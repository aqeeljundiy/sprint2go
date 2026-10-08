// sprint2go service worker: makes the app installable. It passes every request straight to the network (no caching
// yet), so nothing stale is ever shown; the app needs the server for data anyway.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
