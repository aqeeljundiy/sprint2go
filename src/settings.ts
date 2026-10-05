import { useEffect, useState } from 'react';

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
  notifyNewMail: boolean;
  notifyEvents: boolean;
  notifySound: boolean;
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
  notifyNewMail: true,
  notifyEvents: true,
  notifySound: false,
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

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {}
  }, [key, settings]);

  // Apply theme, accent and density to the page.
  useEffect(() => {
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : settings.theme;
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
  }, [key, value]);
  return [value, setValue] as const;
}
