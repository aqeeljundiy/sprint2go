// What a connected AI app can read and do in sprint2go (server/connector.ts serves them at /mcp).
// One rule above all: a tool sees what the person sees in the company they connected, through the app's own lens
// (index.ts teamLens, or their demo company), and changes things only through the app's own save (index.ts applySync),
// so permissions, read-only companies and the demo company work exactly as in the app. Nothing leaves the company
// from here: mail is always a draft, and a message to a channel with guests is a draft the person sends themselves.
// Results are compact JSON for a model: ids, titles, dates in the company's time zone, and a link into the app.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as db from './db.ts';
import * as sandbox from './sandbox.ts';
import { cleanStages, stageName, stageOf, stageIdFor } from '../src/stages.ts';
import { needsYou, updatesOf } from '../src/needsYou.ts';
import { templateValues } from '../src/components/tables/core.ts';
import { addDays, companyTz, localParts, zonedTime } from '../src/jobTimes.ts';
import type { CalEvent, StageKind, TaskStage } from '../src/types.ts';
import { expandEvents, repeatWords, specToRule, startOnRule, type RepeatSpec } from '../src/repeat.ts';
import { parseRRule } from '../src/recurrence.ts';
import { msg, phrase } from '../src/i18n/index.ts';
import { chatRecipients, isGroupDm } from '../src/chatFollow.ts';
import { noticeWords, whereOf } from './chatLater.ts';
import { labelPath, type MailLabel } from '../src/mailFilterMatch.ts';
import { matchThread, parseQuery } from '../src/mailQuery.ts';

export interface ToolDeps {
  /** What one person may see of a document (null: nothing), as the app shows it to them (index.ts teamLens). */
  lens: (userId: string) => (coll: string, d: any) => any | null;
  /** Saves as that person, through every rule the app's own saves pass (index.ts applySync). */
  write: (userId: string, coll: string, upserts: any[], deletes?: string[]) => { status: number; body: { saved?: number; why?: string; error?: string } };
}
export interface ToolCtx {
  userId: string;
  wsId: string;
  demo: boolean;
  app: string; // "Claude", as the app registered itself
  grantId: string;
  company: string;
  origin: string;
}

/** A plain "no" the AI can pass on (a project you can't see, a field that doesn't exist). */
class Refusal extends Error {}
const no = (text: string): never => {
  throw new Refusal(text);
};

type Doc = Record<string, any>;
const doers = (t: Doc): string[] => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
/** "820 KB", "1.4 MB": a file's size the way people say it. */
const fileSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const lower = (s: unknown) => String(s ?? '').toLowerCase();
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
/** A note's or an email's HTML as readable text: headings, lists and paragraphs kept as lines. */
export function htmlToText(html: string) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h\d|li|blockquote|ul|ol|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Bold, italics and links in one line of text the AI wrote (only http and https links). */
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
/** Text the AI wrote (headings with #, lists with - or 1.) as the simple HTML the notes editor uses. */
export function textToHtml(text: string) {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => (para.length && out.push(`<p>${para.map(inline).join('<br>')}</p>`), (para = []));
  const closeList = () => (list && out.push(`</${list}>`), (list = null));
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if (h) {
      flushPara();
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) (closeList(), out.push(`<${kind}>`), (list = kind));
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}

const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string, withTime: boolean) => {
  const key = `${tz}|${withTime}`;
  let f = fmts.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) });
    fmts.set(key, f);
  }
  return f;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Everything one tool call reads: the person's view of their company, worked out once per call. */
class View {
  private cache = new Map<string, Doc[]>();
  private see: ((coll: string, d: any) => any) | null = null;
  private demoDocs: Record<string, Doc[]> | null = null;
  private wsDoc: Doc | null | undefined;
  readonly deps: ToolDeps;
  readonly ctx: ToolCtx;
  constructor(deps: ToolDeps, ctx: ToolCtx) {
    this.deps = deps;
    this.ctx = ctx;
  }
  get me() {
    return this.ctx.userId;
  }
  ws(): Doc {
    if (this.wsDoc === undefined) this.wsDoc = (this.ctx.demo ? sandbox.getDoc(this.me, 'workspaces', this.ctx.wsId) : db.getDoc('workspaces', this.ctx.wsId)) ?? null;
    return this.wsDoc ?? no('This company is gone. Connect again and pick another one.');
  }
  tz() {
    return companyTz(this.ws());
  }
  stages(): TaskStage[] {
    return cleanStages(this.ws().taskStages);
  }
  /** A task's stages, as in the app: its project's own, else its team's own, else the company's. */
  stagesFor(scope: { clientId?: string; teamId?: string }): TaskStage[] {
    const own = (coll: string, id?: string) => (id ? this.docs(coll).find((d) => d.id === id)?.taskStages : undefined);
    const list = own('clients', scope.clientId) ?? own('teams', scope.teamId);
    return Array.isArray(list) && list.length ? cleanStages(list) : this.stages();
  }
  role(): string {
    return (this.ws().members ?? []).find((m: Doc) => m.userId === this.me)?.role ?? 'member';
  }
  today() {
    return localParts(Date.now(), this.tz()).day;
  }
  /** The person's view of one collection, in this company only. */
  docs(coll: string): Doc[] {
    const hit = this.cache.get(coll);
    if (hit) return hit;
    let list: Doc[];
    if (this.ctx.demo) {
      this.demoDocs ??= sandbox.docsOf(this.me);
      list = [...(this.demoDocs[coll] ?? [])];
      if (coll === 'users') {
        const self = db.getDoc('users', this.me);
        if (self) list.push(self);
      }
    } else {
      const see = (this.see ??= this.deps.lens(this.me));
      const all = db.allDocs('workspaces') as Doc[];
      const firstWs = (all.find((w) => w.id === 'pnp') ?? all[0])?.id; // older documents without a company belong to the first (as in the app)
      const wsId = this.ctx.wsId;
      const inWs = (d: Doc) => (typeof d.workspaceId === 'string' ? d.workspaceId : firstWs) === wsId;
      const ids = (c: string) => new Set(this.docs(c).map((x) => x.id));
      let keep: (d: Doc) => boolean = inWs;
      if (coll === 'users') keep = () => true;
      else if (coll === 'workspaces') keep = (d) => d.id === wsId;
      else if (coll === 'notices') keep = (d) => d.userId === this.me && d.workspaceId === wsId;
      else if (coll === 'threads') {
        const boxes = new Set((this.ws().accounts ?? []).map((a: Doc) => a.id));
        keep = (d) => boxes.has(d.accountId);
      } else if (coll === 'messages') {
        const chans = ids('channels');
        keep = (d) => chans.has(d.channelId);
      } else if (coll === 'rows') {
        const tables = ids('tables');
        keep = (d) => tables.has(d.tableId);
      } else if (coll === 'calendars') keep = (d) => (d.workspaceId ? d.workspaceId === wsId : !!d.ownerId);
      else if (coll === 'events') {
        const cals = new Map(this.docs('calendars').map((c) => [c.id, c]));
        keep = (d) => (d.feed === 'holidays' ? d.workspaceId === wsId : cals.get(d.calendarId)?.ownerId ? true : inWs(d));
      }
      list = (db.allDocs(coll) as Doc[]).map((d) => see(coll, d)).filter((d): d is Doc => !!d && keep(d));
    }
    // Notes in Recently deleted are only for the app (restore or delete for good).
    if (coll === 'notes') list = list.filter((d) => !d.deletedAt);
    this.cache.set(coll, list);
    return list;
  }
  user(id: string | undefined | null): Doc | undefined {
    return id ? this.docs('users').find((u) => u.id === id) : undefined;
  }
  nameOf = (id: string | undefined | null) => (id ? (this.user(id)?.name ?? (id.includes('@') ? id : 'Someone')) : '');
  firstOf = (id: string | undefined | null) => this.nameOf(id).split(' ')[0];
  /** The people on the company's team (not guests), with their role. */
  members(): (Doc & { role: string })[] {
    return (this.ws().members ?? []).map((m: Doc) => ({ ...(this.user(m.userId) ?? { id: m.userId, name: 'Someone' }), role: m.role })).filter((u: Doc) => !u.deletedAt);
  }
  /** The mailboxes this person opens in this company. */
  mailboxes(): Doc[] {
    return (this.ws().accounts ?? []).filter((a: Doc) => (a.users ?? []).includes(this.me));
  }
  mine = (email: string) => this.mailboxes().some((a) => lower(a.email) === lower(email));
  /** A link that opens the item in sprint2go (switching to this company first). */
  link(app: string, id?: string, msg?: string) {
    const q = new URLSearchParams({ ws: this.ctx.wsId, ...(id ? { id } : {}), ...(msg ? { msg } : {}) });
    return `${this.ctx.origin}/${app}?${q}`;
  }
  when(iso: string | undefined, allDay = false) {
    if (!iso || Number.isNaN(Date.parse(iso))) return undefined;
    return fmt(this.tz(), !allDay).format(new Date(iso));
  }
  time(iso: string) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.tz(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  dayOf(iso: string) {
    return localParts(Date.parse(iso), this.tz()).day;
  }
  newId() {
    const id = randomBytes(8).toString('hex');
    return this.ctx.demo ? `${this.ctx.wsId}-ai${id}` : `ai${id}`;
  }
  /** Whose calendar an event is on: its person, or the owner of the outside calendar it came from. */
  ownerOf(e: Doc): string {
    // Events from before events had a person belong to the first demo seat, as in the app (App.tsx visibleEvents).
    return e.userId ?? this.docs('calendars').find((c) => c.id === e.calendarId)?.ownerId ?? 'u-aqeel';
  }
  /** My events in this company as the calendar shows them, and the company's holidays. */
  myEvents(): Doc[] {
    return this.docs('events').filter((e) => e.feed === 'holidays' || this.ownerOf(e) === this.me);
  }

  /* ---------- finding things by name or id ---------- */

  person(q: string): Doc {
    const s = lower(q).trim();
    const people = this.members();
    if (['me', 'myself', 'you', 'i'].includes(s)) return people.find((u) => u.id === this.me) ?? no('You aren’t on this company’s team.');
    const hit = people.find((u) => u.id === q || lower(u.email) === s) ?? people.find((u) => lower(u.name) === s);
    if (hit) return hit;
    const some = people.filter((u) => lower(u.name).split(' ').includes(s) || lower(u.name).startsWith(s));
    if (some.length === 1) return some[0];
    return no(some.length ? `“${q}” could be ${some.map((u) => u.name).join(' or ')}. Use their full name or id.` : `Nobody called “${q}” is on the team at ${this.ctx.company}. about_company lists the people.`);
  }
  project(q: string): Doc {
    const list = this.docs('clients');
    const s = lower(q).trim();
    const hit = list.find((c) => c.id === q) ?? list.find((c) => lower(c.name) === s);
    if (hit) return hit;
    const some = list.filter((c) => lower(c.name).includes(s));
    if (some.length === 1) return some[0];
    return no(some.length ? `“${q}” could be ${some.map((c) => c.name).join(' or ')}.` : `No project called “${q}” that you can see. about_company lists yours.`);
  }
  team(q: string): Doc {
    const list = this.docs('teams');
    const s = lower(q).trim();
    return list.find((t) => t.id === q) ?? list.find((t) => lower(t.name) === s) ?? (list.filter((t) => lower(t.name).includes(s)).length === 1 ? list.find((t) => lower(t.name).includes(s))! : no(`No team called “${q}”. about_company lists the teams.`));
  }
  channel(q: string): Doc {
    const list = this.docs('channels');
    const s = lower(q).trim().replace(/^#/, '');
    const hit = list.find((c) => c.id === q) ?? list.find((c) => c.kind === 'channel' && lower(c.name) === s);
    if (hit) return hit;
    // Several names ("Rizky, Faisal and Nanda"): your group message with exactly those people.
    const names = s.split(/\s*(?:,|&|\band\b|\bdan\b)\s*/).map((x) => x.trim()).filter(Boolean);
    if (names.length > 1) {
      const ids = names.map((n) => this.person(n).id).filter((id) => id !== this.me);
      const want = new Set([this.me, ...ids]);
      const group = list.find((c) => c.kind === 'dm' && c.members.length === want.size && c.members.every((m: string) => want.has(m)));
      return group ?? no(`You don’t have a group message with ${names.join(', ')} yet. Start it in sprint2go first.`);
    }
    // A person's name: your direct messages with them.
    const people = this.members().filter((u) => u.id !== this.me && (lower(u.name) === s || lower(u.name).split(' ')[0] === s || lower(u.email) === s));
    if (people.length === 1) {
      const dm = list.find((c) => c.kind === 'dm' && c.members.length === 2 && c.members.includes(this.me) && c.members.includes(people[0].id));
      if (dm) return dm;
      return no(`You don’t have a direct message with ${people[0].name} yet. Start it in sprint2go first.`);
    }
    const some = list.filter((c) => c.kind === 'channel' && lower(c.name).includes(s));
    if (some.length === 1) return some[0];
    return no(some.length ? `“${q}” could be ${some.map((c) => `#${c.name}`).join(' or ')}.` : `No channel called “${q}” that you can see. list_channels shows them.`);
  }
  table(q: string): Doc {
    const list = this.docs('tables');
    const s = lower(q).trim();
    const hit = list.find((t) => t.id === q) ?? list.find((t) => lower(t.name) === s);
    if (hit) return hit;
    const some = list.filter((t) => lower(t.name).includes(s));
    if (some.length === 1) return some[0];
    return no(some.length ? `“${q}” could be ${some.map((t) => t.name).join(' or ')}.` : `No table called “${q}” that you can see. list_tables shows them.`);
  }
  stage(q: string, list: TaskStage[] = this.stages()): TaskStage {
    const s = lower(q).trim();
    const hit = list.find((x) => x.id === q) ?? list.find((x) => lower(stageName(x)) === s);
    if (hit) return hit;
    const kinds: [RegExp, StageKind][] = [
      [/^(to ?do|not started|open|new|backlog)$/, 'open'],
      [/^(in progress|doing|started|active|working)$/, 'active'],
      [/^(waiting|blocked|on hold|waiting on (the )?(client|guest|them))$/, 'waiting'],
      [/^(review|in review|needs review|check)$/, 'review'],
      [/^(done|finished|complete|completed|closed)$/, 'done'],
    ];
    const kind = kinds.find(([re]) => re.test(s))?.[1];
    const byKind = kind ? list.find((x) => x.kind === kind) : undefined;
    return byKind ?? no(`No stage called “${q}”. The stages are: ${list.map((x) => stageName(x)).join(', ')}.`);
  }
  task(id: string): Doc {
    return this.docs('todos').find((t) => t.id === id) ?? no(`No task ${id} that you can see in ${this.ctx.company}.`);
  }
  mailbox(q?: string): Doc {
    const boxes = this.mailboxes();
    if (!boxes.length) return no(`You don’t have a mailbox in ${this.ctx.company}.`);
    if (!q) return boxes.find((a) => a.kind === 'personal') ?? boxes[0];
    return boxes.find((a) => a.id === q || lower(a.email) === lower(q)) ?? no(`“${q}” isn’t one of your mailboxes. Yours: ${boxes.map((a) => a.email).join(', ')}.`);
  }

  /* ---------- saving ---------- */

  /** Saves as the person; a refusal says why in the app's words. Returns a note when it was kept differently. */
  save(coll: string, docs: Doc[], audit?: string): string | undefined {
    const r = this.deps.write(this.me, coll, docs, []);
    if (r.status !== 200) no(r.body.error ?? 'sprint2go couldn’t save that. Try again.');
    if ((r.body.saved ?? 0) < docs.length) no(r.body.why ?? 'sprint2go didn’t save that: it isn’t something you can change here.');
    if (audit && !this.ctx.demo) db.audit(String(this.user(this.me)?.email || this.me), `ai-app.${coll}`, this.ctx.wsId, `via ${this.ctx.app}: ${audit}`.slice(0, 300));
    return r.body.why;
  }
  /** Notices in teammates' bells (the same kinds the app sends). Never to guests, and never stops the change itself. */
  notify(userIds: string[], kind: string, text: { text: string; tr?: unknown }, link: Doc) {
    const team = new Set(this.members().map((u) => u.id));
    const at = new Date().toISOString();
    // Saved with msg(): each teammate reads it in their own language (src/i18n).
    const notes = [...new Set(userIds)].filter((id) => id && id !== this.me && team.has(id)).map((userId) => ({ id: this.newId(), userId, workspaceId: this.ctx.wsId, kind, text: text.text.slice(0, 300), ...(text.tr ? { tr: text.tr } : {}), at, read: false, link }));
    if (notes.length) this.deps.write(this.me, 'notices', notes, []);
  }
}

/* ---------- shaping what goes back to the AI ---------- */

function taskLine(v: View, t: Doc) {
  const s = stageOf(t as any, v.stagesFor(t));
  const today = v.today();
  return {
    id: t.id,
    title: t.title,
    ...(t.kind === 'brief' ? { brief: true } : {}),
    stage: stageName(s),
    ...(t.done ? { done: true } : {}),
    ...(t.due ? { due: t.due } : {}),
    ...(!t.done && t.due && t.due < today ? { late: true } : {}),
    ...(t.priority === 'high' ? { priority: 'high' } : {}),
    assignees: doers(t).map(v.nameOf),
    ...(t.clientId ? { project: v.docs('clients').find((c) => c.id === t.clientId)?.name ?? 'a project' } : {}),
    ...(t.teamId ? { team: v.docs('teams').find((x) => x.id === t.teamId)?.name } : {}),
    link: v.link('tasks', t.id),
  };
}
const lastOf = (t: Doc) => (t.messages ?? [])[(t.messages ?? []).length - 1] ?? {};
/** A conversation's labels by their whole name, from the labels this person sees. */
function labelsOfThread(v: View, t: Doc): string[] {
  if (!t.labels?.length) return [];
  const all = v.docs('mailLabels') as unknown as MailLabel[];
  return (t.labels as string[]).map((id) => all.find((l) => l.id === id)).filter((l): l is MailLabel => !!l).map((l) => labelPath(l, all));
}
function threadLine(v: View, t: Doc) {
  const last = lastOf(t);
  return {
    id: t.id,
    subject: t.subject,
    mailbox: (v.ws().accounts ?? []).find((a: Doc) => a.id === t.accountId)?.email,
    from: last.from ? `${last.from.name || last.from.email} <${last.from.email}>` : undefined,
    date: v.when(last.date),
    ...(t.unread ? { unread: true } : {}),
    ...(t.location !== 'inbox' ? { folder: t.location } : {}),
    messages: (t.messages ?? []).length,
    ...(t.assignee ? { assignee: v.nameOf(t.assignee) } : {}),
    // Labels by their whole name ("Clients/KopiKita"), and the filter that filed it (server/mailFilters.ts).
    ...(labelsOfThread(v, t).length ? { labels: labelsOfThread(v, t) } : {}),
    ...(t.filed?.length ? { filed_by: t.filed[t.filed.length - 1].scope === 'block' ? 'a blocked sender' : t.filed[t.filed.length - 1].name } : {}),
    snippet: clip(last.body, 140),
    link: v.link('mail', t.id),
  };
}
function channelName(v: View, c: Doc) {
  if (c.kind !== 'dm') return `#${c.name}`;
  const others = [...(c.members ?? []).filter((m: string) => m !== v.me).map(v.nameOf), ...(c.guests ?? []).map((g: Doc) => `${g.name || g.email} (guest)`)];
  return `${isGroupDm(c as any) ? 'Group message' : 'Direct message'} with ${others.join(', ') || 'yourself'}`;
}
/** A channel whose messages reach people outside the company: guests, or another company it's shared with. */
const reachesGuests = (c: Doc) => (c.guests ?? []).length > 0 || !!c.sharedWith;
function messageLine(v: View, c: Doc, m: Doc, replies: number) {
  const guest = m.guestEmail ? (c.guests ?? []).find((g: Doc) => lower(g.email) === lower(m.guestEmail)) : null;
  const reactions = Object.entries((m.reactions ?? {}) as Record<string, string[]>).filter(([, who]) => who.length).map(([e, who]) => `${e} ${who.length}`);
  return {
    id: m.id,
    who: m.guestEmail ? `${guest?.name ?? m.guestEmail} (guest)` : m.kind === 'summary' ? 'sprint2go summary' : v.nameOf(m.userId),
    at: v.when(m.at),
    text: clip(m.voice?.transcript ? `[voice note] ${m.voice.transcript}` : m.text, 2000),
    ...(m.files?.length ? { files: m.files.map((f: Doc) => f.name) } : {}),
    ...(m.poll ? { poll: { question: m.poll.question, options: m.poll.options.map((o: Doc) => `${o.text} (${o.votes.length})`) } } : {}),
    ...(replies ? { replies } : {}),
    ...(reactions.length ? { reactions } : {}),
    ...(m.taskId ? { task_id: m.taskId } : {}),
  };
}
/** A table cell as words: choices by their label, people by name, linked rows by their name. */
function cell(v: View, t: Doc, f: Doc, r: Doc): unknown {
  const val = r.values?.[f.id];
  switch (f.type) {
    case 'select':
      return (f.options ?? []).find((o: Doc) => o.id === val)?.label ?? (val || undefined);
    case 'multi':
      return Array.isArray(val) && val.length ? val.map((x) => (f.options ?? []).find((o: Doc) => o.id === x)?.label ?? x) : undefined;
    case 'person':
      return typeof val === 'string' && val ? v.nameOf(val) : undefined;
    case 'checkbox':
      return !!val;
    case 'files':
      return Array.isArray(val) && val.length ? val.map((x: Doc) => x?.name).filter(Boolean) : undefined;
    case 'link': {
      if (!Array.isArray(val) || !val.length) return undefined;
      const other = v.docs('tables').find((x) => x.id === f.linkTable);
      const rows = v.docs('rows');
      return val.map((id) => {
        const row = rows.find((x) => x.id === id);
        return row && other ? String(row.values?.[other.fields?.[0]?.id] ?? id) : id;
      });
    }
    case 'created':
      return v.when(r.createdAt);
    case 'edited':
      return v.when(r.updatedAt);
    case 'creator':
      return v.nameOf(r.createdBy) || r.createdBy;
    case 'button':
      return undefined;
    default:
      return val === null || val === '' ? undefined : val;
  }
}
function rowLine(v: View, t: Doc, r: Doc) {
  const values: Record<string, unknown> = {};
  for (const f of t.fields ?? []) {
    const c = cell(v, t, f, r);
    if (c !== undefined && !(Array.isArray(c) && !c.length)) values[f.name] = c;
  }
  return { id: r.id, name: String(r.values?.[t.fields?.[0]?.id] ?? ''), values, updated: v.when(r.updatedAt), link: v.link('tables', t.id, r.id) };
}
/** A value the AI gave for a table field, as the table stores it; a clear "no" for what can't be set from here. */
function toCell(v: View, f: Doc, given: unknown, rows: Doc[], tables: Doc[]): unknown {
  if (given === null || given === '') return null;
  const s = Array.isArray(given) ? given.map(String) : [String(given)];
  switch (f.type) {
    case 'text':
    case 'longtext':
    case 'email':
    case 'phone':
    case 'url':
      return String(given).slice(0, f.type === 'longtext' ? 20_000 : 2000);
    case 'number':
    case 'money':
    case 'rating': {
      const n = Number(given);
      if (!Number.isFinite(n)) no(`${f.name} takes a number.`);
      return f.type === 'rating' ? Math.max(0, Math.min(f.max ?? 5, Math.round(n))) : n;
    }
    case 'date':
      if (typeof given !== 'string' || !validDay(given.slice(0, 10))) no(`${f.name} takes a date as YYYY-MM-DD.`);
      return String(given).slice(0, 10);
    case 'checkbox':
      return given === true || /^(true|yes|y|1|checked|done)$/i.test(String(given));
    case 'select':
    case 'multi': {
      const ids = s.flatMap((x) => (f.type === 'multi' && !Array.isArray(given) ? x.split(',') : [x])).map((x) => x.trim()).filter(Boolean).map((x) => {
        const o = (f.options ?? []).find((o: Doc) => o.id === x || lower(o.label) === lower(x));
        return o ? o.id : no(`${f.name} has no choice “${x}”. Its choices: ${(f.options ?? []).map((o: Doc) => o.label).join(', ') || 'none yet'}. New choices are added in sprint2go.`);
      });
      return f.type === 'select' ? (ids[0] ?? null) : ids;
    }
    case 'person':
      return v.person(s[0]).id;
    case 'link': {
      const other = tables.find((x) => x.id === f.linkTable) ?? no(`${f.name} links to a table you can’t see.`);
      const nameField = other.fields?.[0]?.id;
      return s.flatMap((x) => (Array.isArray(given) ? [x] : x.split(','))).map((x) => x.trim()).filter(Boolean).map((x) => {
        const row = rows.find((r) => r.tableId === other.id && (r.id === x || lower(r.values?.[nameField]) === lower(x)));
        return row ? row.id : no(`No row “${x}” in ${other.name}.`);
      });
    }
    default:
      return no(`${f.name} (${f.type}) can’t be set from here. Change it in sprint2go.`);
  }
}

/* ---------- the tools ---------- */

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).optional().describe(`How many at most (default ${dflt}, up to ${max})`);

export function registerTools(server: McpServer, deps: ToolDeps, ctx: ToolCtx) {
  const tool = <S extends z.ZodRawShape>(name: string, config: { title: string; description: string; inputSchema: S; annotations: Record<string, boolean> }, run: (args: z.infer<z.ZodObject<S>>, v: View) => unknown) =>
    server.registerTool(name, config as any, (async (args: any) => {
      try {
        const out = run(args ?? {}, new View(deps, ctx));
        return { content: [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out) }] };
      } catch (e) {
        if (e instanceof Refusal) return { isError: true, content: [{ type: 'text' as const, text: e.message }] };
        console.error(`[mcp] ${name}`, e instanceof Error ? e.stack : e);
        return { isError: true, content: [{ type: 'text' as const, text: 'Something went wrong in sprint2go. Try again in a moment.' }] };
      }
    }) as any);

  /* ---------- reading ---------- */

  tool(
    'about_company',
    {
      title: 'About the company',
      description: 'The company this connection reaches: you, its people, teams, the projects you can see, task stages, your mailboxes, its time zone and today’s date. Use it to find names and ids for the other tools.',
      inputSchema: {},
      annotations: READ,
    },
    (_a, v) => {
      const ws = v.ws();
      const me = v.user(v.me);
      return {
        company: { id: ws.id, name: ws.name, ...(v.ctx.demo ? { demo: 'Your private demo company: made-up people and data, nothing in it is real or leaves it.' } : {}), time_zone: v.tz(), today: v.today(), work_is_called: ws.terms?.word === 'client' ? 'clients' : 'projects', link: `${v.ctx.origin}/` },
        you: { id: v.me, name: me?.name, email: me?.email, role: v.role() },
        people: v.members().map((u) => ({ id: u.id, name: u.name, email: u.email, ...(u.title ? { title: u.title } : {}), role: u.role })),
        teams: v.docs('teams').map((t) => ({ id: t.id, name: t.name, ...(t.leadId ? { lead: v.nameOf(t.leadId) } : {}), members: (t.members ?? []).map(v.nameOf) })),
        projects: v.docs('clients').map((c) => ({ id: c.id, name: c.name, status: c.status, ...(c.type ? { type: c.type } : {}), lead: v.nameOf(c.ownerId), ...((c.people ?? []).length ? { guests: c.people.length } : {}), link: v.link('projects', c.id) })),
        task_stages: v.stages().map((s) => ({ id: s.id, name: stageName(s), kind: s.kind })),
        mailboxes: v.mailboxes().map((a) => ({ id: a.id, email: a.email, kind: a.kind })),
      };
    },
  );

  tool(
    'needs_me',
    {
      title: 'What needs me',
      description: 'What needs you now, most urgent first, the same list as sprint2go’s Home: meetings starting soon, work waiting for your review, guests asking for changes, new guest requests, mentions, guests writing, news about your own open tasks, your late tasks and tasks due today, team queues you run, work you handed out that is late, client mail waiting for a reply, finished briefs to close. Also your other unread notifications.',
      inputSchema: {},
      annotations: READ,
    },
    (_a, v) => {
      // The same rules as Home's "Needs you" (src/needsYou.ts), so Claude and the app list the same things.
      const today = v.today();
      const tasks = v.docs('todos');
      // Repeating events as their dates around now (a meeting starting soon is one date of one).
      const events = expandEvents(v.myEvents() as unknown as CalEvent[], Date.now() - 6 * 3_600_000, Date.now() + 3_600_000) as unknown as Doc[];
      const notices = v.docs('notices');
      const boxes = v.mailboxes();
      const threads = v.docs('threads').filter((t) => boxes.some((a) => a.id === t.accountId));
      const items = needsYou({
        me: v.me,
        today,
        now: Date.now(),
        tasks: tasks as any,
        stageKind: (t) => stageOf(t as any, v.stagesFor(t as any)).kind,
        teams: v.docs('teams') as any,
        clients: v.docs('clients') as any,
        isOwner: v.role() === 'owner',
        firstName: (id) => v.firstOf(id),
        events: events as any,
        threads: threads.map((t) => ({ ...t, messages: (t.messages ?? []).filter((m: Doc) => m.from?.email) })) as any,
        mine: v.mine,
        notices: notices as any,
        minutes: (iso) => v.time(iso),
      });
      const WORD: Partial<Record<string, string>> = { today: 'due today', queue: 'team queue', guest: 'guest reply', changes: 'changes asked', assigned: 'about your task' };
      const needs = items.slice(0, 40).map((x) => {
        const head = { kind: WORD[x.kind] ?? x.kind, why: x.sub };
        const e = x.eventId ? events.find((ev) => ev.id === x.eventId) : undefined;
        if (e) return { ...head, id: e.id, title: e.title, ...(e.meetUrl ? { join: e.meetUrl } : {}), link: v.link('calendar', e.id) };
        const t = x.taskId && x.kind !== 'assigned' ? tasks.find((d) => d.id === x.taskId) : undefined;
        if (t) return { ...head, ...taskLine(v, t) };
        const th = x.threadId ? threads.find((d) => d.id === x.threadId) : undefined;
        if (th) return { ...head, ...threadLine(v, th) };
        return { ...head, text: x.text, at: v.when(x.at), ...(x.link?.app ? { link: v.link(x.link.app === 'settings' ? 'settings' : x.link.app, x.link.id, x.link.msg) } : {}) };
      });
      const rest = updatesOf(notices as any[], items)
        .slice(0, 15)
        .map((n) => ({ text: n.text, at: v.when(n.at), ...(n.link?.app ? { link: v.link(n.link.app === 'settings' ? 'settings' : n.link.app, n.link.id, n.link.msg) } : {}) }));
      return { today, needs_you: needs, unread_notifications: rest, ...(needs.length || rest.length ? {} : { note: 'Nothing needs you right now.' }) };
    },
  );

  const KINDS = ['tasks', 'mail', 'chat', 'notes', 'tables', 'calendar', 'projects', 'people', 'files', 'meetings'] as const;
  /** A search that uses Gmail's operators (then mail is matched with them, src/mailQuery.ts). */
  const OPERATOR = /(^|\s|\()-?(from|to|cc|bcc|subject|has|filename|larger|smaller|before|after|older_than|newer_than|label|in|is|category|list):\S|\sOR\s/;
  tool(
    'search',
    {
      title: 'Search everything',
      description: 'Searches everything you can see in the company: tasks, mail, chat messages, notes, table rows, your calendar, projects, people, files and meeting notes. Every word must match. Mail also takes Gmail’s search operators (from:, to:, subject:, has:attachment, filename:, larger:, before:, after:, newer_than:, label:, in:, is:, category:, list:, "phrase", OR, -word). Returns ids and links; read the full item with the read_ tools.',
      inputSchema: { query: z.string().min(1).max(200).describe('Words to look for'), only: z.array(z.enum(KINDS)).optional().describe('Search only these kinds'), limit: limit(50, 20) },
      annotations: READ,
    },
    (a, v) => {
      const words = lower(a.query).split(/\s+/).filter(Boolean);
      const want = new Set<string>(a.only?.length ? a.only : KINDS);
      const hits: { kind: string; score: number; at: string; out: Doc }[] = [];
      const test = (title: string, rest: string) => {
        const t = lower(title);
        const all = `${t} ${lower(rest)}`;
        if (!words.every((w) => all.includes(w))) return 0;
        return words.every((w) => t.includes(w)) ? 2 : 1;
      };
      const snippet = (text: string) => {
        const t = String(text ?? '').replace(/\s+/g, ' ');
        const i = Math.max(0, lower(t).indexOf(words[0]) - 50);
        return clip((i ? '…' : '') + t.slice(i), 160);
      };
      const add = (kind: string, title: string, rest: string, at: string | undefined, out: Doc) => {
        const score = test(title, rest);
        if (score) hits.push({ kind, score, at: at ?? '', out: { kind, ...out } });
      };
      if (want.has('tasks'))
        for (const t of v.docs('todos')) {
          const comments = (t.history ?? []).filter((h: Doc) => h.kind === 'comment').map((h: Doc) => h.text).join(' ');
          add('task', t.title, `${t.notes ?? ''} ${t.context ?? ''} ${comments}`, t.createdAt, { ...taskLine(v, t), snippet: snippet(`${t.notes ?? ''} ${comments}`) || undefined });
        }
      if (want.has('mail')) {
        const boxes = new Set(v.mailboxes().map((x) => x.id));
        // Gmail's operators (from:, has:attachment, newer_than:…) narrow the mail first (src/mailQuery.ts); their
        // words then match as usual.
        const qn = OPERATOR.test(a.query) ? parseQuery(a.query) : null;
        for (const t of v.docs('threads')) {
          if (!boxes.has(t.accountId)) continue;
          if (qn) {
            if (!matchThread(qn, t as never, { isMine: (e) => v.mine(e) })) continue;
            hits.push({ kind: 'mail', score: 2, at: lastOf(t).date ?? '', out: { kind: 'mail', ...threadLine(v, t), snippet: snippet((t.messages ?? []).map((m: Doc) => m.body).join(' ')) } });
            continue;
          }
          if (t.location === 'trash' || t.location === 'spam') continue;
          const body = (t.messages ?? []).map((m: Doc) => `${m.from?.name ?? ''} ${m.from?.email ?? ''} ${m.body ?? ''}`).join(' ');
          add('mail', t.subject, body, lastOf(t).date, { ...threadLine(v, t), snippet: snippet((t.messages ?? []).map((m: Doc) => m.body).join(' ')) });
        }
      }
      if (want.has('chat')) {
        const chans = new Map(v.docs('channels').map((c) => [c.id, c]));
        for (const m of v.docs('messages')) {
          const c = chans.get(m.channelId);
          if (!c || !(m.text || m.voice?.transcript)) continue;
          add('message', '', `${m.text ?? ''} ${m.voice?.transcript ?? ''}`, m.at, { id: m.id, channel: channelName(v, c), channel_id: c.id, who: v.nameOf(m.userId) || m.guestEmail, at: v.when(m.at), text: snippet(m.text ?? m.voice?.transcript), link: v.link('chat', c.id, m.id) });
        }
      }
      if (want.has('notes'))
        for (const n of v.docs('notes')) {
          const text = htmlToText(n.html);
          add('note', n.title, text, n.updatedAt, { id: n.id, title: n.title, updated: v.when(n.updatedAt), snippet: snippet(text), link: v.link('notes', n.id) });
        }
      if (want.has('tables')) {
        const tables = new Map(v.docs('tables').map((t) => [t.id, t]));
        for (const r of v.docs('rows')) {
          const t = tables.get(r.tableId);
          if (!t) continue;
          const line = rowLine(v, t, r);
          add('row', line.name, JSON.stringify(line.values), r.updatedAt, { ...line, table: t.name, table_id: t.id });
        }
      }
      if (want.has('calendar'))
        for (const e of v.myEvents()) add('event', e.title, `${e.location ?? ''} ${e.notes ?? ''}`, e.start, { id: e.id, title: e.title, start: v.when(e.start, e.allDay), link: v.link('calendar', e.id) });
      if (want.has('projects')) for (const c of v.docs('clients')) add('project', c.name, `${c.domain ?? ''} ${c.type ?? ''}`, c.since, { id: c.id, name: c.name, status: c.status, link: v.link('projects', c.id) });
      if (want.has('people')) for (const u of v.members()) add('person', u.name, `${u.email ?? ''} ${u.title ?? ''}`, '', { id: u.id, name: u.name, email: u.email, title: u.title || undefined });
      if (want.has('files')) for (const f of v.docs('drive')) if (!f.trashed && f.kind !== 'folder') add('file', f.name, '', f.modified, { id: f.id, name: f.name, kind: f.kind, modified: v.when(f.modified), link: v.link('drive', f.id) });
      if (want.has('meetings'))
        for (const m of v.docs('meetings')) add('meeting', m.title, `${m.summary ?? ''} ${(m.keyPoints ?? []).join(' ')} ${(m.decisions ?? []).join(' ')}`, m.at, { id: m.id, title: m.title, at: v.when(m.at), summary: clip(m.summary, 200) || undefined, link: v.link('meet', m.id) });
      hits.sort((x, y) => y.score - x.score || y.at.localeCompare(x.at));
      const max = a.limit ?? 20;
      return { query: a.query, results: hits.slice(0, max).map((h) => h.out), ...(hits.length > max ? { more: hits.length - max } : {}), ...(hits.length ? {} : { note: 'Nothing matched. Try fewer or other words.' }) };
    },
  );

  tool(
    'list_mail',
    {
      title: 'List mail',
      description: 'Conversations in your mailboxes in this company, newest first. Folders: inbox, unread, assigned_to_me (shared inboxes), sent, drafts, archive, all.',
      inputSchema: {
        folder: z.enum(['inbox', 'unread', 'assigned_to_me', 'sent', 'drafts', 'archive', 'all']).optional().describe('Default inbox'),
        mailbox: z.string().optional().describe('One mailbox (its address or id); default all of yours'),
        query: z.string().max(200).optional().describe('Only conversations with these words. Gmail search operators work too: from:, to:, subject:, has:attachment, filename:, larger:5M, before:2026/10/01, after:, older_than:7d, newer_than:2d, label:, in:anywhere, is:unread, is:starred, is:important, category:promotions, list:, "exact phrase", OR, -word, (groups)'),
        limit: limit(50, 20),
      },
      annotations: READ,
    },
    (a, v) => {
      const boxes = a.mailbox ? [v.mailbox(a.mailbox)] : v.mailboxes();
      if (!boxes.length) return { conversations: [], note: `You don’t have a mailbox in ${v.ctx.company}.` };
      const ids = new Set(boxes.map((x) => x.id));
      const now = new Date().toISOString();
      const folder = a.folder ?? 'inbox';
      const words = lower(a.query).split(/\s+/).filter(Boolean);
      const qn = a.query && OPERATOR.test(a.query) ? parseQuery(a.query) : null;
      const fromMe = (t: Doc) => (t.messages ?? []).some((m: Doc) => m.from && v.mine(m.from.email));
      const list = v
        .docs('threads')
        .filter((t) => ids.has(t.accountId))
        .filter((t) => {
          const snoozed = !!t.snoozedUntil && t.snoozedUntil > now;
          if (folder === 'inbox') return t.location === 'inbox' && !snoozed;
          if (folder === 'unread') return t.location === 'inbox' && t.unread && !snoozed;
          if (folder === 'assigned_to_me') return t.assignee === v.me && t.location !== 'trash';
          if (folder === 'sent') return fromMe(t) && t.location !== 'trash' && t.location !== 'drafts';
          if (folder === 'drafts') return t.location === 'drafts';
          if (folder === 'archive') return t.location === 'archive';
          return t.location !== 'trash' && t.location !== 'spam';
        })
        .filter((t) => (qn ? matchThread(qn, { ...t, location: t.location === 'spam' || t.location === 'trash' ? 'archive' : t.location } as never, { isMine: (e) => v.mine(e) }) : !words.length || words.every((w) => lower(`${t.subject} ${(t.messages ?? []).map((m: Doc) => `${m.from?.name} ${m.from?.email} ${m.body}`).join(' ')}`).includes(w))))
        .sort((x, y) => String(lastOf(y).date ?? '').localeCompare(String(lastOf(x).date ?? '')));
      const max = a.limit ?? 20;
      return { folder, conversations: list.slice(0, max).map((t) => threadLine(v, t)), ...(list.length > max ? { more: list.length - max } : {}) };
    },
  );

  tool(
    'read_mail',
    {
      title: 'Read a mail conversation',
      description: 'One conversation from your mailboxes: every message (sender, recipients, date, text, attachments), the team’s internal notes and who it’s assigned to. Reading it here doesn’t mark it read.',
      inputSchema: { thread_id: z.string().describe('The conversation’s id (from list_mail or search)') },
      annotations: READ,
    },
    (a, v) => {
      const boxes = new Set(v.mailboxes().map((x) => x.id));
      const t = v.docs('threads').find((x) => x.id === a.thread_id && boxes.has(x.accountId)) ?? no(`No conversation ${a.thread_id} in your mailboxes in ${v.ctx.company}.`);
      const msgs = t.messages ?? [];
      const shown = msgs.slice(-20);
      return {
        ...threadLine(v, t),
        ...(msgs.length > shown.length ? { earlier_messages_not_shown: msgs.length - shown.length } : {}),
        messages: shown.map((m: Doc, i: number) => ({
          id: m.id,
          from: m.from ? `${m.from.name || m.from.email} <${m.from.email}>` : undefined,
          to: (m.to ?? []).map((p: Doc) => (p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.email)),
          date: v.when(m.date),
          text: clip(m.body || htmlToText(m.html ?? ''), i === shown.length - 1 ? 12_000 : 4000),
          ...(m.attachments?.length ? { attachments: m.attachments.map((x: Doc) => x.name) } : {}),
          ...(m.invite ? { invite: { title: m.invite.title, start: v.when(m.invite.start, m.invite.allDay), answer: m.invite.answer?.status } } : {}),
        })),
        ...(t.notes?.length ? { internal_notes: t.notes.map((n: Doc) => ({ who: v.nameOf(n.by), at: v.when(n.at), text: n.text })) } : {}),
      };
    },
  );

  tool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Tasks you can see. Scopes: mine (open tasks you do), today (yours due today or late), overdue, upcoming (yours due in the next 14 days), supervising (others’ work you check), assigned_by_me (work you gave others), unassigned (team queues), project, team, everything. Late and soonest first.',
      inputSchema: {
        scope: z.enum(['mine', 'today', 'overdue', 'upcoming', 'supervising', 'assigned_by_me', 'unassigned', 'project', 'team', 'everything']).optional().describe('Default mine'),
        project: z.string().optional().describe('For scope project: its name or id'),
        team: z.string().optional().describe('For scope team: its name or id'),
        include_done: z.boolean().optional().describe('Also finished tasks (default no)'),
        limit: limit(100, 30),
      },
      annotations: READ,
    },
    (a, v) => {
      const me = v.me;
      const today = v.today();
      const soon = addDays(today, 14);
      const scope = a.scope ?? (a.project ? 'project' : a.team ? 'team' : 'mine');
      const project = scope === 'project' ? v.project(a.project ?? no('Say which project.')) : null;
      const team = scope === 'team' ? v.team(a.team ?? no('Say which team.')) : null;
      const all = v.docs('todos').filter((t) => a.include_done || !t.done);
      const mineOf = (t: Doc) => doers(t).includes(me);
      const pick: Record<string, (t: Doc) => boolean> = {
        mine: mineOf,
        today: (t) => mineOf(t) && !!t.due && t.due <= today,
        overdue: (t) => mineOf(t) && !!t.due && t.due < today && !t.done,
        upcoming: (t) => mineOf(t) && !!t.due && t.due > today && t.due <= soon,
        supervising: (t) => t.supervisorId === me && !mineOf(t),
        assigned_by_me: (t) => t.createdBy === me && !!t.userId && !mineOf(t),
        unassigned: (t) => !t.userId && !(t.assignees ?? []).length,
        project: (t) => t.clientId === project?.id,
        team: (t) => t.teamId === team?.id,
        everything: () => true,
      };
      const list = all.filter(pick[scope]).sort((x, y) => Number(!!x.done) - Number(!!y.done) || String(x.due ?? '9999').localeCompare(String(y.due ?? '9999')) || String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')));
      const max = a.limit ?? 30;
      return { scope, ...(project ? { project: project.name } : {}), ...(team ? { team: team.name } : {}), today, tasks: list.slice(0, max).map((t) => taskLine(v, t)), ...(list.length > max ? { more: list.length - max } : {}), ...(list.length ? {} : { note: 'No tasks here.' }) };
    },
  );

  tool(
    'read_task',
    {
      title: 'Read a task',
      description: 'One task in full: stage, people, dates, notes, checklist, approval, its comments (with the files attached to them) and history, and for a brief its tasks.',
      inputSchema: { task_id: z.string() },
      annotations: READ,
    },
    (a, v) => {
      const t = v.task(a.task_id);
      const subtasks = t.kind === 'brief' ? v.docs('todos').filter((x) => x.briefId === t.id) : [];
      return {
        ...taskLine(v, t),
        ...(t.notes ? { notes: t.notes } : {}),
        ...(t.context ? { brief: t.context } : {}),
        ...(t.supervisorId ? { supervisor: v.nameOf(t.supervisorId) } : {}),
        ...(t.followers?.length ? { followers: t.followers.map(v.nameOf) } : {}),
        created: { by: v.nameOf(t.createdBy) || undefined, at: v.when(t.createdAt) },
        ...(t.doneAt ? { finished: { by: v.nameOf(t.doneBy) || undefined, at: v.when(t.doneAt) } } : {}),
        ...(t.repeat ? { repeats: t.repeat } : {}),
        ...(t.visibleToClient ? { guests_see_it: true } : {}),
        ...(t.approval ? { approval: { status: t.approval.status, ...(t.approval.note ? { note: t.approval.note } : {}) } } : {}),
        ...(t.checklist?.length ? { checklist: t.checklist.map((c: Doc) => `${c.done ? '[x]' : '[ ]'} ${c.text}`) } : {}),
        ...(subtasks.length ? { tasks: subtasks.map((x) => taskLine(v, x)) } : {}),
        history: (t.history ?? []).slice(-40).map((h: Doc) => ({
          at: v.when(h.at),
          who: String(h.by).includes('@') ? `${h.by} (guest)` : v.nameOf(h.by),
          [h.kind === 'comment' ? 'comment' : 'did']: h.text,
          ...(h.toClient ? { guests_see_it: true } : {}),
          // Files attached to the comment: what they are (opening one needs a sign-in in the app).
          ...(Array.isArray(h.files) && h.files.length ? { attachments: h.files.map((f: Doc) => ({ name: String(f.name ?? 'file'), type: String(f.type ?? ''), size: fileSize(Number(f.size) || 0) })) } : {}),
        })),
      };
    },
  );

  tool(
    'list_channels',
    {
      title: 'List chat channels',
      description: 'The chat channels, direct messages and group messages you can see (group messages only when you are in them), most recently active first. guests: true means people outside the company read it (so posting there makes a draft).',
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: READ,
    },
    (a, v) => {
      const last = new Map<string, string>();
      for (const m of v.docs('messages')) if (String(m.at) > (last.get(m.channelId) ?? '')) last.set(m.channelId, m.at);
      const list = v
        .docs('channels')
        .filter((c) => a.include_archived || !c.archived)
        .sort((x, y) => String(last.get(y.id) ?? '').localeCompare(String(last.get(x.id) ?? '')));
      return {
        channels: list.map((c) => ({
          id: c.id,
          name: channelName(v, c),
          ...(c.topic ? { topic: clip(c.topic, 120) } : {}),
          ...(c.clientId ? { project: v.docs('clients').find((x) => x.id === c.clientId)?.name } : {}),
          ...(c.private ? { private: true } : {}),
          ...(!(c.members ?? []).includes(v.me) ? { not_a_member: true } : {}),
          ...(reachesGuests(c) ? { guests: true } : {}),
          ...(c.archived ? { archived: true } : {}),
          ...(last.get(c.id) ? { last_message: v.when(last.get(c.id)) } : {}),
          link: v.link('chat', c.id),
        })),
      };
    },
  );

  tool(
    'read_channel',
    {
      title: 'Read a channel',
      description: 'Recent messages in a channel, direct message or group message, oldest first (each with its id and how many replies its thread has), or one thread in full.',
      inputSchema: {
        channel: z.string().describe('The channel’s id or name (#design), a teammate’s name for your direct messages, or several names ("Rizky, Faisal") for your group message with them'),
        thread: z.string().optional().describe('A message id: read that message and its thread'),
        before: z.string().optional().describe('Only messages before this time (ISO), to read further back'),
        limit: limit(100, 30),
      },
      annotations: READ,
    },
    (a, v) => {
      const c = v.channel(a.channel);
      const all = v.docs('messages').filter((m) => m.channelId === c.id).sort((x, y) => String(x.at).localeCompare(String(y.at)));
      const replies = (id: string) => all.filter((m) => m.parentId === id).length;
      const max = a.limit ?? 30;
      if (a.thread) {
        const root = all.find((m) => m.id === a.thread) ?? no(`No message ${a.thread} in ${channelName(v, c)}.`);
        const list = all.filter((m) => m.parentId === root.id);
        return { channel: channelName(v, c), thread: messageLine(v, c, root, list.length), replies: list.slice(-max).map((m) => messageLine(v, c, m, 0)), link: v.link('chat', c.id, root.id) };
      }
      const top = all.filter((m) => (!m.parentId || m.alsoInChannel) && (!a.before || String(m.at) < a.before));
      const shown = top.slice(-max);
      return {
        channel: channelName(v, c),
        id: c.id,
        ...(reachesGuests(c) ? { guests: (c.guests ?? []).map((g: Doc) => g.name || g.email), note: 'Guests read this channel: post_message here saves a draft for you to send.' } : {}),
        ...(top.length > shown.length ? { older_messages: top.length - shown.length, read_older_with_before: shown[0]?.at } : {}),
        messages: shown.map((m) => messageLine(v, c, m, replies(m.id))),
        link: v.link('chat', c.id),
      };
    },
  );

  tool(
    'calendar_agenda',
    {
      title: 'Calendar agenda',
      description: 'Your calendar (or a teammate’s, as much as they share) for a range of days, in the company’s time zone: events with times, place, video link and guests. A repeating event shows each of its dates in the range, with how it repeats. Default: today and the next 6 days.',
      inputSchema: {
        from: day.optional().describe('First day, YYYY-MM-DD (default today)'),
        to: day.optional().describe('Last day, YYYY-MM-DD (default 6 days after from, at most 62 days)'),
        person: z.string().optional().describe('A teammate’s name, email or id (default you)'),
      },
      annotations: READ,
    },
    (a, v) => {
      const tz = v.tz();
      const from = a.from ?? v.today();
      if (!validDay(from) || (a.to && !validDay(a.to))) no('Use real dates as YYYY-MM-DD.');
      const to = a.to ?? addDays(from, 6);
      if (to < from) no('“to” comes before “from”.');
      if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 62 * 86_400_000) no('Ask for at most 62 days at a time.');
      const start = zonedTime(from, 0, tz);
      const end = zonedTime(addDays(to, 1), 0, tz);
      const who = a.person ? v.person(a.person) : v.user(v.me)!;
      const cals = new Map(v.docs('calendars').map((c) => [c.id, c]));
      const theirs = v.docs('events').filter((e) => (who.id === v.me ? e.feed === 'holidays' || v.ownerOf(e) === v.me : e.feed !== 'holidays' && v.ownerOf(e) === who.id));
      // A repeating event as each of its dates in these days (left-out dates left out, moved ones where they went).
      const dated = expandEvents(theirs as unknown as CalEvent[], start, end) as unknown as Doc[];
      const list = dated.filter((e) => Date.parse(e.end) > start && Date.parse(e.start) < end).sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
      const own = who.id === v.me; // a teammate's: titles, times and places only, as their calendar shows it in the app
      return {
        whose: who.id === v.me ? 'yours' : who.name,
        from,
        to,
        time_zone: tz,
        events: list.slice(0, 200).map((e) => ({
          id: e.id,
          title: e.busy ? 'Busy' : e.title,
          ...(e.allDay ? { all_day: true, date: v.dayOf(e.start) } : { start: v.when(e.start), end: v.time(e.end) }),
          ...(e.location && !e.busy ? { location: e.location } : {}),
          ...(own && e.meetUrl ? { video: e.meetUrl } : {}),
          ...(own && e.guests?.length ? { guests: e.guests.map((g: Doc) => g.name || g.email) } : {}),
          ...(e.feed === 'holidays' ? { holiday: true } : {}),
          ...(cals.get(e.calendarId)?.name ? { calendar: cals.get(e.calendarId)!.name } : {}),
          ...(e.rsvp ? { your_answer: e.rsvp } : {}),
          ...(e.rrule ? { repeats: repeatWords({ rrule: e.rrule, start: e.occurrence ?? e.start, timeZone: e.timeZone }) } : {}),
          link: v.link('calendar', e.id),
        })),
        ...(list.length ? {} : { note: 'Nothing on the calendar in these days.' }),
      };
    },
  );

  tool(
    'list_notes',
    {
      title: 'List notes',
      description: 'Notes you can see: your private ones and the team’s, newest first.',
      inputSchema: { query: z.string().max(200).optional(), project: z.string().optional().describe('Only this project’s notes'), limit: limit(100, 30) },
      annotations: READ,
    },
    (a, v) => {
      const project = a.project ? v.project(a.project) : null;
      const words = lower(a.query).split(/\s+/).filter(Boolean);
      const list = v
        .docs('notes')
        .filter((n) => !project || n.clientId === project.id)
        .filter((n) => !words.length || words.every((w) => lower(`${n.title} ${htmlToText(n.html)}`).includes(w)))
        .sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned) || String(y.updatedAt).localeCompare(String(x.updatedAt)));
      const max = a.limit ?? 30;
      return {
        notes: list.slice(0, max).map((n) => ({ id: n.id, title: n.title || 'Untitled', ...(n.visibility === 'private' ? { private: true } : { shared_with_team: true }), ...(n.clientId ? { project: v.docs('clients').find((c) => c.id === n.clientId)?.name } : {}), ...(n.pinned ? { pinned: true } : {}), updated: v.when(n.updatedAt), snippet: clip(htmlToText(n.html), 120), link: v.link('notes', n.id) })),
        ...(list.length > max ? { more: list.length - max } : {}),
      };
    },
  );

  tool(
    'read_note',
    { title: 'Read a note', description: 'One note in full, as text (headings with #, lists with -).', inputSchema: { note_id: z.string() }, annotations: READ },
    (a, v) => {
      const n = v.docs('notes').find((x) => x.id === a.note_id) ?? no(`No note ${a.note_id} that you can see.`);
      return { id: n.id, title: n.title || 'Untitled', ...(n.visibility === 'private' ? { private: true } : { shared_with_team: true }), owner: v.nameOf(n.ownerId), ...(n.clientId ? { project: v.docs('clients').find((c) => c.id === n.clientId)?.name } : {}), updated: v.when(n.updatedAt), text: clip(htmlToText(n.html), 30_000), link: v.link('notes', n.id) };
    },
  );

  tool(
    'list_tables',
    {
      title: 'List tables',
      description: 'The tables you can see (pipelines, trackers, lists), each with its fields (name, type and choices) and how many rows it has.',
      inputSchema: { project: z.string().optional().describe('Only this project’s tables') },
      annotations: READ,
    },
    (a, v) => {
      const project = a.project ? v.project(a.project) : null;
      const rows = v.docs('rows');
      return {
        tables: v
          .docs('tables')
          .filter((t) => !project || t.clientId === project.id)
          .map((t) => ({
            id: t.id,
            name: t.name,
            ...(t.description ? { about: clip(t.description, 200) } : {}),
            ...(t.clientId ? { project: v.docs('clients').find((c) => c.id === t.clientId)?.name } : {}),
            rows: rows.filter((r) => r.tableId === t.id).length,
            fields: (t.fields ?? []).filter((f: Doc) => f.type !== 'button').map((f: Doc) => ({ name: f.name, type: f.type, ...(f.options?.length ? { choices: f.options.map((o: Doc) => o.label) } : {}) })),
            link: v.link('tables', t.id),
          })),
      };
    },
  );

  tool(
    'query_rows',
    {
      title: 'Read table rows',
      description: 'Rows of one table, with values by field name (choices as their labels, people by name). Filter with where (field name: text the value contains) and query (any field).',
      inputSchema: {
        table: z.string().describe('The table’s name or id'),
        where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Field name: value it should contain, e.g. {"Stage": "Won"}'),
        query: z.string().max(200).optional(),
        offset: z.number().int().min(0).optional(),
        limit: limit(200, 50),
      },
      annotations: READ,
    },
    (a, v) => {
      const t = v.table(a.table);
      const fields = (t.fields ?? []) as Doc[];
      const conds = Object.entries(a.where ?? {}).map(([k, want]) => {
        const f = fields.find((x) => lower(x.name) === lower(k)) ?? no(`${t.name} has no field “${k}”. Its fields: ${fields.map((x) => x.name).join(', ')}.`);
        return { f, want: lower(want) };
      });
      const words = lower(a.query).split(/\s+/).filter(Boolean);
      const lines = v
        .docs('rows')
        .filter((r) => r.tableId === t.id)
        .sort((x, y) => Number(x.order ?? 0) - Number(y.order ?? 0))
        .map((r) => rowLine(v, t, r))
        .filter((line) =>
          conds.every(({ f, want }) => {
            const val = line.values[f.name];
            if (f.type === 'checkbox') return !!val === /^(true|yes|y|1|checked|done)$/.test(want);
            return lower(Array.isArray(val) ? val.join(', ') : val).includes(want);
          }),
        )
        .filter((line) => !words.length || words.every((w) => lower(`${line.name} ${JSON.stringify(line.values)}`).includes(w)));
      const from = a.offset ?? 0;
      const max = a.limit ?? 50;
      return { table: t.name, id: t.id, total: lines.length, rows: lines.slice(from, from + max), ...(lines.length > from + max ? { next_offset: from + max } : {}), link: v.link('tables', t.id) };
    },
  );

  /* ---------- doing ---------- */

  const via = ` via ${ctx.app}`;
  tool(
    'create_task',
    {
      title: 'Create a task',
      description: 'Makes a task in sprint2go, assigned to you unless you name other people (or a team, which puts it in that team’s queue). Assignees hear about it in sprint2go.',
      inputSchema: {
        title: z.string().min(1).max(300),
        assignees: z.array(z.string()).max(10).optional().describe('Teammates’ names, emails or ids. Default: you. An empty list with a team leaves it in the team’s queue.'),
        due: day.optional().describe('YYYY-MM-DD'),
        project: z.string().optional().describe('A project’s name or id'),
        team: z.string().optional().describe('A team’s name or id'),
        stage: z.string().optional().describe('A stage’s name (default the first one)'),
        priority: z.enum(['high', 'normal']).optional(),
        notes: z.string().max(10_000).optional(),
        checklist: z.array(z.string().max(300)).max(50).optional(),
      },
      annotations: WRITE,
    },
    (a, v) => {
      if (a.due && !validDay(a.due)) no('Use a real date as YYYY-MM-DD.');
      const project = a.project ? v.project(a.project) : null;
      const team = a.team ? v.team(a.team) : null;
      const people = a.assignees ? a.assignees.map((x) => v.person(x)) : team ? [] : [v.user(v.me) ?? { id: v.me }];
      const ids = [...new Set(people.map((p) => p.id))];
      const stages = v.stagesFor({ clientId: project?.id, teamId: team?.id });
      const stage = a.stage ? v.stage(a.stage, stages) : stages.find((s) => s.id === stageIdFor({ workspaceId: v.ctx.wsId }, 'open', stages))!;
      const at = new Date().toISOString();
      const done = stage.kind === 'done';
      const task: Doc = {
        id: v.newId(),
        title: a.title.trim(),
        ...(project ? { clientId: project.id } : {}),
        ...(team ? { teamId: team.id } : {}),
        userId: ids[0] ?? '',
        assignees: ids,
        ...(a.due ? { due: a.due } : {}),
        priority: a.priority ?? 'normal',
        done,
        status: stage.id,
        ...(done ? { doneAt: at, doneBy: v.me } : {}),
        source: 'manual',
        createdBy: v.me,
        workspaceId: v.ctx.wsId,
        createdAt: at,
        supervisorId: v.me,
        ...(a.notes ? { notes: a.notes } : {}),
        ...(a.checklist?.length ? { checklist: a.checklist.map((text) => ({ id: randomBytes(4).toString('hex'), text, done: false })) } : {}),
        history: [{ id: randomBytes(6).toString('hex'), at, by: v.me, kind: 'created', text: `created this${via}${ids[0] && ids[0] !== v.me ? ` for ${v.firstOf(ids[0])}` : ''}` }],
      };
      const note = v.save('todos', [task], `created task “${clip(task.title, 120)}”`);
      const me = v.firstOf(v.me);
      v.notify(ids, 'task', msg('{name} assigned you “{task}” via {app}', { name: me, task: clip(task.title, 80), app: v.ctx.app }), { app: 'tasks', id: task.id });
      if (!ids.length && team?.leadId) v.notify([team.leadId], 'task', msg('New in {team}’s queue: “{task}”. Pick someone for it.', { team: team.name, task: clip(task.title, 80) }), { app: 'tasks', id: task.id });
      return { created: taskLine(v, task), ...(note ? { note } : {}) };
    },
  );

  tool(
    'update_task',
    {
      title: 'Update a task',
      description:
        'Changes a task: title, assignees, due date, stage (or done), priority, notes or checklist, and adds a comment (comments stay inside the team). Finishing a task that needs review sends it to its supervisor first, as in the app.',
      inputSchema: {
        task_id: z.string(),
        title: z.string().min(1).max(300).optional(),
        assignees: z.array(z.string()).max(10).optional().describe('The full new list of people doing it (names, emails or ids)'),
        due: z.union([day, z.literal('')]).optional().describe('YYYY-MM-DD, or "" to clear it'),
        stage: z.string().optional().describe('A stage’s name, or: to do, in progress, waiting, review, done'),
        done: z.boolean().optional().describe('true finishes it, false opens it again'),
        priority: z.enum(['high', 'normal']).optional(),
        notes: z.string().max(10_000).optional().describe('Replaces the notes'),
        checklist_add: z.array(z.string().max(300)).max(50).optional(),
        checklist_done: z.array(z.string()).max(50).optional().describe('Checklist items to tick, by their text'),
        comment: z.string().max(5000).optional(),
      },
      annotations: WRITE,
    },
    (a, v) => {
      const before = v.task(a.task_id);
      const t: Doc = { ...before, history: [...(before.history ?? [])] };
      const at = new Date().toISOString();
      const me = v.firstOf(v.me);
      const log = (kind: string, text: string) => t.history.push({ id: randomBytes(6).toString('hex'), at, by: v.me, kind, text: `${text}${via}` });
      const tell: { ids: string[]; text: { text: string; tr?: unknown } }[] = [];
      const changed: string[] = [];
      if (a.title !== undefined && a.title.trim() !== t.title) {
        t.title = a.title.trim();
        log('edit', `renamed it to “${clip(t.title, 120)}”`);
        changed.push('title');
      }
      if (a.assignees) {
        const ids = [...new Set(a.assignees.map((x) => v.person(x).id))];
        const was = doers(before);
        if (JSON.stringify(ids) !== JSON.stringify(was)) {
          t.assignees = ids;
          t.userId = ids[0] ?? '';
          log('assigned', ids.length ? `assigned it to ${ids.map(v.firstOf).join(', ')}` : 'took everyone off it');
          tell.push({ ids: ids.filter((x) => !was.includes(x)), text: msg('{name} assigned you “{task}” via {app}', { name: me, task: clip(t.title, 80), app: v.ctx.app }) });
          changed.push('assignees');
        }
      }
      if (a.due !== undefined && (a.due || undefined) !== t.due) {
        if (a.due && !validDay(a.due)) no('Use a real date as YYYY-MM-DD.');
        t.due = a.due || undefined;
        log('due', a.due ? `set the due date to ${a.due}` : 'cleared the due date');
        changed.push('due');
      }
      if (a.priority && a.priority !== (t.priority ?? 'normal')) {
        t.priority = a.priority;
        log('edit', a.priority === 'high' ? 'marked it high priority' : 'set it to normal priority');
        changed.push('priority');
      }
      if (a.notes !== undefined && a.notes !== (t.notes ?? '')) {
        t.notes = a.notes;
        changed.push('notes');
      }
      if (a.checklist_add?.length) {
        t.checklist = [...(t.checklist ?? []), ...a.checklist_add.map((text) => ({ id: randomBytes(4).toString('hex'), text, done: false }))];
        changed.push('checklist');
      }
      if (a.checklist_done?.length) {
        const list = (t.checklist ?? []) as Doc[];
        t.checklist = list.map((c) => ({ ...c }));
        for (const want of a.checklist_done) {
          const item = (t.checklist as Doc[]).find((c) => lower(c.text) === lower(want)) ?? (t.checklist as Doc[]).find((c) => lower(c.text).includes(lower(want)));
          if (!item) no(`The checklist has no item “${want}”.`);
          item!.done = true;
        }
        changed.push('checklist');
      }
      // The stage, as the app moves it: by what the stage means, with the review step and repeating tasks.
      const stages = v.stagesFor(before);
      const target = a.stage ? v.stage(a.stage, stages) : a.done === true ? stages.find((s) => s.kind === 'done')! : a.done === false && before.done ? stages.find((s) => s.kind === 'open')! : null;
      let next: Doc | null = null;
      let review: string | null = null;
      if (target) {
        const from = stageOf(before as any, stages);
        const team = v.docs('teams').find((x) => x.id === before.teamId);
        const reviewStage = stages.find((s) => s.kind === 'review');
        const needsReview = target.kind === 'done' && !!reviewStage && !!team?.review && !!before.supervisorId && before.supervisorId !== v.me && !doers(before).includes(before.supervisorId) && from.kind !== 'review';
        const to = needsReview ? reviewStage! : target;
        if (to.id !== from.id) {
          const done = to.kind === 'done';
          t.status = to.id;
          t.done = done;
          t.doneAt = done ? (before.done ? before.doneAt : at) : undefined;
          t.doneBy = done ? (before.done ? before.doneBy : v.me) : undefined;
          const text = needsReview ? 'finished it and sent it for review' : done && !before.done ? (from.kind === 'review' ? 'approved it' : 'marked it done') : !done && before.done ? (to.kind === 'open' ? 'reopened it' : `reopened it (${stageName(to)})`) : to.kind === 'active' && from.kind === 'open' ? 'started it' : `moved it to ${stageName(to)}`;
          log(needsReview || from.kind === 'review' ? 'review' : 'status', text);
          changed.push('stage');
          if (needsReview) {
            review = v.nameOf(before.supervisorId);
            tell.push({ ids: [before.supervisorId], text: msg('{name} finished “{task}”. Ready for your review via {app}', { name: me, task: clip(t.title, 80), app: v.ctx.app }) });
          } else if (done && !before.done) {
            tell.push({ ids: [before.supervisorId ?? before.createdBy, ...(before.followers ?? []), ...(from.kind === 'review' ? doers(before) : [])].filter(Boolean), text: from.kind === 'review' ? msg('{name} approved “{task}” via {app}', { name: me, task: clip(t.title, 80), app: v.ctx.app }) : msg('{name} finished “{task}” via {app}', { name: me, task: clip(t.title, 80), app: v.ctx.app }) });
            if (before.repeat) {
              const nextDue = (() => {
                const d = new Date(`${before.due ?? v.today()}T12:00:00Z`);
                const step = { daily: 1, weekly: 7 }[before.repeat as string];
                if (step) d.setUTCDate(d.getUTCDate() + step);
                else if (before.repeat === 'weekdays') do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
                else if (before.repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
                return d.toISOString().slice(0, 10);
              })();
              next = { ...before, id: v.newId(), status: stageIdFor(before, 'open', stages), done: false, doneAt: undefined, doneBy: undefined, due: nextDue, reminded: false, approval: undefined, checklist: before.checklist?.map((c: Doc) => ({ ...c, done: false })), createdAt: at, history: [{ id: randomBytes(6).toString('hex'), at, by: v.me, kind: 'created', text: `created this (repeats ${before.repeat === 'weekdays' ? 'every weekday' : before.repeat})${via}` }] };
            }
          }
        }
      }
      if (a.comment?.trim()) {
        log('comment', a.comment.trim());
        tell.push({ ids: [...doers(t), t.supervisorId, ...(t.followers ?? [])].filter(Boolean), text: msg('{name} commented on “{task}”: {comment}', { name: me, task: clip(t.title, 60), comment: clip(a.comment, 80) }) });
        changed.push('comment');
      }
      if (!changed.length) return { unchanged: taskLine(v, before), note: 'Nothing to change: it already looks like that.' };
      const note = v.save('todos', [t, ...(next ? [next] : [])], `updated task “${clip(t.title, 100)}” (${changed.join(', ')})`);
      for (const x of tell) v.notify(x.ids, 'task', x.text, { app: 'tasks', id: t.id });
      return { updated: taskLine(v, t), changed, ...(review ? { note: `The team checks finished work first, so it went to ${review} for review.` } : {}), ...(next ? { next_repeat: taskLine(v, next) } : {}), ...(note ? { saved_note: note } : {}) };
    },
  );

  tool(
    'write_note',
    {
      title: 'Write a note',
      description: 'Makes a new note, or changes one you can see (replace its text, or add to the end). Write plain text: # for headings, - or 1. for lists, **bold**. New notes are private unless shared with the team.',
      inputSchema: {
        note_id: z.string().optional().describe('To change an existing note; leave out to make a new one'),
        title: z.string().max(200).optional(),
        text: z.string().max(50_000).describe('The note’s text'),
        mode: z.enum(['replace', 'append']).optional().describe('For an existing note: replace its text (default) or add to the end'),
        project: z.string().optional().describe('New notes: file it under this project'),
        share_with_team: z.boolean().optional().describe('New notes: everyone in the company who sees the project can read it (default private)'),
      },
      annotations: WRITE,
    },
    (a, v) => {
      const at = new Date().toISOString();
      if (a.note_id) {
        const before = v.docs('notes').find((x) => x.id === a.note_id) ?? no(`No note ${a.note_id} that you can see.`);
        const html = a.mode === 'append' ? `${before.html ?? ''}${textToHtml(a.text)}` : textToHtml(a.text);
        const n: Doc = { ...before, ...(a.title !== undefined ? { title: a.title.trim() } : {}), html, updatedAt: at, updatedBy: v.me };
        v.save('notes', [n], `${a.mode === 'append' ? 'added to' : 'rewrote'} the note “${clip(n.title, 100)}”`);
        return { updated: { id: n.id, title: n.title, link: v.link('notes', n.id) } };
      }
      const project = a.project ? v.project(a.project) : null;
      const n = { id: v.newId(), workspaceId: v.ctx.wsId, title: (a.title ?? '').trim() || clip(a.text.split('\n')[0].replace(/^#+\s*/, ''), 80) || 'Untitled', html: textToHtml(a.text), ownerId: v.me, visibility: a.share_with_team ? 'team' : 'private', ...(project ? { clientId: project.id } : {}), createdAt: at, updatedAt: at, updatedBy: v.me };
      v.save('notes', [n], `wrote the note “${clip(n.title, 100)}”`);
      return { created: { id: n.id, title: n.title, ...(n.visibility === 'private' ? { private: true } : { shared_with_team: true }), link: v.link('notes', n.id) } };
    },
  );

  const values = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])).describe('Field name: value. Choices by label, people by name, dates as YYYY-MM-DD, null to clear.');
  /** The values the AI gave, as the table stores them, with the history the app keeps for each change. */
  const rowValues = (v: View, t: Doc, given: Record<string, unknown>) => {
    const fields = (t.fields ?? []) as Doc[];
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(given)) {
      const f = fields.find((x) => lower(x.name) === lower(k) || x.id === k) ?? no(`${t.name} has no field “${k}”. Its fields: ${fields.filter((x) => x.type !== 'button').map((x) => x.name).join(', ')}.`);
      out[f.id] = toCell(v, f, val, v.docs('rows'), v.docs('tables'));
    }
    return out;
  };
  tool(
    'add_table_row',
    { title: 'Add a table row', description: 'Adds a row to a table you can see. The table’s own automations run as when you add a row in sprint2go.', inputSchema: { table: z.string().describe('The table’s name or id'), values }, annotations: WRITE },
    (a, v) => {
      const t = v.table(a.table);
      // The table's default template first (as a new row in the app), then what was asked for on top.
      const vals = { ...templateValues(t as any, (t.templates ?? []).find((x: Doc) => x.isDefault), v.me, v.today()), ...rowValues(v, t, a.values) };
      const first = t.fields?.[0];
      if (first && (vals[first.id] === undefined || vals[first.id] === null || vals[first.id] === '')) no(`Give the row a ${first.name} (its name).`);
      const at = new Date().toISOString();
      const row = { id: v.newId(), workspaceId: t.workspaceId, tableId: t.id, values: vals, order: Date.now(), createdBy: v.me, createdAt: at, updatedAt: at };
      v.save('rows', [row], `added “${clip(vals[first?.id ?? ''], 80)}” to ${t.name}`);
      return { created: rowLine(v, t, row), table: t.name };
    },
  );
  tool(
    'update_table_row',
    { title: 'Update a table row', description: 'Changes fields on one row of a table you can see (only the fields you name).', inputSchema: { row_id: z.string(), values }, annotations: WRITE },
    (a, v) => {
      const before = v.docs('rows').find((r) => r.id === a.row_id) ?? no(`No row ${a.row_id} that you can see.`);
      const t = v.docs('tables').find((x) => x.id === before.tableId) ?? no('That row’s table isn’t one you can see.');
      const vals = rowValues(v, t, a.values);
      const at = new Date().toISOString();
      const changes = Object.entries(vals).filter(([k, val]) => JSON.stringify(before.values?.[k] ?? null) !== JSON.stringify(val ?? null));
      if (!changes.length) return { unchanged: rowLine(v, t, before), note: 'Nothing to change: it already has those values.' };
      const row = { ...before, values: { ...before.values, ...Object.fromEntries(changes) }, updatedAt: at, history: [...(before.history ?? []), ...changes.map(([fieldId, to]) => ({ by: v.me, at, fieldId, from: before.values?.[fieldId] ?? null, to }))].slice(-50) };
      v.save('rows', [row], `changed ${changes.map(([k]) => (t.fields ?? []).find((f: Doc) => f.id === k)?.name).join(', ')} on “${clip(before.values?.[t.fields?.[0]?.id], 60)}” in ${t.name}`);
      return { updated: rowLine(v, t, row), table: t.name };
    },
  );

  tool(
    'post_message',
    {
      title: 'Post in chat',
      description:
        'Posts a message in a team channel, a direct message with a teammate or a group message you are in, or replies in a thread. Channels with guests (people outside the company) only get a draft: it waits in the channel’s message box in sprint2go for you to check and send.',
      inputSchema: {
        channel: z.string().describe('The channel’s id or name (#design), a teammate’s name for your direct messages, or several names ("Rizky, Faisal") for your group message with them'),
        text: z.string().min(1).max(10_000),
        thread: z.string().optional().describe('Reply in the thread of this message id'),
      },
      annotations: WRITE,
    },
    (a, v) => {
      const c = v.channel(a.channel);
      if (c.archived) no(`${channelName(v, c)} is archived.`);
      const role = v.role();
      if (c.postPolicy === 'admins' && role === 'member' && c.ownerId !== v.me) no(`Only admins post in ${channelName(v, c)}.`);
      const parent = a.thread ? (v.docs('messages').find((m) => m.id === a.thread && m.channelId === c.id) ?? no(`No message ${a.thread} in ${channelName(v, c)}.`)) : null;
      const root = parent?.parentId ? parent.parentId : parent?.id;
      const text = a.text.trim();
      if (reachesGuests(c)) {
        // Guests read this channel: a draft in the person's own settings (only they see it), shown in the channel's box.
        const key = `s2g-chat-drafts:${v.me}`;
        const prefs = (db.getDoc('prefs', v.me) as Doc | undefined)?.value ?? {};
        const drafts = { ...(prefs[key] ?? {}), [c.id]: { text, at: new Date().toISOString(), via: v.ctx.app } };
        v.save('prefs', [{ id: v.me, value: { ...prefs, [key]: drafts } }]);
        if (!v.ctx.demo) db.audit(String(v.user(v.me)?.email || v.me), 'ai-app.chat-draft', v.ctx.wsId, `via ${v.ctx.app}: drafted a message for ${channelName(v, c)}`);
        return { draft: true, channel: channelName(v, c), message: `Not sent. Guests read ${channelName(v, c)}, so it’s a draft: it waits in the channel’s message box in sprint2go for you to check and send${root ? ' (as a new message; to answer in the thread, paste it there)' : ''}.`, link: v.link('chat', c.id) };
      }
      const m = { id: v.newId(), channelId: c.id, userId: v.me, text, at: new Date().toISOString(), ...(root ? { parentId: root } : {}) };
      v.save('messages', [m], `posted in ${channelName(v, c)}`);
      // Who hears about it, as when it's sent from the app: the others in a DM or group message, people mentioned, the
      // thread's followers (src/chatFollow.ts).
      const rootMsg = root ? v.docs('messages').find((x) => x.id === root) : null;
      const replies = rootMsg ? v.docs('messages').filter((x) => x.parentId === rootMsg.id && !x.sendAt) : [];
      for (const { id, why } of chatRecipients(m, { kind: c.kind, members: c.members ?? [], guests: c.guests }, rootMsg ? { root: rootMsg as any, replies: replies as any } : null, v.firstOf))
        v.notify([id], 'mention', noticeWords(why, v.firstOf(v.me), whereOf(c as any), `“${clip(text, 80)}”`), { app: 'chat', id: c.id, msg: m.id });
      return { posted: { id: m.id, channel: channelName(v, c), ...(root ? { thread: root } : {}), link: v.link('chat', c.id, m.id) } };
    },
  );

  tool(
    'add_event',
    {
      title: 'Add a calendar event',
      description:
        'Adds an event to your sprint2go calendar. Times are in the company’s time zone unless you give an offset. Guests can only be teammates; invite people outside the company from sprint2go. No invitations are emailed.',
      inputSchema: {
        title: z.string().min(1).max(200),
        start: z.string().describe('YYYY-MM-DDTHH:MM (company time), an ISO time with offset, or YYYY-MM-DD for an all-day event'),
        end: z.string().optional().describe('Same forms as start (default an hour after it; all-day: the same day)'),
        location: z.string().max(300).optional(),
        video_link: z.string().max(500).optional(),
        notes: z.string().max(5000).optional(),
        guests: z.array(z.string()).max(30).optional().describe('Teammates’ names or emails'),
        calendar: z.enum(['work', 'clients', 'personal']).optional().describe('Default work'),
        repeat: z
          .object({
            every: z.enum(['day', 'weekday', 'week', 'month', 'year']).describe('weekday: Monday to Friday'),
            interval: z.number().int().min(1).max(99).optional().describe('Every n of them (default 1): 2 with week is every 2 weeks'),
            days: z.array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])).min(1).max(7).optional().describe('week: on these days (default the start’s day)'),
            monthly: z.enum(['date', 'weekday', 'last_day', 'last_weekday']).optional().describe('month: the same date (default), the same weekday of the month (“the 2nd Tuesday”), the last day, or the last of that weekday'),
            until: day.optional().describe('The last date it may happen, YYYY-MM-DD'),
            times: z.number().int().min(1).max(999).optional().describe('Or: how many times in all'),
          })
          .optional()
          .describe('Make it a repeating event (each date is on the calendar, with reminders and the notetaker for each)'),
        rrule: z.string().max(300).optional().describe('Instead of repeat, for anything else: an RFC 5545 RRULE such as FREQ=MONTHLY;BYDAY=1MO,3MO'),
      },
      annotations: WRITE,
    },
    (a, v) => {
      const tz = v.tz();
      const parse = (s: string, field: string): { at: number; allDay: boolean } => {
        const t = s.trim();
        if (DAY_RE.test(t)) return validDay(t) ? { at: zonedTime(t, 0, tz), allDay: true } : no(`${field} isn’t a real date.`);
        const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/.exec(t);
        if (local) return validDay(local[1]) && Number(local[2]) < 24 && Number(local[3]) < 60 ? { at: zonedTime(local[1], Number(local[2]), tz) + Number(local[3]) * 60_000, allDay: false } : no(`${field} isn’t a real time.`);
        const at = Date.parse(t);
        return Number.isNaN(at) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? no(`${field}: use YYYY-MM-DDTHH:MM, an ISO time with offset, or YYYY-MM-DD.`) : { at, allDay: false };
      };
      const s = parse(a.start, 'start');
      const e = a.end ? parse(a.end, 'end') : null;
      const allDay = s.allDay;
      // All day: to the midnight after the last day (a day stays a day when the clocks change).
      const end = allDay ? zonedTime(addDays(v.dayOf(new Date(e ? e.at : s.at).toISOString()), 1), 0, tz) : (e?.at ?? s.at + 60 * 60_000);
      if (end <= s.at) no('The event has to end after it starts.');
      if (a.video_link && !/^https:\/\/\S+$/.test(a.video_link)) no('The video link must start with https://.');
      // Repeating: the picker's choices (as the app has them), or a rule as written. Its dates keep the company's clock.
      let rrule: string | undefined;
      if (a.repeat && a.rrule) no('Give repeat or rrule, not both.');
      if (a.rrule) {
        const raw = a.rrule.trim().replace(/^RRULE:/i, '');
        if (!parseRRule(raw)) no('That rrule isn’t one calendars use for events: FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY.');
        rrule = raw;
      } else if (a.repeat) {
        const r = a.repeat;
        const p = localParts(s.at, tz);
        const [y, mo, d] = p.day.split('-').map(Number);
        const wall = Date.UTC(y, mo - 1, d, allDay ? 0 : p.hour, allDay ? 0 : p.minute);
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        if (r.until && (!validDay(r.until) || r.until < p.day)) no('“until” must be a real date, on or after the start.');
        if (r.monthly === 'last_day' && d !== last) no('“last_day” needs a start on the last day of its month.');
        if (r.monthly === 'last_weekday' && d + 7 <= last) no('“last_weekday” needs a start in the last week of its month.');
        const spec: RepeatSpec = {
          freq: r.every === 'day' ? 'DAILY' : r.every === 'week' || r.every === 'weekday' ? 'WEEKLY' : r.every === 'month' ? 'MONTHLY' : 'YEARLY',
          interval: r.every === 'weekday' ? 1 : (r.interval ?? 1),
          ...(r.every === 'weekday' ? { days: [1, 2, 3, 4, 5] } : r.every === 'week' && r.days ? { days: r.days.map((x) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x)) } : {}),
          ...(r.every === 'month' ? { monthly: r.monthly === 'weekday' ? 'nth' : r.monthly === 'last_day' ? 'last' : r.monthly === 'last_weekday' ? 'lastWeekday' : 'date' } : {}),
          ...(r.times ? { count: r.times } : r.until ? { until: r.until } : {}),
        };
        rrule = specToRule(spec, wall, { floating: false, tz });
      }
      const team = new Map(v.members().map((u) => [lower(u.email), u]));
      const guests: Doc[] = [];
      const outside: string[] = [];
      for (const g of a.guests ?? []) {
        if (g.includes('@') && !team.has(lower(g))) {
          outside.push(g);
          continue;
        }
        const p = g.includes('@') ? team.get(lower(g))! : v.person(g);
        if (p.id !== v.me && !guests.some((x) => x.email === p.email)) guests.push({ name: p.name, email: p.email });
      }
      // A repeating one starts on its rule's first date (made on a Friday, weekly on Mondays: the next Monday).
      const when = startOnRule({ start: new Date(s.at).toISOString(), end: new Date(end).toISOString(), ...(rrule ? { rrule, timeZone: tz } : {}) });
      const ev = {
        id: v.newId(),
        title: a.title.trim(),
        calendarId: a.calendar ?? 'work',
        ...when,
        ...(allDay ? { allDay: true } : {}),
        ...(a.location ? { location: a.location } : {}),
        ...(a.video_link ? { meetUrl: a.video_link } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(guests.length ? { guests } : {}),
        workspaceId: v.ctx.wsId,
        userId: v.me,
      };
      const words = ev.rrule ? repeatWords(ev) : null;
      v.save('events', [ev], `added the event “${clip(ev.title, 100)}” on ${v.when(ev.start, allDay)}${words ? `, ${words.charAt(0).toLowerCase()}${words.slice(1)}` : ''}`);
      return {
        created: { id: ev.id, title: ev.title, ...(allDay ? { date: v.dayOf(ev.start), all_day: true } : { start: v.when(ev.start), end: v.time(ev.end) }), ...(words ? { repeats: words } : {}), ...(guests.length ? { guests: guests.map((g) => g.name) } : {}), link: v.link('calendar', ev.id) },
        ...(outside.length ? { not_added: outside, note: `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the company, so not added. Invite them from sprint2go.` } : {}),
      };
    },
  );

  /** People to write to: addresses as given, teammates by name. */
  const recipients = (v: View, list: string[]) =>
    list.map((x) => {
      const s = x.trim();
      const m = /^(.*)<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/.exec(s);
      if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || m[2].split('@')[0], email: m[2].toLowerCase() };
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { name: s.split('@')[0], email: s.toLowerCase() };
      const p = v.person(s);
      return p.email ? { name: p.name, email: lower(p.email) } : no(`${p.name} has no email address.`);
    });
  const draftThread = (v: View, box: Doc, to: Doc[], subject: string, text: string, extra: Doc = {}) => {
    const me = v.user(v.me);
    const from = { name: box.kind === 'shared' ? String(box.name || v.ws().name) : String(me?.name || box.name || ''), email: box.email };
    return {
      id: v.newId(),
      accountId: box.id,
      subject: subject.trim() || '(no subject)',
      location: 'drafts',
      starred: false,
      unread: false,
      labels: [],
      messages: [{ id: randomBytes(8).toString('hex'), from, to, date: new Date().toISOString(), body: text, html: textToHtml(text) }],
      ...extra,
    };
  };
  const draftNote = (v: View) => `Not sent: it’s a draft in ${v.ctx.demo ? 'the demo company’s' : 'your'} Drafts in sprint2go. Open it there, check it and press Send.`;

  tool(
    'draft_mail',
    {
      title: 'Draft an email',
      description: 'Writes a new email as a draft in your sprint2go Drafts. It is never sent from here: you open it in sprint2go, check it and send it.',
      inputSchema: {
        to: z.array(z.string()).min(1).max(50).describe('Email addresses, "Name <address>", or teammates’ names'),
        cc: z.array(z.string()).max(50).optional(),
        subject: z.string().max(500),
        text: z.string().max(100_000).describe('The email’s text'),
        mailbox: z.string().optional().describe('Which of your mailboxes it’s from (address or id); default your own'),
      },
      annotations: WRITE,
    },
    (a, v) => {
      const box = v.mailbox(a.mailbox);
      const to = recipients(v, [...a.to, ...(a.cc ?? [])]);
      const t = draftThread(v, box, to, a.subject, a.text);
      v.save('threads', [t], `drafted an email “${clip(t.subject, 100)}” to ${to.map((p) => p.email).join(', ').slice(0, 120)}`);
      return { draft: true, id: t.id, from: box.email, to: to.map((p) => p.email), subject: t.subject, message: draftNote(v), link: v.link('mail', t.id) };
    },
  );

  tool(
    'draft_reply',
    {
      title: 'Draft a reply',
      description: 'Writes a reply to a conversation in your mailboxes as a draft in your sprint2go Drafts, addressed to whoever wrote last (or everyone with reply_all). It is never sent from here.',
      inputSchema: { thread_id: z.string(), text: z.string().min(1).max(100_000), reply_all: z.boolean().optional() },
      annotations: WRITE,
    },
    (a, v) => {
      const boxes = v.mailboxes();
      const t = v.docs('threads').find((x) => x.id === a.thread_id && boxes.some((b) => b.id === x.accountId)) ?? no(`No conversation ${a.thread_id} in your mailboxes in ${v.ctx.company}.`);
      const box = boxes.find((b) => b.id === t.accountId)!;
      const msgs = (t.messages ?? []) as Doc[];
      const last = [...msgs].reverse().find((m) => m.from) ?? no('That conversation has no message to reply to.');
      const ours = (e: string) => v.mine(e) || lower(e) === lower(box.email);
      const base = ours(last.from.email) ? (last.to ?? []) : [last.from];
      const all = a.reply_all ? [...base, ...(last.to ?? [])] : base;
      const to: { name: string; email: string }[] = all.filter((p: Doc, i: number) => p?.email && !ours(p.email) && all.findIndex((x: Doc) => lower(x.email) === lower(p.email)) === i).map((p: Doc) => ({ name: p.name || p.email, email: lower(p.email) }));
      if (!to.length) no('There’s nobody outside your own mailboxes to reply to.');
      const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
      const refs = msgs.map((m) => m.mid).filter(Boolean);
      const d = draftThread(v, box, to, subject, a.text, { replyTo: { threadId: t.id, ...(last.mid ? { mid: last.mid } : {}), ...(refs.length ? { references: refs.slice(-20) } : {}) } });
      v.save('threads', [d], `drafted a reply to “${clip(t.subject, 100)}”`);
      return { draft: true, id: d.id, reply_to: t.id, to: to.map((p) => p.email), subject, message: draftNote(v), link: v.link('mail', d.id) };
    },
  );
}
