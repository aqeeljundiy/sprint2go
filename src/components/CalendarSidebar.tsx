import { useRef, useState } from 'react';
import { AlertTriangle, GripVertical, CalendarPlus, Check, ChevronLeft, ChevronDown, ChevronRight, Columns3, Columns4, Globe, Grid3x3, MoreHorizontal, Plus, RefreshCw, Rows3, Settings, Square, Trash2 } from 'lucide-react';
import type { CalendarDef, User, Workspace } from '../types';
import type { CalView } from './calendar/calTools';
import { viewLabel } from './calendar/calTools';
import { AppDrawer, DrawerCheck, DrawerDivider, DrawerHeading, DrawerRow } from './ui/AppDrawer';
import { PushScreen } from './ui/PushScreen';
import { addMonths, monthGrid, sameDay, startOfWeek } from '../calendarUtils';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { Popover } from './ui/Popover';
import { SourceMark } from './ConnectCalendar';
import { HolidayCountries } from './HolidayCountries';
import { calLabel } from '../data/calendar';
import { mark, t } from '../i18n';
import { fmtDate, fmtMonth } from '../i18n/format';

interface Props {
  cursor: Date;
  calendars: CalendarDef[]; // sprint2go calendars
  external: CalendarDef[]; // my connected calendars
  teammates: User[];
  shownMates: Set<string>;
  hidden: Set<string>;
  busyDays: Set<string>;
  onCursor: (d: Date) => void;
  onToggle: (id: string) => void;
  onToggleMate: (id: string) => void;
  onNew: () => void;
  onAddCalendar: () => void;
  onShare: (id: string, share: 'busy' | 'details' | 'private') => void;
  onSync: (id: string) => void | Promise<void>;
  onRemove: (id: string) => void;
  /** The company's public holidays (a calendar everyone in it has). */
  companyName: string;
  isAdmin: boolean;
  onHolidays: () => void; // pick or change the country
  onHolidaysOff: () => void;
  /** Whose public holidays this person sees (any of our countries; the company's until they choose). */
  holidayRegions?: string[];
  companyHolidayCountry?: string;
  onHolidayRegions?: (codes: string[]) => void;
  /** My open tasks without a time block yet: drag one onto the calendar. */
  toPlan?: { id: string; title: string; sub?: string; late?: boolean }[];
  onPlan?: (id: string) => void; // pick a time for it (phones can't drag): how long, then a free slot
  /** Phones: the same calendars as Google Calendar's drawer (the views first, Settings last), opened from ☰. */
  drawer?: CalDrawer;
}

/** What Calendar's phone drawer adds to the panel's own data. */
export interface CalDrawer {
  open: boolean;
  onClose: () => void;
  view: CalView;
  views: CalView[];
  onView: (v: CalView) => void;
  company?: Pick<Workspace, 'name' | 'logo' | 'color'>;
  /** Calendar's settings pages (Notifications), opened over the app. */
  settings: { id: string; label: string; hint?: string; run: () => void }[];
}

const VIEW_ICON: Record<CalView, typeof Rows3> = { schedule: Rows3, day: Square, '3day': Columns3, week: Columns4, month: Grid3x3 };

export function CalendarSidebar(props: Props) {
  const { cursor, calendars, external, teammates, shownMates, hidden, busyDays, onCursor, onToggle, onToggleMate, onNew, onAddCalendar, onShare, onSync, onRemove, companyName, isAdmin, onHolidays, onHolidaysOff, holidayRegions, companyHolidayCountry, onHolidayRegions, toPlan = [], onPlan } = props;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const menuCal = external.find((c) => c.id === menuFor);
  // The group's key; the two built-in groups are shown in the person's language (t(acc)).
  const groupOf = (c: CalendarDef) => c.account ?? (c.source === 'holidays' ? mark('Public holidays') : mark('Calendar links'));
  const accounts = [...new Set(external.map(groupOf))];
  const companyHolidays = menuCal?.source === 'holidays' && !!menuCal.workspaceId;
  const myHolidays = menuCal?.source === 'holidays' && !menuCal.workspaceId; // another country, chosen by this person
  const sync = async (id: string) => {
    setSyncing(id);
    try {
      await onSync(id);
    } finally {
      setSyncing(null);
    }
  };
  const cells = monthGrid(cursor);
  const today = new Date();
  const week = startOfWeek(cursor).getTime();

  // Which calendar's options are open (its menu): the same menu on phones and on the side panel.
  const calMenu = (
    <Popover anchor={anchor} open={!!menuCal} onClose={() => setMenuFor(null)} width={280} title={menuCal ? calLabel(menuCal) : undefined}>
      {menuCal && (
        <div className="sel-pop cal-menu">
          {/* Where it comes from and whether it's keeping up. */}
          {menuCal.error ? (
            <div className="cal-status bad" role="status">
              <AlertTriangle size={14} />
              <span>
                <strong>{t('Not updating')}</strong>
                <small>
                  {t(menuCal.error)}
                  {menuCal.syncedAt ? ` ${t('Last worked {when}.', { when: relative(menuCal.syncedAt) })}` : ''}
                </small>
              </span>
            </div>
          ) : menuCal.source === 'ics' || menuCal.source === 'holidays' ? (
            <div className="cal-status">
              {menuCal.source === 'holidays' ? <Globe size={14} /> : <RefreshCw size={14} />}
              <span>
                <strong>{menuCal.syncedAt ? t('Updated {when}', { when: relative(menuCal.syncedAt) }) : t('Reading it now…')}</strong>
                <small>{companyHolidays ? t('For everyone at {company}. Checked daily.', { company: companyName }) : myHolidays ? t('Only on your calendar. Checked daily.') : t('Read only. Updates every 30 minutes.')}</small>
              </span>
            </div>
          ) : null}
          {!companyHolidays && !myHolidays && (
            <>
              <div className="sel-group">{t('Teammates see')}</div>
              {(
                [
                  ['busy', t('Busy only'), t('A busy block, never the title')],
                  ['details', t('Full details'), t('Titles and places')],
                  ['private', t('Nothing'), t('Only you see these')],
                ] as const
              ).map(([v, l, h]) => (
                <button key={v} className="sel-opt" onClick={() => (onShare(menuCal.id, v), setMenuFor(null))}>
                  <span className="sel-label">
                    {l}
                    <small>{h}</small>
                  </span>
                  {(menuCal.share ?? 'busy') === v && <Check size={14} className="sel-check" />}
                </button>
              ))}
              <div className="sel-sep" />
            </>
          )}
          {(!menuCal.readOnly || menuCal.source === 'ics' || companyHolidays) && (
            <button className="sel-opt" disabled={syncing === menuCal.id} onClick={() => void sync(menuCal.id).then(() => setMenuFor(null))}>
              <RefreshCw size={14} className={syncing === menuCal.id ? 'spin' : ''} /> {menuCal.error ? t('Try again now') : t('Update now')}
            </button>
          )}
          {companyHolidays ? (
            isAdmin ? (
              <>
                <button className="sel-opt" onClick={() => (setMenuFor(null), onHolidays())}>
                  <Globe size={14} /> {t('Change country')}
                </button>
                <button className="sel-opt danger" onClick={() => (setMenuFor(null), onHolidaysOff())}>
                  <Trash2 size={14} /> {t('Remove for everyone')}
                </button>
              </>
            ) : (
              <p className="cal-menu-note">{t('Owners and admins pick the company’s country, in Settings, General. Untick it to hide it just for you, or choose other countries under Public holidays.')}</p>
            )
          ) : (
            <button className="sel-opt danger" onClick={() => (onRemove(menuCal.id), setMenuFor(null))}>
              <Trash2 size={14} /> {myHolidays ? t('Remove from my calendar') : t('Remove calendar')}
            </button>
          )}
        </div>
      )}
    </Popover>
  );

  if (props.drawer) return <CalendarDrawerView {...props} drawer={props.drawer} calMenu={calMenu} onMenu={(id, el) => ((anchor.current = el), setMenuFor(id))} groupOf={groupOf} accounts={accounts} />;

  return (
    <>
      <button className="compose-btn" onClick={onNew} title={t('New event (C)')}>
        <Plus size={16} />
        <span className="sb-label">{t('New event')}</span>
        <kbd className="sb-label">C</kbd>
      </button>

      <div className="mini">
        <div className="mini-head">
          <span>{fmtMonth(cursor)}</span>
          <div>
            <button className="icon-btn sm" onClick={() => onCursor(addMonths(cursor, -1))} aria-label={t('Previous month')}>
              <ChevronLeft size={15} />
            </button>
            <button className="icon-btn sm" onClick={() => onCursor(addMonths(cursor, 1))} aria-label={t('Next month')}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="mini-grid">
          {cells.slice(0, 7).map((d) => (
            <span key={`h${d.getDay()}`} className="mini-dow">
              {fmtDate(d, { weekday: 'narrow' })}
            </span>
          ))}
          {cells.map((d) => (
            <button
              key={d.toISOString()}
              className={[
                'mini-day',
                d.getMonth() !== cursor.getMonth() && 'out',
                sameDay(d, today) && 'today',
                sameDay(d, cursor) && 'picked',
                startOfWeek(d).getTime() === week && 'in-week',
                busyDays.has(d.toDateString()) && 'busy',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onCursor(d)}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
      </div>

      {toPlan.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Plan your tasks')}</div>
          <p className="muted small sb-label plan-hint">{t('Drag a task onto the calendar, or click it to pick a time.')}</p>
          <nav className="nav plan-list">
            {toPlan.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className={`plan-task sb-label ${task.late ? 'late' : ''}`}
                draggable
                onClick={() => onPlan?.(task.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/s2g-task', task.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title={t('Drag onto the calendar')}
              >
                <GripVertical size={13} className="pt-grip" />
                <span className="pt-text">
                  <strong>{task.title}</strong>
                  {task.sub && <small>{task.sub}</small>}
                </span>
                {onPlan && (
                  <button className="icon-btn sm pt-add" title={t('Pick a time')} aria-label={t('Pick a time for “{title}”', { title: task.title })} onClick={(e) => (e.stopPropagation(), onPlan(task.id))}>
                    <CalendarPlus size={14} />
                  </button>
                )}
              </div>
            ))}
          </nav>
        </>
      )}

      <div className="nav-heading sb-label">{t('My calendars')}</div>
      <nav className="nav">
        {calendars.map((c) => {
          const on = !hidden.has(c.id);
          return (
            <button key={c.id} className="nav-item" onClick={() => onToggle(c.id)} title={calLabel(c)}>
              <span className={`cal-check ${on ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="sb-label">{calLabel(c)}</span>
            </button>
          );
        })}
      </nav>

      {accounts.map((acc) => (
        <div key={acc}>
          <div className="nav-heading sb-label cal-acc">
            {(() => {
              const first = external.find((c) => groupOf(c) === acc)!;
              return <SourceMark source={first.source ?? 'sprint2go'} size={14} />;
            })()}
            <span>{acc === 'Public holidays' || acc === 'Calendar links' ? t(acc) : acc}</span>
          </div>
          <nav className="nav">
            {external
              .filter((c) => groupOf(c) === acc)
              .map((c) => {
                const on = !hidden.has(c.id);
                return (
                  <div key={c.id} className="nav-row">
                    <button className="nav-item" onClick={() => onToggle(c.id)} title={c.error ? t('{name}: not updating. {why}', { name: calLabel(c), why: t(c.error) }) : c.syncedAt ? t('{name}, updated {when}', { name: calLabel(c), when: relative(c.syncedAt) }) : calLabel(c)}>
                      <span className={`cal-check ${on ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="sb-label">
                        {calLabel(c)}
                        {c.source !== 'holidays' && c.share === 'busy' && <em className="cal-share">{t('busy only')}</em>}
                        {c.source !== 'holidays' && c.share === 'private' && <em className="cal-share">{t('private')}</em>}
                      </span>
                      {c.error && <AlertTriangle size={13} className="cal-warn sb-label" aria-label={t('Not updating')} />}
                    </button>
                    <button
                      className="nav-more"
                      aria-label={t('Calendar options')}
                      onClick={(e) => {
                        anchor.current = e.currentTarget;
                        setMenuFor(c.id);
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                );
              })}
            {acc === 'Public holidays' && holidayRegions && onHolidayRegions && (
              <HolidayCountries regions={holidayRegions} company={companyHolidayCountry} companyName={companyName} onChange={onHolidayRegions} />
            )}
          </nav>
        </div>
      ))}
      <nav className="nav">
        <button className="nav-item" onClick={onAddCalendar} title={t('Add a calendar')}>
          <Plus size={16} />
          <span className="sb-label">{t('Add a calendar')}</span>
        </button>
      </nav>

      {teammates.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Teammates')}</div>
          <nav className="nav">
            {teammates.map((u) => {
              const on = shownMates.has(u.id);
              return (
                <button key={u.id} className={`nav-item ${on ? 'active' : ''}`} onClick={() => onToggleMate(u.id)} title={t('Show when {name} is busy', { name: u.name.split(' ')[0] })}>
                  <Avatar person={u} size={20} />
                  <span className="sb-label">{u.name}</span>
                  {on && <Check size={14} className="mate-on" />}
                </button>
              );
            })}
          </nav>
        </>
      )}

      {calMenu}
    </>
  );
}


/**
 * Calendar's drawer on phones (Google Calendar's): the company, the views, the calendars with their checkboxes (each
 * connected account under its address, holidays, teammates' busy times), Add a calendar, and Settings last.
 */
function CalendarDrawerView(p: Props & { drawer: CalDrawer; calMenu: React.ReactNode; onMenu: (id: string, el: HTMLElement) => void; groupOf: (c: CalendarDef) => string; accounts: string[] }) {
  const { drawer: d, calendars, external, teammates, shownMates, hidden, onToggle, onToggleMate, onAddCalendar, groupOf, accounts } = p;
  const [allMates, setAllMates] = useState(false);
  const [settings, setSettings] = useState(false);
  const mates = allMates ? teammates : teammates.slice(0, 4);
  const shareWords = (c: CalendarDef) => (c.source === 'holidays' ? undefined : c.share === 'busy' ? t('Busy only') : c.share === 'private' ? t('Private') : undefined);
  return (
    <>
      {d.open && (
        <AppDrawer label={t('Calendar')} company={d.company} onClose={d.onClose}>
          <nav className="ad-group" aria-label={t('Views')}>
            {d.views.map((v) => {
              const Icon = VIEW_ICON[v];
              return <DrawerRow key={v} icon={<Icon size={20} />} label={viewLabel(v)} on={d.view === v} onClick={() => (d.onView(v), d.onClose())} />;
            })}
          </nav>
          <DrawerDivider />
          <DrawerHeading>{t('My calendars')}</DrawerHeading>
          {calendars.map((c) => (
            <DrawerRow key={c.id} icon={<DrawerCheck on={!hidden.has(c.id)} color={c.color} />} label={calLabel(c)} pressed={!hidden.has(c.id)} onClick={() => onToggle(c.id)} />
          ))}
          {accounts.map((acc) => {
            const first = external.find((c) => groupOf(c) === acc)!;
            return (
              <div key={acc} className="ad-group">
                <DrawerHeading>
                  <SourceMark source={first.source ?? 'sprint2go'} size={16} />
                  <span>{acc === 'Public holidays' || acc === 'Calendar links' ? t(acc) : acc}</span>
                </DrawerHeading>
                {external
                  .filter((c) => groupOf(c) === acc)
                  .map((c) => (
                    <DrawerRow
                      key={c.id}
                      icon={<DrawerCheck on={!hidden.has(c.id)} color={c.color} />}
                      label={calLabel(c)}
                      sub={c.error ? t('Not updating') : shareWords(c)}
                      pressed={!hidden.has(c.id)}
                      onClick={() => onToggle(c.id)}
                      end={
                        <button type="button" className="icon-btn ad-end" aria-label={t('Calendar options')} onClick={(e) => p.onMenu(c.id, e.currentTarget)}>
                          <MoreHorizontal size={18} />
                        </button>
                      }
                    />
                  ))}
              </div>
            );
          })}
          {teammates.length > 0 && (
            <div className="ad-group">
              <DrawerHeading>{t('Teammates’ busy times')}</DrawerHeading>
              {mates.map((u) => (
                <DrawerRow key={u.id} icon={<DrawerCheck on={shownMates.has(u.id)} color={u.color ?? 'var(--text-3)'} />} label={u.name} pressed={shownMates.has(u.id)} onClick={() => onToggleMate(u.id)} title={t('Show when {name} is busy', { name: u.name.split(' ')[0] })} />
              ))}
              {teammates.length > 4 && (
                <DrawerRow icon={<ChevronDown size={18} className={`rot-chev${allMates ? ' open' : ''}`} />} label={allMates ? t('Show fewer') : t('Show {n} more', { n: teammates.length - 4 })} onClick={() => setAllMates((o) => !o)} />
              )}
            </div>
          )}
          <DrawerRow icon={<Plus size={20} />} label={t('Add a calendar')} onClick={() => (d.onClose(), onAddCalendar())} />
          <DrawerDivider />
          <DrawerRow icon={<Settings size={20} />} label={t('Settings')} onClick={() => (d.onClose(), setSettings(true))} />
        </AppDrawer>
      )}
      {settings && (
        <PushScreen title={t('Calendar settings')} onBack={() => setSettings(false)} className="cal-settings">
          <div className="as-list cal-settings-list">
            {d.settings.map((r) => (
              <button key={r.id} type="button" className="as-item" onClick={r.run}>
                <span className="as-label">
                  {r.label}
                  {r.hint && <small>{r.hint}</small>}
                </span>
                <ChevronRight size={18} className="as-chev" />
              </button>
            ))}
            {p.holidayRegions && p.onHolidayRegions && (
              <div className="cal-settings-hol">
                <div className="ad-heading">{t('Public holidays')}</div>
                <HolidayCountries regions={p.holidayRegions} company={p.companyHolidayCountry} companyName={p.companyName} onChange={p.onHolidayRegions} />
              </div>
            )}
          </div>
        </PushScreen>
      )}
      {p.calMenu}
    </>
  );
}
