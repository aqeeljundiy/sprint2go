// Mail's filters in the app ("if it's this, it goes there"): Gmail's two-step editor (what to look for, with a live
// "N emails match", then what to do with them and "Also apply to the N that match"), the line on an email a filter
// filed, and filters described in plain words. The server runs them (server/mailFilters.ts).
import { useEffect, useState } from 'react';
import { ArrowLeft, Filter, X } from 'lucide-react';
import type { Account, Thread, User } from '../../types';
import { criteriaEmpty, factsOf, labelPath, labelTree, matches, type FiledBy, type FilterActions, type FilterCriteria, type MailFilterRule, type MailLabel } from '../../mailFilterMatch';
import { isMine } from '../../identity';
import { server } from '../../sync';
import { Select } from '../ui/Select';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { PushScreen } from '../ui/PushScreen';
import { personOption } from '../ui/PeopleList';
import { builtInTemplates, useOwnTemplates } from './Templates';
import { usePhone } from '../../mobile/media';
import { fmtDay } from '../../i18n/format';
import { t, tn } from '../../i18n';
import './organize.css';

/** Which mailbox a filter belongs to, as the editor's choice: an account id, or 'company'. */
export type FilterHome = { value: string; label: string; shared?: boolean };

/** The mailboxes a person may make filters for: their own, and (admins) the shared inboxes and the whole company. */
export function filterHomes(accounts: Account[], me: string, isAdmin: boolean): FilterHome[] {
  const boxes = accounts.filter((a) => !a.temp);
  return [
    ...boxes.filter((a) => a.kind !== 'shared' && a.users.includes(me)).map((a) => ({ value: a.id, label: a.email })),
    ...(isAdmin ? boxes.filter((a) => a.kind === 'shared').map((a) => ({ value: a.id, label: t('{email} (shared)', { email: a.email }), shared: true })) : []),
    ...(isAdmin ? [{ value: 'company', label: t('Every mailbox in the company') }] : []),
  ];
}

/** "From @dokploy.com, has the words invoice": what a filter looks for, in a line. */
export function criteriaWords(c: FilterCriteria): string {
  const parts: string[] = [];
  if (c.from) parts.push(t('from {who}', { who: c.from }));
  if (c.to) parts.push(t('to {who}', { who: c.to }));
  if (c.deliveredTo) parts.push(t('sent to {address}', { address: c.deliveredTo }));
  if (c.subject) parts.push(t('subject has {words}', { words: c.subject }));
  if (c.hasWords) parts.push(t('has {words}', { words: c.hasWords }));
  if (c.notWords) parts.push(t('doesn’t have {words}', { words: c.notWords }));
  if (c.list) parts.push(c.list === '*' ? t('from any mailing list') : t('from the list {list}', { list: c.list }));
  if (c.hasAttachment) parts.push(t('has files'));
  if (c.attachment) parts.push(t('files like {name}', { name: c.attachment }));
  if (c.size?.mb) parts.push(c.size.op === 'larger' ? t('larger than {mb} MB', { mb: c.size.mb }) : t('smaller than {mb} MB', { mb: c.size.mb }));
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Label Infra, skip the inbox": what a filter does, in a line. */
export function actionWords(a: FilterActions, labels: MailLabel[], people: User[]): string {
  const name = (id: string) => {
    const l = labels.find((x) => x.id === id);
    return l ? labelPath(l, labels) : t('a deleted label');
  };
  const who = (id: string) => people.find((u) => u.id === id)?.name.split(' ')[0] ?? t('someone');
  const parts: string[] = [];
  if (a.labels?.length) parts.push(t('label {names}', { names: a.labels.map(name).join(', ') }));
  if (a.archive) parts.push(t('skip the inbox'));
  if (a.read) parts.push(t('mark as read'));
  if (a.star) parts.push(t('star'));
  if (a.important === 'yes') parts.push(t('mark important'));
  if (a.important === 'no') parts.push(t('never mark important'));
  if (a.neverSpam) parts.push(t('never send to Spam'));
  if (a.spam) parts.push(t('send to Spam'));
  if (a.trash) parts.push(t('delete'));
  if (a.forward) parts.push(t('forward to {address}', { address: a.forward }));
  if (a.assign) parts.push(t('assign to {name}', { name: who(a.assign) }));
  if (a.task) parts.push(a.task.assignee ? t('make a task for {name}', { name: who(a.task.assignee) }) : t('make a task'));
  if (a.reply) parts.push(t('answer with “{template}”', { template: a.reply.name }));
  if (a.snoozeDays) parts.push(tn(a.snoozeDays, 'snooze for {n} day', 'snooze for {n} days'));
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The quiet line on an email a filter filed (or that a blocked sender sent). */
export function filedWords(f: FiledBy): string {
  if (f.scope === 'block') return t('Moved to Trash: you blocked {sender}', { sender: f.name });
  if (f.scope === 'company') return t('Filed by the company filter “{name}”', { name: f.name });
  if (f.scope === 'shared') return t('Filed by this inbox’s filter “{name}”', { name: f.name });
  return t('Filed by your filter “{name}”', { name: f.name });
}

type Preview = { count: number; sample: { id: string; subject: string; from?: { name?: string; email: string }; date?: string }[] } | null;

/** "N emails match": the server counts every mailbox it's for; the demo (no server) counts what's on screen. */
function usePreview(criteria: FilterCriteria, wsId: string, accountId: string | null, threads: Thread[]): Preview {
  const [res, setRes] = useState<Preview>(null);
  const key = JSON.stringify([criteria, accountId]);
  useEffect(() => {
    if (criteriaEmpty(criteria)) return setRes({ count: 0, sample: [] });
    let gone = false;
    const timer = setTimeout(() => {
      if (server.on) {
        fetch('/api/mail/filters/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: wsId, accountId, criteria }) })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => !gone && d && setRes(d))
          .catch(() => {});
        return;
      }
      const hit = threads.filter((th) => (accountId ? th.accountId === accountId : true) && th.location !== 'drafts' && th.messages.some((m) => !isMine(m.from.email) && matches(criteria, factsOf(th.subject, m))));
      const last = (th: Thread) => th.messages[th.messages.length - 1];
      if (!gone) setRes({ count: hit.length, sample: hit.slice(0, 5).map((th) => ({ id: th.id, subject: th.subject, from: last(th).from, date: last(th).date })) });
    }, 300);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [key, wsId]); // eslint-disable-line react-hooks/exhaustive-deps
  return res;
}

/** One field of the criteria form: a label and a text box. */
function Field({ id, label, value, onChange, placeholder, hint }: { id: string; label: string; value?: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div className="field flt-field">
      <label htmlFor={`flt-${id}`}>{label}</label>
      <input id={`flt-${id}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** A switch with its words: one thing a filter can do. `children` opens under it while it's on (which label, whom). */
function Act({ on, onChange, label, children, disabled, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; children?: React.ReactNode; disabled?: boolean; hint?: string }) {
  return (
    <div className={`flt-act${on ? ' on' : ''}`}>
      <button type="button" role="switch" aria-checked={on} disabled={disabled} className="flt-act-row" onClick={() => onChange(!on)}>
        <span className="flt-act-words">
          <span>{label}</span>
          {hint && <small>{hint}</small>}
        </span>
        <span className={`switch ${on ? 'on' : ''}`} aria-hidden>
          <span />
        </span>
      </button>
      {children && (
        <div className={`fold${on ? ' open' : ''}`}>
          {/* The fold's own child has no padding, so it closes to nothing. */}
          <div>
            <div className="flt-act-more">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface EditorProps {
  initial: Partial<MailFilterRule>;
  wsId: string;
  me: string;
  homes: FilterHome[];
  accounts: Account[]; // every mailbox in the company (for company addresses to forward to, and who's on a shared inbox)
  labels: MailLabel[]; // every label the person sees
  people: User[];
  threads: Thread[];
  forwardTo: (accountId: string | null) => Promise<string[]>; // addresses this mailbox may forward to
  onNewLabel: (name: string, accountId: string | null) => MailLabel | null;
  onSave: (f: MailFilterRule, applyExisting: boolean) => void;
  onClose: () => void;
}

/**
 * Making or changing a filter (Gmail's): first what to look for, with "N emails match" as you type; then what to do
 * with them, and "Also apply to the N that match". A large dialog on desktop, a pushed screen on phones.
 */
export function FilterEditor(p: EditorProps) {
  const phone = usePhone();
  const editing = !!p.initial.id && !!p.initial.createdAt;
  const [step, setStep] = useState<'find' | 'do'>(p.initial.actions && Object.keys(p.initial.actions).length && !criteriaEmpty(p.initial.criteria) && !editing ? 'do' : 'find');
  const [home, setHome] = useState<string>(p.initial.accountId === null ? 'company' : p.initial.accountId ?? p.homes[0]?.value ?? 'company');
  const [c, setC] = useState<FilterCriteria>(p.initial.criteria ?? {});
  const [a, setA] = useState<FilterActions>(p.initial.actions ?? {});
  const [name, setName] = useState(p.initial.name ?? '');
  const [stop, setStop] = useState(!!p.initial.stop);
  const [also, setAlso] = useState(false);
  const [fwd, setFwd] = useState<string[] | null>(null);
  const [own] = useOwnTemplates(p.me);
  const accountId = home === 'company' ? null : home;
  const account = p.accounts.find((x) => x.id === accountId);
  const shared = account?.kind === 'shared';
  const preview = usePreview(c, p.wsId, accountId, p.threads);
  const set = (k: keyof FilterCriteria, v: unknown) => setC((x) => ({ ...x, [k]: v === '' || v === false ? undefined : v }));
  const act = <K extends keyof FilterActions>(k: K, v: FilterActions[K] | undefined) => setA((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    let gone = false;
    setFwd(null);
    void p.forwardTo(accountId).then((l) => !gone && setFwd(l));
    return () => void (gone = true);
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels this filter can use: the mailbox's own and the company's (a company filter: the company's only).
  const usable = p.labels.filter((l) => l.workspaceId === p.wsId && (l.accountId === null || (accountId && l.accountId === accountId)));
  const labelOptions = labelTree(usable, p.labels).map((x) => ({ value: x.label.id, label: x.path, icon: <span className="ml-dot" style={{ background: x.label.color }} /> }));
  const templates = [...own, ...builtInTemplates()];
  const onShared = account ? p.people.filter((u) => account.users.includes(u.id)) : [];
  const findOk = !criteriaEmpty(c);
  const did = Object.entries(a).some(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length));
  const n = preview?.count ?? 0;

  const save = () => {
    if (!findOk || !did) return;
    const clean: FilterActions = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length)));
    p.onSave(
      {
        id: p.initial.id ?? `flt-${Math.random().toString(36).slice(2, 10)}`,
        workspaceId: p.wsId,
        accountId,
        name: name.trim() || undefined,
        enabled: p.initial.enabled ?? true,
        order: p.initial.order ?? Date.now(),
        criteria: c,
        actions: clean,
        stop: stop || undefined,
        createdBy: p.initial.createdBy ?? p.me,
        createdAt: p.initial.createdAt ?? new Date().toISOString(),
        hits: p.initial.hits,
        lastHitAt: p.initial.lastHitAt,
      },
      also && n > 0,
    );
    p.onClose();
  };

  const find = (
    <div className="flt-find">
      {p.homes.length > 1 && !editing && (
        <div className="field flt-field">
          <label>{t('Whose email')}</label>
          <Select value={home} options={p.homes} onChange={(v) => (setHome(v), setA((x) => ({ ...x, labels: undefined, assign: undefined, forward: undefined })))} title={t('Whose email')} />
        </div>
      )}
      <Field id="from" label={t('From')} value={c.from} onChange={(v) => set('from', v)} placeholder={t('nadia@kopikita.id, @dokploy.com, *@bank.co.id')} />
      <Field id="to" label={t('To or Cc')} value={c.to} onChange={(v) => set('to', v)} placeholder={t('An address, a domain or a name')} />
      <Field id="subject" label={t('Subject')} value={c.subject} onChange={(v) => set('subject', v)} />
      <Field id="has" label={t('Has the words')} value={c.hasWords} onChange={(v) => set('hasWords', v)} placeholder={t('invoice OR receipt, “purchase order”')} />
      <Field id="not" label={t('Doesn’t have')} value={c.notWords} onChange={(v) => set('notWords', v)} />
      <div className="flt-two">
        <div className="field flt-field">
          <label>{t('Size')}</label>
          <div className="flt-size">
            <Select value={c.size?.op ?? 'larger'} options={[{ value: 'larger', label: t('Larger than') }, { value: 'smaller', label: t('Smaller than') }]} onChange={(v) => set('size', c.size?.mb ? { op: v, mb: c.size.mb } : undefined)} title={t('Size')} />
            <input inputMode="decimal" aria-label={t('Megabytes')} value={c.size?.mb ?? ''} onChange={(e) => { const mb = parseFloat(e.target.value.replace(',', '.')); set('size', mb > 0 ? { op: c.size?.op ?? 'larger', mb } : undefined); }} placeholder="MB" />
          </div>
        </div>
        <Field id="file" label={t('File name or type')} value={c.attachment} onChange={(v) => set('attachment', v)} placeholder={t('pdf, spreadsheet, invoice')} />
      </div>
      <Field id="list" label={t('From a mailing list')} value={c.list} onChange={(v) => set('list', v)} placeholder={t('news.acme.com, or * for any list')} />
      <Field id="via" label={t('Sent to (one of our addresses)')} value={c.deliveredTo} onChange={(v) => set('deliveredTo', v)} placeholder={t('sales@yourcompany.com')} hint={t('Mail that came in through this address or alias.')} />
      <button type="button" role="switch" aria-checked={!!c.hasAttachment} className="flt-act-row flt-files" onClick={() => set('hasAttachment', !c.hasAttachment)}>
        <span className="flt-act-words">{t('Has attachment')}</span>
        <span className={`switch ${c.hasAttachment ? 'on' : ''}`} aria-hidden>
          <span />
        </span>
      </button>
    </div>
  );

  const matchLine = (
    <div className="flt-preview" aria-live="polite">
      {!findOk ? (
        <p className="flt-hint">{t('Fill in at least one thing to look for.')}</p>
      ) : preview === null ? (
        <p className="flt-hint">{t('Looking…')}</p>
      ) : n === 0 ? (
        <p className="flt-hint">{t('No emails here match yet. New ones that do will be filtered.')}</p>
      ) : (
        <>
          <p className="flt-count">{tn(n, '{n} email matches', '{n} emails match')}</p>
          <ul className="flt-sample">
            {preview.sample.slice(0, phone ? 3 : 5).map((s) => (
              <li key={s.id}>
                <strong>{s.from?.name || s.from?.email}</strong>
                <span>{s.subject}</span>
                {s.date && <time>{fmtDay(s.date)}</time>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  const doIt = (
    <div className="flt-do">
      <p className="flt-summary">{criteriaWords(c)}</p>
      <Act on={!!a.archive} onChange={(v) => act('archive', v)} label={t('Skip the inbox (archive it)')} />
      <Act on={!!a.read} onChange={(v) => act('read', v)} label={t('Mark as read')} />
      <Act on={!!a.star} onChange={(v) => act('star', v)} label={t('Star it')} />
      <Act on={a.labels !== undefined} onChange={(v) => act('labels', v ? (labelOptions[0] ? [labelOptions[0].value] : []) : undefined)} label={t('Apply the label')}>
        <Select
          value={a.labels?.[0] ?? ''}
          options={labelOptions}
          onChange={(v) => act('labels', [v])}
          placeholder={t('Choose a label')}
          title={t('Apply the label')}
          searchable
          create={{ label: t('New label'), placeholder: t('Label name'), make: (nm) => p.onNewLabel(nm, accountId)?.id ?? null }}
        />
      </Act>
      <Act on={!!a.forward} onChange={(v) => act('forward', v ? fwd?.[0] ?? '' : undefined)} label={t('Forward it to')} disabled={!fwd?.length && !a.forward} hint={fwd && !fwd.length ? t('Add a forwarding address in Settings, Mail first.') : undefined}>
        <Select value={a.forward ?? ''} options={(fwd ?? []).map((x) => ({ value: x, label: x }))} onChange={(v) => act('forward', v)} placeholder={t('Choose an address')} title={t('Forward it to')} />
      </Act>
      {shared && (
        <Act on={!!a.assign} onChange={(v) => act('assign', v ? onShared[0]?.id : undefined)} label={t('Assign it to')}>
          <Select value={a.assign ?? ''} options={onShared.map((u) => personOption(u, p.me))} onChange={(v) => act('assign', v)} title={t('Assign it to')} />
        </Act>
      )}
      <Act on={!!a.task} onChange={(v) => act('task', v ? { assignee: p.me } : undefined)} label={t('Make a task')}>
        <div className="flt-two">
          <Select value={a.task?.assignee ?? p.me} options={p.people.map((u) => personOption(u, p.me))} onChange={(v) => act('task', { ...a.task, assignee: v })} title={t('Who does it')} searchable={p.people.length > 8} />
          <Select
            value={String(a.task?.dueDays ?? '')}
            options={[{ value: '', label: t('No due date') }, { value: '0', label: t('Due the same day') }, { value: '1', label: t('Due the next day') }, { value: '3', label: t('Due in 3 days') }, { value: '7', label: t('Due in a week') }]}
            onChange={(v) => act('task', { ...a.task, dueDays: v === '' ? undefined : Number(v) })}
            title={t('Due')}
          />
        </div>
      </Act>
      <Act on={!!a.reply} onChange={(v) => act('reply', v ? { name: templates[0].name, text: templates[0].text } : undefined)} label={t('Answer with a template')} hint={t('Once per sender every 4 days, never to robots or mailing lists.')}>
        <Select value={templates.find((x) => x.text === a.reply?.text)?.id ?? ''} options={templates.map((x) => ({ value: x.id, label: x.name, hint: x.text.slice(0, 60) }))} onChange={(v) => { const x = templates.find((y) => y.id === v); if (x) act('reply', { name: x.name, text: x.text }); }} title={t('Answer with a template')} />
      </Act>
      <Act on={!!a.snoozeDays} onChange={(v) => act('snoozeDays', v ? 1 : undefined)} label={t('Snooze it')}>
        <Select value={String(a.snoozeDays ?? 1)} options={[1, 2, 3, 7].map((d) => ({ value: String(d), label: tn(d, 'Until tomorrow morning', 'For {n} days') }))} onChange={(v) => act('snoozeDays', Number(v))} title={t('Snooze it')} />
      </Act>
      <Act on={a.important === 'yes'} onChange={(v) => act('important', v ? 'yes' : undefined)} label={t('Always mark it as important')} />
      <Act on={a.important === 'no'} onChange={(v) => act('important', v ? 'no' : undefined)} label={t('Never mark it as important')} />
      <Act on={!!a.neverSpam} onChange={(v) => setA((x) => ({ ...x, neverSpam: v || undefined, spam: v ? undefined : x.spam }))} label={t('Never send it to Spam')} />
      <Act on={!!a.spam} onChange={(v) => setA((x) => ({ ...x, spam: v || undefined, neverSpam: v ? undefined : x.neverSpam }))} label={t('Send it to Spam')} />
      <Act on={!!a.trash} onChange={(v) => act('trash', v)} label={t('Delete it')} />
      <Act on={stop} onChange={setStop} label={t('Don’t run later filters on these emails')} />
      <div className="field flt-field flt-name">
        <label htmlFor="flt-name">{t('Name (shown on the emails it files)')}</label>
        <input id="flt-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={criteriaWords(c).slice(0, 60)} />
      </div>
      {n > 0 && (
        <button type="button" role="switch" aria-checked={also} className="flt-act-row flt-also" onClick={() => setAlso(!also)}>
          <span className="flt-act-words">
            <span>{tn(n, 'Also apply to the {n} email that matches', 'Also apply to the {n} emails that match')}</span>
            <small>{t('Forwarding, answers and tasks only happen for new mail.')}</small>
          </span>
          <span className={`switch ${also ? 'on' : ''}`} aria-hidden>
            <span />
          </span>
        </button>
      )}
    </div>
  );

  const title = editing ? t('Edit filter') : t('New filter');
  const primary =
    step === 'find' ? (
      <button type="button" className="primary-btn" disabled={!findOk} onClick={() => setStep('do')}>
        {t('Continue')}
      </button>
    ) : (
      <button type="button" className="primary-btn" disabled={!did} onClick={save}>
        {editing ? t('Save filter') : t('Create filter')}
      </button>
    );

  if (phone)
    return (
      <PushScreen title={title} onBack={step === 'do' ? () => setStep('find') : p.onClose} cancel={step === 'find'} className="flt-screen" footer={<div className="flt-screen-foot">{step === 'find' && findOk && preview && <span className="flt-foot-count">{n ? tn(n, '{n} email matches', '{n} emails match') : t('No matches yet')}</span>}{primary}</div>}>
        <TabPane key={step}>
          <div className="flt-screen-body">
            {step === 'find' ? (
              <>
                {find}
                {matchLine}
              </>
            ) : (
              doIt
            )}
          </div>
        </TabPane>
      </PushScreen>
    );
  return (
    <div className="modal-scrim" onMouseDown={p.onClose}>
      <div className="modal big-modal flt-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose()}>
        <header className="modal-head">
          <span className="flt-title">
            <Filter size={15} /> {title}
            <span className="flt-steps" aria-hidden>
              <span className={step === 'find' ? 'on' : ''}>{t('1. What to look for')}</span>
              <span className={step === 'do' ? 'on' : ''}>{t('2. What to do')}</span>
            </span>
          </span>
          <button className="icon-btn sm" onClick={p.onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body flt-body">
          <SmoothHeight>
            <TabPane key={step}>
              {step === 'find' ? (
                <div className="flt-grid">
                  {find}
                  {matchLine}
                </div>
              ) : (
                doIt
              )}
            </TabPane>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {step === 'do' ? (
            <button className="ghost-btn" onClick={() => setStep('find')}>
              <ArrowLeft size={14} /> {t('Back')}
            </button>
          ) : (
            <button className="ghost-btn" onClick={p.onClose}>
              {t('Cancel')}
            </button>
          )}
          {primary}
        </footer>
      </div>
    </div>
  );
}

/** A filter's first line: its name, or what it looks for. */
export const filterTitle = (f: MailFilterRule) => f.name || criteriaWords(f.criteria);
