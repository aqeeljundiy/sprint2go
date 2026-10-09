import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { brand as product, term } from '../terms';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Ban,
  CalendarCheck,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Forward,
  HardDriveUpload,
  Laptop,
  Inbox,
  ListChecks,
  ListPlus,
  Loader2,
  Mail,
  MailMinus,
  MoreHorizontal,
  Reply,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { CalEvent, Message, Person, Thread, User, Client } from '../types';
import { fmtTime } from '../calendarUtils';
import { fullDate, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';
import { RichEditor } from './RichEditor';
import { TrackingPanel } from './TrackingPanel';
import { isMine } from '../identity';
import { isTeam } from '../tracking';
import { hasOwnText, sanitize, textToHtml } from '../sanitize';
import { ai, type Summary } from '../ai';
import type { Todo } from '../types';
import type { Attachment } from '../types';
import { PushScreen } from './ui/PushScreen';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { usePhone } from '../mobile/media';
import { AssignPicker, SnoozePicker, type PresenceOf } from './mail/MailPickers';
import { CommentBox, MailComment } from './mail/Comments';
import { QuickReply } from './mail/QuickReply';
import { QUICK_REPLIES } from './mail/Templates';
import { participantsOf, whenWords } from '../mailRules';

interface Props {
  thread: Thread | null;
  /** Phones: the reader is a screen pushed over the list, shown while this is true. */
  open: boolean;
  /** The list it goes back to ("Inbox"), for Back on phones. */
  backLabel: string;
  /** The emails above and below this one in the list (previous and next). */
  prevId?: string;
  nextId?: string;
  onGo: (id: string) => void;
  client?: Client; // the client this email is with
  onClient?: (id: string) => void;
  me: Person;
  meUser: User;
  inviteAdded: boolean;
  inviteConflicts: CalEvent[];
  onAddInvite: (threadId: string) => void;
  /** The card for a calendar invite in a message (Yes, Maybe, No and the meeting link). */
  inviteCard?: (m: Message) => React.ReactNode;
  onBack: () => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onSpam: (id: string) => void;
  onMoveToInbox: (id: string) => void;
  onStar: (id: string) => void;
  onMarkUnread: (id: string) => void;
  /** `track`: the reply box's tracking switch was on (only offered when the company allows it, for outside people). */
  onReply: (id: string, html: string, text: string, track: boolean) => void;
  onForward: (t: Thread) => void;
  /** Read tracking is offered (the company hasn't switched it off), and whether it starts on (Settings, Mail). */
  canTrack?: boolean;
  trackByDefault?: boolean;
  /** A reply taken back with Undo: back in the reply box, as it was written. */
  restoreReply?: { threadId: string; html: string; text: string; key: number } | null;
  /** Why replies can't go out from this mailbox yet; Reply and Forward then explain instead of opening. */
  replyOff?: string;
  onReplyOff?: () => void;
  signature: string;
  blockTrackers: boolean;
  savedToDrive: (name: string) => boolean;
  onSaveToDrive: (threadId: string, a: Attachment) => void;
  myName: string;
  todos: Todo[]; // to-dos that came from this thread
  onToggleTodo: (id: string) => void;
  /** "Make a task": a task from this email, for you, with its project. */
  onMakeTask?: (threadId: string) => void;
  onOpenTodos: () => void;
  unsubscribedAt?: string;
  onUnsubscribe: (t: Thread) => void;
  onBlock: (t: Thread) => void;
  teammates: User[]; // people with access to this mailbox
  /** Team mail: more than one person opens this mailbox, so comments live here. */
  team: boolean;
  /** A shared inbox: someone handles each email. */
  shared: boolean;
  /** Teammates by any of their addresses (sign-in or mailbox), to show who's on the thread. */
  userForEmail: (email: string) => User | undefined;
  presence?: PresenceOf;
  onAssign: (threadId: string, userId: string) => void;
  onSnooze: (threadId: string, until: string, ifNoReply: boolean) => void;
  onComment: (threadId: string, text: string) => void;
  /** AI is set up here: the summary line shows. Off: it says why when asked. */
  aiOn: boolean;
  onAiOff: () => void;
}

/** AI results per message id, kept for the session (the backend stores them with the email). */
const AI_CACHE = { summary: new Map<string, any>(), replies: new Map<string, string[]>() }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Replies being written, per conversation: closing the reply keeps them (Reply then says "Draft"). */
const REPLY_DRAFTS = new Map<string, { html: string; text: string }>();

/** The first sentence of a summary: the one line that sits above the thread. */
const firstLine = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

export function Reader(props: Props) {
  const { thread } = props;
  const phone = usePhone();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState({ html: '', text: '' });
  const [replyInitial, setReplyInitial] = useState<string | null>(null);
  const [replyTrack, setReplyTrack] = useState<boolean | null>(null); // null: the person's default
  const [summary, setSummary] = useState<Summary | 'loading' | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [, setDraftTick] = useState(0);
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const assignBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const incoming = thread ? [...thread.messages].reverse().find((m) => !isMine(m.from.email)) : undefined;
  const isList = !!thread?.messages.some((m) => m.listUnsubscribe);

  // Reset per thread: only the latest message starts expanded, older ones fold into "3 earlier".
  useEffect(() => {
    if (!thread) return;
    setExpanded(new Set([thread.messages[thread.messages.length - 1].id]));
    setShowAll(false);
    setReplyOpen(false);
    setReply({ html: '', text: '' });
    setReplyInitial(null);
    setReplyTrack(null);
    setCommenting(false);
    // AI answers are saved per message: opening the email again never pays twice.
    const key = thread.messages[thread.messages.length - 1].id;
    setSummary(AI_CACHE.summary.get(key) ?? null);
    setSummaryOpen(false);
    setSuggestions(AI_CACHE.replies.get(key) ?? null);
    setSuggesting(false);
  }, [thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Undo send on a reply: what was written comes back in the reply box, ready to send again.
  useEffect(() => {
    const r = props.restoreReply;
    if (!r || !thread || r.threadId !== thread.id) return;
    setReplyInitial(r.html);
    setReply({ html: r.html, text: r.text });
    setReplyOpen(true);
  }, [props.restoreReply?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suggested replies only when someone asks (AI never runs just because an email was opened).
  const lastMsg = thread?.messages[thread.messages.length - 1];
  const canReply = !props.replyOff && !!thread && !!lastMsg && !isMine(lastMsg.from.email) && !isList && thread.location !== 'spam' && !/no-?reply|notifications/i.test(lastMsg.from.email);
  const suggest = async () => {
    if (!thread || !lastMsg || suggesting) return;
    if (!props.aiOn) return props.onAiOff();
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
    if (!props.aiOn) return props.onAiOff();
    if (summary) return setSummaryOpen((o) => !o);
    setSummary('loading');
    try {
      const sum = await ai.summarize(thread);
      AI_CACHE.summary.set(thread.messages[thread.messages.length - 1].id, sum);
      setSummary(sum);
    } catch {
      setSummary(null);
    }
  };

  /** Reply: the half-height sheet on phones (opened in the tap, so the keyboard comes up), the box below on desktop. */
  const startReply = (initial?: string) => {
    if (props.replyOff) return props.onReplyOff?.();
    if (initial !== undefined) setReplyInitial(initial);
    if (phone) flushSync(() => setReplyOpen(true));
    else {
      setReplyOpen(true);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' || !thread || e.metaKey || e.ctrlKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      startReply();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread, props.replyOff, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teammates on this conversation: who wrote or was written to, who commented, who handles it.
  const onThread = useMemo(() => {
    if (!thread) return [];
    const ids = new Set<string>();
    for (const p of participantsOf(thread)) {
      const u = props.userForEmail(p.email);
      if (u) ids.add(u.id);
    }
    for (const n of thread.notes ?? []) ids.add(n.by);
    if (thread.assignee) ids.add(thread.assignee);
    ids.delete(props.meUser.id);
    return props.teammates.filter((u) => ids.has(u.id));
  }, [thread, props.teammates, props.meUser.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!thread) {
    if (phone) return null;
    return (
      <section className="reader reader-empty">
        <Wordmark height={30} />
        <p className="empty-title">Select a conversation</p>
        <p className="empty-sub">
          Use <kbd>J</kbd> <kbd>K</kbd> to move, <kbd>E</kbd> for done, <kbd>C</kbd> to compose.
        </p>
      </section>
    );
  }
  if (phone && !props.open) return null;

  const last = thread.messages[thread.messages.length - 1];
  const replyTo = isMine(last.from.email) ? last.to[0] ?? last.from : last.from;
  // The reply goes to the same people as App's reply(); only those outside the team can be tracked.
  const replyOutside = (isMine(last.from.email) ? last.to : [last.from]).filter((p) => !isTeam(p.email));
  const replyTracked = !!props.canTrack && replyOutside.length > 0 && (replyTrack ?? !!props.trackByDefault);
  const draft = REPLY_DRAFTS.get(thread.id);
  const assignee = thread.assignee ? props.teammates.find((u) => u.id === thread.assignee) : undefined;
  const snoozed = !!thread.snoozedUntil && thread.snoozedUntil > new Date().toISOString();

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const send = () => {
    if (!hasOwnText(reply.text, props.signature)) return;
    props.onReply(thread.id, reply.html, reply.text, replyTracked);
    setReply({ html: '', text: '' });
    setReplyOpen(false);
    setReplyInitial(null);
  };

  /** Done, or the way back for an email that isn't in the inbox. */
  const primary =
    thread.location === 'inbox'
      ? { label: 'Done', icon: Check, run: () => props.onArchive(thread.id), title: 'Done (E): out of the inbox, into Archive' }
      : thread.location === 'drafts'
        ? null
        : { label: thread.location === 'spam' ? 'Not spam' : thread.location === 'trash' ? 'Restore' : 'Inbox', icon: thread.location === 'trash' ? RotateCcw : Inbox, run: () => props.onMoveToInbox(thread.id), title: 'Move to Inbox' };

  const moreActions = (): SheetAction[] => [
    ...(phone ? [] : [{ label: 'Reply', icon: Reply, run: () => startReply() }]),
    { label: 'Forward', icon: Forward, disabled: !!props.replyOff, run: () => props.onForward(thread) },
    ...(props.onMakeTask ? [{ label: 'Make a task', icon: ListPlus, run: () => props.onMakeTask!(thread.id) }] : []),
    { label: 'Mark as unread', icon: Mail, group: 'mark', run: () => props.onMarkUnread(thread.id) },
    { label: thread.starred ? 'Unstar' : 'Star', icon: Star, group: 'mark', checked: thread.starred, run: () => props.onStar(thread.id) },
    ...(phone && props.shared ? [] : props.shared ? [{ label: 'Who handles this…', icon: UserPlus, group: 'mark', run: () => setAssignOpen(true) }] : []),
    ...(thread.location !== 'spam' ? [{ label: 'Report spam', icon: ShieldAlert, group: 'end', run: () => props.onSpam(thread.id) }] : []),
    ...(incoming ? [{ label: `Block ${incoming.from.name || incoming.from.email}`, icon: Ban, group: 'end', run: () => props.onBlock(thread) }] : []),
    ...(thread.location !== 'trash' ? [{ label: 'Delete', icon: Trash2, danger: true, group: 'end', run: () => props.onTrash(thread.id) }] : []),
  ];

  // The conversation: messages and the team's comments in time order. With four or more messages, the ones between
  // the first and the last two fold into "3 earlier" (and the comments among them).
  const items: ({ kind: 'm'; m: Message } | { kind: 'c'; n: NonNullable<Thread['notes']>[number] })[] = [
    ...thread.messages.map((m) => ({ kind: 'm' as const, m, at: m.date })),
    ...(thread.notes ?? []).map((n) => ({ kind: 'c' as const, n, at: n.at })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const n = thread.messages.length;
  const fold = !showAll && n >= 4;
  const hidden = fold
    ? items.filter((x) => {
        const at = x.kind === 'm' ? x.m.date : x.n.at;
        return at > thread.messages[0].date && at < thread.messages[n - 2].date;
      })
    : [];
  const hiddenMsgs = hidden.filter((x) => x.kind === 'm').length;

  const people = props.teammates;
  const avatars = onThread.length > 0 && (
    <span className="reader-people" title={onThread.map((u) => u.name).join(', ')} aria-label={`On this conversation: ${onThread.map((u) => u.name).join(', ')}`}>
      {onThread.slice(0, 3).map((u) => (
        <Avatar key={u.id} person={u} size={24} />
      ))}
      {onThread.length > 3 && <i>+{onThread.length - 3}</i>}
    </span>
  );
  const nav = (
    <span className="reader-nav">
      <button type="button" className="icon-btn" disabled={!props.prevId} onClick={() => props.prevId && props.onGo(props.prevId)} aria-label="Previous email" title="Previous (K)">
        <ChevronUp size={20} />
      </button>
      <button type="button" className="icon-btn" disabled={!props.nextId} onClick={() => props.nextId && props.onGo(props.nextId)} aria-label="Next email" title="Next (J)">
        <ChevronDown size={20} />
      </button>
    </span>
  );

  const message = (m: Message) => {
    const open = expanded.has(m.id);
    return (
      <article key={m.id} className={`message ${open ? 'open' : ''}`}>
        <button className="message-head" onClick={() => toggle(m.id)} aria-expanded={open}>
          <Avatar person={m.from} size={phone ? 34 : 38} />
          <div className="message-who">
            <div className="message-from">
              <strong>{isMine(m.from.email) ? 'You' : m.from.name}</strong>
              {open && <span className="email">&lt;{m.from.email}&gt;</span>}
            </div>
            <div className="message-to">{open ? `to ${m.to.map((p) => (isMine(p.email) ? 'me' : p.name)).join(', ')}${m.bcc?.length ? `, Bcc ${m.bcc.map((p) => p.name || p.email).join(', ')}` : ''}` : snippet(m.body)}</div>
          </div>
          <time title={fullDate(m.date)}>
            {phone ? relative(m.date) : fullDate(m.date)} <span className="rel">({relative(m.date)})</span>
          </time>
          {!open && m.tracking && <Eye size={14} className="head-eye" />}
        </button>
        {open && m.delivery && (
          <div className={`delivery-note ${m.delivery.state}`}>
            {m.delivery.state === 'held' ? <Clock size={14} /> : m.delivery.state === 'sending' ? <Loader2 size={14} className="spin" /> : m.delivery.state === 'sent' ? <Check size={14} /> : m.delivery.state === 'local' ? <Laptop size={14} /> : <AlertTriangle size={14} />}{' '}
            <span>
              {m.delivery.state === 'held'
                ? 'Goes out in a few seconds (Undo is still possible)'
                : m.delivery.state === 'sending'
                  ? 'Sending…'
                  : m.delivery.state === 'sent'
                    ? `Delivered ${relative(m.delivery.at)}`
                    : m.delivery.state === 'local'
                      ? `Held on this computer: a local sprint2go doesn’t send mail to outside addresses${m.delivery.kept?.length ? ` (${m.delivery.kept.join(', ')})` : ''}.`
                      : `Could not be delivered: ${m.delivery.error ?? 'the receiving server refused it'}`}
            </span>
          </div>
        )}
        {open && props.blockTrackers && m.trackersBlocked ? (
          <div className="blocked-note">
            <ShieldCheck size={14} /> Blocked {m.trackersBlocked} tracker{m.trackersBlocked > 1 ? 's' : ''}, so the sender can’t see when you read this
          </div>
        ) : null}
        {open && (
          <div className="message-body">
            {m.invite && props.inviteCard && <div className="mi-wrap">{props.inviteCard(m)}</div>}
            <CodeCard text={`${thread.subject}\n${m.body}`} />
            {m.html ? <div className="prose" dangerouslySetInnerHTML={{ __html: sanitize(m.html) }} /> : m.body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
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
                        <div className="file-name">
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noreferrer" download={a.name}>
                              {a.name}
                            </a>
                          ) : (
                            a.name
                          )}
                        </div>
                        <div className="file-size">{a.size}</div>
                      </div>
                      <button className={`att-save ${saved ? 'saved' : ''}`} disabled={saved} onClick={() => props.onSaveToDrive(thread.id, a)} title={saved ? 'Saved to Drive' : 'Save to Drive'} aria-label={saved ? 'Saved to Drive' : `Save ${a.name} to Drive`}>
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
  };

  const quick = canReply && (
    <div className="smart-replies">
      <span>
        <Sparkles size={13} /> Quick replies
      </span>
      {!suggestions &&
        QUICK_REPLIES.map((sug, i) => (
          <button key={sug} className="tpl" style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (props.signature ? `<p><br></p>${props.signature}` : ''))}>
            {sug}
          </button>
        ))}
      {!suggestions && props.aiOn && (
        <button className="ai-suggest" onClick={suggest} disabled={suggesting} title="Uses AI only when you click. Saved, so it’s free next time">
          <Sparkles size={13} /> {suggesting ? 'Thinking…' : 'Suggest replies'}
        </button>
      )}
      {suggestions?.map((sug, i) => (
        <button key={i} style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (props.signature ? `<p><br></p>${props.signature}` : ''))}>
          {sug.split('\n')[0]}
        </button>
      ))}
    </div>
  );

  const content: ReactNode = (
    <div className="reader-scroll" key={thread.id}>
      <div className="reader-in">
        <div className="thread-head">
          <h2>{thread.subject}</h2>
          <div className="thread-labels">
            {props.client && (
              <button className="chip client-chip" style={{ ['--c' as string]: props.client.color }} onClick={() => props.onClient?.(props.client!.id)} title={`Open the ${term.one} page`}>
                {props.client.name}
              </button>
            )}
            {props.shared && (
              <button type="button" className={`th-who${assignee ? ' on' : ''}`} onClick={() => setAssignOpen(true)}>
                {assignee ? <Avatar person={assignee} size={18} /> : <UserPlus size={14} />}
                {assignee ? (assignee.id === props.meUser.id ? 'You handle this' : `${assignee.name.split(' ')[0]} handles this`) : 'Nobody handles this yet'}
              </button>
            )}
            {snoozed && (
              <span className="th-when">
                <Clock size={13} /> Back {whenWords(new Date(thread.snoozedUntil!))}
                {thread.snoozeIfNoReply ? ' if nobody replies' : ''}
              </span>
            )}
            <span className="thread-count">
              {n} message{n > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {(props.aiOn || props.onMakeTask || props.todos.length > 0) && (
          <div className="ai-bar">
            {props.aiOn && (
              <button className={`ai-sum${summary && summary !== 'loading' ? ' has' : ''}${summaryOpen ? ' open' : ''}`} onClick={summarize} aria-expanded={summary && summary !== 'loading' ? summaryOpen : undefined}>
                {summary === 'loading' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                <span>{summary === 'loading' ? 'Reading the conversation…' : summary ? firstLine(summary.summary) : 'Summarize in one line'}</span>
                {summary && summary !== 'loading' && <ChevronDown size={15} className={`rot-chev${summaryOpen ? ' open' : ''}`} />}
              </button>
            )}
            {props.onMakeTask && (
              <button className="ai-chip" onClick={() => props.onMakeTask!(thread.id)}>
                <ListPlus size={13} /> Make a task
              </button>
            )}
            {props.todos.length > 0 && (
              <button className="ai-chip todo" onClick={props.onOpenTodos}>
                <ListChecks size={13} /> {props.todos.filter((t) => !t.done).length || '✓'} to-do{props.todos.length > 1 ? 's' : ''} from this email
              </button>
            )}
          </div>
        )}

        <SmoothHeight>
          {summary && summary !== 'loading' && summaryOpen && (
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
        </SmoothHeight>

        {isList &&
          incoming &&
          (() => {
            const stillSending = props.unsubscribedAt && incoming.date > props.unsubscribedAt;
            return (
              <div className={`list-banner ${stillSending ? 'warn' : ''}`}>
                <MailMinus size={16} />
                <span>{stillSending ? `${incoming.from.name} is still emailing you after you unsubscribed.` : props.unsubscribedAt ? `You unsubscribed from ${incoming.from.name} ${relative(props.unsubscribedAt)}.` : `Mailing list from ${incoming.from.name}`}</span>
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
                {new Date(thread.invite.start).toLocaleDateString([], { weekday: 'long' })} · {fmtTime(thread.invite.start)} to {fmtTime(thread.invite.end)}
                {thread.invite.location && ` · ${thread.invite.location}`}
              </div>
              <div className={`invite-status ${props.inviteConflicts.length && !props.inviteAdded ? 'warn' : ''}`}>
                {props.inviteAdded ? 'On your calendar' : props.inviteConflicts.length ? `Overlaps with “${props.inviteConflicts[0].title}”` : 'You’re free at this time'}
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
          {items.map((x) => {
            const at = x.kind === 'm' ? x.m.date : x.n.at;
            if (hidden.includes(x)) {
              // The fold sits where the first hidden item was.
              return hidden[0] === x ? (
                <button key="fold" type="button" className="msg-fold" onClick={() => setShowAll(true)}>
                  <span>{hiddenMsgs} earlier message{hiddenMsgs === 1 ? '' : 's'}</span>
                </button>
              ) : null;
            }
            return x.kind === 'm' ? message(x.m) : <MailComment key={x.n.id + at} note={x.n} people={people} meId={props.meUser.id} />;
          })}
        </div>

        {phone ? (
          quick
        ) : (
          <SmoothHeight>
            <TabPane key={String(replyOpen)}>
              {replyOpen ? (
                <div className="reply-box">
                  <div className="reply-to">
                    <Reply size={14} /> Replying to <strong>{replyTo.name}</strong>
                  </div>
                  <div onKeyDown={(e) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.tb-popup') && setReplyOpen(false)}>
                    <RichEditor autoFocus initialHtml={replyInitial ?? draft?.html ?? (props.signature ? `<p><br></p>${props.signature}` : '')} placeholder="Write your reply…" onChange={(html, text) => (setReply({ html, text }), REPLY_DRAFTS.set(thread.id, { html, text }))} onSubmit={send} />
                  </div>
                  <div className="reply-actions">
                    {props.canTrack && replyOutside.length > 0 && (
                      <button
                        type="button"
                        className={`track-toggle ${replyTracked ? 'on' : ''}`}
                        aria-pressed={replyTracked}
                        aria-label="Read tracking"
                        onClick={() => setReplyTrack(!replyTracked)}
                        title={
                          replyTracked
                            ? `${replyOutside.length === 1 ? `${replyOutside[0].name || replyOutside[0].email}’s copy gets` : 'Each person outside the team gets a copy with'} an invisible picture and links that pass through ${product.name}, so you see when it’s opened and which links are clicked. Apple Mail can load pictures by itself, so treat opens as a hint.`
                            : 'Not tracked. Turn on to see when they open your reply and which links they click.'
                        }
                      >
                        {replyTracked ? <Eye size={15} /> : <EyeOff size={15} />}
                        <span>{replyTracked ? 'Tracking' : 'Not tracked'}</span>
                      </button>
                    )}
                    <button
                      className="ghost-btn"
                      onClick={() => {
                        setReplyOpen(false);
                        setReplyInitial(null);
                        REPLY_DRAFTS.delete(thread.id);
                      }}
                    >
                      Discard
                    </button>
                    <button
                      className="primary-btn"
                      onClick={() => {
                        send();
                        REPLY_DRAFTS.delete(thread.id);
                      }}
                      disabled={!hasOwnText(reply.text, props.signature)}
                    >
                      <Send size={15} /> Send <kbd>⌘↵</kbd>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {quick}
                  <div className="reply-buttons">
                    <button className={`ghost-btn outline ${props.replyOff ? 'off' : ''}`} aria-disabled={props.replyOff ? true : undefined} title={props.replyOff} onClick={() => startReply()}>
                      <Reply size={15} /> {draft ? 'Reply (draft)' : 'Reply'} <kbd>R</kbd>
                    </button>
                    <button className={`ghost-btn outline ${props.replyOff ? 'off' : ''}`} aria-disabled={props.replyOff ? true : undefined} title={props.replyOff} onClick={() => (props.replyOff ? props.onReplyOff?.() : props.onForward(thread))}>
                      <Forward size={15} /> Forward
                    </button>
                  </div>
                </>
              )}
            </TabPane>
          </SmoothHeight>
        )}
        {props.team && !phone && <CommentBox people={people.filter((u) => u.id !== props.meUser.id)} onPost={(text) => props.onComment(thread.id, text)} />}
        <div ref={endRef} />
      </div>
    </div>
  );

  const pickers = (
    <>
      <SnoozePicker key={`snooze:${thread.id}`} open={snoozeOpen} onClose={() => setSnoozeOpen(false)} anchor={phone ? undefined : snoozeBtn} waiting={isMine(last.from.email)} onPick={(until, ifNoReply) => props.onSnooze(thread.id, until, ifNoReply)} />
      <AssignPicker open={assignOpen} onClose={() => setAssignOpen(false)} anchor={phone ? undefined : assignBtn} people={props.teammates} me={props.meUser} current={thread.assignee} presence={props.presence} onPick={(id) => props.onAssign(thread.id, id)} />
      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={thread.subject} anchor={phone ? undefined : moreBtn} actions={moreOpen ? moreActions() : []} />
    </>
  );

  if (phone) {
    const PrimaryIcon = primary?.icon;
    return (
      <PushScreen
        title=""
        backLabel={props.backLabel}
        onBack={props.onBack}
        className="mail-reader"
        actions={
          <>
            {avatars && (props.shared ? <button type="button" className="rp-btn" onClick={() => setAssignOpen(true)} aria-label="Who handles this">{avatars}</button> : avatars)}
            {nav}
          </>
        }
        footer={
          <div className={`reader-foot${commenting ? ' commenting' : ''}`}>
            {props.team && <CommentBox bar people={people.filter((u) => u.id !== props.meUser.id)} onPost={(text) => props.onComment(thread.id, text)} onFocusChange={setCommenting} />}
            <nav className="reader-actions" aria-label="Actions for this email">
              {primary && PrimaryIcon && (
                <button type="button" onClick={primary.run}>
                  <PrimaryIcon size={21} />
                  <span>{primary.label}</span>
                </button>
              )}
              <button type="button" className={props.replyOff ? 'off' : ''} aria-disabled={props.replyOff ? true : undefined} onClick={() => startReply()}>
                <span className="ra-icon">
                  <Reply size={21} />
                  {draft && <i className="ra-dot" aria-label="Draft" />}
                </span>
                <span>{draft ? 'Draft' : 'Reply'}</span>
              </button>
              {thread.location !== 'drafts' && thread.location !== 'trash' && (
                <button type="button" onClick={() => setSnoozeOpen(true)}>
                  <Clock size={21} />
                  <span>Snooze</span>
                </button>
              )}
              {props.shared && (
                <button type="button" onClick={() => setAssignOpen(true)}>
                  {assignee ? <Avatar person={assignee} size={22} /> : <UserPlus size={21} />}
                  <span>Assign</span>
                </button>
              )}
              <button type="button" onClick={() => setMoreOpen(true)}>
                <MoreHorizontal size={21} />
                <span>More</span>
              </button>
            </nav>
          </div>
        }
      >
        {content}
        {pickers}
        {replyOpen && (
          <QuickReply
            key={thread.id}
            to={replyTo}
            initialHtml={replyInitial ?? draft?.html ?? (props.signature ? `<p><br></p>${props.signature}` : '')}
            signature={props.signature}
            userId={props.meUser.id}
            track={props.canTrack && replyOutside.length > 0 ? { on: replyTracked, set: setReplyTrack } : null}
            onSend={(html, text) => props.onReply(thread.id, html, text, replyTracked)}
            onKeep={(d) => {
              if (d) REPLY_DRAFTS.set(thread.id, d);
              else REPLY_DRAFTS.delete(thread.id);
              setDraftTick((x) => x + 1);
            }}
            onClose={() => (setReplyOpen(false), setReplyInitial(null))}
          />
        )}
      </PushScreen>
    );
  }

  return (
    <section className="reader">
      <header className="reader-bar">
        <button className="icon-btn back-btn" onClick={props.onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="toolbar">
          {primary && (
            <button className="icon-btn rb-labelled" onClick={primary.run} title={primary.title}>
              {thread.location === 'inbox' ? <Archive size={17} /> : <primary.icon size={17} />}
              <span>{primary.label}</span>
            </button>
          )}
          {thread.location !== 'drafts' && thread.location !== 'trash' && (
            <button ref={snoozeBtn} className="icon-btn rb-labelled" onClick={() => setSnoozeOpen(true)} title="Snooze">
              <Clock size={17} />
              <span>Snooze</span>
            </button>
          )}
          {props.shared && (
            <button ref={assignBtn} className="icon-btn rb-labelled" onClick={() => setAssignOpen(true)} title="Who handles this">
              {assignee ? <Avatar person={assignee} size={20} /> : <UserPlus size={17} />}
              <span>{assignee ? (assignee.id === props.meUser.id ? 'You' : assignee.name.split(' ')[0]) : 'Assign'}</span>
            </button>
          )}
          <span className="divider" />
          <button className="icon-btn" onClick={() => props.onTrash(thread.id)} title="Delete (#)" aria-label="Delete">
            <Trash2 size={17} />
          </button>
          <button className="icon-btn" onClick={() => props.onMarkUnread(thread.id)} title="Mark unread (U)" aria-label="Mark unread">
            <Mail size={17} />
          </button>
          <button className={`icon-btn ${thread.starred ? 'starred' : ''}`} onClick={() => props.onStar(thread.id)} title="Star (S)" aria-label={thread.starred ? 'Unstar' : 'Star'}>
            <Star size={17} />
          </button>
          <button ref={moreBtn} className="icon-btn" onClick={() => setMoreOpen(true)} title="More" aria-label="More actions">
            <MoreHorizontal size={17} />
          </button>
        </div>
        <span className="reader-bar-end">
          {avatars && (props.shared ? <button type="button" className="rp-btn" onClick={() => setAssignOpen(true)} aria-label="Who handles this">{avatars}</button> : avatars)}
          {nav}
        </span>
      </header>
      {content}
      {pickers}
    </section>
  );
}

/** Verification emails: the code, big, with Copy (that's usually why a throwaway address exists). */
function CodeCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  // The number right after "code" (or kode, OTP, PIN), so dates and prices in the email aren't mistaken for it.
  const code = text.match(/\b(?:code|kode|OTP|PIN)\b[^0-9\n]{0,40}?\b(\d{4,8}|\d{3}[- ]\d{3})\b/i)?.[1];
  if (!code) return null;
  return (
    <div className="code-card">
      <span>
        <small>Code in this email</small>
        <b>{code}</b>
      </span>
      <button className="ghost-btn sm outline" onClick={() => void navigator.clipboard?.writeText(code).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
        {copied ? 'Copied' : 'Copy code'}
      </button>
    </div>
  );
}
