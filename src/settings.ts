import { useEffect, useState } from 'react';
import { setStored, store, useStored } from './store';
import { server } from './sync';

export type ThemePref = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

export interface Settings {
  name: string;
  title: string;
  avatarColor: string;
  signature: string; // HTML
  theme: ThemePref;
  accent: string;
  density: Density;
  undoSend: number; // seconds
  // What alerts this person's phones and computers when they're away (the server reads these: server/notifyPush.ts).
  notifyMessages: boolean; // direct messages, mentions, replies
  notifyNewMail: boolean; // mail to them (not newsletters or spam)
  notifyTasks: boolean; // given to them, due, comments, reviews
  notifyGuests: boolean; // guests' messages, comments and approvals
  notifyEvents: boolean; // calendar reminders (10 minutes ahead) and meeting notes
  notifyOther: boolean; // finished work, teams and the rest
  // One email about what's waiting, when they haven't used the app for a while (the server sends it: server/digest.ts).
  emailDigest: 'off' | 'hourly' | 'daily';
  timeZone?: string; // where they are (from their browser), for "daily at 9:00"
  showSnippets: boolean;
  trackByDefault: boolean;
  notifyOpens: boolean;
  blockTrackers: boolean;
}

export const ACCENTS = ['#5b5bf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#d946ef', '#111827'];

export const DEFAULT_SETTINGS: Settings = {
  name: 'Aqeel',
  title: 'COO · Pixel & Profits',
  avatarColor: '#5b5bf6',
  signature: '<p><b>Aqeel</b><br>COO · Pixel &amp; Profits</p>',
  theme: 'system',
  accent: '#5b5bf6',
  density: 'comfortable',
  undoSend: 5,
  notifyMessages: true,
  notifyNewMail: true,
  notifyTasks: true,
  notifyGuests: true,
  notifyEvents: true,
  notifyOther: false,
  emailDigest: 'daily',
  showSnippets: true,
  trackByDefault: true,
  notifyOpens: true,
  blockTrackers: true,
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function load(key: string, defaults: Settings, legacyKey?: string): Settings {
  try {
    const raw = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

/**
 * Each user has their own settings. Kept in the browser for now;
 * they move to the user's account on the server later.
 */
export function useSettings(user: { id: string; name: string; title: string; color: string }) {
  const key = `pm-settings:${user.id}`;
  const [settings, setSettings] = useState<Settings>(() =>
    load(
      key,
      {
        ...DEFAULT_SETTINGS,
        name: user.name,
        title: user.title,
        avatarColor: user.color,
        signature: `<p><b>${esc(user.name)}</b>${user.title ? `<br>${esc(user.title)}` : ''}</p>`,
      },
      user.id === 'u-aqeel' ? 'pm-settings' : undefined, // keep settings saved before users existed
    ),
  );

  // Their time zone follows the device they last opened (the daily email goes out at 9:00 where they are). Once per
  // visit, after settings from their other devices have arrived, so two devices never keep changing it back and forth.
  useEffect(() => {
    const t = setTimeout(() => {
      let zone: string | undefined;
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      } catch {
        /* no zone: the company's is used */
      }
      if (zone) setSettings((s) => (s.timeZone === zone ? s : { ...s, timeZone: zone }));
    }, 5000);
    return () => clearTimeout(t);
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {}
    shared.set(key, settings);
    pushPref(key, settings);
  }, [key, settings]);
  // Settings saved on another device arrive through the prefs sync.
  useEffect(() => {
    const set = subs.get(key) ?? new Set();
    subs.set(key, set);
    set.add(setSettings as (v: never) => void);
    return () => void set.delete(setSettings as (v: never) => void);
  }, [key]);

  // Apply theme, accent and density to the page.
  useEffect(() => {
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : settings.theme;
      // The phone's status bar and the installed app's title bar match the theme picked here.
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', root.dataset.theme === 'dark' ? '#0e1013' : '#f4f5f7'));
    };
    apply();
    mq.addEventListener('change', apply);
    root.dataset.density = settings.density;
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.density]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}

/** Remembers a UI value (like a panel width) between visits. */
// Every component using the same key sees the same value (e.g. the desktop and phone sidebars).
const shared = new Map<string, unknown>();
const subs = new Map<string, Set<(v: never) => void>>();

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (shared.has(key)) return shared.get(key) as T;
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {}
    return initial;
  });
  useEffect(() => {
    const set = subs.get(key) ?? new Set();
    subs.set(key, set);
    set.add(setValue as (v: never) => void);
    if (shared.has(key) && shared.get(key) !== value) setValue(shared.get(key) as T);
    return () => void set.delete(setValue as (v: never) => void);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shared.get(key) === value) return;
    shared.set(key, value);
    subs.get(key)?.forEach((fn) => fn !== (setValue as unknown) && (fn as (v: T) => void)(value));
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
    pushPref(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

/* ---------- prefs that follow you between devices ---------- */

// What's worth carrying to another device: your settings, saved views, tab orders and Ask AI chats.
// Panel widths, the collapsed sidebar and "which table was open" stay with the device.
const SYNCED = [/^pm-settings:/, /^pm-blocked:/, /^s2g-ask-chats:/, /^s2g-task-views$/, /^s2g-tabs:/, /^s2g-tabbar:/, /^s2g-task-(fields|group|layout)$/, /^s2g-project-(group|card-fields|type)$/, /^s2g-briefs-open$/, /^s2g-home:/, /^s2g-chat-(views|view|starred|collapsed):/, /^s2g-join:/, /^s2g-read:/, /^pm-drive-layout$/, /^s2g-table-view:/];
const isSynced = (k: string) => SYNCED.some((r) => r.test(k));
let prefUser = '';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Saves one key to the person's prefs on the server (when it's one that should follow them). */
function pushPref(key: string, value: unknown) {
  if (!prefUser || !server.on || !isSynced(key)) return;
  const all = store.prefs;
  const mine = all[prefUser] ?? {};
  if (same(mine[key], value)) return;
  setStored('prefs', { ...all, [prefUser]: { ...mine, [key]: value } });
}

/** Keeps this person's prefs in step with the server: what arrives is applied here, what's only here is sent. */
export function usePrefsSync(userId: string) {
  const [prefs] = useStored('prefs');
  useEffect(() => {
    prefUser = userId;
    if (!server.on) return;
    const mine = prefs[userId] ?? {};
    for (const [k, v] of Object.entries(mine)) {
      if (same(shared.get(k), v)) continue;
      shared.set(k, v);
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
      subs.get(k)?.forEach((fn) => (fn as (x: unknown) => void)(v));
    }
    // First time on the server: what this device already had goes up.
    const missing: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!isSynced(k) || k in mine) continue;
      if (/:u-|:[a-z0-9]{8,}/.test(k) && !k.includes(userId) && /^(pm-settings|pm-blocked|s2g-ask-chats|s2g-tabbar|s2g-home|s2g-join|s2g-read|s2g-chat-)/.test(k)) continue; // another person's
      try {
        missing[k] = JSON.parse(localStorage.getItem(k)!);
      } catch {}
    }
    if (Object.keys(missing).length) setStored('prefs', { ...prefs, [userId]: { ...mine, ...missing } });
  }, [prefs, userId]);
}
