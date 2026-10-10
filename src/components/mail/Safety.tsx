// Phishing and spam in the reader: a clear banner when an email looks dangerous (the signs the server found on arrival,
// src/mailSafety.ts), why an email is in Spam with Not spam next to it, and links checked when they're clicked, with a
// warning page for the suspicious ones. Report phishing is here too.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellOff, Flag, FolderInput, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react';
import type { SheetAction } from '../ui/ActionSheet';
import { toast } from '../../toast';
import type { MailWarning, Thread } from '../../types';
import { checkLink, warningLevel, type LinkWhy } from '../../mailSafety';
import { isMine, ownDomains } from '../../identity';
import { Layer } from '../ui/Layer';
import { deleteForever, markImportant, mute, reportPhishing } from './sortPrefs';
import { mark, t } from '../../i18n';

/** The signs on the mail others sent in this conversation (each kind once). */
export function warningsOf(th: Thread): MailWarning[] {
  const out: MailWarning[] = [];
  for (const m of th.messages) if (!isMine(m.from.email)) for (const w of m.warn ?? []) if (!out.some((x) => x.kind === w.kind)) out.push(w);
  return out;
}

const signWords = (w: MailWarning): string => {
  switch (w.kind) {
    case 'auth':
      return t('The sender couldn’t be verified: {domain} didn’t pass the checks that prove who sent it.', { domain: w.detail ?? '' });
    case 'lookalike':
      return t('The sender’s address imitates {domain}, but it isn’t.', { domain: w.detail ?? '' });
    case 'spoof':
      return t('It uses the name of {name}, from an address that isn’t theirs.', { name: w.detail ?? '' });
    case 'links':
      return t('A link shows one address but goes to {host}.', { host: w.detail ?? '' });
    case 'first':
      return t('This is the first email from this address.');
    case 'reported':
      return t('Someone here reported it as phishing.');
  }
};

/** Why the server put an email in Spam (server/mailSmart.ts scoreSpam), in the reader's language. */
export const SPAM_REASONS = [
  mark('failed sender checks'),
  mark('the sender couldn’t be verified'),
  mark('the sender’s server is on a blocklist'),
  mark('gambling or pills'),
  mark('promises a prize'),
  mark('offers money'),
  mark('asks for a money transfer'),
  mark('reads like a form letter'),
  mark('offers a loan'),
  mark('scares you about your account'),
  mark('a subject in capitals'),
  mark('only a picture'),
  mark('links to bare server addresses'),
  mark('links that hide where they go'),
  mark('imitates a known sender'),
  mark('pretends to be a colleague'),
  mark('reported by your company before'),
  mark('looks like mail your company reported'),
];

const linkWords = (why: LinkWhy, host: string, looks?: string): string => {
  switch (why) {
    case 'scheme':
      return t('It would run something instead of opening a page.');
    case 'ip':
      return t('It goes to a bare server address ({host}) instead of a named site.', { host });
    case 'punycode':
      return t('Its address uses look-alike letters ({host}).', { host });
    case 'userinfo':
      return t('Its address hides the real site after an @.');
    case 'lookalike':
      return t('{host} imitates {domain}.', { host, domain: looks ?? '' });
    case 'mismatch':
      return t('The link’s words show a different site than where it goes ({host}).', { host });
    case 'shortener':
      return t('It’s a shortened link in an email that already looks suspicious, so where it goes is hidden.');
  }
};

/**
 * Above the conversation: the phishing banner (red when it's likely phishing, amber to be careful) and, in Spam, why
 * it's there with Not spam. Also checks links clicked inside the messages.
 */
export function MailSafety({ thread, onNotSpam }: { thread: Thread; onNotSpam: (id: string) => void }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [link, setLink] = useState<{ href: string; reasons: string[] } | null>(null);
  const warn = warningsOf(thread);
  const level = warningLevel(warn);
  const spamRef = useRef(false);
  spamRef.current = thread.location === 'spam';

  // Links in the messages: checked on click; a suspicious one opens the warning page instead.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !a.closest('.reader-scroll .prose')) return;
      const href = a.getAttribute('href') ?? '';
      const r = checkLink(href, a.textContent ?? '', ownDomains(), !!level);
      const reasons = r.why.map((w) => linkWords(w, r.host, r.looks));
      // Every web link in Spam gets the warning first.
      if (!reasons.length && spamRef.current && /^https?:/i.test(href)) reasons.push(t('It’s in an email in Spam.'));
      if (!reasons.length) return;
      e.preventDefault();
      e.stopPropagation();
      setLink({ href, reasons });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [level]);

  const inSpam = thread.location === 'spam';
  const showWarn = level && dismissed !== thread.id;
  return (
    <>
      {inSpam && level !== 'danger' && (
        <div className="list-banner safety-spam">
          <ShieldAlert size={16} />
          <span>
            {warn.some((w) => w.kind === 'reported') || thread.spamWhy?.includes('phishing')
              ? t('This email was reported as phishing.')
              : thread.spamWhy?.length
                ? t('Why it’s in Spam: {why}.', { why: thread.spamWhy.map((w) => t(w)).join(', ') })
                : t('This email is in Spam.')}{' '}
            {t('Its links open only after a warning.')}
          </span>
          <button type="button" className="ghost-btn outline sm" onClick={() => onNotSpam(thread.id)}>
            <ShieldCheck size={13} /> {t('Not spam')}
          </button>
        </div>
      )}
      {(inSpam ? level === 'danger' : showWarn) && (
        <div className={`safety-banner ${level}`} role="alert">
          <AlertTriangle size={18} className="safety-icon" />
          <div className="safety-words">
            <strong>{level === 'danger' ? t('This email looks like phishing') : t('Be careful with this email')}</strong>
            <ul>
              {warn.map((w) => (
                <li key={w.kind}>{signWords(w)}</li>
              ))}
            </ul>
            <small>{t('Don’t open its links or files, or reply with passwords, codes or payment details, unless you’ve checked with the sender another way.')}</small>
            <span className="safety-actions">
              {!warn.some((w) => w.kind === 'reported') && (
                <button type="button" className="ghost-btn outline sm safety-report" onClick={() => reportPhishing([thread.id])}>
                  {t('Report phishing')}
                </button>
              )}
              {inSpam ? (
                <button type="button" className="ghost-btn sm" onClick={() => onNotSpam(thread.id)}>
                  <ShieldCheck size={13} /> {t('Not spam')}
                </button>
              ) : (
                <button type="button" className="ghost-btn sm" onClick={() => setDismissed(thread.id)}>
                  {t('It’s safe')}
                </button>
              )}
            </span>
          </div>
        </div>
      )}
      {link && <LinkWarning href={link.href} reasons={link.reasons} onClose={() => setLink(null)} />}
    </>
  );
}

/** The warning page for a suspicious link: where it really goes, why, Go back (the default) or Open anyway. */
export function LinkWarning({ href, reasons, onClose }: { href: string; reasons: string[]; onClose: () => void }) {
  let shown = href;
  try {
    const u = new URL(href);
    shown = u.host + (u.pathname.length > 1 ? u.pathname : '');
  } catch {
    /* not a web address */
  }
  const scheme = /^(javascript|data|vbscript|file):/i.test(href);
  return (
    <Layer>
      <div className="modal-scrim" onMouseDown={onClose}>
        <div className="modal link-warn" role="alertdialog" aria-label={t('This link might not be safe')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
          <header className="modal-head">
            <span>{t('This link might not be safe')}</span>
            <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
              <X size={15} />
            </button>
          </header>
          <div className="modal-body">
            <div className="lw-hero">
              <span className="lw-icon">
                <ShieldAlert size={22} />
              </span>
              <div>
                <small>{t('It goes to')}</small>
                <code className="lw-url">{shown}</code>
              </div>
            </div>
            <ul className="lw-why">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="set-hint">{t('If you weren’t expecting it, go back. Sites like this often ask for a password or payment details.')}</p>
          </div>
          <footer className="modal-foot">
            {!scheme && (
              <button type="button" className="ghost-btn" onClick={() => (window.open(href, '_blank', 'noopener,noreferrer'), onClose())}>
                {t('Open anyway')}
              </button>
            )}
            <button type="button" className="primary-btn" autoFocus onClick={onClose}>
              {t('Go back')}
            </button>
          </footer>
        </div>
      </div>
    </Layer>
  );
}

/** Opens "Move to" for these emails (MailShortcuts, mounted once in Mail, shows it). */
export const openMoveTo = (ids: string[]) => window.dispatchEvent(new CustomEvent('s2g:mail-move', { detail: ids }));

/** The reader's extra actions: Move to, Mute, Important, Report phishing, and Delete forever in Spam and Trash. */
export function smartMenu(th: Thread): SheetAction[] {
  const out: SheetAction[] = [
    { label: t('Move to…'), icon: FolderInput, group: 'move', run: () => openMoveTo([th.id]) },
    { label: th.important ? t('Mark not important') : t('Mark important'), icon: Flag, group: 'move', run: () => markImportant([th.id], !th.important) },
    { label: th.muted ? t('Unmute') : t('Mute'), icon: BellOff, group: 'move', checked: !!th.muted, run: () => mute([th.id], !th.muted) },
  ];
  if (th.location !== 'spam' && th.location !== 'drafts' && th.messages.some((m) => !isMine(m.from.email))) out.push({ label: t('Report phishing'), icon: ShieldAlert, group: 'end', run: () => reportPhishing([th.id]) });
  if (th.location === 'trash' || th.location === 'spam') out.push({ label: t('Delete forever'), icon: Trash2, danger: true, group: 'end', run: () => (deleteForever([th.id]), toast({ text: t('Deleted for good') })) });
  return out;
}
