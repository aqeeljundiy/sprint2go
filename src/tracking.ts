import type { Message, Person, RecipientTracking, Thread, TrackOptions } from './types';

import { isMine } from './identity';
export { isTeam } from './identity';

export const DEFAULT_TRACK_OPTIONS: TrackOptions = {
  opens: true,
  clicks: true,
  attachments: true,
  details: true,
  remindDays: 3,
  notify: true,
};

export const realOpens = (r: RecipientTracking) => r.opens.filter((o) => !o.auto);

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
    clicks += r.clicks.length;
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

/**
 * Turns links in outgoing HTML into tracked redirects, and adds the invisible pixel.
 * Used by the real send pipeline once the tracking service exists:
 *   https://track.<domain>/o/<token>.gif   → logs an open
 *   https://track.<domain>/c/<token>?u=…   → logs a click, then redirects
 */
export function instrument(html: string, token: string, base = 'https://track.elkiyamail.com') {
  const linked = html.replace(/href="(https?:[^"]+)"/g, (_, url) => `href="${base}/c/${token}?u=${encodeURIComponent(url)}"`);
  return `${linked}<img src="${base}/o/${token}.gif" width="1" height="1" alt="" style="display:none">`;
}

/** When a recipient first replied after a message (if they did). */
export function replyAfter(t: Thread, m: Message, email: string) {
  const i = t.messages.indexOf(m);
  return t.messages.slice(i + 1).find((x) => x.from.email === email)?.date;
}

/** Opens from more than one city usually mean the email was forwarded. */
export function maybeForwarded(r: RecipientTracking) {
  const places = new Set(realOpens(r).map((o) => o.place).filter(Boolean));
  return places.size > 1;
}

export const fmtDuration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
