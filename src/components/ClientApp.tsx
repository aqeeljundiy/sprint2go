import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Hash,
  Home,
  Inbox,
  ListChecks,
  LogOut,
  MessagesSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Upload,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ChatMessage, Client, ClientAccess, ClientPerson, Meeting, Notice, Todo, User, Workspace } from '../types';
import type { ClientActions } from '../clientActions';
import { can, requestStatus, teamLabel } from '../clientView';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Logo } from './Logo';
import { DatePicker } from './ui/DatePicker';
import { Popover } from './ui/Popover';
import { dueLabel, isBrief, statusOf } from './TasksView';

type Tab = 'home' | 'requests' | 'chat' | 'tasks' | 'files' | 'meet' | 'ask';

interface Props {
  ws: Workspace;
  client: Client;
  person: ClientPerson;
  access: ClientAccess;
  team: User[];
  actions: ClientActions;
  messages: ChatMessage[];
  allTasks: Todo[]; // for brief progress (counts only)
  notices: Notice[];
  onReadNotices: () => void;
  /** "View as client": the bar on top and how to leave. */
  preview?: { onExit: () => void; people: ClientPerson[]; onSwitch: (email: string) => void };
  onSignOut?: () => void;
}

const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/** The client's portal: only what the team shared with them, and what they can do there. */
export function ClientApp(p: Props) {
  const { ws, client, person, access, actions } = p;
  const v = actions.view();
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<string | null>(null); // a task, request or meeting being read
  const [chanId, setChanId] = useState<string | null>(v.channels[0]?.id ?? null);
  const [toast, setToast] = useState('');
  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 3500);
  };
  const first = person.name.split(' ')[0];
  const teamUser = (id?: string) => p.team.find((u) => u.id === id);
  const nameOf = (by: string) => {
    if (by.includes('@')) return v.people.find((x) => x.email.toLowerCase() === by.toLowerCase())?.name ?? by;
    return teamLabel(teamUser(by), access, ws.name);
  };
  const avatarOf = (by: string, size = 24) => {
    if (by.includes('@')) {
      const n = nameOf(by);
      return <span className="capp-av client" style={{ width: size, height: size }}>{n.charAt(0)}</span>;
    }
    const u = teamUser(by);
    return access.teamNames === 'hide' || !u ? <WorkspaceLogo ws={ws} size={size} /> : <Avatar person={u} size={size} />;
  };

  const requests = v.tasks.filter((t) => t.source === 'request').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shared = v.tasks.filter((t) => t.source !== 'request');
  const briefs = shared.filter(isBrief);
  const work = shared.filter((t) => !isBrief(t));
  const approvals = work.filter((t) => t.approval?.status === 'waiting');
  const waitingOnMe = requests.filter((t) => requestStatus(t).cls === 'waiting');
  const unread = p.notices.filter((n) => !n.read).length;

  const tabs: [Tab, string, LucideIcon, number?][] = [
    ['home', 'Home', Home],
    ...(access.requests ? ([['requests', 'Requests', Inbox, requests.filter((t) => !t.done).length]] as [Tab, string, LucideIcon, number][]) : []),
    ['chat', 'Chat', MessagesSquare],
    ['tasks', 'Work', ListChecks, approvals.length],
    ['files', 'Files', FileText],
    ['meet', 'Meetings', Video],
    ...(access.ai ? ([['ask', 'Ask AI', Sparkles]] as [Tab, string, LucideIcon][]) : []),
  ];
  const go = (t: Tab, id?: string) => {
    setTab(t);
    setOpen(id ?? null);
  };

  return (
    <div className="capp" style={{ ['--accent' as string]: ws.color, ['--brand' as string]: ws.color }}>
      {p.preview && (
        <div className="capp-preview">
          <Eye size={15} /> Viewing as <b>{person.name}</b> from {client.name}
          {p.preview.people.length > 1 && (
            <select value={person.email} onChange={(e) => p.preview!.onSwitch(e.target.value)} aria-label="Switch person">
              {p.preview.people.map((x) => (
                <option key={x.email} value={x.email}>
                  {x.name} ({x.role})
                </option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <button className="ghost-btn sm" onClick={p.preview.onExit}>
            <X size={14} /> Exit
          </button>
        </div>
      )}
      <header className="capp-head">
        <WorkspaceLogo ws={ws} size={32} />
        <span className="capp-title">
          <small>{ws.name} for</small>
          <strong>{client.name}</strong>
        </span>
        <span className="spacer" />
        <NoticesButton notices={p.notices} unread={unread} onOpen={(n) => n.link?.id && go(n.link.app === 'chat' ? 'chat' : 'tasks', n.link.id)} onRead={p.onReadNotices} />
        <PersonMenu person={person} access={access} wsName={ws.name} onInvite={actions.invite} onSignOut={p.onSignOut ?? p.preview?.onExit} say={say} />
      </header>

      <div className="capp-body">
        <nav className="capp-nav">
          {tabs.map(([id, label, Icon, n]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
              <Icon size={18} />
              <span>{label}</span>
              {n ? <i>{n}</i> : null}
            </button>
          ))}
        </nav>

        <main className="capp-main">
          {tab === 'home' && (
            <div className="capp-page">
              <h1>Hi {first}</h1>
              <p className="muted">Here’s where things stand with {ws.name}.</p>

              {(approvals.length > 0 || waitingOnMe.length > 0) && (
                <section className="capp-card attention">
                  <h2>
                    <Clock size={16} /> Needs you
                  </h2>
                  {approvals.map((t) => (
                    <button key={t.id} className="capp-row" onClick={() => go('tasks', t.id)}>
                      <span className="capp-row-main">
                        <strong>Approve “{t.title}”</strong>
                        <small>
                          Asked by {nameOf(t.approval!.askedBy)} {relative(t.approval!.askedAt)}
                          {can(person, 'approve') ? '' : ' · your approver decides'}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {waitingOnMe.map((t) => (
                    <button key={t.id} className="capp-row" onClick={() => go('requests', t.id)}>
                      <span className="capp-row-main">
                        <strong>{t.title}</strong>
                        <small>Your request is waiting on you</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              )}

              <div className="capp-grid">
                {briefs.length > 0 && (
                  <section className="capp-card">
                    <h2>
                      <FileText size={16} /> Work in progress
                    </h2>
                    {briefs.map((b) => {
                      const all = p.allTasks.filter((t) => t.briefId === b.id);
                      const done = all.filter((t) => t.done).length;
                      return (
                        <button key={b.id} className="capp-row" onClick={() => go('tasks', b.id)}>
                          <span className="capp-row-main">
                            <strong>{b.title}</strong>
                            <span className="capp-progress">
                              <span className="bar">
                                <span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
                              </span>
                              {done} of {all.length} done{b.due ? ` · due ${fmtDay(b.due)}` : ''}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </section>
                )}
                {access.requests && (
                  <section className="capp-card">
                    <h2>
                      <Inbox size={16} /> Your requests
                      <button className="link-btn" onClick={() => go('requests', 'new')}>
                        <Plus size={13} /> New
                      </button>
                    </h2>
                    {requests.filter((t) => !t.done).length === 0 && <p className="muted small">Need something? Send a request and the team picks it up.</p>}
                    {requests
                      .filter((t) => !t.done)
                      .slice(0, 4)
                      .map((t) => (
                        <button key={t.id} className="capp-row" onClick={() => go('requests', t.id)}>
                          <span className="capp-row-main">
                            <strong>{t.title}</strong>
                            <small>Sent {relative(t.createdAt)}</small>
                          </span>
                          <span className={`req-status ${requestStatus(t).cls}`}>{requestStatus(t).label}</span>
                        </button>
                      ))}
                  </section>
                )}
                <section className="capp-card">
                  <h2>
                    <Video size={16} /> Latest meeting
                  </h2>
                  {v.meetings.length === 0 && <p className="muted small">No meetings yet.</p>}
                  {v.meetings
                    .slice()
                    .sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))
                    .slice(0, 1)
                    .map(({ meeting: m, notes }) => (
                      <button key={m.id} className="capp-row" onClick={() => go('meet', m.id)}>
                        <span className="capp-row-main">
                          <strong>{m.title}</strong>
                          <small>
                            {fmtDay(m.at)} · {m.minutes} min
                          </small>
                          {notes && <span className="capp-snip">{m.summary}</span>}
                        </span>
                      </button>
                    ))}
                </section>
                <section className="capp-card">
                  <h2>
                    <FileText size={16} /> Recent files
                  </h2>
                  {v.files.length === 0 && <p className="muted small">Nothing shared yet.</p>}
                  {v.files
                    .slice()
                    .sort((a, b) => b.modified.localeCompare(a.modified))
                    .slice(0, 4)
                    .map((f) => (
                      <a key={f.id} className="capp-row" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && e.preventDefault()}>
                        <span className="capp-row-main">
                          <strong>{f.name}</strong>
                          <small>
                            {fmtSize(f.size)} · {relative(f.modified)}
                          </small>
                        </span>
                      </a>
                    ))}
                </section>
              </div>
            </div>
          )}

          {tab === 'requests' && <Requests p={p} requests={requests} open={open} setOpen={setOpen} nameOf={nameOf} avatarOf={avatarOf} say={say} />}
          {tab === 'tasks' && <Work p={p} briefs={briefs} work={work} open={open} setOpen={setOpen} nameOf={nameOf} avatarOf={avatarOf} />}
          {tab === 'chat' && <Chat p={p} channels={v.channels} chanId={chanId} setChanId={setChanId} nameOf={nameOf} avatarOf={avatarOf} />}
          {tab === 'files' && <Files p={p} files={v.files} say={say} />}
          {tab === 'meet' && <Meetings p={p} meetings={v.meetings} open={open} setOpen={setOpen} />}
          {tab === 'ask' && <Ask p={p} />}
        </main>
      </div>
      {!access.hideBranding && (
        <footer className="capp-foot">
          Made with <Logo size={13} /> Sprint2go
        </footer>
      )}
      {toast && <div className="capp-toast">{toast}</div>}
    </div>
  );
}

type Helpers = { nameOf: (by: string) => string; avatarOf: (by: string, size?: number) => React.ReactNode };

/** Comments the client can read (internal comments never reach the portal). */
function Thread({ t, nameOf, avatarOf }: { t: Todo } & Helpers) {
  const items = (t.history ?? []).filter((h) => h.toClient || (h.kind === 'created' && t.source === 'request') || (h.kind === 'review' && h.by.includes('@')));
  return (
    <ol className="capp-thread">
      {items.map((h) => (
        <li key={h.id} className={h.by.includes('@') ? 'from-client' : ''}>
          {avatarOf(h.by, 26)}
          <div>
            <b>{nameOf(h.by)}</b> <time>{relative(h.at)}</time>
            <p>{h.kind === 'comment' ? h.text : <i>{h.text}</i>}</p>
          </div>
        </li>
      ))}
      {!items.length && <li className="muted small">No messages yet.</li>}
    </ol>
  );
}

function Reply({ onSend, placeholder }: { onSend: (t: string) => void; placeholder: string }) {
  const [text, setText] = useState('');
  return (
    <div className="capp-reply">
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && text.trim() && (e.preventDefault(), onSend(text), setText(''))} />
      <button className="primary-btn sm" disabled={!text.trim()} onClick={() => (onSend(text), setText(''))}>
        <Send size={14} /> Send
      </button>
    </div>
  );
}

function Requests({ p, requests, open, setOpen, nameOf, avatarOf, say }: { p: Props; requests: Todo[]; open: string | null; setOpen: (id: string | null) => void; say: (t: string) => void } & Helpers) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const canAsk = can(p.person, 'request');
  const t = requests.find((x) => x.id === open);

  if (open === 'new')
    return (
      <div className="capp-page narrow">
        <button className="link-btn back" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} /> Requests
        </button>
        <h1>New request</h1>
        <p className="muted">Tell the team what you need. You’ll see when they pick it up and can talk about it here.</p>
        <label className="field">
          <span>What do you need?</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A new banner for the Ramadan promo" />
        </label>
        <label className="field">
          <span>Details</span>
          <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Sizes, wording, examples you like, anything that helps" />
        </label>
        <div className="field">
          <span>Needed by (optional)</span>
          <DatePicker value={due} onChange={setDue} label="Needed by" placeholder="No date" />
        </div>
        <div className="capp-attach">
          <button className="ghost-btn sm" onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} /> Attach files
          </button>
          {files.map((f) => (
            <span key={f.name} className="chip">
              {f.name}
              <button aria-label="Remove" onClick={() => setFiles(files.filter((x) => x !== f))}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => (setFiles([...files, ...(e.target.files ?? [])]), (e.target.value = ''))} />
        </div>
        <div className="capp-actions">
          <button className="ghost-btn" onClick={() => setOpen(null)}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!title.trim()}
            onClick={async () => {
              const id = await p.actions.request({ title, details, due: due || undefined, files });
              setTitle('');
              setDetails('');
              setDue('');
              setFiles([]);
              setOpen(id);
              say('Request sent. The team has been told.');
            }}
          >
            Send request
          </button>
        </div>
      </div>
    );

  if (t) {
    const st = requestStatus(t);
    return (
      <div className="capp-page narrow">
        <button className="link-btn back" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} /> Requests
        </button>
        <h1>{t.title}</h1>
        <p className="capp-meta">
          <span className={`req-status ${st.cls}`}>{st.label}</span>
          Sent by {nameOf(t.requestedBy ?? '')} {relative(t.createdAt)}
          {t.due && ` · needed by ${fmtDay(t.due)}`}
          {(t.assignees?.length ?? 0) > 0 && ` · ${t.assignees!.map(nameOf).filter((n, i, a) => a.indexOf(n) === i).join(', ')} on it`}
        </p>
        <Thread t={t} nameOf={nameOf} avatarOf={avatarOf} />
        {can(p.person, 'comment') && <Reply onSend={(x) => p.actions.comment(t.id, x)} placeholder="Write to the team…" />}
      </div>
    );
  }

  return (
    <div className="capp-page">
      <div className="capp-h">
        <h1>Requests</h1>
        {canAsk && (
          <button className="primary-btn" onClick={() => setOpen('new')}>
            <Plus size={15} /> New request
          </button>
        )}
      </div>
      {!canAsk && <p className="muted small">Your access is read only. Ask a colleague with more access to send requests.</p>}
      {requests.length === 0 && <p className="te-empty">No requests yet.</p>}
      {requests.map((r) => (
        <button key={r.id} className="capp-row big" onClick={() => setOpen(r.id)}>
          <span className="capp-row-main">
            <strong>{r.title}</strong>
            <small>
              {nameOf(r.requestedBy ?? '')} · {relative(r.createdAt)}
              {r.due && ` · needed by ${fmtDay(r.due)}`}
            </small>
          </span>
          <span className={`req-status ${requestStatus(r).cls}`}>{requestStatus(r).label}</span>
        </button>
      ))}
    </div>
  );
}

function Work({ p, briefs, work, open, setOpen, nameOf, avatarOf }: { p: Props; briefs: Todo[]; work: Todo[]; open: string | null; setOpen: (id: string | null) => void } & Helpers) {
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const t = [...briefs, ...work].find((x) => x.id === open);
  const st = (x: Todo) => (x.done ? 'Done' : statusOf(x) === 'doing' || statusOf(x) === 'review' ? 'In progress' : statusOf(x) === 'waiting' ? 'Waiting on you' : 'Planned');

  if (t) {
    const subs = isBrief(t) ? work.filter((x) => x.briefId === t.id) : [];
    return (
      <div className="capp-page narrow">
        <button className="link-btn back" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} /> Work
        </button>
        <h1>{t.title}</h1>
        <p className="capp-meta">
          <span className={`st-dot st-${statusOf(t)}`} /> {st(t)}
          {t.due && ` · due ${fmtDay(t.due)}`}
          {(t.assignees?.length ?? (t.userId ? 1 : 0)) > 0 && ` · ${[...new Set((t.assignees?.length ? t.assignees : [t.userId]).map(nameOf))].join(', ')}`}
        </p>
        {isBrief(t) && t.context && <p className="capp-context">{t.context}</p>}
        {t.approval?.status === 'waiting' && (
          <div className="capp-approve">
            <strong>Waiting for your approval</strong>
            {can(p.person, 'approve') ? (
              asking ? (
                <>
                  <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" />
                  <div className="capp-actions">
                    <button className="ghost-btn sm" onClick={() => setAsking(false)}>
                      Cancel
                    </button>
                    <button className="primary-btn sm" disabled={!note.trim()} onClick={() => (p.actions.decide(t.id, 'changes', note.trim()), setAsking(false), setNote(''))}>
                      Send changes
                    </button>
                  </div>
                </>
              ) : (
                <div className="capp-actions">
                  <button className="ghost-btn sm" onClick={() => setAsking(true)}>
                    <RotateCcw size={13} /> Ask for changes
                  </button>
                  <button className="primary-btn sm" onClick={() => p.actions.decide(t.id, 'approved', '')}>
                    <CheckCircle2 size={14} /> Approve
                  </button>
                </div>
              )
            ) : (
              <small className="muted">Only approvers at {p.client.name} can approve. You can still comment below.</small>
            )}
          </div>
        )}
        {t.approval && t.approval.status !== 'waiting' && (
          <p className={`ap-tag ${t.approval.status}`}>
            {t.approval.status === 'approved' ? 'Approved' : 'Changes asked'} by {nameOf(t.approval.by ?? '')}
            {t.approval.note ? `: “${t.approval.note}”` : ''}
          </p>
        )}
        {subs.length > 0 && (
          <ul className="capp-list">
            {subs.map((x) => (
              <li key={x.id}>
                <button onClick={() => setOpen(x.id)}>
                  <span className={`st-dot st-${statusOf(x)}`} />
                  <span>{x.title}</span>
                  <small>{st(x)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3 className="capp-sub">Conversation</h3>
        <Thread t={t} nameOf={nameOf} avatarOf={avatarOf} />
        {can(p.person, 'comment') && <Reply onSend={(x) => p.actions.comment(t.id, x)} placeholder="Comment for the team…" />}
      </div>
    );
  }

  return (
    <div className="capp-page">
      <h1>Work</h1>
      {briefs.length + work.length === 0 && <p className="te-empty">Nothing shared yet. The team shares briefs and tasks with you here.</p>}
      {briefs.map((b) => (
        <section key={b.id} className="capp-card">
          <button className="capp-row" onClick={() => setOpen(b.id)}>
            <span className="capp-row-main">
              <strong>{b.title}</strong>
              <small>{b.due ? `Due ${fmtDay(b.due)}` : 'Brief'}</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <ul className="capp-list">
            {work
              .filter((x) => x.briefId === b.id)
              .map((x) => (
                <li key={x.id}>
                  <button onClick={() => setOpen(x.id)}>
                    <span className={`st-dot st-${statusOf(x)}`} />
                    <span>{x.title}</span>
                    {x.approval?.status === 'waiting' ? <span className="req-status waiting">Approve</span> : <small>{st(x)}</small>}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {work.filter((x) => !x.briefId || !briefs.some((b) => b.id === x.briefId)).length > 0 && (
        <section className="capp-card">
          <h2>Other work</h2>
          <ul className="capp-list">
            {work
              .filter((x) => !x.briefId || !briefs.some((b) => b.id === x.briefId))
              .map((x) => (
                <li key={x.id}>
                  <button onClick={() => setOpen(x.id)}>
                    <span className={`st-dot st-${statusOf(x)}`} />
                    <span>{x.title}</span>
                    {x.approval?.status === 'waiting' ? <span className="req-status waiting">Approve</span> : <small>{x.due && !x.done ? dueLabel(x.due).text : st(x)}</small>}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Chat({ p, channels, chanId, setChanId, nameOf, avatarOf }: { p: Props; channels: { id: string; name: string; topic?: string }[]; chanId: string | null; setChanId: (id: string) => void } & Helpers) {
  const ch = channels.find((c) => c.id === chanId) ?? channels[0];
  const msgs = useMemo(() => (ch ? p.messages.filter((m) => m.channelId === ch.id && !m.parentId).sort((a, b) => a.at.localeCompare(b.at)) : []), [p.messages, ch]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length, ch?.id]);
  if (!ch)
    return (
      <div className="capp-page">
        <h1>Chat</h1>
        <p className="te-empty">No conversations yet. {p.ws.name} will add you to a channel.</p>
      </div>
    );
  return (
    <div className="capp-chat">
      {channels.length > 1 && (
        <div className="capp-chans">
          {channels.map((c) => (
            <button key={c.id} className={c.id === ch.id ? 'on' : ''} onClick={() => setChanId(c.id)}>
              <Hash size={14} /> {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="capp-chat-head">
        <strong>
          <Hash size={15} /> {ch.name}
        </strong>
        {ch.topic && <small>{ch.topic}</small>}
      </div>
      <div className="capp-msgs">
        {msgs.map((m) => {
          const by = m.guestEmail ?? m.userId;
          return (
            <div key={m.id} className={`capp-msg ${m.kind === 'celebration' ? 'celebration' : ''}`}>
              {avatarOf(by, 30)}
              <div>
                <b>{nameOf(by)}</b> <time>{relative(m.at)}</time>
                <p>{m.text}</p>
                {m.files?.map((f) => (
                  <a key={f.name} className="chip" href={f.url} target="_blank" rel="noreferrer">
                    <Paperclip size={11} /> {f.name}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
        {msgs.length === 0 && <p className="te-empty">Say hello to the team.</p>}
        <div ref={end} />
      </div>
      {can(p.person, 'comment') ? <Reply onSend={(x) => p.actions.send(ch.id, x)} placeholder={`Message #${ch.name}`} /> : <p className="muted small capp-ro">Your access is read only.</p>}
    </div>
  );
}

function Files({ p, files, say }: { p: Props; files: { id: string; name: string; size: number; modified: string; url?: string; uploadedBy?: string }[]; say: (t: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const theirs = files.filter((f) => f.uploadedBy);
  const ours = files.filter((f) => !f.uploadedBy);
  const list = (fs: typeof files) =>
    fs
      .slice()
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .map((f) => (
        <a key={f.id} className="capp-row" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && (e.preventDefault(), say('This is a demo file without content.'))}>
          <FileText size={16} />
          <span className="capp-row-main">
            <strong>{f.name}</strong>
            <small>
              {fmtSize(f.size)} · {relative(f.modified)}
            </small>
          </span>
        </a>
      ));
  return (
    <div className="capp-page">
      <div className="capp-h">
        <h1>Files</h1>
        {p.access.uploads && can(p.person, 'upload') && (
          <>
            <button className="primary-btn" onClick={() => ref.current?.click()}>
              <Upload size={15} /> Upload
            </button>
            <input
              ref={ref}
              type="file"
              multiple
              hidden
              onChange={async (e) => {
                const fs = [...(e.target.files ?? [])];
                e.target.value = '';
                const big = fs.filter((f) => f.size > 8_000_000);
                const done = await p.actions.upload(fs);
                say(big.length ? `${done.length} uploaded. Files over 8 MB: send a link instead.` : `${done.length} file${done.length === 1 ? '' : 's'} uploaded.`);
              }}
            />
          </>
        )}
      </div>
      <section className="capp-card">
        <h2>Shared with you · {ours.length}</h2>
        {ours.length ? list(ours) : <p className="muted small">Nothing shared yet.</p>}
      </section>
      {(theirs.length > 0 || p.access.uploads) && (
        <section className="capp-card">
          <h2>
            From {p.client.name} · {theirs.length}
          </h2>
          {theirs.length ? list(theirs) : <p className="muted small">Files you upload go here, and the team sees them.</p>}
        </section>
      )}
    </div>
  );
}

function Meetings({ p, meetings, open, setOpen }: { p: Props; meetings: { meeting: Meeting; notes: boolean }[]; open: string | null; setOpen: (id: string | null) => void }) {
  const sel = meetings.find((x) => x.meeting.id === open);
  if (sel) {
    const m = sel.meeting;
    return (
      <div className="capp-page narrow">
        <button className="link-btn back" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} /> Meetings
        </button>
        <h1>{m.title}</h1>
        <p className="capp-meta">
          {fmtDay(m.at)} · {m.minutes} min · {m.attendees.join(', ')}
        </p>
        {p.access.recordings !== 'off' && (
          <div className="capp-recording">
            <Video size={16} /> {p.access.recordings === 'video' ? 'Video' : 'Audio'} recording
            <small className="muted">Playback works once recordings are stored on the server.</small>
          </div>
        )}
        {sel.notes ? (
          <>
            <p>{m.summary}</p>
            {!!m.decisions?.length && (
              <>
                <h3 className="capp-sub">Decisions</h3>
                <ul>
                  {m.decisions.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            )}
            {!!m.keyPoints?.length && (
              <>
                <h3 className="capp-sub">Key points</h3>
                <ul>
                  {m.keyPoints.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            )}
            {m.actions.length > 0 && (
              <>
                <h3 className="capp-sub">Next steps</h3>
                <ul>
                  {m.actions.map((a) => (
                    <li key={a.title}>
                      {a.title}
                      {a.due ? <small className="muted"> · {fmtDay(a.due)}</small> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="muted">The team hasn’t shared notes for this meeting.</p>
        )}
      </div>
    );
  }
  return (
    <div className="capp-page">
      <h1>Meetings</h1>
      {meetings.length === 0 && <p className="te-empty">No meetings yet.</p>}
      {meetings
        .slice()
        .sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))
        .map(({ meeting: m, notes }) => (
          <button key={m.id} className="capp-row big" onClick={() => setOpen(m.id)}>
            <Video size={16} />
            <span className="capp-row-main">
              <strong>{m.title}</strong>
              <small>
                {fmtDay(m.at)} · {m.minutes} min{notes ? ' · notes' : ''}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
    </div>
  );
}

function Ask({ p }: { p: Props }) {
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ role: 'me' | 'ai'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const month = new Date().toISOString().slice(0, 7);
  const used = p.client.aiUsage?.month === month ? p.client.aiUsage.count : 0;
  const left = Math.max(0, p.access.aiQuestions - used);
  const ask = async (text: string) => {
    if (!text.trim() || busy || !left) return;
    setChat((c) => [...c, { role: 'me', text }]);
    setQ('');
    setBusy(true);
    const a = await p.actions.ask(text).catch(() => 'Couldn’t answer right now. Try again in a moment.');
    setChat((c) => [...c, { role: 'ai', text: a.replace(/\[[MECT]:[\w-]+(?:@\d+)?\]/g, '') }]);
    setBusy(false);
  };
  return (
    <div className="capp-page narrow">
      <h1>
        <Sparkles size={20} /> Ask AI
      </h1>
      <p className="muted small">
        Answers come only from what {p.ws.name} shared with you: work, meeting notes and your chats. {left} of {p.access.aiQuestions} questions left this month.
      </p>
      <div className="capp-ask">
        {chat.length === 0 &&
          ['Where does our campaign stand?', 'What did we agree in the last meeting?', 'What is waiting on us?'].map((c) => (
            <button key={c} className="ask-chip" onClick={() => ask(c)} disabled={!left}>
              {c}
            </button>
          ))}
        {chat.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role === 'me' ? 'user' : 'ai'}`}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="ask-msg ai typing">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <div className="capp-reply">
        <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask(q))} placeholder={left ? 'Ask about your work with the team…' : 'No questions left this month'} disabled={!left} />
        <button className="primary-btn sm" disabled={!q.trim() || busy || !left} onClick={() => ask(q)}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function NoticesButton({ notices, unread, onOpen, onRead }: { notices: Notice[]; unread: number; onOpen: (n: Notice) => void; onRead: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} className="icon-btn capp-bell" aria-label="Notifications" onClick={() => (setOpen(true), onRead())}>
        <Bell size={18} />
        {unread > 0 && <i>{unread}</i>}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={320} title="Notifications">
        <div className="sel-pop">
          {notices.length === 0 && <p className="muted small menu-note">Nothing yet.</p>}
          {notices.slice(0, 12).map((n) => (
            <button key={n.id} className="sel-opt" onClick={() => (setOpen(false), onOpen(n))}>
              <span className="sel-label">
                {n.text}
                <small>{relative(n.at)}</small>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function PersonMenu({ person, access, wsName, onInvite, onSignOut, say }: { person: ClientPerson; access: ClientAccess; wsName: string; onInvite: ClientActions['invite']; onSignOut?: () => void; say: (t: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ text: string; link?: string | null } | null>(null);
  return (
    <>
      <button ref={ref} className="capp-me" onClick={() => setOpen(true)} aria-label="Your account">
        <span className="capp-av client">{person.name.charAt(0)}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => (setOpen(false), setInviting(false), setMsg(null))} width={300} title={person.name}>
        <div className="sel-pop">
          <p className="menu-note">
            <b>{person.name}</b>
            <br />
            <small className="muted">
              {person.email} · {person.role === 'approver' ? 'Approver' : person.role === 'viewer' ? 'Viewer' : 'Collaborator'}
            </small>
          </p>
          {access.invites !== 'off' &&
            (inviting ? (
              <div className="capp-invite">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
                {msg && (
                  <p className="small">
                    {msg.text}
                    {msg.link && (
                      <button className="link-btn" onClick={() => void navigator.clipboard?.writeText(msg.link!).then(() => say('Invite link copied'))}>
                        Copy link
                      </button>
                    )}
                  </p>
                )}
                <button
                  className="primary-btn sm"
                  disabled={!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                  onClick={async () => {
                    const r = await onInvite({ name, email });
                    setMsg({ text: r.message, link: r.link });
                    if (r.ok) (setName(''), setEmail(''));
                  }}
                >
                  {access.invites === 'approve' ? 'Ask to add them' : 'Invite'}
                </button>
              </div>
            ) : (
              <button className="sel-opt" onClick={() => setInviting(true)}>
                <UserPlus size={14} /> Invite a colleague
              </button>
            ))}
          {onSignOut && (
            <button className="sel-opt" onClick={() => (setOpen(false), onSignOut())}>
              <LogOut size={14} /> Sign out
            </button>
          )}
          <p className="muted small menu-note">You see what {wsName} shares with you. Questions? Use Requests or Chat.</p>
        </div>
      </Popover>
    </>
  );
}
