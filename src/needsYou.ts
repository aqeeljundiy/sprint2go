// "Needs you": what one person has to act on now, across apps, most urgent first. Home shows it (and its count is the
// Home badge on phones); the AI connector's needs_me tool (server/mcpTools.ts) answers from the same rules, so Home and
// Claude always agree. Pure: no React and no browser, the inputs come from the app's state or the server's lens.
// The words come in the active language (English on the server, which is what the connector wants). The imports name
// the file, not the folder: the server can't import a folder.
import type { StageKind } from './types';
import { t, tn, textOf, type Msg } from './i18n/index';

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
  tr?: Msg; // the words to show each reader in their own language (msg() in src/i18n)
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
  dayWords?: (day: string) => string; // "yesterday", "6 Oct": read mid-sentence ("Was due 6 Oct")
  minutes?: (iso: string) => string; // "10:30"
}

const doersOf = (tk: TaskIn) => (tk.assignees?.length ? tk.assignees : tk.userId ? [tk.userId] : []);
const lastFrom = (th: ThreadIn) => th.messages[th.messages.length - 1]?.from;

/** Everything that needs this person, most urgent first. */
export function needsYou(p: NeedsInput): Need[] {
  const { me, today, now } = p;
  const work = p.tasks.filter((tk) => tk.kind !== 'brief');
  const open = work.filter((tk) => !tk.done);
  const late = (tk: TaskIn) => !tk.done && !!tk.due && tk.due < today;
  const leads = p.teams.filter((tm) => tm.leadId === me);
  const queue = open.filter((tk) => !tk.userId && !doersOf(tk).length && (p.isOwner || leads.some((tm) => tm.id === tk.teamId)));
  const project = (id?: string) => p.clients.find((c) => c.id === id)?.name;
  const words = p.dayWords ?? ((d: string) => d);
  const out: Need[] = [];
  const task = (rank: number, kind: NeedKind, group: NeedGroup, tk: TaskIn, sub: string, tone?: 'warn') =>
    out.push({ key: `${kind}:${tk.id}`, rank, kind, group, text: tk.title, sub, taskId: tk.id, noticeIds: [], due: tk.due, ...(tone ? { tone } : {}) });

  for (const e of p.events ?? []) {
    const start = Date.parse(e.start);
    if (e.allDay || Date.parse(e.end) <= now || start > now + 30 * 60_000 || start < now - 5 * 60_000) continue;
    const mins = Math.round((start - now) / 60_000);
    const sub = mins <= 0 ? t('Happening now') : mins === 1 || !p.minutes ? tn(mins, 'In {n} min', 'In {n} min') : tn(mins, 'In {n} min, at {time}', 'In {n} min, at {time}', { time: p.minutes(e.start) });
    out.push({ key: `meeting:${e.id}`, rank: 100, kind: 'meeting', group: 'now', text: e.title, sub, eventId: e.id, noticeIds: [] });
  }
  for (const tk of open) {
    const k = p.stageKind(tk);
    const who = project(tk.clientId);
    if (k === 'review' && tk.supervisorId === me) task(90, 'review', 'needs', tk, t('{name} finished it, waiting for your review', { name: p.firstName(doersOf(tk)[0]) || t('Someone') }));
    else if (tk.approval?.status === 'changes' && doersOf(tk).includes(me)) {
      const name = who ?? t('The guest');
      task(88, 'changes', 'needs', tk, tk.approval.note ? t('{name} asked for changes: “{note}”', { name, note: tk.approval.note }) : t('{name} asked for changes', { name }), 'warn');
    } else if (tk.source === 'request' && k === 'open' && (doersOf(tk).includes(me) || (!tk.userId && leads.some((tm) => tm.id === tk.teamId))))
      task(85, 'request', 'needs', tk, who ? t('New request from {name}', { name: who }) : t('New request from a guest'));
    else if (doersOf(tk).includes(me) && late(tk)) task(80, 'late', 'needs', tk, t('Was due {when}', { when: words(tk.due!) }), 'warn');
    else if (doersOf(tk).includes(me) && tk.due === today && k !== 'review') task(70, 'today', 'today', tk, t('Due today'));
  }
  for (const tk of queue)
    if (!out.some((x) => x.taskId === tk.id)) {
      const team = p.teams.find((x) => x.id === tk.teamId)?.name;
      task(60, 'queue', 'needs', tk, team ? t('{team} queue, nobody on it yet', { team }) : t('Team queue, nobody on it yet'));
    }
  for (const tk of work)
    if (tk.createdBy === me && tk.userId && !doersOf(tk).includes(me) && late(tk)) {
      const name = p.firstName(tk.userId);
      task(50, 'delegated', 'needs', tk, name ? t('Late with {name}', { name }) : t('Late with someone'), 'warn');
    }
  for (const th of p.threads ?? []) {
    const from = lastFrom(th);
    if (!from || th.location !== 'inbox' || !th.unread || p.mine?.(from.email)) continue;
    const mail = from.email.toLowerCase();
    if (!p.clients.some((c) => c.domain && mail.endsWith('@' + c.domain.toLowerCase()))) continue;
    out.push({ key: `mail:${th.id}`, rank: 45, kind: 'mail', group: 'needs', text: th.subject || t('(no subject)'), sub: t('{name} is waiting for a reply', { name: from.name || from.email }), threadId: th.id, noticeIds: [] });
  }
  for (const b of p.tasks) {
    if (b.kind !== 'brief' || b.done || b.userId !== me) continue;
    const subs = work.filter((tk) => tk.briefId === b.id);
    if (subs.length && subs.every((tk) => tk.done)) task(30, 'brief', 'needs', b, t('Every task is done, close the brief'));
  }

  // Notifications that ask something of you fold in: mentions, guests writing, and news about your own open work.
  // One that's about an item already listed joins that item (acting on it marks it read).
  for (const n of (p.notices ?? []).filter((x) => !x.read).sort((a, b) => b.at.localeCompare(a.at))) {
    const id = n.link?.id;
    const onTask = n.link?.app === 'tasks' && id ? p.tasks.find((tk) => tk.id === id) : undefined;
    const covered = out.find((x) => (onTask && x.taskId === onTask.id) || (n.link?.app === 'mail' && id && x.threadId === id));
    if (covered) {
      covered.noticeIds.push(n.id);
      continue;
    }
    const base = { key: `notice:${n.id}`, text: textOf(n), noticeIds: [n.id], at: n.at, link: n.link, group: 'needs' as const };
    if (n.kind === 'mention') out.push({ ...base, rank: 84, kind: 'mention', sub: t('Mentioned you') });
    else if (n.fromGuest) out.push({ ...base, rank: 83, kind: 'guest', sub: t('From a guest') });
    else if (onTask && !onTask.done && (doersOf(onTask).includes(me) || onTask.supervisorId === me || (!onTask.userId && leads.some((tm) => tm.id === onTask.teamId))))
      out.push({ ...base, rank: 82, kind: 'assigned', sub: project(onTask.clientId) ?? t('Your task'), taskId: onTask.id, due: onTask.due });
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
