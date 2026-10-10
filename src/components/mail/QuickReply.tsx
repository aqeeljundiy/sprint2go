import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, FileText, MoreHorizontal, MoreVertical, SendHorizontal, Sparkles, Trash2, Type, X } from 'lucide-react';
import type { Person } from '../../types';
import { RichEditor, type RichEditorHandle } from '../RichEditor';
import { ActionSheet } from '../ui/ActionSheet';
import { AIWriter } from '../AIWriter';
import { TemplatesPicker } from './Templates';
import { startAtTop } from './caret';
import { hasOwnText, htmlToText, textToHtml } from '../../sanitize';
import { t } from '../../i18n';
import { AttachButton, DraftFilesList, useDraftFiles, type OutFile } from './DraftFiles';
import { uploadForMail } from './attachApi';
import { toast } from '../../toast';
import { RecipientInput } from '../RecipientInput';
import type { ReplyOpts } from './composeExtras';

/**
 * Reply and Reply all on a phone: Gmail's full-screen compose, with the people filled in and the subject shown as
 * "Re: …". Close keeps what's written as a draft (Reply then says "Draft"); Send is the arrow top right, with
 * templates, read tracking and Discard under ⋮. The strip above the keyboard has Help me write, formatting and templates.
 */
export function QuickReply({
  to: startTo,
  cc: startCc = [],
  contacts = [],
  spellLang,
  suggest,
  all,
  subject,
  initialHtml,
  signature,
  userId,
  myName,
  track,
  onSend,
  onKeep,
  onClose,
  initialFiles,
  quoted,
}: {
  /** The message being answered: shown folded under the reply (Gmail's "…"), so you can check what was said. */
  quoted?: { who: string; when: string; text: string };
  to: Person[];
  cc?: Person[];
  contacts?: Person[];
  /** The browser's spell check language, and smart compose (RichEditor). */
  spellLang?: 'en' | 'id' | 'off';
  suggest?: (before: string) => Promise<string | null>;
  all?: boolean; // Reply all
  subject: string;
  initialHtml: string;
  signature: string;
  userId: string;
  myName: string;
  /** Read tracking, when it's offered for these recipients: whether it's on, and switching it. */
  track: { on: boolean; set: (on: boolean) => void } | null;
  /** `opts`: the people or subject, when they were changed here. */
  onSend: (html: string, text: string, opts?: ReplyOpts) => void;
  onKeep: (draft: { html: string; text: string } | null) => void; // closed without sending: what's written, or null
  onClose: () => void;
  /** Files of a reply that came back (not sent, or Undo). */
  initialFiles?: OutFile[];
}) {
  const [body, setBody] = useState({ html: initialHtml, text: htmlToText(initialHtml) });
  const [format, setFormat] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [more, setMore] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const editor = useRef<RichEditorHandle>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const latest = useRef(body);
  latest.current = body;
  // Files: uploaded when added, big ones as Drive links (DraftFiles.tsx).
  const files = useDraftFiles(initialFiles ?? [], body.html.length);
  const typed = hasOwnText(body.text, signature) || files.files.length > 0;
  const ready = typed && !files.busy;
  const inlineImages = (pics: File[]) => Promise.all(pics.map((f) => uploadForMail(f).then((up) => ({ url: up.url, name: f.name }), (e: Error) => (toast({ text: e.message }), null))));
  const sigText = signature ? htmlToText(signature) : '';
  const own = (sigText ? body.text.replace(sigText, '') : body.text).trim();
  const reStart = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  // Gmail lets the people and the subject of a reply change.
  const [to, setTo] = useState(startTo);
  const [cc, setCc] = useState(startCc);
  const [re, setRe] = useState(reStart);
  const changed = (): ReplyOpts => ({ ...(to !== startTo || cc !== startCc ? { to, cc } : {}), ...(re.trim() && re !== reStart ? { subject: re.trim() } : {}) });

  const leave = (then: () => void) => {
    setClosing(true);
    setTimeout(then, 160);
  };
  const close = () => leave(() => (onKeep(hasOwnText(latest.current.text, signature) ? latest.current : null), onClose()));
  const send = () => {
    if (!ready) return;
    if (!to.length && !cc.length) return;
    const out = files.out();
    leave(() => (onSend(latest.current.html, latest.current.text, { ...changed(), ...(out.length ? { files: out } : {}) }), onKeep(null), onClose()));
  };
  const insert = (text: string) => {
    editor.current?.setHtml(textToHtml(text) + (signature ? `<p><br></p>${signature}` : ''));
    requestAnimationFrame(() => editor.current?.focus());
  };
  return createPortal(
    <>
      <div
        className={`compose normal phone gm-reply${closing ? ' closing' : ''}${format ? ' fmt-on' : ''}`}
        role="dialog"
        aria-label={all ? t('Reply all') : t('Reply')}
        onKeyDown={(e) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.tb-popup') && close()}
      >
        <header className="compose-head">
          <button type="button" className="icon-btn" onClick={close} aria-label={t('Close and keep as a draft')} title={t('Close (kept in Drafts)')}>
            <X size={22} />
          </button>
          <span className="compose-title">{all ? t('Reply all') : t('Reply')}</span>
          <AttachButton onFiles={(f) => files.add(f)} size={22} />
          <button type="button" className={`icon-btn compose-send-icon${ready ? ' ready' : ''}`} onClick={send} aria-disabled={!ready} aria-label={t('Send the reply')} title={files.busy ? t('Wait for the files to finish uploading') : t('Send')}>
            <SendHorizontal size={22} />
          </button>
          <button type="button" ref={moreBtn} className="icon-btn" onClick={() => setMore(true)} aria-label={t('More')} title={t('More')}>
            <MoreVertical size={22} />
          </button>
        </header>
        <div className="compose-main">
          <RecipientInput label={t('To')} value={to} contacts={contacts} onChange={setTo} />
          {(cc.length > 0 || all) && <RecipientInput label="Cc" value={cc} contacts={contacts} onChange={setCc} />}
          <label className="compose-field">
            <span>{t('Subject')}</span>
            <input value={re} onChange={(e) => setRe(e.target.value)} />
          </label>
          <div className="compose-body" onClick={(e) => startAtTop(e, typed)}>
            <RichEditor ref={editor} autoFocus initialHtml={initialHtml} placeholder={t('Compose email')} onChange={(html, text) => setBody({ html, text })} onSubmit={send} spellLang={spellLang} suggest={suggest} onImages={inlineImages} />
          </div>
          <DraftFilesList state={files} />
          {quoted && (
            <div className="qr-quoted">
              <button type="button" className="qr-quoted-btn" onClick={() => setShowQuote((x) => !x)} aria-expanded={showQuote} aria-label={showQuote ? t('Hide the email you’re answering') : t('Show the email you’re answering')}>
                <MoreHorizontal size={20} />
              </button>
              <div className={`fold${showQuote ? ' open' : ''}`} aria-hidden={!showQuote}>
                <div className="fold-in">
                  <p className="qr-quoted-head">{t('On {when}, {who} wrote:', { when: quoted.when, who: quoted.who })}</p>
                  <blockquote className="qr-quoted-text">{quoted.text}</blockquote>
                </div>
              </div>
            </div>
          )}
        </div>
        {aiOpen && <AIWriter hasText={!!own} currentText={own} me={myName} to={to[0]?.name} subject={re} onClose={() => setAiOpen(false)} onResult={(text) => (insert(text), setAiOpen(false))} />}
        <footer className="compose-foot kb-bar" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className={`icon-btn kb-ai${aiOpen ? ' on' : ''}${!own ? ' labelled' : ''}`} onClick={() => setAiOpen((o) => !o)} aria-pressed={aiOpen} aria-label={t('Help me write')} title={t('Help me write')}>
            <Sparkles size={19} />
            {!own && <span>{t('Help me write')}</span>}
          </button>
          <button type="button" className={`icon-btn${format ? ' on' : ''}`} onClick={() => setFormat((f) => !f)} aria-pressed={format} aria-label={t('Formatting')} title={t('Formatting')}>
            <Type size={19} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setTpl(true)} aria-label={t('Templates')} title={t('Templates')}>
            <FileText size={19} />
          </button>
          <span className="spacer" />
        </footer>
      </div>
      <ActionSheet
        open={more}
        onClose={() => setMore(false)}
        anchor={moreBtn}
        menu
        actions={[
          { label: t('Templates'), icon: FileText, run: () => setTpl(true) },
          ...(track ? [{ label: t('Read tracking'), icon: track.on ? Eye : EyeOff, checked: track.on, run: () => track.set(!track.on) }] : []),
          { label: t('Discard'), icon: Trash2, danger: true, group: 'end', run: () => leave(() => (onKeep(null), onClose())) },
        ]}
      />
      <TemplatesPicker open={tpl} onClose={() => setTpl(false)} userId={userId} current={own} onInsert={insert} />
    </>,
    document.body,
  );
}
