// Compose's extras (Gmail's "More options"): Reply-To, priority, confidential mode, plain text, spell check, sending as
// an alias, and a signature per address. The server checks and carries them (server/mailExtras.ts).
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, CornerUpLeft, Lock, SpellCheck, Type, X } from 'lucide-react';
import type { Account, Person, Workspace } from '../../types';
import type { SheetAction } from '../ui/ActionSheet';
import { Sheet } from '../ui/Sheet';
import { sanitize } from '../../sanitize';
import { mark, t, getLang } from '../../i18n';
import { fmtDateTime, fmtDayLong } from '../../i18n/format';

export type Priority = 'high' | 'low';
export type SpellLang = 'en' | 'id' | 'off';
export interface ConfidentialChoice {
  expiresAt: string; // ISO
  passcode: boolean;
}
/** What an email carries beyond its people, subject and words. */
export interface SendExtras {
  fromAddress?: string; // an alias of the mailbox (its own address when missing)
  replyTo?: Person[];
  priority?: Priority;
  confidential?: ConfidentialChoice;
  plain?: boolean; // plain text mode: no formatting goes out
}
/** A reply with what the reply box (or the popped-out compose) changed. */
export type ReplyOpts = SendExtras & { to?: Person[]; cc?: Person[]; bcc?: Person[]; subject?: string; files?: { name: string; url: string; size?: number }[] };

/** The fields /api/mail/send reads for these extras. */
export function extrasOf(x: SendExtras, acct?: Pick<Account, 'email'>) {
  return {
    ...(x.fromAddress && acct && x.fromAddress.toLowerCase() !== acct.email.toLowerCase() ? { fromAddress: x.fromAddress } : {}),
    ...(x.replyTo?.length ? { replyTo: x.replyTo } : {}),
    ...(x.priority ? { priority: x.priority } : {}),
    ...(x.confidential ? { confidential: x.confidential } : {}),
  };
}

/** The addresses a mailbox sends as: its own, then the aliases at the company's domain that deliver into it. */
export function sendersOf(ws: Pick<Workspace, 'domains' | 'mailAliases'>, acct: Pick<Account, 'id' | 'email'>): string[] {
  const domains = (ws.domains ?? []).map((d) => d.toLowerCase());
  const aliases = (ws.mailAliases ?? []).filter((al) => al.to.includes(acct.id) && domains.includes(al.address.split('@')[1]?.toLowerCase() ?? '')).map((al) => al.address.toLowerCase());
  return [acct.email.toLowerCase(), ...aliases.filter((a) => a !== acct.email.toLowerCase())];
}

/** The signature for an address: its own when one was set (even an empty one), else the person's usual signature. */
export function signatureFor(s: { signature: string; signatures?: Record<string, string> }, address: string | undefined) {
  const k = (address ?? '').toLowerCase();
  return k && s.signatures && k in s.signatures ? s.signatures[k] : s.signature;
}

/** The HTML as the editor holds it (what a signature looks like once it's inside the editor). */
const asEditor = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = sanitize(html);
  return d.innerHTML;
};
/** Swaps one signature for another in a body: in place when it's there, at the end when the body had none. */
export function swapSignature(body: string, from: string, to: string): string {
  const old = from ? asEditor(from) : '';
  const next = to ? asEditor(to) : '';
  if (old && body.includes(old)) return body.replace(old, next);
  if (!old && next) return `${body}${body.trim() ? '' : '<p><br></p>'}${next}`;
  return body;
}

/** The expiry choices (Gmail's): a day, a week, a month, three months, five years. */
const SPANS = () => [
  { id: '1d', label: t('1 day'), ms: 86_400_000 },
  { id: '1w', label: t('1 week'), ms: 7 * 86_400_000 },
  { id: '1m', label: t('1 month'), ms: 30 * 86_400_000 },
  { id: '3m', label: t('3 months'), ms: 91 * 86_400_000 },
  { id: '5y', label: t('5 years'), ms: 5 * 365 * 86_400_000 },
];
export const confidentialUntil = (c: ConfidentialChoice) => t('Confidential until {date}', { date: fmtDayLong(c.expiresAt) });

/** Confidential mode for one email: until when it can be opened, and whether people outside need a code. */
export function ConfidentialSheet({ value, onSave, onClose }: { value?: ConfidentialChoice; onSave: (c: ConfidentialChoice | undefined) => void; onClose: () => void }) {
  const spans = SPANS();
  const closest = value ? spans.reduce((a, b) => (Math.abs(Date.parse(value.expiresAt) - Date.now() - b.ms) < Math.abs(Date.parse(value.expiresAt) - Date.now() - a.ms) ? b : a)).id : '1w';
  const [span, setSpan] = useState(closest);
  const [code, setCode] = useState(value?.passcode ?? false);
  const pick = spans.find((x) => x.id === span) ?? spans[1];
  return (
    <Sheet
      title={t('Confidential mode')}
      onClose={onClose}
      className="cm-sheet"
      footer={
        <div className="cm-foot">
          {value && (
            <button type="button" className="ghost-btn" onClick={() => (onSave(undefined), onClose())}>
              {t('Turn off')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={() => (onSave({ expiresAt: new Date(Date.now() + pick.ms).toISOString(), passcode: code }), onClose())}>
            {t('Save')}
          </button>
        </div>
      }
    >
      <p className="cm-intro">{t('People can read it until it expires, and can’t forward, copy, print or download it. People outside sprint2go get a link to read it on our site. Nothing stops a screenshot.')}</p>
      <div className="cm-label">{t('Expires in')}</div>
      <div className="as-list cm-spans" role="radiogroup" aria-label={t('Expires in')}>
        {spans.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={span === x.id} className={`as-item${span === x.id ? ' on' : ''}`} onClick={() => setSpan(x.id)}>
            <span className="as-label">
              {x.label}
              <small>{t('Until {when}', { when: fmtDateTime(Date.now() + x.ms) })}</small>
            </span>
            {span === x.id && <Check size={16} className="as-check" />}
          </button>
        ))}
      </div>
      <label className="cm-code">
        <span>
          <strong>{t('Ask for a code')}</strong>
          <small>{t('People outside sprint2go get a code by email before it opens, so a forwarded link alone doesn’t work. Teammates are already signed in.')}</small>
        </span>
        <button type="button" role="switch" aria-checked={code} className={`switch ${code ? 'on' : ''}`} onClick={() => setCode((c) => !c)} aria-label={t('Ask for a code')}>
          <span />
        </button>
      </label>
    </Sheet>
  );
}

/** The spell check languages: the browser's own checker, told which language the email is in. */
export const SPELL: { id: SpellLang; label: string }[] = [
  { id: 'en', label: mark('Check spelling in English') },
  { id: 'id', label: mark('Check spelling in Indonesian') },
  { id: 'off', label: mark('Don’t check spelling') },
];
/** The language spelling is checked in, by default: the one the app speaks. */
export const defaultSpell = (): SpellLang => (getLang() === 'id' ? 'id' : 'en');

/** "More options" for one email: Reply-To, priority, confidential mode, plain text, spelling. */
export function moreOptions(x: SendExtras, set: (patch: Partial<SendExtras>) => void, opts: { showReplyTo: boolean; onReplyTo: () => void; onConfidential: () => void; spell: SpellLang; onSpell: (s: SpellLang) => void; canConfidential?: boolean }): SheetAction[] {
  return [
    { label: t('Reply-to address'), icon: CornerUpLeft, checked: opts.showReplyTo, group: 'x', run: opts.onReplyTo },
    { label: t('High priority'), icon: ArrowUp, checked: x.priority === 'high', group: 'p', run: () => set({ priority: x.priority === 'high' ? undefined : 'high' }) },
    { label: t('Low priority'), icon: ArrowDown, checked: x.priority === 'low', group: 'p', run: () => set({ priority: x.priority === 'low' ? undefined : 'low' }) },
    ...(opts.canConfidential === false ? [] : [{ label: t('Confidential mode…'), icon: Lock, checked: !!x.confidential, hint: x.confidential ? confidentialUntil(x.confidential) : undefined, group: 'c', run: opts.onConfidential }]),
    { label: t('Plain text mode'), icon: Type, checked: !!x.plain, group: 'c', run: () => set({ plain: !x.plain }) },
    ...SPELL.map((s) => ({ label: t(s.label), icon: s.id === 'off' ? X : SpellCheck, checked: opts.spell === s.id, group: 's', run: () => opts.onSpell(s.id) })),
  ];
}

/** What's switched on for this email, as chips under the subject, each with a way to change or remove it. */
export function OptionChips({ x, set, onConfidential }: { x: SendExtras; set: (patch: Partial<SendExtras>) => void; onConfidential: () => void }) {
  if (!x.priority && !x.confidential && !x.plain) return null;
  return (
    <div className="cx-chips">
      {x.confidential && (
        <span className="cx-chip cx-conf">
          <button type="button" className="cx-chip-main" onClick={onConfidential} title={t('Change')}>
            <Lock size={13} /> {confidentialUntil(x.confidential)}
            {x.confidential.passcode ? ` · ${t('code by email')}` : ''}
          </button>
          <button type="button" className="cx-chip-x" onClick={() => set({ confidential: undefined })} aria-label={t('Turn off confidential mode')}>
            <X size={13} />
          </button>
        </span>
      )}
      {x.priority && (
        <span className="cx-chip">
          <span className="cx-chip-main">
            {x.priority === 'high' ? <ArrowUp size={13} /> : <ArrowDown size={13} />} {x.priority === 'high' ? t('High priority') : t('Low priority')}
          </span>
          <button type="button" className="cx-chip-x" onClick={() => set({ priority: undefined })} aria-label={t('Remove priority')}>
            <X size={13} />
          </button>
        </span>
      )}
      {x.plain && (
        <span className="cx-chip">
          <span className="cx-chip-main">
            <Type size={13} /> {t('Plain text')}
          </span>
          <button type="button" className="cx-chip-x" onClick={() => set({ plain: false })} aria-label={t('Back to formatting')}>
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
