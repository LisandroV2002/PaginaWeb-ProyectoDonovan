// Configuración de la API

// Registrar el Service Worker para la PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registrado con éxito.', reg.scope))
      .catch(err => console.error('Error al registrar el Service Worker:', err));
  });
}

// Configuración de la API dinámica (Detecta la IP o dominio automáticamente)
const API_BASE_URL = window.location.origin;

//const API_BASE_URL = "http://localhost:8000"; 

let chartInstance = null;

async function fetchDashboardData() {
    try {
        const resDonovan = await fetch(`${API_BASE_URL}/api/donovan/estado`);
        if(resDonovan.ok) {
            const dataDonovan = await resDonovan.json();
            actualizarDonovan(dataDonovan);
        }

        const resInv = await fetch(`${API_BASE_URL}/api/invernadero/sectores`);
        if(resInv.ok) {
            const dataInv = await resInv.json();
            actualizarInvernadero(dataInv);
        }
    } catch (error) {
        console.error("Error conectando con la API:", error);
    }
}

function actualizarDonovan(data) {
    const badge = document.getElementById('badge-estado');
    if(data.estacion && data.estacion.activa) {
        badge.className = "inline-flex items-center gap-2 bg-[#7cb518] text-white text-xs font-bold px-3 py-1.5 rounded-full mb-3 shadow-sm w-max";
        badge.innerHTML = `<div class="w-2 h-2 bg-white rounded-full animate-pulse"></div> ACTIVA`;
    } else {
        badge.className = "inline-flex items-center gap-2 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-3 shadow-sm w-max";
        badge.innerHTML = `<div class="w-2 h-2 bg-white rounded-full"></div> INACTIVA`;
    }

    const now = new Date();
    document.getElementById('txt-actualizacion').innerText = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const alertaIcono = document.getElementById('alerta-icono');
    const alertaTitulo = document.getElementById('alerta-titulo');
    const alertaDesc = document.getElementById('alerta-desc');

    if(data.alertas && data.alertas.length > 0) {
        alertaIcono.className = "w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-3 text-red-600 shadow-inner";
        alertaIcono.innerHTML = `<i class="ph-bold ph-warning text-3xl"></i>`;
        alertaTitulo.innerText = "¡Atención Requerida!";
        alertaTitulo.classList.replace("text-gray-800", "text-red-600");
        alertaDesc.innerText = data.alertas.join(" | ");
    } else {
        alertaIcono.className = "w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mb-3 text-green-600 shadow-inner";
        alertaIcono.innerHTML = `<i class="ph-bold ph-check text-3xl"></i>`;
        alertaTitulo.innerText = "Sin alertas activas";
        alertaTitulo.classList.replace("text-red-600", "text-gray-800");
        alertaDesc.innerText = "Todo bajo control";
    }

    if(data.actual) {
        const act = data.actual;
        document.getElementById('cond-humedad').innerText = `${act.humedad !== null && act.humedad !== undefined ? act.humedad : '--'} %`;
        document.getElementById('cond-viento').innerText = `${act.viento_velocidad !== null && act.viento_velocidad !== undefined ? act.viento_velocidad : '--'} km/h`;
        document.getElementById('cond-dir').innerText = `${act.viento_direccion !== null && act.viento_direccion !== undefined ? act.viento_direccion : '--'}`;
        document.getElementById('cond-precip').innerText = `${act.precipitacion !== null && act.precipitacion !== undefined ? act.precipitacion : '--'} mm`;
        document.getElementById('temp-actual').innerHTML = `${act.temperatura !== null && act.temperatura !== undefined ? act.temperatura : '--'}<span class="text-xl">°C</span>`;
    }

    if(data.predicciones && data.predicciones.length > 0) {
        const temps = data.predicciones.map(p => p.temperatura_predicha);
        const minT = Math.min(...temps).toFixed(0);
        const maxT = Math.max(...temps).toFixed(0);
        document.getElementById('temp-rango').innerText = `${minT}°C - ${maxT}°C`;
    }

    const forecastContainer = document.getElementById('forecast-cards');
    forecastContainer.innerHTML = ''; 
    
    let etiquetasGrafico = [];
    let datosObservados = [];
    let datosPredichos = [];

    if(data.historial) {
        data.historial.forEach(h => {
            const date = new Date(h.fecha_hora);
            etiquetasGrafico.push(`${date.getHours()}:00`);
            datosObservados.push(h.temperatura);
            datosPredichos.push(null); 
        });
    }

    const lastObservedTemp = datosObservados.length > 0 ? datosObservados[datosObservados.length - 1] : null;

    if(data.predicciones) {
        data.predicciones.forEach((p, index) => {
            const horaFutura = new Date();
            horaFutura.setHours(horaFutura.getHours() + p.horizonte);
            const horaStr = `${horaFutura.getHours().toString().padStart(2,'0')}:00`;
            const tempFormat = p.temperatura_predicha.toFixed(0);
            
            let icon = `<i class="ph-fill ph-sun text-3xl text-yellow-500"></i>`;
            if(tempFormat < 15) icon = `<i class="ph-fill ph-cloud text-3xl text-gray-400"></i>`;
            else if (tempFormat < 20) icon = `<i class="ph-fill ph-cloud-sun text-3xl text-yellow-500"></i>`;

            forecastContainer.innerHTML += `
                <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 min-w-[80px] flex-1 flex flex-col items-center text-center">
                    <p class="text-xs font-bold text-gray-800 mb-1">+${p.horizonte} h</p>
                    <p class="text-[10px] text-gray-400 mb-2">${horaStr}</p>
                    ${icon}
                    <p class="text-sm font-bold text-gray-800 mt-2">${tempFormat}°C</p>
                </div>
            `;

            etiquetasGrafico.push(horaStr);
            if(index === 0 && lastObservedTemp !== null) {
                datosPredichos[datosPredichos.length - 1] = lastObservedTemp;
            }
            datosObservados.push(null);
            datosPredichos.push(p.temperatura_predicha);
        });
    }

    actualizarGrafico(etiquetasGrafico, datosObservados, datosPredichos);
}

function actualizarGrafico(labels, observados, predichos) {
    const ctx = document.getElementById('tempChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperatura observada',
                    data: observados,
                    borderColor: '#7cb518',
                    backgroundColor: '#7cb518',
                    borderWidth: 2,
                    pointRadius: 4,
                    tension: 0.3,
                    spanGaps: true
                },
                {
                    label: 'Predicción',
                    data: predichos,
                    borderColor: '#0284c7',
                    backgroundColor: '#0284c7',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 4,
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { size: 11, family: "'Inter', sans-serif" }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: '#f1f5f9' },
                    ticks: { callback: function(value) { return value + '°'; } }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function obtenerEstadoHumedad(val) {
    if(val < 60) return { txt: 'Baja', cls: 'bg-yellow-100 text-yellow-700', icon: 'ph-drop-half-bottom' };
    if(val > 80) return { txt: 'Alta', cls: 'bg-red-100 text-red-700', icon: 'ph-drop' };
    return { txt: 'Normal', cls: 'bg-green-100 text-green-700', icon: 'ph-drop' };
}

function obtenerEstadoTemperatura(val) {
    if(val < 18) return { txt: 'Baja', cls: 'bg-yellow-100 text-yellow-700', icon: 'ph-thermometer-cold' };
    if(val > 25) return { txt: 'Alta', cls: 'bg-red-100 text-red-700', icon: 'ph-thermometer-hot' };
    return { txt: 'Normal', cls: 'bg-green-100 text-green-700', icon: 'ph-thermometer' };
}

function actualizarInvernadero(data) {
    document.getElementById('inv-hum-prom').innerHTML = `${data.humedad_promedio}<span class="text-xl text-gray-800">%</span>`;
    
    const gridHum = document.getElementById('grid-humedad');
    const gridTemp = document.getElementById('grid-temperatura');
    gridHum.innerHTML = '';
    gridTemp.innerHTML = '';

    let sumTemp = 0;
    let countTemp = 0;

    const sectoresKeys = Object.keys(data.sectores);

    sectoresKeys.forEach(key => {
        const sector = data.sectores[key];
        
        // === Lógica Tarjetas de Humedad ===
        if(sector.humedad !== null) {
            const estH = obtenerEstadoHumedad(sector.humedad);
            gridHum.innerHTML += `
                <div class="border border-gray-100 bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-between shadow-sm">
                    <p class="text-[11px] text-gray-500 font-semibold mb-1 leading-tight h-6 flex items-center">${key}</p>
                    <p class="text-lg font-bold text-gray-800 mb-2">${sector.humedad} %</p>
                    <span class="text-[10px] font-bold px-2 py-1 rounded w-full flex items-center justify-center gap-1 ${estH.cls}">
                        <i class="ph ${estH.icon}"></i> ${estH.txt}
                    </span>
                </div>
            `;
        } else {
            gridHum.innerHTML += `
                <div class="border border-gray-200 bg-gray-100 opacity-60 rounded-xl p-3 text-center flex flex-col items-center justify-between">
                    <p class="text-[11px] text-gray-500 font-semibold mb-1 leading-tight h-6 flex items-center">${key}</p>
                    <p class="text-lg font-bold text-gray-400 mb-2">-- %</p>
                    <span class="text-[10px] font-bold px-2 py-1 rounded w-full flex items-center justify-center gap-1 bg-gray-200 text-gray-500">
                        <i class="ph-bold ph-warning-circle"></i> Inactivo
                    </span>
                </div>
            `;
        }

        // === Lógica Tarjetas de Temperatura ===
        if(sector.temperatura !== null) {
            sumTemp += sector.temperatura;
            countTemp++;
            const estT = obtenerEstadoTemperatura(sector.temperatura);
            gridTemp.innerHTML += `
                <div class="border border-gray-100 bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-between shadow-sm">
                    <p class="text-[11px] text-gray-500 font-semibold mb-1 leading-tight h-6 flex items-center">${key}</p>
                    <p class="text-lg font-bold text-gray-800 mb-2">${sector.temperatura.toFixed(1)} °C</p>
                    <span class="text-[10px] font-bold px-2 py-1 rounded w-full flex items-center justify-center gap-1 ${estT.cls}">
                        <i class="ph ${estT.icon}"></i> ${estT.txt}
                    </span>
                </div>
            `;
        } else {
            gridTemp.innerHTML += `
                <div class="border border-gray-200 bg-gray-100 opacity-60 rounded-xl p-3 text-center flex flex-col items-center justify-between">
                    <p class="text-[11px] text-gray-500 font-semibold mb-1 leading-tight h-6 flex items-center">${key}</p>
                    <p class="text-lg font-bold text-gray-400 mb-2">-- °C</p>
                    <span class="text-[10px] font-bold px-2 py-1 rounded w-full flex items-center justify-center gap-1 bg-gray-200 text-gray-500">
                        <i class="ph-bold ph-warning-circle"></i> Inactivo
                    </span>
                </div>
            `;
        }
    });

    const tempPromedio = countTemp > 0 ? (sumTemp / countTemp).toFixed(1) : '--';
    document.getElementById('inv-temp-prom').innerHTML = `${tempPromedio}<span class="text-xl text-gray-800">°C</span>`;
}

document.addEventListener("DOMContentLoaded", fetchDashboardData);
setInterval(fetchDashboardData, 300000);
