// A company's task stages: the board's columns and the choices for a task's status. Admins rename, add, reorder,
// colour and remove them (Settings, Task stages). Each stage has a kind, and everything that reacts to where a task
// is (Home, reminders, approvals, the guest portal, the server) checks the kind, never a stage's id or name.
// The five built-in stages keep the ids tasks always had ('todo', 'doing', 'waiting', 'review', 'done'), so nothing
// needs moving; stages a company adds get new ids.
import { term } from './terms';
import type { StageColor, StageKind, TaskStage, Todo, Workspace } from './types';

export const STAGE_KINDS: StageKind[] = ['open', 'active', 'waiting', 'review', 'done'];

/** What each kind means, in the settings' words. */
export const KIND_INFO: Record<StageKind, { name: string; hint: string }> = {
  open: { name: 'Not started', hint: 'New tasks land in the first one' },
  active: { name: 'In progress', hint: 'Start moves a task to the first one' },
  waiting: {
    get name() {
      return `Waiting on the ${term.who}`;
    },
    get hint() {
      return `The ${term.who}’s shared space says “Waiting on you”`;
    },
  },
  review: { name: 'Review', hint: 'The supervisor approves it or sends it back' },
  done: { name: 'Done', hint: 'Counts as finished everywhere' },
};

/** Colours a stage can have. Red stays for late work; amber is always waiting and green always done. */
export const STAGE_COLORS: StageColor[] = ['gray', 'accent', 'blue', 'violet', 'teal'];
export type StageTone = StageColor | 'amber' | 'green';
export const TONE_NAME: Record<StageTone, string> = { gray: 'Grey', accent: 'Brand colour', blue: 'Blue', violet: 'Violet', teal: 'Teal', amber: 'Amber', green: 'Green' };
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
const BUILT_IN: Record<string, () => string> = { todo: () => 'To do', doing: () => 'In progress', waiting: () => `Waiting on ${term.who}`, review: () => 'Review', done: () => 'Done' };
/** A built-in stage's usual name (it follows the company's words, e.g. "Waiting on client"). */
export const builtInName = (id: string) => BUILT_IN[id]?.();
export const stageName = (s: Pick<TaskStage, 'id' | 'name' | 'kind'>) => s.name?.trim() || BUILT_IN[s.id]?.() || KIND_INFO[s.kind].name;
/** The words on a task's row: the built-in review stage says what it's waiting for. */
export const stageBadge = (s: TaskStage) => (s.id === 'review' && !s.name?.trim() ? 'Waiting for review' : stageName(s));

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

// Every company's stages this person can see, so any screen finds a task's stage from its workspace.
const registry = new Map<string, { from: TaskStage[] | undefined; list: TaskStage[] }>();
let current = '';
/** Called while the app renders (like the company's words): every workspace on hand, and the one on screen. */
export function registerStages(workspaces: Pick<Workspace, 'id' | 'taskStages'>[], currentId?: string) {
  for (const w of workspaces) {
    if (registry.get(w.id)?.from === w.taskStages) continue; // unchanged: keep the same list, so memos hold
    registry.set(w.id, { from: w.taskStages, list: w.taskStages?.length ? cleanStages(w.taskStages) : DEFAULT_STAGES });
  }
  if (currentId) current = currentId;
}
/** A company's stages in board order (the one on screen when there's no id). */
export const stagesFor = (wsId?: string): TaskStage[] => (registry.get(wsId || current) ?? registry.get(current))?.list ?? DEFAULT_STAGES;

export const firstOf = (kind: StageKind, list: TaskStage[]) => list.find((s) => s.kind === kind);
export const hasKind = (kind: StageKind, wsId?: string) => stagesFor(wsId).some((s) => s.kind === kind);

/** A task's stage. One whose stage was removed (or that never had one) sits in the first open or done stage. */
export function stageOf(t: Pick<Todo, 'status' | 'done' | 'workspaceId'>, list: TaskStage[] = stagesFor(t.workspaceId)): TaskStage {
  const s = t.status ? list.find((x) => x.id === t.status) : undefined;
  if (s && (s.kind === 'done') === !!t.done) return s;
  return (t.done ? firstOf('done', list) : firstOf('open', list)) ?? list[0];
}
export const kindOf = (t: Pick<Todo, 'status' | 'done' | 'workspaceId'>, list?: TaskStage[]): StageKind => stageOf(t, list).kind;

/** Where a task goes for a kind: Start is the first active stage, ticking it the first done one, unticking the first open one. */
export function stageIdFor(t: Pick<Todo, 'workspaceId'>, kind: StageKind, list: TaskStage[] = stagesFor(t.workspaceId)): string {
  return (firstOf(kind, list) ?? firstOf(kind === 'done' ? 'done' : 'open', list) ?? list[0]).id;
}
