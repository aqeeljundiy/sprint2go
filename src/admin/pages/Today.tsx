import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Clock, CreditCard, KeyRound, LifeBuoy, ShieldAlert, Trash2, TrendingDown, UserPlus } from 'lucide-react';

import { rel, dateTime, day, duration, post, rp, rpShort } from '../api';
import { CopyBtn, deltaOf, Empty, Failed, Loading, Page, Stat, Stats, useAct, useAdmin, useApi } from '../ui';
import { t, tn, tx } from '../../i18n';

interface TodayData {
  kpis: { mrr: number; mrrLastMonth: number | null; companies: number; unlimited?: number; newThisMonth: number; active7: number; activePrev7: number; people: number; openTickets: number; medianFirstReplyMin: number | null; satisfaction: number | null };
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
  if (error) return <Page title={t('Today')}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Today')}><Loading rows={6} /></Page>;
  const { kpis: k, queue: q } = data;
  const hour = new Date().getHours();
  const name = (me.name || me.email).split(/[ @]/)[0];
  // Indonesian greets the late afternoon ("sore") apart from the night ("malam"); English says good evening to both.
  const hello = hour < 11 ? t('Good morning, {name}', { name }) : hour < 15 ? t('Good afternoon, {name}', { name }) : hour < 18 ? tx('late afternoon', 'Good evening, {name}', { name }) : t('Good evening, {name}', { name });
  const high = q.warnings.filter((w) => w.level === 'high');
  const normal = q.warnings.filter((w) => w.level !== 'high');
  const total = q.breaching.length + q.mine.length + q.unassigned.length + q.overdue.length + q.atRisk.length + q.trialsEnding.length + q.signups.length + q.codes.length + q.deletions.length + q.flagged.length + q.warnings.length;
  return (
    <Page title={hello} sub={total ? tn(total, '{n} thing needs you, most urgent first.', '{n} things need you, most urgent first.') : t('Nothing needs you right now.')}>
      <Stats>
        <Stat i={0} label={t('Monthly revenue')} value={rpShort(k.mrr)} delta={deltaOf(k.mrr, k.mrrLastMonth, true, rpShort)} hint={k.mrrLastMonth === null ? t('booked from plans') : t('vs last month')} onClick={() => go('/admin/money/revenue')} />
        <Stat i={1} label={t('Companies')} value={k.companies} hint={`${k.newThisMonth ? t('+{n} this month', { n: k.newThisMonth }) : t('none new this month')}${k.unlimited ? ` · ${t('{n} Unlimited', { n: k.unlimited })}` : ''}`} onClick={() => go('/admin/companies')} />
        <Stat i={2} label={t('Active people, 7 days')} value={k.active7} delta={deltaOf(k.active7, k.activePrev7 || null)} hint={t('of {n}', { n: k.people })} onClick={() => go('/admin/growth')} />
        <Stat i={3} label={t('Open tickets')} value={k.openTickets} tone={q.breaching.length ? 'bad' : undefined} hint={`${t('first reply {time}', { time: duration(k.medianFirstReplyMin) })}${k.satisfaction !== null ? ` · ${t('{n}% happy', { n: k.satisfaction })}` : ''}`} onClick={() => go('/admin/tickets')} />
      </Stats>

      {total === 0 && <Empty title={t('All clear')} text={t('No tickets waiting, no money late, nothing broken. New sign-ups and problems show up here first.')} />}

      <div className="adm-queue">
        <Group title={t('Broken right now')} n={high.length}>
          {high.map((w) => (
            <Row key={w.kind} icon={<AlertTriangle size={15} />} tone="bad" title={w.text} onOpen={w.to ? () => go(w.to!) : undefined} />
          ))}
        </Group>
        <Group title={t('Past the reply target')} n={q.breaching.length}>
          {q.breaching.map((tk) => (
            <Row key={tk.id} icon={<Clock size={15} />} tone="bad" title={`#${tk.number} ${tk.subject}`} sub={`${tk.company ?? tk.requester} · ${t('was due {ago}', { ago: rel(tk.dueAt) })}`} onOpen={() => go(`/admin/tickets/${tk.id}`)}>
              <button className="primary-btn sm" onClick={() => go(`/admin/tickets/${tk.id}`)}>
                {t('Reply')}
              </button>
            </Row>
          ))}
        </Group>
        <Group title={t('Your tickets')} n={q.mine.length}>
          {q.mine.map((tk) => (
            <Row key={tk.id} icon={<LifeBuoy size={15} />} title={`#${tk.number} ${tk.subject}`} sub={`${tk.company ?? tk.requester} · ${t('updated {ago}', { ago: rel(tk.updatedAt) })}`} onOpen={() => go(`/admin/tickets/${tk.id}`)}>
              <button className="ghost-btn sm" onClick={() => go(`/admin/tickets/${tk.id}`)}>
                {t('Open')}
              </button>
            </Row>
          ))}
        </Group>
        <Group title={t('Nobody on it')} n={q.unassigned.length}>
          {q.unassigned.map((tk) => (
            <Row key={tk.id} icon={<LifeBuoy size={15} />} tone={tk.priority === 'urgent' ? 'bad' : undefined} title={`#${tk.number} ${tk.subject}`} sub={`${tk.company ?? tk.requester} · ${rel(tk.createdAt)}`} onOpen={() => go(`/admin/tickets/${tk.id}`)}>
              {may('support') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { id: tk.id, assignee: me.email }), t('#{n} is yours', { n: tk.number }))}>
                  {t('Take it')}
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title={t('Invoices overdue')} n={q.overdue.length}>
          {q.overdue.map((i) => (
            <Row key={i.id} icon={<CreditCard size={15} />} tone="warn" title={i.company ? t('{company} owes {amount}', { company: i.company, amount: rp(i.total) }) : t('A company owes {amount}', { amount: rp(i.total) })} sub={`${i.number} · ${t('due {day}', { day: day(i.dueAt) })}`} onOpen={() => go(`/admin/companies/${i.workspaceId}/billing`)}>
              {may('billing') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), t('Reminder sent'))}>
                  {t('Remind')}
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title={t('At risk')} n={q.atRisk.length}>
          {q.atRisk.map((c) => (
            <Row key={c.id} icon={<TrendingDown size={15} />} tone="warn" title={c.name} sub={[t('Health {score}', { score: c.score }), c.lastActive ? t('last seen {ago}', { ago: rel(c.lastActive) }) : t('never active'), t('{amount}/month', { amount: rpShort(c.mrr) })].join(' · ')} onOpen={() => go(`/admin/companies/${c.id}`)}>
              <button className="ghost-btn sm" onClick={() => go(`/admin/companies/${c.id}`)}>
                {t('Look')}
              </button>
            </Row>
          ))}
        </Group>
        <Group title={t('Trials ending this week')} n={q.trialsEnding.length}>
          {q.trialsEnding.map((c) => (
            <Row key={c.id} icon={<CalendarClock size={15} />} title={c.name} sub={t('ends {day} · then {amount}/month', { day: day(c.trialEnds), amount: rpShort(c.after) })} onOpen={() => go(`/admin/companies/${c.id}`)}>
              {may('customers') && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('company/extend-trial', { id: c.id, days: 14 }), t('{company}: trial +14 days', { company: c.name }))}>
                  {t('+14 days')}
                </button>
              )}
            </Row>
          ))}
        </Group>
        <Group title={t('Waiting for their sign-up code')} n={q.signups.length}>
          {q.signups.map((s) => (
            <Row key={s.email} icon={<UserPlus size={15} />} tone={s.disposable ? 'warn' : undefined} title={`${s.name} · ${s.email}`} sub={s.disposable ? t('Throwaway address · code valid until {time}', { time: dateTime(s.until) }) : t('code valid until {time}', { time: dateTime(s.until) })}>
              <code className="adm-code">{s.code}</code>
              <CopyBtn text={s.code} iconOnly label={t('Copy code')} />
            </Row>
          ))}
        </Group>
        <Group title={t('Password reset codes')} n={q.codes.length}>
          {q.codes.map((c) => (
            <Row key={c.key} icon={<KeyRound size={15} />} title={c.key.replace(/^reset:/, '')} sub={t('valid until {time}', { time: dateTime(c.until) })}>
              <code className="adm-code">{c.code}</code>
              <CopyBtn text={c.code} iconOnly label={t('Copy code')} />
            </Row>
          ))}
        </Group>
        <Group title={t('Deletions scheduled')} n={q.deletions.length}>
          {q.deletions.map((d) => (
            <Row key={d.id} icon={<Trash2 size={15} />} tone="warn" title={t('{company} is deleted {when}', { company: d.company ?? d.workspaceId, when: rel(d.runAt) })} sub={t('asked by {name}', { name: d.requestedBy })} onOpen={() => go(`/admin/companies/${d.workspaceId}`)} />
          ))}
        </Group>
        <Group title={t('Throwaway sign-ups')} n={q.flagged.length}>
          {q.flagged.map((u) => (
            <Row key={u.id} icon={<ShieldAlert size={15} />} title={u.name} sub={u.email} onOpen={() => go(`/admin/people/${u.id}`)} />
          ))}
        </Group>
        <Group title={t('Worth a look')} n={normal.length}>
          {normal.map((w) => (
            <Row key={w.kind} icon={<AlertTriangle size={15} />} tone="info" title={w.text} onOpen={w.to ? () => go(w.to!) : undefined} />
          ))}
        </Group>
      </div>
    </Page>
  );
}
