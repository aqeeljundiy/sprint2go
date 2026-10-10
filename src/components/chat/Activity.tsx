import { Fragment, useState } from 'react';
import { AtSign, Bell, BellOff, Bookmark, CheckCheck, Clock, MailOpen, MessageCircle, MessagesSquare, X } from 'lucide-react';
import type { Channel, ChatMessage, Notice, User } from '../../types';
import { usePersisted } from '../../settings';
import { Avatar } from '../Avatar';
import { EmptyState } from '../ui/EmptyState';
import { SwipeRow } from '../ui/SwipeRow';
import { useLeaving } from '../ui/Smooth';
import { useLongPress } from '../ui/useLongPress';
import { ActionSheet, type SheetAction } from '../ui/ActionSheet';
import { toast } from '../../toast';
import { preview } from './Message';
import { WhenSheet, chanName } from './Sheets';
import { shortTime, whenText, type ChatState } from './chatPrefs';
import { t, textOf } from '../../i18n';
import { followsThread, isGroupDm } from '../../chatFollow';

type Filter = 'all' | 'mentions' | 'threads' | 'unread';
type Kind = 'mention' | 'thread' | 'dm' | 'other';
type Item = { n: Notice; m?: ChatMessage; root?: ChatMessage; ch?: Channel; kind: Kind; who?: { name: string; email: string; color?: string } };

/**
 * Phones, Chat's Activity (Slack's third tab): mentions of you, replies in your threads and direct messages, newest
 * first. Tap opens the message in its conversation (or thread) and marks it read; hold for more; swipe left to clear.
 * Built from this company's chat notices, so it matches the notifications you get.
 */
export function ChatActivity({ notices, messages, channels, users, me, myFirst, chat, onOpen, onRead, onFollow }: { notices: Notice[]; messages: ChatMessage[]; channels: Channel[]; users: User[]; me: string; myFirst: string; chat: ChatState; onOpen: (n: Notice) => void; onRead: (ids: string[], read: boolean) => void; onFollow?: (rootId: string, on: boolean) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [cleared, setCleared] = usePersisted<string[]>(`s2g-chat-cleared:${me}`, []);
  const [menu, setMenu] = useState<{ it: Item; at: { x: number; y: number } } | null>(null);
  const [sub, setSub] = useState<{ kind: 'mute' | 'remind'; it: Item } | null>(null);
  const gone = new Set(cleared);
  const all: Item[] = notices
    .filter((n) => !gone.has(n.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((n) => {
      const ch0 = channels.find((c) => c.id === n.link?.id);
      // Older notices name only the conversation: the message is the last one there from someone else by then.
      const m = n.link?.msg ? messages.find((x) => x.id === n.link!.msg) : ch0 ? messages.filter((x) => x.channelId === ch0.id && x.userId !== me && !x.sendAt && x.at <= n.at && textOf(n).includes(preview(x).slice(0, 24))).sort((a, b) => b.at.localeCompare(a.at))[0] : undefined;
      const ch = channels.find((c) => c.id === (m?.channelId ?? n.link?.id));
      const root = m?.parentId ? messages.find((x) => x.id === m.parentId) : undefined;
      const kind: Kind = m?.parentId ? 'thread' : ch?.kind === 'dm' ? 'dm' : n.kind === 'mention' ? 'mention' : 'other';
      const u = m && !m.guestEmail ? users.find((x) => x.id === m.userId) : undefined;
      const g = m?.guestEmail ? ch?.guests?.find((x) => x.email === m.guestEmail) : undefined;
      const dmOther = !m && ch?.kind === 'dm' ? users.find((x) => x.id !== me && ch.members.includes(x.id)) : undefined;
      const who = u ?? (m?.guestEmail ? { name: g?.name ?? m.guestEmail, email: m.guestEmail } : dmOther);
      return { n, m, root, ch, kind, who };
    });
  const shown = all.filter((it) => (filter === 'mentions' ? it.kind === 'mention' : filter === 'threads' ? it.kind === 'thread' : filter === 'unread' ? !it.n.read : true));
  const rows = useLeaving(shown, (it) => it.n.id);

  const clear = (it: Item) => {
    const wasUnread = !it.n.read;
    setCleared((c) => [it.n.id, ...c].slice(0, 500));
    if (wasUnread) onRead([it.n.id], true);
    return () => {
      setCleared((c) => c.filter((x) => x !== it.n.id));
      if (wasUnread) onRead([it.n.id], false);
    };
  };
  const actions = (it: Item): SheetAction[] => {
    const list: SheetAction[] = [it.n.read ? { label: t('Mark unread'), icon: MailOpen, run: () => onRead([it.n.id], false) } : { label: t('Mark read'), icon: CheckCheck, run: () => onRead([it.n.id], true) }];
    if (it.ch) list.push(chat.isMuted(it.ch.id) ? { label: t('Unmute conversation'), icon: Bell, run: () => (chat.unmute(it.ch!.id), toast({ text: t('Notifications back on') })) } : { label: t('Mute conversation…'), icon: BellOff, run: () => setSub({ kind: 'mute', it }) });
    // A thread's notices come while you follow it (src/chatFollow.ts): stop them here, or start again.
    if (it.root && onFollow) {
      const on = followsThread(it.root, messages.filter((x) => x.parentId === it.root!.id && !x.sendAt), me, myFirst);
      list.push(on ? { label: t('Unfollow thread'), icon: BellOff, run: () => (onFollow(it.root!.id, false), toast({ text: t('You won’t be notified about new replies'), action: { label: t('Undo'), run: () => onFollow(it.root!.id, true) } })) } : { label: t('Follow thread'), icon: Bell, run: () => (onFollow(it.root!.id, true), toast({ text: t('You’ll be notified about new replies') })) });
    }
    if (it.m) {
      list.push({ label: t('Remind me'), icon: Clock, run: () => setSub({ kind: 'remind', it }) });
      list.push(chat.isSaved(it.m.id) ? { label: t('Remove from saved'), icon: Bookmark, run: () => chat.unsave(it.m!.id) } : { label: t('Save'), icon: Bookmark, run: () => (chat.save(it.m!), toast({ text: t('Saved') })) });
    }
    list.push({ label: t('Clear'), icon: X, group: 'end', run: () => toast({ text: t('Cleared'), action: { label: t('Undo'), run: clear(it) } }) });
    return list;
  };

  const chips: [Filter, string][] = [
    ['all', t('All')],
    ['mentions', t('Mentions')],
    ['threads', t('Threads')],
    ['unread', t('Unread')],
  ];
  return (
    <div className="act-feed">
      <div className="act-chips" role="group" aria-label={t('Show')}>
        {chips.map(([k, l]) => (
          <button key={k} type="button" className={`act-chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState className="act-empty" icon={<AtSign size={22} />} title={filter === 'unread' ? t('You’re all caught up') : t('Nothing here yet')} text={t('Mentions of you, replies in your threads and direct messages show up here.')} />
      ) : (
        <div className="act-list">
          {rows.map(({ item, leaving }) => (
            <SwipeRow key={item.n.id} leaving={leaving} className="act-swipe" end={[{ id: 'clear', label: t('Clear'), icon: X, tone: 'neutral', removes: true, done: t('Cleared'), run: () => clear(item) }]}>
              <ActivityRow it={item} users={users} me={me} myFirst={myFirst} onOpen={() => onOpen(item.n)} onMenu={(at) => setMenu({ it: item, at })} />
            </SwipeRow>
          ))}
        </div>
      )}
      {menu && <ActionSheet open onClose={() => setMenu(null)} actions={actions(menu.it)} at={menu.at} />}
      {sub?.kind === 'mute' && sub.it.ch && (
        <ActionSheet
          open
          onClose={() => setSub(null)}
          title={t('Mute {name}', { name: chanName(sub.it.ch, users, me) })}
          actions={(
            [
              ['hour', t('For an hour')],
              ['tomorrow', t('Until tomorrow morning')],
              ['always', t('Until I turn it back on')],
            ] as const
          ).map(([k, l]) => ({ label: l, hint: k === 'always' ? t('Mentions of you still come through') : undefined, run: () => (chat.mute(sub.it.ch!.id, k), toast({ text: t('Muted') })) }))}
        />
      )}
      {sub?.kind === 'remind' && sub.it.m && (
        <WhenSheet
          title={t('Remind me')}
          kind="remind"
          note={<p className="when-note">{t('It’s saved, and you get a notification then: “{text}”', { text: preview(sub.it.m).slice(0, 70) })}</p>}
          onPick={(at) => (chat.save(sub.it.m!, at), toast({ text: t('Saved. You’ll be reminded {when}.', { when: whenText(at) }) }))}
          onClose={() => setSub(null)}
        />
      )}
    </div>
  );
}

/** One item: what it is and where (with the time and an unread dot), then who said what. */
function ActivityRow({ it, users, me, myFirst, onOpen, onMenu }: { it: Item; users: User[]; me: string; myFirst: string; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void }) {
  const press = useLongPress((pt) => onMenu({ x: pt.x, y: pt.y }));
  const where = it.ch ? chanName(it.ch, users, me) : '';
  const context =
    it.kind === 'thread' ? (where ? t('Thread in {where}', { where }) : t('Thread')) : it.kind === 'dm' ? (it.ch && isGroupDm(it.ch) ? t('Group message') : t('Direct message')) : it.kind === 'mention' ? (where ? t('Mention in {where}', { where }) : t('Mention')) : where || t('Chat');
  const Icon = it.kind === 'thread' ? MessagesSquare : it.kind === 'dm' ? MessageCircle : it.kind === 'mention' ? AtSign : Bell;
  const text = it.m ? preview(it.m) || t('Sent something') : textOf(it.n);
  return (
    <button type="button" className={`act-row lp${it.n.read ? '' : ' unread'}`} {...press} onClick={onOpen} onContextMenu={(e) => (press.onContextMenu(e), e.preventDefault(), onMenu({ x: e.clientX, y: e.clientY }))}>
      <span className="act-context">
        <Icon size={14} aria-hidden />
        <span className="act-where">{context}</span>
        <time dateTime={it.n.at}>{shortTime(it.n.at)}</time>
        <i className="act-dot" aria-label={it.n.read ? undefined : t('Unread')} />
      </span>
      <span className="act-main">
        {it.who ? (
          <Avatar person={it.who} size={36} />
        ) : (
          <span className="act-ico" aria-hidden>
            <Icon size={18} />
          </span>
        )}
        <span className="act-body">
          {it.who && <strong className="act-name">{it.who.name}</strong>}
          {it.kind === 'thread' && it.root && <span className="act-quote">{t('replied to: {text}', { text: preview(it.root) })}</span>}
          <span className="act-text">
            <Highlight text={text} name={myFirst} />
          </span>
        </span>
      </span>
    </button>
  );
}

/** Your @name stands out in the message, like Slack. */
function Highlight({ text, name }: { text: string; name: string }) {
  if (!name) return <>{text}</>;
  const re = new RegExp(`(@${name.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}\\b)`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <b key={i} className="act-me">
            {part}
          </b>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
