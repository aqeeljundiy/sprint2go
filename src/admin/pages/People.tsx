import { useState } from 'react';
import { AlertTriangle, LogIn, MonitorSmartphone } from 'lucide-react';

import { rel, dateTime, day, post, ROLE_LABEL, type PersonRow } from '../api';
import { Badge, Confirm, CopyBtn, Dialog, Empty, Failed, Initials, Loading, Menu, Page, Section, Table, useAct, useAdmin, useApi, Who } from '../ui';
import { TicketList } from './Tickets';
import { t, tn, tx } from '../../i18n';

/** Someone's role in a company (owner, admin, member), in the console's language; anything else as it is. */
const roleName = (role: string) => (role === 'owner' ? tx('role', 'owner') : role === 'admin' ? tx('role', 'admin') : role === 'member' ? tx('role', 'member') : role);

export function People() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<{ people: PersonRow[] }>('people');
  if (error) return <Page title={t('People')}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('People')}><Loading rows={8} /></Page>;
  const rows = data.people;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const active = rows.filter((p) => p.lastSeen && p.lastSeen > weekAgo).length;
  return (
    <Page title={t('People')} sub={`${tn(rows.length, '{n} account', '{n} accounts')} · ${tn(active, '{n} active this week', '{n} active this week')}`}>
      <Table
        id="people"
        rows={rows}
        rowKey={(p) => p.id}
        onOpen={(p) => go(`/admin/people/${p.id}`)}
        search={(p) => `${p.name} ${p.email} ${p.title} ${p.companies.map((c) => c.name).join(' ')} ${p.guestOf.join(' ')}`}
        initialSort={{ key: 'seen', dir: -1 }}
        views={[
          { id: 'all', label: t('Everyone'), test: () => true },
          { id: 'team', label: t('In a company'), test: (p) => p.companies.length > 0 },
          { id: 'guests', label: t('Guests only'), test: (p) => !p.companies.length && p.guestOf.length > 0 },
          { id: 'never', label: t('Never signed in'), test: (p) => !p.hasLogin },
          { id: 'flagged', label: t('Throwaway email'), test: (p) => p.disposable },
          { id: 'suspended', label: t('Suspended'), test: (p) => !!p.suspended },
          { id: 'operators', label: t('Operators'), test: (p) => !!p.operator },
        ]}
        empty={{ title: t('Nobody here') }}
        cols={[
          {
            key: 'name',
            label: t('Person'),
            width: 'minmax(0, 2fr)',
            sort: (p) => p.name.toLowerCase(),
            render: (p) => (
              <Who
                name={p.name}
                email={p.email}
                color={p.color}
                badges={
                  <>
                    {p.operator && <Badge tone="accent">{ROLE_LABEL[p.operator]}</Badge>}
                    {p.suspended && <Badge tone="bad">{t('Suspended')}</Badge>}
                    {p.disposable && <Badge tone="warn">{t('Throwaway')}</Badge>}
                  </>
                }
              />
            ),
          },
          {
            key: 'companies',
            label: t('Where'),
            width: 'minmax(0, 2fr)',
            hide: 'phone',
            sort: (p) => p.companies.length,
            render: (p) => <span className="adm-ellipsis">{p.companies.length ? p.companies.map((c) => `${c.name} (${roleName(c.role)})`).join(', ') : p.guestOf.length ? <span className="muted">{t('Guest of {companies}', { companies: p.guestOf.join(', ') })}</span> : <span className="muted">{t('nowhere')}</span>}</span>,
          },
          { key: 'seen', label: t('Last seen'), width: '120px', align: 'right', sort: (p) => p.lastSeen ?? '', render: (p) => <span className="muted">{!p.hasLogin ? t('never signed in') : p.lastSeen ? rel(p.lastSeen) : t('not yet')}</span> },
        ]}
      />
    </Page>
  );
}

interface Person {
  id: string;
  name: string;
  email: string;
  title: string;
  color: string;
  deleted: boolean;
  suspended: { at: string; by: string; reason: string } | null;
  hasLogin: boolean;
  twoStep: boolean;
  /** Free trials: one per person and per company domain; an operator can allow one more. */
  trial: { trials: { workspaceId: string; company: string; at: string; how: string }[]; granted: { by: string; at: string } | null };
  lastSeen: string | null;
  operator: string | null;
  disposable: boolean;
  guestOf: string | null;
  companies: { id: string; name: string; role: string }[];
  sessions: { id: string; createdAt: string; lastAt: string; ua: string | null; ip: string | null; actingAs: string | null }[];
  tickets: { id: string; number: number; subject: string; status: 'new' | 'open' | 'waiting' | 'resolved' | 'closed'; updatedAt: string }[];
  audit: { id: number; at: string; operator: string; action: string; detail: string | null }[];
}

/** A browser name from a user agent, good enough to recognise a device. */
export function device(ua: string | null) {
  if (!ua) return t('Unknown device');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : tx('os', 'Device');
  const app = /Electron/.test(ua) ? t('sprint2go app') : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : t('Browser');
  return t('{app} on {os}', { app, os });
}

export function PersonPage({ id }: { id: string }) {
  const { go, may, signInAs, toast } = useAdmin();
  const { data, error, reload } = useApi<{ person: Person }>(`person?id=${encodeURIComponent(id)}`);
  const act = useAct();
  const [suspending, setSuspending] = useState(false);
  const [resetting2fa, setResetting2fa] = useState(false);
  // What was made for them (a reset code or an invite link); its words are written while rendering.
  const [shown, setShown] = useState<{ kind: 'code' | 'invite'; value: string } | null>(null);
  if (error) return <Page title={t('Person')} back={{ label: t('People'), to: '/admin/people' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Person')} back={{ label: t('People'), to: '/admin/people' }}><Loading rows={6} /></Page>;
  const u = data.person;
  const first = u.name.split(' ')[0];
  return (
    <Page
      back={{ label: t('People'), to: '/admin/people' }}
      title={
        <span className="adm-title-dot">
          <Initials name={u.name} color={u.color} size={36} /> {u.name}
        </span>
      }
      sub={
        <span className="adm-head-badges">
          <span className="muted">{u.email}</span>
          {u.operator && <Badge tone="accent">{ROLE_LABEL[u.operator as keyof typeof ROLE_LABEL]}</Badge>}
          {u.deleted && <Badge tone="neutral">{t('Deleted account')}</Badge>}
          {u.disposable && <Badge tone="warn">{t('Throwaway email')}</Badge>}
          {u.twoStep && <Badge tone="good">{t('Two-step on')}</Badge>}
          <span className="muted">{!u.hasLogin ? t('Never signed in') : u.lastSeen ? t('Seen {ago}', { ago: rel(u.lastSeen) }) : t('Has a sign-in')}</span>
        </span>
      }
      actions={
        !u.deleted && (
          <>
            {may('impersonate') && !u.suspended && (
              <button className="primary-btn sm" onClick={() => signInAs(u.id)}>
                <LogIn size={13} /> {t('Sign in as {name}', { name: first })}
              </button>
            )}
            <Menu
              label={t('More')}
              items={[
                may('impersonate') &&
                  (u.hasLogin
                    ? { label: t('Give a reset code'), run: () => void post<{ code: string }>('person/reset-code', { userId: u.id }).then((r) => setShown({ kind: 'code', value: r.code })).catch((e: Error) => toast(e.message)) }
                    : { label: t('Make an invite link'), run: () => void post<{ link: string }>('person/invite', { userId: u.id }).then((r) => setShown({ kind: 'invite', value: r.link })).catch((e: Error) => toast(e.message)) }),
                may('impersonate') && u.twoStep && { label: t('Reset two-step sign-in'), run: () => setResetting2fa(true), danger: true },
                may('customers') && !u.operator && (u.suspended ? { label: t('Lift the suspension'), run: () => void act(() => post('person/suspend', { userId: u.id, on: false }), t('Suspension lifted')).then(reload) } : { label: t('Suspend'), run: () => setSuspending(true), danger: true }),
              ]}
            />
          </>
        )
      }
    >
      {u.suspended && (
        <div className="adm-banner bad">
          <AlertTriangle size={15} />
          <span>
            {u.suspended.reason
              ? t('Suspended {ago} by {name}: {reason}. They can’t sign in.', { ago: rel(u.suspended.at), name: u.suspended.by, reason: u.suspended.reason })
              : t('Suspended {ago} by {name}. They can’t sign in.', { ago: rel(u.suspended.at), name: u.suspended.by })}
          </span>
        </div>
      )}
      <div className="adm-split">
        <div>
          <Section title={t('Companies')}>
            {u.companies.length === 0 ? (
              <Empty title={u.guestOf ? t('Only a guest of {company}', { company: u.guestOf }) : t('In no company')} />
            ) : (
              <div className="adm-mini-list">
                {u.companies.map((c) => (
                  <div key={c.id} className="adm-mini-row">
                    <button type="button" className="grow adm-link" onClick={() => go(`/admin/companies/${c.id}`)}>
                      <strong>{c.name}</strong> <span className="muted">{roleName(c.role)}</span>
                    </button>
                    {may('customers') && c.role !== 'owner' && (
                      <button className="ghost-btn sm" onClick={() => void act(() => post('person/role', { id: c.id, userId: u.id, role: 'owner' }), t('{name} owns {company} now', { name: first, company: c.name })).then(reload)}>
                        {t('Make owner')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title={t('Free trial')} hint={t('One per person and per company domain')}>
            <div className="adm-mini-list">
              {u.trial.trials.length === 0 ? (
                <div className="adm-mini-row">
                  <span className="grow muted">{t('Hasn’t had one yet: their first company starts on it.')}</span>
                </div>
              ) : (
                u.trial.trials.map((tr) => (
                  <div key={tr.workspaceId} className="adm-mini-row">
                    <button type="button" className="grow adm-link" onClick={() => go(`/admin/companies/${tr.workspaceId}`)}>
                      <strong>{tr.company}</strong>{' '}
                      <span className="muted">
                        {tr.how === 'operator'
                          ? t('from {day}, given by an operator', { day: day(tr.at) })
                          : tr.how === 'granted'
                            ? t('from {day}, allowed by an operator', { day: day(tr.at) })
                            : t('from {day}', { day: day(tr.at) })}
                      </span>
                    </button>
                  </div>
                ))
              )}
              {u.trial.trials.length > 0 && (
                <div className="adm-mini-row">
                  {u.trial.granted ? (
                    <span className="grow muted">
                      {t('{name} allowed one more {ago}: their next new company starts on it.', { name: u.trial.granted.by, ago: rel(u.trial.granted.at) })}
                    </span>
                  ) : (
                    <>
                      <span className="grow muted">{t('A new company of theirs starts on Free.')}</span>
                      {may('customers') && (
                        <button className="ghost-btn sm" onClick={() => void act(() => post('person/trial-grant', { userId: u.id }), t('{name}’s next company gets a trial', { name: first })).then(reload)}>
                          {t('Allow another trial')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Section>
          <Section title={t('Tickets')}>
            <TicketList tickets={u.tickets} />
          </Section>
        </div>
        <div>
          <Section title={t('Signed in on')} hint={tn(u.sessions.length, '{n} device', '{n} devices')}>
            {u.sessions.length === 0 ? (
              <Empty title={t('Not signed in anywhere')} />
            ) : (
              <div className="adm-mini-list">
                {u.sessions.map((s) => (
                  <div key={s.id} className="adm-mini-row">
                    <MonitorSmartphone size={14} />
                    <span className="grow">
                      <strong>{s.actingAs ? t('Operator {name}', { name: s.actingAs }) : device(s.ua)}</strong>
                      <small className="muted">
                        {' '}
                        · {s.ip ?? t('unknown address')} · {t('last {ago}', { ago: rel(s.lastAt) })}
                      </small>
                    </span>
                    {may('customers') && (
                      <button className="ghost-btn sm" onClick={() => void act(() => post('person/end-session', { userId: u.id, sessionId: s.id }), t('Signed out there')).then(reload)}>
                        {tx('session', 'Sign out')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title={t('What operators did')}>
            {u.audit.length === 0 ? (
              <Empty title={t('Nothing yet')} />
            ) : (
              <ol className="adm-timeline">
                {u.audit.map((a) => (
                  <li key={a.id} className="operator">
                    <i />
                    <span>
                      <strong>{a.action}</strong>
                      {a.detail && <span className="muted"> · {a.detail}</span>}
                      <small>
                        {a.operator} · {dateTime(a.at)}
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
      {suspending && <Confirm title={t('Suspend {name}', { name: first })} action={t('Suspend')} danger reason={t('Why (they see it)')} text={t('{name} is signed out everywhere and can’t sign in until you lift it. Their work stays.', { name: u.name })} onClose={() => setSuspending(false)} onConfirm={(v) => act(() => post('person/suspend', { userId: u.id, reason: v.reason }), t('Suspended')).then(() => (setSuspending(false), reload()))} />}
      {resetting2fa && (
        <Confirm
          title={t('Reset {name}’s two-step sign-in', { name: first })}
          action={t('Reset')}
          danger
          reason={t('How you checked it’s them (logged)')}
          text={t('{name} lost their authenticator app and backup codes? This turns two-step sign-in off for their account and signs them out everywhere; they get an email. If a company requires it, they set it up again at their next sign-in. Only do this after checking it’s really them.', { name: first })}
          onClose={() => setResetting2fa(false)}
          onConfirm={(v) => act(() => post('person/2fa-reset', { userId: u.id, reason: v.reason }), t('Two-step sign-in reset')).then(() => (setResetting2fa(false), reload()))}
        />
      )}
      {shown && (
        <Dialog title={shown.kind === 'code' ? t('Reset code') : t('Invite link')} size="sm" onClose={() => setShown(null)} foot={<button className="primary-btn" onClick={() => setShown(null)}>{t('Done')}</button>}>
          <div className="adm-form">
            <p className="adm-dialog-text">
              {shown.kind === 'code'
                ? t('Tell {name} this code; they enter it with a new password at “Forgot your password?”. Good for 15 minutes.', { name: first })
                : t('Send {name} this link to pick a password (valid 7 days).', { name: first })}
            </p>
            <div className="adm-linkbox">
              <code className={shown.value.length < 10 ? 'big' : ''}>{shown.value}</code>
              <CopyBtn text={shown.value} />
            </div>
          </div>
        </Dialog>
      )}
    </Page>
  );
}

