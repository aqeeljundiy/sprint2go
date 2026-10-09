// Outside calendars that work without anyone signing in anywhere:
// - Calendar links: a person pastes a private .ics or webcal:// address (Google's "secret address in iCal format",
//   Outlook's published ICS link, an iCloud public calendar, a booking tool). The server reads it now, every 30
//   minutes and on demand, and keeps its events (90 days back, a year ahead) as read-only events of that person.
//   Teammates see them only as the owner chose (busy, details, or nothing), shaped here before they leave the server.
// - Public holidays: a company picks its country; everyone in it gets the public holidays as all-day items.
//   Read from Google's public holiday calendars (no key), cached per country, refreshed once a day.
import { createHash, randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { expand, parseCalendar, type Occurrence } from './ics.ts';
import { FetchError, normalizeUrl, safeGet } from './safeFetch.ts';
import { findMeetingLink } from '../src/meetingLinks.ts';
import { holidayCalendarId, holidayCountry, holidayFeedUrl } from '../src/data/holidays.ts';
import { calendarLinkKey } from '../src/calendarLink.ts';

type Doc = db.Doc;
type Broadcast = (coll: string, upserts: Doc[], deletes: string[], except?: string, deleted?: Doc[]) => void;
let broadcast: Broadcast = () => {};

const DAY = 86_400_000;
const REFRESH_MS = 30 * 60_000;
const MAX_LINKS = 25; // per person
const MAX_EVENTS = 4000; // per calendar
const SHARES = ['busy', 'details', 'private'];
const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#4285f4', '#0078d4', '#dc2626'];

db.db.exec('CREATE TABLE IF NOT EXISTS holiday_cache (country TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, data TEXT NOT NULL)');

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);

function eventsOf(calId: string): Doc[] {
  return (db.db.prepare("SELECT data FROM docs WHERE coll = 'events' AND json_extract(data, '$.calendarId') = ?").all(calId) as { data: string }[]).map((r) => JSON.parse(r.data));
}

/** A calendar's events become `next`: only what changed is written and sent out. */
function replaceEvents(calId: string, next: Doc[]) {
  const before = new Map(eventsOf(calId).map((e) => [e.id, e]));
  const seen = new Set<string>();
  const fresh = next.filter((d) => !seen.has(d.id) && seen.add(d.id));
  const upserts = fresh.filter((d) => JSON.stringify(before.get(d.id)) !== JSON.stringify(d));
  const keep = new Set(fresh.map((d) => d.id));
  const deletes = [...before.keys()].filter((id) => !keep.has(id));
  if (!upserts.length && !deletes.length) return;
  db.writeDocs('events', upserts, deletes, null);
  broadcast('events', upserts, deletes, undefined, deletes.map((id) => before.get(id)!));
}
function saveCalendar(doc: Doc) {
  db.writeDocs('calendars', [doc], [], null);
  broadcast('calendars', [doc], []);
}
/** A calendar and all its events go. */
function dropCalendar(calId: string) {
  const evs = eventsOf(calId);
  if (evs.length) {
    db.writeDocs('events', [], evs.map((e) => e.id), null);
    broadcast('events', [], evs.map((e) => e.id), undefined, evs);
  }
  const cal = db.getDoc('calendars', calId);
  if (cal) {
    db.writeDocs('calendars', [], [calId], null);
    broadcast('calendars', [], [calId], undefined, [cal]);
  }
}

/* ---------- calendar links ---------- */

/** Reads a calendar link: its name and every occurrence from 90 days ago to a year ahead. */
async function readLink(url: string) {
  const got = await safeGet(url, { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' });
  const head = got.body.subarray(0, 4000).toString('utf8').replace(/^﻿/, '').trimStart();
  if (!/^BEGIN:VCALENDAR/i.test(head))
    throw new FetchError(/^<(!doctype|html|\?xml)|<html/i.test(head) ? 'That link opens a web page, not a calendar file. Copy the calendar’s iCal (.ics) address instead.' : 'That link isn’t a calendar file (.ics). Copy the calendar’s iCal address instead.');
  let cal;
  try {
    cal = parseCalendar(got.body);
  } catch {
    throw new FetchError('The calendar file couldn’t be read. Check that it’s the iCal (.ics) address.');
  }
  const t = Date.now();
  return { name: cal.name, occurrences: expand(cal, t - 90 * DAY, t + 365 * DAY, MAX_EVENTS) };
}

/** Some calendar apps put HTML in descriptions: plain text with its line breaks and link addresses kept. */
function plain(s: string) {
  if (!/<\/?(br|p|div|a|b|i|u|span|ul|ol|li|html|body)\b/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => (label.includes(href) ? label : `${label} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function linkEvent(cal: any, o: Occurrence, ownerEmail: string): Doc {
  const link = findMeetingLink(o.conference, o.location, o.url, o.description);
  const guests = o.attendees.filter((a) => a.email !== ownerEmail && a.status !== 'DECLINED').slice(0, 50).map((a) => ({ name: a.name || a.email.split('@')[0], email: a.email }));
  return {
    id: `${cal.id}-${hash(o.key)}`,
    calendarId: cal.id,
    userId: cal.ownerId,
    feed: 'link',
    title: o.title.slice(0, 300),
    start: o.start,
    end: o.end,
    ...(o.allDay ? { allDay: true } : {}),
    ...(o.location ? { location: o.location.slice(0, 500) } : {}),
    ...(o.description ? { notes: plain(o.description).slice(0, 4000) } : {}),
    ...(guests.length ? { guests } : {}),
    ...(link ? { meetUrl: link.url } : {}),
  };
}
const emailOf = (userId: string) => String((db.getDoc('users', userId) as any)?.email ?? '').toLowerCase();
const explain = (e: unknown) => (e instanceof FetchError ? e.message : 'The calendar couldn’t be read. It will be tried again later.');

const running = new Map<string, Promise<{ ok: boolean; error?: string }>>();
/** Reads one calendar link again now. Never throws; a failure is kept on the calendar (and told to its owner once). */
export function refreshLink(calId: string) {
  const going = running.get(calId);
  if (going) return going;
  const job = (async () => {
    const cal = db.getDoc('calendars', calId) as any;
    if (!cal || cal.source !== 'ics' || !cal.url) return { ok: false, error: 'This calendar can’t be updated from a link.' };
    const at = now();
    try {
      const { occurrences } = await readLink(cal.url);
      const cur = db.getDoc('calendars', calId) as any;
      if (!cur) return { ok: false, error: 'The calendar was removed.' };
      saveCalendar({ ...cur, syncedAt: at, checkedAt: at, error: undefined });
      replaceEvents(calId, occurrences.map((o) => linkEvent(cur, o, emailOf(cur.ownerId))));
      return { ok: true };
    } catch (e) {
      const error = explain(e);
      const cur = db.getDoc('calendars', calId) as any;
      if (!cur) return { ok: false, error };
      saveCalendar({ ...cur, checkedAt: at, error });
      if (!cur.error) tellOwner(cur, `Your calendar “${cur.name}” stopped updating. ${error}`);
      return { ok: false, error };
    }
  })().finally(() => running.delete(calId));
  running.set(calId, job);
  return job;
}

function tellOwner(cal: any, text: string) {
  const ws = (db.allDocs('workspaces') as any[]).find((w) => (w.members ?? []).some((m: any) => m.userId === cal.ownerId));
  if (!ws) return;
  const n = { id: `n-${randomBytes(6).toString('hex')}`, userId: cal.ownerId, workspaceId: ws.id, kind: 'meeting', text: text.slice(0, 240), at: now(), read: false, link: { app: 'calendar' } };
  db.writeDocs('notices', [n], [], null);
  broadcast('notices', [n], []);
}

/** Adds a calendar link for this person, after reading it once (so a wrong link is said straight away). */
export async function addLink(me: string, b: { url?: unknown; name?: unknown; color?: unknown; share?: unknown }) {
  const url = normalizeUrl(String(b.url ?? ''));
  const mine = (db.allDocs('calendars') as any[]).filter((c) => c.ownerId === me && c.source === 'ics');
  if (mine.length >= MAX_LINKS) throw new FetchError(`You have ${MAX_LINKS} calendar links, the most there can be. Remove one first.`);
  // The same link written another way (webcal or https, a trailing slash, its query in another order) is the same calendar.
  const key = calendarLinkKey(url);
  const same = mine.find((c) => c.url && calendarLinkKey(c.url) === key);
  if (same) throw new FetchError(`You’ve already added this calendar, as “${same.name}”. It updates by itself every 30 minutes.`);
  const { name, occurrences } = await readLink(url);
  const at = now();
  const cal = {
    id: `link-${randomBytes(6).toString('hex')}`,
    name: str(b.name, 80) || str(name, 80) || new URL(url).hostname.replace(/^www\./, ''),
    color: isColor(b.color) ? b.color : COLORS[mine.length % COLORS.length],
    source: 'ics',
    ownerId: me,
    readOnly: true,
    url,
    share: SHARES.includes(b.share as string) ? b.share : 'busy',
    syncedAt: at,
    checkedAt: at,
  };
  saveCalendar(cal);
  replaceEvents(cal.id, occurrences.map((o) => linkEvent(cal, o, emailOf(me))));
  const t = Date.now();
  return { calendar: cal, upcoming: occurrences.filter((o) => Date.parse(o.end) >= t).length };
}

/* ---------- public holidays ---------- */

interface Holiday {
  date: string; // YYYY-MM-DD
  end: string; // the day after it ends
  name: string;
  regions?: string; // only in these states or provinces
  tentative?: boolean;
  half?: boolean;
}

/** A country's public holidays, from the cache when it's less than a day old (or when the source is down). */
async function holidaysOf(code: string): Promise<{ list: Holiday[]; at: string; error?: string }> {
  const row = db.db.prepare('SELECT fetched_at, data FROM holiday_cache WHERE country = ?').get(code) as { fetched_at: string; data: string } | undefined;
  if (row && Date.now() - Date.parse(row.fetched_at) < DAY) return { list: JSON.parse(row.data), at: row.fetched_at };
  const country = holidayCountry(code);
  if (!country) throw new FetchError('Public holidays for that country aren’t available.');
  try {
    const got = await safeGet(holidayFeedUrl(country), { accept: 'text/calendar' });
    const year = new Date().getUTCFullYear();
    const list = expand(parseCalendar(got.body), Date.UTC(year - 1, 0, 1), Date.UTC(year + 3, 0, 1), 3000)
      .filter((o) => o.allDay && /^Public holiday/i.test(o.description ?? ''))
      .map((o) => {
        const desc = o.description ?? '';
        return {
          date: o.start.slice(0, 10),
          end: o.end.slice(0, 10),
          name: o.title,
          ...(desc.match(/^Public holiday in ([^\n]+)/i) ? { regions: desc.match(/^Public holiday in ([^\n]+)/i)![1].trim() } : {}),
          ...(/tentative/i.test(desc) ? { tentative: true } : {}),
          ...(/half-day/i.test(desc) ? { half: true } : {}),
        };
      });
    if (!list.length) throw new FetchError('No public holidays came back for this country.');
    const at = now();
    db.db.prepare('INSERT INTO holiday_cache (country, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT (country) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data').run(code, at, JSON.stringify(list));
    return { list, at };
  } catch (e) {
    // Keep showing what we had: holidays rarely move.
    if (row) return { list: JSON.parse(row.data), at: row.fetched_at, error: explain(e) };
    throw e;
  }
}

const syncingHolidays = new Map<string, Promise<void>>();
/** A company's holiday calendar follows its setting: made, refreshed, switched to another country, or removed. */
export function syncHolidays(wsId: string): Promise<void> {
  const going = syncingHolidays.get(wsId);
  if (going) return going.then(() => syncHolidays(wsId));
  const job = (async () => {
    const ws = db.getDoc('workspaces', wsId) as any;
    const calId = holidayCalendarId(wsId);
    const country = holidayCountry(ws?.holidays?.country);
    const existing = db.getDoc('calendars', calId) as any;
    if (!ws || !country) {
      if (existing) dropCalendar(calId);
      return;
    }
    const base = { id: calId, name: `Holidays in ${country.name}`, color: existing?.color ?? '#dc2626', source: 'holidays', workspaceId: wsId, readOnly: true, share: 'details', country: country.code };
    const at = now();
    try {
      const { list, at: fetchedAt, error } = await holidaysOf(country.code);
      // Still the same country? (It may have been changed while this was reading.)
      if ((db.getDoc('workspaces', wsId) as any)?.holidays?.country !== country.code) return;
      const year = new Date().getFullYear();
      const events = list
        .filter((h) => h.date >= `${year}-01-01` && h.date <= `${year + 1}-12-31`)
        .map((h) => ({
          id: `${calId}-${h.date}-${hash(h.name).slice(0, 8)}`,
          calendarId: calId,
          workspaceId: wsId,
          feed: 'holidays',
          title: h.name,
          start: `${h.date}T00:00:00`,
          end: `${h.end}T00:00:00`,
          allDay: true,
          notes: [h.regions ? `Public holiday in ${h.regions} only.` : `Public holiday in ${country.name}.`, h.half ? 'A half day.' : '', h.tentative ? 'The date may still change.' : ''].filter(Boolean).join(' '),
        }));
      saveCalendar({ ...base, syncedAt: fetchedAt, checkedAt: at, ...(error ? { error } : {}) });
      replaceEvents(calId, events);
    } catch (e) {
      // A new country we couldn't read: the old country's holidays shouldn't stay under the new name.
      if (existing && existing.country !== country.code) replaceEvents(calId, []);
      saveCalendar({ ...base, syncedAt: existing?.country === country.code ? existing.syncedAt : undefined, checkedAt: at, error: explain(e) });
    }
  })().finally(() => syncingHolidays.delete(wsId));
  syncingHolidays.set(wsId, job);
  return job;
}

/* ---------- who sees what, and who may change it ---------- */

/**
 * Calendars and events as one person may see them (undefined: not decided here, the usual company rule applies).
 * Someone's own outside calendar: everything for them; for people in a company with them, busy blocks, titles and
 * places, or nothing, as they chose. The link address itself never leaves the server except to its owner.
 */
export function lensFor(userId: string, sharesCompany: (otherUserId: string) => boolean, inCompany: (wsId: string) => boolean) {
  let cals: Map<string, any> | null = null;
  const calOf = (id: string) => (cals ??= new Map((db.allDocs('calendars') as any[]).map((c) => [c.id, c]))).get(id);
  return (coll: string, d: any): any | null | undefined => {
    if (coll === 'calendars') {
      if (d.ownerId) {
        if (d.ownerId === userId) return d;
        if (!sharesCompany(d.ownerId)) return null;
        const { url: _u, error: _e, checkedAt: _c, ...rest } = d;
        return rest;
      }
      if (d.workspaceId) return inCompany(d.workspaceId) ? d : null;
      return undefined;
    }
    if (coll === 'events') {
      const cal = d.calendarId ? calOf(d.calendarId) : undefined;
      if (!cal?.ownerId) return undefined; // the company's own calendars and holidays: by company
      if (cal.ownerId === userId) return d;
      if (!sharesCompany(cal.ownerId)) return null;
      const share = cal.share ?? 'busy';
      if (share === 'private') return null;
      if (share === 'busy') return { id: d.id, calendarId: d.calendarId, userId: d.userId ?? cal.ownerId, title: 'Busy', start: d.start, end: d.end, ...(d.allDay ? { allDay: true } : {}), ...(d.feed ? { feed: d.feed } : {}), busy: true };
      const { notes: _n, guests: _g, meetUrl: _m, threadId: _t, ...rest } = d;
      return rest;
    }
    return undefined;
  };
}

const shareChanged = new Set<string>();
/**
 * A change sent from someone's app (/api/sync). 'pass': not ours to judge. null: refused. A document: what to store.
 * Events from links and holidays are the server's; outside calendars are their owner's; holidays are set in Settings.
 */
export function checkWrite(coll: string, d: any, me: string, demo: boolean): Doc | null | 'pass' {
  if (coll === 'events') {
    const before = db.getDoc('events', d.id) as any;
    if (before?.feed || d.feed) return null;
    for (const calId of [d.calendarId, before?.calendarId]) {
      const cal = calId ? (db.getDoc('calendars', calId) as any) : undefined;
      if (cal?.ownerId && cal.ownerId !== me) return null;
      if (cal?.source === 'holidays' || cal?.source === 'ics') return null;
    }
    return 'pass';
  }
  if (coll !== 'calendars') return 'pass';
  const before = db.getDoc('calendars', d.id) as any;
  if (before) {
    if (before.workspaceId && before.source === 'holidays') return null; // changed in Settings, by admins
    if (before.ownerId && before.ownerId !== me) return null;
    const share = SHARES.includes(d.share) ? d.share : before.share;
    if (share !== before.share) shareChanged.add(before.id);
    // Links: name, colour and sharing are theirs; the address and sync state are the server's.
    if (before.source === 'ics') return { ...before, name: str(d.name, 80) || before.name, color: isColor(d.color) ? d.color : before.color, share };
    return { ...d, ownerId: before.ownerId ?? me, share };
  }
  if (d.source === 'holidays') return null; // a company's holidays come from its setting
  if (d.source === 'ics') {
    // Put back after "Undo": read again straight away.
    let url: string;
    try {
      url = normalizeUrl(String(d.url ?? ''));
    } catch {
      return null;
    }
    return { id: d.id, name: str(d.name, 80) || 'Calendar', color: isColor(d.color) ? d.color : COLORS[0], source: 'ics', ownerId: me, readOnly: true, url, share: SHARES.includes(d.share) ? d.share : 'busy' };
  }
  // Google, Outlook and iCloud connections aren't real yet: only the demo may pretend.
  if ((d.source === 'google' || d.source === 'microsoft' || d.source === 'icloud') && !demo) return null;
  return { ...d, ownerId: me };
}

/** May this person delete it? Link and holiday events go with their calendar; holidays are switched off in Settings. */
export function mayDelete(coll: string, before: any, me: string) {
  if (coll === 'events') {
    if (before.feed) return false;
    const cal = before.calendarId ? (db.getDoc('calendars', before.calendarId) as any) : undefined;
    return !(cal?.ownerId && cal.ownerId !== me);
  }
  if (coll === 'calendars') return !(before.workspaceId && before.source === 'holidays') && (!before.ownerId || before.ownerId === me);
  return true;
}

/** After a change from someone's app is stored: removed calendars take their events, put-back links are read again. */
export function afterSync(coll: string, upserts: Doc[], deleted: Doc[]) {
  if (coll !== 'calendars') return;
  for (const c of deleted) {
    const evs = eventsOf(c.id);
    if (evs.length) {
      db.writeDocs('events', [], evs.map((e) => e.id), null);
      broadcast('events', [], evs.map((e) => e.id), undefined, evs);
    }
  }
  for (const c of upserts as any[]) {
    if (c.source === 'ics' && !c.syncedAt) void refreshLink(c.id);
    // Sharing changed: teammates get the events again, shaped the new way.
    if (shareChanged.delete(c.id)) {
      const evs = eventsOf(c.id);
      if (evs.length) broadcast('events', evs, []);
    }
  }
}

/** A deleted account: its outside calendars, their addresses and events go. */
export function forgetPerson(userId: string) {
  for (const c of db.allDocs('calendars') as any[]) if (c.ownerId === userId) dropCalendar(c.id);
}

/* ---------- the schedule ---------- */

async function refreshDue() {
  const t = Date.now();
  const due = (db.allDocs('calendars') as any[]).filter((c) => c.source === 'ics' && c.url && t - (Date.parse(c.checkedAt ?? c.syncedAt ?? '') || 0) >= REFRESH_MS - 60_000);
  for (const c of due) await refreshLink(c.id).catch(() => null); // one at a time: gentle on us and on them
}
async function refreshHolidays() {
  for (const w of db.allDocs('workspaces') as any[]) if (w.holidays?.country || db.getDoc('calendars', holidayCalendarId(w.id))) await syncHolidays(w.id).catch(() => null);
}

export function startCalendarFeeds(opts: { broadcast: Broadcast }) {
  broadcast = opts.broadcast;
  // Before public holidays were a company setting, the demo had personal holiday calendars: they go.
  for (const c of db.allDocs('calendars') as any[]) if (c.source === 'holidays' && !c.workspaceId) dropCalendar(c.id);
  setTimeout(() => void refreshHolidays(), 15_000);
  setTimeout(() => void refreshDue(), 30_000);
  setInterval(() => void refreshDue(), 5 * 60_000);
  setInterval(() => void refreshHolidays(), 6 * 60 * 60_000);
}
