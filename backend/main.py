from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# Cargar las variables desde el archivo .env
load_dotenv()

app = FastAPI(title="API Agrometeorológica UNSL")

# Configurar CORS para permitir que el frontend local consulte la API
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:7777,http://127.0.0.1:7777").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Credenciales y configuración (Ahora seguras)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5433")
DB_USER = os.getenv("DB_USER", "reader_user")
DB_PASS = os.getenv("DB_PASS", "")

ID_ESTACION = int(os.getenv("ID_ESTACION", 85))

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
                   EXTRACT(EPOCH FROM (NOW() - fecha_hora))/60 as minutos_pasados
            FROM datos_rem_temp 
            WHERE id_estacion = %s 
            ORDER BY fecha_hora DESC LIMIT 1
        """, (ID_ESTACION,))
        actual = cursor.fetchone()

        if not actual:
            return {"error": "Sin datos"}

        activa = actual["minutos_pasados"] <= 30

        # 2. Obtener predicciones (modelo 1) para las alertas y el panel
        cursor.execute("""
            SELECT horizonte, temperatura_predicha 
            FROM predicciones_temperatura 
            WHERE id_estacion = %s AND modelo = 1 
              AND fecha_generacion = (
                  SELECT MAX(fecha_generacion) 
                  FROM predicciones_temperatura 
                  WHERE id_estacion = %s AND modelo = 1
              )
            ORDER BY horizonte ASC LIMIT 6
        """, (ID_ESTACION, ID_ESTACION))
        predicciones = cursor.fetchall()

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
                "activa": activa,
                "minutos_pasados": int(actual["minutos_pasados"])
            },
            "actual": {
                "temperatura": float(actual["temperatura"]) if actual["temperatura"] is not None else None,
                "humedad": float(actual["humedad"]) if actual["humedad"] is not None else None,
                "viento_velocidad": float(actual["viento_velocidad"]) if actual["viento_velocidad"] is not None else None,
                "viento_direccion": grados_a_cardinal(actual["viento_direccion"]),
                "precipitacion": float(actual["precipitacion"]) if actual["precipitacion"] is not None else None
            },
            "predicciones": predicciones,
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
