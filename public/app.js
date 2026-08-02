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
        statusDescription: document.querySelector('.status-description'),
        statusShield: document.querySelector('.status-shield-icon'),
        statusBadgeTitle: document.querySelector('.status-badge-title')
    };

    // Función principal para cargar datos del backend
    async function fetchDashboardData() {
        try {
            const resDonovan = await fetch(`${API_BASE_URL}/api/donovan/estado`);
            const resInv = await fetch(`${API_BASE_URL}/api/invernadero/sectores`);
            
            if(resDonovan.ok && resInv.ok) {
                const dataDonovan = await resDonovan.json();
                const dataInv = await resInv.json();
                
                actualizarDashboard(dataDonovan, dataInv);
            }
        } catch (error) {
            console.error("Error conectando con la API:", error);
        }
    }

    function actualizarDashboard(donovan, invernadero) {
        // --- 1. SECCIÓN DONOVAN (Estado General) ---
        
        // Estado de la estación
        if(donovan.estacion && donovan.estacion.activa) {
            domElements.stationBadge.innerHTML = `
                <svg class="station-signal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <circle cx="12" cy="20" r="1" fill="currentColor"></circle>
                </svg>
                <span class="badge-active">ACTIVA</span>
            `;
            domElements.stationBadge.style.color = "#72C02C";
        } else {
            domElements.stationBadge.innerHTML = `<span class="badge-active" style="color: red;">INACTIVA</span>`;
        }

        // Hora de actualización
        const now = new Date();
        domElements.ultimaActualizacion.textContent = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

        // Alertas
        if(donovan.alertas && donovan.alertas.length > 0) {
            // Diseño cuando HAY alertas (Naranja/Rojo + Escudo con Cruz)
            if (domElements.statusBadgeTitle) domElements.statusBadgeTitle.textContent = "¡ALERTA ACTIVA!";
            domElements.estadoAlerta.textContent = "Atención Requerida";
            domElements.estadoAlerta.style.color = "#E67E22";
            domElements.statusDescription.textContent = donovan.alertas.join(" | ");
            
            // Dibuja escudo con cruz (X)
            domElements.statusShield.innerHTML = `
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M15 9l-6 6m0-6 6 6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            `;
            domElements.statusShield.style.color = "#E67E22";
            
        } else {
            // Diseño cuando ESTÁ TODO BIEN (Verde + Escudo con Check)
            if (domElements.statusBadgeTitle) domElements.statusBadgeTitle.textContent = "ESTADO SEGURO";
            domElements.estadoAlerta.textContent = "Sin alertas activas";
            domElements.estadoAlerta.style.color = "#0A3632";
            domElements.statusDescription.textContent = "Invernadero monitoreado. Todo bajo control.";
            
            // Dibuja escudo con check
            domElements.statusShield.innerHTML = `
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            `;
            domElements.statusShield.style.color = "#72C02C";
        }

        // Condiciones Actuales
        if(donovan.actual) {
            const act = donovan.actual;
            domElements.temperaturaExterna.innerHTML = `${act.temperatura !== null ? act.temperatura : '--'}<span class="temp-unit">°C</span>`;
            domElements.humedadExterna.innerHTML = `${act.humedad !== null ? act.humedad : '--'}<span class="secondary-unit">%</span>`;
            domElements.vientoVelocidad.innerHTML = `${act.viento_velocidad !== null ? act.viento_velocidad : '--'}<span class="secondary-unit-sm">km/h</span>`;
            domElements.vientoDireccion.textContent = act.viento_direccion || '--';
        }

        // Predicciones
        let prediccionesParaGrafico = [];
        if(donovan.predicciones && donovan.predicciones.length > 0) {
            const temps = donovan.predicciones.map(p => p.temperatura_predicha);
            const minT = Math.min(...temps).toFixed(0);
            const maxT = Math.max(...temps).toFixed(0);
            domElements.prediccionRango.textContent = `${minT}°C - ${maxT}°C`;

            domElements.forecastGrid.innerHTML = '';
            donovan.predicciones.forEach((pred, index) => {
                const horaFutura = new Date();
                horaFutura.setHours(horaFutura.getHours() + pred.horizonte);
                const horaStr = `${horaFutura.getHours().toString().padStart(2,'0')}:00`;
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
        }

        // --- 2. SECCIÓN INVERNADERO (Sensores Internos) ---
        domElements.humedadPromedio.textContent = `${invernadero.humedad_promedio}%`;
        
        let sumTemp = 0;
        let countTemp = 0;
        let nodosHumedad = [];
        let nodosTemp = [];

        const sectoresKeys = Object.keys(invernadero.sectores);
        sectoresKeys.forEach(key => {
            const sector = invernadero.sectores[key];
            
            nodosHumedad.push({
                ubicacion: key,
                valor: sector.humedad !== null ? sector.humedad : '--',
                activo: sector.humedad !== null
            });

            if(sector.temperatura !== null) {
                sumTemp += sector.temperatura;
                countTemp++;
            }
            nodosTemp.push({
                ubicacion: key,
                valor: sector.temperatura !== null ? sector.temperatura.toFixed(1) : '--',
                activo: sector.temperatura !== null
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
                const date = new Date(h.fecha_hora);
                historialParaGrafico.push({
                    hora: `${date.getHours().toString().padStart(2,'0')}:00`,
                    temperatura: h.temperatura
                });
            });
        }

        initUnifiedChart(historialParaGrafico, prediccionesParaGrafico);
        generarCartelTendencia(donovan.actual.temperatura, prediccionesParaGrafico);
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
        
        // Conectar la línea de predicción con el último punto histórico
        let paddingArray = Array(histValues.length - 1).fill(null);
        const predData = [...paddingArray, ultimoValorRegistrado, ...predValues];

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

    // Registrar el Service Worker para la PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrado.', reg.scope))
            .catch(err => console.error('Error al registrar el Service Worker:', err));
    }

    // Iniciar y programar refresco
    fetchDashboardData();
    setInterval(fetchDashboardData, 300000); // 5 minutos
});
