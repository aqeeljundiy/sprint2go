import type { Person } from '../types';
import { avatarColor, initials } from '../utils';

export function Avatar({ person, size = 36 }: { person: Person & { color?: string }; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: person.color ?? avatarColor(person.email), fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}
