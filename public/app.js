/**
 * app.js
 * Lógica principal del Dashboard Climático conectada a FastAPI.
 */

const API_BASE_URL = window.location.origin;
let chartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Elementos del DOM a actualizar
    const domElements = {
        ultimaActualizacion: document.getElementById('last-update'),
        estadoAlerta: document.getElementById('status-main-title'),
        temperaturaExterna: document.getElementById('temp-display'),
        humedadExterna: document.getElementById('humidity-display'),
        vientoVelocidad: document.getElementById('wind-speed'),
        vientoDireccion: document.getElementById('wind-direction'),
        prediccionRango: document.getElementById('prediction-range'),
        humedadPromedio: document.getElementById('sensor-avg-humidity'),
        temperaturaPromedio: document.getElementById('sensor-avg-temp'),
        nodosHumedadContenedor: document.getElementById('humidity-nodes-grid'),
        nodosTemperaturaContenedor: document.getElementById('temp-nodes-grid'),
        forecastGrid: document.getElementById('hourly-forecast-grid'),
        stationBadge: document.querySelector('.station-badge-wrapper'),
        statusBanner: document.querySelector('.status-banner'),
        statusDescription: document.querySelector('.status-description'),
        statusShield: document.querySelector('.status-shield-icon'),
        statusBadgeTitle: document.querySelector('.status-badge-title'),
        connectionBanner: document.getElementById('connection-banner'),
        connectionBannerText: document.getElementById('connection-banner-text')
    };

    /* ----------------------------------------------------------------------
     * UTILIDADES DE TIEMPO
     * Todo lo relativo a "cuándo se midió" sale del API (timestamp real de la
     * base). El reloj del dispositivo NO se usa para fechar lecturas.
     * -------------------------------------------------------------------- */

    const pad2 = n => String(n).padStart(2, '0');

    // Convierte los minutos transcurridos (calculados por el servidor) en texto.
    function formatearAntiguedad(minutos) {
        if (minutos === null || minutos === undefined || isNaN(minutos)) return 'sin datos';
        const m = Math.max(0, Math.round(Number(minutos)));
        if (m < 1) return 'hace instantes';
        if (m === 1) return 'hace 1 minuto';
        if (m < 60) return `hace ${m} minutos`;

        const horas = Math.floor(m / 60);
        const resto = m % 60;
        if (horas < 24) {
            const txtHoras = horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`;
            return resto === 0 ? txtHoras : `${txtHoras} ${resto} min`;
        }
        const dias = Math.floor(horas / 24);
        return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
    }

    // Parsea el timestamp del API SIN reinterpretarlo en la zona horaria del
    // cliente: se leen los componentes tal como los almacenó la base.
    function partesTimestamp(iso) {
        if (!iso) return null;
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (!m) return null;
        return { anio: +m[1], mes: +m[2], dia: +m[3], hora: +m[4], minuto: +m[5] };
    }

    function formatearFechaLectura(iso) {
        const t = partesTimestamp(iso);
        if (!t) return '';
        return `${pad2(t.dia)}/${pad2(t.mes)} ${pad2(t.hora)}:${pad2(t.minuto)}`;
    }

    /* ----------------------------------------------------------------------
     * ESTADO VISUAL DEL BANNER DE ALERTA (C3)
     * El borde deja de estar fijo en verde: lo define la clase de estado.
     * -------------------------------------------------------------------- */
    const CLASES_BANNER_ESTADO = ['status-safe', 'status-alert', 'status-nodata'];

    function setClaseBannerEstado(clase) {
        const banner = domElements.statusBanner;
        if (!banner) return;
        banner.classList.remove(...CLASES_BANNER_ESTADO);
        banner.classList.add(clase);
    }

    /* ----------------------------------------------------------------------
     * INDICADOR DE CONEXIÓN / ESTADO DE DATOS
     * -------------------------------------------------------------------- */
    const ESTADOS_CONEXION = {
        ok:      { texto: '', clase: '' },
        loading: { texto: 'Actualizando datos…', clase: 'is-loading' },
        offline: { texto: 'Sin conexión — se muestran los últimos datos recibidos', clase: 'is-offline' },
        error:   { texto: 'No se pudo contactar al servidor — datos posiblemente desactualizados', clase: 'is-error' }
    };

    function setEstadoConexion(estado) {
        const banner = domElements.connectionBanner;
        if (!banner) return;

        const cfg = ESTADOS_CONEXION[estado] || ESTADOS_CONEXION.ok;
        banner.classList.remove('is-loading', 'is-offline', 'is-error');

        if (estado === 'ok') {
            banner.hidden = true;
            domElements.connectionBannerText.textContent = '';
            return;
        }
        if (cfg.clase) banner.classList.add(cfg.clase);
        domElements.connectionBannerText.textContent = cfg.texto;
        banner.hidden = false;
    }

    /* ----------------------------------------------------------------------
     * CARGA DE DATOS
     * -------------------------------------------------------------------- */
    const FETCH_TIMEOUT_MS = 12000;
    let hayDatosEnPantalla = false;

    async function fetchConTimeout(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            return await fetch(url, { signal: controller.signal, cache: 'no-store' });
        } finally {
            clearTimeout(timer);
        }
    }

    // Función principal para cargar datos del backend
    async function fetchDashboardData() {
        if (!navigator.onLine) {
            setEstadoConexion('offline');
            return;
        }
        if (!hayDatosEnPantalla) setEstadoConexion('loading');

        try {
            const [resDonovan, resInv] = await Promise.all([
                fetchConTimeout(`${API_BASE_URL}/api/donovan/estado`),
                fetchConTimeout(`${API_BASE_URL}/api/invernadero/sectores`)
            ]);

            if (resDonovan.ok && resInv.ok) {
                const dataDonovan = await resDonovan.json();
                const dataInv = await resInv.json();

                actualizarDashboard(dataDonovan, dataInv);
                hayDatosEnPantalla = true;
                setEstadoConexion('ok');
            } else {
                console.error('API respondió con error:', resDonovan.status, resInv.status);
                setEstadoConexion('error');
            }
        } catch (error) {
            console.error("Error conectando con la API:", error);
            setEstadoConexion(navigator.onLine ? 'error' : 'offline');
        }
    }

    function actualizarDashboard(donovan, invernadero) {
        // --- 1. SECCIÓN DONOVAN (Estado General) ---

        const estacion = donovan.estacion || {};
        // Estado de 3 valores. Se deriva del campo explícito del API; el fallback
        // mantiene compatibilidad si el backend todavía no lo envía.
        let estadoEstacion = estacion.estado;
        if (!estadoEstacion) {
            if (estacion.minutos_pasados === null || estacion.minutos_pasados === undefined) {
                estadoEstacion = 'sin_datos';
            } else {
                estadoEstacion = estacion.activa ? 'activa' : 'inactiva';
            }
        }

        const ICONO_SENAL = `
                <svg class="station-signal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <circle cx="12" cy="20" r="1" fill="currentColor"></circle>
                </svg>`;

        // C4: INACTIVA -> fondo rojo + texto blanco. SIN DATOS es un estado propio,
        // no se confunde con "inactiva".
        if (estadoEstacion === 'activa') {
            domElements.stationBadge.innerHTML = `${ICONO_SENAL}
                <span class="badge-active">ACTIVA</span>
            `;
            domElements.stationBadge.style.color = "#72C02C";
        } else if (estadoEstacion === 'inactiva') {
            domElements.stationBadge.innerHTML = `${ICONO_SENAL}
                <span class="badge-active badge-inactive">INACTIVA</span>
            `;
            domElements.stationBadge.style.color = "#D93838";
        } else {
            domElements.stationBadge.innerHTML = `${ICONO_SENAL}
                <span class="badge-active badge-nodata">SIN DATOS</span>
            `;
            domElements.stationBadge.style.color = "#B9C2B9";
        }

        // C1: antigüedad de la ÚLTIMA LECTURA REAL de la base.
        // Los minutos los calcula el servidor (SQL NOW() - fecha_hora), por lo que
        // el resultado no depende del reloj ni de la zona horaria del dispositivo.
        const minutosLectura = estacion.minutos_pasados;
        domElements.ultimaActualizacion.textContent = formatearAntiguedad(minutosLectura);
        domElements.ultimaActualizacion.classList.remove('reading-stale', 'reading-none');

        if (minutosLectura === null || minutosLectura === undefined) {
            domElements.ultimaActualizacion.classList.add('reading-none');
        } else if (minutosLectura > 30) {
            domElements.ultimaActualizacion.classList.add('reading-stale');
        }

        // La fecha y hora exactas de la lectura van en el tooltip, para que el
        // bloque conserve una sola línea y el alto original de la tarjeta.
        domElements.ultimaActualizacion.title = estacion.last_reading_at
            ? `Última lectura registrada: ${formatearFechaLectura(estacion.last_reading_at)}`
            : 'La estación no registra lecturas';

        // Alertas
        if(donovan.alertas && donovan.alertas.length > 0) {
            // Diseño cuando HAY alertas (Naranja/Rojo + Escudo con Cruz)
            // C3: el borde del banner lo define la clase de estado, no el CSS fijo.
            setClaseBannerEstado('status-alert');
            if (domElements.statusBadgeTitle) domElements.statusBadgeTitle.textContent = "¡ALERTA ACTIVA!";
            domElements.estadoAlerta.textContent = "Atención Requerida";
            domElements.statusDescription.textContent = donovan.alertas.join(" | ");

            // Dibuja escudo con cruz (X)
            domElements.statusShield.innerHTML = `
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M15 9l-6 6m0-6 6 6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            `;

        } else if (estadoEstacion === 'sin_datos') {
            // Sin lecturas: NO se puede afirmar que el invernadero esté seguro.
            setClaseBannerEstado('status-nodata');
            if (domElements.statusBadgeTitle) domElements.statusBadgeTitle.textContent = "SIN DATOS";
            domElements.estadoAlerta.textContent = "Estado desconocido";
            domElements.statusDescription.textContent = "La estación no está reportando lecturas. No hay información para evaluar alertas.";

            // Escudo con interrogante
            domElements.statusShield.innerHTML = `
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M10 9a2 2 0 1 1 3.4 1.4c-.7.7-1.4 1.1-1.4 2.1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
                <circle cx="12" cy="16" r="0.9" fill="currentColor"></circle>
            `;

        } else {
            // Diseño cuando ESTÁ TODO BIEN (Verde + Escudo con Check)
            setClaseBannerEstado('status-safe');
            if (domElements.statusBadgeTitle) domElements.statusBadgeTitle.textContent = "ESTADO SEGURO";
            domElements.estadoAlerta.textContent = "Sin alertas activas";
            domElements.statusDescription.textContent = "Invernadero monitoreado. Todo bajo control.";

            // Dibuja escudo con check
            domElements.statusShield.innerHTML = `
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            `;
        }

        // Condiciones Actuales
        if(donovan.actual) {
            const act = donovan.actual;
            const val = v => (v !== null && v !== undefined) ? v : '--';
            domElements.temperaturaExterna.innerHTML = `${val(act.temperatura)}<span class="temp-unit">°C</span>`;
            domElements.humedadExterna.innerHTML = `${val(act.humedad)}<span class="secondary-unit">%</span>`;
            domElements.vientoVelocidad.innerHTML = `${val(act.viento_velocidad)}<span class="secondary-unit-sm">km/h</span>`;
            domElements.vientoDireccion.textContent = act.viento_direccion || '--';
        }

        // Predicciones
        let prediccionesParaGrafico = [];
        if(donovan.predicciones && donovan.predicciones.length > 0) {
            const temps = donovan.predicciones.map(p => p.temperatura_predicha);
            const minT = Math.min(...temps).toFixed(0);
            const maxT = Math.max(...temps).toFixed(0);
            domElements.prediccionRango.textContent = `${minT}°C - ${maxT}°C`;

            // Las horas del pronóstico se anclan al momento en que el modelo generó
            // las predicciones (dato del servidor), no al reloj del dispositivo.
            const baseTs = partesTimestamp(donovan.predicciones_generadas_at) ||
                           partesTimestamp(estacion.last_reading_at);
            const horaBase = baseTs ? baseTs.hora : new Date().getHours();

            domElements.forecastGrid.innerHTML = '';
            donovan.predicciones.forEach((pred, index) => {
                const horaStr = `${pad2((horaBase + pred.horizonte) % 24)}:00`;
                const tempFormat = pred.temperatura_predicha.toFixed(1);
                
                prediccionesParaGrafico.push({ hora: horaStr, temperatura: pred.temperatura_predicha });

                const cardHTML = `
                    <div class="hourly-card">
                        <div class="hourly-time">+${pred.horizonte} h</div>
                        <div class="hourly-hour">${horaStr}</div>
                        <div class="hourly-temp">${tempFormat}°C</div>
                    </div>
                `;
                domElements.forecastGrid.insertAdjacentHTML('beforeend', cardHTML);
            });
        } else {
            // Sin predicciones disponibles: se limpia la proyección en vez de dejar
            // en pantalla los valores del ciclo anterior.
            domElements.prediccionRango.textContent = '--°C - --°C';
            domElements.forecastGrid.innerHTML = '';
        }

        // --- 2. SECCIÓN INVERNADERO (Sensores Internos) ---
        const sectores = (invernadero && invernadero.sectores) ? invernadero.sectores : {};
        const humProm = (invernadero && invernadero.humedad_promedio !== null &&
                         invernadero.humedad_promedio !== undefined)
            ? invernadero.humedad_promedio : '--';
        domElements.humedadPromedio.textContent = `${humProm}%`;

        let sumTemp = 0;
        let countTemp = 0;
        let nodosHumedad = [];
        let nodosTemp = [];

        const sectoresKeys = Object.keys(sectores);
        sectoresKeys.forEach(key => {
            const sector = sectores[key] || {};
            const hum = (sector.humedad !== null && sector.humedad !== undefined) ? sector.humedad : null;
            const tmp = (sector.temperatura !== null && sector.temperatura !== undefined) ? sector.temperatura : null;

            nodosHumedad.push({
                ubicacion: key,
                valor: hum !== null ? hum : '--',
                activo: hum !== null
            });

            if(tmp !== null) {
                sumTemp += tmp;
                countTemp++;
            }
            nodosTemp.push({
                ubicacion: key,
                valor: tmp !== null ? tmp.toFixed(1) : '--',
                activo: tmp !== null
            });
        });

        const tempPromedio = countTemp > 0 ? (sumTemp / countTemp).toFixed(1) : '--';
        domElements.temperaturaPromedio.textContent = `${tempPromedio}°C`;

        renderNodes(nodosHumedad, domElements.nodosHumedadContenedor, '%');
        renderNodes(nodosTemp, domElements.nodosTemperaturaContenedor, '°C');

        // --- 3. GRÁFICOS Y CARTEL ---
        let historialParaGrafico = [];
        if(donovan.historial) {
            donovan.historial.forEach(h => {
                // Se lee la hora tal como está en la base (sin convertir a la zona
                // horaria del dispositivo, que distorsionaría el eje del gráfico).
                const t = partesTimestamp(h.fecha_hora);
                historialParaGrafico.push({
                    hora: t ? `${pad2(t.hora)}:00` : '--:--',
                    temperatura: h.temperatura
                });
            });
        }

        initUnifiedChart(historialParaGrafico, prediccionesParaGrafico);
        // donovan.actual puede venir con nulos (estación sin lecturas): se pasa null
        // en vez de romper el render completo del dashboard.
        const tempActual = (donovan.actual && donovan.actual.temperatura !== undefined)
            ? donovan.actual.temperatura : null;
        generarCartelTendencia(tempActual, prediccionesParaGrafico);
    }

    function renderNodes(nodes, container, unit) {
        container.innerHTML = '';
        nodes.forEach(node => {
            const statusClass = node.activo ? 'active' : 'inactive';
            const statusText = node.activo ? '● Activo' : '○ Inactivo';
            const valDisplay = node.valor !== '--' ? `${node.valor}${unit}` : '--';
            const itemHTML = `
                <div class="sensor-node-item ${statusClass === 'inactive' ? 'inactive' : ''}">
                    <span class="node-location">${node.ubicacion}</span>
                    <span class="node-value">${valDisplay}</span>
                    <span class="node-status ${statusClass}">${statusText}</span>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHTML);
        });
    }

    function initUnifiedChart(hist, pred) {
        const ctx = document.getElementById('tempChart').getContext('2d');
        if (chartInstance) chartInstance.destroy();
        
        const labels = [...hist.map(d => d.hora), ...pred.map(d => d.hora)];
        const histValues = hist.map(d => d.temperatura);
        const predValues = pred.map(d => d.temperatura);
        
        // Rellenar arrays para alinear la gráfica
        const histData = [...histValues, ...Array(predValues.length).fill(null)];
        const ultimoValorRegistrado = histValues.length > 0 ? histValues[histValues.length - 1] : null;
        
        // Conectar la línea de predicción con el último punto histórico.
        // Sin historial, histValues.length - 1 daba -1 y Array(-1) lanzaba
        // RangeError, dejando el dashboard a medio renderizar.
        let paddingArray = Array(Math.max(0, histValues.length - 1)).fill(null);
        const predData = histValues.length > 0
            ? [...paddingArray, ultimoValorRegistrado, ...predValues]
            : [...predValues];

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Temperatura Registrada',
                        data: histData,
                        borderColor: '#72C02C',
                        backgroundColor: 'rgba(114, 192, 44, 0.2)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#72C02C',
                        pointRadius: 4,
                        spanGaps: true
                    },
                    {
                        label: 'Predicción de Temperatura',
                        data: predData,
                        borderColor: '#E67E22',
                        backgroundColor: 'rgba(230, 126, 34, 0.2)',
                        borderWidth: 3,
                        borderDash: [6, 4],
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#E67E22',
                        pointRadius: 4,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: { grid: { color: '#EAEFEA', borderDash: [4, 4] } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    function generarCartelTendencia(temperaturaActual, proximas6Horas) {
        const bannerElement = document.querySelector('.farmer-explanation-box');
        if (!bannerElement || temperaturaActual === null || proximas6Horas.length === 0) return;

        let maxTemp = temperaturaActual;
        let minTemp = temperaturaActual;
        let horaMax = "";
        let horaMin = "";

        proximas6Horas.forEach(pred => {
            if (pred.temperatura > maxTemp) { maxTemp = pred.temperatura; horaMax = pred.hora; }
            if (pred.temperatura < minTemp) { minTemp = pred.temperatura; horaMin = pred.hora; }
        });

        const difAscenso = maxTemp - temperaturaActual;
        const difDescenso = temperaturaActual - minTemp;
        const umbralCambio = 0.5; 

        if (difAscenso > difDescenso && difAscenso >= umbralCambio) {
            bannerElement.innerHTML = `<strong>💡 Pronóstico:</strong> La temperatura irá en aumento desde los <strong>${temperaturaActual}°C</strong> hasta <strong>${maxTemp.toFixed(1)}°C</strong> hacia <strong>${horaMax}</strong>.`;
            bannerElement.style.display = 'block';
        } else if (difDescenso > difAscenso && difDescenso >= umbralCambio) {
            bannerElement.innerHTML = `<strong>💡 Pronóstico:</strong> La temperatura irá en descenso desde los <strong>${temperaturaActual}°C</strong> hasta <strong>${minTemp.toFixed(1)}°C</strong> hacia <strong>${horaMin}</strong>.`;
            bannerElement.style.display = 'block';
        } else {
            bannerElement.style.display = 'none';
        }
    }

    /* ----------------------------------------------------------------------
     * SERVICE WORKER — actualización automática transparente (C2)
     * El SW purga los caches y toma el control; acá sólo se recarga una vez
     * para que el usuario quede en la versión nueva sin tocar nada.
     * -------------------------------------------------------------------- */
    if ('serviceWorker' in navigator) {
        // Si no había controlador, es la primera instalación: no hay que recargar.
        const habiaControlador = !!navigator.serviceWorker.controller;
        let recargando = false;

        const recargarUnaVez = () => {
            if (recargando || !habiaControlador) return;
            recargando = true;
            window.location.reload();
        };

        navigator.serviceWorker.addEventListener('controllerchange', recargarUnaVez);
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'SW_UPDATED') {
                console.log('[SW] Nueva versión activa:', event.data.version);
                recargarUnaVez();
            }
        });

        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('Service Worker registrado.', reg.scope);

                // Chequeo periódico y al volver a primer plano, para que un deploy
                // se propague sin esperar a que el usuario cierre la app.
                const buscarActualizacion = () => reg.update().catch(() => {});
                setInterval(buscarActualizacion, 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) buscarActualizacion();
                });
            })
            .catch(err => console.error('Error al registrar el Service Worker:', err));
    }

    /* ----------------------------------------------------------------------
     * TRANSICIONES ONLINE / OFFLINE
     * -------------------------------------------------------------------- */
    window.addEventListener('offline', () => setEstadoConexion('offline'));
    window.addEventListener('online', () => {
        setEstadoConexion('loading');
        fetchDashboardData();
    });

    // Iniciar y programar refresco
    const REFRESH_INTERVAL_MS = 300000; // 5 minutos
    let refreshIntervalId = null;

    function iniciarPolling() {
        if (refreshIntervalId) return; // ya está corriendo, evita duplicados
        refreshIntervalId = setInterval(fetchDashboardData, REFRESH_INTERVAL_MS);
    }

    function detenerPolling() {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            detenerPolling();
        } else {
            fetchDashboardData(); 
            iniciarPolling();
        }
    });

    if (!navigator.onLine) setEstadoConexion('offline');
    fetchDashboardData();
    iniciarPolling();
});
