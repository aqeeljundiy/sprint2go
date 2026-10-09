// A Trello board (its JSON export: board menu, Print, export and share, Export as JSON) into a project with tasks.
//  - the board becomes a new project named after it, or goes into a project picked in the preview
//  - each list goes to one of the company's task stages (stages are the company's, so the admin maps them); the
//    list's name stays on each task's history
//  - cards become tasks: title, description, due date, labels (in the notes; "urgent" and the like make it high
//    priority), checklists as checklist items, comments as comments with their authors' names, members as the
//    people doing it (matched by email or name), and attachments as links in the notes
//  - archived cards and lists stay out unless the admin brings them in
import * as db from './db.ts';
import { readFileSync } from 'node:fs';
import { ImportError, limits, matchPerson, newId, sizeOf, suggest, type AnalyzeCtx, type RunCtx } from './importKit.ts';
import { cleanStages, stageName } from '../src/stages.ts';
import { companyTz } from '../src/jobTimes.ts';
import type { ImportList, ImportPreview } from '../src/importTypes.ts';
import type { StageKind, TaskStage } from '../src/types.ts';

const NOT_TRELLO = 'This isn’t a Trello board export. In Trello, open the board’s menu, then Print, export and share, then Export as JSON, and save that page as a .json file.';

type TList = { id: string; name?: string; closed?: boolean; pos?: number };
type TCard = { id: string; name?: string; desc?: string; closed?: boolean; idList?: string; idLabels?: string[]; labels?: { id?: string; name?: string; color?: string }[]; idMembers?: string[]; due?: string | null; dueComplete?: boolean; pos?: number; dateLastActivity?: string; attachments?: { name?: string; url?: string }[] };
type TMember = { id: string; fullName?: string; username?: string; email?: string };
type TChecklist = { id: string; name?: string; idCard?: string; pos?: number; checkItems?: { name?: string; state?: string; pos?: number }[] };
type TAction = { type?: string; date?: string; idMemberCreator?: string; memberCreator?: TMember; data?: { text?: string; card?: { id?: string } } };
interface Board {
  name: string;
  lists: TList[];
  cards: TCard[];
  members: TMember[];
  labels: { id: string; name?: string; color?: string }[];
  checklists: TChecklist[];
  actions: TAction[];
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown) => (typeof x === 'string' ? x : '');

function readBoard(file: string): Board {
  if (sizeOf(file) > limits().json) throw new ImportError(`That board is over ${Math.round(limits().json / 1024 / 1024)} MB, more than one import takes.`);
  const text = readFileSync(file, 'utf8');
  if (text.startsWith('PK')) throw new ImportError(`That’s a zip file. ${NOT_TRELLO}`);
  let b: any;
  try {
    b = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ImportError(NOT_TRELLO);
  }
  if (!b || typeof b !== 'object' || !Array.isArray(b.lists) || !Array.isArray(b.cards)) throw new ImportError(NOT_TRELLO);
  const ok = <T extends { id?: unknown }>(l: unknown) => arr<T>(l).filter((x) => x && typeof x === 'object' && typeof x.id === 'string');
  return { name: str(b.name).trim().slice(0, 80) || 'Trello board', lists: ok<TList>(b.lists), cards: ok<TCard>(b.cards), members: ok<TMember>(b.members), labels: ok<{ id: string }>(b.labels), checklists: ok<TChecklist>(b.checklists), actions: arr<TAction>(b.actions).filter((a) => a && typeof a === 'object') };
}

/** The company's stages, in board order. */
export const stagesOf = (ws: any): TaskStage[] => cleanStages(ws?.taskStages);

/** Where a list's cards most likely go: a stage with the same name, else by what the name says. */
export function guessStage(name: string, stages: TaskStage[]): string {
  const n = name.trim().toLowerCase();
  const same = stages.find((s) => stageName(s).toLowerCase() === n);
  if (same) return same.id;
  const kind: StageKind = /done|complete|finished|shipped|closed|launched|published|delivered|selesai/.test(n)
    ? 'done'
    : /review|qa\b|check|approv|feedback/.test(n)
      ? 'review'
      : /wait|block|hold|pending|client/.test(n)
        ? 'waiting'
        : /doing|progress|working|wip|active|current|this week|today|ongoing|started/.test(n)
          ? 'active'
          : 'open';
  return (stages.find((s) => s.kind === kind) ?? stages.find((s) => s.kind === 'open') ?? stages[0]).id;
}

const archivedCard = (c: TCard, lists: Map<string, TList>) => !!c.closed || !!lists.get(String(c.idList))?.closed;

/** The preview: the board, its lists with a stage each, and the people on its cards and comments. */
export async function analyze(ctx: AnalyzeCtx): Promise<ImportPreview> {
  ctx.progress('Reading the board', 0, 1);
  const b = readBoard(ctx.file);
  const lists = new Map(b.lists.map((l) => [l.id, l]));
  const stages = stagesOf(ctx.ws);
  const comments = b.actions.filter((a) => a.type === 'commentCard' && str(a.data?.text));
  // The people who matter: on a card, or who wrote a comment.
  const byId = new Map(b.members.map((m) => [m.id, m]));
  const appear = new Set<string>();
  for (const c of b.cards) for (const id of arr<string>(c.idMembers)) appear.add(id);
  for (const a of comments) {
    const id = str(a.idMemberCreator) || str(a.memberCreator?.id);
    if (!id) continue;
    appear.add(id);
    if (!byId.has(id) && a.memberCreator) byId.set(id, { ...a.memberCreator, id });
  }
  const people = [...appear]
    .map((id) => {
      const m = byId.get(id);
      const name = str(m?.fullName) || str(m?.username) || 'Someone';
      const email = str(m?.email).toLowerCase() || undefined;
      const hit = matchPerson(ctx.members, { email, names: [str(m?.fullName), str(m?.username)] });
      return { key: id, name, ...(email ? { email } : {}), ...(hit ? { match: hit.id, how: hit.how } : {}), canInvite: !!email };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const sorted = [...b.lists].sort((x, y) => (Number(x.pos) || 0) - (Number(y.pos) || 0));
  const listsOut: ImportList[] = sorted.map((l) => ({
    key: l.id,
    name: str(l.name) || 'Untitled list',
    cards: b.cards.filter((c) => c.idList === l.id && (l.closed || !c.closed)).length,
    ...(l.closed ? { archived: true } : {}),
    suggested: guessStage(str(l.name), stages),
  }));
  const same = (db.allDocs('clients') as any[]).find((c) => c.workspaceId === ctx.ws.id && String(c.name).trim().toLowerCase() === b.name.toLowerCase() && c.status !== 'ended');
  ctx.progress('Reading the board', 1, 1);
  return {
    source: 'trello',
    title: b.name,
    people: suggest(people, ctx.seats),
    board: { name: b.name, cards: b.cards.filter((c) => !archivedCard(c, lists)).length, archivedCards: b.cards.filter((c) => archivedCard(c, lists)).length, comments: comments.length, ...(same ? { sameName: same.id } : {}) },
    lists: listsOut,
    room: ctx.room,
    seatsLeft: ctx.seats,
  };
}

const COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'];
const HIGH = /urgent|high|priority|important|asap|critical|penting/i;
/** When a card was made: its createCard action, else the time inside its id. */
const madeAt = (c: TCard, created: Map<string, string>) => created.get(c.id) ?? (/^[a-f0-9]{24}$/.test(c.id) ? new Date(parseInt(c.id.slice(0, 8), 16) * 1000).toISOString() : new Date().toISOString());

export async function run(ctx: RunCtx) {
  const b = readBoard(ctx.file);
  const ws = ctx.ws;
  const tz = companyTz(ws);
  const lists = new Map(b.lists.map((l) => [l.id, l]));
  const stages = stagesOf(ws);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const labels = new Map(b.labels.map((l: any) => [l.id, l]));
  const memberOf = (id: string) => ctx.people.get(id);
  const created = new Map<string, string>();
  const commentsOf = new Map<string, TAction[]>();
  for (const a of b.actions) {
    const card = str(a.data?.card?.id);
    if (!card) continue;
    if (a.type === 'createCard' && str(a.date)) created.set(card, a.date!);
    if (a.type === 'commentCard' && str(a.data?.text)) commentsOf.set(card, [...(commentsOf.get(card) ?? []), a]);
  }
  const checklistsOf = new Map<string, TChecklist[]>();
  for (const cl of b.checklists) if (cl.idCard) checklistsOf.set(cl.idCard, [...(checklistsOf.get(cl.idCard) ?? []), cl]);

  // The project: the one picked, or a new one named after the board with the board's people on it.
  let projectId = ctx.choices.projectId;
  const now = new Date().toISOString();
  if (!projectId) {
    projectId = newId('c-');
    const team = [...new Set([...ctx.people.values()].map((p) => p.userId).filter((x): x is string => !!x && x !== ctx.me))];
    const color = COLORS[(db.allDocs('clients') as any[]).filter((c) => c.workspaceId === ws.id).length % COLORS.length];
    ctx.add('clients', [{ id: projectId, workspaceId: ws.id, name: b.name, color, status: 'active', since: now, ownerId: ctx.me, members: team.map((userId) => ({ userId, role: 'member', addedBy: ctx.me, at: now })) }]);
    ctx.made('projects', 1);
  }

  const cards = b.cards.filter((c) => ctx.choices.archived || !archivedCard(c, lists)).sort((x, y) => (Number(x.pos) || 0) - (Number(y.pos) || 0));
  const dateIn = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD where the company is
  };
  let batch: db.Doc[] = [];
  let made = 0;
  const flush = async () => {
    ctx.add('todos', batch);
    made += batch.length;
    batch = [];
    await ctx.breathe();
  };
  for (const [i, c] of cards.entries()) {
    const list = lists.get(String(c.idList));
    const stage = stageById.get(ctx.choices.stages?.[String(c.idList)] ?? '') ?? stages.find((s) => s.kind === 'open') ?? stages[0];
    const done = stage.kind === 'done' || !!c.dueComplete;
    const status = done && stage.kind !== 'done' ? (stages.find((s) => s.kind === 'done') ?? stage).id : stage.id;
    const doing = arr<string>(c.idMembers).map(memberOf);
    const assignees = [...new Set(doing.map((p) => p?.userId).filter((x): x is string => !!x))];
    const notHere = doing.filter((p) => p && !p.userId).map((p) => p!.name);
    const labelNames = [...arr<{ name?: string; color?: string }>(c.labels), ...arr<string>(c.idLabels).map((id) => labels.get(id)).filter(Boolean)].map((l: any) => str(l?.name) || (l?.color ? `${l.color} label` : '')).filter(Boolean);
    const uniqLabels = [...new Set(labelNames)];
    const links = arr<{ name?: string; url?: string }>(c.attachments).filter((a) => /^https?:\/\//i.test(str(a.url)));
    const notes = [
      str(c.desc).trim(),
      uniqLabels.length ? `Labels: ${uniqLabels.join(', ')}` : '',
      notHere.length ? `On this card in Trello: ${notHere.join(', ')}` : '',
      links.length ? `Attachments:\n${links.map((a) => `- ${str(a.name) && str(a.name) !== str(a.url) ? `${str(a.name)}: ` : ''}${str(a.url)}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 20_000);
    const checklist = (checklistsOf.get(c.id) ?? [])
      .sort((x, y) => (Number(x.pos) || 0) - (Number(y.pos) || 0))
      .flatMap((cl, _, all) =>
        arr<{ name?: string; state?: string; pos?: number }>(cl.checkItems)
          .sort((x, y) => (Number(x.pos) || 0) - (Number(y.pos) || 0))
          .map((it) => ({ id: newId('ck-'), text: `${all.length > 1 && str(cl.name) ? `${str(cl.name)}: ` : ''}${str(it.name)}`.slice(0, 300), done: it.state === 'complete' })),
      )
      .filter((x) => x.text.trim());
    const comments = (commentsOf.get(c.id) ?? [])
      .sort((x, y) => String(x.date).localeCompare(String(y.date)))
      .map((a) => {
        const key = str(a.idMemberCreator) || str(a.memberCreator?.id);
        const who = memberOf(key);
        const name = who?.name || str(a.memberCreator?.fullName) || str(a.memberCreator?.username) || 'Former member';
        return { id: newId('h-'), at: str(a.date) || now, kind: 'comment', text: str(a.data?.text).slice(0, 10_000), ...(who?.userId ? { by: who.userId } : { by: `former:${key || 'trello'}`, byName: name }) };
      });
    const at = madeAt(c, created);
    const due = c.due ? dateIn(c.due) : undefined;
    batch.push({
      id: newId('t-'),
      kind: 'task',
      title: (str(c.name).trim() || 'Untitled card').slice(0, 300),
      ...(notes ? { notes } : {}),
      ...(due ? { due } : {}),
      done,
      status,
      ...(done ? { doneAt: str(c.dateLastActivity) || now, doneBy: ctx.me } : {}),
      priority: uniqLabels.some((l) => HIGH.test(l)) ? 'high' : 'normal',
      source: 'manual',
      userId: assignees[0] ?? '',
      assignees,
      ...(checklist.length ? { checklist } : {}),
      history: [...comments, { id: newId('h-'), at: now, by: ctx.me, kind: 'created', text: `brought this in from Trello (list “${str(list?.name) || 'Untitled list'}”)` }],
      createdBy: ctx.me,
      clientId: projectId,
      workspaceId: ws.id,
      createdAt: at,
    });
    if (batch.length >= 300) {
      await flush();
      ctx.progress('Making tasks', i + 1, cards.length);
    }
  }
  await flush();
  ctx.progress('Making tasks', cards.length, cards.length);
  ctx.made('tasks', made);
}
