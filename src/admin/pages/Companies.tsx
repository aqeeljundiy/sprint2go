import { useState } from 'react';
import { AlertTriangle, Check, Download, FileText, KeyRound, LogIn, Mail, Pin, Plus, Trash2, UserPlus } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { zoneOptions } from '../../components/ui/zones';
import { deviceTz } from '../../jobTimes';

import { rel, bytes, CompanyRow, copy, dateTime, day, planLabel, post, rp, rpShort, STATE_LABEL, type Health, type State } from '../api';
import { Badge, Confirm, CopyBtn, Dialog, Dot, Empty, Failed, Field, HealthPill, KV, Loading, Menu, Page, Section, Stat, Stats, Switch, Table, Tabs, useAct, useAdmin, useApi, Who } from '../ui';
import { TicketList } from './Tickets';
import { t, tn, tx } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtDate, fmtNumber } from '../../i18n/format';

export const STATE_TONE: Record<State, 'good' | 'accent' | 'warn' | 'bad' | 'neutral' | 'info'> = { paying: 'good', trial: 'accent', comp: 'info', paused: 'warn', suspended: 'bad', free: 'neutral' };
export function StateBadge({ s }: { s: State }) {
  return <Badge tone={STATE_TONE[s]}>{STATE_LABEL[s]}</Badge>;
}
const soon = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

/** A person's role in a company, in the console's language (the server sends owner, admin or member). */
const roleLabel = (role: string) => (role === 'owner' ? t('Owner') : role === 'admin' ? t('Admin') : role === 'member' ? t('Member') : role);
const roleOptions = () => [
  { value: 'owner', label: t('Owner') },
  { value: 'admin', label: t('Admin') },
  { value: 'member', label: t('Member') },
];

function csv(rows: CompanyRow[]) {
  const head = [t('Company'), t('Owner'), t('Plan'), t('State'), t('People'), t('Monthly (Rp)'), t('Health'), t('Last active'), t('Since')];
  const lines = rows.map((c) => [c.name, c.owner?.email ?? '', planLabel(c.plan), STATE_LABEL[c.state], c.people, Math.round(c.mrr || c.after || 0), c.health.score, c.lastActive ?? '', c.since ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sprint2go-companies-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Companies() {
  const { go, may } = useAdmin();
  const { data, error, reload } = useApi<{ companies: CompanyRow[] }>('companies');
  const [creating, setCreating] = useState(false);
  const act = useAct();
  if (error) return <Page title={t('Companies')}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Companies')}><Loading rows={8} /></Page>;
  const rows = data.companies;
  const real = rows.filter((c) => !c.internal);
  const paying = real.filter((c) => c.state === 'paying').length;
  const risk = real.filter((c) => c.health.label === 'risk').length;
  return (
    <Page
      title={t('Companies')}
      sub={[tn(real.length, '{n} customer', '{n} customers'), tn(paying, '{n} paying', '{n} paying'), tn(risk, '{n} at risk', '{n} at risk')].join(' · ')}
      actions={
        may('customers') && (
          <button className="primary-btn sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> {t('New company')}
          </button>
        )
      }
    >
      <Table
        id="companies"
        rows={rows}
        rowKey={(c) => c.id}
        onOpen={(c) => go(`/admin/companies/${c.id}`)}
        search={(c) => `${c.name} ${c.owner?.email ?? ''} ${c.owner?.name ?? ''} ${c.domains.join(' ')} ${c.id}`}
        initialSort={{ key: 'active', dir: -1 }}
        views={[
          { id: 'customers', label: t('Customers'), test: (c) => !c.internal },
          { id: 'paying', label: STATE_LABEL.paying, test: (c) => !c.internal && c.state === 'paying' },
          { id: 'trial', label: t('On trial'), test: (c) => !c.internal && c.state === 'trial' },
          { id: 'ending', label: t('Trial ending'), test: (c) => !c.internal && c.state === 'trial' && !!c.plan?.trialEnds && c.plan.trialEnds < soon() },
          { id: 'risk', label: t('At risk'), test: (c) => !c.internal && c.health.label === 'risk' && c.state !== 'free' },
          { id: 'suspended', label: STATE_LABEL.suspended, test: (c) => !!c.suspended },
          { id: 'internal', label: t('Ours & tests'), test: (c) => c.internal },
        ]}
        empty={{ title: t('No companies here'), text: t('A company appears when someone finishes signing up, or when you create one.') }}
        bulk={(sel, clear) => (
          <>
            {may('customers') && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('company/extend-trial', { ids: sel.map((c) => c.id), days: 14 }), t('Trials extended by 14 days')).then(clear)}>
                {t('Trial +14 days')}
              </button>
            )}
            {may('customers') && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('company/internal', { ids: sel.map((c) => c.id), on: !sel[0].internal }), sel[0].internal ? t('Counted as customers again') : t('Left out of the numbers')).then(clear)}>
                {sel[0].internal ? t('Count as customers') : t('Mark as ours or test')}
              </button>
            )}
            <button className="ghost-btn sm" onClick={() => csv(sel)}>
              <Download size={13} /> CSV
            </button>
          </>
        )}
        cols={[
          {
            key: 'name',
            label: t('Company'),
            width: 'minmax(0, 2fr)',
            sort: (c) => c.name.toLowerCase(),
            render: (c) => (
              <span className="adm-cell-main with-dot">
                <Dot color={c.color} />
                <span>
                  <strong>
                    {c.name}
                    {c.home && <Badge tone="accent">{t('ours')}</Badge>}
                  </strong>
                  <small>{c.owner?.email ?? tx('company', 'no owner')}</small>
                </span>
              </span>
            ),
          },
          { key: 'health', label: t('Health'), width: '110px', sort: (c) => c.health.score, render: (c) => <HealthPill h={c.health} /> },
          {
            key: 'plan',
            label: t('Plan'),
            width: 'minmax(0, 1.3fr)',
            hide: 'phone',
            sort: (c) => ['suspended', 'free', 'paused', 'comp', 'trial', 'paying'].indexOf(c.state),
            render: (c) => (
              <span className="adm-cell-inline">
                <span className="adm-ellipsis">{planLabel(c.plan)}</span> <StateBadge s={c.state} />
              </span>
            ),
          },
          { key: 'people', label: t('People'), width: '70px', align: 'right', hide: 'tablet', sort: (c) => c.people, render: (c) => c.people },
          { key: 'mrr', label: t('Monthly'), width: '110px', align: 'right', sort: (c) => c.mrr || (c.after ?? 0) / 1000, render: (c) => (c.mrr ? rpShort(c.mrr) : c.after ? <span className="muted">{t('{amount} later', { amount: rpShort(c.after) })}</span> : <span className="muted">Rp 0</span>) },
          { key: 'tickets', label: t('Tickets'), width: '70px', align: 'right', hide: 'tablet', sort: (c) => c.openTickets, render: (c) => (c.openTickets ? <Badge tone="warn">{c.openTickets}</Badge> : <span className="muted">0</span>) },
          { key: 'active', label: t('Last active'), width: '110px', align: 'right', hide: 'phone', sort: (c) => c.lastActive ?? '', render: (c) => <span className="muted">{c.lastActive ? rel(c.lastActive) : t('never')}</span> },
        ]}
      />
      {creating && <NewCompany onClose={() => setCreating(false)} onDone={(id) => (setCreating(false), go(`/admin/companies/${id}`))} />}
    </Page>
  );
}

// The plans' names (Small, Studio…) are product names and stay as they are; the words are getters, read when shown.
const TIERS = [
  { value: 'free', get label() { return t('Free'); } },
  { value: 'small', label: 'Small' },
  { value: 'studio', label: 'Studio' },
  { value: 'agency', label: 'Agency' },
  { value: 'business', label: 'Business' },
];
const TRACKS = [
  { value: 'ai', get label() { return t('AI included'); } },
  { value: 'own', get label() { return t('Own AI keys'); } },
];

function NewCompany({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [owner, setOwner] = useState('');
  const [tier, setTier] = useState('studio');
  const [track, setTrack] = useState('ai');
  const [trial, setTrial] = useState('14');
  // The company's clock (summaries, digests, reminders, the demo's dates): the operator's own zone unless they pick one.
  const [tz, setTz] = useState(deviceTz);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; link: string | null } | null>(null);
  const { toast } = useAdmin();
  return (
    <Dialog
      title={t('New company')}
      onClose={onClose}
      foot={
        result ? (
          <button className="primary-btn" onClick={() => onDone(result.id)}>
            {t('Open the company')}
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              className="primary-btn"
              disabled={busy || name.trim().length < 2 || !email.includes('@')}
              onClick={() => {
                setBusy(true);
                post<{ id: string; link: string | null }>('company/create', { name, ownerEmail: email, ownerName: owner, tier, track, trialDays: Number(trial), timeZone: tz })
                  .then(setResult)
                  .catch((e: Error) => toast(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('Create')}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="adm-form">
          <p className="adm-dialog-text">
            {result.link
              ? tj('{name} is ready. Send the owner this link to pick a password (valid 7 days). Onboarding starts when they sign in.', { name: <strong>{name}</strong> })
              : tj('{name} is ready. The owner already signs in; it’s in their switcher now.', { name: <strong>{name}</strong> })}
          </p>
          {result.link && (
            <div className="adm-linkbox">
              <code>{result.link}</code>
              <CopyBtn text={result.link} label={t('Copy link')} />
            </div>
          )}
        </div>
      ) : (
        <div className="adm-form">
          <Field label={t('Company name')}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. {example}', { example: 'Nusa Studio' })} autoFocus />
          </Field>
          <div className="adm-grid2">
            <Field label={t('Owner’s email')}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('owner@company.com')} />
            </Field>
            <Field label={t('Owner’s name')}>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('Optional')} />
            </Field>
          </div>
          <div className="adm-grid3">
            <Field label={t('Plan')}>
              <Select value={tier} options={TIERS} onChange={setTier} label={t('Plan')} />
            </Field>
            <Field label="AI">
              <Select value={track} options={TRACKS} onChange={setTrack} label="AI" />
            </Field>
            <Field label={t('Trial')}>
              <Select value={trial} onChange={setTrial} label={t('Trial')} options={[{ value: '0', label: t('None, billed now') }, ...[14, 30, 90].map((n) => ({ value: String(n), label: tn(n, '{n} day', '{n} days') }))]} />
            </Field>
          </div>
          {/* Not a <label>: a click on its edge would pull focus away from the picker's search. */}
          <div className="adm-field">
            <span>{t('Time zone')}</span>
            <Select value={tz} onChange={setTz} label={t('Time zone')} searchable options={zoneOptions(tz)} />
            <small>{t('Their day: summaries, digests and reminders run on this clock. They can change it in Settings, General.')}</small>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- one company ---------- */

interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  color: string;
  role: string;
  lastSeen: string | null;
  hasLogin: boolean;
  suspended: unknown;
  deleted: boolean;
}
interface Invoice {
  id: string;
  number: string;
  period: string;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  dueAt: string;
  paidAt: string | null;
}
type Full = CompanyRow & {
  members: Member[];
  accounts: { id: string; email: string; kind: string; provider: string; users: number; sendPaused: { at: string; reason: string } | null }[];
  apps: string[] | null;
  emailSetup: string | null;
  mailRoute: string;
  mailCredits: number;
  mailChecks: { at: string; allOk: boolean; checks: { key: string; ok: boolean; found: string; want: string }[] } | null;
  whiteLabel: { name: string; domain: string | null } | null;
  usage: { job: string; provider: string; model: string; uses: number; rp: number }[];
  appsUsed: { coll: string; n: number }[];
  mail: { received: number; spam: number; sent: number; boosted: number; failed: number; queued: number };
  invoices: Invoice[];
  tickets: { id: string; number: number; subject: string; status: 'new' | 'open' | 'waiting' | 'resolved' | 'closed'; priority: string; updatedAt: string; requester: string }[];
  notes: { id: string; by: string; text: string; pinned: boolean; at: string }[];
  timeline: { at: string; kind: 'event' | 'operator'; type: string; text: string | null; by: string | null }[];
  deletion: { runAt: string; requestedBy: string } | null;
};

// Words read when they're shown (getters), in the console's language: docs/i18n.md.
const EVENT_TEXT: Record<string, string> = {
  get 'company.created'() { return t('Company created'); },
  get 'team.invited'() { return t('Invited their team'); },
  get 'first.use'() { return t('First real use'); },
  get 'mail.first'() { return t('Sent their first email'); },
  get 'ticket.opened'() { return t('Opened a ticket'); },
  get 'plan.changed'() { return t('Plan changed'); },
  get 'invoice.paid'() { return t('Paid an invoice'); },
  get 'coupon.used'() { return t('Used a code'); },
  get 'company.suspended'() { return t('Suspended'); },
  get 'company.unsuspended'() { return t('Suspension lifted'); },
};
const EMAIL_SETUP: Record<string, string> = {
  get keep() { return t('Stays with their provider'); },
  get mix() { return t('Some of each'); },
  get hosted() { return t('Hosted here'); },
  get none() { return t('No email'); },
};
const APP_NAME: Record<string, string> = {
  get threads() { return t('Mail'); },
  get messages() { return t('Chat'); },
  get todos() { return t('Tasks'); },
  get clients() { return t('Projects'); },
  get events() { return t('Calendar'); },
  get drive() { return t('Drive'); },
  get meetings() { return t('Meet'); },
  get tables() { return t('Tables'); },
  get rows() { return t('Tables'); },
  get notes() { return t('Notes'); },
  get quotes() { return t('Quotes'); },
  get channels() { return t('Chat'); },
};
/** A mailbox's kind (personal or shared), as the app writes it. */
const MAILBOX_KIND: Record<string, string> = {
  get personal() { return tx('mailbox', 'personal'); },
  get shared() { return tx('mailbox', 'shared'); },
};

export function CompanyPage({ id, tab }: { id: string; tab: string }) {
  const { go, may, signInAs } = useAdmin();
  const { data, error, reload } = useApi<{ company: Full }>(`company?id=${encodeURIComponent(id)}`);
  const act = useAct();
  const [confirm, setConfirm] = useState<'suspend' | 'delete' | 'reset' | 'schedule' | null>(null);
  if (error) return <Page title={t('Company')} back={{ label: t('Companies'), to: '/admin/companies' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Company')} back={{ label: t('Companies'), to: '/admin/companies' }}><Loading rows={8} /></Page>;
  const c = data.company;
  const owner = c.members.find((m) => m.role === 'owner');
  const setTab = (to: string) => go(`/admin/companies/${id}/${to}`);
  return (
    <Page
      back={{ label: t('Companies'), to: '/admin/companies' }}
      wide
      title={
        <span className="adm-title-dot">
          <Dot color={c.color} /> {c.name}
        </span>
      }
      sub={
        <span className="adm-head-badges">
          <StateBadge s={c.state} />
          <HealthPill h={c.health} />
          {c.internal && <Badge tone="info">{c.home ? t('Our own company') : t('Ours or test')}</Badge>}
          <span className="muted">
            {[planLabel(c.plan), tn(c.people, '{n} person', '{n} people'), c.since ? t('since {date}', { date: day(c.since) }) : '', c.lastActive ? t('active {when}', { when: rel(c.lastActive) }) : t('never active')].filter(Boolean).join(' · ')}
          </span>
        </span>
      }
      actions={
        <>
          {owner && may('impersonate') && (
            <button className="ghost-btn sm" onClick={() => signInAs(owner.id)}>
              <LogIn size={13} /> {t('Sign in as owner')}
            </button>
          )}
          <Menu
            label={t('More')}
            items={[
              may('customers') && (c.suspended ? { label: t('Lift the suspension'), run: () => void act(() => post('company/suspend', { id, on: false }), t('Suspension lifted')) } : { label: t('Suspend'), run: () => setConfirm('suspend'), hint: t('Read-only, with a reason they see') }),
              may('customers') && { label: c.internal ? t('Count as a customer') : t('Mark as ours or test'), run: () => void act(() => post('company/internal', { id, on: !c.internal }), c.internal ? t('Counted again') : t('Left out of the numbers')), hint: t('Leaves it out of revenue and growth') },
              may('customers') && { label: t('Export its data'), run: () => location.assign(`/api/admin/company/export?id=${encodeURIComponent(id)}`), hint: t('Everything, as JSON') },
              may('danger') && (c.deletion ? { label: t('Cancel the scheduled deletion'), run: () => void act(() => post('company/delete-request', { id, cancel: true }), t('Deletion cancelled')) } : { label: t('Delete in 30 days'), run: () => setConfirm('schedule'), hint: t('When they ask for their data to be removed') }),
              may('danger') && { label: t('Reset data'), run: () => setConfirm('reset'), danger: true },
              may('danger') && { label: t('Delete now'), run: () => setConfirm('delete'), danger: true },
            ]}
          />
        </>
      }
    >
      {c.suspended && (
        <div className="adm-banner bad">
          <AlertTriangle size={15} />
          <span>
            {c.suspended.reason
              ? t('Suspended {when} by {who}: {reason}. Everyone there can read but not change anything.', { when: rel(c.suspended.at), who: c.suspended.by, reason: c.suspended.reason })
              : t('Suspended {when} by {who}. Everyone there can read but not change anything.', { when: rel(c.suspended.at), who: c.suspended.by })}
          </span>
          {may('customers') && (
            <button className="ghost-btn sm" onClick={() => void act(() => post('company/suspend', { id, on: false }), t('Suspension lifted')).then(reload)}>
              {t('Lift')}
            </button>
          )}
        </div>
      )}
      {c.deletion && (
        <div className="adm-banner warn">
          <Trash2 size={15} />
          <span>{t('Deleted {when} ({date}), asked by {who}.', { when: rel(c.deletion.runAt), date: day(c.deletion.runAt), who: c.deletion.requestedBy })}</span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: t('Overview') },
          { id: 'people', label: t('People'), count: c.people },
          { id: 'billing', label: t('Billing'), count: c.overdue },
          { id: 'usage', label: t('Usage') },
          { id: 'email', label: t('Email') },
          { id: 'support', label: tx('tab', 'Support'), count: c.openTickets },
          { id: 'notes', label: t('Notes'), count: c.notes.length },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {tab === 'overview' && <Overview c={c} reload={reload} />}
        {tab === 'people' && <PeopleTab c={c} reload={reload} />}
        {tab === 'billing' && <BillingTab c={c} reload={reload} />}
        {tab === 'usage' && <UsageTab c={c} />}
        {tab === 'email' && <EmailTab c={c} reload={reload} />}
        {tab === 'support' && (
          <Section title={t('Tickets')} actions={<button className="ghost-btn sm" onClick={() => go('/admin/tickets')}>{t('All tickets')}</button>}>
            <TicketList tickets={c.tickets} />
          </Section>
        )}
        {tab === 'notes' && <Notes c={c} reload={reload} />}
      </div>
      {confirm === 'suspend' && <Confirm title={t('Suspend {name}', { name: c.name })} action={t('Suspend')} why reason={t('What they’ll see')} text={t('Everyone in the company keeps read access and sees the reason; nothing can be changed until you lift it.')} onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/suspend', { id, reason: v.reason, why: v.why }), t('Suspended')).then(() => (setConfirm(null), reload()))} />}
      {confirm === 'schedule' && <Confirm title={t('Delete in 30 days')} action={t('Schedule')} reason={t('Who asked for it')} text={t('{name} and everything in it is deleted in 30 days. Until then it can be cancelled here, and the data can be exported.', { name: c.name })} onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/delete-request', { id, requestedBy: v.reason || undefined }), t('Deletion scheduled')).then(() => (setConfirm(null), reload()))} />}
      {confirm === 'reset' && <Confirm title={t('Reset data')} danger word="RESET" action={tx('data', 'Reset')} text={t('Empties the company (tasks, chat, mail, files, tables, meetings, projects) but keeps it, its plan and its people. The daily backup is the only way back.')} onClose={() => setConfirm(null)} onConfirm={() => act(() => post('company/reset', { id, confirm: 'RESET' }), t('Company data reset')).then(() => (setConfirm(null), reload()))} />}
      {confirm === 'delete' && <Confirm title={t('Delete now')} danger word={c.name} why action={t('Delete')} text={t('Removes the company and everything in it. People keep their own accounts. The daily backup is the only way back.')} onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/delete', { id, confirm: c.name, why: v.why }), t('Company deleted')).then(() => (setConfirm(null), go('/admin/companies')))} />}
    </Page>
  );
}

function HealthParts({ h }: { h: Health }) {
  return (
    <div className="adm-parts">
      {h.parts.map((p) => (
        <div key={p.key} className="adm-part">
          <span>{p.label}</span>
          <span className="adm-part-bar">
            <i style={{ width: `${(p.score / p.max) * 100}%` }} className={p.score / p.max >= 0.66 ? 'good' : p.score / p.max >= 0.33 ? 'warn' : 'bad'} />
          </span>
          <small>
            {p.score}/{p.max}
          </small>
        </div>
      ))}
    </div>
  );
}

function Overview({ c, reload }: { c: Full; reload: () => void }) {
  const { may } = useAdmin();
  const [note, setNote] = useState('');
  const act = useAct();
  const pinned = c.notes.filter((n) => n.pinned);
  return (
    <div className="adm-split">
      <div>
        {pinned.map((n) => (
          <div key={n.id} className="adm-banner note">
            <Pin size={14} />
            <span>
              {n.text}
              <small className="muted"> · {n.by.split('@')[0]}, {rel(n.at)}</small>
            </span>
          </div>
        ))}
        <Section title={t('Health')} hint={t('{score} of 100', { score: c.health.score })}>
          <HealthParts h={c.health} />
        </Section>
        <Section title={tx('company', 'Set up')}>
          <KV
            items={[
              { k: t('Owner'), v: c.owner ? `${c.owner.name} · ${c.owner.email}` : t('nobody') },
              { k: t('Domains'), v: c.domains.join(', ') || t('none') },
              {
                k: t('Email'),
                v: [
                  EMAIL_SETUP[c.emailSetup ?? ''] ?? t('Not chosen'),
                  c.emailSetup && c.emailSetup !== 'none' ? (c.mailRoute === 'boosted' ? t('sends boosted') : t('sends from our server')) : '',
                  c.mailChecks ? (c.mailChecks.allOk ? t('records ok') : t('records missing')) : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
              },
              { k: t('Apps'), v: c.apps ? c.apps.join(', ') : t('all') },
              { k: t('Brand'), v: c.whiteLabel ? (c.whiteLabel.domain ? t('{name} at {domain}', { name: c.whiteLabel.name, domain: c.whiteLabel.domain }) : c.whiteLabel.name) : 'sprint2go' },
              { k: t('Industry'), v: c.industry ?? t('not set') },
              { k: t('Projects'), v: `${c.projects} · ${tn(c.guests, '{n} guest', '{n} guests')}` },
              { k: 'ID', v: <code className="adm-mono-sm">{c.id}</code> },
            ]}
          />
        </Section>
      </div>
      <div>
        {may('support') && (
          <div className="adm-note-add">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('A note for the team (they never see it)')} />
            <button className="ghost-btn sm" disabled={!note.trim()} onClick={() => void act(() => post('note', { workspaceId: c.id, text: note }), t('Note added')).then((ok) => ok && (setNote(''), reload()))}>
              {t('Add note')}
            </button>
          </div>
        )}
        <Section title={t('Timeline')}>
          {c.timeline.length === 0 ? (
            <Empty title={t('Nothing yet')} text={t('Sign-ups, first use, plan changes, tickets and every operator action show here.')} />
          ) : (
            <ol className="adm-timeline">
              {c.timeline.map((e, i) => (
                <li key={i} className={e.kind}>
                  <i />
                  <span>
                    <strong>{e.kind === 'operator' ? e.type.replace('company.', '').replace('.', ' ') : EVENT_TEXT[e.type] ?? e.type}</strong>
                    {e.text && <span className="muted"> · {e.text}</span>}
                    <small>
                      {e.by ? `${e.by} · ` : ''}
                      {dateTime(e.at)}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}

function PeopleTab({ c, reload }: { c: Full; reload: () => void }) {
  const { go, may, signInAs, toast } = useAdmin();
  const [adding, setAdding] = useState(false);
  // What's kept is the kind and the name; the words are written while rendering, in the console's language.
  const [shown, setShown] = useState<{ kind: 'code' | 'link'; value: string; name: string } | null>(null);
  const act = useAct();
  return (
    <Section
      title={t('People')}
      actions={
        may('customers') && (
          <button className="ghost-btn sm" onClick={() => setAdding(true)}>
            <UserPlus size={13} /> {t('Add a person')}
          </button>
        )
      }
    >
      <Table
        id={`company-people`}
        rows={c.members}
        rowKey={(m) => m.id}
        onOpen={(m) => go(`/admin/people/${m.id}`)}
        dense
        cols={[
          {
            key: 'name',
            label: t('Person'),
            width: 'minmax(0, 2fr)',
            sort: (m) => m.name,
            render: (m) => (
              <Who name={m.name} email={m.email} color={m.color} />
            ),
          },
          {
            key: 'role',
            label: t('Role'),
            width: '130px',
            sort: (m) => m.role,
            render: (m) =>
              may('customers') ? (
                <Select value={m.role} onChange={(v) => void act(() => post('person/role', { id: c.id, userId: m.id, role: v }), t('{name} is now {role}', { name: m.name.split(' ')[0], role: roleLabel(v).toLowerCase() })).then(reload)} label={t('Role')} options={roleOptions()} />
              ) : (
                roleLabel(m.role)
              ),
          },
          { key: 'seen', label: t('Last seen'), width: '120px', hide: 'phone', sort: (m) => m.lastSeen ?? '', render: (m) => <span className="muted">{m.deleted ? t('deleted') : !m.hasLogin ? t('never signed in') : m.lastSeen ? rel(m.lastSeen) : t('not yet')}</span> },
          {
            key: 'act',
            label: '',
            width: '84px',
            align: 'right',
            render: (m) =>
              m.deleted ? null : (
                <span className="adm-row-actions">
                  {may('impersonate') && (
                    <button className="icon-btn sm" title={m.hasLogin ? t('Reset code') : t('Invite link')} aria-label={t('Help them sign in')} onClick={() => void post<{ code?: string; link?: string }>(m.hasLogin ? 'person/reset-code' : 'person/invite', { userId: m.id }).then((r) => setShown(r.code ? { kind: 'code', value: r.code, name: m.name.split(' ')[0] } : { kind: 'link', value: r.link!, name: m.name.split(' ')[0] })).catch((e: Error) => toast(e.message))}>
                      <KeyRound size={14} />
                    </button>
                  )}
                  {may('impersonate') && (
                    <button className="icon-btn sm" title={t('Sign in as')} aria-label={t('Sign in as {name}', { name: m.name })} onClick={() => signInAs(m.id)}>
                      <LogIn size={14} />
                    </button>
                  )}
                </span>
              ),
          },
        ]}
      />
      {adding && <AddPerson companyId={c.id} onClose={() => setAdding(false)} onDone={reload} />}
      {shown && (
        <Dialog title={shown.kind === 'code' ? t('Reset code') : t('Invite link')} size="sm" onClose={() => setShown(null)} foot={<button className="primary-btn" onClick={() => setShown(null)}>{t('Done')}</button>}>
          <div className="adm-form">
            <p className="adm-dialog-text">
              {shown.kind === 'code'
                ? t('Tell {name} this code; they enter it with a new password at “Forgot your password?”. Good for 15 minutes.', { name: shown.name })
                : t('Send {name} this link to pick a password (valid 7 days).', { name: shown.name })}
            </p>
            <div className="adm-linkbox">
              <code className={shown.value.length < 10 ? 'big' : ''}>{shown.value}</code>
              <CopyBtn text={shown.value} />
            </div>
          </div>
        </Dialog>
      )}
    </Section>
  );
}

function AddPerson({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<string | null | 'none'>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useAdmin();
  return (
    <Dialog
      title={t('Add a person')}
      size="sm"
      onClose={onClose}
      foot={
        link ? (
          <button className="primary-btn" onClick={onClose}>
            {t('Done')}
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              className="primary-btn"
              disabled={busy || !email.includes('@')}
              onClick={() => {
                setBusy(true);
                post<{ link: string | null }>('company/person', { id: companyId, email, name, role })
                  .then((r) => (setLink(r.link ?? 'none'), onDone()))
                  .catch((e: Error) => toast(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('Add')}
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="adm-form">
          <p className="adm-dialog-text">{link === 'none' ? t('They already sign in; the company is in their switcher now.') : t('Send them this link to pick a password (valid 7 days):')}</p>
          {link !== 'none' && (
            <div className="adm-linkbox">
              <code>{link}</code>
              <CopyBtn text={link} label={t('Copy link')} />
            </div>
          )}
        </div>
      ) : (
        <div className="adm-form">
          <Field label={t('Email')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label={t('Name')}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Optional')} />
          </Field>
          <Field label={t('Role')}>
            <Select value={role} onChange={setRole} label={t('Role')} options={[{ value: 'member', label: t('Member') }, { value: 'admin', label: t('Admin') }, { value: 'owner', label: t('Owner') }]} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

const INV_TONE = { draft: 'neutral', sent: 'accent', paid: 'good', void: 'neutral' } as const;
function BillingTab({ c, reload }: { c: Full; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  const p = c.plan;
  const canBill = may('billing');
  const canCare = may('customers');
  const plan = (patch: Record<string, unknown>, done = t('Saved')) => void act(() => post('company/plan', { id: c.id, ...patch }), done).then(reload);
  const [compUntil, setCompUntil] = useState('');
  const [compNote, setCompNote] = useState('');
  const [code, setCode] = useState('');
  const [bill, setBill] = useState({ company: p?.billing?.company ?? c.name, npwp: p?.billing?.npwp ?? '', address: p?.billing?.address ?? '', emails: (p?.billing?.emails ?? []).join(', ') });
  const d = p?.discount;
  const off = !d ? '' : d.kind === 'percent' ? (d.until ? t('{value}% off until {date}', { value: d.value, date: day(d.until) }) : t('{value}% off, for good', { value: d.value })) : d.until ? t('{amount} off a month until {date}', { amount: rp(d.value), date: day(d.until) }) : t('{amount} off a month, for good', { amount: rp(d.value) });
  const invStatus = { get draft() { return t('Draft'); }, get sent() { return t('Sent'); }, get paid() { return t('Paid'); }, get void() { return t('Void'); } };
  return (
    <div className="adm-split">
      <div>
        <Section title={t('Plan')} hint={c.mrr ? tn(c.active, '{amount} a month, for {n} active person', '{amount} a month, for {n} active people', { amount: rp(c.mrr) }) : c.after ? t('{amount} a month after {state}', { amount: rp(c.after), state: STATE_LABEL[c.state].toLowerCase() }) : 'Rp 0'}>
          <div className="adm-form">
            <div className="adm-grid3">
              <Field label={t('Plan')}>
                <Select value={p?.tier ?? 'free'} options={TIERS} onChange={(v) => plan({ tier: v }, t('Plan: {plan}', { plan: TIERS.find((x) => x.value === v)?.label ?? v }))} label={t('Plan')} disabled={!canBill} />
              </Field>
              <Field label="AI">
                <Select value={p?.track ?? 'own'} options={TRACKS} onChange={(v) => plan({ track: v })} label="AI" disabled={!canBill} />
              </Field>
              <Field label={t('Billed')}>
                <Select value={p?.cycle ?? 'monthly'} onChange={(v) => plan({ cycle: v })} label={t('Billed')} disabled={!canBill} options={[{ value: 'monthly', label: t('Monthly') }, { value: 'yearly', label: t('Yearly (10 months)') }]} />
              </Field>
            </div>
            <div className="adm-grid2">
              <Field label={t('Trial ends')}>
                <DatePicker value={p?.trialEnds ? p.trialEnds.slice(0, 10) : ''} onChange={(v) => plan({ trialEnds: v ? new Date(v + 'T23:59:59Z').toISOString() : null }, v ? t('Trial changed') : t('Trial ended'))} clearable label={t('Trial ends')} />
              </Field>
              <Switch label={t('Paused')} hint={t('No charge; they keep read access')} on={!!p?.paused} disabled={!canCare} onChange={(v) => plan({ paused: v }, v ? t('Paused') : t('Resumed'))} />
            </div>
          </div>
        </Section>
        <Section title={t('Free months')}>
          {p?.comp ? (
            <div className="adm-inline">
              <span>
                {tj('Free until {date}', { date: <strong>{day(p.comp.until)}</strong> })}
                {p.comp.note ? <span className="muted"> · {p.comp.note}</span> : null}
              </span>
              {canCare && (
                <button className="link-btn small" onClick={() => plan({ comp: null }, t('Free months removed'))}>
                  {t('Remove')}
                </button>
              )}
            </div>
          ) : (
            <div className="adm-form">
              <div className="adm-grid2">
                <Field label={t('Free until')}>
                  <DatePicker value={compUntil} onChange={setCompUntil} clearable label={t('Free until')} />
                </Field>
                <Field label={t('Why')}>
                  <input value={compNote} onChange={(e) => setCompNote(e.target.value)} placeholder={t('e.g. {example}', { example: t('Launch partner') })} disabled={!canCare} />
                </Field>
              </div>
              <div>
                <button className="ghost-btn sm" disabled={!compUntil || !canCare} onClick={() => (plan({ comp: { until: new Date(compUntil + 'T23:59:59Z').toISOString(), note: compNote } }, t('Free months given')), setCompUntil(''), setCompNote(''))}>
                  {t('Give free months')}
                </button>
              </div>
            </div>
          )}
        </Section>
        <Section title={t('Discount')}>
          {d ? (
            <div className="adm-inline">
              <span>
                <strong>{d.code}</strong>: {off}
              </span>
              {canBill && (
                <button className="link-btn small" onClick={() => plan({ discount: null }, t('Discount removed'))}>
                  {t('Remove')}
                </button>
              )}
            </div>
          ) : (
            <div className="adm-inline">
              <input className="adm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('Coupon code')} disabled={!canBill} />
              <button className="ghost-btn sm" disabled={!code.trim() || !canBill} onClick={() => void act(() => post('coupon', { apply: code, workspaceId: c.id }), t('Code applied')).then((ok) => ok && (setCode(''), reload()))}>
                {t('Apply')}
              </button>
            </div>
          )}
        </Section>
        <Section title={t('Add-ons')}>
          <div className="adm-form">
            <div className="adm-grid3">
              {(
                [
                  ['mailboxes', t('Hosted mailboxes')],
                  ['storage50', t('Extra 50 GB blocks')],
                  ['meetHours10', t('Bot hours ×10')],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <input type="number" min={0} defaultValue={p?.addons?.[k] ?? 0} disabled={!canBill} onBlur={(e) => Number(e.target.value) !== (p?.addons?.[k] ?? 0) && plan({ addons: { [k]: Math.max(0, Number(e.target.value) || 0) } }, t('Add-ons saved'))} />
                </Field>
              ))}
            </div>
            <Switch label={t('Branding add-on')} on={!!p?.addons?.branding} disabled={!canBill} onChange={(v) => plan({ addons: { branding: v } }, t('Add-ons saved'))} />
          </div>
        </Section>
      </div>
      <div>
        <Section title={t('Invoices')} actions={canBill && p && p.tier !== 'free' && <button className="ghost-btn sm" onClick={() => void act(() => post('invoice/create', { workspaceId: c.id }), t('Draft invoice made')).then(reload)}><FileText size={13} /> {t('New invoice')}</button>}>
          {c.invoices.length === 0 ? (
            <Empty title={t('No invoices yet')} text={t('Make one here, or make this month’s for every paying company from {money}.', { money: t('Money') })} />
          ) : (
            <div className="adm-mini-list">
              {c.invoices.map((i) => {
                const late = i.status === 'sent' && i.dueAt < new Date().toISOString();
                return (
                  <div key={i.id} className="adm-mini-row">
                    <a href={`/api/admin/invoice.html?id=${i.id}`} target="_blank" rel="noreferrer" className="grow">
                      <strong>{i.number}</strong> <span className="muted">{fmtDate(`${i.period}-01`, { month: 'short', year: 'numeric' })}</span>
                    </a>
                    <span>{rp(i.total)}</span>
                    <Badge tone={late ? 'bad' : INV_TONE[i.status]}>{late ? t('Overdue') : invStatus[i.status]}</Badge>
                    {canBill && (
                      <Menu
                        label=""
                        items={[
                          i.status === 'draft' && { label: t('Send'), run: () => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), t('Invoice sent')).then(reload) },
                          i.status === 'sent' && { label: t('Send a reminder'), run: () => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), t('Reminder sent')).then(reload) },
                          (i.status === 'sent' || i.status === 'draft') && { label: t('Mark paid (bank transfer)'), run: () => void act(() => post('invoice/status', { id: i.id, status: 'paid', method: 'bank transfer' }), t('Marked paid')).then(reload) },
                          i.status !== 'void' && i.status !== 'paid' && { label: tx('action', 'Void'), run: () => void act(() => post('invoice/status', { id: i.id, status: 'void' }), t('Voided')).then(reload), danger: true },
                          { label: t('Copy link'), run: () => void copy(`${location.origin}/api/admin/invoice.html?id=${i.id}`) },
                        ]}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        <Section title={t('Billing details')} hint={t('Printed on invoices')}>
          <div className="adm-form">
            <Field label={t('Company name')}>
              <input value={bill.company} onChange={(e) => setBill({ ...bill, company: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label="NPWP">
              <input value={bill.npwp} onChange={(e) => setBill({ ...bill, npwp: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label={t('Address')}>
              <textarea rows={2} value={bill.address} onChange={(e) => setBill({ ...bill, address: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label={t('Invoice emails')} hint={t('Comma-separated')}>
              <input value={bill.emails} onChange={(e) => setBill({ ...bill, emails: e.target.value })} disabled={!canBill} />
            </Field>
            {canBill && (
              <div>
                <button className="ghost-btn sm" onClick={() => plan({ billing: { ...bill, emails: bill.emails.split(/[,\s]+/).filter(Boolean) } }, t('Billing details saved'))}>
                  {t('Save details')}
                </button>
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function UsageTab({ c }: { c: Full }) {
  const apps = new Map<string, number>();
  for (const a of c.appsUsed) apps.set(APP_NAME[a.coll] ?? a.coll, (apps.get(APP_NAME[a.coll] ?? a.coll) ?? 0) + a.n);
  const max = Math.max(1, ...apps.values());
  return (
    <>
      <Stats>
        <Stat label={t('AI this month')} value={rpShort(c.aiRp)} hint={c.plan?.track === 'ai' ? t('on us') : t('on their keys')} />
        <Stat label={t('Included AI uses')} value={c.aiIncludedUses} />
        <Stat label={t('Files')} value={bytes(c.storageBytes)} />
        <Stat label={t('Mail this month')} value={t('{sent} out · {received} in', { sent: c.mail.sent, received: c.mail.received })} />
      </Stats>
      <div className="adm-split">
        <Section title={t('What they use')} hint={t('Things made or changed, last 30 days')}>
          {apps.size === 0 ? (
            <Empty title={t('Nothing yet')} text={t('They haven’t made anything in the last 30 days.')} />
          ) : (
            <div className="adm-parts">
              {[...apps.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <div key={name} className="adm-part">
                    <span>{name}</span>
                    <span className="adm-part-bar">
                      <i className="accent" style={{ width: `${(n / max) * 100}%` }} />
                    </span>
                    <small>{n}</small>
                  </div>
                ))}
            </div>
          )}
        </Section>
        <Section title={t('AI by job')}>
          {c.usage.length === 0 ? (
            <Empty title={t('No AI used this month')} />
          ) : (
            <div className="adm-mini-list">
              {c.usage.map((u) => (
                <div key={`${u.job}-${u.provider}-${u.model}`} className="adm-mini-row">
                  <span className="grow">
                    <strong>{u.job}</strong> <span className="muted">{u.provider} · {u.model}</span>
                  </span>
                  <span className="muted">{u.uses}×</span>
                  <span>{rp(u.rp)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function EmailTab({ c, reload }: { c: Full; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  return (
    <div className="adm-split">
      <div>
        <Section title={t('Set-up')}>
          <KV
            items={[
              { k: t('Where mail lives'), v: EMAIL_SETUP[c.emailSetup ?? ''] ?? t('Not chosen') },
              { k: t('Sending'), v: c.mailRoute === 'boosted' ? tn(c.mailCredits, 'Boosted · {n} credit left', 'Boosted · {n} credits left') : t('From our server') },
              { k: t('Domain'), v: c.domains[0] ?? t('none (addresses on our server)') },
              {
                k: t('Records'),
                v: c.mailChecks ? (
                  c.mailChecks.allOk ? (
                    <span className="adm-ok">
                      <Check size={13} /> {t('all in place, {when}', { when: rel(c.mailChecks.at) })}
                    </span>
                  ) : (
                    t('{records} missing ({when})', { records: c.mailChecks.checks.filter((x) => !x.ok).map((x) => x.key.toUpperCase()).join(', '), when: rel(c.mailChecks.at) })
                  )
                ) : (
                  t('never checked')
                ),
              },
            ]}
          />
        </Section>
        <Section title={t('This month')}>
          <KV
            items={[
              { k: t('Received'), v: c.mail.spam ? t('{received} ({spam} spam)', { received: fmtNumber(c.mail.received), spam: fmtNumber(c.mail.spam) }) : fmtNumber(c.mail.received) },
              { k: t('Sent'), v: c.mail.boosted ? t('{sent} ({boosted} boosted)', { sent: fmtNumber(c.mail.sent), boosted: fmtNumber(c.mail.boosted) }) : fmtNumber(c.mail.sent) },
              { k: t('Undelivered'), v: fmtNumber(c.mail.failed) },
              { k: t('On the way'), v: fmtNumber(c.mail.queued) },
            ]}
          />
        </Section>
      </div>
      <Section title={t('Mailboxes')}>
        {c.accounts.length === 0 ? (
          <Empty title={t('No mailboxes')} />
        ) : (
          <div className="adm-mini-list">
            {c.accounts.map((a) => (
              <div key={a.id} className="adm-mini-row">
                <Mail size={14} />
                <span className="grow">
                  <strong>{a.email}</strong>{' '}
                  <span className="muted">
                    {MAILBOX_KIND[a.kind] ?? a.kind} · {a.provider === 'sprint2go' ? t('hosted here') : a.provider}
                  </span>
                  {a.sendPaused && <small className="adm-late"> {t('Sending paused: {reason}', { reason: a.sendPaused.reason })}</small>}
                </span>
                {a.sendPaused && may('platform') && (
                  <button className="ghost-btn sm" onClick={() => void act(() => post('mailbox/unpause', { workspaceId: c.id, accountId: a.id }), t('Sending resumed')).then(reload)}>
                    {t('Resume')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Notes({ c, reload }: { c: Full; reload: () => void }) {
  const { may } = useAdmin();
  const [text, setText] = useState('');
  const act = useAct();
  return (
    <Section title={t('Notes')} hint={t('Only operators see these')}>
      {may('support') && (
        <div className="adm-note-add">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('What the next person should know about this company')} />
          <button className="primary-btn sm" disabled={!text.trim()} onClick={() => void act(() => post('note', { workspaceId: c.id, text }), t('Note added')).then((ok) => ok && (setText(''), reload()))}>
            {t('Add note')}
          </button>
        </div>
      )}
      {c.notes.length === 0 ? (
        <Empty title={t('No notes yet')} text={t('Context for the team: who to talk to, what was promised, what to watch.')} />
      ) : (
        <div className="adm-notes">
          {c.notes.map((n) => (
            <article key={n.id} className={n.pinned ? 'pinned' : ''}>
              <p>{n.text}</p>
              <footer>
                <small className="muted">
                  {n.by} · {dateTime(n.at)}
                </small>
                {may('support') && (
                  <span className="adm-row-actions">
                    <button className="icon-btn sm" title={n.pinned ? t('Unpin') : t('Pin to the overview')} aria-label={n.pinned ? t('Unpin') : t('Pin')} onClick={() => void act(() => post('note', { id: n.id, pin: !n.pinned })).then(reload)}>
                      <Pin size={13} />
                    </button>
                    <button className="icon-btn sm" title={t('Delete')} aria-label={t('Delete')} onClick={() => void act(() => post('note', { delete: n.id }), t('Note deleted')).then(reload)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

