import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Building2, CalendarPlus, FileText, Hash, ListChecks, Mail, PenLine, Search, User, type LucideIcon } from 'lucide-react';

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
}

interface Props {
  items: PaletteItem[];
  onClose: () => void;
}

export const PALETTE_ICONS = { Brain, Building2, CalendarPlus, FileText, Hash, ListChecks, Mail, PenLine, User };

/** ⌘K: jump to anything (clients, tasks, emails, channels, people, files) or run an action. */
export function CommandPalette({ items, onClose }: Props) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pool = t
      ? items.filter((i) => (i.title + ' ' + (i.sub ?? '') + ' ' + i.group).toLowerCase().includes(t))
      : items.filter((i) => i.group === 'Actions' || i.group === 'Go to');
    return pool.slice(0, 40);
  }, [q, items]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const run = (i: PaletteItem) => {
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
            placeholder="Search clients, tasks, emails, people, channels, files…"
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
          {results.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
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
