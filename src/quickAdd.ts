// Quick Add: reads a task as it's typed ("Send invoice tomorrow 3pm #kopi +dewi p1") and pulls out the due date,
// time, repeat, project, stage, people, priority and reminder. Each piece it understood is a token with its place in
// the text, so the field can highlight it and show it again as a chip; tapping a highlight turns it back into plain
// words (its key goes in `off`). Pure: no React, no browser, the unit tests run it (scripts/unit-tests.mjs).
import type { Repeat } from './types';
import { MON_SHORT, WD_SHORT, addDays, addMonths, clock, dayDate, dueText, isoDay, nextOn, onOrAfter, weekStart } from './taskDates';

export type TokenKind = 'date' | 'repeat' | 'project' | 'stage' | 'person' | 'priority' | 'reminder';

export interface QuickToken {
  kind: TokenKind;
  start: number;
  end: number;
  text: string; // as typed
  key: string; // stays the same while the rest of the text changes; put it in `off` to keep these words as words
  keys: string[]; // a date and its time are one token with two keys: turning it off turns off both
  label: string; // what the chip says ("Tomorrow 15:00", "Kopi Harian", "Dewi", "P1")
}

export interface QuickParsed {
  title: string;
  tokens: QuickToken[];
  due?: string;
  time?: string; // HH:MM, when a time came with the date
  repeat?: Repeat;
  clientId?: string;
  stageId?: string;
  assignees: string[];
  priority?: 'high' | 'normal';
  remindAt?: string; // ISO
}

export interface QuickContext {
  today: string; // YYYY-MM-DD
  now?: Date; // for "!2h" reminders and a time that has already passed today
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  off?: string[]; // token keys turned back into plain text
}

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WD_RE = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)';
const PREFIX = '(?:(?:on|by|due|from)\\s+)?';
const TIME_RE = '(?:at\\s+)?(?:(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)|([01]?\\d|2[0-3])[:.]([0-5]\\d))';

const monthOf = (s: string) => MON_SHORT.findIndex((m) => s.toLowerCase().startsWith(m.toLowerCase()));
const wdOf = (s: string) => WD_SHORT.findIndex((w) => s.toLowerCase().startsWith(w.toLowerCase()));
/** Lowercase letters and digits only: "Kopi Harian" and "kopi-harian" both read "kopiharian". */
export const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

interface Hit {
  kind: TokenKind | 'time';
  start: number;
  end: number;
  text: string;
  value: string; // a day, a repeat, an id, HH:MM, or an ISO time
  label?: string;
}

/** A day from a date phrase, or null. */
function dayFrom(m: RegExpExecArray, kind: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const fix = (y: number, mon: number, d: number) => {
    const dt = new Date(y, mon, d, 12);
    if (dt.getMonth() !== mon) return null; // 31 June
    return isoDay(dt);
  };
  const future = (mon: number, d: number) => {
    const x = fix(year, mon, d);
    if (!x) return null;
    return x < today ? fix(year + 1, mon, d) : x;
  };
  switch (kind) {
    case 'word': {
      const w = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (w === 'today' || w === 'tod' || w === 'tonight') return today;
      if (w === 'tomorrow' || w === 'tmr' || w === 'tmrw') return addDays(today, 1);
      if (w === 'this weekend' || w === 'weekend') return onOrAfter(today, 6);
      return null;
    }
    case 'next': {
      const w = m[1].toLowerCase();
      if (w === 'week') return nextOn(today, 1);
      if (w === 'month') return addMonths(today, 1);
      const wd = wdOf(w);
      return wd < 0 ? null : addDays(weekStart(addDays(weekStart(today), 7)), (wd + 6) % 7); // that day in next week
    }
    case 'in': {
      const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
      const unit = m[2].toLowerCase();
      if (!n || n > 400) return null;
      return unit.startsWith('day') ? addDays(today, n) : unit.startsWith('week') ? addDays(today, n * 7) : addMonths(today, n);
    }
    case 'weekday':
      return onOrAfter(today, wdOf(m[1]));
    case 'dm':
      return future(monthOf(m[2]), Number(m[1]));
    case 'md':
      return future(monthOf(m[1]), Number(m[2]));
    case 'slash': {
      const d = Number(m[1]);
      const mon = Number(m[2]) - 1;
      if (mon < 0 || mon > 11) return null;
      return future(mon, d);
    }
    case 'iso':
      return fix(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return null;
}

const timeFrom = (m: RegExpExecArray, at = 1): string | null => {
  if (m[at + 2] !== undefined) {
    let h = Number(m[at]);
    const min = Number(m[at + 1] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[at + 2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[at + 2].toLowerCase() === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  if (m[at + 3] !== undefined) return `${m[at + 3].padStart(2, '0')}:${m[at + 4]}`;
  return null;
};

/** Every place a pattern matches, with whole words only. */
function scan(text: string, source: string, flags = 'gi') {
  const re = new RegExp(source, flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out.push(m);
  }
  return out;
}
/** The text starts a new word here (start of the text, or after a space or bracket). */
const wordStart = (text: string, i: number) => i === 0 || /[\s([{"'“]/.test(text[i - 1]);

/** The best match for "#kopi", "+dew", "/review": exact first, then the start of the name or of any of its words. */
function pick<T extends { id: string; name: string }>(list: T[], typed: string): T | undefined {
  const q = squash(typed);
  if (!q) return undefined;
  return (
    list.find((x) => squash(x.name) === q || squash(x.id) === q) ??
    list.find((x) => squash(x.name).startsWith(q)) ??
    list.find((x) => x.name.split(/\s+/).some((w) => squash(w).startsWith(q)))
  );
}

export function parseQuickAdd(text: string, ctx: QuickContext): QuickParsed {
  const { today } = ctx;
  const now = ctx.now ?? new Date();
  const off = new Set(ctx.off ?? []);
  const hits: Hit[] = [];
  const add = (kind: Hit['kind'], start: number, end: number, value: string, label?: string) => hits.push({ kind, start, end, text: text.slice(start, end), value, label });

  // Repeats first (they also set the day): "every Monday", "every weekday", "daily".
  for (const m of scan(text, `\\b(?:every\\s+(day|weekday|week|month|${WD_RE.slice(1, -1)})|(daily|weekly|monthly|weekdays))\\b`)) {
    const w = (m[1] ?? m[2]).toLowerCase();
    const rep: Repeat = w === 'day' || w === 'daily' ? 'daily' : w === 'weekday' || w === 'weekdays' ? 'weekdays' : w === 'month' || w === 'monthly' ? 'monthly' : 'weekly';
    const wd = rep === 'weekly' && w !== 'week' && w !== 'weekly' ? wdOf(w) : -1;
    add('repeat', m.index, m.index + m[0].length, `${rep}|${wd >= 0 ? onOrAfter(today, wd) : ''}`, rep === 'daily' ? 'Every day' : rep === 'weekdays' ? 'Every weekday' : rep === 'monthly' ? 'Every month' : wd >= 0 ? `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]}` : 'Every week');
  }
  // Dates.
  const dates: [string, string][] = [
    ['next', `\\b${PREFIX}next\\s+(week|month|${WD_RE.slice(1, -1)})\\b`],
    ['in', `\\b(?:in\\s+)(an?|\\d{1,3})\\s+(days?|weeks?|months?)\\b`],
    ['word', `\\b${PREFIX}(today|tod|tonight|tomorrow|tmrw?|this\\s+weekend|weekend)\\b`],
    ['dm', `\\b${PREFIX}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b`],
    ['md', `\\b${PREFIX}${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`],
    ['iso', `\\b${PREFIX}(\\d{4})-(\\d{2})-(\\d{2})\\b`],
    ['slash', `\\b${PREFIX}(\\d{1,2})/(\\d{1,2})\\b`],
    ['weekday', `\\b${PREFIX}${WD_RE}\\b`],
  ];
  for (const [kind, src] of dates)
    for (const m of scan(text, src)) {
      const day = dayFrom(m, kind, today);
      if (day) add('date', m.index, m.index + m[0].length, day);
    }
  // Times: "3pm", "at 15:00", "9.30am".
  for (const m of scan(text, `\\b${TIME_RE}\\b`)) {
    const t = timeFrom(m);
    if (t) add('time', m.index, m.index + m[0].length, t);
  }
  // Reminders: "!3pm", "!15:00", "!30m", "!2h", "!1d".
  for (const m of scan(text, `!(?:(\\d{1,3})\\s?(m|mins?|minutes?|h|hrs?|hours?|d|days?)\\b|(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)\\b|([01]?\\d|2[0-3])[:.]([0-5]\\d)\\b)`)) {
    if (!wordStart(text, m.index)) continue;
    let iso = '';
    if (m[1]) {
      const n = Number(m[1]);
      const u = m[2].toLowerCase()[0];
      iso = new Date(now.getTime() + n * (u === 'm' ? 60_000 : u === 'h' ? 3_600_000 : 86_400_000)).toISOString();
    } else {
      const t = timeFrom(m, 3);
      if (!t) continue;
      iso = `time:${t}`; // a time of day: settled below, on the due day
    }
    add('reminder', m.index, m.index + m[0].length, iso);
  }
  // Project, stage, people: only when they name something real.
  for (const m of scan(text, '#([\\p{L}\\p{N}][\\p{L}\\p{N}_\\-.]*)', 'gu')) {
    if (!wordStart(text, m.index)) continue;
    const p = pick(ctx.projects, m[1]);
    if (p) add('project', m.index, m.index + m[0].length, p.id, p.name);
  }
  for (const m of scan(text, '/([\\p{L}\\p{N}][\\p{L}\\p{N}_\\-]*)', 'gu')) {
    if (!wordStart(text, m.index)) continue;
    const s = pick(ctx.stages, m[1]);
    if (s) add('stage', m.index, m.index + m[0].length, s.id, s.name);
  }
  for (const m of scan(text, '\\+([\\p{L}\\p{N}][\\p{L}\\p{N}_\\-.]*)', 'gu')) {
    if (!wordStart(text, m.index)) continue;
    const u = pick(ctx.people, m[1]);
    if (u) add('person', m.index, m.index + m[0].length, u.id, u.name.split(' ')[0]);
  }
  for (const m of scan(text, '\\b[pP]([1-4])\\b')) add('priority', m.index, m.index + m[0].length, m[1] === '1' ? 'high' : 'normal', `P${m[1]}`);

  // Keys: the words and which time they appear, so turning one off survives edits elsewhere in the text.
  const seen = new Map<string, number>();
  const keyed = hits
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((h) => {
      const base = `${h.kind === 'time' ? 'date' : h.kind}:${h.text.toLowerCase()}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { ...h, key: `${base}#${n}` };
    });
  // Words turned back into text stay text: nothing inside them is read again ("friday" in "next friday").
  const offHits = keyed.filter((h) => off.has(h.key));
  const live = keyed.filter((h) => !off.has(h.key) && !offHits.some((o) => h.start < o.end && o.start < h.end));

  // Longest wins where two overlap ("next friday" over "friday"; "every monday" over "monday").
  const kept: typeof keyed = [];
  for (const h of [...live].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (kept.some((k) => h.start < k.end && k.start < h.end)) continue;
    kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start);

  // One of each, except people. A time right next to the date joins it ("tomorrow 3pm").
  const out: QuickParsed = { title: '', tokens: [], assignees: [] };
  type Kept = (typeof kept)[number] & { keys?: string[] };
  const used: Kept[] = [];
  const repeat = kept.find((h) => h.kind === 'repeat');
  const date = kept.find((h) => h.kind === 'date');
  const time = kept.find((h) => h.kind === 'time');
  let dateTok: Kept | undefined = date;
  if (date && time) {
    const between = time.start >= date.end ? text.slice(date.end, time.start) : text.slice(time.end, date.start);
    if (/^\s*$/.test(between)) {
      const start = Math.min(date.start, time.start);
      const end = Math.max(date.end, time.end);
      dateTok = { ...date, start, end, text: text.slice(start, end), keys: [date.key, time.key] };
    }
  }
  if (repeat) {
    const [rep, day] = repeat.value.split('|');
    out.repeat = rep as Repeat;
    if (day && !date) out.due = day;
    used.push(repeat);
  }
  if (date) {
    out.due = date.value;
    used.push(dateTok!);
  }
  if (time) {
    out.time = time.value;
    if (!dateTok || dateTok === date) used.push(time); // a time apart from the date (or on its own) is its own token
    if (!out.due) {
      // A time on its own: today, or tomorrow when that time has gone.
      const [h, m] = time.value.split(':').map(Number);
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      out.due = at.getTime() > now.getTime() ? today : addDays(today, 1);
    }
  }
  if (out.repeat && !out.due) out.due = today; // a repeat counts from a first day
  const project = kept.find((h) => h.kind === 'project');
  if (project) (out.clientId = project.value), used.push(project);
  const stage = kept.find((h) => h.kind === 'stage');
  if (stage) (out.stageId = stage.value), used.push(stage);
  for (const p of kept.filter((h) => h.kind === 'person'))
    if (!out.assignees.includes(p.value)) {
      out.assignees.push(p.value);
      used.push(p);
    }
  const prio = kept.find((h) => h.kind === 'priority');
  if (prio) (out.priority = prio.value as 'high' | 'normal'), used.push(prio);
  const rem = kept.find((h) => h.kind === 'reminder');
  if (rem) {
    if (rem.value.startsWith('time:')) {
      const [h, m] = rem.value.slice(5).split(':').map(Number);
      const day = out.due ?? today;
      const at = dayDate(day);
      at.setHours(h, m, 0, 0);
      if (!out.due && at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      out.remindAt = at.toISOString();
    } else out.remindAt = rem.value;
    used.push(rem);
  }
  // A time with the date also reminds the doers then.
  if (!out.remindAt && out.time && out.due) {
    const [h, m] = out.time.split(':').map(Number);
    const at = dayDate(out.due);
    at.setHours(h, m, 0, 0);
    if (at.getTime() > now.getTime()) out.remindAt = at.toISOString();
  }

  const dateLabel = out.due ? `${dueText(out.due, today)}${out.time ? ` ${out.time}` : ''}` : '';
  out.tokens = used
    .sort((a, b) => a.start - b.start)
    .map((h) => ({
      kind: h.kind === 'time' ? 'date' : (h.kind as TokenKind),
      start: h.start,
      end: h.end,
      text: h.text,
      key: h.key,
      keys: h.keys ?? [h.key],
      label: h.kind === 'date' || h.kind === 'time' ? dateLabel : h.kind === 'reminder' ? remindText(out.remindAt!, today) : (h.label ?? h.text),
    }));
  // The title: the words that are left.
  let title = '';
  let at = 0;
  for (const t of out.tokens) {
    title += text.slice(at, t.start) + ' ';
    at = t.end;
  }
  title += text.slice(at);
  out.title = title.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  return out;
}

/** The word being typed at the cursor when it starts with #, + or / (for suggestions under the field). */
export function triggerAt(text: string, cursor: number): { char: '#' | '+' | '/'; query: string; start: number } | null {
  let i = cursor;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  const word = text.slice(i, cursor);
  const c = word[0];
  if ((c === '#' || c === '+' || c === '/') && !/[#+/]/.test(word.slice(1))) return { char: c, query: word.slice(1), start: i };
  return null;
}

/** What a suggestion puts in the text: the name as one word ("#Kopi-Harian"). */
export const asToken = (char: string, name: string) => `${char}${name.trim().replace(/\s+/g, '-')}`;

/** For the "Remind" chip and the task panel: "Tomorrow, 15:00". */
export function remindText(iso: string, today: string) {
  const d = new Date(iso);
  return `${dueText(isoDay(d), today)}, ${clock(d)}`;
}
