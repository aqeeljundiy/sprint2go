import { forwardRef, useEffect, useRef, useState } from 'react';
import { lastTracked, summarize } from '../tracking';
import { Archive, Clock, Eye, EyeOff, Menu, Paperclip, RefreshCw, Search, Star, Trash2 } from 'lucide-react';
import type { Client, Person, Thread } from '../types';
import { lastMessage, listDate, participants, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { isMine } from '../identity';
import { PenLine } from 'lucide-react';
import { useCreateAction } from '../mobile/chrome';

interface Props {
  /** A line above the list about what doesn't work yet (incoming or outgoing mail), with its fix. */
  notice?: React.ReactNode;
  /** What an empty list says instead (e.g. a temporary address waiting for its first email). */
  empty?: { title: string; sub: string; action?: React.ReactNode };
  title: string;
  threads: Thread[];
  clientOf: (t: Thread) => Client | undefined; // the client this email is with (replaces labels)
  personName: (id: string) => string | undefined;
  meId: string;
  me: Person;
  selectedId: string | null;
  query: string;
  filter: 'all' | 'unread';
  onQuery: (q: string) => void;
  onFilter: (f: 'all' | 'unread') => void;
  onOpen: (id: string) => void;
  onStar: (id: string) => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onSnooze?: (id: string) => void; // until tomorrow 9:00
  onMenu: () => void;
  leaving: Set<string>;
  showSnippets: boolean;
  width: number;
  onWidth: (w: number) => void;
  /** Checks for new mail now (the button, and pulling the list down on a phone). */
  onRefresh?: () => Promise<void>;
  updatedAt?: number; // when mail last came in fresh
  offline?: boolean; // the live connection dropped: new mail waits for a refresh
  onCompose?: () => void; // phones: Compose is Mail's create button (missing: sending isn't set up)
}

const PULL_AT = 64; // px: pull this far, let go, and it refreshes

export const LIST_MIN = 300;
export const LIST_MAX = 560;

export const MessageList = forwardRef<HTMLInputElement, Props>(function MessageList(props, searchRef) {
  const { title, threads, me, selectedId, query, filter } = props;
  useCreateAction('mail', props.onCompose && { label: 'Compose', icon: PenLine, run: props.onCompose });
  const listRef = useRef<HTMLUListElement>(null);
  const unread = threads.filter((t) => t.unread).length;
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0); // how far the list is pulled down, in px
  const [dragging, setDragging] = useState(false); // a finger is on it: the list follows without easing
  const [, tick] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  const bodyRef = useRef<HTMLElement | null>(null); // the list, or the empty state: what a pull starts on
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
    if (!el || !props.onRefresh) return;
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
  }, [!!props.onRefresh, threads.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps
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

  return (
    <section className="list-pane" style={{ ['--list-w' as string]: `${props.width}px` }}>
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
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Search mail"
          />
          <kbd>/</kbd>
        </label>
        <div className="segmented">
          {(['all', 'unread'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => props.onFilter(f)}>
              {f === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </header>
      {props.notice}
      {props.onRefresh && (
        <div className={`pull-mark ${pull ? 'on' : ''} ${dragging ? 'dragging' : ''} ${refreshing ? 'busy' : ''} ${pull >= PULL_AT ? 'ready' : ''}`} style={{ ['--pull' as string]: `${pull}px` }} aria-hidden>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        </div>
      )}

      {threads.length === 0 ? (
        <div className={`empty ${pull ? 'pulled' : ''} ${dragging ? 'dragging' : ''}`} ref={(el) => void (bodyRef.current = el)} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
          <div className="empty-art">✓</div>
          <p className="empty-title">{query ? 'No matches' : (props.empty?.title ?? 'All caught up')}</p>
          <p className="empty-sub">{query ? `Nothing found for “${query}”. Try a name, an email address or a few words from the subject.` : (props.empty?.sub ?? 'Nothing waiting here. New mail lands in your inbox; press C to write one.')}</p>
          {!query && props.empty?.action}
        </div>
      ) : (
        <ul
          className={`rows ${pull ? 'pulled' : ''} ${dragging ? 'dragging' : ''}`}
          ref={(el) => void ((listRef.current = el), (bodyRef.current = el))}
          style={pull ? { transform: `translateY(${pull}px)` } : undefined}
        >
          {threads.map((t) => {
            const last = lastMessage(t);
            const client = props.clientOf(t);
            const hasFiles = t.messages.some((m) => m.attachments?.length);
            const tracked = lastTracked(t, me);
            const sum = tracked?.tracking && !t.sendAt ? summarize(tracked.tracking) : null; // not sent yet: nothing to see
            return (
              <li
                key={t.id}
                className={`row ${t.unread ? 'unread' : ''} ${selectedId === t.id ? 'selected' : ''} ${props.leaving.has(t.id) ? 'leaving' : ''}`}
                onClick={() => props.onOpen(t.id)}
              >
                <Avatar person={isMine(last.from.email) ? t.messages[0].from : last.from} />
                <div className="row-main">
                  <div className="row-top">
                    <span className="row-from">
                      {participants(t, me)}
                      {t.messages.length > 1 && <span className="row-count">{t.messages.length}</span>}
                    </span>
                    <span className="row-date">{t.sendAt ? `Sends ${listDate(t.sendAt)}` : t.snoozedUntil ? `Back ${listDate(t.snoozedUntil)}` : listDate(last.date)}</span>
                  </div>
                  <div className="row-subject">{t.subject}</div>
                  {props.showSnippets && <div className="row-snippet">{snippet(last.body)}</div>}
                  {(client || t.assignee || hasFiles || sum) && (
                    <div className="row-meta">
                      {client && (
                        <span className="chip client-chip" style={{ ['--c' as string]: client.color }}>
                          {client.name}
                        </span>
                      )}
                      {t.assignee && <span className="chip assignee-chip">{t.assignee === props.meId ? 'You’re on it' : `${props.personName(t.assignee)?.split(' ')[0] ?? 'Someone'} is on it`}</span>}
                      {hasFiles && <Paperclip size={13} className="clip" />}
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
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  {props.onSnooze && t.location === 'inbox' && (
                    <button className="icon-btn sm" onClick={() => props.onSnooze!(t.id)} title="Snooze until tomorrow morning">
                      <Clock size={15} />
                    </button>
                  )}
                  <button className="icon-btn sm" onClick={() => props.onArchive(t.id)} title="Archive (E)">
                    <Archive size={15} />
                  </button>
                  <button className="icon-btn sm" onClick={() => props.onTrash(t.id)} title="Delete (#)">
                    <Trash2 size={15} />
                  </button>
                </div>
                <button
                  className={`star ${t.starred ? 'on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onStar(t.id);
                  }}
                  aria-label={t.starred ? 'Unstar' : 'Star'}
                >
                  <Star size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
