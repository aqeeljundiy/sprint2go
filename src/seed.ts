import type { Status, User, Workspace } from './types';
import type { TaskTemplate } from './data/templates';
import { DEMO_MAIL_FILTERS, DEMO_MAIL_LABELS, THREADS } from './data/mock';
import { EVENTS, EXTERNAL_EVENTS, SEED_CALENDARS } from './data/calendar';
import { DRIVE } from './data/drive';
import { CHANNELS, CLIENTS, MEETINGS, MESSAGES, NOTICES, TASKS, TEAMS } from './data/team';
import { USERS, WORKSPACES } from './data/workspaces';
import { NOTES } from './data/notes';
import { ROWS, TABLES } from './data/tables';
import type { DataTable, Quote, TableRow } from './types';

/** The demo company's starting data. The browser demo starts from it; the local server copies it into its database on first run. */
export const seed = () => ({
  users: USERS as User[],
  workspaces: WORKSPACES as Workspace[],
  threads: THREADS,
  events: [...EVENTS, ...EXTERNAL_EVENTS],
  calendars: SEED_CALENDARS,
  drive: DRIVE,
  todos: TASKS,
  clients: CLIENTS,
  teams: TEAMS,
  channels: CHANNELS,
  messages: MESSAGES,
  notices: NOTICES,
  statuses: { 'u-nanda': { emoji: '🎬', text: 'Editing, slow to reply' }, 'u-faisal': { emoji: '🗓️', text: 'In client meetings till 3pm' } } as Record<string, Status>,
  meetings: MEETINGS,
  templates: [] as TaskTemplate[], // templates a company saved for itself
  notes: NOTES,
  tables: TABLES as DataTable[],
  rows: ROWS as TableRow[],
  prefs: {} as Record<string, Record<string, unknown>>,
  quotes: [] as Quote[], // each person's settings and views, so they follow them between devices
  mailLabels: DEMO_MAIL_LABELS, // Mail's labels: a mailbox's own and the company's (server/mailFilters.ts)
  mailFilters: DEMO_MAIL_FILTERS, // Mail's filters, run by the server on every arriving email
});
export type Collections = ReturnType<typeof seed>;
export type CollectionKey = keyof Collections;
/** Collections stored as { id: value } maps rather than lists. */
export const RECORD_KEYS: CollectionKey[] = ['statuses', 'prefs'];
