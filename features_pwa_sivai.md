# Features PWA SIVAI — checklist de cumplimiento

**Fechas:** 2026-09-15 (relevamiento) · 2026-09-17 (re-verificación contra backend real)
**Base:** commit `678a6d0` + cambios C1–C5 de este ticket.
**Nota:** salvo las 5 features marcadas 🔒, todo lo verificado se re-ejecutó contra el backend FastAPI real conectado a PostgreSQL 18 con las bases restauradas.

**Leyenda de estados**
- ✅ Implementado y funcionando
- ⚠️ Implementado parcialmente, o funcionando con salvedades
- ❌ No implementado
- 🔒 No verificable en este entorno (ver nota al pie)

---

## A. Nivel 1 — Service Worker

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 1 | Registro del Service Worker | SW / Frontend | ✅ | ✅ | 🔒 | T-06 |
| 2 | Caché de assets estáticos (precache de 12 recursos) | Service Worker | ⚠️ 10 assets, faltaban los íconos PWA 192/512 | ✅ 12 assets | ✅ | T-07 |
| 3 | Estrategia cache-first para assets | Service Worker | ⚠️ cache-first para **todo**, sin revalidar | ✅ cache-first **+ revalidación en segundo plano** | ✅ | T-10 |
| 4 | Estrategia network-first para HTML | Service Worker | ❌ El HTML se servía desde caché sin revalidar | ✅ | ✅ | T-10 |
| 5 | Exclusión de `/api/` del caché | Service Worker | ⚠️ Match frágil por `url.includes('/api/')` | ✅ Match por `pathname.startsWith` | ✅ | T-10 |
| 6 | Exclusión de peticiones no-GET | Service Worker | ❌ Se interceptaban todos los métodos | ✅ | ✅ | T-10 |
| 7 | Exclusión de orígenes de terceros (Google Fonts) | Service Worker | ❌ | ✅ | ✅ | T-10 |
| 8 | Versionado del Service Worker | Service Worker | ⚠️ `sivai-v1`, sin `skipWaiting` | ✅ `sivai-v2` + `SW_VERSION` | ✅ | T-06 |
| 9 | **Purga de cachés obsoletos en `activate`** | Service Worker | ⚠️ Purgaba sólo los de nombre distinto, y nunca llegaba a activarse | ✅ Purga **total** | ✅ | T-07 |
| 10 | **Re-descarga limpia de assets tras actualizar** | Service Worker | ❌ | ✅ `cache: 'reload'` en los 12 assets | ✅ | T-08 |
| 11 | **`clients.claim()` tras la purga y descarga** | Service Worker | ❌ Ausente | ✅ Orden verificado | ✅ | T-09 |
| 12 | **Actualización automática sin intervención del usuario** | SW / Frontend | ❌ | ✅ `skipWaiting` + `controllerchange` + recarga única | ⚠️ 🔒 | T-11 |
| 13 | Búsqueda periódica de nueva versión (`reg.update()`) | Frontend | ❌ | ✅ Cada 1 h y al volver a primer plano | 🔒 | T-11 |
| 14 | Fallback offline a `index.html` cacheado | Service Worker | ⚠️ Implícito por cache-first | ✅ Explícito | ✅ | T-12 |
| 15 | Canal de mensajes SW ↔ página (`SW_UPDATED`, `SKIP_WAITING`) | Service Worker | ❌ | ✅ | ✅ | T-09 |
| 16 | **Notificaciones push** | Service Worker | ❌ **No implementado** | ❌ **No implementado** | — | — |
| 17 | Background Sync | Service Worker | ❌ No implementado | ❌ No implementado | — | — |

> **Feature 16 (push):** no existe `self.addEventListener('push')`, ni `pushsubscriptionchange`, ni `Notification.requestPermission()`, ni backend de VAPID. La PWA **no solicita ningún permiso**. Figura en la tabla del pedido, pero nunca estuvo implementada. Ver sugerencia E-8.

---

## B. Nivel 1 — Web App Manifest / Instalación

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 18 | `manifest.json` enlazado desde el HTML | Manifest | ✅ | ✅ | ✅ | T-13 |
| 19 | `name` y `short_name` | Manifest | ✅ | ✅ | ✅ | T-13 |
| 20 | `display: standalone` | Manifest | ✅ | ✅ | ✅ | T-13 |
| 21 | `start_url` | Manifest | ✅ `./` | ✅ | ✅ | T-13 |
| 22 | `orientation: portrait` | Manifest | ✅ | ✅ | ✅ | T-13 |
| 23 | Íconos PWA 192 y 512 px | Manifest | ✅ | ✅ | ✅ | T-13 |
| 24 | Íconos `maskable` (Android adaptive) | Manifest | ✅ 2 | ✅ 2 | ✅ | T-13 |
| 25 | Favicon SVG | Manifest / HTML | ✅ | ✅ | ✅ | T-13 |
| 26 | `apple-touch-icon` | HTML | ⚠️ Apunta a un SVG; iOS requiere PNG | ⚠️ Sin cambios | ⚠️ | — |
| 27 | `theme_color` = `#0A3632` | Manifest / HTML | ✅ | ✅ | ✅ | T-13 |
| 28 | **`background_color` (splash) = `#0A3632`** | Manifest | ❌ Era `#ffffff` | ✅ `#0A3632` | ✅ | T-13 |
| 29 | Splash screen coherente con la marca | Manifest | ❌ Fondo blanco, sin relación con la identidad | ✅ Verde SIVAI | ⚠️ 🔒 | T-14 |
| 30 | Instalabilidad (criterios de Chrome) | Manifest + SW | ⚠️ Cumplía, pero con splash blanco | ✅ | 🔒 | T-14 |

> **Feature 26:** iOS ignora los SVG en `apple-touch-icon`. Debería apuntar a `icons/SIVAI_Icono-PWA192x192.png`. Preexistente, fuera de alcance. Ver sugerencia E-9.

---

## C. Nivel 2/3 — Datos agrometeorológicos

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 31 | Endpoint `GET /api/donovan/estado` | API REST | ✅ | ✅ | ✅ | T-01 |
| 32 | Endpoint `GET /api/invernadero/sectores` | API REST | ✅ | ✅ | ✅ | T-01 |
| 33 | Temperatura exterior actual | Frontend / API | ✅ | ✅ | ✅ | T-01 |
| 34 | Humedad exterior actual | Frontend / API | ✅ | ✅ | ✅ | T-01 |
| 35 | Velocidad de viento en km/h (conversión ×3.6) | Frontend / API | ✅ | ✅ | ✅ | T-01 |
| 36 | Dirección de viento en puntos cardinales | Frontend / API | ✅ | ✅ | ✅ | T-01 |
| 37 | Precipitación (expuesta por el API) | API REST | ⚠️ Se devuelve pero **no se muestra en la UI** | ⚠️ Sin cambios | ⚠️ | — |
| 38 | Predicción de temperatura a 6 horas (modelo 1) | API REST | ✅ | ✅ | ✅ | T-01 |
| 39 | Rango mín–máx de la predicción | Frontend | ✅ | ✅ | ✅ | T-01 |
| 40 | Grilla de pronóstico horario (6 tarjetas) | Frontend | ✅ | ✅ | ✅ | T-01 |
| 41 | **Horas del pronóstico ancladas al servidor** | Frontend / API | ❌ Usaba `new Date()` del cliente | ✅ Usa `predicciones_generadas_at` | ✅ | T-03 |
| 42 | Gráfico unificado histórico + predicción (Chart.js) | Frontend | ✅ | ✅ | ✅ | T-01 |
| 43 | Historial de las últimas 6 lecturas | API REST | ✅ | ✅ | ✅ | T-01 |
| 44 | **Etiquetas del eje X del gráfico con hora del servidor** | Frontend | ❌ `new Date(fecha_hora)` convertía a la zona del cliente | ✅ Parseo sin conversión de zona | ✅ | T-01 |
| 45 | Cartel de tendencia en lenguaje llano ("Pronóstico: …") | Frontend | ✅ | ✅ | ✅ | T-01 |
| 46 | 6 sensores internos de temperatura por sector | API REST | ✅ | ✅ | ✅ | T-01 |
| 47 | 6 sensores internos de humedad por sector | API REST | ✅ | ✅ | ✅ | T-01 |
| 48 | Promedio de temperatura interna | Frontend | ✅ | ✅ | ✅ | T-05 |
| 49 | Promedio de humedad interna | API REST | ✅ | ✅ | ✅ | T-05 |
| 50 | Detección de sensor caído (umbral 120 min) | API REST | ✅ | ✅ | ✅ | T-05 |
| 51 | Indicador Activo/Inactivo por nodo sensor | Frontend | ✅ | ✅ | ✅ | T-05 |
| 52 | Refresco automático cada 5 minutos | Frontend | ✅ | ✅ | ✅ | T-01 |
| 53 | Pausa del polling con la pestaña oculta | Frontend | ✅ | ✅ | ✅ | — |
| 54 | Refresco inmediato al volver a primer plano | Frontend | ✅ | ✅ | ✅ | — |

---

## D. Nivel 1 — Alertas y estados

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 55 | Panel de alertas | Frontend | ✅ | ✅ | ✅ | T-02 |
| 56 | Alerta por frío extremo (`< 4.5 °C`) | API REST | ✅ | ✅ | ✅ | T-02 |
| 57 | Alerta por calor extremo (`> 35 °C`) | API REST | ✅ | ✅ | — | — |
| 58 | Alerta de viento Norte/Sur por estación de origen | API REST | ✅ | ✅ | ✅ | T-02 |
| 59 | Ícono de escudo con check / cruz según estado | Frontend | ✅ | ✅ | ✅ | T-02 |
| 60 | **Borde del banner naranja con alerta activa** | Frontend / CSS | ❌ **Bug: quedaba verde** | ✅ `#E67E22` | ✅ | T-02, T-27 |
| 61 | **Fondo del banner naranja con alerta activa** | Frontend / CSS | ❌ **Bug: quedaba verde menta** | ✅ `#F8E2CE` | ✅ | T-02, T-27 |
| 61b | Paleta de alerta completa en WCAG AA (título, texto, escudo) | Frontend / CSS | ❌ Título en naranja puro, 2.56:1 | ✅ 4.99 / 6.65 / 3.88 | ✅ | T-32 |
| 61c | Colores del banner sólo en CSS, sin estilos inline | Frontend | ❌ 4 `style.color` desde JS | ✅ Ninguno | ✅ | T-28 |
| 62 | Estado tercero "sin datos" en el banner | Frontend | ❌ Se trataba como "seguro" | ✅ Estado gris propio | ✅ | T-04 |
| 63 | Badge de estación ACTIVA | Frontend | ✅ | ✅ | ✅ | T-01 |
| 64 | **Badge de estación INACTIVA: fondo rojo, texto blanco** | Frontend / CSS | ❌ Texto rojo sobre fondo **verde** (1.94:1) | ✅ `#D93838` / blanco (4.59:1) | ✅ | T-03 |
| 65 | **Badge "SIN DATOS" diferenciado de "INACTIVA"** | Frontend / CSS | ❌ Ambos mostraban "INACTIVA" | ✅ Estado propio | ✅ | T-04 |
| 66 | Umbral de estación activa (30 min) | API REST | ✅ | ✅ | ✅ | T-03 |

---

## E. Nivel 1 — Frescura del dato y conectividad

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 67 | **Timestamp de la última lectura efectiva de la base** | API REST | ❌ No se exponía | ✅ Campo `last_reading_at` | ✅ | T-03 |
| 68 | **Antigüedad relativa ("hace 2 horas")** | Frontend | ❌ Mostraba la hora del dispositivo | ✅ Derivada de `minutos_pasados` (SQL) | ✅ | T-03 |
| 69 | Fecha/hora exacta de la lectura visible | Frontend | ❌ | ✅ "Lectura: 15/09 10:21" | ✅ | T-03 |
| 70 | Resalte visual de lectura vieja (> 30 min) | Frontend / CSS | ❌ | ✅ Clase `.reading-stale` | ✅ | T-03 |
| 71 | Inmunidad a la zona horaria del cliente | API REST / Frontend | ❌ | ✅ `minutos_pasados` calculado en SQL | ✅ | T-03 |
| 72 | **Modo offline + indicador de estado** | SW / Frontend | ❌ **Indicador inexistente** | ✅ Banner con 4 estados | ✅ | T-15 |
| 73 | Detección de transición online → offline | Frontend | ❌ | ✅ Listener `offline` | ✅ | T-15 |
| 74 | Detección de transición offline → online + refetch | Frontend | ❌ | ✅ Listener `online` | ✅ | T-16 |
| 75 | Chequeo de `navigator.onLine` antes de cada fetch | Frontend | ❌ | ✅ | ✅ | T-15 |
| 76 | Indicador de error de API (5xx) | Frontend | ❌ Silencio total | ✅ Banner rojo | ✅ | T-17 |
| 77 | Indicador de carga inicial | Frontend | ⚠️ Sólo el texto "Cargando…" | ✅ Banner `is-loading` | ✅ | T-17 |
| 78 | Timeout en las llamadas al API (12 s) | Frontend | ❌ Fetch sin límite | ✅ `AbortController` | ✅ | — |
| 79 | Peticiones al API en paralelo | Frontend | ⚠️ Secuenciales | ✅ `Promise.all` | ✅ | T-01 |
| 80 | Reintento automático de la petición fallida | Frontend | ❌ | ❌ **No implementado** (espera al próximo ciclo de 5 min) | — | Ver E-3 |
| 81 | Accesibilidad del indicador (`role`/`aria-live`) | Frontend | — | ✅ `role="status"`, `aria-live="polite"` | ✅ | T-15 |

---

## F. Presentación y accesibilidad

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 82 | Responsive desktop (≥ 900 px, grilla 2 columnas) | Frontend | ✅ | ✅ | ✅ | T-18 |
| 83 | Responsive mobile (por defecto, columna única) | Frontend | ✅ | ✅ | ✅ | T-19 |
| 84 | Header adaptativo (≤ 600 px, logos apilados) | Frontend | ✅ | ✅ | ✅ | T-19 |
| 85 | Sin scroll horizontal a 375 px | Frontend | ✅ | ✅ | ✅ | T-19 |
| 86 | Tipografías de marca (Anek Latin / Reddit Sans) | Frontend | ✅ | ✅ | ✅ | — |
| 87 | Logos institucionales UNSL + INTA | Frontend | ✅ | ✅ | ✅ | — |
| 88 | Contraste AA en los estados nuevos | Frontend / CSS | — | ✅ 4.59 / 5.70 / 4.99 / 6.65 / 3.88 / 7.02 | ✅ | T-20, T-32 |
| 89 | Contraste AA en los elementos preexistentes | Frontend / CSS | ❌ 4 elementos por debajo de 4.5:1 | ❌ **Sin cambios** | ❌ | T-20 / E-6 |
| 90 | Soporte `prefers-reduced-motion` | Frontend / CSS | ❌ | ⚠️ Sólo en el banner nuevo | ⚠️ | — |
| 91 | Tamaños táctiles ≥ 44 px | Frontend | N/A — no hay controles interactivos | N/A | — | — |

---

## G. Infraestructura

| # | Feature | Nivel/módulo | Estado antes | Estado post-cambio | Verificado | Caso de test |
|---|---|---|---|---|---|---|
| 92 | **HTTPS/TLS** | Infraestructura | ❌ **No forzado** (sin redirect, sin HSTS) | ❌ **Sin cambios** | ❌ | H-03 |
| 92b | Backend FastAPI operativo contra PostgreSQL | Infraestructura | ⚠️ No verificable (sin Python en la máquina) | ✅ Verificado con datos reales | ✅ | T-25 |
| 93 | **Content-Security-Policy** | Infraestructura | ❌ Ausente | ✅ Estricta, sin `'unsafe-inline'` | ✅ | T-37, T-38 |
| 93b | `worker-src` restringiendo el registro del SW | Infraestructura | ❌ Ausente | ✅ `worker-src 'self'` | ✅ | T-37 |
| 93c | Modo report-only para despliegue gradual | Infraestructura | — | ✅ `CSP_REPORT_ONLY` | ✅ | T-37 |
| 94 | **Cabeceras de seguridad** (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, COOP) | Infraestructura | ❌ Ausentes | ✅ En todas las respuestas | ✅ | T-37 |
| 94b | `Permissions-Policy` denegando permisos no usados | Infraestructura | ❌ Ausente | ✅ 7 permisos denegados | ✅ | T-37 |
| 94c | `Strict-Transport-Security` condicional a HTTPS | Infraestructura | ❌ Ausente | ✅ Sólo sobre HTTPS / `X-Forwarded-Proto` | ✅ | T-39 |
| 95 | CORS restringido por origen y a GET | Infraestructura | ✅ | ✅ | ✅ | — |
| 96 | Credenciales fuera del repositorio (`.gitignore`) | Infraestructura | ✅ | ✅ | ✅ | — |
| 97 | **Validación de configuración obligatoria al arrancar** | Infraestructura | ❌ Defaults permisivos (`DB_PASS=""`) | ✅ No arranca sin las 5 variables | ✅ | T-34, T-35, T-36 |
| 97b | Plantilla `.env.example` versionada | Infraestructura | ❌ No existía | ✅ Con excepción en `.gitignore` | ✅ | T-36 |
| 97c | Los errores de configuración no exponen credenciales | Infraestructura | — | ✅ Nombran la variable, no el valor | ✅ | T-35 |
| 98 | Servido de estáticos desde FastAPI | Infraestructura | ✅ | ✅ | ✅ | — |
| 99 | Tests automatizados | QA | ❌ Ninguno | ❌ **Ninguno** | ❌ | H-17 / E-0 |
| 100 | Pipeline de CI | QA | ❌ | ❌ | ❌ | E-0 |

---

## Resumen de cierre

| Categoría | ✅ | ⚠️ | ❌ | 🔒 | Total |
|---|---|---|---|---|---|
| A. Service Worker | 13 | 1 | 2 | 3 | 17 |
| B. Manifest / Instalación | 10 | 1 | 0 | 2 | 13 |
| C. Datos agrometeorológicos | 23 | 1 | 0 | 0 | 24 |
| D. Alertas y estados | 14 | 0 | 0 | 0 | 14 |
| E. Frescura y conectividad | 13 | 0 | 1 | 0 | 15 |
| F. Presentación / a11y | 7 | 1 | 1 | 0 | 10 |
| G. Infraestructura | 13 | 0 | 2 | 0 | 15 |
| **Total** | **93** | **4** | **6** | **5** | **108** |

**Los 5 cambios pedidos en el punto C: 5/5 ✅** (features 67-71, 12, 60-61c, 64-65, 28).

---

### 🔒 Nota sobre las features no verificables en este entorno

Cinco features del ciclo de vida del Service Worker **no pudieron verificarse de extremo a extremo**: el navegador embebido del entorno de trabajo bloquea el registro de Service Workers. Se comprobó que la petición del script **ni siquiera llega al servidor** (el log de accesos sólo registra `GET /`), y que un Service Worker mínimo y sintácticamente trivial falla exactamente igual — o sea, es una restricción del entorno, no un problema del código.

En la segunda ronda (2026-09-17) el diagnóstico se repitió contra **uvicorn real**: su log de acceso registra todas las peticiones del navegador y ninguna a `/sw.js`. Queda descartado el servidor de pruebas como causa.

(El backend FastAPI real sí se pudo levantar y probar en esa segunda ronda; lo único que sigue bloqueado es el registro del Service Worker.)

**Cómo se compensó:** la lógica de `sw.js` se ejecutó bajo un arnés de test con `caches`, `fetch`, `clients` y `self` simulados, verificando la secuencia real de operaciones (casos T-06 a T-12, todos ✅). Esto valida la lógica, no la integración con el navegador.

**Queda pendiente de ejecución por el equipo**, en Chrome desktop y Chrome Android reales, sobre un despliegue HTTPS:
- Feature 1, 12, 13 — registro y actualización automática de extremo a extremo (casos T-11 y T-21).
- Feature 29, 30 — splash screen e instalación en Android.

El procedimiento exacto está en `resultados_testing_pwa_sivai.md`, sección "Pendiente de verificación en dispositivo real".
