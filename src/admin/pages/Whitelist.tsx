import { useEffect, useRef, useState } from 'react';
import { Check, HardDrive, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { bytes, day, get, post, rp } from '../api';
import { Badge, Confirm, Dialog, Failed, Field, Loading, MoneyInput, Page, Section, Table, useAct, useAdmin, useApi, Who } from '../ui';
import { t, tn } from '../../i18n';
import { fmtNumber, fmtPercent } from '../../i18n/format';

type Unit = 'usd' | 'rp';
interface Row {
  workspaceId: string;
  name: string;
  color: string | null;
  owner: { name: string; email: string } | null;
  people: number;
  note: string;
  aiUnit: Unit;
  aiLimit: number;
  aiUsed: number;
  sesLimit: number;
  sesUsed: number;
  prevPlan: { tier: string; track: string } | null;
  addedBy: string;
  addedAt: string;
  updatedAt: string | null;
  resets: string;
}
interface Data {
  rows: Row[];
  disk: { total: number; free: number; reserve: number; room: number };
  rate: number;
  can: boolean;
}
interface Found {
  id: string;
  name: string;
  color: string | null;
  domains: string[];
  owner: { name: string; email: string } | null;
  people: number;
  plan: string | null;
}

/** "US$25" or "Rp 400.000". */
const money = (n: number, unit: Unit) => (unit === 'rp' ? rp(n) : `US$${fmtNumber(n, { maximumFractionDigits: 2 })}`);
/** "Small AI" from a saved plan's parts (plan names stay as they are). */
const planName = (p: { tier: string; track: string } | null) => (!p || p.tier === 'free' ? t('Free') : `${p.tier[0].toUpperCase()}${p.tier.slice(1)}${p.track === 'ai' ? ' AI' : ''}`);

/** Used of a monthly limit: a thin bar, warning at 80%, full at 100%. */
function Meter({ share, text, label }: { share: number; text: string; label: string }) {
  const tone = share >= 1 ? 'bad' : share >= 0.8 ? 'warn' : '';
  return (
    <span className={`adm-use ${tone}`}>
      <span className="adm-use-text">{text}</span>
      <span className="adm-use-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)}>
        <span style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
    </span>
  );
}

/** The operator console's Whitelist: companies with every feature, no plan limits and no bills ("Unlimited" in the app). */
export function Whitelist() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<Data>('whitelist');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const title = t('Whitelist');
  if (error) return <Page title={title}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={title}><Loading rows={5} /></Page>;
  const full = data.rows.filter((r) => (r.aiLimit > 0 && r.aiUsed >= r.aiLimit) || (r.sesLimit > 0 && r.sesUsed >= r.sesLimit));
  return (
    <Page
      title={title}
      sub={t('Companies here get every feature with no plan limits and are never billed. They see “Unlimited” in the app. Two monthly limits cover what costs us money: AI on our keys and Boosted sending.')}
      actions={
        data.can && (
          <button className="primary-btn sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('Add a company')}
          </button>
        )
      }
    >
      {full.length > 0 && (
        <div className="adm-banner warn">
          <span>{full.length === 1 ? t('{company} used up a monthly limit: that part is paused until the 1st. Raise it if it should go on.', { company: full[0].name }) : t('{n} companies used up a monthly limit: those parts are paused until the 1st. Raise them if they should go on.', { n: full.length })}</span>
        </div>
      )}
      <Section title={t('Companies')} hint={t('Limits start again on the 1st')}>
        <Table
          id="whitelist"
          rows={data.rows}
          rowKey={(r) => r.workspaceId}
          onOpen={(r) => (data.can ? setEditing(r) : go(`/admin/companies/${r.workspaceId}`))}
          search={(r) => `${r.name} ${r.owner?.email ?? ''} ${r.note}`}
          empty={{ title: t('No company is on the Whitelist'), text: t('Add one to give it every feature with no plan limits and no bills, for an investor, a partner or a friend.') }}
          cols={[
            {
              key: 'company',
              label: t('Company'),
              width: 'minmax(0, 2fr)',
              sort: (r) => r.name.toLowerCase(),
              render: (r) => <Who name={r.name} email={r.owner?.email} color={r.color} sub={r.note || null} />,
            },
            {
              key: 'ai',
              label: t('AI this month'),
              width: 'minmax(140px, 1fr)',
              sort: (r) => (r.aiLimit ? r.aiUsed / r.aiLimit : 1),
              render: (r) => <Meter share={r.aiLimit ? r.aiUsed / r.aiLimit : 1} text={t('{used} of {limit}', { used: money(r.aiUsed, r.aiUnit), limit: money(r.aiLimit, r.aiUnit) })} label={t('AI this month')} />,
            },
            {
              key: 'ses',
              label: t('Boosted this month'),
              width: 'minmax(140px, 1fr)',
              hide: 'phone',
              sort: (r) => (r.sesLimit ? r.sesUsed / r.sesLimit : 1),
              render: (r) => <Meter share={r.sesLimit ? r.sesUsed / r.sesLimit : 1} text={t('{used} of {limit} emails', { used: fmtNumber(r.sesUsed), limit: fmtNumber(r.sesLimit) })} label={t('Boosted this month')} />,
            },
            { key: 'since', label: t('Since'), width: '90px', hide: 'tablet', sort: (r) => r.addedAt, render: (r) => <span className="muted">{day(r.addedAt)}</span> },
            {
              key: 'act',
              label: '',
              width: '44px',
              align: 'right',
              render: (r) =>
                data.can && (
                  <span className="adm-row-actions">
                    <button className="icon-btn sm" title={t('Change limits')} aria-label={t('Change limits for {company}', { company: r.name })} onClick={(e) => (e.stopPropagation(), setEditing(r))}>
                      <Pencil size={14} />
                    </button>
                  </span>
                ),
            },
          ]}
        />
      </Section>
      <Section title={t('Drive storage')} hint={t('Shared by every Unlimited company')}>
        <div className="adm-wl-disk">
          <HardDrive size={16} />
          <span>
            {data.disk.room > 0
              ? t('{room} left for uploads. The server keeps {reserve} free whatever happens (10% of its disk or 20 GB, whichever is larger); uploads stop with a plain message before that.', { room: bytes(data.disk.room), reserve: bytes(data.disk.reserve) })
              : t('Uploads to Unlimited companies are stopped: only the safety reserve ({reserve}) is left. Free some space or add disk.', { reserve: bytes(data.disk.reserve) })}
          </span>
        </div>
      </Section>
      {adding && <AddCompany rate={data.rate} onClose={() => setAdding(false)} onDone={reload} />}
      {editing && <EditCompany row={editing} rate={data.rate} onClose={() => setEditing(null)} onDone={reload} />}
    </Page>
  );
}

/** The two monthly limits and the note, as one form (adding and changing). */
function Limits({ v, set, rate }: { v: { note: string; aiUnit: Unit; aiLimit: number; sesLimit: number }; set: (p: Partial<{ note: string; aiUnit: Unit; aiLimit: number; sesLimit: number }>) => void; rate: number }) {
  const [usdText, setUsdText] = useState(v.aiUnit === 'usd' ? String(v.aiLimit || '') : '');
  return (
    <>
      <Field label={t('Note')} hint={t('Only operators see it.')}>
        <input value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('Seed investor')} maxLength={200} />
      </Field>
      <Field label={t('AI on our keys, a month')} hint={v.aiUnit === 'usd' ? t('About {amount} at our rate. Priced like the AI plan.', { amount: rp(v.aiLimit * rate) }) : t('About {amount} at our rate. Priced like the AI plan.', { amount: `US$${fmtNumber(v.aiLimit / rate, { maximumFractionDigits: 2 })}` })}>
        <span className="adm-wl-amount">
          <span className="segmented sm" role="tablist" aria-label={t('Currency')}>
            <button type="button" role="tab" aria-selected={v.aiUnit === 'usd'} className={v.aiUnit === 'usd' ? 'on' : ''} onClick={() => v.aiUnit !== 'usd' && (set({ aiUnit: 'usd', aiLimit: Math.round((v.aiLimit / rate) * 100) / 100 }), setUsdText(String(Math.round((v.aiLimit / rate) * 100) / 100 || '')))}>
              US$
            </button>
            <button type="button" role="tab" aria-selected={v.aiUnit === 'rp'} className={v.aiUnit === 'rp' ? 'on' : ''} onClick={() => v.aiUnit !== 'rp' && set({ aiUnit: 'rp', aiLimit: Math.round(v.aiLimit * rate) })}>
              Rp
            </button>
          </span>
          {v.aiUnit === 'rp' ? (
            <MoneyInput value={v.aiLimit} onChange={(n) => set({ aiLimit: n })} label={t('AI on our keys, a month')} />
          ) : (
            <input
              inputMode="decimal"
              value={usdText}
              aria-label={t('AI on our keys, a month')}
              onChange={(e) => {
                const s = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
                setUsdText(s);
                set({ aiLimit: Number(s) || 0 });
              }}
            />
          )}
        </span>
      </Field>
      <Field label={t('Boosted sending, emails a month')} hint={t('Sent through Amazon SES. Past it, mail goes out from our own server until the 1st.')}>
        <input inputMode="numeric" value={v.sesLimit ? v.sesLimit.toLocaleString('id-ID') : '0'} onChange={(e) => set({ sesLimit: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
      </Field>
    </>
  );
}

function AddCompany({ rate, onClose, onDone }: { rate: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useAdmin();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Found | null>(null);
  const [v, setV] = useState({ note: '', aiUnit: 'usd' as Unit, aiLimit: 25, sesLimit: 5000 });
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Search as they type (name, domain or the owner's email), a moment after the last key.
  useEffect(() => {
    if (q.trim().length < 2) return setFound(null);
    const id = setTimeout(() => void get<{ results: Found[] }>(`whitelist/find?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.results), () => setFound([])), 200);
    return () => clearTimeout(id);
  }, [q]);
  const ok = !!pick && v.aiLimit >= 0 && v.sesLimit >= 0;
  return (
    <Dialog
      title={t('Add a company to the Whitelist')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="primary-btn"
            disabled={busy || !ok}
            onClick={() => {
              setBusy(true);
              post('whitelist/add', { workspaceId: pick!.id, ...v })
                .then(() => (toast(t('{company} is on Unlimited now', { company: pick!.name })), onDone(), onClose()))
                .catch((e: Error) => toast(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t('Add to the Whitelist')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        {pick ? (
          <div className="adm-wl-picked">
            <Who name={pick.name} email={pick.owner?.email} color={pick.color} sub={t('Now on {plan}. Its plan comes back if it’s taken off.', { plan: pick.plan ?? t('Free') })} />
            <button type="button" className="ghost-btn sm" onClick={() => (setPick(null), setTimeout(() => input.current?.focus(), 0))}>
              {t('Change')}
            </button>
          </div>
        ) : (
          <Field label={t('Company')}>
            <span className="adm-wl-search">
              <Search size={14} />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name, domain or owner’s email')} autoFocus />
            </span>
            {found && (
              <div className="adm-wl-results" role="listbox" aria-label={t('Companies')}>
                {found.map((c) => (
                  <button key={c.id} type="button" role="option" aria-selected={false} onClick={() => setPick(c)}>
                    <Who name={c.name} email={c.owner?.email} color={c.color} sub={[c.plan ?? t('Free'), tn(c.people, '{n} person', '{n} people'), c.domains[0]].filter(Boolean).join(' · ')} />
                    <Check size={14} className="adm-wl-go" />
                  </button>
                ))}
                {found.length === 0 && <small className="muted">{t('No company matches, or it’s already on the Whitelist.')}</small>}
              </div>
            )}
          </Field>
        )}
        {pick && <Limits v={v} set={(p) => setV((x) => ({ ...x, ...p }))} rate={rate} />}
      </div>
    </Dialog>
  );
}

function EditCompany({ row, rate, onClose, onDone }: { row: Row; rate: number; onClose: () => void; onDone: () => void }) {
  const { toast, go } = useAdmin();
  const act = useAct();
  const [v, setV] = useState({ note: row.note, aiUnit: row.aiUnit, aiLimit: row.aiLimit, sesLimit: row.sesLimit });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const changed = v.note !== row.note || v.aiUnit !== row.aiUnit || v.aiLimit !== row.aiLimit || v.sesLimit !== row.sesLimit;
  if (removing)
    return (
      <Confirm
        title={t('Take {company} off the Whitelist', { company: row.name })}
        text={t('It goes back to {plan}, the plan it had before, and is billed again from today. People’s rules are removed.', { plan: planName(row.prevPlan) })}
        action={t('Take off')}
        danger
        onClose={() => setRemoving(false)}
        onConfirm={() => act(() => post('whitelist/remove', { workspaceId: row.workspaceId }), t('{company} is back on {plan}', { company: row.name, plan: planName(row.prevPlan) })).then(() => (onDone(), onClose()))}
      />
    );
  return (
    <Dialog
      title={t('Change limits')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn danger-text adm-foot-start" onClick={() => setRemoving(true)}>
            <Trash2 size={13} /> {t('Take off')}
          </button>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="primary-btn"
            disabled={busy || !changed}
            onClick={() => {
              setBusy(true);
              post('whitelist/update', { workspaceId: row.workspaceId, ...v })
                .then(() => (toast(t('Saved. It applies at once.')), onDone(), onClose()))
                .catch((e: Error) => toast(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <div className="adm-wl-picked">
          <Who name={row.name} email={row.owner?.email} color={row.color} sub={t('On the Whitelist since {date}. Before: {plan}.', { date: day(row.addedAt), plan: planName(row.prevPlan) })} />
          <button type="button" className="ghost-btn sm" onClick={() => (onClose(), go(`/admin/companies/${row.workspaceId}`))}>
            {t('Open')}
          </button>
        </div>
        <div className="adm-wl-now">
          <Badge tone={row.aiLimit && row.aiUsed / row.aiLimit >= 0.8 ? (row.aiUsed >= row.aiLimit ? 'bad' : 'warn') : 'neutral'}>{t('AI: {share} used', { share: fmtPercent(row.aiLimit ? Math.min(1, row.aiUsed / row.aiLimit) : 1) })}</Badge>
          <Badge tone={row.sesLimit && row.sesUsed / row.sesLimit >= 0.8 ? (row.sesUsed >= row.sesLimit ? 'bad' : 'warn') : 'neutral'}>{t('Boosted: {share} used', { share: fmtPercent(row.sesLimit ? Math.min(1, row.sesUsed / row.sesLimit) : 1) })}</Badge>
        </div>
        <Limits v={v} set={(p) => setV((x) => ({ ...x, ...p }))} rate={rate} />
      </div>
    </Dialog>
  );
}
