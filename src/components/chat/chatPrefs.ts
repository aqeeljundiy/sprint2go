import { useEffect, useRef } from 'react';
import { usePersisted } from '../../settings';
import type { Channel, ChatMessage, Status } from '../../types';
import { mark, t } from '../../i18n';
import { fmtDate, fmtDay, fmtTime, fmtWeekday } from '../../i18n/format';

/*
 * Each person's own chat state. It lives in their settings (prefs), so it follows them to every device, and the
 * server reads two parts of it: reminders on saved messages and muted conversations (server/chatLater.ts).
 *   s2g-read:<me>         when they last read each conversation (and each thread, as "t:<message id>")
 *   s2g-chat-typed:<me>   what they started writing and didn't send, per conversation and per thread
 *   s2g-chat-saved:<me>   saved messages, some with a reminder
 *   s2g-chat-muted:<me>   muted conversations: "always" or until a time
 *   s2g-chat-tiles:<me>   the tiles on top of the chat list: their order and which are hidden
 */

export type Draft = { text: string; at: string };
export type SavedItem = { id: string; channelId: string; at: string; remindAt?: string; reminded?: boolean };
export type TileId = 'catchup' | 'threads' | 'drafts' | 'saved' | 'live';
export type Tiles = { order: TileId[]; hidden: TileId[] };
/** Each tile's name, in the reader's language (getters: read while rendering). */
export const TILE_NAMES: Record<TileId, string> = {
  get catchup() {
    return t('Catch up');
  },
  get threads() {
    return t('Threads');
  },
  get drafts() {
    return t('Drafts and sent');
  },
  get saved() {
    return t('Saved');
  },
  get live() {
    return t('Live calls');
  },
};
// "In a meeting" comes from the calendar on its own; people only set Focus, Away or their own words. A preset is saved
// in English and read in each reader's language (statusText).
export const STATUS_PRESETS: Status[] = [
  { emoji: '🎯', text: mark('Focusing, slow to reply') },
  { emoji: '🌴', text: mark('Away') },
];
/** A status's words: the presets in the reader's language, people's own words as they wrote them. */
export const statusText = (s: Status) => (STATUS_PRESETS.some((x) => x.text === s.text) ? t(s.text) : s.text);

const DEFAULT_TILES: Tiles = { order: ['catchup', 'threads', 'drafts', 'saved', 'live'], hidden: [] };

/** A draft's key: the conversation, or the conversation and the thread. */
export const draftKey = (channelId: string, rootId?: string | null) => (rootId ? `${channelId}/${rootId}` : channelId);
export const threadKey = (rootId: string) => `t:${rootId}`;
/** Before anyone opened a conversation on this device, what came in the last 90 minutes counts as new. */
export const readFallback = () => new Date(Date.now() - 90 * 60_000).toISOString();

/** The end of a mute: in an hour, tomorrow at 08:00, or never. */
export function muteUntil(kind: 'hour' | 'tomorrow' | 'always'): string {
  if (kind === 'always') return 'always';
  const d = new Date();
  if (kind === 'hour') return new Date(d.getTime() + 3600_000).toISOString();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}
export const isMutedValue = (v: string | undefined, now = Date.now()) => v === 'always' || (!!v && Date.parse(v) > now);

/**
 * "today at 14:30", "tomorrow at 09:00" or "Tue 12 Oct, 09:00": when something happens, said briefly, in the reader's
 * language. A value for a whole sentence: t('Goes {when}', { when: whenText(at) }).
 */
export function whenText(iso: string) {
  const d = new Date(iso);
  const time = fmtTime(d);
  const day = (x: Date) => x.toDateString();
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (day(d) === day(now)) return t('today at {time}', { time });
  if (day(d) === day(tomorrow)) return t('tomorrow at {time}', { time });
  return t('{day}, {time}', { day: fmtWeekday(d), time });
}

/** A list's short time: 14:05 today, Yesterday, Tue this week, 12 Oct before that. */
export function shortTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return fmtTime(d);
  if (days === 1) return t('Yesterday');
  if (days < 7) return fmtDate(d, { weekday: 'short' });
  return fmtDay(d);
}

type Setters = {
  setRead: (f: (r: Record<string, string>) => Record<string, string>) => void;
  setDrafts: (f: (d: Record<string, Draft>) => Record<string, Draft>) => void;
  setSaved: (f: (s: SavedItem[]) => SavedItem[]) => void;
  setMuted: (f: (m: Record<string, string>) => Record<string, string>) => void;
  setTiles: (t: Tiles) => void;
};
/** The setters of the one instance that's always mounted (ChatPrefsHost), by person. */
const hosts = new Map<string, Setters>();

/**
 * Keeps each person's chat state saved even when the screen that changed it is closing: a draft put away as you go
 * back, a conversation marked unread on the way out. (A setting is saved by the component holding it, so one that
 * closes in the same moment would lose the change.) App.tsx mounts it once.
 */
export function ChatPrefsHost({ me }: { me: string }) {
  const [, setRead] = usePersisted<Record<string, string>>(`s2g-read:${me}`, {});
  const [, setDrafts] = usePersisted<Record<string, Draft>>(`s2g-chat-typed:${me}`, {});
  const [, setSaved] = usePersisted<SavedItem[]>(`s2g-chat-saved:${me}`, []);
  const [, setMuted] = usePersisted<Record<string, string>>(`s2g-chat-muted:${me}`, {});
  const [, setTiles] = usePersisted<Tiles>(`s2g-chat-tiles:${me}`, DEFAULT_TILES);
  useEffect(() => {
    hosts.set(me, { setRead, setDrafts, setSaved, setMuted, setTiles });
    return () => void hosts.delete(me);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function useChatState(me: string) {
  const [read, ownRead] = usePersisted<Record<string, string>>(`s2g-read:${me}`, {});
  const [drafts, ownDrafts] = usePersisted<Record<string, Draft>>(`s2g-chat-typed:${me}`, {});
  const [saved, ownSaved] = usePersisted<SavedItem[]>(`s2g-chat-saved:${me}`, []);
  const [muted, ownMuted] = usePersisted<Record<string, string>>(`s2g-chat-muted:${me}`, {});
  const [tilesRaw, ownTiles] = usePersisted<Tiles>(`s2g-chat-tiles:${me}`, DEFAULT_TILES);
  const host = () => hosts.get(me);
  const setRead: Setters['setRead'] = (f) => (host()?.setRead ?? ownRead)(f);
  const setDrafts: Setters['setDrafts'] = (f) => (host()?.setDrafts ?? ownDrafts)(f);
  const setSaved: Setters['setSaved'] = (f) => (host()?.setSaved ?? ownSaved)(f);
  const setMuted: Setters['setMuted'] = (f) => (host()?.setMuted ?? ownMuted)(f);
  const setTiles = (t: Tiles) => (host()?.setTiles ?? ownTiles)(t);
  // Tiles added later show up for people who saved an order before them.
  const tiles: Tiles = { order: [...tilesRaw.order.filter((t) => t in TILE_NAMES), ...DEFAULT_TILES.order.filter((t) => !tilesRaw.order.includes(t))], hidden: tilesRaw.hidden ?? [] };
  return {
    read,
    drafts,
    saved,
    muted,
    tiles,
    setTiles,
    readAt: (channelId: string) => read[channelId] ?? readFallback(),
    markRead: (channelId: string, at = new Date().toISOString()) => setRead((r) => (r[channelId] && r[channelId] >= at ? r : { ...r, [channelId]: at })),
    /** Unread from this message on: the marker goes just before it. */
    markUnread: (m: ChatMessage) => setRead((r) => ({ ...r, [m.parentId && !m.alsoInChannel ? threadKey(m.parentId) : m.channelId]: new Date(Date.parse(m.at) - 1).toISOString() })),
    /** Puts a read marker back to what it was (Undo in Catch up). */
    setReadBack: (key: string, at: string | undefined) =>
      setRead((r) => {
        if (at === undefined) {
          const { [key]: _gone, ...rest } = r;
          return rest;
        }
        return { ...r, [key]: at };
      }),
    threadReadAt: (rootId: string) => read[threadKey(rootId)],
    markThreadRead: (rootId: string) =>
      setRead((r) => {
        const at = new Date().toISOString();
        const next = { ...r, [threadKey(rootId)]: at };
        // Only the last 300 threads are remembered, so the settings stay small.
        const keys = Object.keys(next).filter((k) => k.startsWith('t:'));
        if (keys.length > 300) keys.sort((a, b) => next[a].localeCompare(next[b])).slice(0, keys.length - 300).forEach((k) => delete next[k]);
        return next;
      }),
    setDraft: (key: string, text: string) =>
      setDrafts((d) => {
        if (!text.trim()) {
          if (!d[key]) return d;
          const { [key]: _gone, ...rest } = d;
          return rest;
        }
        if (d[key]?.text === text) return d;
        return { ...d, [key]: { text, at: new Date().toISOString() } };
      }),
    isSaved: (id: string) => saved.some((s) => s.id === id),
    savedItem: (id: string) => saved.find((s) => s.id === id),
    save: (m: ChatMessage, remindAt?: string) => setSaved((list) => [{ id: m.id, channelId: m.channelId, at: list.find((s) => s.id === m.id)?.at ?? new Date().toISOString(), ...(remindAt ? { remindAt } : {}) }, ...list.filter((s) => s.id !== m.id)].slice(0, 500)),
    unsave: (id: string) => setSaved((list) => list.filter((s) => s.id !== id)),
    restoreSaved: (item: SavedItem) => setSaved((list) => [item, ...list.filter((s) => s.id !== item.id)]),
    isMuted: (channelId: string) => isMutedValue(muted[channelId]),
    mutedUntil: (channelId: string) => (isMutedValue(muted[channelId]) ? muted[channelId] : undefined),
    mute: (channelId: string, kind: 'hour' | 'tomorrow' | 'always') => setMuted((m) => ({ ...m, [channelId]: muteUntil(kind) })),
    unmute: (channelId: string) =>
      setMuted((m) => {
        const { [channelId]: _gone, ...rest } = m;
        return rest;
      }),
  };
}
export type ChatState = ReturnType<typeof useChatState>;

/**
 * A draft for one box: starts from what was left there, keeps what's typed (a moment after typing stops, and when the
 * box goes away), and clears when the message is sent.
 */
export function useDraft(chat: ChatState, key: string | null, text: string, setText: (t: string) => void) {
  const current = useRef({ key, text });
  const timer = useRef<number>(0);
  // Another conversation: put the last one's words away, then bring this one's back.
  useEffect(() => {
    const prev = current.current;
    if (prev.key && prev.key !== key) chat.setDraft(prev.key, prev.text);
    current.current = { key, text: key ? (chat.drafts[key]?.text ?? '') : '' };
    setText(current.current.text);
    return undefined;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!key || current.current.key !== key) return;
    current.current.text = text;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => chat.setDraft(key, text), 700);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving (back to the list, another app): what was typed is kept.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const c = current.current;
      if (c.key) chat.setDraft(c.key, c.text);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return {
    /** The message went: nothing to keep. */
    sent: () => {
      window.clearTimeout(timer.current);
      current.current.text = '';
      if (key) chat.setDraft(key, '');
    },
  };
}

/** The other person in a direct message. */
export const dmOther = (c: Channel, me: string) => c.members.find((m) => m !== me) ?? me;

/** Threads someone follows: ones they started, replied in, or were mentioned in. With the replies they haven't read. */
export function followedThreads(messages: ChatMessage[], me: string, myFirst: string, chat: ChatState) {
  const byRoot = new Map<string, ChatMessage[]>();
  for (const m of messages) if (m.parentId && !m.sendAt) (byRoot.get(m.parentId) ?? byRoot.set(m.parentId, []).get(m.parentId)!).push(m);
  const at = new RegExp(`@${myFirst.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}\\b`, 'i');
  const roots = new Map(messages.filter((m) => byRoot.has(m.id)).map((m) => [m.id, m]));
  const out: { root: ChatMessage; replies: ChatMessage[]; unread: number; last: string }[] = [];
  for (const [id, replies] of byRoot) {
    const root = roots.get(id);
    if (!root) continue;
    const mine = replies.filter((r) => r.userId === me);
    const follows = root.userId === me || mine.length > 0 || at.test(root.text) || replies.some((r) => at.test(r.text));
    if (!follows) continue;
    replies.sort((a, b) => a.at.localeCompare(b.at));
    // Read up to their own last reply, or the last time they opened the thread.
    const seen = [chat.threadReadAt(id), mine[mine.length - 1]?.at, root.userId === me ? root.at : undefined].filter(Boolean).sort().pop() ?? root.at;
    const unread = replies.filter((r) => r.userId !== me && r.at > seen).length;
    out.push({ root, replies, unread, last: replies[replies.length - 1].at });
  }
  return out.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || b.last.localeCompare(a.last));
}
