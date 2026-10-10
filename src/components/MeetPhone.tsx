import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, Home, Inbox, ListChecks, Mic, MicOff, Search, Settings, Video, X } from 'lucide-react';
import type { CalEvent, Client, Meeting, MeetingSettings, Role, Todo, Workspace } from '../types';
import { JOIN_MODES, MEETING_NAME, joinsByRule, meetingLinkOf, notetakerJoins, type MeetingKind } from '../meetingLinks';
import { isMine } from '../identity';
import { fmtTimeRange, sameDay } from '../calendarUtils';
import { AppDrawer, DrawerDivider, DrawerHeading, DrawerRow } from './ui/AppDrawer';
import { PushScreen } from './ui/PushScreen';
import { Sheet } from './ui/Sheet';
import { Select } from './ui/Select';
import { SwipeRow } from './ui/SwipeRow';
import { EmptyState } from './ui/EmptyState';
import { ProjectBadge } from './ProjectBadge';
import { IconTile } from './ui/IconTile';
import type { MeetPage } from './MeetApp';
import { LIVE, STATUS_LABEL } from './MeetApp';
import { t, tn } from '../i18n';
import { fmtDate, fmtList } from '../i18n/format';
import { term } from '../terms';

/** The event's call: a real link, or in the demo a place that just says Zoom or Google Meet. */
export const callOf = (e: CalEvent, demo?: boolean): MeetingKind | null => meetingLinkOf(e)?.kind ?? (demo ? (/zoom/i.test(e.location ?? '') ? 'zoom' : /meet|google/i.test(e.location ?? '') ? 'meet' : null) : null);

/** A meeting, as Meet sees it: a call link, or someone else invited. */
const isMeeting = (e: CalEvent, demo?: boolean) => !!callOf(e, demo) || (e.guests?.length ?? 0) > 0;

/** A call app's mark: a rounded square in its colour with a camera (Meet green, Zoom blue, Teams purple). */
export function CallMark({ kind, size = 40 }: { kind: MeetingKind | 'meet' | 'zoom' | null | undefined; size?: number }) {
  return (
    <span className={`call-mark ${kind ?? 'none'}`} style={{ width: size, height: size }} aria-label={kind ? MEETING_NAME[kind] : undefined}>
      <Video size={Math.round(size * 0.5)} />
    </span>
  );
}

/** "Today", "Tomorrow" or "Sat 10 Oct". */
function dayWord(d: Date) {
  const now = new Date();
  if (sameDay(d, now)) return t('Today');
  if (sameDay(d, new Date(now.getTime() + 86_400_000))) return t('Tomorrow');
  return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Meet's drawer on phones (the same drawer as Calendar's): Home, Tasks from meetings, Unfiled, projects, Settings. */
export function MeetDrawer({ page, clients, meetings, company, onPage, onClose, onSettings }: { page: MeetPage; clients: Client[]; meetings: Meeting[]; company?: Pick<Workspace, 'name' | 'logo' | 'color'>; onPage: (p: MeetPage) => void; onClose: () => void; onSettings: () => void }) {
  const go = (p: MeetPage) => (onPage(p), onClose());
  const unfiled = meetings.filter((m) => !m.clientId).length;
  return (
    <AppDrawer label={t('Meet')} company={company} onClose={onClose}>
      <DrawerRow icon={<Home size={20} />} label={t('Home')} on={page.kind === 'list'} onClick={() => go({ kind: 'list' })} />
      <DrawerRow icon={<ListChecks size={20} />} label={t('Tasks from meetings')} on={page.kind === 'tasks'} onClick={() => go({ kind: 'tasks' })} />
      <DrawerRow icon={<Inbox size={20} />} label={t('Unfiled')} sub={unfiled ? tn(unfiled, '{n} to file', '{n} to file') : undefined} on={page.kind === 'unfiled'} onClick={() => go({ kind: 'unfiled' })} />
      {clients.length > 0 && (
        <>
          <DrawerDivider />
          <DrawerHeading>{term.Many}</DrawerHeading>
          {clients.map((c) => (
            <DrawerRow key={c.id} icon={<ProjectBadge p={c} kind="client-dot" />} label={c.name} on={page.kind === 'folder' && page.clientId === c.id} onClick={() => go({ kind: 'folder', clientId: c.id })} />
          ))}
        </>
      )}
      <DrawerDivider />
      <DrawerRow icon={<Settings size={20} />} label={t('Settings')} onClick={() => (onClose(), onSettings())} />
    </AppDrawer>
  );
}

/** Meet's settings on phones: the company's meeting settings and whether the notetaker joins by itself. */
export function MeetSettingsScreen({ settings, rows, myRole, autoJoin, onJoinMode, onBack }: { settings: MeetingSettings; rows: { id: string; label: string; hint?: string; run: () => void }[]; myRole: Role; autoJoin: 'live' | 'demo' | 'off'; onJoinMode: (m: NonNullable<MeetingSettings['joinMode']>) => void; onBack: () => void }) {
  const mode = settings.joinMode ?? 'accepted';
  const admin = myRole !== 'member';
  return (
    <PushScreen title={t('Meet settings')} onBack={onBack} className="meet-settings">
      <div className="as-list">
        {rows.map((r) => (
          <button key={r.id} type="button" className="as-item" onClick={r.run}>
            <span className="as-label">
              {r.label}
              {r.hint && <small>{r.hint}</small>}
            </span>
            <ChevronRight size={18} className="as-chev" />
          </button>
        ))}
        <div className="ms-join">
          <div className="ad-heading">{t('Bot joins automatically')}</div>
          <p className="ms-note">
            {autoJoin === 'off'
              ? t('The notetaker isn’t available on this server yet, so it can’t join meetings. Recordings and notes start working as soon as it is.')
              : admin
                ? t('It joins a minute before each meeting with a Google Meet or Zoom link, for everyone in the company. Read only: it never changes your calendar.')
                : t('{mode}, for everyone in the company. An admin can change it in Settings, Meetings. Use the switch on a meeting to change just that one.', { mode: t(JOIN_MODES.find((x) => x.value === mode)?.label ?? '') })}
          </p>
          {autoJoin !== 'off' && admin && <Select value={mode} onChange={onJoinMode} label={t('Bot joins automatically')} className="ms-sel" options={JOIN_MODES.map((x) => ({ value: x.value, label: t(x.label), hint: t(x.hint) }))} />}
        </div>
      </div>
    </PushScreen>
  );
}

interface HomeProps {
  meetings: Meeting[];
  clients: Client[];
  tasks: Todo[];
  events: CalEvent[];
  settings: MeetingSettings;
  overrides: Record<string, boolean>;
  sentEvents: Record<string, string>;
  autoJoin: 'live' | 'demo' | 'off';
  demo?: boolean;
  unfiled?: boolean;
  /** Phones with the app's own bar: Notes shows the past meetings only (Meetings has what's coming). */
  notesOnly?: boolean;
  onPage: (p: MeetPage) => void;
  onFolder: (id: string, clientId: string | null, remember: boolean) => void;
  onOverride: (eventId: string, join: boolean | null) => void;
  onOpenEvent?: (id: string) => void;
}

/** Whether the notetaker joins this event (its own switch, else the company's rule). */
function useJoins(p: Pick<HomeProps, 'settings' | 'overrides' | 'demo' | 'autoJoin'>) {
  const mode = p.settings.joinMode ?? 'accepted';
  return {
    can: (e: CalEvent) => {
      const k = callOf(e, p.demo);
      return !!k && notetakerJoins(k) && p.autoJoin !== 'off';
    },
    joins: (e: CalEvent) => {
      const k = callOf(e, p.demo);
      if (!k || !notetakerJoins(k)) return false;
      if (e.id in p.overrides) return p.overrides[e.id];
      return joinsByRule(e, mode, isMine);
    },
    byRule: (e: CalEvent) => joinsByRule(e, mode, isMine),
  };
}

/** One meeting coming up: its call, title, when and who; the mic says whether the notetaker joins (tap to change). */
function ComingRow({ e, p, j }: { e: CalEvent; p: HomeProps; j: ReturnType<typeof useJoins> }) {
  const [open, setOpen] = useState(false);
  const k = callOf(e, p.demo);
  const on = j.joins(e);
  const others = e.guests?.length ?? 0;
  const start = new Date(e.start);
  return (
    <div className="mh-row">
      <button type="button" className="mh-main" onClick={() => setOpen(true)}>
        <CallMark kind={k} />
        <span className="mh-text">
          <strong>{e.title}</strong>
          <small>{[dayWord(start), fmtTimeRange(e.start, e.end), others ? tn(others, '{n} other', '{n} others') : ''].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
      {j.can(e) && (
        <button
          type="button"
          className={`mh-mic${on ? ' on' : ''}`}
          aria-pressed={on}
          aria-label={on ? t('The notetaker will join. Tap so it doesn’t') : t('The notetaker won’t join. Tap so it does')}
          onClick={() => p.onOverride(e.id, !on === j.byRule(e) ? null : !on)}
        >
          {on ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
      )}
      {open && (
        <Sheet
          title={e.title}
          onClose={() => setOpen(false)}
          className="mh-event"
          footer={
            p.onOpenEvent ? (
              <button type="button" className="ghost-btn" onClick={() => (setOpen(false), p.onOpenEvent!(e.id))}>
                {t('Open in Calendar')}
              </button>
            ) : undefined
          }
        >
          <p className="mhe-line">{[dayWord(start), fmtTimeRange(e.start, e.end)].join(' · ')}</p>
          {others > 0 && <p className="mhe-line">{fmtList((e.guests ?? []).map((g) => g.name || g.email))}</p>}
          {k && <p className="mhe-line">{MEETING_NAME[k]}</p>}
          {j.can(e) && <p className="mhe-line">{on ? t('The notetaker joins and takes notes.') : t('The notetaker won’t join this one.')}</p>}
        </Sheet>
      )}
    </div>
  );
}

const FILTERS = [
  ['all', 'All'],
  ['recording', 'Recording'],
  ['tasks', 'Has tasks'],
  ['failed', 'Failed'],
] as const;

/**
 * Meet's home on phones (Google Meet's): a search pill, filter chips, "Coming up" (the next calls with the notetaker's
 * mic) above "Past meetings" (one title line and one plain line each; swipe right to file one).
 */
export function MeetHome(p: HomeProps) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [filing, setFiling] = useState<string | null>(null);
  const j = useJoins(p);
  const now = Date.now();
  const coming = useMemo(
    () => p.events.filter((e) => !e.allDay && isMeeting(e, p.demo) && new Date(e.end).getTime() > now && new Date(e.start).getTime() < now + 86_400_000).sort((a, b) => a.start.localeCompare(b.start)),
    [p.events, p.demo, now],
  );
  const past = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...p.meetings]
      .filter((m) => !p.unfiled || !m.clientId)
      .filter((m) => filter === 'all' || (filter === 'recording' ? LIVE.has(m.status ?? 'done') : filter === 'failed' ? m.status === 'failed' : p.tasks.some((tk) => tk.meetingId === m.id)))
      .filter((m) => !s || m.title.toLowerCase().includes(s) || m.summary.toLowerCase().includes(s) || (m.transcript ?? []).some((l) => l.text.toLowerCase().includes(s)))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [p.meetings, p.tasks, p.unfiled, q, filter]);
  return (
    <section className="meet-pane meet-home view-enter">
      <div className="tracking-scroll meet-list">
        <label className="mh-search">
          <Search size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search meetings, notes and transcripts')} aria-label={t('Search meetings')} enterKeyHint="search" />
          {q && (
            <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label={t('Clear')}>
              <X size={18} />
            </button>
          )}
        </label>
        <div className="mh-chips" role="radiogroup" aria-label={t('Show')}>
          {FILTERS.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} className={`mh-chip${filter === v ? ' on' : ''}`} onClick={() => setFilter(v)}>
              {t(l)}
            </button>
          ))}
        </div>

        {!p.unfiled && !p.notesOnly && !q && filter === 'all' && coming.length > 0 && (
          <>
            <h2 className="mh-head">{t('Coming up')}</h2>
            <div className="mh-card">
              {coming.slice(0, 3).map((e) => (
                <ComingRow key={e.id} e={e} p={p} j={j} />
              ))}
            </div>
            <button type="button" className="mh-all" onClick={() => p.onPage({ kind: 'upcoming' })}>
              {t('See all')}
            </button>
          </>
        )}

        <h2 className="mh-head">{p.unfiled ? t('Unfiled') : t('Past meetings')}</h2>
        {past.length > 0 ? (
          <div className="mh-card">
            {past.map((m) => {
              const c = p.clients.find((x) => x.id === m.clientId);
              const s = m.status ?? 'done';
              const row = (
                <div className="mh-row" key={m.id}>
                  <button type="button" className="mh-main" onClick={() => p.onPage({ kind: 'meeting', id: m.id })}>
                    <CallMark kind={m.platform ?? 'meet'} />
                    <span className="mh-text">
                      <strong>{m.title}</strong>
                      <small>
                        {fmtDate(m.at, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtDate(m.at, { hour: '2-digit', minute: '2-digit' })} · {c ? c.name : <span className="mh-unfiled">{t('Not filed')}</span>}
                      </small>
                    </span>
                    {LIVE.has(s) ? (
                      <span className="mh-status live">
                        <i /> {t(STATUS_LABEL[s])}
                      </span>
                    ) : s === 'failed' ? (
                      <span className="mh-status bad">{t(STATUS_LABEL[s])}</span>
                    ) : null}
                  </button>
                </div>
              );
              return (
                <SwipeRow key={m.id} className="mh-swipe" start={p.clients.length ? [{ id: 'file', label: t('File'), icon: Folder, tone: 'ok', run: () => setFiling(m.id) }] : []}>
                  {row}
                </SwipeRow>
              );
            })}
          </div>
        ) : (
          <EmptyState compact text={q || filter !== 'all' ? t('Nothing matches.') : t('No meetings here yet. Tap “{send}” to send the notetaker to one.', { send: t('Take notes') })} />
        )}
      </div>
      {filing && (
        <Sheet title={t('File under')} onClose={() => setFiling(null)} size={p.clients.length > 6 ? 'tall' : 'auto'}>
          <div className="as-list">
            {p.clients.map((c) => (
              <button key={c.id} type="button" className="as-item" onClick={() => (p.onFolder(filing, c.id, false), setFiling(null))}>
                <ProjectBadge p={c} kind="client-dot" />
                <span className="as-label">{c.name}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}

/** Everything coming up in the next 7 days (from "See all"): the same rows, by day. */
export function MeetUpcomingScreen(p: HomeProps & { onBack: () => void; onSendNow: (e: CalEvent) => void }) {
  return (
    <PushScreen title={t('Coming up')} onBack={p.onBack} className="meet-upcoming">
      <MeetComingList {...p} />
    </PushScreen>
  );
}

/**
 * Meetings (Meet's first section, and Calendar's Meetings on phones): what's live and coming up in the next 7 days,
 * by day, each with whether the notetaker joins.
 */
export function MeetComing(p: HomeProps) {
  const live = p.meetings.filter((m) => LIVE.has(m.status ?? 'done'));
  return (
    <section className="meet-pane meet-home view-enter">
      <div className="tracking-scroll meet-list">
        {live.length > 0 && (
          <>
            <h2 className="mh-head">{t('Now')}</h2>
            <div className="mh-card">
              {live.map((m) => (
                <div className="mh-row" key={m.id}>
                  <button type="button" className="mh-main" onClick={() => p.onPage({ kind: 'meeting', id: m.id })}>
                    <CallMark kind={m.platform ?? 'meet'} />
                    <span className="mh-text">
                      <strong>{m.title}</strong>
                      <small>{t('The notetaker is in this meeting')}</small>
                    </span>
                    <span className="mh-status live">
                      <i /> {t(STATUS_LABEL[m.status ?? 'done'])}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <MeetComingList {...p} />
        {p.meetings.some((m) => !LIVE.has(m.status ?? 'done')) && (
          <>
            <h2 className="mh-head">{t('Past meetings')}</h2>
            <div className="mh-card">
              {[...p.meetings]
                .filter((m) => !LIVE.has(m.status ?? 'done'))
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 5)
                .map((m) => {
                  const c = p.clients.find((x) => x.id === m.clientId);
                  return (
                    <div className="mh-row" key={m.id}>
                      <button type="button" className="mh-main" onClick={() => p.onPage({ kind: 'meeting', id: m.id })}>
                        <CallMark kind={m.platform ?? 'meet'} />
                        <span className="mh-text">
                          <strong>{m.title}</strong>
                          <small>{[fmtDate(m.at, { weekday: 'short', day: 'numeric', month: 'short' }), c?.name].filter(Boolean).join(' · ')}</small>
                        </span>
                      </button>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function MeetComingList(p: HomeProps) {
  const j = useJoins(p);
  const now = Date.now();
  const soon = p.events.filter((e) => !e.allDay && isMeeting(e, p.demo) && new Date(e.end).getTime() > now && new Date(e.start).getTime() < now + 7 * 86_400_000).sort((a, b) => a.start.localeCompare(b.start));
  const days = [...new Set(soon.map((e) => new Date(e.start).toDateString()))];
  return (
      <div className="mh-up">
        {days.map((d) => (
          <div key={d}>
            <h2 className="mh-head">{dayWord(new Date(d))}</h2>
            <div className="mh-card">
              {soon
                .filter((e) => new Date(e.start).toDateString() === d)
                .map((e) => (
                  <ComingRow key={e.id} e={e} p={p} j={j} />
                ))}
            </div>
          </div>
        ))}
        {!soon.length && <EmptyState compact text={t('No meetings in the next 7 days. Connect a calendar in Calendar, or send the bot to a meeting link.')} />}
      </div>
  );
}

/** Meet's Folders on phones: tasks from meetings, the unfiled ones, then a folder per project. */
export function MeetFolders({ clients, meetings, onPage, onSettings }: { clients: Client[]; meetings: Meeting[]; onPage: (p: MeetPage) => void; onSettings: () => void }) {
  const unfiled = meetings.filter((m) => !m.clientId).length;
  const row = (key: string, icon: ReactNode, label: string, sub: string | undefined, go: MeetPage) => (
    <div className="mh-row" key={key}>
      <button type="button" className="mh-main" onClick={() => onPage(go)}>
        {icon}
        <span className="mh-text">
          <strong>{label}</strong>
          {sub && <small>{sub}</small>}
        </span>
        <ChevronRight size={20} className="mh-chev" />
      </button>
    </div>
  );
  return (
    <section className="meet-pane meet-home view-enter">
      <div className="tracking-scroll meet-list">
        <div className="mh-card mh-first">
          {row('tasks', <span className="mh-ficon"><ListChecks size={20} /></span>, t('Tasks from meetings'), undefined, { kind: 'tasks' })}
          {row('unfiled', <span className="mh-ficon"><Inbox size={20} /></span>, t('Unfiled'), unfiled ? tn(unfiled, '{n} to file', '{n} to file') : undefined, { kind: 'unfiled' })}
        </div>
        {clients.length > 0 && (
          <>
            <h2 className="mh-head">{term.Many}</h2>
            <div className="mh-card">
              {clients.map((c) => {
                const n = meetings.filter((m) => m.clientId === c.id).length;
                return row(c.id, <IconTile letter={c.name} color={c.color} size={40} />, c.name, n ? tn(n, '{n} meeting', '{n} meetings') : t('No meetings yet'), { kind: 'folder', clientId: c.id });
              })}
            </div>
          </>
        )}
        <div className="mh-card mh-last">
          <div className="mh-row">
            <button type="button" className="mh-main" onClick={onSettings}>
              <span className="mh-ficon">
                <Settings size={20} />
              </span>
              <span className="mh-text">
                <strong>{t('Meet settings')}</strong>
              </span>
              <ChevronRight size={20} className="mh-chev" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
