import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Clock, CreditCard, KeyRound, LifeBuoy, ShieldAlert, Trash2, TrendingDown, UserPlus } from 'lucide-react';

import { rel, dateTime, day, duration, post, rp, rpShort } from '../api';
import { CopyBtn, deltaOf, Empty, Failed, Loading, Page, Stat, Stats, useAct, useAdmin, useApi } from '../ui';

interface TodayData {
  kpis: { mrr: number; mrrLastMonth: number | null; companies: number; newThisMonth: number; active7: number; activePrev7: number; people: number; openTickets: number; medianFirstReplyMin: number | null; satisfaction: number | null };
  queue: {
    breaching: { id: string; number: number; subject: string; company: string | null; requester: string; dueAt: string; priority: string }[];
    unassigned: { id: string; number: number; subject: string; company: string | null; requester: string; createdAt: string; priority: string }[];
    mine: { id: string; number: number; subject: string; company: string | null; requester: string; updatedAt: string; priority: string }[];
    overdue: { id: string; number: string; workspaceId: string; company: string | null; total: number; dueAt: string }[];
    trialsEnding: { id: string; name: string; trialEnds: string; after: number }[];
    atRisk: { id: string; name: string; score: number; mrr: number; lastActive: string | null }[];
    signups: { email: string; name: string; code: string; until: string; disposable: boolean }[];
    codes: { key: string; code: string; until: string }[];
    deletions: { id: string; workspaceId: string; company: string | null; runAt: string; requestedBy: string }[];
    flagged: { id: string; name: string; email: string }[];
    warnings: { kind: string; text: string; level: 'high' | 'normal'; to?: string }[];
  };
}

function Row({ icon, tone, title, sub, children, onOpen }: { icon: ReactNode; tone?: 'bad' | 'warn' | 'info'; title: ReactNode; sub?: ReactNode; children?: ReactNode; onOpen?: () => void }) {
  return (
    <div className={`adm-q-row ${tone ?? ''}`}>
      <span className="adm-q-icon">{icon}</span>
      {onOpen ? (
        <button type="button" className="adm-q-text" onClick={onOpen}>
          <strong>{title}</strong>
          {sub && <small>{sub}</small>}
        </button>
      ) : (
        <span className="adm-q-text">
          <strong>{title}</strong>
          {sub && <small>{sub}</small>}
        </span>
      )}
      {children && <span className="adm-q-act">{children}</span>}
    </div>
  );
}
function Group({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  if (!n) return null;
  return (
    <div className="adm-q-group">
      <h3>
        {title} <span className="adm-count">{n}</span>
      </h3>
      <div className="adm-q-list">{children}</div>
    </div>
  );
}

export function Today() {
  const { me, go, may } = useAdmin();
  const { data, error, reload } = useApi<TodayData>('today', [], 60_000);
  const act = useAct();
  if (error) return <Page title="Today"><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Today"><Loading rows={6} /></Page>;
  const { kpis: k, queue: q } = data;
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : 'Good evening';
  const high = q.warnings.filter((w) => w.level === 'high');
  const normal = q.warnings.filter((w) => w.level !== 'high');
  const total = q.breaching.length + q.mine.length + q.unassigned.length + q.overdue.length + q.atRisk.length + q.trialsEnding.length + q.signups.length + q.codes.length + q.deletions.length + q.flagged.length + q.warnings.length;
  return (
    <Page title={`${hello}, ${(me.name || me.email).split(/[ @]/)[0]}`} sub={total ? `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} you, most urgent first.` : 'Nothing needs you right now.'}>
      <Stats>
        <Stat i={0} label="Monthly revenue" value={rpShort(k.mrr)} delta={deltaOf(k.mrr, k.mrrLastMonth, true, rpShort)} hint={k.mrrLastMonth === null ? 'booked from plans' : 'vs last month'} onClick={() => go('/admin/money/revenue')} />
        <Stat i={1} label="Companies" value={k.companies} hint={k.newThisMonth ? `+${k.newThisMonth} this month` : 'none new this month'} onClick={() => go('/admin/companies')} />
        <Stat i={2} label="Active people, 7 days" value={k.active7} delta={deltaOf(k.active7, k.activePrev7 || null)} hint={`of ${k.people}`} onClick={() => go('/admin/growth')} />
        <Stat i={3} label="Open tickets" value={k.openTickets} tone={q.breaching.length ? 'bad' : undefined} hint={`first reply ${duration(k.medianFirstReplyMin)}${k.satisfaction !== null ? ` · ${k.satisfaction}% happy` : ''}`} onClick={() => go('/admin/tickets')} />
      </Stats>

      {total === 0 && <Empty title="All clear" text="No tickets waiting, no money late, nothing broken. New sign-ups and problems show up here first." />}

      <div className="adm-queue">
        <Group title="Broken right now" n={high.length}>
          {high.map((w) => (
            <Row key={w.kind} icon={<AlertTriangle size={15} />} tone="bad" title={w.text} onOpen={w.to ? () => go(w.to!) : undefined} />
          ))}
        </Group>
        <Group title="Past the reply target" n={q.breaching.length}>
          {q.breaching.map((t) => (
            <Row key={t.id} icon={<Clock size={15} />} tone="bad" title={`#${t.number} ${t.subject}`} sub={`${t.company ?? t.requester} · was due ${rel(t.dueAt)}`} onOpen={() => go(`/admin/tickets/${t.id}`)}>
              <button className="primary-btn sm" onClick={() => go(`/admin/tickets/${t.id}`)}>
                Reply
              </button>
            </Row>
          ))}
        </Group>
        <Group title="Your tickets" n={q.mine.length}>
          {q.mine.map((t) => (
            <Row key={t.id} icon={<LifeBuoy size={15} />} title={`#${t.number} ${t.subject}`} sub={`${t.company ?? t.requester} · updated ${rel(t.updatedAt)}`} onOpen={() => go(`/admin/tickets/${t.id}`)}>
              <button className="ghost-btn sm" onClick={() => go(`/admin/tickets/${t.id}`)}>
                Open
              </button>
            </Row>
          ))}
        </Group>
        <Group title="Nobody on it" n={q.unassigned.length}>
          {q.unassigned.map((t) => (
            <Row key={t.id} icon={<LifeBuoy size={15} />} tone={t.priority === 'urgent' ? 'bad' : undefined} title={`#${t.number} ${t.subject}`} sub={`${t.company ?? t.requester} · ${rel(t.createdAt)}`} onOpen={() => go(`/admin/tickets/${t.id}`)}>
              {may('support') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { id: t.id, assignee: me.email }), `#${t.number} is yours`)}>
                  Take it
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title="Invoices overdue" n={q.overdue.length}>
          {q.overdue.map((i) => (
            <Row key={i.id} icon={<CreditCard size={15} />} tone="warn" title={`${i.company ?? 'A company'} owes ${rp(i.total)}`} sub={`${i.number} · due ${day(i.dueAt)}`} onOpen={() => go(`/admin/companies/${i.workspaceId}/billing`)}>
              {may('billing') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), 'Reminder sent')}>
                  Remind
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title="At risk" n={q.atRisk.length}>
          {q.atRisk.map((c) => (
            <Row key={c.id} icon={<TrendingDown size={15} />} tone="warn" title={c.name} sub={`Health ${c.score} · ${c.lastActive ? `last seen ${rel(c.lastActive)}` : 'never active'} · ${rpShort(c.mrr)}/month`} onOpen={() => go(`/admin/companies/${c.id}`)}>
              <button className="ghost-btn sm" onClick={() => go(`/admin/companies/${c.id}`)}>
                Look
              </button>
            </Row>
          ))}
        </Group>
        <Group title="Trials ending this week" n={q.trialsEnding.length}>
          {q.trialsEnding.map((t) => (
            <Row key={t.id} icon={<CalendarClock size={15} />} title={t.name} sub={`ends ${day(t.trialEnds)} · then ${rpShort(t.after)}/month`} onOpen={() => go(`/admin/companies/${t.id}`)}>
              {may('customers') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('company/extend-trial', { id: t.id, days: 14 }), `${t.name}: trial +14 days`)}>
                  +14 days
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title="Waiting for their sign-up code" n={q.signups.length}>
          {q.signups.map((s) => (
            <Row key={s.email} icon={<UserPlus size={15} />} tone={s.disposable ? 'warn' : undefined} title={`${s.name} · ${s.email}`} sub={`${s.disposable ? 'Throwaway address · ' : ''}code valid until ${dateTime(s.until)}`}>
              <code className="adm-code">{s.code}</code>
              <CopyBtn text={s.code} iconOnly label="Copy code" />
            </Row>
          ))}
        </Group>
        <Group title="Password reset codes" n={q.codes.length}>
          {q.codes.map((c) => (
            <Row key={c.key} icon={<KeyRound size={15} />} title={c.key.replace(/^reset:/, '')} sub={`valid until ${dateTime(c.until)}`}>
              <code className="adm-code">{c.code}</code>
              <CopyBtn text={c.code} iconOnly label="Copy code" />
            </Row>
          ))}
        </Group>
        <Group title="Deletions scheduled" n={q.deletions.length}>
          {q.deletions.map((d) => (
            <Row key={d.id} icon={<Trash2 size={15} />} tone="warn" title={`${d.company ?? d.workspaceId} is deleted ${rel(d.runAt)}`} sub={`asked by ${d.requestedBy}`} onOpen={() => go(`/admin/companies/${d.workspaceId}`)} />
          ))}
        </Group>
        <Group title="Throwaway sign-ups" n={q.flagged.length}>
          {q.flagged.map((u) => (
            <Row key={u.id} icon={<ShieldAlert size={15} />} title={u.name} sub={u.email} onOpen={() => go(`/admin/people/${u.id}`)} />
          ))}
        </Group>
        <Group title="Worth a look" n={normal.length}>
          {normal.map((w) => (
            <Row key={w.kind} icon={<AlertTriangle size={15} />} tone="info" title={w.text} onOpen={w.to ? () => go(w.to!) : undefined} />
          ))}
        </Group>
      </div>
    </Page>
  );
}
