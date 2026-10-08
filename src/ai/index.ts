import type { Thread } from '../types';
import { localDay } from '../utils';
import * as demo from './demo';
export type { DumpTask, DumpPerson, DumpClient, DumpTeam, DumpBrief, DumpPlan, DumpInput } from './demo';

// sprint2go AI client. With the local server, each job goes to the AI the company picked in Settings (server/llm.ts).
// Without a server, or before anyone adds a key, a small built-in demo stands in so every feature can be tried.
import { server } from '../sync';
import { caps } from '../caps';

const ENV_URL = (import.meta.env.VITE_AI_URL as string | undefined)?.replace(/\/$/, '');
const state = { workspaceId: '', live: !!ENV_URL };
/** Whether answers come from a real AI right now (false = the demo). */
export const aiLive = () => state.live;
/** The workspace AI calls are for; asks the server whether it has a key for it. */
export function setAIWorkspace(id: string) {
  state.workspaceId = id;
  if (!server.on) return;
  void fetch(`/api/ai/status?ws=${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : { live: false }))
    .then((d: { live: boolean }) => (state.live = d.live));
}
const URL = () => (server.on ? '' : ENV_URL);
const useServer = () => server.on || !!ENV_URL;

export type RewriteStyle = 'shorter' | 'formal' | 'friendly' | 'fix';
export interface Summary {
  summary: string;
  asks: string[];
}
export interface AITodo {
  title: string;
  due: string | null;
  priority: 'high' | 'normal';
}

const plain = (t: Thread) => ({
  id: t.id,
  subject: t.subject,
  messages: t.messages.map((m) => ({ from: `${m.from.name} <${m.from.email}>`, to: m.to.map((p) => p.email).join(', '), date: m.date, body: m.body })),
});

class NoKey extends Error {}
async function call<T>(action: string, body: object): Promise<T> {
  const res = await fetch(`${URL()}/api/ai/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, workspaceId: state.workspaceId }) });
  if (res.status === 409) throw new NoKey();
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'AI request failed');
  return res.json() as Promise<T>;
}
/** The real AI when there is one; the demo when no key is set up for this job. */
function run<T>(action: string, body: object, demoRun: () => Promise<T>): Promise<T> {
  if (!useServer()) return demoRun();
  return call<T>(action, body).catch((e) => {
    if (e instanceof NoKey) {
      state.live = false;
      // On a real server there are no made-up answers: say what's missing instead.
      if (server.on && !caps.demo) throw new Error('AI isn’t set up for this company yet. An admin can add it in Settings, AI.');
      return demoRun();
    }
    throw e;
  });
}

const today = () => localDay();

export const ai = {
  summarize: (t: Thread): Promise<Summary> => run('summarize', { thread: plain(t) }, () => demo.summarize(t)),
  replies: (t: Thread, me: string): Promise<string[]> => run('replies', { thread: plain(t), me }, () => demo.replies(t, me)),
  draft: (p: { instruction: string; to?: string; subject?: string; tone?: string; me: string; thread?: Thread }): Promise<string> =>
    run('draft', { ...p, thread: p.thread && plain(p.thread) }, () => demo.draft(p)),
  rewrite: (text: string, style: RewriteStyle): Promise<string> => run('rewrite', { text, style }, () => demo.rewrite(text, style)),
  todos: (t: Thread, me: string): Promise<AITodo[]> => run('todos', { thread: plain(t), me, today: today() }, () => demo.todos(t, me)),
  braindump: (input: demo.DumpInput): Promise<demo.DumpPlan> => run('braindump', { ...input, today: today() }, () => demo.braindump(input)),
  meetingNotes: (title: string, transcript: { speaker: string; text: string; at: number }[], clientNames: string[], members: string[]): Promise<demo.MeetingNotes> =>
    run('meetingnotes', { title, transcript, clientNames, members }, () => demo.meetingNotes(title, transcript, clientNames, members)),
  folderOverview: (client: string, meetings: { title: string; summary: string; decisions: string[]; openQuestions: string[] }[], openTasks: string[], doneTasks: number): Promise<demo.FolderOverview> =>
    run('folderoverview', { client, meetings, openTasks, doneTasks }, () => demo.folderOverview(client, meetings, openTasks, doneTasks)),
  askMeetings: (question: string, sources: demo.MeetSource[]): Promise<string> => run('askmeetings', { question, sources }, () => demo.askMeetings(question, sources)),
  catchUp: (channel: string, messages: demo.CatchUpMessage[], me: string): Promise<string> => run('catchup', { channel, messages, me }, () => demo.catchUp(channel, messages, me)),
  assistant: (question: string, threads: Thread[], me: string): Promise<{ answer: string; threadIds: string[] }> =>
    run('assistant', { question, threads: threads.map(plain), me, today: today() }, () => demo.assistant(question, threads, me)),
};
