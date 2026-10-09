import type { Client, Repeat, TaskStage, TaskStatus, Team, Todo, User } from '../../types';
import { toast } from '../../toast';

/** A new task, as Quick Add, Duplicate and the board's "Add task" make it. */
export interface NewTask {
  title: string;
  userId: string;
  assignees?: string[];
  clientId?: string;
  teamId?: string;
  due?: string;
  priority?: 'high' | 'normal';
  repeat?: Repeat;
  remindAt?: string;
  status?: TaskStatus;
  notes?: string;
  checklist?: Todo['checklist'];
  briefId?: string;
}

/** Everything the task screens need to read and change tasks (handed down from the app). */
export interface TaskOps {
  me: string;
  today: string; // YYYY-MM-DD
  wsId: string;
  tasks: Todo[];
  users: User[];
  clients: Client[];
  teams: Team[];
  stages: TaskStage[];
  open: (id: string) => void;
  status: (id: string, s: TaskStatus, quiet?: boolean) => void;
  patch: (id: string, p: Partial<Todo>) => void;
  remove: (ids: string[], quiet?: boolean) => void;
  add: (t: NewTask) => string;
  toCalendar: (t: Todo) => void;
}

/** Everyone doing a task (older tasks only have userId). */
export const doersOf = (t: Pick<Todo, 'assignees' | 'userId'>) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);

/** A link that opens the task in sprint2go (the same address notifications use). */
export const taskLink = (wsId: string, id: string) => `${location.origin}/tasks?ws=${encodeURIComponent(wsId)}&id=${encodeURIComponent(id)}`;

export async function copyTaskLink(wsId: string, id: string) {
  const url = taskLink(wsId, id);
  try {
    await navigator.clipboard.writeText(url);
    toast({ text: 'Link copied' });
  } catch {
    toast({ text: 'Couldn’t copy here. The link: ' + url, ms: 9000 });
  }
}

/** A copy of a task: what it is and who does it, not its history or done state. */
export function duplicateOf(t: Todo): NewTask {
  return {
    title: t.title,
    userId: t.userId,
    assignees: t.assignees,
    clientId: t.clientId,
    teamId: t.teamId,
    due: t.due,
    priority: t.priority,
    repeat: t.repeat,
    notes: t.notes,
    checklist: t.checklist?.map((c) => ({ ...c, id: Math.random().toString(36).slice(2), done: false })),
    briefId: t.briefId,
  };
}

/** "“Send the invoice”", cut short for a toast. */
export const quoted = (title: string) => `“${title.length > 40 ? title.slice(0, 40).trimEnd() + '…' : title}”`;
