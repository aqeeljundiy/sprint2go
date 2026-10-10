import type { Person } from '../types';
import { avatarColor, initials } from '../utils';
import { photoOf } from '../photos';
import { isPhone } from '../mobile/media';

/** Phones keep to four picture sizes (docs/mobile-kit.md): 24 inline, 32 one-line rows, 40 two- and three-line rows, 56 headers. */
export const phoneAvatar = (size: number) => (size <= 26 ? 24 : size <= 35 ? 32 : size <= 47 ? 40 : 56);

export function Avatar({ person, size: asked = 36 }: { person: Person & { color?: string; photo?: string }; size?: number }) {
  const size = isPhone() ? phoneAvatar(asked) : asked;
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
