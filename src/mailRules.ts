// Mail's rules that the app and the server share: when a snoozed email comes back, which senders are people (not
// automated mail), what still needs a reply, and the snooze presets with their exact times.
import type { Message, Person, Thread } from './types';
import { mark, t } from './i18n/index'; // the full paths: the server imports this file too
import { fmtDate, fmtTime } from './i18n/format';

/**
 * A snoozed email whose time has come, as it should be now, or null when it isn't due.
 * - Usually it comes back to the inbox, unread, on top.
 * - "Only if no reply" (`snoozeIfNoReply` holds the id of the last message when it was snoozed): if anyone wrote in
 *   the conversation since, it doesn't come back. Mail that arrived already brought it back (the mail engine does that
 *   for every snoozed email); a reply sent from here means it's handled, so it goes to Archive (Done) quietly.
 */
export function wakeThread<T extends Pick<Thread, 'snoozedUntil' | 'snoozeIfNoReply' | 'messages' | 'location' | 'unread'>>(t: T, now: string): T | null {
  if (!t.snoozedUntil || t.snoozedUntil > now) return null;
  const { snoozedUntil: _until, snoozeIfNoReply, ...rest } = t;
  const last = t.messages[t.messages.length - 1];
  if (snoozeIfNoReply && last && last.id !== snoozeIfNoReply) return { ...rest, location: t.location === 'inbox' ? 'archive' : t.location } as T;
  return { ...rest, unread: true, location: t.location === 'archive' ? 'inbox' : t.location } as T;
}

/** What a snooze sets on a thread: until when, and (only if no reply) the last message it was snoozed at. */
export function snoozePatch(t: Pick<Thread, 'messages'>, until: string, ifNoReply: boolean): Pick<Thread, 'snoozedUntil' | 'snoozeIfNoReply'> {
  return { snoozedUntil: until, snoozeIfNoReply: ifNoReply ? t.messages[t.messages.length - 1]?.id : undefined };
}

// Addresses that belong to systems, not people: they never buzz a phone and never "need a reply".
const AUTOMATED = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|news(letters?)?|digest|updates|marketing|receipts?|billing|invoices?|automated|system)([+._-].*)?$/i;

/** A person wrote it (not a newsletter, a receipt or a system that sends notifications). */
export function fromPerson(m: Pick<Message, 'from' | 'listUnsubscribe'>): boolean {
  if (m.listUnsubscribe) return false;
  const local = String(m.from?.email ?? '').split('@')[0] ?? '';
  return !!local && !AUTOMATED.test(local);
}

/** Waiting for an answer from us: in the inbox, and the last message came from a person outside our own mailboxes. */
export function needsReply(t: Pick<Thread, 'location' | 'messages'>, isMine: (email: string) => boolean): boolean {
  const last = t.messages[t.messages.length - 1];
  return t.location === 'inbox' && !!last && !isMine(last.from.email) && fromPerson(last);
}

/** The people in a conversation, for "who's on this thread": everyone who wrote or was written to. */
export const participantsOf = (t: Pick<Thread, 'messages'>): Person[] => {
  const seen = new Map<string, Person>();
  for (const m of t.messages) for (const p of [m.from, ...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])]) if (p?.email && !seen.has(p.email.toLowerCase())) seen.set(p.email.toLowerCase(), p);
  return [...seen.values()];
};

export interface SnoozePreset {
  id: string;
  label: string; // "Tomorrow", in English: show it with t(label)
  at: Date;
}

const at = (base: Date, days: number, h: number, m = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
};

/** The quick choices for a snooze, each with an exact time; only the ones that make sense right now. */
export function snoozePresets(now = new Date()): SnoozePreset[] {
  const h = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  const later = new Date(now.getTime() + 3 * 3_600_000);
  later.setMinutes(Math.ceil(later.getMinutes() / 15) * 15, 0, 0);
  const out: SnoozePreset[] = [];
  if (h < 19) out.push({ id: 'later', label: mark('Later today'), at: later });
  if (h < 16) out.push({ id: 'evening', label: mark('This evening'), at: at(now, 0, 18) });
  out.push({ id: 'tomorrow', label: mark('Tomorrow'), at: at(now, 1, 9) });
  if (day >= 1 && day <= 4) out.push({ id: 'weekend', label: mark('This weekend'), at: at(now, 6 - day, 9) });
  out.push({ id: 'week', label: mark('Next week'), at: at(now, ((8 - day) % 7) || 7, 9) });
  return out;
}

/** "Today, 15:30", "Tomorrow, 09:00", "Sat, 09:00", "Mon 13 Oct, 09:00": always the exact time, in the person's language. */
export function whenWords(d: Date, now = new Date()): string {
  const time = fmtTime(d);
  const days = Math.round((at(d, 0, 12).getTime() - at(now, 0, 12).getTime()) / 86_400_000);
  if (days === 0) return t('Today, {time}', { time });
  if (days === 1) return t('Tomorrow, {time}', { time });
  if (days > 1 && days < 7) return `${fmtDate(d, { weekday: 'short' })}, ${time}`;
  return `${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}
