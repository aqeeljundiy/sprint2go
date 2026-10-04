import { useEffect, useState } from 'react';
import { THREADS } from './data/mock';
import { EVENTS } from './data/calendar';
import { DRIVE } from './data/drive';
import { CHANNELS, CLIENTS, MEETINGS, MESSAGES, NOTICES, TASKS } from './data/team';

// Mail, calendar, drive, tasks, chat and notifications live here (outside React) so they survive switching users.
// The real backend replaces this.
const store = {
  threads: THREADS,
  events: EVENTS,
  drive: DRIVE,
  todos: TASKS,
  clients: CLIENTS,
  channels: CHANNELS,
  messages: MESSAGES,
  notices: NOTICES,
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
