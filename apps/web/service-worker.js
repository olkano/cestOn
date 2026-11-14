/* global self, caches, fetch, URL */
const VERSION = '__VERSION__';
const CACHE = `ceston-static-${VERSION}`;
const ASSETS = []; // CESTON_ASSET_LIST
const allowed = new Set(ASSETS);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil((async () => { const owned = (await caches.keys()).filter(key => key.startsWith('ceston-static-')); const keep = new Set([CACHE, ...owned.filter(key => key !== CACHE).slice(-2)]); await Promise.all(owned.filter(key => !keep.has(key)).map(key => caches.delete(key))); await self.clients.claim(); })()); });
self.addEventListener('message', event => { if (event.data?.type === 'version') event.ports[0]?.postMessage({ version: VERSION }); if (event.data?.type === 'activate') { if (event.data.version === VERSION) void self.skipWaiting(); } });
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/health/')) return;
  if (request.mode === 'navigate') event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
  else if (allowed.has(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) ?? fetch(request)));
});
self.addEventListener('push', event => {
  let payload = {}; try { payload = event.data.json(); } catch { /* Generic notification remains usable. */ }
  const route = /^\/(tasks|decisions)\/[a-f0-9-]{36}$/.test(payload.route ?? '') ? payload.route : '/today';
  const body = payload.body === 'cestOn needs a decision.' ? payload.body : 'cestOn has work for your review.';
  event.waitUntil(self.registration.showNotification('cestOn', { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: /^[a-f0-9-]{36}$/.test(payload.tag ?? '') ? payload.tag : 'ceston', renotify: false, data: { route } }));
});
self.addEventListener('notificationclick', event => { event.notification.close(); const route = /^\/(tasks|decisions)\/[a-f0-9-]{36}$/.test(event.notification.data?.route ?? '') ? event.notification.data.route : '/today'; event.waitUntil((async () => { const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); const existing = windows.find(client => new URL(client.url).origin === self.location.origin); if (existing) { await existing.navigate(route); await existing.focus(); } else await self.clients.openWindow(route); })()); });
