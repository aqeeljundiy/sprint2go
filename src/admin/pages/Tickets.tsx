import { useEffect, useRef, useState } from 'react';
import { Bug, ChevronDown, FileX, LogIn, Mail, MessageSquare, Paperclip, Plus, Smartphone } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { SmoothHeight } from '../../components/ui/Smooth';
import { t, tn, tx } from '../../i18n';
import { fmtNumber, fmtPercent } from '../../i18n/format';

import { rel, dateTime, duration, post, PRIORITY_LABEL, rpShort, STATE_LABEL, STATUS_LABEL, type Priority, type TicketRow, type TicketStatus } from '../api';
import { Badge, Dialog, Empty, Failed, Field, HealthPill, Initials, KV, Loading, Menu, Page, Section, Table, useAct, useAdmin, useApi, Who } from '../ui';

const STATUS_TONE: Record<TicketStatus, 'accent' | 'warn' | 'info' | 'good' | 'neutral'> = { new: 'accent', open: 'warn', waiting: 'info', resolved: 'good', closed: 'neutral' };
const PRIO_TONE: Record<Priority, 'neutral' | 'warn' | 'bad'> = { low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'bad' };
const CHANNEL_ICON = { app: Smartphone, email: Mail, crash: Bug } as const;
const live = (tk: { status: TicketStatus }) => tk.status === 'new' || tk.status === 'open';

export function StatusBadge({ s }: { s: TicketStatus }) {
  return <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;
}

export function Tickets() {
  const { me, go, may } = useAdmin();
  const { data, error, reload } = useApi<{ tickets: TicketRow[]; operators: string[]; stats: { opened: number; medianFirstReplyMin: number | null; satisfaction: number | null; rated: number } }>('tickets', [], 30_000);
  const [creating, setCreating] = useState(false);
  const act = useAct();
  if (error) return <Page title={t('Tickets')}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Tickets')}><Loading rows={8} /></Page>;
  const s = data.stats;
  const sums = { opened: fmtNumber(s.opened), reply: duration(s.medianFirstReplyMin) };
  return (
    <Page
      title={t('Tickets')}
      sub={
        s.satisfaction !== null
          ? t('Last 30 days: {opened} opened · first reply {reply} · {rate} rated good ({rated})', { ...sums, rate: fmtPercent(s.satisfaction / 100), rated: fmtNumber(s.rated) })
          : t('Last 30 days: {opened} opened · first reply {reply}', sums)
      }
      actions={
        may('support') && (
          <button className="primary-btn sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> {t('Log a ticket')}
          </button>
        )
      }
    >
      <Table
        id="tickets"
        rows={data.tickets}
        rowKey={(tk) => tk.id}
        onOpen={(tk) => go(`/admin/tickets/${tk.id}`)}
        search={(tk) => `${tk.number} ${tk.subject} ${tk.requester.email} ${tk.requester.name ?? ''} ${tk.company ?? ''} ${tk.tags.join(' ')}`}
        initialSort={{ key: 'updated', dir: -1 }}
        rowTone={(tk) => (tk.breaching ? 'tone-bad' : tk.priority === 'urgent' && live(tk) ? 'tone-warn' : undefined)}
        views={[
          { id: 'mine', label: t('Mine'), test: (tk) => tk.assignee === me.email && tk.status !== 'resolved' && tk.status !== 'closed' },
          { id: 'unassigned', label: t('Nobody on it'), test: (tk) => !tk.assignee && live(tk) },
          { id: 'open', label: STATUS_LABEL.open, test: live },
          { id: 'late', label: t('Past target'), test: (tk) => tk.breaching },
          { id: 'waiting', label: STATUS_LABEL.waiting, test: (tk) => tk.status === 'waiting' },
          { id: 'done', label: STATUS_LABEL.resolved, test: (tk) => tk.status === 'resolved' || tk.status === 'closed' },
          { id: 'all', label: t('All'), test: () => true },
        ]}
        empty={{ title: t('No tickets here'), text: t('Tickets come from Help in the app, the crash screen, and email to support.') }}
        bulk={
          may('support')
            ? (sel, clear) => (
                <>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((tk) => tk.id), assignee: me.email }), tn(sel.length, '{n} assigned to you', '{n} assigned to you')).then(clear)}>
                    {t('Assign to me')}
                  </button>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((tk) => tk.id), status: 'resolved' }), tn(sel.length, '{n} resolved', '{n} resolved')).then(clear)}>
                    {t('Resolve')}
                  </button>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((tk) => tk.id), priority: 'high' }), t('Priority raised')).then(clear)}>
                    {t('High priority')}
                  </button>
                </>
              )
            : undefined
        }
        cols={[
          {
            key: 'subject',
            label: t('Ticket'),
            width: 'minmax(0, 2.4fr)',
            sort: (tk) => tk.number,
            render: (tk) => {
              const Icon = CHANNEL_ICON[tk.channel];
              return (
                <span className="adm-cell-main">
                  <strong>
                    <span className="adm-num">#{tk.number}</span> {tk.subject}
                  </strong>
                  <small>
                    <Icon size={11} /> {tk.requester.name ?? tk.requester.email}
                    {tk.tags.length ? ` · ${tk.tags.join(', ')}` : ''}
                  </small>
                </span>
              );
            },
          },
          { key: 'company', label: t('Company'), width: 'minmax(0, 1.1fr)', hide: 'phone', sort: (tk) => tk.company ?? '', render: (tk) => <span className="adm-ellipsis">{tk.company ?? <span className="muted">{t('no company')}</span>}</span> },
          { key: 'status', label: t('Status'), width: '130px', sort: (tk) => ['new', 'open', 'waiting', 'resolved', 'closed'].indexOf(tk.status), render: (tk) => <StatusBadge s={tk.status} /> },
          { key: 'priority', label: t('Priority'), width: '90px', hide: 'tablet', sort: (tk) => ['low', 'normal', 'high', 'urgent'].indexOf(tk.priority), render: (tk) => (tk.priority === 'normal' ? <span className="muted">{PRIORITY_LABEL.normal}</span> : <Badge tone={PRIO_TONE[tk.priority]}>{PRIORITY_LABEL[tk.priority]}</Badge>) },
          { key: 'assignee', label: t('On it'), width: '120px', hide: 'phone', sort: (tk) => tk.assignee ?? '', render: (tk) => (tk.assignee ? <span className="adm-ellipsis">{tk.assignee === me.email ? t('You') : tk.assignee.split('@')[0]}</span> : <span className="muted">{t('nobody')}</span>) },
          { key: 'updated', label: t('Updated'), width: '110px', align: 'right', sort: (tk) => tk.updatedAt, render: (tk) => <span className={tk.breaching ? 'adm-late' : 'muted'}>{tk.breaching ? t('past target') : rel(tk.updatedAt)}</span> },
        ]}
      />
      {creating && <NewTicket onClose={() => setCreating(false)} onDone={(id) => (setCreating(false), go(`/admin/tickets/${id}`))} />}
    </Page>
  );
}

function NewTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [busy, setBusy] = useState(false);
  const { toast } = useAdmin();
  return (
    <Dialog
      title={t('Log a ticket')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="primary-btn"
            disabled={busy || !email.includes('@') || !subject.trim()}
            onClick={() => {
              setBusy(true);
              post<{ id: string }>('ticket/create', { email, subject, body, priority })
                .then((r) => onDone(r.id))
                .catch((e: Error) => toast(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t('Create')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-dialog-text">{t('For a call, a WhatsApp message or a conversation: the ticket is linked to the person and company by email, and it’s yours.')}</p>
        <Field label={t('Their email')}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label={t('What it’s about')}>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={t('What they said')}>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label={t('Priority')}>
          <Select value={priority} onChange={(v) => setPriority(v as Priority)} label={t('Priority')} options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        </Field>
      </div>
    </Dialog>
  );
}

interface TicketData {
  ticket: TicketRow & { context: Record<string, unknown> | null; mergedInto: string | null };
  messages: { id: string; at: string; kind: 'customer' | 'operator' | 'system'; author: string; authorName: string | null; body: string; internal: boolean; attachments: { name: string; url: string; size?: string; blocked?: string }[] }[];
  company: { id: string; name: string; color: string; plan: never; state: keyof typeof STATE_LABEL; mrr: number; after?: number; people: number; health: { score: number; label: string }; lastActive: string | null } | null;
  person: { id: string; name: string; email: string; color: string; lastSeen: string | null; companies: { id: string; name: string }[] } | null;
  others: { id: string; number: number; subject: string; status: TicketStatus; updatedAt: string }[];
  macros: { id: string; title: string; body: string }[];
  operators: string[];
}

export function TicketPage({ id }: { id: string }) {
  const { me, go, may, signInAs } = useAdmin();
  const { data, error, reload } = useApi<TicketData>(`ticket?id=${encodeURIComponent(id)}`, [], 20_000);
  const act = useAct();
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [tag, setTag] = useState('');
  const [errorsOpen, setErrorsOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);
  if (error) return <Page title={t('Ticket')} back={{ label: t('Tickets'), to: '/admin/tickets' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title={t('Ticket')} back={{ label: t('Tickets'), to: '/admin/tickets' }}><Loading rows={6} /></Page>;
  const tk = data.ticket;
  const first = (data.person?.name ?? tk.requester.name ?? '').split(' ')[0] || tx('greeting', 'there');
  const send = async (status: TicketStatus) => {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await act(() => post('ticket/reply', { id: tk.id, body: text, internal, status }), internal ? t('Note added') : status === 'resolved' ? t('Sent and resolved') : t('Sent'));
    setBusy(false);
    if (ok) (setText(''), reload());
  };
  const update = (patch: Record<string, unknown>, done: string) => void act(() => post('ticket/update', { id: tk.id, ...patch }), done).then(reload);
  const ctx = tk.context ?? {};
  const errors = Array.isArray(ctx.errors) ? (ctx.errors as unknown[]).length : 0;
  const rated = { good: t('Rated good'), okay: t('Rated okay'), bad: t('Rated bad') };
  return (
    <Page
      back={{ label: t('Tickets'), to: '/admin/tickets' }}
      title={
        <>
          <span className="adm-num">#{tk.number}</span> {tk.subject}
        </>
      }
      sub={
        <span className="adm-head-badges">
          <StatusBadge s={tk.status} />
          {tk.priority !== 'normal' && <Badge tone={PRIO_TONE[tk.priority]}>{PRIORITY_LABEL[tk.priority]}</Badge>}
          {tk.breaching && <Badge tone="bad">{t('Past the reply target')}</Badge>}
          {!tk.breaching && !tk.firstReplyAt && tk.dueAt && <span className="muted">{t('Reply due {when}', { when: rel(tk.dueAt) })}</span>}
          <span className="muted">
            {tk.channel === 'email' ? t('By email') : tk.channel === 'crash' ? t('From the crash screen') : t('From the app')} · {dateTime(tk.createdAt)}
          </span>
        </span>
      }
      actions={
        <Menu
          label={t('More')}
          items={[
            { label: t('Copy link'), run: () => void navigator.clipboard?.writeText(location.href) },
            may('support') && { label: t('Merge into another ticket'), run: () => setMerging(true) },
            may('support') && tk.status !== 'closed' && { label: t('Close without reply'), run: () => update({ status: 'closed' }, STATUS_LABEL.closed) },
          ]}
        />
      }
      wide
    >
      <div className="adm-ticket">
        <div className="adm-convo">
          <div className="adm-msgs">
            {data.messages.map((m, i) => (
              <article key={m.id} className={`adm-msg ${m.kind} ${m.internal ? 'internal' : ''}`} style={{ ['--i' as string]: Math.min(i, 8) }}>
                <Initials name={m.authorName ?? m.author} color={m.kind === 'operator' ? 'var(--accent)' : data.person?.color} size={30} />
                <div className="adm-msg-body">
                  <header>
                    <strong>{m.kind === 'operator' ? (m.author === me.email ? t('You') : m.authorName ?? m.author) : m.authorName ?? m.author}</strong>
                    {m.internal && <Badge tone="warn">{t('Internal note')}</Badge>}
                    <time title={dateTime(m.at)}>{rel(m.at)}</time>
                  </header>
                  <div className="adm-msg-text">{m.body}</div>
                  {m.attachments.length > 0 && (
                    <div className="adm-msg-files">
                      {m.attachments.map((a, j) =>
                        a.blocked ? (
                          // Not sent with this ticket (a ticket from before 9 Oct could point at any file): never opened.
                          <span key={`blocked-${j}`} className="adm-file-blocked">
                            <FileX size={12} /> <span className="adm-file-name">{a.name}</span> · {a.blocked}
                          </span>
                        ) : (
                          <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                            <Paperclip size={12} /> {a.name}
                            {a.size && <small> {a.size}</small>}
                          </a>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
            <div ref={end} />
          </div>
          {tk.rating && (
            <p className={`adm-rating ${tk.rating}`}>
              {rated[tk.rating]}
              {tk.ratingNote ? `: “${tk.ratingNote}”` : ''}
            </p>
          )}
          {may('support') && (
            <div className={`adm-compose ${internal ? 'internal' : ''}`}>
              <div className="adm-compose-top">
                <div className="segmented sm">
                  <button type="button" className={!internal ? 'on' : ''} onClick={() => setInternal(false)}>
                    {t('Reply')}
                  </button>
                  <button type="button" className={internal ? 'on' : ''} onClick={() => setInternal(true)}>
                    {t('Internal note')}
                  </button>
                </div>
                <span className="spacer" />
                <Menu
                  label={t('Saved replies')}
                  icon={<MessageSquare size={13} />}
                  items={[
                    ...data.macros.map((m) => ({ label: m.title, run: () => setText((x) => (x ? `${x}\n\n` : '') + m.body.replace(/\{name\}/g, first).replace(/\{me\}/g, me.name.split(' ')[0])) })),
                    { label: t('Manage saved replies'), run: () => go('/admin/team/replies'), hint: t('Use {name} for their first name', { name: '{name}' }) },
                  ]}
                />
              </div>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={internal ? t('Only the team sees this') : t('Hi {name}, …', { name: first })}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void send(internal ? tk.status : 'waiting')}
              />
              <div className="adm-compose-foot">
                <small className="muted">{internal ? t('Not sent to them.') : tk.channel === 'email' ? t('Sent by email and shown in their Help screen.') : t('Shown in their Help screen; by email too if they haven’t been back.')}</small>
                <span className="spacer" />
                {internal ? (
                  <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send(tk.status)}>
                    {t('Add note')}
                  </button>
                ) : (
                  <>
                    <button className="ghost-btn sm" disabled={busy || !text.trim()} onClick={() => void send('resolved')}>
                      {t('Send and resolve')}
                    </button>
                    <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send('waiting')}>
                      {t('Send')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="adm-side">
          <Section title={t('Ticket')}>
            <div className="adm-form tight">
              <Field label={t('Status')}>
                <Select value={tk.status} disabled={!may('support')} onChange={(v) => update({ status: v }, t('Now {status}', { status: STATUS_LABEL[v as TicketStatus].toLowerCase() }))} label={t('Status')} options={(['new', 'open', 'waiting', 'resolved', 'closed'] as TicketStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
              </Field>
              <Field label={t('Priority')}>
                <Select value={tk.priority} disabled={!may('support')} onChange={(v) => update({ priority: v }, t('Priority changed'))} label={t('Priority')} options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
              </Field>
              <Field label={t('On it')}>
                <Select value={tk.assignee ?? ''} disabled={!may('support')} onChange={(v) => update({ assignee: v || null }, !v ? t('Unassigned') : v === me.email ? t('Given to you') : t('Given to {who}', { who: v }))} label={t('On it')} options={[{ value: '', label: t('Nobody') }, ...data.operators.map((o) => ({ value: o, label: o === me.email ? t('You ({email})', { email: o }) : o }))]} />
              </Field>
              <Field label={t('Tags')}>
                <span className="adm-tags">
                  {tk.tags.map((x) => (
                    <button key={x} type="button" className="adm-tag" disabled={!may('support')} onClick={() => update({ tags: tk.tags.filter((y) => y !== x) }, t('Tag removed'))} title={t('Remove')}>
                      {x} ×
                    </button>
                  ))}
                  {may('support') && (
                    <input
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder={t('Add a tag')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tag.trim()) (update({ tags: [...tk.tags, tag.trim()] }, t('Tagged')), setTag(''));
                      }}
                    />
                  )}
                </span>
              </Field>
            </div>
          </Section>

          <Section title={tx('ticket', 'Who')}>
            {data.person ? (
              <div className="adm-who">
                <button type="button" className="adm-who-main" onClick={() => go(`/admin/people/${data.person!.id}`)}>
                  <Who name={data.person.name} email={data.person.email} color={data.person.color} sub={`${data.person.email} · ${data.person.lastSeen ? t('seen {when}', { when: rel(data.person.lastSeen) }) : t('not seen in the app yet')}`} />
                </button>
                {may('impersonate') && (
                  <button className="ghost-btn sm" onClick={() => signInAs(data.person!.id, tk.number)}>
                    <LogIn size={13} /> {t('Sign in as {name}', { name: data.person.name.split(' ')[0] })}
                  </button>
                )}
              </div>
            ) : (
              <p className="adm-small">
                {tk.requester.name ? `${tk.requester.name} · ` : ''}
                {tk.requester.email} <span className="muted">({t('no account')})</span>
              </p>
            )}
          </Section>

          {data.company && (
            <Section title={t('Company')}>
              <button type="button" className="adm-card-link" onClick={() => go(`/admin/companies/${data.company!.id}`)}>
                <span className="adm-card-row">
                  <strong>{data.company.name}</strong>
                  <HealthPill h={data.company.health} />
                </span>
                <small>
                  {STATE_LABEL[data.company.state]} · {tn(data.company.people, '{n} person', '{n} people')} · {t('{amount}/month', { amount: rpShort(data.company.mrr || data.company.after || 0) })}
                </small>
              </button>
            </Section>
          )}

          {Object.keys(ctx).length > 0 && (
            <Section title={t('What we know')}>
              <KV
                items={Object.entries(ctx)
                  .filter(([k]) => k !== 'errors')
                  .map(([k, v]) => ({ k: k[0].toUpperCase() + k.slice(1), v: <span className="adm-wrap">{String(v)}</span> }))}
              />
              {errors > 0 && (
                <>
                  <button type="button" className="link-btn small adm-fold-btn" onClick={() => setErrorsOpen((o) => !o)}>
                    {tn(errors, '{n} recent error in their browser', '{n} recent errors in their browser')} <ChevronDown size={12} className={`rot-chev ${errorsOpen ? 'open' : ''}`} />
                  </button>
                  <div className={`fold ${errorsOpen ? 'open' : ''}`}>
                    <div className="fold-in">
                      <pre className="adm-pre">{(ctx.errors as { message: string; at?: string }[]).map((e) => `${e.at ? e.at.slice(11, 19) + ' ' : ''}${e.message}`).join('\n')}</pre>
                    </div>
                  </div>
                </>
              )}
            </Section>
          )}

          {data.others.length > 0 && (
            <Section title={t('Their other tickets')}>
              <div className="adm-mini-list">
                {data.others.map((o) => (
                  <button key={o.id} type="button" onClick={() => go(`/admin/tickets/${o.id}`)}>
                    <span>
                      #{o.number} {o.subject}
                    </span>
                    <StatusBadge s={o.status} />
                  </button>
                ))}
              </div>
            </Section>
          )}
        </aside>
      </div>
      {merging && <Merge from={tk} onClose={() => setMerging(false)} />}
    </Page>
  );
}

function Merge({ from, onClose }: { from: TicketRow; onClose: () => void }) {
  const [n, setN] = useState('');
  const { go, toast } = useAdmin();
  return (
    <Dialog
      title={t('Merge #{number}', { number: from.number })}
      size="sm"
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="primary-btn"
            disabled={!/^\d+$/.test(n.trim())}
            onClick={() =>
              void post<{ id: string }>('ticket/merge', { id: from.id, into: n.trim() })
                .then((r) => (toast(t('Merged')), go(`/admin/tickets/${r.id}`)))
                .catch((e: Error) => toast(e.message))
            }
          >
            {t('Merge')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-dialog-text">{t('All messages move to the other ticket and this one closes. Use it when someone wrote twice about the same thing.')}</p>
        <Field label={t('Merge into ticket number')}>
          <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} placeholder="1001" autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

export function TicketList({ tickets }: { tickets: { id: string; number: number; subject: string; status: TicketStatus; updatedAt: string; requester?: string }[] }) {
  const { go } = useAdmin();
  if (!tickets.length) return <Empty title={t('No tickets')} text={t('Nothing from them yet.')} />;
  return (
    <SmoothHeight>
      <div className="adm-mini-list">
        {tickets.map((o) => (
          <button key={o.id} type="button" onClick={() => go(`/admin/tickets/${o.id}`)}>
            <span>
              #{o.number} {o.subject}
              <small className="muted"> · {o.requester ? `${o.requester} · ` : ''}{rel(o.updatedAt)}</small>
            </span>
            <StatusBadge s={o.status} />
          </button>
        ))}
      </div>
    </SmoothHeight>
  );
}
