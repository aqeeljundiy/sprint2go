import { useState } from 'react';
import { AlertTriangle, Check, Download, FileText, KeyRound, LogIn, Mail, Pin, Plus, Trash2, UserPlus } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';

import { rel, bytes, CompanyRow, copy, dateTime, day, planLabel, post, rp, rpShort, STATE_LABEL, type Health, type State } from '../api';
import { Badge, Confirm, CopyBtn, Dialog, Dot, Empty, Failed, Field, HealthPill, KV, Loading, Menu, Page, Section, Stat, Stats, Switch, Table, Tabs, useAct, useAdmin, useApi, Who } from '../ui';
import { TicketList } from './Tickets';

export const STATE_TONE: Record<State, 'good' | 'accent' | 'warn' | 'bad' | 'neutral' | 'info'> = { paying: 'good', trial: 'accent', comp: 'info', paused: 'warn', suspended: 'bad', free: 'neutral' };
export function StateBadge({ s }: { s: State }) {
  return <Badge tone={STATE_TONE[s]}>{STATE_LABEL[s]}</Badge>;
}
const soon = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function csv(rows: CompanyRow[]) {
  const head = ['Company', 'Owner', 'Plan', 'State', 'People', 'Monthly (Rp)', 'Health', 'Last active', 'Since'];
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
  if (error) return <Page title="Companies"><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Companies"><Loading rows={8} /></Page>;
  const rows = data.companies;
  const real = rows.filter((c) => !c.internal);
  return (
    <Page
      title="Companies"
      sub={`${real.length} customers · ${real.filter((c) => c.state === 'paying').length} paying · ${real.filter((c) => c.health.label === 'risk').length} at risk`}
      actions={
        may('customers') && (
          <button className="primary-btn sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New company
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
          { id: 'customers', label: 'Customers', test: (c) => !c.internal },
          { id: 'paying', label: 'Paying', test: (c) => !c.internal && c.state === 'paying' },
          { id: 'trial', label: 'On trial', test: (c) => !c.internal && c.state === 'trial' },
          { id: 'ending', label: 'Trial ending', test: (c) => !c.internal && c.state === 'trial' && !!c.plan?.trialEnds && c.plan.trialEnds < soon() },
          { id: 'risk', label: 'At risk', test: (c) => !c.internal && c.health.label === 'risk' && c.state !== 'free' },
          { id: 'suspended', label: 'Suspended', test: (c) => !!c.suspended },
          { id: 'internal', label: 'Ours & tests', test: (c) => c.internal },
        ]}
        empty={{ title: 'No companies here', text: 'A company appears when someone finishes signing up, or when you create one.' }}
        bulk={(sel, clear) => (
          <>
            {may('customers') && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('company/extend-trial', { ids: sel.map((c) => c.id), days: 14 }), 'Trials extended by 14 days').then(clear)}>
                Trial +14 days
              </button>
            )}
            {may('customers') && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('company/internal', { ids: sel.map((c) => c.id), on: !sel[0].internal }), sel[0].internal ? 'Counted as customers again' : 'Left out of the numbers').then(clear)}>
                {sel[0].internal ? 'Count as customers' : 'Mark as ours or test'}
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
            label: 'Company',
            width: 'minmax(0, 2fr)',
            sort: (c) => c.name.toLowerCase(),
            render: (c) => (
              <span className="adm-cell-main with-dot">
                <Dot color={c.color} />
                <span>
                  <strong>
                    {c.name}
                    {c.home && <Badge tone="accent">ours</Badge>}
                  </strong>
                  <small>{c.owner?.email ?? 'no owner'}</small>
                </span>
              </span>
            ),
          },
          { key: 'health', label: 'Health', width: '110px', sort: (c) => c.health.score, render: (c) => <HealthPill h={c.health} /> },
          {
            key: 'plan',
            label: 'Plan',
            width: 'minmax(0, 1.3fr)',
            hide: 'phone',
            sort: (c) => ['suspended', 'free', 'paused', 'comp', 'trial', 'paying'].indexOf(c.state),
            render: (c) => (
              <span className="adm-cell-inline">
                <span className="adm-ellipsis">{planLabel(c.plan)}</span> <StateBadge s={c.state} />
              </span>
            ),
          },
          { key: 'people', label: 'People', width: '70px', align: 'right', hide: 'tablet', sort: (c) => c.people, render: (c) => c.people },
          { key: 'mrr', label: 'Monthly', width: '110px', align: 'right', sort: (c) => c.mrr || (c.after ?? 0) / 1000, render: (c) => (c.mrr ? rpShort(c.mrr) : c.after ? <span className="muted">{rpShort(c.after)} later</span> : <span className="muted">Rp 0</span>) },
          { key: 'tickets', label: 'Tickets', width: '70px', align: 'right', hide: 'tablet', sort: (c) => c.openTickets, render: (c) => (c.openTickets ? <Badge tone="warn">{c.openTickets}</Badge> : <span className="muted">0</span>) },
          { key: 'active', label: 'Last active', width: '110px', align: 'right', hide: 'phone', sort: (c) => c.lastActive ?? '', render: (c) => <span className="muted">{c.lastActive ? rel(c.lastActive) : 'never'}</span> },
        ]}
      />
      {creating && <NewCompany onClose={() => setCreating(false)} onDone={(id) => (setCreating(false), go(`/admin/companies/${id}`))} />}
    </Page>
  );
}

const TIERS = [
  { value: 'free', label: 'Free' },
  { value: 'small', label: 'Small' },
  { value: 'studio', label: 'Studio' },
  { value: 'agency', label: 'Agency' },
  { value: 'business', label: 'Business' },
];
const TRACKS = [
  { value: 'ai', label: 'AI included' },
  { value: 'own', label: 'Own AI keys' },
];

function NewCompany({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [owner, setOwner] = useState('');
  const [tier, setTier] = useState('studio');
  const [track, setTrack] = useState('ai');
  const [trial, setTrial] = useState('14');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; link: string | null } | null>(null);
  const { toast } = useAdmin();
  return (
    <Dialog
      title="New company"
      onClose={onClose}
      foot={
        result ? (
          <button className="primary-btn" onClick={() => onDone(result.id)}>
            Open the company
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-btn"
              disabled={busy || name.trim().length < 2 || !email.includes('@')}
              onClick={() => {
                setBusy(true);
                post<{ id: string; link: string | null }>('company/create', { name, ownerEmail: email, ownerName: owner, tier, track, trialDays: Number(trial) })
                  .then(setResult)
                  .catch((e: Error) => toast(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Create
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="adm-form">
          <p className="adm-dialog-text">
            <strong>{name}</strong> is ready. {result.link ? 'Send the owner this link to pick a password (valid 7 days). Onboarding starts when they sign in.' : 'The owner already signs in; it’s in their switcher now.'}
          </p>
          {result.link && (
            <div className="adm-linkbox">
              <code>{result.link}</code>
              <CopyBtn text={result.link} label="Copy link" />
            </div>
          )}
        </div>
      ) : (
        <div className="adm-form">
          <Field label="Company name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nusa Studio" autoFocus />
          </Field>
          <div className="adm-grid2">
            <Field label="Owner’s email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.com" />
            </Field>
            <Field label="Owner’s name">
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          <div className="adm-grid3">
            <Field label="Plan">
              <Select value={tier} options={TIERS} onChange={setTier} label="Plan" />
            </Field>
            <Field label="AI">
              <Select value={track} options={TRACKS} onChange={setTrack} label="AI" />
            </Field>
            <Field label="Trial">
              <Select value={trial} onChange={setTrial} label="Trial" options={[{ value: '0', label: 'None, billed now' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            </Field>
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

const EVENT_TEXT: Record<string, string> = {
  'company.created': 'Company created',
  'team.invited': 'Invited their team',
  'first.use': 'First real use',
  'mail.first': 'Sent their first email',
  'ticket.opened': 'Opened a ticket',
  'plan.changed': 'Plan changed',
  'invoice.paid': 'Paid an invoice',
  'coupon.used': 'Used a code',
  'company.suspended': 'Suspended',
  'company.unsuspended': 'Suspension lifted',
};
const EMAIL_SETUP: Record<string, string> = { keep: 'Stays with their provider', mix: 'Some of each', hosted: 'Hosted here', none: 'No email' };
const APP_NAME: Record<string, string> = { threads: 'Mail', messages: 'Chat', todos: 'Tasks', clients: 'Projects', events: 'Calendar', drive: 'Drive', meetings: 'Meet', tables: 'Tables', rows: 'Tables', notes: 'Notes', quotes: 'Quotes', channels: 'Chat' };

export function CompanyPage({ id, tab }: { id: string; tab: string }) {
  const { go, may, signInAs } = useAdmin();
  const { data, error, reload } = useApi<{ company: Full }>(`company?id=${encodeURIComponent(id)}`);
  const act = useAct();
  const [confirm, setConfirm] = useState<'suspend' | 'delete' | 'reset' | 'schedule' | null>(null);
  if (error) return <Page title="Company" back={{ label: 'Companies', to: '/admin/companies' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Company" back={{ label: 'Companies', to: '/admin/companies' }}><Loading rows={8} /></Page>;
  const c = data.company;
  const owner = c.members.find((m) => m.role === 'owner');
  const setTab = (t: string) => go(`/admin/companies/${id}/${t}`);
  return (
    <Page
      back={{ label: 'Companies', to: '/admin/companies' }}
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
          {c.internal && <Badge tone="info">{c.home ? 'Our own company' : 'Ours or test'}</Badge>}
          <span className="muted">
            {planLabel(c.plan)} · {c.people} {c.people === 1 ? 'person' : 'people'}
            {c.since ? ` · since ${day(c.since)}` : ''}
            {c.lastActive ? ` · active ${rel(c.lastActive)}` : ' · never active'}
          </span>
        </span>
      }
      actions={
        <>
          {owner && may('impersonate') && (
            <button className="ghost-btn sm" onClick={() => signInAs(owner.id)}>
              <LogIn size={13} /> Sign in as owner
            </button>
          )}
          <Menu
            label="More"
            items={[
              may('customers') && (c.suspended ? { label: 'Lift the suspension', run: () => void act(() => post('company/suspend', { id, on: false }), 'Suspension lifted') } : { label: 'Suspend', run: () => setConfirm('suspend'), hint: 'Read-only, with a reason they see' }),
              may('customers') && { label: c.internal ? 'Count as a customer' : 'Mark as ours or test', run: () => void act(() => post('company/internal', { id, on: !c.internal }), c.internal ? 'Counted again' : 'Left out of the numbers'), hint: 'Leaves it out of revenue and growth' },
              may('customers') && { label: 'Export its data', run: () => location.assign(`/api/admin/company/export?id=${encodeURIComponent(id)}`), hint: 'Everything, as JSON' },
              may('danger') && (c.deletion ? { label: 'Cancel the scheduled deletion', run: () => void act(() => post('company/delete-request', { id, cancel: true }), 'Deletion cancelled') } : { label: 'Delete in 30 days', run: () => setConfirm('schedule'), hint: 'When they ask for their data to be removed' }),
              may('danger') && { label: 'Reset data', run: () => setConfirm('reset'), danger: true },
              may('danger') && { label: 'Delete now', run: () => setConfirm('delete'), danger: true },
            ]}
          />
        </>
      }
    >
      {c.suspended && (
        <div className="adm-banner bad">
          <AlertTriangle size={15} />
          <span>
            Suspended {rel(c.suspended.at)} by {c.suspended.by}
            {c.suspended.reason ? `: ${c.suspended.reason}` : ''}. Everyone there can read but not change anything.
          </span>
          {may('customers') && (
            <button className="ghost-btn sm" onClick={() => void act(() => post('company/suspend', { id, on: false }), 'Suspension lifted').then(reload)}>
              Lift
            </button>
          )}
        </div>
      )}
      {c.deletion && (
        <div className="adm-banner warn">
          <Trash2 size={15} />
          <span>
            Deleted {rel(c.deletion.runAt)} ({day(c.deletion.runAt)}), asked by {c.deletion.requestedBy}.
          </span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'people', label: 'People', count: c.people },
          { id: 'billing', label: 'Billing', count: c.overdue },
          { id: 'usage', label: 'Usage' },
          { id: 'email', label: 'Email' },
          { id: 'support', label: 'Support', count: c.openTickets },
          { id: 'notes', label: 'Notes', count: c.notes.length },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {tab === 'overview' && <Overview c={c} reload={reload} />}
        {tab === 'people' && <PeopleTab c={c} reload={reload} />}
        {tab === 'billing' && <BillingTab c={c} reload={reload} />}
        {tab === 'usage' && <UsageTab c={c} />}
        {tab === 'email' && <EmailTab c={c} reload={reload} />}
        {tab === 'support' && (
          <Section title="Tickets" actions={<button className="ghost-btn sm" onClick={() => go('/admin/tickets')}>All tickets</button>}>
            <TicketList tickets={c.tickets} />
          </Section>
        )}
        {tab === 'notes' && <Notes c={c} reload={reload} />}
      </div>
      {confirm === 'suspend' && <Confirm title={`Suspend ${c.name}`} action="Suspend" why reason="What they’ll see" text="Everyone in the company keeps read access and sees the reason; nothing can be changed until you lift it." onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/suspend', { id, reason: v.reason, why: v.why }), 'Suspended').then(() => (setConfirm(null), reload()))} />}
      {confirm === 'schedule' && <Confirm title="Delete in 30 days" action="Schedule" reason="Who asked for it" text={`${c.name} and everything in it is deleted in 30 days. Until then it can be cancelled here, and the data can be exported.`} onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/delete-request', { id, requestedBy: v.reason || undefined }), 'Deletion scheduled').then(() => (setConfirm(null), reload()))} />}
      {confirm === 'reset' && <Confirm title="Reset data" danger word="RESET" action="Reset" text="Empties the company (tasks, chat, mail, files, tables, meetings, projects) but keeps it, its plan and its people. The daily backup is the only way back." onClose={() => setConfirm(null)} onConfirm={() => act(() => post('company/reset', { id, confirm: 'RESET' }), 'Company data reset').then(() => (setConfirm(null), reload()))} />}
      {confirm === 'delete' && <Confirm title="Delete now" danger word={c.name} why action="Delete" text="Removes the company and everything in it. People keep their own accounts. The daily backup is the only way back." onClose={() => setConfirm(null)} onConfirm={(v) => act(() => post('company/delete', { id, confirm: c.name, why: v.why }), 'Company deleted').then(() => (setConfirm(null), go('/admin/companies')))} />}
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
        <Section title="Health" hint={`${c.health.score} of 100`}>
          <HealthParts h={c.health} />
        </Section>
        <Section title="Set up">
          <KV
            items={[
              { k: 'Owner', v: c.owner ? `${c.owner.name} · ${c.owner.email}` : 'nobody' },
              { k: 'Domains', v: c.domains.join(', ') || 'none' },
              { k: 'Email', v: `${EMAIL_SETUP[c.emailSetup ?? ''] ?? 'Not chosen'}${c.emailSetup && c.emailSetup !== 'none' ? ` · sends ${c.mailRoute === 'boosted' ? 'boosted' : 'from our server'}` : ''}${c.mailChecks ? (c.mailChecks.allOk ? ' · records ok' : ' · records missing') : ''}` },
              { k: 'Apps', v: c.apps ? c.apps.join(', ') : 'all' },
              { k: 'Brand', v: c.whiteLabel ? `${c.whiteLabel.name}${c.whiteLabel.domain ? ` at ${c.whiteLabel.domain}` : ''}` : 'sprint2go' },
              { k: 'Industry', v: c.industry ?? 'not set' },
              { k: 'Projects', v: `${c.projects} · ${c.guests} guests` },
              { k: 'ID', v: <code className="adm-mono-sm">{c.id}</code> },
            ]}
          />
        </Section>
      </div>
      <div>
        {may('support') && (
          <div className="adm-note-add">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the team (they never see it)" />
            <button className="ghost-btn sm" disabled={!note.trim()} onClick={() => void act(() => post('note', { workspaceId: c.id, text: note }), 'Note added').then((ok) => ok && (setNote(''), reload()))}>
              Add note
            </button>
          </div>
        )}
        <Section title="Timeline">
          {c.timeline.length === 0 ? (
            <Empty title="Nothing yet" text="Sign-ups, first use, plan changes, tickets and every operator action show here." />
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
  const [shown, setShown] = useState<{ title: string; value: string; text: string } | null>(null);
  const act = useAct();
  return (
    <Section
      title="People"
      actions={
        may('customers') && (
          <button className="ghost-btn sm" onClick={() => setAdding(true)}>
            <UserPlus size={13} /> Add a person
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
            label: 'Person',
            width: 'minmax(0, 2fr)',
            sort: (m) => m.name,
            render: (m) => (
              <Who name={m.name} email={m.email} color={m.color} />
            ),
          },
          {
            key: 'role',
            label: 'Role',
            width: '130px',
            sort: (m) => m.role,
            render: (m) =>
              may('customers') ? (
                <Select value={m.role} onChange={(v) => void act(() => post('person/role', { id: c.id, userId: m.id, role: v }), `${m.name.split(' ')[0]} is now ${v}`).then(reload)} label="Role" options={[{ value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }]} />
              ) : (
                m.role
              ),
          },
          { key: 'seen', label: 'Last seen', width: '120px', hide: 'phone', sort: (m) => m.lastSeen ?? '', render: (m) => <span className="muted">{m.deleted ? 'deleted' : !m.hasLogin ? 'never signed in' : m.lastSeen ? rel(m.lastSeen) : 'not yet'}</span> },
          {
            key: 'act',
            label: '',
            width: '84px',
            align: 'right',
            render: (m) =>
              m.deleted ? null : (
                <span className="adm-row-actions">
                  {may('impersonate') && (
                    <button className="icon-btn sm" title={m.hasLogin ? 'Reset code' : 'Invite link'} aria-label="Help them sign in" onClick={() => void post<{ code?: string; link?: string }>(m.hasLogin ? 'person/reset-code' : 'person/invite', { userId: m.id }).then((r) => setShown(r.code ? { title: 'Reset code', value: r.code, text: `Tell ${m.name.split(' ')[0]} this code; they enter it with a new password at “Forgot your password?”. Good for 15 minutes.` } : { title: 'Invite link', value: r.link!, text: `Send ${m.name.split(' ')[0]} this link to pick a password (valid 7 days).` })).catch((e: Error) => toast(e.message))}>
                      <KeyRound size={14} />
                    </button>
                  )}
                  {may('impersonate') && (
                    <button className="icon-btn sm" title="Sign in as" aria-label={`Sign in as ${m.name}`} onClick={() => signInAs(m.id)}>
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
      title="Add a person"
      size="sm"
      onClose={onClose}
      foot={
        link ? (
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              Cancel
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
              Add
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="adm-form">
          <p className="adm-dialog-text">{link === 'none' ? 'They already sign in; the company is in their switcher now.' : 'Send them this link to pick a password (valid 7 days):'}</p>
          {link !== 'none' && (
            <div className="adm-linkbox">
              <code>{link}</code>
              <CopyBtn text={link} label="Copy link" />
            </div>
          )}
        </div>
      ) : (
        <div className="adm-form">
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={setRole} label="Role" options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }, { value: 'owner', label: 'Owner' }]} />
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
  const plan = (patch: Record<string, unknown>, done = 'Saved') => void act(() => post('company/plan', { id: c.id, ...patch }), done).then(reload);
  const [compUntil, setCompUntil] = useState('');
  const [compNote, setCompNote] = useState('');
  const [code, setCode] = useState('');
  const [bill, setBill] = useState({ company: p?.billing?.company ?? c.name, npwp: p?.billing?.npwp ?? '', address: p?.billing?.address ?? '', emails: (p?.billing?.emails ?? []).join(', ') });
  return (
    <div className="adm-split">
      <div>
        <Section title="Plan" hint={c.mrr ? `${rp(c.mrr)} a month` : c.after ? `${rp(c.after)} a month after ${STATE_LABEL[c.state].toLowerCase()}` : 'Rp 0'}>
          <div className="adm-form">
            <div className="adm-grid3">
              <Field label="Plan">
                <Select value={p?.tier ?? 'free'} options={TIERS} onChange={(v) => plan({ tier: v }, `Plan: ${v}`)} label="Plan" disabled={!canBill} />
              </Field>
              <Field label="AI">
                <Select value={p?.track ?? 'own'} options={TRACKS} onChange={(v) => plan({ track: v })} label="AI" disabled={!canBill} />
              </Field>
              <Field label="Billed">
                <Select value={p?.cycle ?? 'monthly'} onChange={(v) => plan({ cycle: v })} label="Billed" disabled={!canBill} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly (10 months)' }]} />
              </Field>
            </div>
            <div className="adm-grid2">
              <Field label="Trial ends">
                <DatePicker value={p?.trialEnds ? p.trialEnds.slice(0, 10) : ''} onChange={(v) => plan({ trialEnds: v ? new Date(v + 'T23:59:59Z').toISOString() : null }, v ? 'Trial changed' : 'Trial ended')} clearable label="Trial ends" />
              </Field>
              <Switch label="Paused" hint="No charge; they keep read access" on={!!p?.paused} disabled={!canCare} onChange={(v) => plan({ paused: v }, v ? 'Paused' : 'Resumed')} />
            </div>
          </div>
        </Section>
        <Section title="Free months">
          {p?.comp ? (
            <div className="adm-inline">
              <span>
                Free until <strong>{day(p.comp.until)}</strong>
                {p.comp.note ? <span className="muted"> · {p.comp.note}</span> : null}
              </span>
              {canCare && (
                <button className="link-btn small" onClick={() => plan({ comp: null }, 'Free months removed')}>
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div className="adm-form">
              <div className="adm-grid2">
                <Field label="Free until">
                  <DatePicker value={compUntil} onChange={setCompUntil} clearable label="Free until" />
                </Field>
                <Field label="Why">
                  <input value={compNote} onChange={(e) => setCompNote(e.target.value)} placeholder="e.g. Launch partner" disabled={!canCare} />
                </Field>
              </div>
              <div>
                <button className="ghost-btn sm" disabled={!compUntil || !canCare} onClick={() => (plan({ comp: { until: new Date(compUntil + 'T23:59:59Z').toISOString(), note: compNote } }, 'Free months given'), setCompUntil(''), setCompNote(''))}>
                  Give free months
                </button>
              </div>
            </div>
          )}
        </Section>
        <Section title="Discount">
          {p?.discount ? (
            <div className="adm-inline">
              <span>
                <strong>{p.discount.code}</strong>: {p.discount.kind === 'percent' ? `${p.discount.value}% off` : `${rp(p.discount.value)} off a month`}
                {p.discount.until ? ` until ${day(p.discount.until)}` : ', for good'}
              </span>
              {canBill && (
                <button className="link-btn small" onClick={() => plan({ discount: null }, 'Discount removed')}>
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div className="adm-inline">
              <input className="adm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Coupon code" disabled={!canBill} />
              <button className="ghost-btn sm" disabled={!code.trim() || !canBill} onClick={() => void act(() => post('coupon', { apply: code, workspaceId: c.id }), 'Code applied').then((ok) => ok && (setCode(''), reload()))}>
                Apply
              </button>
            </div>
          )}
        </Section>
        <Section title="Add-ons">
          <div className="adm-form">
            <div className="adm-grid3">
              {(
                [
                  ['mailboxes', 'Hosted mailboxes'],
                  ['storage50', 'Extra 50 GB blocks'],
                  ['meetHours10', 'Bot hours ×10'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <input type="number" min={0} defaultValue={p?.addons?.[k] ?? 0} disabled={!canBill} onBlur={(e) => Number(e.target.value) !== (p?.addons?.[k] ?? 0) && plan({ addons: { [k]: Math.max(0, Number(e.target.value) || 0) } }, 'Add-ons saved')} />
                </Field>
              ))}
            </div>
            <Switch label="Branding add-on" on={!!p?.addons?.branding} disabled={!canBill} onChange={(v) => plan({ addons: { branding: v } }, 'Add-ons saved')} />
          </div>
        </Section>
      </div>
      <div>
        <Section title="Invoices" actions={canBill && p && p.tier !== 'free' && <button className="ghost-btn sm" onClick={() => void act(() => post('invoice/create', { workspaceId: c.id }), 'Draft invoice made').then(reload)}><FileText size={13} /> New invoice</button>}>
          {c.invoices.length === 0 ? (
            <Empty title="No invoices yet" text="Make one here, or make this month’s for every paying company from Money." />
          ) : (
            <div className="adm-mini-list">
              {c.invoices.map((i) => (
                <div key={i.id} className="adm-mini-row">
                  <a href={`/api/admin/invoice.html?id=${i.id}`} target="_blank" rel="noreferrer" className="grow">
                    <strong>{i.number}</strong> <span className="muted">{new Date(i.period + '-01').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
                  </a>
                  <span>{rp(i.total)}</span>
                  <Badge tone={i.status === 'sent' && i.dueAt < new Date().toISOString() ? 'bad' : INV_TONE[i.status]}>{i.status === 'sent' && i.dueAt < new Date().toISOString() ? 'Overdue' : i.status[0].toUpperCase() + i.status.slice(1)}</Badge>
                  {canBill && (
                    <Menu
                      label=""
                      items={[
                        i.status === 'draft' && { label: 'Send', run: () => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), 'Invoice sent').then(reload) },
                        i.status === 'sent' && { label: 'Send a reminder', run: () => void act(() => post('invoice/status', { id: i.id, status: 'sent' }), 'Reminder sent').then(reload) },
                        (i.status === 'sent' || i.status === 'draft') && { label: 'Mark paid (bank transfer)', run: () => void act(() => post('invoice/status', { id: i.id, status: 'paid', method: 'bank transfer' }), 'Marked paid').then(reload) },
                        i.status !== 'void' && i.status !== 'paid' && { label: 'Void', run: () => void act(() => post('invoice/status', { id: i.id, status: 'void' }), 'Voided').then(reload), danger: true },
                        { label: 'Copy link', run: () => void copy(`${location.origin}/api/admin/invoice.html?id=${i.id}`) },
                      ]}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Billing details" hint="Printed on invoices">
          <div className="adm-form">
            <Field label="Company name">
              <input value={bill.company} onChange={(e) => setBill({ ...bill, company: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label="NPWP">
              <input value={bill.npwp} onChange={(e) => setBill({ ...bill, npwp: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label="Address">
              <textarea rows={2} value={bill.address} onChange={(e) => setBill({ ...bill, address: e.target.value })} disabled={!canBill} />
            </Field>
            <Field label="Invoice emails" hint="Comma-separated">
              <input value={bill.emails} onChange={(e) => setBill({ ...bill, emails: e.target.value })} disabled={!canBill} />
            </Field>
            {canBill && (
              <div>
                <button className="ghost-btn sm" onClick={() => plan({ billing: { ...bill, emails: bill.emails.split(/[,\s]+/).filter(Boolean) } }, 'Billing details saved')}>
                  Save details
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
        <Stat label="AI this month" value={rpShort(c.aiRp)} hint={c.plan?.track === 'ai' ? 'on us' : 'on their keys'} />
        <Stat label="Included AI uses" value={c.aiIncludedUses} />
        <Stat label="Files" value={bytes(c.storageBytes)} />
        <Stat label="Mail this month" value={`${c.mail.sent} out · ${c.mail.received} in`} />
      </Stats>
      <div className="adm-split">
        <Section title="What they use" hint="Things made or changed, last 30 days">
          {apps.size === 0 ? (
            <Empty title="Nothing yet" text="They haven’t made anything in the last 30 days." />
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
        <Section title="AI by job">
          {c.usage.length === 0 ? (
            <Empty title="No AI used this month" />
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
        <Section title="Set-up">
          <KV
            items={[
              { k: 'Where mail lives', v: EMAIL_SETUP[c.emailSetup ?? ''] ?? 'Not chosen' },
              { k: 'Sending', v: c.mailRoute === 'boosted' ? `Boosted · ${c.mailCredits.toLocaleString('id-ID')} credits left` : 'From our server' },
              { k: 'Domain', v: c.domains[0] ?? 'none (addresses on our server)' },
              { k: 'Records', v: c.mailChecks ? (c.mailChecks.allOk ? <span className="adm-ok"><Check size={13} /> all in place, {rel(c.mailChecks.at)}</span> : `${c.mailChecks.checks.filter((x) => !x.ok).map((x) => x.key.toUpperCase()).join(', ')} missing (${rel(c.mailChecks.at)})`) : 'never checked' },
            ]}
          />
        </Section>
        <Section title="This month">
          <KV
            items={[
              { k: 'Received', v: `${c.mail.received}${c.mail.spam ? ` (${c.mail.spam} spam)` : ''}` },
              { k: 'Sent', v: `${c.mail.sent}${c.mail.boosted ? ` (${c.mail.boosted} boosted)` : ''}` },
              { k: 'Undelivered', v: c.mail.failed },
              { k: 'On the way', v: c.mail.queued },
            ]}
          />
        </Section>
      </div>
      <Section title="Mailboxes">
        {c.accounts.length === 0 ? (
          <Empty title="No mailboxes" />
        ) : (
          <div className="adm-mini-list">
            {c.accounts.map((a) => (
              <div key={a.id} className="adm-mini-row">
                <Mail size={14} />
                <span className="grow">
                  <strong>{a.email}</strong>{' '}
                  <span className="muted">
                    {a.kind} · {a.provider === 'sprint2go' ? 'hosted here' : a.provider}
                  </span>
                  {a.sendPaused && <small className="adm-late"> Sending paused: {a.sendPaused.reason}</small>}
                </span>
                {a.sendPaused && may('platform') && (
                  <button className="ghost-btn sm" onClick={() => void act(() => post('mailbox/unpause', { workspaceId: c.id, accountId: a.id }), 'Sending resumed').then(reload)}>
                    Resume
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
    <Section title="Notes" hint="Only operators see these">
      {may('support') && (
        <div className="adm-note-add">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What the next person should know about this company" />
          <button className="primary-btn sm" disabled={!text.trim()} onClick={() => void act(() => post('note', { workspaceId: c.id, text }), 'Note added').then((ok) => ok && (setText(''), reload()))}>
            Add note
          </button>
        </div>
      )}
      {c.notes.length === 0 ? (
        <Empty title="No notes yet" text="Context for the team: who to talk to, what was promised, what to watch." />
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
                    <button className="icon-btn sm" title={n.pinned ? 'Unpin' : 'Pin to the overview'} aria-label="Pin" onClick={() => void act(() => post('note', { id: n.id, pin: !n.pinned })).then(reload)}>
                      <Pin size={13} />
                    </button>
                    <button className="icon-btn sm" title="Delete" aria-label="Delete" onClick={() => void act(() => post('note', { delete: n.id }), 'Note deleted').then(reload)}>
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

