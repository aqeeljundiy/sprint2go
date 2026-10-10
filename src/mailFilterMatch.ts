// Mail labels and filters: the shapes, and the matcher that decides whether an email fits a filter's criteria.
// Pure (no React, no browser): the server's engine (server/mailFilters.ts) runs it on every arriving email, the app runs
// it for the demo company's previews, and the tests run it directly. Gmail's filter form is the model: From, To,
// Subject, Has the words, Doesn't have, Size, Has attachment, plus the team's own (mailing list, which address it came
// in through, attachment name or type).

/** A label. A mailbox's labels are everyone's who opens that mailbox (a shared inbox's are its team's); company labels
 * (`accountId: null`) are made by admins and every mailbox in the company has them. Nested by `parentId`. */
export interface MailLabel {
  id: string;
  workspaceId: string;
  accountId: string | null;
  name: string; // its own name, without the parents ("Kopinara" under "Clients")
  parentId: string | null;
  color: string;
  show: 'show' | 'unread' | 'hide'; // in the sidebar and drawer: always, only with unread mail, never
  order?: number;
  createdBy?: string;
  createdAt?: string;
}

export interface FilterCriteria {
  from?: string; // addresses, domains (@acme.com or acme.com), wildcards (*@acme.com) or names; commas or OR between them
  to?: string; // To or Cc, the same way
  subject?: string; // words in the subject
  hasWords?: string; // words in the subject or the email ("quoted phrases", OR, -not)
  notWords?: string; // none of these words
  size?: { op: 'larger' | 'smaller'; mb: number };
  hasAttachment?: boolean;
  attachment?: string; // a file name or type: invoice, pdf, image, spreadsheet, *.xlsx
  list?: string; // from a mailing list: its List-Id or address, or * for any list
  deliveredTo?: string; // which of our addresses it came in through (an alias like sales@)
}

export interface FilterActions {
  labels?: string[]; // label ids
  archive?: boolean; // skip the inbox
  read?: boolean;
  star?: boolean;
  important?: 'yes' | 'no';
  neverSpam?: boolean;
  spam?: boolean;
  trash?: boolean; // delete it
  forward?: string; // a verified address, within the company's forwarding rule
  assign?: string; // a teammate on the shared inbox (user id)
  task?: { assignee?: string; dueDays?: number }; // make a task from it
  reply?: { name: string; text: string }; // answer with a template (once per sender every 4 days)
  snoozeDays?: number; // back in the inbox that many days later, in the morning
}

/** A filter: a person's mailbox's, or (set by admins) a shared inbox's or the whole company's (`accountId: null`). */
export interface MailFilterRule {
  id: string;
  workspaceId: string;
  accountId: string | null;
  name?: string;
  enabled: boolean;
  order: number; // run order inside its group (company first, then the mailbox's)
  criteria: FilterCriteria;
  actions: FilterActions;
  stop?: boolean; // later filters don't run on an email this one matched
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  hits?: number; // the server's: how many emails it has acted on
  lastHitAt?: string;
  problem?: string; // the server's: why it couldn't do part of its job (a label that's gone, forwarding switched off)
}

/** What a filter did to an email: a quiet line in the reader. */
export interface FiledBy {
  filterId: string; // 'block' for a blocked sender
  name: string;
  scope: 'mine' | 'shared' | 'company' | 'block';
  at: string;
  messageId?: string;
}

/** What the matcher looks at in one email. */
export interface MsgFacts {
  from: { name?: string; email: string };
  to: { name?: string; email: string }[]; // To and Cc
  subject: string;
  body: string;
  size: number; // bytes
  attachments: { name: string }[];
  listId?: string; // the List-Id header, or the unsubscribe link's host for older mail
  deliveredTo?: string[]; // the addresses it came in through
}

export const LABEL_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#0ea5e9', '#3b82f6', '#5b5bf6', '#8b5cf6', '#d946ef', '#ec4899', '#78716c', '#64748b'];
export const MAX_LABELS = 500; // per mailbox, and for the company's own
export const MAX_FILTERS = 500;

/* ---------- labels ---------- */

/** "Clients/Kopinara": the label's whole path (its parents' names first). */
export function labelPath(l: MailLabel, all: MailLabel[]): string {
  const byId = new Map(all.map((x) => [x.id, x]));
  const parts = [l.name];
  for (let p = l.parentId ? byId.get(l.parentId) : undefined, i = 0; p && i < 20; p = p.parentId ? byId.get(p.parentId) : undefined, i++) parts.unshift(p.name);
  return parts.join('/');
}
/** The labels a mailbox has: its own and the company's. */
export const labelsFor = (all: MailLabel[], workspaceId: string, accountId: string) => all.filter((l) => l.workspaceId === workspaceId && (l.accountId === null || l.accountId === accountId));
/** A label and everything nested under it. */
export function subtree(id: string, all: MailLabel[]): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const l of all) if (l.parentId === out[i] && !out.includes(l.id)) out.push(l.id);
  return out;
}
/** Labels as a tree, in order: each with its depth (for indenting) and its path. */
export function labelTree(list: MailLabel[], all: MailLabel[] = list): { label: MailLabel; depth: number; path: string }[] {
  const ids = new Set(list.map((l) => l.id));
  const kids = new Map<string | null, MailLabel[]>();
  for (const l of list) {
    const parent = l.parentId && ids.has(l.parentId) ? l.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), l]);
  }
  const sort = (a: MailLabel, b: MailLabel) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const out: { label: MailLabel; depth: number; path: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of [...(kids.get(parent) ?? [])].sort(sort)) {
      out.push({ label: l, depth, path: labelPath(l, all) });
      if (depth < 20) walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
export const cleanLabelName = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

/* ---------- the matcher ---------- */

const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Splits a list of addresses or patterns: commas, semicolons, spaces and OR. */
export const patternsOf = (s: string | undefined) =>
  fold(s)
    .split(/\s+or\s+|[,;\s]+/)
    .map((x) => x.replace(/^[<"'(]+|[>"')]+$/g, '').trim())
    .filter(Boolean);

/** Does this person fit one pattern? An address, a domain (and its subdomains), a wildcard, or part of the name. */
export function personFits(pattern: string, p: { name?: string; email: string }): boolean {
  const email = fold(p.email).trim();
  const name = fold(p.name);
  if (!pattern) return false;
  if (pattern.includes('*')) {
    const rx = new RegExp('^' + pattern.split('*').map(esc).join('.*') + '$');
    return rx.test(email) || (!pattern.includes('@') && rx.test(name));
  }
  if (pattern.startsWith('@')) return email.endsWith(pattern) || email.split('@')[1]?.endsWith('.' + pattern.slice(1)) === true;
  if (pattern.includes('@')) return email === pattern;
  const domain = email.split('@')[1] ?? '';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(pattern) && (domain === pattern || domain.endsWith('.' + pattern))) return true;
  return email.split('@')[0].includes(pattern) || name.split(/\s+/).some((w) => w.startsWith(pattern)) || name.includes(pattern);
}
const anyFits = (patterns: string[], people: { name?: string; email: string }[]) => patterns.some((pt) => people.some((p) => personFits(pt, p)));

type Term = { text: string; neg: boolean };
/** Gmail's words: "a phrase", OR between alternatives, -word for not. Each group must hold (one alternative of it). */
export function parseWords(q: string | undefined): Term[][] {
  const tokens = (fold(q).match(/-?"[^"]*"|\S+/g) ?? []).map((x) => x.trim()).filter(Boolean);
  const groups: Term[][] = [];
  let joinNext = false;
  for (const tok of tokens) {
    if (tok === 'or' || tok === '|') {
      joinNext = groups.length > 0;
      continue;
    }
    const neg = tok.startsWith('-') && tok.length > 1;
    const text = (neg ? tok.slice(1) : tok).replace(/^"|"$/g, '').trim();
    if (!text) continue;
    const term = { text, neg };
    if (joinNext) groups[groups.length - 1].push(term);
    else groups.push([term]);
    joinNext = false;
  }
  return groups;
}
/** A word or phrase at the start of a word (so "invoice" finds "invoices", not "reinvoiced"). */
const has = (hay: string, text: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(text)}`, 'u').test(hay);
export function wordsMatch(q: string | undefined, hay: string): boolean {
  const groups = parseWords(q);
  if (!groups.length) return true;
  const h = fold(hay);
  return groups.every((g) => g.some((term) => has(h, term.text) !== term.neg));
}
/** None of these words (each alone, or a phrase) appears. */
export const noneOf = (q: string | undefined, hay: string) => {
  const h = fold(hay);
  return parseWords(q).every((g) => g.every((term) => term.neg || !has(h, term.text)));
};

const TYPES: Record<string, string[]> = {
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'tif', 'tiff'],
  photo: ['png', 'jpg', 'jpeg', 'heic', 'webp'],
  spreadsheet: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
  document: ['doc', 'docx', 'odt', 'rtf', 'txt', 'pages', 'pdf'],
  presentation: ['ppt', 'pptx', 'key', 'odp'],
  zip: ['zip', 'rar', '7z', 'gz', 'tar'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
};
export function attachmentFits(pattern: string, name: string): boolean {
  const n = fold(name);
  const ext = n.includes('.') ? n.split('.').pop()! : '';
  const pt = pattern.replace(/^\./, '');
  if (TYPES[pt]) return TYPES[pt].includes(ext);
  if (pattern.includes('*')) return new RegExp('^' + pattern.split('*').map(esc).join('.*') + '$').test(n);
  return ext === pt || n.includes(pattern);
}

/** Calendar invites ride along as files but aren't attachments to anyone reading. */
const realFiles = (f: MsgFacts) => f.attachments.filter((a) => !/\.ics$/i.test(a.name));

export function criteriaEmpty(c: FilterCriteria | undefined): boolean {
  if (!c) return true;
  return !(c.from?.trim() || c.to?.trim() || c.subject?.trim() || c.hasWords?.trim() || c.notWords?.trim() || (c.size && c.size.mb > 0) || c.hasAttachment || c.attachment?.trim() || c.list?.trim() || c.deliveredTo?.trim());
}

/** Does this email fit every criterion that's filled in? An empty filter fits nothing. */
export function matches(c: FilterCriteria, f: MsgFacts): boolean {
  if (criteriaEmpty(c)) return false;
  if (c.from?.trim() && !anyFits(patternsOf(c.from), [f.from])) return false;
  if (c.to?.trim() && !anyFits(patternsOf(c.to), f.to)) return false;
  if (c.subject?.trim() && !wordsMatch(c.subject, f.subject)) return false;
  const all = `${f.subject}\n${f.body}`;
  if (c.hasWords?.trim() && !wordsMatch(c.hasWords, all)) return false;
  if (c.notWords?.trim() && !noneOf(c.notWords, all)) return false;
  if (c.size && c.size.mb > 0) {
    const limit = c.size.mb * 1024 * 1024;
    if (c.size.op === 'larger' ? !(f.size > limit) : !(f.size < limit)) return false;
  }
  const files = realFiles(f);
  if (c.hasAttachment && !files.length) return false;
  if (c.attachment?.trim()) {
    const pts = patternsOf(c.attachment);
    if (!files.some((a) => pts.some((pt) => attachmentFits(pt, a.name)))) return false;
  }
  if (c.list?.trim()) {
    const id = fold(f.listId);
    if (!id) return false;
    const pts = patternsOf(c.list);
    if (!pts.some((pt) => pt === '*' || pt === 'any' || id.includes(pt.replace(/^@/, '')))) return false;
  }
  if (c.deliveredTo?.trim()) {
    const pts = patternsOf(c.deliveredTo);
    const via = (f.deliveredTo?.length ? f.deliveredTo : f.to.map((p) => p.email)).map((e) => ({ email: e }));
    if (!anyFits(pts, via)) return false;
  }
  return true;
}

/** Bytes from "1.2 MB", "340 KB" (the sizes stored on attachments). */
export function bytesOf(size: string | number | undefined): number {
  if (typeof size === 'number') return size;
  const m = String(size ?? '').match(/([\d.,]+)\s*(b|kb|mb|gb)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = (m[2] ?? 'b').toLowerCase();
  return Math.round(n * (u === 'gb' ? 1024 ** 3 : u === 'mb' ? 1024 ** 2 : u === 'kb' ? 1024 : 1));
}

type AnyMsg = { from: { name?: string; email: string }; to?: { name?: string; email: string }[]; cc?: { name?: string; email: string }[]; body?: string; html?: string; attachments?: { name: string; size?: string | number }[]; listUnsubscribe?: { url: string }; size?: number; listId?: string; deliveredTo?: string[] };
/** The facts of one stored message (older mail has no List-Id or arrival address: the unsubscribe link and To stand in). */
export function factsOf(subject: string, m: AnyMsg, extra: Partial<MsgFacts> = {}): MsgFacts {
  let host = '';
  try {
    host = m.listUnsubscribe?.url ? new URL(m.listUnsubscribe.url).hostname : '';
  } catch {
    /* not a link */
  }
  const size = m.size ?? (m.body ?? '').length + (m.html ?? '').length + (m.attachments ?? []).reduce((n, a) => n + bytesOf(a.size), 0);
  return {
    from: m.from,
    to: [...(m.to ?? []), ...(m.cc ?? [])],
    subject,
    body: m.body ?? '',
    size,
    attachments: (m.attachments ?? []).map((a) => ({ name: a.name })),
    listId: m.listId ?? host ?? undefined,
    deliveredTo: m.deliveredTo,
    ...extra,
  };
}

/* ---------- a search, as a filter ---------- */

/**
 * The criteria for what was searched: from:, to:, cc:, subject:, has:attachment, filename:, larger:, smaller:, list:,
 * deliveredto: and plain words (the rest, with -word, OR and "phrases", goes to Has the words / Doesn't have).
 */
export function criteriaFromSearch(q: string): FilterCriteria {
  const c: FilterCriteria = {};
  const words: string[] = [];
  const nots: string[] = [];
  const add = (k: 'from' | 'to' | 'subject' | 'attachment' | 'list' | 'deliveredTo', v: string) => (c[k] = c[k] ? `${c[k]}, ${v}` : v);
  for (const tok of q.match(/-?\w+:"[^"]*"|-?"[^"]*"|\S+/g) ?? []) {
    const m = tok.match(/^(-?)(\w+):(.+)$/);
    const val = m?.[3].replace(/^"|"$/g, '') ?? '';
    const op = m?.[2].toLowerCase();
    if (m && !m[1]) {
      if (op === 'from') add('from', val);
      else if (op === 'to' || op === 'cc' || op === 'bcc') add('to', val);
      else if (op === 'subject') add('subject', val);
      else if (op === 'has' && /^attachments?$/i.test(val)) c.hasAttachment = true;
      else if (op === 'filename') add('attachment', val);
      else if (op === 'list') add('list', val);
      else if (op === 'deliveredto') add('deliveredTo', val);
      else if (op === 'larger' || op === 'smaller' || op === 'size') {
        const mb = /k$/i.test(val) ? parseFloat(val) / 1024 : /m$/i.test(val) ? parseFloat(val) : parseFloat(val) / (1024 * 1024);
        if (mb > 0) c.size = { op: op === 'smaller' ? 'smaller' : 'larger', mb: Math.round(mb * 100) / 100 };
      } else words.push(tok);
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) nots.push(tok.slice(1));
    else words.push(tok);
  }
  if (words.length) c.hasWords = words.join(' ');
  if (nots.length) c.notWords = nots.join(' ');
  return c;
}
