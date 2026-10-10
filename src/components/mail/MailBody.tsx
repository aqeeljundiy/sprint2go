// One message's words in the reader, desktop and phone: HTML mail as it was sent (in a sandboxed frame, pictures
// through our proxy, a "Show pictures" bar for senders that couldn't be verified), a translation in its place, and
// confidential mode (the words opened from the server while access lasts, with nothing to copy).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Languages, Lock, Loader2, ShieldAlert, Undo2 } from 'lucide-react';
import type { ConfidentialMeta, Message } from '../../types';
import { mailHtml, hasOutsidePictures } from './mailHtml';
import { usePersisted } from '../../settings';
import { server } from '../../sync';
import { toast } from '../../toast';
import { t, tx } from '../../i18n';
import { fmtDateTime } from '../../i18n/format';

/** What SPF, DKIM and DMARC said about a received message: it failed when DMARC failed, or SPF failed without DKIM. */
export function authFailed(auth?: string) {
  if (!auth) return false;
  const v = (k: string) => auth.match(new RegExp(`\\b${k}=([a-z]+)`, 'i'))?.[1]?.toLowerCase();
  return v('dmarc') === 'fail' || (v('spf') === 'fail' && v('dkim') !== 'pass');
}

/** The app's theme, kept up to date (the frame's colours follow it). */
function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => {
      const d = root.dataset.theme === 'dark';
      setDark((was) => (was === d ? was : d));
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/**
 * The email's HTML in a frame of its own: no scripts (sandbox without allow-scripts, and a CSP), links open in a new
 * tab, its CSS can't reach the app. It grows to its content, fits a wide newsletter to the width (zoomed out, like
 * Gmail on phones), and in dark mode a plain email takes the app's colours while a designed one sits on white paper.
 */
export function MailFrame({ html, css, designed, noCopy = false, label }: { html: string; css: string; designed: boolean; noCopy?: boolean; label: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const dark = useDark();
  const paper = dark && designed;
  const doc = useMemo(() => {
    const cs = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const text = paper || !dark ? '#16161d' : cs.color;
    const link = paper || !dark ? '#1a56db' : root.getPropertyValue('--accent').trim() || '#8ab4f8';
    const font = cs.fontFamily;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>
html,body{margin:0;padding:0;background:transparent}
body{color:${text};font:14.5px/1.6 ${font};overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
a{color:${link}}
img{max-width:100%;height:auto}
img[data-hidden-img]{display:inline-block;min-width:16px;min-height:16px;background:rgba(127,127,127,.12);border-radius:4px}
blockquote{margin:.5em 0;padding:2px 0 2px 12px;border-left:3px solid rgba(127,127,127,.35);opacity:.85}
p{margin:0 0 .75em}
pre{white-space:pre-wrap}
#s2g-root{display:flow-root}
${noCopy ? 'html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}@media print{body{display:none}}' : ''}
</style><style>${css.replace(/<\//g, '<\\/')}</style></head><body><div id="s2g-root">${html}</div></body></html>`;
  }, [html, css, dark, paper, noCopy]);

  // Height follows the content (pictures that load later too); a wide email is zoomed out to the frame's width.
  useLayoutEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const d = f.contentDocument;
      const root = d?.getElementById('s2g-root') as HTMLElement | null;
      if (!d || !root) return;
      root.style.zoom = '';
      const wide = root.scrollWidth;
      const room = f.clientWidth;
      if (wide > room + 2 && room > 0) root.style.zoom = String(Math.max(0.4, room / wide));
      // The end of the content, measured where it really is (zoom included, whatever the engine).
      let end = d.getElementById('s2g-end');
      if (!end) {
        end = d.createElement('div');
        end.id = 's2g-end';
        d.body.appendChild(end);
      }
      const h = Math.ceil(end.getBoundingClientRect().top + (f.contentWindow?.scrollY ?? 0));
      setHeight((was) => (Math.abs(was - h) > 1 ? h : was));
    };
    const ready = () => {
      const d = f.contentDocument;
      if (!d) return;
      fit();
      ro?.disconnect();
      ro = new ResizeObserver(() => fit());
      if (d.body) ro.observe(d.body);
      ro.observe(f);
      d.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit, { once: true }));
      // Nothing to copy from a confidential email.
      if (noCopy) for (const ev of ['copy', 'cut', 'contextmenu', 'dragstart'] as const) d.addEventListener(ev, (e) => e.preventDefault());
    };
    f.addEventListener('load', ready);
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.getElementById('s2g-root')) ready();
    return () => {
      f.removeEventListener('load', ready);
      ro?.disconnect();
    };
  }, [doc, noCopy]);

  return (
    <div className={`mail-frame${paper ? ' paper' : ''}`}>
      <iframe ref={frame} title={label} srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" style={{ height }} />
    </div>
  );
}

/** Plain text, as paragraphs (links stay text: plain mail is shown as written). */
const Paragraphs = ({ text }: { text: string }) => (
  <>
    {text.split('\n\n').map((para, i) => (
      <p key={i}>{para}</p>
    ))}
  </>
);

export type Translation = { text: string; from: string } | 'loading' | 'needs-ai' | 'failed';

type ConfidentialState = { state: 'loading' } | { state: 'open'; content: { html: string; text: string; files: { name: string; url: string; type?: string }[] } } | { state: 'expired' | 'revoked' | 'gone' };

/** A confidential email someone sent here: its words from the server while access lasts. */
function useConfidential(meta: ConfidentialMeta | undefined, mine: boolean) {
  const [s, setS] = useState<ConfidentialState>({ state: 'loading' });
  const closed = meta && (meta.revokedAt ? 'revoked' : Date.parse(meta.expiresAt) <= Date.now() ? 'expired' : null);
  useEffect(() => {
    if (!meta || mine) return;
    if (closed) return setS({ state: closed });
    if (!server.on) return setS({ state: 'gone' });
    let live = true;
    setS({ state: 'loading' });
    fetch(`/api/mail/confidential/${encodeURIComponent(meta.id)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok && d.content) setS({ state: 'open', content: d.content });
        else setS({ state: d.state === 'revoked' ? 'revoked' : d.state === 'expired' ? 'expired' : 'gone' });
      })
      .catch(() => live && setS({ state: 'gone' }));
    return () => void (live = false);
  }, [meta?.id, meta?.revokedAt, closed, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

/** The sender's own confidential email: until when it lasts, and Remove access. */
function SenderBanner({ meta }: { meta: ConfidentialMeta }) {
  const [busy, setBusy] = useState(false);
  const shut = !!meta.revokedAt || Date.parse(meta.expiresAt) <= Date.now();
  const remove = async () => {
    setBusy(true);
    const r = await fetch('/api/mail/confidential/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: meta.id }) }).catch(() => null);
    setBusy(false);
    toast({ text: r?.ok ? t('Access removed. Nobody can open this email any more.') : t('Access couldn’t be removed. Try again.') });
  };
  return (
    <div className={`conf-banner${shut ? ' shut' : ''}`}>
      <Lock size={14} />
      <span>
        {meta.revokedAt
          ? t('Confidential. You removed access {when}.', { when: fmtDateTime(meta.revokedAt) })
          : shut
            ? t('Confidential. Access ended {when}.', { when: fmtDateTime(meta.expiresAt) })
            : t('Confidential. People can open it until {when}.', { when: fmtDateTime(meta.expiresAt) })}
      </span>
      {!shut && server.on && (
        <button type="button" className="link-btn" disabled={busy} onClick={remove}>
          {busy ? tx('confidential', 'Removing…') : t('Remove access')}
        </button>
      )}
    </div>
  );
}

export function MailBody({ m, spam, blockTrackers, translation, onShowOriginalText }: { m: Message; spam: boolean; blockTrackers: boolean; translation?: Translation | null; onShowOriginalText?: () => void }) {
  const meta = m.confidential;
  const mine = !!meta?.sender;
  const conf = useConfidential(meta, mine);
  const [shown, setShown] = useState(false);
  const [always, setAlways] = usePersisted<string[]>('s2g-mail-pictures', []);
  const sender = m.from.email.toLowerCase();
  const domain = sender.split('@')[1] ?? '';
  // Pictures load unless the sender couldn't be verified (or it's in Spam), until the reader says so.
  const trusted = shown || always.includes(sender) || always.includes(`@${domain}`) || (!spam && !authFailed(m.auth));

  // A confidential email someone sent here.
  if (meta && !mine) {
    if (conf.state === 'loading')
      return (
        <div className="conf-banner">
          <Loader2 size={14} className="spin" /> <span>{t('Opening the confidential email…')}</span>
        </div>
      );
    if (conf.state !== 'open')
      return (
        <div className="conf-banner shut">
          <Lock size={14} />
          <span>{conf.state === 'revoked' ? t('The sender removed access to this confidential email.') : conf.state === 'expired' ? t('This confidential email expired {when}.', { when: fmtDateTime(meta.expiresAt) }) : t('This confidential email can’t be opened here.')}</span>
        </div>
      );
    const c = conf.content;
    const pics = c.files.filter((f) => /^image\//.test(f.type ?? ''));
    const body = c.html ? mailHtml(c.html, { images: false, blockTrackers: true, proxy: server.on }) : null;
    return (
      <div className="conf-body" onCopy={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
        <div className="conf-banner">
          <Lock size={14} />
          <span>{t('Confidential. You can read it until {when}; it can’t be forwarded, copied, printed or downloaded.', { when: fmtDateTime(meta.expiresAt) })}</span>
        </div>
        <div className="conf-words">
          {body ? <MailFrame html={body.html} css={body.css} designed={body.designed} noCopy label={t('Confidential email')} /> : <Paragraphs text={c.text} />}
          {pics.map((f) => (
            <img key={f.url} className="conf-pic" src={f.url} alt={f.name} draggable={false} />
          ))}
        </div>
        {c.files.length > 0 && (
          <div className="conf-files">
            {c.files.map((f) => (
              <span key={f.url}>{f.name}</span>
            ))}
            <small>{t('Attachments can’t be downloaded from a confidential email.')}</small>
          </div>
        )}
      </div>
    );
  }

  const translated = translation && typeof translation === 'object' ? translation : null;
  const rendered = m.html && !translated ? mailHtml(m.html, { images: trusted, blockTrackers, attachments: m.attachments, proxy: server.on }) : null;
  const hidden = !trusted && !!m.html && !translated && hasOutsidePictures(m.html);
  return (
    <>
      {meta && mine && <SenderBanner meta={meta} />}
      {translation === 'loading' && (
        <div className="tr-note">
          <Loader2 size={14} className="spin" /> {t('Translating…')}
        </div>
      )}
      {(translation === 'needs-ai' || translation === 'failed') && (
        <div className="tr-note">
          <Languages size={14} /> {translation === 'needs-ai' ? t('Translation needs AI. An admin can set it up in Settings, AI.') : t('It couldn’t be translated just now. Try again in a moment.')}
          {onShowOriginalText && (
            <button type="button" className="link-btn" onClick={onShowOriginalText}>
              {t('Close')}
            </button>
          )}
        </div>
      )}
      {translated && (
        <div className="tr-note">
          <Languages size={14} /> {t('Translated from {lang}', { lang: translated.from })}
          <button type="button" className="link-btn" onClick={onShowOriginalText}>
            <Undo2 size={13} /> {t('Show original')}
          </button>
        </div>
      )}
      {hidden && (
        <div className="img-bar">
          {authFailed(m.auth) ? <ShieldAlert size={15} /> : <ImageOff size={15} />}
          <span>{authFailed(m.auth) ? t('Pictures are hidden: this sender couldn’t be verified.') : t('Pictures are hidden in Spam.')}</span>
          <button type="button" className="link-btn" onClick={() => setShown(true)}>
            {t('Show pictures')}
          </button>
          <button type="button" className="link-btn" onClick={() => (setAlways((l) => [...new Set([...l, sender])].slice(-500)), setShown(true))}>
            {t('Always show from {sender}', { sender })}
          </button>
        </div>
      )}
      {translated ? <Paragraphs text={translated.text} /> : rendered ? <MailFrame html={rendered.html} css={rendered.css} designed={rendered.designed} label={t('Email from {name}', { name: m.from.name || m.from.email })} /> : <Paragraphs text={m.body} />}
    </>
  );
}
