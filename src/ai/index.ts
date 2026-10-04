import type { Thread } from '../types';
import * as demo from './demo';
export type { DumpTask, DumpPerson, DumpClient } from './demo';

// Sprint2go AI client. Talks to the AI service on your server (server/ai.ts → Claude) when VITE_AI_URL is set.
// Without it, a small built-in demo stands in so every feature can be tried offline.

const URL = (import.meta.env.VITE_AI_URL as string | undefined)?.replace(/\/$/, '');
export const AI_LIVE = !!URL;

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

async function call<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`${URL}/api/ai/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'AI request failed');
  return res.json() as Promise<T>;
}

const today = () => new Date().toISOString().slice(0, 10);

export const ai = {
  summarize: (t: Thread): Promise<Summary> => (URL ? call('summarize', { thread: plain(t) }) : demo.summarize(t)),
  replies: (t: Thread, me: string): Promise<string[]> => (URL ? call('replies', { thread: plain(t), me }) : demo.replies(t, me)),
  draft: (p: { instruction: string; to?: string; subject?: string; tone?: string; me: string; thread?: Thread }): Promise<string> =>
    URL ? call('draft', { ...p, thread: p.thread && plain(p.thread) }) : demo.draft(p),
  rewrite: (text: string, style: RewriteStyle): Promise<string> => (URL ? call('rewrite', { text, style }) : demo.rewrite(text, style)),
  todos: (t: Thread, me: string): Promise<AITodo[]> => (URL ? call('todos', { thread: plain(t), me, today: today() }) : demo.todos(t, me)),
  braindump: (text: string, people: demo.DumpPerson[], clients: demo.DumpClient[], meId: string): Promise<demo.DumpTask[]> =>
    URL ? call('braindump', { text, people, clients, meId, today: today() }) : demo.braindump(text, people, clients, meId),
  assistant: (question: string, threads: Thread[], me: string): Promise<{ answer: string; threadIds: string[] }> =>
    URL ? call('assistant', { question, threads: threads.map(plain), me, today: today() }) : demo.assistant(question, threads, me),
};
