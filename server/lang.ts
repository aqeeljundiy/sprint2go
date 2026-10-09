// Which language the server writes in (docs/i18n.md, section 7). The app's own words, in src/i18n, are kept here for
// every language at once; each email, push and error is written in its reader's language with inLang():
//
//   - a person (emails, pushes): their own pick (Settings, Account, synced in their prefs), else the company's default
//     (Settings, General: the company the message is about, else their first; a guest's, the company that invited
//     them), else English;
//   - someone without an account yet (an invite): the company's default, else English;
//   - an answer to a request (errors shown in the app and the console): the language the screen speaks (a cookie the
//     app sets, src/i18n/index.ts), else the signed-in person's, else the browser's (Accept-Language), else English.
//
// Notices are saved with msg() (src/i18n): the English text plus a key and values, so each reader's app shows its own.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { addWords, inLang, isLang, mark, msg, phrase, t, textOf, type Lang, type Msg } from '../src/i18n/index.ts';
import id from '../src/i18n/id/index.ts';
import * as db from './db.ts';

addWords('id', id);

export { inLang, type Lang };

/** Words saved with msg(): the English and what each reader's language needs. */
export type Said = { text: string; tr?: Msg };
/** Fixed English text (from t() or mark() in the code) or a msg(). */
export type Words = string | Said;

/** Words in one language: a msg() through its key, fixed English text through the dictionary. */
export const sayIn = (lang: Lang, words: Words): string => inLang(lang, () => (typeof words === 'string' ? t(words) : textOf(words)));
/** Words used inside another msg(): its phrase when it has one, else its text. */
export const part = (words: Words): string | Msg => (typeof words === 'string' ? words : (words.tr ?? words.text));
/** Several sentences as one msg() ("A. B."), each still translated on its own. */
export function sentences(list: Words[]): Said {
  if (list.length <= 1) return list.length ? saved(list[0]) : { text: '' };
  const [a, ...rest] = list;
  const b = sentences(rest);
  return msg('{a} {b}', { a: part(a), b: part(b) });
}
/** A msg() or plain text as what's saved in a notice: `text` (the English) and `tr` when there is one. */
export const saved = (words: Words): Said => (typeof words === 'string' ? { text: words } : words.tr ? { text: words.text, tr: words.tr } : { text: words.text });

const ownPick = db.db.prepare("SELECT data FROM docs WHERE coll = 'prefs' AND id = ?");
const firstCompany = db.db.prepare("SELECT json_extract(data, '$.language') AS lang FROM docs WHERE coll = 'workspaces' AND EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.members')) WHERE json_extract(value, '$.userId') = ?) ORDER BY rowid LIMIT 1");
const companyById = db.db.prepare("SELECT json_extract(data, '$.language') AS lang FROM docs WHERE coll = 'workspaces' AND id = ?");
const guestCompany = db.db.prepare("SELECT json_extract(data, '$.clientOf.workspaceId') AS ws FROM docs WHERE coll = 'users' AND id = ?");
const userByEmail = db.db.prepare("SELECT id FROM docs WHERE coll = 'users' AND lower(json_extract(data, '$.email')) = lower(?) LIMIT 1");

/** What the person picked in Settings, Account (it follows them between devices), if anything. */
export function ownLang(userId: string | null | undefined): Lang | undefined {
  if (!userId) return undefined;
  const row = ownPick.get(userId) as { data: string } | undefined;
  if (!row) return undefined;
  try {
    const l = JSON.parse(row.data)?.value?.[`pm-settings:${userId}`]?.language;
    return isLang(l) ? l : undefined;
  } catch {
    return undefined;
  }
}

/** A company's default language (Settings, General), if it set one. */
export function companyLang(workspaceId: string | null | undefined): Lang | undefined {
  if (!workspaceId) return undefined;
  const l = (companyById.get(workspaceId) as { lang: unknown } | undefined)?.lang;
  return isLang(l) ? l : undefined;
}

/**
 * The language to write to someone in: theirs, else the company's (`workspaceId`, the one the message is about; else
 * the company that invited a guest; else their first), else English.
 */
export function langOf(userId: string | null | undefined, workspaceId?: string | null): Lang {
  const own = ownLang(userId);
  if (own) return own;
  const about = companyLang(workspaceId);
  if (about) return about;
  if (!userId) return 'en';
  const guestOf = (guestCompany.get(userId) as { ws: string | null } | undefined)?.ws;
  const l = guestOf ? companyLang(guestOf) : (firstCompany.get(userId) as { lang: unknown } | undefined)?.lang;
  return isLang(l) ? l : 'en';
}

/** The language for an email address: its person's when they have an account, else the company's, else English. */
export function langOfEmail(email: string, workspaceId?: string | null): Lang {
  const u = (userByEmail.get(String(email).trim()) as { id: string } | undefined)?.id;
  return u ? langOf(u, workspaceId) : (companyLang(workspaceId) ?? 'en');
}

/** Runs `fn` in someone's language (see langOf). `fn` must not await. */
export const forUser = <T>(userId: string | null | undefined, workspaceId: string | null | undefined, fn: () => T): T => inLang(langOf(userId, workspaceId), fn);

/** The first language the browser asks for that we speak (Accept-Language), if any. */
export function browserLang(header: string | string[] | undefined): Lang | undefined {
  const list = String(Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of list) {
    if (tag.startsWith('id') || tag.startsWith('in')) return 'id';
    if (tag.startsWith('en')) return 'en';
  }
  return undefined;
}

const cookieOf = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

/**
 * The language to answer a request in: what the screen speaks (the s2g-lang cookie), else the signed-in person's, else
 * the browser's, else English.
 */
export function requestLang(req: IncomingMessage): Lang {
  const screen = cookieOf(req, 's2g-lang');
  if (isLang(screen)) return screen;
  const userId = db.sessionUser(cookieOf(req, 's2g'));
  const own = ownLang(userId);
  if (own) return own;
  const browser = browserLang(req.headers['accept-language']);
  if (userId) {
    const l = (firstCompany.get(userId) as { lang: unknown } | undefined)?.lang;
    if (isLang(l)) return l;
  }
  return browser ?? 'en';
}

/* ---------- dates inside saved words ---------- */

// A notice is saved once and read in each reader's language, so a date in it is saved as words that are translated
// when read: "8 October" is phrase('{day} {month}') with the month's English name (its Indonesian is in id/server.ts).
const MONTHS = [mark('January'), mark('February'), mark('March'), mark('April'), mark('May'), mark('June'), mark('July'), mark('August'), mark('September'), mark('October'), mark('November'), mark('December')];
const WEEKDAYS = [mark('Sunday'), mark('Monday'), mark('Tuesday'), mark('Wednesday'), mark('Thursday'), mark('Friday'), mark('Saturday')];

/**
 * A day (and a time) as a phrase() for a msg(): "8 October", "Thursday 8 October", "8 October 2027", "8 October, 14:30"
 * in English, "8 Oktober", "Kamis, 8 Oktober", "8 Oktober, 14.30" in Indonesian. In `tz` (the reader's or the company's).
 */
export function datePhrase(when: Date | string | number, opts: { tz?: string; weekday?: boolean; year?: boolean; time?: boolean } = {}): Msg {
  const d = when instanceof Date ? when : new Date(when);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: opts.tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  const month = phrase(MONTHS[Number(parts.month) - 1]);
  const day = Number(parts.day);
  const weekday = phrase(WEEKDAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)]);
  const date = opts.weekday
    ? opts.year
      ? phrase('{weekday} {day} {month} {year}', { weekday, day, month, year: parts.year })
      : phrase('{weekday} {day} {month}', { weekday, day, month })
    : opts.year
      ? phrase('{day} {month} {year}', { day, month, year: parts.year })
      : phrase('{day} {month}', { day, month });
  return opts.time ? phrase('{date}, {time}', { date, time: phrase('{hour}:{minute}', { hour: parts.hour, minute: parts.minute }) }) : date;
}

/** A month as a phrase(): "October 2026" / "Oktober 2026", for a month written 2026-10. */
export function monthPhrase(ym: string): Msg {
  const [y, m] = ym.split('-').map(Number);
  return phrase('{month} {year}', { month: phrase(MONTHS[(m || 1) - 1]), year: y });
}

/* ---------- answers: errors in the asker's language ---------- */

const asked = new WeakMap<ServerResponse, IncomingMessage>();
/** Remembers which request an answer belongs to (called first thing for every request). */
export const answering = (req: IncomingMessage, res: ServerResponse) => void asked.set(res, req);
/** The language of the request this answer belongs to (English when it isn't known). */
export const answerLang = (res: ServerResponse): Lang => {
  const req = asked.get(res);
  return req ? requestLang(req) : 'en';
};

/** Exactly what msg() makes ({ text, tr }): a notice has more fields, so it's never mistaken for one. */
const isSaid = (v: unknown): v is Said => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.text === 'string' && !!o.tr && typeof (o.tr as Msg).key === 'string' && Object.keys(o).length === 2;
};

/**
 * A JSON answer with its words in the asker's language: `error` (fixed English text, or a msg() when it has names or
 * numbers in it) and any other top-level msg(). Everything else is sent as it is.
 */
export function localize(res: ServerResponse, data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const o = data as Record<string, unknown>;
  const words = Object.entries(o).filter(([k, v]) => (k === 'error' && typeof v === 'string') || isSaid(v));
  if (!words.length) return data;
  const lang = answerLang(res);
  const out = { ...o };
  for (const [k, v] of words) out[k] = sayIn(lang, v as Words);
  return out;
}

/** Every msg() anywhere in an answer, and its `error`, in one language (the console's answers: labels deep in lists). */
export function localizeAll(lang: Lang, data: unknown): unknown {
  return inLang(lang, () => {
    const walk = (v: unknown, key?: string): unknown => {
      if (typeof v === 'string') return key === 'error' ? t(v) : v;
      if (!v || typeof v !== 'object') return v;
      if (isSaid(v)) return textOf(v);
      if (Array.isArray(v)) return v.map((x) => walk(x));
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return v; // a Date, a Buffer: as JSON makes them
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
      return out;
    };
    return walk(data);
  });
}
