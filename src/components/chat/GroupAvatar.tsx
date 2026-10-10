import type { Channel, User } from '../../types';
import { avatarColor, initials } from '../../utils';
import { photoOf } from '../../photos';
import { t, tn } from '../../i18n';

type Face = { name: string; email: string; color?: string; photo?: string };

/** The people in a group message besides me: teammates first, then its guests. */
export function groupFaces(c: Channel, users: User[], me: string): Face[] {
  const team = c.members.filter((id) => id !== me).map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u);
  return [...team, ...(c.guests ?? []).map((g) => ({ name: g.name || g.email, email: g.email }))];
}

/**
 * A group message's picture (Slack): two of its people, one over the other's corner. Small (a one-line row) it is a
 * square with how many people are in it, since faces that small can't be told apart.
 */
export function GroupAvatar({ c, users, me, size }: { c: Channel; users: User[]; me: string; size: number }) {
  const faces = groupFaces(c, users, me);
  const label = tn(faces.length + 1, '{n} people', '{n} people');
  if (size <= 24)
    return (
      <span className="group-av is-count" style={{ width: size, height: size }} role="img" aria-label={label}>
        {faces.length + 1}
      </span>
    );
  const one = Math.round(size * 0.64);
  const face = (f: Face | undefined, cls: string) => {
    const photo = f ? (f.photo ?? photoOf(f.email)) : undefined;
    return (
      <span className={`avatar ${cls}${photo ? ' has-photo' : ''}`} style={{ width: one, height: one, background: photo ? undefined : f ? (f.color ?? avatarColor(f.email)) : 'var(--surface-2)', fontSize: one * 0.4 }} aria-hidden>
        {photo ? <img src={photo} alt="" /> : f ? (cls === 'ga-back' ? initials(f.name).slice(0, 1) : initials(f.name)) : `+${faces.length - 1}`}
      </span>
    );
  };
  return (
    <span className="group-av" style={{ width: size, height: size }} role="img" aria-label={faces.length ? label : t('Group message')}>
      {face(faces[1] ?? faces[0], 'ga-back')}
      {face(faces[0], 'ga-front')}
    </span>
  );
}
