import { useState } from 'react';
import { AlertTriangle, LogIn, MonitorSmartphone } from 'lucide-react';

import { rel, dateTime, day, post, ROLE_LABEL, type PersonRow } from '../api';
import { Badge, Confirm, CopyBtn, Dialog, Empty, Failed, Initials, Loading, Menu, Page, Section, Table, useAct, useAdmin, useApi, Who } from '../ui';
import { TicketList } from './Tickets';

export function People() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<{ people: PersonRow[] }>('people');
  if (error) return <Page title="People"><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="People"><Loading rows={8} /></Page>;
  const rows = data.people;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return (
    <Page title="People" sub={`${rows.length} accounts · ${rows.filter((p) => p.lastSeen && p.lastSeen > weekAgo).length} active this week`}>
      <Table
        id="people"
        rows={rows}
        rowKey={(p) => p.id}
        onOpen={(p) => go(`/admin/people/${p.id}`)}
        search={(p) => `${p.name} ${p.email} ${p.title} ${p.companies.map((c) => c.name).join(' ')} ${p.guestOf.join(' ')}`}
        initialSort={{ key: 'seen', dir: -1 }}
        views={[
          { id: 'all', label: 'Everyone', test: () => true },
          { id: 'team', label: 'In a company', test: (p) => p.companies.length > 0 },
          { id: 'guests', label: 'Guests only', test: (p) => !p.companies.length && p.guestOf.length > 0 },
          { id: 'never', label: 'Never signed in', test: (p) => !p.hasLogin },
          { id: 'flagged', label: 'Throwaway email', test: (p) => p.disposable },
          { id: 'suspended', label: 'Suspended', test: (p) => !!p.suspended },
          { id: 'operators', label: 'Operators', test: (p) => !!p.operator },
        ]}
        empty={{ title: 'Nobody here' }}
        cols={[
          {
            key: 'name',
            label: 'Person',
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
                    {p.suspended && <Badge tone="bad">Suspended</Badge>}
                    {p.disposable && <Badge tone="warn">Throwaway</Badge>}
                  </>
                }
              />
            ),
          },
          {
            key: 'companies',
            label: 'Where',
            width: 'minmax(0, 2fr)',
            hide: 'phone',
            sort: (p) => p.companies.length,
            render: (p) => <span className="adm-ellipsis">{p.companies.length ? p.companies.map((c) => `${c.name} (${c.role})`).join(', ') : p.guestOf.length ? <span className="muted">Guest of {p.guestOf.join(', ')}</span> : <span className="muted">nowhere</span>}</span>,
          },
          { key: 'seen', label: 'Last seen', width: '120px', align: 'right', sort: (p) => p.lastSeen ?? '', render: (p) => <span className="muted">{!p.hasLogin ? 'never signed in' : p.lastSeen ? rel(p.lastSeen) : 'not yet'}</span> },
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
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = /Electron/.test(ua) ? 'sprint2go app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'Browser';
  return `${app} on ${os}`;
}

export function PersonPage({ id }: { id: string }) {
  const { go, may, signInAs, toast } = useAdmin();
  const { data, error, reload } = useApi<{ person: Person }>(`person?id=${encodeURIComponent(id)}`);
  const act = useAct();
  const [suspending, setSuspending] = useState(false);
  const [resetting2fa, setResetting2fa] = useState(false);
  const [shown, setShown] = useState<{ title: string; value: string; text: string } | null>(null);
  if (error) return <Page title="Person" back={{ label: 'People', to: '/admin/people' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Person" back={{ label: 'People', to: '/admin/people' }}><Loading rows={6} /></Page>;
  const u = data.person;
  const first = u.name.split(' ')[0];
  return (
    <Page
      back={{ label: 'People', to: '/admin/people' }}
      title={
        <span className="adm-title-dot">
          <Initials name={u.name} color={u.color} size={36} /> {u.name}
        </span>
      }
      sub={
        <span className="adm-head-badges">
          <span className="muted">{u.email}</span>
          {u.operator && <Badge tone="accent">{ROLE_LABEL[u.operator as keyof typeof ROLE_LABEL]}</Badge>}
          {u.deleted && <Badge tone="neutral">Deleted account</Badge>}
          {u.disposable && <Badge tone="warn">Throwaway email</Badge>}
          {u.twoStep && <Badge tone="good">Two-step on</Badge>}
          <span className="muted">{!u.hasLogin ? 'Never signed in' : u.lastSeen ? `Seen ${rel(u.lastSeen)}` : 'Has a sign-in'}</span>
        </span>
      }
      actions={
        !u.deleted && (
          <>
            {may('impersonate') && !u.suspended && (
              <button className="primary-btn sm" onClick={() => signInAs(u.id)}>
                <LogIn size={13} /> Sign in as {first}
              </button>
            )}
            <Menu
              label="More"
              items={[
                may('impersonate') &&
                  (u.hasLogin
                    ? { label: 'Give a reset code', run: () => void post<{ code: string }>('person/reset-code', { userId: u.id }).then((r) => setShown({ title: 'Reset code', value: r.code, text: `Tell ${first} this code; they enter it with a new password at “Forgot your password?”. Good for 15 minutes.` })).catch((e: Error) => toast(e.message)) }
                    : { label: 'Make an invite link', run: () => void post<{ link: string }>('person/invite', { userId: u.id }).then((r) => setShown({ title: 'Invite link', value: r.link, text: `Send ${first} this link to pick a password (valid 7 days).` })).catch((e: Error) => toast(e.message)) }),
                may('impersonate') && u.twoStep && { label: 'Reset two-step sign-in', run: () => setResetting2fa(true), danger: true },
                may('customers') && !u.operator && (u.suspended ? { label: 'Lift the suspension', run: () => void act(() => post('person/suspend', { userId: u.id, on: false }), 'Suspension lifted').then(reload) } : { label: 'Suspend', run: () => setSuspending(true), danger: true }),
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
            Suspended {rel(u.suspended.at)} by {u.suspended.by}
            {u.suspended.reason ? `: ${u.suspended.reason}` : ''}. They can’t sign in.
          </span>
        </div>
      )}
      <div className="adm-split">
        <div>
          <Section title="Companies">
            {u.companies.length === 0 ? (
              <Empty title={u.guestOf ? `Only a guest of ${u.guestOf}` : 'In no company'} />
            ) : (
              <div className="adm-mini-list">
                {u.companies.map((c) => (
                  <div key={c.id} className="adm-mini-row">
                    <button type="button" className="grow adm-link" onClick={() => go(`/admin/companies/${c.id}`)}>
                      <strong>{c.name}</strong> <span className="muted">{c.role}</span>
                    </button>
                    {may('customers') && c.role !== 'owner' && (
                      <button className="ghost-btn sm" onClick={() => void act(() => post('person/role', { id: c.id, userId: u.id, role: 'owner' }), `${first} owns ${c.name} now`).then(reload)}>
                        Make owner
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Free trial" hint="One per person and per company domain">
            <div className="adm-mini-list">
              {u.trial.trials.length === 0 ? (
                <div className="adm-mini-row">
                  <span className="grow muted">Hasn’t had one yet: their first company starts on it.</span>
                </div>
              ) : (
                u.trial.trials.map((t) => (
                  <div key={t.workspaceId} className="adm-mini-row">
                    <button type="button" className="grow adm-link" onClick={() => go(`/admin/companies/${t.workspaceId}`)}>
                      <strong>{t.company}</strong> <span className="muted">from {day(t.at)}{t.how === 'operator' ? ', given by an operator' : t.how === 'granted' ? ', allowed by an operator' : ''}</span>
                    </button>
                  </div>
                ))
              )}
              {u.trial.trials.length > 0 && (
                <div className="adm-mini-row">
                  {u.trial.granted ? (
                    <span className="grow muted">
                      {u.trial.granted.by} allowed one more {rel(u.trial.granted.at)}: their next new company starts on it.
                    </span>
                  ) : (
                    <>
                      <span className="grow muted">A new company of theirs starts on Free.</span>
                      {may('customers') && (
                        <button className="ghost-btn sm" onClick={() => void act(() => post('person/trial-grant', { userId: u.id }), `${first}’s next company gets a trial`).then(reload)}>
                          Allow another trial
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Section>
          <Section title="Tickets">
            <TicketList tickets={u.tickets} />
          </Section>
        </div>
        <div>
          <Section title="Signed in on" hint={`${u.sessions.length} device${u.sessions.length === 1 ? '' : 's'}`}>
            {u.sessions.length === 0 ? (
              <Empty title="Not signed in anywhere" />
            ) : (
              <div className="adm-mini-list">
                {u.sessions.map((s) => (
                  <div key={s.id} className="adm-mini-row">
                    <MonitorSmartphone size={14} />
                    <span className="grow">
                      <strong>{s.actingAs ? `Operator ${s.actingAs}` : device(s.ua)}</strong>
                      <small className="muted">
                        {' '}
                        · {s.ip ?? 'unknown address'} · last {rel(s.lastAt)}
                      </small>
                    </span>
                    {may('customers') && (
                      <button className="ghost-btn sm" onClick={() => void act(() => post('person/end-session', { userId: u.id, sessionId: s.id }), 'Signed out there').then(reload)}>
                        Sign out
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="What operators did">
            {u.audit.length === 0 ? (
              <Empty title="Nothing yet" />
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
      {suspending && <Confirm title={`Suspend ${first}`} action="Suspend" danger reason="Why (they see it)" text={`${u.name} is signed out everywhere and can’t sign in until you lift it. Their work stays.`} onClose={() => setSuspending(false)} onConfirm={(v) => act(() => post('person/suspend', { userId: u.id, reason: v.reason }), 'Suspended').then(() => (setSuspending(false), reload()))} />}
      {resetting2fa && (
        <Confirm
          title={`Reset ${first}’s two-step sign-in`}
          action="Reset"
          danger
          reason="How you checked it’s them (logged)"
          text={`${first} lost their authenticator app and backup codes? This turns two-step sign-in off for their account and signs them out everywhere; they get an email. If a company requires it, they set it up again at their next sign-in. Only do this after checking it’s really them.`}
          onClose={() => setResetting2fa(false)}
          onConfirm={(v) => act(() => post('person/2fa-reset', { userId: u.id, reason: v.reason }), 'Two-step sign-in reset').then(() => (setResetting2fa(false), reload()))}
        />
      )}
      {shown && (
        <Dialog title={shown.title} size="sm" onClose={() => setShown(null)} foot={<button className="primary-btn" onClick={() => setShown(null)}>Done</button>}>
          <div className="adm-form">
            <p className="adm-dialog-text">{shown.text}</p>
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

