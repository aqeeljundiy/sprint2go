// A company's task stages: the board's columns and the choices for a task's status. Admins rename, add, reorder,
// colour and remove them (Settings, Task stages). Each stage has a kind, and everything that reacts to where a task
// is (Home, reminders, approvals, the guest portal, the server) checks the kind, never a stage's id or name.
// A project or a team can use its own stages instead (its settings, starting from a copy of the company's): a task
// follows its project's own stages, else its team's own, else the company's (stagesForTask).
// The five built-in stages keep the ids tasks always had ('todo', 'doing', 'waiting', 'review', 'done'), so nothing
// needs moving; stages a company adds get new ids.
import { term } from './terms';
import { phrase, t, type Msg } from './i18n/index'; // the full path: the server imports this file too (it gets English)
import type { StageColor, StageKind, TaskStage, Todo, Workspace } from './types';

export const STAGE_KINDS: StageKind[] = ['open', 'active', 'waiting', 'review', 'done'];

/** What each kind means, in the settings' words (in the reader's language: the server gets English). */
export const KIND_INFO: Record<StageKind, { name: string; hint: string }> = {
  open: {
    get name() {
      return t('Not started');
    },
    get hint() {
      return t('New tasks land in the first one');
    },
  },
  active: {
    get name() {
      return t('In progress');
    },
    get hint() {
      return t('Start moves a task to the first one');
    },
  },
  waiting: {
    get name() {
      return t('Waiting on the {who}', { who: term.who });
    },
    get hint() {
      return t('The {who}’s shared space says “Waiting on you”', { who: term.who });
    },
  },
  review: {
    get name() {
      return t('Review');
    },
    get hint() {
      return t('The supervisor approves it or sends it back');
    },
  },
  done: {
    get name() {
      return t('Done');
    },
    get hint() {
      return t('Counts as finished everywhere');
    },
  },
};

/** Colours a stage can have. Red stays for late work; amber is always waiting and green always done. */
export const STAGE_COLORS: StageColor[] = ['gray', 'accent', 'blue', 'violet', 'teal'];
export type StageTone = StageColor | 'amber' | 'green';
/** Each colour's name, in the reader's language. */
export const TONE_NAME: Record<StageTone, string> = {
  get gray() {
    return t('Grey');
  },
  get accent() {
    return t('Brand colour');
  },
  get blue() {
    return t('Blue');
  },
  get violet() {
    return t('Violet');
  },
  get teal() {
    return t('Teal');
  },
  get amber() {
    return t('Amber');
  },
  get green() {
    return t('Green');
  },
};
const KIND_TONE: Record<StageKind, StageTone> = { open: 'gray', active: 'accent', waiting: 'amber', review: 'violet', done: 'green' };
/** Waiting and done stages always wear their meaning's colour. */
export const fixedTone = (k: StageKind) => k === 'waiting' || k === 'done';
export const toneOf = (s: Pick<TaskStage, 'kind' | 'color'>): StageTone => (fixedTone(s.kind) ? KIND_TONE[s.kind] : s.color && STAGE_COLORS.includes(s.color) ? s.color : KIND_TONE[s.kind]);
export const kindTone = (k: StageKind) => KIND_TONE[k];

export const DEFAULT_STAGES: TaskStage[] = [
  { id: 'todo', kind: 'open' },
  { id: 'doing', kind: 'active' },
  { id: 'waiting', kind: 'waiting' },
  { id: 'review', kind: 'review' },
  { id: 'done', kind: 'done' },
];
// The built-in stages' names, in the reader's language (the server and the AI connector get English). A company's own
// names are what someone typed: they're never translated.
const BUILT_IN: Record<string, () => string> = {
  todo: () => t('To do'),
  doing: () => t('In progress'),
  waiting: () => t('Waiting on {who}', { who: term.who }),
  review: () => t('Review'),
  done: () => t('Done'),
};
/** A built-in stage's usual name (it follows the company's words, e.g. "Waiting on client"). */
export const builtInName = (id: string) => BUILT_IN[id]?.();
export const stageName = (s: Pick<TaskStage, 'id' | 'name' | 'kind'>) => s.name?.trim() || BUILT_IN[s.id]?.() || KIND_INFO[s.kind].name;
/** The words on a task's row: the built-in review stage says what it's waiting for. */
export const stageBadge = (s: TaskStage) => (s.id === 'review' && !s.name?.trim() ? t('Waiting for review') : stageName(s));

/**
 * A stage's name for words saved now and read later (a task's history): a company's own name as typed, a built-in
 * one as a phrase each reader sees in their own language.
 */
export function stagePhrase(s: Pick<TaskStage, 'id' | 'name' | 'kind'>): string | Msg {
  if (s.name?.trim()) return s.name.trim();
  const who = phrase(term.word === 'client' ? 'client' : 'guest');
  const built: Record<string, Msg> = { todo: phrase('To do'), doing: phrase('In progress'), waiting: phrase('Waiting on {who}', { who }), review: phrase('Review'), done: phrase('Done') };
  if (built[s.id]) return built[s.id];
  const kinds: Record<StageKind, Msg> = { open: phrase('Not started'), active: phrase('In progress'), waiting: phrase('Waiting on the {who}', { who }), review: phrase('Review'), done: phrase('Done') };
  return kinds[s.kind];
}

/** A list the app can work with: known kinds, no repeated ids, and at least one open and one done stage. */
export function cleanStages(list: unknown): TaskStage[] {
  if (!Array.isArray(list) || !list.length) return DEFAULT_STAGES;
  const seen = new Set<string>();
  const out: TaskStage[] = [];
  for (const s of list.slice(0, 20) as Partial<TaskStage>[]) {
    if (!s || typeof s.id !== 'string' || !s.id || s.id.length > 40 || seen.has(s.id) || !STAGE_KINDS.includes(s.kind as StageKind)) continue;
    seen.add(s.id);
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 40) : '';
    const color = s.color && STAGE_COLORS.includes(s.color) ? s.color : undefined;
    out.push({ id: s.id, kind: s.kind as StageKind, ...(name ? { name } : {}), ...(color ? { color } : {}) });
  }
  return out.some((s) => s.kind === 'open') && out.some((s) => s.kind === 'done') ? out : DEFAULT_STAGES;
}

// Every company's stages this person can see, so any screen finds a task's stage from its workspace; and the projects
// and teams that use stages of their own.
const registry = new Map<string, { from: TaskStage[] | undefined; list: TaskStage[] }>();
const own = { clients: new Map<string, { from: TaskStage[]; list: TaskStage[] }>(), teams: new Map<string, { from: TaskStage[]; list: TaskStage[] }>() };
let current = '';
type WithStages = { id: string; taskStages?: TaskStage[] };
/** A project's or team's own list, when it has a usable one (else it follows the company's). */
export const ownList = (x: { taskStages?: TaskStage[] } | undefined | null): TaskStage[] | null => {
  if (!x?.taskStages?.length) return null;
  const c = cleanStages(x.taskStages);
  return c === DEFAULT_STAGES ? null : c;
};
function keep(map: Map<string, { from: TaskStage[]; list: TaskStage[] }>, list: WithStages[] | undefined) {
  if (!list) return;
  const seen = new Set<string>();
  for (const x of list) {
    seen.add(x.id);
    if (!x.taskStages?.length) map.delete(x.id);
    else if (map.get(x.id)?.from !== x.taskStages) {
      const l = ownList(x);
      if (l) map.set(x.id, { from: x.taskStages, list: l });
      else map.delete(x.id);
    }
  }
  for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
}
/**
 * Called while the app renders (like the company's words): every workspace on hand, and the one on screen; with the
 * projects and teams on hand, the ones that use their own stages.
 */
export function registerStages(workspaces: Pick<Workspace, 'id' | 'taskStages'>[], currentId?: string, extra?: { clients?: WithStages[]; teams?: WithStages[] }) {
  for (const w of workspaces) {
    if (registry.get(w.id)?.from === w.taskStages) continue; // unchanged: keep the same list, so memos hold
    registry.set(w.id, { from: w.taskStages, list: w.taskStages?.length ? cleanStages(w.taskStages) : DEFAULT_STAGES });
  }
  keep(own.clients, extra?.clients);
  keep(own.teams, extra?.teams);
  if (currentId) current = currentId;
}
/** A company's stages in board order (the one on screen when there's no id). */
export const stagesFor = (wsId?: string): TaskStage[] => (registry.get(wsId || current) ?? registry.get(current))?.list ?? DEFAULT_STAGES;
/** A project's own stages, else null (it follows its team's or the company's). */
export const projectStages = (clientId?: string) => (clientId ? own.clients.get(clientId)?.list ?? null : null);
/** A team's own stages, else null. */
export const teamStages = (teamId?: string) => (teamId ? own.teams.get(teamId)?.list ?? null : null);
type TaskRef = Pick<Todo, 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>;
/** The stages a task follows: its project's own, else its team's own, else its company's. */
export const stagesForTask = (t: TaskRef): TaskStage[] => projectStages(t.clientId) ?? teamStages(t.teamId) ?? stagesFor(t.workspaceId);
/**
 * The same, from the documents themselves (the server, which has no registry): the project's own, the team's own, or
 * the company's.
 */
export const stagesFrom = (src: { client?: { taskStages?: TaskStage[] } | null; team?: { taskStages?: TaskStage[] } | null; workspace?: { taskStages?: TaskStage[] } | null }): TaskStage[] =>
  ownList(src.client) ?? ownList(src.team) ?? (src.workspace?.taskStages?.length ? cleanStages(src.workspace.taskStages) : DEFAULT_STAGES);
/** The board's columns for a page: a project's or team's own stages there, else the company's. */
export const stagesForScope = (wsId: string, scope: { clientId?: string; teamId?: string }): TaskStage[] => projectStages(scope.clientId) ?? teamStages(scope.teamId) ?? stagesFor(wsId);

/**
 * Which board column a task sits in when the board's stages aren't its own (My tasks, across projects with stages of
 * their own): its own stage when the board has it, else the board's first stage of the same kind.
 */
export function columnOf(t: Pick<Todo, 'status' | 'done' | 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>, board: TaskStage[]): TaskStage {
  const mine = stageOf(t);
  return board.find((s) => s.id === mine.id && s.kind === mine.kind) ?? firstOf(mine.kind, board) ?? (mine.kind === 'done' ? firstOf('done', board) : firstOf('open', board)) ?? board[0];
}
/** Moving a task onto a board column of other stages: the task's own first stage of that column's kind. */
export const ownStageForColumn = (t: TaskRef, col: TaskStage): TaskStage => {
  const list = stagesForTask(t);
  return list.find((s) => s.id === col.id) ?? firstOf(col.kind, list) ?? (col.kind === 'done' ? firstOf('done', list) : firstOf('open', list)) ?? list[0];
};

/**
 * A task moving to another project or team whose stages are different: its stage of the same name there, else the
 * first stage (a finished task stays finished: the first done stage). Null when the stages are the same.
 */
export function stageAfterMove(t: Pick<Todo, 'status' | 'done' | 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>, next: TaskRef): { stage: TaskStage; kept: boolean; from: TaskStage } | null {
  const before = stagesForTask(t);
  const after = stagesForTask(next);
  if (before === after || JSON.stringify(before) === JSON.stringify(after)) return null;
  const from = stageOf(t, before);
  const same = after.find((s) => stageName(s).trim().toLowerCase() === stageName(from).trim().toLowerCase() && (s.kind === 'done') === (from.kind === 'done'));
  const stage = same ?? (t.done ? firstOf('done', after) : after[0]) ?? after[0];
  return { stage, kept: !!same, from };
}

export const firstOf = (kind: StageKind, list: TaskStage[]) => list.find((s) => s.kind === kind);
export const hasKind = (kind: StageKind, wsId?: string) => stagesFor(wsId).some((s) => s.kind === kind);

/** A task's stage. One whose stage was removed (or that never had one) sits in the first open or done stage. */
export function stageOf(t: Pick<Todo, 'status' | 'done' | 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>, list: TaskStage[] = stagesForTask(t)): TaskStage {
  const s = t.status ? list.find((x) => x.id === t.status) : undefined;
  if (s && (s.kind === 'done') === !!t.done) return s;
  return (t.done ? firstOf('done', list) : firstOf('open', list)) ?? list[0];
}
export const kindOf = (t: Pick<Todo, 'status' | 'done' | 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>, list?: TaskStage[]): StageKind => stageOf(t, list).kind;

/** Where a task goes for a kind: Start is the first active stage, ticking it the first done one, unticking the first open one. */
export function stageIdFor(t: TaskRef, kind: StageKind, list: TaskStage[] = stagesForTask(t)): string {
  return (firstOf(kind, list) ?? firstOf(kind === 'done' ? 'done' : 'open', list) ?? list[0]).id;
}
