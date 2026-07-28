/**
 * app.js
 * Lógica principal del Dashboard Climático.
 * Requiere que mockData.js y Chart.js estén cargados previamente.
 */

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
        forecastGrid: document.getElementById('hourly-forecast-grid')
    };

    // 2. Inicialización de Datos Base
    function populateBaseData(data) {
        domElements.ultimaActualizacion.textContent = data.ultimaActualizacion;
        domElements.estadoAlerta.textContent = data.estadoAlerta;
        
        domElements.temperaturaExterna.innerHTML = `${data.temperaturaExterna}<span class="temp-unit">°C</span>`;
        domElements.prediccionRango.textContent = `${data.prediccionMin}°C - ${data.prediccionMax}°C`;
        domElements.humedadExterna.innerHTML = `${data.humedadExterna}<span class="secondary-unit">%</span>`;
        
        domElements.vientoVelocidad.innerHTML = `${data.vientoVelocidad}<span class="secondary-unit-sm">km/h</span>`;
        domElements.vientoDireccion.textContent = data.vientoDireccion;

        domElements.humedadPromedio.textContent = `${data.sensoresInternos.humedadPromedio}%`;
        domElements.temperaturaPromedio.textContent = `${data.sensoresInternos.temperaturaPromedio}°C`;
    }

    // 3. Renderizado de Nodos (Sensores)
    function renderNodes(nodes, container, unit) {
        container.innerHTML = '';
        nodes.forEach(node => {
            const statusClass = node.activo ? 'active' : 'inactive';
            const statusText = node.activo ? '● Activo' : '○ Inactivo';
            const itemHTML = `
                <div class="sensor-node-item ${statusClass === 'inactive' ? 'inactive' : ''}">
                    <span class="node-location">${node.ubicacion}</span>
                    <span class="node-value">${node.valor}${unit}</span>
                    <span class="node-status ${statusClass}">${statusText}</span>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHTML);
        });
    }

    // 4. Renderizado del grid predictivo (próximas 6 horas)
    function renderHourlyForecast(predictions) {
        domElements.forecastGrid.innerHTML = '';
        const next6Hours = predictions.slice(0, 6);
        
        next6Hours.forEach((pred, index) => {
            const cardHTML = `
                <div class="hourly-card">
                    <div class="hourly-time">+${index + 1} h</div>
                    <div class="hourly-hour">${pred.hora}</div>
                    <div class="hourly-temp">${pred.temperatura}°C</div>
                </div>
            `;
            domElements.forecastGrid.insertAdjacentHTML('beforeend', cardHTML);
        });
    }

    // 5. Lógica de Gráfica Unificada con Chart.js
    function initUnifiedChart(data) {
        const ctx = document.getElementById('tempChart').getContext('2d');
        
        const hist = data.historico; // 6 horas
        const pred = data.predicciones.slice(0, 6); // Próximas 6 horas

        // Eje X completo (12 puntos temporales)
        const labels = [...hist.map(d => d.hora), ...pred.map(d => d.hora)];

        // Para crear una línea continua, la serie de predicción comienza 
        // exactamente en el último punto del historial.
        const histValues = hist.map(d => d.temperatura);
        const predValues = pred.map(d => d.temperatura);
        
        // Array de Historial: Rellenamos con 'null' la parte del futuro
        const histData = [...histValues, null, null, null, null, null, null];
        
        // Array de Predicción: Rellenamos con 'null' la parte pasada, 
        // pero inyectamos el último valor registrado para conectar la línea.
        const ultimoValorRegistrado = histValues[histValues.length - 1];
        const predData = [null, null, null, null, null, ultimoValorRegistrado, ...predValues];

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Temperatura Registrada',
                        data: histData,
                        borderColor: '#72C02C',
                        backgroundColor: 'rgba(114, 192, 44, 0.2)', // Verde transparente
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#72C02C',
                        pointRadius: 4
                    },
                    {
                        label: 'Predicción de Temperatura',
                        data: predData,
                        borderColor: '#E67E22', // Naranja
                        backgroundColor: 'rgba(230, 126, 34, 0.2)', // Naranja transparente
                        borderWidth: 3,
                        borderDash: [6, 4], // Diferenciador visual de proyección
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#E67E22',
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: true, 
                        position: 'bottom', // Leyenda ubicada debajo de la gráfica
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: { family: "'Reddit Sans', sans-serif" }
                        }
                    },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: '#EAEFEA', borderDash: [4, 4] }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // 6. Lógica de Cartel de Tendencia
    function generarCartelTendencia(data) {
        const bannerElement = document.querySelector('.farmer-explanation-box');
        if (!bannerElement) return;

        const temperaturaActual = data.temperaturaExterna;
        const proximas6Horas = data.predicciones.slice(0, 6);

        let maxTemp = temperaturaActual;
        let minTemp = temperaturaActual;
        let horaMax = "";
        let horaMin = "";

        proximas6Horas.forEach(pred => {
            if (pred.temperatura > maxTemp) {
                maxTemp = pred.temperatura;
                horaMax = pred.hora;
            }
            if (pred.temperatura < minTemp) {
                minTemp = pred.temperatura;
                horaMin = pred.hora;
            }
        });

        const diferenciaAscenso = maxTemp - temperaturaActual;
        const diferenciaDescenso = temperaturaActual - minTemp;
        const umbralCambio = 0.5; 

        if (diferenciaAscenso > diferenciaDescenso && diferenciaAscenso >= umbralCambio) {
            bannerElement.outerHTML = `<div class="farmer-explanation-box">  <strong>💡 Pronóstico para las próximas horas:</strong>  La temperatura irá en aumento desde los  <strong>${temperaturaActual}°C</strong> actuales hasta alcanzar  <strong>${maxTemp}°C</strong> hacia  <strong>${horaMax}</strong>.</div>`;
        } else if (diferenciaDescenso > diferenciaAscenso && diferenciaDescenso >= umbralCambio) {
            bannerElement.outerHTML = `<div class="farmer-explanation-box">  <strong>💡 Pronóstico para las próximas horas:</strong>  La temperatura irá en descenso desde los  <strong>${temperaturaActual}°C</strong> actuales hasta alcanzar  <strong>${minTemp}°C</strong> hacia  <strong>${horaMin}</strong>.</div>`;
        } else {
            bannerElement.style.display = 'none';
        }
    }

    // --- EJECUCIÓN PRINCIPAL ---
    populateBaseData(mockDataBackend);
    renderNodes(mockDataBackend.sensoresInternos.nodosHumedad, domElements.nodosHumedadContenedor, '%');
    renderNodes(mockDataBackend.sensoresInternos.nodosTemperatura, domElements.nodosTemperaturaContenedor, '°C');
    renderHourlyForecast(mockDataBackend.predicciones);
    
    initUnifiedChart(mockDataBackend);
    generarCartelTendencia(mockDataBackend);
});
