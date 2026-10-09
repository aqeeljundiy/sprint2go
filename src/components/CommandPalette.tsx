import { useEffect, useMemo, useRef, useState } from 'react';
import { term } from '../terms';
import { Brain, Building2, CalendarPlus, Check, FileText, Hash, ListChecks, Mail, PenLine, Search, User, type LucideIcon } from 'lucide-react';
import { lsKey } from '../settings';
import { APPS } from './AppRail';
import type { AppId } from '../types';
import { mark, t } from '../i18n';

export interface PaletteItem {
  id: string;
  /** Which list it's in, in English ('Tasks', 'Needs you'…): code compares it, and it's shown with t(). */
  group: string;
  title: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
  keywords?: string; // what's inside it (an email's text, a note, a transcript, a row's cells): searched, shown as a snippet when it's the match
  app?: AppId; // the app it belongs to (else worked out from its group): search scoped to an app shows only these
}

/** Which app each kind of result belongs to, for searching inside one app and for grouping results by app. */
const GROUP_APP: Record<string, AppId> = { Tasks: 'tasks', Emails: 'mail', Channels: 'chat', Messages: 'chat', Notes: 'notes', Meetings: 'meet', Rows: 'tables', Files: 'drive' };
// The groups' words, for the language check (they're shown with t(group)).
mark('Needs you'), mark('Actions'), mark('Go to'), mark('Recent'), mark('Apps'), mark('People'), mark('Emails'), mark('Channels'), mark('Messages'), mark('Meetings'), mark('Rows'), mark('Files');
export const appOf = (i: PaletteItem): AppId | undefined => i.app ?? (i.group === term.Many ? 'projects' : GROUP_APP[i.group]);
const appName = (id: AppId) => APPS.find((a) => a.id === id)?.name ?? id;
/** Apps that have something to search in them (the others open search across all apps). */
export const SEARCHABLE: AppId[] = ['mail', 'chat', 'tasks', 'projects', 'notes', 'meet', 'tables', 'drive'];

interface Props {
  items: PaletteItem[];
  onClose: () => void;
  /** Things to do with whatever was typed (e.g. "Create task", "Ask AI"). */
  queryActions?: (q: string) => PaletteItem[];
  /** Where to remember recent places (per person). */
  recentKey?: string;
  /** Open inside one app ("Search Mail"), with an "All apps" chip one tap away. */
  scope?: AppId | null;
}

// Recent places: saved right away (the palette closes as soon as you pick something).
const recentMem = new Map<string, string[]>();
function loadRecent(key: string): string[] {
  if (recentMem.has(key)) return recentMem.get(key)!;
  try {
    return JSON.parse(localStorage.getItem(lsKey(key)) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function saveRecent(key: string, ids: string[]) {
  recentMem.set(key, ids);
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(ids));
  } catch {}
}

export const PALETTE_ICONS = { Brain, Building2, CalendarPlus, FileText, Hash, ListChecks, Mail, PenLine, User };

/** ⌘K: jump to anything (clients, tasks, emails, channels, people, files) or run an action. */
export function CommandPalette({ items: all, onClose, queryActions, recentKey = 's2g-palette-recent', scope: startScope = null }: Props) {
  const [q, setQ] = useState('');
  const [recent] = useState<string[]>(() => loadRecent(recentKey));
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // In one app, or one kind of thing (People, Projects, Files, Notes), or everywhere.
  const [scope, setScope] = useState<AppId | null>(startScope);
  const [kind, setKind] = useState<string | null>(null);
  const KINDS = ['People', term.Many, 'Files', 'Notes']; // shown with t()
  const items = useMemo(() => all.filter((i) => (!scope || appOf(i) === scope) && (!kind || i.group === kind)), [all, scope, kind]);
  const narrow = (s: AppId | null, k: string | null) => (setScope(s), setKind(k), input.current?.focus());

  const results = useMemo(() => {
    const typed = q.trim().toLowerCase();
    if (!typed) {
      // One kind of thing picked: all of them, recent ones first.
      if (kind) return [...items].sort((a, b) => Number(recent.includes(b.id)) - Number(recent.includes(a.id))).slice(0, 40);
      // Nothing typed: what needs you, where you were recently, and the common actions.
      const needs = scope && scope !== 'tasks' ? [] : items.filter((i) => i.group === 'Needs you').slice(0, 5);
      const recents = recent.map((id) => items.find((i) => i.id === id && i.group !== 'Needs you')).filter((i): i is PaletteItem => !!i).slice(0, 6).map((i) => ({ ...i, group: 'Recent' }));
      // Inside one app with little history yet: its latest things, so there's something to tap before typing.
      const latest = scope && recents.length < 3 ? items.filter((i) => i.group !== 'Actions' && i.group !== 'Needs you' && !recents.some((r) => r.id === i.id)).slice(0, 5 - recents.length).map((i) => ({ ...i, group: t('Latest in {app}', { app: appName(scope) }) })) : [];
      return [...needs, ...recents, ...latest, ...items.filter((i) => i.group === 'Actions')];
    }
    // Every word must match somewhere; titles that start with what you typed come first.
    const words = typed.split(/\s+/).filter(Boolean);
    const scored = items
      .filter((i) => i.group !== 'Needs you')
      .map((i) => {
        const title = i.title.toLowerCase().replace(/^#/, '');
        const hay = `${title} ${(i.sub ?? '').toLowerCase()} ${i.group.toLowerCase()} ${t(i.group).toLowerCase()}`;
        const deep = (i.keywords ?? '').toLowerCase();
        const onTop = words.every((w) => hay.includes(w));
        if (!onTop && !words.every((w) => hay.includes(w) || deep.includes(w))) return null;
        let score = (title.startsWith(typed) ? 100 : 0) + (title.split(/[\s:·-]+/).some((x) => x.startsWith(words[0])) ? 40 : 0) + (title.includes(typed) ? 20 : 0) + (recent.includes(i.id) ? 15 : 0) - Math.min(title.length, 60) / 10;
        if (onTop) return { i, score };
        // Found inside: show where, and rank under things that match by name.
        const at = Math.max(0, deep.indexOf(words.find((w) => deep.includes(w))!));
        const start = Math.max(0, at - 36);
        const snippet = (start > 0 ? '…' : '') + (i.keywords ?? '').slice(start, at + 64).replace(/\s+/g, ' ').trim() + '…';
        score -= 30;
        return { i: { ...i, sub: snippet }, score };
      })
      .filter((x): x is { i: PaletteItem; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);
    // Group by app (People, Actions and apps themselves on their own), best match first, so the top result is the
    // one Enter opens.
    const head = (i: PaletteItem) => {
      const a = appOf(i);
      return a && i.group !== 'Actions' ? appName(a) : i.group === 'Go to' ? 'Apps' : i.group;
    };
    const order: string[] = [];
    for (const r of scored) if (!order.includes(head(r))) order.push(head(r));
    const grouped = order.flatMap((g) => scored.filter((r) => head(r) === g).slice(0, scope ? 12 : 6).map((r) => ({ ...r, group: g })));
    return [...grouped.slice(0, 40), ...(queryActions?.(q.trim()) ?? [])];
  }, [q, items, recent, queryActions, scope, kind]);

  useEffect(() => {
    setHi(0);
  }, [q]);
  useEffect(() => {
    list.current?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const run = (i: PaletteItem) => {
    if (!i.id.startsWith('q-') && i.group !== 'Actions') saveRecent(recentKey, [i.id.replace(/^n-/, 't-'), ...recent.filter((x) => x !== i.id)].slice(0, 12));
    onClose();
    i.run();
  };

  let lastGroup = '';
  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('Search')}>
        <label className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            ref={input}
            placeholder={scope ? t('Search {app}', { app: appName(scope) }) : kind ? t('Search {kind}', { kind: t(kind).toLowerCase() }) : t('Search or jump to an app, {project} or person', { project: term.one })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter' && results[hi]) {
                run(results[hi]);
              } else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>esc</kbd>
          <button type="button" className="palette-close" onClick={onClose}>
            {t('Cancel')}
          </button>
        </label>
        <div className="palette-chips" role="toolbar" aria-label={t('Search in')}>
          {startScope && (
            <button type="button" className={scope === startScope && !kind ? 'on' : ''} aria-pressed={scope === startScope && !kind} onClick={() => narrow(startScope, null)}>
              {scope === startScope && !kind && <Check size={13} />}
              {appName(startScope)}
            </button>
          )}
          <button type="button" className={!scope && !kind ? 'on' : ''} aria-pressed={!scope && !kind} onClick={() => narrow(null, null)}>
            {!scope && !kind && <Check size={13} />}
            {t('All apps')}
          </button>
          {KINDS.map((k) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => narrow(null, kind === k ? null : k)}>
              {kind === k && <Check size={13} />}
              {t(k)}
            </button>
          ))}
        </div>
        <ul ref={list}>
          {results.length === 0 &&
            (scope && q.trim() ? (
              <li className="palette-empty">
                {t('Nothing in {app} matches “{q}”.', { app: appName(scope), q })}{' '}
                <button type="button" className="link-btn" onClick={() => narrow(null, null)}>
                  {t('Search all apps')}
                </button>
              </li>
            ) : q.trim() ? (
              <li className="palette-empty">{t('Nothing matches “{q}”. Try a {who}, a person or a few words from a task.', { q, who: term.who })}</li>
            ) : (
              <li className="palette-empty">{scope ? t('Type to search {app}.', { app: appName(scope) }) : t('Type to search.')}</li>
            ))}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return (
              <li key={r.id}>
                {head && <div className="palette-group">{t(head)}</div>}
                <button className={idx === hi ? 'hi' : ''} onMouseEnter={() => setHi(idx)} onClick={() => run(r)}>
                  <r.icon size={16} />
                  <span className="pi-title">{r.title}</span>
                  {r.sub && <span className="pi-sub">{r.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
