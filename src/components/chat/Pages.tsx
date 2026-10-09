import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Bookmark, CheckCheck, Clock, Hash, Lock, MessagesSquare, MoreHorizontal, PenLine, RotateCcw, SendHorizontal, SkipForward, Trash2, Undo2, X, Handshake, Send } from 'lucide-react';
import type { Channel, ChatMessage, User } from '../../types';
import { relative } from '../../utils';
import { toast, toastUndo } from '../../toast';
import { haptic, useLongPress } from '../ui/useLongPress';
import { PushScreen } from '../ui/PushScreen';
import { EmptyState } from '../ui/EmptyState';
import { TabPane } from '../ui/Smooth';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { Avatar } from '../Avatar';
import { ConfirmSheet, WhenSheet, chanName } from './Sheets';
import { authorOf, preview, Text } from './Message';
import { dmOther, followedThreads, readFallback, TILE_NAMES, useChatState, whenText, type ChatState, type SavedItem } from './chatPrefs';
import type { ChatPage } from '../ChatApp';

export interface PagesProps {
  page: ChatPage;
  phone: boolean;
  channels: Channel[]; // conversations I'm in
  messages: ChatMessage[]; // their messages
  users: User[];
  me: string;
  myFirst: string;
  onClose: () => void;
  /** Open a conversation, at a message (a reply opens its thread). */
  onOpen: (channelId: string, messageId?: string) => void;
  onSendTo: (channelId: string, text: string) => void;
  onSendNow: (id: string) => void;
  onReschedule: (id: string, at: string) => void;
  onDelete: (id: string) => void;
}

/** Catch up, Threads, Drafts and sent, Saved: full screen on phones, in the main area on wider screens. */
export function ChatPages(p: PagesProps) {
  const chat = useChatState(p.me);
  const title = TILE_NAMES[p.page];
  const body = (
    <TabPane key={p.page}>
      {p.page === 'catchup' ? <CatchUp {...p} chat={chat} /> : p.page === 'threads' ? <Threads {...p} chat={chat} /> : p.page === 'drafts' ? <DraftsSent {...p} chat={chat} /> : <Saved {...p} chat={chat} />}
    </TabPane>
  );
  if (p.phone)
    return (
      <PushScreen title={title} backLabel="Chat" onBack={p.onClose} className={`chat-page-push page-${p.page}`}>
        {body}
      </PushScreen>
    );
  return (
    <section className={`chat-pane chat-page view-enter page-${p.page}`}>
      <header className="chat-head">
        <div className="th-text">
          <h1>{title}</h1>
          <p>{p.page === 'catchup' ? 'Unread conversations, one at a time' : p.page === 'threads' ? 'Threads you started, replied in or were mentioned in' : p.page === 'drafts' ? 'What you started writing, what waits to be sent, and what you sent' : 'Messages you saved, and their reminders'}</p>
        </div>
        <button className="icon-btn sm" onClick={p.onClose} aria-label="Close" title="Close">
          <X size={16} />
        </button>
      </header>
      <div className="chat-page-body">{body}</div>
    </section>
  );
}

const nameOf = (p: PagesProps, channelId: string) => {
  const c = p.channels.find((x) => x.id === channelId);
  return c ? chanName(c, p.users, p.me) : 'A conversation you left';
};
const ChanIcon = ({ c, users, me, size = 16 }: { c?: Channel; users: User[]; me: string; size?: number }) => {
  if (!c) return <Hash size={size} />;
  if (c.kind === 'dm') {
    const u = users.find((x) => x.id === dmOther(c, me));
    return u ? <Avatar person={u} size={size + 6} /> : <Hash size={size} />;
  }
  return c.category === 'shared' ? <Handshake size={size} /> : c.private ? <Lock size={size} /> : <Hash size={size} />;
};

/* ---------------- Catch up: unread conversations, one card at a time ---------------- */

type Step = { id: string; kind: 'read' | 'skip'; before?: string };

function CatchUp(p: PagesProps & { chat: ChatState }) {
  const { chat } = p;
  // Taken when it opens: new messages don't reshuffle the cards (close and open it again for those).
  const [queue] = useState(() => {
    const at = new RegExp(`@${p.myFirst.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}\\b`, 'i');
    const fallback = readFallback();
    return p.channels
      .filter((c) => !chat.isMuted(c.id))
      .map((c) => {
        const since = chat.read[c.id] ?? fallback;
        const unread = p.messages.filter((m) => m.channelId === c.id && !m.sendAt && (!m.parentId || m.alsoInChannel) && m.userId !== p.me && m.kind !== 'celebration' && m.at > since).sort((a, b) => a.at.localeCompare(b.at));
        return { c, unread, since, mentions: unread.some((m) => at.test(m.text)) };
      })
      .filter((x) => x.unread.length)
      .sort((a, b) => Number(b.c.kind === 'dm' || b.mentions) - Number(a.c.kind === 'dm' || a.mentions) || b.unread[b.unread.length - 1].at.localeCompare(a.unread[a.unread.length - 1].at));
  });
  const [i, setI] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);
  const [fly, setFly] = useState<0 | 1 | -1>(0);
  const [reply, setReply] = useState('');
  const [allOpen, setAllOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const drag = useRef({ id: -1, x: 0, y: 0, lock: '' as '' | 'x' | 'y', t: 0 });
  const card = queue[i];
  const left = queue.length - i;

  const act = (kind: 'read' | 'skip') => {
    if (!card || fly) return;
    const before = chat.read[card.c.id];
    if (kind === 'read') chat.markRead(card.c.id);
    setSteps((s) => [...s, { id: card.c.id, kind, before }]);
    setFly(kind === 'read' ? 1 : -1);
    haptic(10);
    // The card leaves, then the next one comes up from under it.
    setTimeout(
      () => {
        setFly(0);
        setDx(0);
        setReply('');
        setI((n) => n + 1);
      },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200,
    );
  };
  const undo = () => {
    const last = steps[steps.length - 1];
    if (!last) return;
    if (last.kind === 'read') chat.setReadBack(last.id, last.before);
    setSteps((s) => s.slice(0, -1));
    setI((n) => Math.max(0, n - 1));
  };
  const markAll = () => {
    const rest = queue.slice(i);
    rest.forEach((x) => chat.markRead(x.c.id));
    setSteps((s) => [...s, ...rest.map((x) => ({ id: x.c.id, kind: 'read' as const, before: chat.read[x.c.id] }))]);
    setI(queue.length);
    toastUndo(`${rest.length} ${rest.length === 1 ? 'conversation' : 'conversations'} marked read`, () => {
      rest.forEach((x) => chat.setReadBack(x.c.id, chat.read[x.c.id] === undefined ? undefined : x.since));
      setI(i);
    });
  };
  const holdRead = useLongPress(() => left > 1 && setAllOpen(true), { disabled: left < 2 });

  // Arrow keys on a keyboard: right marks read, left skips, Z takes the last one back.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]') || document.querySelector('.sheet-scrim, .modal-scrim')) return;
      if (e.key === 'ArrowRight') act('read');
      else if (e.key === 'ArrowLeft') act('skip');
      else if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) undo();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (!queue.length)
    return <EmptyState icon={<CheckCheck size={22} />} title="You’re caught up" text="Nothing unread in your conversations. New messages show up here next time." action={<button className="ghost-btn" onClick={p.onClose}>Done</button>} />;
  if (!card)
    return (
      <div className="cu-done">
        <EmptyState icon={<CheckCheck size={22} />} title="That’s everything" text={`You went through ${queue.length} ${queue.length === 1 ? 'conversation' : 'conversations'}.`} action={<button className="primary-btn" onClick={p.onClose}>Done</button>} />
        {steps.length > 0 && (
          <button className="link-btn cu-undo-last" onClick={undo}>
            <Undo2 size={14} /> Undo the last one
          </button>
        )}
      </div>
    );

  const next = queue[i + 1];
  const shown = card.unread.slice(-5);
  const width = 360;
  const tilt = fly ? fly * 12 : dx / 24;
  return (
    <div className="cu-page">
      <div className="cu-top">
        <span className="muted">{left === 1 ? 'Last one' : `${left} left`}</span>
        <button className="link-btn" onClick={undo} disabled={!steps.length}>
          <Undo2 size={14} /> Undo
        </button>
      </div>
      <div className="cu-stack">
        {next && (
          <div className="cu-card under" aria-hidden="true">
            <CardHead c={next.c} n={next.unread.length} p={p} />
          </div>
        )}
        <div
          key={card.c.id}
          className={`cu-card${fly ? ' flying' : ''}${dx ? ' moving' : ''}`}
          style={{ transform: fly ? `translateX(${fly * 120}%) rotate(${tilt}deg)` : dx ? `translateX(${dx}px) rotate(${tilt}deg)` : undefined }}
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('input, button, a, textarea')) return;
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lock: '', t: performance.now() };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (e.pointerId !== d.id) return;
            const mx = e.clientX - d.x;
            const my = e.clientY - d.y;
            if (!d.lock) {
              if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
              d.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
              if (d.lock === 'x') e.currentTarget.setPointerCapture(e.pointerId);
            }
            if (d.lock === 'x') setDx(mx);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (e.pointerId !== d.id) return;
            d.id = -1;
            if (d.lock !== 'x') return;
            const speed = Math.abs(dx) / Math.max(1, performance.now() - d.t);
            if (Math.abs(dx) > width * 0.3 || speed > 0.8) act(dx > 0 ? 'read' : 'skip');
            else setDx(0);
          }}
          onPointerCancel={() => ((drag.current.id = -1), setDx(0))}
        >
          <span className={`cu-stamp read${dx > 40 ? ' on' : ''}`} aria-hidden>
            Read
          </span>
          <span className={`cu-stamp skip${dx < -40 ? ' on' : ''}`} aria-hidden>
            Skip
          </span>
          <button className="cu-open" onClick={() => p.onOpen(card.c.id)} aria-label={`Open ${nameOf(p, card.c.id)}`}>
            <CardHead c={card.c} n={card.unread.length} p={p} />
          </button>
          <div className="cu-msgs">
            {card.unread.length > shown.length && <p className="muted small cu-more">{card.unread.length - shown.length} earlier</p>}
            {shown.map((m) => {
              const a = authorOf(m, { me: p.me, users: p.users, channel: card.c });
              return (
                <div key={m.id} className="cu-msg">
                  {a.person ? <Avatar person={a.person} size={28} /> : <span className="cm-gutter" />}
                  <div>
                    <div className="cu-msg-head">
                      <strong>{a.name}</strong>
                      <time>{relative(m.at)}</time>
                    </div>
                    <div className="cm-text">{m.text ? <Text text={m.text} users={p.users} /> : preview(m)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="cu-reply"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              p.onSendTo(card.c.id, reply.trim());
              toast({ text: `Sent to ${nameOf(p, card.c.id)}` });
              act('read');
            }}
          >
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply to ${nameOf(p, card.c.id)}`} aria-label={`Reply to ${nameOf(p, card.c.id)}`} />
            <button className="ai-send chat-send" disabled={!reply.trim()} aria-label="Send reply">
              <ArrowUp size={16} />
            </button>
          </form>
        </div>
      </div>
      <div className="cu-actions">
        <button className="ghost-btn" onClick={() => act('skip')}>
          <SkipForward size={16} /> Skip
        </button>
        <button className="primary-btn lp" {...holdRead} onClick={() => act('read')} title={left > 1 ? 'Hold to mark everything read' : undefined}>
          <CheckCheck size={16} /> Mark read
        </button>
      </div>
      <p className="muted small cu-hint">{p.phone ? 'Swipe right to mark read, left to skip. Hold Mark read for all of them.' : 'Right arrow marks read, left arrow skips, Z undoes.'}</p>
      {allOpen && <ConfirmSheet title={`Mark all ${left} read?`} text="Every conversation left here is marked read. You can undo it straight after." yes="Mark all read" onYes={markAll} onClose={() => setAllOpen(false)} />}
    </div>
  );
}

function CardHead({ c, n, p }: { c: Channel; n: number; p: PagesProps }) {
  return (
    <span className="cu-head">
      <span className="cu-icon">
        <ChanIcon c={c} users={p.users} me={p.me} />
      </span>
      <strong>{chanName(c, p.users, p.me)}</strong>
      <span className="cu-count">{n} new</span>
    </span>
  );
}

/* ---------------- Threads you follow ---------------- */

function Threads(p: PagesProps & { chat: ChatState }) {
  const list = useMemo(() => followedThreads(p.messages, p.me, p.myFirst, p.chat), [p.messages, p.me, p.myFirst, p.chat.read]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return <EmptyState icon={<MessagesSquare size={22} />} title="No threads yet" text="Threads you start, reply in or are mentioned in show up here, with new replies on top." />;
  return (
    <div className="page-list">
      {list.map(({ root, replies, unread }) => {
        const c = p.channels.find((x) => x.id === root.channelId);
        const last = replies[replies.length - 1];
        const ctx = { me: p.me, users: p.users, channel: c ?? ({ id: root.channelId, members: [], kind: 'channel', name: '', workspaceId: '' } as Channel) };
        const draft = p.chat.drafts[`${root.channelId}/${root.id}`];
        return (
          <button key={root.id} className={`page-row${unread ? ' unread' : ''}`} onClick={() => p.onOpen(root.channelId, last.id)}>
            <span className="pr-where">
              <ChanIcon c={c} users={p.users} me={p.me} size={13} /> {nameOf(p, root.channelId)}
              <time>{relative(last.at)}</time>
            </span>
            <span className="pr-text">
              <b>{authorOf(root, ctx).first}:</b> {preview(root)}
            </span>
            <span className="pr-reply">
              <b>{authorOf(last, ctx).first}:</b> {preview(last)}
            </span>
            <span className="pr-meta">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              {unread ? <span className="count">{unread} new</span> : null}
              {draft && <span className="draft-pill">Draft</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Drafts, waiting to be sent, sent ---------------- */

function DraftsSent(p: PagesProps & { chat: ChatState }) {
  const { chat } = p;
  const waiting = p.messages.filter((m) => m.sendAt && m.userId === p.me).sort((a, b) => (a.sendAt ?? '').localeCompare(b.sendAt ?? ''));
  const drafts = Object.entries(chat.drafts)
    .map(([key, d]) => ({ key, ...d, channelId: key.split('/')[0], rootId: key.split('/')[1] }))
    .filter((d) => p.channels.some((c) => c.id === d.channelId))
    .sort((a, b) => b.at.localeCompare(a.at));
  const sent = p.messages
    .filter((m) => m.userId === p.me && !m.sendAt && !m.guestEmail && m.kind !== 'celebration' && m.kind !== 'system')
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);
  const [tab, setTab] = useState<'drafts' | 'scheduled' | 'sent'>(() => (waiting.length && !drafts.length ? 'scheduled' : 'drafts'));
  const [when, setWhen] = useState<ChatMessage | null>(null);
  const [del, setDel] = useState<ChatMessage | null>(null);
  return (
    <div className="drafts-page">
      <div className="segmented page-tabs" role="tablist">
        {(
          [
            ['drafts', 'Drafts'],
            ['scheduled', 'To send'],
            ['sent', 'Sent'],
          ] as const
        ).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {l}
          </button>
        ))}
      </div>
      <TabPane key={tab}>
        {tab === 'drafts' &&
          (drafts.length ? (
            <div className="page-list">
              {drafts.map((d) => (
                <ItemRow
                  key={d.key}
                  onOpen={() => p.onOpen(d.channelId, d.rootId)}
                  where={`${d.rootId ? 'Thread in ' : ''}${nameOf(p, d.channelId)}`}
                  c={p.channels.find((x) => x.id === d.channelId)}
                  p={p}
                  time={relative(d.at)}
                  text={d.text}
                  icon={<PenLine size={13} />}
                  actions={[{ label: 'Delete draft', icon: Trash2, danger: true, run: () => (chat.setDraft(d.key, ''), toastUndo('Draft deleted', () => chat.setDraft(d.key, d.text))) }]}
                />
              ))}
            </div>
          ) : (
            <EmptyState compact text="No drafts. Anything you start writing and leave stays here until you send it." />
          ))}
        {tab === 'scheduled' &&
          (waiting.length ? (
            <div className="page-list">
              {waiting.map((m) => (
                <ItemRow
                  key={m.id}
                  onOpen={() => p.onOpen(m.channelId)}
                  where={nameOf(p, m.channelId)}
                  c={p.channels.find((x) => x.id === m.channelId)}
                  p={p}
                  time={`Goes ${whenText(m.sendAt!)}`}
                  text={preview(m)}
                  icon={<Clock size={13} />}
                  buttons={
                    <>
                      <button className="ghost-btn sm" onClick={() => (p.onSendNow(m.id), toast({ text: `Sent to ${nameOf(p, m.channelId)}` }))}>
                        <Send size={14} /> Send now
                      </button>
                      <button className="ghost-btn sm" onClick={() => setWhen(m)}>
                        <Clock size={14} /> Change time
                      </button>
                    </>
                  }
                  actions={[
                    { label: 'Send now', icon: SendHorizontal, run: () => p.onSendNow(m.id) },
                    { label: 'Change time', icon: Clock, run: () => setWhen(m) },
                    { label: 'Delete', icon: Trash2, danger: true, run: () => setDel(m) },
                  ]}
                />
              ))}
            </div>
          ) : (
            <EmptyState compact text="Nothing waiting. Hold Send (or use its arrow) to send a message later." />
          ))}
        {tab === 'sent' &&
          (sent.length ? (
            <div className="page-list">
              {sent.map((m) => (
                <ItemRow key={m.id} onOpen={() => p.onOpen(m.channelId, m.id)} where={`${m.parentId ? 'Thread in ' : ''}${nameOf(p, m.channelId)}`} c={p.channels.find((x) => x.id === m.channelId)} p={p} time={relative(m.at)} text={preview(m)} />
              ))}
            </div>
          ) : (
            <EmptyState compact text="Nothing sent yet." />
          ))}
      </TabPane>
      {when && <WhenSheet title="Change when it goes" kind="send" onPick={(at) => (p.onReschedule(when.id, at), toast({ text: `Goes ${whenText(at)}` }))} onClose={() => setWhen(null)} />}
      {del && <ConfirmSheet title="Delete this message?" text="It won’t be sent. Nobody saw it yet." yes="Delete" onYes={() => p.onDelete(del.id)} onClose={() => setDel(null)} />}
    </div>
  );
}

/* ---------------- Saved messages ---------------- */

function Saved(p: PagesProps & { chat: ChatState }) {
  const { chat } = p;
  const [remind, setRemind] = useState<SavedItem | null>(null);
  if (!chat.saved.length) return <EmptyState icon={<Bookmark size={22} />} title="Nothing saved" text="Hold a message (or use its menu) and choose Save or Remind me. It waits here." />;
  const items = [...chat.saved].sort((a, b) => Number(!!b.remindAt && !b.reminded) - Number(!!a.remindAt && !a.reminded) || (a.remindAt ?? '').localeCompare(b.remindAt ?? '') || b.at.localeCompare(a.at));
  return (
    <div className="page-list">
      {items.map((s) => {
        const m = p.messages.find((x) => x.id === s.id);
        const c = p.channels.find((x) => x.id === s.channelId);
        const remove: SheetAction = { label: 'Remove from saved', icon: Trash2, danger: true, run: () => (chat.unsave(s.id), toastUndo('Removed from saved', () => chat.restoreSaved(s))) };
        if (!m)
          return <ItemRow key={s.id} where={nameOf(p, s.channelId)} c={c} p={p} time={relative(s.at)} text="This message isn’t here any more (deleted, or you left the conversation)." muted actions={[remove]} />;
        const a = authorOf(m, { me: p.me, users: p.users, channel: c ?? ({ id: s.channelId, members: [], kind: 'channel', name: '', workspaceId: '' } as Channel) });
        return (
          <ItemRow
            key={s.id}
            onOpen={() => p.onOpen(m.channelId, m.id)}
            where={nameOf(p, m.channelId)}
            c={c}
            p={p}
            time={s.remindAt && !s.reminded ? `Reminder ${whenText(s.remindAt)}` : s.reminded ? 'Reminded' : `Saved ${relative(s.at)}`}
            text={`${a.first}: ${preview(m)}`}
            icon={s.remindAt && !s.reminded ? <Clock size={13} /> : <Bookmark size={13} />}
            actions={[{ label: s.remindAt && !s.reminded ? 'Change reminder' : 'Remind me', icon: Clock, run: () => setRemind(s) }, ...(s.remindAt && !s.reminded ? [{ label: 'No reminder', icon: RotateCcw, run: () => chat.restoreSaved({ id: s.id, channelId: s.channelId, at: s.at }) }] : []), remove]}
          />
        );
      })}
      {remind && (
        <WhenSheet
          title="Remind me"
          kind="remind"
          onPick={(at) => (chat.restoreSaved({ id: remind.id, channelId: remind.channelId, at: remind.at, remindAt: at }), toast({ text: `You’ll be reminded ${whenText(at)}` }))}
          onClose={() => setRemind(null)}
        />
      )}
    </div>
  );
}

/** A row in these pages: where, when, what; tap opens it; long-press (or "…") for its actions. */
function ItemRow({ where, c, p, time, text, icon, onOpen, actions, buttons, muted }: { where: string; c?: Channel; p: PagesProps; time: string; text: string; icon?: ReactNode; onOpen?: () => void; actions?: SheetAction[]; buttons?: ReactNode; muted?: boolean }) {
  const more = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(actions ?? [], { title: where, disabled: !actions?.length });
  return (
    <div className={`page-item${muted ? ' muted' : ''}`}>
      <div className="pi-main">
        <button className={`page-row${p.phone ? ' lp' : ''}`} {...(p.phone ? menu.bind : { onContextMenu: menu.bind.onContextMenu })} onClick={onOpen} disabled={!onOpen && !actions?.length}>
          <span className="pr-where">
            <ChanIcon c={c} users={p.users} me={p.me} size={13} /> {where}
            <time>
              {icon} {time}
            </time>
          </span>
          <span className="pr-text">{text}</span>
        </button>
        {!p.phone && !!actions?.length && (
          <button ref={more} className="icon-btn sm pi-more" onClick={() => menu.openFrom(more)} aria-label="More">
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      {buttons && <div className="pr-actions">{buttons}</div>}
      {menu.menu}
    </div>
  );
}

