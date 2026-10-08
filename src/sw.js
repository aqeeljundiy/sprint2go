// sprint2go's service worker (built into dist/sw.js by vite.config.ts, which stamps the build on it, so every deploy is
// a new worker that takes over straight away). It is small on purpose:
// - Pages always come from the network, so a deploy shows at once. Only with no connection: a simple offline page.
// - Nothing else is touched: scripts and styles (hashed, the browser caches them), the API, the live stream
//   (/api/events) and uploads all go straight to the server, exactly as without a worker.
// - Notifications: shows what the server pushes, and a tap opens the exact item in the app.
const BUILD = '__BUILD__';
const CACHE = `s2g-offline-${BUILD}`;
const OFFLINE = '/offline.html';
const KEEP = [OFFLINE, '/offline.js']; // all that's kept on the device: the offline page and its script

self.addEventListener('install', (e) => {
  // Where the browser supports it, the API (the live stream and uploads too) and the built files don't even wake the
  // worker: they go to the network directly.
  try {
    if (e.addRoutes && typeof URLPattern === 'function')
      e.waitUntil(e.addRoutes(['/api/*', '/assets/*'].map((pathname) => ({ condition: { urlPattern: new URLPattern({ pathname }) }, source: 'network' }))).catch(() => {}));
  } catch {
    /* older browsers: the fetch handler below leaves these alone anyway */
  }
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(KEEP.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('s2g-offline-') && k !== CACHE) await caches.delete(k);
      // Pages start loading while the worker wakes up, so having a worker never makes opening the app slower.
      await self.registration.navigationPreload?.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // The offline page's script, from the device when there's no connection.
  if (url.pathname === '/offline.js') return e.respondWith(fetch(req).catch(() => caches.match(req)));
  if (req.mode !== 'navigate') return;
  const api = url.pathname.startsWith('/api/');
  e.respondWith(
    (async () => {
      try {
        return (await e.preloadResponse) || (await fetch(req));
      } catch (err) {
        if (api) throw err;
        return (await caches.match(OFFLINE)) || new Response('You’re offline. Check your connection and try again.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })(),
  );
});

/* ---------- notifications ---------- */

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  const shown = self.registration.showNotification(d.title || 'New notification', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag, // a newer message in the same conversation still alerts
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    timestamp: Date.now(),
    data: { url: d.url || '/', notice: d.notice },
  });
  // The count on the app's icon (Home Screen apps and installed desktop apps).
  const badge = typeof d.badge === 'number' && self.navigator.setAppBadge ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}) : null;
  e.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href;
  e.waitUntil(
    (async () => {
      // An open window of the app: bring it forward and let it open the item (no reload, nothing lost).
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.focused) || wins.find((w) => w.visibilityState === 'visible') || wins[0];
      if (win) {
        await win.focus().catch(() => {});
        win.postMessage({ type: 's2g-open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// The browser renewed this device's notification address: tell the server, so nothing gets lost.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      const old = e.oldSubscription;
      let sub = e.newSubscription;
      if (!sub) {
        const key = old && old.options && old.options.applicationServerKey ? old.options.applicationServerKey : await fetch('/api/push/key').then((r) => r.json()).then((k) => fromB64(k.key));
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), replaces: old ? old.endpoint : undefined, refresh: true }) });
    })().catch(() => {}),
  );
});
