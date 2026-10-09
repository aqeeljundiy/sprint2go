import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { lastTracked, summarize } from '../tracking';
import { Archive, Check, Clock, Eye, EyeOff, FileText, Inbox, Mail, MailOpen, Menu, MessageSquare, MoreHorizontal, Paperclip, PenLine, RefreshCw, Search, ShieldAlert, Star, Trash2, X } from 'lucide-react';
import type { Client, Label, Person, Thread, User } from '../types';
import { lastMessage, listDate, participants, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { isMine } from '../identity';
import { useCreateAction, useFocusedScreen } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { SwipeRow, type SwipeAction } from './ui/SwipeRow';
import { useLeaving } from './ui/Smooth';
import { useLongPress } from './ui/useLongPress';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { SnoozePicker } from './mail/MailPickers';
import { useMailSwipes, type SwipeKind } from './mail/MailSettings';
import { whenWords } from '../mailRules';

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
}

const PULL_AT = 64; // px: pull this far, let go, and it refreshes

export const LIST_MIN = 300;
export const LIST_MAX = 560;

const CHIPS: { id: Exclude<MailFilter, 'all'>; label: string }[] = [
  { id: 'unread', label: 'Unread' },
  { id: 'reply', label: 'Needs reply' },
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'files', label: 'Attachments' },
];

export const MessageList = forwardRef<HTMLInputElement, Props>(function MessageList(props, searchRef) {
  const { title, threads, me, selectedId, query, filter, actions } = props;
  const phone = usePhone();
  useCreateAction('mail', props.onCompose && { label: 'Compose', icon: PenLine, run: props.onCompose, more: props.onDrafts ? [{ label: 'Drafts', icon: FileText, run: props.onDrafts }] : undefined });
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
  useFocusedScreen(phone && selecting); // the bulk bar takes the tab bar's place
  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet-scrim:not(.is-leaving), .pop:not(.is-leaving)') && endSelect();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [selecting]);

  const [snoozing, setSnoozing] = useState<{ ids: string[]; anchor?: React.RefObject<HTMLElement | null> } | null>(null);
  const [menuFor, setMenuFor] = useState<{ ids: string[]; at?: { x: number; y: number }; anchor?: React.RefObject<HTMLElement | null>; title?: string } | null>(null);

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
  const swipe = (kind: SwipeKind, t: Thread): SwipeAction | null => {
    const leaves = (patch: Partial<Thread>) => !props.stays(t, patch);
    switch (kind) {
      case 'done':
        if (t.location === 'inbox') return { id: 'done', label: 'Done', icon: Check, tone: 'ok', removes: leaves({ location: 'archive' }), run: () => actions.done([t.id]) };
        if (t.location === 'archive' || t.location === 'spam' || t.location === 'trash') return { id: 'inbox', label: 'Inbox', icon: Inbox, tone: 'accent', removes: leaves({ location: 'inbox' }), run: () => actions.inbox([t.id]) };
        return null;
      case 'snooze':
        return t.location === 'drafts' || t.location === 'trash' || t.location === 'spam' ? null : { id: 'snooze', label: 'Snooze', icon: Clock, tone: 'warn', run: () => setSnoozing({ ids: [t.id] }) };
      case 'read':
        return { id: 'read', label: t.unread ? 'Read' : 'Unread', icon: t.unread ? MailOpen : Mail, tone: 'accent', removes: leaves({ unread: !t.unread }), run: () => actions.read([t.id], !t.unread) };
      case 'star':
        return { id: 'star', label: t.starred ? 'Unstar' : 'Star', icon: Star, tone: 'warn', removes: leaves({ starred: !t.starred }), run: () => actions.star([t.id], !t.starred) };
      case 'trash':
        return t.location === 'trash' ? null : { id: 'trash', label: 'Delete', icon: Trash2, tone: 'danger', removes: leaves({ location: 'trash' }), run: () => actions.trash([t.id]) };
      default:
        return null;
    }
  };

  /** The actions for one or several emails (the bulk bar's More, right-click on desktop). */
  const actionsFor = (list: Thread[], extra = false): SheetAction[] => {
    const ids = list.map((t) => t.id);
    const anyUnread = list.some((t) => t.unread);
    const allStarred = list.every((t) => t.starred);
    const out: SheetAction[] = [];
    if (extra && list.length === 1) out.push({ label: 'Open', icon: MailOpen, run: () => props.onOpen(ids[0]) });
    if (list.some((t) => t.location === 'inbox')) out.push({ label: 'Done', icon: Archive, hint: 'Out of the inbox, into Archive', run: () => actions.done(ids.filter((id) => list.find((t) => t.id === id)?.location === 'inbox')) });
    if (list.some((t) => t.location !== 'inbox' && t.location !== 'drafts')) out.push({ label: 'Move to Inbox', icon: Inbox, run: () => actions.inbox(ids) });
    if (extra) out.push({ label: 'Snooze…', icon: Clock, run: () => setSnoozing({ ids }) });
    out.push({ label: anyUnread ? 'Mark as read' : 'Mark as unread', icon: anyUnread ? MailOpen : Mail, run: () => actions.read(ids, !anyUnread) });
    out.push({ label: allStarred ? 'Unstar' : 'Star', icon: Star, run: () => actions.star(ids, !allStarred) });
    if (extra) out.push({ label: 'Select', icon: Check, group: 'select', run: () => setPicked(new Set(ids)) });
    if (list.some((t) => t.location !== 'spam')) out.push({ label: 'Report spam', icon: ShieldAlert, group: 'end', run: () => actions.spam(ids) });
    if (list.some((t) => t.location !== 'trash')) out.push({ label: 'Delete', icon: Trash2, danger: true, group: 'end', run: () => actions.trash(ids) });
    return out;
  };

  const rows = useLeaving(threads, (t) => t.id);
  const selList = threads.filter((t) => sel.has(t.id));
  const selUnread = selList.some((t) => t.unread);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const chips = CHIPS.filter((c) => c.id !== 'assigned' || props.assignChip);
  const lastSnoozed = snoozing ? threads.filter((t) => snoozing.ids.includes(t.id)) : [];

  return (
    <section className={`list-pane${selecting ? ' selecting' : ''}`} style={{ ['--list-w' as string]: `${props.width}px` }}>
      <div className="pane-resize" onPointerDown={startResize} onDoubleClick={() => props.onWidth(400)} title="Drag to resize" />
      <header className="list-header">
        <div className="list-title">
          <button className="icon-btn menu-btn" onClick={props.onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <h1>{title}</h1>
          {unread > 0 && <span className="pill">{unread} unread</span>}
          {props.onRefresh && (
            <span className={`list-sync ${props.offline ? 'off' : ''}`}>
              {(updated || props.offline) && (
                <small key={props.offline ? 'off' : 'on'} title={props.offline ? 'New mail isn’t arriving by itself right now. Refresh to reconnect.' : undefined}>
                  {refreshing ? 'Checking for mail…' : props.offline ? `Connection lost${updated ? `. Updated ${updated}` : ''}` : `Updated ${updated}`}
                </small>
              )}
              <button type="button" className="icon-btn sm" onClick={() => void refresh()} disabled={refreshing} title="Check for new mail" aria-label="Check for new mail">
                <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
              </button>
            </span>
          )}
        </div>
        <label className="search">
          <Search size={16} />
          <input ref={searchRef} value={query} onChange={(e) => props.onQuery(e.target.value)} placeholder="Search mail" />
          <kbd>/</kbd>
        </label>
        {/* One row that switches between the filters and the selection's own header, at the same height. */}
        <div className="mail-tools" key={selecting ? 'sel' : 'chips'}>
          {selecting ? (
            <div className="sel-head">
              <button type="button" className="ghost-btn sm" onClick={endSelect}>
                <X size={15} /> Cancel
              </button>
              <span className="sel-count" aria-live="polite">
                {sel.size} selected
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => setPicked(sel.size === threads.length ? new Set() : new Set(threads.map((t) => t.id)))}>
                {sel.size === threads.length ? 'Select none' : 'Select all'}
              </button>
            </div>
          ) : (
            <div className="mail-chips" role="group" aria-label="Show only">
              {chips.map((c) => (
                <button key={c.id} type="button" className={`mail-chip${filter === c.id ? ' on' : ''}`} aria-pressed={filter === c.id} onClick={() => props.onFilter(filter === c.id ? 'all' : c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      {props.notice}
      {props.offline && <div className="list-offline">Connection lost. Pull down to check for mail.</div>}
      {props.onRefresh && (
        <div className={`pull-mark ${pull ? 'on' : ''} ${dragging ? 'dragging' : ''} ${refreshing ? 'busy' : ''} ${pull >= PULL_AT ? 'ready' : ''}`} style={{ ['--pull' as string]: `${pull}px` }} aria-hidden>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        </div>
      )}

      {threads.length === 0 ? (
        <div className={`empty ${pull ? 'pulled' : ''} ${dragging ? 'dragging' : ''}`} ref={(el) => void (bodyRef.current = el)} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
          <div className="empty-art">✓</div>
          <p className="empty-title">{query ? 'No matches' : filter !== 'all' ? 'Nothing like that here' : (props.empty?.title ?? 'All caught up')}</p>
          <p className="empty-sub">
            {query
              ? `Nothing found for “${query}”. Try a name, an email address or a few words from the subject.`
              : filter !== 'all'
                ? `No emails here are ${filter === 'unread' ? 'unread' : filter === 'reply' ? 'waiting for your reply' : filter === 'assigned' ? 'given to you' : 'with attachments'} right now.`
                : (props.empty?.sub ?? (phone ? 'Nothing waiting here. New mail lands in your inbox.' : 'Nothing waiting here. New mail lands in your inbox; press C to write one.'))}
          </p>
          {filter !== 'all' && !query ? (
            <button type="button" className="ghost-btn sm outline" onClick={() => props.onFilter('all')}>
              Show everything
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

      {selecting && (
        <div className="mail-bulk" role="toolbar" aria-label={`${sel.size} selected`}>
          {selList.some((t) => t.location === 'inbox') ? (
            <button type="button" onClick={() => (actions.done(selList.filter((t) => t.location === 'inbox').map((t) => t.id)), endSelect())}>
              <Check size={20} />
              <span>Done</span>
            </button>
          ) : (
            <button type="button" onClick={() => (actions.inbox([...sel]), endSelect())}>
              <Inbox size={20} />
              <span>Inbox</span>
            </button>
          )}
          <button type="button" ref={snoozeBtn} onClick={() => setSnoozing({ ids: [...sel], anchor: snoozeBtn })}>
            <Clock size={20} />
            <span>Snooze</span>
          </button>
          <button type="button" onClick={() => (actions.read([...sel], !selUnread), endSelect())}>
            {selUnread ? <MailOpen size={20} /> : <Mail size={20} />}
            <span>{selUnread ? 'Read' : 'Unread'}</span>
          </button>
          <button type="button" onClick={() => (actions.trash([...sel]), endSelect())}>
            <Trash2 size={20} />
            <span>Delete</span>
          </button>
          <button type="button" ref={moreBtn} onClick={() => setMenuFor({ ids: [...sel], anchor: moreBtn, title: `${sel.size} selected` })}>
            <MoreHorizontal size={20} />
            <span>More</span>
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
        actions={menuFor ? actionsFor(threads.filter((t) => menuFor.ids.includes(t.id)), !!menuFor.at).map((a) => (menuFor.anchor ? { ...a, run: () => (a.run(), a.label !== 'Snooze…' && endSelect()) } : a)) : []}
      />
    </section>
  );
});

/** One email in the list: picture, who and when, subject, a line of it, then one quiet line of status. */
function MailRow(p: {
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
}) {
  const { t } = p;
  const last = lastMessage(t);
  const hasFiles = t.messages.some((m) => m.attachments?.length);
  const tracked = lastTracked(t, p.me);
  const sum = tracked?.tracking && !t.sendAt ? summarize(tracked.tracking) : null; // not sent yet: nothing to see
  const who = t.assignee ? p.personOf(t.assignee) : undefined;
  const comments = t.notes?.length ?? 0;
  const labels = p.labels.filter((l) => t.labels.includes(l.id));
  const snoozed = !!t.snoozedUntil && t.snoozedUntil > new Date().toISOString();
  const pointer = useRef<string>('');
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const hold = useLongPress(() => !p.selecting && p.onHold(), { disabled: p.leaving });
  const status =
    (p.shared && (who || t.location === 'inbox')) || comments > 0 || snoozed || !!t.sendAt || hasFiles || !!p.client || labels.length > 0 || !!sum || t.location === 'drafts' || (p.phone && t.starred);
  return (
    <div
      className={`row lp${t.unread ? ' unread' : ''}${p.current ? ' selected' : ''}${p.picked ? ' picked' : ''}${p.team ? ' team-mail' : ''}`}
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
      aria-label={`${t.unread ? 'Unread, ' : ''}${participants(t, p.me)}: ${t.subject}`}
    >
      <button
        type="button"
        className={`row-av${p.picked ? ' on' : ''}`}
        onClick={(e) => (e.stopPropagation(), p.onToggle())}
        aria-pressed={p.picked}
        aria-label={p.picked ? 'Unselect' : 'Select'}
        title={p.picked ? 'Unselect' : 'Select'}
      >
        <Avatar person={isMine(last.from.email) ? t.messages[0].from : last.from} />
        <span className="row-check" aria-hidden="true">
          <Check size={18} strokeWidth={3} />
        </span>
      </button>
      <div className="row-main">
        <div className="row-top">
          <span className="row-from">
            {t.unread && <i className="row-dot" aria-hidden="true" />}
            <span className="row-names">{participants(t, p.me)}</span>
            {t.messages.length > 1 && <span className="row-count">{t.messages.length}</span>}
          </span>
          <span className="row-date">{listDate(last.date)}</span>
        </div>
        <div className="row-subject">{t.subject}</div>
        {p.snippets && <div className="row-snippet">{snippet(last.body) || ' '}</div>}
        {status && (
          <div className="row-meta">
            {p.phone && t.starred && (
              <span className="rm-item rm-star" aria-label="Starred">
                <Star size={13} />
              </span>
            )}
            {t.location === 'drafts' && !t.sendAt && <span className="rm-draft">Draft</span>}
            {t.sendAt && (
              <span className="rm-item rm-when">
                <Clock size={13} /> Sends {whenWords(new Date(t.sendAt))}
              </span>
            )}
            {snoozed && (
              <span className="rm-item rm-when" title={t.snoozeIfNoReply ? 'Comes back only if nobody writes before then' : undefined}>
                <Clock size={13} /> {whenWords(new Date(t.snoozedUntil!))}
                {t.snoozeIfNoReply ? ', if no reply' : ''}
              </span>
            )}
            {p.shared && who && (
              <span className="rm-item rm-who">
                <Avatar person={who} size={16} />
                {who.id === p.meId ? 'You' : who.name.split(' ')[0]}
              </span>
            )}
            {p.shared && !who && t.location === 'inbox' && <span className="rm-item rm-open">Unassigned</span>}
            {comments > 0 && (
              <span className="rm-item" title={`${comments} comment${comments > 1 ? 's' : ''} from the team`}>
                <MessageSquare size={13} /> {comments}
              </span>
            )}
            {hasFiles && (
              <span className="rm-item" title="Has attachments">
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
                    ? `Opened by ${sum.openedBy} of ${sum.recipients} · last ${relative(sum.lastOpen!)}${sum.clicks ? ` · ${sum.clicks} link click${sum.clicks > 1 ? 's' : ''}` : ''}`
                    : sum.clicks
                      ? 'A link in it was clicked; their mail app doesn’t load pictures, so opens don’t show'
                      : sum.autoOnly
                        ? 'Apple Mail or a mail filter loaded it by itself, so it may not have been read yet'
                        : 'Not opened yet'
                }
              >
                {sum.opens || sum.clicks ? <Eye size={12} /> : <EyeOff size={12} />}
                {sum.opens ? `Seen ${sum.opens}×` : sum.clicks ? 'Clicked' : sum.autoOnly ? 'Opened (maybe automatic)' : 'Not opened'}
              </span>
            )}
          </div>
        )}
      </div>
      {!p.selecting && (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          {t.location !== 'drafts' && t.location !== 'trash' && t.location !== 'spam' && (
            <button ref={snoozeBtn} className="icon-btn sm" onClick={() => p.onSnooze(snoozeBtn)} title="Snooze">
              <Clock size={15} />
            </button>
          )}
          {t.location !== 'drafts' && (
            <button className="icon-btn sm" onClick={p.onDone} title={t.location === 'inbox' ? 'Done (E)' : 'Move to Inbox'}>
              {t.location === 'inbox' ? <Archive size={15} /> : <Inbox size={15} />}
            </button>
          )}
          {t.location !== 'trash' && (
            <button className="icon-btn sm" onClick={p.onTrash} title="Delete (#)">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
      <button
        className={`star ${t.starred ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onStar();
        }}
        aria-label={t.starred ? 'Unstar' : 'Star'}
        tabIndex={p.selecting ? -1 : 0}
      >
        <Star size={15} />
      </button>
    </div>
  );
}
