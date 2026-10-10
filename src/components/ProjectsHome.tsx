import { ProjectBadge } from './ProjectBadge';
import { IconTile } from './ui/IconTile';
import { useRef, useState } from 'react';
import { usePersisted } from '../settings';
import { Popover } from './ui/Popover';
import { Archive, ArrowRight, Check, Menu, Plus, SlidersHorizontal } from 'lucide-react';
import type { Client, Todo, User } from '../types';
import { PROJECT_TYPES, term } from '../terms';
import { localDay, relative } from '../utils';
import { Avatar } from './Avatar';
import { isBrief } from './TasksView';
import { kindOf } from '../stages';
import { Select } from './ui/Select';
import { SmoothHeight } from './ui/Smooth';
import { EmptyState } from './ui/EmptyState';
import { useCreateAction } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { TasksBrowse, type BrowseGroup } from './tasks/TasksBrowse';
import { t, tn, tx } from '../i18n';
import { fmtDay } from '../i18n/format';

/**
 * The Projects app's home: every project, the ones that need something first. Each card says what's wrong (late,
 * nobody on it, waiting on a guest) or that it's on track, and opens the project's hub.
 */
export function ProjectsHome({ projects, tasks, users, onOpen, onCreate, onMenu, startAdding, onPast }: { startAdding?: boolean; projects: Client[]; tasks: Todo[]; users: User[]; onOpen: (id: string) => void; onCreate?: (name: string, type?: string) => void; onPast?: () => void; onMenu: () => void }) {
  const [adding, setAdding] = useState(!!startAdding);
  const phone = usePhone();
  useCreateAction('projects', !!onCreate && { label: t('New {project}', { project: term.one }), icon: Plus, run: () => setAdding(true) });
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  // What each card shows, chosen by each person.
  const [cardFields, setCardFields] = usePersisted<string[]>('s2g-project-card-fields', ['type', 'owner', 'state', 'next', 'updated']);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fieldsBtn = useRef<HTMLButtonElement>(null);
  const on = (id: string) => cardFields.includes(id);
  const today = localDay();
  const live = projects.filter((c) => c.status !== 'ended');
  const stats = (c: Client) => {
    const open = tasks.filter((x) => x.clientId === c.id && !x.done && !isBrief(x));
    const late = open.filter((x) => x.due && x.due < today).length;
    const nobody = open.filter((x) => !x.userId && !(x.assignees?.length)).length;
    const guest = open.filter((x) => kindOf(x) === 'waiting' || x.approval?.status === 'waiting').length;
    const last = tasks
      .filter((x) => x.clientId === c.id)
      .map((x) => x.history?.at(-1)?.at ?? x.createdAt)
      .sort()
      .pop();
    const next = open.filter((x) => x.due && x.due >= today).sort((a, b) => a.due!.localeCompare(b.due!))[0];
    return { late, nobody, guest, open: open.length, last, next };
  };
  const rows = live.map((c) => ({ c, s: stats(c) })).sort((a, b) => b.s.late - a.s.late || b.s.nobody - a.s.nobody || a.c.name.localeCompare(b.c.name));
  const save = () => {
    if (!name.trim()) return;
    onCreate?.(name.trim(), type || undefined);
    setName('');
    setType('');
    setAdding(false);
  };
  const newForm = (
    <SmoothHeight>
      {adding && (
        <div className="proj-new">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setAdding(false))} placeholder={t('{Project} name', { project: term.one })} />
          <Select<string> value={type} onChange={setType} label={t('Type')} className="sel-flat" options={[{ value: '', label: t('No type') }, ...PROJECT_TYPES.map((ty) => ({ value: ty, label: t(ty) }))]} />
          <button className="ghost-btn sm" onClick={() => setAdding(false)}>
            {t('Cancel')}
          </button>
          <button className="primary-btn sm" disabled={!name.trim()} onClick={save}>
            {t('Add')}
          </button>
        </div>
      )}
    </SmoothHeight>
  );

  // Phones: the projects as rows (Todoist's Browse), by status, with what needs a look at the right.
  if (phone) {
    const hint = (s: ReturnType<typeof stats>) =>
      s.late ? { hint: tn(s.late, '{n} late', '{n} late'), tone: 'danger' as const } : s.guest ? { hint: t('Waiting on {who}', { who: term.who }) } : s.nobody ? { hint: tn(s.nobody, '{n} not picked up', '{n} not picked up') } : {};
    const row = ({ c, s }: (typeof rows)[number]) => ({
      id: c.id,
      label: c.name,
      icon: c.photo ? <span className="tbr-photo"><ProjectBadge p={c} kind="client-badge" /></span> : <IconTile letter={c.name} color={c.color} />, // N4: a project is a tile with its initial everywhere
      ...hint(s),
      run: () => onOpen(c.id),
    });
    const groups: BrowseGroup[] = [
      { id: 'active', title: t('Active'), rows: rows.filter((r) => r.c.status === 'active').map(row) },
      { id: 'lead', title: t('Leads'), rows: rows.filter((r) => r.c.status === 'lead').map(row) },
      { id: 'paused', title: t('Paused'), rows: rows.filter((r) => r.c.status === 'paused').map(row) },
      ...(onPast ? [{ id: 'past', rows: [{ id: 'past', label: t('Past {projects}', { projects: term.many }), icon: <Archive size={22} />, muted: true, run: onPast }] }] : []),
    ];
    return (
      <TasksBrowse
        groups={groups}
        top={
          <>
            {newForm}
            {rows.length === 0 && (
              <EmptyState
                icon={<Plus size={20} />}
                title={t('No {projects} yet', { projects: term.many })}
                text={t('A {project} holds everything about one piece of work: its tasks, chat, mail, meetings, files, notes, logins and the {whos} you invite.', { project: term.one, whos: term.whos })}
              />
            )}
          </>
        }
      />
    );
  }

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>{term.Many}</h1>
          <p>{t('Everything about each one, in one place: tasks, chat, mail, meetings, files, notes and logins.')}</p>
        </div>
        <button ref={fieldsBtn} className="icon-btn" onClick={() => setFieldsOpen(true)} title={t('What cards show')} aria-label={t('What cards show')}>
          <SlidersHorizontal size={16} />
        </button>
        <Popover anchor={fieldsBtn} open={fieldsOpen} onClose={() => setFieldsOpen(false)} width={240} align="end" title={t('On each card')}>
          <div className="tab-edit-list">
            <p className="muted small">{t('What each {project} card shows. Just for you.', { project: term.one })}</p>
            {(
              [
                ['type', t('Type and status')],
                ['owner', t('Owner')],
                ['people', t('People on it')],
                ['state', t('What needs attention')],
                ['next', t('Next deadline')],
                ['updated', t('Last activity')],
              ] as const
            ).map(([id, name]) => (
              <label key={id} className="check-row tb-field-toggle">
                <input type="checkbox" checked={on(id)} onChange={(e) => setCardFields(e.target.checked ? [...cardFields, id] : cardFields.filter((x) => x !== id))} /> {name}
              </label>
            ))}
          </div>
        </Popover>
        {onCreate && (
          <button className="primary-btn sm" onClick={() => setAdding((a) => !a)}>
            <Plus size={14} /> {t('New {project}', { project: term.one })}
          </button>
        )}
      </header>
      <div className="tracking-scroll">
        {newForm}
        {rows.length === 0 ? (
          <EmptyState
            icon={<Plus size={20} />}
            title={t('No {projects} yet', { projects: term.many })}
            text={t('A {project} holds everything about one piece of work: its tasks, chat, mail, meetings, files, notes, logins and the {whos} you invite.', { project: term.one, whos: term.whos })}
            action={
              onCreate && (
                <button className="primary-btn sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> {t('New {project}', { project: term.one })}
                </button>
              )
            }
          />
        ) : (
          <div className="proj-grid">
            {rows.map(({ c, s }, i) => {
              const owner = users.find((u) => u.id === c.ownerId);
              const issues = [s.late && tn(s.late, '{n} late', '{n} late'), s.nobody && tn(s.nobody, '{n} not picked up', '{n} not picked up'), s.guest && tn(s.guest, '{n} waiting on {who}', '{n} waiting on {who}', { who: term.who })].filter(Boolean) as string[];
              return (
                <button key={c.id} className="proj-card" style={{ ['--i' as string]: i }} onClick={() => onOpen(c.id)}>
                  <span className="proj-top">
                    <ProjectBadge p={c} kind="client-badge" />
                    <span className="proj-name">
                      <strong>{c.name}</strong>
                      {on('type') && (
                        <small>
                          {[c.type ? t(c.type) : null, c.status === 'lead' ? tx('status', 'Lead') : c.status === 'paused' ? t('Paused') : null].filter(Boolean).join(' · ') || ' '}
                        </small>
                      )}
                    </span>
                    {on('owner') && owner && <Avatar person={owner} size={24} />}
                  </span>
                  {on('people') && (c.members?.length ?? 0) > 0 && (
                    <span className="avatar-stack proj-card-people">
                      {(c.members ?? []).slice(0, 5).map((m) => {
                        const u = users.find((x) => x.id === m.userId);
                        return u ? <Avatar key={u.id} person={u} size={20} /> : null;
                      })}
                    </span>
                  )}
                  {on('next') && s.next && (
                    <span className="proj-next small">
                      {t('Next: {title} · {due}', { title: s.next.title, due: fmtDay(s.next.due!) })}
                    </span>
                  )}
                  {on('state') && <span className={`proj-state ${issues.length ? (s.late ? 'bad' : 'warn') : 'ok'}`}>
                    {issues.length ? (
                      issues.join(' · ')
                    ) : (
                      <>
                        <Check size={13} /> {s.open ? t('On track') : t('Nothing open')}
                      </>
                    )}
                  </span>}
                  <span className="proj-foot">
                    <small>{on('updated') ? (s.last ? t('Updated {when}', { when: relative(s.last) }) : t('No activity yet')) : ''}</small>
                    <ArrowRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
