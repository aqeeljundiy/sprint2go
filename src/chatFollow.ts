// Who follows a thread, and who hears about a chat message as it goes out. One set of rules for the app
// (App.tsx chatNotices), messages sent later (server/chatLater.ts) and the AI connector (server/mcpTools.ts).
// No React and no browser here: the server imports this file.
import type { Channel, ChatMessage } from './types';

type Root = Pick<ChatMessage, 'userId' | 'text'> & { follow?: Record<string, boolean> };
type Reply = Pick<ChatMessage, 'userId' | 'text'>;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "@Rizky" in a message, by first name (how the composer writes a mention). */
export const mentions = (text: string | undefined, first: string) => !!first && !!text && new RegExp(`@${esc(first)}\\b`, 'i').test(text);

/**
 * Whether someone follows a thread. Their own choice (Follow or Unfollow) wins; otherwise they follow it when they
 * started it, replied in it or were mentioned in it (Slack).
 */
export function followsThread(root: Root, replies: Reply[], userId: string, first: string): boolean {
  const said = root.follow?.[userId];
  if (typeof said === 'boolean') return said;
  return root.userId === userId || replies.some((r) => r.userId === userId) || mentions(root.text, first) || replies.some((r) => mentions(r.text, first));
}

/** A follow choice as the server keeps it: each person changes only their own entry. */
export function ownFollow(before: Record<string, boolean> | undefined, asked: unknown, me: string): Record<string, boolean> | undefined {
  const next = { ...(before ?? {}) };
  const want = asked && typeof asked === 'object' ? (asked as Record<string, unknown>)[me] : undefined;
  if (typeof want === 'boolean') next[me] = want;
  else delete next[me];
  return Object.keys(next).length ? next : undefined;
}

/** A group message: a direct message with more than one other person (or with a guest). */
export const isGroupDm = (c: Pick<Channel, 'kind' | 'members' | 'guests'>) => c.kind === 'dm' && (c.members.length > 2 || !!c.guests?.length);
/** Up to 8 people besides you in a group message (Slack's limit); more is a channel. */
export const GROUP_MAX = 9;

/** Why someone hears about a message: a DM to them, a group message they're in, a mention, a reply to their message, a thread they follow. */
export type NoticeWhy = 'dm' | 'group' | 'mention' | 'reply' | 'thread';

/**
 * Who hears about a message that just went out, once each, and why. A reply in a thread reaches the thread's followers
 * (and nobody else, unless it was also sent to the conversation); everything else reaches the other people in a DM or
 * group message, and the people a channel message mentions. Only people still in the conversation.
 */
export function chatRecipients(
  m: Pick<ChatMessage, 'userId' | 'text' | 'parentId' | 'alsoInChannel'>,
  ch: Pick<Channel, 'kind' | 'members' | 'guests'>,
  thread: { root: Root; replies: Reply[] } | null,
  firstOf: (id: string) => string,
): { id: string; why: NoticeWhy }[] {
  const out: { id: string; why: NoticeWhy }[] = [];
  const told = new Set<string>([m.userId]);
  const add = (id: string, why: NoticeWhy) => (told.add(id), out.push({ id, why }));
  if (m.parentId && thread) {
    const all = [...thread.replies, m];
    for (const id of ch.members) {
      if (told.has(id)) continue;
      const first = firstOf(id);
      if (!followsThread(thread.root, all, id, first)) continue;
      add(id, mentions(m.text, first) ? 'mention' : thread.root.userId === id ? 'reply' : 'thread');
    }
    if (!m.alsoInChannel) return out;
  }
  for (const id of ch.members) {
    if (told.has(id)) continue;
    if (ch.kind === 'dm') add(id, isGroupDm(ch) ? 'group' : 'dm');
    else if (mentions(m.text, firstOf(id))) add(id, 'mention');
  }
  return out;
}
