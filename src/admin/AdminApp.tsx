import { useEffect, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowLeft, Building2, Check, ClipboardList, Copy, CreditCard, Download, Eye, Gauge, KeyRound, LogIn, LogOut, Plus, RefreshCw, Search, ServerCog, Users, X, type LucideIcon } from 'lucide-react';
import { Wordmark } from '../components/Logo';
import { Avatar } from '../components/Avatar';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { SmoothHeight, TabPane } from '../components/ui/Smooth';
import { useOnePanel } from '../onePanel';
import { relative } from '../utils';
import { signOut } from '../sync';
import { bytes, copy, day, get, planLabel, post, rp, STATE_LABEL, type CompanyRow, type PersonRow, type State } from './api';

type Section = 'today' | 'companies' | 'people' | 'revenue' | 'usage' | 'system' | 'audit';
const SECTIONS: { id: Section; name: string; icon: LucideIcon }[] = [
  { id: 'today', name: 'Today', icon: Gauge },
  { id: 'companies', name: 'Companies', icon: Building2 },
  { id: 'people', name: 'People', icon: Users },
  { id: 'revenue', name: 'Revenue', icon: CreditCard },
  { id: 'usage', name: 'Usage & costs', icon: Activity },
  { id: 'system', name: 'System', icon: ServerCog },
  { id: 'audit', name: 'Audit log', icon: ClipboardList },
];

type Toast = { id: number; text: string };
type Ctx = { toast: (t: string) => void; superadmin: boolean; openCompany: (id: string) => void; openPerson: (id: string) => void; signInAs: (id: string) => void };

/** The operator backend: the people who run Sprint2go. Same shell and parts as the app, its own screens. */
export function AdminApp() {
  const [me, setMe] = useState<{ operator: boolean; superadmin: boolean; email: string } | null | 'denied'>(null);
  const [section, setSection] = useState<Section>(() => (location.hash.slice(1) as Section) || 'today');
  const [toast, setToast] = useState<Toast | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  useEffect(() => {
    get('me').then(setMe, () => setMe('denied'));
  }, []);
  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (me === null) return <div className="boot" />;
  if (me === 'denied')
    return (
      <div className="signin">
        <div className="signin-card">
          <Wordmark height={30} />
          <h1>Operators only</h1>
          <p className="signin-sub">This account isn’t listed as an operator. Operators are set on the server (S2G_OPERATORS).</p>
          <a className="primary-btn signin-btn" href="/">
            Open the app
          </a>
          <p className="signin-switch">
            <button type="button" className="link-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        </div>
      </div>
    );
  const ctx: Ctx = {
    toast: (text) => setToast({ id: Date.now(), text }),
    superadmin: me.superadmin,
    openCompany: (id) => (setPerson(null), setCompany(id)),
    openPerson: (id) => (setCompany(null), setPerson(id)),
    signInAs: (id) =>
      void post('person/signin-as', { userId: id })
        .then(() => location.assign('/'))
        .catch((e: Error) => ctx.toast(e.message)),
  };
  return (
    <div className="app ad-app">
      <section className="settings-pane ad-pane">
        <header className="settings-head ad-head">
          <Wordmark height={22} />
          <span className="ad-head-title">Operator backend</span>
          <span className="spacer" />
          <span className="muted small ad-who">{me.email}</span>
          <a className="ghost-btn sm" href="/">
            <ArrowLeft size={13} /> App
          </a>
          <button className="icon-btn sm" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <LogOut size={15} />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map(({ id, name, icon: Icon }) => (
              <span key={id} className="settings-nav-item">
                <button className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
                  <Icon size={16} /> {name}
                </button>
              </span>
            ))}
          </nav>
          <div className="settings-content ad-content" key={section}>
            <TabPane key={section}>
              {section === 'today' && <Today ctx={ctx} />}
              {section === 'companies' && <Companies ctx={ctx} />}
              {section === 'people' && <People ctx={ctx} />}
              {section === 'revenue' && <Revenue ctx={ctx} />}
              {section === 'usage' && <Usage ctx={ctx} />}
              {section === 'system' && <System ctx={ctx} />}
              {section === 'audit' && <Audit ctx={ctx} />}
            </TabPane>
          </div>
        </div>
      </section>
      {company && <CompanyPanel id={company} ctx={ctx} onClose={() => setCompany(null)} />}
      {person && <PersonPanel id={person} ctx={ctx} onClose={() => setPerson(null)} />}
      {toast && (
        <div className="ad-toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ---------- small parts ---------- */

function Kpis({ items }: { items: { label: string; value: ReactNode; hint?: string; warn?: boolean }[] }) {
  return (
    <div className="ad-kpis">
      {items.map((k, i) => (
        <div key={k.label} className={`ad-kpi ${k.warn ? 'warn' : ''}`} style={{ ['--i' as string]: i }}>
          <b>{k.value}</b>
          <span>{k.label}</span>
          {k.hint && <small>{k.hint}</small>}
        </div>
      ))}
    </div>
  );
}
function StateBadge({ state }: { state: State }) {
  return <span className={`ad-badge ${state}`}>{STATE_LABEL[state]}</span>;
}
function Empty({ text }: { text: string }) {
  return <p className="muted small ad-empty">{text}</p>;
}
function Loading() {
  return <div className="lazy-wait" aria-hidden />;
}
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost-btn sm"
      onClick={() => {
        void copy(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </button>
  );
}
function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    load().then((d) => on && setData(d), (e: Error) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/* ---------- Today ---------- */

function Today({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useLoad(() => get('overview'));
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const { counts, queue, newCompaniesByDay } = data;
  const days = Object.entries(newCompaniesByDay as Record<string, number>);
  const max = Math.max(1, ...days.map(([, n]) => n));
  const queueEmpty = !queue.warnings.length && !queue.signups.length && !queue.codes.length && !queue.trialsEnding.length && !queue.trialsEnded.length && !queue.suspended.length && !queue.quiet.length;
  const act = (p: Promise<unknown>, done: string) => p.then(() => (ctx.toast(done), reload())).catch((e: Error) => ctx.toast(e.message));
  return (
    <>
      <div className="ad-title-row">
        <h2>Today</h2>
        <button className="icon-btn sm" onClick={reload} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      <Kpis
        items={[
          { label: 'Companies', value: counts.companies, hint: `${counts.paying} paying · ${counts.trials} on trial` },
          { label: 'People', value: counts.people, hint: `${counts.guests} guests · ${counts.online} online now` },
          { label: 'MRR', value: rp(counts.mrr), hint: 'booked' },
          { label: 'AI this month', value: rp(counts.aiRp), hint: 'at list prices' },
        ]}
      />
      <h3 className="ad-h3">What needs you</h3>
      {queueEmpty && <Empty text="Nothing waiting. Enjoy it." />}
      {queue.warnings.length > 0 && (
        <div className="ad-list">
          {queue.warnings.map((w: { kind: string; text: string }) => (
            <div key={w.kind} className="ad-row warn">
              <AlertTriangle size={15} />
              <span className="grow">{w.text}</span>
            </div>
          ))}
        </div>
      )}
      {queue.signups.length > 0 && (
        <>
          <h4 className="ad-h4">Sign-ups waiting for their code</h4>
          <div className="ad-list">
            {queue.signups.map((s: { email: string; name: string; code: string; until: string }) => (
              <div key={s.email} className="ad-row">
                <span className="grow">
                  <strong>{s.name}</strong> <span className="muted">{s.email}</span>
                  <small className="muted"> · until {new Date(s.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
                </span>
                <span className="ad-code mono">{s.code}</span>
                <CopyBtn text={s.code} />
              </div>
            ))}
          </div>
        </>
      )}
      {queue.codes.length > 0 && (
        <>
          <h4 className="ad-h4">Password reset codes</h4>
          <div className="ad-list">
            {queue.codes.map((c: { key: string; code: string; until: string }) => (
              <div key={c.key} className="ad-row">
                <span className="grow">
                  {c.key.replace(/^reset:/, '')}
                  <small className="muted"> · until {new Date(c.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
                </span>
                <span className="ad-code mono">{c.code}</span>
                <CopyBtn text={c.code} />
              </div>
            ))}
          </div>
        </>
      )}
      {queue.trialsEnding.length > 0 && (
        <>
          <h4 className="ad-h4">Trials ending this week</h4>
          <div className="ad-list">
            {queue.trialsEnding.map((t: { id: string; name: string; trialEnds: string; after: number }) => (
              <div key={t.id} className="ad-row">
                <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(t.id)}>
                  <strong>{t.name}</strong> <span className="muted">ends {day(t.trialEnds)} · then {rp(t.after)}/month</span>
                </button>
                <button className="ghost-btn sm" onClick={() => void act(post('company/plan', { id: t.id, trialEnds: new Date(Date.parse(t.trialEnds) + 14 * 86_400_000).toISOString() }), 'Trial extended by 14 days')}>
                  +14 days
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {queue.trialsEnded.length > 0 && (
        <>
          <h4 className="ad-h4">Trial over, now booked</h4>
          <div className="ad-list">
            {queue.trialsEnded.map((t: { id: string; name: string; trialEnds: string; mrr: number }) => (
              <div key={t.id} className="ad-row">
                <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(t.id)}>
                  <strong>{t.name}</strong> <span className="muted">since {day(t.trialEnds)} · {rp(t.mrr)}/month, no payment yet</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {queue.suspended.length > 0 && (
        <>
          <h4 className="ad-h4">Suspended</h4>
          <div className="ad-list">
            {queue.suspended.map((s: { id: string; name: string; at: string; by: string; reason: string }) => (
              <div key={s.id} className="ad-row">
                <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(s.id)}>
                  <strong>{s.name}</strong> <span className="muted">{s.reason || 'no reason'} · {relative(s.at)}</span>
                </button>
                <button className="ghost-btn sm" onClick={() => void act(post('company/suspend', { id: s.id, on: false }), 'Suspension lifted')}>
                  Lift
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {queue.quiet.length > 0 && (
        <>
          <h4 className="ad-h4">Gone quiet (14 days)</h4>
          <div className="ad-list">
            {queue.quiet.map((q: { id: string; name: string; lastActive: string | null; people: number }) => (
              <div key={q.id} className="ad-row">
                <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(q.id)}>
                  <strong>{q.name}</strong> <span className="muted">{q.lastActive ? `last seen ${relative(q.lastActive)}` : 'never active'} · {q.people} people</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <h3 className="ad-h3">New companies, last 30 days</h3>
      <div className="ad-bars" aria-label="New companies per day">
        {days.map(([d, n]) => (
          <span key={d} title={`${day(d)}: ${n}`} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} className={n ? 'on' : ''} />
        ))}
      </div>
    </>
  );
}

/* ---------- Companies ---------- */

function Companies({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useLoad(() => get<{ companies: CompanyRow[] }>('companies'));
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const list = data.companies.filter((c) => !q || `${c.name} ${c.owner?.email ?? ''} ${c.domains.join(' ')}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
  return (
    <>
      <div className="ad-title-row">
        <h2>Companies</h2>
        <span className="muted small">{data.companies.length}</span>
        <span className="spacer" />
        <label className="ad-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, owner or domain" />
        </label>
        <button className="primary-btn sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New company
        </button>
      </div>
      {list.length === 0 && <Empty text={q ? 'No company matches.' : 'No companies yet. Create one, or wait for the first sign-up.'} />}
      <div className="ad-table">
        {list.length > 0 && (
          <div className="ad-tr head">
            <span>Company</span>
            <span>Plan</span>
            <span>People</span>
            <span>Monthly</span>
            <span>AI</span>
            <span>Last active</span>
          </div>
        )}
        {list.map((c) => (
          <button type="button" key={c.id} className="ad-tr" onClick={() => ctx.openCompany(c.id)}>
            <span className="ad-name">
              <i className="ad-dot" style={{ background: c.color }} />
              <span>
                <strong>{c.name}</strong>
                <small className="muted">{c.owner?.email ?? 'no owner'}</small>
              </span>
            </span>
            <span>
              {planLabel(c.plan)} <StateBadge state={c.state} />
            </span>
            <span>
              {c.people}
              {c.guests ? <small className="muted"> +{c.guests} guests</small> : null}
            </span>
            <span>{c.mrr ? rp(c.mrr) : c.after ? <small className="muted">{rp(c.after)} after</small> : <small className="muted">Rp 0</small>}</span>
            <span>{c.aiRp ? rp(c.aiRp) : <small className="muted">none</small>}</span>
            <span className="muted small">{c.lastActive ? relative(c.lastActive) : 'never'}</span>
          </button>
        ))}
      </div>
      {creating && (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            reload();
            ctx.openCompany(id);
          }}
          toast={ctx.toast}
        />
      )}
    </>
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

function Dialog({ title, onClose, children, foot, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className={`modal ad-modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={typeof title === 'string' ? title : 'Dialog'} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">{title}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>{children}</SmoothHeight>
        </div>
        {foot && <footer className="modal-foot">{foot}</footer>}
      </div>
    </div>
  );
}

function NewCompanyDialog({ onClose, onDone, toast }: { onClose: () => void; onDone: (id: string) => void; toast: (t: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [owner, setOwner] = useState('');
  const [tier, setTier] = useState('studio');
  const [track, setTrack] = useState('ai');
  const [trial, setTrial] = useState('14');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; link: string | null; existing: boolean } | null>(null);
  const create = async () => {
    setBusy(true);
    try {
      const r = await post<{ id: string; link: string | null; existing: boolean }>('company/create', { name, ownerEmail: email, ownerName: owner, tier, track, trialDays: Number(trial) });
      setResult(r);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
            <button className="primary-btn" disabled={busy || name.trim().length < 2 || !email.includes('@')} onClick={() => void create()}>
              Create
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="ad-result">
          <p>
            <strong>{name}</strong> is ready. {result.existing ? 'The owner already signs in; the company is in their switcher.' : 'Send the owner this link to pick a password (valid 7 days):'}
          </p>
          {result.link && (
            <div className="ad-linkbox">
              <code className="mono">{result.link}</code>
              <CopyBtn text={result.link} label="Copy link" />
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="ad-field">
            <span>Company name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nusa Studio" autoFocus />
          </label>
          <div className="ad-two">
            <label className="ad-field">
              <span>Owner’s email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.com" type="email" />
            </label>
            <label className="ad-field">
              <span>Owner’s name</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <div className="ad-three">
            <div className="ad-field">
              <span>Plan</span>
              <Select value={tier} options={TIERS} onChange={setTier} label="Plan" />
            </div>
            <div className="ad-field">
              <span>AI</span>
              <Select value={track} options={TRACKS} onChange={setTrack} label="AI" />
            </div>
            <div className="ad-field">
              <span>Trial</span>
              <Select
                value={trial}
                options={[
                  { value: '0', label: 'No trial, billed now' },
                  { value: '14', label: '14 days' },
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                ]}
                onChange={setTrial}
                label="Trial"
              />
            </div>
          </div>
          <small className="set-hint">The owner goes through onboarding on their first sign-in. Nothing is charged until payments are connected.</small>
        </>
      )}
    </Dialog>
  );
}

function ConfirmDialog({ title, text, word, danger, onClose, onConfirm }: { title: string; text: string; word: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? 'danger-btn' : 'primary-btn'}
            disabled={busy || (word ? typed !== word : false)}
            onClick={() => {
              setBusy(true);
              onConfirm(typed).finally(() => setBusy(false));
            }}
          >
            {title}
          </button>
        </>
      }
    >
      <p className="small">{text}</p>
      {word ? (
        <label className="ad-field">
          <span>
            Type <code className="mono">{word}</code> to confirm
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      ) : (
        <label className="ad-field">
          <span>Reason (people in the company see it)</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. Unpaid since September" autoFocus />
        </label>
      )}
    </Dialog>
  );
}

function AddPersonDialog({ companyId, onClose, onDone, toast }: { companyId: string; onClose: () => void; onDone: () => void; toast: (t: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<string | null | 'none'>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await post<{ link: string | null }>('company/person', { id: companyId, email, name, role });
      setLink(r.link ?? 'none');
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Add a person"
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
            <button className="primary-btn" disabled={busy || !email.includes('@')} onClick={() => void add()}>
              Add
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="ad-result">
          <p>{link === 'none' ? 'They already sign in; the company is in their switcher now.' : 'Send them this link to pick a password (valid 7 days):'}</p>
          {link !== 'none' && (
            <div className="ad-linkbox">
              <code className="mono">{link}</code>
              <CopyBtn text={link} label="Copy link" />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="ad-two">
            <label className="ad-field">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus />
            </label>
            <label className="ad-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <div className="ad-field">
            <span>Role</span>
            <Select
              value={role}
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin' },
                { value: 'owner', label: 'Owner' },
              ]}
              onChange={setRole}
              label="Role"
            />
          </div>
        </>
      )}
    </Dialog>
  );
}

function Panel({ title, kind, onClose, children }: { title: ReactNode; kind: string; onClose: () => void; children: ReactNode }) {
  useOnePanel(onClose);
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer ad-drawer" role="dialog" aria-label={kind}>
        <header className="drawer-head">
          <span className="drawer-kind">{kind}</span>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <h2 className="client-title">{title}</h2>
          {children}
        </div>
      </aside>
    </div>
  );
}

type Member = { id: string; name: string; email: string; title: string; color: string; role: string; lastSeen: string | null; hasLogin: boolean; suspended: unknown; deleted: boolean };

function CompanyPanel({ id, ctx, onClose }: { id: string; ctx: Ctx; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => get('company?id=' + encodeURIComponent(id)), [id]);
  const [confirm, setConfirm] = useState<'suspend' | 'delete' | 'reset' | null>(null);
  const [adding, setAdding] = useState(false);
  const [compUntil, setCompUntil] = useState('');
  const [compNote, setCompNote] = useState('');
  const [tab, setTab] = useState<'plan' | 'people' | 'money' | 'log'>('plan');
  if (error) return <Panel title="Company" kind="Company" onClose={onClose}><Empty text={error} /></Panel>;
  if (!data) return <Panel title="…" kind="Company" onClose={onClose}><Loading /></Panel>;
  const c = data.company as CompanyRow & { members: Member[]; accounts: { id: string; email: string; kind: string; users: number }[]; apps: string[] | null; emailSetup: string | null; whiteLabel: { name: string; domain: string | null } | null; usage: { job: string; provider: string; model: string; uses: number; rp: number }[]; invoices: { month: string; amount: number; state: string }[]; audit: { id: number; at: string; operator: string; action: string; detail: string | null }[] };
  const act = (p: Promise<unknown>, done: string) => p.then(() => (ctx.toast(done), reload())).catch((e: Error) => ctx.toast(e.message));
  const plan = (patch: Record<string, unknown>, done = 'Saved') => act(post('company/plan', { id, ...patch }), done);
  const owner = c.members.find((m) => m.role === 'owner');
  return (
    <Panel
      kind="Company"
      onClose={onClose}
      title={
        <span className="ad-panel-title">
          <i className="ad-dot" style={{ background: c.color }} /> {c.name} <StateBadge state={c.state} />
        </span>
      }
    >
      <p className="muted small">
        {planLabel(c.plan)} · {c.people} people{c.guests ? `, ${c.guests} guests` : ''} · {c.projects} projects · since {day(c.since) || 'unknown'}
        {c.lastActive ? ` · last active ${relative(c.lastActive)}` : ''}
      </p>
      {c.suspended && (
        <div className="ad-row warn">
          <AlertTriangle size={15} />
          <span className="grow">
            Suspended {relative(c.suspended.at)} by {c.suspended.by}: {c.suspended.reason || 'no reason'}
          </span>
          <button className="ghost-btn sm" onClick={() => void act(post('company/suspend', { id, on: false }), 'Suspension lifted')}>
            Lift
          </button>
        </div>
      )}
      <div className="segmented sm ad-tabs">
        {(['plan', 'people', 'money', 'log'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'plan' ? 'Plan' : t === 'people' ? 'People' : t === 'money' ? 'Money' : 'Log'}
          </button>
        ))}
      </div>
      <SmoothHeight>
        <TabPane key={tab}>
          {tab === 'plan' && (
            <div className="ad-stack">
              <div className="ad-three">
                <div className="ad-field">
                  <span>Plan</span>
                  <Select value={c.plan?.tier ?? 'free'} options={TIERS} onChange={(v) => void plan({ tier: v }, `Plan: ${v}`)} label="Plan" />
                </div>
                <div className="ad-field">
                  <span>AI</span>
                  <Select value={c.plan?.track ?? 'own'} options={TRACKS} onChange={(v) => void plan({ track: v })} label="AI" />
                </div>
                <div className="ad-field">
                  <span>Billing</span>
                  <Select
                    value={c.plan?.cycle ?? 'monthly'}
                    options={[
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'yearly', label: 'Yearly (10 months)' },
                    ]}
                    onChange={(v) => void plan({ cycle: v })}
                    label="Billing"
                  />
                </div>
              </div>
              <div className="ad-two">
                <div className="ad-field">
                  <span>Trial ends</span>
                  <DatePicker value={c.plan?.trialEnds ? c.plan.trialEnds.slice(0, 10) : ''} onChange={(v) => void plan({ trialEnds: v ? new Date(v + 'T23:59:59Z').toISOString() : null }, v ? 'Trial changed' : 'Trial ended')} clearable label="Trial ends" />
                </div>
                <label className="set-row toggle-row ad-toggle">
                  <span>
                    <strong>Paused</strong>
                    <small>No charge, read-only data</small>
                  </span>
                  <button type="button" role="switch" aria-checked={!!c.plan?.paused} className={`switch ${c.plan?.paused ? 'on' : ''}`} onClick={() => void plan({ paused: !c.plan?.paused }, c.plan?.paused ? 'Resumed' : 'Paused')}>
                    <span />
                  </button>
                </label>
              </div>
              <div className="set-block ad-block">
                <strong>Free months</strong>
                {c.plan?.comp ? (
                  <p className="small">
                    Free until {day(c.plan.comp.until)}
                    {c.plan.comp.note ? ` · ${c.plan.comp.note}` : ''}{' '}
                    <button type="button" className="link-btn small" onClick={() => void plan({ comp: null }, 'Free months removed')}>
                      Remove
                    </button>
                  </p>
                ) : (
                  <div className="ad-two">
                    <div className="ad-field">
                      <span>Until</span>
                      <DatePicker value={compUntil} onChange={setCompUntil} clearable label="Free until" />
                    </div>
                    <label className="ad-field">
                      <span>Why</span>
                      <input value={compNote} onChange={(e) => setCompNote(e.target.value)} placeholder="e.g. Launch partner" />
                    </label>
                    <button className="ghost-btn sm" disabled={!compUntil} onClick={() => void plan({ comp: { until: new Date(compUntil + 'T23:59:59Z').toISOString(), note: compNote } }, 'Free months given').then(() => (setCompUntil(''), setCompNote('')))}>
                      Give
                    </button>
                  </div>
                )}
              </div>
              <div className="set-block ad-block">
                <strong>Add-ons</strong>
                <div className="ad-addons">
                  {(
                    [
                      ['mailboxes', 'Hosted mailboxes'],
                      ['storage50', 'Extra 50 GB'],
                      ['meetHours10', 'Bot hours ×10'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="ad-field">
                      <span>{label}</span>
                      <input type="number" min={0} value={c.plan?.addons?.[k] ?? 0} onChange={(e) => void plan({ addons: { [k]: Math.max(0, Number(e.target.value) || 0) } }, 'Add-ons saved')} />
                    </label>
                  ))}
                  <label className="set-row toggle-row ad-toggle">
                    <span>
                      <strong>Branding add-on</strong>
                    </span>
                    <button type="button" role="switch" aria-checked={!!c.plan?.addons?.branding} className={`switch ${c.plan?.addons?.branding ? 'on' : ''}`} onClick={() => void plan({ addons: { branding: !c.plan?.addons?.branding } }, 'Add-ons saved')}>
                      <span />
                    </button>
                  </label>
                </div>
              </div>
              <div className="set-block ad-block">
                <strong>Set-up</strong>
                <p className="small muted">
                  Apps: {c.apps ? c.apps.join(', ') : 'all'} · Email: {c.emailSetup ?? 'not chosen'} · Mailboxes: {c.accounts.length}
                  {c.whiteLabel ? ` · Brand: ${c.whiteLabel.name}${c.whiteLabel.domain ? ` at ${c.whiteLabel.domain}` : ''}` : ''}
                  {c.domains.length ? ` · Domains: ${c.domains.join(', ')}` : ''}
                </p>
              </div>
              <div className="ad-danger">
                {!c.suspended && (
                  <button className="ghost-btn sm" onClick={() => setConfirm('suspend')}>
                    Suspend
                  </button>
                )}
                {ctx.superadmin && (
                  <button className="ghost-btn sm" onClick={() => setConfirm('reset')}>
                    Reset data
                  </button>
                )}
                <button className="danger-btn sm" onClick={() => setConfirm('delete')}>
                  Delete company
                </button>
              </div>
            </div>
          )}
          {tab === 'people' && (
            <div className="ad-stack">
              <div className="ad-list">
                {c.members.map((m) => (
                  <div key={m.id} className="ad-row">
                    <Avatar person={{ name: m.name, email: m.email, color: m.color }} size={28} />
                    <button type="button" className="ad-link grow" onClick={() => ctx.openPerson(m.id)}>
                      <strong>{m.name}</strong> <span className="muted">{m.email}</span>
                      <small className="muted">
                        {m.role}
                        {m.deleted ? ' · deleted' : m.suspended ? ' · suspended' : !m.hasLogin ? ' · never signed in' : m.lastSeen ? ` · seen ${relative(m.lastSeen)}` : ''}
                      </small>
                    </button>
                    {!m.deleted && (
                      <button className="icon-btn sm" title="Sign in as" aria-label={`Sign in as ${m.name}`} onClick={() => ctx.signInAs(m.id)}>
                        <LogIn size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <button className="ghost-btn sm" onClick={() => setAdding(true)}>
                  <Plus size={13} /> Add a person
                </button>
                {!owner && <small className="muted"> No owner: make someone owner from their page.</small>}
              </div>
            </div>
          )}
          {tab === 'money' && (
            <div className="ad-stack">
              <Kpis items={[{ label: 'Monthly', value: c.mrr ? rp(c.mrr) : c.after ? rp(c.after) : 'Rp 0', hint: STATE_LABEL[c.state] }, { label: 'AI this month', value: rp(c.aiRp), hint: c.plan?.track === 'ai' ? 'on us' : 'their keys' }, { label: 'Storage', value: bytes(c.storageBytes) }]} />
              {c.usage.length > 0 && (
                <div className="ad-list">
                  {c.usage.map((u) => (
                    <div key={`${u.job}-${u.provider}-${u.model}`} className="ad-row">
                      <span className="grow">
                        {u.job} <span className="muted">{u.provider} · {u.model}</span>
                      </span>
                      <span className="muted small">{u.uses}×</span>
                      <span>{rp(u.rp)}</span>
                    </div>
                  ))}
                </div>
              )}
              <h4 className="ad-h4">Booked invoices</h4>
              {c.invoices.length === 0 && <Empty text="Nothing to bill on this plan." />}
              <div className="ad-list">
                {c.invoices.map((inv) => (
                  <div key={inv.month} className="ad-row">
                    <span className="grow">{new Date(inv.month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                    <span className="muted small">{inv.state}</span>
                    <span>{rp(inv.amount)}</span>
                  </div>
                ))}
              </div>
              <small className="muted">Booked, not collected: payments aren’t connected yet.</small>
            </div>
          )}
          {tab === 'log' && (
            <div className="ad-list">
              {c.audit.length === 0 && <Empty text="No operator actions on this company yet." />}
              {c.audit.map((a) => (
                <div key={a.id} className="ad-row">
                  <span className="grow">
                    <strong>{a.action}</strong> <span className="muted">{a.detail}</span>
                  </span>
                  <small className="muted">
                    {a.operator} · {relative(a.at)}
                  </small>
                </div>
              ))}
            </div>
          )}
        </TabPane>
      </SmoothHeight>
      {confirm === 'suspend' && <ConfirmDialog title="Suspend" word="" text={`Everyone at ${c.name} keeps read access and sees the reason; nothing can be changed until it's lifted.`} onClose={() => setConfirm(null)} onConfirm={(reason) => act(post('company/suspend', { id, reason }), 'Suspended').then(() => setConfirm(null))} />}
      {confirm === 'delete' && <ConfirmDialog title="Delete company" danger word={c.name} text="Removes the company and everything in it: tasks, chat, files, tables, meetings. People keep their accounts. This can't be undone (the daily backup is the only way back)." onClose={() => setConfirm(null)} onConfirm={() => act(post('company/delete', { id, confirm: c.name }), 'Company deleted').then(() => (setConfirm(null), onClose()))} />}
      {confirm === 'reset' && <ConfirmDialog title="Reset data" danger word="RESET" text="Empties the company (tasks, chat, files, tables, meetings, projects) but keeps the company, its plan and its people. Superadmin only." onClose={() => setConfirm(null)} onConfirm={() => act(post('company/reset', { id, confirm: 'RESET' }), 'Company data reset').then(() => setConfirm(null))} />}
      {adding && <AddPersonDialog companyId={id} onClose={() => setAdding(false)} onDone={reload} toast={ctx.toast} />}
    </Panel>
  );
}

/* ---------- People ---------- */

function People({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 200);
    return () => clearTimeout(t);
  }, [typed]);
  const { data, error } = useLoad(() => get<{ people: PersonRow[]; total: number }>('people?q=' + encodeURIComponent(q)), [q]);
  if (error) return <Empty text={error} />;
  return (
    <>
      <div className="ad-title-row">
        <h2>People</h2>
        {data && <span className="muted small">{data.total}</span>}
        <span className="spacer" />
        <label className="ad-search">
          <Search size={14} />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Name, email or company" autoFocus />
        </label>
      </div>
      {!data && <Loading />}
      {data && data.people.length === 0 && <Empty text={q ? 'Nobody matches.' : 'Nobody yet.'} />}
      {data && (
        <div className="ad-table people">
          {data.people.length > 0 && (
            <div className="ad-tr head">
              <span>Person</span>
              <span>Companies</span>
              <span>Last seen</span>
            </div>
          )}
          {data.people.map((u) => (
            <button type="button" key={u.id} className="ad-tr" onClick={() => ctx.openPerson(u.id)}>
              <span className="ad-name">
                <Avatar person={{ name: u.name, email: u.email, color: u.color }} size={28} />
                <span>
                  <strong>
                    {u.name}
                    {u.operator && <span className="ad-badge paying"> operator</span>}
                    {u.suspended && <span className="ad-badge suspended"> suspended</span>}
                  </strong>
                  <small className="muted">{u.email}</small>
                </span>
              </span>
              <span className="small">
                {u.companies.map((c) => `${c.name} (${c.role})`).join(', ') || (Array.isArray(u.guestOf) && u.guestOf.length ? `Guest of ${u.guestOf.join(', ')}` : typeof u.guestOf === 'string' ? `Guest of ${u.guestOf}` : <span className="muted">none</span>)}
              </span>
              <span className="muted small">{!u.hasLogin ? 'never signed in' : u.lastSeen ? relative(u.lastSeen) : 'not yet'}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PersonPanel({ id, ctx, onClose }: { id: string; ctx: Ctx; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => get<{ people: PersonRow[] }>('people').then((r) => r.people.find((p) => p.id === id) ?? null), [id]);
  const [code, setCode] = useState<{ code: string; until: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  if (error) return <Panel title="Person" kind="Person" onClose={onClose}><Empty text={error} /></Panel>;
  if (data === null) return <Panel title="…" kind="Person" onClose={onClose}><Loading /></Panel>;
  const u = data;
  if (!u) return <Panel title="Person" kind="Person" onClose={onClose}><Empty text="This person no longer exists." /></Panel>;
  const act = (p: Promise<unknown>, done: string) => p.then(() => (ctx.toast(done), reload())).catch((e: Error) => ctx.toast(e.message));
  return (
    <Panel
      kind="Person"
      onClose={onClose}
      title={
        <span className="ad-panel-title">
          <Avatar person={{ name: u.name, email: u.email, color: u.color }} size={32} /> {u.name}
        </span>
      }
    >
      <p className="muted small">
        {u.email}
        {u.title ? ` · ${u.title}` : ''} · {!u.hasLogin ? 'never signed in' : u.lastSeen ? `last seen ${relative(u.lastSeen)}` : 'has a sign-in'}
        {u.operator ? ' · operator' : ''}
      </p>
      {u.suspended && (
        <div className="ad-row warn">
          <AlertTriangle size={15} />
          <span className="grow">
            Suspended {relative(u.suspended.at)} by {u.suspended.by}: {u.suspended.reason || 'no reason'}
          </span>
          <button className="ghost-btn sm" onClick={() => void act(post('person/suspend', { userId: id, on: false }), 'Suspension lifted')}>
            Lift
          </button>
        </div>
      )}
      <h4 className="ad-h4">Companies</h4>
      {u.companies.length === 0 && <Empty text={u.guestOf ? `Only a guest (${Array.isArray(u.guestOf) ? u.guestOf.join(', ') : u.guestOf}).` : 'In no company.'} />}
      <div className="ad-list">
        {u.companies.map((c) => (
          <div key={c.id} className="ad-row">
            <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(c.id)}>
              <strong>{c.name}</strong> <span className="muted">{c.role}</span>
            </button>
            {c.role !== 'owner' && (
              <button className="ghost-btn sm" onClick={() => void act(post('person/owner', { id: c.id, userId: id, role: 'owner' }), `Owner of ${c.name}`)}>
                Make owner
              </button>
            )}
          </div>
        ))}
      </div>
      <h4 className="ad-h4">Help them in</h4>
      <div className="ad-actions">
        {!u.suspended && (
          <button className="primary-btn sm" onClick={() => ctx.signInAs(id)}>
            <LogIn size={14} /> Sign in as {u.name.split(' ')[0]}
          </button>
        )}
        {u.hasLogin ? (
          <button className="ghost-btn sm" onClick={() => void post<{ code: string; until: string }>('person/reset-code', { userId: id }).then(setCode).catch((e: Error) => ctx.toast(e.message))}>
            <KeyRound size={14} /> Reset code
          </button>
        ) : (
          <button className="ghost-btn sm" onClick={() => void post<{ link: string }>('person/invite', { userId: id }).then((r) => setLink(r.link)).catch((e: Error) => ctx.toast(e.message))}>
            <KeyRound size={14} /> Invite link
          </button>
        )}
        {!u.suspended && !u.operator && (
          <button className="ghost-btn sm" onClick={() => setSuspending(true)}>
            Suspend
          </button>
        )}
      </div>
      <SmoothHeight>
        {code && (
          <div className="ad-result">
            <p className="small">Tell them this code; they enter it with a new password at “Forgot your password?”. Good for 15 minutes.</p>
            <div className="ad-linkbox">
              <span className="ad-code mono big">{code.code}</span>
              <CopyBtn text={code.code} />
            </div>
          </div>
        )}
        {link && (
          <div className="ad-result">
            <p className="small">Send them this link to pick a password (valid 7 days):</p>
            <div className="ad-linkbox">
              <code className="mono">{link}</code>
              <CopyBtn text={link} label="Copy link" />
            </div>
          </div>
        )}
      </SmoothHeight>
      {suspending && <ConfirmDialog title="Suspend" word="" text={`${u.name} can't sign in until it's lifted. Their work stays.`} onClose={() => setSuspending(false)} onConfirm={(reason) => act(post('person/suspend', { userId: id, reason }), 'Suspended').then(() => setSuspending(false))} />}
    </Panel>
  );
}

/* ---------- Revenue ---------- */

function Revenue({ ctx }: { ctx: Ctx }) {
  const { data, error } = useLoad(() => get('revenue'));
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const series = data.series as { month: string; newCompanies: number; churned: number }[];
  const max = Math.max(1, ...series.flatMap((s) => [s.newCompanies, s.churned]));
  const tiers = Object.entries(data.byTier as Record<string, { companies: number; mrr: number }>).sort((a, b) => b[1].mrr - a[1].mrr);
  return (
    <>
      <div className="ad-title-row">
        <h2>Revenue</h2>
        <span className="muted small">booked from plans; collected once payments are connected</span>
      </div>
      <Kpis
        items={[
          { label: 'MRR', value: rp(data.mrr), hint: `${rp(data.arr)} a year` },
          { label: 'Paying companies', value: data.paying },
          { label: 'On trial', value: data.trials.count, hint: `${rp(data.trials.after)}/month when they convert` },
          { label: 'Add-ons', value: rp(data.addons), hint: `${data.comped} comped · ${data.paused} paused` },
        ]}
      />
      <h3 className="ad-h3">By plan</h3>
      {tiers.length === 0 && <Empty text="No companies yet." />}
      <div className="ad-list">
        {tiers.map(([name, t]) => (
          <div key={name} className="ad-row">
            <span className="grow">{name[0].toUpperCase() + name.slice(1)}</span>
            <span className="muted small">{t.companies} companies</span>
            <span>{rp(t.mrr)}</span>
          </div>
        ))}
      </div>
      <h3 className="ad-h3">New and lost, last 6 months</h3>
      <div className="ad-months">
        {series.map((s) => (
          <div key={s.month} className="ad-month">
            <div className="ad-month-bars">
              <span className="new" style={{ height: `${(s.newCompanies / max) * 100}%` }} title={`${s.newCompanies} new`} />
              <span className="lost" style={{ height: `${(s.churned / max) * 100}%` }} title={`${s.churned} lost`} />
            </div>
            <small className="muted">{new Date(s.month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short' })}</small>
            <small>
              +{s.newCompanies}
              {s.churned ? ` −${s.churned}` : ''}
            </small>
          </div>
        ))}
      </div>
      <h3 className="ad-h3">Who pays what</h3>
      {data.companies.length === 0 && <Empty text="Nobody is on a paid plan yet." />}
      <div className="ad-list">
        {(data.companies as CompanyRow[]).map((c) => (
          <div key={c.id} className="ad-row">
            <button type="button" className="ad-link grow" onClick={() => ctx.openCompany(c.id)}>
              <strong>{c.name}</strong> <span className="muted">{planLabel(c.plan)} · {c.people} people</span>
            </button>
            <StateBadge state={c.state} />
            <span>{c.mrr ? rp(c.mrr) : <small className="muted">{rp(c.after ?? 0)} later</small>}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- Usage & costs ---------- */

function Usage({ ctx }: { ctx: Ctx }) {
  const { data, error } = useLoad(() => get('usage'));
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const rows = data.companies as { id: string; name: string; state: State; mrr: number; aiRp: number; aiIncludedUses: number; included: boolean; storageBytes: number; recorderMinutes: number; people: number; margin: number; mailOut: number; mailIn: number; boosted: number }[];
  const losing = rows.filter((r) => r.included && r.margin < 0);
  return (
    <>
      <div className="ad-title-row">
        <h2>Usage & costs</h2>
        <span className="muted small">{new Date(data.month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
      </div>
      <Kpis
        items={[
          { label: 'AI spend', value: rp(data.totals.aiRp), hint: 'list prices, all companies' },
          { label: 'Storage', value: bytes(data.totals.storageBytes) },
          { label: 'Recorder', value: `${Math.round(data.totals.recorderMinutes)} min` },
          { label: 'Email', value: `${data.totals.mailOut} out · ${data.totals.mailIn} in`, hint: data.totals.boosted ? `${data.totals.boosted} boosted` : 'none boosted' },
          { label: 'Costing more than they pay', value: losing.length, warn: losing.length > 0, hint: 'AI-included plans' },
        ]}
      />
      {rows.length === 0 && <Empty text="No usage yet this month." />}
      <div className="ad-table usage">
        {rows.length > 0 && (
          <div className="ad-tr head">
            <span>Company</span>
            <span>Pays</span>
            <span>AI cost</span>
            <span>Margin</span>
            <span>Storage</span>
            <span>Email</span>
          </div>
        )}
        {rows.map((r) => (
          <button type="button" key={r.id} className="ad-tr" onClick={() => ctx.openCompany(r.id)}>
            <span className="ad-name">
              <span>
                <strong>{r.name}</strong>
                <small className="muted">{r.people} people · {STATE_LABEL[r.state]}</small>
              </span>
            </span>
            <span>{rp(r.mrr)}</span>
            <span>
              {rp(r.aiRp)} <small className="muted">{r.included ? 'on us' : 'their keys'}</small>
            </span>
            <span className={r.included && r.margin < 0 ? 'ad-neg' : ''}>{r.included ? rp(r.margin) : <small className="muted">n/a</small>}</span>
            <span>{bytes(r.storageBytes)}</span>
            <span>
              {r.mailOut} out · {r.mailIn} in{r.boosted ? <small className="muted"> · {r.boosted} boosted</small> : null}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- System ---------- */

function System({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useLoad(() => get('system'));
  const [busy, setBusy] = useState(false);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const up = data.uptimeSeconds;
  const uptime = up > 86400 ? `${Math.floor(up / 86400)} d ${Math.floor((up % 86400) / 3600)} h` : up > 3600 ? `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min` : `${Math.floor(up / 60)} min`;
  const rows: { label: string; value: ReactNode; ok?: boolean }[] = [
    { label: 'Version', value: `${data.version}${data.commit ? ` · ${String(data.commit).slice(0, 7)}` : ''}${data.built ? ` · built ${relative(data.built)}` : ''}` },
    { label: 'Running', value: `${uptime} · Node ${data.node} · ${data.production ? 'production' : 'development'}` },
    { label: 'Address', value: data.publicUrl, ok: data.https },
    { label: 'Email', value: data.mailOn ? 'On (SES)' : 'Off: codes go to the log and the Today screen', ok: data.mailOn },
    { label: 'Meeting recorder', value: !data.recorder.configured ? 'Not set up' : data.recorder.reachable ? `Reachable · ${data.recorder.bots ?? 0} bots busy` : 'Configured but not answering', ok: data.recorder.configured && data.recorder.reachable },
    { label: 'Disk', value: data.disk ? `${bytes(data.disk.free)} free of ${bytes(data.disk.total)}` : 'unknown', ok: !data.disk || data.disk.free / data.disk.total > 0.1 },
    { label: 'Database', value: bytes(data.dbBytes) },
    { label: 'Last backup', value: data.lastBackupAt ? relative(data.lastBackupAt) : 'none yet', ok: !!data.lastBackupAt && data.lastBackupAt > new Date(Date.now() - 36 * 3600_000).toISOString() },
    { label: 'Live connections', value: `${data.liveConnections} open · ${data.sessions} sessions` },
    { label: 'Operators', value: (data.operators as string[]).join(', ') || 'none set' },
  ];
  return (
    <>
      <div className="ad-title-row">
        <h2>System</h2>
        <button className="icon-btn sm" onClick={reload} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="ad-list">
        {rows.map((r) => (
          <div key={r.label} className={`ad-row ${r.ok === false ? 'warn' : ''}`}>
            <span className="ad-label">{r.label}</span>
            <span className="grow small">{r.value}</span>
            {r.ok !== undefined && <span className={`ad-ok ${r.ok ? 'yes' : 'no'}`}>{r.ok ? <Check size={13} /> : <AlertTriangle size={13} />}</span>}
          </div>
        ))}
      </div>
      <h3 className="ad-h3">Environment</h3>
      <div className="ad-flags">
        {(data.flags as { key: string; set: boolean }[]).map((f) => (
          <span key={f.key} className={`ad-flag ${f.set ? 'on' : ''}`}>
            {f.key}
          </span>
        ))}
      </div>
      <div className="ad-title-row">
        <h3 className="ad-h3">Backups</h3>
        <span className="spacer" />
        <button
          className="ghost-btn sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            post('backup/now')
              .then(() => (ctx.toast('Backup made'), reload()))
              .catch((e: Error) => ctx.toast(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <Download size={13} /> Back up now
        </button>
      </div>
      {data.backups.length === 0 && <Empty text="No backups yet. One is made every day." />}
      <div className="ad-list">
        {(data.backups as { file: string; bytes: number; at: string }[]).map((b) => (
          <div key={b.file} className="ad-row">
            <span className="grow mono small">{b.file}</span>
            <span className="muted small">{bytes(b.bytes)}</span>
            <a className="ghost-btn sm" href={`/api/admin/backup?file=${encodeURIComponent(b.file)}`}>
              <Download size={13} /> Download
            </a>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- Audit ---------- */

function Audit({ ctx }: { ctx: Ctx }) {
  const { data, error } = useLoad(() => Promise.all([get('audit?limit=300'), get<{ companies: CompanyRow[] }>('companies'), get<{ people: PersonRow[] }>('people')]));
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const [audit, companies, people] = data;
  const nameOf = (target: string | null) => (target ? companies.companies.find((c) => c.id === target)?.name ?? people.people.find((p) => p.id === target)?.name ?? null : null);
  const entries = audit.entries as { id: number; at: string; operator: string; action: string; target: string | null; detail: string | null }[];
  return (
    <>
      <div className="ad-title-row">
        <h2>Audit log</h2>
        <span className="muted small">every operator action</span>
      </div>
      {entries.length === 0 && <Empty text="Nothing yet." />}
      <div className="ad-list">
        {entries.map((a) => {
          const name = nameOf(a.target);
          const isCompany = a.target && companies.companies.some((c) => c.id === a.target);
          return (
            <div key={a.id} className="ad-row">
              <span className="grow">
                <strong>{a.action}</strong>{' '}
                {name && (
                  <button type="button" className="ad-link" onClick={() => (isCompany ? ctx.openCompany(a.target!) : ctx.openPerson(a.target!))}>
                    {name}
                  </button>
                )}{' '}
                <span className="muted">{a.detail}</span>
              </span>
              <small className="muted">
                {a.operator} · {relative(a.at)}
              </small>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A small hint used by the app: the operator's way back after "sign in as". */
export function ActingBanner({ operator }: { operator: string }) {
  return (
    <div className="op-banner" role="status">
      <span>
        <Eye size={14} /> Signed in as this person by <strong>{operator}</strong>. What you do here is theirs.
      </span>
      <button
        className="ghost-btn sm"
        onClick={() => void fetch('/api/admin/signin-as/stop', { method: 'POST' }).then(() => location.assign('/admin'))}
      >
        Back to the backend
      </button>
    </div>
  );
}

