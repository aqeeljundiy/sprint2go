import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { lastTracked, summarize } from '../tracking';
import { Archive, Check, Clock, Eye, EyeOff, FileText, Inbox, Mail, MailOpen, Menu, MessageSquare, MoreHorizontal, Paperclip, PenLine, RefreshCw, Search, ShieldAlert, Star, Tag, Trash2, X } from 'lucide-react';
import type { Client, Label, Person, Thread, User } from '../types';
import { threadHasAttachment } from '../mailAttachments';
import { lastMessage, listDate, participants, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { isMine } from '../identity';
import { useCreateAction } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { SwipeRow, type SwipeAction } from './ui/SwipeRow';
import { useLeaving } from './ui/Smooth';
import { useLongPress } from './ui/useLongPress';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { SnoozePicker } from './mail/MailPickers';
import { useMailSwipes, type SwipeKind } from './mail/MailSettings';
import { whenWords } from '../mailRules';
import { TopBar } from '../mobile/TopBar';
import { MailSearchPill, MailSelectBar } from './mail/MailTop';
import { MailSearch } from './mail/MailSearch';
import { mark, t, tn } from '../i18n';
// Search options and chips, the Important marker, Move to, mute (components/mail/Sorting.tsx, sorting.ts).
import { ImportantMark, SearchChips, SearchOptions } from './mail/Sorting';
import { MoveToSheet } from './mail/Shortcuts';
import { markImportant, mute } from './mail/sortPrefs';
import { BellOff, Flag, FolderInput } from 'lucide-react';

/** The chips under the title: one at a time, tap again for everything. */
export type MailFilter = 'all' | 'unread' | 'reply' | 'assigned' | 'files';

/** What can be done to emails from the list (one or several). Each says what happened, with Undo. */
export interface MailActions {
  done: (ids: string[]) => void; // out of the inbox, into Archive
  inbox: (ids: string[]) => void; // back to the inbox
  trash: (ids: string[]) => void;
  spam: (ids: string[]) => void;
  star: (ids: string[], on: boolean) => void;
  read: (ids: string[], unread: boolean) => void;
  snooze: (ids: string[], until: string, ifNoReply: boolean) => void;
}

interface Props {
  /** A line above the list about what doesn't work yet (incoming or outgoing mail), with its fix. */
  notice?: React.ReactNode;
  /** Above the rows: the inbox tabs, multiple inboxes' sections, Spam's 30 days (components/mail/Sorting.tsx). */
  top?: React.ReactNode;
  /** What an empty list says instead (e.g. a temporary address waiting for its first email). */
  empty?: { title: string; sub: string; action?: React.ReactNode };
  title: string;
  threads: Thread[];
  clientOf: (t: Thread) => Client | undefined; // the project this email is with
  labels: Label[];
  personOf: (id: string) => User | undefined;
  meId: string;
  me: Person;
  /** Mail in a mailbox more than one person opens (a shared inbox, or a mailbox given to several): a coloured edge. */
  teamMail: (t: Thread) => boolean;
  /** A shared inbox: someone handles each email ("Unassigned" until then). */
  sharedMail: (t: Thread) => boolean;
  /** Whether "Assigned to me" makes sense here (there's a shared inbox, and this isn't that list already). */
  assignChip: boolean;
  selectedId: string | null;
  query: string;
  filter: MailFilter;
  onQuery: (q: string) => void;
  onFilter: (f: MailFilter) => void;
  onOpen: (id: string) => void;
  actions: MailActions;
  /** Whether an email stays in this list after a change (so a swipe only slides out what really leaves). */
  stays: (t: Thread, patch: Partial<Thread>) => boolean;
  onMenu: () => void;
  showSnippets: boolean;
  width: number;
  onWidth: (w: number) => void;
  /** Checks for new mail now (the button, and pulling the list down on a phone). */
  onRefresh?: () => Promise<void>;
  updatedAt?: number; // when mail last came in fresh
  offline?: boolean; // the live connection dropped: new mail waits for a refresh
  onCompose?: () => void; // Compose is Mail's create button (missing: sending isn't set up)
  onDrafts?: () => void; // long-press Compose: the drafts
  /** Phones: your picture in the search pill opens your account and companies; `elsewhere`: another has new mail. */
  onAccounts?: () => void;
  elsewhere?: boolean;
  /** Phones: what Mail's search looks through (every folder but Spam and Trash), and "All apps" for the suite's search. */
  searchable?: Thread[];
  onAllApps?: () => void;
  /** Labels and filters (src/components/mail/Organize.tsx): "Label as…" and "Filter messages like this" for chosen
   * emails, and "Create filter from this search". */
  moreActions?: (list: Thread[], anchor?: React.RefObject<HTMLElement | null>) => SheetAction[];
  onFilterSearch?: (q: string, extra?: { from?: string; to?: string; files?: boolean }) => void;
}

const PULL_AT = 64; // px: pull this far, let go, and it refreshes

export const LIST_MIN = 300;
export const LIST_MAX = 560;

const CHIPS: { id: Exclude<MailFilter, 'all'>; label: string }[] = [
  { id: 'unread', label: mark('Unread') },
  { id: 'reply', label: mark('Needs reply') },
  { id: 'assigned', label: mark('Assigned to me') },
  { id: 'files', label: mark('Attachments') },
];

export const MessageList = forwardRef<HTMLInputElement, Props>(function MessageList(props, searchRef) {
  const { title, threads, me, selectedId, query, filter, actions } = props;
  const phone = usePhone();
  const listRef = useRef<HTMLUListElement>(null);
  const unread = threads.filter((t) => t.unread).length;
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0); // how far the list is pulled down, in px
  const [dragging, setDragging] = useState(false); // a finger is on it: the list follows without easing
  const [, tick] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  const bodyRef = useRef<HTMLElement | null>(null); // the list, or the empty state: what a pull starts on
  const [swipes] = useMailSwipes();

  // Selecting several: long-press a row or tap its picture. Ends when nothing is selected.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = useMemo(() => new Set(threads.map((t) => t.id)), [threads]);
  const sel = useMemo(() => new Set([...picked].filter((id) => ids.has(id))), [picked, ids]);
  const selecting = sel.size > 0;
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set([...s].filter((x) => ids.has(x)));
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const endSelect = () => setPicked(new Set());
  // Gmail's Compose floats above the bar; it steps away while selecting (it would act on nothing).
  useCreateAction('mail', props.onCompose && { label: t('Compose'), icon: PenLine, run: props.onCompose, extended: true, hidden: phone && selecting, more: props.onDrafts ? [{ label: t('Drafts'), icon: FileText, run: props.onDrafts }] : undefined });
  // Phones: Mail's own search screen (Gmail's), opened from the pill.
  const [searching, setSearching] = useState(false);
  const openSearch = () => {
    flushSync(() => setSearching(true));
    document.querySelector<HTMLInputElement>('.mail-search .gm-input')?.focus(); // in the tap itself, so iPhone opens the keyboard
  };
  const selMore = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet-scrim:not(.is-leaving), .pop:not(.is-leaving)') && endSelect();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [selecting]);

  const [snoozing, setSnoozing] = useState<{ ids: string[]; anchor?: React.RefObject<HTMLElement | null> } | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null); // Move to…
  const [menuFor, setMenuFor] = useState<{ ids: string[]; at?: { x: number; y: number }; anchor?: React.RefObject<HTMLElement | null>; title?: string; menu?: boolean } | null>(null);

  const refresh = async () => {
    if (refreshing || !props.onRefresh) return;
    setRefreshing(true);
    await props.onRefresh().catch(() => {});
    setRefreshing(false);
    setPull(0);
  };
  refreshRef.current = () => void refresh();

  // "Updated 3 min ago" stays true while the screen is open.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Pull to refresh (touch screens): from the top of the list, pull down past the mark and let go.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !props.onRefresh || selecting) return;
    let startY = 0;
    let pulling = false;
    let dist = 0;
    const down = (e: TouchEvent) => {
      if (el.scrollTop > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      pulling = true;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (dist) setPull((dist = 0));
        return;
      }
      e.preventDefault(); // the list follows the finger instead of the page bouncing
      if (!dist) setDragging(true);
      dist = Math.min(96, dy * 0.5);
      setPull(dist);
    };
    const up = () => {
      if (!pulling) return;
      pulling = false;
      setDragging(false);
      if (dist >= PULL_AT) {
        setPull(44);
        refreshRef.current();
      } else setPull(0);
      dist = 0;
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [!!props.onRefresh, threads.length === 0, selecting]); // eslint-disable-line react-hooks/exhaustive-deps
  const updated = props.updatedAt ? relative(new Date(props.updatedAt).toISOString()) : null;

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    listRef.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = props.width;
    document.body.classList.add('resizing', 'resizing-x');
    const move = (ev: PointerEvent) => props.onWidth(Math.min(Math.max(startW + ev.clientX - startX, LIST_MIN), LIST_MAX));
    const up = () => {
      document.body.classList.remove('resizing', 'resizing-x');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  /** The swipe for one side, as this person set it, for this email. */
  const swipe = (kind: SwipeKind, th: Thread): SwipeAction | null => {
    const leaves = (patch: Partial<Thread>) => !props.stays(th, patch);
    switch (kind) {
      case 'done':
        if (th.location === 'inbox') return { id: 'done', label: t('Done'), icon: Check, tone: 'ok', removes: leaves({ location: 'archive' }), run: () => actions.done([th.id]) };
        if (th.location === 'archive' || th.location === 'spam' || th.location === 'trash') return { id: 'inbox', label: t('Inbox'), icon: Inbox, tone: 'accent', removes: leaves({ location: 'inbox' }), run: () => actions.inbox([th.id]) };
        return null;
      case 'snooze':
        return th.location === 'drafts' || th.location === 'trash' || th.location === 'spam' ? null : { id: 'snooze', label: t('Snooze'), icon: Clock, tone: 'warn', run: () => setSnoozing({ ids: [th.id] }) };
      case 'read':
        return { id: 'read', label: th.unread ? t('Read') : t('Unread'), icon: th.unread ? MailOpen : Mail, tone: 'accent', removes: leaves({ unread: !th.unread }), run: () => actions.read([th.id], !th.unread) };
      case 'star':
        return { id: 'star', label: th.starred ? t('Unstar') : t('Star'), icon: Star, tone: 'warn', removes: leaves({ starred: !th.starred }), run: () => actions.star([th.id], !th.starred) };
      case 'trash':
        return th.location === 'trash' ? null : { id: 'trash', label: t('Delete'), icon: Trash2, tone: 'danger', removes: leaves({ location: 'trash' }), run: () => actions.trash([th.id]) };
      default:
        return null;
    }
  };

  /** The actions for one or several emails (the bulk bar's More, right-click on desktop). */
  const actionsFor = (list: Thread[], extra = false): SheetAction[] => {
    const ids = list.map((th) => th.id);
    const anyUnread = list.some((th) => th.unread);
    const allStarred = list.every((th) => th.starred);
    const out: SheetAction[] = [];
    if (extra && list.length === 1) out.push({ label: t('Open'), icon: MailOpen, run: () => props.onOpen(ids[0]) });
    if (list.some((th) => th.location === 'inbox')) out.push({ label: t('Done'), icon: Archive, hint: t('Out of the inbox, into Archive'), run: () => actions.done(ids.filter((id) => list.find((th) => th.id === id)?.location === 'inbox')) });
    if (list.some((th) => th.location !== 'inbox' && th.location !== 'drafts')) out.push({ label: t('Move to Inbox'), icon: Inbox, run: () => actions.inbox(ids) });
    if (extra) out.push({ id: 'snooze', label: t('Snooze…'), icon: Clock, run: () => setSnoozing({ ids }) });
    out.push({ label: anyUnread ? t('Mark as read') : t('Mark as unread'), icon: anyUnread ? MailOpen : Mail, run: () => actions.read(ids, !anyUnread) });
    out.push({ label: allStarred ? t('Unstar') : t('Star'), icon: Star, run: () => actions.star(ids, !allStarred) });
    out.push(...(props.moreActions?.(list, moreBtn) ?? []));
    if (extra) out.push({ label: t('Select'), icon: Check, group: 'select', run: () => setPicked(new Set(ids)) });
    out.push({ label: t('Move to…'), icon: FolderInput, group: 'move', run: () => setMoving(ids) });
    const allImportant = list.every((th) => th.important);
    out.push({ label: allImportant ? t('Mark not important') : t('Mark important'), icon: Flag, group: 'move', run: () => markImportant(ids, !allImportant) });
    const allMuted = list.every((th) => th.muted);
    out.push({ label: allMuted ? t('Unmute') : t('Mute'), icon: BellOff, group: 'move', run: () => mute(ids, !allMuted) });
    if (list.some((th) => th.location !== 'spam')) out.push({ label: t('Report spam'), icon: ShieldAlert, group: 'end', run: () => actions.spam(ids) });
    if (list.some((th) => th.location !== 'trash')) out.push({ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => actions.trash(ids) });
    return out;
  };

  /** The selection bar's ⋮ on phones (Done, Delete and Read are on the bar itself). */
  const selectMore = (list: Thread[]): SheetAction[] => {
    const ids = list.map((th) => th.id);
    const allStarred = list.every((th) => th.starred);
    const out: SheetAction[] = [];
    if (list.some((th) => th.location !== 'drafts' && th.location !== 'trash' && th.location !== 'spam')) out.push({ id: 'snooze', label: t('Snooze…'), icon: Clock, run: () => setSnoozing({ ids }) });
    out.push({ label: allStarred ? t('Unstar') : t('Star'), icon: Star, run: () => actions.star(ids, !allStarred) });
    if (list.some((th) => th.location === 'inbox') && list.some((th) => th.location !== 'inbox' && th.location !== 'drafts')) out.push({ label: t('Move to Inbox'), icon: Inbox, run: () => actions.inbox(ids) });
    out.push({ label: t('Move to…'), icon: FolderInput, run: () => setMoving(ids) });
    const allMuted = list.every((th) => th.muted);
    out.push({ label: allMuted ? t('Unmute') : t('Mute'), icon: BellOff, run: () => mute(ids, !allMuted) });
    out.push(...(props.moreActions?.(list) ?? []));
    if (list.some((th) => th.location !== 'spam')) out.push({ label: t('Report spam'), icon: ShieldAlert, group: 'end', run: () => actions.spam(ids) });
    return out;
  };
  const rows = useLeaving(threads, (t) => t.id);
  const selList = threads.filter((t) => sel.has(t.id));
  const selUnread = selList.some((t) => t.unread);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const labelBtn = useRef<HTMLButtonElement>(null);
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const chips = CHIPS.filter((c) => c.id !== 'assigned' || props.assignChip);
  const lastSnoozed = snoozing ? threads.filter((t) => snoozing.ids.includes(t.id)) : [];

  return (
    <section className={`list-pane${selecting ? ' selecting' : ''}`} style={{ ['--list-w' as string]: `${props.width}px` }}>
      <div className="pane-resize" onPointerDown={startResize} onDoubleClick={() => props.onWidth(400)} title={t('Drag to resize')} />
      {phone && (
        <TopBar
          app="mail"
          replace={
            selecting ? (
              <MailSelectBar
                key="sel"
                ref={selMore}
                count={sel.size}
                inInbox={selList.some((th) => th.location === 'inbox')}
                unread={selUnread}
                onClose={endSelect}
                onDone={() => (selList.some((th) => th.location === 'inbox') ? actions.done(selList.filter((th) => th.location === 'inbox').map((th) => th.id)) : actions.inbox([...sel]), endSelect())}
                onTrash={() => (actions.trash([...sel]), endSelect())}
                onRead={() => (actions.read([...sel], !selUnread), endSelect())}
                onMore={() => setMenuFor({ ids: [...sel], anchor: selMore, title: tn(sel.size, '{n} selected', '{n} selected'), menu: true })}
              />
            ) : (
              <MailSearchPill key="pill" me={me} elsewhere={props.elsewhere} onMenu={props.onMenu} onSearch={openSearch} onAccounts={props.onAccounts} />
            )
          }
        />
      )}
      <header className="list-header">
        <div className="list-title">
          <button className="icon-btn menu-btn" onClick={props.onMenu} aria-label={t('Open menu')}>
            <Menu size={18} />
          </button>
          <h1>{title}</h1>
          {unread > 0 && <span className="pill">{tn(unread, '{n} unread', '{n} unread')}</span>}
          {props.onRefresh && (
            <span className={`list-sync ${props.offline ? 'off' : ''}`}>
              {(updated || props.offline) && (
                <small key={props.offline ? 'off' : 'on'} title={props.offline ? t('New mail isn’t arriving by itself right now. Refresh to reconnect.') : undefined}>
                  {refreshing ? t('Checking for mail…') : props.offline ? (updated ? t('Connection lost. Updated {when}', { when: updated }) : t('Connection lost')) : t('Updated {when}', { when: updated ?? '' })}
                </small>
              )}
              <button type="button" className="icon-btn sm" onClick={() => void refresh()} disabled={refreshing} title={t('Check for new mail')} aria-label={t('Check for new mail')}>
                <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
              </button>
            </span>
          )}
        </div>
        <label className="search">
          <Search size={16} />
          <input ref={searchRef} value={query} onChange={(e) => props.onQuery(e.target.value)} placeholder={t('Search mail')} />
          {query ? (
            <button type="button" className="icon-btn sm so-clear" onClick={(e) => (e.preventDefault(), props.onQuery(''))} aria-label={t('Clear search')} title={t('Clear search')}>
              <X size={15} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
          <SearchOptions query={query} onQuery={props.onQuery} />
        </label>
        {/* One row that switches between the filters and the selection's own header, at the same height. */}
        <div className="mail-tools" key={selecting ? 'sel' : 'chips'}>
          {selecting ? (
            <div className="sel-head">
              <button type="button" className="ghost-btn sm" onClick={endSelect}>
                <X size={15} /> {t('Cancel')}
              </button>
              <span className="sel-count" aria-live="polite">
                {tn(sel.size, '{n} selected', '{n} selected')}
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => setPicked(sel.size === threads.length ? new Set() : new Set(threads.map((th) => th.id)))}>
                {sel.size === threads.length ? t('Select none') : t('Select all')}
              </button>
            </div>
          ) : query.trim() && !phone ? (
            <SearchChips query={query} onQuery={props.onQuery} />
          ) : (
            <div className="mail-chips" role="group" aria-label={t('Show only')}>
              {chips.map((c) => (
                <button key={c.id} type="button" className={`mail-chip${filter === c.id ? ' on' : ''}`} aria-pressed={filter === c.id} onClick={() => props.onFilter(filter === c.id ? 'all' : c.id)}>
                  {t(c.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      {props.notice}
      {props.top}
      {props.offline && <div className="list-offline">{t('Connection lost. Pull down to check for mail.')}</div>}
      {props.onRefresh && (
        <div className={`pull-mark ${pull ? 'on' : ''} ${dragging ? 'dragging' : ''} ${refreshing ? 'busy' : ''} ${pull >= PULL_AT ? 'ready' : ''}`} style={{ ['--pull' as string]: `${pull}px` }} aria-hidden>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        </div>
      )}

      {phone &&
        (selecting ? (
          <div className="gm-label gm-selall">
            <button type="button" className={`gm-selall-btn${sel.size === threads.length ? ' on' : ''}`} onClick={() => setPicked(sel.size === threads.length ? new Set() : new Set(threads.map((th) => th.id)))}>
              <span className="gm-selall-box" aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
              {sel.size === threads.length ? t('Select none') : t('Select all')}
            </button>
          </div>
        ) : (
          <div className="gm-label">{title}</div>
        ))}
      {threads.length === 0 ? (
        <div className={`empty ${pull ? 'pulled' : ''} ${dragging ? 'dragging' : ''}`} ref={(el) => void (bodyRef.current = el)} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
          <div className="empty-art">✓</div>
          <p className="empty-title">{query ? t('No matches') : filter !== 'all' ? t('Nothing like that here') : (props.empty?.title ?? t('All caught up'))}</p>
          <p className="empty-sub">
            {query
              ? t('Nothing found for “{query}”. Try a name, an email address or a few words from the subject.', { query })
              : filter !== 'all'
                ? filter === 'unread'
                  ? t('No emails here are unread right now.')
                  : filter === 'reply'
                    ? t('No emails here are waiting for your reply right now.')
                    : filter === 'assigned'
                      ? t('No emails here are given to you right now.')
                      : t('No emails here have attachments right now.')
                : (props.empty?.sub ?? (phone ? t('Nothing waiting here. New mail lands in your inbox.') : t('Nothing waiting here. New mail lands in your inbox; press C to write one.')))}
          </p>
          {filter !== 'all' && !query ? (
            <button type="button" className="ghost-btn sm outline" onClick={() => props.onFilter('all')}>
              {t('Show everything')}
            </button>
          ) : (
            !query && props.empty?.action
          )}
        </div>
      ) : (
        <ul className={`rows ${pull ? 'pulled' : ''} ${dragging ? 'dragging' : ''}`} ref={(el) => void ((listRef.current = el), (bodyRef.current = el))} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
          {rows.map(({ item: t, leaving }) => {
            const start = swipe(swipes.right, t);
            const end = swipe(swipes.left, t);
            return (
              <li key={t.id} className="row-li">
                <SwipeRow leaving={leaving} disabled={selecting} start={start ? [start] : []} end={end ? [end] : []} className="mail-swipe">
                  <MailRow
                    t={t}
                    me={me}
                    meId={props.meId}
                    client={props.clientOf(t)}
                    labels={props.labels}
                    personOf={props.personOf}
                    team={props.teamMail(t)}
                    shared={props.sharedMail(t)}
                    snippets={props.showSnippets}
                    phone={phone}
                    current={selectedId === t.id}
                    picked={sel.has(t.id)}
                    selecting={selecting}
                    leaving={leaving}
                    onOpen={() => props.onOpen(t.id)}
                    onToggle={() => toggle(t.id)}
                    onHold={() => setPicked((s) => new Set([...s].filter((x) => ids.has(x))).add(t.id))}
                    onMenu={(x, y) => setMenuFor({ ids: [t.id], at: { x, y }, title: t.subject })}
                    onStar={() => actions.star([t.id], !t.starred)}
                    onDone={() => (t.location === 'inbox' ? actions.done([t.id]) : actions.inbox([t.id]))}
                    onTrash={() => actions.trash([t.id])}
                    onSnooze={(anchor) => setSnoozing({ ids: [t.id], anchor })}
                  />
                </SwipeRow>
              </li>
            );
          })}
        </ul>
      )}

      {selecting && !phone && (
        <div className="mail-bulk" role="toolbar" aria-label={tn(sel.size, '{n} selected', '{n} selected')}>
          {selList.some((th) => th.location === 'inbox') ? (
            <button type="button" onClick={() => (actions.done(selList.filter((th) => th.location === 'inbox').map((th) => th.id)), endSelect())}>
              <Check size={20} />
              <span>{t('Done')}</span>
            </button>
          ) : (
            <button type="button" onClick={() => (actions.inbox([...sel]), endSelect())}>
              <Inbox size={20} />
              <span>{t('Inbox')}</span>
            </button>
          )}
          <button type="button" ref={snoozeBtn} onClick={() => setSnoozing({ ids: [...sel], anchor: snoozeBtn })}>
            <Clock size={20} />
            <span>{t('Snooze')}</span>
          </button>
          <button type="button" onClick={() => (actions.read([...sel], !selUnread), endSelect())}>
            {selUnread ? <MailOpen size={20} /> : <Mail size={20} />}
            <span>{selUnread ? t('Read') : t('Unread')}</span>
          </button>
          <button type="button" onClick={() => (actions.trash([...sel]), endSelect())}>
            <Trash2 size={20} />
            <span>{t('Delete')}</span>
          </button>
          {props.moreActions && (
            <button type="button" ref={labelBtn} onClick={() => props.moreActions!(selList, labelBtn).find((x) => x.id === 'label')?.run()}>
              <Tag size={20} />
              <span>{t('Label')}</span>
            </button>
          )}
          <button type="button" ref={moreBtn} onClick={() => setMenuFor({ ids: [...sel], anchor: moreBtn, title: tn(sel.size, '{n} selected', '{n} selected') })}>
            <MoreHorizontal size={20} />
            <span>{t('More')}</span>
          </button>
        </div>
      )}

      <SnoozePicker
        key={snoozing ? snoozing.ids.join() : 'none'}
        open={!!snoozing}
        anchor={snoozing?.anchor}
        count={snoozing?.ids.length}
        waiting={lastSnoozed.length > 0 && lastSnoozed.every((t) => isMine(lastMessage(t).from.email))}
        onClose={() => setSnoozing(null)}
        onPick={(until, ifNoReply) => {
          if (!snoozing) return;
          actions.snooze(snoozing.ids, until, ifNoReply);
          if (snoozing.ids.length > 1 || selecting) endSelect();
        }}
      />
      <ActionSheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        anchor={menuFor?.anchor}
        at={menuFor?.at ?? null}
        menu={menuFor?.menu}
        actions={menuFor ? (menuFor.menu ? selectMore(threads.filter((t) => menuFor.ids.includes(t.id))) : actionsFor(threads.filter((t) => menuFor.ids.includes(t.id)), !!menuFor.at)).map((a) => (menuFor.anchor ? { ...a, run: () => (a.run(), a.id !== 'snooze' && endSelect()) } : a)) : []}
      />
      {moving && <MoveToSheet ids={moving} actions={actions} onClose={() => setMoving(null)} />}
      {phone && searching && (
        <MailSearch
          threads={props.searchable ?? threads}
          onFilterSearch={props.onFilterSearch}
          me={me}
          meId={props.meId}
          clientOf={props.clientOf}
          labels={props.labels}
          personOf={props.personOf}
          sharedMail={props.sharedMail}
          assignChip={props.assignChip}
          showSnippets={props.showSnippets}
          onStar={(id, on) => actions.star([id], on)}
          onOpen={props.onOpen}
          onAllApps={props.onAllApps}
          onClose={() => setSearching(false)}
        />
      )}
    </section>
  );
});

/** Bold the words someone searched for (Gmail's results). */
function Hl({ text, q }: { text: string; q?: string }) {
  const words = (q ?? '').trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return <>{parts.map((x, i) => (i % 2 ? <b key={i} className="hl">{x}</b> : x))}</>;
}

/** One email in the list: picture, who and when, subject, a line of it, then one quiet line of status. */
export function MailRow(p: {
  t: Thread;
  me: Person;
  meId: string;
  client?: Client;
  labels: Label[];
  personOf: (id: string) => User | undefined;
  team: boolean;
  shared: boolean;
  snippets: boolean;
  phone: boolean;
  current: boolean;
  picked: boolean;
  selecting: boolean;
  leaving: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onHold: () => void;
  onMenu: (x: number, y: number) => void;
  onStar: () => void;
  onDone: () => void;
  onTrash: () => void;
  onSnooze: (anchor: React.RefObject<HTMLElement | null>) => void;
  hl?: string; // search words to bold
}) {
  const th = p.t;
  const last = lastMessage(th);
  const hasFiles = threadHasAttachment(th); // not pictures inside the words (src/mailAttachments.ts)
  const tracked = lastTracked(th, p.me);
  const sum = tracked?.tracking && !th.sendAt ? summarize(tracked.tracking) : null; // not sent yet: nothing to see
  const who = th.assignee ? p.personOf(th.assignee) : undefined;
  const comments = th.notes?.length ?? 0;
  const labels = p.labels.filter((l) => th.labels.includes(l.id));
  const snoozed = !!th.snoozedUntil && th.snoozedUntil > new Date().toISOString();
  const pointer = useRef<string>('');
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const hold = useLongPress(() => !p.selecting && p.onHold(), { disabled: p.leaving });
  if (p.phone) {
    // Gmail's three lines: who and when, the subject, a line of it with the star. Unread is semibold, nothing else.
    // Files are a paperclip by the time. A project (or label) is one small chip after the subject.
    const files = th.messages.flatMap((m) => m.attachments ?? []);
    const tag = p.client ?? labels[0];
    return (
      <div
        className={`row gm-row lp${th.unread ? ' unread' : ''}${p.current ? ' selected' : ''}${p.picked ? ' picked' : ''}`}
        {...hold}
        onClick={() => (p.selecting ? p.onToggle() : p.onOpen())}
        role="button"
        tabIndex={-1}
        aria-label={th.unread ? t('Unread, {who}: {subject}', { who: participants(th, p.me), subject: th.subject }) : `${participants(th, p.me)}: ${th.subject}`}
      >
        <button type="button" className={`row-av${p.picked ? ' on' : ''}`} onClick={(e) => (e.stopPropagation(), p.onToggle())} aria-pressed={p.picked} aria-label={p.picked ? t('Unselect') : t('Select')}>
          <Avatar person={isMine(last.from.email) ? th.messages[0].from : last.from} size={40} />
          <span className="row-check" aria-hidden="true">
            <Check size={20} strokeWidth={3} />
          </span>
        </button>
        <div className="row-main">
          <div className="row-top">
            <span className="row-from">
              <span className="row-names">
                <Hl text={participants(th, p.me)} q={p.hl} />
              </span>
              {th.messages.length > 1 && <span className="row-count">{th.messages.length}</span>}
            </span>
            {p.shared && who && (
              <span className="row-assignee" title={who.id === p.meId ? t('You handle this one') : t('{name} handles this one', { name: who.name.split(' ')[0] })}>
                <Avatar person={who} size={18} />
              </span>
            )}
            {files.length > 0 && <Paperclip size={16} className="row-clip" aria-hidden="true" />}
            <span className={`row-date${snoozed ? ' snoozed' : ''}`}>{snoozed ? whenWords(new Date(th.snoozedUntil!)) : th.sendAt ? whenWords(new Date(th.sendAt)) : listDate(last.date)}</span>
          </div>
          <div className="row-subject">
            {th.location === 'drafts' && !th.sendAt && <span className="rm-draft">{t('Draft')} </span>}
            {th.sendAt && <span className="rm-sched">{t('Scheduled')} </span>}
            <ImportantMark on={th.important} />
            <span className="row-subj-text">
              <Hl text={th.subject} q={p.hl} />
            </span>
            {tag && (
              <span className="gm-tag" style={{ ['--c' as string]: tag.color }}>
                {tag.name}
              </span>
            )}
          </div>
          <div className="row-line3">
            <span className="row-snippet">{p.snippets ? <Hl text={snippet(last.body) || ' '} q={p.hl} /> : ' '}</span>
            <button
              type="button"
              className={`row-star${th.starred ? ' on' : ''}`}
              onClick={(e) => (e.stopPropagation(), p.onStar())}
              onPointerDown={(e) => e.stopPropagation()}
              aria-pressed={th.starred}
              aria-label={th.starred ? t('Unstar') : t('Star')}
              tabIndex={p.selecting ? -1 : 0}
            >
              <Star size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }
  const status =
    (p.shared && (who || th.location === 'inbox')) || comments > 0 || snoozed || !!th.sendAt || hasFiles || !!p.client || labels.length > 0 || !!sum || th.location === 'drafts' || (p.phone && th.starred);
  return (
    <div
      className={`row lp${th.unread ? ' unread' : ''}${p.current ? ' selected' : ''}${p.picked ? ' picked' : ''}${p.team ? ' team-mail' : ''}`}
      {...hold}
      onPointerDown={(e) => ((pointer.current = e.pointerType), hold.onPointerDown(e))}
      onClick={() => (p.selecting ? p.onToggle() : p.onOpen())}
      onContextMenu={(e) => {
        hold.onContextMenu(e);
        if (e.defaultPrevented || pointer.current !== 'mouse') return;
        e.preventDefault();
        p.onMenu(e.clientX, e.clientY);
      }}
      role="button"
      tabIndex={-1}
      aria-label={th.unread ? t('Unread, {who}: {subject}', { who: participants(th, p.me), subject: th.subject }) : `${participants(th, p.me)}: ${th.subject}`}
    >
      <button
        type="button"
        className={`row-av${p.picked ? ' on' : ''}`}
        onClick={(e) => (e.stopPropagation(), p.onToggle())}
        aria-pressed={p.picked}
        aria-label={p.picked ? t('Unselect') : t('Select')}
        title={p.picked ? t('Unselect') : t('Select')}
      >
        <Avatar person={isMine(last.from.email) ? th.messages[0].from : last.from} />
        <span className="row-check" aria-hidden="true">
          <Check size={18} strokeWidth={3} />
        </span>
      </button>
      <div className="row-main">
        <div className="row-top">
          <span className="row-from">
            {th.unread && <i className="row-dot" aria-hidden="true" />}
            <span className="row-names">{participants(th, p.me)}</span>
            {th.messages.length > 1 && <span className="row-count">{th.messages.length}</span>}
          </span>
          <span className="row-date">{listDate(last.date)}</span>
        </div>
        <div className="row-subject">
          <ImportantMark on={th.important} />
          {th.subject}
        </div>
        {p.snippets && <div className="row-snippet">{snippet(last.body) || ' '}</div>}
        {status && (
          <div className="row-meta">
            {p.phone && th.starred && (
              <span className="rm-item rm-star" aria-label={t('Starred')}>
                <Star size={13} />
              </span>
            )}
            {th.location === 'drafts' && !th.sendAt && <span className="rm-draft">{t('Draft')}</span>}
            {th.sendAt && (
              <span className="rm-item rm-when">
                <Clock size={13} /> {t('Sends {when}', { when: whenWords(new Date(th.sendAt)) })}
              </span>
            )}
            {snoozed && (
              <span className="rm-item rm-when" title={th.snoozeIfNoReply ? t('Comes back only if nobody writes before then') : undefined}>
                <Clock size={13} /> {th.snoozeIfNoReply ? t('{when}, if no reply', { when: whenWords(new Date(th.snoozedUntil!)) }) : whenWords(new Date(th.snoozedUntil!))}
              </span>
            )}
            {p.shared && who && (
              <span className="rm-item rm-who">
                <Avatar person={who} size={16} />
                {who.id === p.meId ? t('You') : who.name.split(' ')[0]}
              </span>
            )}
            {p.shared && !who && th.location === 'inbox' && <span className="rm-item rm-open">{t('Unassigned')}</span>}
            {comments > 0 && (
              <span className="rm-item" title={tn(comments, '{n} comment from the team', '{n} comments from the team')}>
                <MessageSquare size={13} /> {comments}
              </span>
            )}
            {hasFiles && (
              <span className="rm-item" title={t('Has attachments')}>
                <Paperclip size={13} />
              </span>
            )}
            {p.client && (
              <span className="chip client-chip" style={{ ['--c' as string]: p.client.color }}>
                {p.client.name}
              </span>
            )}
            {labels.map((l) => (
              <span key={l.id} className="chip client-chip" style={{ ['--c' as string]: l.color }}>
                {l.name}
              </span>
            ))}
            {sum && (
              <span
                className={`seen-chip ${sum.opens || sum.clicks ? 'yes' : sum.autoOnly ? 'auto' : ''}`}
                title={
                  sum.opens
                    ? [t('Opened by {opened} of {total} · last {when}', { opened: sum.openedBy, total: sum.recipients, when: relative(sum.lastOpen!) }), sum.clicks ? tn(sum.clicks, '{n} link click', '{n} link clicks') : ''].filter(Boolean).join(' · ')
                    : sum.clicks
                      ? t('A link in it was clicked; their mail app doesn’t load pictures, so opens don’t show')
                      : sum.autoOnly
                        ? t('Apple Mail or a mail filter loaded it by itself, so it may not have been read yet')
                        : t('Not opened yet')
                }
              >
                {sum.opens || sum.clicks ? <Eye size={12} /> : <EyeOff size={12} />}
                {sum.opens ? t('Seen {n}×', { n: sum.opens }) : sum.clicks ? t('Clicked') : sum.autoOnly ? t('Opened (maybe automatic)') : t('Not opened')}
              </span>
            )}
          </div>
        )}
      </div>
      {!p.selecting && (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          {th.location !== 'drafts' && th.location !== 'trash' && th.location !== 'spam' && (
            <button ref={snoozeBtn} className="icon-btn sm" onClick={() => p.onSnooze(snoozeBtn)} title={t('Snooze')}>
              <Clock size={15} />
            </button>
          )}
          {th.location !== 'drafts' && (
            <button className="icon-btn sm" onClick={p.onDone} title={th.location === 'inbox' ? t('Done (E)') : t('Move to Inbox')}>
              {th.location === 'inbox' ? <Archive size={15} /> : <Inbox size={15} />}
            </button>
          )}
          {th.location !== 'trash' && (
            <button className="icon-btn sm" onClick={p.onTrash} title={t('Delete (#)')}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
      <button
        className={`star ${th.starred ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onStar();
        }}
        aria-label={th.starred ? t('Unstar') : t('Star')}
        tabIndex={p.selecting ? -1 : 0}
      >
        <Star size={15} />
      </button>
    </div>
  );
}
