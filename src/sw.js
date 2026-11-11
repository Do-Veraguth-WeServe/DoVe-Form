// Form Service Worker — precached app shell only.
//
// Scope: static shell files. NEVER /api/* responses (they are user
// authenticated; the app layer owns data caching via its localStorage cache
// with the server SQLite as single source of truth). Cache name is versioned
// by a shell-content hash injected at build time, so every deploy activates a
// fresh cache and activation drops the old one.
const VERSION = '__FORM_SHELL_VERSION__';
const SHELL = [
  '/',
  '/app.js',
  '/worker.js',
  '/animation-verification.js',
  '/quickjs.wasm',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

async function refresh(cache, request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return null;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll is atomic: a missing shell file fails the install, the previous
    // worker keeps serving — no half-cached shell.
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const isNavigation = request.mode === 'navigate';
  const cachedPath = isNavigation ? '/' : url.pathname;
  if (!isNavigation && !SHELL.includes(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(cachedPath);
    if (cached) {
      // stale-while-revalidate: instant paint, silent background refresh
      event.waitUntil(refresh(cache, new Request(cachedPath)));
      return cached;
    }
    const network = await refresh(cache, request);
    return network || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
