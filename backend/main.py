from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# Cargar las variables desde el archivo .env
load_dotenv()

app = FastAPI(title="API Agrometeorológica UNSL")

# ===========================================================================
#  CONFIGURACIÓN OBLIGATORIA (hallazgo H-01)
#  ---------------------------------------------------------------------------
#  Antes, DB_PASS tenía default "" y el resto tenía defaults de desarrollo: si
#  el .env no se cargaba (contenedor sin variables, deploy mal configurado,
#  load_dotenv que no encuentra el archivo), la aplicación arrancaba igual e
#  intentaba conectarse con contraseña vacía. El fallo recién se manifestaba en
#  runtime como un 500 genérico, lo que retrasaba la detección.
#
#  Ahora: falta de configuración = la aplicación no arranca, y el mensaje dice
#  exactamente qué falta. Nunca se registra el VALOR de una credencial, sólo el
#  nombre de la variable.
# ===========================================================================

_faltantes = []
_invalidas = []


def _config(nombre: str) -> str:
    valor = os.getenv(nombre)
    if valor is None or not valor.strip():
        _faltantes.append(nombre)
        return ""
    return valor.strip()


def _config_int(nombre: str) -> int:
    # Sólo se usa para valores no sensibles (puerto, id de estación), por eso
    # es seguro incluir el valor recibido en el mensaje de error.
    crudo = _config(nombre)
    if not crudo:
        return 0
    try:
        return int(crudo)
    except ValueError:
        _invalidas.append("{}={!r} (se esperaba un número entero)".format(nombre, crudo))
        return 0


DB_HOST = _config("DB_HOST")
DB_PORT = _config_int("DB_PORT")
DB_USER = _config("DB_USER")
DB_PASS = _config("DB_PASS")
ID_ESTACION = _config_int("ID_ESTACION")

if _faltantes or _invalidas:
    _detalle = []
    if _faltantes:
        _detalle.append("faltan o están vacías: " + ", ".join(_faltantes))
    if _invalidas:
        _detalle.append("valores inválidos: " + "; ".join(_invalidas))
    raise RuntimeError(
        "Configuración incompleta en backend/.env -> " + " | ".join(_detalle) +
        ". Copiar backend/.env.example a backend/.env y completar los valores."
    )

# Configurar CORS para permitir que el frontend local consulte la API.
# Nota: el frontend se sirve desde esta misma aplicación (StaticFiles al final
# del archivo), así que en producción es same-origin y CORS no interviene.
ALLOWED_ORIGINS = [
    origen.strip()
    for origen in os.getenv("ALLOWED_ORIGINS", "http://localhost:7777,http://127.0.0.1:7777").split(",")
    if origen.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ===========================================================================
#  CABECERAS DE SEGURIDAD (hallazgo H-02)
#  ---------------------------------------------------------------------------
#  StaticFiles de Starlette no emite ninguna cabecera de seguridad. Sin CSP,
#  cualquier XSS puede cargar scripts de cualquier origen y —lo más grave en una
#  PWA— nada restringe desde qué origen se puede registrar un Service Worker,
#  que sobrevive a la navegación e intercepta todo el tráfico de su scope.
#
#  La política es estricta a propósito: la aplicación no tiene scripts ni
#  estilos inline, ni atributos style= en el markup, así que NO hace falta
#  'unsafe-inline' en ningún lado. Los estilos que app.js aplica por JS
#  (element.style.color = ...) son CSSOM, que la CSP no gobierna.
#
#  Los únicos orígenes externos son las tipografías de marca de Google Fonts:
#  la hoja viene de fonts.googleapis.com y los archivos de fuente de
#  fonts.gstatic.com.
# ===========================================================================

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])

# Permite desplegar la CSP en modo observación antes de hacerla obligatoria:
# con CSP_REPORT_ONLY=true el navegador reporta las violaciones por consola
# pero no bloquea nada. Útil para una primera vuelta en producción.
CSP_REPORT_ONLY = os.getenv("CSP_REPORT_ONLY", "false").strip().lower() in ("1", "true", "yes", "si", "sí")

PERMISSIONS_POLICY = ", ".join([
    "geolocation=()",
    "microphone=()",
    "camera=()",
    "payment=()",
    "usb=()",
    "magnetometer=()",
    "accelerometer=()",
])


def _es_https(request: Request) -> bool:
    reenviado = request.headers.get("x-forwarded-proto", "")
    if reenviado:
        return reenviado.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


@app.middleware("http")
async def cabeceras_seguridad(request: Request, call_next):
    response = await call_next(request)

    cabecera_csp = "Content-Security-Policy-Report-Only" if CSP_REPORT_ONLY else "Content-Security-Policy"
    response.headers[cabecera_csp] = CSP

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY

    # HSTS sólo tiene sentido sobre HTTPS; los navegadores la ignoran sobre
    # HTTP, y enviarla siempre confundiría a quien audite las cabeceras en el
    # entorno de desarrollo local.
    if _es_https(request):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response

def get_db_connection(db_name: str):
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=db_name, user=DB_USER, password=DB_PASS
    )

def grados_a_cardinal(grados):
    if grados is None: return "N/D"
    direcciones = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
    indice = int((grados + 22.5) / 45) % 8
    return direcciones[indice]

@app.get("/api/donovan/estado")
def get_donovan_estado():
    conn = get_db_connection("db_rem")
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Obtener datos actuales y calcular si está activa (umbral 30 min)
        cursor.execute("""
            SELECT temperatura, humedad, viento_velocidad, viento_direccion, precipitacion,
                   fecha_hora,
                   EXTRACT(EPOCH FROM (NOW() - fecha_hora))/60 as minutos_pasados
            FROM datos_rem_temp 
            WHERE id_estacion = %s 
            ORDER BY fecha_hora DESC LIMIT 1
        """, (ID_ESTACION,))
        actual = cursor.fetchone()

        if not actual:
            # Se devuelve la MISMA forma que en el caso normal (con nulos) para que el
            # frontend distinga "sin datos" de "estacion inactiva" sin romperse.
            return {
                "estacion": {
                    "estado": "sin_datos",
                    "activa": False,
                    "minutos_pasados": None,
                    "last_reading_at": None
                },
                "actual": {
                    "temperatura": None,
                    "humedad": None,
                    "viento_velocidad": None,
                    "viento_direccion": None,
                    "precipitacion": None
                },
                "predicciones": [],
                "predicciones_generadas_at": None,
                "historial": [],
                "alertas": [],
                "error": "Sin datos"
            }

        minutos_pasados = float(actual["minutos_pasados"])
        activa = minutos_pasados <= 30

        # 2. Obtener predicciones (modelo 1) para las alertas y el panel
        cursor.execute("""
            SELECT horizonte, temperatura_predicha, fecha_generacion
            FROM predicciones_temperatura 
            WHERE id_estacion = %s AND modelo = 1 
              AND fecha_generacion = (
                  SELECT MAX(fecha_generacion) 
                  FROM predicciones_temperatura 
                  WHERE id_estacion = %s AND modelo = 1
              )
            ORDER BY horizonte ASC LIMIT 6
        """, (ID_ESTACION, ID_ESTACION))
        predicciones_raw = cursor.fetchall()

        # La fecha de generación es común a todo el lote: se expone una sola vez y se
        # quita de cada fila para no alterar la forma del array 'predicciones'.
        predicciones_generadas_at = None
        if predicciones_raw and predicciones_raw[0].get("fecha_generacion") is not None:
            predicciones_generadas_at = predicciones_raw[0]["fecha_generacion"].isoformat()

        predicciones = [
            {"horizonte": p["horizonte"], "temperatura_predicha": p["temperatura_predicha"]}
            for p in predicciones_raw
        ]

        # Lógica de alertas (Temperaturas)
        alertas = []
        if predicciones:
            temp_min = min(p["temperatura_predicha"] for p in predicciones)
            temp_max = max(p["temperatura_predicha"] for p in predicciones)
            if temp_min < 4.5:
                alertas.append("¡Alerta por frío extremo!")
            if temp_max > 35:
                alertas.append("¡Alerta por calor extremo!")

        # Lógica de alertas (Viento)
        cursor.execute("""
            SELECT id_estacion, velocidad_viento 
            FROM alertas_viento 
            WHERE id_estacion IN (22, 52, 14, 26) 
              AND fecha_hora_alerta >= NOW() - INTERVAL '4 hours'
            ORDER BY fecha_hora_alerta DESC LIMIT 1
        """)
        alerta_viento = cursor.fetchone()

        if alerta_viento:
            id_origen = alerta_viento['id_estacion']
            velocidad = alerta_viento['velocidad_viento']

            if id_origen == 22:
                direccion = "NORTE"
            elif id_origen in [52, 14, 26]:
                direccion = "SUR"
            else:
                direccion = ""

            alertas.append(f"¡Alerta de Viento {direccion}!")

        # 3. Obtener historial reciente para la gráfica (últimas 6 horas)
        cursor.execute("""
            SELECT fecha_hora, temperatura 
            FROM datos_rem 
            WHERE id_estacion = %s 
            ORDER BY fecha_hora DESC LIMIT 6
        """, (ID_ESTACION,))
        historial = cursor.fetchall()
        historial.reverse()  # Ordenar cronológicamente

        cursor.close()

        return {
            "estacion": {
                # Estado explicito de 3 valores: activa | inactiva | sin_datos
                "estado": "activa" if activa else "inactiva",
                "activa": activa,
                "minutos_pasados": int(minutos_pasados),
                # Timestamp REAL de la ultima lectura guardada en la base.
                # La UI debe mostrar este valor, nunca la hora del dispositivo.
                "last_reading_at": actual["fecha_hora"].isoformat() if actual["fecha_hora"] else None
            },
            "actual": {
                "temperatura": float(actual["temperatura"]) if actual["temperatura"] is not None else None,
                "humedad": float(actual["humedad"]) if actual["humedad"] is not None else None,
                
                "viento_velocidad": round(float(actual["viento_velocidad"]) * 3.6, 1) if actual["viento_velocidad"] is not None else None,
                "viento_direccion": grados_a_cardinal(actual["viento_direccion"]),
                "precipitacion": float(actual["precipitacion"]) if actual["precipitacion"] is not None else None
            },
            "predicciones": predicciones,
            "predicciones_generadas_at": predicciones_generadas_at,
            "historial": historial,
            "alertas": alertas
        }
    finally:
        conn.close()


# Mapeo explícito: sufijo del nombre del sensor -> sector del invernadero
SENSOR_SECTOR_MAP = {
    "SUELO_01": "Sur-Este",
    "SUELO_02": "Nor-Este",
    "SUELO_03": "Nor-Oeste",
    "SUELO_04": "Sur-Oeste",
    "AMB_40CM": "Centro (40cm)",
    "AMB_2M": "Centro (2m)",
}

@app.get("/api/invernadero/sectores")
def get_invernadero_sectores():
    conn = get_db_connection("sistema_iot")
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Agregamos el cálculo de minutos pasados para detectar sensores caídos
        cursor.execute("""
            SELECT s.nombre, m.valor,
                   EXTRACT(EPOCH FROM (NOW() - m.fecha_hora))/60 as min_pasados
            FROM sensor s
            JOIN medicion m ON s.id_sensor = m.id_sensor
            WHERE s.id_zona = 1
              AND m.fecha_hora = (
                  SELECT MAX(fecha_hora) 
                  FROM medicion 
                  WHERE id_sensor = s.id_sensor
              )
        """)
        mediciones = cursor.fetchall()
        cursor.close()

        # Diccionario base "fijo" con todos los sensores de la tabla (menos luz)
        sectores = {
            "Nor-Oeste": {"temperatura": None, "humedad": None},
            "Nor-Este": {"temperatura": None, "humedad": None},
            "Sur-Oeste": {"temperatura": None, "humedad": None},
            "Sur-Este": {"temperatura": None, "humedad": None},
            "Centro (40cm)": {"temperatura": None, "humedad": None},
            "Centro (2m)": {"temperatura": None, "humedad": None}
        }

        humedad_total = []

        for med in mediciones:
            nombre = med["nombre"].upper()

            if med["min_pasados"] is None or med["min_pasados"] > 120:
                valor = None
            else:
                valor = float(med["valor"])

            if nombre.startswith("TEMP_"):
                tipo, clave_sensor = "temperatura", nombre[len("TEMP_"):]
            elif nombre.startswith("HUM_"):
                tipo, clave_sensor = "humedad", nombre[len("HUM_"):]
            else:
                continue

            if tipo == "humedad" and valor is not None:
                valor = round(valor)

            sec_key = SENSOR_SECTOR_MAP.get(clave_sensor)
            if sec_key:
                sectores[sec_key][tipo] = valor
                if tipo == "humedad" and valor is not None:
                    humedad_total.append(valor)

        humedad_promedio = sum(humedad_total) / len(humedad_total) if humedad_total else 0

        return {
            "humedad_promedio": round(humedad_promedio, 1),
            "sectores": sectores
        }
    finally:
        conn.close()
    

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "../public")

app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
