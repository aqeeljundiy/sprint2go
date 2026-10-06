import { useState } from 'react';
import { term } from '../terms';
import { CheckSquare, LayoutTemplate, Repeat as RepeatIcon, Trash2, X } from 'lucide-react';
import type { Client, User } from '../types';
import type { TaskTemplate } from '../data/templates';
import { addWorkdays, localDay } from '../utils';
import { Select, Dot } from './ui/Select';
import { DatePicker, shortDate } from './ui/DatePicker';
import { Avatar } from './Avatar';

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
  const tpl = p.templates.find((t) => t.id === tplId);
  const count = (tpl?.tasks.length ?? 0) - skip.length;

  return (
    <div className="modal-scrim" onMouseDown={p.onClose}>
      <div className="modal tpl-modal" role="dialog" aria-label="Start from a template" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutTemplate size={15} /> Start from a template
          </span>
          <button className="icon-btn sm" onClick={p.onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body tpl-body">
          <div className="tpl-list">
            {p.templates.map((t) => (
              <button key={t.id} className={`tpl-card ${t.id === tplId ? 'on' : ''}`} onClick={() => (setTplId(t.id), setSkip([]))}>
                <strong>{t.name}</strong>
                <small>
                  {t.tasks.length} tasks{t.builtIn ? '' : ' · saved by your team'}
                </small>
                {!t.builtIn && (
                  <span
                    role="button"
                    className="tpl-del"
                    title="Delete template"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onDelete(t.id);
                      if (t.id === tplId) setTplId(p.templates[0]?.id ?? '');
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
              <p className="muted small">{tpl.description}</p>
              <div className="tpl-fields">
                <label className="field">
                  <span>{term.One}</span>
                  <Select
                    value={clientId}
                    onChange={setClientId}
                    label={`${term.One}`}
                    searchable
                    options={[{ value: '', label: `No ${term.one}` }, ...p.clients.map((c) => ({ value: c.id, label: c.name, icon: <Dot color={c.color} /> }))]}
                  />
                </label>
                <label className="field">
                  <span>Starts</span>
                  <DatePicker value={start} onChange={(v) => setStart(v || localDay())} clearable={false} label="Start date" />
                </label>
                <label className="field">
                  <span>In charge</span>
                  <Select value={ownerId} onChange={setOwnerId} label="In charge" searchable options={p.users.map((u) => ({ value: u.id, label: u.id === p.me ? `${u.name} (me)` : u.name, icon: <Avatar person={u} size={20} /> }))} />
                </label>
              </div>
              <ul className="tpl-tasks">
                {tpl.tasks.map((t, i) => {
                  const off = skip.includes(i);
                  return (
                    <li key={i} className={off ? 'off' : ''}>
                      <label>
                        <input type="checkbox" checked={!off} onChange={() => setSkip((s) => (off ? s.filter((x) => x !== i) : [...s, i]))} />
                        <span className="tpl-title">{t.title}</span>
                      </label>
                      <span className="tpl-meta">
                        {!!t.checklist?.length && (
                          <span title={t.checklist.join(', ')}>
                            <CheckSquare size={12} /> {t.checklist.length}
                          </span>
                        )}
                        {t.repeat && (
                          <span title={`Repeats ${t.repeat}`}>
                            <RepeatIcon size={12} /> {t.repeat}
                          </span>
                        )}
                        <time>{shortDate(addWorkdays(start, t.days))}</time>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">Each task goes to the team whose work it matches. Team leads pick who does it.</p>
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={p.onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!tpl || count === 0} onClick={() => tpl && p.onCreate(tpl, { clientId: clientId || undefined, start, ownerId, skip })}>
            Create brief and {count} task{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  );
}
