// Reading tools for one message (Gmail's): show original, download the .eml, print (one message or the conversation)
// and translate. The server does the work (server/mailExtras.ts, /api/ai/translate).
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { isPhone } from '../../mobile/media';
import { server } from '../../sync';
import { toast } from '../../toast';
import { getLang, t, tx } from '../../i18n';
import { fmtDateTime } from '../../i18n/format';
import { isSandboxId } from '../../sandbox';

const q = (threadId: string, messageId?: string) => `thread=${encodeURIComponent(threadId)}${messageId ? `&message=${encodeURIComponent(messageId)}` : ''}`;

/** Prints one message (or the whole conversation): our clean page, printed from a hidden frame (a new tab on phones). */
export function printMail(threadId: string, messageId?: string) {
  if (!server.on) return toast({ text: t('Printing needs the sprint2go server.') });
  const url = `/api/mail/print?${q(threadId, messageId)}&auto=1`;
  if (isPhone()) return void window.open(url, '_blank', 'noopener');
  document.querySelectorAll('iframe.print-frame').forEach((f) => f.remove());
  const f = document.createElement('iframe');
  f.className = 'print-frame';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.src = url;
  document.body.appendChild(f);
  // The page prints itself once it's loaded; the frame goes a while after.
  setTimeout(() => f.remove(), 120_000);
}

/** Downloads a message as it was sent or received (.eml). */
export function downloadEml(threadId: string, messageId: string) {
  if (!server.on) return toast({ text: t('Downloading a message needs the sprint2go server.') });
  const a = document.createElement('a');
  a.href = `/api/mail/original?${q(threadId, messageId)}&download=1`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The reader's language for translations, as the AI understands it. */
export const readerLanguage = () => (getLang() === 'id' ? 'Indonesian' : 'English');

/** A message in the reader's language (the company's AI). Throws 'needs-ai' when there's no AI here. */
export async function translateText(text: string, workspaceId: string): Promise<{ text: string; from: string }> {
  if (!server.on || isSandboxId(workspaceId)) throw new Error('needs-ai');
  const r = await fetch('/api/ai/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, text: text.slice(0, 20_000), to: readerLanguage() }) });
  if (r.status === 409 || r.status === 403) throw new Error('needs-ai');
  if (!r.ok) throw new Error('failed');
  return r.json();
}

type Original = { subject: string; messageId: string | null; date: string; from: string; to: string; cc: string; auth: { spf?: string; dkim?: string; dmarc?: string }; signedBy: string | null; kind: 'raw' | 'built'; size: number; source: string; cut: boolean };

const Verdict = ({ v }: { v?: string }) => {
  const ok = v === 'pass';
  const bad = v === 'fail' || v === 'softfail' || v === 'permerror';
  const Icon = ok ? ShieldCheck : bad ? ShieldAlert : ShieldQuestion;
  return (
    <span className={`og-verdict ${ok ? 'pass' : bad ? 'fail' : 'none'}`}>
      <Icon size={14} /> {v ? v.toUpperCase() : tx('auth check', 'Not checked')}
    </span>
  );
};

/** Show original: the details Gmail shows (ID, date, people, SPF, DKIM, DMARC) and the source, with Copy and Download. */
export function OriginalSheet({ threadId, messageId, onClose }: { threadId: string; messageId: string; onClose: () => void }) {
  const [o, setO] = useState<Original | 'loading' | 'failed'>('loading');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!server.on) return setO('failed');
    let live = true;
    fetch(`/api/mail/original?${q(threadId, messageId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Original) => live && setO(d))
      .catch(() => live && setO('failed'));
    return () => void (live = false);
  }, [threadId, messageId]);
  const sent = o !== 'loading' && o !== 'failed' && !o.auth.spf && !o.auth.dmarc;
  return (
    <Sheet
      title={t('Original message')}
      onClose={onClose}
      size="tall"
      className="og-sheet"
      footer={
        o !== 'loading' && o !== 'failed' ? (
          <div className="og-foot">
            <button type="button" className="ghost-btn" onClick={() => void navigator.clipboard?.writeText(o.source).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('Copied') : t('Copy to clipboard')}
            </button>
            <span className="spacer" />
            <button type="button" className="primary-btn" onClick={() => downloadEml(threadId, messageId)}>
              <Download size={15} /> {t('Download (.eml)')}
            </button>
          </div>
        ) : undefined
      }
    >
      {o === 'loading' ? (
        <div className="og-wait">
          <Loader2 size={18} className="spin" />
        </div>
      ) : o === 'failed' ? (
        <p className="og-note">{t('The original couldn’t be loaded. It needs the sprint2go server.')}</p>
      ) : (
        <>
          <dl className="og-facts">
            <dt>{t('Message ID')}</dt>
            <dd className="mono">{o.messageId ?? t('None')}</dd>
            <dt>{t('Created at')}</dt>
            <dd>{fmtDateTime(o.date)}</dd>
            <dt>{t('From')}</dt>
            <dd>{o.from}</dd>
            <dt>{t('To')}</dt>
            <dd>{o.to || t('None')}</dd>
            {o.cc && (
              <>
                <dt>Cc</dt>
                <dd>{o.cc}</dd>
              </>
            )}
            <dt>{t('Subject')}</dt>
            <dd>{o.subject || t('(no subject)')}</dd>
            {sent ? (
              <>
                <dt>DKIM</dt>
                <dd>{o.signedBy ? t('Signed by {domain}', { domain: o.signedBy }) : t('Not signed')}</dd>
              </>
            ) : (
              <>
                <dt>SPF</dt>
                <dd>
                  <Verdict v={o.auth.spf} />
                </dd>
                <dt>DKIM</dt>
                <dd>
                  <Verdict v={o.auth.dkim} /> {o.signedBy && <span className="og-dim">{t('Signed by {domain}', { domain: o.signedBy })}</span>}
                </dd>
                <dt>DMARC</dt>
                <dd>
                  <Verdict v={o.auth.dmarc} />
                </dd>
              </>
            )}
          </dl>
          {o.kind === 'built' && <p className="og-note">{t('This copy was rebuilt from the conversation; its first source wasn’t kept.')}</p>}
          <pre className="og-source" tabIndex={0}>
            {o.source}
            {o.cut ? `\n\n${t('(The rest is in the download.)')}` : ''}
          </pre>
        </>
      )}
    </Sheet>
  );
}
