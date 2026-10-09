// The demo company: every signed-in person can open their own private copy of the sample company and try everything
// in it. Nothing in it is real and nothing leaves it (the server keeps it apart from the real companies: see
// server/sandbox.ts). This file is shared by the app and the server: the ids, the "Try this" list, and how a copy is
// made from the demo data (src/seed.ts).
import type { Collections, CollectionKey } from './seed';
import { holidayCalendarId } from './data/holidays';

/** Every id inside someone's demo company starts with this; real documents may never use it. */
export const SANDBOX_PREFIX = 'demo-';
/** The demo company's own id: one per person. */
export const sandboxWsId = (userId: string) => `${SANDBOX_PREFIX}${userId}`;
export const isSandboxId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(SANDBOX_PREFIX);
/** Whether a workspace is someone's demo company. */
export const isSandbox = (ws: { id?: string; sandbox?: unknown } | null | undefined) => !!ws && (!!ws.sandbox || isSandboxId(ws.id));

/** Which of the demo's two companies is copied (the richer one), and whose seat the person takes in it. */
export const SAMPLE_COMPANY = 'pnp';
export const SAMPLE_SEAT = 'u-aqeel';
/** The demo company's name in the switcher (a "Demo" badge sits next to it). */
export const SANDBOX_NAME = 'Pixel & Profits';

/** What the server keeps on the demo company's workspace: whose it is and when it was made, and the "Try this" list. */
export interface SandboxMark {
  owner: string;
  createdAt: string;
  tried?: TryKey[]; // what the person already tried (ticked off on the list)
  listOff?: boolean; // they closed the list (Help & support brings it back)
}

/** Where someone's demo company stands, from the server (/api/me): not made yet, open, or hidden from the switcher. */
export interface DemoState {
  allowed: boolean; // their companies let them open it (Settings, Apps & chat), and they're not only a guest somewhere
  state: 'none' | 'on' | 'hidden';
}

/** "Try this": concrete things to do in the demo company, ticked off when the person really does them there. */
export const TRY_THIS = [
  { key: 'reply', label: 'Reply to a client email', hint: 'Nadia at KopiKita asked to move the review call' },
  { key: 'email-task', label: 'Turn an email into a task', hint: 'Open an email and press Make a task' },
  { key: 'stage', label: 'Move a task to another stage', hint: 'Drag a card on the board, or change its stage' },
  { key: 'ask', label: 'Ask AI about a project', hint: 'For example: what’s late at KopiKita?' },
  { key: 'guest', label: 'See what a guest sees', hint: 'Open a project and press View as guest' },
  { key: 'voice', label: 'Start a huddle or send a voice note', hint: 'In any channel or direct message' },
  { key: 'event', label: 'Add a calendar event', hint: 'Click a free slot in your week' },
  { key: 'meeting', label: 'Read a meeting’s notes', hint: 'The KopiKita weekly sync has notes and a transcript' },
] as const;
export type TryKey = (typeof TRY_THIS)[number]['key'];
export const TRY_KEYS = TRY_THIS.map((t) => t.key) as TryKey[];

type Doc = { id: string; [k: string]: unknown };
type Seed = Collections;

/** A first name that reads well in sentences ("Hi Maria,"), and an address-safe version of it. */
function names(name: string) {
  const first = name.trim().split(/\s+/)[0] || 'You';
  const slug =
    first
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30) || 'you';
  return { first, slug };
}

/**
 * Makes one person's demo company from the demo data: the sample company with everything in it, every id moved into
 * the person's own space (demo-<their id>-…), the person in the owner's seat (so Home, mail and tasks "for you" make
 * sense), and the made-up teammates as people that exist only inside it. Pure: the server stores what this returns.
 * Dates come from the data as it was made: the server makes it fresh, in the person's time zone, for each copy.
 */
export function buildSandbox(seed: Seed, me: { id: string; name: string }, now = new Date().toISOString()): Record<CollectionKey, Doc[]> {
  const wsId = sandboxWsId(me.id);
  const src = (seed.workspaces as unknown as Doc[]).find((w) => w.id === SAMPLE_COMPANY) as Doc & { members: { userId: string; role: string }[]; accounts: { id: string }[] };
  if (!src) throw new Error('The demo data has no sample company');
  const members = new Set(src.members.map((m) => m.userId));
  const accounts = new Set(src.accounts.map((a) => a.id));
  const inWs = (d: Doc) => ((d.workspaceId as string | undefined) ?? SAMPLE_COMPANY) === SAMPLE_COMPANY;
  const list = <K extends CollectionKey>(k: K) => seed[k] as unknown as Doc[];

  // What comes along: the sample company's own things. Not the other company, and not the seat's personal calendar
  // (a pretend Google account would look like theirs).
  const calendars = list('calendars').filter((c) => (c.workspaceId ? c.workspaceId === SAMPLE_COMPANY : members.has(String(c.ownerId)) && c.ownerId !== SAMPLE_SEAT));
  const calIds = new Set(calendars.map((c) => c.id));
  const seededCals = new Set(list('calendars').map((c) => c.id));
  const channels = list('channels').filter((c) => c.workspaceId === SAMPLE_COMPANY);
  const chanIds = new Set(channels.map((c) => c.id));
  const tables = list('tables').filter(inWs);
  const tableIds = new Set(tables.map((t) => t.id));
  const picked: Partial<Record<CollectionKey, Doc[]>> = {
    users: list('users').filter((u) => members.has(u.id) && u.id !== SAMPLE_SEAT),
    threads: list('threads').filter((t) => accounts.has(String(t.accountId))),
    // Events on an outside calendar (a teammate's, the holidays) come with that calendar; the rest are the seat's own.
    events: list('events')
      .filter((e) => (seededCals.has(String(e.calendarId)) ? calIds.has(String(e.calendarId)) : inWs(e) && (!e.userId || members.has(String(e.userId)))))
      .map((e) => (e.userId || seededCals.has(String(e.calendarId)) ? e : { ...e, userId: SAMPLE_SEAT })),
    calendars,
    drive: list('drive').filter(inWs),
    todos: list('todos').filter(inWs),
    clients: list('clients').filter((c) => c.workspaceId === SAMPLE_COMPANY),
    teams: list('teams').filter((t) => t.workspaceId === SAMPLE_COMPANY),
    channels,
    messages: list('messages').filter((m) => chanIds.has(String(m.channelId))),
    notices: list('notices').filter((n) => n.workspaceId === SAMPLE_COMPANY && n.userId === SAMPLE_SEAT),
    meetings: list('meetings').filter((m) => m.workspaceId === SAMPLE_COMPANY),
    templates: list('templates').filter((t) => t.workspaceId === SAMPLE_COMPANY),
    notes: list('notes').filter((n) => n.workspaceId === SAMPLE_COMPANY),
    tables,
    rows: list('rows').filter((r) => tableIds.has(String(r.tableId))),
    quotes: list('quotes').filter((q) => q.workspaceId === SAMPLE_COMPANY),
  };
  const statuses = Object.entries((seed.statuses ?? {}) as Record<string, unknown>).filter(([id]) => members.has(id) && id !== SAMPLE_SEAT);

  // Every id that something can point at moves into the person's space; the seat becomes the person.
  const ids = new Map<string, string>([[SAMPLE_COMPANY, wsId], [SAMPLE_SEAT, me.id]]);
  const own = (id: string) => ids.set(id, `${wsId}-${id}`);
  for (const docs of Object.values(picked)) for (const d of docs ?? []) own(d.id);
  for (const id of accounts) own(id);
  for (const id of members) if (id !== SAMPLE_SEAT) own(id);
  // The company's holiday calendar has a fixed name the app looks for (Settings, General: public holidays).
  ids.set(holidayCalendarId(SAMPLE_COMPANY), holidayCalendarId(wsId));
  const { first, slug } = names(me.name);
  const seatEmail = /\baqeel@pixelandprofits\.com\b/gi;
  const text = (s: string) => s.replace(seatEmail, `${slug}@pixelandprofits.com`).replace(/\bAqeel\b/g, () => first);
  const move = (v: unknown): unknown => {
    if (typeof v === 'string') return ids.get(v) ?? text(v);
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [ids.get(k) ?? k, move(x)]));
    return v;
  };
  const out = {} as Record<CollectionKey, Doc[]>;
  for (const [k, docs] of Object.entries(picked) as [CollectionKey, Doc[]][]) out[k] = docs.map((d) => move(structuredClone(d)) as Doc);

  // Things that default to the sample company or its owner in the app say whose they are.
  for (const k of ['events', 'todos', 'drive'] as const) out[k] = out[k].map((d) => ({ ...d, workspaceId: d.workspaceId ?? wsId }));
  out.statuses = statuses.map(([id, value]) => ({ id: ids.get(id) ?? id, value: move(value) }));
  out.prefs = [];

  const ws = move(structuredClone(src)) as Doc & { members: { userId: string; role: string }[] };
  const mark: SandboxMark = { owner: me.id, createdAt: now, tried: [] };
  out.workspaces = [
    {
      ...ws,
      id: wsId,
      name: SANDBOX_NAME,
      members: [{ userId: me.id, role: 'owner' }, ...ws.members.filter((m) => m.userId !== me.id)],
      sandbox: mark,
      createdAt: now,
      // Nothing that only the real world sets: no mail checks, sign-in rules, own address, WhatsApp or suspension.
      mailReady: undefined,
      mailChecks: undefined,
      mailRouting: undefined,
      whiteLabel: undefined,
      security: undefined,
      whatsapp: undefined,
      suspended: undefined,
    },
  ];
  return out;
}
