import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppId } from '../types';
import type { Option } from '../components/ui/Select';
import type { SheetAction } from '../components/ui/ActionSheet';

/**
 * How an app talks to the phone shell (the top bar, the bottom bar and its create button). Each app calls these hooks
 * from its own component; the shell shows what the app on screen registered. Nothing here renders anything.
 *
 *   useCreateAction('mail', { label: 'Compose', icon: PenLine, run: compose, extended: true })   the floating button
 *   useTitleMenu('tasks', { label, value, options, onChange })                   the screen title as a switcher
 *   useAppSettings('tasks', { id, label, hint, render })                         a row at the bottom of that switcher
 *   useFocusedScreen(open, back?)                                                 the tab bar steps aside
 *   useSidebarDrawer(on)                                                          the app's Sidebar opens as a left drawer
 *   <TopBar lead={…} title={…} actions={…} search={false} />  (src/mobile/TopBar.tsx)  the app owns parts of the top bar
 *
 * Registrations follow the component: they're there while it's mounted and gone when it unmounts. When two parts of an
 * app register the same thing, the one mounted last wins.
 */

export interface CreateAction {
  label: string; // said by screen readers and shown as the button's tooltip ("New task")
  icon: LucideIcon;
  run: () => void;
  /** Long-press the button (or right-click it) for these, e.g. Brain dump next to New task. */
  more?: SheetAction[];
  /** Gmail's extended button: the icon and the label ("Compose"). It shrinks to the round icon while the list scrolls
   *  down and grows back on the way up (and at the top). */
  extended?: boolean;
  /** Keep it registered but out of sight for now (while selecting rows, say): it scales away and comes back. */
  hidden?: boolean;
}

export interface TitleMenu {
  label: string; // what the list is ("Mailbox and folder"): the sheet's title and the button's aria-label
  value: string;
  options: Option[];
  onChange: (v: string) => void;
}

export interface SettingsEntry {
  id: string;
  label: string; // "Swipe actions"
  hint?: string; // one line under it
  render: () => ReactNode; // the content of the full-screen page it opens (a PushScreen made by the shell)
}

type Entry<T> = { app: AppId | '*'; value: T; seq: number };
let seq = 0;

/** A small store: registrations by app, newest first, with subscribers for useSyncExternalStore. */
function slot<T>() {
  let list: Entry<T>[] = [];
  let version = 0;
  const subs = new Set<() => void>();
  const changed = () => {
    version++;
    subs.forEach((f) => f());
  };
  return {
    add(app: AppId | '*', value: T) {
      const e = { app, value, seq: ++seq };
      list = [...list, e];
      changed();
      return () => {
        list = list.filter((x) => x !== e);
        changed();
      };
    },
    latest: (app: AppId | '*') => list.filter((x) => x.app === app).sort((a, b) => b.seq - a.seq)[0]?.value ?? null,
    all: (app: AppId | '*') => list.filter((x) => x.app === app).sort((a, b) => a.seq - b.seq).map((x) => x.value),
    subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
    version: () => version,
  };
}

const creates = slot<CreateAction>();
const titles = slot<TitleMenu>();
const settings = slot<SettingsEntry>();
const focused = slot<{ back?: () => void }>();

/**
 * The app's main action: the button floating above the bottom bar at the right on phones (Gmail's Compose, Teams'
 * round compose). Pass null when there's none. `extended` shows the label too and shrinks on scroll; `hidden` keeps it
 * registered but out of sight.
 */
export function useCreateAction(app: AppId, action: CreateAction | null | false | undefined) {
  const ref = useRef(action || null);
  ref.current = action || null;
  const on = !!action;
  const label = action ? action.label : '';
  const icon = action ? action.icon : null;
  const extended = !!(action && action.extended);
  const hidden = !!(action && action.hidden);
  const moreKey = action && action.more ? action.more.map((m) => `${m.label}:${m.disabled ? 0 : 1}`).join('|') : '';
  useEffect(() => {
    if (!on || !icon) return;
    const more = ref.current?.more?.map((m, i) => ({ ...m, run: () => ref.current?.more?.[i]?.run() }));
    return creates.add(app, { label, icon, run: () => ref.current?.run(), more, extended, hidden });
  }, [app, on, label, icon, moreKey, extended, hidden]);
}

/** The screen title as a switcher (mailbox in Mail, scope in Tasks…). Pass null for a plain title. */
export function useTitleMenu(app: AppId, menu: TitleMenu | null | false | undefined) {
  const ref = useRef(menu || null);
  ref.current = menu || null;
  const key = menu ? JSON.stringify([menu.label, menu.value, menu.options.map((o) => [o.value, o.label, o.hint, o.group])]) : '';
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    return titles.add(app, { ...m, onChange: (v) => ref.current?.onChange(v) });
  }, [app, key]);
}

/** One of the app's own settings, listed at the bottom of the title switcher and opened full screen over the app. */
export function useAppSettings(app: AppId, entry: SettingsEntry | null | false | undefined) {
  const ref = useRef(entry || null);
  ref.current = entry || null;
  const key = entry ? `${entry.id}|${entry.label}|${entry.hint ?? ''}` : '';
  useEffect(() => {
    if (!ref.current) return;
    const { id, label, hint } = ref.current;
    return settings.add(app, { id, label, hint, render: () => ref.current?.render() ?? null });
  }, [app, key]);
}

/**
 * A focused screen (a mail, a channel, a note, a record, a project): while `open`, the tab bar and the create button
 * step aside so the screen's own actions take the bottom. `back` puts a Back button in the phone's top bar, for screens
 * that have no Back of their own.
 */
export function useFocusedScreen(open = true, back?: () => void) {
  const ref = useRef(back);
  ref.current = back;
  const hasBack = !!back;
  useEffect(() => {
    if (!open) return;
    return focused.add('*', { back: hasBack ? () => ref.current?.() : undefined });
  }, [open, hasBack]);
}

/**
 * The app's own Sidebar (the desktop one, from App.tsx) opens on phones as a modal drawer from the left while `on`
 * (Gmail's folders). Without it the sidebar stays hidden on phones. Open and close it with App's `sidebarOpen`.
 */
export function useSidebarDrawer(on = true) {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.classList.add('phone-sidebar');
    return () => root.classList.remove('phone-sidebar');
  }, [on]);
}

/* ---------- The company sheet, opened from an app's own place (Calendar's drawer header) ---------- */

const companyOpeners = new Set<() => void>();
/** Opens the shell's company sheet (you, your status, your companies), the one behind the top bar's logo. */
export function openCompanySheet() {
  companyOpeners.forEach((f) => f());
}
/** Used by the shell's top bar: what opens its company sheet. */
export function useCompanySheetOpener(open: () => void) {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const f = () => ref.current();
    companyOpeners.add(f);
    return () => void companyOpeners.delete(f);
  }, []);
}

/* ---------- The top bar: which parts an app owns (filled by <TopBar>, src/mobile/TopBar.tsx) ---------- */

export interface TopBarClaim {
  lead: boolean; // the left button (the company logo by default)
  title: boolean; // the title (the app's name or its title switcher by default)
  actions: boolean; // buttons before search
  search: boolean; // false: no search button
  replace: boolean; // the whole row is the app's (Gmail's search pill)
}
const bars = slot<TopBarClaim>();
const larges = slot<{ tucked: () => boolean; sub: (f: () => void) => () => void }>();

/** Where <TopBar> puts its parts: the shell's top bar registers its slots here. */
type Targets = { lead: HTMLElement | null; title: HTMLElement | null; actions: HTMLElement | null; replace: HTMLElement | null };
let targets: Targets = { lead: null, title: null, actions: null, replace: null };
const targetSubs = new Set<() => void>();
export function setTopTargets(next: Partial<Targets>) {
  targets = { ...targets, ...next };
  targetSubs.forEach((f) => f());
}
export function useTopTargets() {
  return useSyncExternalStore(
    (f) => (targetSubs.add(f), () => void targetSubs.delete(f)),
    () => targets,
    () => targets,
  );
}
/** Used by <TopBar>: claim parts of the bar while mounted. */
export function useTopBarClaim(app: AppId, claim: TopBarClaim) {
  const key = JSON.stringify(claim);
  useEffect(() => bars.add(app, JSON.parse(key) as TopBarClaim), [app, key]);
}
/** Used by <LargeTitle>: while mounted the bar's title is tucked away until the big one scrolls under the bar. */
export function useLargeTitleClaim(app: AppId, tucked: () => boolean, sub: (f: () => void) => () => void) {
  const ref = useRef({ tucked, sub });
  ref.current = { tucked, sub };
  useEffect(() => larges.add(app, { tucked: () => ref.current.tucked(), sub: (f) => ref.current.sub(f) }), [app]);
}
/** The shell: is the bar's title tucked away right now (a large title on screen)? */
export function useTitleTucked(app: AppId | 'settings') {
  useSlot(larges);
  const lt = app === 'settings' ? null : larges.latest(app);
  const [, bump] = useState(0);
  useEffect(() => (lt ? lt.sub(() => bump((n) => n + 1)) : undefined), [lt]);
  return lt ? { large: true, tucked: lt.tucked() } : { large: false, tucked: false };
}

/* ---------- read by the shell ---------- */

function useSlot<T>(s: ReturnType<typeof slot<T>>) {
  useSyncExternalStore(s.subscribe, s.version, s.version);
  return s;
}

/** What the app on screen asked the shell for. */
export function useChrome(app: AppId | 'settings') {
  const c = useSlot(creates);
  const t = useSlot(titles);
  const s = useSlot(settings);
  const f = useSlot(focused);
  const b = useSlot(bars);
  const isApp = app !== 'settings';
  const top = f.latest('*');
  return {
    create: isApp ? c.latest(app) : null,
    title: isApp ? t.latest(app) : null,
    settings: isApp ? s.all(app) : [],
    focused: !!top,
    back: top?.back,
    bar: isApp ? b.latest(app) : null,
  };
}
