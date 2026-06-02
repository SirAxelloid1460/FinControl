/**
 * Service worker mínimo de FinControl PWA.
 * Estrategia: network-first para la navegación (para no servir HTML viejo) con
 * fallback a caché offline; cache-first para los assets estáticos. Suficiente
 * para que la PWA sea instalable y funcione sin conexión (la app ya es
 * local-first: los datos viven en el dispositivo).
 */
// Subruta de despliegue (debe coincidir con EXPO_PUBLIC_BASE_PATH). "" = raíz.
const BASE = '/FinControl';
const CACHE = 'fincontrol-v1';
const APP_SHELL = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // No interceptar llamadas a Supabase ni a APIs externas (precios, FX).
  if (url.origin !== self.location.origin) return;

  // Navegaciones: network-first con fallback a la app shell cacheada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(BASE + '/', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(BASE + '/').then((r) => r || caches.match(BASE + '/index.html'))
        )
    );
    return;
  }

  // Assets estáticos: cache-first.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
