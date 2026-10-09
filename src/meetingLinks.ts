// Video call links inside calendar events (the event's own link, its place, or its description): for Join, and for
// sending the notetaker. Shared by the app and the server (which stores the link it finds on events it imports).
import type { CalEvent } from './types';
import { mark } from './i18n/index'; // the full path: the server imports this file too

export type MeetingKind = 'meet' | 'zoom' | 'teams' | 'webex' | 'whereby' | 'jitsi';

const HOSTS: [RegExp, RegExp, MeetingKind][] = [
  // host, path, kind
  [/^meet\.google\.com$/, /^\/(?!$)/, 'meet'],
  [/(^|\.)zoom\.(us|com)$|(^|\.)zoomgov\.com$/, /^\/(j|my|w|s|wc)\//, 'zoom'],
  [/^teams\.microsoft\.com$/, /^\/(l\/meetup-join|meet)\//, 'teams'],
  [/^teams\.live\.com$/, /^\/meet\//, 'teams'],
  [/(^|\.)webex\.com$/, /^\/(meet|join|[\w-]+\/j\.php)/, 'webex'],
  [/^whereby\.com$/, /^\/[\w-]+/, 'whereby'],
  [/^meet\.jit\.si$/, /^\/[\w-]+/, 'jitsi'],
];

export const MEETING_NAME: Record<MeetingKind, string> = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams', webex: 'Webex', whereby: 'Whereby', jitsi: 'Jitsi' };

/** The first video call link in these texts, if any. */
export function findMeetingLink(...texts: (string | undefined | null)[]): { url: string; kind: MeetingKind } | null {
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
      const url = m[0].replace(/[.,;:!?*]+$/, '');
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        continue;
      }
      const hit = HOSTS.find(([host, path]) => host.test(u.hostname.toLowerCase()) && path.test(u.pathname));
      if (hit) return { url: u.toString(), kind: hit[2] };
    }
  }
  return null;
}

/** An event's video call: its own link first, then its place, then its notes. */
export const meetingLinkOf = (e: Pick<CalEvent, 'meetUrl' | 'location' | 'notes'>) => findMeetingLink(e.meetUrl, e.location, e.notes);

/** The notetaker joins Google Meet and Zoom. */
export const notetakerJoins = (k: MeetingKind) => k === 'meet' || k === 'zoom';

/** The same call, whatever extras the link carries (Google adds ?authuser; copies on two calendars may differ). */
export function callKey(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

/** The company's "Bot joins automatically" (Settings, Meetings, and Meet's Upcoming). Show label and hint with t(). */
export type JoinMode = 'accepted' | 'organizer' | 'all' | 'off';
export const JOIN_MODES: { value: JoinMode; label: string; hint: string }[] = [
  { value: 'accepted', label: mark('Meetings people organize or accept'), hint: mark('Their own events, invites they said yes to, and their linked calendars') },
  { value: 'organizer', label: mark('Only meetings people organize'), hint: mark('Events they made, or invites they sent') },
  { value: 'all', label: mark('Every meeting with a link'), hint: mark('Anything on their calendar with a Meet or Zoom link') },
  { value: 'off', label: mark('Off: people pick each one'), hint: mark('Switch it on per meeting in Meet, Upcoming') },
];

/**
 * Whether the notetaker joins an event by the company's rule, before the owner's own switch for that event.
 * `mine`: the owner's addresses (their email and mailboxes), to tell invites they sent from ones they got.
 */
export function joinsByRule(e: Pick<CalEvent, 'organizer' | 'inviteUid' | 'feed' | 'rsvp'>, mode: JoinMode | undefined, mine: (email: string) => boolean): boolean {
  const m = mode ?? 'accepted';
  if (m === 'off') return false;
  if (m === 'all') return true;
  const org = e.organizer?.email?.toLowerCase();
  // Made here by hand (no invite behind it) or an invite they sent. A linked calendar doesn't say who organised it.
  const organizes = org ? mine(org) : !e.inviteUid && !e.feed;
  if (m === 'organizer') return organizes;
  // Said yes to the invite, or it's on a calendar they linked (Google and Outlook keep what they're going to).
  return organizes || e.rsvp === 'accepted' || (e.feed === 'link' && e.rsvp !== 'declined');
}

/** Whether the notetaker joins this event: the owner's switch for it, else the company's rule; only Meet and Zoom calls. */
export function botJoins(e: CalEvent, mode: JoinMode | undefined, overrides: Record<string, boolean> | undefined, mine: (email: string) => boolean) {
  const link = meetingLinkOf(e);
  if (!link || !notetakerJoins(link.kind) || e.allDay) return false;
  // One date of a repeating event: its own switch, else the series' switch.
  const own = overrides?.[e.id] ?? (e.seriesId ? overrides?.[e.seriesId] : undefined);
  return typeof own === 'boolean' ? own : joinsByRule(e, mode, mine);
}
