import { useMemo, useState, type ReactNode } from 'react';
import { Hash, Lock, Plus, Search as SearchIcon } from 'lucide-react';
import type { Channel, ChatMessage, User } from '../../types';
import { Sheet } from '../ui/Sheet';
import { Avatar } from '../Avatar';
import { PersonCell } from '../ui/Person';
import { DatePicker } from '../ui/DatePicker';
import { TimePicker } from '../ui/DatePicker';
import { localDay } from '../../utils';
import { whenText } from './chatPrefs';
import { dmOther } from './chatPrefs';

/* Small sheets chat uses in several places: emoji, a time (Send later, Remind me), forwarding, who reacted, asking first. */

export const EMOJI: { group: string; list: string[] }[] = [
  { group: 'Often', list: ['👍', '❤️', '😂', '🙌', '👀', '✅', '🔥', '🙏'] },
  { group: 'Faces', list: ['😀', '😄', '😅', '🤣', '😊', '😍', '🥳', '😎', '🤔', '😮', '😢', '😭', '😤', '😴', '🤯', '🫡', '🙃', '😬', '🤗', '🥲'] },
  { group: 'Hands', list: ['👏', '👋', '🤝', '💪', '👌', '✌️', '🤞', '👇', '👉', '🫶', '🙋', '🤷'] },
  { group: 'Things', list: ['🎉', '🚀', '💡', '📌', '📎', '📅', '⏰', '☕', '🍕', '💰', '📈', '🎯', '⭐', '💯', '⚠️', '❌', '➕', '❓'] },
];
export const QUICK = ['👍', '❤️', '😂', '🙌', '👀', '✅'];

/** The emoji to pick from, in a sheet (phones) or a centred panel (wider screens). */
export function EmojiSheet({ title = 'Emoji', onPick, onClose }: { title?: string; onPick: (e: string) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} className="emoji-sheet">
      <EmojiGrid onPick={(e) => (onClose(), onPick(e))} />
    </Sheet>
  );
}
export function EmojiGrid({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="emoji-grid">
      {EMOJI.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <div>
            {g.list.map((e) => (
              <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The reactions on top of a message's actions: the six used most, and more. */
export function ReactionRow({ mine, onReact, onMore }: { mine: string[]; onReact: (e: string) => void; onMore: () => void }) {
  return (
    <div className="react-row" role="group" aria-label="React">
      {QUICK.map((e) => (
        <button key={e} type="button" className={mine.includes(e) ? 'on' : ''} onClick={() => onReact(e)} aria-label={`React ${e}`} aria-pressed={mine.includes(e)}>
          {e}
        </button>
      ))}
      <button type="button" className="react-more" onClick={onMore} aria-label="More reactions">
        <Plus size={18} />
      </button>
    </div>
  );
}

const at = (days: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
/** Times worth offering: soon, later today, tomorrow morning, Monday morning. */
export function timeChoices(kind: 'send' | 'remind'): { label: string; at: string }[] {
  const now = new Date();
  const out: { label: string; at: string }[] = [];
  if (kind === 'remind') out.push({ label: 'In 20 minutes', at: new Date(Date.now() + 20 * 60_000).toISOString() });
  out.push({ label: 'In 1 hour', at: new Date(Date.now() + 3600_000).toISOString() });
  if (kind === 'remind') out.push({ label: 'In 3 hours', at: new Date(Date.now() + 3 * 3600_000).toISOString() });
  if (now.getHours() < 16) out.push({ label: 'This afternoon', at: at(0, 16) });
  out.push({ label: 'Tomorrow morning', at: at(1, 9) });
  const toMonday = (8 - now.getDay()) % 7 || 7;
  if (toMonday > 1) out.push({ label: 'Monday morning', at: at(toMonday, 9) });
  return out;
}

/** Pick a time: a few choices, or a day and time of your own. For Send later and Remind me. */
export function WhenSheet({ title, kind, note, onPick, onClose, footer }: { title: string; kind: 'send' | 'remind'; note?: ReactNode; onPick: (iso: string) => void; onClose: () => void; footer?: ReactNode }) {
  const [own, setOwn] = useState(false);
  const [day, setDay] = useState(localDay());
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  });
  const picked = new Date(`${day}T${time}:00`);
  const past = picked.getTime() <= Date.now();
  return (
    <Sheet
      title={title}
      onClose={onClose}
      className="when-sheet"
      footer={
        own ? (
          <>
            <button type="button" className="ghost-btn" onClick={() => setOwn(false)}>
              Back
            </button>
            <button type="button" className="primary-btn" disabled={past} onClick={() => (onClose(), onPick(picked.toISOString()))}>
              {past ? 'Pick a later time' : kind === 'send' ? `Send ${whenText(picked.toISOString())}` : `Remind me ${whenText(picked.toISOString())}`}
            </button>
          </>
        ) : (
          footer
        )
      }
    >
      {note}
      {own ? (
        <div className="when-own">
          <DatePicker value={day} onChange={(v) => v && setDay(v)} label="Day" clearable={false} />
          <TimePicker value={time} onChange={setTime} label="Time" />
        </div>
      ) : (
        <div className="as-list">
          {timeChoices(kind).map((c) => (
            <button key={c.label} type="button" className="as-item" onClick={() => (onClose(), onPick(c.at))}>
              <span className="as-label">
                {c.label}
                <small>{whenText(c.at).replace(/^./, (x) => x.toUpperCase())}</small>
              </span>
            </button>
          ))}
          <button type="button" className="as-item" onClick={() => setOwn(true)}>
            <span className="as-label">
              Pick a day and time
              <small>Any time in the next four months</small>
            </span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** Forward a message: to a channel or a person, with a line of your own. */
export function ForwardSheet({ m, channels, users, me, onForward, onClose }: { m: ChatMessage; channels: Channel[]; users: User[]; me: string; onForward: (to: { channelId?: string; userId?: string }, note: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [to, setTo] = useState<{ channelId?: string; userId?: string; label: string } | null>(null);
  const [note, setNote] = useState('');
  const s = q.trim().toLowerCase();
  const rooms = channels.filter((c) => c.kind === 'channel' && c.members.includes(me) && !c.archived && (!s || c.name.toLowerCase().includes(s)));
  const people = users.filter((u) => u.id !== me && (!s || `${u.name} ${u.email}`.toLowerCase().includes(s)));
  const on = (x: { channelId?: string; userId?: string }) => !!to && to.channelId === x.channelId && to.userId === x.userId;
  return (
    <Sheet
      title="Forward"
      size="tall"
      onClose={onClose}
      footer={
        <>
          <input className="fwd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a line (optional)" aria-label="Add a line" />
          <button type="button" className="primary-btn" disabled={!to} onClick={() => to && (onClose(), onForward(to, note.trim()))}>
            {to ? `Send to ${to.label}` : 'Pick where'}
          </button>
        </>
      }
    >
      <blockquote className="fwd-preview">{m.text || 'A file'}</blockquote>
      <label className="sheet-search">
        <SearchIcon size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A channel or a person" aria-label="Where to forward" />
      </label>
      <div className="as-list" role="listbox" aria-label="Where to forward">
        {rooms.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={on({ channelId: c.id })} className={`as-item${on({ channelId: c.id }) ? ' picked' : ''}`} onClick={() => setTo({ channelId: c.id, label: `#${c.name}` })}>
            {c.private ? <Lock size={18} className="as-icon" /> : <Hash size={18} className="as-icon" />}
            <span className="as-label">{c.name}</span>
          </button>
        ))}
        {people.map((u) => (
          <button key={u.id} type="button" role="option" aria-selected={on({ userId: u.id })} className={`as-item${on({ userId: u.id }) ? ' picked' : ''}`} onClick={() => setTo({ userId: u.id, label: u.name.split(' ')[0] })}>
            <Avatar person={u} size={28} />
            <span className="as-label">
              {u.name}
              {u.title && <small>{u.title}</small>}
            </span>
          </button>
        ))}
        {!rooms.length && !people.length && <p className="sheet-empty">Nothing called “{q}”</p>}
      </div>
    </Sheet>
  );
}

/** Who reacted to a message, emoji by emoji. */
export function WhoReactedSheet({ m, first, users, me, channel, onClose }: { m: ChatMessage; first: string; users: User[]; me: string; channel: Channel; onClose: () => void }) {
  const groups = useMemo(() => {
    const all = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length);
    return [...all.filter(([e]) => e === first), ...all.filter(([e]) => e !== first)];
  }, [m.reactions, first]);
  return (
    <Sheet title="Reactions" onClose={onClose}>
      {groups.map(([emoji, who]) => (
        <section key={emoji} className="who-reacted">
          <h3>
            <span className="who-emoji">{emoji}</span> {who.length}
          </h3>
          {who.map((id) => {
            const u = users.find((x) => x.id === id);
            const g = !u ? channel.guests?.find((x) => x.email === id) : undefined;
            return <div key={id} className="pl-row">{u ? <PersonCell person={u} size={28} sub={id === me ? 'You' : u.title} /> : <PersonCell person={{ name: g?.name ?? 'Someone', email: g?.email ?? '' }} size={28} />}</div>;
          })}
        </section>
      ))}
    </Sheet>
  );
}

/** Ask before something that can't be taken back. */
export function ConfirmSheet({ title, text, yes, onYes, onClose }: { title: string; text: string; yes: string; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      className="confirm-sheet"
      footer={
        <>
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn danger" onClick={() => (onClose(), onYes())}>
            {yes}
          </button>
        </>
      }
    >
      <p className="confirm-text">{text}</p>
    </Sheet>
  );
}

/** A list to pick one thing from, with search: tasks, notes, table rows, Drive files. */
export function PickSheet<T extends { id: string }>({ title, items, label, hint, icon, empty, onPick, onClose, top }: { title: string; items: T[]; label: (t: T) => string; hint?: (t: T) => string | undefined; icon?: (t: T) => ReactNode; empty: string; onPick: (t: T) => void; onClose: () => void; top?: ReactNode }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const shown = items.filter((t) => !s || `${label(t)} ${hint?.(t) ?? ''}`.toLowerCase().includes(s)).slice(0, 80);
  return (
    <Sheet title={title} size="tall" onClose={onClose}>
      {items.length > 6 && (
        <label className="sheet-search">
          <SearchIcon size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} />
        </label>
      )}
      <div className="as-list">
        {!s && top}
        {shown.map((t) => (
          <button key={t.id} type="button" className="as-item" onClick={() => (onClose(), onPick(t))}>
            {icon?.(t)}
            <span className="as-label">
              {label(t)}
              {hint?.(t) && <small>{hint(t)}</small>}
            </span>
          </button>
        ))}
        {!shown.length && <p className="sheet-empty">{s ? `Nothing called “${q}”` : empty}</p>}
      </div>
    </Sheet>
  );
}

/** A conversation's name as people say it: #name, or the other person's name. */
export function chanName(c: Channel, users: User[], me: string) {
  if (c.kind === 'dm') return users.find((u) => u.id === dmOther(c, me))?.name ?? 'Direct message';
  return c.category === 'shared' ? c.name : `#${c.name}`;
}
