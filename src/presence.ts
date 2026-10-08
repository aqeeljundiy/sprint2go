// Tells the server whether this window is in front and in use, so notifications go to the person's phone only when
// they're away (server/index.ts, /api/presence). Sent when the window shows, hides, gains or loses focus, and at most
// once a minute while someone is working in it. Nothing about what they do is sent, only that they're here.
let conn = '';
let last = 0;
let started = false;
const isDesktopApp = () => !!(window as unknown as { s2gDesktop?: unknown }).s2gDesktop;

function send() {
  if (!conn) return;
  last = Date.now();
  const visible = document.visibilityState === 'visible';
  const body = JSON.stringify({ conn, visible, focused: visible && document.hasFocus(), desktop: isDesktopApp() || undefined });
  // Leaving: a beacon still goes out while the page is being hidden or closed.
  if (!visible && navigator.sendBeacon?.('/api/presence', body)) return;
  void fetch('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

/** Called with each new live connection (the server's id for it). */
export function startPresence(id: string) {
  conn = id;
  send();
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', send);
  addEventListener('focus', send);
  addEventListener('blur', () => setTimeout(send, 50)); // focus moving into an email's frame isn't leaving
  const poke = () => {
    if (document.visibilityState === 'visible' && Date.now() - last > 60_000) send();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, poke, { passive: true, capture: true });
}
