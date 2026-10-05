import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  CalendarCheck,
  CalendarPlus,
  Eye,
  FileText,
  HardDriveUpload,
  Check,
  Forward,
  Inbox,
  Mail,
  Reply,
  Send,
  ShieldAlert,
  Ban,
  ListChecks,
  MailMinus,
  Sparkles,
  Loader2,
  ShieldCheck,
  Star,
  Trash2,
  Clock,
  StickyNote,
  UserCheck,
} from 'lucide-react';
import type { CalEvent, Person, Thread, User, Client } from '../types';
import { Popover } from './ui/Popover';
import { Select } from './ui/Select';
import { fmtTime } from '../calendarUtils';
import { fullDate, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';
import { RichEditor } from './RichEditor';
import { TrackingPanel } from './TrackingPanel';
import { isMine } from '../identity';
import { hasOwnText, sanitize, textToHtml } from '../sanitize';
import { ai, type Summary } from '../ai';
import type { Todo } from '../types';
import type { Attachment } from '../types';

interface Props {
  thread: Thread | null;
  client?: Client; // the client this email is with
  onClient?: (id: string) => void;
  me: Person;
  inviteAdded: boolean;
  inviteConflicts: CalEvent[];
  onAddInvite: (threadId: string) => void;
  onBack: () => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onSpam: (id: string) => void;
  onMoveToInbox: (id: string) => void;
  onStar: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onReply: (id: string, html: string, text: string) => void;
  signature: string;
  blockTrackers: boolean;
  savedToDrive: (name: string) => boolean;
  onSaveToDrive: (threadId: string, a: Attachment) => void;
  myName: string;
  todos: Todo[]; // to-dos that came from this thread
  onToggleTodo: (id: string) => void;
  onOpenTodos: () => void;
  unsubscribedAt?: string;
  onUnsubscribe: (t: Thread) => void;
  onBlock: (t: Thread) => void;
  teammates: User[]; // people with access to this mailbox
  shared: boolean;
  onAssign: (threadId: string, userId: string) => void;
  onSnooze: (threadId: string, until: string) => void;
  onNote: (threadId: string, text: string) => void;
}

/** AI results per message id, kept for the session (the backend stores them with the email). */
const AI_CACHE = { summary: new Map<string, any>(), replies: new Map<string, string[]>() }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Snooze options: later today, tomorrow morning, next Monday. */
const snoozeTimes = (): [string, Date][] => {
  const at = (days: number, h: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const mon = new Date();
  mon.setDate(mon.getDate() + (((8 - mon.getDay()) % 7) || 7));
  mon.setHours(9, 0, 0, 0);
  const later = new Date(Date.now() + 3 * 3_600_000);
  return [
    ['In 3 hours', later],
    ['Tomorrow morning', at(1, 9)],
    ['Next Monday', mon],
    ['In a week', at(7, 9)],
  ];
};

/** Free reply templates: always there, no AI. */
const TEMPLATES = ['Thanks, received!', 'Let me check and get back to you.', 'Sounds good, let’s do it.'];

export function Reader(props: Props) {
  const { thread } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState({ html: '', text: '' });
  const [replyInitial, setReplyInitial] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | 'loading' | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const incoming = thread ? [...thread.messages].reverse().find((m) => !isMine(m.from.email)) : undefined;
  const isList = !!thread?.messages.some((m) => m.listUnsubscribe);

  // Reset per thread: only the latest message starts expanded.
  useEffect(() => {
    if (!thread) return;
    setExpanded(new Set([thread.messages[thread.messages.length - 1].id]));
    setReplyOpen(false);
    setReply({ html: '', text: '' });
    setReplyInitial(null);
    // AI answers are saved per message: opening the email again never pays twice.
    const key = thread.messages[thread.messages.length - 1].id;
    setSummary(AI_CACHE.summary.get(key) ?? null);
    setSuggestions(AI_CACHE.replies.get(key) ?? null);
    setSuggesting(false);
  }, [thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suggested replies only when someone asks (AI never runs just because an email was opened).
  const lastMsg = thread?.messages[thread.messages.length - 1];
  const canReply = !!thread && !!lastMsg && !isMine(lastMsg.from.email) && !isList && thread.location !== 'spam' && !/no-?reply|notifications/i.test(lastMsg.from.email);
  const suggest = async () => {
    if (!thread || !lastMsg || suggesting) return;
    setSuggesting(true);
    try {
      const r = await ai.replies(thread, props.myName);
      AI_CACHE.replies.set(lastMsg.id, r);
      setSuggestions(r);
    } catch {
      /* AI unavailable */
    }
    setSuggesting(false);
  };

  const summarize = async () => {
    if (!thread || summary === 'loading') return;
    if (summary) return setSummary(null);
    setSummary('loading');
    try {
      const sum = await ai.summarize(thread);
      AI_CACHE.summary.set(thread.messages[thread.messages.length - 1].id, sum);
      setSummary(sum);
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' || !thread || e.metaKey || e.ctrlKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      setReplyOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread]);

  if (!thread) {
    return (
      <section className="reader reader-empty">
        <Wordmark height={30} />
        <p className="empty-title">Select a conversation</p>
        <p className="empty-sub">
          Use <kbd>J</kbd> <kbd>K</kbd> to move, <kbd>E</kbd> to archive, <kbd>C</kbd> to compose.
        </p>
      </section>
    );
  }

  const last = thread.messages[thread.messages.length - 1];
  const replyTo = isMine(last.from.email) ? last.to[0] : last.from;
  const inbox = thread.location === 'inbox';

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const send = () => {
    if (!hasOwnText(reply.text, props.signature)) return;
    props.onReply(thread.id, reply.html, reply.text);
    setReply({ html: '', text: '' });
    setReplyOpen(false);
    setReplyInitial(null);
  };

  return (
    <section className="reader">
      <header className="reader-bar">
        <button className="icon-btn back-btn" onClick={props.onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="toolbar">
          {inbox ? (
            <button className="icon-btn" onClick={() => props.onArchive(thread.id)} title="Archive (E)">
              <Archive size={17} />
            </button>
          ) : (
            <button className="icon-btn" onClick={() => props.onMoveToInbox(thread.id)} title="Move to inbox">
              <Inbox size={17} />
            </button>
          )}
          <button className="icon-btn" onClick={() => props.onSpam(thread.id)} title="Report spam">
            <ShieldAlert size={17} />
          </button>
          <button className="icon-btn" onClick={() => props.onTrash(thread.id)} title="Delete (#)">
            <Trash2 size={17} />
          </button>
          {incoming && (
            <button className="icon-btn" onClick={() => props.onBlock(thread)} title={`Block ${incoming.from.email}`}>
              <Ban size={17} />
            </button>
          )}
          <span className="divider" />
          <button ref={snoozeBtn} className="icon-btn" onClick={() => setSnoozeOpen(true)} title="Snooze">
            <Clock size={17} />
          </button>
          <Popover anchor={snoozeBtn} open={snoozeOpen} onClose={() => setSnoozeOpen(false)} width={240} title="Snooze until">
            <div className="sel-pop">
              {snoozeTimes().map(([l, d]) => (
                <button key={l} className="sel-opt" onClick={() => (setSnoozeOpen(false), props.onSnooze(thread.id, d.toISOString()))}>
                  <span className="sel-label">
                    {l}
                    <small>{d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                  </span>
                </button>
              ))}
            </div>
          </Popover>
          {props.shared && (
            <Select
              value={thread.assignee ?? ''}
              onChange={(v) => props.onAssign(thread.id, v)}
              label="Who handles this"
              className="sel-flat assign-sel"
              width={240}
              options={[{ value: '', label: 'Nobody yet' }, ...props.teammates.map((u) => ({ value: u.id, label: u.name, icon: <Avatar person={u} size={20} /> }))]}
              renderValue={(o) => (
                <>
                  <UserCheck size={14} />
                  <span className="sel-text">{o?.value ? o.label.split(' ')[0] : 'Assign'}</span>
                </>
              )}
            />
          )}
          <button className="icon-btn" onClick={() => props.onMarkUnread(thread.id)} title="Mark unread (U)">
            <Mail size={17} />
          </button>
          <button
            className={`icon-btn ${thread.starred ? 'starred' : ''}`}
            onClick={() => props.onStar(thread.id)}
            title="Star (S)"
          >
            <Star size={17} />
          </button>
        </div>
      </header>

      <div className="reader-scroll" key={thread.id}>
        <div className="thread-head">
          <h2>{thread.subject}</h2>
          <div className="thread-labels">
            {props.client && (
              <button className="chip client-chip" style={{ ['--c' as string]: props.client.color }} onClick={() => props.onClient?.(props.client!.id)} title="Open the client page">
                {props.client.name}
              </button>
            )}
            <span className="thread-count">
              {thread.messages.length} message{thread.messages.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="ai-bar">
          <button className={`ai-chip ${summary && summary !== 'loading' ? 'on' : ''}`} onClick={summarize}>
            {summary === 'loading' ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {summary === 'loading' ? 'Reading…' : summary ? 'Hide summary' : 'Summarize'}
          </button>
          {props.todos.length > 0 && (
            <button className="ai-chip todo" onClick={props.onOpenTodos}>
              <ListChecks size={13} /> {props.todos.filter((t) => !t.done).length || '✓'} to-do{props.todos.length > 1 ? 's' : ''} from this email
            </button>
          )}
        </div>

        {summary && summary !== 'loading' && (
          <div className="ai-summary">
            <div className="ais-label">
              <Sparkles size={13} /> Summary
            </div>
            <p>{summary.summary}</p>
            {summary.asks.length > 0 && (
              <>
                <div className="ais-label">They’re asking you to</div>
                <ul>
                  {summary.asks.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            )}
            {props.todos.length > 0 && (
              <>
                <div className="ais-label">Your to-dos</div>
                {props.todos.map((t) => (
                  <label key={t.id} className={`ais-todo ${t.done ? 'done' : ''}`}>
                    <input type="checkbox" checked={t.done} onChange={() => props.onToggleTodo(t.id)} />
                    {t.title}
                  </label>
                ))}
              </>
            )}
          </div>
        )}

        {isList && incoming && (() => {
          const stillSending = props.unsubscribedAt && incoming.date > props.unsubscribedAt;
          return (
            <div className={`list-banner ${stillSending ? 'warn' : ''}`}>
              <MailMinus size={16} />
              <span>
                {stillSending
                  ? `${incoming.from.name} is still emailing you after you unsubscribed.`
                  : props.unsubscribedAt
                    ? `You unsubscribed from ${incoming.from.name} ${relative(props.unsubscribedAt)}.`
                    : `Mailing list from ${incoming.from.name}`}
              </span>
              {!props.unsubscribedAt && (
                <button className="ghost-btn outline sm" onClick={() => props.onUnsubscribe(thread)}>
                  Unsubscribe
                </button>
              )}
              <button className={stillSending ? 'primary-btn sm' : 'ghost-btn sm'} onClick={() => props.onBlock(thread)}>
                <Ban size={13} /> Block
              </button>
            </div>
          );
        })()}

        {thread.invite && (
          <div className={`invite ${props.inviteAdded ? 'added' : ''}`}>
            <div className="invite-date">
              <span>{new Date(thread.invite.start).toLocaleDateString([], { month: 'short' })}</span>
              <strong>{new Date(thread.invite.start).getDate()}</strong>
            </div>
            <div className="invite-info">
              <div className="invite-kicker">Meeting proposed in this email</div>
              <div className="invite-title">{thread.invite.title}</div>
              <div className="invite-when">
                {new Date(thread.invite.start).toLocaleDateString([], { weekday: 'long' })} ·{' '}
                {fmtTime(thread.invite.start)} – {fmtTime(thread.invite.end)}
                {thread.invite.location && ` · ${thread.invite.location}`}
              </div>
              <div className={`invite-status ${props.inviteConflicts.length && !props.inviteAdded ? 'warn' : ''}`}>
                {props.inviteAdded
                  ? 'On your calendar'
                  : props.inviteConflicts.length
                    ? `Overlaps with “${props.inviteConflicts[0].title}”`
                    : 'You’re free at this time'}
              </div>
            </div>
            {props.inviteAdded ? (
              <span className="invite-done">
                <CalendarCheck size={16} /> Added
              </span>
            ) : (
              <button className="primary-btn" onClick={() => props.onAddInvite(thread.id)}>
                <CalendarPlus size={15} /> Add to calendar
              </button>
            )}
          </div>
        )}

        <div className="messages">
          {thread.messages.map((m) => {
            const open = expanded.has(m.id);
            return (
              <article key={m.id} className={`message ${open ? 'open' : ''}`}>
                <button className="message-head" onClick={() => toggle(m.id)}>
                  <Avatar person={m.from} size={38} />
                  <div className="message-who">
                    <div className="message-from">
                      <strong>{isMine(m.from.email) ? 'You' : m.from.name}</strong>
                      {open && <span className="email">&lt;{m.from.email}&gt;</span>}
                    </div>
                    <div className="message-to">
                      {open ? `to ${m.to.map((p) => (isMine(p.email) ? 'me' : p.name)).join(', ')}` : snippet(m.body)}
                    </div>
                  </div>
                  <time title={fullDate(m.date)}>
                    {fullDate(m.date)} <span className="rel">({relative(m.date)})</span>
                  </time>
                  {!open && m.tracking && <Eye size={14} className="head-eye" />}
                </button>
                {open && props.blockTrackers && m.trackersBlocked ? (
                  <div className="blocked-note">
                    <ShieldCheck size={14} /> Blocked {m.trackersBlocked} tracker{m.trackersBlocked > 1 ? 's' : ''}, so the sender can’t see when you read this
                  </div>
                ) : null}
                {open && (
                  <div className="message-body">
                    {m.html ? (
                      <div className="prose" dangerouslySetInnerHTML={{ __html: sanitize(m.html) }} />
                    ) : (
                      m.body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
                    )}
                    {m.attachments && (
                      <div className="attachments">
                        {m.attachments.map((a) => {
                          const saved = props.savedToDrive(a.name);
                          return (
                            <div key={a.name} className="attachment">
                              <span className="file-icon">
                                <FileText size={18} />
                              </span>
                              <div>
                                <div className="file-name">{a.name}</div>
                                <div className="file-size">{a.size}</div>
                              </div>
                              <button
                                className={`att-save ${saved ? 'saved' : ''}`}
                                disabled={saved}
                                onClick={() => props.onSaveToDrive(thread.id, a)}
                                title={saved ? 'Saved to Drive' : 'Save to Drive'}
                              >
                                {saved ? <Check size={14} /> : <HardDriveUpload size={14} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {m.tracking && <TrackingPanel thread={thread} message={m} />}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {replyOpen ? (
          <div className="reply-box">
            <div className="reply-to">
              <Reply size={14} /> Replying to <strong>{replyTo.name}</strong>
            </div>
            <div onKeyDown={(e) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.tb-popup') && setReplyOpen(false)}>
              <RichEditor
                autoFocus
                initialHtml={replyInitial ?? (props.signature ? `<p><br></p>${props.signature}` : '')}
                placeholder="Write your reply…"
                onChange={(html, text) => setReply({ html, text })}
                onSubmit={send}
              />
            </div>
            <div className="reply-actions">
              <button
                className="ghost-btn"
                onClick={() => {
                  setReplyOpen(false);
                  setReplyInitial(null);
                }}
              >
                Discard
              </button>
              <button className="primary-btn" onClick={send} disabled={!hasOwnText(reply.text, props.signature)}>
                <Send size={15} /> Send <kbd>⌘↵</kbd>
              </button>
            </div>
          </div>
        ) : (
          <>
          {canReply && (
            <div className="smart-replies">
              <span>
                <Sparkles size={13} /> Quick replies
              </span>
              {!suggestions &&
                TEMPLATES.map((sug, i) => (
                  <button
                    key={sug}
                    className="tpl"
                    style={{ ['--i' as string]: i }}
                    onClick={() => {
                      setReplyInitial(textToHtml(sug) + (props.signature ? `<p><br></p>${props.signature}` : ''));
                      setReplyOpen(true);
                    }}
                  >
                    {sug}
                  </button>
                ))}
              {!suggestions && (
                <button className="ai-suggest" onClick={suggest} disabled={suggesting} title="Uses AI only when you click. Saved, so it’s free next time">
                  <Sparkles size={13} /> {suggesting ? 'Thinking…' : 'Suggest replies'}
                </button>
              )}
              {suggestions?.map((sug, i) => (
                <button
                  key={i}
                  style={{ ['--i' as string]: i }}
                  onClick={() => {
                    setReplyInitial(textToHtml(sug) + (props.signature ? `<p><br></p>${props.signature}` : ''));
                    setReplyOpen(true);
                  }}
                >
                  {sug.split('\n')[0]}
                </button>
              ))}
            </div>
          )}
          {!!thread.notes?.length && (
            <div className="team-notes">
              {thread.notes.map((n) => {
                const u = props.teammates.find((x) => x.id === n.by);
                return (
                  <div key={n.id} className="team-note">
                    <StickyNote size={14} />
                    <span>
                      <b>{u?.name.split(' ')[0] ?? 'Someone'}</b> {n.text}
                    </span>
                    <time>{new Date(n.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                );
              })}
            </div>
          )}
          {noteOpen && (
            <div className="note-compose">
              <StickyNote size={15} />
              <textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && note.trim() && (e.preventDefault(), props.onNote(thread.id, note.trim()), setNote(''), setNoteOpen(false))} placeholder="Note for your team. The sender never sees this. @mention someone" />
              <button className="primary-btn sm" disabled={!note.trim()} onClick={() => (props.onNote(thread.id, note.trim()), setNote(''), setNoteOpen(false))}>
                Add note
              </button>
            </div>
          )}
          <div className="reply-buttons">
            <button className="ghost-btn outline" onClick={() => setReplyOpen(true)}>
              <Reply size={15} /> Reply <kbd>R</kbd>
            </button>
            <button className="ghost-btn outline" onClick={() => setNoteOpen((o) => !o)}>
              <StickyNote size={15} /> Internal note
            </button>
            <button className="ghost-btn outline" onClick={() => setReplyOpen(true)}>
              <Forward size={15} /> Forward
            </button>
          </div>
          </>
        )}
      </div>
    </section>
  );
}
