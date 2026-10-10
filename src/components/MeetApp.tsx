import { TabBar } from './ui/TabBar';
import { ProjectBadge } from './ProjectBadge';
import { MEETING_LANGUAGES, languageLabel, languagesLabel } from '../data/languages';
import { t, tn, tx, mark } from '../i18n';
import { fmtDate, fmtList, fmtNumber, fmtTime, fmtDay } from '../i18n/format';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
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
  MoreHorizontal,
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
  EllipsisVertical,
  Tag,
  Users,
  CircleCheck,
  Languages,
} from 'lucide-react';
import type { CalEvent, Client, Meeting, MeetingSettings, MeetingType, Role, Todo, User, Workspace } from '../types';
import { relative, fullDate } from '../utils';
import { JOIN_MODES, MEETING_NAME, joinsByRule, meetingLinkOf, notetakerJoins, type MeetingKind } from '../meetingLinks';
import { isMine } from '../identity';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { Popover } from './ui/Popover';

export type MeetPage = { kind: 'list' } | { kind: 'unfiled' } | { kind: 'upcoming' } | { kind: 'tasks' } | { kind: 'folder'; clientId: string } | { kind: 'meeting'; id: string };

/** A meeting's status. Show it with t(). */
export const STATUS_LABEL: Record<NonNullable<Meeting['status']>, string> = {
  queued: mark('Queued'),
  joining: mark('Joining'),
  waiting_room: mark('Waiting to be let in'),
  recording: mark('Recording'),
  stopping: mark('Stopping'),
  processing: mark('Writing notes'),
  done: mark('Done'),
  failed: mark('Failed'),
  stopped: mark('Stopped'),
};
export const LIVE = new Set(['queued', 'joining', 'waiting_room', 'recording', 'stopping', 'processing']);
// Getters: the words come in the language on screen when they're read.
export const TYPE_LABEL: Record<MeetingType, string> = {
  get sales() { return t('Sales'); },
  get client() { return term.One; },
  get internal() { return t('Internal'); },
  get hiring() { return t('Hiring'); },
  get partner() { return t('Partner'); },
  one_on_one: '1:1',
  get other() { return t('Other'); },
};
// Video is a company choice (Beta); a meeting only shows video when the bot actually recorded it.
const KEEP_LABEL = { video: mark('Video, audio and notes'), audio: mark('Audio and notes'), notes: mark('Notes and transcript only') } as const;
export const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const sizeOf = (mb: number) => (mb >= 1000 ? `${fmtNumber(mb / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB` : mb < 1 ? t('Under 1 MB') : `${fmtNumber(Math.round(mb))} MB`);
/** A log line's time with seconds: "14:30:05" / "14.30.05". */
const logTime = (at: string) => fmtDate(at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** "45 min", "1 h 20 min" / "45 menit", "1 jam 20 menit". */
const hoursOf = (min: number) => {
  const all = Math.round(min);
  const h = Math.floor(all / 60);
  const m = all % 60;
  return h ? (m ? t('{h} h {m} min', { h, m }) : tn(h, '{n} h', '{n} h')) : tn(all, '{n} min', '{n} min');
};

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
        <button className="compose-btn" onClick={onSend} title={t('Send the notetaker to a meeting')}>
          <Bot size={16} />
          <span className="sb-label">{t('Send bot to a meeting')}</span>
        </button>
      )}
      <nav className="nav">
        <button className={`nav-item ${is('list') ? 'active' : ''}`} onClick={() => onPage({ kind: 'list' })} title={tx('meet', 'Meetings')}>
          <Video size={17} />
          <span className="sb-label">{tx('meet', 'Meetings')}</span>
          {live ? <span className="count live-count">{tn(live, '{n} live', '{n} live')}</span> : null}
        </button>
        <button className={`nav-item ${is('upcoming') ? 'active' : ''}`} onClick={() => onPage({ kind: 'upcoming' })} title={t('Upcoming')}>
          <CalendarClock size={17} />
          <span className="sb-label">{t('Upcoming')}</span>
        </button>
        <button className={`nav-item ${is('tasks') ? 'active' : ''}`} onClick={() => onPage({ kind: 'tasks' })} title={t('Tasks from meetings')}>
          <ListChecks size={17} />
          <span className="sb-label">{t('Tasks from meetings')}</span>
        </button>
        <button className="nav-item" onClick={onAsk} title={t('Ask AI about your meetings')}>
          <MessageCircleQuestion size={17} />
          <span className="sb-label">{t('Ask AI')}</span>
        </button>
      </nav>
      <div className="nav-heading sb-label">{t('Folders')}</div>
      <nav className="nav">
        {clients.map((c) => {
          return (
            <button key={c.id} className={`nav-item ${is('folder', c.id) ? 'active' : ''}`} onClick={() => onPage({ kind: 'folder', clientId: c.id })} title={c.name}>
              <ProjectBadge p={c} kind="client-dot" />
              <span className="sb-label">{c.name}</span>
            </button>
          );
        })}
        <button className={`nav-item ${is('unfiled') ? 'active' : ''}`} onClick={() => onPage({ kind: 'unfiled' })} title={t('Unfiled')}>
          <Inbox size={16} />
          <span className="sb-label">{t('Unfiled')}</span>
          {unfiled ? <span className="count warn-count" title={t('Meetings to file')}>{unfiled}</span> : null}
        </button>
        <button className="nav-item" onClick={onSettings} title={t('Meeting settings')}>
          <Folder size={16} />
          <span className="sb-label">{t('Filing rules & settings')}</span>
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
  onTranscribeAgain?: (id: string, language?: string) => void; // real recordings: transcribe the audio again, then rewrite the notes
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
  /** The notetaker joining by itself: live (the recorder answers), the demo's switches, or not available here. */
  autoJoin: 'live' | 'demo' | 'off';
  demo?: boolean; // the demo: events that only say "Zoom" or "Google Meet" count as having a link
  calendarsSyncedAt?: string; // when the outside calendars were last read
  onSyncCalendars?: () => void;
  onAsk: (scope: AskScope) => void;
  onSend: () => void;
  canSendBot?: boolean; // the notetaker works here (else Meet has no create button on phones)
  onMenu: () => void;
  toast: (t: string) => void;
  /** Phones: the company at the top of Meet's drawer, Meet's settings pages, and opening a calendar event. */
  company?: Pick<Workspace, 'name' | 'logo' | 'color'>;
  appSettings?: { id: string; label: string; hint?: string; run: () => void }[];
  onOpenEvent?: (id: string) => void;
}

export type { AskScope } from './Assistant';
import type { AskScope } from './Assistant';
import { personOption } from './ui/PeopleList';
import { EmptyState } from './ui/EmptyState';
import { DatePicker } from './ui/DatePicker';
import { useCreateAction, useFocusedScreen } from '../mobile/chrome';
import { useActionMenu } from './ui/ActionSheet';
import { usePhone } from '../mobile/media';
import { TopBar, TopBarBack, TopBarButton } from '../mobile/TopBar';
import { useEdgeSwipe } from './ui/SideDrawer';
import { CallMark, callOf, MeetDrawer, MeetHome, MeetSettingsScreen, MeetUpcomingScreen } from './MeetPhone';
import { Sheet } from './ui/Sheet';

export function MeetView(p: MeetProps) {
  const pg = p.page;
  const phone = usePhone();
  // Phones: Google Meet's "Take notes" (send the notetaker to a call), and Calendar's drawer for Meet's pages.
  useCreateAction('meet', p.canSendBot !== false && (phone ? { label: t('Take notes'), icon: Mic, run: p.onSend } : { label: t('Send the notetaker'), icon: Bot, run: p.onSend }));
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEdgeSwipe(() => setDrawer(true), phone && pg.kind !== 'meeting');
  const phoneChrome = phone && (
    <>
      {pg.kind !== 'meeting' && (
        <TopBar
          app="meet"
          lead={<TopBarButton icon={Menu} label={t('Menu')} onClick={() => setDrawer(true)} />}
          title={
            <h1 className="mt-title plain">
              <span className="mt-title-text">{t('Meet')}</span>
            </h1>
          }
        />
      )}
      {drawer && <MeetDrawer page={pg} clients={p.clients} meetings={p.meetings} company={p.company} onPage={p.onPage} onClose={() => setDrawer(false)} onSettings={() => setSettingsOpen(true)} />}
      {settingsOpen && <MeetSettingsScreen settings={p.settings} rows={p.appSettings ?? []} myRole={p.myRole} autoJoin={p.autoJoin} onJoinMode={p.onJoinMode} onBack={() => setSettingsOpen(false)} />}
    </>
  );
  if (phone && (pg.kind === 'list' || pg.kind === 'unfiled' || pg.kind === 'upcoming'))
    return (
      <>
        {phoneChrome}
        <MeetHome {...p} unfiled={pg.kind === 'unfiled'} />
        {pg.kind === 'upcoming' && <MeetUpcomingScreen {...p} onBack={() => p.onPage({ kind: 'list' })} />}
      </>
    );
  if (phone && pg.kind !== 'meeting')
    return (
      <>
        {phoneChrome}
        {pg.kind === 'tasks' ? <MeetTasks {...p} /> : pg.kind === 'folder' ? <FolderPage {...p} clientId={pg.clientId} /> : null}
      </>
    );
  if (pg.kind === 'meeting') {
    const m = p.meetings.find((x) => x.id === pg.id);
    if (!m)
      return (
        <section className="meet-pane meet-empty view-enter">
          <EmptyState
            title={t('Not found')}
            text={t('This meeting doesn’t exist in this workspace.')}
            action={
              <button className="ghost-btn" onClick={() => p.onPage({ kind: 'list' })}>
                {t('Back to meetings')}
              </button>
            }
          />
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
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
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
  return <span className={`m-status s-${s}`}>{LIVE.has(s) && <i />}{t(STATUS_LABEL[s])}</span>;
}

function MeetingRows({ list, clients, tasks, onOpen, onFile, showStatusDone = false }: { list: Meeting[]; clients: Client[]; tasks: Todo[]; onOpen: (id: string) => void; onFile?: (id: string, clientId: string) => void; showStatusDone?: boolean }) {
  return (
    <div className="m-rows">
      {list.map((m) => {
        const c = clients.find((x) => x.id === m.clientId);
        const open = tasks.filter((tk) => tk.meetingId === m.id && !tk.done).length;
        return (
          <div key={m.id} className="m-row" role="button" tabIndex={0} onClick={(e) => !(e.target as HTMLElement).closest('.sel, .pop') && onOpen(m.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(m.id)}>
            <span className={`plat ${m.platform ?? 'meet'}`}>{m.platform === 'zoom' ? 'Zm' : 'GM'}</span>
            <span className="m-main">
              <strong>{m.title}</strong>
              <small>
                {fullDate(m.at)}
                {m.type ? ` · ${TYPE_LABEL[m.type]}` : ''}
                {open ? ` · ${tn(open, '{n} open task', '{n} open tasks')}` : ''}
                {m.error && <span className="m-err"> · {t(m.error)}</span>}
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
                <Select value="" onChange={(v) => onFile(m.id, v)} label={t('File under')} placeholder={t('File under…')} className="sel-flat" options={clients.map((x) => ({ value: x.id, label: x.name }))} />
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
      <Select value={type} onChange={setType} label={t('Type')} options={[{ value: '', label: t('All types') }, ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
    </div>
  );
  return { shown, bar, filtering: !!(q || type) };
}

function MeetingList(p: MeetProps & { unfiled: boolean }) {
  const list = [...p.meetings].filter((m) => !p.unfiled || !m.clientId).sort((a, b) => b.at.localeCompare(a.at));
  const { shown, bar, filtering } = useFilter(list);
  return (
    <section className="meet-pane view-enter">
      <Head title={p.unfiled ? t('Unfiled') : t('Meetings')} sub={p.unfiled ? t('Meetings that didn’t fit a {project} yet.', { project: term.one }) : t('Every meeting the notetaker has joined in this workspace.')} onMenu={p.onMenu}>
        <button className="primary-btn sm" onClick={p.onSend}>
          <Bot size={14} /> {t('Send bot')}
        </button>
      </Head>
      <div className="tracking-scroll">
        {bar(t('Search titles, notes and transcripts'))}
        <MeetingRows list={shown} clients={p.clients} tasks={p.tasks} onOpen={(id) => p.onPage({ kind: 'meeting', id })} onFile={(id, cid) => p.onFolder(id, cid, false)} />
        {shown.length === 0 && <EmptyState compact text={filtering ? t('Nothing matches.') : t('No meetings here yet. Use “{send}”.', { send: t('Send bot to a meeting') })} />}
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
  const mTasks = p.tasks.filter((tk) => tk.meetingId === m.id);
  const doneN = mTasks.filter((tk) => tk.done).length;
  const speakers = [...new Set((m.transcript ?? []).map((l) => l.speaker))];
  const rawKeep = m.recording?.keep ?? (status === 'done' ? p.settings.keep : undefined);
  const keep = rawKeep === 'video' && !m.recording?.videoUrl ? 'audio' : rawKeep; // demo and older meetings have no real video
  // A real recording from the bot plays through <audio> or <video>; demo meetings run the same controls on a timer.
  const audio = useRef<HTMLMediaElement>(null);
  const real = (keep === 'audio' || keep === 'video') && !!m.recording?.url;
  const isVideo = keep === 'video' && !!m.recording?.videoUrl;
  const duration = real && m.recording?.seconds ? m.recording.seconds * 1000 : (m.minutes || 1) * 60_000;

  useEffect(() => {
    if (real) {
      const a = audio.current;
      if (a) void (playing ? a.play().catch(() => setPlaying(false)) : a.pause());
      return;
    }
    if (!playing) return;
    const timer = setInterval(() => setTime((x) => (x + 1000 >= duration ? (setPlaying(false), duration) : x + 1000)), 250);
    return () => clearInterval(timer);
  }, [playing, duration, real]);
  useEffect(() => {
    if (tab === 'transcript' && live) tEnd.current?.scrollIntoView({ block: 'end' });
  }, [m.transcript?.length, tab, live]);

  const seek = (ms: number) => {
    setTime(ms);
    if (real && audio.current) audio.current.currentTime = ms / 1000;
    if (keep !== 'notes') setPlaying(true);
  };

  const copy = async () => {
    const section = (h: string, list?: string[]) => ['', t(h), ...(list?.length ? list.map((x) => `- ${x}`) : [`- ${t('None')}`])];
    const taskLine = (tk: Todo) => {
      const who = tk.userId ? p.users.find((u) => u.id === tk.userId)?.name : undefined;
      const task = who ? `${tk.title} (${who})` : tk.title;
      return `[${tk.done ? 'x' : ' '}] ${tk.due ? t('{task}, due {due}', { task, due: fmtDay(tk.due) }) : task}`;
    };
    const lines =
      tab === 'summary'
        ? [m.title, '', m.summary, ...section(mark('Key points'), m.keyPoints), ...section(mark('Decisions'), m.decisions), ...section(mark('Open questions'), m.openQuestions)]
        : tab === 'tasks'
          ? mTasks.map(taskLine)
          : tab === 'transcript'
            ? (m.transcript ?? []).map((l) => `[${mmss(l.at)}] ${l.speaker}: ${l.text}`)
            : (m.log ?? []).map((l) => `${logTime(l.at)}  ${l.message}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      p.toast(tab === 'summary' ? t('Summary copied') : tab === 'tasks' ? t('Tasks copied') : tab === 'transcript' ? t('Transcript copied') : t('Bot log copied'));
    } catch {
      p.toast(t('Copying isn’t allowed here'));
    }
  };
  const downloadTxt = () => {
    const blob = new Blob([(m.transcript ?? []).map((l) => `[${mmss(l.at)}] ${l.speaker}: ${l.text}`).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transcript-${m.id}.txt`;
    a.click();
  };

  const nameFor = (tk: Todo) => p.users.find((u) => u.id === tk.userId);
  const actionOwner = (tk: Todo) => m.actions.find((a) => a.taskId === tk.id)?.owner;

  // Phones: the meeting takes the whole screen with Back to the list, and its actions sit in one "…" menu so the
  // header stays one row (the desktop keeps its buttons).
  const phone = usePhone();
  useFocusedScreen(true, phone ? undefined : () => p.onPage({ kind: 'list' }));
  const moreBtn = useRef<HTMLButtonElement>(null);
  const regenerate = () => confirm(t('Regenerate the summary and tasks from the transcript? Tasks you edited are kept.')) && p.onRegenerate(m.id);
  const remove = () => confirm(t('Delete this meeting, its recording, transcript and tasks?')) && p.onDelete(m.id);
  const more = useActionMenu(
    () => [
      { label: m.share ? t('Shared') : t('Share'), hint: m.share ? t('A read-only link is on') : t('A read-only link'), icon: Share2, run: () => p.onShare(m.id) },
      { label: t('Ask about this meeting'), icon: Sparkles, run: () => p.onAsk({ kind: 'meeting', id: m.id }) },
      ...(live && status !== 'stopping' && status !== 'processing' ? [{ label: t('Make bot leave'), icon: Square, run: () => p.onStop(m.id) }] : []),
      ...(!live && (m.transcript?.length ?? 0) > 0 ? [{ label: t('Regenerate notes'), hint: t('From the transcript'), icon: RefreshCw, run: regenerate }] : []),
      ...(status === 'done' ? [{ label: t('Who can see this'), icon: Lock, run: () => setAccessOpen(true) }] : []),
      ...(phone ? [{ label: t('Bot log'), hint: t('What the notetaker did, step by step'), icon: FileText, run: () => setTab('log') }] : []),
      { label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: remove },
    ],
    { title: m.title, menu: phone },
  );
  // Phones: Google's details page: Back, then Share and ⋮ at the top right.
  const phoneBar = phone && (
    <TopBar
      app="meet"
      lead={<TopBarBack onClick={() => p.onPage({ kind: 'list' })} />}
      title={<span className="mt-empty-title" />}
      search={false}
      actions={
        <>
          <TopBarButton icon={Share2} label={m.share ? t('Shared') : t('Share')} onClick={() => p.onShare(m.id)} />
          <button ref={moreBtn} type="button" className="icon-btn mt-btn" aria-label={t('More for this meeting')} onClick={() => more.openFrom(moreBtn)}>
            <EllipsisVertical size={22} />
          </button>
        </>
      }
    />
  );

  return (
    <section className="meet-pane meet-page view-enter">
      {phoneBar}
      <header className="tracking-head m-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <button className="link-btn" onClick={() => p.onPage({ kind: 'list' })}>
          {t('Meetings')}
        </button>
        <StatusPill m={m} />
        <ProjectPicker value={m.clientId ?? ''} onChange={(v) => {
            const outsiders = speakers.filter((s) => !p.users.some((u) => u.name.split(' ')[0] === s.split(' ')[0]) && s !== 'You' && s !== `${term.One}`);
            if (v && outsiders.length && m.clientId !== v) setAskRemember(v);
            p.onFolder(m.id, v || null, false);
          }} projects={p.clients} none={t('Unfiled')} label={t('Folder')} className="sel-flat" />
        <Select value={m.type ?? null} onChange={(v) => p.onPatch(m.id, { type: v as MeetingType })} placeholder={t('Type…')} label={t('Type')} className="sel-flat" options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        {m.filedBy && m.filedBy !== 'user' && <span className="muted small">{m.filedBy === 'ai' ? t('auto-filed') : t('filed by rule')}</span>}
        <span className="spacer" />
        {live && status !== 'stopping' && status !== 'processing' && (
          <button className="ghost-btn sm" onClick={() => p.onStop(m.id)}>
            <Square size={13} /> {t('Make bot leave')}
          </button>
        )}
        {!live && (m.transcript?.length ?? 0) > 0 && (
          <button className="ghost-btn sm" title={t('Write the summary and tasks again from the transcript')} onClick={regenerate}>
            <RefreshCw size={13} /> {t('Regenerate notes')}
          </button>
        )}
        <button className="ghost-btn sm" onClick={() => p.onShare(m.id)}>
          <Share2 size={13} /> {m.share ? t('Shared') : t('Share')}
        </button>
        <button className="icon-btn sm m-delete" title={t('Delete')} onClick={remove}>
          <Trash2 size={15} />
        </button>
        {!phone && (
          <button ref={moreBtn} className="icon-btn m-more" aria-label={t('More for this meeting')} onClick={() => more.openFrom(moreBtn)}>
            <MoreHorizontal size={20} />
          </button>
        )}
        {more.menu}
      </header>

      <div className="tracking-scroll">
        {askRemember && (
          <div className="remember">
            {t('Always file meetings with {people} under {project}?', { people: fmtList(speakers.filter((s) => !p.users.some((u) => u.name.split(' ')[0] === s.split(' ')[0]) && s !== 'You')), project: p.clients.find((c) => c.id === askRemember)?.name ?? '' })}
            <span className="spacer" />
            <button className="ghost-btn sm" onClick={() => setAskRemember(null)}>
              {t('No')}
            </button>
            <button className="primary-btn sm" onClick={() => (p.onFolder(m.id, askRemember, true), setAskRemember(null))}>
              {t('Yes, always')}
            </button>
          </div>
        )}
        <h2 className="m-title">{m.title}</h2>
        <p className="m-sub">
          {fullDate(m.at)} · {m.platform === 'zoom' ? 'Zoom' : 'Google Meet'}
          {m.error && <span className="m-err"> · {t(m.error)}</span>}
          {m.attendees.length ? ` · ${tn(m.attendees.length, '{n} invited', '{n} invited')}` : ''}
          {m.tags?.map((tag) => (
            <span key={tag} className="m-tag">
              #{tag}
            </span>
          ))}
        </p>
        {live && phone && (
          <p className="m-live">
            <i /> {t(STATUS_LABEL[status])}
          </p>
        )}
        {phone && (
          // Phones: the meeting's facts as rows (Calendar's details), where the desktop has "At a glance".
          <div className="m-facts">
            <div className="dr-row">
              <span className="dr-icon">
                <Folder size={20} />
              </span>
              <ProjectPicker
                value={m.clientId ?? ''}
                onChange={(v) => {
                  const outsiders = speakers.filter((s) => !p.users.some((u) => u.name.split(' ')[0] === s.split(' ')[0]) && s !== 'You' && s !== `${term.One}`);
                  if (v && outsiders.length && m.clientId !== v) setAskRemember(v);
                  p.onFolder(m.id, v || null, false);
                }}
                projects={p.clients}
                none={t('Unfiled')}
                label={t('Folder')}
                className="er-sel"
              />
            </div>
            <div className="dr-row">
              <span className="dr-icon">
                <Tag size={20} />
              </span>
              <Select value={m.type ?? null} onChange={(v) => p.onPatch(m.id, { type: v as MeetingType })} placeholder={t('Type…')} label={t('Type')} className={`er-sel${m.type ? '' : ' er-empty'}`} options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
            </div>
            {(m.attendees.length > 0 || speakers.length > 0) && (
              <div className="dr-row">
                <span className="dr-icon">
                  <Users size={20} />
                </span>
                <span className="dr-text">{fmtList(m.attendees.length ? m.attendees : speakers)}</span>
              </div>
            )}
            <button type="button" className="dr-row dr-main" onClick={() => setTab('tasks')}>
              <span className="dr-icon">
                <CircleCheck size={20} />
              </span>
              <span className="dr-text">{t('{done} of {total} done', { done: doneN, total: mTasks.length })}</span>
            </button>
          </div>
        )}

        <div className="m-top">
          <div className="m-video">
            {keep === 'notes' ? (
              <div className="m-novideo">
                <FileText size={22} />
                <strong>{t('Notes and transcript only')}</strong>
                <span>{t('The recording wasn’t kept for this meeting, to save space.')}</span>
              </div>
            ) : !keep ? (
              <div className="m-novideo">
                {status === 'recording' ? <span className="rec-dot big" /> : <Video size={22} />}
                <strong>{t('No recording')}</strong>
                <span>{status === 'recording' ? t('Recording in progress. It appears here when the meeting ends.') : status === 'failed' || status === 'stopped' ? t('There is no recording for this meeting.') : t('The recording appears here after the meeting.')}</span>
              </div>
            ) : (
              <div className={`m-player ${keep}${playing ? ' is-playing' : ''}`}>
                {isVideo ? (
                  <video ref={audio as React.RefObject<HTMLVideoElement>} className="m-video-el" src={m.recording!.videoUrl} preload="metadata" playsInline onClick={() => setPlaying((x) => !x)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime * 1000)} onEnded={() => setPlaying(false)} />
                ) : (
                  real && <audio ref={audio as React.RefObject<HTMLAudioElement>} src={m.recording!.url} preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime * 1000)} onEnded={() => setPlaying(false)} />
                )}
                {keep === 'audio' && (
                  <span className="voice-wave playing-static">
                    {Array.from({ length: 48 }, (_, i) => (
                      <i key={i} style={{ height: 8 + Math.abs(Math.sin(i * 1.3)) * 30 }} />
                    ))}
                  </span>
                )}
                <button className="m-play" onClick={() => setPlaying((x) => !x)} aria-label={playing ? t('Pause') : t('Play')}>
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
                <span className="muted small">{t('Keep:')}</span>
                <Select
                  value={keep ?? p.settings.keep}
                  onChange={(v) => {
                    if (m.recording?.url) {
                      // A real recording: keeping less deletes it for good.
                      const ask = v === 'notes' ? t('Delete the recording for good? This can’t be undone.') : v === 'audio' && keep === 'video' ? t('Delete the video (the audio stays) for good? This can’t be undone.') : '';
                      if (ask && !confirm(ask)) return;
                      return p.onPatch(m.id, { recording: { ...m.recording, keep: v } });
                    }
                    p.onPatch(m.id, { recording: { ...m.recording, keep: v, sizeMb: v === 'audio' ? (m.minutes || 30) * 0.5 : 0.4 } });
                  }}
                  label={t('What to keep')}
                  className="sel-flat"
                  width={280}
                  options={(m.recording?.videoUrl ? (['video', 'audio', 'notes'] as const) : m.bot && !m.recording?.url ? (['notes'] as const) : (['audio', 'notes'] as const)).map((k) => ({ value: k, label: t(KEEP_LABEL[k]), hint: k === 'video' ? t('About {size}', { size: sizeOf(m.recording?.videoMb ?? 0) }) : k === 'audio' ? t('About {size}', { size: sizeOf(m.recording?.url ? m.recording.sizeMb : (m.minutes || 30) * 0.5) }) : t('Under 1 MB') }))}
                />
                {keep !== 'notes' && m.recording && <span className="muted small">{t('{size} of team storage', { size: sizeOf(m.recording.sizeMb + (keep === 'video' ? m.recording.videoMb ?? 0 : 0)) })}</span>}
                <button ref={accessBtn} className="link-btn small" onClick={() => setAccessOpen(true)}>
                  <Lock size={12} /> {t('Who can see this')}
                </button>
              </div>
            )}
          </div>

          <div className="m-glance side-card">
            <h3>{t('At a glance')}</h3>
            <dl>
              <dt>{t('Tasks')}</dt>
              <dd>
                {t('{done}/{total} done', { done: doneN, total: mTasks.length })}
                <span className="bar wide">
                  <span style={{ width: `${mTasks.length ? (doneN / mTasks.length) * 100 : 0}%` }} />
                </span>
              </dd>
              <dt>{t('Length')}</dt>
              <dd>{m.minutes ? hoursOf(m.minutes) : t('not set')}</dd>
              <dt>{t('Speakers')}</dt>
              <dd>{speakers.length}</dd>
              <dt>{tx('meet', 'People')}</dt>
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
                    {m.sharedWithClient && <span className="ap-tag approved">{t('notes visible to {whos}', { whos: term.whos })}</span>}
                  </dd>
                </>
              )}
            </dl>
            <button className="ghost-btn sm" onClick={() => p.onAsk({ kind: 'meeting', id: m.id })}>
              <Sparkles size={13} /> {t('Ask about this meeting')}
            </button>
          </div>
        </div>

        <TabBar
          storageKey="meeting-tabs"
          className="client-tabs m-tabs"
          value={tab}
          onSelect={(id) => setTab(id as typeof tab)}
          fixed={['summary']}
          items={(
            [
              ['summary', t('Summary'), t('Summary')],
              ['tasks', t('Tasks {n}', { n: mTasks.filter((tk) => !tk.done).length }), t('Tasks')],
              ['transcript', t('Transcript'), t('Transcript')],
              ['log', t('Bot log'), t('Bot log')],
            ] as const
          )
            // Phones: the bot log is in ⋮ (it's for checking what went wrong, not reading).
            .filter(([id]) => !phone || id !== 'log' || tab === 'log')
            .map(([id, label, name]) => ({ id, label, name }))}
          trailing={
            <>
              <span className="spacer" />
              {tab === 'transcript' && (m.transcript?.length ?? 0) > 0 && (
                <button className="m-tab-act" onClick={downloadTxt} title={t('Download .txt')}>
                  <Download size={13} /> <span className="lbl">{t('Download .txt')}</span>
                </button>
              )}
              <button className="m-tab-act" onClick={copy} title={t('Copy')}>
                <Copy size={13} /> <span className="lbl">{t('Copy')}</span>
              </button>
            </>
          }
        />

        <TabPane key={tab}>
        {tab === 'summary' &&
          (m.summary ? (
            <div className="m-notes">
              <p className="m-lead">{m.summary}</p>
              {(
                [
                  [mark('Key points'), m.keyPoints],
                  [mark('Decisions'), m.decisions],
                  [mark('Open questions'), m.openQuestions],
                ] as const
              ).map(([h, list]) => (
                <div key={h}>
                  <h4>{t(h)}</h4>
                  {list?.length ? (
                    <ul>
                      {list.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">{t('None')}</p>
                  )}
                </div>
              ))}
              {!!m.topics?.length && (
                <div>
                  <h4>{t('Topics')}</h4>
                  <div className="topic-chips">
                    {m.topics.map((tp) => (
                      <button key={tp.name + tp.at} onClick={() => seek(tp.at)}>
                        <b>{mmss(tp.at)}</b> {tp.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState compact text={live ? t('Notes appear here when the meeting ends.') : t('No notes. The bot log says why (notes need a transcript and an AI provider in Settings → AI).')} />
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
                <button className="ghost-btn sm" onClick={() => confirm(tn(mTasks.length, 'Remove {n} task from this meeting? The summary stays.', 'Remove all {n} tasks from this meeting? The summary stays.')) && (p.onBulk(mTasks.map((tk) => tk.id), 'delete'), p.toast(t('Tasks cleared')))}>
                  {t('Clear all tasks')}
                </button>
              )
            }
            empty={
              m.actions.some((a) => !a.taskId) ? (
                <div className="te-empty">
                  {t('No tasks (automatic tasks are off or were cleared). Action items mentioned in the meeting:')}
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
                <EmptyState compact text={t('No action items.')} />
              )
            }
            footer={
              <div className="todo-add task-add">
                <Plus size={16} />
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newTask.trim() && (p.onAddTask({ title: newTask.trim(), userId: p.me, meetingId: m.id, clientId: m.clientId }), setNewTask(''))} placeholder={t('Add a task from this meeting…')} />
                <button className="primary-btn sm" disabled={!newTask.trim()} onClick={() => (p.onAddTask({ title: newTask.trim(), userId: p.me, meetingId: m.id, clientId: m.clientId }), setNewTask(''))}>
                  {t('Add')}
                </button>
              </div>
            }
            onSeek={(ms) => (setTab('summary'), seek(ms))}
          />
        )}

        {tab === 'transcript' && (
          <div className="m-transcript">
            {!live && m.bot && m.recording?.url && p.onTranscribeAgain && (
              <div className="tr-again">
                <span className="muted small">{t('Spoken in {languages}. Wrong language or messy?', { languages: m.language ? languageLabel(m.language) : languagesLabel(p.settings.languages) })}</span>
                <Select<string>
                  value={null}
                  onChange={(v) => p.onTranscribeAgain!(m.id, v === 'company' ? undefined : v)}
                  placeholder={t('Transcribe again in…')}
                  label={t('Transcribe again in')}
                  className="sel-flat"
                  width={260}
                  options={[{ value: 'company', label: languagesLabel(p.settings.languages), hint: t('Your company’s meeting languages') }, ...MEETING_LANGUAGES.map((l) => ({ value: l.code, label: t(l.label), hint: m.language === l.code ? t('Used last time') : undefined }))]}
                />
              </div>
            )}
            {(m.transcript ?? []).map((l, i) => (
              <button key={i} className={`tl ${time >= l.at && time < (m.transcript![i + 1]?.at ?? Infinity) && playing ? 'now' : ''}`} onClick={() => seek(l.at)}>
                <time>{mmss(l.at)}</time>
                <b>{l.speaker || t('Unknown')}</b>
                <span>{l.text}</span>
              </button>
            ))}
            {!m.transcript?.length && <EmptyState compact text={live ? t('Waiting for people to talk… (captions must be on in the meeting)') : t('No transcript.')} />}
            <div ref={tEnd} />
          </div>
        )}

        {tab === 'log' && (
          <pre className="m-log">{(m.log ?? []).map((l) => `${logTime(l.at)}  ${l.message}`).join('\n') || t('Nothing logged yet.')}</pre>
        )}
        </TabPane>
      </div>

      <Popover anchor={accessBtn} open={accessOpen} onClose={() => setAccessOpen(false)} width={320} title={t('Who can see this meeting')}>
        <div className="access-pop">
          <label>{t('Who can watch the recording')}</label>
          <Select
            value={m.access?.watch ?? 'everyone'}
            onChange={(v) => p.onPatch(m.id, { access: { watch: v, download: m.access?.download ?? false, transcript: m.access?.transcript ?? 'everyone' } })}
            label={t('Who can watch')}
            options={[
              { value: 'everyone', label: t('Everyone in the company') },
              { value: 'attendees', label: t('Only people who were in the meeting') },
              { value: 'admins', label: t('Only admins') },
            ]}
          />
          <label>{t('Who sees the transcript')}</label>
          <Select
            value={m.access?.transcript ?? 'everyone'}
            onChange={(v) => p.onPatch(m.id, { access: { watch: m.access?.watch ?? 'everyone', download: m.access?.download ?? false, transcript: v } })}
            label={t('Transcript')}
            options={[
              { value: 'everyone', label: t('Everyone in the company') },
              { value: 'attendees', label: t('Only people who were in the meeting') },
            ]}
          />
          <label className="check-row">
            <input type="checkbox" checked={m.access?.download ?? false} onChange={(e) => p.onPatch(m.id, { access: { watch: m.access?.watch ?? 'everyone', transcript: m.access?.transcript ?? 'everyone', download: e.target.checked } })} /> {t('Allow downloading the recording')}
          </label>
          {client && (
            <label className="check-row">
              <input type="checkbox" checked={!!m.sharedWithClient} onChange={(e) => p.onPatch(m.id, { sharedWithClient: e.target.checked })} /> {t('{name} sees the notes in their portal', { name: client.name })}
            </label>
          )}
          <p className="muted small">{t('Recordings never go to the shared space. Use Share for a read-only link.')}</p>
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
    if (a === 'delete' && !confirm(tn(sel.size, 'Delete {n} task?', 'Delete {n} tasks?'))) return;
    p.onBulk([...sel], a);
    p.toast(a === 'done' ? tn(sel.size, '{n} task marked done', '{n} tasks marked done') : a === 'reopen' ? tn(sel.size, '{n} task reopened', '{n} tasks reopened') : tn(sel.size, '{n} task deleted', '{n} tasks deleted'));
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
              }} onChange={() => setSel(sel.size === p.list.length ? new Set() : new Set(p.list.map((tk) => tk.id)))} /> {t('All')}
            </label>
            <span className="muted small">{tn(sel.size, '{n} selected', '{n} selected')}</span>
            <button className="ghost-btn sm" disabled={!sel.size} onClick={() => bulk('done')}>
              {t('Mark done')}
            </button>
            <button className="ghost-btn sm" disabled={!sel.size} onClick={() => bulk('reopen')}>
              {t('Reopen')}
            </button>
            <button className="ghost-btn sm danger-text" disabled={!sel.size} onClick={() => bulk('delete')}>
              {t('Delete')}
            </button>
            <button className="link-btn" onClick={() => (setSelecting(false), setSel(new Set()))}>
              {t('Cancel')}
            </button>
          </>
        ) : (
          <button className="ghost-btn sm" disabled={!p.list.length} onClick={() => setSelecting(true)}>
            <CheckSquare size={13} /> {t('Select')}
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
                {mt ? `${mt.title} · ${fullDate(mt.at)}${mt.clientId ? ` · ${p.clients.find((c) => c.id === mt.clientId)?.name}` : ''}` : t('Added by hand')}
              </button>
            )}
            {list.map((tk) => {
              const owner = p.ownerName?.(tk);
              const m = p.meetingFor(tk);
              return (
                <div key={tk.id} className={`task m-task ${tk.done ? 'done' : ''}`} onClick={() => selecting && toggle(tk.id)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), selecting && toggle(tk.id))}>
                  {selecting && <input type="checkbox" checked={sel.has(tk.id)} onChange={() => toggle(tk.id)} onClick={(e) => e.stopPropagation()} />}
                  <button className="todo-check" onClick={(e) => (e.stopPropagation(), p.onToggleTask(tk.id))} aria-label={t('Toggle done')}>
                    {tk.done && <span>✓</span>}
                  </button>
                  <input className="task-title" value={tk.title} onChange={(e) => p.onPatchTask(tk.id, { title: e.target.value })} onClick={(e) => e.stopPropagation()} aria-label={t('Task')} />
                  <Select
                    value={tk.userId}
                    onChange={(v) => p.onPatchTask(tk.id, { userId: v })}
                    label={t('Assignee')}
                    className="sel-flat"
                    options={[
                      { value: '', label: owner && !p.users.some((u) => u.name.split(' ')[0] === owner) ? t('{name} (not a member)', { name: owner }) : t('Unassigned') },
                      ...p.users.map((u) => ({ ...personOption(u), label: u.name, icon: <Avatar person={u} size={18} /> })),
                    ]}
                  />
                  <span className="due-pick" onClick={(e) => e.stopPropagation()}>
                    <DatePicker value={tk.due ?? ''} onChange={(v) => p.onPatchTask(tk.id, { due: v || undefined })} label={t('Due')} placeholder={t('No due date')} className="sel-flat" />
                  </span>
                  {tk.saidAt !== undefined && m && (
                    <button className="jump" onClick={(e) => (e.stopPropagation(), p.onSeek ? p.onSeek(tk.saidAt!, tk) : p.onPage({ kind: 'meeting', id: m.id }))} title={t('Jump to when it was said')}>
                      ▶ {mmss(tk.saidAt)}
                    </button>
                  )}
                  <button className="icon-btn sm" onClick={(e) => (e.stopPropagation(), p.onBulk([tk.id], 'delete'))} aria-label={t('Delete task')}>
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
  const all = p.tasks.filter((tk) => tk.meetingId || tk.source === 'meeting');
  const list = all.filter((tk) => (tab === 'open' ? !tk.done : tab === 'mine' ? !tk.done && tk.userId === p.me : tab === 'done' ? tk.done : true));
  return (
    <section className="meet-pane view-enter">
      <Head title={t('Tasks from meetings')} sub={t('Action items from every meeting, plus your own.')} onMenu={p.onMenu} />
      <div className="tracking-scroll">
        <div className="client-tabs flat">
          {(['open', 'mine', 'done', 'all'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {k === 'open' ? tx('meet', 'Open') : k === 'mine' ? t('Mine') : k === 'done' ? t('Done') : t('All')}
            </button>
          ))}
        </div>
        <div className="todo-add task-add">
          <Plus size={16} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Add a task…')} />
          <Select value={who} onChange={setWho} label={t('Assignee')} className="sel-flat" options={[{ value: '', label: t('Unassigned') }, ...p.users.map((u) => ({ ...personOption(u), label: u.name }))]} />
          <input className="due-input" value={due} onChange={(e) => setDue(e.target.value)} placeholder={t('Due (e.g. Friday)')} />
          <button className="primary-btn sm" disabled={!title.trim()} onClick={() => (p.onAddTask({ title: title.trim(), userId: who, due: due || undefined }), setTitle(''), setDue(''))}>
            {t('Add')}
          </button>
        </div>
        <TaskList
          {...p}
          list={list}
          grouped
          meetingFor={(tk) => p.meetings.find((m) => m.id === tk.meetingId)}
          ownerName={(tk) => p.meetings.find((m) => m.id === tk.meetingId)?.actions.find((a) => a.taskId === tk.id)?.owner}
          nameFor={(tk) => p.users.find((u) => u.id === tk.userId)}
          empty={<EmptyState compact text={tab === 'done' ? t('Nothing finished yet.') : t('No open tasks. Nice.')} />}
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
  const tasks = p.tasks.filter((tk) => tk.meetingId && list.some((m) => m.id === tk.meetingId));
  const open = tasks.filter((tk) => !tk.done).length;
  if (!c) return null;
  return (
    <section className="meet-pane view-enter">
      <Head
        title={
          <>
            <ProjectBadge p={c} kind="client-dot sm" />{' '}
            {c.name}
          </>
        }
        sub={t('{Project} folder', { project: term.one })}
        onMenu={p.onMenu}
      >
        <button className="ghost-btn sm" onClick={() => p.onOpenClient(c.id)}>
          {t('{Project} page: overview, mail, files', { project: term.one })}
        </button>
        <button className="ghost-btn sm" onClick={() => p.onAsk({ kind: 'client', id: c.id })}>
          <Sparkles size={13} /> {t('Ask AI')}
        </button>
      </Head>
      <div className="client-tabs">
        {(
          [
            ['meetings', t('Meetings')],
            ['tasks', open ? t('Tasks · {n} open', { n: open }) : t('Tasks')],
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
            {bar(t('Search this {project}’s meetings', { project: term.one }))}
            <MeetingRows list={shown} clients={p.clients} tasks={p.tasks} onOpen={(id) => p.onPage({ kind: 'meeting', id })} />
            {!shown.length && <EmptyState compact text={filtering ? t('Nothing matches.') : t('No meetings yet.')} />}
          </>
        )}
        {tab === 'tasks' && (
          <TaskList
            {...p}
            list={tasks}
            grouped
            meetingFor={(tk) => p.meetings.find((m) => m.id === tk.meetingId)}
            nameFor={(tk) => p.users.find((u) => u.id === tk.userId)}
            empty={<EmptyState compact text={t('No tasks from these meetings yet. Promises made in a meeting become tasks here.')} />}
          />
        )}
        </TabPane>
      </div>
    </section>
  );
}

/* ---------------- Upcoming ---------------- */

/** The event's video call: a real link, or in the demo a place that just says Zoom or Google Meet. */
const linkOf = (e: CalEvent, demo?: boolean): MeetingKind | null => meetingLinkOf(e)?.kind ?? (demo ? (/zoom/i.test(e.location ?? '') ? 'zoom' : /meet|google/i.test(e.location ?? '') ? 'meet' : null) : null);

function Upcoming(p: MeetProps) {
  const mode = p.settings.joinMode ?? 'accepted';
  const now = Date.now();
  const soon = p.events.filter((e) => !e.allDay && new Date(e.end).getTime() > now && new Date(e.start).getTime() < now + 7 * 86_400_000).sort((a, b) => a.start.localeCompare(b.start));
  const days = [...new Set(soon.map((e) => new Date(e.start).toDateString()))];
  const dayName = (d: string) => (d === new Date().toDateString() ? t('Today') : d === new Date(now + 86_400_000).toDateString() ? t('Tomorrow') : fmtDate(new Date(d), { weekday: 'long', day: 'numeric', month: 'short' }));
  const joins = (e: CalEvent) => {
    const k = linkOf(e, p.demo);
    if (!k || !notetakerJoins(k)) return false;
    if (e.id in p.overrides) return p.overrides[e.id];
    return joinsByRule(e, mode, isMine);
  };
  const live = p.autoJoin === 'live';
  const admin = p.myRole !== 'member';
  const modeLabel = t(JOIN_MODES.find((x) => x.value === mode)?.label ?? '');
  return (
    <section className="meet-pane view-enter">
      <Head title={t('Upcoming')} sub={p.calendarsSyncedAt ? t('From your calendars · updated {ago}', { ago: relative(p.calendarsSyncedAt) }) : t('From your calendar')} onMenu={p.onMenu}>
        {p.onSyncCalendars && (
          <button className="ghost-btn sm" onClick={p.onSyncCalendars}>
            <RefreshCw size={13} /> {t('Update now')}
          </button>
        )}
      </Head>
      <div className="tracking-scroll">
        <div className="side-card upcoming-set">
          <span>
            <strong>{t('Bot joins automatically')}</strong>
            <small>
              {p.autoJoin === 'off'
                ? t('The notetaker isn’t available on this server yet, so it can’t join meetings. Recordings and notes start working as soon as it is.')
                : admin
                  ? t('It joins a minute before each meeting with a Google Meet or Zoom link, for everyone in the company. Read only: it never changes your calendar.')
                  : t('{mode}, for everyone in the company. An admin can change it in Settings, Meetings. Use the switch on a meeting to change just that one.', { mode: modeLabel })}
            </small>
          </span>
          {p.autoJoin !== 'off' && admin && <Select value={mode} onChange={p.onJoinMode} label={t('Bot joins automatically')} width={280} options={JOIN_MODES.map((x) => ({ value: x.value, label: t(x.label), hint: t(x.hint) }))} />}
        </div>
        {days.map((d) => (
          <div key={d} className="todo-group">
            <div className="d-heading">{dayName(d)}</div>
            {soon
              .filter((e) => new Date(e.start).toDateString() === d)
              .map((e) => {
                const link = linkOf(e, p.demo);
                const url = meetingLinkOf(e)?.url;
                const bot = !!link && notetakerJoins(link) && p.autoJoin !== 'off';
                const mid = p.sentEvents[e.id];
                const mt = mid ? p.meetings.find((x) => x.id === mid) : undefined;
                const startsSoon = new Date(e.start).getTime() - now < 15 * 60_000;
                // With the real notetaker, the server sends it by itself a minute or two before the start.
                const willJoin = live && bot && !mt && new Date(e.start).getTime() > now - 60_000 && joins(e);
                return (
                  <div key={e.id} className="ev-row">
                    <time>
                      {fmtTime(e.start)}
                      <small>{fmtTime(e.end)}</small>
                    </time>
                    <span className="ev-main">
                      <strong>{e.title}</strong>
                      <small>
                        {link ? MEETING_NAME[link] : t('No meeting link')}
                        {link && !notetakerJoins(link) ? ` · ${t('the notetaker can’t join this yet')}` : ''}
                        {e.guests?.length ? ` · ${tn(e.guests.length, '{n} other', '{n} others')}` : ''}
                        {e.id in p.overrides ? ` · ${t('set by you')}` : ''}
                      </small>
                      {willJoin && (
                        <small className="ev-bot-will">
                          <Mic size={12} aria-hidden /> {t('The notetaker will join')}
                        </small>
                      )}
                    </span>
                    {mt ? (
                      <button className="link-btn" onClick={() => p.onPage({ kind: 'meeting', id: mt.id })}>
                        <StatusPill m={mt} />
                      </button>
                    ) : (
                      bot &&
                      startsSoon &&
                      !willJoin && (
                        <button className="ghost-btn sm" onClick={() => p.onSendNow(e)}>
                          <Send size={13} /> {t('Send now')}
                        </button>
                      )
                    )}
                    {url && startsSoon && (
                      <a className="ghost-btn sm" href={url} target="_blank" rel="noopener noreferrer">
                        <Video size={13} /> {t('Join')}
                      </a>
                    )}
                    {bot && !mt && (
                      <label className="ev-switch" title={t('Bot joins')}>
                        <span className="muted small">{t('Bot joins')}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={joins(e)}
                          className={`switch ${joins(e) ? 'on' : ''}`}
                          onClick={() => {
                            const want = !joins(e);
                            p.onOverride(e.id, want === joinsByRule(e, mode, isMine) ? null : want);
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
        {!soon.length && <EmptyState compact text={t('No meetings in the next 7 days. Connect a calendar in Calendar, or send the bot to a meeting link.')} />}
      </div>
    </section>
  );
}

/* ---------------- Send bot ---------------- */

export function SendBotDialog({ clients, botName, languages, real, workspaceId, isOwner, seed, upcoming, demo, onSendEvent, onSend, onClose }: { clients: Client[]; botName: string; languages?: string[]; real?: boolean; workspaceId?: string; isOwner?: boolean; seed?: { title: string; note?: string }; upcoming?: CalEvent[]; demo?: boolean; onSendEvent?: (e: CalEvent) => void; onSend: (d: { url: string; title: string; botName: string; clientId: string; language?: string }) => void; onClose: () => void }) {
  const phone = usePhone();
  // The real notetaker: this month's hours left on the plan (the server stops it when they run out).
  const [minutes, setMinutes] = useState<{ used: number; left: number | null; total: number | null } | null>(null);
  useEffect(() => {
    if (!real || !workspaceId) return;
    let on = true;
    void fetch(`/api/meet/status?ws=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { minutes?: { used: number; left: number | null; total: number | null } } | null) => on && setMinutes(d?.minutes ?? null), () => {});
    return () => {
      on = false;
    };
  }, [real, workspaceId]);
  const usedUp = !!minutes && minutes.left !== null && minutes.left < 1;
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState('');
  const [title, setTitle] = useState(seed?.title ?? '');
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [err, setErr] = useState('');
  const send = () => {
    if (!/^https?:\/\/(meet\.google\.com|[\w.-]*zoom\.us)\//i.test(url.trim())) return setErr(t('Paste a Google Meet or Zoom link'));
    onSend({ url: url.trim(), title: title.trim(), botName: name.trim() || botName, clientId, language: language || undefined });
  };
  const minutesNote = minutes && minutes.total !== null && minutes.left !== null && (
    <p className={usedUp ? 'warn-note small' : 'muted small'}>
      {usedUp
        ? isOwner
          ? t('The notetaker’s {hours} for this month are used up. Add 10 more hours in Settings, Plan & billing, Add-ons, or it starts again on the 1st.', { hours: hoursOf(minutes.total) })
          : t('The notetaker’s {hours} for this month are used up. An owner can add 10 more hours in Settings, Plan & billing, or it starts again on the 1st.', { hours: hoursOf(minutes.total) })
        : t('{left} of the notetaker’s {total} left this month. It leaves the meeting when they run out.', { left: hoursOf(minutes.left), total: hoursOf(minutes.total) })}
    </p>
  );

  // Phones (Google Meet's "Take notes"): the next calls first, one tap each; or paste a link. Send at the top right.
  if (phone) {
    const now = Date.now();
    const next = seed
      ? []
      : (upcoming ?? [])
          .filter((e) => !e.allDay && callOf(e, demo) && notetakerJoins(callOf(e, demo)!) && new Date(e.end).getTime() > now && new Date(e.start).getTime() < now + 86_400_000)
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, 3);
    const paste = async () => {
      try {
        const v = (await navigator.clipboard.readText()).trim();
        if (v) (setUrl(v), setErr(''));
      } catch {
        setErr(t('Couldn’t read what you copied. Paste it into the field instead.'));
      }
    };
    return (
      <Sheet
        onClose={onClose}
        label={t('Take notes')}
        className="tn-sheet"
        size="tall"
        head={
          <>
            <button type="button" className="icon-btn qc-x" onClick={onClose} aria-label={t('Close')}>
              <X size={22} />
            </button>
            <h2 className="sheet-title tn-title">{t('Take notes')}</h2>
            <span className="spacer" />
            <button type="button" className="primary-btn qc-save" onClick={send} disabled={usedUp || !url.trim()}>
              {t('Send')}
            </button>
          </>
        }
      >
        <div className="tn-body">
          {seed && <p className="tn-note">{seed.note ? t('{note} If the meeting also has a Google Meet or Zoom link, paste it here.', { note: t(seed.note) }) : t('“{title}” has no meeting link yet. Paste its Google Meet or Zoom link to send the notetaker. Someone in the call has to let it in.', { title: seed.title })}</p>}
          {next.length > 0 && onSendEvent && (
            <>
              <div className="ad-heading">{t('Your next calls')}</div>
              {next.map((e) => (
                <button key={e.id} type="button" className="tn-call" onClick={() => onSendEvent(e)}>
                  <CallMark kind={callOf(e, demo)} />
                  <span className="mh-text">
                    <strong>{e.title}</strong>
                    <small>
                      {fmtTime(e.start)} · {MEETING_NAME[callOf(e, demo)!]}
                    </small>
                  </span>
                  <Send size={18} className="tn-send" />
                </button>
              ))}
              <div className="ad-heading">{t('Or paste a link')}</div>
            </>
          )}
          <div className="er-row tn-link">
            <span className="er-icon">
              <Link2 size={20} />
            </span>
            <span className="er-body">
              <span className="er-field">
                <input className="er-input" value={url} onChange={(e) => (setUrl(e.target.value), setErr(''))} placeholder={t('Google Meet or Zoom link')} inputMode="url" aria-label={t('Meeting link')} onKeyDown={(e) => e.key === 'Enter' && send()} />
                {!url && (
                  <button type="button" className="tn-paste" onClick={() => void paste()}>
                    {t('Paste')}
                  </button>
                )}
              </span>
            </span>
          </div>
          {err && <p className="err tn-err">{err}</p>}
          <div className="er-group">
            <div className="er-row">
              <span className="er-icon">
                <FileText size={20} />
              </span>
              <span className="er-body">
                <input className="er-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Title')} aria-label={t('Title')} />
              </span>
            </div>
            <div className="er-row">
              <span className="er-icon">
                <Folder size={20} />
              </span>
              <span className="er-body">
                <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none={t('Filed automatically')} label={t('Folder')} className="er-sel" />
              </span>
            </div>
            <div className="er-row">
              <span className="er-icon">
                <Languages size={20} />
              </span>
              <span className="er-body">
                <Select<string>
                  value={language}
                  onChange={setLanguage}
                  label={t('Spoken in')}
                  className="er-sel"
                  options={[{ value: '', label: languagesLabel(languages), hint: t('Your company’s meeting languages') }, ...MEETING_LANGUAGES.map((l) => ({ value: l.code, label: t(l.label), hint: t('Just this meeting') }))]}
                />
              </span>
            </div>
            <div className="er-row">
              <span className="er-icon">
                <Bot size={20} />
              </span>
              <span className="er-body">
                <input className="er-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={botName} aria-label={t('Bot name, for this meeting')} />
              </span>
            </div>
          </div>
          {!real && <p className="tn-note">{t('Demo: no real bot is sent. You’ll see it join, record a short sample conversation and write the notes.')}</p>}
          {minutesNote && <div className="tn-note">{minutesNote}</div>}
        </div>
      </Sheet>
    );
  }

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={t('Send the bot to a meeting')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Bot size={15} /> {t('Send the bot to a meeting')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
          <p className="modal-intro">{seed ? (seed.note ? t('{note} If the meeting also has a Google Meet or Zoom link, paste it here.', { note: t(seed.note) }) : t('“{title}” has no meeting link yet. Paste its Google Meet or Zoom link to send the notetaker. Someone in the call has to let it in.', { title: seed.title })) : t('Paste a Google Meet or Zoom link. Someone in the call has to let the bot in.')}</p>
          <label className="field">
            <span>{t('Meeting link')}</span>
            <input autoFocus value={url} onChange={(e) => (setUrl(e.target.value), setErr(''))} placeholder="https://meet.google.com/abc-defg-hij" onKeyDown={(e) => e.key === 'Enter' && send()} />
          </label>
          {err && <p className="err">{err}</p>}
          <label className="field">
            <span>{t('Title (optional)')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Weekly sync with…')} />
          </label>
          <label className="field">
            <span>{t('Bot name (optional, for this meeting)')}</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={botName} />
          </label>
          <div className="field">
            <span>{t('Folder (optional, otherwise filed automatically)')}</span>
            <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none={t('Auto')} label={t('Folder')} />
          </div>
          <div className="field">
            <span>{t('Spoken in')}</span>
            <Select<string>
              value={language}
              onChange={setLanguage}
              label={t('Spoken in')}
              options={[{ value: '', label: languagesLabel(languages), hint: t('Your company’s meeting languages') }, ...MEETING_LANGUAGES.map((l) => ({ value: l.code, label: t(l.label), hint: t('Just this meeting') }))]}
            />
          </div>
          {!real && <p className="muted small">{t('Demo: no real bot is sent. You’ll see it join, record a short sample conversation and write the notes.')}</p>}
          {minutesNote}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={send} disabled={usedUp}>
            <Send size={14} /> {t('Send bot')}
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
      <div className="modal" role="dialog" aria-label={t('Share this meeting')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Link2 size={15} /> {t('Share this meeting')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <p className="modal-intro">{t('Anyone with the link can view a read-only page: summary and tasks, plus the parts you allow below. No login needed.')}</p>
          <label className="set-row toggle-row">
            <span>
              <strong>{t('Include transcript')}</strong>
              <small>{t('The full conversation, line by line')}</small>
            </span>
            <button type="button" role="switch" aria-checked={transcript} className={`switch ${transcript ? 'on' : ''}`} onClick={() => setTranscript(!transcript)}>
              <span />
            </button>
          </label>
          <label className="set-row toggle-row">
            <span>
              <strong>{t('Include recording')}</strong>
              <small>{hasVideo ? t('The meeting recording') : t('This meeting has no recording')}</small>
            </span>
            <button type="button" role="switch" disabled={!hasVideo} aria-checked={video && hasVideo} className={`switch ${video && hasVideo ? 'on' : ''}`} onClick={() => setVideo(!video)}>
              <span />
            </button>
          </label>
          {link && (
            <div className="share-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="ghost-btn sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast(t('Link copied')), () => toast(t('Copying isn’t allowed here')))}>
                {t('Copy link')}
              </button>
              <button className="link-btn" onClick={onPreview}>
                <Eye size={13} /> {t('Preview')}
              </button>
            </div>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {link && (
            <button className="ghost-btn danger-text" onClick={() => confirm(t('Turn off this link? People who have it will no longer see the meeting.')) && onOff()}>
              {t('Turn off link')}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Close')}
          </button>
          <button className="primary-btn" onClick={() => onSave({ transcript, video: video && hasVideo })}>
            {link ? t('Save') : t('Create link')}
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
        <Eye size={15} /> {t('Preview of the public link. People see this without signing in.')}
        <span className="spacer" />
        <button className="ghost-btn sm" onClick={onClose}>
          <X size={14} /> {t('Close preview')}
        </button>
      </div>
      <div className="portal">
        <p className="portal-kicker">{t('{brand} · Shared meeting · read only', { brand })}</p>
        <h1 className="m-title">{m.title}</h1>
        <p className="m-sub">
          {[fullDate(m.at), m.minutes ? hoursOf(m.minutes) : '', fmtList(m.attendees)].filter(Boolean).join(' · ')}
        </p>
        {opts.video && (
          <div className="m-player video">
            <span className="m-play">
              <Play size={20} />
            </span>
          </div>
        )}
        <div className="portal-card">
          <h2>{tx('meet', 'Notes')}</h2>
          <p>{m.summary || t('No summary for this meeting.')}</p>
          {(
            [
              [mark('Key points'), m.keyPoints],
              [mark('Decisions'), m.decisions],
              [mark('Open questions'), m.openQuestions],
            ] as const
          ).map(([h, l]) =>
            l?.length ? (
              <div key={h}>
                <h4>{t(h)}</h4>
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
          <h2>{t('Action items')}</h2>
          <ul className="portal-list">
            {tasks.map((tk) => (
              <li key={tk.id}>
                {tk.done ? '✓' : '○'} <span className="pl-title">{tk.title}</span>
                <span className="muted small">
                  {users.find((u) => u.id === tk.userId)?.name.split(' ')[0] ?? ''}
                  {tk.due ? ` · ${t('due {date}', { date: fmtDay(tk.due) })}` : ''}
                </span>
              </li>
            ))}
            {!tasks.length && m.actions.map((a) => <li key={a.title}>○ {a.title}</li>)}
          </ul>
        </div>
        {opts.transcript && (
          <div className="portal-card">
            <h2>{t('Transcript')}</h2>
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
