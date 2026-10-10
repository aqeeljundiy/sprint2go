import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Account, AwayReply } from '../types';
import { DatePicker, shortDate } from './ui/DatePicker';
import { t } from '../i18n';
import { fmtDayLong } from '../i18n/format';
import { usePhone } from '../mobile/media';
import { EditScreen, GField, GRow, Group, SwitchRow } from './ui/Grouped';

type Draft = { on: boolean; from: string; until: string; subject: string; message: string };
const draftOf = (a?: AwayReply): Draft => ({ on: !!a?.on, from: a?.from ?? '', until: a?.until ?? '', subject: a?.subject ?? '', message: a?.message ?? '' });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const today = () => new Date().toLocaleDateString('en-CA');
/** The server's message, translated; "Out of office can’t answer yet. <why>" has the server's reason inside it. */
const serverText = (e: string) => {
  const m = /^Out of office can’t answer yet\. (.+)$/s.exec(e);
  return m ? t('Out of office can’t answer yet. {why}', { why: t(m[1]) }) : t(e);
};

/** Settings, Mail & signature: an automatic answer per mailbox while you're away. */
export function OutOfOffice({ accounts, canSend, onSave }: { accounts: Account[]; canSend: (id: string) => string | null; onSave: (a: Account, away: Omit<AwayReply, 'since'>) => Promise<string | null> }) {
  const phone = usePhone();
  if (!accounts.length) return null;
  // Phones (iOS Settings): a row per mailbox with its state; the dates and the message on the mailbox's own screen.
  if (phone)
    return (
      <Group title={t('Out of office')} footer={t('An automatic answer while you’re away. Each person gets it once every 4 days; mailing lists, newsletters and other automatic mail don’t.')}>
          {accounts.map((a) => (
            <AwayPhoneRow key={a.id} account={a} many={accounts.length > 1} blocked={canSend(a.id)} onSave={(away) => onSave(a, away)} />
          ))}
      </Group>
    );
  return (
    <>
      <h3>{t('Out of office')}</h3>
      <small className="set-hint ooo-hint">{t('An automatic answer while you’re away. Each person gets it once every 4 days; mailing lists, newsletters and other automatic mail don’t.')}</small>
      <div className="ooo-list">
        {accounts.map((a) => (
          <AwayRow key={a.id} account={a} many={accounts.length > 1} blocked={canSend(a.id)} onSave={(away) => onSave(a, away)} />
        ))}
      </div>
    </>
  );
}

function AwayRow({ account, many, blocked, onSave }: { account: Account; many: boolean; blocked: string | null; onSave: (away: Omit<AwayReply, 'since'>) => Promise<string | null> }) {
  const saved = draftOf(account.away);
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A change saved elsewhere (another device, an admin) shows here unless you're in the middle of editing.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft((d) => (same(d, saved) || !d.on ? saved : d));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !same(draft, saved);
  const open = draft.on;
  const now = today();
  const status = blocked
    ? t('Can’t answer yet. {why}', { why: t(blocked) })
    : !saved.on
      ? t('Off')
      : saved.until && saved.until < now
        ? t('Ended {date}. Switch it off, or pick new dates.', { date: shortDate(saved.until) })
        : saved.from && saved.from > now
          ? saved.until
            ? t('Starts {from}, until {until}', { from: shortDate(saved.from), until: shortDate(saved.until) })
            : t('Starts {from}', { from: shortDate(saved.from) })
          : saved.until
            ? t('On until {until}. People who write get your answer.', { until: shortDate(saved.until) })
            : t('On. People who write get your answer.');

  const save = async (next: Draft) => {
    setBusy(true);
    setError('');
    const err = await onSave({
      on: next.on,
      from: next.from || undefined,
      until: next.until || undefined,
      fromAt: next.from ? new Date(`${next.from}T00:00`).toISOString() : undefined,
      untilAt: next.until ? new Date(`${next.until}T23:59:59.999`).toISOString() : undefined,
      subject: next.subject.trim(),
      message: next.message.trim(),
    });
    setBusy(false);
    if (err) setError(serverText(err));
    return !err;
  };
  const toggle = () => {
    if (blocked && !saved.on) return setError('');
    if (draft.on && saved.on) return void save({ ...draft, on: false }).then((ok) => ok && setDraft({ ...draft, on: false }));
    if (draft.on) return setDraft(saved); // switched on, never saved: put it back
    setDraft({ ...draft, on: true, message: draft.message || (draft.until ? t('Thanks for your email. I’m away until {until} with little access to email, and I’ll reply when I’m back.', { until: fmtDayLong(draft.until) }) : t('Thanks for your email. I’m away with little access to email, and I’ll reply when I’m back.')) });
  };
  const datesWrong = !!draft.from && !!draft.until && draft.until < draft.from;

  return (
    <div className={`ooo ${open ? 'open' : ''}`}>
      <label className="set-row toggle-row">
        <span>
          <strong>{many ? account.email : t('Automatic answer')}</strong>
          <small className={blocked ? 'ooo-warn' : undefined}>{status}</small>
        </span>
        <button role="switch" aria-checked={draft.on} aria-disabled={blocked && !saved.on ? true : undefined} title={blocked && !saved.on ? t(blocked) : undefined} className={`switch ${draft.on ? 'on' : ''} ${blocked && !saved.on ? 'off' : ''}`} onClick={toggle} disabled={busy}>
          <span />
        </button>
      </label>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="ooo-form">
            <div className="ooo-dates">
              <div className="field">
                <label>{t('First day away')}</label>
                <DatePicker value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} label={t('First day away')} placeholder={t('From now')} />
              </div>
              <div className="field">
                <label>{t('Last day away')}</label>
                <DatePicker value={draft.until} onChange={(v) => setDraft({ ...draft, until: v })} label={t('Last day away')} placeholder={t('Until I switch it off')} />
              </div>
            </div>
            {datesWrong && <small className="err">{t('The last day is before the first.')}</small>}
            <div className="field">
              <label>{t('Subject')}</label>
              <input value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder={t('Out of office: their subject')} />
            </div>
            <div className="field">
              <label>{t('Message')}</label>
              <textarea rows={4} value={draft.message} maxLength={5000} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
            </div>
            {error && <small className="err">{error}</small>}
            <div className="ooo-actions">
              {dirty && (
                <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => (setDraft(saved), setError(''))}>
                  {saved.on ? t('Undo changes') : t('Cancel')}
                </button>
              )}
              <button type="button" className="primary-btn sm" disabled={busy || !dirty || !draft.message.trim() || datesWrong} onClick={() => void save(draft)}>
                {busy && <Loader2 size={14} className="spin" />} {saved.on ? t('Save changes') : t('Turn on')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A mailbox's out of office on a phone: its state on the row; its own screen has the switch, the dates and the message. */
function AwayPhoneRow({ account, many, blocked, onSave }: { account: Account; many: boolean; blocked: string | null; onSave: (away: Omit<AwayReply, 'since'>) => Promise<string | null> }) {
  const saved = draftOf(account.away);
  const [open, setOpen] = useState(false);
  const now = today();
  const value = blocked && !saved.on ? t('Can’t answer yet') : !saved.on ? t('Off') : saved.until && saved.until < now ? t('Ended') : saved.until ? t('Until {date}', { date: shortDate(saved.until) }) : t('On');
  return (
    <>
      <GRow label={many ? account.email : t('Automatic answer')} value={value} onClick={() => setOpen(true)} />
      {open && <AwayScreen title={many ? account.email : t('Automatic answer')} saved={saved} blocked={blocked} onSave={onSave} onBack={() => setOpen(false)} />}
    </>
  );
}

function AwayScreen({ title, saved, blocked, onSave, onBack }: { title: string; saved: Draft; blocked: string | null; onSave: (away: Omit<AwayReply, 'since'>) => Promise<string | null>; onBack: () => void }) {
  const [draft, setDraft] = useState<Draft>(saved);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const datesWrong = !!draft.from && !!draft.until && draft.until < draft.from;
  const turnOn = (on: boolean) =>
    set({ on, message: draft.message || (!on ? '' : draft.until ? t('Thanks for your email. I’m away until {until} with little access to email, and I’ll reply when I’m back.', { until: fmtDayLong(draft.until) }) : t('Thanks for your email. I’m away with little access to email, and I’ll reply when I’m back.')) });
  const can = !same(draft, saved) && !datesWrong && (!draft.on || !!draft.message.trim()) && !(blocked && draft.on && !saved.on);
  return (
    <EditScreen
      title={title}
      onBack={onBack}
      canSave={can}
      onSave={async () => {
        const err = await onSave({
          on: draft.on,
          from: draft.from || undefined,
          until: draft.until || undefined,
          fromAt: draft.from ? new Date(`${draft.from}T00:00`).toISOString() : undefined,
          untilAt: draft.until ? new Date(`${draft.until}T23:59:59.999`).toISOString() : undefined,
          subject: draft.subject.trim(),
          message: draft.message.trim(),
        });
        return err ? serverText(err) : null;
      }}
    >
      <Group footer={blocked ? t('Can’t answer yet. {why}', { why: t(blocked) }) : t('An automatic answer while you’re away. Each person gets it once every 4 days; mailing lists, newsletters and other automatic mail don’t.')}>
        <SwitchRow label={t('Automatic answer')} on={draft.on} onChange={turnOn} disabled={!!blocked && !saved.on} />
      </Group>
      <div className={`fold ${draft.on ? 'open' : ''}`}>
        <div className="fold-in">
          <Group footer={datesWrong ? <span className="g-err">{t('The last day is before the first.')}</span> : undefined}>
            <GRow label={t('First day away')} chevron accessory={<span className="g-inline"><DatePicker value={draft.from} onChange={(v) => set({ from: v })} label={t('First day away')} placeholder={t('From now')} /></span>} />
            <GRow label={t('Last day away')} chevron accessory={<span className="g-inline"><DatePicker value={draft.until} onChange={(v) => set({ until: v })} label={t('Last day away')} placeholder={t('Until I switch it off')} /></span>} />
          </Group>
          <p className="g-field-label">{t('Subject')}</p>
          <Group>
            <GField value={draft.subject} onChange={(v) => set({ subject: v })} label={t('Subject')} placeholder={t('Out of office: their subject')} maxLength={200} />
          </Group>
          <p className="g-field-label">{t('Message')}</p>
          <Group>
            <GField value={draft.message} onChange={(v) => set({ message: v })} label={t('Message')} multiline maxLength={5000} />
          </Group>
        </div>
      </div>
    </EditScreen>
  );
}
