// Channel summaries on a schedule (Daily, Weekly, Monthly; Settings in each channel's Summary tab). Each one that's
// due is written once with the company's AI (its own keys, or the plan's allowance), kept in the channel's history,
// and posted in the channel when that's switched on. Nothing happened in the period: no summary (and no AI used).
// No working AI: no summary, and the channel remembers why so its Summary tab can say so.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { SUMMARY_TRIES, channelSchedule, companyTz, settledKey, summaryDue, zonedTime, type SummaryPeriod, type SummaryRun } from '../src/jobTimes.ts';

export type SummaryInput = { channel: string; period: string; messages: { who: string; text: string; at: string; task?: string; files?: string[] }[] };
/** What writing one summary came to: the text, AI that isn't there for this company (and why), or a failure. */
export type Written = { text: string } | { off: string } | { failed: string };
export interface SummaryDeps {
  write: (ws: any, input: SummaryInput) => Promise<Written>;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
}

/** The newest summaries kept on a channel. */
export const HISTORY_KEEP = 60;
const RETRY_MS = 60 * 60_000;
/** At most this many messages go to the AI for one period (the newest), each cut to a reasonable length. */
const MAX_MESSAGES = 400;

const nameOf = (users: Map<string, any>, ch: any, m: any) =>
  m.userId === 'guest' ? (ch.guests ?? []).find((g: any) => g.email === m.guestEmail)?.name ?? 'Guest' : String(users.get(m.userId)?.name ?? 'Someone').split(' ')[0];

/** One channel's summary for a period: the messages it covers, or null when nothing happened. */
function inputFor(ch: any, period: SummaryPeriod, users: Map<string, any>, todos: Map<string, any>, tz: string): SummaryInput | null {
  const from = new Date(zonedTime(period.from, 0, tz)).toISOString();
  const to = new Date(zonedTime(period.to, 0, tz)).toISOString();
  const msgs = (db.allDocs('messages') as any[])
    .filter((m) => m.channelId === ch.id && m.at >= from && m.at < to && m.kind !== 'summary' && m.kind !== 'system' && !m.sendAt) // not messages still waiting to be sent
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-MAX_MESSAGES);
  if (!msgs.length) return null;
  return {
    channel: ch.kind === 'dm' ? 'a direct message' : `#${ch.name}`,
    period: period.label,
    messages: msgs.map((m) => ({
      who: nameOf(users, ch, m),
      text: String(m.voice?.transcript ?? m.text ?? '').slice(0, 1500),
      at: m.at,
      task: m.taskId ? todos.get(m.taskId)?.title : undefined,
      files: m.files?.length ? m.files.map((f: any) => String(f.name)) : undefined,
    })),
  };
}

let running = false;
/**
 * Writes every scheduled summary that's due, by each company's own clock (Settings, General, Time zone). `now` (and
 * a time zone for every company) can be set for tests. Returns what it did, per channel.
 */
export async function runSummaries(deps: SummaryDeps, now = Date.now(), tzFor?: string): Promise<{ channelId: string; key: string; state: SummaryRun['state'] }[]> {
  if (running) return [];
  running = true;
  const out: { channelId: string; key: string; state: SummaryRun['state'] }[] = [];
  try {
    const wss = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w]));
    const users = new Map((db.allDocs('users') as any[]).map((u) => [u.id, u]));
    let todos: Map<string, any> | null = null;
    for (const ch of db.allDocs('channels') as any[]) {
      if (ch.archived || !ch.workspaceId) continue;
      const ws = wss.get(ch.workspaceId);
      if (!ws || ws.suspended) continue;
      const tz = tzFor ?? companyTz(ws);
      const last = ch.summary?.last as SummaryRun | undefined;
      // A failed run waits for its retry time; then the same period is tried again.
      if (last?.state === 'failed' && (last.tries ?? 0) < SUMMARY_TRIES && last.retryAt && last.retryAt > new Date(now).toISOString()) continue;
      const period = summaryDue(channelSchedule(ch), settledKey(last), now, tz, !!last);
      if (!period) continue;
      const input = inputFor(ch, period, users, (todos ??= new Map((db.allDocs('todos') as any[]).map((t) => [t.id, t]))), tz);
      const at = new Date(now).toISOString();
      let run: SummaryRun;
      let entry: { id: string; text: string; period: string; at: string; auto: boolean } | null = null;
      if (!input) run = { key: period.key, state: 'nothing', at, label: period.label };
      else {
        const res = await deps.write(ws, input).catch((e): Written => ({ failed: e instanceof Error ? e.message : 'the AI service failed' }));
        if ('text' in res && res.text.trim()) {
          entry = { id: randomBytes(6).toString('hex'), text: res.text.trim(), period: period.label, at, auto: true };
          run = { key: period.key, state: 'done', at, label: period.label };
        } else if ('off' in res) run = { key: period.key, state: 'off', at, label: period.label, why: res.off };
        else {
          const tries = (last?.key === period.key ? (last.tries ?? 0) : 0) + 1;
          run = { key: period.key, state: 'failed', at, label: period.label, why: 'failed' in res ? res.failed : 'The AI wrote nothing', tries, retryAt: new Date(now + RETRY_MS).toISOString() };
        }
      }
      // Saved onto the channel as it is now (someone may have changed it while the AI was writing).
      const cur = db.getDoc('channels', ch.id) as any;
      if (!cur) continue;
      const summary = cur.summary ?? { schedule: channelSchedule(cur), post: false, history: [] };
      const next = { ...cur, summary: { ...summary, schedule: summary.schedule ?? channelSchedule(cur), history: entry ? [entry, ...(summary.history ?? [])].slice(0, HISTORY_KEEP) : (summary.history ?? []), last: run } };
      db.writeDocs('channels', [next], [], null);
      deps.broadcast('channels', [next], []);
      if (entry && summary.post) {
        const msg = { id: randomBytes(8).toString('hex'), channelId: ch.id, userId: 'sprint2go', kind: 'summary', text: entry.text, summaryOf: period.label, at } as db.Doc;
        db.writeDocs('messages', [msg], [], null);
        deps.broadcast('messages', [msg], []);
      }
      out.push({ channelId: ch.id, key: period.key, state: run.state });
    }
  } finally {
    running = false;
  }
  return out;
}

/**
 * A channel saved from someone's app: the schedule's history and the server's last run stay as the server has them,
 * so a page that was open while a summary was written can't remove it. Summaries asked for in the app are added.
 */
export function keepSummaries(next: any, before: any) {
  if (!before?.summary || !next) return next;
  const mine = new Map<string, any>();
  for (const h of [...(next.summary?.history ?? []), ...(before.summary.history ?? [])]) if (h?.id && !mine.has(h.id)) mine.set(h.id, h);
  const history = [...mine.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, HISTORY_KEEP);
  return { ...next, summary: { ...(next.summary ?? before.summary), history, last: before.summary.last } };
}
