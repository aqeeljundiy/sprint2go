import { useEffect, useMemo, useRef, useState } from 'react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { term } from '../terms';
import {
  Bot,
  CalendarClock,
  CheckSquare,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  Inbox,
  Link2,
  ListChecks,
  Lock,
  Menu,
  MessageCircleQuestion,
  Mic,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { CalEvent, Client, Meeting, MeetingSettings, MeetingType, Role, Todo, User } from '../types';
import { relative, fullDate } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { Popover } from './ui/Popover';

export type MeetPage = { kind: 'list' } | { kind: 'unfiled' } | { kind: 'upcoming' } | { kind: 'tasks' } | { kind: 'folder'; clientId: string } | { kind: 'meeting'; id: string };

export const STATUS_LABEL: Record<NonNullable<Meeting['status']>, string> = {
  queued: 'Queued',
  joining: 'Joining',
  waiting_room: 'Waiting to be let in',
  recording: 'Recording',
  stopping: 'Stopping',
  processing: 'Writing notes',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};
export const LIVE = new Set(['queued', 'joining', 'waiting_room', 'recording', 'stopping', 'processing']);
export const TYPE_LABEL: Record<MeetingType, string> = { sales: 'Sales', get client() { return `${term.One}`; }, internal: 'Internal', hiring: 'Hiring', partner: 'Partner', one_on_one: '1:1', other: 'Other' };
const KEEP_LABEL = { video: 'Video, audio and notes', audio: 'Audio and notes', notes: 'Notes and transcript only' } as const;
export const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const sizeOf = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/* ---------------- Sidebar ---------------- */

export function MeetSidebar({ page, meetings, clients, canSend, onPage, onSend, onAsk, onSettings }: {
  page: MeetPage;
  meetings: Meeting[];
  clients: Client[];
  canSend: boolean;
  onPage: (p: MeetPage) => void;
  onSend: () => void;
  onAsk: () => void;
  onSettings: () => void;
}) {
  const is = (k: MeetPage['kind'], id?: string) => page.kind === k && (!id || ('clientId' in page && page.clientId === id));
  const live = meetings.filter((m) => LIVE.has(m.status ?? 'done')).length;
  const unfiled = meetings.filter((m) => !m.clientId).length;
  return (
    <>
      {canSend && (
        <button className="compose-btn" onClick={onSend} title="Send the notetaker to a meeting">
          <Bot size={16} />
          <span className="sb-label">Send bot to a meeting</span>
        </button>
      )}
      <nav className="nav">
        <button className={`nav-item ${is('list') ? 'active' : ''}`} onClick={() => onPage({ kind: 'list' })} title="Meetings">
          <Video size={17} />
          <span className="sb-label">Meetings</span>
          {live ? <span className="count live-count">{live} live</span> : null}
        </button>
        <button className={`nav-item ${is('upcoming') ? 'active' : ''}`} onClick={() => onPage({ kind: 'upcoming' })} title="Upcoming">
          <CalendarClock size={17} />
          <span className="sb-label">Upcoming</span>
        </button>
        <button className={`nav-item ${is('tasks') ? 'active' : ''}`} onClick={() => onPage({ kind: 'tasks' })} title="Tasks from meetings">
          <ListChecks size={17} />
          <span className="sb-label">Tasks from meetings</span>
        </button>
        <button className="nav-item" onClick={onAsk} title="Ask AI about your meetings">
          <MessageCircleQuestion size={17} />
          <span className="sb-label">Ask AI</span>
        </button>
      </nav>
      <div className="nav-heading sb-label">Folders</div>
      <nav className="nav">
        {clients.map((c) => {
          return (
            <button key={c.id} className={`nav-item ${is('folder', c.id) ? 'active' : ''}`} onClick={() => onPage({ kind: 'folder', clientId: c.id })} title={c.name}>
              <span className="client-dot" style={{ background: c.color }}>
                {c.name.charAt(0)}
              </span>
              <span className="sb-label">{c.name}</span>
            </button>
          );
        })}
        <button className={`nav-item ${is('unfiled') ? 'active' : ''}`} onClick={() => onPage({ kind: 'unfiled' })} title="Unfiled">
          <Inbox size={16} />
          <span className="sb-label">Unfiled</span>
          {unfiled ? <span className="count warn-count" title="Meetings to file">{unfiled}</span> : null}
        </button>
        <button className="nav-item" onClick={onSettings} title="Meeting settings">
          <Folder size={16} />
          <span className="sb-label">Filing rules & settings</span>
        </button>
      </nav>
    </>
  );
}

/* ---------------- Main ---------------- */

export interface MeetProps {
  page: MeetPage;
  meetings: Meeting[];
  clients: Client[];
  tasks: Todo[];
  users: User[];
  me: string;
  myRole: Role;
  events: CalEvent[];
  settings: MeetingSettings;
  overrides: Record<string, boolean>;
  sentEvents: Record<string, string>; // event id -> meeting id
  onPage: (p: MeetPage) => void;
  onStop: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onFolder: (id: string, clientId: string | null, remember: boolean) => void;
  onPatch: (id: string, p: Partial<Meeting>) => void;
  onShare: (id: string) => void;
  onToggleTask: (id: string) => void;
  onPatchTask: (id: string, p: Partial<Todo>) => void;
  onBulk: (ids: string[], action: 'done' | 'reopen' | 'delete') => void;
  onAddTask: (t: { title: string; userId: string; meetingId?: string; due?: string; clientId?: string }) => void;
  onOpenTask: (id: string) => void;
  onOpenClient: (id: string) => void;
  onWriteOverview: (clientId: string) => Promise<void>;
  onJoinMode: (m: NonNullable<MeetingSettings['joinMode']>) => void;
  onOverride: (eventId: string, join: boolean | null) => void;
  onSendNow: (e: CalEvent) => void;
  onAsk: (scope: AskScope) => void;
  onSend: () => void;
  onMenu: () => void;
  toast: (t: string) => void;
}

export type { AskScope } from './Assistant';
import type { AskScope } from './Assistant';

export function MeetView(p: MeetProps) {
  const pg = p.page;
  if (pg.kind === 'meeting') {
    const m = p.meetings.find((x) => x.id === pg.id);
    if (!m)
      return (
        <section className="meet-pane meet-empty view-enter">
          <p className="empty-title">Not found</p>
          <p className="empty-sub">This meeting doesn’t exist in this workspace.</p>
          <button className="ghost-btn" onClick={() => p.onPage({ kind: 'list' })}>
            Back to meetings
          </button>
        </section>
      );
    return <MeetingPage {...p} m={m} />;
  }
  if (pg.kind === 'upcoming') return <Upcoming {...p} />;
  if (pg.kind === 'tasks') return <MeetTasks {...p} />;
  if (pg.kind === 'folder') return <FolderPage {...p} clientId={pg.clientId} />;
  return <MeetingList {...p} unfiled={pg.kind === 'unfiled'} />;
}

function Head({ title, sub, onMenu, children }: { title: React.ReactNode; sub?: React.ReactNode; onMenu: () => void; children?: React.ReactNode }) {
  return (
    <header className="tracking-head">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <div className="th-text">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </header>
  );
}

function StatusPill({ m }: { m: Meeting }) {
  const s = m.status ?? 'done';
  return <span className={`m-status s-${s}`}>{LIVE.has(s) && <i />}{STATUS_LABEL[s]}</span>;
}

function MeetingRows({ list, clients, tasks, onOpen, onFile, showStatusDone = false }: { list: Meeting[]; clients: Client[]; tasks: Todo[]; onOpen: (id: string) => void; onFile?: (id: string, clientId: string) => void; showStatusDone?: boolean }) {
  return (
    <div className="m-rows">
      {list.map((m) => {
        const c = clients.find((x) => x.id === m.clientId);
        const open = tasks.filter((t) => t.meetingId === m.id && !t.done).length;
        return (
          <div key={m.id} className="m-row" role="button" tabIndex={0} onClick={(e) => !(e.target as HTMLElement).closest('.sel, .pop') && onOpen(m.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(m.id)}>
            <span className={`plat ${m.platform ?? 'meet'}`}>{m.platform === 'zoom' ? 'Zm' : 'GM'}</span>
            <span className="m-main">
              <strong>{m.title}</strong>
              <small>
                {fullDate(m.at)}
                {m.type ? ` · ${TYPE_LABEL[m.type]}` : ''}
                {open ? ` · ${open} open task${open > 1 ? 's' : ''}` : ''}
                {m.error && <span className="m-err"> · {m.error}</span>}
              </small>
            </span>
            {c && (
              <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                {c.name}
              </span>
            )}
            {!c && onFile && (!m.status || m.status === 'done') && (
              // Not filed yet: file it right here.
              <span onClick={(e) => e.stopPropagation()}>
                <Select value="" onChange={(v) => onFile(m.id, v)} label="File under" placeholder="File under…" className="sel-flat" options={clients.map((x) => ({ value: x.id, label: x.name }))} />
              </span>
            )}
            {(showStatusDone || m.status !== 'done') && m.status && <StatusPill m={m} />}
          </div>
        );
      })}
    </div>
  );
}

function useFilter(list: Meeting[]) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<string>('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter(
      (m) =>
        (!type || m.type === type) &&
        (!s || m.title.toLowerCase().includes(s) || m.summary.toLowerCase().includes(s) || (m.transcript ?? []).some((l) => l.text.toLowerCase().includes(s))),
    );
  }, [list, q, type]);
  const bar = (placeholder: string) => (
    <div className="m-filters">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      <Select value={type} onChange={setType} label="Type" options={[{ value: '', label: 'All types' }, ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
    </div>
  );
  return { shown, bar, filtering: !!(q || type) };
}

function MeetingList(p: MeetProps & { unfiled: boolean }) {
  const list = [...p.meetings].filter((m) => !p.unfiled || !m.clientId).sort((a, b) => b.at.localeCompare(a.at));
  const { shown, bar, filtering } = useFilter(list);
  return (
    <section className="meet-pane view-enter">
      <Head title={p.unfiled ? 'Unfiled' : 'Meetings'} sub={p.unfiled ? `Meetings that didn’t fit a ${term.one} yet.` : 'Every meeting the notetaker has joined in this workspace.'} onMenu={p.onMenu}>
        <button className="primary-btn sm" onClick={p.onSend}>
          <Bot size={14} /> Send bot
        </button>
      </Head>
      <div className="tracking-scroll">
        {bar('Search titles, notes and transcripts')}
        <MeetingRows list={shown} clients={p.clients} tasks={p.tasks} onOpen={(id) => p.onPage({ kind: 'meeting', id })} onFile={(id, cid) => p.onFolder(id, cid, false)} />
        {shown.length === 0 && <p className="te-empty">{filtering ? 'Nothing matches.' : 'No meetings here yet. Use “Send bot to a meeting”.'}</p>}
      </div>
    </section>
  );
}

/* ---------------- Meeting page ---------------- */

function MeetingPage(p: MeetProps & { m: Meeting }) {
  const { m } = p;
  const [tab, setTab] = useState<'summary' | 'tasks' | 'transcript' | 'log'>('summary');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [askRemember, setAskRemember] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const accessBtn = useRef<HTMLButtonElement>(null);
  const tEnd = useRef<HTMLDivElement>(null);
  const status = m.status ?? 'done';
  const live = LIVE.has(status);
  const client = p.clients.find((c) => c.id === m.clientId);
  const mTasks = p.tasks.filter((t) => t.meetingId === m.id);
  const doneN = mTasks.filter((t) => t.done).length;
  const speakers = [...new Set((m.transcript ?? []).map((l) => l.speaker))];
  const duration = (m.minutes || 1) * 60_000;
  const keep = m.recording?.keep ?? (status === 'done' ? p.settings.keep : undefined);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setTime((x) => (x + 1000 >= duration ? (setPlaying(false), duration) : x + 1000)), 250);
    return () => clearInterval(t);
  }, [playing, duration]);
  useEffect(() => {
    if (tab === 'transcript' && live) tEnd.current?.scrollIntoView({ block: 'end' });
  }, [m.transcript?.length, tab, live]);

  const seek = (ms: number) => {
    setTime(ms);
    if (keep !== 'notes') setPlaying(true);
  };

  const copy = async () => {
    const lines =
      tab === 'summary'
        ? [m.title, '', m.summary, '', 'Key points', ...(m.keyPoints?.length ? m.keyPoints.map((x) => `- ${x}`) : ['- None']), '', 'Decisions', ...(m.decisions?.length ? m.decisions.map((x) => `- ${x}`) : ['- None']), '', 'Open questions', ...(m.openQuestions?.length ? m.openQuestions.map((x) => `- ${x}`) : ['- None'])]
        : tab === 'tasks'
          ? mTasks.map((t) => `[${t.done ? 'x' : ' '}] ${t.title}${t.userId ? ` (${p.users.find((u) => u.id === t.userId)?.name ?? ''})` : ''}${t.due ? `, due ${t.due}` : ''}`)
          : tab === 'transcript'
            ? (m.transcript ?? []).map((l) => `[${mmss(l.at)}] ${l.speaker}: ${l.text}`)
            : (m.log ?? []).map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.message}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      p.toast(`${tab === 'summary' ? 'Summary' : tab === 'tasks' ? 'Tasks' : tab === 'transcript' ? 'Transcript' : 'Bot log'} copied`);
    } catch {
      p.toast('Copying isn’t allowed here');
    }
  };
  const downloadTxt = () => {
    const blob = new Blob([(m.transcript ?? []).map((l) => `[${mmss(l.at)}] ${l.speaker}: ${l.text}`).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transcript-${m.id}.txt`;
    a.click();
  };

  const nameFor = (t: Todo) => p.users.find((u) => u.id === t.userId);
  const actionOwner = (t: Todo) => m.actions.find((a) => a.taskId === t.id)?.owner;

  return (
    <section className="meet-pane meet-page view-enter">
      <header className="tracking-head m-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <button className="link-btn" onClick={() => p.onPage({ kind: 'list' })}>
          Meetings
        </button>
        <StatusPill m={m} />
        <Select
          value={m.clientId ?? ''}
          onChange={(v) => {
            const outsiders = speakers.filter((s) => !p.users.some((u) => u.name.split(' ')[0] === s.split(' ')[0]) && s !== 'You' && s !== `${term.One}`);
            if (v && outsiders.length && m.clientId !== v) setAskRemember(v);
            p.onFolder(m.id, v || null, false);
          }}
          label="Folder"
          className="sel-flat"
          options={[{ value: '', label: 'Unfiled' }, ...p.clients.map((c) => ({ value: c.id, label: c.name, icon: <span className="sel-dot" style={{ background: c.color }} /> }))]}
        />
        <Select value={m.type ?? null} onChange={(v) => p.onPatch(m.id, { type: v as MeetingType })} placeholder="Type…" label="Type" className="sel-flat" options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        {m.filedBy && m.filedBy !== 'user' && <span className="muted small">{m.filedBy === 'ai' ? 'auto-filed' : 'filed by rule'}</span>}
        <span className="spacer" />
        {live && status !== 'stopping' && status !== 'processing' && (
          <button className="ghost-btn sm" onClick={() => p.onStop(m.id)}>
            <Square size={13} /> Make bot leave
          </button>
        )}
        {!live && (m.transcript?.length ?? 0) > 0 && (
          <button className="ghost-btn sm" title="Write the summary and tasks again from the transcript" onClick={() => confirm('Regenerate the summary and tasks from the transcript? Tasks you edited are kept.') && p.onRegenerate(m.id)}>
            <RefreshCw size={13} /> Regenerate notes
          </button>
        )}
        <button className="ghost-btn sm" onClick={() => p.onShare(m.id)}>
          <Share2 size={13} /> {m.share ? 'Shared' : 'Share'}
        </button>
        <button className="icon-btn sm" title="Delete" onClick={() => confirm('Delete this meeting, its recording, transcript and tasks?') && p.onDelete(m.id)}>
          <Trash2 size={15} />
        </button>
      </header>

      <div className="tracking-scroll">
        {askRemember && (
          <div className="remember">
            Always file meetings with {speakers.filter((s) => !p.users.some((u) => u.name.split(' ')[0] === s.split(' ')[0]) && s !== 'You').join(', ')} under {p.clients.find((c) => c.id === askRemember)?.name}?
            <span className="spacer" />
            <button className="ghost-btn sm" onClick={() => setAskRemember(null)}>
              No
            </button>
            <button className="primary-btn sm" onClick={() => (p.onFolder(m.id, askRemember, true), setAskRemember(null))}>
              Yes, always
            </button>
          </div>
        )}
        <h2 className="m-title">{m.title}</h2>
        <p className="m-sub">
          {fullDate(m.at)} · {m.platform === 'zoom' ? 'Zoom' : 'Google Meet'}
          {m.error && <span className="m-err"> · {m.error}</span>}
          {m.attendees.length ? ` · ${m.attendees.length} invited` : ''}
          {m.tags?.map((t) => (
            <span key={t} className="m-tag">
              #{t}
            </span>
          ))}
        </p>

        <div className="m-top">
          <div className="m-video">
            {keep === 'notes' ? (
              <div className="m-novideo">
                <FileText size={22} />
                <strong>Notes and transcript only</strong>
                <span>The recording wasn’t kept for this meeting, to save space.</span>
              </div>
            ) : !keep ? (
              <div className="m-novideo">
                {status === 'recording' ? <span className="rec-dot big" /> : <Video size={22} />}
                <strong>No recording</strong>
                <span>{status === 'recording' ? 'Recording in progress. It appears here when the meeting ends.' : status === 'failed' || status === 'stopped' ? 'There is no recording for this meeting.' : 'The recording appears here after the meeting.'}</span>
              </div>
            ) : (
              <div className={`m-player ${keep}`}>
                {keep === 'audio' && (
                  <span className="voice-wave playing-static">
                    {Array.from({ length: 48 }, (_, i) => (
                      <i key={i} style={{ height: 8 + Math.abs(Math.sin(i * 1.3)) * 30 }} />
                    ))}
                  </span>
                )}
                <button className="m-play" onClick={() => setPlaying((x) => !x)} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <div className="m-bar" onClick={(e) => seek(((e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth) * duration)}>
                  <span style={{ width: `${(time / duration) * 100}%` }} />
                </div>
                <span className="m-time">
                  {mmss(time)} / {mmss(duration)}
                </span>
              </div>
            )}
            {status === 'done' && (
              <div className="keep-row">
                <span className="muted small">Keep:</span>
                <Select
                  value={keep ?? p.settings.keep}
                  onChange={(v) => p.onPatch(m.id, { recording: { keep: v, sizeMb: v === 'video' ? (m.recording?.keep === 'video' ? m.recording.sizeMb : (m.minutes || 30) * 18.3) : v === 'audio' ? (m.minutes || 30) * 0.8 : 0.4 } })}
                  label="What to keep"
                  className="sel-flat"
                  width={280}
                  options={(['video', 'audio', 'notes'] as const).map((k) => ({ value: k, label: KEEP_LABEL[k], hint: k === 'video' ? `About ${sizeOf((m.minutes || 30) * 18.3)}` : k === 'audio' ? `About ${sizeOf((m.minutes || 30) * 0.8)}` : 'Under 1 MB' }))}
                />
                {m.recording && <span className="muted small">{sizeOf(m.recording.sizeMb)} of team storage</span>}
                <button ref={accessBtn} className="link-btn small" onClick={() => setAccessOpen(true)}>
                  <Lock size={12} /> Who can see this
                </button>
              </div>
            )}
            {status === 'done' && keep === 'video' && m.minutes >= 90 && (
              <div className="remember warn">
                This {Math.round(m.minutes / 60)}-hour recording is {sizeOf(m.recording?.sizeMb ?? m.minutes * 18.3)}. Keep the video, or audio and notes only?
                <span className="spacer" />
                <button className="ghost-btn sm" onClick={() => p.onPatch(m.id, { recording: { keep: 'audio', sizeMb: m.minutes * 0.8 } })}>
                  Audio and notes
                </button>
              </div>
            )}
          </div>

          <div className="m-glance side-card">
            <h3>At a glance</h3>
            <dl>
              <dt>Tasks</dt>
              <dd>
                {doneN}/{mTasks.length} done
                <span className="bar wide">
                  <span style={{ width: `${mTasks.length ? (doneN / mTasks.length) * 100 : 0}%` }} />
                </span>
              </dd>
              <dt>Length</dt>
              <dd>{m.minutes ? `${m.minutes} min` : 'not set'}</dd>
              <dt>Speakers</dt>
              <dd>{speakers.length}</dd>
              <dt>People</dt>
              <dd className="chips">
                {(m.attendees.length ? m.attendees : speakers).map((a) => (
                  <span key={a} className="m-person">
                    {a}
                  </span>
                ))}
              </dd>
              {client && (
                <>
                  <dt>{term.One}</dt>
                  <dd>
                    <button className="link-btn" onClick={() => p.onOpenClient(client.id)}>
                      {client.name}
                    </button>
                    {m.sharedWithClient && <span className="ap-tag approved">notes visible to {term.whos}</span>}
                  </dd>
                </>
              )}
            </dl>
            <button className="ghost-btn sm" onClick={() => p.onAsk({ kind: 'meeting', id: m.id })}>
              <Sparkles size={13} /> Ask about this meeting
            </button>
          </div>
        </div>

        <div className="client-tabs m-tabs">
          {(
            [
              ['summary', 'Summary'],
              ['tasks', `Tasks ${mTasks.filter((t) => !t.done).length}`],
              ['transcript', 'Transcript'],
              ['log', 'Bot log'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {l}
            </button>
          ))}
          <span className="spacer" />
          {tab === 'transcript' && (m.transcript?.length ?? 0) > 0 && (
            <button onClick={downloadTxt}>
              <Download size={13} /> Download .txt
            </button>
          )}
          <button onClick={copy}>
            <Copy size={13} /> Copy
          </button>
        </div>

        <TabPane key={tab}>
        {tab === 'summary' &&
          (m.summary ? (
            <div className="m-notes">
              <p className="m-lead">{m.summary}</p>
              {(
                [
                  ['Key points', m.keyPoints],
                  ['Decisions', m.decisions],
                  ['Open questions', m.openQuestions],
                ] as const
              ).map(([h, list]) => (
                <div key={h}>
                  <h4>{h}</h4>
                  {list?.length ? (
                    <ul>
                      {list.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">None</p>
                  )}
                </div>
              ))}
              {!!m.topics?.length && (
                <div>
                  <h4>Topics</h4>
                  <div className="topic-chips">
                    {m.topics.map((t) => (
                      <button key={t.name + t.at} onClick={() => seek(t.at)}>
                        <b>{mmss(t.at)}</b> {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="te-empty">{live ? 'Notes appear here when the meeting ends.' : 'No notes. The bot log says why (notes need a transcript and an AI provider in Settings → AI).'}</p>
          ))}

        {tab === 'tasks' && (
          <TaskList
            {...p}
            list={mTasks}
            meetingFor={() => m}
            ownerName={actionOwner}
            nameFor={nameFor}
            extra={
              mTasks.length > 0 && (
                <button className="ghost-btn sm" onClick={() => confirm(`Remove all ${mTasks.length} tasks from this meeting? The summary stays.`) && (p.onBulk(mTasks.map((t) => t.id), 'delete'), p.toast('Tasks cleared'))}>
                  Clear all tasks
                </button>
              )
            }
            empty={
              m.actions.some((a) => !a.taskId) ? (
                <div className="te-empty">
                  No tasks (automatic tasks are off or were cleared). Action items mentioned in the meeting:
                  <ul>
                    {m.actions.map((a) => (
                      <li key={a.title}>
                        {a.title}
                        {a.owner ? ` · ${a.owner}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="te-empty">No action items.</p>
              )
            }
            footer={
              <div className="todo-add task-add">
                <Plus size={16} />
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newTask.trim() && (p.onAddTask({ title: newTask.trim(), userId: p.me, meetingId: m.id, clientId: m.clientId }), setNewTask(''))} placeholder="Add a task from this meeting…" />
                <button className="primary-btn sm" disabled={!newTask.trim()} onClick={() => (p.onAddTask({ title: newTask.trim(), userId: p.me, meetingId: m.id, clientId: m.clientId }), setNewTask(''))}>
                  Add
                </button>
              </div>
            }
            onSeek={(t) => (setTab('summary'), seek(t))}
          />
        )}

        {tab === 'transcript' && (
          <div className="m-transcript">
            {(m.transcript ?? []).map((l, i) => (
              <button key={i} className={`tl ${time >= l.at && time < (m.transcript![i + 1]?.at ?? Infinity) && playing ? 'now' : ''}`} onClick={() => seek(l.at)}>
                <time>{mmss(l.at)}</time>
                <b>{l.speaker || 'Unknown'}</b>
                <span>{l.text}</span>
              </button>
            ))}
            {!m.transcript?.length && <p className="te-empty">{live ? 'Waiting for people to talk… (captions must be on in the meeting)' : 'No transcript.'}</p>}
            <div ref={tEnd} />
          </div>
        )}

        {tab === 'log' && (
          <pre className="m-log">{(m.log ?? []).map((l) => `${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${l.message}`).join('\n') || 'Nothing logged yet.'}</pre>
        )}
        </TabPane>
      </div>

      <Popover anchor={accessBtn} open={accessOpen} onClose={() => setAccessOpen(false)} width={320} title="Who can see this meeting">
        <div className="access-pop">
          <label>Who can watch the recording</label>
          <Select
            value={m.access?.watch ?? 'everyone'}
            onChange={(v) => p.onPatch(m.id, { access: { watch: v, download: m.access?.download ?? false, transcript: m.access?.transcript ?? 'everyone' } })}
            label="Who can watch"
            options={[
              { value: 'everyone', label: 'Everyone in the company' },
              { value: 'attendees', label: 'Only people who were in the meeting' },
              { value: 'admins', label: 'Only admins' },
            ]}
          />
          <label>Who sees the transcript</label>
          <Select
            value={m.access?.transcript ?? 'everyone'}
            onChange={(v) => p.onPatch(m.id, { access: { watch: m.access?.watch ?? 'everyone', download: m.access?.download ?? false, transcript: v } })}
            label="Transcript"
            options={[
              { value: 'everyone', label: 'Everyone in the company' },
              { value: 'attendees', label: 'Only people who were in the meeting' },
            ]}
          />
          <label className="check-row">
            <input type="checkbox" checked={m.access?.download ?? false} onChange={(e) => p.onPatch(m.id, { access: { watch: m.access?.watch ?? 'everyone', transcript: m.access?.transcript ?? 'everyone', download: e.target.checked } })} /> Allow downloading the recording
          </label>
          {client && (
            <label className="check-row">
              <input type="checkbox" checked={!!m.sharedWithClient} onChange={(e) => p.onPatch(m.id, { sharedWithClient: e.target.checked })} /> {client.name} sees the notes in their portal
            </label>
          )}
          <p className="muted small">Recordings never go to the shared space. Use Share for a read-only link.</p>
        </div>
      </Popover>
    </section>
  );
}

/* ---------------- Tasks (shared) ---------------- */

function TaskList(p: MeetProps & { list: Todo[]; meetingFor: (t: Todo) => Meeting | undefined; ownerName?: (t: Todo) => string | undefined; nameFor: (t: Todo) => User | undefined; extra?: React.ReactNode; empty?: React.ReactNode; footer?: React.ReactNode; onSeek?: (ms: number, t: Todo) => void; grouped?: boolean }) {
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const bulk = (a: 'done' | 'reopen' | 'delete') => {
    if (a === 'delete' && !confirm(`Delete ${sel.size} task${sel.size > 1 ? 's' : ''}?`)) return;
    p.onBulk([...sel], a);
    p.toast(`${sel.size} task${sel.size > 1 ? 's' : ''} ${a === 'done' ? 'marked done' : a === 'reopen' ? 'reopened' : 'deleted'}`);
    setSel(new Set());
    setSelecting(false);
  };
  const groups: [string, Todo[]][] = p.grouped
    ? [...p.list.reduce((map, t) => map.set(t.meetingId ?? '', [...(map.get(t.meetingId ?? '') ?? []), t]), new Map<string, Todo[]>()).entries()]
    : [['', p.list]];
  return (
    <div className="m-tasks">
      <div className="bulk-bar">
        {selecting ? (
          <>
            <label className="check-row">
              <input type="checkbox" checked={sel.size === p.list.length && p.list.length > 0} ref={(el) => {
                if (el) el.indeterminate = sel.size > 0 && sel.size < p.list.length;
              }} onChange={() => setSel(sel.size === p.list.length ? new Set() : new Set(p.list.map((t) => t.id)))} /> All
            </label>
            <span className="muted small">{sel.size} selected</span>
            <button className="ghost-btn sm" disabled={!sel.size} onClick={() => bulk('done')}>
              Mark done
            </button>
            <button className="ghost-btn sm" disabled={!sel.size} onClick={() => bulk('reopen')}>
              Reopen
            </button>
            <button className="ghost-btn sm danger-text" disabled={!sel.size} onClick={() => bulk('delete')}>
              Delete
            </button>
            <button className="link-btn" onClick={() => (setSelecting(false), setSel(new Set()))}>
              Cancel
            </button>
          </>
        ) : (
          <button className="ghost-btn sm" disabled={!p.list.length} onClick={() => setSelecting(true)}>
            <CheckSquare size={13} /> Select
          </button>
        )}
        <span className="spacer" />
        {p.extra}
      </div>
      {p.list.length === 0 && p.empty}
      {groups.map(([mid, list]) => {
        const mt = mid ? p.meetings.find((x) => x.id === mid) : undefined;
        return (
          <div key={mid || 'none'} className="todo-group">
            {p.grouped && (
              <button className="d-heading m-group" onClick={() => mt && p.onPage({ kind: 'meeting', id: mt.id })}>
                {mt ? `${mt.title} · ${fullDate(mt.at)}${mt.clientId ? ` · ${p.clients.find((c) => c.id === mt.clientId)?.name}` : ''}` : 'Added by hand'}
              </button>
            )}
            {list.map((t) => {
              const owner = p.ownerName?.(t);
              const m = p.meetingFor(t);
              return (
                <div key={t.id} className={`task m-task ${t.done ? 'done' : ''}`} onClick={() => selecting && toggle(t.id)}>
                  {selecting && <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} />}
                  <button className="todo-check" onClick={(e) => (e.stopPropagation(), p.onToggleTask(t.id))} aria-label="Toggle done">
                    {t.done && <span>✓</span>}
                  </button>
                  <input className="task-title" value={t.title} onChange={(e) => p.onPatchTask(t.id, { title: e.target.value })} onClick={(e) => e.stopPropagation()} aria-label="Task" />
                  <Select
                    value={t.userId}
                    onChange={(v) => p.onPatchTask(t.id, { userId: v })}
                    label="Assignee"
                    className="sel-flat"
                    options={[
                      { value: '', label: owner && !p.users.some((u) => u.name.split(' ')[0] === owner) ? `${owner} (not a member)` : 'Unassigned' },
                      ...p.users.map((u) => ({ value: u.id, label: u.name, icon: <Avatar person={u} size={18} /> })),
                    ]}
                  />
                  <input className="due-input" value={t.due ?? ''} onChange={(e) => p.onPatchTask(t.id, { due: e.target.value || undefined })} placeholder="No due date" onClick={(e) => e.stopPropagation()} aria-label="Due" />
                  {t.saidAt !== undefined && m && (
                    <button className="jump" onClick={(e) => (e.stopPropagation(), p.onSeek ? p.onSeek(t.saidAt!, t) : p.onPage({ kind: 'meeting', id: m.id }))} title="Jump to when it was said">
                      ▶ {mmss(t.saidAt)}
                    </button>
                  )}
                  <button className="icon-btn sm" onClick={(e) => (e.stopPropagation(), p.onBulk([t.id], 'delete'))} aria-label="Delete task">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      {p.footer}
    </div>
  );
}

function MeetTasks(p: MeetProps) {
  const [tab, setTab] = useState<'open' | 'mine' | 'done' | 'all'>('open');
  const [title, setTitle] = useState('');
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const all = p.tasks.filter((t) => t.meetingId || t.source === 'meeting');
  const list = all.filter((t) => (tab === 'open' ? !t.done : tab === 'mine' ? !t.done && t.userId === p.me : tab === 'done' ? t.done : true));
  return (
    <section className="meet-pane view-enter">
      <Head title="Tasks from meetings" sub="Action items from every meeting, plus your own." onMenu={p.onMenu} />
      <div className="tracking-scroll">
        <div className="client-tabs flat">
          {(['open', 'mine', 'done', 'all'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {k === 'open' ? 'Open' : k === 'mine' ? 'Mine' : k === 'done' ? 'Done' : 'All'}
            </button>
          ))}
        </div>
        <div className="todo-add task-add">
          <Plus size={16} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
          <Select value={who} onChange={setWho} label="Assignee" className="sel-flat" options={[{ value: '', label: 'Unassigned' }, ...p.users.map((u) => ({ value: u.id, label: u.name }))]} />
          <input className="due-input" value={due} onChange={(e) => setDue(e.target.value)} placeholder="Due (e.g. Friday)" />
          <button className="primary-btn sm" disabled={!title.trim()} onClick={() => (p.onAddTask({ title: title.trim(), userId: who, due: due || undefined }), setTitle(''), setDue(''))}>
            Add
          </button>
        </div>
        <TaskList
          {...p}
          list={list}
          grouped
          meetingFor={(t) => p.meetings.find((m) => m.id === t.meetingId)}
          ownerName={(t) => p.meetings.find((m) => m.id === t.meetingId)?.actions.find((a) => a.taskId === t.id)?.owner}
          nameFor={(t) => p.users.find((u) => u.id === t.userId)}
          empty={<p className="te-empty">{tab === 'done' ? 'Nothing finished yet.' : 'No open tasks. Nice.'}</p>}
        />
      </div>
    </section>
  );
}

/* ---------------- Folder (client) ---------------- */

function FolderPage(p: MeetProps & { clientId: string }) {
  const c = p.clients.find((x) => x.id === p.clientId);
  const [tab, setTab] = useState<'meetings' | 'tasks'>('meetings');
  const list = p.meetings.filter((m) => m.clientId === p.clientId).sort((a, b) => b.at.localeCompare(a.at));
  const { shown, bar, filtering } = useFilter(list);
  const tasks = p.tasks.filter((t) => t.meetingId && list.some((m) => m.id === t.meetingId));
  const open = tasks.filter((t) => !t.done).length;
  if (!c) return null;
  return (
    <section className="meet-pane view-enter">
      <Head
        title={
          <>
            <span className="client-dot sm" style={{ background: c.color }}>
              {c.name.charAt(0)}
            </span>{' '}
            {c.name}
          </>
        }
        sub={`${term.One} folder`}
        onMenu={p.onMenu}
      >
        <button className="ghost-btn sm" onClick={() => p.onOpenClient(c.id)}>
          {term.One} page: overview, mail, files
        </button>
        <button className="ghost-btn sm" onClick={() => p.onAsk({ kind: 'client', id: c.id })}>
          <Sparkles size={13} /> Ask AI
        </button>
      </Head>
      <div className="client-tabs">
        {(
          [
            ['meetings', 'Meetings'],
            ['tasks', open ? `Tasks · ${open} open` : 'Tasks'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="tracking-scroll">
        <TabPane key={tab}>
        {tab === 'meetings' && (
          <>
            {bar(`Search this ${term.one}’s meetings`)}
            <MeetingRows list={shown} clients={p.clients} tasks={p.tasks} onOpen={(id) => p.onPage({ kind: 'meeting', id })} />
            {!shown.length && <p className="te-empty">{filtering ? 'Nothing matches.' : 'No meetings yet.'}</p>}
          </>
        )}
        {tab === 'tasks' && (
          <TaskList
            {...p}
            list={tasks}
            grouped
            meetingFor={(t) => p.meetings.find((m) => m.id === t.meetingId)}
            nameFor={(t) => p.users.find((u) => u.id === t.userId)}
            empty={<p className="te-empty">No tasks from these meetings yet. Promises made in a meeting become tasks here.</p>}
          />
        )}
        </TabPane>
      </div>
    </section>
  );
}

/* ---------------- Upcoming ---------------- */

const JOIN_LABEL = { accepted: 'Meetings I organize or accept', organizer: 'Only meetings I organize', all: 'Every meeting with a link', off: 'Off: I pick each one' } as const;
const linkOf = (e: CalEvent) => (/zoom/i.test(e.location ?? '') ? 'zoom' : /meet|google/i.test(e.location ?? '') ? 'meet' : null);

function Upcoming(p: MeetProps) {
  const mode = p.settings.joinMode ?? 'accepted';
  const now = Date.now();
  const soon = p.events.filter((e) => !e.allDay && new Date(e.end).getTime() > now && new Date(e.start).getTime() < now + 7 * 86_400_000).sort((a, b) => a.start.localeCompare(b.start));
  const days = [...new Set(soon.map((e) => new Date(e.start).toDateString()))];
  const dayName = (d: string) => (d === new Date().toDateString() ? 'Today' : d === new Date(now + 86_400_000).toDateString() ? 'Tomorrow' : new Date(d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }));
  const joins = (e: CalEvent) => {
    if (!linkOf(e)) return false;
    if (e.id in p.overrides) return p.overrides[e.id];
    return mode === 'all' || mode === 'accepted' || (mode === 'organizer' && !e.guests?.length);
  };
  return (
    <section className="meet-pane view-enter">
      <Head title="Upcoming" sub={`From your connected calendars · synced ${relative(new Date(now - 3 * 60_000).toISOString())}`} onMenu={p.onMenu}>
        <button className="ghost-btn sm" onClick={() => p.toast('Synced')}>
          <RefreshCw size={13} /> Sync now
        </button>
      </Head>
      <div className="tracking-scroll">
        <div className="side-card upcoming-set">
          <span>
            <strong>Bot joins automatically</strong>
            <small>It joins a minute before each meeting with a Meet or Zoom link. Read-only: it never changes your calendar.</small>
          </span>
          <Select value={mode} onChange={p.onJoinMode} label="Bot joins automatically" width={280} options={Object.entries(JOIN_LABEL).map(([v, l]) => ({ value: v as keyof typeof JOIN_LABEL, label: l }))} />
        </div>
        {days.map((d) => (
          <div key={d} className="todo-group">
            <div className="d-heading">{dayName(d)}</div>
            {soon
              .filter((e) => new Date(e.start).toDateString() === d)
              .map((e) => {
                const link = linkOf(e);
                const mid = p.sentEvents[e.id];
                const mt = mid ? p.meetings.find((x) => x.id === mid) : undefined;
                const startsSoon = new Date(e.start).getTime() - now < 15 * 60_000;
                return (
                  <div key={e.id} className="ev-row">
                    <time>
                      {new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <small>{new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                    </time>
                    <span className="ev-main">
                      <strong>{e.title}</strong>
                      <small>
                        {link === 'zoom' ? 'Zoom' : link === 'meet' ? 'Google Meet' : 'No meeting link'}
                        {e.guests?.length ? ` · ${e.guests.length} other${e.guests.length > 1 ? 's' : ''}` : ''}
                        {e.id in p.overrides ? ' · set by you' : ''}
                      </small>
                    </span>
                    {mt ? (
                      <button className="link-btn" onClick={() => p.onPage({ kind: 'meeting', id: mt.id })}>
                        <StatusPill m={mt} />
                      </button>
                    ) : (
                      link &&
                      startsSoon && (
                        <button className="ghost-btn sm" onClick={() => p.onSendNow(e)}>
                          <Send size={13} /> Send now
                        </button>
                      )
                    )}
                    {link && (
                      <label className="ev-switch" title="Bot joins">
                        <span className="muted small">Bot joins</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={joins(e)}
                          className={`switch ${joins(e) ? 'on' : ''}`}
                          onClick={() => {
                            const want = !joins(e);
                            const byRule = mode === 'all' || mode === 'accepted' || (mode === 'organizer' && !e.guests?.length);
                            p.onOverride(e.id, want === byRule ? null : want);
                          }}
                        >
                          <span />
                        </button>
                      </label>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
        {!soon.length && <p className="te-empty">No meetings in the next 7 days. Connect a calendar in Calendar, or send the bot to a meeting link.</p>}
      </div>
    </section>
  );
}

/* ---------------- Send bot ---------------- */

export function SendBotDialog({ clients, botName, onSend, onClose }: { clients: Client[]; botName: string; onSend: (d: { url: string; title: string; botName: string; clientId: string }) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [err, setErr] = useState('');
  const send = () => {
    if (!/^https?:\/\/(meet\.google\.com|[\w.-]*zoom\.us)\//i.test(url.trim())) return setErr('Paste a Google Meet or Zoom link');
    onSend({ url: url.trim(), title: title.trim(), botName: name.trim() || botName, clientId });
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Send the bot to a meeting" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Bot size={15} /> Send the bot to a meeting
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
          <p className="modal-intro">Paste a Google Meet or Zoom link. Someone in the call has to let the bot in.</p>
          <label className="field">
            <span>Meeting link</span>
            <input autoFocus value={url} onChange={(e) => (setUrl(e.target.value), setErr(''))} placeholder="https://meet.google.com/abc-defg-hij" onKeyDown={(e) => e.key === 'Enter' && send()} />
          </label>
          {err && <p className="err">{err}</p>}
          <label className="field">
            <span>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync with…" />
          </label>
          <label className="field">
            <span>Bot name (optional, for this meeting)</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={botName} />
          </label>
          <div className="field">
            <span>Folder (optional, otherwise filed automatically)</span>
            <Select value={clientId} onChange={setClientId} label="Folder" options={[{ value: '', label: 'Auto' }, ...clients.map((c) => ({ value: c.id, label: c.name, icon: <span className="sel-dot" style={{ background: c.color }} /> }))]} />
          </div>
          <p className="muted small">Demo: no real bot is sent. You’ll see it join, record a short sample conversation and write the notes.</p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={send}>
            <Send size={14} /> Send bot
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ---------------- Share ---------------- */

export function ShareDialog({ m, onSave, onOff, onPreview, onClose, toast }: { m: Meeting; onSave: (opts: { transcript: boolean; video: boolean }) => void; onOff: () => void; onPreview: () => void; onClose: () => void; toast: (t: string) => void }) {
  const hasVideo = m.recording?.keep === 'video' || m.recording?.keep === 'audio';
  const [transcript, setTranscript] = useState(m.share?.transcript ?? true);
  const [video, setVideo] = useState(m.share?.video ?? hasVideo);
  const link = m.share ? `https://meet.sprint2go.com/s/${m.share.token}` : '';
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Share this meeting" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Link2 size={15} /> Share this meeting
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <p className="modal-intro">Anyone with the link can view a read-only page: summary and tasks, plus the parts you allow below. No login needed.</p>
          <label className="set-row toggle-row">
            <span>
              <strong>Include transcript</strong>
              <small>The full conversation, line by line</small>
            </span>
            <button type="button" role="switch" aria-checked={transcript} className={`switch ${transcript ? 'on' : ''}`} onClick={() => setTranscript(!transcript)}>
              <span />
            </button>
          </label>
          <label className="set-row toggle-row">
            <span>
              <strong>Include recording</strong>
              <small>{hasVideo ? 'The meeting recording' : 'This meeting has no recording'}</small>
            </span>
            <button type="button" role="switch" disabled={!hasVideo} aria-checked={video && hasVideo} className={`switch ${video && hasVideo ? 'on' : ''}`} onClick={() => setVideo(!video)}>
              <span />
            </button>
          </label>
          {link && (
            <div className="share-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="ghost-btn sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'), () => toast('Copying isn’t allowed here'))}>
                Copy link
              </button>
              <button className="link-btn" onClick={onPreview}>
                <Eye size={13} /> Preview
              </button>
            </div>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {link && (
            <button className="ghost-btn danger-text" onClick={() => confirm('Turn off this link? People who have it will no longer see the meeting.') && onOff()}>
              Turn off link
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Close
          </button>
          <button className="primary-btn" onClick={() => onSave({ transcript, video: video && hasVideo })}>
            {link ? 'Save' : 'Create link'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SharedPage({ m, brand, tasks, users, onClose }: { m: Meeting; brand: string; tasks: Todo[]; users: User[]; onClose: () => void }) {
  const opts = m.share ?? { transcript: false, video: false };
  return (
    <div className="portal-scrim">
      <div className="preview-bar">
        <Eye size={15} /> Preview of the public link. People see this without signing in.
        <span className="spacer" />
        <button className="ghost-btn sm" onClick={onClose}>
          <X size={14} /> Close preview
        </button>
      </div>
      <div className="portal">
        <p className="portal-kicker">{brand} · Shared meeting · read only</p>
        <h1 className="m-title">{m.title}</h1>
        <p className="m-sub">
          {fullDate(m.at)} · {m.minutes} min · {m.attendees.join(', ')}
        </p>
        {opts.video && (
          <div className="m-player video">
            <span className="m-play">
              <Play size={20} />
            </span>
          </div>
        )}
        <div className="portal-card">
          <h2>Notes</h2>
          <p>{m.summary || 'No summary for this meeting.'}</p>
          {(
            [
              ['Key points', m.keyPoints],
              ['Decisions', m.decisions],
              ['Open questions', m.openQuestions],
            ] as const
          ).map(([h, l]) =>
            l?.length ? (
              <div key={h}>
                <h4>{h}</h4>
                <ul>
                  {l.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
        <div className="portal-card">
          <h2>Action items</h2>
          <ul className="portal-list">
            {tasks.map((t) => (
              <li key={t.id}>
                {t.done ? '✓' : '○'} <span className="pl-title">{t.title}</span>
                <span className="muted small">
                  {users.find((u) => u.id === t.userId)?.name.split(' ')[0] ?? ''}
                  {t.due ? ` · due ${t.due}` : ''}
                </span>
              </li>
            ))}
            {!tasks.length && m.actions.map((a) => <li key={a.title}>○ {a.title}</li>)}
          </ul>
        </div>
        {opts.transcript && (
          <div className="portal-card">
            <h2>Transcript</h2>
            <div className="m-transcript">
              {(m.transcript ?? []).map((l, i) => (
                <div key={i} className="tl">
                  <time>{mmss(l.at)}</time>
                  <b>{l.speaker}</b>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { Mic as MeetIcon };
