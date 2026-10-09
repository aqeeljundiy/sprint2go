// The app's languages: English (the source, and the keys) and Bahasa Indonesia. How to use it: docs/i18n.md.
//
// t('Save') looks the English text up in the active language's dictionary and gives it back translated, or as it is
// when there's no entry yet (so an untranslated string simply shows English). No React and no browser at import time:
// the server and the unit tests import files that call t(), and get English.

export type Lang = 'en' | 'id';
export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;

/** The languages a person can pick, each named in its own language. */
export const LANGS: { id: Lang; name: string; locale: string }[] = [
  { id: 'en', name: 'English', locale: 'en-GB' },
  { id: 'id', name: 'Bahasa Indonesia', locale: 'id-ID' },
];

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'id';

let current: Lang = 'en';
let dict: Dict | null = null; // the active language's entries; null while it's English
const listeners = new Set<() => void>();

/** Fills {name} placeholders. {Name} with a capital fills in vars.name with its first letter capitalised. */
function fill(s: string, vars: Vars): string {
  return s.replace(/\{([A-Za-z_][\w]*)\}/g, (whole, name: string) => {
    if (name in vars) return String(vars[name]);
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    if (lower !== name && lower in vars) {
      const v = String(vars[lower]);
      return v.charAt(0).toUpperCase() + v.slice(1);
    }
    return whole;
  });
}

/**
 * The text in the person's language. The English text is the key; {name} placeholders are filled from vars.
 * Call it while rendering (or in a function called then), never at import time: see docs/i18n.md.
 */
export function t(text: string, vars?: Vars): string {
  const s = (dict && dict[text]) || text;
  return vars ? fill(s, vars) : s;
}

/**
 * The same English words meaning different things ("Open" a file, a task that is "Open"): a context tells them apart.
 * The dictionary key is "context::text"; without that entry the plain text's translation is used.
 */
export function tx(context: string, text: string, vars?: Vars): string {
  const s = (dict && (dict[`${context}::${text}`] || dict[text])) || text;
  return vars ? fill(s, vars) : s;
}

/**
 * A count with its words: tn(3, '{n} task', '{n} tasks'). {n} is the count, written the local way (1.234 in
 * Indonesian). Indonesian has one form: its dictionary has one entry, under the English plural.
 */
export function tn(count: number, one: string, other: string, vars?: Vars): string {
  const all = { n: fmtCount(count), ...vars };
  const own = dict && dict[other];
  return fill(own || (count === 1 ? one : other), all);
}

/**
 * Marks English text to be translated later, where it can't be translated yet (a table built at import time):
 * returns it unchanged. Translate it where it's shown, with t(value). The check script finds the words.
 */
export const mark = (text: string) => text;

/** What to translate later: the English text (with {placeholders}) and its values, which can be phrases themselves. */
export type Msg = { key: string; vars?: MsgVars };
export type MsgVars = { [name: string]: string | number | Msg };

const plain = (vars: MsgVars, say: (m: Msg) => string): Vars => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'object' ? say(v) : v]));
const english = (m: Msg): string => fill(m.key, m.vars ? plain(m.vars, english) : {});
const local = (m: Msg): string => t(m.key, m.vars ? plain(m.vars, local) : undefined);

/**
 * Words saved now and read later, maybe by someone who reads another language (a notice for a colleague): `text` is the
 * English (for push notifications, emails and older app versions), `tr` lets each reader see it in their own language.
 * Spread it into what you save: { ...msg('{name} assigned you {task}', { name, task }), userId, … }.
 * A value can be a phrase() that is translated too: msg('{name} assigned you {task}', { name, task: phrase('“{title}”, due {due}', …) }).
 */
export function msg(key: string, vars?: MsgVars): { text: string; tr: Msg } {
  const tr = vars ? { key, vars } : { key };
  return { text: english(tr), tr };
}

/** A part of a msg() that is translated on its own when it's read (a task described with its project and date). */
export const phrase = (key: string, vars?: MsgVars): Msg => (vars ? { key, vars } : { key });

/** The text of something saved with msg(), in the reader's language; as it was saved when it has no `tr`. */
export const textOf = (x: { text: string; tr?: Msg }) => (x.tr?.key ? local(x.tr) : x.text);

/** The active language. */
export const getLang = () => current;
/** The active language's locale for Intl ('en-GB' or 'id-ID'). */
export const locale = () => (current === 'id' ? 'id-ID' : 'en-GB');

const fmtCount = (n: number) => {
  try {
    return n.toLocaleString(locale());
  } catch {
    return String(n);
  }
};

/** Something to do when the language changes (useLang in React; caches built from words). */
export function onLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

let idBundle: Promise<Dict> | null = null;
/** The Indonesian words, downloaded the first time they're needed: English users never fetch them. */
const loadId = () =>
  (idBundle ??= import('./id/index').then(
    (m) => m.default,
    (e) => {
      idBundle = null; // a failed download is tried again next time
      throw e;
    },
  ));

let asked = 0;
/** Switches the language. The words arrive first, then everything re-renders at once (no half-translated screen). */
export async function setLang(lang: Lang): Promise<void> {
  const n = ++asked;
  if (lang === current && (lang === 'en' || dict)) return;
  let next: Dict | null = null;
  if (lang === 'id') {
    try {
      next = await loadId();
    } catch {
      return; // offline before the words ever arrived: stay as it is
    }
  }
  if (n !== asked) return; // a later switch won
  current = lang;
  dict = next;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

/* ---------- the device's language: before anyone is signed in ---------- */

// The landing page's switch and the sign-in pages write the same key, so a choice made on one carries to the other.
const KEY = 's2g-lang';

/** The language this device last picked (here or on the landing page), else the browser's. */
export function deviceLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked: the browser's language */
  }
  return browserLang();
}

/** The browser's own language: Indonesian when it says so, else English. */
export function browserLang(): Lang {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  const list = nav?.languages?.length ? nav.languages : [nav?.language ?? ''];
  for (const l of list) {
    const code = l.toLowerCase();
    if (code.startsWith('id') || code.startsWith('in')) return 'id';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

/** Remembers a language on this device (the sign-in pages and the landing page open in it next time). */
export function rememberLang(lang: Lang) {
  try {
    if (globalThis.localStorage?.getItem(KEY) !== lang) globalThis.localStorage?.setItem(KEY, lang);
  } catch {
    /* storage blocked: it's remembered for this visit only */
  }
}
