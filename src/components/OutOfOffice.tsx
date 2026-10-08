import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Account, AwayReply } from '../types';
import { DatePicker, shortDate } from './ui/DatePicker';

type Draft = { on: boolean; from: string; until: string; subject: string; message: string };
const draftOf = (a?: AwayReply): Draft => ({ on: !!a?.on, from: a?.from ?? '', until: a?.until ?? '', subject: a?.subject ?? '', message: a?.message ?? '' });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const today = () => new Date().toLocaleDateString('en-CA');

/** Settings, Mail & signature: an automatic answer per mailbox while you're away. */
export function OutOfOffice({ accounts, canSend, onSave }: { accounts: Account[]; canSend: (id: string) => string | null; onSave: (a: Account, away: Omit<AwayReply, 'since'>) => Promise<string | null> }) {
  if (!accounts.length) return null;
  return (
    <>
      <h3>Out of office</h3>
      <small className="set-hint ooo-hint">An automatic answer while you’re away. Each person gets it once every 4 days; mailing lists, newsletters and other automatic mail don’t.</small>
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
    ? `Can’t answer yet. ${blocked}`
    : !saved.on
      ? 'Off'
      : saved.until && saved.until < now
        ? `Ended ${shortDate(saved.until)}. Switch it off, or pick new dates.`
        : saved.from && saved.from > now
          ? `Starts ${shortDate(saved.from)}${saved.until ? `, until ${shortDate(saved.until)}` : ''}`
          : `On${saved.until ? ` until ${shortDate(saved.until)}` : ''}. People who write get your answer.`;

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
    if (err) setError(err);
    return !err;
  };
  const toggle = () => {
    if (blocked && !saved.on) return setError('');
    if (draft.on && saved.on) return void save({ ...draft, on: false }).then((ok) => ok && setDraft({ ...draft, on: false }));
    if (draft.on) return setDraft(saved); // switched on, never saved: put it back
    setDraft({ ...draft, on: true, message: draft.message || `Thanks for your email. I’m away${draft.until ? ` until ${shortDate(draft.until)}` : ''} with little access to email, and I’ll reply when I’m back.` });
  };
  const datesWrong = !!draft.from && !!draft.until && draft.until < draft.from;

  return (
    <div className={`ooo ${open ? 'open' : ''}`}>
      <label className="set-row toggle-row">
        <span>
          <strong>{many ? account.email : 'Automatic answer'}</strong>
          <small className={blocked ? 'ooo-warn' : undefined}>{status}</small>
        </span>
        <button role="switch" aria-checked={draft.on} aria-disabled={blocked && !saved.on ? true : undefined} title={blocked && !saved.on ? blocked : undefined} className={`switch ${draft.on ? 'on' : ''} ${blocked && !saved.on ? 'off' : ''}`} onClick={toggle} disabled={busy}>
          <span />
        </button>
      </label>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="ooo-form">
            <div className="ooo-dates">
              <div className="field">
                <label>First day away</label>
                <DatePicker value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} label="First day away" placeholder="From now" />
              </div>
              <div className="field">
                <label>Last day away</label>
                <DatePicker value={draft.until} onChange={(v) => setDraft({ ...draft, until: v })} label="Last day away" placeholder="Until I switch it off" />
              </div>
            </div>
            {datesWrong && <small className="err">The last day is before the first.</small>}
            <div className="field">
              <label>Subject</label>
              <input value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Out of office: their subject" />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea rows={4} value={draft.message} maxLength={5000} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
            </div>
            {error && <small className="err">{error}</small>}
            <div className="ooo-actions">
              {dirty && (
                <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => (setDraft(saved), setError(''))}>
                  {saved.on ? 'Undo changes' : 'Cancel'}
                </button>
              )}
              <button type="button" className="primary-btn sm" disabled={busy || !dirty || !draft.message.trim() || datesWrong} onClick={() => void save(draft)}>
                {busy && <Loader2 size={14} className="spin" />} {saved.on ? 'Save changes' : 'Turn on'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
