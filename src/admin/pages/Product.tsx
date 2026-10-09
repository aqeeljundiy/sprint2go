import { useState } from 'react';
import { Flag, Megaphone, Pencil, Plus, Send, Trash2, Wrench } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { dateTime, day, post } from '../api';
import { Badge, Confirm, Dialog, Empty, Failed, Field, Loading, Page, Section, Switch, Tabs, useAct, useAdmin, useApi } from '../ui';
import { t, tn } from '../../i18n';
import { fmtList } from '../../i18n/format';

interface Announcement {
  id: string;
  text: string;
  link?: string;
  kind: 'news' | 'warning';
  audience: 'all' | 'owners' | 'paying' | 'trial' | 'list';
  companies: string[];
  from: string;
  until?: string;
  createdBy: string;
}
interface FlagDef {
  description: string;
  mode: 'off' | 'on' | 'list' | 'percent';
  companies: string[];
  percent: number;
}
interface ProductData {
  announcements: Announcement[];
  flags: Record<string, FlagDef>;
  broadcasts: { id: string; subject: string; audience: string; sent: number; at: string; by: string }[];
  maintenance: { on: boolean; message: string };
  companies: { id: string; name: string }[];
}
// Getters: each read gives the words in the console's language of the moment (docs/i18n.md).
const AUDIENCE: Record<string, string> = {
  get all() { return t('Everyone'); },
  get owners() { return t('Company owners'); },
  get paying() { return t('Paying companies'); },
  get trial() { return t('Companies on trial'); },
  get list() { return t('Chosen companies'); },
  get risk() { return t('Companies at risk'); },
};
/** Who a broadcast goes to: always company owners, of which companies. */
const OWNERS: Record<string, string> = {
  get all() { return t('All company owners'); },
  get paying() { return t('Owners of paying companies'); },
  get trial() { return t('Owners of companies on trial'); },
  get risk() { return t('Owners of companies at risk'); },
};

export function Product({ tab }: { tab: string }) {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<ProductData>('product');
  return (
    <Page title={t('Product')} sub={t('Talk to customers inside the app, switch features on for some of them, and pause changes while you update.')}>
      <Tabs
        value={tab}
        onChange={(x) => go(`/admin/product/${x}`)}
        items={[
          { id: 'announcements', label: t('Announcements') },
          { id: 'flags', label: t('Feature flags') },
          { id: 'broadcasts', label: t('Email to owners') },
          { id: 'maintenance', label: t('Maintenance') },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={5} /> : tab === 'flags' ? <Flags d={data} reload={reload} /> : tab === 'broadcasts' ? <Broadcasts d={data} reload={reload} /> : tab === 'maintenance' ? <Maintenance d={data} reload={reload} /> : <Announcements d={data} reload={reload} />}
      </div>
    </Page>
  );
}

function CompanyPicker({ all, value, onChange }: { all: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = all.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="adm-picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tn(all.length, 'Search {n} company', 'Search {n} companies')} />
      <div className="adm-picker-list">
        {shown.map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={value.includes(c.id)} onChange={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])} />
            <span>{c.name}</span>
          </label>
        ))}
        {shown.length === 0 && <small className="muted">{t('No company matches.')}</small>}
      </div>
      <small className="muted">{tn(value.length, '{n} chosen', '{n} chosen')}</small>
    </div>
  );
}

function stateOf(a: Announcement) {
  const now = new Date().toISOString();
  if (a.from > now) return { label: t('Starts {day}', { day: day(a.from) }), tone: 'info' as const };
  if (a.until && a.until < now) return { label: t('Ended'), tone: 'neutral' as const };
  return { label: t('Showing'), tone: 'good' as const };
}

function Announcements({ d, reload }: { d: ProductData; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null);
  return (
    <Section
      title={t('Announcements')}
      hint={t('Shown on Home in the app, for the people you choose')}
      actions={
        may('product') && (
          <button className="primary-btn sm" onClick={() => setEdit('new')}>
            <Plus size={13} /> {t('New announcement')}
          </button>
        )
      }
    >
      {d.announcements.length === 0 ? (
        <Empty title={t('Nothing announced')} text={t('A new feature, planned maintenance, a price change: write it once and it shows on everyone’s Home until it ends.')} />
      ) : (
        <div className="adm-cards">
          {d.announcements.map((a) => {
            const st = stateOf(a);
            return (
              <article key={a.id} className={`adm-card ${a.kind}`}>
                <header>
                  {a.kind === 'warning' ? <Wrench size={15} /> : <Megaphone size={15} />}
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <span className="muted small">
                    {AUDIENCE[a.audience]}
                    {a.audience === 'list' ? ` (${a.companies.length})` : ''}
                    {a.until ? ` · ${t('until {day}', { day: day(a.until) })}` : ''}
                  </span>
                  <span className="spacer" />
                  {may('product') && (
                    <>
                      <button className="icon-btn sm" aria-label={t('Edit')} onClick={() => setEdit(a)}>
                        <Pencil size={13} />
                      </button>
                      <button className="icon-btn sm" aria-label={t('Delete')} onClick={() => void act(() => post('announcement', { delete: a.id }), t('Announcement removed')).then(reload)}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </header>
                <p>{a.text}</p>
                {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="small">{a.link}</a>}
              </article>
            );
          })}
        </div>
      )}
      {edit && <AnnouncementDialog a={edit === 'new' ? null : edit} companies={d.companies} onClose={() => setEdit(null)} onDone={() => (setEdit(null), reload())} />}
    </Section>
  );
}
function AnnouncementDialog({ a, companies, onClose, onDone }: { a: Announcement | null; companies: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ text: a?.text ?? '', link: a?.link ?? '', kind: a?.kind ?? 'news', audience: a?.audience ?? 'all', companies: a?.companies ?? [], from: a?.from?.slice(0, 10) ?? '', until: a?.until?.slice(0, 10) ?? '' });
  const act = useAct();
  return (
    <Dialog
      title={a ? t('Edit announcement') : t('New announcement')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!v.text.trim() || (v.audience === 'list' && !v.companies.length)} onClick={() => void act(() => post('announcement', { id: a?.id, ...v, from: v.from ? new Date(v.from + 'T00:00:00').toISOString() : undefined, until: v.until ? new Date(v.until + 'T23:59:59').toISOString() : undefined }), a ? t('Saved') : t('Announced')).then((ok) => ok && onDone())}>
            {a ? t('Save') : t('Announce')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <Field label={t('Message')} hint={t('One or two short sentences')}>
          <textarea rows={3} maxLength={300} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} autoFocus />
        </Field>
        <Field label={t('Link (optional)')}>
          <input value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder="https://" />
        </Field>
        <div className="adm-grid2">
          <Field label={t('Kind')}>
            <Select value={v.kind} onChange={(x) => setV({ ...v, kind: x as 'news' })} label={t('Kind')} options={[{ value: 'news', label: t('News') }, { value: 'warning', label: t('Warning (maintenance, a problem)') }]} />
          </Field>
          <Field label={t('Who sees it')}>
            <Select value={v.audience} onChange={(x) => setV({ ...v, audience: x as 'all' })} label={t('Who sees it')} options={['all', 'owners', 'paying', 'trial', 'list'].map((k) => ({ value: k, label: AUDIENCE[k] }))} />
          </Field>
        </div>
        {v.audience === 'list' && <CompanyPicker all={companies} value={v.companies} onChange={(c) => setV({ ...v, companies: c })} />}
        <div className="adm-grid2">
          <Field label={t('From')}>
            <DatePicker value={v.from} onChange={(x) => setV({ ...v, from: x })} clearable label={t('From')} />
          </Field>
          <Field label={t('Until')}>
            <DatePicker value={v.until} onChange={(x) => setV({ ...v, until: x })} clearable label={t('Until')} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function Flags({ d, reload }: { d: ProductData; reload: () => void }) {
  const { may } = useAdmin();
  const [edit, setEdit] = useState<{ key: string; f: FlagDef } | 'new' | null>(null);
  const flags = Object.entries(d.flags);
  const reach = (f: FlagDef) => (f.mode === 'on' ? t('Everyone') : f.mode === 'off' ? t('Nobody') : f.mode === 'percent' ? t('{n}% of companies', { n: f.percent }) : tn(f.companies.length, '{n} chosen company', '{n} chosen companies'));
  return (
    <Section
      title={t('Feature flags')}
      hint={t('Try something new with a few companies before everyone')}
      actions={
        may('product') && (
          <button className="primary-btn sm" onClick={() => setEdit('new')}>
            <Plus size={13} /> {t('New flag')}
          </button>
        )
      }
    >
      {flags.length === 0 ? (
        <Empty title={t('No flags yet')} text={t('Name a flag, then ship code that checks it. Turn it on for one company, a percentage, or everyone.')} />
      ) : (
        <div className="adm-mini-list">
          {flags.map(([key, f]) => (
            <div key={key} className="adm-mini-row">
              <Flag size={14} />
              <span className="grow">
                <strong className="adm-mono">{key}</strong> <span className="muted">{f.description}</span>
              </span>
              <Badge tone={f.mode === 'off' ? 'neutral' : f.mode === 'on' ? 'good' : 'accent'}>{reach(f)}</Badge>
              {may('product') && (
                <button className="icon-btn sm" aria-label={t('Edit')} onClick={() => setEdit({ key, f })}>
                  <Pencil size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && <FlagDialog k={edit === 'new' ? '' : edit.key} f={edit === 'new' ? null : edit.f} companies={d.companies} onClose={() => setEdit(null)} onDone={() => (setEdit(null), reload())} />}
    </Section>
  );
}
function FlagDialog({ k, f, companies, onClose, onDone }: { k: string; f: FlagDef | null; companies: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ key: k, description: f?.description ?? '', mode: f?.mode ?? 'list', companies: f?.companies ?? [], percent: f?.percent ?? 10 });
  const act = useAct();
  return (
    <Dialog
      title={k ? t('Flag {name}', { name: k }) : t('New flag')}
      onClose={onClose}
      foot={
        <>
          {k && (
            <button className="ghost-btn danger-text" onClick={() => void act(() => post('flag', { key: k, delete: true }), t('Flag deleted')).then((ok) => ok && onDone())}>
              {t('Delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!v.key.trim()} onClick={() => void act(() => post('flag', v), t('Flag saved')).then((ok) => ok && onDone())}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <div className="adm-grid2">
          <Field label={t('Name')} hint={t('Used in the code, e.g. new-calendar')}>
            <input value={v.key} disabled={!!k} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} autoFocus={!k} />
          </Field>
          <Field label={t('Who gets it')}>
            <Select value={v.mode} onChange={(x) => setV({ ...v, mode: x as 'on' })} label={t('Who gets it')} options={[{ value: 'off', label: t('Nobody') }, { value: 'list', label: t('Chosen companies') }, { value: 'percent', label: t('A percentage') }, { value: 'on', label: t('Everyone') }]} />
          </Field>
        </div>
        <Field label={t('What it does')}>
          <input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder={t('The new calendar week view')} />
        </Field>
        {v.mode === 'percent' && (
          <Field label={t('Percentage of companies: {n}%', { n: v.percent })} hint={t('Each company always lands on the same side')}>
            <input type="range" min={0} max={100} step={5} value={v.percent} onChange={(e) => setV({ ...v, percent: Number(e.target.value) })} />
          </Field>
        )}
        {v.mode === 'list' && <CompanyPicker all={companies} value={v.companies} onChange={(c) => setV({ ...v, companies: c })} />}
      </div>
    </Dialog>
  );
}

function Broadcasts({ d, reload }: { d: ProductData; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  const [audience, setAudience] = useState('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const check = () => void post<{ count: number; sample: string[] }>('broadcast/preview', { audience }).then((r) => (setPreview(r), setConfirm(true)));
  return (
    <div className="adm-split">
      <Section title={t('Write to company owners')} hint={t('One email each, from support')}>
        {!may('product') ? (
          <Empty title={t('Your role can’t send these')} />
        ) : (
          <div className="adm-form">
            <Field label={t('To')}>
              <Select value={audience} onChange={setAudience} label={t('To')} options={['all', 'paying', 'trial', 'risk'].map((k) => ({ value: k, label: OWNERS[k] }))} />
            </Field>
            <Field label={t('Subject')}>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label={t('Message')}>
              <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div>
              <button className="primary-btn sm" disabled={!subject.trim() || !body.trim()} onClick={check}>
                <Send size={13} /> {t('Send…')}
              </button>
            </div>
          </div>
        )}
      </Section>
      <Section title={t('Sent before')}>
        {d.broadcasts.length === 0 ? (
          <Empty title={t('Nothing sent yet')} />
        ) : (
          <div className="adm-mini-list">
            {d.broadcasts.map((b) => (
              <div key={b.id} className="adm-mini-row">
                <span className="grow">
                  <strong>{b.subject}</strong>
                  <small className="muted">
                    {' '}
                    · {tn(b.sent, '{n} owner', '{n} owners')} · {b.by} · {dateTime(b.at)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      {confirm && preview && (
        <Confirm
          title={tn(preview.count, 'Send to {n} owner', 'Send to {n} owners')}
          action={t('Send now')}
          text={
            !preview.count
              ? t('Nobody matches this audience.')
              : preview.count > preview.sample.length
                ? t('For example {names} and more. Each gets their own copy.', { names: preview.sample.join(', ') })
                : t('For example {names}. Each gets their own copy.', { names: fmtList(preview.sample) })
          }
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            act(() => post('broadcast/send', { audience, subject, body }), tn(preview.count, 'Sent to {n} owner', 'Sent to {n} owners')).then((ok) => {
              setConfirm(false);
              if (ok) (setSubject(''), setBody(''), reload());
            })
          }
        />
      )}
    </div>
  );
}

function Maintenance({ d, reload }: { d: ProductData; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  const [msg, setMsg] = useState(d.maintenance.message);
  return (
    <Section title={t('Maintenance mode')} hint={t('Everyone keeps reading; saving is paused until you switch it off')}>
      <div className="adm-form">
        <Switch label={d.maintenance.on ? t('On: changes are paused') : t('Off')} hint={t('Operators can still change things')} on={d.maintenance.on} disabled={!may('product')} onChange={(on) => void act(() => post('maintenance', { on, message: msg }), on ? t('Maintenance mode on') : t('Maintenance mode off')).then(reload)} />
        <Field label={t('What people see')}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('sprint2go is being updated. Back in about 10 minutes.')} disabled={!may('product')} />
        </Field>
        {d.maintenance.on && msg !== d.maintenance.message && (
          <div>
            <button className="ghost-btn sm" onClick={() => void act(() => post('maintenance', { on: true, message: msg }), t('Message updated')).then(reload)}>
              {t('Update the message')}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}
