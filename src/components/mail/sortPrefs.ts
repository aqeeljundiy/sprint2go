// Mail's sorting on this side: the person's inbox settings (tabs, inbox type, auto-advance, conversation view,
// sections, saved searches), the list helpers App uses, and changes to emails made from anywhere (with Undo).
// The server does the sorting itself (server/mailSmart.ts); src/mailQuery.ts reads searches the same way here.
import { usePersisted } from '../../settings';
import { setStored, store } from '../../store';
import { toastUndo } from '../../toast';
import type { Thread } from '../../types';
import { CATEGORIES, type Category } from '../../mailQuery';
import { mark, t } from '../../i18n';

export type InboxType = 'default' | 'important' | 'unread' | 'starred';
export type Advance = 'auto' | 'newer' | 'older' | 'list';
export interface SavedSearch {
  id: string;
  name: string;
  q: string;
}
export interface MailPrefs {
  /** Which tabs are on (Primary always is). Off: that mail stays in Primary. */
  tabs: Partial<Record<Exclude<Category, 'primary'>, boolean>>;
  inboxType: InboxType;
  advance: Advance;
  /** Conversation view: replies are kept together. Off: each email is its own row. */
  conversation: boolean;
  /** Multiple inboxes: extra sections above the inbox (desktop), each a search. */
  sections: SavedSearch[];
  saved: SavedSearch[];
}
export const DEFAULT_PREFS: MailPrefs = { tabs: { promotions: true, social: true, updates: true, forums: false }, inboxType: 'default', advance: 'auto', conversation: true, sections: [], saved: [] };

/** Follows the person between devices (src/settings.ts SYNCED). */
export function useMailPrefs() {
  const [raw, set] = usePersisted<MailPrefs>('s2g-mail-prefs', DEFAULT_PREFS);
  const prefs: MailPrefs = { ...DEFAULT_PREFS, ...raw, tabs: { ...DEFAULT_PREFS.tabs, ...raw?.tabs } };
  const update = (patch: Partial<MailPrefs> | ((p: MailPrefs) => Partial<MailPrefs>)) => set((p) => {
    const cur = { ...DEFAULT_PREFS, ...p, tabs: { ...DEFAULT_PREFS.tabs, ...p?.tabs } };
    return { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
  });
  return [prefs, update] as const;
}

export const categoryName = (c: Category) => ({ primary: t('Primary'), promotions: t('Promotions'), social: t('Social'), updates: t('Updates'), forums: t('Forums') })[c];
export const CATEGORY_HINT: Record<Category, string> = {
  primary: mark('People you know and anything not in another tab'),
  promotions: mark('Deals, offers and newsletters'),
  social: mark('Social networks and sites you share on'),
  updates: mark('Receipts, bills, confirmations and notices'),
  forums: mark('Groups, discussion lists and mailing lists'),
};

/** The tabs that are on, Primary first. */
export const tabsOn = (p: MailPrefs): Category[] => CATEGORIES.filter((c) => c === 'primary' || p.tabs[c as Exclude<Category, 'primary'>]);
/** The tab an email shows in: its own, or Primary when that tab is off. */
export const tabOf = (th: Pick<Thread, 'category'>, on: Category[]): Category => (th.category && on.includes(th.category) ? th.category : 'primary');

/** The inbox in the order the inbox type asks for (newest first within each part). */
export function sortInbox(list: Thread[], type: InboxType): Thread[] {
  if (type === 'default') return list;
  const first = (th: Thread) => (type === 'important' ? !!th.important : type === 'unread' ? th.unread : th.starred);
  return [...list.filter(first), ...list.filter((th) => !first(th))];
}

/** Rows with conversation view off: each email is a row of its own (`threadId~messageId`). */
export const ROW_SEP = '~';
export function splitRows(list: Thread[]): Thread[] {
  return list.flatMap((th) =>
    th.location === 'drafts' || th.messages.length < 2
      ? [th]
      : [...th.messages].reverse().map((m) => ({ ...th, id: `${th.id}${ROW_SEP}${m.id}`, messages: [m] })),
  );
}
/** A row's conversation (and the one email of it, with conversation view off). */
export const rowOf = (id: string) => {
  const [thread, message] = id.split(ROW_SEP);
  return { thread, message: message as string | undefined };
};
export const baseIds = (ids: string[]) => [...new Set(ids.map((id) => rowOf(id).thread))];

/** Where the reader goes after its email leaves the list: the newer one, the older one, or back to the list. */
export const advanceTo = (a: Advance, phone: boolean): 'newer' | 'older' | 'list' => (a === 'auto' ? (phone ? 'list' : 'older') : a);

/* ---------- changes to emails, from anywhere, with Undo ---------- */

/** Changes emails in the store (saved and sent to everyone like any change) and offers Undo. */
export function changeThreads(ids: string[], patch: (th: Thread) => Partial<Thread>, text: string | null) {
  const set = new Set(baseIds(ids));
  const list = store.threads.filter((th) => set.has(th.id));
  if (!list.length) return;
  const old = new Map(list.map((th) => [th.id, Object.fromEntries(Object.keys(patch(th)).map((k) => [k, th[k as keyof Thread]])) as Partial<Thread>]));
  setStored('threads', store.threads.map((th) => (set.has(th.id) ? { ...th, ...patch(th) } : th)));
  if (text) toastUndo(text, () => setStored('threads', store.threads.map((th) => (old.has(th.id) ? { ...th, ...old.get(th.id) } : th))));
}

export function mute(ids: string[], on: boolean) {
  const n = baseIds(ids).length;
  changeThreads(ids, (th) => (on ? { muted: true, location: th.location === 'inbox' ? 'archive' : th.location } : { muted: undefined }), on ? (n > 1 ? t('{n} conversations muted', { n }) : t('Muted. New replies skip your inbox.')) : n > 1 ? t('{n} conversations unmuted', { n }) : t('Unmuted'));
}
export function markImportant(ids: string[], on: boolean) {
  const n = baseIds(ids).length;
  changeThreads(ids, () => ({ important: on || undefined }), on ? (n > 1 ? t('{n} emails marked important', { n }) : t('Marked important')) : n > 1 ? t('{n} emails marked not important', { n }) : t('Marked not important. Mail like this will be too.'));
}
export function moveToTab(ids: string[], c: Category) {
  const n = baseIds(ids).length;
  changeThreads(ids, () => ({ category: c }), n > 1 ? t('{n} emails moved to {tab}', { n, tab: categoryName(c) }) : t('Moved to {tab}. Mail from this sender goes there from now on.', { tab: categoryName(c) }));
}
export function reportPhishing(ids: string[]) {
  const n = baseIds(ids).length;
  changeThreads(ids, () => ({ location: 'spam', spamWhy: ['phishing'] }), n > 1 ? t('{n} emails reported as phishing', { n }) : t('Reported as phishing. Your company’s filter will catch mail like it.'));
}
/** Deletes emails for good (Spam and Trash only). */
export function deleteForever(ids: string[]) {
  const set = new Set(baseIds(ids));
  setStored('threads', store.threads.filter((th) => !(set.has(th.id) && (th.location === 'trash' || th.location === 'spam'))));
}

/** "Make a rule from this search": handed to Mail's rules when they're there; false when nothing took it. */
export function ruleFromSearch(query: string): boolean {
  const detail = { query, handled: false };
  window.dispatchEvent(new CustomEvent('s2g:mail-rule-from-search', { detail }));
  return detail.handled;
}

export const newId = () => Math.random().toString(36).slice(2, 10);
