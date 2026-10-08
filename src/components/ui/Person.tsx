import type { ReactNode } from 'react';
import { Avatar } from '../Avatar';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

/**
 * A small label: "You", "Owner", "Lead", "Suspended", "On". One pill everywhere (system.css), on a name's line or in
 * a table cell. The tone is the meaning: accent for roles and you, good / warn / bad for state, neutral for the rest.
 */
export function Badge({ tone = 'neutral', children, title, small }: { tone?: BadgeTone; children: ReactNode; title?: string; small?: boolean }) {
  return (
    <span className={`badge is-${tone}${small ? ' sm' : ''}`} title={title}>
      {children}
    </span>
  );
}

/** Who someone is to show in a cell: a person, or just a name and colour (the operator console has no photos). */
export interface PersonLike {
  name: string;
  email?: string;
  color?: string | null;
  photo?: string;
}

/**
 * Someone in a table or list, the same way everywhere: the avatar centred on the name and the line under it, badges
 * as pills on the name's line, a long name or email ending in "…" instead of pushing the row wider.
 * `sub` replaces the email line (pass null for no second line); `avatar` replaces the picture (a presence dot, a logo).
 */
export function PersonCell({
  person,
  name,
  sub,
  badges,
  size = 32,
  avatar,
  className = '',
}: {
  person: PersonLike;
  name?: ReactNode;
  sub?: ReactNode | null;
  badges?: ReactNode;
  size?: number;
  avatar?: ReactNode;
  className?: string;
}) {
  const second = sub === undefined ? person.email : sub;
  return (
    <span className={`person-cell ${className}`}>
      {avatar ?? <Avatar person={{ name: person.name || person.email || '?', email: person.email ?? person.name, color: person.color ?? undefined, photo: person.photo }} size={size} />}
      <span className="person-text">
        <span className="person-name">
          <span className="person-name-text">{name ?? person.name}</span>
          {badges}
        </span>
        {second ? <small className="person-sub">{second}</small> : null}
      </span>
    </span>
  );
}
