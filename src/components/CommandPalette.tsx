import { useEffect, useMemo, useRef, useState } from 'react';
import { term } from '../terms';
import { Brain, Building2, CalendarPlus, FileText, Hash, ListChecks, Mail, PenLine, Search, User, type LucideIcon } from 'lucide-react';
import { lsKey } from '../settings';

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
  keywords?: string; // what's inside it (an email's text, a note, a transcript, a row's cells): searched, shown as a snippet when it's the match
}

interface Props {
  items: PaletteItem[];
  onClose: () => void;
  /** Things to do with whatever was typed (e.g. "Create task", "Ask AI"). */
  queryActions?: (q: string) => PaletteItem[];
  /** Where to remember recent places (per person). */
  recentKey?: string;
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
export function CommandPalette({ items, onClose, queryActions, recentKey = 's2g-palette-recent' }: Props) {
  const [q, setQ] = useState('');
  const [recent] = useState<string[]>(() => loadRecent(recentKey));
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) {
      // Nothing typed: what needs you, where you were recently, and the common actions.
      const needs = items.filter((i) => i.group === 'Needs you').slice(0, 5);
      const recents = recent.map((id) => items.find((i) => i.id === id && i.group !== 'Needs you')).filter((i): i is PaletteItem => !!i).slice(0, 6).map((i) => ({ ...i, group: 'Recent' }));
      return [...needs, ...recents, ...items.filter((i) => i.group === 'Actions')];
    }
    // Every word must match somewhere; titles that start with what you typed come first.
    const words = t.split(/\s+/).filter(Boolean);
    const scored = items
      .filter((i) => i.group !== 'Needs you')
      .map((i) => {
        const title = i.title.toLowerCase().replace(/^#/, '');
        const hay = `${title} ${(i.sub ?? '').toLowerCase()} ${i.group.toLowerCase()}`;
        const deep = (i.keywords ?? '').toLowerCase();
        const onTop = words.every((w) => hay.includes(w));
        if (!onTop && !words.every((w) => hay.includes(w) || deep.includes(w))) return null;
        let score = (title.startsWith(t) ? 100 : 0) + (title.split(/[\s:·-]+/).some((x) => x.startsWith(words[0])) ? 40 : 0) + (title.includes(t) ? 20 : 0) + (recent.includes(i.id) ? 15 : 0) - Math.min(title.length, 60) / 10;
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
    // Group by kind, best match first, so the top result is the one Enter opens.
    const order: string[] = [];
    for (const r of scored) if (!order.includes(r.group)) order.push(r.group);
    const grouped = order.flatMap((g) => scored.filter((r) => r.group === g).slice(0, 6));
    return [...grouped.slice(0, 40), ...(queryActions?.(q.trim()) ?? [])];
  }, [q, items, recent, queryActions]);

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
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <label className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Jump to a ${term.one}, task, person, channel, email or file…`}
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
        </label>
        <ul ref={list}>
          {results.length === 0 && <li className="palette-empty">Nothing matches “{q}”. Try a client, a person or a few words from a task.</li>}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return (
              <li key={r.id}>
                {head && <div className="palette-group">{head}</div>}
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
