import type { CalEvent } from './types';

// Meeting links: which kind of call an event is, and whether the notetaker can join it (it joins Google Meet and Zoom).

const LINK_RE = /https:\/\/(?:meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}|(?:[\w-]+\.)?zoom\.us\/(?:j|my|w|s)\/[^\s<>"'),]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s<>"')]*)/i;

export type MeetingKind = 'meet' | 'zoom' | 'teams' | 'webex' | 'other';
export const MEETING_NAME: Record<MeetingKind, string> = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams', webex: 'Webex', other: 'the meeting' };

/** The first meeting link in some text. */
export const findMeetingLink = (text: string | undefined) => text?.match(LINK_RE)?.[0]?.replace(/[.,;]+$/, '');

export function meetingKind(url: string): MeetingKind {
  if (/^https:\/\/meet\.google\.com\//i.test(url)) return 'meet';
  if (/^https:\/\/([\w-]+\.)?zoom\.us\//i.test(url)) return 'zoom';
  if (/^https:\/\/teams\.(microsoft|live)\.com\//i.test(url)) return 'teams';
  if (/^https:\/\/[\w-]+\.webex\.com\//i.test(url)) return 'webex';
  return 'other';
}

/** An event's meeting link: the one it was given (an invite's), else one written in its place or notes. */
export const meetingLinkOf = (e: Pick<CalEvent, 'meetingUrl' | 'location' | 'notes'>): string | null =>
  (e.meetingUrl && /^https:\/\//i.test(e.meetingUrl) ? e.meetingUrl : null) ?? findMeetingLink(e.location) ?? findMeetingLink(e.notes) ?? null;

/** The notetaker joins Google Meet and Zoom calls. */
export const botCanJoin = (url: string | null | undefined) => !!url && /^https:\/\/(meet\.google\.com|([\w-]+\.)?zoom\.us)\//i.test(url);
