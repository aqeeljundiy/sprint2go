import type { Thread } from '../types';
import { localDay } from '../utils';
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
  return localDay(d);
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
    return due ? [{ title: `Pay: ${t.subject.replace(/ is available$/i, '')}`, due: localDay(new Date(due)), priority: 'normal' }] : [];
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

/* ---------------- Brain dump ---------------- */

export interface DumpPerson {
  id: string;
  name: string;
  nicknames?: string[];
  teamIds?: string[];
}
export interface DumpClient {
  id: string;
  name: string;
}
export interface DumpTeam {
  id: string;
  name: string;
  keywords?: string[];
}
export interface DumpTask {
  title: string;
  clientId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  due: string | null; // YYYY-MM-DD
  priority: 'high' | 'normal';
  unknownName?: string | null; // a name in the "who" position that matches nobody: the UI asks "Who is Andi?"
  contact?: string | null; // a client-side person mentioned ("Dimas at Arunika"), not the assignee
}
export interface DumpBrief {
  title: string;
  context: string;
  clientId: string | null;
  ownerId: string;
  due: string | null;
}
export interface DumpPlan {
  tasks: DumpTask[];
  brief: DumpBrief | null; // suggested when the dump describes one bigger piece of work
}
export interface DumpInput {
  text: string;
  people: DumpPerson[];
  clients: DumpClient[];
  teams: DumpTeam[];
  meId: string;
  aliases?: Record<string, string>; // learned: "andi" -> user id, or "contact"
}

const NOT_NAMES = new Set(
  'I Im The A An Also And Then So Ok Okay Hey Please Can Could Should Someone Somebody Anyone Everyone Let Maybe Just We Our They Q1 Q2 Q3 Q4 Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Next This Today Tomorrow Meta Google TikTok Instagram Facebook YouTube Drive WIB ROAS CEO It For With Make Do Send Get Book Prepare Finish Build Check Review Follow Call Edit Design Cut Write Draft Update Launch'.split(' '),
);

/**
 * "KopiKita wants the concepts by Thursday. Rizky, do the ad structure. Andi send the moodboard."
 * One task per instruction; the client is carried forward; names go through nicknames and learned aliases;
 * an unknown name where a person is expected is flagged (never guessed); teams come from keywords or the person.
 */
export async function braindump(input: DumpInput): Promise<DumpPlan> {
  const { text, people, clients, teams, meId, aliases = {} } = input;
  await wait(1100);
  const lower = (s: string) => s.toLowerCase();
  const namesOf = (p: DumpPerson) => [p.name.split(' ')[0], ...(p.nicknames ?? [])].map(lower);
  const byName = (word: string) => {
    const w = lower(word);
    const alias = aliases[w];
    if (alias && alias !== 'contact') return people.find((p) => p.id === alias) ?? null;
    return people.find((p) => namesOf(p).includes(w) || lower(p.name) === w) ?? null;
  };
  const clientWords = new Set(clients.flatMap((c) => c.name.split(/\s+/).map(lower)));
  const clauses = text
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?;])\s+|\s+(?:and then|also|plus)\s+/i)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ''))
    .filter((s) => s.length > 3);

  const VERBS = 'do|send|take|book|prepare|follow|build|check|edit|design|cut|make|write|draft|update|finish|review|set|setup|get|create|plan|shoot|post|schedule|call|email|reply|share|fix|ship|run|handle|deliver|pull|find|look|brief|order|pay|chase|confirm';
  const WHO = `(,|\\s+(?:to|will|can|could|should|please|needs? to|has to|must|${VERBS})\\b|\\s*$)`;
  const ACTION = new RegExp(`^(?:please\\s+)?(?:${VERBS}|someone|somebody|anyone|i\\b|i'll|let me|remind me|we need|need to)`, 'i');
  const context: string[] = [];
  let briefName: string | null = null;
  let client: string | null = null;
  const out: DumpTask[] = [];
  for (const raw of clauses) {
    const c = lower(raw);
    const hit = clients.find((cl) => c.includes(lower(cl.name)) || c.includes(lower(cl.name.split(' ')[0])));
    if (hit) client = hit.id;

    // Client contacts: "Dimas at Arunika", "Nadia from KopiKita".
    let contact: string | null = null;
    const atClient = raw.match(/\b([A-Z][a-z]+)\s+(?:at|from)\s+([A-Z][\w]+)/);
    if (atClient && clientWords.has(lower(atClient[2]))) contact = atClient[1];

    // Who: a name in the "who" position (start of the sentence, "ask X to", "X will…").
    let assignee: string | null = null;
    let unknownName: string | null = null;
    const candidates = [...raw.matchAll(/\b([A-Z][a-z]{2,})\b/g)].map((m) => m[1]);
    for (const word of candidates) {
      if (word === contact) continue;
      const re = new RegExp(`(^|\\b)${word}${WHO}|\\b(?:ask|tell|get|have|assign(?:ed)? to)\\s+${word}\\b`);
      const p = byName(word);
      // A known person at the start of a sentence is the "who"; an unknown word only counts in a clear "who" position.
      if (p && (re.test(raw) || raw.startsWith(word))) {
        assignee = p.id;
        break;
      }
      if (!re.test(raw) || p) continue;
      if (aliases[lower(word)] === 'contact' || NOT_NAMES.has(word) || clientWords.has(lower(word))) continue;
      unknownName = word;
      break;
    }
    const meRef = /^(i|i'll|i will|i need to|i should|let me|remind me to)\b/i.test(raw.trim());
    if (!assignee && !unknownName && meRef) assignee = meId;
    if (/\b(someone|anyone|somebody)\b/i.test(raw)) assignee = null;

    // Title: strip names, filler and dates, keep the instruction.
    // Sentences that aren't instructions (a goal, background, a campaign name) become the brief's context.
    const clientAsks = clients.some((cl) => new RegExp(`^${cl.name.split(' ')[0]}\\b.*\\b(wants?|needs?|asked for)\\b`, 'i').test(raw.trim()));
    const instruction = assignee || unknownName || ACTION.test(raw.trim()) || clientAsks || (dueFrom(raw) && !/^(goal|target|background|budget is|the goal)\b/i.test(raw.trim()));
    if (!instruction) {
      if (!briefName && raw.split(/\s+/).length <= 6 && hit) briefName = raw.replace(/[.!?;]+$/, '').trim();
      else context.push(raw);
      continue;
    }

    let title = raw
      .replace(/^(?:(?:also|and|so|ok|okay|hey|then)\b[,]?\s*)+/i, '')
      .replace(/\b(someone|somebody|anyone)\s+(should|needs? to|has to|must|can)?\s*/i, '')
      .replace(/^(i|i'll|i will|i need to|i should|let me|remind me to)\s+/i, '');
    const strip = [...people.flatMap((p) => [p.name.split(' ')[0], ...(p.nicknames ?? [])]), ...(unknownName ? [unknownName] : [])];
    for (const fn of strip) {
      title = title
        .replace(new RegExp(`\\b(ask|tell|get|have|assign(?:ed)? to)\\s+${fn}\\s+(to\\s+)?`, 'i'), '')
        .replace(new RegExp(`^${fn},?\\s*(please\\s+|can you\\s+|could you\\s+|will\\s+|to\\s+|should\\s+|needs? to\\s+)?`, 'i'), '')
        .replace(new RegExp(`,?\\s*${fn}\\s+(handle|take|do)\\s+(that|this|it)\\b`, 'i'), '')
        .replace(new RegExp(`\\s+for\\s+${fn}\\b(?!\\s+at)`, 'i'), '');
    }
    title = title
      .replace(/\s+(by|before|on|due)\s+(mon|tues|wednes|thurs|fri|satur|sun)day\b.*$/i, '')
      .replace(/\s+(by|before)\s+(tomorrow|today|tonight|next week|end of (the )?week)\b.*$/i, '')
      .replace(/\s+(next week|tomorrow|today)\b\.?$/i, '')
      .replace(/[.!?;]+$/, '')
      .trim();
    const wants = title.match(/^(.+?)\s+(wants?|needs?|asked for)\s+(.+)$/i);
    if (wants && clients.some((cl) => lower(wants[1]).includes(lower(cl.name.split(' ')[0])))) {
      title = `${/^wants?|asked/i.test(wants[2]) ? 'Deliver' : 'Prepare'} ${wants[3]} ${/^wants?|asked/i.test(wants[2]) ? 'to' : 'for'} ${wants[1]}`;
    }
    if (title.length < 3) continue;
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // Team: keywords first, then the person's own team.
    const tl = ' ' + lower(title) + ' ';
    let teamId = teams.find((t) => t.keywords?.some((k) => tl.includes(k)))?.id ?? null;
    if (!teamId && assignee) teamId = people.find((p) => p.id === assignee)?.teamIds?.[0] ?? null;

    out.push({ title, clientId: client, teamId, assigneeId: assignee, due: dueFrom(raw), priority: /asap|urgent|today|tomorrow|!/.test(c) ? 'high' : 'normal', unknownName, contact });
  }

  // A brief when it's one bigger job: long, or many tasks for one client, or brief-like words.
  const mainClient = out.length ? [...out.map((t) => t.clientId)].sort((a, b) => out.filter((t) => t.clientId === b).length - out.filter((t) => t.clientId === a).length)[0] : null;
  const sameClient = out.filter((t) => t.clientId && t.clientId === mainClient).length;
  const briefy = /\b(brief|campaign|launch|project|goal|background|deliverables?|concepts?)\b/i.test(text);
  const brief: DumpBrief | null =
    out.length >= 2 && (context.length > 0 || !!briefName || (briefy && sameClient === out.length) || (sameClient >= 3 && sameClient === out.length))
      ? {
          title: briefName ?? `${clients.find((c) => c.id === mainClient)?.name ?? 'New'} ${/campaign/i.test(text) ? 'campaign' : /launch/i.test(text) ? 'launch' : 'project'}`,
          context: context.length ? context.join(' ') : text.trim(),
          clientId: mainClient ?? null,
          ownerId: meId,
          due: out.map((t) => t.due).filter(Boolean).sort().pop() ?? null,
        }
      : null;
  return { tasks: out, brief };
}
