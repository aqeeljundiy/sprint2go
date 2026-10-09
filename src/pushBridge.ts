// Where notifications meet the open app: a tapped notification opens the exact item (switching company first when
// needed), the app icon shows the unread count, the desktop app shows the notifications the server sends it, and it
// offers a restart when a new version is ready.
import { useEffect, useRef } from 'react';
import type { AppId, Notice } from './types';
import { desktop, pushState } from './push';
import { server } from './sync';
import { brand as product } from './terms';
import { t } from './i18n';

type Target = { app: string; ws?: string; id?: string; msg?: string; notice?: string };

/** The address a notification opens (/chat?ws=…&id=…&msg=…&notice=…) as what to open. */
function parse(href: string): Target | null {
  const u = new URL(href, location.origin);
  if (u.origin !== location.origin) return null;
  const q = u.searchParams;
  if (!q.has('ws') && !q.has('id') && !q.has('notice')) return null;
  return { app: u.pathname.slice(1).split('/')[0], ws: q.get('ws') ?? undefined, id: q.get('id') ?? undefined, msg: q.get('msg') ?? undefined, notice: q.get('notice') ?? undefined };
}

type Toast = { text: string; action?: { label: string; run: () => void }; ms?: number };

export function usePushBridge(p: { userId: string; wsId: string; workspaceIds: string[]; notices: Notice[]; switchWs: (id: string) => void; open: (n: Notice) => void; toast: (t: Toast) => void }) {
  const latest = useRef(p);
  latest.current = p;
  const pending = useRef<Target | null>(null);

  const openNow = (t: Target) => {
    const { notices, open } = latest.current;
    const found = t.notice ? notices.find((x) => x.id === t.notice) : undefined;
    open(found ?? { id: t.notice ?? '', userId: latest.current.userId, workspaceId: t.ws ?? '', kind: 'team', text: '', at: '', read: true, link: t.app ? { app: t.app as AppId, id: t.id, msg: t.msg } : undefined });
  };
  const go = (t: Target) => {
    const { wsId, workspaceIds, switchWs } = latest.current;
    // In another of their companies: switch there first, then open it (below, once the switch has happened).
    if (t.ws && t.ws !== wsId && workspaceIds.includes(t.ws)) {
      pending.current = t;
      return switchWs(t.ws);
    }
    openNow(t);
  };

  useEffect(() => {
    // Opened by tapping a notification while the app was closed: the address says what to open.
    const first = parse(location.href);
    if (first) {
      history.replaceState(history.state, '', location.pathname);
      go(first);
    }
    // Tapped while the app was open: the service worker brings this window forward and says what to open.
    const onMessage = (e: MessageEvent) => {
      const t = e.data?.type === 's2g-open' ? parse(String(e.data.url)) : null;
      if (t) go(t);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    // This device's notifications, if on, are renewed for this sign-in.
    if (server.on) void pushState();
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = pending.current;
    if (t && t.ws === p.wsId) {
      pending.current = null;
      openNow(t);
    }
  }, [p.wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The count on the app's icon: the Home Screen app, the installed desktop browser app, or the desktop app's dock.
  const unread = p.notices.reduce((n, x) => n + Number(x.userId === p.userId && !x.read), 0);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    void (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
    desktop()?.setBadge?.(unread);
  }, [unread]);

  useEffect(() => {
    const d = desktop();
    if (!d) return;
    // The desktop app can't take web push: the server sends what to show over the live connection (server/notifyPush.ts).
    const onAlert = (e: Event) => {
      const a = (e as CustomEvent<{ title: string; body: string; url: string; tag: string }>).detail;
      if (!('Notification' in window) || Notification.permission === 'denied') return;
      const show = () => {
        const n = new Notification(a.title, { body: a.body, tag: a.tag, icon: '/icon-192.png' });
        n.onclick = () => {
          d.focus?.();
          window.focus();
          const t = parse(a.url);
          if (t) go(t);
          n.close();
        };
      };
      if (Notification.permission === 'granted') show();
      else void Notification.requestPermission().then((x) => x === 'granted' && show());
    };
    addEventListener('s2g:alert', onAlert);
    // A new version of the desktop app downloaded in the background: a quiet offer to restart (it also installs on quit).
    const stop = d.onUpdateReady?.((info) =>
      latest.current.toast({ text: info.version ? t('A new version of the {product} app is ready ({version}). Restart to update.', { product: product.name, version: info.version }) : t('A new version of the {product} app is ready. Restart to update.', { product: product.name }), action: { label: t('Restart'), run: () => d.restartToUpdate?.() }, ms: 60_000 }),
    );
    return () => {
      removeEventListener('s2g:alert', onAlert);
      if (typeof stop === 'function') stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
