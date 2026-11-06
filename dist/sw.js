/* network-first so fixes land immediately; falls back to cache offline */
const CACHE = 'dulux-scan-v3';
/* The share-gated host rejects subresource requests without the sharecode.
   This script is registered WITH the query, so self.location.search retains it. */
const Q = self.location.search || '';
const CORE = ['./' + Q, './index.html' + Q, './manifest.json' + Q,
              './icon-192.png' + Q, './icon-512.png' + Q];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
