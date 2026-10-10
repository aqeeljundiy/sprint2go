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
  MoreVertical,
  MessageSquare,
  Reply,
  ReplyAll,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  X,
  Download,
  Share2,
  Image as ImageIcon,
} from 'lucide-react';
import type { CalEvent, Message, Person, Thread, User, Client } from '../types';
import { fmtTimeRange } from '../calendarUtils';
import { fullDate, relative, snippet } from '../utils';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';
import { RichEditor } from './RichEditor';
import { TrackingPanel } from './TrackingPanel';
import { isMine } from '../identity';
import { isTeam } from '../tracking';
import { hasOwnText, textToHtml } from '../sanitize';
import { ai, type Summary } from '../ai';
import type { Todo } from '../types';
import type { Attachment } from '../types';
import { PushScreen } from './ui/PushScreen';
import { ActionSheet, useActionMenu, type SheetAction } from './ui/ActionSheet';
import { usePhone } from '../mobile/media';
import { AssignPicker, SnoozePicker, type PresenceOf } from './mail/MailPickers';
import { CommentBox, MailComment } from './mail/Comments';
import { QuickReply } from './mail/QuickReply';
import { quickReplies } from './mail/Templates';
import { participantsOf, whenWords } from '../mailRules';
import { t, tn, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtDate } from '../i18n/format';
// Gmail's reading extras (src/components/mail/): HTML as sent, show original, print, translate, message-level actions,
// Reply all and editing a reply's people and subject.
import { MailBody, type Translation } from './mail/MailBody';
import { OriginalSheet, downloadEml, printMail, translateText } from './mail/MessageTools';
import { ReplyHead } from './mail/ReplyHead';
import { canReplyAll, replyPeople } from '../mailPeople';
import type { ReplyOpts } from './mail/composeExtras';
import { Code2, Languages, Printer } from 'lucide-react';
import { defaultSpell, type SpellLang } from './mail/composeExtras';
import { suggestNext } from './mail/smartCompose';
import { usePersisted } from '../settings';

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
  /** `track`: the reply box's tracking switch was on (only offered when the company allows it, for outside people). `opts`: the people or subject the reply box changed. */
  onReply: (id: string, html: string, text: string, track: boolean, all?: boolean, opts?: ReplyOpts) => void;
  /** Forward the conversation's last message, or this one. */
  onForward: (t: Thread, m?: Message) => void;
  /** A reply moved into the full compose window, with what the reply box held. */
  onPopOut?: (threadId: string, draft: { to: Person[]; cc: Person[]; subject: string; html: string; text: string }) => void;
  /** The signature for an address (Settings, Mail), and the address of this mailbox a conversation goes out from. */
  signatureFor?: (address: string) => string;
  replyAddress?: (t: Thread) => string | undefined;
  /** What Reply and R do: answer the sender, or everyone (Settings, Mail). */
  defaultReply?: 'reply' | 'all';
  /** Smart compose in replies (Settings, Mail). */
  smartCompose?: boolean;
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
  // The signature of the address replies go out from (an alias has its own; Settings, Mail).
  const sigAddress = thread ? props.replyAddress?.(thread) : undefined;
  const signature = sigAddress && props.signatureFor ? props.signatureFor(sigAddress) : props.signature;
  const phone = usePhone();
  const [translations, setTranslations] = useState<Map<string, Translation>>(new Map());
  const [original, setOriginal] = useState<string | null>(null); // the message whose source is open
  // The desktop reply box: its people and subject when changed (null: Gmail's), and which fields are open.
  const [rPeople, setRPeople] = useState<{ to: Person[]; cc: Person[] } | null>(null);
  const [rSubject, setRSubject] = useState<string | null>(null);
  const [spell] = usePersisted<SpellLang | ''>('s2g-mail-spell', '');
  const spellLang: SpellLang = spell || defaultSpell();
  const nextWords = props.smartCompose === false ? undefined : (before: string) => suggestNext(before, { aiOn: props.aiOn, workspaceId: thread?.workspaceId ?? props.client?.workspaceId ?? '', subject: thread?.subject, me: props.myName, lang: spellLang === 'id' ? 'Indonesian' : undefined });
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
  const [replyAll, setReplyAll] = useState(false); // phones: the reply screen answers everyone
  const [details, setDetails] = useState<Set<string>>(new Set()); // phones: "to me ▾" opened on these messages
  const [msgMenu, setMsgMenu] = useState<{ m: Message; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const msgMenuBtn = useRef<HTMLElement | null>(null);
  const swipeBox = useRef<HTMLDivElement>(null);
  const [enterFrom, setEnterFrom] = useState<'' | 'left' | 'right'>(''); // the next or previous email slides in from that side
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
    setReplyAll(false);
    setDetails(new Set());
    setMsgMenu(null);
    setTranslations(new Map());
    setOriginal(null);
    setRPeople(null);
    setRSubject(null);
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
  const startReply = (initial?: string, all = false) => {
    if (props.replyOff) return props.onReplyOff?.();
    if (initial !== undefined) setReplyInitial(initial);
    if (phone) flushSync(() => (setReplyAll(all), setReplyOpen(true)));
    else {
      setReplyAll(all);
      setRPeople(null);
      setReplyOpen(true);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    }
  };
  /** Translate: the message in the reader's language (the company's AI); again to show the original. */
  const translate = async (m: Message) => {
    if (translations.has(m.id)) return setTranslations((x) => new Map([...x].filter(([k]) => k !== m.id)));
    const set = (v: Translation) => setTranslations((x) => new Map(x).set(m.id, v));
    if (!props.aiOn) return set('needs-ai');
    set('loading');
    try {
      set(await translateText(m.body || '', thread?.workspaceId ?? (props.client?.workspaceId ?? '')));
    } catch (e) {
      set(e instanceof Error && e.message === 'needs-ai' ? 'needs-ai' : 'failed');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' || !thread || e.metaKey || e.ctrlKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      startReply(undefined, props.defaultReply === 'all');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread, props.replyOff, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phones: swipe the email sideways for the next or previous one (Gmail). Starts away from the left edge, where the
  // swipe means Back; follows the finger and goes past 30% of the width.
  const goRef = useRef({ prev: props.prevId, next: props.nextId, go: props.onGo });
  goRef.current = { prev: props.prevId, next: props.nextId, go: props.onGo };
  useEffect(() => {
    const el = swipeBox.current;
    if (!phone || !el) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let state: '' | 'maybe' | 'drag' = '';
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      state = e.touches.length === 1 && p.clientX > 24 && !(e.target as Element).closest('.smart-replies, .gm-chiprow, pre, .prose table, input, textarea, [contenteditable]') ? 'maybe' : '';
      x0 = p.clientX;
      y0 = p.clientY;
      dx = 0;
    };
    const move = (e: TouchEvent) => {
      if (!state) return;
      const p = e.touches[0];
      const ddx = p.clientX - x0;
      if (state === 'maybe') {
        if (Math.abs(p.clientY - y0) > 10) return void (state = '');
        if (Math.abs(ddx) < 14) return;
        state = 'drag';
      }
      const { prev, next } = goRef.current;
      dx = ddx > 0 ? (prev ? ddx : ddx / 4) : next ? ddx : ddx / 4; // nothing that way: it gives a little, then springs back
      if (e.cancelable) e.preventDefault();
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      if (state !== 'drag') return void (state = '');
      state = '';
      const { prev, next, go } = goRef.current;
      const to = dx > el.offsetWidth * 0.3 ? prev : dx < -el.offsetWidth * 0.3 ? next : undefined;
      if (to) {
        el.style.transition = 'transform 0.18s cubic-bezier(0.4, 0, 1, 1)';
        el.style.transform = `translateX(${dx > 0 ? '100%' : '-100%'})`;
        setTimeout(() => {
          el.style.transition = 'none';
          el.style.transform = '';
          setEnterFrom(dx > 0 ? 'left' : 'right');
          go(to);
        }, 180);
      } else {
        el.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        el.style.transform = '';
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [phone, props.open, !!thread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phones: a conversation opens at its latest message (Gmail), its header just under the top bar.
  useEffect(() => {
    if (!phone || !props.open || !thread || thread.messages.length < 2) return;
    const id = requestAnimationFrame(() => {
      const all = document.querySelectorAll<HTMLElement>('.mail-reader:not(.is-leaving) .gm-msg.open');
      all[all.length - 1]?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [phone, props.open, thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <p className="empty-title">{t('Select a conversation')}</p>
        <p className="empty-sub">{tj('Use {j} {k} to move, {e} for done, {c} to compose.', { j: <kbd>J</kbd>, k: <kbd>K</kbd>, e: <kbd>E</kbd>, c: <kbd>C</kbd> })}</p>
      </section>
    );
  }
  if (phone && !props.open) return null;

  const last = thread.messages[thread.messages.length - 1];
  // Who the reply goes to: Gmail's rules (src/mailPeople.ts), or what the reply box changed them to.
  const gmailPeople = replyPeople(last, replyAll, isMine);
  const rWho = rPeople ?? gmailPeople;
  const reSubject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const canAllDesk = canReplyAll(last, isMine);
  // Only people outside the team can be tracked.
  const replyOutside = [...rWho.to, ...rWho.cc].filter((p) => !isTeam(p.email));
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
    if (!hasOwnText(reply.text, signature)) return;
    props.onReply(thread.id, reply.html, reply.text, replyTracked, replyAll, { ...(rPeople ? { to: rPeople.to, cc: rPeople.cc } : {}), ...(rSubject?.trim() ? { subject: rSubject.trim() } : {}) });
    setReply({ html: '', text: '' });
    setReplyOpen(false);
    setReplyInitial(null);
    setRPeople(null);
    setRSubject(null);
  };
  /** One message's own actions (Gmail's ⋮ on each message): reply, forward, print, the source, translate. */
  const confidentialIn = (m: Message) => !!m.confidential && !m.confidential.sender;
  const messageTools = (m: Message): SheetAction[] => [
    { label: t('Reply'), icon: Reply, disabled: !!props.replyOff, run: () => startReply() },
    ...(canAllDesk ? [{ label: t('Reply all'), icon: ReplyAll, disabled: !!props.replyOff, run: () => startReply(undefined, true) }] : []),
    { label: t('Forward'), icon: Forward, disabled: !!props.replyOff || confidentialIn(m), hint: confidentialIn(m) ? t('Confidential: it can’t be forwarded') : undefined, run: () => props.onForward(thread, m) },
    { label: t('Print'), icon: Printer, group: 'tools', disabled: confidentialIn(m), run: () => printMail(thread.id, m.id) },
    { label: t('Show original'), icon: Code2, group: 'tools', run: () => setOriginal(m.id) },
    { label: t('Download message'), icon: Download, group: 'tools', disabled: confidentialIn(m), run: () => downloadEml(thread.id, m.id) },
    ...(m.html || m.body ? [{ label: translations.has(m.id) ? t('Show original language') : t('Translate'), icon: Languages, group: 'tools', disabled: confidentialIn(m), run: () => void translate(m) }] : []),
    { label: t('Mark unread from here'), icon: Mail, group: 'mark', run: () => props.onMarkUnread(thread.id) },
  ];

  /** Done, or the way back for an email that isn't in the inbox. */
  const primary =
    thread.location === 'inbox'
      ? { label: t('Done'), icon: Check, run: () => props.onArchive(thread.id), title: t('Done (E): out of the inbox, into Archive') }
      : thread.location === 'drafts'
        ? null
        : { label: thread.location === 'spam' ? t('Not spam') : thread.location === 'trash' ? t('Restore') : t('Inbox'), icon: thread.location === 'trash' ? RotateCcw : Inbox, run: () => props.onMoveToInbox(thread.id), title: t('Move to Inbox') };

  const moreActions = (): SheetAction[] => [
    ...(phone ? [] : [{ label: t('Reply'), icon: Reply, run: () => startReply() }]),
    ...(phone || !canAllDesk ? [] : [{ label: t('Reply all'), icon: ReplyAll, run: () => startReply(undefined, true) }]),
    { label: t('Forward'), icon: Forward, disabled: !!props.replyOff, run: () => props.onForward(thread) },
    { label: t('Print all'), icon: Printer, run: () => printMail(thread.id) },
    ...(props.onMakeTask ? [{ label: tx('mail', 'Make a task'), icon: ListPlus, run: () => props.onMakeTask!(thread.id) }] : []),
    { label: t('Mark as unread'), icon: Mail, group: 'mark', run: () => props.onMarkUnread(thread.id) },
    { label: thread.starred ? t('Unstar') : t('Star'), icon: Star, group: 'mark', checked: thread.starred, run: () => props.onStar(thread.id) },
    ...(phone && props.shared ? [] : props.shared ? [{ label: t('Who handles this…'), icon: UserPlus, group: 'mark', run: () => setAssignOpen(true) }] : []),
    ...(thread.location !== 'spam' ? [{ label: t('Report spam'), icon: ShieldAlert, group: 'end', run: () => props.onSpam(thread.id) }] : []),
    ...(incoming ? [{ label: t('Block {name}', { name: incoming.from.name || incoming.from.email }), icon: Ban, group: 'end', run: () => props.onBlock(thread) }] : []),
    ...(thread.location !== 'trash' ? [{ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => props.onTrash(thread.id) }] : []),
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
    <span className="reader-people" title={onThread.map((u) => u.name).join(', ')} aria-label={t('On this conversation: {names}', { names: onThread.map((u) => u.name).join(', ') })}>
      {onThread.slice(0, 3).map((u) => (
        <Avatar key={u.id} person={u} size={24} />
      ))}
      {onThread.length > 3 && <i>+{onThread.length - 3}</i>}
    </span>
  );
  const nav = (
    <span className="reader-nav">
      <button type="button" className="icon-btn" disabled={!props.prevId} onClick={() => props.prevId && props.onGo(props.prevId)} aria-label={t('Previous email')} title={t('Previous (K)')}>
        <ChevronUp size={20} />
      </button>
      <button type="button" className="icon-btn" disabled={!props.nextId} onClick={() => props.nextId && props.onGo(props.nextId)} aria-label={t('Next email')} title={t('Next (J)')}>
        <ChevronDown size={20} />
      </button>
    </span>
  );

  const message = (m: Message) => {
    const open = expanded.has(m.id);
    return (
      <article key={m.id} className={`message ${open ? 'open' : ''}`}>
        {open && (
          <span className="msg-acts">
            <button type="button" className="icon-btn" onClick={() => startReply()} aria-label={t('Reply')} title={t('Reply')} disabled={!!props.replyOff}>
              <Reply size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => {
                msgMenuBtn.current = e.currentTarget;
                setMsgMenu({ m, anchor: msgMenuBtn });
              }}
              aria-label={t('More for this message')}
              title={t('More')}
            >
              <MoreVertical size={16} />
            </button>
          </span>
        )}
        <button className="message-head" onClick={() => toggle(m.id)} aria-expanded={open}>
          <Avatar person={m.from} size={phone ? 34 : 38} />
          <div className="message-who">
            <div className="message-from">
              <strong>{isMine(m.from.email) ? t('You') : m.from.name}</strong>
              {open && <span className="email">&lt;{m.from.email}&gt;</span>}
              {m.priority === 'high' && <span className="prio-chip">{t('High priority')}</span>}
            </div>
            <div className="message-to">
              {open
                ? [
                    t('to {names}', { names: m.to.map((p) => (isMine(p.email) ? t('me') : p.name || p.email)).join(', ') }),
                    m.cc?.length ? t('Cc {names}', { names: m.cc.map((p) => (isMine(p.email) ? t('me') : p.name || p.email)).join(', ') }) : '',
                    m.bcc?.length ? t('Bcc {names}', { names: m.bcc.map((p) => p.name || p.email).join(', ') }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : m.confidential && !m.confidential.sender
                  ? t('Confidential email')
                  : snippet(m.body)}
            </div>
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
                ? t('Goes out in a few seconds (Undo is still possible)')
                : m.delivery.state === 'sending'
                  ? t('Sending…')
                  : m.delivery.state === 'sent'
                    ? t('Delivered {when}', { when: relative(m.delivery.at) })
                    : m.delivery.state === 'local'
                      ? m.delivery.kept?.length
                        ? t('Held on this computer: a local sprint2go doesn’t send mail to outside addresses ({who}).', { who: m.delivery.kept.join(', ') })
                        : t('Held on this computer: a local sprint2go doesn’t send mail to outside addresses.')
                      : t('Could not be delivered: {why}', { why: m.delivery.error ?? t('the receiving server refused it') })}
            </span>
          </div>
        )}
        {open && props.blockTrackers && m.trackersBlocked ? (
          <div className="blocked-note">
            <ShieldCheck size={14} /> {tn(m.trackersBlocked, 'Blocked {n} tracker, so the sender can’t see when you read this', 'Blocked {n} trackers, so the sender can’t see when you read this')}
          </div>
        ) : null}
        {open && (
          <div className="message-body">
            {m.invite && props.inviteCard && <div className="mi-wrap">{props.inviteCard(m)}</div>}
            {!m.confidential && <CodeCard text={`${thread.subject}\n${m.body}`} />}
            <MailBody m={m} spam={thread.location === 'spam'} blockTrackers={props.blockTrackers} translation={translations.get(m.id)} onShowOriginalText={() => setTranslations((x) => new Map([...x].filter(([k]) => k !== m.id)))} />
            {m.attachments && m.attachments.some((a) => !a.cid) && (
              <div className="attachments">
                {m.attachments.filter((a) => !a.cid).map((a) => {
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
                      <button className={`att-save ${saved ? 'saved' : ''}`} disabled={saved} onClick={() => props.onSaveToDrive(thread.id, a)} title={saved ? t('Saved to Drive') : t('Save to Drive')} aria-label={saved ? t('Saved to Drive') : t('Save {name} to Drive', { name: a.name })}>
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
        <Sparkles size={13} /> {t('Quick replies')}
      </span>
      {!suggestions &&
        quickReplies().map((sug, i) => (
          <button key={sug} className="tpl" style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (signature ? `<p><br></p>${signature}` : ''))}>
            {sug}
          </button>
        ))}
      {!suggestions && props.aiOn && (
        <button className="ai-suggest" onClick={suggest} disabled={suggesting} title={t('Uses AI only when you click. Saved, so it’s free next time')}>
          <Sparkles size={13} /> {suggesting ? t('Thinking…') : t('Suggest replies')}
        </button>
      )}
      {suggestions?.map((sug, i) => (
        <button key={i} style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (signature ? `<p><br></p>${signature}` : ''))}>
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
              <button className="chip client-chip" style={{ ['--c' as string]: props.client.color }} onClick={() => props.onClient?.(props.client!.id)} title={t('Open the {project} page', { project: term.one })}>
                {props.client.name}
              </button>
            )}
            {props.shared && (
              <button type="button" className={`th-who${assignee ? ' on' : ''}`} onClick={() => setAssignOpen(true)}>
                {assignee ? <Avatar person={assignee} size={18} /> : <UserPlus size={14} />}
                {assignee ? (assignee.id === props.meUser.id ? t('You handle this') : t('{name} handles this', { name: assignee.name.split(' ')[0] })) : t('Nobody handles this yet')}
              </button>
            )}
            {snoozed && (
              <span className="th-when">
                <Clock size={13} /> {thread.snoozeIfNoReply ? t('Back {when} if nobody replies', { when: whenWords(new Date(thread.snoozedUntil!)) }) : t('Back {when}', { when: whenWords(new Date(thread.snoozedUntil!)) })}
              </span>
            )}
            <span className="thread-count">{tn(n, '{n} message', '{n} messages')}</span>
          </div>
        </div>

        {(props.aiOn || props.onMakeTask || props.todos.length > 0) && (
          <div className="ai-bar">
            {props.aiOn && (
              <button className={`ai-sum${summary && summary !== 'loading' ? ' has' : ''}${summaryOpen ? ' open' : ''}`} onClick={summarize} aria-expanded={summary && summary !== 'loading' ? summaryOpen : undefined}>
                {summary === 'loading' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                <span>{summary === 'loading' ? t('Reading the conversation…') : summary ? firstLine(summary.summary) : t('Summarize in one line')}</span>
                {summary && summary !== 'loading' && <ChevronDown size={15} className={`rot-chev${summaryOpen ? ' open' : ''}`} />}
              </button>
            )}
            {props.onMakeTask && (
              <button className="ai-chip" onClick={() => props.onMakeTask!(thread.id)}>
                <ListPlus size={13} /> {tx('mail', 'Make a task')}
              </button>
            )}
            {props.todos.length > 0 && (
              <button className="ai-chip todo" onClick={props.onOpenTodos}>
                <ListChecks size={13} />{' '}
                {props.todos.some((td) => !td.done)
                  ? tn(props.todos.filter((td) => !td.done).length, '{n} to-do from this email', '{n} to-dos from this email')
                  : tn(props.todos.length, '✓ To-do from this email', '✓ To-dos from this email')}
              </button>
            )}
          </div>
        )}

        <SmoothHeight>
          {summary && summary !== 'loading' && summaryOpen && (
            <div className="ai-summary">
              <div className="ais-label">
                <Sparkles size={13} /> {t('Summary')}
              </div>
              <p>{summary.summary}</p>
              {summary.asks.length > 0 && (
                <>
                  <div className="ais-label">{t('They’re asking you to')}</div>
                  <ul>
                    {summary.asks.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {props.todos.length > 0 && (
                <>
                  <div className="ais-label">{t('Your to-dos')}</div>
                  {props.todos.map((td) => (
                    <label key={td.id} className={`ais-todo ${td.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={td.done} onChange={() => props.onToggleTodo(td.id)} />
                      {td.title}
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
                <span>
                  {stillSending
                    ? t('{name} is still emailing you after you unsubscribed.', { name: incoming.from.name })
                    : props.unsubscribedAt
                      ? t('You unsubscribed from {name} {when}.', { name: incoming.from.name, when: relative(props.unsubscribedAt) })
                      : t('Mailing list from {name}', { name: incoming.from.name })}
                </span>
                {!props.unsubscribedAt && (
                  <button className="ghost-btn outline sm" onClick={() => props.onUnsubscribe(thread)}>
                    {t('Unsubscribe')}
                  </button>
                )}
                <button className={stillSending ? 'primary-btn sm' : 'ghost-btn sm'} onClick={() => props.onBlock(thread)}>
                  <Ban size={13} /> {t('Block')}
                </button>
              </div>
            );
          })()}

        {thread.invite && (
          <div className={`invite ${props.inviteAdded ? 'added' : ''}`}>
            <div className="invite-date">
              <span>{fmtDate(thread.invite.start, { month: 'short' })}</span>
              <strong>{new Date(thread.invite.start).getDate()}</strong>
            </div>
            <div className="invite-info">
              <div className="invite-kicker">{t('Meeting proposed in this email')}</div>
              <div className="invite-title">{thread.invite.title}</div>
              <div className="invite-when">
                {fmtDate(thread.invite.start, { weekday: 'long' })} · {fmtTimeRange(thread.invite.start, thread.invite.end)}
                {thread.invite.location && ` · ${thread.invite.location}`}
              </div>
              <div className={`invite-status ${props.inviteConflicts.length && !props.inviteAdded ? 'warn' : ''}`}>
                {props.inviteAdded ? t('On your calendar') : props.inviteConflicts.length ? t('Overlaps with “{title}”', { title: props.inviteConflicts[0].title }) : t('You’re free at this time')}
              </div>
            </div>
            {props.inviteAdded ? (
              <span className="invite-done">
                <CalendarCheck size={16} /> {t('Added')}
              </span>
            ) : (
              <button className="primary-btn" onClick={() => props.onAddInvite(thread.id)}>
                <CalendarPlus size={15} /> {t('Add to calendar')}
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
                  <span>{tn(hiddenMsgs, '{n} earlier message', '{n} earlier messages')}</span>
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
                  <ReplyHead
                    all={replyAll}
                    canAll={canAllDesk}
                    to={rWho.to}
                    cc={rWho.cc}
                    subject={rSubject ?? reSubject}
                    contacts={participantsOf(thread)}
                    onKind={(all) => (setReplyAll(all), setRPeople(null))}
                    onPeople={(to, cc) => setRPeople({ to, cc })}
                    onSubject={setRSubject}
                    onForward={() => (setReplyOpen(false), props.onForward(thread))}
                    onPopOut={
                      props.onPopOut
                        ? () => {
                            props.onPopOut!(thread.id, { to: rWho.to, cc: rWho.cc, subject: rSubject?.trim() || reSubject, html: reply.html || (replyInitial ?? draft?.html ?? ''), text: reply.text });
                            REPLY_DRAFTS.delete(thread.id);
                            setReplyOpen(false);
                            setReplyInitial(null);
                          }
                        : undefined
                    }
                  />
                  <div onKeyDown={(e) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.tb-popup, .recip') && setReplyOpen(false)}>
                    <RichEditor autoFocus initialHtml={replyInitial ?? draft?.html ?? (signature ? `<p><br></p>${signature}` : '')} placeholder={t('Write your reply…')} onChange={(html, text) => (setReply({ html, text }), REPLY_DRAFTS.set(thread.id, { html, text }))} onSubmit={send} spellLang={spellLang} suggest={nextWords} />
                  </div>
                  <div className="reply-actions">
                    {props.canTrack && replyOutside.length > 0 && (
                      <button
                        type="button"
                        className={`track-toggle ${replyTracked ? 'on' : ''}`}
                        aria-pressed={replyTracked}
                        aria-label={t('Read tracking')}
                        onClick={() => setReplyTrack(!replyTracked)}
                        title={
                          replyTracked
                            ? replyOutside.length === 1
                              ? t('{name}’s copy gets an invisible picture and links that pass through {product}, so you see when it’s opened and which links are clicked. Apple Mail can load pictures by itself, so treat opens as a hint.', { name: replyOutside[0].name || replyOutside[0].email, product: product.name })
                              : t('Each person outside the team gets a copy with an invisible picture and links that pass through {product}, so you see when it’s opened and which links are clicked. Apple Mail can load pictures by itself, so treat opens as a hint.', { product: product.name })
                            : t('Not tracked. Turn on to see when they open your reply and which links they click.')
                        }
                      >
                        {replyTracked ? <Eye size={15} /> : <EyeOff size={15} />}
                        <span>{replyTracked ? t('Tracking') : t('Not tracked')}</span>
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
                      {t('Discard')}
                    </button>
                    <button
                      className="primary-btn"
                      onClick={() => {
                        send();
                        REPLY_DRAFTS.delete(thread.id);
                      }}
                      disabled={!hasOwnText(reply.text, signature)}
                    >
                      <Send size={15} /> {t('Send')} <kbd>⌘↵</kbd>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {quick}
                  <div className="reply-buttons">
                    <button className={`ghost-btn outline ${props.replyOff ? 'off' : ''}`} aria-disabled={props.replyOff ? true : undefined} title={props.replyOff} onClick={() => startReply()}>
                      <Reply size={15} /> {draft ? t('Reply (draft)') : t('Reply')} {props.defaultReply !== 'all' && <kbd>R</kbd>}
                    </button>
                    {canAllDesk && (
                      <button className={`ghost-btn outline ${props.replyOff ? 'off' : ''}`} aria-disabled={props.replyOff ? true : undefined} title={props.replyOff} onClick={() => startReply(undefined, true)}>
                        <ReplyAll size={15} /> {t('Reply all')} {props.defaultReply === 'all' && <kbd>R</kbd>}
                      </button>
                    )}
                    <button className={`ghost-btn outline ${props.replyOff ? 'off' : ''}`} aria-disabled={props.replyOff ? true : undefined} title={props.replyOff} onClick={() => (props.replyOff ? props.onReplyOff?.() : props.onForward(thread))}>
                      <Forward size={15} /> {t('Forward')}
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
    // Gmail's reader: back and the actions at the top; the subject with its star and chips; each message with Reply and
    // ⋮ in its header; Reply, Reply all, Forward (and Comment for team mail) docked at the bottom.
    const canAll = canAllDesk;
    const PrimaryIcon = primary?.icon;
    const openTodos = props.todos.filter((td) => !td.done).length;
    const incomingLast = [...thread.messages].reverse().find((m) => !isMine(m.from.email));
    const phoneMore = (): SheetAction[] => [
      ...(thread.location !== 'drafts' && thread.location !== 'trash' ? [{ label: t('Snooze'), icon: Clock, run: () => setSnoozeOpen(true) }] : []),
      ...(props.shared ? [{ label: t('Who handles this…'), icon: UserPlus, run: () => setAssignOpen(true) }] : []),
      ...(props.onMakeTask ? [{ label: tx('mail', 'Make a task'), icon: ListPlus, run: () => props.onMakeTask!(thread.id) }] : []),
      ...(thread.invite && !props.inviteAdded ? [{ label: t('Add to calendar'), icon: CalendarPlus, run: () => props.onAddInvite(thread.id) }] : []),
      { label: t('Print all'), icon: Printer, run: () => printMail(thread.id) },
      ...(incoming ? [{ label: t('Block {name}', { name: incoming.from.name || incoming.from.email }), icon: Ban, group: 'end', run: () => props.onBlock(thread) }] : []),
      ...(thread.location !== 'spam' ? [{ label: t('Report spam'), icon: ShieldAlert, group: 'end', run: () => props.onSpam(thread.id) }] : []),
    ];
    // Gmail's ⋮ on each message: the same tools as on desktop, plus Make a task and Block.
    const messageMore = (m: Message): SheetAction[] => [
      ...messageTools(m).filter((a) => a.icon !== Reply),
      ...(props.onMakeTask ? [{ label: tx('mail', 'Make a task'), icon: ListPlus, group: 'mark', run: () => props.onMakeTask!(thread.id) }] : []),
      ...(!isMine(m.from.email) ? [{ label: t('Block {name}', { name: m.from.name || m.from.email }), icon: Ban, group: 'end', run: () => props.onBlock(thread) }] : []),
    ];
    const toWords = (m: Message) => {
      const names = [...m.to, ...(m.cc ?? [])].map((p) => (isMine(p.email) ? t('me') : p.name || p.email));
      return names.length > 2 ? t('to {names} and {n} more', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : t('to {names}', { names: names.join(', ') });
    };
    const isLatest = (m: Message) => m.id === last.id;

    const phoneMessage = (m: Message) => {
      const open = expanded.has(m.id);
      const who = isMine(m.from.email) ? t('You') : m.from.name || m.from.email;
      if (!open)
        return (
          <article key={m.id} className="message gm-msg">
            <button type="button" className="gm-msg-collapsed" onClick={() => toggle(m.id)} aria-expanded={false}>
              <Avatar person={m.from} size={40} />
              <span className="gm-msg-lines">
                <span className="gm-msg-l1">
                  <strong>{who}</strong>
                  <time title={fullDate(m.date)}>{relative(m.date)}</time>
                </span>
                <span className="gm-msg-snip">{snippet(m.body)}</span>
              </span>
            </button>
          </article>
        );
      const showDetails = details.has(m.id);
      return (
        <article key={m.id} className="message gm-msg open">
          <div className="gm-msg-head">
            <button type="button" className="gm-msg-av" onClick={() => toggle(m.id)} aria-label={t('Fold this message')} tabIndex={-1}>
              <Avatar person={m.from} size={40} />
            </button>
            <button type="button" className="gm-msg-name" onClick={() => toggle(m.id)} aria-expanded>
              <strong>{who}</strong>
              <time title={fullDate(m.date)}>{relative(m.date)}</time>
            </button>
            <button type="button" className="gm-msg-to" onClick={() => setDetails((d) => (d.has(m.id) ? new Set([...d].filter((x) => x !== m.id)) : new Set([...d, m.id])))} aria-expanded={showDetails}>
              <span>{toWords(m)}</span>
              <ChevronDown size={14} className={`rot-chev${showDetails ? ' open' : ''}`} />
            </button>
            <span className="gm-msg-acts">
              <button type="button" className="gm-icon" onClick={() => startReply()} aria-label={t('Reply')} title={t('Reply')}>
                <Reply size={20} />
              </button>
              <button
                type="button"
                className="gm-icon"
                onClick={(e) => {
                  msgMenuBtn.current = e.currentTarget;
                  setMsgMenu({ m, anchor: msgMenuBtn });
                }}
                aria-label={t('More for this message')}
                title={t('More')}
              >
                <MoreVertical size={20} />
              </button>
            </span>
          </div>
          <SmoothHeight>
            {showDetails && (
              <dl className="gm-msg-details">
                <dt>{tx('mail', 'From')}</dt>
                <dd>
                  {m.from.name} <span>{m.from.email}</span>
                </dd>
                <dt>{t('To')}</dt>
                <dd>{m.to.map((p) => `${p.name ? p.name + ' ' : ''}<${p.email}>`).join(', ')}</dd>
                {m.cc?.length ? (
                  <>
                    <dt>Cc</dt>
                    <dd>{m.cc.map((p) => `${p.name ? p.name + ' ' : ''}<${p.email}>`).join(', ')}</dd>
                  </>
                ) : null}
                {m.replyTo?.length ? (
                  <>
                    <dt>{t('Reply to')}</dt>
                    <dd>{m.replyTo.map((p) => p.email).join(', ')}</dd>
                  </>
                ) : null}
                {m.priority ? (
                  <>
                    <dt>{t('Priority')}</dt>
                    <dd>{m.priority === 'high' ? t('High') : t('Low')}</dd>
                  </>
                ) : null}
                {m.bcc?.length ? (
                  <>
                    <dt>Bcc</dt>
                    <dd>{m.bcc.map((p) => p.email).join(', ')}</dd>
                  </>
                ) : null}
                <dt>{t('Date')}</dt>
                <dd>{fullDate(m.date)}</dd>
              </dl>
            )}
          </SmoothHeight>
          {m.delivery && (
            <div className={`delivery-note ${m.delivery.state}`}>
              {m.delivery.state === 'held' ? <Clock size={14} /> : m.delivery.state === 'sending' ? <Loader2 size={14} className="spin" /> : m.delivery.state === 'sent' ? <Check size={14} /> : m.delivery.state === 'local' ? <Laptop size={14} /> : <AlertTriangle size={14} />}{' '}
              <span>
                {m.delivery.state === 'held'
                  ? t('Goes out in a few seconds (Undo is still possible)')
                  : m.delivery.state === 'sending'
                    ? t('Sending…')
                    : m.delivery.state === 'sent'
                      ? t('Delivered {when}', { when: relative(m.delivery.at) })
                      : m.delivery.state === 'local'
                        ? t('Held on this computer: a local sprint2go doesn’t send mail to outside addresses.')
                        : t('Could not be delivered: {why}', { why: m.delivery.error ?? t('the receiving server refused it') })}
              </span>
            </div>
          )}
          {props.blockTrackers && m.trackersBlocked ? (
            <div className="blocked-note">
              <ShieldCheck size={14} /> {tn(m.trackersBlocked, 'Blocked {n} tracker, so the sender can’t see when you read this', 'Blocked {n} trackers, so the sender can’t see when you read this')}
            </div>
          ) : null}
          <div className="message-body">
            {/* Cards that belong to this message sit inside it, above its words (Gmail). */}
            {isList && incomingLast?.id === m.id && listBanner}
            {isLatest(m) && proposed}
            {m.invite && props.inviteCard && <div className="mi-wrap">{props.inviteCard(m)}</div>}
            {!m.confidential && <CodeCard text={`${thread.subject}\n${m.body}`} />}
            <MailBody m={m} spam={thread.location === 'spam'} blockTrackers={props.blockTrackers} translation={translations.get(m.id)} onShowOriginalText={() => setTranslations((x) => new Map([...x].filter(([k]) => k !== m.id)))} />
            {m.attachments && m.attachments.some((a) => !a.cid) && (
              <div className="gm-atts">
                {m.attachments.length > 2 && (
                  <div className="gm-atts-head">
                    <span>{tn(m.attachments.length, '{n} attachment', '{n} attachments')}</span>
                    {m.attachments.some((a) => !props.savedToDrive(a.name)) && (
                      <button type="button" className="link-btn" onClick={() => m.attachments!.forEach((a) => !props.savedToDrive(a.name) && props.onSaveToDrive(thread.id, a))}>
                        {t('Save all to Drive')}
                      </button>
                    )}
                  </div>
                )}
                <div className="gm-att-row">
                  {m.attachments.filter((a) => !a.cid).map((a) => (
                    <AttachmentCard key={a.name} a={a} saved={props.savedToDrive(a.name)} onSave={() => props.onSaveToDrive(thread.id, a)} />
                  ))}
                </div>
              </div>
            )}
            {m.tracking && <TrackingPanel thread={thread} message={m} />}
          </div>
        </article>
      );
    };

    const listBanner =
      isList && incoming
        ? (() => {
            const stillSending = props.unsubscribedAt && incoming.date > props.unsubscribedAt;
            return (
              <div className={`list-banner ${stillSending ? 'warn' : ''}`}>
                <MailMinus size={16} />
                <span>
                  {stillSending
                    ? t('{name} is still emailing you after you unsubscribed.', { name: incoming.from.name })
                    : props.unsubscribedAt
                      ? t('You unsubscribed from {name} {when}.', { name: incoming.from.name, when: relative(props.unsubscribedAt) })
                      : t('Mailing list from {name}', { name: incoming.from.name })}
                </span>
                {!props.unsubscribedAt && (
                  <button className="link-btn" onClick={() => props.onUnsubscribe(thread)}>
                    {t('Unsubscribe')}
                  </button>
                )}
              </div>
            );
          })()
        : null;
    // A meeting proposed in the text (not a calendar invite): Gmail's quiet card with an outlined Add to calendar.
    const proposed = thread.invite ? (
      <div className={`invite gm-invite ${props.inviteAdded ? 'added' : ''}`}>
        <div className="invite-date">
          <span>{fmtDate(thread.invite.start, { month: 'short' })}</span>
          <strong>{new Date(thread.invite.start).getDate()}</strong>
        </div>
        <div className="invite-info">
          <div className="invite-title">{thread.invite.title}</div>
          <div className="invite-when">
            {fmtDate(thread.invite.start, { weekday: 'long' })} · {fmtTimeRange(thread.invite.start, thread.invite.end)}
            {thread.invite.location && ` · ${thread.invite.location}`}
          </div>
          <div className={`invite-status ${props.inviteConflicts.length && !props.inviteAdded ? 'warn' : ''}`}>
            {props.inviteAdded ? t('On your calendar') : props.inviteConflicts.length ? t('Overlaps with “{title}”', { title: props.inviteConflicts[0].title }) : t('You’re free at this time')}
          </div>
          {props.inviteAdded ? (
            <span className="invite-done">
              <CalendarCheck size={16} /> {t('Added')}
            </span>
          ) : (
            <button type="button" className="gm-pill" onClick={() => props.onAddInvite(thread.id)}>
              <CalendarPlus size={18} /> {t('Add to calendar')}
            </button>
          )}
        </div>
      </div>
    ) : null;

    const phoneContent = (
      <div className={`reader-scroll gm-reader${enterFrom ? ` enter-${enterFrom}` : ''}`} key={thread.id} onAnimationEnd={() => setEnterFrom('')}>
        <div className="reader-in">
          <div className="gm-subject">
            <h2>
              <span>{thread.subject}</span>
              {props.client && (
                <button type="button" className="gm-tag gm-tag-btn" style={{ ['--c' as string]: props.client.color }} onClick={() => props.onClient?.(props.client!.id)} title={t('Open the {project} page', { project: term.one })}>
                  {props.client.name}
                </button>
              )}
              {props.shared && (
                <button type="button" className={`gm-tag gm-tag-btn gm-who${assignee ? ' on' : ''}`} onClick={() => setAssignOpen(true)} aria-label={t('Who handles this')}>
                  {assignee ? <Avatar person={assignee} size={16} /> : <UserPlus size={12} />}
                  {assignee ? (assignee.id === props.meUser.id ? t('You') : assignee.name.split(' ')[0]) : t('Assign')}
                </button>
              )}
              {snoozed && (
                <span className="gm-tag gm-snoozed">
                  <Clock size={12} /> {thread.snoozeIfNoReply ? t('Back {when} if nobody replies', { when: whenWords(new Date(thread.snoozedUntil!)) }) : t('Back {when}', { when: whenWords(new Date(thread.snoozedUntil!)) })}
                </span>
              )}
            </h2>
            <button type="button" className={`gm-star${thread.starred ? ' on' : ''}`} onClick={() => props.onStar(thread.id)} aria-pressed={thread.starred} aria-label={thread.starred ? t('Unstar') : t('Star')}>
              <Star size={22} />
            </button>
          </div>

          {props.aiOn && (
            <div className="gm-chiprow">
              <button type="button" className={`gm-ai${summary && summary !== 'loading' ? ' has' : ''}`} onClick={summarize} aria-expanded={summary && summary !== 'loading' ? summaryOpen : undefined}>
                {summary === 'loading' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {summary === 'loading' ? t('Reading…') : summary ? t('Summary') : t('Summarize')}
                {summary && summary !== 'loading' && <ChevronDown size={14} className={`rot-chev${summaryOpen ? ' open' : ''}`} />}
              </button>
            </div>
          )}
          <SmoothHeight>
            {summary && summary !== 'loading' && summaryOpen && (
              <div className="ai-summary">
                <p>{summary.summary}</p>
                {summary.asks.length > 0 && (
                  <>
                    <div className="ais-label">{t('They’re asking you to')}</div>
                    <ul>
                      {summary.asks.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {props.todos.length > 0 && (
                  <>
                    <div className="ais-label">{t('Your to-dos')}</div>
                    {props.todos.map((td) => (
                      <label key={td.id} className={`ais-todo ${td.done ? 'done' : ''}`}>
                        <input type="checkbox" checked={td.done} onChange={() => props.onToggleTodo(td.id)} />
                        {td.title}
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </SmoothHeight>
          {props.todos.length > 0 && (
            <button type="button" className="gm-todos link-btn" onClick={props.onOpenTodos}>
              <ListChecks size={16} />
              {openTodos ? tn(openTodos, '{n} to-do from this email', '{n} to-dos from this email') : tn(props.todos.length, '✓ To-do from this email', '✓ To-dos from this email')}
            </button>
          )}

          <div className="messages">
            {items.map((x) => {
              const at = x.kind === 'm' ? x.m.date : x.n.at;
              if (hidden.includes(x)) {
                // Gmail's fold: a line across the thread with a circle that counts what's folded.
                return hidden[0] === x ? (
                  <button key="fold" type="button" className="msg-fold gm-fold" onClick={() => setShowAll(true)} aria-label={tn(hiddenMsgs, 'Show {n} earlier message', 'Show {n} earlier messages')}>
                    <span>{hiddenMsgs}</span>
                  </button>
                ) : null;
              }
              return x.kind === 'm' ? phoneMessage(x.m) : <MailComment key={x.n.id + at} note={x.n} people={people} meId={props.meUser.id} />;
            })}
          </div>

          {canReply && (
            <div className="smart-replies gm-smart">
              {!suggestions &&
                quickReplies().map((sug, i) => (
                  <button key={sug} className="tpl" style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (signature ? `<p><br></p>${signature}` : ''))}>
                    {sug}
                  </button>
                ))}
              {suggestions?.map((sug, i) => (
                <button key={i} style={{ ['--i' as string]: i }} onClick={() => startReply(textToHtml(sug) + (signature ? `<p><br></p>${signature}` : ''))}>
                  {sug.split('\n')[0]}
                </button>
              ))}
              {!suggestions && props.aiOn && (
                <button className="ai-suggest" onClick={suggest} disabled={suggesting} title={t('Uses AI only when you click. Saved, so it’s free next time')}>
                  <Sparkles size={16} /> {suggesting ? t('Thinking…') : t('Suggest replies')}
                </button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
    );

    return (
      <PushScreen
        title={thread.subject}
        backLabel={props.backLabel}
        iconBack
        onBack={props.onBack}
        className="mail-reader gm-reader-screen"
        actions={
          <>
            {props.shared && (
              <button type="button" className="icon-btn gm-assignee" onClick={() => setAssignOpen(true)} aria-label={assignee ? t('{name} handles this', { name: assignee.name }) : t('Who handles this')} title={t('Who handles this')}>
                {assignee ? <Avatar person={assignee} size={28} /> : <UserPlus size={22} />}
              </button>
            )}
            {primary && PrimaryIcon && (
              <button type="button" className="icon-btn" onClick={primary.run} aria-label={primary.label} title={primary.label}>
                <PrimaryIcon size={22} />
              </button>
            )}
            {thread.location !== 'trash' && (
              <button type="button" className="icon-btn" onClick={() => props.onTrash(thread.id)} aria-label={t('Delete')} title={t('Delete')}>
                <Trash2 size={22} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => props.onMarkUnread(thread.id)} aria-label={t('Mark as unread')} title={t('Mark as unread')}>
              <Mail size={22} />
            </button>
            <button type="button" ref={moreBtn} className="icon-btn" onClick={() => setMoreOpen(true)} aria-label={t('More actions')} title={t('More')}>
              <MoreVertical size={22} />
            </button>
          </>
        }
        footer={
          <div className={`gm-dock${commenting ? ' commenting' : ''}`}>
            {commenting ? (
              <div className="gm-dock-comment" key="comment">
                <CommentBox bar autoFocus people={people.filter((u) => u.id !== props.meUser.id)} onPost={(text) => (props.onComment(thread.id, text), setCommenting(false))} />
                <button type="button" className="gm-icon" onClick={() => setCommenting(false)} aria-label={t('Back to reply')}>
                  <X size={22} />
                </button>
              </div>
            ) : (
              <div className="gm-dock-row" key="reply">
                <button type="button" className={`gm-pill${props.replyOff ? ' off' : ''}`} aria-disabled={props.replyOff ? true : undefined} onClick={() => startReply()}>
                  <Reply size={18} />
                  {draft ? <span className="gm-draft">{t('Draft')}</span> : t('Reply')}
                </button>
                {canAll && (
                  <button type="button" className={`gm-pill${props.replyOff ? ' off' : ''}`} aria-disabled={props.replyOff ? true : undefined} onClick={() => startReply(undefined, true)}>
                    <ReplyAll size={18} />
                    {t('Reply all')}
                  </button>
                )}
                <button
                  type="button"
                  className={`gm-pill${props.replyOff ? ' off' : ''}${props.team && canAll ? ' gm-round' : ''}`}
                  aria-disabled={props.replyOff ? true : undefined}
                  aria-label={t('Forward')}
                  onClick={() => (props.replyOff ? props.onReplyOff?.() : props.onForward(thread))}
                >
                  <Forward size={18} />
                  <span className="gm-pill-word">{t('Forward')}</span>
                </button>
                {props.team && (
                  <button type="button" className="gm-pill gm-round gm-comment" onClick={() => setCommenting(true)} aria-label={t('Comment for the team')} title={t('Comment for the team')}>
                    <MessageSquare size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
        }
      >
        <div ref={swipeBox} className="gm-swipe-box">
          {phoneContent}
        </div>
        <SnoozePicker key={`snooze:${thread.id}`} open={snoozeOpen} onClose={() => setSnoozeOpen(false)} waiting={isMine(last.from.email)} onPick={(until, ifNoReply) => props.onSnooze(thread.id, until, ifNoReply)} />
        <AssignPicker open={assignOpen} onClose={() => setAssignOpen(false)} people={props.teammates} me={props.meUser} current={thread.assignee} presence={props.presence} onPick={(id) => props.onAssign(thread.id, id)} />
        <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={thread.subject} anchor={moreBtn} menu actions={moreOpen ? phoneMore() : []} />
        <ActionSheet open={!!msgMenu} onClose={() => setMsgMenu(null)} anchor={msgMenu?.anchor} menu actions={msgMenu ? messageMore(msgMenu.m) : []} />
        {original && <OriginalSheet threadId={thread.id} messageId={original} onClose={() => setOriginal(null)} />}
        {replyOpen && (
          <QuickReply
            key={thread.id}
            to={gmailPeople.to}
            cc={gmailPeople.cc}
            contacts={participantsOf(thread)}
            spellLang={spellLang}
            suggest={nextWords}
            all={replyAll}
            subject={thread.subject}
            initialHtml={replyInitial ?? draft?.html ?? (signature ? `<p><br></p>${signature}` : '')}
            signature={signature}
            userId={props.meUser.id}
            myName={props.myName}
            track={props.canTrack && replyOutside.length > 0 ? { on: replyTracked, set: setReplyTrack } : null}
            onSend={(html, text, opts) => props.onReply(thread.id, html, text, replyTracked, replyAll, opts)}
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
        <button className="icon-btn back-btn" onClick={props.onBack} aria-label={t('Back')}>
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
            <button ref={snoozeBtn} className="icon-btn rb-labelled" onClick={() => setSnoozeOpen(true)} title={t('Snooze')}>
              <Clock size={17} />
              <span>{t('Snooze')}</span>
            </button>
          )}
          {props.shared && (
            <button ref={assignBtn} className="icon-btn rb-labelled" onClick={() => setAssignOpen(true)} title={t('Who handles this')}>
              {assignee ? <Avatar person={assignee} size={20} /> : <UserPlus size={17} />}
              <span>{assignee ? (assignee.id === props.meUser.id ? t('You') : assignee.name.split(' ')[0]) : t('Assign')}</span>
            </button>
          )}
          <span className="divider" />
          <button className="icon-btn" onClick={() => props.onTrash(thread.id)} title={t('Delete (#)')} aria-label={t('Delete')}>
            <Trash2 size={17} />
          </button>
          <button className="icon-btn" onClick={() => props.onMarkUnread(thread.id)} title={t('Mark unread (U)')} aria-label={t('Mark unread')}>
            <Mail size={17} />
          </button>
          <button className={`icon-btn ${thread.starred ? 'starred' : ''}`} onClick={() => props.onStar(thread.id)} title={t('Star (S)')} aria-label={thread.starred ? t('Unstar') : t('Star')}>
            <Star size={17} />
          </button>
          <button ref={moreBtn} className="icon-btn" onClick={() => setMoreOpen(true)} title={t('More')} aria-label={t('More actions')}>
            <MoreHorizontal size={17} />
          </button>
        </div>
        <span className="reader-bar-end">
          {avatars && (props.shared ? <button type="button" className="rp-btn" onClick={() => setAssignOpen(true)} aria-label={t('Who handles this')}>{avatars}</button> : avatars)}
          {nav}
        </span>
      </header>
      {content}
      {pickers}
      <ActionSheet open={!!msgMenu} onClose={() => setMsgMenu(null)} anchor={msgMenu?.anchor} title={t('This message')} actions={msgMenu ? messageTools(msgMenu.m) : []} />
      {original && <OriginalSheet threadId={thread.id} messageId={original} onClose={() => setOriginal(null)} />}
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
        <small>{t('Code in this email')}</small>
        <b>{code}</b>
      </span>
      <button className="ghost-btn sm outline" onClick={() => void navigator.clipboard?.writeText(code).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
        {copied ? t('Copied') : t('Copy code')}
      </button>
    </div>
  );
}

/** A file in an email on phones: Gmail's card (a preview, then the name). Tap opens it; hold for Download, Save to Drive, Share. */
function AttachmentCard({ a, saved, onSave }: { a: Attachment; saved: boolean; onSave: () => void }) {
  const img = /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(a.name);
  const ext = (a.name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
  const self = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(
    () => [
      ...(a.url ? [{ label: t('Download'), icon: Download, run: () => void window.open(a.url, '_blank', 'noopener') }] : []),
      { label: saved ? t('Saved to Drive') : t('Save to Drive'), icon: saved ? Check : HardDriveUpload, disabled: saved, run: onSave },
      ...(a.url && typeof navigator !== 'undefined' && 'share' in navigator ? [{ label: t('Share'), icon: Share2, run: () => void navigator.share({ title: a.name, url: new URL(a.url!, location.href).href }).catch(() => {}) }] : []),
    ],
    { title: a.name },
  );
  const face = (
    <>
      <span className="gm-att-preview">{img && a.url ? <img src={a.url} alt="" loading="lazy" /> : <span className="gm-att-ext">{ext || <FileText size={28} />}</span>}</span>
      <span className="gm-att-name">
        {img ? <ImageIcon size={16} /> : <FileText size={16} />}
        <span>{a.name}</span>
      </span>
    </>
  );
  return (
    <>
      {a.url ? (
        <a className="gm-att lp" href={a.url} target="_blank" rel="noreferrer" title={`${a.name} · ${a.size}`} {...menu.bind}>
          {face}
        </a>
      ) : (
        <button type="button" ref={self} className="gm-att lp" title={`${a.name} · ${a.size}`} onClick={() => menu.openFrom(self)} {...menu.bind}>
          {face}
        </button>
      )}
      {menu.menu}
    </>
  );
}
