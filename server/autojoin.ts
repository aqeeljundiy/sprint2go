// The notetaker joins by itself. Every minute: calendar events starting in the next two minutes with a Google Meet or
// Zoom link, that the company's "Bot joins automatically" and the owner's own switch for the event say to record, get
// the notetaker. Each call is sent once (remembered here), so a restart, a second tick or the same meeting on two
// people's calendars never sends it twice. The plan's meeting-bot hours are respected.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { botJoins, callKey, meetingLinkOf, notetakerJoins, type JoinMode } from '../src/meetingLinks.ts';
import { meetHours } from '../src/data/pricing.ts';
import { teamSize } from './aiplan.ts';
import { readOnlyWhy } from './billing.ts';
import { expandEvents } from '../src/repeat.ts';

db.db.exec('CREATE TABLE IF NOT EXISTS autojoin (key TEXT PRIMARY KEY, event_id TEXT NOT NULL, workspace_id TEXT NOT NULL, meeting_id TEXT, outcome TEXT NOT NULL, at TEXT NOT NULL)');

export interface AutoJoinDeps {
  /** The recorder is set up and answering. */
  recorderUp: () => boolean;
  /** Saves the meeting and sends the recorder bot to it: null when it's on its way, else why not. */
  send: (ws: any, meeting: any) => Promise<string | null>;
  /** A notice in these people's bell. */
  notify: (userIds: string[], workspaceId: string, text: string, link: { app: string; id?: string }) => void;
}

/** Meetings starting this soon get the notetaker (it joins a minute or two early and waits to be let in). */
const AHEAD = 2 * 60_000;
/** A tick that came late still catches a meeting that started a moment ago. */
const BEHIND = 60_000;

const monthStart = (now: number) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

/** The plan's meeting-bot hours this month (Infinity on Business), and the minutes the notetaker recorded so far. */
export function botHours(ws: any, now = Date.now()) {
  const plan = ws.plan ?? { tier: 'studio', track: 'ai' }; // no plan yet: the Studio trial, as for storage
  const hours = meetHours({ ...plan, addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false, ...(plan.addons ?? {}) } }, Math.max(1, teamSize(ws)));
  const since = monthStart(now);
  const used = (db.allDocs('meetings') as any[]).filter((m) => m.workspaceId === ws.id && m.bot && String(m.at ?? '') >= since).reduce((n, m) => n + (Number(m.minutes) || 0), 0);
  return { hours, usedMinutes: used, left: hours === Infinity ? Infinity : Math.max(0, hours * 60 - used) };
}

/** One call, whoever's calendar it's on: the company, the link without its extras, the start. */
const keyOf = (wsId: string, url: string, start: number) => `${wsId}|${callKey(url)}|${new Date(start).toISOString()}`;
const seen = (key: string) => !!db.db.prepare('SELECT 1 FROM autojoin WHERE key = ?').get(key);
const remember = (key: string, eventId: string, wsId: string, outcome: string, meetingId: string | null = null) =>
  db.db.prepare('INSERT OR REPLACE INTO autojoin (key, event_id, workspace_id, meeting_id, outcome, at) VALUES (?, ?, ?, ?, ?, ?)').run(key, eventId, wsId, meetingId, outcome, new Date().toISOString());

const prefsOf = (userId: string) => ((db.getDoc('prefs', userId) as any)?.value ?? {}) as Record<string, any>;

/** What the notetaker did on one tick, for the log and the tests. */
export type AutoJoinResult = { eventId: string; workspaceId: string; outcome: 'sent' | 'failed' | 'no-hours' | 'not-allowed'; meetingId?: string; error?: string };

let running = false;
/** Sends the notetaker to the meetings about to start that should be recorded. `now` can be set for tests. */
export async function runAutoJoin(deps: AutoJoinDeps, now = Date.now()): Promise<AutoJoinResult[]> {
  if (running || !deps.recorderUp()) return [];
  running = true;
  const out: AutoJoinResult[] = [];
  try {
    const wss = db.allDocs('workspaces') as any[];
    const users = new Map((db.allDocs('users') as any[]).map((u) => [u.id, u]));
    // A repeating event: its dates about to start (each one an event of its own, its id saying which date).
    for (const e of expandEvents(db.allDocs('events') as any[], now - BEHIND, now + AHEAD) as any[]) {
      if (!e?.start || e.allDay || !e.userId || e.busy) continue;
      const start = Date.parse(e.start);
      if (!(start > now - BEHIND && start <= now + AHEAD)) continue;
      const link = meetingLinkOf(e);
      if (!link || !notetakerJoins(link.kind)) continue;
      // The event's company, else the owner's first (a linked calendar belongs to the person, not one company).
      const ws = wss.find((w) => w.id === e.workspaceId && (w.members ?? []).some((m: any) => m.userId === e.userId)) ?? wss.find((w) => (w.members ?? []).some((m: any) => m.userId === e.userId));
      if (!ws || ws.suspended || readOnlyWhy(ws)) continue; // a paused company records nothing
      const owner = users.get(e.userId);
      if (!owner || owner.deletedAt || owner.suspended) continue;
      const addresses = new Set<string>([String(owner.email ?? '').toLowerCase(), ...(ws.accounts ?? []).filter((a: any) => (a.users ?? []).includes(e.userId)).map((a: any) => String(a.email).toLowerCase())]);
      if (!botJoins(e, ws.meetings?.joinMode as JoinMode | undefined, prefsOf(e.userId)[`s2g-join:${e.userId}`], (x) => addresses.has(x.toLowerCase()))) continue;
      const key = keyOf(ws.id, link.url, start);
      if (seen(key)) continue;
      const title = String(e.title || 'Meeting').slice(0, 200);
      // "Who can record": only admins send the notetaker in this company.
      const role = (ws.members ?? []).find((m: any) => m.userId === e.userId)?.role;
      if (ws.meetings?.whoCanRecord === 'admins' && role === 'member') {
        remember(key, e.id, ws.id, 'not-allowed');
        out.push({ eventId: e.id, workspaceId: ws.id, outcome: 'not-allowed' });
        continue;
      }
      const hours = botHours(ws, now);
      if (hours.left <= 0) {
        remember(key, e.id, ws.id, 'no-hours');
        deps.notify([e.userId], ws.id, `The notetaker didn’t join “${title}”: this month’s ${hours.hours} meeting-bot hours are used up. An admin can add more in Settings, Plan & billing.`, { app: 'settings', id: 'billing' });
        out.push({ eventId: e.id, workspaceId: ws.id, outcome: 'no-hours' });
        continue;
      }
      const id = `m-${randomBytes(8).toString('hex')}`;
      remember(key, e.id, ws.id, 'sent', id); // first, so an overlapping tick can't send it again
      const at = new Date(now).toISOString();
      const meeting = {
        id,
        workspaceId: ws.id,
        title,
        at: new Date(start).toISOString(),
        minutes: 0,
        attendees: (e.guests ?? []).map((g: any) => String(g.name ?? g.email ?? '')).filter(Boolean).slice(0, 50),
        summary: '',
        actions: [],
        status: 'queued',
        platform: link.kind === 'zoom' ? 'zoom' : 'meet',
        url: link.url,
        botName: String(ws.meetings?.botName || 'sprint2go Notetaker').slice(0, 80),
        bot: true,
        transcript: [],
        log: [{ message: `Joining by itself from ${String(owner.name ?? 'someone').split(' ')[0]}’s calendar`, at }],
        createdBy: e.userId,
        eventId: e.id,
        scheduledFor: new Date(start).toISOString(),
        auto: true,
      };
      const error = await deps.send(ws, meeting).catch((err) => (err instanceof Error ? err.message : 'The recorder didn’t answer'));
      if (error) {
        remember(key, e.id, ws.id, 'failed', id);
        deps.notify([e.userId], ws.id, `The notetaker couldn’t join “${title}”: ${error}`, { app: 'meet', id });
        out.push({ eventId: e.id, workspaceId: ws.id, outcome: 'failed', meetingId: id, error });
      } else out.push({ eventId: e.id, workspaceId: ws.id, outcome: 'sent', meetingId: id });
    }
  } finally {
    running = false;
  }
  return out;
}
