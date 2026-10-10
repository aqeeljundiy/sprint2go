import { useEffect, useMemo, useState } from 'react';
import { Archive, Plus, X } from 'lucide-react';
import type { MailPolicy, User, Workspace } from '../../types';
import { server } from '../../sync';
import { Select, type Option } from '../ui/Select';
import { PersonSelect } from '../ui/PeoplePicker';
import { PersonCell } from '../ui/Person';
import { SmoothHeight, useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { loadPolicy, savePolicy, type AuditEntry } from './teamsApi';
import { BusyButton, ErrorLine, MailLog, SwitchLine } from './teamsBits';
import { mark, t, tn } from '../../i18n';
import { fmtDay } from '../../i18n/format';
import './teams.css';

/*
 * Settings, Mail retention & rules (company, admins): how long mail is kept, legal holds, data loss rules, forwarding
 * outside the company, and the company's mail log (server/mailCompliance.ts, server/mailAudit.ts). Changes are a
 * draft until "Save rules"; deleting old mail starts a week after it's switched on, and admins are told.
 */
export const MAIL_RULES_SECTION = { id: 'mailrules' as const, name: mark('Mail retention & rules'), icon: Archive, group: 'Company' as const };

const PERIODS = [0, 30, 90, 180, 365, 730, 1095, 2555];
const periodWords = (days: number) =>
  days === 0 ? t('Keep forever') : days % 365 === 0 ? tn(days / 365, 'Delete after {n} year', 'Delete after {n} years') : tn(days, 'Delete after {n} day', 'Delete after {n} days');
type Dlp = NonNullable<MailPolicy['dlp']>[number];
const KIND_NAME: Record<Dlp['kind'], string> = { card: mark('Card numbers'), nik: mark('NIK (KTP) numbers'), words: mark('Words you list') };

export function MailRules({ ws, users, me, toast }: { ws: Workspace; users: User[]; me: string; toast: (text: string) => void }) {
  const [saved, setSaved] = useState<MailPolicy | null>(null);
  const [draft, setDraft] = useState<MailPolicy>({});
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [holdWho, setHoldWho] = useState<string | null>(null);
  const [holdWhy, setHoldWhy] = useState('');
  useEffect(() => {
    if (!server.on) return;
    void loadPolicy(ws.id).then(
      (d) => (setSaved(d.policy), setDraft(d.policy), setLog(d.log)),
      () => setFailed(true),
    );
  }, [ws.id]);
  const holds = useLeaving(draft.holds ?? [], (h) => h.userId);
  const rules = useLeaving(draft.dlp ?? [], (r) => r.id);
  const dirty = useMemo(() => !!saved && JSON.stringify(clean(saved)) !== JSON.stringify(clean(draft)), [saved, draft]);
  const team = users.filter((u) => ws.members.some((m) => m.userId === u.id));
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? t('Someone');
  const boxes = ws.accounts.filter((a) => !a.temp && (!a.provider || a.provider === 'sprint2go'));
  if (!server.on)
    return (
      <>
        <h2>{t('Mail retention & rules')}</h2>
        <p className="set-intro">{t('How long mail is kept, legal holds and data loss rules. This works with sprint2go on a server; this demo has none.')}</p>
      </>
    );
  const set = (patch: Partial<MailPolicy>) => setDraft((d) => ({ ...d, ...patch }));
  const days = draft.retention?.days ?? 0;
  const perBox = draft.retention?.mailboxes ?? {};
  const setRetention = (r: { days?: number; mailboxes?: Record<string, number> }) => set({ retention: { ...(draft.retention ?? { days: 0 }), ...r } });
  const periodOptions = (withCompany: boolean): Option[] => [...(withCompany ? [{ value: 'company', label: t('As the company: {period}', { period: periodWords(days) }) }] : []), ...PERIODS.map((n) => ({ value: String(n), label: periodWords(n) }))];
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await savePolicy(ws.id, draft);
      setSaved(r.policy);
      setDraft(r.policy);
      setLog(r.log);
      toast(t('Mail rules saved'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addRule = (kind: Dlp['kind']) => set({ dlp: [...(draft.dlp ?? []), { id: `new-${Date.now().toString(36)}`, name: t(KIND_NAME[kind]), kind, action: kind === 'card' ? 'block' : 'warn', on: true, ...(kind === 'words' ? { words: '' } : {}) }] });
  const setRule = (id: string, patch: Partial<Dlp>) => set({ dlp: (draft.dlp ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const r = saved?.retention;
  return (
    <>
      <h2>{t('Mail retention & rules')}</h2>
      <p className="set-intro">{t('How long the company keeps mail, whose mail is kept no matter what, and what can’t leave by email. Every change is in the log at the bottom.')}</p>
      <SmoothHeight>
        {!saved ? (
          <p className={failed ? 'set-hint' : 'muted small'}>{failed ? t('Couldn’t check right now. Try again in a moment.') : t('Checking…')}</p>
        ) : (
          <div className="mx-sections">
            <section className="set-block">
              <h3>{t('Retention')}</h3>
              <div className="set-row">
                <span>
                  <strong>{t('Everyone’s mail')}</strong>
                  <small>{t('Conversations whose last email is older than this are deleted for everyone, once a day. Drafts stay.')}</small>
                </span>
                <Select value={String(days)} options={periodOptions(false)} onChange={(v) => setRetention({ days: Number(v) })} label={t('Everyone’s mail')} title={t('Everyone’s mail')} width={260} />
              </div>
              {boxes.map((a) => (
                <div key={a.id} className="set-row">
                  <span>
                    <strong>{a.email}</strong>
                  </span>
                  <Select
                    value={a.id in perBox ? String(perBox[a.id]) : 'company'}
                    options={periodOptions(true)}
                    onChange={(v) => {
                      const next = { ...perBox };
                      if (v === 'company') delete next[a.id];
                      else next[a.id] = Number(v);
                      setRetention({ mailboxes: next });
                    }}
                    label={t('Retention for {email}', { email: a.email })}
                    title={a.email}
                    width={280}
                  />
                </div>
              ))}
              <p className="set-hint">
                {r?.deleteFrom && Date.parse(r.deleteFrom) > Date.now()
                  ? t('Deleting starts {date}, a week after it was switched on, so there’s time to export what you need.', { date: fmtDay(r.deleteFrom) })
                  : r?.lastRun
                    ? tn(r.lastRun.deleted, 'Last run {when}: {n} conversation deleted.', 'Last run {when}: {n} conversations deleted.', { when: fmtDay(r.lastRun.at) })
                    : t('Deleting starts a week after it’s switched on, so there’s time to export what you need.')}
              </p>
            </section>

            <section className="set-block">
              <h3>{t('Legal hold')}</h3>
              <div className="acct-list">
                {holds.length === 0 && <EmptyState compact text={t('Nobody. Put someone on hold and nothing in their mailboxes can be deleted for good, by them, retention or anyone else.')} />}
                {holds.map(({ item: h, leaving }) => {
                  const u = users.find((x) => x.id === h.userId);
                  return (
                    <div key={h.userId} className={`acct-row mx-person ${leaving ? 'row-leaving' : ''}`}>
                      <PersonCell person={{ name: u?.name ?? t('Someone'), email: u?.email, color: u?.color, photo: u?.photo }} sub={h.reason ? t('{reason}, since {date}', { reason: h.reason, date: fmtDay(h.at) }) : t('Since {date}', { date: fmtDay(h.at) })} />
                      <button type="button" className="icon-btn sm" aria-label={t('Lift the hold on {name}', { name: name(h.userId) })} title={t('Lift the hold')} onClick={() => set({ holds: (draft.holds ?? []).filter((x) => x.userId !== h.userId) })}>
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}
                <form
                  className="acct-row mx-hold-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!holdWho) return;
                    set({ holds: [...(draft.holds ?? []), { id: '', userId: holdWho, reason: holdWhy.trim(), by: me, at: new Date().toISOString() }] });
                    setHoldWho(null);
                    setHoldWhy('');
                  }}
                >
                  <PersonSelect value={holdWho} users={team.filter((u) => !(draft.holds ?? []).some((h) => h.userId === u.id))} me={me} onChange={setHoldWho} label={t('Put someone on hold')} placeholder={t('Put someone on hold')} />
                  <input value={holdWhy} maxLength={200} placeholder={t('Why (for the log)')} aria-label={t('Why (for the log)')} onChange={(e) => setHoldWhy(e.target.value)} />
                  <button type="submit" className="ghost-btn outline sm" disabled={!holdWho}>
                    <Plus size={14} /> {t('Add')}
                  </button>
                </form>
              </div>
            </section>

            <section className="set-block">
              <h3>{t('Data loss rules')}</h3>
              <div className="acct-list">
                {rules.length === 0 && <EmptyState compact text={t('No rules. Add one to warn or stop people before an email with card numbers, NIK numbers or words you list goes out.')} />}
                {rules.map(({ item: x, leaving }) => (
                  <div key={x.id} className={`acct-row mx-rule ${leaving ? 'row-leaving' : ''}`}>
                    <span className="acct-info">
                      <strong>{t(KIND_NAME[x.kind])}</strong>
                      {x.kind === 'words' ? (
                        <input className="mx-words" value={x.words ?? ''} placeholder={t('payroll, project mango')} aria-label={t('Words, separated by commas')} onChange={(e) => setRule(x.id, { words: e.target.value })} />
                      ) : (
                        <small>{x.kind === 'card' ? t('Credit and debit card numbers (checked like banks do).') : t('16-digit NIK numbers from a KTP.')}</small>
                      )}
                    </span>
                    <Select value={x.action} options={[{ value: 'warn', label: t('Warn the sender') }, { value: 'block', label: t('Stop the email') }]} onChange={(action) => setRule(x.id, { action })} label={t('What happens')} title={t('What happens')} width={220} />
                    <button type="button" role="switch" aria-checked={x.on} aria-label={t('On')} className={`switch ${x.on ? 'on' : ''}`} onClick={() => setRule(x.id, { on: !x.on })}>
                      <span />
                    </button>
                    <button type="button" className="icon-btn sm" aria-label={t('Remove')} title={t('Remove')} onClick={() => set({ dlp: (draft.dlp ?? []).filter((y) => y.id !== x.id) })}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <div className="acct-row mx-rule-add">
                  {(['card', 'nik', 'words'] as const)
                    .filter((k) => k === 'words' || !(draft.dlp ?? []).some((x) => x.kind === k))
                    .map((k) => (
                      <button key={k} type="button" className="ghost-btn outline sm" onClick={() => addRule(k)}>
                        <Plus size={14} /> {t(KIND_NAME[k])}
                      </button>
                    ))}
                </div>
              </div>
              <p className="set-hint">{t('Checked in the subject, the text and attachment names of every email that leaves, from the app, mail apps and scheduled mail. The numbers themselves are never logged.')}</p>
            </section>

            <section className="set-block">
              <h3>{t('Forwarding')}</h3>
              <SwitchLine on={draft.forwardOutside !== false} onChange={(v) => set({ forwardOutside: v ? undefined : false })} label={t('Let people forward mail outside the company')} hint={t('Off: forwarding only to addresses at your own domains. Forwarding anywhere else stops at once.')} />
            </section>

            <ErrorLine text={error} />
            <div className={`fold mx-savebar-fold ${dirty ? 'open' : ''}`} aria-hidden={!dirty}>
              <div className="fold-in">
                <div className="mx-savebar">
                  <small>{t('Your changes aren’t saved yet.')}</small>
                  <button type="button" className="ghost-btn sm" tabIndex={dirty ? 0 : -1} onClick={() => setDraft(saved)}>
                    {t('Discard')}
                  </button>
                  <BusyButton busy={busy} onClick={() => void save()}>
                    {t('Save rules')}
                  </BusyButton>
                </div>
              </div>
            </div>

            <section className="set-block">
              <h3>{t('Mail log')}</h3>
              <MailLog entries={log} users={users} mailbox={(id) => ws.accounts.find((a) => a.id === id)?.email} limit={40} />
            </section>
          </div>
        )}
      </SmoothHeight>
    </>
  );
}

/** The parts of a policy people change (what the server adds, like when deleting starts, doesn't count as a change). */
const clean = (p: MailPolicy) => ({ days: p.retention?.days ?? 0, boxes: p.retention?.mailboxes ?? {}, holds: (p.holds ?? []).map((h) => [h.userId, h.reason]), dlp: (p.dlp ?? []).map((r) => [r.kind, r.words ?? '', r.action, r.on]), out: p.forwardOutside !== false });
