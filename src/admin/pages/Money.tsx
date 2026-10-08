import { useEffect, useState } from 'react';
import { FileText, Plus, RotateCcw, Tag } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { day, monthName, planLabel, post, rp, rpShort, type CompanyRow } from '../api';
import { Badge, Bars, Dialog, Empty, Failed, Field, Legend, Loading, MoneyInput, Page, Section, Stat, Stats, Switch, Table, Tabs, useAct, useAdmin, useApi, WHY } from '../ui';
import { StateBadge } from './Companies';

export function Money({ tab }: { tab: string }) {
  const { go } = useAdmin();
  return (
    <Page title="Money" sub="Booked from plans until payments are connected; bank transfers are marked paid by hand.">
      <Tabs
        value={tab}
        onChange={(t) => go(`/admin/money/${t}`)}
        items={[
          { id: 'revenue', label: 'Revenue' },
          { id: 'invoices', label: 'Invoices' },
          { id: 'plans', label: 'Plans & coupons' },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {tab === 'invoices' ? <Invoices /> : tab === 'plans' ? <Plans /> : <Revenue />}
      </div>
    </Page>
  );
}

interface RevenueData {
  mrr: number;
  paying: number;
  trials: { count: number; after: number };
  comped: number;
  paused: number;
  discounts: number;
  movement: { month: string; mrr: number; new: number; expansion: number; contraction: number; churn: number }[];
  byTier: Record<string, { companies: number; mrr: number }>;
  churnReasons: Record<string, number>;
  invoiced: { month: string; total: number; paid: number; overdue: number };
  companies: CompanyRow[];
}
function Revenue() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<RevenueData>('revenue');
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={6} />;
  const last = data.movement[data.movement.length - 2];
  const tiers = Object.entries(data.byTier).sort((a, b) => b[1].mrr - a[1].mrr);
  const reasons = Object.entries(data.churnReasons).sort((a, b) => b[1] - a[1]);
  const why = (k: string) => WHY.find((w) => w.value === k)?.label ?? k;
  return (
    <>
      <Stats>
        <Stat label="Monthly revenue" value={rpShort(data.mrr)} hint={`${rpShort(data.mrr * 12)} a year`} delta={last && last.mrr ? { text: rpShort(Math.abs(data.mrr - last.mrr)), dir: data.mrr > last.mrr ? 'up' : data.mrr < last.mrr ? 'down' : 'flat', good: data.mrr >= last.mrr } : null} />
        <Stat label="Paying" value={data.paying} hint={`${data.comped} on free months · ${data.paused} paused`} onClick={() => go('/admin/companies')} />
        <Stat label="On trial" value={data.trials.count} hint={`${rpShort(data.trials.after)}/month if all convert`} />
        <Stat label={`Invoiced in ${monthName(data.invoiced.month)}`} value={rpShort(data.invoiced.total)} hint={`${rpShort(data.invoiced.paid)} paid`} tone={data.invoiced.overdue ? 'warn' : undefined} onClick={() => go('/admin/money/invoices')} />
      </Stats>
      <Section title="How monthly revenue moved" hint="From daily snapshots; history starts the day this was switched on">
        <Bars
          fmt={rpShort}
          data={data.movement.map((m) => ({
            label: monthName(m.month),
            parts: [
              { name: 'New', value: m.new, tone: 'good' },
              { name: 'Grew', value: m.expansion, tone: 'accent' },
              { name: 'Shrank', value: m.contraction, tone: 'warn' },
              { name: 'Lost', value: m.churn, tone: 'bad' },
            ],
          }))}
        />
        <Legend items={[{ tone: 'good', name: 'New' }, { tone: 'accent', name: 'Grew' }, { tone: 'warn', name: 'Shrank' }, { tone: 'bad', name: 'Lost' }]} />
      </Section>
      <div className="adm-split">
        <Section title="By plan">
          {tiers.length === 0 ? (
            <Empty title="No companies yet" />
          ) : (
            <div className="adm-mini-list">
              {tiers.map(([name, t]) => (
                <div key={name} className="adm-mini-row">
                  <span className="grow">{name}</span>
                  <span className="muted">{t.companies}</span>
                  <span className="adm-num-r">{rpShort(t.mrr)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Why companies left" hint="Last 12 months">
          {reasons.length === 0 ? (
            <Empty title="Nobody has left" text="When you suspend or delete a company, the reason you pick is counted here." />
          ) : (
            <div className="adm-mini-list">
              {reasons.map(([k, n]) => (
                <div key={k} className="adm-mini-row">
                  <span className="grow">{why(k)}</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
      <Section title="Who pays what">
        <Table
          id="revenue-companies"
          rows={data.companies}
          rowKey={(c) => c.id}
          onOpen={(c) => go(`/admin/companies/${c.id}/billing`)}
          dense
          initialSort={{ key: 'mrr', dir: -1 }}
          empty={{ title: 'Nobody on a paid plan yet' }}
          cols={[
            { key: 'name', label: 'Company', width: 'minmax(0, 2fr)', sort: (c) => c.name, render: (c) => <strong className="adm-ellipsis">{c.name}</strong> },
            { key: 'plan', label: 'Plan', width: 'minmax(0, 1.2fr)', hide: 'phone', sort: (c) => planLabel(c.plan), render: (c) => <span className="adm-ellipsis">{planLabel(c.plan)}</span> },
            { key: 'state', label: 'State', width: '110px', sort: (c) => c.state, render: (c) => <StateBadge s={c.state} /> },
            { key: 'mrr', label: 'Monthly', width: '120px', align: 'right', sort: (c) => c.mrr || c.after || 0, render: (c) => (c.mrr ? rp(c.mrr) : <span className="muted">{rp(c.after ?? 0)} later</span>) },
          ]}
        />
      </Section>
    </>
  );
}

interface InvoiceRow {
  id: string;
  number: string;
  workspaceId: string;
  company: string;
  period: string;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  dueAt: string;
  paidAt: string | null;
  overdue: boolean;
}
function Invoices() {
  const { go, may } = useAdmin();
  const { data, error, reload } = useApi<{ invoices: InvoiceRow[] }>('invoices');
  const act = useAct();
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={6} />;
  const label = (i: InvoiceRow) => (i.overdue ? 'Overdue' : i.status[0].toUpperCase() + i.status.slice(1));
  const tone = (i: InvoiceRow) => (i.overdue ? 'bad' : i.status === 'paid' ? 'good' : i.status === 'sent' ? 'accent' : 'neutral');
  return (
    <Section
      title="Invoices"
      hint="PPN 11% included; bank details from Team & settings"
      actions={
        may('billing') && (
          <button className="primary-btn sm" onClick={() => void act(() => post<{ made: number }>('invoice/generate').then((r) => r), 'Drafts made for every paying company without one this month').then(reload)}>
            <FileText size={13} /> Make this month’s invoices
          </button>
        )
      }
    >
      <Table
        id="invoices"
        rows={data.invoices}
        rowKey={(i) => i.id}
        onOpen={(i) => window.open(`/api/admin/invoice.html?id=${i.id}`, '_blank')}
        search={(i) => `${i.number} ${i.company}`}
        initialSort={{ key: 'number', dir: -1 }}
        views={[
          { id: 'todo', label: 'To send', test: (i) => i.status === 'draft' },
          { id: 'overdue', label: 'Overdue', test: (i) => i.overdue },
          { id: 'sent', label: 'Waiting for payment', test: (i) => i.status === 'sent' && !i.overdue },
          { id: 'paid', label: 'Paid', test: (i) => i.status === 'paid' },
          { id: 'all', label: 'All', test: () => true },
        ]}
        empty={{ title: 'No invoices here', text: 'Make this month’s drafts, check them, then send.' }}
        bulk={
          may('billing')
            ? (sel, clear) => (
                <>
                  <button className="ghost-btn sm" onClick={() => void Promise.all(sel.filter((i) => i.status === 'draft' || i.status === 'sent').map((i) => post('invoice/status', { id: i.id, status: 'sent' }))).then(() => (clear(), reload()))}>
                    Send
                  </button>
                  <button className="ghost-btn sm" onClick={() => void Promise.all(sel.filter((i) => i.status !== 'paid' && i.status !== 'void').map((i) => post('invoice/status', { id: i.id, status: 'paid', method: 'bank transfer' }))).then(() => (clear(), reload()))}>
                    Mark paid
                  </button>
                </>
              )
            : undefined
        }
        cols={[
          {
            key: 'number',
            label: 'Invoice',
            width: 'minmax(0, 2fr)',
            sort: (i) => i.number,
            render: (i) => (
              <span className="adm-cell-main">
                <strong>{i.number}</strong>
                <small>
                  <button type="button" className="adm-link" onClick={() => go(`/admin/companies/${i.workspaceId}/billing`)}>
                    {i.company}
                  </button>
                </small>
              </span>
            ),
          },
          { key: 'period', label: 'Month', width: '90px', hide: 'phone', sort: (i) => i.period, render: (i) => monthName(i.period) },
          { key: 'total', label: 'Total', width: '130px', align: 'right', sort: (i) => i.total, render: (i) => rp(i.total) },
          { key: 'status', label: 'Status', width: '110px', sort: (i) => (i.overdue ? 0 : ['draft', 'sent', 'paid', 'void'].indexOf(i.status) + 1), render: (i) => <Badge tone={tone(i) as 'bad'}>{label(i)}</Badge> },
          { key: 'due', label: 'Due', width: '100px', align: 'right', hide: 'tablet', sort: (i) => i.dueAt, render: (i) => <span className="muted">{i.status === 'paid' ? `paid ${day(i.paidAt)}` : day(i.dueAt)}</span> },
        ]}
      />
    </Section>
  );
}

type Prices = Record<'own' | 'ai', Record<'small' | 'studio' | 'agency' | 'business', { base: number; included: number; extra: number }>>;
interface Coupon {
  code: string;
  kind: 'percent' | 'amount' | 'months';
  value: number;
  months: number | null;
  maxUses: number | null;
  used: number;
  expiresAt: string | null;
  note: string | null;
  active: boolean;
}
const TIERS = ['small', 'studio', 'agency', 'business'] as const;
function Plans() {
  const { may } = useAdmin();
  const pricing = useApi<{ prices: Prices; addons: Record<string, number>; topUp: number; overridden: boolean }>('pricing');
  const coupons = useApi<{ coupons: Coupon[] }>('coupons');
  const act = useAct();
  const [draft, setDraft] = useState<{ prices: Prices; addons: Record<string, number>; topUp: number } | null>(null);
  const [newCoupon, setNewCoupon] = useState(false);
  useEffect(() => {
    if (pricing.data) setDraft(JSON.parse(JSON.stringify({ prices: pricing.data.prices, addons: pricing.data.addons, topUp: pricing.data.topUp })));
  }, [pricing.data]);
  const can = may('billing');
  if (pricing.error) return <Failed error={pricing.error} retry={pricing.reload} />;
  if (!draft || !pricing.data) return <Loading rows={6} />;
  const changed = JSON.stringify(draft) !== JSON.stringify({ prices: pricing.data.prices, addons: pricing.data.addons, topUp: pricing.data.topUp });
  const setPrice = (track: 'own' | 'ai', tier: (typeof TIERS)[number], k: 'base' | 'included' | 'extra', v: number) => setDraft((d) => (d ? { ...d, prices: { ...d.prices, [track]: { ...d.prices[track], [tier]: { ...d.prices[track][tier], [k]: v } } } } : d));
  const ADDON_NAME: Record<string, string> = { mailboxes: 'Hosted mailbox', storage50: 'Extra 50 GB', meetHours10: 'Bot hours ×10', branding: 'Branding' };
  return (
    <>
      <Section
        title="Prices"
        hint={pricing.data.overridden ? 'Changed from the defaults' : 'The defaults'}
        actions={
          can && (
            <>
              {pricing.data.overridden && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('pricing', { reset: true }), 'Back to the default prices').then(pricing.reload)}>
                  <RotateCcw size={13} /> Defaults
                </button>
              )}
              <button className="primary-btn sm" disabled={!changed} onClick={() => void act(() => post('pricing', draft), 'Prices saved: the app and landing page use them now').then(pricing.reload)}>
                Save prices
              </button>
            </>
          )
        }
      >
        <div className="adm-prices">
          {(['own', 'ai'] as const).map((track) => (
            <div key={track} className="adm-price-block">
              <h3>{track === 'ai' ? 'AI included' : 'Own AI keys'}</h3>
              <div className="adm-price-grid">
                <span />
                <small>Per month</small>
                <small>People in it</small>
                <small>Each extra</small>
                {TIERS.map((tier) => (
                  <PriceRow key={tier} tier={tier} v={draft.prices[track][tier]} disabled={!can} onChange={(k, v) => setPrice(track, tier, k, v)} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="adm-grid4">
          {Object.entries(draft.addons).map(([k, v]) => (
            <Field key={k} label={ADDON_NAME[k] ?? k}>
              <MoneyInput value={v} disabled={!can} onChange={(n) => setDraft((d) => (d ? { ...d, addons: { ...d.addons, [k]: n } } : d))} label={ADDON_NAME[k] ?? k} />
            </Field>
          ))}
          <Field label="AI top-up">
            <MoneyInput value={draft.topUp} disabled={!can} onChange={(n) => setDraft((d) => (d ? { ...d, topUp: n } : d))} label="AI top-up" />
          </Field>
        </div>
      </Section>
      <Section
        title="Coupons"
        actions={
          can && (
            <button className="ghost-btn sm" onClick={() => setNewCoupon(true)}>
              <Plus size={13} /> New coupon
            </button>
          )
        }
      >
        {!coupons.data ? (
          <Loading rows={3} />
        ) : coupons.data.coupons.length === 0 ? (
          <Empty title="No coupons yet" text="Make a code for a launch, a partner or a campaign. Companies enter it under Plan & billing." />
        ) : (
          <div className="adm-mini-list">
            {coupons.data.coupons.map((c) => (
              <div key={c.code} className={`adm-mini-row ${c.active ? '' : 'faded'}`}>
                <Tag size={14} />
                <span className="grow">
                  <strong className="adm-mono">{c.code}</strong>{' '}
                  <span className="muted">
                    {c.kind === 'percent' ? `${c.value}% off` : c.kind === 'amount' ? `${rp(c.value)} off a month` : `${c.value} free month${c.value === 1 ? '' : 's'}`}
                    {c.kind !== 'months' && (c.months ? ` for ${c.months} months` : ', for good')}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                </span>
                <span className="muted">
                  {c.used}
                  {c.maxUses ? `/${c.maxUses}` : ''} used{c.expiresAt ? ` · until ${day(c.expiresAt)}` : ''}
                </span>
                {can && (
                  <button className="ghost-btn sm" onClick={() => void act(() => post('coupon', { ...c, active: !c.active }), c.active ? 'Coupon switched off' : 'Coupon on').then(coupons.reload)}>
                    {c.active ? 'Switch off' : 'Switch on'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      {newCoupon && <NewCoupon onClose={() => setNewCoupon(false)} onDone={() => (setNewCoupon(false), coupons.reload())} />}
    </>
  );
}
function PriceRow({ tier, v, onChange, disabled }: { tier: string; v: { base: number; included: number; extra: number }; onChange: (k: 'base' | 'included' | 'extra', v: number) => void; disabled: boolean }) {
  return (
    <>
      <strong>{tier[0].toUpperCase() + tier.slice(1)}</strong>
      <MoneyInput value={v.base} disabled={disabled} onChange={(n) => onChange('base', n)} label={`${tier} per month`} />
      <input type="number" min={1} value={v.included} disabled={disabled || tier === 'small'} onChange={(e) => onChange('included', Number(e.target.value) || 1)} aria-label={`${tier} people included`} />
      <MoneyInput value={v.extra} disabled={disabled} onChange={(n) => onChange('extra', n)} label={`${tier} each extra person`} />
    </>
  );
}
function NewCoupon({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [c, setC] = useState({ code: '', kind: 'percent', value: '20', months: '3', maxUses: '', expiresAt: '', note: '', forGood: false });
  const act = useAct();
  const valid = c.code.trim().length >= 3 && Number(c.value) > 0 && (c.kind !== 'percent' || Number(c.value) <= 100);
  return (
    <Dialog
      title="New coupon"
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!valid} onClick={() => void act(() => post('coupon', { code: c.code, kind: c.kind, value: Number(c.value), months: c.kind === 'months' || c.forGood ? null : Number(c.months) || null, maxUses: Number(c.maxUses) || null, expiresAt: c.expiresAt ? new Date(c.expiresAt + 'T23:59:59Z').toISOString() : null, note: c.note }), 'Coupon made').then((ok) => ok && onDone())}>
            Make coupon
          </button>
        </>
      }
    >
      <div className="adm-form">
        <div className="adm-grid2">
          <Field label="Code" hint="Letters, numbers and dashes">
            <input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} placeholder="LAUNCH25" autoFocus />
          </Field>
          <Field label="What it gives">
            <Select value={c.kind} onChange={(v) => setC({ ...c, kind: v })} label="Kind" options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Rupiah off a month' }, { value: 'months', label: 'Free months' }]} />
          </Field>
        </div>
        <div className="adm-grid2">
          <Field label={c.kind === 'percent' ? 'Percent' : c.kind === 'amount' ? 'Rupiah a month' : 'Months'}>
            <input type="number" min={1} value={c.value} onChange={(e) => setC({ ...c, value: e.target.value })} />
          </Field>
          {c.kind !== 'months' && (
            <Field label="For how many months">
              <input type="number" min={1} value={c.forGood ? '' : c.months} disabled={c.forGood} onChange={(e) => setC({ ...c, months: e.target.value })} placeholder="for good" />
            </Field>
          )}
        </div>
        {c.kind !== 'months' && <Switch label="For good" hint="The discount never ends" on={c.forGood} onChange={(v) => setC({ ...c, forGood: v })} />}
        <div className="adm-grid2">
          <Field label="How many times it can be used">
            <input type="number" min={1} value={c.maxUses} onChange={(e) => setC({ ...c, maxUses: e.target.value })} placeholder="no limit" />
          </Field>
          <Field label="Works until">
            <DatePicker value={c.expiresAt} onChange={(v) => setC({ ...c, expiresAt: v })} clearable label="Works until" />
          </Field>
        </div>
        <Field label="Note (for us)">
          <input value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} placeholder="e.g. Instagram campaign, October" />
        </Field>
      </div>
    </Dialog>
  );
}

