import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, FileText, Maximize2, Minimize2, Send, Trash2, Type } from 'lucide-react';
import type { Person } from '../../types';
import { Sheet } from '../ui/Sheet';
import { RichEditor, type RichEditorHandle } from '../RichEditor';
import { TemplatesPicker } from './Templates';
import { startAtTop } from './caret';
import { hasOwnText, htmlToText, textToHtml } from '../../sanitize';

/**
 * Reply on a phone: a sheet over half the screen with the thread still showing above it. Swipe it up (or tap the
 * corner button) for the whole screen; swipe it down and what you wrote waits as a draft on Reply. Send sits top right,
 * so it's never under the keyboard; the bar above the keyboard has formatting, templates and read tracking.
 */
export function QuickReply({
  to,
  initialHtml,
  signature,
  userId,
  track,
  onSend,
  onKeep,
  onClose,
}: {
  to: Person;
  initialHtml: string;
  signature: string;
  userId: string;
  /** Read tracking, when it's offered for these recipients: whether it's on, and switching it. */
  track: { on: boolean; set: (on: boolean) => void } | null;
  onSend: (html: string, text: string) => void;
  onKeep: (draft: { html: string; text: string } | null) => void; // closed without sending: what's written, or null
  onClose: () => void;
}) {
  const [body, setBody] = useState({ html: initialHtml, text: htmlToText(initialHtml) });
  const [grown, setGrown] = useState(false);
  const [format, setFormat] = useState(false);
  const [tpl, setTpl] = useState(false);
  const editor = useRef<RichEditorHandle>(null);
  const tplBtn = useRef<HTMLButtonElement>(null);
  const latest = useRef(body);
  latest.current = body;
  const typed = hasOwnText(body.text, signature);
  const sigText = signature ? htmlToText(signature) : '';
  const own = (sigText ? body.text.replace(sigText, '') : body.text).trim();

  // Swipe the sheet up from its handle or title: it takes the whole screen.
  useEffect(() => {
    let y0 = 0;
    let on = false;
    const start = (e: TouchEvent) => {
      on = !!(e.target as Element).closest?.('.quick-reply .sheet-grab, .quick-reply .sheet-head');
      y0 = e.touches[0]?.clientY ?? 0;
    };
    const move = (e: TouchEvent) => {
      if (on && (e.touches[0]?.clientY ?? 0) - y0 < -36) {
        on = false;
        setGrown(true);
      }
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
    };
  }, []);

  const close = () => {
    onKeep(hasOwnText(latest.current.text, signature) ? latest.current : null);
    onClose();
  };
  const send = () => {
    if (!typed) return;
    onSend(body.html, body.text);
    onKeep(null);
    onClose();
  };
  return (
    <Sheet
      onClose={close}
      title={`Reply to ${to.name || to.email}`}
      className={`quick-reply${grown ? ' grown' : ''}${format ? ' fmt-on' : ''}`}
      head={
        <>
          <button type="button" className="icon-btn" onClick={() => setGrown((g) => !g)} aria-label={grown ? 'Make it smaller' : 'Full screen'} title={grown ? 'Make it smaller' : 'Full screen'}>
            {grown ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" className="primary-btn qr-send" onClick={send} disabled={!typed} aria-label="Send the reply">
            <Send size={16} /> Send
          </button>
        </>
      }
      footer={
        <div className="kb-bar" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className={`icon-btn${format ? ' on' : ''}`} onClick={() => setFormat((f) => !f)} aria-pressed={format} aria-label="Formatting" title="Formatting">
            <Type size={19} />
          </button>
          <button type="button" ref={tplBtn} className="icon-btn" onClick={() => setTpl(true)} aria-label="Templates" title="Templates">
            <FileText size={19} />
          </button>
          {track && (
            <button type="button" className={`icon-btn track-icon${track.on ? ' on' : ''}`} onClick={() => track.set(!track.on)} aria-pressed={track.on} aria-label={track.on ? 'Read tracking is on' : 'Read tracking is off'} title={track.on ? 'Tracking opens and clicks' : 'Not tracked'}>
              {track.on ? <Eye size={19} /> : <EyeOff size={19} />}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={() => (onKeep(null), onClose())} aria-label="Discard the reply" title="Discard">
            <Trash2 size={18} />
          </button>
        </div>
      }
    >
      <div className="qr-editor" onClick={(e) => startAtTop(e, typed)}>
        <RichEditor ref={editor} autoFocus initialHtml={initialHtml} placeholder="Write your reply…" onChange={(html, text) => setBody({ html, text })} onSubmit={send} />
      </div>
      <TemplatesPicker
        open={tpl}
        onClose={() => setTpl(false)}
        userId={userId}
        current={own}
        onInsert={(text) => {
          editor.current?.setHtml(textToHtml(text) + (signature ? `<p><br></p>${signature}` : ''));
          requestAnimationFrame(() => editor.current?.focus());
        }}
      />
    </Sheet>
  );
}
