// Minimal HTTP wrapper for the AI service: POST /api/ai/<action> with a JSON body.
// Run:  ANTHROPIC_API_KEY=… node --experimental-strip-types server/index.ts
// Then build the UI with VITE_AI_URL pointing here (or serve both from one origin behind Traefik).
import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import * as ai from './ai.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

const routes: Record<string, (b: any) => Promise<unknown>> = {
  summarize: (b) => ai.summarize(b.thread),
  replies: (b) => ai.replies(b.thread, b.me),
  draft: (b) => ai.draft(b),
  rewrite: (b) => ai.rewrite(b.text, b.style),
  todos: (b) => ai.todos(b.thread, b.me, b.today),
  assistant: (b) => ai.assistant(b.question, b.threads, b.me, b.today),
};

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();

  const action = req.url?.match(/^\/api\/ai\/(\w+)$/)?.[1];
  const route = action && routes[action];
  if (req.method !== 'POST' || !route) {
    res.statusCode = 404;
    return res.end();
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    const result = await route(JSON.parse(raw || '{}'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (err) {
    // Retryable upstream problems → 503; everything else → 500. Never leak the key or raw errors.
    const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
    res.statusCode = retryable ? 503 : 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: retryable ? 'AI is busy, try again shortly.' : 'AI request failed.' }));
    console.error(`[ai/${action}]`, err);
  }
}).listen(PORT, () => console.log(`Elkiya Mail AI on :${PORT}`));
