/**
 * sw.js — Service Worker de SIVAI
 *
 * Política de actualización (transparente para el usuario):
 *   install  -> skipWaiting(): la versión nueva no espera a que se cierren las pestañas.
 *   activate -> purga TODOS los caches previos, vuelve a descargar los assets críticos
 *               desde la red (cache: 'reload', sin pasar por el HTTP cache del browser)
 *               y recién entonces toma el control con clients.claim().
 *   Al tomar el control se avisa a los clientes, que recargan una sola vez.
 *
 * IMPORTANTE: al publicar una versión nueva hay que subir SW_VERSION.
 */

const SW_VERSION = 'v2';
const CACHE_NAME = `sivai-${SW_VERSION}`;

// Assets críticos: son los que se re-descargan desde cero en cada activación.
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './chart.min.js',
  './manifest.json',
  './icons/SIVAI_favicon.svg',
  './icons/SIVAI_marca_Color_SF.svg',
  './icons/SIVAI_Icono-PWA192x192.png',
  './icons/SIVAI_Icono-PWA512x512.png',
  './icons/logo-unsl-negativo2.png',
  './icons/inta_logo.png'
];

const HTML_FALLBACK = './index.html';

/* --------------------------------------------------------------------------
 * INSTALL — no se precachea nada acá: el llenado del cache ocurre en 'activate',
 * después de la purga, para garantizar que ningún recurso quede stale.
 * -------------------------------------------------------------------------- */
self.addEventListener('install', () => {
  self.skipWaiting();
});

/* --------------------------------------------------------------------------
 * ACTIVATE — purga total + descarga limpia + claim
 * -------------------------------------------------------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 1. Purga COMPLETA de todos los caches (incluido cualquier resto de la versión
    //    anterior). Nada de la versión previa sobrevive a este punto.
    const nombres = await caches.keys();
    await Promise.all(nombres.map(nombre => caches.delete(nombre)));

    // 2. Re-descarga de los assets críticos salteando el HTTP cache del navegador.
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async url => {
      try {
        const respuesta = await fetch(new Request(url, { cache: 'reload' }));
        if (respuesta && respuesta.ok && respuesta.type !== 'opaque') {
          await cache.put(url, respuesta.clone());
        }
      } catch (err) {
        // Sin conexión durante la actualización: el recurso se cachea en el
        // primer fetch exitoso. No se aborta la activación por esto.
        console.warn('[SW] No se pudo precachear', url, err);
      }
    }));

    // 3. Recién ahora se toma el control de las pestañas abiertas.
    await self.clients.claim();

    // 4. Aviso a los clientes para que recarguen con la versión nueva.
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientes.forEach(cliente => cliente.postMessage({ type: 'SW_UPDATED', version: SW_VERSION }));
  })());
});

/* --------------------------------------------------------------------------
 * FETCH — estrategia por tipo de recurso
 * -------------------------------------------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Sólo GET: POST/PUT nunca se cachean.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Terceros (Google Fonts, etc.): se dejan al navegador, no se cachean acá.
  if (url.origin !== self.location.origin) return;

  // Datos agrometeorológicos: SIEMPRE a la red, nunca cache.
  // Evita mostrar lecturas viejas como si fueran actuales.
  if (url.pathname.startsWith('/api/')) return;

  const esNavegacion = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  // HTML / navegación -> network-first: el documento nunca se sirve stale si hay red.
  if (esNavegacion) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets estáticos -> cache-first con revalidación en segundo plano.
  event.respondWith(cacheFirstConRevalidacion(event, req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const respuesta = await fetch(req);
    if (respuesta && respuesta.ok) {
      cache.put(req, respuesta.clone()).catch(() => {});
    }
    return respuesta;
  } catch (err) {
    const cacheada = await cache.match(req);
    if (cacheada) return cacheada;
    const fallback = await cache.match(HTML_FALLBACK);
    if (fallback) return fallback;
    return new Response('Sin conexión y sin copia en caché.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirstConRevalidacion(event, req) {
  const cache = await caches.open(CACHE_NAME);
  const cacheada = await cache.match(req);

  const desdeRed = fetch(req)
    .then(respuesta => {
      if (respuesta && respuesta.ok) {
        cache.put(req, respuesta.clone()).catch(() => {});
      }
      return respuesta;
    })
    .catch(() => null);

  if (cacheada) {
    event.waitUntil(desdeRed);
    return cacheada;
  }

  const respuesta = await desdeRed;
  if (respuesta) return respuesta;

  return new Response('Recurso no disponible sin conexión.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/* --------------------------------------------------------------------------
 * Mensajes desde la página (fuerza activación inmediata si se solicita)
 * -------------------------------------------------------------------------- */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
