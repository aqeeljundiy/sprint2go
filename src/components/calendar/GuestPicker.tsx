import { useMemo, useRef, useState } from 'react';
import { Mail, UserPlus, X } from 'lucide-react';
import type { Person, User } from '../../types';
import { Avatar } from '../Avatar';
import { Popover } from '../ui/Popover';
import { PeopleList } from '../ui/PeopleList';
import { t } from '../../i18n';

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const key = (email: string) => email.trim().toLowerCase();

/**
 * Guests of an event: teammates, the project's guests and people met before, picked from our people list (search by
 * name, email, title or team), or anyone by typing their email. Chosen guests show as chips with a remove button.
 */
export function GuestPicker({
  value,
  onChange,
  team,
  contacts = [],
  me,
  label = t('Guests'),
}: {
  value: Person[];
  onChange: (p: Person[]) => void;
  team: User[]; // teammates
  contacts?: Person[]; // the projects' guests and earlier guests
  me: string; // the organiser: not a guest of their own event
  label?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Everyone as one list for the picker: teammates first, then contacts, by email.
  const people = useMemo(() => {
    const seen = new Set<string>();
    const out: User[] = [];
    for (const u of team) {
      if (u.id === me || seen.has(key(u.email))) continue;
      seen.add(key(u.email));
      out.push({ ...u, id: key(u.email) });
    }
    for (const c of [...contacts, ...value]) {
      if (!c.email || seen.has(key(c.email))) continue;
      seen.add(key(c.email));
      out.push({ id: key(c.email), name: c.name || c.email.split('@')[0], email: c.email, title: '', color: '#8b8f98' });
    }
    return out;
  }, [team, contacts, value, me]);
  const chosen = value.map((p) => key(p.email));
  const toggle = (id: string) => {
    if (id.startsWith('new:')) {
      const email = id.slice(4);
      if (!chosen.includes(key(email))) onChange([...value, { name: email.split('@')[0], email }]);
      return;
    }
    if (chosen.includes(id)) return onChange(value.filter((p) => key(p.email) !== id));
    const u = people.find((x) => x.id === id);
    if (u) onChange([...value, { name: u.name, email: u.email }]);
  };
  return (
    <div className="guest-field">
      {value.map((p) => (
        <span key={p.email} className="guest-chip" title={p.email}>
          <Avatar person={people.find((u) => u.id === key(p.email)) ?? p} size={20} />
          <span className="guest-chip-name">{p.name}</span>
          <button type="button" onClick={() => onChange(value.filter((x) => x !== p))} aria-label={t('Remove {name}', { name: p.name })}>
            <X size={13} />
          </button>
        </span>
      ))}
      <button ref={btn} type="button" className={`guest-add${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog">
        <UserPlus size={15} />
        {value.length ? t('Add') : t('Add guests')}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={320} title={label}>
        <PeopleList
          users={people}
          selected={chosen}
          onPick={toggle}
          placeholder={t('Name, team or any email')}
          typed={(q) => (isEmail(q) && !people.some((u) => u.id === key(q)) ? { value: `new:${q}`, label: t('Add {email}', { email: q }), hint: t('Someone who isn’t in the list yet'), icon: <Mail size={16} /> } : null)}
        />
      </Popover>
    </div>
  );
}
