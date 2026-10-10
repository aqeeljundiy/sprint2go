// Smart compose (Gmail's): the next few words, greyed after the caret, taken with Tab or a tap.
// With the company's AI on, the AI suggests them (through /api/ai/complete, so the company's AI limits, budgets and
// Unlimited's per-person rules apply there). Without it, a small list of everyday phrases does (greetings, thanks,
// sign-offs) in English and Indonesian. Settings, Mail can switch it off.
import { server } from '../../sync';
import { isSandboxId } from '../../sandbox';

import { localSuggestion } from './phrases';
export { localSuggestion };

const cache = new Map<string, string>();
let inFlight: AbortController | null = null;
let restUntil = 0; // after a refusal (no AI, limits), local phrases only for a while

/**
 * The words to suggest after `before`: the AI's when it's on (and the server allows it), else the local phrases.
 * `ctx` helps the AI: who it's to, the subject, who writes.
 */
export async function suggestNext(before: string, ctx: { aiOn: boolean; workspaceId: string; subject?: string; to?: string; me?: string; lang?: string }): Promise<string | null> {
  const local = localSuggestion(before);
  // The demo company and a browser without the server only get the local phrases.
  if (!ctx.aiOn || !server.on || isSandboxId(ctx.workspaceId) || Date.now() < restUntil) return local;
  // A finished phrase from the list is quicker and free.
  if (local) return local;
  const tail = before.slice(-600);
  if (tail.trim().length < 12 || /\s{2,}$/.test(tail)) return null;
  const key = `${ctx.workspaceId}\n${tail}`;
  if (cache.has(key)) return cache.get(key) || null;
  inFlight?.abort();
  const ac = new AbortController();
  inFlight = ac;
  try {
    const r = await fetch('/api/ai/complete', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ctx.workspaceId, text: tail, subject: ctx.subject, to: ctx.to, me: ctx.me, lang: ctx.lang }) });
    if (!r.ok) {
      // No AI here right now (none set up, a limit reached, switched off for this person): stop asking for a while.
      restUntil = Date.now() + (r.status === 429 ? 60_000 : 10 * 60_000);
      return null;
    }
    const { completion } = (await r.json()) as { completion?: string };
    const words = String(completion ?? '');
    // The AI answers for the text as it was; the writer may have typed the start of it since.
    cache.set(key, words);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return words.trim() ? words : null;
  } catch {
    return null;
  } finally {
    if (inFlight === ac) inFlight = null;
  }
}
