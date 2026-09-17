# Auditoría PWA SIVAI

**Fecha:** 2026-09-15
**Commit base auditado:** `678a6d0` (rama `master`)
**Alcance:** Frontend (`public/`), Service Worker, Web App Manifest, API REST (`backend/main.py`).

---

## 0. Stack identificado

| Capa | Tecnología | Observación |
|---|---|---|
| Frontend | HTML + CSS plano + JavaScript vanilla | Sin framework, sin build, sin gestor de estado. El estado vive en el DOM y en la variable global `chartInstance`. |
| Gráficos | Chart.js vendorizado (`public/chart.min.js`) | Servido localmente, no por CDN. Bien. |
| Service Worker | **Custom, no Workbox** (`public/sw.js`) | 52 líneas antes de la intervención. Un único cache `sivai-v1`, estrategia cache-first indiscriminada. |
| Manifest | `public/manifest.json` estático | Sin generación por build. |
| API REST | FastAPI + psycopg2 (`backend/main.py`) | 2 endpoints GET. Además sirve `public/` con `StaticFiles(html=True)`. |
| Persistencia | PostgreSQL, bases `db_rem` y `sistema_iot` | Usuario de sólo lectura (`reader_user` por defecto). |
| Tests | **Ninguno** | No hay `package.json`, ni pytest, ni CI. |

---

## 1. Resumen de hallazgos

| Severidad | Cantidad | Corregidos | Pendientes |
|---|---|---|---|
| Crítico | 3 | 2 | 1 |
| Alto | 6 | 5 | 1 |
| Medio | 8 | 3 | 5 |
| Bajo | 5 | 0 | 5 |
| **Total** | **22** | **10** | **12** |

Los hallazgos corregidos son los que caían dentro del alcance explícito de los puntos C1–C5, más dos fallas de robustez que el propio cambio de contrato dejaba al descubierto (H-09 y H-10). El resto quedó documentado y priorizado sin tocar, según la restricción de alcance (punto F).

**Actualización del 2026-09-17:** los dos hallazgos críticos de seguridad que habían quedado a la espera de confirmación —**H-01** (credenciales con defaults permisivos) y **H-02** (ausencia de CSP y cabeceras de seguridad)— fueron **aprobados y aplicados**. El crítico pendiente es ahora H-17, la ausencia total de cobertura de tests, que es un proyecto en sí mismo.

---

## 2. Seguridad

### H-01 · CRÍTICO · Credenciales de base de datos con valores por defecto permisivos
**Archivo:** `backend/main.py:25-30`

```python
DB_USER = os.getenv("DB_USER", "reader_user")
DB_PASS = os.getenv("DB_PASS", "")
```

**Descripción:** si `.env` no se carga (deploy mal configurado, contenedor sin variables, `load_dotenv()` que no encuentra el archivo), la aplicación no falla: arranca silenciosamente e intenta conectarse con contraseña vacía. El mismo patrón aplica a `DB_HOST`, `DB_PORT` e `ID_ESTACION`.

**Riesgo:** en un servidor PostgreSQL con `trust` o `md5` mal configurado, un default vacío puede conectar. Peor aún, el fallo se manifiesta como error 500 genérico en runtime en lugar de un fallo de arranque explícito, lo que retrasa la detección.

**Fix aplicado:** ✅ Las cinco variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `ID_ESTACION`) pasaron a ser **obligatorias**: ya no tienen valores por defecto. Si falta alguna, o está vacía, o `DB_PORT`/`ID_ESTACION` no son enteros, la aplicación **no arranca**.

La validación acumula todos los problemas y falla una sola vez con la lista completa, en lugar de ir fallando de a una:

```
RuntimeError: Configuración incompleta en backend/.env ->
  faltan o están vacías: DB_PASS.
  Copiar backend/.env.example a backend/.env y completar los valores.
```

El mensaje nombra **la variable, nunca su valor**, para no filtrar credenciales a los logs. La única excepción son `DB_PORT` e `ID_ESTACION`, que no son secretos y cuyo valor recibido sí se muestra porque ayuda a diagnosticar.

Se agregó `backend/.env.example` con las variables documentadas, y se corrigió `.gitignore`: el patrón `.env*` estaba excluyendo también la plantilla, así que se añadió la excepción `!.env.example`. Verificado que el `.env` real sigue ignorado.

**Verificado** en tres escenarios (ver casos T-34 a T-36 del informe de testing): sin `.env`, con `DB_PASS` vacía —el caso exacto del hallazgo— y con `DB_PORT` no numérico.

---

### H-02 · CRÍTICO · Ausencia total de Content-Security-Policy y cabeceras de seguridad
**Archivo:** `backend/main.py:225` (`app.mount("/", StaticFiles(...))`), `public/index.html` (todo el `<head>`)

**Descripción:** la aplicación no emite `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` ni `X-Frame-Options`. `StaticFiles` de Starlette no agrega ninguna de ellas.

Consecuencias concretas para una PWA:
- Sin CSP, cualquier XSS que se logre inyectar (ver H-05) puede cargar y ejecutar scripts de cualquier origen.
- **Sin CSP, nada restringe el origen desde el que se puede registrar un Service Worker** (`worker-src` / `script-src`). Un SW comprometido persiste entre sesiones e intercepta todo el tráfico del scope.
- Sin `X-Content-Type-Options: nosniff`, un asset servido con MIME ambiguo puede ser interpretado como script.

**Riesgo:** amplificación de cualquier otra vulnerabilidad. En una PWA la superficie es mayor que en una web común porque el SW sobrevive a la navegación.

**Fix propuesto:** middleware de cabeceras en FastAPI:

```python
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "worker-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response
```

**Fix aplicado:** ✅ Middleware de cabeceras en FastAPI, que cubre **todas** las respuestas — el API, los estáticos y el propio `sw.js`.

La política quedó **estricta, sin `'unsafe-inline'` en ninguna directiva**. Eso fue posible porque se auditó primero qué la rompería, y el resultado fue: nada.

- Cero atributos `style="..."` en el markup.
- Cero bloques `<style>` o `<script>` inline.
- Cero llamadas a `setAttribute('style', ...)`.
- Las seis asignaciones `element.style.x = ...` que quedan en `app.js` son **CSSOM**, y la CSP no gobierna el CSSOM — sólo los estilos que llegan por markup. Chart.js dimensiona su canvas por la misma vía, así que tampoco necesita excepción.

La migración de estilos inline que este hallazgo anticipaba como prerequisito ya se había hecho al corregir C3, lo que dejó el camino libre.

Política resultante:

```
default-src 'self'; script-src 'self';
style-src 'self' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:; connect-src 'self';
worker-src 'self'; manifest-src 'self';
object-src 'none'; frame-ancestors 'none';
base-uri 'self'; form-action 'self'
```

`worker-src 'self'` es la directiva que cierra el vector específico de PWA que motivaba este hallazgo: restringe el origen desde el que se puede registrar un Service Worker.

Cabeceras adicionales: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` y `Permissions-Policy` denegando geolocalización, micrófono, cámara, pagos, USB y sensores de movimiento — coherente con que la aplicación no solicita ningún permiso (ver H-08).

`Strict-Transport-Security` se emite **sólo sobre HTTPS** (detectando `X-Forwarded-Proto` para funcionar detrás de un reverse proxy). Los navegadores la ignoran sobre HTTP, y enviarla siempre confundiría a quien audite las cabeceras en desarrollo local.

**Interruptor de despliegue seguro:** con `CSP_REPORT_ONLY=true` la política se emite como `Content-Security-Policy-Report-Only`, de modo que el navegador reporta las violaciones por consola sin bloquear nada. Recomendado para la primera vuelta en producción, por si algún recurso externo no detectado en el análisis estático aparece en runtime.

**Verificado en el navegador** con la política aplicada (no en modo report-only): **cero violaciones**. Cargan correctamente Chart.js, ambas tipografías de Google Fonts (`Anek Latin` y `Reddit Sans` en estado `loaded`), los tres logos institucionales, los dos endpoints del API y el gráfico. Ver casos T-37 a T-39.

---

### H-03 · ALTO · HTTPS no está forzado en ningún punto
**Archivos:** `backend/main.py` (completo), `public/manifest.json:4` (`"start_url": "./"`)

**Descripción:** no hay `HTTPSRedirectMiddleware`, no hay HSTS, y el `start_url` es relativo. Si la app se sirve por HTTP, el Service Worker directamente **no se registra** (los SW exigen contexto seguro, salvo en `localhost`), con lo que la PWA pierde instalabilidad, caché y modo offline sin ningún mensaje de error para el usuario.

**Riesgo:** pérdida silenciosa de toda la funcionalidad PWA + tráfico de datos agrometeorológicos en claro, interceptable y modificable en la red del establecimiento rural.

**Fix propuesto:** TLS en el reverse proxy + `HTTPSRedirectMiddleware` + `Strict-Transport-Security: max-age=31536000`. Adicionalmente, detectar el fallo en el cliente:

```js
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    console.warn('SIVAI requiere HTTPS: el Service Worker no se registrará.');
}
```

**Estado:** ❌ NO aplicado — es configuración de despliegue, fuera del código.

---

### H-04 · ALTO · Datos agrometeorológicos cacheados sin control de vigencia
**Archivo:** `public/sw.js:24-40` (versión original)

```js
if (event.request.url.includes('/api/')) {
  return;
}
event.respondWith(caches.match(event.request).then(response => response || fetch(...)));
```

**Descripción:** la exclusión de `/api/` se hacía con `url.includes('/api/')`, un match sobre la URL completa. Una URL como `https://cdn.ejemplo.com/api/tracking.js` habría quedado excluida por accidente, y una ruta propia que contuviera `/api/` en el query string (`?redirect=/api/x`) también. Más de fondo: **el resto de recursos se servía cache-first sin ninguna revalidación**, incluido `index.html`.

**Riesgo:** un agricultor podía quedar viendo una versión vieja de la aplicación indefinidamente. En el contexto de alertas de helada, servir la UI de una versión anterior con la lógica de umbrales vieja es un riesgo operativo real.

**Fix aplicado:** ✅ El match ahora es sobre `url.pathname.startsWith('/api/')` con parseo real de la URL, se descartan los `origin` de terceros y los métodos distintos de GET, y el HTML pasó a **network-first**.

Verificado: `sw.js:80-111`.

---

### H-05 · MEDIO · Datos del API inyectados vía `innerHTML` / `insertAdjacentHTML`
**Archivos:** `public/app.js` — `renderNodes()` (`insertAdjacentHTML` con `node.ubicacion` y `node.valor`), bloque de predicciones (`pred.horizonte`), `generarCartelTendencia()`.

**Descripción:** valores provenientes del API REST se concatenan en plantillas HTML sin escapar.

**Riesgo actual: BAJO.** Las claves de sector (`node.ubicacion`) no vienen de la base: se construyen en el backend desde el diccionario literal `SENSOR_SECTOR_MAP` (`backend/main.py:145-152`) y del diccionario base `sectores` (`backend/main.py:177-184`). Los valores numéricos pasan por `float()`/`round()`. O sea: hoy no hay una ruta por la que un dato controlado por un atacante llegue a esos `innerHTML`.

**Riesgo futuro: MEDIO.** El día que un sector o una etiqueta de alerta pase a leerse de la base (por ejemplo `SELECT nombre FROM sensor`), esto se convierte en XSS almacenado sin que nadie lo note, y sin CSP (H-02) que lo contenga.

**Fix propuesto:** escapar en el punto de render.

```js
const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
```
…y usar `esc(node.ubicacion)` / `esc(node.valor)` en `renderNodes()`. Alternativamente, construir los nodos con `document.createElement` + `textContent`.

**Estado:** ❌ NO aplicado — no es un hallazgo crítico explotable hoy y el punto F restringe cambios fuera de C. Va como ítem prioritario en las sugerencias (E-1).

---

### H-06 · MEDIO · `alertas_viento` consulta estaciones hardcodeadas sin validar
**Archivo:** `backend/main.py:112-118`

```sql
WHERE id_estacion IN (22, 52, 14, 26)
```

**Descripción:** los ids de estación de referencia para las alertas de viento están hardcodeados en la query, y el mapeo id→dirección está hardcodeado en Python (`22 → NORTE`, `[52,14,26] → SUR`). No hay SQL injection (no hay interpolación de input), pero sí un acoplamiento frágil: si la base renumera estaciones, la app anuncia direcciones de viento incorrectas sin fallar.

**Riesgo:** información meteorológica errónea presentada como correcta. No es seguridad en sentido estricto, es integridad del dato.

**Fix propuesto:** mover el mapeo a configuración (`.env` o tabla de la base) y registrar un warning si el id no está en el mapa.

**Estado:** ❌ NO aplicado — fuera de alcance.

---

### H-07 · BAJO · Variable sin uso que sugiere funcionalidad incompleta
**Archivo:** `backend/main.py:123` — `velocidad = alerta_viento['velocidad_viento']`

Se lee la velocidad del viento de la alerta y nunca se usa; el mensaje final es `f"¡Alerta de Viento {direccion}!"`. Probablemente se pretendía incluir la magnitud. No es un riesgo, es deuda.

**Estado:** ❌ NO aplicado.

---

### H-08 · INFORMATIVO · Permisos y almacenamiento — sin hallazgos
Revisado explícitamente y **sin problemas**:
- ✅ No se solicita `Notification.requestPermission()`, geolocalización, cámara, micrófono ni ningún otro permiso. La PWA no pide nada.
- ✅ No hay uso de `localStorage`, `sessionStorage` ni `IndexedDB`. No hay tokens ni credenciales en el cliente.
- ✅ No hay autenticación: la API es de sólo lectura y pública dentro de su red. No hay secretos que exponer en el cliente.
- ✅ `.gitignore` cubre `.env` y `.env*` correctamente (`.gitignore:1-3`). No hay credenciales versionadas.
- ✅ CORS está restringido por `ALLOWED_ORIGINS` y limitado a `allow_methods=["GET"]` (`backend/main.py:15-22`). Correcto, aunque el default apunta a localhost.

---

## 3. Implementación

### H-09 · ALTO · El `activate` del SW no purgaba realmente, y nunca tomaba el control
**Archivo:** `public/sw.js:43-52` (versión original)

```js
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(cacheNames =>
    Promise.all(cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))));
});
```

**Descripción:** tres fallas encadenadas.
1. **No había `skipWaiting()`**: el SW nuevo quedaba en estado `waiting` hasta que se cerraran *todas* las pestañas de la app. En una PWA instalada que el usuario deja abierta, eso puede ser días.
2. **No había `clients.claim()`**: aun activándose, no controlaba las páginas ya cargadas.
3. **El precache de `install` usaba `cache.addAll()` sin `cache: 'reload'`**, con lo que los assets se tomaban del HTTP cache del navegador — podían entrar al cache del SW ya obsoletos.

**Riesgo:** exactamente el síntoma reportado — tras un deploy el usuario seguía viendo la versión anterior indefinidamente, sin forma de saberlo ni de forzarlo salvo desinstalando la PWA.

**Fix aplicado:** ✅ Reescrito completo (`sw.js:39-75`), implementando la secuencia exigida por C2:
`install → skipWaiting()` → `activate → caches.keys() + delete de TODOS` → `re-fetch con cache:'reload'` → `clients.claim()` → `postMessage('SW_UPDATED')`.
En el cliente (`app.js`), `controllerchange` + el mensaje `SW_UPDATED` disparan una recarga única, y se agregó `reg.update()` periódico y al volver a primer plano.

Verificado con arnés de test — ver `resultados_testing_pwa_sivai.md`, casos T-06 a T-09.

---

### H-10 · ALTO · `RangeError: Invalid array length` con historial vacío
**Archivo:** `public/app.js:218` (original) — `initUnifiedChart()`

```js
let paddingArray = Array(histValues.length - 1).fill(null);
```

**Descripción:** si `historial` viene vacío, `histValues.length - 1` es `-1` y `Array(-1)` lanza `RangeError`, abortando `actualizarDashboard()` a mitad de camino y dejando el dashboard renderizado parcialmente.

**Riesgo:** una estación recién dada de alta, o una purga de la tabla `datos_rem`, rompe la pantalla completa.

**Fix aplicado:** ✅ `Math.max(0, histValues.length - 1)` más una rama explícita para el caso sin historial (`app.js`, `initUnifiedChart`). Detectado durante el testing del escenario `sin_datos`, que este mismo ticket habilitó.

---

### H-11 · ALTO · La respuesta "Sin datos" rompía el frontend
**Archivos:** `backend/main.py:60-61` (original) → `public/app.js:185` (original)

```python
if not actual:
    return {"error": "Sin datos"}
```
```js
generarCartelTendencia(donovan.actual.temperatura, ...);  // TypeError
```

**Descripción:** el backend devolvía un objeto con una forma completamente distinta al caso normal. El frontend accedía a `donovan.actual.temperatura` sin guarda → `TypeError: Cannot read properties of undefined`. La pantalla quedaba congelada en "Cargando…" sin explicación.

**Riesgo:** falla total de la UI justo en el escenario en que el usuario más necesita saber qué pasa.

**Fix aplicado:** ✅ El endpoint devuelve ahora la misma forma con nulos y un `estado: "sin_datos"` explícito (`backend/main.py:60-82`), y el frontend tiene guardas en todos los accesos (`app.js`).

---

### H-12 · ALTO · Sin timeouts ni manejo de error en las llamadas al API
**Archivo:** `public/app.js:31-45` (original)

```js
try {
    const resDonovan = await fetch(`${API_BASE_URL}/api/donovan/estado`);
    const resInv = await fetch(`${API_BASE_URL}/api/invernadero/sectores`);
    if(resDonovan.ok && resInv.ok) { ... }
} catch (error) {
    console.error("Error conectando con la API:", error);
}
```

**Descripción:** cuatro problemas en 14 líneas.
1. Sin `AbortController`: un servidor que acepta la conexión pero no responde deja el `fetch` colgado indefinidamente.
2. Las dos peticiones son **secuenciales** sin necesidad; duplica la latencia.
3. Si `resDonovan.ok` es `false` (por ejemplo 503), **no pasa absolutamente nada**: no hay `else`. La UI queda con los datos viejos, o en "Cargando…", sin señal alguna.
4. El `catch` sólo hace `console.error`. El usuario nunca se entera.

**Riesgo:** el agricultor ve un dashboard que parece funcionar y toma decisiones con datos viejos, sin ninguna indicación de que la conexión se cortó. Este es, en términos operativos, el hallazgo más peligroso del informe después de H-02.

**Fix aplicado:** ✅ `AbortController` con timeout de 12 s, `Promise.all` para paralelizar, rama `else` explícita para respuestas no-OK, y un indicador visual de conexión con cuatro estados (`ok`/`loading`/`offline`/`error`).

---

### H-13 · MEDIO · Sin manejo de estado offline/online
**Archivo:** `public/app.js` (original, completo)

**Descripción:** no había listeners de `online`/`offline`, ni chequeo de `navigator.onLine`. Estando sin conexión, el polling seguía disparando fetches que fallaban silenciosamente cada 5 minutos.

**Fix aplicado:** ✅ Listeners `online`/`offline`, chequeo previo de `navigator.onLine` antes de cada fetch, y refetch automático al recuperar la conexión.

> **Nota de alcance:** el punto C no pedía construir este indicador, pero el punto D exige probar explícitamente la transición online→offline→online "y que el indicador de estado responda correctamente". El indicador no existía, así que se implementó lo mínimo para que ese caso de prueba sea ejecutable. Queda señalado como adición consciente.

---

### H-14 · MEDIO · Condición de carrera en el polling por `visibilitychange`
**Archivo:** `public/app.js:318-325` (original)

```js
document.addEventListener('visibilitychange', () => {
    if (document.hidden) { detenerPolling(); }
    else { fetchDashboardData(); iniciarPolling(); }
});
```

**Descripción:** al volver a primer plano se dispara `fetchDashboardData()` sin cancelar una petición eventualmente en vuelo. Con dos llamadas concurrentes, la que responde última gana — que no es necesariamente la más reciente. Con la red móvil inestable de una zona rural, una respuesta vieja puede pisar a una nueva.

**Riesgo:** mostrar datos más viejos que los ya recibidos. Baja probabilidad, impacto medio.

**Fix propuesto:** un token de secuencia monotónico; descartar respuestas cuyo token no sea el último emitido.

**Estado:** ❌ NO aplicado — fuera del alcance de C. Va a sugerencias (E-3).

---

### H-15 · MEDIO · `chart.min.js` se carga bloqueando el render
**Archivo:** `public/index.html:18` — `<script src="./chart.min.js"></script>` en el `<head>`, sin `defer`.

Chart.js son ~200 KB que bloquean el parseo del HTML. En un teléfono de gama baja con 3G rural, esto es directamente tiempo de pantalla en blanco.

**Fix propuesto:** `<script src="./chart.min.js" defer></script>`. Es seguro: `app.js` sólo lo usa dentro de `DOMContentLoaded`.

**Estado:** ❌ NO aplicado. Va a sugerencias (E-2).

---

### H-16 · BAJO · `<div class="section-header-flex">` sin cerrar
**Archivo:** `public/index.html:150-173`

El `div` abierto en la línea 150 nunca se cierra. El parser del navegador lo cierra implícitamente en `</section>`, con lo que `.chart-wrapper` y `#hourly-forecast-grid` quedan **dentro** de `section-header-flex` en lugar de ser hermanos suyos. Hoy no se nota porque no existe ninguna regla CSS `.section-header-flex`, pero sí anula el `gap: 16px` del contenedor flex padre entre esos tres bloques.

**Fix propuesto:** cerrar el `div` después de `.farmer-explanation-box`.

**Estado:** ❌ NO aplicado — corregirlo altera levemente el espaciado vertical del bloque 2, lo cual es un cambio visual fuera de C. Va a sugerencias (E-4).

---

## 4. QA

### H-17 · CRÍTICO (de proceso) · Cero cobertura de tests
**Archivos:** todo el repositorio.

No existe ningún test: ni unitario, ni de integración, ni e2e. No hay `package.json`, ni `pytest`, ni pipeline de CI. Cada cambio se valida a mano, y este mismo ticket es la prueba: el bug H-10 (`RangeError`) llevaba en el código desde que se escribió `initUnifiedChart` y sólo apareció cuando se construyó un escenario de prueba específico.

**Riesgo:** una lógica que dispara **alertas de helada** (umbral `< 4.5 °C`, `backend/main.py:106`) no tiene ni un solo test. Un error de signo o de comparación ahí tiene consecuencias económicas directas sobre el cultivo.

**Fix propuesto (mínimo viable, por prioridad):**
1. `pytest` sobre `grados_a_cardinal()` — función pura, 8 casos, 10 minutos de trabajo.
2. `pytest` sobre la lógica de umbrales de alerta, extrayéndola a una función pura `calcular_alertas(predicciones, alerta_viento)`.
3. Tests de `formatearAntiguedad()` y `partesTimestamp()` en el frontend (Vitest o un runner mínimo).
4. e2e con Playwright sobre los 6 escenarios que ya están definidos en el mock server de este ticket.

**Estado:** ❌ NO aplicado — es un proyecto en sí mismo. Es la recomendación #1 del punto E.

---

### H-18 · MEDIO · Casos borde no contemplados (inventario)

| Caso borde | Antes | Ahora |
|---|---|---|
| Sin conexión al abrir por primera vez | SW cacheaba, pero el HTML podía servirse stale y la UI quedaba en "Cargando…" sin explicación | ✅ Fallback a `index.html` cacheado + banner "Sin conexión" |
| API caída (5xx) | ❌ Silencio absoluto, UI congelada | ✅ Banner rojo de error |
| API con timeout infinito | ❌ Fetch colgado para siempre | ✅ `AbortController` a 12 s |
| `historial` vacío | ❌ `RangeError`, dashboard roto | ✅ Manejado (H-10) |
| `predicciones` vacías | ⚠️ Quedaban en pantalla los valores del ciclo anterior | ✅ Se limpian a `--°C - --°C` |
| Estación sin lecturas (`Sin datos`) | ❌ `TypeError`, UI congelada | ✅ Estado "SIN DATOS" propio |
| Sensores con `valor = null` | ✅ Ya se manejaba (nodo "Inactivo") | ✅ Sin cambios |
| Todos los sensores caídos | ⚠️ `humedad_promedio: 0` se muestra como "0%", indistinguible de humedad real 0% | ❌ **Pendiente** — ver E-5 |
| Estación inactiva vs. sin datos | ❌ Ambos casos mostraban "INACTIVA" | ✅ Estados separados |
| `fecha_hora` nulo en una fila del historial | ❌ `new Date(null)` → 1970 en el eje X | ✅ Se muestra `--:--` |

---

### H-19 · MEDIO · Inconsistencia entre lo cacheado y lo mostrado
**Archivo:** `public/sw.js` (original) + `public/app.js:67-68` (original)

**Descripción:** el problema de fondo que motivó C1. El SW no cacheaba `/api/`, con lo que offline no había datos nuevos — pero la UI mostraba `new Date()`, **la hora del dispositivo en el momento del render**. Resultado: una pantalla con datos de hace 6 horas rotulada "Última actualización: 14:32" porque el usuario abrió la app a las 14:32.

**Riesgo:** ALTO en términos operativos. Es peor que no mostrar nada: afirma activamente una frescura que el dato no tiene.

**Fix aplicado:** ✅ El backend expone `last_reading_at` (timestamp real de `datos_rem_temp.fecha_hora`) y `minutos_pasados` calculado en SQL (`NOW() - fecha_hora`), inmune al reloj y a la zona horaria del cliente. La UI muestra "hace 2 horas" + la fecha/hora exacta de la lectura. Las horas del pronóstico se anclan a `predicciones_generadas_at`, no al reloj local.

---

## 5. UX y accesibilidad

### H-20 · ALTO · El borde del banner quedaba verde con alerta activa
**Archivo:** `public/styles.css:272-281` + `public/app.js:71-98` (original)

```css
.status-banner {
  background-color: var(--color-surface-soft);  /* verde menta, FIJO */
  border: 2px solid #C5EE90;                    /* verde, FIJO */
}
```

**Diagnóstico — la pregunta del punto C3 ("¿CSS o lógica?"): es CSS.** La condición JavaScript estaba bien evaluada (`donovan.alertas.length > 0` entraba correctamente a la rama de alerta y cambiaba el texto, el color del título y el ícono del escudo). Lo que faltaba es que **nadie tocaba nunca el borde ni el fondo del contenedor**: estaban hardcodeados en la regla base de `.status-banner` y no existía ninguna clase de estado que los sobrescribiera.

El resultado era un banner con fondo verde menta, borde verde, y adentro un título naranja diciendo "Atención Requerida". Contradictorio y, a distancia o de reojo —que es como se mira un dashboard en un invernadero—, se lee como "todo bien".

**Riesgo:** ALTO. Una alerta de helada que se percibe como estado seguro es una pérdida de cultivo.

**Fix aplicado:** ✅ Clases de estado `status-safe` / `status-alert` / `status-nodata` en CSS, aplicadas desde `setClaseBannerEstado()` en el mismo punto donde ya se decidía el resto del estado visual.

El estado de alerta replica **el mismo esquema visual que el estado seguro, trasladado a la escala naranja** — no sólo el borde:

| Rol | Estado seguro | Estado alerta | Contraste |
|---|---|---|---|
| Fondo | `#E8F8CE` (verde menta) | **`#F8E2CE`** (naranja claro) | — |
| Borde | `#C5EE90` | **`#E67E22`** | — |
| Título | `#0A3632` | **`#9A4A0A`** | 4.99:1 ✅ |
| Badge y descripción | `#0A3632` | **`#7A3E0A`** | 6.65:1 ✅ |
| Escudo | `#72C02C` | **`#B3580C`** | 3.88:1 ✅ |

El naranja claro del fondo se derivó del verde menta manteniendo saturación y luminosidad en HSL (L=89%, S≈75%), de modo que ambos estados pesan lo mismo visualmente y sólo cambia el matiz.

**Corolario importante — se eliminó la causa raíz, no sólo el síntoma:** los colores del banner se definen ahora **exclusivamente en CSS**. Se quitaron los cuatro `element.style.color = "..."` que `app.js` aplicaba sobre `#status-main-title` y `.status-shield-icon`. Un estilo inline gana siempre sobre la hoja de estilos, así que mientras existieran, cualquier estado que olvidara actualizarlos quedaba con el color del ciclo anterior — exactamente el mecanismo del bug original. Verificado: `getAttribute('style')` devuelve `(ninguno)` en los tres estados.

Verificado contra el backend real: fondo `rgb(248,226,206)`, borde `rgb(230,126,34)`, y transición seguro↔alerta repetida 4 veces sin residuos.

---

### H-21 · ALTO · Badge de estación inactiva ilegible
**Archivo:** `public/app.js:63` (original)

```js
domElements.stationBadge.innerHTML = `<span class="badge-active" style="color: red;">INACTIVA</span>`;
```

**Descripción:** se reutilizaba la clase `.badge-active`, que define `background-color: var(--color-accent)` (`#A0E35D`, verde brote), y se le pisaba sólo el color del texto a `red`. El resultado: **texto rojo sobre fondo verde**. Contraste calculado: **1.94:1** — muy por debajo del mínimo AA de 4.5:1, y una de las peores combinaciones posibles para daltonismo rojo-verde (protanopía/deuteranopía), que afecta a cerca del 8% de los varones.

Peor: la estación inactiva seguía teniendo **fondo verde**, el mismo color que el estado activo.

Además, al pasar de activo a inactivo no se reseteaba `stationBadge.style.color`, dejando el verde `#72C02C` del ciclo anterior sobre el ícono.

**Fix aplicado:** ✅ Modificador `.badge-inactive` con fondo `#D93838` y texto blanco (contraste **4.59:1**, cumple AA), y `.badge-nodata` con fondo `#5A6B5A` y texto blanco (**5.7:1**) para el estado intermedio. El color del wrapper se setea explícitamente en las tres ramas.

---

### H-22 · MEDIO · Problemas de contraste preexistentes (medidos)

Contrastes calculados sobre los colores reales del CSS:

| Elemento | Colores | Ratio | Mínimo | Resultado |
|---|---|---|---|---|
| `.node-status.active` "● Activo" | `#27AE60` sobre `#F8FAF8` | **2.74:1** | 4.5 | ❌ Falla |
| `.node-status` inactivo | `#888888` sobre `#F0F2F0` | **3.15:1** | 4.5 | ❌ Falla |
| `.hourly-hour` (hora del pronóstico) | `#888888` sobre `#F8FAF8` | **3.38:1** | 4.5 | ❌ Falla |
| `.status-shield-icon` en estado **seguro** | `#72C02C` sobre `#E8F8CE` | **2.02:1** | 3.0 | ❌ Falla |
| `.prediction-label` | `#666666` sobre `#F8FAF8` | 5.47:1 | 4.5 | ✅ |
| `.status-badge-title` seguro | `#0A3632` sobre `#E8F8CE` | 11.82:1 | 4.5 | ✅ |
| Badge ACTIVA | `#0A3632` sobre `#A0E35D` | 8.6:1 | 4.5 | ✅ |

Los cuatro que fallan son **preexistentes** y quedan fuera del alcance de C.

⚠️ Aclaración sobre el escudo verde: al mover los colores del banner de estilos inline a CSS (ver H-20), esa línea fue tocada, pero **el color no cambió** — era `#72C02C` inline y sigue siendo `#72C02C` en CSS. No es una regresión introducida por este ticket; simplemente quedó medido al auditar los tres estados. Elevar el verde a `#4E8C1E` daría 3.42:1 y lo pondría en regla.

El caso del título de alerta en naranja puro (`#E67E22`, 2.56:1 sobre el fondo anterior) **sí se corrigió**, porque el rediseño del estado de alerta lo requería: sobre el fondo naranja nuevo habría bajado a 2.27:1. Ver H-20 para la paleta resultante, toda en AA.

**Fix propuesto para los 4 restantes:** subir `#888888` a `#6B6B6B` (4.6:1), `#27AE60` a `#1E8449` (4.6:1) y el escudo verde a `#4E8C1E`.

**Estado:** ❌ NO aplicado — fuera de alcance. Sugerencia E-6.

---

### H-23 · MEDIO · Sin feedback de carga en el primer render
**Archivo:** `public/index.html:98` — `<h2 id="status-main-title">Cargando...</h2>`

El único indicador de carga era la palabra "Cargando..." hardcodeada en el HTML, que nunca se limpiaba si el fetch fallaba. No había spinner, ni skeleton, ni distinción entre "cargando" y "falló".

**Fix aplicado (parcial):** ✅ El banner de conexión cubre ahora los estados `loading` / `offline` / `error`. El skeleton de las tarjetas sigue pendiente (sugerencia E-7).

---

### H-24 · BAJO · Tamaños táctiles
No hay controles interactivos en la aplicación (ni botones, ni links, ni inputs) — el dashboard es puramente de lectura. Las reglas `.toggle-btn` del CSS (`styles.css:710-731`) corresponden a un control que **no existe en el HTML**: es CSS muerto. Por lo tanto no hay violaciones del mínimo de 44×44 px, simplemente porque no hay nada que tocar.

⚠️ Cuando se agreguen los toggles Histórico/Predicción que ese CSS anticipa, verificar el tamaño: `padding: 8px 16px` sobre texto de `0.85rem` da aproximadamente 34 px de alto, por debajo del mínimo.

---

### H-25 · BAJO · `maximum-scale=5.0` en el viewport
**Archivo:** `public/index.html:6`

Limitar el zoom máximo es una barrera de accesibilidad para usuarios con baja visión. 5× es permisivo y no viola WCAG 1.4.4 (que exige 200%), pero no hay ninguna razón para el límite. Quitarlo es gratis.

---

## 6. Tabla resumen de hallazgos

| ID | Sev. | Área | Archivo:línea | Título | Estado |
|---|---|---|---|---|---|
| H-01 | Crítico | Seguridad | `backend/main.py:25-30` | Credenciales con defaults permisivos | ✅ Corregido |
| H-02 | Crítico | Seguridad | `backend/main.py:225` | Sin CSP ni cabeceras de seguridad | ✅ Corregido |
| H-03 | Alto | Seguridad | `backend/main.py` | HTTPS no forzado | ❌ Infraestructura |
| H-04 | Alto | Seguridad | `sw.js:24-40` | Caché sin control de vigencia | ✅ Corregido |
| H-05 | Medio | Seguridad | `app.js` (`renderNodes`) | `innerHTML` sin escapar | ❌ Sugerencia E-1 |
| H-06 | Medio | Seguridad | `backend/main.py:112-118` | Ids de estación hardcodeados | ❌ Fuera de alcance |
| H-07 | Bajo | Impl. | `backend/main.py:123` | Variable `velocidad` sin uso | ❌ Deuda |
| H-08 | Info | Seguridad | — | Permisos/storage: sin hallazgos | ✅ Verificado OK |
| H-09 | Alto | Impl. | `sw.js:43-52` | `activate` sin purga real ni claim | ✅ Corregido (C2) |
| H-10 | Alto | Impl. | `app.js:218` | `RangeError` con historial vacío | ✅ Corregido |
| H-11 | Alto | Impl. | `backend/main.py:60` | "Sin datos" rompía el frontend | ✅ Corregido |
| H-12 | Alto | Impl. | `app.js:31-45` | Sin timeouts ni manejo de error | ✅ Corregido |
| H-13 | Medio | Impl. | `app.js` | Sin manejo offline/online | ✅ Corregido |
| H-14 | Medio | Impl. | `app.js:318-325` | Carrera en `visibilitychange` | ❌ Sugerencia E-3 |
| H-15 | Medio | Impl. | `index.html:18` | `chart.min.js` bloquea el render | ❌ Sugerencia E-2 |
| H-16 | Bajo | Impl. | `index.html:150` | `<div>` sin cerrar | ❌ Sugerencia E-4 |
| H-17 | Crítico | QA | — | Cero cobertura de tests | ❌ Sugerencia E-0 |
| H-18 | Medio | QA | — | Casos borde no contemplados | ✅ 9 de 10 corregidos |
| H-19 | Medio | QA | `app.js:67-68` | Timestamp del cliente, no del dato | ✅ Corregido (C1) |
| H-20 | Alto | UX | `styles.css:272-281` | Fondo y borde verdes con alerta activa | ✅ Corregido (C3) |
| H-21 | Alto | UX | `app.js:63` | Badge inactiva ilegible (1.94:1) | ✅ Corregido (C4) |
| H-22 | Medio | UX | `styles.css` (varios) | Contrastes por debajo de AA | ❌ Sugerencia E-6 |
| H-23 | Medio | UX | `index.html:98` | Sin feedback de carga | ✅ Parcial |
| H-24 | Bajo | UX | `styles.css:710-731` | CSS muerto de toggles | ❌ Informativo |
| H-25 | Bajo | UX | `index.html:6` | `maximum-scale=5.0` | ❌ Informativo |

---

## 7. Hallazgos críticos de seguridad — ✅ aplicados

Conforme al punto F, estos dos hallazgos se reportaron aparte y se aplicaron **una vez confirmados** (2026-09-17).

### Qué cambia en el despliegue — leer antes de subir a producción

**H-01 · La aplicación ahora falla al arrancar si falta configuración.**
Es el comportamiento correcto —mejor un fallo ruidoso al arrancar que un 500 silencioso en runtime con contraseña vacía— pero **es un cambio de comportamiento en el arranque**. Antes de desplegar, confirmar que el entorno de producción define las cinco variables: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `ID_ESTACION`. Si alguna se inyecta por otro mecanismo (variables del contenedor, secretos del orquestador) y no por `.env`, sigue funcionando: la validación lee `os.getenv`, no el archivo.

**H-02 · La CSP es estricta y podría bloquear recursos externos no detectados.**
El análisis estático del código no encontró nada que la política rompa, y la verificación en navegador dio cero violaciones. Aun así, si en producción se sirve algún recurso desde un origen que no esté en el repositorio (un script de analítica, un CDN, una fuente distinta), quedaría bloqueado.

Mitigación recomendada para la primera vuelta:

```bash
CSP_REPORT_ONLY=true
```

Con eso el navegador reporta las violaciones por consola sin bloquear nada. Revisar la consola un par de días y luego quitar la variable para que la política pase a aplicarse.

### Lo que sigue pendiente en seguridad

**H-03 · HTTPS no está forzado.** Deliberadamente NO se agregó un `HTTPSRedirectMiddleware`: rompería el entorno de desarrollo local sobre HTTP y, sobre todo, la terminación TLS corresponde al reverse proxy, no a la aplicación. Lo que sí quedó listo es la cabecera `Strict-Transport-Security`, que se emite automáticamente en cuanto la aplicación detecte que la petición llegó por HTTPS (directamente o vía `X-Forwarded-Proto`). **Falta la configuración de TLS en el proxy**, que es trabajo de infraestructura.

---

## 8. Sugerencias priorizadas (punto E)

Mejoras **fuera del alcance de C**, derivadas de los hallazgos de esta auditoría. Ordenadas por relación impacto/esfuerzo.

| # | Mejora | Hallazgo | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|---|---|
| **E-0** | **Suite de tests mínima.** Empezar por las funciones puras: `grados_a_cardinal()`, la lógica de umbrales de alerta (extrayéndola a `calcular_alertas()`), `formatearAntiguedad()` y `partesTimestamp()`. Después, e2e con Playwright reutilizando los 6 escenarios del mock server de este ticket, que ya están escritos. | H-17 | 🔴 Muy alto | Medio | **1** |
| **E-1** | **Escapar el HTML en `renderNodes()`** y en las plantillas de predicción. Hoy no es explotable porque todos los strings vienen de diccionarios literales del backend, pero es una bomba de tiempo: el día que un sector se lea de la base, se convierte en XSS almacenado, y sin CSP (H-02) nada lo contiene. 10 líneas de trabajo. | H-05 | 🟠 Alto | Muy bajo | **2** |
| **E-2** | **`defer` en `chart.min.js`.** Un atributo. Hoy ~200 KB bloquean el parseo del HTML en el `<head>`; en un teléfono de gama baja con 3G rural eso es tiempo de pantalla en blanco. Es seguro: `app.js` sólo usa Chart dentro de `DOMContentLoaded`. | H-15 | 🟠 Alto | Trivial | **3** |
| **E-3** | **Token de secuencia en el polling** para descartar respuestas fuera de orden, más un reintento con backoff ante fallo (hoy se espera el ciclo completo de 5 minutos). Elimina la carrera de `visibilitychange` y mejora la recuperación en redes inestables. | H-14, feature 80 | 🟡 Medio | Bajo | **4** |
| **E-4** | **Cerrar el `<div class="section-header-flex">`** de `index.html:150`. Hoy el parser lo cierra solo y `.chart-wrapper` + `#hourly-forecast-grid` quedan anidados donde no corresponde, anulando el `gap` del contenedor flex. Revisar el espaciado resultante al aplicarlo. | H-16 | 🟡 Medio | Trivial | **5** |
| **E-5** | **Distinguir "0 %" de "sin datos" en el promedio de humedad.** El backend devuelve `humedad_promedio: 0` cuando *todos* los sensores están caídos, y la UI lo muestra como "0%" — indistinguible de una humedad real de 0 %. Devolver `null` y mostrar `--%`. | H-18 | 🟡 Medio | Muy bajo | **6** |
| **E-6** | **Corregir los 4 contrastes por debajo de AA.** El más importante: el título de alerta en `#E67E22` sobre fondo claro da 2.56:1. Usar `#8A4B10` para el texto (6.11:1, ya validado en este ticket) y reservar el naranja para bordes e íconos, donde 3:1 alcanza y sí se cumple. | H-22 | 🟡 Medio | Bajo | **7** |
| **E-7** | **Skeleton de carga** en las tarjetas de métricas durante el primer render, en lugar del "Cargando..." hardcodeado en el HTML que nunca se limpia si el fetch falla. | H-23 | 🟢 Bajo | Bajo | **8** |
| **E-8** | **Notificaciones push para alertas críticas.** Es la feature con mayor valor de producto pendiente: una alerta de helada sirve de poco si el agricultor tiene que abrir la app para verla. Requiere VAPID, endpoint de suscripción, tabla de suscriptores y handler `push` en el SW. Es un proyecto, no un fix. | Feature 16 | 🔴 Muy alto | Alto | **9** |
| **E-9** | **`apple-touch-icon` a PNG.** iOS ignora los SVG en esa etiqueta; hoy apunta a `SIVAI_favicon.svg`. Cambiar a `icons/SIVAI_Icono-PWA192x192.png`. | Feature 26 | 🟢 Bajo | Trivial | **10** |

**Recomendación de secuencia:** E-2, E-4, E-5, E-9 son cambios triviales que pueden ir todos en un mismo commit de limpieza. E-1 y E-6 son de bajo esfuerzo y cierran hallazgos reales de seguridad y accesibilidad. E-0 merece su propio ticket y debería ir antes que cualquier feature nueva. E-8 es una decisión de producto, no técnica.
