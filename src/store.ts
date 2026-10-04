import { useEffect, useState } from 'react';
import type { Status } from './types';
import { THREADS } from './data/mock';
import { EVENTS, EXTERNAL_CALENDARS, EXTERNAL_EVENTS } from './data/calendar';
import { DRIVE } from './data/drive';
import { CHANNELS, CLIENTS, MEETINGS, MESSAGES, NOTICES, TASKS, TEAMS } from './data/team';

// Mail, calendar, drive, tasks, chat and notifications live here (outside React) so they survive switching users.
// The real backend replaces this.
const store = {
  threads: THREADS,
  events: [...EVENTS, ...EXTERNAL_EVENTS],
  calendars: EXTERNAL_CALENDARS,
  drive: DRIVE,
  todos: TASKS,
  clients: CLIENTS,
  teams: TEAMS,
  channels: CHANNELS,
  messages: MESSAGES,
  notices: NOTICES,
  statuses: { 'u-nanda': { emoji: '🎬', text: 'Editing, slow to reply' }, 'u-faisal': { emoji: '🗓️', text: 'In client meetings till 3pm' } } as Record<string, Status>,
  meetings: MEETINGS,
};

/** Threads already scanned for to-dos (key: user:thread:lastMessage). */
export const scanned = new Set<string>();

export function useStored<K extends keyof typeof store>(key: K) {
  const [value, setValue] = useState<(typeof store)[K]>(() => store[key]);
  useEffect(() => {
    store[key] = value;
  }, [key, value]);
  return [value, setValue] as const;
}
