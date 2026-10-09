// Delete old chat messages (Settings, Apps & chat). Off unless an admin picks a period. Turning it on (or making the
// period shorter) starts with a 7-day notice to the admins: nothing is deleted before that. Then once a day, chat
// messages older than the period go for everyone, except pinned ones, threads still going, and the channels of
// projects marked to keep. Files shared in them stay in Drive. Every run leaves an audit entry.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { kindOf } from '../src/data/drive.ts';
import { COMPANY_TZ, companyTz } from '../src/jobTimes.ts';
import { msg, phrase } from '../src/i18n/index.ts';
import { datePhrase, type Said } from './lang.ts';

export const RETENTION_DAYS = { '1y': 365, '90d': 90 } as const;
export type Period = keyof typeof RETENTION_DAYS;
export const NOTICE_DAYS = 7;
const DAY = 86_400_000;
const isPeriod = (h: unknown): h is Period => typeof h === 'string' && h in RETENTION_DAYS;
export const periodWords = (h: Period) => (h === '1y' ? '1 year' : '90 days');
/** The period as words translated when read. */
const periodPhrase = (h: Period) => (h === '1y' ? phrase('1 year') : phrase('90 days'));

/** What the server keeps about deleting (the app shows it, never sets it). */
export interface RetentionState {
  deleteFrom?: string; // deleting starts on this day, after the notice
  lastRun?: { at: string; deleted: number; files: number; before: string };
}

/**
 * The company's chat settings as saved from the app. The period and the projects to keep are the admins'; when
 * deleting starts and the last run are the server's. Turning it on, or a shorter period, starts the notice again.
 * `started`: the notice to send (the caller tells the admins).
 */
export function chatOnSave(next: any, before: any, now = Date.now()): { chat: any; started?: { from: string; period: Period } } {
  if (!next) return { chat: before };
  const keep = Array.isArray(next.keep) ? [...new Set(next.keep.filter((x: unknown) => typeof x === 'string').map(String))].slice(0, 500) : undefined;
  const want = isPeriod(next.history) ? next.history : 'forever';
  const had = isPeriod(before?.history) ? before.history : 'forever';
  const base = { ...next, keep, history: want === 'forever' && !next.history ? undefined : want, lastRun: before?.lastRun };
  if (want === 'forever') return { chat: { ...base, deleteFrom: undefined } };
  const starts = had === 'forever' || !before?.deleteFrom || RETENTION_DAYS[want as Period] < RETENTION_DAYS[had as Period];
  if (!starts) return { chat: { ...base, deleteFrom: before.deleteFrom } };
  const from = new Date(now + NOTICE_DAYS * DAY).toISOString();
  return { chat: { ...base, deleteFrom: from }, started: { from, period: want } };
}

/** The admins' notice when deleting is switched on: when it starts (the day by the company's clock) and what it does. */
export const noticeWords = (company: string, period: Period, from: string, tz = COMPANY_TZ): Said =>
  msg('From {date}, chat messages older than {period} will be deleted every day for everyone at {company}. Pinned messages and the projects you keep stay; files stay in Drive. Change it in Settings, Apps & chat.', { date: datePhrase(from, { tz }), period: periodPhrase(period), company });
export const noticeText = (company: string, period: Period, from: string, tz = COMPANY_TZ) => noticeWords(company, period, from, tz).text;

export interface RetentionDeps {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
  notify: (userIds: string[], workspaceId: string, text: Said, link: { app: string; id?: string }) => void;
}

const adminsOf = (ws: any) => (ws.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId as string);

/** Runs what's due today in every company. `now` can be set for tests. */
export function runRetention(deps: RetentionDeps, now = Date.now()) {
  const out: { workspaceId: string; deleted: number; files: number; noticeOnly?: boolean }[] = [];
  for (const ws of db.allDocs('workspaces') as any[]) {
    const chat = ws.chat ?? {};
    if (!isPeriod(chat.history) || ws.suspended) continue;
    const at = new Date(now).toISOString();
    // A period set before the server did this: the notice starts now, like turning it on.
    if (!chat.deleteFrom) {
      const from = new Date(now + NOTICE_DAYS * DAY).toISOString();
      const next = { ...ws, chat: { ...chat, deleteFrom: from } };
      db.writeDocs('workspaces', [next], [], null);
      deps.broadcast('workspaces', [next], []);
      deps.notify(adminsOf(ws), ws.id, noticeWords(ws.name, chat.history, from, companyTz(ws)), { app: 'settings', id: 'apps' });
      out.push({ workspaceId: ws.id, deleted: 0, files: 0, noticeOnly: true });
      continue;
    }
    if (now < Date.parse(chat.deleteFrom)) continue;
    if (chat.lastRun?.at && Date.parse(chat.lastRun.at) > now - 20 * 3600_000) continue; // once a day
    const before = new Date(now - RETENTION_DAYS[chat.history as Period] * DAY).toISOString();
    const keep = new Set<string>(Array.isArray(chat.keep) ? chat.keep : []);
    const channels = new Map((db.allDocs('channels') as any[]).filter((c) => c.workspaceId === ws.id && !(c.clientId && keep.has(c.clientId))).map((c) => [c.id, c]));
    const msgs = (db.allDocs('messages') as any[]).filter((m) => channels.has(m.channelId));
    // A thread that's still going keeps its first message.
    const liveThreads = new Set(msgs.filter((m) => m.parentId && m.at >= before).map((m) => m.parentId));
    const gone = msgs.filter((m) => typeof m.at === 'string' && m.at < before && !m.pinned && !liveThreads.has(m.id));
    // Their files stay in Drive: the copy saved when they were shared (now with its address), or a new one.
    const drive: db.Doc[] = [];
    for (const m of gone)
      for (const f of m.files ?? []) {
        if (!f?.url || !/^\/api\/files\/[a-f0-9]{32}$/.test(String(f.url))) continue;
        const saved = f.driveId ? (db.getDoc('drive', f.driveId) as any) : null;
        if (saved && !saved.trashed) {
          if (!saved.url) drive.push({ ...saved, url: f.url });
          continue;
        }
        const ch = channels.get(m.channelId);
        drive.push({ id: `d-${randomBytes(6).toString('hex')}`, name: String(f.name ?? 'file').slice(0, 200), kind: kindOf({ name: String(f.name ?? ''), type: f.type }), parentId: null, size: Number(f.size) || 0, modified: m.at, workspaceId: ws.id, clientId: ch?.clientId, channelId: m.channelId, url: f.url, uploadedBy: m.userId === 'guest' ? m.guestEmail : m.userId });
      }
    if (drive.length) (db.writeDocs('drive', drive, [], null), deps.broadcast('drive', drive, []));
    if (gone.length) {
      db.writeDocs('messages', [], gone.map((m) => m.id), null);
      deps.broadcast('messages', [], gone.map((m) => m.id), undefined, gone);
    }
    const run = { at, deleted: gone.length, files: drive.length, before };
    const fresh = db.getDoc('workspaces', ws.id) as any;
    const next = { ...fresh, chat: { ...(fresh.chat ?? {}), lastRun: run } };
    db.writeDocs('workspaces', [next], [], null);
    deps.broadcast('workspaces', [next], []);
    db.audit('system', 'chat.retention.run', ws.id, `${gone.length} chat message${gone.length === 1 ? '' : 's'} older than ${periodWords(chat.history)} (before ${before.slice(0, 10)}) deleted${drive.length ? `; ${drive.length} file${drive.length === 1 ? '' : 's'} kept in Drive` : ''}`);
    if (!chat.lastRun)
      deps.notify(
        adminsOf(ws),
        ws.id,
        !drive.length
          ? msg('Old chat messages are now deleted every day: {n} older than {period} went today.', { n: gone.length, period: periodPhrase(chat.history) })
          : drive.length === 1
            ? msg('Old chat messages are now deleted every day: {n} older than {period} went today, and their 1 file is in Drive.', { n: gone.length, period: periodPhrase(chat.history) })
            : msg('Old chat messages are now deleted every day: {n} older than {period} went today, and their {files} files are in Drive.', { n: gone.length, period: periodPhrase(chat.history), files: drive.length }),
        { app: 'settings', id: 'apps' },
      );
    out.push({ workspaceId: ws.id, deleted: gone.length, files: drive.length });
  }
  return out;
}
