# Resultados de testing — PWA SIVAI

**Fechas:** 2026-09-15 (primera ronda, mock server) · 2026-09-17 (segunda ronda, backend real; tercera ronda, correcciones de seguridad)
**Responsable:** auditoría técnica del ticket "Auditoría y corrección de la PWA SIVAI"

---

## 0. Actualización — segunda ronda de pruebas (2026-09-17)

Tras la primera ronda se instalaron **Python 3.14.7** y **PostgreSQL 18**, y se restauraron las bases reales. Todas las pruebas se re-ejecutaron contra el **backend FastAPI real conectado a PostgreSQL**, ya no contra el mock.

**Entorno real verificado:**

| Componente | Estado |
|---|---|
| Python | 3.14.7 (`C:\Python314`) |
| Dependencias | `pip install -r backend/requirements.txt` → OK; `fastapi 0.139.2`, `psycopg2`, `uvicorn` importan |
| PostgreSQL | 18, servicio `postgresql-x64-18` corriendo, puerto 5432 |
| `backend/.env` | Configurado por el equipo (`localhost:5432`, `reader_user`, `ID_ESTACION=85`) |
| Base `db_rem` | 11 tablas. `datos_rem` 332 509 filas, `predicciones_temperatura` 64 992, `datos_rem_temp` 21 030, `alertas_viento` 787 |
| Base `sistema_iot` | 5 tablas. `medicion` 820 300 filas, `sensor` 13 |
| Servidor | `python -m uvicorn main:app --host 127.0.0.1 --port 7777` → OK |

**Zona horaria — duda de la primera ronda, resuelta.** El caso T-24 advertía sobre un posible desfase. Verificado contra la base real:

- TZ del servidor PostgreSQL: `America/Argentina/Buenos_Aires`
- `datos_rem_temp.fecha_hora` es `timestamp without time zone` y guarda **hora local**: última lectura `2026-09-17 08:07:00` contra `NOW() = 2026-09-17 08:55:05-03:00`, con `minutos_pasados = 48`. Coherente.
- **No hay desfase.** La UI muestra "Lectura: 17/09 08:07", que es exactamente lo que dice la base.
- Detalle a tener presente: `predicciones_temperatura.fecha_generacion` **sí** es `timestamptz` (devuelve `2026-09-17T08:00:00-03:00`). El parseo del frontend lee los componentes literales e ignora el offset, con lo que toma la hora local tal como está almacenada — que es lo correcto para etiquetar el pronóstico.

**Resultado:** los 5 cambios de C siguen pasando contra datos reales. Se agregaron los casos **T-25 a T-31**. Detalle en la sección 2 bis.

---

## 1. Entorno de pruebas — y sus límites

### Primera ronda (2026-09-15) — mock server

En la primera ronda la máquina **no tenía Python ni Node.js**, por lo que no se pudo levantar el backend real. Se construyó un servidor de pruebas en PowerShell (`System.Net.HttpListener`) que sirve `public/` sobre `http://localhost:7777` y **mockea los dos endpoints del API** reproduciendo exactamente el contrato de respuesta del backend modificado, con seis escenarios conmutables en caliente:

| Escenario | Qué simula |
|---|---|
| `normal` | Estación activa, lectura de hace 7 min, sin alertas, 6 sensores OK |
| `alerta` | Alerta de frío extremo + alerta de viento SUR |
| `inactiva` | **Estación que no reporta hace exactamente 2 horas** (criterio de aceptación C1) |
| `sin_datos` | La estación no tiene ninguna lectura en la base |
| `parcial` | Sensores mixtos: algunos con dato, otros en `null` |
| `caida` | El API responde 503 a todo |

Se agregó además `/__deploy/<v>` para simular un despliegue nuevo (cambia `SW_VERSION` y el CSS servidos).

Ubicación: `%TEMP%\claude\...\scratchpad\testserver.ps1` (fuera del repositorio, no se versiona).

### Lo que NO se pudo probar — y por qué

> ⚠️ **El navegador embebido del entorno bloquea el registro de Service Workers.**
> Confirmado en las dos rondas: contra el mock en PowerShell **y contra uvicorn real**.

Diagnóstico realizado, en este orden:

1. `navigator.serviceWorker.register('sw.js')` falla con `TypeError: ... An unknown error occurred when fetching the script.`
2. Un `fetch('/sw.js')` normal desde la misma página funciona perfecto: **HTTP 200**, `Content-Type: application/javascript; charset=utf-8`, 5 880 bytes, `window.isSecureContext === true`.
3. Se añadió `Content-Length` explícito y la cabecera `Service-Worker-Allowed: /` al servidor. Sin cambios.
4. Se probó con un Service Worker **mínimo y trivial** (`self.addEventListener("install",()=>self.skipWaiting());`). **Falla exactamente igual.**
5. Se instrumentó el mock con un log de accesos. Tras un intento de registro, el log contiene únicamente `12:20:19 / SW=`. La petición del script nunca llega.
6. **Prueba decisiva (segunda ronda):** se repitió contra **uvicorn real**, cuyo log de acceso es de un servidor de producción y no de un script casero. Con la página cargada desde `http://127.0.0.1:7777/`, uvicorn registra todas las peticiones del navegador — `/`, `/app.js`, `/styles.css`, `/chart.min.js`, los cuatro íconos, ambos endpoints del API — y **ninguna a `/sw.js`**. El único `GET /sw.js` del log proviene de una verificación manual hecha con PowerShell desde otra conexión TCP.

**Conclusión:** queda descartado el servidor de pruebas como causa. El navegador embebido no emite la petición del script del Service Worker. Tampoco hay una instancia de Chrome real conectada a este entorno (`list_connected_browsers` devuelve una lista vacía), así que no hubo forma de sortearlo.

**Cómo se compensó:** se escribió un arnés que carga el código fuente real de `sw.js` y lo ejecuta con `self`, `caches`, `fetch` y `clients` simulados, disparando los eventos `install`, `activate` y `fetch` y registrando la **secuencia exacta de operaciones**. Esto verifica la lógica del Service Worker de forma rigurosa y reproducible; **no** verifica su integración con el ciclo de vida real del navegador. Los casos así validados están marcados **PASS (arnés)**.

---

## 2. Resultados por caso

### Bloque 1 — Funcionalidad base (regresión)

#### T-01 · Dashboard completo, escenario normal — **PASS**
Desktop, Chromium, escenario `normal`.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Badge de estación | ACTIVA, fondo verde | ✅ `rgb(160,227,93)`, texto `rgb(10,54,50)` |
| Temperatura exterior | 22.6 °C | ✅ `22.6°C` |
| Humedad | 54 % | ✅ `54%` |
| Viento | 12.4 km/h NE | ✅ `12.4km/h NE` |
| Rango de predicción | 23–25 °C | ✅ `23°C - 25°C` |
| Tarjetas de pronóstico | 6 | ✅ 6 (`13:00`…`18:00`) |
| Nodos de sensores | 12 (6 hum + 6 temp) | ✅ 12, todos "● Activo" |
| Promedio de temperatura | 24.7 °C | ✅ `24.7°C` |
| Cartel de tendencia | Ascenso hasta 25.2 °C | ✅ "…en aumento desde los 22.6°C hasta 25.2°C hacia 16:00" |
| Gráfico Chart.js | Renderiza | ✅ |
| Errores en consola | Ninguno | ✅ Ninguno |

Se confirma que **toda la funcionalidad preexistente sigue intacta** (restricción F del pedido).

---

#### T-02 · **C3 — Fondo y borde del banner de alerta** — **PASS** ✅
Escenario `alerta` (frío extremo + viento SUR). Re-verificado en la segunda ronda contra el backend real (ver T-27).

| Verificación | Esperado | Obtenido |
|---|---|---|
| Clase del banner | `status-alert` | ✅ `"status-banner status-alert"` |
| **Color del borde** | Naranja `#E67E22` | ✅ **`rgb(230, 126, 34)`** |
| **Color de fondo** | Naranja claro `#F8E2CE` | ✅ **`rgb(248, 226, 206)`** |
| Color del título | `#9A4A0A` | ✅ `rgb(154, 74, 10)` |
| Color de badge y descripción | `#7A3E0A` | ✅ `rgb(122, 62, 10)` |
| Color del escudo | `#B3580C` | ✅ `rgb(179, 88, 12)` |
| **Estilos inline residuales** | Ninguno | ✅ `getAttribute('style')` → `(ninguno)` |
| Título del badge | "¡ALERTA ACTIVA!" | ✅ |
| Título principal | "Atención Requerida" | ✅ |
| Descripción | Las 2 alertas concatenadas | ✅ "¡Alerta por frío extremo! \| ¡Alerta de Viento SUR!" (acentos y `¡` correctos) |
| Ícono del escudo | Cruz (X) | ✅ |

**Antes del cambio:** fondo `rgb(232, 248, 206)` (`#E8F8CE`, verde menta) y borde `rgb(197, 238, 144)` (`#C5EE90`, verde) — el bug reportado. El banner mostraba un fondo verde de "estado seguro" con un título naranja adentro: contradictorio, y de reojo se leía como "todo bien".

**El estado de alerta ahora replica el esquema del estado seguro trasladado al naranja:** mismo rol para cada color, misma luminosidad de fondo (derivada en HSL del verde menta: L=89 %, S≈75 %), sólo cambia el matiz. Ver la tabla comparativa en el hallazgo H-20 de la auditoría.

**Diagnóstico del bug (respuesta a la pregunta de C3): era CSS, no lógica.** La condición `donovan.alertas.length > 0` se evaluaba correctamente y cambiaba texto, color de título e ícono. Lo que fallaba es que el borde y el fondo estaban hardcodeados en la regla base `.status-banner` (`styles.css:272-281`) y **ningún código los tocaba jamás**. No existía una clase de estado que los sobrescribiera.

**Causa raíz eliminada, no sólo el síntoma:** se quitaron además los cuatro `element.style.color = "..."` que `app.js` aplicaba sobre el título y el escudo. Un estilo inline gana siempre sobre la hoja de estilos: mientras existieran, cualquier estado que se olvidara de actualizarlos quedaba con el color del ciclo anterior — el mismo mecanismo que produjo el bug. Ahora los tres estados se definen sólo en CSS. Verificado en T-28.

---

#### T-03 · **C1 + C4 — Timestamp real y badge inactiva** — **PASS** ✅
Escenario `inactiva`. Lectura de la base: `10:21`. Hora del dispositivo al renderizar: `12:21`.

| Verificación | Esperado | Obtenido |
|---|---|---|
| **Antigüedad (criterio de aceptación C1)** | **"hace 2 horas"** | ✅ **`hace 2 horas`** |
| Fecha/hora exacta de la lectura | 15/09 10:21 | ✅ En el tooltip (ver T-40) |
| Tooltip | Lectura registrada | ✅ "Última lectura registrada: 15/09 10:21" |
| Clase de lectura vieja | `reading-stale` | ✅ |
| **Badge: texto** | **INACTIVA** | ✅ |
| **Badge: fondo rojo** | `#D93838` | ✅ **`rgb(217, 56, 56)`** |
| **Badge: texto blanco** | `#FFFFFF` | ✅ **`rgb(255, 255, 255)`** |
| Clases del badge | `badge-active badge-inactive` | ✅ |
| **Horas del pronóstico** | Ancladas al servidor (10:21) → 11:00–16:00 | ✅ **`11:00,12:00,13:00,14:00,15:00,16:00`** |

**Prueba clave del anclaje al servidor:** si las horas del pronóstico se calcularan con el reloj del cliente (12:21), las tarjetas dirían `13:00`–`18:00`. Dicen `11:00`–`16:00`, o sea que salen de `predicciones_generadas_at`. **Confirmado: no se usa el reloj del dispositivo.**

**Antes del cambio:** el campo mostraba `12:21` — la hora local del renderizado — para un dato de hace 2 horas, y el badge era texto rojo sobre fondo verde (contraste 1.94:1).

---

#### T-04 · **C4 (parte 2) — Estado intermedio "sin datos"** — **PASS** ✅
Escenario `sin_datos`. Este caso verifica la salvedad del pedido: *"que no quede un estado intermedio mal contemplado (ej. 'sin datos' vs 'inactiva' tratados igual por error)"*.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Texto del badge | Distinto de "INACTIVA" | ✅ `SIN DATOS` |
| Clases del badge | `badge-nodata` | ✅ `badge-active badge-nodata` |
| Fondo del badge | Gris, no rojo ni verde | ✅ `rgb(90, 107, 90)` |
| Texto del badge | Blanco | ✅ `rgb(255, 255, 255)` |
| Clase del banner | `status-nodata` | ✅ |
| Borde del banner | Gris neutro | ✅ `rgb(185, 194, 185)` |
| Título del banner | No afirma "seguro" | ✅ "Estado desconocido" / "SIN DATOS" |
| Descripción | Explica la falta de datos | ✅ "La estación no está reportando lecturas. No hay información para evaluar alertas." |
| Antigüedad | Sin dato | ✅ `sin datos` |
| Métricas | Todas en `--` | ✅ `--°C`, `--%`, `--km/h` |
| Rango de predicción | Limpio | ✅ `--°C - --°C` |
| Tarjetas de pronóstico | 0 | ✅ 0 |
| Nodos de sensores | 12 en estado inactivo | ✅ 12 |
| Banner de conexión | Oculto (el API respondió bien) | ✅ `hidden` |
| Errores en consola | Ninguno | ✅ Ninguno |

**Antes del cambio:** este escenario mostraba "INACTIVA" (indistinguible de una estación caída) **y además rompía la UI por completo** — el backend devolvía `{"error": "Sin datos"}`, una forma de respuesta distinta, y el frontend lanzaba `TypeError` al leer `donovan.actual.temperatura`.

---

#### T-05 · Datos parciales de sensores — **PASS**
Escenario `parcial` (3 de 6 sensores de temperatura con dato, 3 de 6 de humedad).

| Verificación | Esperado | Obtenido |
|---|---|---|
| Nodos con dato | "● Activo" + valor | ✅ 6 nodos |
| Nodos sin dato | "○ Inactivo" + `--` | ✅ 6 nodos |
| **Promedio sólo sobre los activos** | (25.0+23.8+24.1)/3 = **24.3** | ✅ **`24.3°C`** |
| Promedio de humedad | Del API | ✅ `61.5%` |
| Errores en consola | Ninguno | ✅ Ninguno |

El promedio **no** cuenta los `null` como ceros — verificado numéricamente.

---

### Bloque 2 — Service Worker (C2)

Casos T-06 a T-12: ejecutados con el arnés descrito en la sección 1.

#### T-06 · Registro de handlers y `skipWaiting` en `install` — **PASS (arnés)** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| Handlers registrados | install, activate, fetch, message | ✅ los 4 |
| Operaciones del evento `install` | Sólo `skipWaiting` | ✅ `["skipWaiting"]` |
| Nombre del caché | `sivai-v2` | ✅ |

---

#### T-07 · **Purga total de cachés en `activate`** — **PASS (arnés)** ✅
Estado inicial simulado: tres cachés — `sivai-v1`, `sivai-v0-viejo`, `otro-cache`.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Se enumeran los cachés | `caches.keys()` | ✅ |
| **Se borran TODOS los previos** | Los 3 | ✅ `delete:sivai-v1`, `delete:sivai-v0-viejo`, `delete:otro-cache` |
| Cachés restantes | Sólo `sivai-v2` | ✅ `["sivai-v2"]` |
| Sin residuos de versiones previas | — | ✅ `purgoTodosLosViejos: true` |

**Antes del cambio:** se borraban sólo los cachés con nombre distinto del actual, y —más grave— sin `skipWaiting()` el evento `activate` **no se disparaba** hasta que el usuario cerrara todas las pestañas de la app. En una PWA instalada, eso podía ser días.

---

#### T-08 · **Re-descarga limpia de assets críticos** — **PASS (arnés)** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| Assets re-descargados | 12 | ✅ 12 |
| **Todos con `cache: 'reload'`** | Saltea el HTTP cache del navegador | ✅ `todosFetchConReload: true` |
| Orden | La descarga ocurre **después** de la purga | ✅ `caches.open` posterior a los 3 `delete` |
| Se guardan en el caché nuevo | `cache.put` por cada uno | ✅ |

`cache: 'reload'` es lo que garantiza que ni siquiera el HTTP cache del navegador pueda devolver un asset de la versión anterior — el requisito literal de "descarga desde cero".

---

#### T-09 · **`clients.claim()` al final, y aviso a los clientes** — **PASS (arnés)** ✅

Secuencia completa registrada:

```
skipWaiting
caches.keys
caches.delete:sivai-v1
caches.delete:sivai-v0-viejo
caches.delete:otro-cache
caches.open:sivai-v2
fetch:/            |cache=reload
fetch:/index.html  |cache=reload
        ... (12 fetch + 12 cache.put) ...
cache.put:./icons/inta_logo.png
clients.claim
clients.matchAll
postMessage:SW_UPDATED
```

| Verificación | Esperado | Obtenido |
|---|---|---|
| `claim()` posterior a la purga | Sí | ✅ `claimDespuesDePurga: true` |
| `claim()` posterior a la descarga | Sí | ✅ `claimDespuesDeDescarga: true` |
| Aviso a los clientes | `{type:'SW_UPDATED', version:'v2'}` | ✅ |

**El orden exigido por el criterio de aceptación C2 se cumple exactamente:** purga → descarga limpia → recién entonces toma de control. En ningún momento hay una ventana en la que un cliente controlado pueda recibir un recurso de la versión anterior.

---

#### T-10 · Estrategias de caché por tipo de recurso — **PASS (arnés)** ✅

| Petición | Estrategia esperada | Obtenido |
|---|---|---|
| `GET /api/donovan/estado` | **No interceptar** (datos siempre frescos) | ✅ No interceptado |
| `POST` same-origin | No interceptar | ✅ No interceptado |
| `GET https://fonts.googleapis.com/...` | No interceptar (tercero) | ✅ No interceptado |
| Navegación HTML | **network-first** | ✅ Respondió desde red |
| Asset ya cacheado (`styles.css`) | **cache-first** | ✅ Respondió desde caché |
| Asset no cacheado (`nuevo.png`) | Red + guardar en caché | ✅ Respondió desde red |

**Antes del cambio:** todo lo que no fuera `/api/` se servía cache-first sin revalidación, **incluido `index.html`**, y el filtro de API era un `url.includes('/api/')` sobre la URL completa (frágil ante terceros o query strings).

---

#### T-11 · Recarga automática del cliente tras actualizar — **PASS (código) / PENDIENTE (e2e)** ⚠️
**No verificable de extremo a extremo** por el bloqueo de Service Workers del entorno.

Lo verificado por inspección del código (`app.js`):
- ✅ Se captura `habiaControlador` **antes** de registrar, para no recargar en la primera instalación.
- ✅ `controllerchange` dispara `recargarUnaVez()`.
- ✅ El mensaje `SW_UPDATED` dispara la misma función.
- ✅ Bandera `recargando` que garantiza una sola recarga (evita el bucle clásico de recarga infinita).
- ✅ `reg.update()` cada hora y al volver la pestaña a primer plano.

**Queda pendiente de ejecución en dispositivo real** — ver sección 4, caso T-21.

---

#### T-12 · Fallback offline del network-first — **PASS (arnés)** ✅

Simulando `fetch` que lanza `TypeError: Failed to fetch` con `index.html` presente en el caché:

| Verificación | Esperado | Obtenido |
|---|---|---|
| Respuesta a la navegación | Desde el caché | ✅ `cache-fallback` |

O sea: sin conexión, la app **abre igual** con la última versión cacheada, en lugar de mostrar el dinosaurio del navegador.

---

### Bloque 3 — Manifest (C5)

#### T-13 · **C5 — `background_color` del splash** — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| **`background_color`** | **`#0A3632`** | ✅ **`#0A3632`** |
| `theme_color` | `#0A3632` | ✅ `#0A3632` |
| `<meta name="theme-color">` | `#0A3632` | ✅ `#0A3632` |
| `display` | `standalone` | ✅ |
| `start_url` | `./` | ✅ |
| Íconos declarados | ≥ 2 | ✅ 5 |
| Íconos `maskable` | ≥ 1 | ✅ 2 |
| `<link rel="manifest">` presente | Sí | ✅ |

**Antes del cambio:** `background_color: "#ffffff"` — la pantalla de carga de la app instalada era **blanca**, sin relación con la identidad de marca, y con un salto visual brusco al aparecer el header verde.

---

#### T-14 · Splash screen renderizado en la app instalada — **PENDIENTE** 🔒
Requiere instalar la PWA en un dispositivo real. Ver sección 4, caso T-22.

---

### Bloque 4 — Conectividad

#### T-15 · Transición online → **offline** — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| Banner visible | Sí | ✅ `hidden: false` |
| Clase | `is-offline` | ✅ `connection-banner is-offline` |
| Texto | Explica el estado | ✅ "Sin conexión — se muestran los últimos datos recibidos" |
| Color de fondo | Gris neutro | ✅ `rgb(90, 107, 90)` |
| Color del texto | Blanco (5.7:1) | ✅ `rgb(255, 255, 255)` |
| **Los datos previos siguen visibles** | No se borra la pantalla | ✅ `22.6°C` sigue presente |
| Accesibilidad | `role="status"`, `aria-live="polite"` | ✅ |

---

#### T-16 · Transición offline → **online** — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| Banner se oculta | Sí | ✅ `hidden: true` |
| Clases de estado limpiadas | Sin `is-offline` | ✅ `"connection-banner"` |
| **Refetch automático** | Datos actualizados | ✅ `hace 7 minutos` |
| Intervención del usuario | Ninguna | ✅ Ninguna |

**Ciclo completo online → offline → online verificado.**

---

#### T-17 · API caída (HTTP 503) — **PASS** ✅
Escenario `caida`.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Banner visible | Sí | ✅ `hidden: false` |
| Clase | `is-error` | ✅ `connection-banner is-error` |
| Texto | Explica el fallo | ✅ "No se pudo contactar al servidor — datos posiblemente desactualizados" |
| Fondo | Rojo `#D93838` | ✅ `rgb(217, 56, 56)` |
| Texto | Blanco (4.59:1, cumple AA) | ✅ `rgb(255, 255, 255)` |

**Antes del cambio:** un 503 producía **silencio absoluto**. El código tenía `if (resDonovan.ok && resInv.ok) { ... }` **sin rama `else`**: la UI se quedaba mostrando datos viejos, o congelada en "Cargando…", sin ninguna señal.

---

### Bloque 5 — Responsive y accesibilidad

#### T-18 · Desktop — **PASS**
Viewport ~800 px. Grilla de 2 columnas, bloque 2 a todo el ancho, 6 nodos sensores en una fila. Sin solapamientos.

#### T-19 · Mobile 375×812 — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| **Scroll horizontal** | Ninguno | ✅ `scrollWidth 375 === innerWidth 375` |
| Layout | Columna única | ✅ |
| Header | Logos institucionales apilados | ✅ |
| Borde de alerta | Naranja también en mobile | ✅ `rgb(230, 126, 34)` |
| Antigüedad de la lectura | Legible | ✅ "hace 6 minutos" + "Lectura: 15/09 12:16" |
| Banner de alerta | Legible, sin desbordar | ✅ |

---

#### T-20 · Contraste de color (WCAG AA, 4.5:1) — **PASS parcial** ⚠️

Colores **nuevos** introducidos por este ticket:

| Elemento | Colores | Ratio | AA |
|---|---|---|---|
| Badge INACTIVA | blanco / `#D93838` | **4.59:1** | ✅ |
| Badge SIN DATOS | blanco / `#5A6B5A` | **5.70:1** | ✅ |
| Texto del banner de alerta | `#8A4B10` / `#FDF1E6` | **6.11:1** | ✅ |
| Texto del banner sin datos | `#4A544A` / `#F0F2F0` | **7.02:1** | ✅ |
| Banner de error | blanco / `#D93838` | **4.59:1** | ✅ |
| Banner offline | blanco / `#5A6B5A` | **5.70:1** | ✅ |

**Todos los colores nuevos cumplen AA.**

Elementos **preexistentes** que no cumplen (fuera del alcance de C, ver sugerencia E-6):

| Elemento | Colores | Ratio | AA |
|---|---|---|---|
| `#status-main-title` en alerta | `#E67E22` / `#FDF1E6` | 2.56:1 | ❌ |
| `.node-status.active` | `#27AE60` / `#F8FAF8` | 2.74:1 | ❌ |
| `.node-status` inactivo | `#888888` / `#F0F2F0` | 3.15:1 | ❌ |
| `.hourly-hour` | `#888888` / `#F8FAF8` | 3.38:1 | ❌ |

---

## 2 bis. Segunda ronda — casos contra el backend real (2026-09-17)

Servidor: `python -m uvicorn main:app --host 127.0.0.1 --port 7777`, conectado a PostgreSQL 18 con las bases restauradas. **Los datos de estos casos son reales, no simulados.**

Estado de la estación 85 durante las pruebas: última lectura `2026-09-17 08:07`, o sea **48–53 minutos de antigüedad** → por encima del umbral de 30 min, la estación está genuinamente **inactiva**. Sirvió para verificar C1 y C4 con datos reales sin fabricar nada.

#### T-25 · Contrato de respuesta del backend real — **PASS** ✅

`GET /api/donovan/estado` contra PostgreSQL:

| Verificación | Obtenido |
|---|---|
| `estacion.estado` | ✅ `"inactiva"` |
| `estacion.activa` | ✅ `false` |
| `estacion.minutos_pasados` | ✅ `48` (entero) |
| **`estacion.last_reading_at`** | ✅ `"2026-09-17T08:07:00"` |
| **`predicciones_generadas_at`** | ✅ `"2026-09-17T08:00:00-03:00"` |
| `predicciones[]` sólo con `horizonte` + `temperatura_predicha` | ✅ `fecha_generacion` correctamente movida al nivel superior |
| `historial[]` | ✅ 6 lecturas horarias |
| `alertas[]` | ✅ `[]` (sin alertas reales en ese momento) |

`GET /api/invernadero/sectores`: ✅ `humedad_promedio: 85.0`, 6 sectores, **2 con `temperatura: null`** (sensores caídos reales — el escenario "parcial" se dio solo).

Estáticos servidos por `StaticFiles`: `/`, `/app.js`, `/sw.js`, `/styles.css`, `/manifest.json` → todos **200** con el MIME correcto.

---

#### T-26 · **C1 + C4 con datos reales de PostgreSQL** — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| **Antigüedad** | Derivada de la base | ✅ `hace 48 minutos`, luego `hace 53 minutos` |
| **Fecha de lectura** | La de la base, sin convertir zona | ✅ `17/09 08:07` en el tooltip |
| Clase de lectura vieja | `reading-stale` | ✅ |
| **Badge** | INACTIVA rojo/blanco | ✅ `rgb(217,56,56)` / `rgb(255,255,255)` |
| Temperatura | La de la base (11.5 °C) | ✅ `11.5°C` |
| Horas del pronóstico | Ancladas a `predicciones_generadas_at` (08:00) | ✅ `09:00,10:00,11:00,12:00,13:00,14:00` |

**Prueba de que no se usa el reloj del cliente:** la hora del dispositivo al renderizar era **08:55**; la UI muestra **08:07**, el timestamp real de la lectura.

**Verificación de sincronía UI ↔ API:** se consultó el endpoint y el DOM en el mismo instante. API `minutos_pasados = 53`, UI `"hace 53 minutos"`. Coinciden exactamente — no hay render obsoleto.

---

#### T-27 · **C3 con el backend real** — **PASS** ✅

No había alertas meteorológicas reales durante la ventana de prueba. Se consultó la base: ninguna estación tiene predicciones bajo 4,5 °C ni sobre 35 °C en su última corrida del modelo 1, y no hay registros en `alertas_viento` de las últimas 4 horas.

Para ejercitar la rama de alerta **sin modificar la base de datos del equipo**, se interceptó en el navegador únicamente el array `alertas` de la respuesta real; todo lo demás —temperaturas, timestamps, historial, sensores— siguió viniendo de PostgreSQL.

| Verificación | Obtenido |
|---|---|
| Clase | ✅ `status-banner status-alert` |
| **Fondo** | ✅ `rgb(248, 226, 206)` = `#F8E2CE` |
| **Borde** | ✅ `rgb(230, 126, 34)` = `#E67E22` |
| Título | ✅ `rgb(154, 74, 10)` |
| Badge y descripción | ✅ `rgb(122, 62, 10)` |
| Escudo | ✅ `rgb(179, 88, 12)` |
| Estilos inline | ✅ `(ninguno)` |
| Codificación de acentos | ✅ "¡Alerta por frío extremo! \| ¡Alerta de Viento SUR!" |
| Temperatura de fondo | ✅ `11.5°C` — sigue siendo el dato real de la base |

---

#### T-28 · **Transición seguro ↔ alerta sin residuos** — **PASS** ✅

Este caso existe específicamente para verificar que la causa raíz del bug de C3 quedó eliminada. Se alternó el estado **4 veces sobre la misma página, sin recargar**, disparando el ciclo de refresco real de la aplicación:

| Paso | Clase | Fondo | Borde | Escudo | Inline |
|---|---|---|---|---|---|
| 1 · seguro | `status-safe` | `rgb(232,248,206)` | `rgb(197,238,144)` | `rgb(114,192,44)` | ninguno |
| 2 · alerta | `status-alert` | `rgb(248,226,206)` | `rgb(230,126,34)` | `rgb(179,88,12)` | ninguno |
| 3 · vuelve a seguro | `status-safe` | `rgb(232,248,206)` | `rgb(197,238,144)` | `rgb(114,192,44)` | ninguno |
| 4 · alerta otra vez | `status-alert` | `rgb(248,226,206)` | `rgb(230,126,34)` | `rgb(179,88,12)` | ninguno |

Los pasos 1 y 3 son idénticos, y los pasos 2 y 4 también. **Ningún color queda "pegado" de un estado al siguiente.** Con los estilos inline anteriores esto no se podía garantizar.

---

#### T-29 · **Backend real caído** — **PASS** ✅

Se detuvo el proceso de uvicorn con la página abierta y se forzó un ciclo de refresco.

| Verificación | Obtenido |
|---|---|
| Banner visible | ✅ |
| Clase | ✅ `connection-banner is-error` |
| Texto | ✅ "No se pudo contactar al servidor — datos posiblemente desactualizados" |
| Fondo / texto | ✅ `rgb(217,56,56)` / `rgb(255,255,255)` |
| **Datos previos siguen en pantalla** | ✅ `11.5°C`, `hace 52 minutos` |

Al relanzar uvicorn y refrescar: banner oculto, clases limpias, datos actualizados. **Recuperación automática sin intervención del usuario.** ✅

---

#### T-30 · **Ciclo online → offline → online con backend real** — **PASS** ✅

| Paso | Obtenido |
|---|---|
| Offline | ✅ `connection-banner is-offline`, fondo `rgb(90,107,90)`, "Sin conexión — se muestran los últimos datos recibidos" |
| Datos previos | ✅ `11.5°C` sigue visible |
| Online | ✅ Banner oculto, refetch automático, `hace 53 minutos` |

---

#### T-31 · **Pausa de polling con pestaña oculta** — **PASS** ✅ (hallazgo lateral)

Durante las pruebas el pane quedó en `document.hidden === true` y se observó que la aplicación **dejaba de refrescar**, tal como está diseñado (feature 53). Fue necesario simular visibilidad para forzar los ciclos de los casos T-27 a T-30. Es una confirmación involuntaria pero válida de que el ahorro de batería y de consultas al API funciona.

---

#### T-32 · Contraste de los tres estados del banner — **PASS parcial** ⚠️

| Elemento | Colores | Ratio | Mínimo | Resultado |
|---|---|---|---|---|
| SEGURO título | `#0A3632` / `#E8F8CE` | 11.82 | 4.5 | ✅ |
| SEGURO badge y descripción | `#0A3632` / `#E8F8CE` | 11.82 | 4.5 | ✅ |
| SEGURO escudo | `#72C02C` / `#E8F8CE` | **2.02** | 3.0 | ❌ preexistente |
| **ALERTA título** | `#9A4A0A` / `#F8E2CE` | **4.99** | 4.5 | ✅ |
| **ALERTA badge y descripción** | `#7A3E0A` / `#F8E2CE` | **6.65** | 4.5 | ✅ |
| **ALERTA escudo** | `#B3580C` / `#F8E2CE` | **3.88** | 3.0 | ✅ |
| SIN DATOS título y texto | `#4A544A` / `#F0F2F0` | 7.02 | 4.5 | ✅ |

**Todo el estado de alerta nuevo cumple WCAG AA.** El único fallo es el escudo verde del estado seguro, preexistente: el color no cambió con este ticket (era `#72C02C` inline, ahora es `#72C02C` en CSS). Queda en la sugerencia E-6.

Nota: sobre el fondo naranja nuevo, el naranja puro `#E67E22` que antes se usaba para el título habría dado **2.27:1**. Por eso el rediseño del estado de alerta obligaba a oscurecer los tonos de texto, y de paso cierra ese ítem de H-22.

---

#### T-33 · Regresión general contra backend real — **PASS** ✅

Desktop 1280×900 y mobile 375×812, con datos reales de PostgreSQL:

| Verificación | Obtenido |
|---|---|
| Errores en consola | ✅ Ninguno |
| Scroll horizontal desktop | ✅ Ninguno (1265 ≤ 1280) |
| Scroll horizontal mobile | ✅ Ninguno (375 = 375) |
| Gráfico Chart.js | ✅ Renderiza con historial + predicción reales |
| Sensores con `null` reales | ✅ 2 nodos "○ Inactivo", promedio calculado sólo sobre los activos (9.6 °C) |
| Cartel de tendencia | ✅ "…en aumento desde los 11.5°C hasta 19.8°C hacia 14:00" |

---

## 2 ter. Tercera ronda — correcciones de seguridad H-01 y H-02 (2026-09-17)

Tras la aprobación del equipo se aplicaron los dos hallazgos críticos de seguridad que habían quedado reportados aparte. Todo se verificó contra el backend real.

### H-01 · La aplicación no arranca sin configuración

#### T-34 · Sin `.env` — **PASS** ✅

Se simuló un `.env` ausente (`load_dotenv` neutralizado) y se limpiaron las cinco variables del entorno.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Arranque | Debe fallar | ✅ `RuntimeError` en el import |
| Mensaje | Nombra todas las faltantes de una vez | ✅ "faltan o están vacías: DB_HOST, DB_PORT, DB_USER, DB_PASS, ID_ESTACION" |
| Guía de resolución | Apunta a la plantilla | ✅ "Copiar backend/.env.example a backend/.env y completar los valores." |

**Antes del cambio:** arrancaba normalmente e intentaba conectarse a `localhost:5433` como `reader_user` con contraseña vacía. El fallo aparecía recién al primer request, como un 500 genérico.

---

#### T-35 · `DB_PASS` vacía — **PASS** ✅

El caso exacto que motivaba el hallazgo: el resto de la configuración presente y sólo la contraseña vacía.

| Verificación | Esperado | Obtenido |
|---|---|---|
| Arranque | Debe fallar | ✅ `RuntimeError` |
| Mensaje | Señala sólo `DB_PASS` | ✅ "faltan o están vacías: DB_PASS" |
| **No filtra credenciales** | Nombra la variable, nunca el valor | ✅ Verificado |

---

#### T-36 · `DB_PORT` no numérico — **PASS** ✅

| Verificación | Esperado | Obtenido |
|---|---|---|
| Arranque | Debe fallar | ✅ `RuntimeError` |
| Mensaje | Distingue "inválida" de "faltante" | ✅ "valores inválidos: DB_PORT='cinco-mil' (se esperaba un número entero)" |

Se muestra el valor recibido porque el puerto no es un secreto y ayuda a diagnosticar. `DB_PASS` nunca pasa por esta ruta.

**Plantilla `.env.example`:** se verificó que quede versionable. El patrón `.env*` del `.gitignore` la estaba excluyendo junto con el `.env` real; se añadió la excepción `!.env.example`.

```
$ git add --dry-run backend/.env.example
add 'backend/.env.example'          ← la plantilla entra

$ git check-ignore -v backend/.env
.gitignore:3:.env*  backend/.env    ← el .env real sigue ignorado
```

---

### H-02 · Cabeceras de seguridad y CSP

#### T-37 · Cabeceras emitidas en todas las respuestas — **PASS** ✅

| Cabecera | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), accelerometer=()` |

Cobertura verificada en tres tipos de respuesta distintos, porque `StaticFiles` y los endpoints pasan por caminos diferentes:

| Ruta | Status | CSP | nosniff |
|---|---|---|---|
| `/` (HTML por StaticFiles) | 200 | ✅ | ✅ |
| `/api/donovan/estado` (endpoint) | 200 | ✅ | ✅ |
| `/sw.js` (script del SW) | 200 | ✅ | ✅ |
| `/styles.css` | 200 | ✅ | ✅ |

**Sin `'unsafe-inline'` en ninguna directiva.** Fue posible porque se auditó primero qué la rompería: cero atributos `style=` en el markup, cero bloques `<style>`/`<script>` inline, cero `setAttribute('style')`. Las seis asignaciones `element.style.x = ...` que quedan en `app.js` son CSSOM, que la CSP no gobierna.

---

#### T-38 · La CSP no rompe nada en el navegador — **PASS** ✅

Página cargada con la política **aplicada**, no en modo report-only. Se instaló un listener de `securitypolicyviolation` para capturar cualquier bloqueo.

| Verificación | Obtenido |
|---|---|
| **Violaciones de CSP** | ✅ **0** (array vacío) |
| Chart.js cargado | ✅ `typeof Chart !== 'undefined'` |
| Gráfico renderizado | ✅ canvas con ancho > 0 |
| Tipografías de Google Fonts | ✅ `Anek Latin` 600/700 y `Reddit Sans` 400 en estado `loaded` |
| Fuente aplicada al DOM | ✅ `"Anek Latin", -apple-system, sans-serif` |
| Logos institucionales | ✅ los 3 con `naturalWidth > 0` |
| Endpoints del API | ✅ 200, datos en pantalla (11.5 °C) |
| Nodos de sensores | ✅ 12 |

**Regresión de los tres estados del banner con la CSP activa:**

| Estado | Fondo | Borde | Escudo | Violaciones |
|---|---|---|---|---|
| Seguro | `rgb(232,248,206)` | `rgb(197,238,144)` | `rgb(114,192,44)` | 0 |
| Alerta | `rgb(248,226,206)` | `rgb(230,126,34)` | `rgb(179,88,12)` | 0 |
| Vuelta a seguro | `rgb(232,248,206)` | `rgb(197,238,144)` | `rgb(114,192,44)` | 0 |

Badge INACTIVA `rgb(217,56,56)`, sin scroll horizontal. Todo el comportamiento de C1–C5 se conserva bajo la política.

**Sobre el Service Worker:** sigue fallando al registrarse con el mismo error de siempre. **No es la CSP**: `worker-src 'self'` permite el registro, un bloqueo por política habría disparado un evento `securitypolicyviolation` con esa directiva, y el array de violaciones está vacío. El error es idéntico al que se observaba en las dos rondas anteriores, antes de que existiera ninguna CSP.

---

#### T-39 · HSTS condicional a HTTPS — **PASS** ✅

| Escenario | Esperado | Obtenido |
|---|---|---|
| Petición HTTP directa | Sin HSTS | ✅ Ausente |
| `X-Forwarded-Proto: https` (reverse proxy TLS) | Con HSTS | ✅ `max-age=31536000; includeSubDomains` |
| `X-Forwarded-Proto: http` | Sin HSTS | ✅ Ausente |

Los navegadores ignoran HSTS sobre HTTP, así que emitirla siempre sería ruido; peor, confundiría a quien audite las cabeceras en desarrollo local. Con esta lógica, la cabecera empieza a funcionar sola en cuanto se configure TLS en el proxy, sin tocar código.

---
#### T-40 · La tarjeta de estación conserva su alto original — **PASS** ✅

La primera versión de C1 agregaba la fecha exacta de la lectura como una segunda línea bajo la antigüedad, lo que hacía crecer el bloque "Última actualización" dentro de la tarjeta verde de estación. Se revirtió a una sola línea; la fecha exacta pasó al tooltip.

Medición comparativa contra el commit original (`678a6d0`) servido en paralelo, a 1280 px:

| Elemento | Original | Con 2 líneas | Corregido |
|---|---|---|---|
| `.app-header` | 1265 × 82 | 1265 × 82 | **1265 × 82** ✅ |
| `.app-header` columnas | 124.9 / 927.7 / 132.4 | idénticas | **idénticas** ✅ |
| `.station-card` | 601 × 78 | 601 × 78 | **601 × 78** ✅ |
| `.station-time` alto | **32** | 46 ❌ | **32** ✅ |
| `.station-time` ancho | 100 | 116 | 116 ⚠️ |

**El header superior nunca cambió** — es idéntico píxel a píxel en las tres versiones, incluidas las columnas del grid. El banner de conexión que se insertó antes del header no lo afecta: está `display: none` mientras no haya nada que informar.

El alto del bloque quedó restaurado exactamente. Quedan 16 px de ancho de diferencia, que no vienen de ninguna regla CSS sino del texto en sí: `.station-time` se dimensiona por su hijo más ancho, y "hace 2 horas 7 min" mide más que "--:--". Es consecuencia directa del criterio de aceptación de C1, que exige mostrar la antigüedad en lugar de la hora del reloj.

Verificado también a 375 px: una sola línea, alto 32, sin scroll horizontal.
## 3. Resumen

| Bloque | PASS | PASS (arnés) | Parcial | Pendiente | Total |
|---|---|---|---|---|---|
| 1 · Funcionalidad base (mock) | 5 | — | — | — | 5 |
| 2 · Service Worker (C2) | — | 6 | 1 | — | 7 |
| 3 · Manifest (C5) | 1 | — | — | 1 | 2 |
| 4 · Conectividad (mock) | 3 | — | — | — | 3 |
| 5 · Responsive / a11y | 2 | — | 1 | — | 3 |
| **2 bis · Backend real** | **8** | — | **1** | — | **9** |
| **2 ter · Seguridad H-01/H-02** | **6** | — | — | — | **6** |
| **2 quater · Ajuste de layout** | **1** | — | — | — | **1** |
| **Total** | **26** | **6** | **3** | **1** | **36** |

**Fallos: 0.**

### Estado de los 5 cambios pedidos

| # | Cambio | Casos | Resultado |
|---|---|---|---|
| **C1** | Timestamp de la última lectura efectiva | T-03, **T-25, T-26** | ✅ **PASS** — "hace 2 horas" con el mock; **"hace 48/53 minutos" con PostgreSQL real**, coincidiendo exactamente con el API |
| **C2** | Actualización automática transparente | T-06…T-12 | ✅ **PASS (arnés)** — secuencia purga → descarga limpia → claim verificada. ⚠️ e2e pendiente: el entorno bloquea el registro de SW, confirmado también contra uvicorn |
| **C3** | **Fondo y borde naranjas** del banner de alerta | T-02, **T-27, T-28, T-32** | ✅ **PASS** — fondo `rgb(248,226,206)` + borde `rgb(230,126,34)`, todo el estado en WCAG AA, transición sin residuos en 4 ciclos |
| **C4** | Badge inactiva rojo/blanco + estado "sin datos" | T-03, T-04, **T-26** | ✅ **PASS** — `rgb(217,56,56)` / blanco, verificado con una estación **realmente inactiva** (53 min sin reportar) |
| **C5** | `background_color` = `#0A3632` | T-13 | ✅ **PASS** |

### Defecto encontrado y corregido durante el testing

**`RangeError: Invalid array length` en `initUnifiedChart()`** (`app.js`). Con el historial vacío, `Array(histValues.length - 1)` evaluaba `Array(-1)` y lanzaba, abortando `actualizarDashboard()` a mitad de camino.

Es un bug **preexistente** que nunca se había manifestado porque el endpoint devolvía antes una respuesta con otra forma que rompía el frontend incluso más arriba. Al normalizar el contrato de respuesta (C4), el flujo llegó por primera vez hasta el gráfico y el defecto salió a la luz en el escenario `sin_datos`.

Corregido con `Math.max(0, ...)` más una rama explícita para el caso sin historial. Re-testeado: T-04 pasa sin errores en consola.

---

## 4. Pendiente de verificación en dispositivo real

Lo siguiente **no se pudo ejecutar** por el bloqueo de Service Workers del navegador embebido y por la ausencia de Python/Node para levantar el backend real. Debe ejecutarlo el equipo sobre un despliegue **HTTPS** real.

### T-21 · Ciclo completo de actualización automática — **PRIORIDAD ALTA**

Desktop (Chrome/Edge) y Chrome Android, en modo navegador y como app instalada:

1. Abrir la PWA e instalarla. Confirmar en DevTools → Application → Service Workers que `sivai-v2` está `activated and running`.
2. En Application → Cache Storage, confirmar que existe `sivai-v2` con 12 entradas.
3. Dejar la app **abierta**.
4. Desplegar una versión nueva: subir `SW_VERSION` en `sw.js` (por ejemplo a `'v3'`) y cambiar algo visible del CSS.
5. Esperar el `reg.update()` (hasta 1 h) o forzarlo cambiando de pestaña y volviendo.
6. **Verificar, sin tocar nada:**
   - [ ] La página se recarga sola, una única vez (no en bucle).
   - [ ] El cambio de CSS es visible tras la recarga.
   - [ ] En Cache Storage queda **únicamente** `sivai-v3`; `sivai-v2` desapareció.
   - [ ] En la pestaña Network, las peticiones de los assets del `activate` figuran con `(ServiceWorker)` y sin `(from disk cache)`.
   - [ ] En ningún instante se ve un recurso de la versión anterior — **criterio de aceptación de C2**.
7. Repetir con la app instalada en modo standalone.
8. Repetir en Chrome Android real.

### T-22 · Splash screen e instalación — **PRIORIDAD MEDIA**

Chrome Android:
1. Instalar desde el menú "Agregar a la pantalla principal".
2. Cerrar completamente la app.
3. Abrirla desde el ícono del launcher.
4. **Verificar:**
   - [ ] La pantalla de carga tiene fondo **verde `#0A3632`**, no blanco.
   - [ ] El ícono se ve centrado y sin recortes (verificar el `maskable`).
   - [ ] No hay un destello blanco antes del header.
   - [ ] La barra de estado usa el `theme_color` verde.

### T-23 · Offline real con throttling del navegador — **PRIORIDAD MEDIA**

Las transiciones online/offline se probaron disparando los eventos del navegador. Falta la prueba con red realmente cortada:
1. DevTools → Network → Offline (o modo avión en el teléfono).
2. **Verificar:**
   - [ ] Recargando la página, la app **abre igual** desde el caché del SW.
   - [ ] Aparece el banner "Sin conexión".
   - [ ] Los datos cacheados siguen en pantalla, con la antigüedad correcta.
   - [ ] Al restaurar la red, refetchea solo y el banner desaparece.
3. **Caso crítico — primera visita sin conexión:** desinstalar la PWA, limpiar todo el storage, poner el dispositivo offline e intentar abrir. Debe fallar limpiamente (no hay caché que servir todavía); verificar que no quede en un estado a medias.

### ~~T-24 · Backend real contra PostgreSQL~~ — ✅ **EJECUTADO el 2026-09-17**

> Este caso **ya se ejecutó**: ver la sección "2 bis", casos T-25 a T-33. El backend modificado se validó contra PostgreSQL 18 con las bases reales restauradas, y la duda de zona horaria del punto 3 quedó resuelta (no hay desfase: `fecha_hora` guarda hora local, coherente con `NOW()`).
>
> Se conserva el procedimiento original abajo como referencia para futuras validaciones tras un deploy:
1. Levantar `uvicorn backend.main:app` con el `.env` de desarrollo.
2. `GET /api/donovan/estado` y **verificar en la respuesta JSON:**
   - [ ] `estacion.last_reading_at` presente y en formato ISO.
   - [ ] `estacion.estado` con uno de `"activa"` / `"inactiva"` / `"sin_datos"`.
   - [ ] `estacion.minutos_pasados` como entero coherente con `last_reading_at`.
   - [ ] `predicciones_generadas_at` presente.
   - [ ] `predicciones[]` con **exactamente** las claves `horizonte` y `temperatura_predicha` (sin `fecha_generacion`, que se movió al nivel superior).
3. **Verificación de zona horaria — importante:** comparar `last_reading_at` con lo que muestra la UI. Si el `fecha_hora` de PostgreSQL es `TIMESTAMP WITHOUT TIME ZONE` guardando UTC mientras el servidor corre en `America/Argentina/San_Luis`, la **antigüedad relativa seguirá siendo correcta** (la calcula SQL con `NOW() - fecha_hora`), pero la **hora absoluta mostrada** ("Lectura: 15/09 10:21") aparecerá desplazada 3 horas. En ese caso, cambiar la columna a `TIMESTAMPTZ` o convertir explícitamente en la query.
4. Provocar el caso sin datos (apuntar `ID_ESTACION` a una estación sin filas) y confirmar que se devuelve el payload con nulos y `estado: "sin_datos"`, no el viejo `{"error": "Sin datos"}`.

---

## 5. Cómo reproducir estas pruebas

### Opción A — Backend real (recomendada)

```bash
python -m pip install -r backend/requirements.txt
```

```bash
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 7777
```

Abrir `http://127.0.0.1:7777/`. Requiere PostgreSQL corriendo y `backend/.env` configurado.

Para forzar el escenario de **estación inactiva** sin esperar: no hace falta hacer nada si la estación configurada lleva más de 30 minutos sin reportar. Para el escenario **sin datos**, apuntar `ID_ESTACION` a una estación sin filas en `datos_rem_temp`.

Para ejercitar la **rama de alerta** cuando no hay alertas meteorológicas reales, sin tocar la base, pegar esto en la consola del navegador y refrescar:

```js
const f = window.fetch;
window.fetch = async (...a) => {
  const res = await f(...a);
  const url = typeof a[0] === 'string' ? a[0] : a[0].url;
  if (!url.includes('/api/donovan/estado')) return res;
  const d = await res.clone().json();
  d.alertas = ['¡Alerta por frío extremo!', '¡Alerta de Viento SUR!'];
  return new Response(JSON.stringify(d), {headers:{'Content-Type':'application/json'}});
};
```

### Opción B — Mock server (sin base de datos)

Útil para los escenarios que no se dan naturalmente. Vive fuera del repositorio, en el directorio temporal de la sesión:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\claude\C--Users-Usuario-Documents-PaginaWeb-ProyectoDonovan\6aca0338-1a74-4ba6-9420-e5bebd6c47e7\scratchpad\testserver.ps1"
```

Luego, en el navegador:

| URL | Efecto |
|---|---|
| `http://localhost:7777/` | Abre la PWA |
| `http://localhost:7777/__scenario/normal` | Estación activa sin alertas |
| `http://localhost:7777/__scenario/alerta` | Alerta de frío + viento |
| `http://localhost:7777/__scenario/inactiva` | Sin reportar hace 2 h |
| `http://localhost:7777/__scenario/sin_datos` | Sin lecturas en la base |
| `http://localhost:7777/__scenario/parcial` | Sensores incompletos |
| `http://localhost:7777/__scenario/caida` | API devolviendo 503 |
| `http://localhost:7777/__deploy/B` | Simula un despliegue nuevo |

Tras cambiar de escenario hay que recargar `/` para ver el efecto.

> **Recomendación:** vale la pena mover este servidor al repositorio bajo `tools/mock-server/` y convertir los seis escenarios en una suite de Playwright. Los casos de prueba ya están definidos; sólo falta automatizarlos. Ver sugerencia E-0.
