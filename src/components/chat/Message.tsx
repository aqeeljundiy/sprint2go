import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Bookmark, FileText, Forward, Image as ImageIcon, ListChecks, MessageSquareReply, MoreHorizontal, Pause, Play, RotateCw, SmilePlus, Sparkles, SquareCheck, Table2, Video } from 'lucide-react';
import type { Channel, ChatMessage, Client, Status, Todo, User } from '../../types';
import { relative } from '../../utils';
import { companyOf } from '../../clientView';
import { stageName, stageOf } from '../../stages';
import { Avatar } from '../Avatar';
import { Badge } from '../ui/Person';
import { useLongPress } from '../ui/useLongPress';
import { whenText, type SavedItem } from './chatPrefs';

export const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');

/** One line of a message: @mentions, links, `code`, *bold*, _italic_ and ~struck~ words. Never HTML. */
function Inline({ text, names }: { text: string; names: string }) {
  const re = new RegExp(`(${names ? `@(?:${names})\\b|` : ''}https?://[^\\s<]+|\`[^\`\\n]+\`|\\*[^*\\s][^*\\n]*\\*|\\b_[^_\\n]+_\\b|~[^~\\s][^~\\n]*~)`, 'g');
  return (
    <>
      {text.split(re).map((p, i) => {
        if (!p) return null;
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith('@'))
          return (
            <b key={i} className="mention">
              {p}
            </b>
          );
        if (/^https?:\/\//.test(p))
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer">
              {p}
            </a>
          );
        if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith('*')) return <strong key={i}>{p.slice(1, -1)}</strong>;
        if (p.startsWith('_')) return <em key={i}>{p.slice(1, -1)}</em>;
        return <s key={i}>{p.slice(1, -1)}</s>;
      })}
    </>
  );
}

/** A message's words: lines starting with "> " are a quote, "- " a list; the rest as written. */
export function Text({ text, users }: { text: string; users: User[] }) {
  const names = useMemo(() => users.map((u) => esc(u.name.split(' ')[0])).filter(Boolean).join('|'), [users]);
  const lines = text.split('\n');
  const blocks: { kind: 'p' | 'quote' | 'list'; lines: string[] }[] = [];
  for (const l of lines) {
    const kind = /^>\s?/.test(l) ? 'quote' : /^[-•]\s/.test(l) ? 'list' : 'p';
    const body = kind === 'quote' ? l.replace(/^>\s?/, '') : kind === 'list' ? l.replace(/^[-•]\s/, '') : l;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && kind !== 'p') last.lines.push(body);
    else blocks.push({ kind, lines: [body] });
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'quote' ? (
          <blockquote key={i} className="cm-quote">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} names={names} />
              </Fragment>
            ))}
          </blockquote>
        ) : b.kind === 'list' ? (
          <ul key={i} className="cm-list">
            {b.lines.map((l, j) => (
              <li key={j}>
                <Inline text={l} names={names} />
              </li>
            ))}
          </ul>
        ) : (
          <Fragment key={i}>
            {i > 0 && blocks[i - 1].kind === 'p' && '\n'}
            <Inline text={b.lines[0]} names={names} />
          </Fragment>
        ),
      )}
    </>
  );
}

/** A plain one-line version of a message, for lists and previews. */
export function preview(m: ChatMessage) {
  if (m.text) return m.text.replace(/\s+/g, ' ').replace(/[*_~`]/g, '').trim();
  if (m.voice) return 'Voice note';
  if (m.files?.length) return m.files.length === 1 ? m.files[0].name : `${m.files.length} files`;
  if (m.taskId) return 'Shared a task';
  if (m.ref) return m.ref.title;
  if (m.poll) return m.poll.question;
  if (m.forwarded) return m.forwarded.text;
  return '';
}

export interface MsgCtx {
  me: string;
  users: User[];
  channel: Channel;
  client?: Client;
  tasks: Todo[];
  statuses: Record<string, Status>;
  guest: boolean;
  phone: boolean;
  replies: (id: string) => ChatMessage[];
  threadDraft: (rootId: string) => boolean;
  saved: (id: string) => SavedItem | undefined;
  unsent: { ids: Set<string>; failed: boolean };
  onReact: (id: string, emoji: string) => void;
  onVote: (id: string, option: number) => void;
  onOpenTask: (id: string) => void;
  onOpenThread: (rootId: string) => void;
  onMenu: (m: ChatMessage, where: { x: number; y: number } | { anchor: HTMLElement }) => void;
  onReactPick: (m: ChatMessage, anchor: HTMLElement) => void;
  onWhoReacted: (m: ChatMessage, emoji: string) => void;
  onOpenRef: (ref: NonNullable<ChatMessage['ref']>) => void;
  onMakeTask: (m: ChatMessage) => void;
  onSave: (m: ChatMessage) => void;
  onRetry: () => void;
}

/** Who wrote it: a person on the team, a guest, or someone an import brought in. */
export function authorOf(m: ChatMessage, ctx: Pick<MsgCtx, 'me' | 'users' | 'channel'>) {
  if (m.guestEmail) {
    const g = ctx.channel.guests?.find((x) => x.email === m.guestEmail);
    return { name: `${g?.name ?? m.guestEmail}${m.via === 'whatsapp' ? ' · WhatsApp' : ''}`, first: (g?.name ?? m.guestEmail).split(' ')[0], guest: true, former: false, person: { name: g?.name ?? m.guestEmail, email: m.guestEmail } as { name: string; email: string; color?: string } };
  }
  const u = ctx.users.find((x) => x.id === m.userId);
  if (!u && m.authorName) return { name: m.authorName, first: m.authorName.split(' ')[0], guest: false, former: true, person: { name: m.authorName, email: m.authorName } as { name: string; email: string; color?: string } };
  return { name: m.userId === ctx.me ? 'You' : (u?.name ?? 'Someone'), first: m.userId === ctx.me ? 'You' : (u?.name.split(' ')[0] ?? 'Someone'), guest: false, former: false, person: u as { name: string; email: string; color?: string } | undefined };
}

function ReactionPill({ m, emoji, who, ctx }: { m: ChatMessage; emoji: string; who: string[]; ctx: MsgCtx }) {
  // Long-press shows who reacted (a tap adds or takes away your own).
  const press = useLongPress(() => ctx.onWhoReacted(m, emoji));
  const names = who.map((w) => (w === ctx.me ? 'You' : (ctx.users.find((u) => u.id === w)?.name.split(' ')[0] ?? 'Someone'))).join(', ');
  return (
    <button className={`reaction lp ${who.includes(ctx.me) ? 'on' : ''}`} {...press} onClick={() => ctx.onReact(m.id, emoji)} title={names} aria-label={`${emoji} ${who.length}: ${names}`}>
      {emoji} <b>{who.length}</b>
    </button>
  );
}

/** One message in a conversation or thread. Tap opens its thread on phones; long-press (or right-click, or "…") shows what you can do with it. */
export function Msg({ m, grouped, inThread = false, ctx }: { m: ChatMessage; grouped: boolean; inThread?: boolean; ctx: MsgCtx }) {
  const more = useRef<HTMLButtonElement>(null);
  const plain = m.kind === 'celebration' || m.kind === 'summary' || m.kind === 'system';
  const press = useLongPress((pt) => ctx.onMenu(m, { x: pt.x, y: pt.y }), { disabled: plain || !ctx.phone });
  const a = authorOf(m, ctx);
  if (m.kind === 'celebration')
    return (
      <div className="chat-celebration">
        <span>🎉 {m.text}</span>
        <time>{relative(m.at)}</time>
      </div>
    );
  if (m.kind === 'summary')
    return (
      <div data-msg={m.id} className="chat-summary">
        <div className="chat-summary-head">
          <Sparkles size={13} aria-hidden /> Summary{m.summaryOf ? `, ${m.summaryOf}` : ''}
          <time>{relative(m.at)}</time>
        </div>
        <p>{m.text}</p>
      </div>
    );
  if (m.kind === 'system')
    return (
      <div className="chat-celebration system">
        <span>
          {a.name} {m.text}
        </span>
        <time>{relative(m.at)}</time>
      </div>
    );
  const task = m.taskId ? ctx.tasks.find((t) => t.id === m.taskId) : undefined;
  const reps = inThread ? [] : ctx.replies(m.id);
  const draft = !inThread && ctx.threadDraft(m.id);
  const st = !a.guest ? ctx.statuses[m.userId] : undefined;
  const saved = ctx.saved(m.id);
  const pending = m.userId === ctx.me && ctx.unsent.ids.has(m.id);
  const client = ctx.client;
  const person = (id: string) => ctx.users.find((u) => u.id === id);
  const canOpen = ctx.phone && !inThread && !ctx.guest;
  return (
    <div
      data-msg={m.id}
      className={`chat-msg ${grouped ? 'grouped' : ''} ${m.kind === 'kudos' ? 'kudos-msg' : ''}${saved ? ' is-saved' : ''}${pending ? ' is-pending' : ''}${ctx.phone ? ' lp' : ''}`}
      {...press}
      onClick={(e) => {
        if (!canOpen || (e.target as HTMLElement).closest('a, button, audio, video, input, textarea, .poll, .voice')) return;
        ctx.onOpenThread(m.id);
      }}
      onContextMenu={(e) => {
        press.onContextMenu(e);
        if (e.defaultPrevented || ctx.phone || (e.target as HTMLElement).closest('a')) return;
        e.preventDefault();
        ctx.onMenu(m, { x: e.clientX, y: e.clientY });
      }}
    >
      {grouped ? <span className="cm-gutter" /> : a.person ? <Avatar person={a.person} size={34} /> : <span className="cm-gutter" />}
      <div className="cm-body">
        {saved && (
          <div className="cm-saved">
            <Bookmark size={12} aria-hidden /> {saved.remindAt && !saved.reminded ? `Saved, reminder ${whenText(saved.remindAt)}` : 'Saved'}
          </div>
        )}
        {!grouped && (
          <div className="cm-head">
            <strong>{a.name}</strong>
            {a.former && <Badge small>{m.userId.startsWith('former:bot:') ? 'App' : 'Former member'}</Badge>}
            {a.guest && (
              <Badge small tone="warn">
                Guest
                {(() => {
                  const co = companyOf(a.person?.email ?? '', client?.people?.find((x) => x.email === a.person?.email)?.company, client);
                  return co ? ` · ${co}` : '';
                })()}
              </Badge>
            )}
            {st && (
              <span className="st-emoji" title={st.text}>
                {st.emoji}
              </span>
            )}
            <time dateTime={m.at}>{relative(m.at)}</time>
            {m.parentId && m.alsoInChannel && !inThread && <span className="muted small">replied in a thread</span>}
          </div>
        )}
        {m.forwarded && (
          <div className="cm-fwd">
            <span className="cm-fwd-head">
              <Forward size={12} aria-hidden /> {m.forwarded.who} in {m.forwarded.where}
            </span>
            <Text text={m.forwarded.text} users={ctx.users} />
          </div>
        )}
        {m.kind === 'kudos' ? (
          <div className="kudos-card">
            <span className="kudos-emoji">🙌</span>
            <span>
              <strong>Kudos to {m.kudosFor === ctx.me ? 'you' : person(m.kudosFor ?? '')?.name}</strong>
              {m.text && <span> {m.text}</span>}
            </span>
          </div>
        ) : (
          m.text && (
            <div className="cm-text">
              <Text text={m.text} users={ctx.users} />
              {m.edited && <span className="cm-edited"> (edited)</span>}
            </div>
          )
        )}
        {m.voice && <VoiceNote voice={m.voice} />}
        {m.poll && (
          <div className="poll">
            <div className="poll-q">
              <BarChart3 size={14} /> {m.poll.question}
            </div>
            {m.poll.options.map((o, i) => {
              const total = m.poll!.options.reduce((s, x) => s + x.votes.length, 0) || 1;
              return (
                <button key={i} className={`poll-opt ${o.votes.includes(ctx.me) ? 'on' : ''}`} onClick={() => ctx.onVote(m.id, i)}>
                  <span className="poll-fill" style={{ width: `${(o.votes.length / total) * 100}%` }} />
                  <span className="poll-text">{o.text}</span>
                  <span className="poll-votes">
                    {o.votes.slice(0, 3).map((v) => person(v) && <Avatar key={v} person={person(v)!} size={16} />)}
                    {o.votes.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {m.files?.map((f) => (
          <a key={f.name} className="chat-file" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && e.preventDefault()}>
            <span className="cf-icon">{f.type.startsWith('video') ? <Video size={16} /> : f.type.startsWith('image') ? <ImageIcon size={16} /> : <FileText size={16} />}</span>
            <span className="cf-text">
              <strong>{f.name}</strong>
              <small>
                {fmtSize(f.size)}
                {f.missing ? ` · ${f.missing}` : f.url && !f.driveId ? '' : client ? ` · saved to Drive › ${client.name}` : ' · saved to Drive'}
              </small>
            </span>
          </a>
        ))}
        {task && (
          <button className={`cm-task ${task.done ? 'done' : ''}`} onClick={() => ctx.onOpenTask(task.id)}>
            <SquareCheck size={14} />
            <span>{task.title}</span>
            <em>
              {stageName(stageOf(task))} · {person(task.userId)?.name.split(' ')[0] ?? 'team queue'}
            </em>
          </button>
        )}
        {m.ref && (
          <button className="cm-task cm-ref" onClick={() => ctx.onOpenRef(m.ref!)}>
            {m.ref.kind === 'note' ? <FileText size={14} /> : m.ref.kind === 'row' ? <Table2 size={14} /> : <ImageIcon size={14} />}
            <span>{m.ref.title}</span>
            <em>{m.ref.kind === 'note' ? 'Note' : m.ref.kind === 'row' ? 'Table row' : 'Drive file'}</em>
          </button>
        )}
        {m.reactions && Object.keys(m.reactions).some((k) => m.reactions![k].length) && (
          <div className="reactions">
            {Object.entries(m.reactions)
              .filter(([, who]) => who.length)
              .map(([emoji, who]) => (
                <ReactionPill key={emoji} m={m} emoji={emoji} who={who} ctx={ctx} />
              ))}
            {!ctx.guest && (
              <button className="reaction add" onClick={(e) => ctx.onReactPick(m, e.currentTarget)} aria-label="Add reaction">
                <SmilePlus size={13} />
              </button>
            )}
          </div>
        )}
        {(reps.length > 0 || draft) && (
          <button className="thread-link" onClick={() => ctx.onOpenThread(m.id)}>
            {reps.length > 0 ? (
              <>
                <span className="tl-avs">{[...new Set(reps.map((r) => r.userId))].slice(0, 3).map((u) => person(u) && <Avatar key={u} person={person(u)!} size={18} />)}</span>
                <b>
                  {reps.length} repl{reps.length === 1 ? 'y' : 'ies'}
                </b>
                <span className="muted">Last reply {relative(reps[reps.length - 1].at)}</span>
              </>
            ) : (
              <b>Reply in thread</b>
            )}
            {draft && <span className="draft-pill">Draft</span>}
          </button>
        )}
        {pending && (
          <div className={`cm-state${ctx.unsent.failed ? ' failed' : ''}`} role="status">
            {ctx.unsent.failed ? (
              <>
                Not sent yet. It goes when you’re back online.
                <button type="button" className="link-btn" onClick={ctx.onRetry}>
                  <RotateCw size={12} /> Try now
                </button>
              </>
            ) : (
              'Sending…'
            )}
          </div>
        )}
      </div>
      {!ctx.phone && (
        <div className="cm-tools">
          {!ctx.guest && (
            <button title="React" aria-label="React" onClick={(e) => ctx.onReactPick(m, e.currentTarget)}>
              <SmilePlus size={15} />
            </button>
          )}
          {!inThread && (
            <button title="Reply in thread" aria-label="Reply in thread" onClick={() => ctx.onOpenThread(m.id)}>
              <MessageSquareReply size={15} />
            </button>
          )}
          {!ctx.guest && !task && m.kind !== 'kudos' && m.text && (
            <button title="Make a task" aria-label="Make a task" onClick={() => ctx.onMakeTask(m)}>
              <ListChecks size={15} />
            </button>
          )}
          {!ctx.guest && (
            <button title={saved ? 'Saved' : 'Save'} aria-label={saved ? 'Remove from saved' : 'Save'} className={saved ? 'on' : ''} onClick={() => ctx.onSave(m)}>
              <Bookmark size={15} />
            </button>
          )}
          <button ref={more} title="More" aria-label="More actions" onClick={() => more.current && ctx.onMenu(m, { anchor: more.current })}>
            <MoreHorizontal size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export function VoiceNote({ voice }: { voice: NonNullable<ChatMessage['voice']> }) {
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState(voice.transcript ?? '');
  const [transcribing, setTranscribing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7 + voice.seconds)) * 18), [voice.seconds]);
  const toggle = () => {
    if (voice.url) {
      if (!audio.current) {
        audio.current = new Audio(voice.url);
        audio.current.onended = () => setPlaying(false);
      }
      if (playing) audio.current.pause();
      else audio.current.play().catch(() => setPlaying(false));
    } else if (!playing) setTimeout(() => setPlaying(false), Math.min(voice.seconds, 6) * 1000);
    setPlaying(!playing);
  };
  return (
    <div className="voice">
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className={`voice-wave ${playing ? 'playing' : ''}`}>
        {bars.map((h, i) => (
          <i key={i} style={{ height: h, animationDelay: `${i * 40}ms` }} />
        ))}
      </span>
      <span className="voice-len">{fmtSecs(voice.seconds)}</span>
      {text ? (
        <button className="link-btn small" onClick={() => setShowText((s) => !s)}>
          {showText ? 'Hide text' : 'Show text'}
        </button>
      ) : (
        <button
          className="link-btn small"
          disabled={transcribing}
          title="Turns speech into text with the AI your company picked. Only when someone asks"
          onClick={() => {
            setTranscribing(true);
            setTimeout(() => {
              setText('Demo transcript: once an AI provider is connected, the real words of this voice note appear here.');
              setShowText(true);
              setTranscribing(false);
            }, 1200);
          }}
        >
          <Sparkles size={11} /> {transcribing ? 'Transcribing…' : 'Transcribe'}
        </button>
      )}
      {showText && text && <p className="voice-text">{text}</p>}
    </div>
  );
}

/** A day line between messages. */
export function DayLine({ at }: { at: string }) {
  return (
    <div className="chat-day">
      <span>{new Date(at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>
  );
}

/** Where the unread part of a conversation starts. */
export function NewLine({ children }: { children?: ReactNode }) {
  return (
    <div className="chat-new" role="separator">
      <span>{children ?? 'New'}</span>
    </div>
  );
}
