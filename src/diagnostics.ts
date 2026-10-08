/**
 * What's useful to know when someone asks for help: the page, the browser, the app's build, and the last errors in
 * this tab. Errors are also reported to the server (grouped in the operator backend), at most a few per minute.
 */
const errors: { message: string; at: string }[] = [];
let sent = 0;
let started = false;

function report(message: string, stack?: string) {
  errors.push({ message: message.slice(0, 300), at: new Date().toISOString() });
  if (errors.length > 10) errors.shift();
  if (sent > 20 || !location.protocol.startsWith('http')) return;
  sent++;
  void fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, stack, path: location.pathname }), keepalive: true }).catch(() => {});
}

export function startDiagnostics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  setInterval(() => (sent = Math.max(0, sent - 5)), 60_000);
  window.addEventListener('error', (e) => {
    if (!e.message || /ResizeObserver loop/.test(e.message)) return; // harmless browser noise
    report(e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && typeof r === 'object' && 'name' in r && (r as Error).name === 'AbortError') return;
    report(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}
/** A crash caught by the app's error boundary. */
export const reportCrash = (e: Error) => report(e.message, e.stack);

/** The build the browser is running (from the app script's hashed file name). */
export function build() {
  const src = Array.from(document.scripts).map((s) => s.src).find((s) => /\/assets\/app-[\w-]+\.js/.test(s));
  return src?.match(/app-([\w-]+)\.js/)?.[1] ?? 'dev';
}
function browser() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown';
  const app = /Electron/.test(ua) ? 'desktop app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${app} on ${os}`;
}
export function diagnostics() {
  return {
    page: location.pathname,
    browser: browser(),
    screen: `${innerWidth}×${innerHeight}`,
    build: build(),
    language: navigator.language,
    errors: [...errors],
  };
}
