// "Needs you": what one person has to act on now, across apps, most urgent first. Home shows it (and its count is the
// Home badge on phones); the AI connector's needs_me tool (server/mcpTools.ts) answers from the same rules, so Home and
// Claude always agree. Pure: no React and no browser, the inputs come from the app's state or the server's lens.
import type { StageKind } from './types';

export type NeedKind =
  | 'meeting' // starts within 30 minutes (or started under 5 minutes ago): Join
  | 'review' // someone finished work you supervise: Approve
  | 'changes' // a guest asked for changes on work you do: Open
  | 'request' // a new guest request for you or your team: Start
  | 'mention' // you were mentioned: Reply
  | 'guest' // a guest wrote: Reply
  | 'assigned' // new on your plate (assigned, sent back, a comment, a reminder): Done or Open
  | 'late' // your task is overdue: Done
  | 'queue' // your team's queue has work nobody picked up: Assign
  | 'delegated' // work you handed out is late: Remind
  | 'mail' // a client wrote and is waiting for your reply: Reply
  | 'brief' // every task in your brief is done: Close brief
  | 'today'; // your task is due today: Done

/** Where an item shows on Home: the meeting strip, the Needs you list (the badge), or Today. */
export type NeedGroup = 'now' | 'needs' | 'today';

export interface Need {
  key: string;
  rank: number;
  kind: NeedKind;
  group: NeedGroup;
  text: string; // the thing (a task's title, a mail's subject, the notification)
  sub: string; // why it needs you
  taskId?: string;
  threadId?: string;
  eventId?: string;
  link?: { app: string; id?: string; msg?: string }; // a notification's own place
  noticeIds: string[]; // notifications this item answers (acting on it marks them read)
  at?: string; // when it happened (notifications)
  due?: string;
  tone?: 'warn';
}

interface TaskIn {
  id: string;
  title: string;
  kind?: string;
  done: boolean;
  due?: string;
  status?: string;
  userId: string;
  assignees?: string[];
  supervisorId?: string;
  createdBy?: string;
  teamId?: string;
  clientId?: string;
  briefId?: string;
  source?: string;
  approval?: { status: string; note?: string };
}
interface NoticeIn {
  id: string;
  kind: string;
  text: string;
  at: string;
  read: boolean;
  fromGuest?: boolean;
  link?: { app: string; id?: string; msg?: string };
}
interface ThreadIn {
  id: string;
  subject: string;
  location?: string;
  unread?: boolean;
  messages: { from: { name?: string; email: string } }[];
}
interface EventIn {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
}

export interface NeedsInput {
  me: string;
  today: string; // YYYY-MM-DD in the person's (or company's) time
  now: number; // ms
  tasks: TaskIn[]; // work and briefs this person can see
  stageKind: (t: TaskIn) => StageKind;
  teams: { id: string; name: string; leadId?: string }[];
  clients: { id: string; name: string; domain?: string }[];
  isOwner: boolean; // the owner sees every team's queue
  firstName: (userId: string) => string;
  events?: EventIn[]; // this person's own calendar
  threads?: ThreadIn[]; // their mailboxes
  mine?: (email: string) => boolean; // an address of theirs
  notices?: NoticeIn[]; // their notifications here
  dayWords?: (day: string) => string; // "Tue 6 Oct"
  minutes?: (iso: string) => string; // "10:30"
}

const doersOf = (t: TaskIn) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
const lastFrom = (t: ThreadIn) => t.messages[t.messages.length - 1]?.from;

/** Everything that needs this person, most urgent first. */
export function needsYou(p: NeedsInput): Need[] {
  const { me, today, now } = p;
  const work = p.tasks.filter((t) => t.kind !== 'brief');
  const open = work.filter((t) => !t.done);
  const late = (t: TaskIn) => !t.done && !!t.due && t.due < today;
  const mine = open.filter((t) => doersOf(t).includes(me));
  const leads = p.teams.filter((t) => t.leadId === me);
  const queue = open.filter((t) => !t.userId && !doersOf(t).length && (p.isOwner || leads.some((tm) => tm.id === t.teamId)));
  const project = (id?: string) => p.clients.find((c) => c.id === id)?.name;
  const words = p.dayWords ?? ((d: string) => d);
  const out: Need[] = [];
  const task = (rank: number, kind: NeedKind, group: NeedGroup, t: TaskIn, sub: string, tone?: 'warn') =>
    out.push({ key: `${kind}:${t.id}`, rank, kind, group, text: t.title, sub, taskId: t.id, noticeIds: [], due: t.due, ...(tone ? { tone } : {}) });

  for (const e of p.events ?? []) {
    const start = Date.parse(e.start);
    if (e.allDay || Date.parse(e.end) <= now || start > now + 30 * 60_000 || start < now - 5 * 60_000) continue;
    const mins = Math.round((start - now) / 60_000);
    out.push({ key: `meeting:${e.id}`, rank: 100, kind: 'meeting', group: 'now', text: e.title, sub: mins <= 0 ? 'Happening now' : mins === 1 ? 'In 1 min' : `In ${mins} min${p.minutes ? `, at ${p.minutes(e.start)}` : ''}`, eventId: e.id, noticeIds: [] });
  }
  for (const t of open) {
    const k = p.stageKind(t);
    if (k === 'review' && t.supervisorId === me) task(90, 'review', 'needs', t, `${p.firstName(doersOf(t)[0]) || 'Someone'} finished it, waiting for your review`);
    else if (t.approval?.status === 'changes' && doersOf(t).includes(me)) task(88, 'changes', 'needs', t, `${project(t.clientId) ?? 'The guest'} asked for changes${t.approval.note ? `: “${t.approval.note}”` : ''}`, 'warn');
    else if (t.source === 'request' && k === 'open' && (doersOf(t).includes(me) || (!t.userId && leads.some((tm) => tm.id === t.teamId)))) task(85, 'request', 'needs', t, `New request from ${project(t.clientId) ?? 'a guest'}`);
    else if (doersOf(t).includes(me) && late(t)) task(80, 'late', 'needs', t, `Was due ${words(t.due!)}`, 'warn');
    else if (doersOf(t).includes(me) && t.due === today && k !== 'review') task(70, 'today', 'today', t, 'Due today');
  }
  for (const t of queue) if (!out.some((x) => x.taskId === t.id)) task(60, 'queue', 'needs', t, `${p.teams.find((x) => x.id === t.teamId)?.name ?? 'Team'} queue, nobody on it yet`);
  for (const t of work) if (t.createdBy === me && t.userId && !doersOf(t).includes(me) && late(t)) task(50, 'delegated', 'needs', t, `Late with ${p.firstName(t.userId) || 'someone'}`, 'warn');
  for (const t of p.threads ?? []) {
    const from = lastFrom(t);
    if (!from || t.location !== 'inbox' || !t.unread || p.mine?.(from.email)) continue;
    const mail = from.email.toLowerCase();
    if (!p.clients.some((c) => c.domain && mail.endsWith('@' + c.domain.toLowerCase()))) continue;
    out.push({ key: `mail:${t.id}`, rank: 45, kind: 'mail', group: 'needs', text: t.subject || '(no subject)', sub: `${from.name || from.email} is waiting for a reply`, threadId: t.id, noticeIds: [] });
  }
  for (const b of p.tasks) {
    if (b.kind !== 'brief' || b.done || b.userId !== me) continue;
    const subs = work.filter((t) => t.briefId === b.id);
    if (subs.length && subs.every((t) => t.done)) task(30, 'brief', 'needs', b, 'Every task is done, close the brief');
  }

  // Notifications that ask something of you fold in: mentions, guests writing, and news about your own open work.
  // One that's about an item already listed joins that item (acting on it marks it read).
  for (const n of (p.notices ?? []).filter((x) => !x.read).sort((a, b) => b.at.localeCompare(a.at))) {
    const id = n.link?.id;
    const onTask = n.link?.app === 'tasks' && id ? p.tasks.find((t) => t.id === id) : undefined;
    const covered = out.find((x) => (onTask && x.taskId === onTask.id) || (n.link?.app === 'mail' && id && x.threadId === id));
    if (covered) {
      covered.noticeIds.push(n.id);
      continue;
    }
    const base = { key: `notice:${n.id}`, text: n.text, noticeIds: [n.id], at: n.at, link: n.link, group: 'needs' as const };
    if (n.kind === 'mention') out.push({ ...base, rank: 84, kind: 'mention', sub: 'Mentioned you' });
    else if (n.fromGuest) out.push({ ...base, rank: 83, kind: 'guest', sub: 'From a guest' });
    else if (onTask && !onTask.done && (doersOf(onTask).includes(me) || onTask.supervisorId === me || (!onTask.userId && leads.some((tm) => tm.id === onTask.teamId))))
      out.push({ ...base, rank: 82, kind: 'assigned', sub: project(onTask.clientId) ?? 'Your task', taskId: onTask.id, due: onTask.due });
  }
  return out.sort((a, b) => b.rank - a.rank || (a.due ?? '').localeCompare(b.due ?? '') || (b.at ?? '').localeCompare(a.at ?? ''));
}

/** The unread notifications Needs you didn't take: news to read, not to act on (Home's Updates on phones). */
export function updatesOf<N extends NoticeIn>(notices: N[], needs: Need[]): N[] {
  const taken = new Set(needs.flatMap((x) => x.noticeIds));
  return notices.filter((n) => !n.read && !taken.has(n.id)).sort((a, b) => b.at.localeCompare(a.at));
}

/** The Home badge: what's in Needs you (not the meeting strip, not Today). */
export const needsCount = (needs: Need[]) => needs.filter((x) => x.group === 'needs').length;
