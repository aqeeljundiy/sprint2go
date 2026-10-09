import { ProjectBadge } from './ProjectBadge';
import { Archive, RotateCcw } from 'lucide-react';
import { term } from '../terms';
import type { Client, Todo } from '../types';
import { EmptyState } from './ui/EmptyState';
import { t, tn } from '../i18n';
import { fmtDate } from '../i18n/format';

const month = (iso: string) => fmtDate(iso, { month: 'short', year: 'numeric' });
const monthsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (30.4 * 86_400_000)));

/** When the work with a client started: as set, or their first task. */
export const startedOf = (c: Client, tasks: Todo[]) => c.since ?? tasks.filter((x) => x.clientId === c.id).map((x) => x.createdAt).sort()[0];

/**
 * Past clients, and a look back at clients over time (who started and who ended, month by month).
 * A look-back page, so it lives here and not on Home.
 */
export function PastClients({ clients, tasks, canManage, onOpen, onReactivate }: { clients: Client[]; tasks: Todo[]; canManage: boolean; onOpen: (id: string) => void; onReactivate: (id: string) => void }) {
  const past = clients.filter((c) => c.status === 'ended').sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  // Month by month for the last 12 months: who started, who ended.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  const rows = months
    .map((m) => ({
      m,
      started: clients.filter((c) => c.status !== 'lead' && (startedOf(c, tasks) ?? '').startsWith(m)),
      ended: clients.filter((c) => c.status === 'ended' && (c.endedAt ?? '').startsWith(m)),
    }))
    .filter((r) => r.started.length || r.ended.length);
  const lengths = past.map((c) => (startedOf(c, tasks) && c.endedAt ? monthsBetween(startedOf(c, tasks)!, c.endedAt) : null)).filter((x): x is number => x !== null);
  const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null;
  const name = (c: Client) => (
    <button key={c.id} className="link-btn" onClick={() => onOpen(c.id)}>
      {c.name}
    </button>
  );

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <span className="client-badge" style={{ background: 'var(--text-3)' }}>
          <Archive size={16} />
        </span>
        <div className="th-text">
          <h1>{t('Past {projects}', { projects: term.many })}</h1>
          <p>{t('Work that has ended. Everything stays here to read, and you can start again any time.')}</p>
        </div>
      </header>
      <div className="tracking-scroll">
        {past.length === 0 ? (
          <EmptyState compact text={t('No past {projects}. When work with a {project} ends, choose “End work” on their page.', { projects: term.many, project: term.one })} />
        ) : (
          <div className="todo-group">
            {past.map((c) => {
              const start = startedOf(c, tasks);
              return (
                <div key={c.id} className="task past-row" onClick={(e) => !(e.target as HTMLElement).closest('button') && onOpen(c.id)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onOpen(c.id))}>
                  <ProjectBadge p={c} kind="client-dot" />
                  <div className="task-main">
                    <span className="task-title-btn">{c.name}</span>
                    <div className="task-meta">
                      <span className="src">
                        {[
                          start ? t('{from} to {to}', { from: month(start), to: c.endedAt ? month(c.endedAt) : t('now') }) : t('Until {to}', { to: c.endedAt ? month(c.endedAt) : t('now') }),
                          start && c.endedAt ? tn(monthsBetween(start, c.endedAt), '{n} month', '{n} months') : '',
                          c.endReason ? t(c.endReason) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <button className="row-act" onClick={() => onReactivate(c.id)}>
                      <RotateCcw size={12} /> {t('Work with them again')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="side-card over-time">
          <h3>{t('{Projects} over time', { projects: term.many })}</h3>
          {avg !== null && <p className="muted small">{tn(avg, 'On average, work with a {project} lasted {n} month.', 'On average, work with a {project} lasted {n} months.', { project: term.one })}</p>}
          {rows.length === 0 ? (
            <EmptyState compact text={t('No changes in the last 12 months.')} />
          ) : (
            <table className="ot-table">
              <thead>
                <tr>
                  <th>{t('Month')}</th>
                  <th>{t('Started')}</th>
                  <th>{t('Ended')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.m}>
                    <td>{month(r.m + '-01')}</td>
                    <td>{r.started.length ? r.started.map(name) : <span className="muted">{t('none')}</span>}</td>
                    <td>{r.ended.length ? r.ended.map(name) : <span className="muted">{t('none')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
