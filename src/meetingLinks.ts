// Video call links inside calendar events (the event's own link, its place, or its description): for Join, and for
// sending the notetaker. Shared by the app and the server (which stores the link it finds on events it imports).
import type { CalEvent } from './types';

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
