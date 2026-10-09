// "Try it without signing up" (app.sprint2go.com/try): the demo that runs in this browser tab, even though a server is
// there. No session, no sign-in, nothing saved on our server: the demo data lives in this tab, and the little the app
// remembers between visits sits under its own prefix in this browser (Start over clears it). The only request that
// still reaches the server is reading the public prices.
import { clearPrefixed, setStoragePrefix } from './settings';

export const trying = typeof location !== 'undefined' && /^\/try(\/|$)/.test(location.pathname);
/** The try-out's address prefix: its screens are /try/mail, /try/chat… so a reload stays in the try-out. */
export const routeBase = trying ? '/try' : '';
const PREFIX = 's2g-try:';

/** Before anything renders: its own storage, and no requests to our API except the public prices. */
export function startTryOut() {
  if (!trying) return;
  setStoragePrefix(PREFIX);
  const send = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const ours = url.origin === location.origin && url.pathname.startsWith('/api/');
    if (ours && !(url.pathname === '/api/pricing' && method === 'GET')) return Promise.reject(new TypeError('Nothing is sent to the server in the try-out'));
    return send(input, init);
  };
}

/** Start over: what this browser kept for the try-out goes, and the demo begins again. */
export function startOver() {
  clearPrefixed();
  location.assign('/try');
}
/** Signing up ends the try-out cleanly: nothing from it comes along into the new account. */
export function endTryOut() {
  clearPrefixed();
}
