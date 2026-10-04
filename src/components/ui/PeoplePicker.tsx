import { useRef, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { User } from '../../types';
import { Avatar } from '../Avatar';
import { Popover } from './Popover';

/** Pick one or more people. Shows stacked avatars; opens a searchable list with checkmarks. */
export function PeoplePicker({
  value,
  users,
  me,
  onChange,
  label,
  compact,
  emptyText = 'Nobody yet',
  max = 4,
}: {
  value: string[];
  users: User[];
  me: string;
  onChange: (ids: string[]) => void;
  label: string;
  compact?: boolean; // just the avatars, for task rows
  emptyText?: string;
  max?: number; // avatars shown before "+N"
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = value.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];
  const shown = users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`people-btn ${compact ? 'compact' : 'sel'} ${open ? 'open' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={label}
        title={chosen.length ? chosen.map((u) => u.name).join(', ') : label}
      >
        {chosen.length ? (
          <span className="av-stack">
            {chosen.slice(0, max).map((u) => (
              <Avatar key={u.id} person={u} size={compact ? 24 : 22} />
            ))}
            {chosen.length > max && <span className="av-more">+{chosen.length - max}</span>}
          </span>
        ) : compact ? (
          <span className="avatar-empty">?</span>
        ) : (
          <span className="sel-text muted">{emptyText}</span>
        )}
        {!compact && chosen.length > 0 && <span className="sel-text">{chosen.length === 1 ? (chosen[0].id === me ? 'You' : chosen[0].name) : `${chosen.length} people`}</span>}
        {!compact && <Plus size={13} className="sel-chev" />}
      </button>
      <Popover anchor={btn} open={open} onClose={() => (setOpen(false), setQ(''))} width={260} title={label}>
        <div className="sel-pop">
          <label className="sel-search">
            <Search size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
          </label>
          <ul role="listbox" aria-multiselectable="true">
            {shown.map((u) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected={value.includes(u.id)} className="sel-opt" onClick={() => toggle(u.id)}>
                  <span className="sel-icon">
                    <Avatar person={u} size={22} />
                  </span>
                  <span className="sel-label">
                    {u.id === me ? `${u.name} (me)` : u.name}
                    <small>{u.title}</small>
                  </span>
                  {value.includes(u.id) && <Check size={14} className="sel-check" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </>
  );
}
