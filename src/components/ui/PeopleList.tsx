import { useMemo, useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { Team, User } from '../../types';
import { session, store } from '../../store';

/** Teams in the workspace on screen. */
const wsTeams = () => store.teams.filter((t) => !session.wsId || t.workspaceId === session.wsId);
import { Avatar } from '../Avatar';
import { lsKey } from '../../settings';

const RECENT_KEY = 's2g-recent-people';

/** People this person picked lately, newest first (kept in this browser). */
export function recentPeople(): string[] {
  try {
    return JSON.parse(localStorage.getItem(lsKey(RECENT_KEY)) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function noteRecent(id: string) {
  try {
    localStorage.setItem(lsKey(RECENT_KEY), JSON.stringify([id, ...recentPeople().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* private window: no recents */
  }
}

/** "Video editor · Video, Design": what helps tell two people apart. */
export function personHint(u: User, teams: Team[] = wsTeams()) {
  const theirs = teams.filter((t) => t.members.includes(u.id)).map((t) => t.name);
  return [u.title, theirs.join(', ')].filter(Boolean).join(' · ');
}

/** Matches a name, nickname, email, job title or team name. */
export function matchPerson(u: User, q: string, teams: Team[] = wsTeams()) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [u.name, u.email, u.title, ...(u.nicknames ?? []), ...teams.filter((t) => t.members.includes(u.id)).map((t) => t.name)].join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

/** A person as an option for our Select: found by email, title and team too, with title and team underneath. */
export function personOption(u: User, me?: string) {
  return {
    value: u.id,
    label: u.id === me ? `${u.name} (me)` : u.name,
    hint: personHint(u),
    icon: <Avatar person={u} size={20} />,
    keywords: [u.email, u.title, ...(u.nicknames ?? []), ...wsTeams().filter((t) => t.members.includes(u.id)).map((t) => t.name)].join(' '),
  };
}

export interface ExtraOption {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

/**
 * The list inside every people picker: search by name, email, title or team; the people you picked lately first;
 * arrows and Enter to choose. `selected` shows checkmarks; `onPick` gets a person's id or an extra option's value.
 */
export function PeopleList({
  users,
  me,
  selected,
  onPick,
  extra = [],
  placeholder = 'Search by name, email, title or team',
}: {
  users: User[];
  me?: string;
  selected: string[];
  onPick: (id: string) => void;
  extra?: ExtraOption[]; // e.g. "Nobody" or "The row's owner", listed first
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const teams = wsTeams();
  // Ordered by who was chosen when the list opened, so ticking someone doesn't make the rows jump.
  const [chosenAtOpen] = useState(selected);
  const shown = useMemo(() => {
    const recent = recentPeople();
    const rank = (u: User) => (chosenAtOpen.includes(u.id) ? -2 : u.id === me ? -1 : recent.includes(u.id) ? recent.indexOf(u.id) : 100);
    const people = users.filter((u) => matchPerson(u, q, teams)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const ex = q.trim() ? extra.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : extra;
    return [...ex.map((o) => ({ kind: 'extra' as const, o })), ...people.map((u) => ({ kind: 'person' as const, u }))];
  }, [users, q, chosenAtOpen, me, extra, teams]);
  const pick = (i: number) => {
    const item = shown[i];
    if (!item) return;
    if (item.kind === 'person') noteRecent(item.u.id);
    onPick(item.kind === 'person' ? item.u.id : item.o.value);
  };
  return (
    <div
      className="sel-pop people-list-pop"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, shown.length - 1)));
        else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
        else if (e.key === 'Enter') (e.preventDefault(), pick(hi));
      }}
    >
      <label className="sel-search">
        <Search size={14} />
        <input autoFocus value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} placeholder={placeholder} aria-label="Search people" />
      </label>
      <ul role="listbox" aria-multiselectable={selected.length > 1 || undefined}>
        {shown.length === 0 && <li className="sel-empty">Nobody matches “{q.trim()}”</li>}
        {shown.map((item, i) => {
          const on = item.kind === 'person' ? selected.includes(item.u.id) : selected.includes(item.o.value);
          return (
            <li key={item.kind === 'person' ? item.u.id : 'x:' + item.o.value} role="presentation">
              <button type="button" role="option" aria-selected={on} className={`sel-opt${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(i)}>
                <span className="sel-icon">{item.kind === 'person' ? <Avatar person={item.u} size={22} /> : item.o.icon}</span>
                <span className="sel-label">
                  {item.kind === 'person' ? (item.u.id === me ? `${item.u.name} (me)` : item.u.name) : item.o.label}
                  {(item.kind === 'person' ? personHint(item.u, teams) : item.o.hint) && <small>{item.kind === 'person' ? personHint(item.u, teams) : item.o.hint}</small>}
                </span>
                {on && <Check size={14} className="sel-check" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
