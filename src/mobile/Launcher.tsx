import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bell, EyeOff, LayoutGrid, Plus, Search, Sparkles, type LucideIcon } from 'lucide-react';
import type { Person, Workspace } from '../types';
import type { Need } from '../needsYou';
import { NeedsList, type NeedActions } from '../components/home/HomeParts';
import { Avatar } from '../components/Avatar';
import { WorkspaceLogo } from '../components/WorkspaceLogo';
import { ActionSheet, type SheetAction } from '../components/ui/ActionSheet';
import { PushScreen } from '../components/ui/PushScreen';
import { useLongPress } from '../components/ui/useLongPress';
import { fmtTime, fmtWeekdayLong } from '../i18n/format';
import { t, tn, tx } from '../i18n';
import type { LauncherId } from './launcherApps';

export interface LauncherApp {
  id: LauncherId;
  name: string;
  icon: LucideIcon;
  badge?: number; // only what is for you (unread mail, DMs and mentions, tasks due or late, table replies)
  live?: boolean; // Meet: the notetaker is in a meeting right now
  create?: { label: string; run: () => void }; // "New task" in the tile's long-press sheet
}

export interface Recent {
  key: string;
  title: string;
  icon: LucideIcon;
  app: LauncherId;
  run: () => void;
}

const count = (n: number) => (n > 99 ? '99+' : String(n));

/** One app's tile: the app's colour, its icon, its name under it, a red count or a live dot on its corner. */
export function AppTile({ app, onOpen, press, dim, children }: { app: LauncherApp; onOpen?: (el: HTMLElement) => void; press?: ReturnType<typeof useLongPress>; dim?: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      className={`ln-tile lp${dim ? ' dim' : ''}`}
      data-app={app.id}
      data-tile={app.id}
      onClick={(e) => onOpen?.(e.currentTarget)}
      aria-label={app.badge ? t('{app}, {n} new', { app: app.name, n: app.badge }) : app.live ? t('{app}, recording now', { app: app.name }) : app.name}
      {...press}
    >
      <span className="ln-sq">
        <app.icon size={24} strokeWidth={1.75} />
        {app.badge ? <i className="ln-badge">{count(app.badge)}</i> : app.live ? <i className="ln-live" /> : null}
        {children}
      </span>
      <span className="ln-name">{app.name}</span>
    </button>
  );
}

/**
 * The phone's start screen (research/launcher/plan.md, section 2; Teams' grid, Gojek's fixed corner, Lark's admin
 * order): the company and search on top, what needs you (three rows, "See all" for the rest), where you left off,
 * then your apps in four columns. Tapping a tile opens the app full screen; the launcher button in every app's top bar
 * comes back here. Always mounted on phones: it fades and scales back while an app grows out of its tile.
 */
export function Launcher(p: {
  open: boolean;
  ws: Workspace;
  me: Person & { color?: string };
  firstName: string;
  needs: Need[];
  needActions: NeedActions;
  next?: { title: string; start: string };
  recents: Recent[];
  apps: LauncherApp[];
  unreadNotices: number;
  ai: boolean;
  onCompany: () => void;
  onSearch: () => void;
  onAsk: () => void;
  onBell: () => void;
  onAccount: () => void;
  onSeeAll: () => void;
  onApp: (id: LauncherId, tile: HTMLElement) => void;
  onHide: (id: LauncherId) => void;
  onEdit: () => void;
  onNew: () => void;
}) {
  const hour = new Date().getHours();
  const name = p.firstName;
  const greeting = (hour < 11 ? t('Good morning, {name}.', { name }) : hour < 15 ? t('Good afternoon, {name}.', { name }) : hour < 18 ? t('Good evening, {name}.', { name }) : hour < 19 ? tx('after 6 pm', 'Good evening, {name}.', { name }) : t('Working late, {name}.', { name })).replace(/\.$/, '');
  const list = p.needs.filter((x) => x.group === 'needs');
  // The Needs you card right below says what needs you, so the line under the greeting only adds what's next.
  const lede = list.length
    ? p.next
      ? t('Next: {title} at {time}.', { title: p.next.title, time: fmtTime(p.next.start) })
      : ''
    : p.next
      ? t('Nothing needs you right now. Next: {title} at {time}.', { title: p.next.title, time: fmtTime(p.next.start) })
      : t('Nothing needs you right now.');
  const [allNeeds, setAllNeeds] = useState(false);
  // Opening an app from the full list closes the launcher; the list goes with it.
  useEffect(() => {
    if (!p.open) setAllNeeds(false);
  }, [p.open]);
  const [menuFor, setMenuFor] = useState<{ app: LauncherApp; anchor: HTMLElement } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  if (menuFor) anchor.current = menuFor.anchor;
  const actions: SheetAction[] = menuFor
    ? [
        { label: t('Open'), icon: menuFor.app.icon, run: () => p.onApp(menuFor.app.id, menuFor.anchor) },
        ...(menuFor.app.create ? [{ label: menuFor.app.create.label, icon: Plus, run: menuFor.app.create.run }] : []),
        ...(menuFor.app.id !== 'settings' ? [{ label: t('Hide from the launcher'), icon: EyeOff, run: () => p.onHide(menuFor.app.id) }] : []),
        { label: t('Edit apps'), icon: LayoutGrid, run: p.onEdit },
      ]
    : [];
  return (
    <div className={`launcher home-phone${p.open ? ' on' : ''}`} aria-hidden={!p.open} inert={!p.open || undefined}>
      <div className="ln-scroll">
        <header className="ln-top">
          <button type="button" className="ln-logo" onClick={p.onCompany} aria-haspopup="dialog" aria-label={t('Workspace: {name}', { name: p.ws.name })}>
            <WorkspaceLogo ws={p.ws} size={32} />
          </button>
          <button type="button" className="ln-search" onClick={p.onSearch} aria-label={t('Search apps and people')}>
            <Search size={20} />
            <FitText full={t('Search apps and people')} short={t('Search')} />
          </button>
          {p.ai && (
            <button type="button" className="icon-btn ln-ib" onClick={p.onAsk} aria-label={t('Ask AI')} title={t('Ask AI')}>
              <Sparkles size={24} strokeWidth={1.75} />
            </button>
          )}
          <button type="button" className="icon-btn ln-ib" onClick={p.onBell} aria-label={p.unreadNotices ? t('Notifications, new ones') : t('Notifications')}>
            <Bell size={24} strokeWidth={1.75} />
            {p.unreadNotices > 0 && <i className="ln-dot" />}
          </button>
          <button type="button" className="ln-me" onClick={p.onAccount} aria-label={t('Your account')}>
            <Avatar person={p.me} size={32} />
          </button>
        </header>

        <div className="ln-hello">
          <p className="ln-date">{fmtWeekdayLong(new Date())}</p>
          <FitTitle full={greeting} short={greeting.split(',')[0]} />
          {lede && <p className="ln-lede">{lede}</p>}
        </div>

        {list.length > 0 && (
          <section className="ln-sec" aria-label={t('Needs you')}>
            <h2 className="ln-h">
              <span>{t('Needs you')}</span>
              {list.length > 3 && (
                <button type="button" className="link-btn" onClick={() => setAllNeeds(true)}>
                  {tn(list.length, 'See all {n}', 'See all {n}')}
                </button>
              )}
            </h2>
            <div className="ln-card">
              <NeedsList items={list} a={p.needActions} limit={3} more={false} />
            </div>
          </section>
        )}
        {list.length === 0 && (
          <section className="ln-sec">
            <h2 className="ln-h">
              <span>{t('You’re clear for now')}</span>
              <button type="button" className="link-btn" onClick={p.onSeeAll}>
                {t('Home')}
              </button>
            </h2>
          </section>
        )}

        {p.recents.length > 0 && (
          <section className="ln-sec" aria-label={t('Continue where you left off')}>
            <h2 className="ln-h">
              <span>{t('Continue where you left off')}</span>
            </h2>
            <div className="ln-recents">
              {p.recents.slice(0, 3).map((r) => (
                <button key={r.key} type="button" className="ln-recent" data-app={r.app} onClick={r.run}>
                  <r.icon size={16} />
                  <span>{r.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="ln-sec" aria-label={t('Apps')}>
          <h2 className="ln-h">
            <span>{t('Apps')}</span>
            <button type="button" className="link-btn" onClick={p.onEdit}>
              {t('Edit')}
            </button>
          </h2>
          <div className="ln-grid">
            {p.apps.map((a) => (
              <PressTile key={a.id} app={a} onOpen={(el) => p.onApp(a.id, el)} onMenu={(el) => setMenuFor({ app: a, anchor: el })} />
            ))}
          </div>
        </section>
      </div>
      <button type="button" className={`fab ln-fab${p.open ? ' on' : ''}`} onClick={p.onNew} aria-label={t('New')} title={t('New')} tabIndex={p.open ? 0 : -1}>
        <Plus size={24} />
      </button>
      {allNeeds && (
        <PushScreen title={t('Needs you')} onBack={() => setAllNeeds(false)} backLabel={t('Home')} iconBack className="ln-all">
          <div className="ln-card ln-all-card">
            <NeedsList items={list} a={p.needActions} limit={list.length} more={false} />
          </div>
        </PushScreen>
      )}
      <ActionSheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.app.name ?? ''} anchor={anchor} actions={actions} />
    </div>
  );
}

function PressTile({ app, onOpen, onMenu }: { app: LauncherApp; onOpen: (el: HTMLElement) => void; onMenu: (el: HTMLElement) => void }) {
  const press = useLongPress((pt) => onMenu(pt.target.closest<HTMLElement>('.ln-tile') ?? pt.target));
  return (
    <AppTile
      app={app}
      onOpen={onOpen}
      press={{
        ...press,
        onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
          press.onContextMenu(e);
          e.preventDefault();
          onMenu(e.currentTarget);
        },
      }}
    />
  );
}

/** One line that says less when the room runs out ("Search apps and people", else "Search"). */
function FitText({ full, short }: { full: string; short: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const probe = el.querySelector<HTMLElement>('.ln-probe');
      if (probe) setFits(probe.scrollWidth <= el.clientWidth + 1);
    };
    check();
    void document.fonts?.ready.then(check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);
  return (
    <span ref={ref} className="ln-fit">
      <span aria-hidden="true">{fits ? full : short}</span>
      <span className="ln-probe" aria-hidden="true">
        {full}
      </span>
    </span>
  );
}

/** The greeting on one line: "Good morning, Raka" when it fits the width, else "Good morning". */
function FitTitle({ full, short }: { full: string; short: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const h = ref.current;
    if (!h) return;
    const check = () => {
      const probe = h.querySelector<HTMLElement>('.ln-probe');
      if (probe) setFits(probe.scrollWidth <= h.clientWidth);
    };
    check();
    void document.fonts?.ready.then(check);
    const ro = new ResizeObserver(check);
    ro.observe(h);
    return () => ro.disconnect();
  }, [full]);
  return (
    <h1 ref={ref} className="ln-greet" aria-label={full} style={{ '--fit': fits ? 1 : 0 } as CSSProperties}>
      <span aria-hidden="true">{fits ? full : short}</span>
      <span className="ln-probe" aria-hidden="true">
        {full}
      </span>
    </h1>
  );
}
