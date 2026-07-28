const CACHE_NAME = 'sivai-v1';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './chart.min.js',
  './manifest.json',
  './icons/SIVAI_favicon.svg',
  './icons/SIVAI_marca_Color_SF.svg',
  './icons/logo-unsl-negativo2.png',
  './icons/inta_logo.png'
];

// Instalar el Service Worker y guardar los archivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Interceptar peticiones
self.addEventListener('fetch', event => {
  // NO guardar en caché las consultas a tu API (FastAPI)
  if (event.request.url.includes('/api/')) {
    return; 
  }

  // Para el HTML, CSS, JS e imágenes, responder con caché si está disponible
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Devuelve desde caché
        }
        return fetch(event.request); // Si no está, va a internet
      })
  );
});

// Limpiar cachés viejos si actualizas la versión de 'sivai-v1' a otra
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
                  .map(name => caches.delete(name))
      );
    })
  );
});
