import { useEffect, useRef, useState } from 'react';
import { Bug, ChevronDown, FileX, LogIn, Mail, MessageSquare, Paperclip, Plus, Smartphone } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { SmoothHeight } from '../../components/ui/Smooth';

import { rel, dateTime, duration, post, PRIORITY_LABEL, rpShort, STATE_LABEL, STATUS_LABEL, type Priority, type TicketRow, type TicketStatus } from '../api';
import { Badge, Dialog, Empty, Failed, Field, HealthPill, Initials, KV, Loading, Menu, Page, Section, Table, useAct, useAdmin, useApi, Who } from '../ui';

const STATUS_TONE: Record<TicketStatus, 'accent' | 'warn' | 'info' | 'good' | 'neutral'> = { new: 'accent', open: 'warn', waiting: 'info', resolved: 'good', closed: 'neutral' };
const PRIO_TONE: Record<Priority, 'neutral' | 'warn' | 'bad'> = { low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'bad' };
const CHANNEL_ICON = { app: Smartphone, email: Mail, crash: Bug } as const;
const live = (t: { status: TicketStatus }) => t.status === 'new' || t.status === 'open';

export function StatusBadge({ s }: { s: TicketStatus }) {
  return <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;
}

export function Tickets() {
  const { me, go, may } = useAdmin();
  const { data, error, reload } = useApi<{ tickets: TicketRow[]; operators: string[]; stats: { opened: number; medianFirstReplyMin: number | null; satisfaction: number | null; rated: number } }>('tickets', [], 30_000);
  const [creating, setCreating] = useState(false);
  const act = useAct();
  if (error) return <Page title="Tickets"><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Tickets"><Loading rows={8} /></Page>;
  const s = data.stats;
  return (
    <Page
      title="Tickets"
      sub={`Last 30 days: ${s.opened} opened · first reply ${duration(s.medianFirstReplyMin)}${s.satisfaction !== null ? ` · ${s.satisfaction}% rated good (${s.rated})` : ''}`}
      actions={
        may('support') && (
          <button className="primary-btn sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Log a ticket
          </button>
        )
      }
    >
      <Table
        id="tickets"
        rows={data.tickets}
        rowKey={(t) => t.id}
        onOpen={(t) => go(`/admin/tickets/${t.id}`)}
        search={(t) => `${t.number} ${t.subject} ${t.requester.email} ${t.requester.name ?? ''} ${t.company ?? ''} ${t.tags.join(' ')}`}
        initialSort={{ key: 'updated', dir: -1 }}
        rowTone={(t) => (t.breaching ? 'tone-bad' : t.priority === 'urgent' && live(t) ? 'tone-warn' : undefined)}
        views={[
          { id: 'mine', label: 'Mine', test: (t) => t.assignee === me.email && t.status !== 'resolved' && t.status !== 'closed' },
          { id: 'unassigned', label: 'Nobody on it', test: (t) => !t.assignee && live(t) },
          { id: 'open', label: 'Open', test: live },
          { id: 'late', label: 'Past target', test: (t) => t.breaching },
          { id: 'waiting', label: 'Waiting on them', test: (t) => t.status === 'waiting' },
          { id: 'done', label: 'Resolved', test: (t) => t.status === 'resolved' || t.status === 'closed' },
          { id: 'all', label: 'All', test: () => true },
        ]}
        empty={{ title: 'No tickets here', text: 'Tickets come from Help in the app, the crash screen, and email to support.' }}
        bulk={
          may('support')
            ? (sel, clear) => (
                <>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((t) => t.id), assignee: me.email }), `${sel.length} assigned to you`).then(clear)}>
                    Assign to me
                  </button>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((t) => t.id), status: 'resolved' }), `${sel.length} resolved`).then(clear)}>
                    Resolve
                  </button>
                  <button className="ghost-btn sm" onClick={() => void act(() => post('ticket/update', { ids: sel.map((t) => t.id), priority: 'high' }), 'Priority raised').then(clear)}>
                    High priority
                  </button>
                </>
              )
            : undefined
        }
        cols={[
          {
            key: 'subject',
            label: 'Ticket',
            width: 'minmax(0, 2.4fr)',
            sort: (t) => t.number,
            render: (t) => {
              const Icon = CHANNEL_ICON[t.channel];
              return (
                <span className="adm-cell-main">
                  <strong>
                    <span className="adm-num">#{t.number}</span> {t.subject}
                  </strong>
                  <small>
                    <Icon size={11} /> {t.requester.name ?? t.requester.email}
                    {t.tags.length ? ` · ${t.tags.join(', ')}` : ''}
                  </small>
                </span>
              );
            },
          },
          { key: 'company', label: 'Company', width: 'minmax(0, 1.1fr)', hide: 'phone', sort: (t) => t.company ?? '', render: (t) => <span className="adm-ellipsis">{t.company ?? <span className="muted">no company</span>}</span> },
          { key: 'status', label: 'Status', width: '130px', sort: (t) => ['new', 'open', 'waiting', 'resolved', 'closed'].indexOf(t.status), render: (t) => <StatusBadge s={t.status} /> },
          { key: 'priority', label: 'Priority', width: '90px', hide: 'tablet', sort: (t) => ['low', 'normal', 'high', 'urgent'].indexOf(t.priority), render: (t) => (t.priority === 'normal' ? <span className="muted">Normal</span> : <Badge tone={PRIO_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>) },
          { key: 'assignee', label: 'On it', width: '120px', hide: 'phone', sort: (t) => t.assignee ?? '', render: (t) => (t.assignee ? <span className="adm-ellipsis">{t.assignee === me.email ? 'You' : t.assignee.split('@')[0]}</span> : <span className="muted">nobody</span>) },
          { key: 'updated', label: 'Updated', width: '110px', align: 'right', sort: (t) => t.updatedAt, render: (t) => <span className={t.breaching ? 'adm-late' : 'muted'}>{t.breaching ? 'past target' : rel(t.updatedAt)}</span> },
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
      title="Log a ticket"
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
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
            Create
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-dialog-text">For a call, a WhatsApp message or a conversation: the ticket is linked to the person and company by email, and it’s yours.</p>
        <Field label="Their email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="What it’s about">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="What they said">
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(v) => setPriority(v as Priority)} label="Priority" options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
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
  if (error) return <Page title="Ticket" back={{ label: 'Tickets', to: '/admin/tickets' }}><Failed error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Ticket" back={{ label: 'Tickets', to: '/admin/tickets' }}><Loading rows={6} /></Page>;
  const t = data.ticket;
  const first = (data.person?.name ?? t.requester.name ?? '').split(' ')[0] || 'there';
  const send = async (status: TicketStatus) => {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await act(() => post('ticket/reply', { id: t.id, body: text, internal, status }), internal ? 'Note added' : status === 'resolved' ? 'Sent and resolved' : 'Sent');
    setBusy(false);
    if (ok) (setText(''), reload());
  };
  const update = (patch: Record<string, unknown>, done: string) => void act(() => post('ticket/update', { id: t.id, ...patch }), done).then(reload);
  const ctx = t.context ?? {};
  return (
    <Page
      back={{ label: 'Tickets', to: '/admin/tickets' }}
      title={
        <>
          <span className="adm-num">#{t.number}</span> {t.subject}
        </>
      }
      sub={
        <span className="adm-head-badges">
          <StatusBadge s={t.status} />
          {t.priority !== 'normal' && <Badge tone={PRIO_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>}
          {t.breaching && <Badge tone="bad">Past the reply target</Badge>}
          {!t.breaching && !t.firstReplyAt && t.dueAt && <span className="muted">Reply due {rel(t.dueAt)}</span>}
          <span className="muted">
            {t.channel === 'email' ? 'By email' : t.channel === 'crash' ? 'From the crash screen' : 'From the app'} · {dateTime(t.createdAt)}
          </span>
        </span>
      }
      actions={
        <Menu
          label="More"
          items={[
            { label: 'Copy link', run: () => void navigator.clipboard?.writeText(location.href) },
            may('support') && { label: 'Merge into another ticket', run: () => setMerging(true) },
            may('support') && t.status !== 'closed' && { label: 'Close without reply', run: () => update({ status: 'closed' }, 'Closed') },
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
                    <strong>{m.kind === 'operator' ? (m.author === me.email ? 'You' : m.authorName ?? m.author) : m.authorName ?? m.author}</strong>
                    {m.internal && <Badge tone="warn">Internal note</Badge>}
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
          {t.rating && (
            <p className={`adm-rating ${t.rating}`}>
              Rated {t.rating}
              {t.ratingNote ? `: “${t.ratingNote}”` : ''}
            </p>
          )}
          {may('support') && (
            <div className={`adm-compose ${internal ? 'internal' : ''}`}>
              <div className="adm-compose-top">
                <div className="segmented sm">
                  <button type="button" className={!internal ? 'on' : ''} onClick={() => setInternal(false)}>
                    Reply
                  </button>
                  <button type="button" className={internal ? 'on' : ''} onClick={() => setInternal(true)}>
                    Internal note
                  </button>
                </div>
                <span className="spacer" />
                <Menu
                  label="Saved replies"
                  icon={<MessageSquare size={13} />}
                  items={[
                    ...data.macros.map((m) => ({ label: m.title, run: () => setText((x) => (x ? `${x}\n\n` : '') + m.body.replace(/\{name\}/g, first).replace(/\{me\}/g, me.name.split(' ')[0])) })),
                    { label: 'Manage saved replies', run: () => go('/admin/team/replies'), hint: 'Use {name} for their first name' },
                  ]}
                />
              </div>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={internal ? 'Only the team sees this' : `Hi ${first}, …`}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void send(internal ? t.status : 'waiting')}
              />
              <div className="adm-compose-foot">
                <small className="muted">{internal ? 'Not sent to them.' : t.channel === 'email' ? 'Sent by email and shown in their Help screen.' : 'Shown in their Help screen; by email too if they haven’t been back.'}</small>
                <span className="spacer" />
                {internal ? (
                  <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send(t.status)}>
                    Add note
                  </button>
                ) : (
                  <>
                    <button className="ghost-btn sm" disabled={busy || !text.trim()} onClick={() => void send('resolved')}>
                      Send and resolve
                    </button>
                    <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send('waiting')}>
                      Send
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="adm-side">
          <Section title="Ticket">
            <div className="adm-form tight">
              <Field label="Status">
                <Select value={t.status} disabled={!may('support')} onChange={(v) => update({ status: v }, `Now ${STATUS_LABEL[v as TicketStatus].toLowerCase()}`)} label="Status" options={(['new', 'open', 'waiting', 'resolved', 'closed'] as TicketStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
              </Field>
              <Field label="Priority">
                <Select value={t.priority} disabled={!may('support')} onChange={(v) => update({ priority: v }, 'Priority changed')} label="Priority" options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
              </Field>
              <Field label="On it">
                <Select value={t.assignee ?? ''} disabled={!may('support')} onChange={(v) => update({ assignee: v || null }, v ? `Given to ${v === me.email ? 'you' : v}` : 'Unassigned')} label="On it" options={[{ value: '', label: 'Nobody' }, ...data.operators.map((o) => ({ value: o, label: o === me.email ? `You (${o})` : o }))]} />
              </Field>
              <Field label="Tags">
                <span className="adm-tags">
                  {t.tags.map((x) => (
                    <button key={x} type="button" className="adm-tag" disabled={!may('support')} onClick={() => update({ tags: t.tags.filter((y) => y !== x) }, 'Tag removed')} title="Remove">
                      {x} ×
                    </button>
                  ))}
                  {may('support') && (
                    <input
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="Add a tag"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tag.trim()) (update({ tags: [...t.tags, tag.trim()] }, 'Tagged'), setTag(''));
                      }}
                    />
                  )}
                </span>
              </Field>
            </div>
          </Section>

          <Section title="Who">
            {data.person ? (
              <div className="adm-who">
                <button type="button" className="adm-who-main" onClick={() => go(`/admin/people/${data.person!.id}`)}>
                  <Who name={data.person.name} email={data.person.email} color={data.person.color} sub={`${data.person.email} · ${data.person.lastSeen ? `seen ${rel(data.person.lastSeen)}` : 'not seen in the app yet'}`} />
                </button>
                {may('impersonate') && (
                  <button className="ghost-btn sm" onClick={() => signInAs(data.person!.id, t.number)}>
                    <LogIn size={13} /> Sign in as {data.person.name.split(' ')[0]}
                  </button>
                )}
              </div>
            ) : (
              <p className="adm-small">
                {t.requester.name ? `${t.requester.name} · ` : ''}
                {t.requester.email} <span className="muted">(no account)</span>
              </p>
            )}
          </Section>

          {data.company && (
            <Section title="Company">
              <button type="button" className="adm-card-link" onClick={() => go(`/admin/companies/${data.company!.id}`)}>
                <span className="adm-card-row">
                  <strong>{data.company.name}</strong>
                  <HealthPill h={data.company.health} />
                </span>
                <small>
                  {STATE_LABEL[data.company.state]} · {data.company.people} people · {rpShort(data.company.mrr || data.company.after || 0)}/month
                </small>
              </button>
            </Section>
          )}

          {Object.keys(ctx).length > 0 && (
            <Section title="What we know">
              <KV
                items={Object.entries(ctx)
                  .filter(([k]) => k !== 'errors')
                  .map(([k, v]) => ({ k: k[0].toUpperCase() + k.slice(1), v: <span className="adm-wrap">{String(v)}</span> }))}
              />
              {Array.isArray(ctx.errors) && (ctx.errors as unknown[]).length > 0 && (
                <>
                  <button type="button" className="link-btn small adm-fold-btn" onClick={() => setErrorsOpen((o) => !o)}>
                    {(ctx.errors as unknown[]).length} recent errors in their browser <ChevronDown size={12} className={`rot-chev ${errorsOpen ? 'open' : ''}`} />
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
            <Section title="Their other tickets">
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
      {merging && <Merge from={t} onClose={() => setMerging(false)} />}
    </Page>
  );
}

function Merge({ from, onClose }: { from: TicketRow; onClose: () => void }) {
  const [n, setN] = useState('');
  const { go, toast } = useAdmin();
  return (
    <Dialog
      title={`Merge #${from.number}`}
      size="sm"
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!/^\d+$/.test(n.trim())}
            onClick={() =>
              void post<{ id: string }>('ticket/merge', { id: from.id, into: n.trim() })
                .then((r) => (toast('Merged'), go(`/admin/tickets/${r.id}`)))
                .catch((e: Error) => toast(e.message))
            }
          >
            Merge
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-dialog-text">All messages move to the other ticket and this one closes. Use it when someone wrote twice about the same thing.</p>
        <Field label="Merge into ticket number">
          <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} placeholder="1001" autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

export function TicketList({ tickets }: { tickets: { id: string; number: number; subject: string; status: TicketStatus; updatedAt: string; requester?: string }[] }) {
  const { go } = useAdmin();
  if (!tickets.length) return <Empty title="No tickets" text="Nothing from them yet." />;
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

