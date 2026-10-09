import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppId } from '../types';
import type { Option } from '../components/ui/Select';
import type { SheetAction } from '../components/ui/ActionSheet';

/**
 * How an app talks to the phone shell (the top bar, the bottom bar and its create button). Each app calls these hooks
 * from its own component; the shell shows what the app on screen registered. Nothing here renders anything.
 *
 *   useCreateAction('mail', { label: 'Compose', icon: PenLine, run: compose })   the round button by the tab bar
 *   useTitleMenu('tasks', { label, value, options, onChange })                   the screen title as a switcher
 *   useAppSettings('tasks', { id, label, hint, render })                         a row at the bottom of that switcher
 *   useFocusedScreen(open, back?)                                                 the tab bar steps aside
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

/** The app's main action: the round button docked at the end of the tab bar on phones. Pass null when there's none. */
export function useCreateAction(app: AppId, action: CreateAction | null | false | undefined) {
  const ref = useRef(action || null);
  ref.current = action || null;
  const on = !!action;
  const label = action ? action.label : '';
  const icon = action ? action.icon : null;
  const moreKey = action && action.more ? action.more.map((m) => `${m.label}:${m.disabled ? 0 : 1}`).join('|') : '';
  useEffect(() => {
    if (!on || !icon) return;
    const more = ref.current?.more?.map((m, i) => ({ ...m, run: () => ref.current?.more?.[i]?.run() }));
    return creates.add(app, { label, icon, run: () => ref.current?.run(), more });
  }, [app, on, label, icon, moreKey]);
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
  const isApp = app !== 'settings';
  const top = f.latest('*');
  return {
    create: isApp ? c.latest(app) : null,
    title: isApp ? t.latest(app) : null,
    settings: isApp ? s.all(app) : [],
    focused: !!top,
    back: top?.back,
  };
}
