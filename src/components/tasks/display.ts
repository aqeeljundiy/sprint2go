import { useReducer } from 'react';
import { lsKey } from '../../settings';
import type { StageKind, Todo } from '../../types';
import { doersOf } from './taskOps';

/**
 * How a task view shows its tasks: the layout, completed tasks, grouping, order and who/what is filtered. Each view
 * (My tasks, Today, a team, a project…) remembers its own, on this device only: a phone never gets stuck on the board
 * someone picked on a computer.
 */
export type Layout = 'list' | 'board' | 'calendar';
export type GroupBy = 'date' | 'client' | 'team' | 'person' | 'stage' | 'none';
export type SortBy = 'smart' | 'due' | 'priority' | 'name' | 'newest';
export type Who = 'any' | 'me' | 'me-none' | 'none' | 'people';
export type Only = 'late' | 'high' | 'waiting';

export interface Display {
  layout: Layout;
  completed: boolean;
  group: GroupBy;
  sort: SortBy;
  who: Who;
  people: string[];
  only: Only[];
}

export function defaultDisplay(kind: string): Display {
  const group: GroupBy = kind === 'mine' || kind === 'today' ? 'date' : kind === 'team' ? 'person' : kind === 'project' ? 'stage' : kind === 'client' ? 'team' : 'client';
  return { layout: kind === 'upcoming' ? 'calendar' : 'list', completed: false, group, sort: 'smart', who: 'any', people: [], only: [] };
}

/** Where a view's display is kept: one per kind of view (all teams share one, all projects another). */
export const displayKey = (kind: string) => `s2g-tdisplay:${kind}`;

const cache = new Map<string, Display>();
function read(key: string, init: Display): Display {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (raw) return { ...init, ...(JSON.parse(raw) as Partial<Display>) };
  } catch {
    /* private window */
  }
  return init;
}
/** Keeps a view's display on this device. */
export function saveDisplay(kind: string, d: Display) {
  const key = displayKey(kind);
  cache.set(key, d);
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(d));
  } catch {
    /* private window: just for now */
  }
}

/** This device's display for a view. */
export function useDisplay(kind: string): [Display, (d: Display) => void, () => void] {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const key = displayKey(kind);
  let d = cache.get(key);
  if (!d) {
    d = read(key, defaultDisplay(kind));
    cache.set(key, d);
  }
  const set = (n: Display) => (saveDisplay(kind, n), bump());
  return [d, set, () => set(defaultDisplay(kind))];
}

/** The filters on now, in words ("Me", "Late"), for the line under the toolbar and the Display button. */
export function filterWords(d: Display, nameOf: (id: string) => string, waitingWord: string): string[] {
  const out: string[] = [];
  if (d.who === 'me') out.push('Me');
  if (d.who === 'me-none') out.push('Me and not assigned');
  if (d.who === 'none') out.push('Not assigned');
  if (d.who === 'people' && d.people.length) out.push(d.people.map(nameOf).join(', '));
  if (d.only.includes('late')) out.push('Late');
  if (d.only.includes('high')) out.push('High priority');
  if (d.only.includes('waiting')) out.push(waitingWord);
  return out;
}

export function applyFilters(tasks: Todo[], d: Display, me: string, today: string, kind: (t: Todo) => StageKind): Todo[] {
  return tasks.filter((t) => {
    const who = doersOf(t);
    if (d.who === 'me' && !who.includes(me)) return false;
    if (d.who === 'me-none' && !(who.includes(me) || !who.length)) return false;
    if (d.who === 'none' && who.length) return false;
    if (d.who === 'people' && d.people.length && !d.people.some((p) => who.includes(p))) return false;
    if (d.only.includes('late') && !(!t.done && t.due && t.due < today)) return false;
    if (d.only.includes('high') && t.priority !== 'high') return false;
    if (d.only.includes('waiting') && !(kind(t) === 'waiting' || t.approval?.status === 'waiting')) return false;
    return true;
  });
}

const prio = (t: Todo) => (t.priority === 'high' ? 0 : 1);
/** Smart: by day, high priority first within a day, then the oldest first. */
export function sortTasks(tasks: Todo[], by: SortBy): Todo[] {
  const list = [...tasks];
  const due = (t: Todo) => t.due ?? '9999';
  switch (by) {
    case 'due':
      return list.sort((a, b) => due(a).localeCompare(due(b)) || a.createdAt.localeCompare(b.createdAt));
    case 'priority':
      return list.sort((a, b) => prio(a) - prio(b) || due(a).localeCompare(due(b)));
    case 'name':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'newest':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      return list.sort((a, b) => due(a).localeCompare(due(b)) || prio(a) - prio(b) || a.createdAt.localeCompare(b.createdAt));
  }
}

export const GROUP_LABEL: Record<GroupBy, string> = { date: 'Date', client: 'Project', team: 'Team', person: 'Person', stage: 'Stage', none: 'None' };
export const SORT_LABEL: Record<SortBy, string> = { smart: 'Smart', due: 'Due date', priority: 'Priority', name: 'Name', newest: 'Newest first' };
