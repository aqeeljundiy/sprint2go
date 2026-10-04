import { forwardRef, useEffect, useRef } from 'react';
import { lastTracked, summarize } from '../tracking';
import { Archive, Eye, EyeOff, Menu, Paperclip, Search, Star, Trash2 } from 'lucide-react';
import type { Label, Person, Thread } from '../types';
import { lastMessage, listDate, participants, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { isMine } from '../identity';

interface Props {
  title: string;
  threads: Thread[];
  labels: Label[];
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
  onMenu: () => void;
  leaving: Set<string>;
  showSnippets: boolean;
  width: number;
  onWidth: (w: number) => void;
}

export const LIST_MIN = 300;
export const LIST_MAX = 560;

export const MessageList = forwardRef<HTMLInputElement, Props>(function MessageList(props, searchRef) {
  const { title, threads, labels, me, selectedId, query, filter } = props;
  const listRef = useRef<HTMLUListElement>(null);
  const unread = threads.filter((t) => t.unread).length;

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

      {threads.length === 0 ? (
        <div className="empty">
          <div className="empty-art">✓</div>
          <p className="empty-title">{query ? 'No matches' : 'All caught up'}</p>
          <p className="empty-sub">{query ? `Nothing found for “${query}”.` : 'Nothing here right now.'}</p>
        </div>
      ) : (
        <ul className="rows" ref={listRef}>
          {threads.map((t) => {
            const last = lastMessage(t);
            const hasFiles = t.messages.some((m) => m.attachments?.length);
            const tracked = lastTracked(t, me);
            const sum = tracked?.tracking ? summarize(tracked.tracking) : null;
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
                    <span className="row-date">{listDate(last.date)}</span>
                  </div>
                  <div className="row-subject">{t.subject}</div>
                  {props.showSnippets && <div className="row-snippet">{snippet(last.body)}</div>}
                  {(t.labels.length > 0 || hasFiles || sum) && (
                    <div className="row-meta">
                      {t.labels.map((id) => {
                        const l = labels.find((x) => x.id === id);
                        return l ? (
                          <span key={id} className="chip" style={{ ['--c' as string]: l.color }}>
                            {l.name}
                          </span>
                        ) : null;
                      })}
                      {hasFiles && <Paperclip size={13} className="clip" />}
                      {sum && (
                        <span
                          className={`seen-chip ${sum.opens ? 'yes' : sum.autoOnly ? 'auto' : ''}`}
                          title={
                            sum.opens
                              ? `Opened by ${sum.openedBy} of ${sum.recipients} · last ${relative(sum.lastOpen!)}${sum.clicks ? ` · ${sum.clicks} link click${sum.clicks > 1 ? 's' : ''}` : ''}`
                              : sum.autoOnly
                                ? 'Loaded automatically by Apple Mail, may not have been read'
                                : 'Not opened yet'
                          }
                        >
                          {sum.opens ? <Eye size={12} /> : <EyeOff size={12} />}
                          {sum.opens ? `Seen ${sum.opens}×` : sum.autoOnly ? 'Auto-opened' : 'Not opened'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
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
