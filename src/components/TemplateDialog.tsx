import { useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { CheckSquare, LayoutTemplate, Repeat as RepeatIcon, Trash2, X } from 'lucide-react';
import type { Client, User } from '../types';
import { tplText, type TaskTemplate } from '../data/templates';
import { addWorkdays, localDay } from '../utils';
import { Select } from './ui/Select';
import { DatePicker, shortDate } from './ui/DatePicker';
import { Avatar } from './Avatar';
import { personOption } from './ui/PeopleList';
import { t, tn } from '../i18n';

interface Props {
  templates: TaskTemplate[];
  clients: Client[];
  users: User[];
  me: string;
  clientId?: string; // opened from a client page
  onCreate: (tpl: TaskTemplate, opts: { clientId?: string; start: string; ownerId: string; skip: number[] }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Start a brief from a template: pick one, the client, the start date and who's in charge. Tasks get spaced-out due dates. */
export function TemplateDialog(p: Props) {
  const [tplId, setTplId] = useState(p.templates[0]?.id ?? '');
  const [clientId, setClientId] = useState(p.clientId ?? '');
  const [start, setStart] = useState(localDay());
  const [ownerId, setOwnerId] = useState(p.me);
  const [skip, setSkip] = useState<number[]>([]);
  const tpl = p.templates.find((x) => x.id === tplId);
  const count = (tpl?.tasks.length ?? 0) - skip.length;

  return (
    <div className="modal-scrim" onMouseDown={p.onClose}>
      <div className="modal tpl-modal" role="dialog" aria-label={t('Start from a template')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutTemplate size={15} /> {t('Start from a template')}
          </span>
          <button className="icon-btn sm" onClick={p.onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body tpl-body">
          <SmoothHeight>
          <div className="tpl-list">
            {p.templates.map((x) => (
              <button key={x.id} className={`tpl-card ${x.id === tplId ? 'on' : ''}`} onClick={() => (setTplId(x.id), setSkip([]))}>
                <strong>{tplText(x, x.name)}</strong>
                <small>{x.builtIn ? tn(x.tasks.length, '{n} task', '{n} tasks') : tn(x.tasks.length, '{n} task · saved by your team', '{n} tasks · saved by your team')}</small>
                {!x.builtIn && (
                  <span
                    role="button"
                    className="tpl-del"
                    title={t('Delete template')}
                    aria-label={t('Delete template')}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onDelete(x.id);
                      if (x.id === tplId) setTplId(p.templates[0]?.id ?? '');
                    }}
                  >
                    <Trash2 size={13} />
                  </span>
                )}
              </button>
            ))}
          </div>
          {tpl && (
            <div className="tpl-detail">
              <p className="muted small">{tplText(tpl, tpl.description)}</p>
              <div className="tpl-fields">
                <label className="field">
                  <span>{term.One}</span>
                  <ProjectPicker value={clientId} onChange={setClientId} projects={p.clients} none={t('No {project}', { project: term.one })} />
                </label>
                <label className="field">
                  <span>{t('Starts')}</span>
                  <DatePicker value={start} onChange={(v) => setStart(v || localDay())} clearable={false} label={t('Start date')} />
                </label>
                <label className="field">
                  <span>{t('In charge')}</span>
                  <Select value={ownerId} onChange={setOwnerId} label={t('In charge')} searchable options={p.users.map((u) => ({ ...personOption(u), label: u.id === p.me ? t('{name} (me)', { name: u.name }) : u.name, icon: <Avatar person={u} size={20} /> }))} />
                </label>
              </div>
              <ul className="tpl-tasks">
                {tpl.tasks.map((x, i) => {
                  const off = skip.includes(i);
                  const repeat = x.repeat === 'daily' ? t('Every day') : x.repeat === 'weekdays' ? t('Every weekday') : x.repeat === 'weekly' ? t('Every week') : x.repeat === 'monthly' ? t('Every month') : '';
                  return (
                    <li key={i} className={off ? 'off' : ''}>
                      <label>
                        <input type="checkbox" checked={!off} onChange={() => setSkip((s) => (off ? s.filter((y) => y !== i) : [...s, i]))} />
                        <span className="tpl-title">{tplText(tpl, x.title)}</span>
                      </label>
                      <span className="tpl-meta">
                        {!!x.checklist?.length && (
                          <span title={x.checklist.map((c) => tplText(tpl, c)).join(', ')}>
                            <CheckSquare size={12} /> {x.checklist.length}
                          </span>
                        )}
                        {x.repeat && (
                          <span title={repeat}>
                            <RepeatIcon size={12} /> {repeat}
                          </span>
                        )}
                        <time>{shortDate(addWorkdays(start, x.days))}</time>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">{t('Each task goes to the team whose work it matches. Team leads pick who does it.')}</p>
            </div>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={p.onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!tpl || count === 0} onClick={() => tpl && p.onCreate(tpl, { clientId: clientId || undefined, start, ownerId, skip })}>
            {tn(count, 'Create brief and {n} task', 'Create brief and {n} tasks')}
          </button>
        </footer>
      </div>
    </div>
  );
}
