import type { Person } from '../types';
import { avatarColor, initials } from '../utils';
import { photoOf } from '../photos';

export function Avatar({ person, size = 36 }: { person: Person & { color?: string; photo?: string }; size?: number }) {
  const photo = person.photo ?? photoOf(person.email);
  return (
    <span
      className={`avatar ${photo ? 'has-photo' : ''}`}
      style={{ width: size, height: size, background: photo ? undefined : (person.color ?? avatarColor(person.email)), fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {photo ? <img src={photo} alt="" /> : initials(person.name)}
    </span>
  );
}
