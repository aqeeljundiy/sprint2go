import { useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { User } from '../../types';
import { Avatar } from '../Avatar';
import { Popover } from './Popover';
import { PeopleList, type ExtraOption } from './PeopleList';
import { t, tn } from '../../i18n';

/** Pick one or more people. Shows stacked avatars; opens a searchable list with checkmarks. */
export function PeoplePicker({
  value,
  users,
  me,
  onChange,
  label,
  compact,
  emptyText = t('Nobody yet'),
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
  const chosen = value.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];
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
        {!compact && chosen.length > 0 && <span className="sel-text">{chosen.length === 1 ? (chosen[0].id === me ? t('You') : chosen[0].name) : tn(chosen.length, '{n} person', '{n} people')}</span>}
        {!compact && <Plus size={13} className="sel-chev" />}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={300} title={label}>
        <PeopleList users={users} me={me} selected={value} onPick={toggle} />
      </Popover>
    </>
  );
}

/**
 * Pick one person, like a <select> but searchable by name, email, title or team, with recent people first.
 * `extra` adds choices above the people (e.g. "Nobody", "The row’s owner").
 */
export function PersonSelect({
  value,
  users,
  me,
  onChange,
  label,
  placeholder = t('Choose someone…'),
  extra,
  className = '',
  width = 300,
}: {
  value: string | null | undefined;
  users: User[];
  me?: string;
  onChange: (id: string) => void;
  label: string;
  placeholder?: string;
  extra?: ExtraOption[];
  className?: string;
  width?: number;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const u = users.find((x) => x.id === value);
  const ex = !u ? extra?.find((o) => o.value === value) : undefined;
  return (
    <>
      <button ref={btn} type="button" className={`sel person-sel ${open ? 'open' : ''} ${u || ex ? '' : 'empty'} ${className}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        {u ? <Avatar person={u} size={20} /> : ex?.icon}
        <span className="sel-text">{u ? (u.id === me ? t('{name} (me)', { name: u.name }) : u.name) : ex?.label ?? placeholder}</span>
        <ChevronDown size={14} className="sel-chev" />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={width} title={label}>
        <PeopleList
          users={users}
          me={me}
          selected={value ? [value] : []}
          extra={extra}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
            btn.current?.focus();
          }}
        />
      </Popover>
    </>
  );
}
