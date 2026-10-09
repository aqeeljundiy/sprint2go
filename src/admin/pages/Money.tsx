import { useEffect, useState } from 'react';
import { FileText, Plus, RotateCcw, Tag } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { day, monthName, planLabel, post, rp, rpShort, STATE_LABEL, type CompanyRow } from '../api';
import { Badge, Bars, Dialog, Empty, Failed, Field, Legend, Loading, MoneyInput, Page, Section, Stat, Stats, Switch, Table, Tabs, useAct, useAdmin, useApi, WHY } from '../ui';
import { StateBadge } from './Companies';
import { t, tn } from '../../i18n';
import { fmtNumber } from '../../i18n/format';

export function Money({ tab }: { tab: string }) {
  const { go } = useAdmin();
  return (
    <Page title={t('Money')} sub={t('Booked from plans until payments are connected; bank transfers are marked paid by hand.')}>
      <Tabs
        value={tab}
        onChange={(id) => go(`/admin/money/${id}`)}
        items={[
          { id: 'revenue', label: t('Revenue') },
          { id: 'invoices', label: t('Invoices') },
          { id: 'plans', label: t('Plans & coupons') },
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
  // The bar parts and the legend share these names.
  const MOVE = { new: t('New'), grew: t('Grew'), shrank: t('Shrank'), lost: t('Lost') };
  return (
    <>
      <Stats>
        <Stat label={t('Monthly revenue')} value={rpShort(data.mrr)} hint={t('{amount} a year', { amount: rpShort(data.mrr * 12) })} delta={last && last.mrr ? { text: rpShort(Math.abs(data.mrr - last.mrr)), dir: data.mrr > last.mrr ? 'up' : data.mrr < last.mrr ? 'down' : 'flat', good: data.mrr >= last.mrr } : null} />
        <Stat label={STATE_LABEL.paying} value={data.paying} hint={t('{comped} on free months · {paused} paused', { comped: fmtNumber(data.comped), paused: fmtNumber(data.paused) })} onClick={() => go('/admin/companies')} />
        <Stat label={t('On trial')} value={data.trials.count} hint={t('{amount}/month if all convert', { amount: rpShort(data.trials.after) })} />
        <Stat label={t('Invoiced in {month}', { month: monthName(data.invoiced.month) })} value={rpShort(data.invoiced.total)} hint={t('{amount} paid', { amount: rpShort(data.invoiced.paid) })} tone={data.invoiced.overdue ? 'warn' : undefined} onClick={() => go('/admin/money/invoices')} />
      </Stats>
      <Section title={t('How monthly revenue moved')} hint={t('From daily snapshots; history starts the day this was switched on')}>
        <Bars
          fmt={rpShort}
          data={data.movement.map((m) => ({
            label: monthName(m.month),
            parts: [
              { name: MOVE.new, value: m.new, tone: 'good' },
              { name: MOVE.grew, value: m.expansion, tone: 'accent' },
              { name: MOVE.shrank, value: m.contraction, tone: 'warn' },
              { name: MOVE.lost, value: m.churn, tone: 'bad' },
            ],
          }))}
        />
        <Legend items={[{ tone: 'good', name: MOVE.new }, { tone: 'accent', name: MOVE.grew }, { tone: 'warn', name: MOVE.shrank }, { tone: 'bad', name: MOVE.lost }]} />
      </Section>
      <div className="adm-split">
        <Section title={t('By plan')}>
          {tiers.length === 0 ? (
            <Empty title={t('No companies yet')} />
          ) : (
            <div className="adm-mini-list">
              {tiers.map(([name, x]) => (
                <div key={name} className="adm-mini-row">
                  <span className="grow">{name}</span>
                  <span className="muted">{x.companies}</span>
                  <span className="adm-num-r">{rpShort(x.mrr)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title={t('Why companies left')} hint={t('Last 12 months')}>
          {reasons.length === 0 ? (
            <Empty title={t('Nobody has left')} text={t('When you suspend or delete a company, the reason you pick is counted here.')} />
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
      <Section title={t('Who pays what')}>
        <Table
          id="revenue-companies"
          rows={data.companies}
          rowKey={(c) => c.id}
          onOpen={(c) => go(`/admin/companies/${c.id}/billing`)}
          dense
          initialSort={{ key: 'mrr', dir: -1 }}
          empty={{ title: t('Nobody on a paid plan yet') }}
          cols={[
            { key: 'name', label: t('Company'), width: 'minmax(0, 2fr)', sort: (c) => c.name, render: (c) => <strong className="adm-ellipsis">{c.name}</strong> },
            { key: 'plan', label: t('Plan'), width: 'minmax(0, 1.2fr)', hide: 'phone', sort: (c) => planLabel(c.plan), render: (c) => <span className="adm-ellipsis">{planLabel(c.plan)}</span> },
            { key: 'state', label: t('State'), width: '110px', sort: (c) => c.state, render: (c) => <StateBadge s={c.state} /> },
            { key: 'mrr', label: t('Monthly'), width: '120px', align: 'right', sort: (c) => c.mrr || c.after || 0, render: (c) => (c.mrr ? rp(c.mrr) : <span className="muted">{t('{amount} later', { amount: rp(c.after ?? 0) })}</span>) },
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
  const STATUS: Record<InvoiceRow['status'], string> = { draft: t('Draft'), sent: t('Sent'), paid: t('Paid'), void: t('Void') };
  const label = (i: InvoiceRow) => (i.overdue ? t('Overdue') : STATUS[i.status]);
  const tone = (i: InvoiceRow) => (i.overdue ? 'bad' : i.status === 'paid' ? 'good' : i.status === 'sent' ? 'accent' : 'neutral');
  return (
    <Section
      title={t('Invoices')}
      hint={t('PPN 11% included; bank details from Team & settings')}
      actions={
        may('billing') && (
          <button className="primary-btn sm" onClick={() => void act(() => post<{ made: number }>('invoice/generate').then((r) => r), t('Drafts made for every paying company without one this month')).then(reload)}>
            <FileText size={13} /> {t('Make this month’s invoices')}
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
          { id: 'todo', label: t('To send'), test: (i) => i.status === 'draft' },
          { id: 'overdue', label: t('Overdue'), test: (i) => i.overdue },
          { id: 'sent', label: t('Waiting for payment'), test: (i) => i.status === 'sent' && !i.overdue },
          { id: 'paid', label: t('Paid'), test: (i) => i.status === 'paid' },
          { id: 'all', label: t('All'), test: () => true },
        ]}
        empty={{ title: t('No invoices here'), text: t('Make this month’s drafts, check them, then send.') }}
        bulk={
          may('billing')
            ? (sel, clear) => (
                <>
                  <button className="ghost-btn sm" onClick={() => void Promise.all(sel.filter((i) => i.status === 'draft' || i.status === 'sent').map((i) => post('invoice/status', { id: i.id, status: 'sent' }))).then(() => (clear(), reload()))}>
                    {t('Send')}
                  </button>
                  <button className="ghost-btn sm" onClick={() => void Promise.all(sel.filter((i) => i.status !== 'paid' && i.status !== 'void').map((i) => post('invoice/status', { id: i.id, status: 'paid', method: 'bank transfer' }))).then(() => (clear(), reload()))}>
                    {t('Mark paid')}
                  </button>
                </>
              )
            : undefined
        }
        cols={[
          {
            key: 'number',
            label: t('Invoice'),
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
          { key: 'period', label: t('Month'), width: '90px', hide: 'phone', sort: (i) => i.period, render: (i) => monthName(i.period) },
          { key: 'total', label: t('Total'), width: '130px', align: 'right', sort: (i) => i.total, render: (i) => rp(i.total) },
          { key: 'status', label: t('Status'), width: '110px', sort: (i) => (i.overdue ? 0 : ['draft', 'sent', 'paid', 'void'].indexOf(i.status) + 1), render: (i) => <Badge tone={tone(i) as 'bad'}>{label(i)}</Badge> },
          { key: 'due', label: t('Due'), width: '100px', align: 'right', hide: 'tablet', sort: (i) => i.dueAt, render: (i) => <span className="muted">{i.status === 'paid' ? t('paid {date}', { date: day(i.paidAt) }) : day(i.dueAt)}</span> },
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
/** What a coupon gives, in one phrase: "20% off for 3 months", "Rp 50.000 off a month, for good", "2 free months". */
const couponGives = (c: Coupon) =>
  c.kind === 'months'
    ? tn(c.value, '{n} free month', '{n} free months')
    : c.kind === 'percent'
      ? c.months
        ? tn(c.months, '{pct}% off for {n} month', '{pct}% off for {n} months', { pct: fmtNumber(c.value) })
        : t('{pct}% off, for good', { pct: fmtNumber(c.value) })
      : c.months
        ? tn(c.months, '{amount} off a month for {n} month', '{amount} off a month for {n} months', { amount: rp(c.value) })
        : t('{amount} off a month, for good', { amount: rp(c.value) });
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
  const ADDON_NAME: Record<string, string> = { mailboxes: t('Hosted mailbox'), storage50: t('Extra 50 GB'), meetHours10: t('Bot hours ×10'), branding: t('Branding') };
  return (
    <>
      <Section
        title={t('Prices')}
        hint={pricing.data.overridden ? t('Changed from the defaults') : t('The defaults')}
        actions={
          can && (
            <>
              {pricing.data.overridden && (
                <button className="ghost-btn sm" onClick={() => void act(() => post('pricing', { reset: true }), t('Back to the default prices')).then(pricing.reload)}>
                  <RotateCcw size={13} /> {t('Defaults')}
                </button>
              )}
              <button className="primary-btn sm" disabled={!changed} onClick={() => void act(() => post('pricing', draft), t('Prices saved: the app and landing page use them now')).then(pricing.reload)}>
                {t('Save prices')}
              </button>
            </>
          )
        }
      >
        <div className="adm-prices">
          {(['own', 'ai'] as const).map((track) => (
            <div key={track} className="adm-price-block">
              <h3>{track === 'ai' ? t('AI included') : t('Own AI keys')}</h3>
              <div className="adm-price-grid">
                <span />
                <small>{t('Per month')}</small>
                <small>{t('People in it')}</small>
                <small>{t('Each extra')}</small>
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
          <Field label={t('AI top-up')}>
            <MoneyInput value={draft.topUp} disabled={!can} onChange={(n) => setDraft((d) => (d ? { ...d, topUp: n } : d))} label={t('AI top-up')} />
          </Field>
        </div>
      </Section>
      <Section
        title={t('Coupons')}
        actions={
          can && (
            <button className="ghost-btn sm" onClick={() => setNewCoupon(true)}>
              <Plus size={13} /> {t('New coupon')}
            </button>
          )
        }
      >
        {!coupons.data ? (
          <Loading rows={3} />
        ) : coupons.data.coupons.length === 0 ? (
          <Empty title={t('No coupons yet')} text={t('Make a code for a launch, a partner or a campaign. Companies enter it under Plan & billing.')} />
        ) : (
          <div className="adm-mini-list">
            {coupons.data.coupons.map((c) => (
              <div key={c.code} className={`adm-mini-row ${c.active ? '' : 'faded'}`}>
                <Tag size={14} />
                <span className="grow">
                  <strong className="adm-mono">{c.code}</strong>{' '}
                  <span className="muted">
                    {couponGives(c)}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                </span>
                <span className="muted">
                  {c.maxUses ? t('{used}/{max} used', { used: fmtNumber(c.used), max: fmtNumber(c.maxUses) }) : t('{used} used', { used: fmtNumber(c.used) })}
                  {c.expiresAt ? ` · ${t('until {date}', { date: day(c.expiresAt) })}` : ''}
                </span>
                {can && (
                  <button className="ghost-btn sm" onClick={() => void act(() => post('coupon', { ...c, active: !c.active }), c.active ? t('Coupon switched off') : t('Coupon on')).then(coupons.reload)}>
                    {c.active ? t('Switch off') : t('Switch on')}
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
  // The plan's name is a product name: it stays as it is in every language.
  const plan = tier[0].toUpperCase() + tier.slice(1);
  return (
    <>
      <strong>{plan}</strong>
      <MoneyInput value={v.base} disabled={disabled} onChange={(n) => onChange('base', n)} label={t('{plan} per month', { plan })} />
      <input type="number" min={1} value={v.included} disabled={disabled || tier === 'small'} onChange={(e) => onChange('included', Number(e.target.value) || 1)} aria-label={t('{plan} people included', { plan })} />
      <MoneyInput value={v.extra} disabled={disabled} onChange={(n) => onChange('extra', n)} label={t('{plan} each extra person', { plan })} />
    </>
  );
}
function NewCoupon({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [c, setC] = useState({ code: '', kind: 'percent', value: '20', months: '3', maxUses: '', expiresAt: '', note: '', forGood: false });
  const act = useAct();
  const valid = c.code.trim().length >= 3 && Number(c.value) > 0 && (c.kind !== 'percent' || Number(c.value) <= 100);
  return (
    <Dialog
      title={t('New coupon')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!valid} onClick={() => void act(() => post('coupon', { code: c.code, kind: c.kind, value: Number(c.value), months: c.kind === 'months' || c.forGood ? null : Number(c.months) || null, maxUses: Number(c.maxUses) || null, expiresAt: c.expiresAt ? new Date(c.expiresAt + 'T23:59:59Z').toISOString() : null, note: c.note }), t('Coupon made')).then((ok) => ok && onDone())}>
            {t('Make coupon')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <div className="adm-grid2">
          <Field label={t('Code')} hint={t('Letters, numbers and dashes')}>
            <input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} placeholder="LAUNCH25" autoFocus />
          </Field>
          <Field label={t('What it gives')}>
            <Select value={c.kind} onChange={(v) => setC({ ...c, kind: v })} label={t('Kind')} options={[{ value: 'percent', label: t('Percent off') }, { value: 'amount', label: t('Rupiah off a month') }, { value: 'months', label: t('Free months') }]} />
          </Field>
        </div>
        <div className="adm-grid2">
          <Field label={c.kind === 'percent' ? t('Percent') : c.kind === 'amount' ? t('Rupiah a month') : t('Months')}>
            <input type="number" min={1} value={c.value} onChange={(e) => setC({ ...c, value: e.target.value })} />
          </Field>
          {c.kind !== 'months' && (
            <Field label={t('For how many months')}>
              <input type="number" min={1} value={c.forGood ? '' : c.months} disabled={c.forGood} onChange={(e) => setC({ ...c, months: e.target.value })} placeholder={t('for good')} />
            </Field>
          )}
        </div>
        {c.kind !== 'months' && <Switch label={t('For good')} hint={t('The discount never ends')} on={c.forGood} onChange={(v) => setC({ ...c, forGood: v })} />}
        <div className="adm-grid2">
          <Field label={t('How many times it can be used')}>
            <input type="number" min={1} value={c.maxUses} onChange={(e) => setC({ ...c, maxUses: e.target.value })} placeholder={t('no limit')} />
          </Field>
          <Field label={t('Works until')}>
            <DatePicker value={c.expiresAt} onChange={(v) => setC({ ...c, expiresAt: v })} clearable label={t('Works until')} />
          </Field>
        </div>
        <Field label={t('Note (for us)')}>
          <input value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} placeholder={t('e.g. Instagram campaign, October')} />
        </Field>
      </div>
    </Dialog>
  );
}

