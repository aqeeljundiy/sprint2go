import { useState } from 'react';
import { CheckCircle2, Clock, Eye, FileText, Hash, MessageSquare, RotateCcw, Video, X } from 'lucide-react';
import type { Channel, Client, DriveItem, Guest, Meeting, Todo, User, Workspace } from '../types';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { WorkspaceLogo } from './WorkspaceLogo';
import { dueLabel, isBrief, statusOf } from './TasksView';
import { Logo } from './Logo';

interface Props {
  workspace: Workspace;
  client: Client;
  guest: Guest | null; // previewing as this guest
  tasks: Todo[];
  meetings: Meeting[];
  files: DriveItem[];
  channels: Channel[];
  users: User[];
  branded: boolean; // paid plans hide "Made with Sprint2go"
  onApprove: (taskId: string, status: 'approved' | 'changes', note: string, by: string) => void;
  onOpenChannel: (id: string) => void;
  onClose: () => void;
}

/** What a client sees: only what the team marked "Visible to client". Shown here as a preview. */
export function ClientPortal(p: Props) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const shown = p.tasks.filter((t) => t.clientId === p.client.id && t.visibleToClient);
  const briefs = shown.filter(isBrief);
  const work = shown.filter((t) => !isBrief(t));
  const waiting = work.filter((t) => t.approval?.status === 'waiting');
  const decided = work.filter((t) => t.approval && t.approval.status !== 'waiting');
  const meetings = p.meetings.filter((m) => m.clientId === p.client.id && m.sharedWithClient);
  const files = p.files.filter((f) => f.sharedWithClient && !f.trashed && f.kind !== 'folder');
  const chans = p.channels.filter((c) => c.clientId === p.client.id && c.guests?.some((g) => g.email === p.guest?.email));
  const person = (id: string) => p.users.find((u) => u.id === id);
  const by = p.guest?.email ?? `someone@${p.client.domain ?? 'client.com'}`;

  return (
    <div className="portal-scrim">
      <div className="preview-bar">
        <Eye size={15} /> Previewing the client portal as <strong>{p.guest?.name ?? `someone at ${p.client.name}`}</strong>. Only items marked “Visible to client” appear.
        <span className="spacer" />
        <button className="ghost-btn sm" onClick={p.onClose}>
          <X size={14} /> Close preview
        </button>
      </div>
      <div className="portal" style={{ ['--accent' as string]: p.workspace.color }}>
        <header className="portal-head">
          <WorkspaceLogo ws={p.workspace} size={40} />
          <div>
            <p className="portal-kicker">{p.workspace.name} for</p>
            <h1>{p.client.name}</h1>
          </div>
          <span className="spacer" />
          {p.guest && (
            <span className="portal-me">
              <span className="guest-av">{p.guest.name.charAt(0)}</span>
              {p.guest.name}
            </span>
          )}
        </header>

        <div className="portal-body">
          {waiting.length > 0 && (
            <section className="portal-card attention">
              <h2>
                <Clock size={16} /> Waiting for your approval · {waiting.length}
              </h2>
              {waiting.map((t) => (
                <div key={t.id} className="approval">
                  <div className="ap-main">
                    <strong>{t.title}</strong>
                    <small>
                      Asked by {person(t.approval!.askedBy)?.name.split(' ')[0] ?? 'the team'} {relative(t.approval!.askedAt)}
                      {t.due ? ` · due ${dueLabel(t.due).text.toLowerCase()}` : ''}
                    </small>
                  </div>
                  {asking === t.id ? (
                    <div className="ap-changes">
                      <textarea autoFocus value={note[t.id] ?? ''} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} placeholder="What should change?" />
                      <div>
                        <button className="ghost-btn sm" onClick={() => setAsking(null)}>
                          Cancel
                        </button>
                        <button className="primary-btn sm" disabled={!note[t.id]?.trim()} onClick={() => (p.onApprove(t.id, 'changes', note[t.id].trim(), by), setAsking(null))}>
                          Send changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ap-btns">
                      <button className="ghost-btn sm" onClick={() => setAsking(t.id)}>
                        <RotateCcw size={13} /> Request changes
                      </button>
                      <button className="primary-btn sm" onClick={() => p.onApprove(t.id, 'approved', '', by)}>
                        <CheckCircle2 size={14} /> Approve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {briefs.map((b) => {
            const subs = work.filter((t) => t.briefId === b.id);
            const all = p.tasks.filter((t) => t.briefId === b.id);
            const done = all.filter((t) => t.done).length;
            return (
              <section key={b.id} className="portal-card">
                <h2>
                  <FileText size={16} /> {b.title}
                </h2>
                <div className="portal-progress">
                  <span className="bar wide">
                    <span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
                  </span>
                  <span>
                    {done} of {all.length} done{b.due ? ` · due ${dueLabel(b.due).text.toLowerCase()}` : ''}
                  </span>
                </div>
                {b.context && <p className="portal-context">{b.context.split('\n')[0]}</p>}
                <ul className="portal-list">
                  {subs.map((t) => (
                    <li key={t.id}>
                      <span className={`st-dot st-${statusOf(t)}`} />
                      <span className="pl-title">{t.title}</span>
                      <span className="muted small">{statusOf(t) === 'done' ? 'Done' : statusOf(t) === 'doing' ? 'In progress' : 'Planned'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {work.filter((t) => !t.briefId && !t.approval).length > 0 && (
            <section className="portal-card">
              <h2>Other work</h2>
              <ul className="portal-list">
                {work
                  .filter((t) => !t.briefId && !t.approval)
                  .map((t) => (
                    <li key={t.id}>
                      <span className={`st-dot st-${statusOf(t)}`} />
                      <span className="pl-title">{t.title}</span>
                      <span className="muted small">{t.due ? dueLabel(t.due).text : ''}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <div className="portal-two">
            <section className="portal-card">
              <h2>
                <FileText size={16} /> Files · {files.length}
              </h2>
              {files.length === 0 && <p className="muted small">Nothing shared yet.</p>}
              {files.map((f) => (
                <div key={f.id} className="chat-file flat">
                  <span className="cf-icon">
                    <FileText size={16} />
                  </span>
                  <span className="cf-text">
                    <strong>{f.name}</strong>
                    <small>Shared {relative(f.modified)}</small>
                  </span>
                </div>
              ))}
            </section>
            <section className="portal-card">
              <h2>
                <Video size={16} /> Meeting notes · {meetings.length}
              </h2>
              {meetings.length === 0 && <p className="muted small">No notes shared yet.</p>}
              {meetings.map((m) => (
                <div key={m.id} className="portal-meeting">
                  <strong>{m.title}</strong>
                  <small>
                    {relative(m.at)} · {m.minutes} min
                  </small>
                  <p>{m.summary}</p>
                </div>
              ))}
            </section>
          </div>

          {decided.length > 0 && (
            <section className="portal-card">
              <h2>
                <CheckCircle2 size={16} /> Decisions
              </h2>
              <ul className="portal-list">
                {decided.map((t) => (
                  <li key={t.id}>
                    <span className={`ap-tag ${t.approval!.status}`}>{t.approval!.status === 'approved' ? 'Approved' : 'Changes asked'}</span>
                    <span className="pl-title">
                      {t.title}
                      {t.approval!.note && <small className="muted"> “{t.approval!.note}”</small>}
                    </span>
                    <span className="muted small">{t.approval!.at ? relative(t.approval!.at) : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {chans.length > 0 && (
            <section className="portal-card">
              <h2>
                <MessageSquare size={16} /> Talk to the team
              </h2>
              {chans.map((c) => (
                <button key={c.id} className="portal-chan" onClick={() => p.onOpenChannel(c.id)}>
                  <Hash size={14} /> {c.name}
                  <span className="portal-avs">
                    {c.members.slice(0, 4).map((id) => person(id) && <Avatar key={id} person={person(id)!} size={20} />)}
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
        {!p.branded && (
          <footer className="portal-foot">
            Made with <Logo size={14} /> Sprint2go
          </footer>
        )}
      </div>
    </div>
  );
}
