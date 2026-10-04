import type { Thread } from '../types';
import { isMine } from '../identity';
import type { AITodo, RewriteStyle, Summary } from './index';

// Offline stand-in for Claude: simple rules, clearly not a real model.
// It exists so the AI features can be tried before the AI service is deployed.

const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms + Math.random() * 400));
const sentences = (text: string) =>
  text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && !/^(hi|hello|dear|thanks|thank you|cheers|best)\b[^.]*,?$/i.test(s));
const first = (name: string) => name.split(' ')[0];
const lastFromThem = (t: Thread) => [...t.messages].reverse().find((m) => !isMine(m.from.email)) ?? t.messages[t.messages.length - 1];
const ASK = /\?|\b(could|can|would) (you|we)\b|\bplease\b|\blet me know\b|\bneed(s)? to\b|\bby (mon|tue|wed|thu|fri|sat|sun|tomorrow|next week|the \d+)/i;
const SIGNOFF = /^(\w+)$/; // a lone name at the end

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dueFrom(text: string): string | null {
  const t = text.toLowerCase();
  const d = new Date();
  if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
  else if (/\bnext week\b/.test(t)) d.setDate(d.getDate() + 7);
  else {
    const i = DAYS.findIndex((day) => t.includes(day) || t.includes(day.slice(0, 3) + ' '));
    if (i < 0) return null;
    d.setDate(d.getDate() + (((i - d.getDay() + 7) % 7) || 7));
  }
  return d.toISOString().slice(0, 10);
}

/** "Could you send the deck by Friday?" → "Send the deck" */
function toTask(s: string) {
  const clean = s.replace(/^(also|and|so|one more thing)[,—\-\s]+/i, '').trim();
  // A question that isn't "could you / can we…" is something to answer, not a task to do
  if (/\?$/.test(clean) && !/^(could|can|would) (you|we)\b|^please\b/i.test(clean)) {
    const q = clean.length > 70 ? clean.slice(0, 67) + '…?' : clean;
    return `Answer: “${q}”`;
  }
  let t = s
    .replace(/^(also|and|so|one more thing)[,—\-\s]+/i, '')
    .replace(/^(hi|hello)\s+\w+,?\s*/i, '')
    .replace(/^(could|can|would) (you|we)( please)?\s+/i, '')
    .replace(/^please\s+/i, '')
    .replace(/^let me know\s+/i, 'Reply about ')
    .replace(/\s+(by|before|on) (mon|tues|wednes|thurs|fri|satur|sun)day.*$/i, '')
    .replace(/\s+(by|before) (tomorrow|next week).*$/i, '')
    .replace(/[?.!]+$/, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 90 ? t.slice(0, 87) + '…' : t;
}

export async function summarize(t: Thread): Promise<Summary> {
  await wait();
  const m = lastFromThem(t);
  const s = sentences(m.body).filter((x) => !SIGNOFF.test(x));
  const asks = s.filter((x) => ASK.test(x)).map(toTask).slice(0, 3);
  // Skip pleasantries ("Amazing, thank you!") — lead with the first sentence that says something
  const meaty = (x: string) => x.length > 28 && !/^(amazing|great|thanks|thank you|hope|awesome|perfect)\b/i.test(x);
  const gist = s.find((x) => meaty(x) && !ASK.test(x)) ?? s.find(meaty) ?? s[0] ?? t.subject;
  const who = isMine(m.from.email) ? 'You' : first(m.from.name);
  return {
    summary: `${who} ${t.messages.length > 1 ? `(latest of ${t.messages.length} messages)` : ''}: ${gist}`.replace(/\s+:/, ':'),
    asks,
  };
}

export async function replies(t: Thread, me: string): Promise<string[]> {
  await wait(500);
  const m = lastFromThem(t);
  const them = first(m.from.name);
  // Prefer a proposed slot like "Thursday 2pm" over any day merely mentioned
  const slot = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\s+(at\s+)?(\d{1,2}(:\d{2})?\s?(am|pm))/i.exec(m.body);
  const when = slot ? `${slot[1][0].toUpperCase()}${slot[1].slice(1).toLowerCase()}day ${slot[3]}` : '';
  return [
    when ? `Hi ${them}, ${when} works for me, I'll send an invite. Thanks!` : `Thanks ${them}, sounds good, I'll take it from here.`,
    `Hi ${them}, thanks for this. Let me check and come back to you by tomorrow.`,
    `Hi ${them}, could we jump on a quick call to go through it? Happy to work around your schedule.\n\n${first(me)}`,
  ];
}

export async function draft(p: { instruction: string; to?: string; subject?: string; tone?: string; me: string }): Promise<string> {
  await wait(900);
  const them = p.to ? first(p.to) : 'there';
  const formal = /formal|professional/i.test(p.tone ?? '');
  const short = /short/i.test(p.tone ?? '');
  // "follow up on the proposal and offer a call" → "I wanted to follow up on the proposal and offer a call."
  let body = p.instruction.trim().replace(/^(tell|ask|say|write|let) (them|him|her)( that)?\s*/i, '');
  if (/^(follow|check|send|share|offer|confirm|remind|ask|thank|update|let|propose|suggest|book|schedule|invite|decline|accept)\b/i.test(body))
    body = `I wanted to ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  body = body.replace(/^\w/, (c) => c.toUpperCase()).replace(/\byou\b(?= next week)/, '').replace(/\s+/g, ' ');
  const point = /[.!?]$/.test(body) ? body : body + '.';
  // No sign-off here: the user's signature is added after the draft.
  if (short) return `Hi ${them},\n\n${point}\n\nThanks!`;
  return formal
    ? `Dear ${them},\n\nI hope you are well. ${point}\n\nPlease let me know if you have any questions. I would be happy to discuss further.\n\nKind regards,`
    : `Hi ${them},\n\nHope your week's going well! ${point}\n\nLet me know what you think, happy to adjust anything.\n\nThanks!`;
}

export async function rewrite(text: string, style: RewriteStyle): Promise<string> {
  await wait(600);
  const paras = text.split(/\n+/).filter((p) => p.trim());
  switch (style) {
    case 'shorter': {
      // Keep the greeting and sign-off lines; trim every other paragraph to its first sentence.
      const isFrame = (p: string) => p.length < 40 && /^(hi|hello|dear|thanks|thank you|kind regards|best|cheers)\b/i.test(p.trim());
      return paras
        .map((p) => (isFrame(p) ? p : sentences(p).slice(0, 1).join(' ') || p))
        .filter((p, i, all) => isFrame(p) || all.filter((x) => !isFrame(x)).indexOf(p) === 0)
        .join('\n\n');
    }
    case 'formal':
      return text
        .replace(/^Hi\b/m, 'Dear')
        .replace(/\b(can't|won't|don't|I'm|it's|we're|you're|I'll|let's)\b/g, (w) =>
          ({ "can't": 'cannot', "won't": 'will not', "don't": 'do not', "I'm": 'I am', "it's": 'it is', "we're": 'we are', "you're": 'you are', "I'll": 'I will', "let's": 'let us' })[w] ?? w,
        )
        .replace(/\bThanks!?/g, 'Kind regards,')
        .replace(/!/g, '.');
    case 'friendly':
      return text.replace(/^(Dear|Hello)\b/m, 'Hi').replace(/^(Hi [^,\n]+,)/m, '$1\n\nHope you’re having a great week!').replace(/Kind regards,/g, 'Thanks so much!');
    case 'fix':
      return text
        .replace(/\bi\b/g, 'I')
        .replace(/\s{2,}/g, ' ')
        .replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase())
        .replace(/\bteh\b/g, 'the')
        .replace(/\brecieve/g, 'receive');
  }
}

export async function todos(t: Thread, _me: string): Promise<AITodo[]> {
  await wait(400);
  const m = lastFromThem(t);
  if (isMine(m.from.email)) return [];
  if (/noreply|no-reply|notifications|billing|news|deals|digest|winner/i.test(m.from.email)) {
    // Bills still deserve a reminder
    const due = /due:?\s*(\d{1,2} \w+ \d{4})/i.exec(m.body)?.[1];
    return due ? [{ title: `Pay: ${t.subject.replace(/ is available$/i, '')}`, due: new Date(due).toISOString().slice(0, 10), priority: 'normal' }] : [];
  }
  return sentences(m.body)
    .filter((s) => ASK.test(s) && !/\bthank/i.test(s))
    .slice(0, 3)
    .map((s) => ({ title: toTask(s), due: dueFrom(s) ?? dueFrom(m.body), priority: /asap|urgent|today|tomorrow/i.test(s) ? ('high' as const) : ('normal' as const) }));
}

export async function assistant(question: string, threads: Thread[], me: string): Promise<{ answer: string; threadIds: string[] }> {
  await wait(1000);
  const q = question.toLowerCase();
  const inbox = threads.filter((t) => t.location === 'inbox');
  const unread = inbox.filter((t) => t.unread);
  const line = (t: Thread) => `• **${t.subject}** from ${first(lastFromThem(t).from.name)}`;

  if (/urgent|today|priorit|important|focus/.test(q)) {
    const human = (t: Thread) => {
      const m = lastFromThem(t);
      return !m.listUnsubscribe && !/no-?reply|notifications|billing|news|deals/i.test(m.from.email);
    };
    const score = (t: Thread) => (t.labels.includes('clients') ? 2 : 0) + (t.unread ? 1 : 0) + (t.starred ? 1 : 0);
    const picks = inbox.filter((t) => human(t) && (t.unread || t.starred)).sort((a, b) => score(b) - score(a)).slice(0, 4);
    return {
      answer: picks.length
        ? `Here’s what needs you first, ${first(me)}:\n${picks.map(line).join('\n')}\n\nStart with the client threads, they’re waiting on a reply from you.`
        : 'Nothing urgent, your inbox is clear. 🎉',
      threadIds: picks.map((t) => t.id),
    };
  }
  if (/unread|summar|catch me up|what did i miss/.test(q)) {
    const picks = unread.slice(0, 5);
    const parts = await Promise.all(picks.map(async (t) => `• **${t.subject}**: ${(await summarize(t)).summary}`));
    return { answer: picks.length ? `You have ${unread.length} unread:\n${parts.join('\n')}` : 'You’re all caught up, no unread mail.', threadIds: picks.map((t) => t.id) };
  }
  // A person's name or a topic: find matching threads
  const words = q.replace(/[^a-z0-9@. ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['what', 'did', 'the', 'ask', 'for', 'about', 'from', 'with', 'any', 'emails', 'email', 'last', 'me', 'have', 'does', 'want', 'wants'].includes(w));
  const hits = threads
    .map((t) => ({ t, score: words.filter((w) => (t.subject + ' ' + t.messages.map((m) => m.from.name + ' ' + m.from.email + ' ' + m.body).join(' ')).toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || lastFromThem(b.t).date.localeCompare(lastFromThem(a.t).date))
    .slice(0, 3)
    .map((x) => x.t);
  if (!hits.length) return { answer: 'I couldn’t find anything about that in your mail. Try a name, a company or a subject.', threadIds: [] };
  const top = await summarize(hits[0]);
  return {
    answer: `Most relevant: **${hits[0].subject}**.\n${top.summary}${top.asks.length ? `\n\nThey’re asking you to:\n${top.asks.map((a) => `• ${a}`).join('\n')}` : ''}${hits.length > 1 ? `\n\nAlso related: ${hits.slice(1).map((t) => `**${t.subject}**`).join(', ')}.` : ''}`,
    threadIds: hits.map((t) => t.id),
  };
}
