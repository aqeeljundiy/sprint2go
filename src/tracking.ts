import type { Message, OpenEvent, Person, RecipientTracking, Thread, TrackOptions } from './types';

import { isMine } from './identity';
import { listDate } from './utils';
import { t, tn } from './i18n/index'; // the full path: the server loads this file (seed.ts, data/mock.ts)
export { isTeam } from './identity';

// Read tracking on mail you send to people outside the company. On a server the mail engine does it for real
// (server/readTracking.ts): each outside recipient's copy gets its own invisible picture and, with clicks on, links
// that pass through the server first. What comes back is a hint, and the words here say so: Apple Mail and some mail
// filters load pictures by themselves ("maybe automatic", not counted), Gmail loads them through Google (no device).

export const DEFAULT_TRACK_OPTIONS: TrackOptions = {
  opens: true,
  clicks: true,
  attachments: false, // not offered: misleading and invasive
  details: false, // not offered: the rough device always shows, a place only when the server knows it for sure
  remindDays: 3,
  notify: true,
};
/** A reply sent with tracking on (the reply box has the switch, not the menu): opens, clicks and a notice, no reminder. */
export const REPLY_TRACK_OPTIONS: TrackOptions = { ...DEFAULT_TRACK_OPTIONS, remindDays: 0 };

/** Opens a person made (a provider's picture proxy counts: it loads pictures when someone opens the email). */
export const realOpens = (r: RecipientTracking) => r.opens.filter((o) => !o.auto);
/** Clicks a person made, not a mail filter checking the link. */
export const realClicks = (r: RecipientTracking) => r.clicks.filter((c) => !c.auto);

export const PROXY: Record<NonNullable<OpenEvent['via']>, string> = { gmail: 'Gmail', yahoo: 'Yahoo Mail', outlook: 'Outlook' };
/** Where an open came from, in a few words: "on iPhone", "via Gmail", or nothing when the app didn't say. */
export function openWhere(o: OpenEvent) {
  if (o.via) return t('via {provider}', { provider: PROXY[o.via] });
  const device = o.device.split(' · ')[0];
  return device ? t('on {device}', { device }) : '';
}
/** Why an open may not have been a person, for a tooltip or a timeline line. */
export const autoWhy = (o: { auto?: string }) =>
  o.auto === 'apple' ? t('Apple Mail loads pictures by itself, so this may not mean they read it') : t('A mail filter or app loaded it by itself, so this may not mean they read it');

/** One recipient in a line: "Opened 2 times, last 10:42 on iPhone", "Opened (maybe automatic)" or "Not opened yet". */
export function recipientLine(r: RecipientTracking) {
  const real = realOpens(r);
  const clicked = realClicks(r);
  // A click with no picture loaded: their app blocks pictures, but they did open it.
  if (!real.length && clicked.length) return t('Clicked a link {when}', { when: listDate(clicked[clicked.length - 1].at) });
  if (!real.length) return r.opens.length ? t('Opened (maybe automatic)') : t('Not opened yet');
  const last = real[real.length - 1];
  const where = openWhere(last);
  const when = listDate(last.at);
  if (real.length === 1) return where ? t('Opened {when} {where}', { when, where }) : t('Opened {when}', { when });
  return where ? tn(real.length, 'Opened {n} time, last {when} {where}', 'Opened {n} times, last {when} {where}', { when, where }) : tn(real.length, 'Opened {n} time, last {when}', 'Opened {n} times, last {when}', { when });
}

export interface TrackingSummary {
  recipients: number;
  openedBy: number; // people with at least one real open
  opens: number; // real opens across everyone
  clicks: number;
  autoOnly: number; // only machine opens (e.g. Apple Mail Privacy)
  lastOpen?: string;
}

export function summarize(tracking: Record<string, RecipientTracking>): TrackingSummary {
  const list = Object.values(tracking);
  let opens = 0;
  let clicks = 0;
  let openedBy = 0;
  let autoOnly = 0;
  let lastOpen: string | undefined;
  for (const r of list) {
    const real = realOpens(r);
    opens += real.length;
    clicks += realClicks(r).length;
    if (real.length) openedBy++;
    else if (r.opens.length) autoOnly++;
    for (const o of real) if (!lastOpen || o.at > lastOpen) lastOpen = o.at;
  }
  return { recipients: list.length, openedBy, opens, clicks, autoOnly, lastOpen };
}

/** The newest tracked message you sent in a thread. */
export function lastTracked(t: Thread, _me?: Person): Message | undefined {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const m = t.messages[i];
    if (isMine(m.from.email) && m.tracking) return m;
  }
}

/** When a recipient first replied after a message (if they did). */
export function replyAfter(t: Thread, m: Message, email: string) {
  const i = t.messages.indexOf(m);
  return t.messages.slice(i + 1).find((x) => x.from.email === email)?.date;
}

/** Opens from more than one country usually mean the email was forwarded (places only show when known for sure). */
export function maybeForwarded(r: RecipientTracking) {
  const places = new Set(realOpens(r).map((o) => o.place).filter(Boolean));
  return places.size > 1;
}

export const fmtDuration = (s: number) => (s < 60 ? t('{s}s', { s }) : t('{m}m {s}s', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }));
