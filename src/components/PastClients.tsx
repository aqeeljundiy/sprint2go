import { ProjectBadge } from './ProjectBadge';
import { Archive, RotateCcw } from 'lucide-react';
import { term } from '../terms';
import type { Client, Todo } from '../types';

const month = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', year: 'numeric' });
const monthsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (30.4 * 86_400_000)));

/** When the work with a client started: as set, or their first task. */
export const startedOf = (c: Client, tasks: Todo[]) => c.since ?? tasks.filter((t) => t.clientId === c.id).map((t) => t.createdAt).sort()[0];

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
          <h1>Past {term.many}</h1>
          <p>Work that has ended. Everything stays here to read, and you can start again any time.</p>
        </div>
      </header>
      <div className="tracking-scroll">
        {past.length === 0 ? (
          <p className="te-empty">No past {term.many}. When work with a {term.one} ends, choose “End work” on their page.</p>
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
                        {start ? `${month(start)} to ` : 'Until '}
                        {c.endedAt ? month(c.endedAt) : 'now'}
                        {start && c.endedAt ? ` · ${monthsBetween(start, c.endedAt)} month${monthsBetween(start, c.endedAt) === 1 ? '' : 's'}` : ''}
                        {c.endReason ? ` · ${c.endReason}` : ''}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <button className="row-act" onClick={() => onReactivate(c.id)}>
                      <RotateCcw size={12} /> Work with them again
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="side-card over-time">
          <h3>{term.Many} over time</h3>
          {avg !== null && <p className="muted small">On average, work with a {term.one} lasted {avg} month{avg === 1 ? '' : 's'}.</p>}
          {rows.length === 0 ? (
            <p className="te-empty">No changes in the last 12 months.</p>
          ) : (
            <table className="ot-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Started</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.m}>
                    <td>{month(r.m + '-01')}</td>
                    <td>{r.started.length ? r.started.map(name) : <span className="muted">none</span>}</td>
                    <td>{r.ended.length ? r.ended.map(name) : <span className="muted">none</span>}</td>
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
