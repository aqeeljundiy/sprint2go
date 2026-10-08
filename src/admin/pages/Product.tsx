import { useState } from 'react';
import { Flag, Megaphone, Pencil, Plus, Send, Trash2, Wrench } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { dateTime, day, post } from '../api';
import { Badge, Confirm, Dialog, Empty, Failed, Field, Loading, Page, Section, Switch, Tabs, useAct, useAdmin, useApi } from '../ui';

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
const AUDIENCE: Record<string, string> = { all: 'Everyone', owners: 'Company owners', paying: 'Paying companies', trial: 'Companies on trial', list: 'Chosen companies', risk: 'Companies at risk' };

export function Product({ tab }: { tab: string }) {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<ProductData>('product');
  return (
    <Page title="Product" sub="Talk to customers inside the app, switch features on for some of them, and pause changes while you update.">
      <Tabs
        value={tab}
        onChange={(t) => go(`/admin/product/${t}`)}
        items={[
          { id: 'announcements', label: 'Announcements' },
          { id: 'flags', label: 'Feature flags' },
          { id: 'broadcasts', label: 'Email to owners' },
          { id: 'maintenance', label: 'Maintenance' },
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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${all.length} companies`} />
      <div className="adm-picker-list">
        {shown.map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={value.includes(c.id)} onChange={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])} />
            <span>{c.name}</span>
          </label>
        ))}
        {shown.length === 0 && <small className="muted">No company matches.</small>}
      </div>
      <small className="muted">{value.length} chosen</small>
    </div>
  );
}

function stateOf(a: Announcement) {
  const now = new Date().toISOString();
  if (a.from > now) return { label: `Starts ${day(a.from)}`, tone: 'info' as const };
  if (a.until && a.until < now) return { label: 'Ended', tone: 'neutral' as const };
  return { label: 'Showing', tone: 'good' as const };
}

function Announcements({ d, reload }: { d: ProductData; reload: () => void }) {
  const { may } = useAdmin();
  const act = useAct();
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null);
  return (
    <Section
      title="Announcements"
      hint="Shown on Home in the app, for the people you choose"
      actions={
        may('product') && (
          <button className="primary-btn sm" onClick={() => setEdit('new')}>
            <Plus size={13} /> New announcement
          </button>
        )
      }
    >
      {d.announcements.length === 0 ? (
        <Empty title="Nothing announced" text="A new feature, planned maintenance, a price change: write it once and it shows on everyone’s Home until it ends." />
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
                    {a.until ? ` · until ${day(a.until)}` : ''}
                  </span>
                  <span className="spacer" />
                  {may('product') && (
                    <>
                      <button className="icon-btn sm" aria-label="Edit" onClick={() => setEdit(a)}>
                        <Pencil size={13} />
                      </button>
                      <button className="icon-btn sm" aria-label="Delete" onClick={() => void act(() => post('announcement', { delete: a.id }), 'Announcement removed').then(reload)}>
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
      title={a ? 'Edit announcement' : 'New announcement'}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!v.text.trim() || (v.audience === 'list' && !v.companies.length)} onClick={() => void act(() => post('announcement', { id: a?.id, ...v, from: v.from ? new Date(v.from + 'T00:00:00').toISOString() : undefined, until: v.until ? new Date(v.until + 'T23:59:59').toISOString() : undefined }), a ? 'Saved' : 'Announced').then((ok) => ok && onDone())}>
            {a ? 'Save' : 'Announce'}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <Field label="Message" hint="One or two short sentences">
          <textarea rows={3} maxLength={300} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} autoFocus />
        </Field>
        <Field label="Link (optional)">
          <input value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder="https://" />
        </Field>
        <div className="adm-grid2">
          <Field label="Kind">
            <Select value={v.kind} onChange={(x) => setV({ ...v, kind: x as 'news' })} label="Kind" options={[{ value: 'news', label: 'News' }, { value: 'warning', label: 'Warning (maintenance, a problem)' }]} />
          </Field>
          <Field label="Who sees it">
            <Select value={v.audience} onChange={(x) => setV({ ...v, audience: x as 'all' })} label="Who sees it" options={['all', 'owners', 'paying', 'trial', 'list'].map((k) => ({ value: k, label: AUDIENCE[k] }))} />
          </Field>
        </div>
        {v.audience === 'list' && <CompanyPicker all={companies} value={v.companies} onChange={(c) => setV({ ...v, companies: c })} />}
        <div className="adm-grid2">
          <Field label="From">
            <DatePicker value={v.from} onChange={(x) => setV({ ...v, from: x })} clearable label="From" />
          </Field>
          <Field label="Until">
            <DatePicker value={v.until} onChange={(x) => setV({ ...v, until: x })} clearable label="Until" />
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
  const reach = (f: FlagDef) => (f.mode === 'on' ? 'Everyone' : f.mode === 'off' ? 'Nobody' : f.mode === 'percent' ? `${f.percent}% of companies` : `${f.companies.length} chosen companies`);
  return (
    <Section
      title="Feature flags"
      hint="Try something new with a few companies before everyone"
      actions={
        may('product') && (
          <button className="primary-btn sm" onClick={() => setEdit('new')}>
            <Plus size={13} /> New flag
          </button>
        )
      }
    >
      {flags.length === 0 ? (
        <Empty title="No flags yet" text="Name a flag, then ship code that checks it. Turn it on for one company, a percentage, or everyone." />
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
                <button className="icon-btn sm" aria-label="Edit" onClick={() => setEdit({ key, f })}>
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
      title={k ? `Flag ${k}` : 'New flag'}
      onClose={onClose}
      foot={
        <>
          {k && (
            <button className="ghost-btn danger-text" onClick={() => void act(() => post('flag', { key: k, delete: true }), 'Flag deleted').then((ok) => ok && onDone())}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!v.key.trim()} onClick={() => void act(() => post('flag', v), 'Flag saved').then((ok) => ok && onDone())}>
            Save
          </button>
        </>
      }
    >
      <div className="adm-form">
        <div className="adm-grid2">
          <Field label="Name" hint="Used in the code, e.g. new-calendar">
            <input value={v.key} disabled={!!k} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} autoFocus={!k} />
          </Field>
          <Field label="Who gets it">
            <Select value={v.mode} onChange={(x) => setV({ ...v, mode: x as 'on' })} label="Who gets it" options={[{ value: 'off', label: 'Nobody' }, { value: 'list', label: 'Chosen companies' }, { value: 'percent', label: 'A percentage' }, { value: 'on', label: 'Everyone' }]} />
          </Field>
        </div>
        <Field label="What it does">
          <input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="The new calendar week view" />
        </Field>
        {v.mode === 'percent' && (
          <Field label={`Percentage of companies: ${v.percent}%`} hint="Each company always lands on the same side">
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
      <Section title="Write to company owners" hint="One email each, from support">
        {!may('product') ? (
          <Empty title="Your role can’t send these" />
        ) : (
          <div className="adm-form">
            <Field label="To">
              <Select value={audience} onChange={setAudience} label="To" options={['all', 'paying', 'trial', 'risk'].map((k) => ({ value: k, label: k === 'all' ? 'All company owners' : `Owners of ${AUDIENCE[k].toLowerCase()}` }))} />
            </Field>
            <Field label="Subject">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message">
              <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div>
              <button className="primary-btn sm" disabled={!subject.trim() || !body.trim()} onClick={check}>
                <Send size={13} /> Send…
              </button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Sent before">
        {d.broadcasts.length === 0 ? (
          <Empty title="Nothing sent yet" />
        ) : (
          <div className="adm-mini-list">
            {d.broadcasts.map((b) => (
              <div key={b.id} className="adm-mini-row">
                <span className="grow">
                  <strong>{b.subject}</strong>
                  <small className="muted">
                    {' '}
                    · {b.sent} owners · {b.by} · {dateTime(b.at)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      {confirm && preview && (
        <Confirm
          title={`Send to ${preview.count} owner${preview.count === 1 ? '' : 's'}`}
          action="Send now"
          text={preview.count ? `For example ${preview.sample.join(', ')}${preview.count > preview.sample.length ? ' and more' : ''}. Each gets their own copy.` : 'Nobody matches this audience.'}
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            act(() => post('broadcast/send', { audience, subject, body }), `Sent to ${preview.count} owners`).then((ok) => {
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
    <Section title="Maintenance mode" hint="Everyone keeps reading; saving is paused until you switch it off">
      <div className="adm-form">
        <Switch label={d.maintenance.on ? 'On: changes are paused' : 'Off'} hint="Operators can still change things" on={d.maintenance.on} disabled={!may('product')} onChange={(on) => void act(() => post('maintenance', { on, message: msg }), on ? 'Maintenance mode on' : 'Maintenance mode off').then(reload)} />
        <Field label="What people see">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="sprint2go is being updated. Back in about 10 minutes." disabled={!may('product')} />
        </Field>
        {d.maintenance.on && msg !== d.maintenance.message && (
          <div>
            <button className="ghost-btn sm" onClick={() => void act(() => post('maintenance', { on: true, message: msg }), 'Message updated').then(reload)}>
              Update the message
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}
