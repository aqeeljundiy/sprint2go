import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Person } from '../types';
import { Avatar } from './Avatar';

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

interface Props {
  label: string;
  value: Person[];
  contacts: Person[];
  autoFocus?: boolean;
  onChange: (p: Person[]) => void;
  trailing?: React.ReactNode;
}

export function RecipientInput({ label, value, contacts, autoFocus, onChange, trailing }: Props) {
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((c) => !value.some((v) => v.email === c.email))
      .filter((c) => c.name.toLowerCase().includes(q) || c.email.includes(q))
      // Names or emails that start with what you typed come first.
      .map((c) => ({ c, rank: c.name.toLowerCase().split(' ').some((w) => w.startsWith(q)) || c.email.startsWith(q) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ c }) => c)
      .slice(0, 5);
  }, [text, contacts, value]);

  const add = (p: Person) => {
    if (!value.some((v) => v.email === p.email)) onChange([...value, p]);
    setText('');
    setHi(0);
  };

  const commit = () => {
    const t = text.trim().replace(/[,;]$/, '');
    if (suggestions[hi] && !isEmail(t)) return add(suggestions[hi]);
    if (isEmail(t)) add(contacts.find((c) => c.email === t) ?? { name: t.split('@')[0], email: t });
  };

  return (
    <div className="recip">
      <span className="recip-label">{label}</span>
      <div className="recip-chips">
        {value.map((p) => (
          <span key={p.email} className="recip-chip" title={p.email}>
            <Avatar person={p} size={18} />
            {p.name}
            <button onClick={() => onChange(value.filter((v) => v.email !== p.email))} aria-label={`Remove ${p.name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (['Enter', ',', ';', 'Tab'].includes(e.key) && text.trim()) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault();
              setHi((h) => (h + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault();
              setHi((h) => (h - 1 + suggestions.length) % suggestions.length);
            }
          }}
          onBlur={() => isEmail(text.trim()) && commit()}
          placeholder={value.length ? '' : 'Name or email'}
        />
      </div>
      {trailing}
      {suggestions.length > 0 && (
        <div className="recip-suggest">
          {suggestions.map((c, i) => (
            <button
              key={c.email}
              className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                add(c);
              }}
            >
              <Avatar person={c} size={26} />
              <span>
                <strong>{c.name}</strong>
                <small>{c.email}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
