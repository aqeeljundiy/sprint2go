// Notifications on this device: turning them on (the browser asks, then we hand the server this device's push
// address), off, and a test. The server sends them only while the person is away from the app (server/notifyPush.ts).
import { caps } from './caps';
import { server } from './sync';
import { t } from './i18n';

/** The Mac and Windows app (desktop/preload.cjs): it shows notifications itself while it's open. */
export interface DesktopBridge {
  platform: string;
  version: string;
  focus?: () => void;
  setBadge?: (n: number) => void;
  onUpdateReady?: (cb: (info: { version?: string }) => void) => (() => void) | void;
  restartToUpdate?: () => void;
}
export const desktop = () => (window as unknown as { s2gDesktop?: DesktopBridge }).s2gDesktop;

/**
 * Where this device stands:
 * demo: no server to send from; desktop: the desktop app (on while it's open); unsupported: this browser can't;
 * ios-install: iPhone or iPad in Safari, which needs the app on the Home Screen first; blocked: the browser said no;
 * off; on.
 */
export type PushState = 'demo' | 'desktop' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

const ua = () => navigator.userAgent;
export const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** A short name for this device, so a person can tell their devices apart later. */
function deviceName() {
  const u = ua();
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || (isIOS() && !/iPhone/.test(u)) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return `${os}${browser && !installed() ? ` (${browser})` : installed() ? ' (app)' : ''}`;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function registration() {
  // The built app registers the worker as it starts (main.tsx); in development it's registered here, when needed.
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
}
async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}
const post = (url: string, body: unknown, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Where this device stands. When it's on, this also tells the server the device is still here (and renews which
 * sign-in it belongs to); it never turns notifications on by itself for someone else signed in on this browser.
 */
export async function pushState(): Promise<PushState> {
  if (!server.on || !caps.push) return 'demo';
  if (desktop()) return 'desktop';
  if (!supported()) return isIOS() && !installed() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = Notification.permission === 'granted' ? await currentSub().catch(() => null) : null;
  if (!sub) return 'off';
  const r = await post('/api/push/subscribe', { subscription: sub.toJSON(), device: deviceName(), refresh: true }).catch(() => null);
  if (!r) return 'on'; // offline: it was on, and still is as far as we know
  return ((await r.json().catch(() => ({}))) as { on?: boolean }).on ? 'on' : 'off';
}

/** Asks the browser (it must follow a tap), then subscribes this device. */
export async function turnOn(): Promise<{ state: PushState; error?: string }> {
  if (!supported()) return { state: isIOS() && !installed() ? 'ios-install' : 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm === 'denied') return { state: 'blocked' };
  if (perm !== 'granted') return { state: 'off' }; // closed the browser's question without answering
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const { key } = (await (await fetch('/api/push/key')).json()) as { key: string };
    const appKey = fromB64(key);
    let sub = await reg.pushManager.getSubscription();
    // Made for other keys (the server's were renewed): start over.
    if (sub && !sameKey(sub.options.applicationServerKey, appKey)) (await sub.unsubscribe(), (sub = null));
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const r = await post('/api/push/subscribe', { subscription: sub.toJSON(), device: deviceName() });
    if (!r.ok) {
      const why = ((await r.json().catch(() => ({}))) as { error?: string }).error;
      return { state: 'off', error: why ? t(why) : t('Couldn’t turn them on. Try again.') };
    }
    return { state: ((await r.json()) as { on?: boolean }).on ? 'on' : 'off' };
  } catch {
    return { state: 'off', error: t('This browser couldn’t set up notifications. Try again, or use another browser.') };
  }
}

export async function turnOff(): Promise<PushState> {
  const sub = await currentSub().catch(() => null);
  if (sub) {
    await post('/api/push/subscribe', { endpoint: sub.endpoint }, 'DELETE').catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

export async function sendTest(): Promise<string | null> {
  const sub = await currentSub().catch(() => null);
  if (!sub) return 'This device isn’t set up yet. Turn notifications on first.';
  const r = await post('/api/push/test', { endpoint: sub.endpoint }).catch(() => null);
  if (!r) return 'Couldn’t reach the server. Check your connection.';
  return r.ok ? null : (((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'The test didn’t go out.');
}

/** Signing out: this browser stops getting that person's notifications (the next person turns their own on). */
export async function forgetDevice() {
  if (!('serviceWorker' in navigator)) return;
  const sub = await currentSub().catch(() => null);
  await sub?.unsubscribe().catch(() => {});
}
