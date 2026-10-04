import { useState } from 'react';
import { Check, ExternalLink, ListChecks, Menu, Mic, Plus, Users, Video } from 'lucide-react';
import type { Client, Meeting, Todo } from '../types';
import { fullDate, relative } from '../utils';
import { statusOf } from './TasksView';

interface Props {
  meetings: Meeting[];
  clients: Client[];
  tasks: Todo[];
  selected: string | null;
  meetUrl?: string;
  onSelect: (id: string) => void;
  onMakeTask: (m: Meeting, actionIndex: number) => void;
  onMakeAll: (m: Meeting) => void;
  onOpenTask: (id: string) => void;
  onOpenClient: (id: string) => void;
  onMenu: () => void;
}

/** Meeting notes from the notetaker. Action items turn into assigned tasks. */
export function MeetView({ meetings, clients, tasks, selected, meetUrl, onSelect, onMakeTask, onMakeAll, onOpenTask, onOpenClient, onMenu }: Props) {
  const list = [...meetings].sort((a, b) => b.at.localeCompare(a.at));
  const [mobileDetail, setMobileDetail] = useState(false);
  const m = list.find((x) => x.id === selected) ?? list[0];
  const client = m?.clientId ? clients.find((c) => c.id === m.clientId) : undefined;
  const pending = m ? m.actions.filter((a) => !a.taskId).length : 0;

  return (
    <section className={`meet-pane view-enter ${mobileDetail ? 'detail' : ''}`}>
      <div className="meet-list">
        <header className="tracking-head">
          <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="th-text">
            <h1>Meet</h1>
            <p>Notes and action items from your calls</p>
          </div>
        </header>
        {meetUrl && (
          <a className="meet-open" href={meetUrl} target="_blank" rel="noreferrer">
            <Video size={15} /> Open the notetaker <ExternalLink size={13} />
          </a>
        )}
        <ul>
          {list.map((x) => {
            const c = clients.find((cl) => cl.id === x.clientId);
            return (
              <li key={x.id}>
                <button
                  className={x.id === m?.id ? 'on' : ''}
                  onClick={() => {
                    onSelect(x.id);
                    setMobileDetail(true);
                  }}
                >
                  <span className="meet-ic">
                    <Mic size={14} />
                  </span>
                  <span className="meet-li">
                    <strong>{x.title}</strong>
                    <small>
                      {relative(x.at)} · {x.minutes} min{c ? ` · ${c.name}` : ''}
                    </small>
                  </span>
                  {x.actions.some((a) => !a.taskId) && <span className="dot-new" title="Action items not yet tasks" />}
                </button>
              </li>
            );
          })}
        </ul>
        {list.length === 0 && <p className="te-empty">No meetings yet. Invite the notetaker to a call and its notes appear here.</p>}
      </div>

      {m && (
        <div className="meet-detail" key={m.id}>
          <button className="ghost-btn sm meet-back" onClick={() => setMobileDetail(false)}>
            ← All meetings
          </button>
          <h2>{m.title}</h2>
          <p className="muted">
            {fullDate(m.at)} · {m.minutes} min ·{' '}
            {client ? (
              <button className="link-btn" onClick={() => onOpenClient(client.id)}>
                {client.name}
              </button>
            ) : (
              'Internal'
            )}
          </p>
          <div className="meet-people">
            <Users size={14} /> {m.attendees.join(', ')}
          </div>

          <div className="ais-label">Summary</div>
          <p className="meet-summary">{m.summary}</p>

          <div className="meet-actions-head">
            <div className="ais-label">Action items</div>
            {pending > 1 && (
              <button className="primary-btn sm" onClick={() => onMakeAll(m)}>
                <ListChecks size={14} /> Make all {pending} tasks
              </button>
            )}
          </div>
          <ul className="meet-actions">
            {m.actions.map((a, i) => {
              const t = a.taskId ? tasks.find((x) => x.id === a.taskId) : undefined;
              return (
                <li key={i}>
                  <span className={`ma-check ${t ? statusOf(t) : ''}`}>{t && statusOf(t) === 'done' ? <Check size={12} /> : null}</span>
                  <span className="ma-text">
                    {a.title}
                    <small>
                      {a.owner ?? 'No owner'}
                      {a.due ? ` · ${a.due}` : ''}
                    </small>
                  </span>
                  {t ? (
                    <button className="ghost-btn outline sm" onClick={() => onOpenTask(t.id)}>
                      View task
                    </button>
                  ) : (
                    <button className="ghost-btn outline sm" onClick={() => onMakeTask(m, i)}>
                      <Plus size={13} /> Make task
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
