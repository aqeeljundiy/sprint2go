import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Bell, ChevronUp, Clock, Sparkles, Eye, EyeOff, FileText, Maximize2, MousePointerClick, Minimize2, Minus, Paperclip, PenLine, Send, Trash2, Type, X } from 'lucide-react';
import type { Person } from '../types';
import { fmtSize } from '../data/drive';
import { usePersisted } from '../settings';
import { RecipientInput } from './RecipientInput';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { AIWriter } from './AIWriter';
import { hasOwnText, htmlToText, textToHtml } from '../sanitize';
import { DEFAULT_TRACK_OPTIONS, isTeam } from '../tracking';
import type { Account, TrackOptions } from '../types';
import { Select } from './ui/Select';
import { brand as product } from '../terms';
import { usePhone } from '../mobile/media';
import { useLongPress } from './ui/useLongPress';
import { SendLaterPicker } from './mail/MailPickers';
import { TemplatesPicker } from './mail/Templates';

export interface OutgoingFile {
  name: string;
  size: number;
  url: string;
}

export interface Outgoing {
  to: Person[];
  cc: Person[];
  bcc?: Person[]; // they get it; nobody sees them
  subject: string;
  html: string;
  text: string;
  files: OutgoingFile[];
  /** Track opens and clicks for external recipients. */
  track: boolean;
  trackOptions: TrackOptions;
  fromId: string;
  sendAt?: string; // send later
}

interface Props {
  contacts: Person[];
  signature: string;
  trackByDefault: boolean;
  /** Read tracking is offered: the company hasn't switched it off (the mail engine tracks for real, the demo pretends). */
  canTrack?: boolean;
  accounts: Account[];
  defaultFrom: string;
  userId: string; // whose templates
  /** Re-opening a draft or an undone send. */
  initial?: Outgoing;
  onSend: (m: Outgoing) => void;
  /** Called with the unsent message (or null if it was empty). */
  onClose: (draft: Outgoing | null) => void;
  /** Phones: parked as a pill at the bottom (swiped down), and back. */
  parked?: boolean;
  onPark?: (parked: boolean) => void;
  /** What's written right now, for whoever opens another email over this one (it's kept as a draft first). */
  snapshot?: MutableRefObject<(() => Outgoing | null) | null>;
}

type WinState = 'normal' | 'min' | 'max';

export function Compose({ contacts, signature, trackByDefault, canTrack = true, accounts, defaultFrom, userId, initial, onSend, onClose, parked = false, onPark, snapshot }: Props) {
  const phone = usePhone();
  const [to, setTo] = useState<Person[]>(initial?.to ?? []);
  const [cc, setCc] = useState<Person[]>(initial?.cc ?? []);
  const [bcc, setBcc] = useState<Person[]>(initial?.bcc ?? []);
  const [showCc, setShowCc] = useState(!!initial?.cc.length || !!initial?.bcc?.length);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial ? { html: initial.html, text: initial.text } : { html: signature ? `<p><br></p>${signature}` : '', text: '' });
  const [files, setFiles] = useState<OutgoingFile[]>(initial?.files ?? []);
  const [trackChoice, setTrackChoice] = useState<boolean | null>(initial ? initial.track : null);
  const [opts, setOpts] = useState<TrackOptions>(initial?.trackOptions ?? DEFAULT_TRACK_OPTIONS);
  const [optsOpen, setOptsOpen] = useState(false);
  const [fromId, setFromId] = useState(initial?.fromId && accounts.some((a) => a.id === initial.fromId) ? initial.fromId : defaultFrom);
  const [deskWin, setWin] = useState<WinState>('normal');
  const win: WinState = phone ? (parked ? 'min' : 'normal') : deskWin;
  const [size, setSize] = usePersisted('pm-compose-size', { w: 560, h: 560 });
  const [closing, setClosing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [format, setFormat] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<RichEditorHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  const laterBtn = useRef<HTMLButtonElement>(null);
  const tplBtn = useRef<HTMLButtonElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const sigText = signature ? htmlToText(signature) : '';
  const ownText = (sigText ? body.text.replace(sigText, '') : body.text).trim();

  const external = [...to, ...cc, ...bcc].filter((p) => !isTeam(p.email));
  // Follows the default until you flip it yourself.
  const track = canTrack && external.length > 0 && (trackChoice ?? trackByDefault);
  const message = (): Outgoing => ({ to, cc, bcc, subject: subject.trim(), html: body.html, text: body.text, files, track, trackOptions: opts, fromId });
  const typed = hasOwnText(body.text, signature);
  const hasContent = to.length > 0 || cc.length > 0 || bcc.length > 0 || !!subject.trim() || typed || files.length > 0;
  const valid = to.length + cc.length + bcc.length > 0 && (typed || files.length > 0);
  if (snapshot) snapshot.current = () => (hasContent ? message() : null);
  useEffect(
    () => () => {
      if (snapshot) snapshot.current = null;
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const close = (sent?: boolean, sendAt?: string) => {
    setClosing(true);
    setTimeout(() => (sent ? onSend({ ...message(), sendAt }) : onClose(hasContent ? message() : null)), 160);
  };
  const send = () => valid && close(true);
  const holdSend = useLongPress(() => valid && setLaterOpen(true));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).map((x) => ({ name: x.name, size: x.size, url: URL.createObjectURL(x) }))]);
  };

  /** Drag the top/left edges to resize (the window is anchored bottom-right). */
  const startResize = (e: React.PointerEvent, dx: boolean, dy: boolean) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) =>
      setSize({
        w: dx ? Math.min(Math.max(start.w + start.x - ev.clientX, 420), innerWidth - 48) : start.w,
        h: dy ? Math.min(Math.max(start.h + start.y - ev.clientY, 320), innerHeight - 24) : start.h,
      });
    const up = () => {
      document.body.classList.remove('resizing');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  // Phones: swipe the top bar down and the email waits as a pill at the bottom, to come back to.
  useEffect(() => {
    const el = box.current;
    const bar = head.current;
    if (!phone || parked || !el || !bar) return;
    let y0 = 0;
    let dy = 0;
    let on = false;
    let alive = true;
    const start = (e: TouchEvent) => {
      on = e.touches.length === 1 && !(e.target as Element).closest('button');
      y0 = e.touches[0].clientY;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!on) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy < 6) return;
      if (e.cancelable) e.preventDefault();
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (!on) return;
      on = false;
      el.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      if (dy > 90) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        el.style.transform = 'translateY(100%)';
        setTimeout(() => {
          if (!alive) return;
          el.style.transition = '';
          el.style.transform = '';
          onPark?.(true);
        }, 190);
      } else {
        el.style.transform = '';
        setTimeout(() => alive && (el.style.transition = ''), 220);
      }
    };
    bar.addEventListener('touchstart', start, { passive: true });
    bar.addEventListener('touchmove', move, { passive: false });
    bar.addEventListener('touchend', end);
    bar.addEventListener('touchcancel', end);
    return () => {
      alive = false;
      bar.removeEventListener('touchstart', start);
      bar.removeEventListener('touchmove', move);
      bar.removeEventListener('touchend', end);
      bar.removeEventListener('touchcancel', end);
    };
  }, [phone, parked]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = subject.trim() || 'New message';
  const discard = () => {
    setClosing(true);
    setTimeout(() => onClose(null), 160);
  };
  const insertTemplate = (text: string) => {
    editor.current?.setHtml(textToHtml(text) + (signature ? `<p><br></p>${signature}` : ''));
    requestAnimationFrame(() => editor.current?.focus());
  };
  const trackTitle = !external.length
    ? 'Your team’s mail is never tracked'
    : track
      ? `${external.length === 1 ? `${external[0].name}’s copy gets` : `Each of the ${external.length} people outside the team gets a copy with`} an invisible picture and links that pass through ${product.name}, so you see when it’s opened and which links are clicked. Teammates are never tracked. Apple Mail can load pictures by itself, so treat opens as a hint.`
      : 'Not tracked. Turn on to see when people outside the team open it and which links they click.';

  // Parked on a phone: a pill at the bottom; tap to carry on.
  if (phone && parked)
    return (
      <div className={`compose min compose-pill${closing ? ' closing' : ''}`} role="group" aria-label={`Draft: ${title}`}>
        <button type="button" className="cp-open" onClick={() => onPark?.(false)}>
          <PenLine size={16} />
          <span>{title}</span>
        </button>
        <button type="button" className="icon-btn" onClick={() => close()} aria-label="Save as a draft and close" title="Save as a draft">
          <X size={18} />
        </button>
      </div>
    );

  return (
    <>
      {win === 'max' && <div className={`compose-scrim ${closing ? 'out' : ''}`} onClick={() => setWin('normal')} />}
      <div
        ref={box}
        className={`compose ${win} ${closing ? 'closing' : ''} ${dragOver ? 'drag' : ''}${phone ? ' phone' : ''}${format ? ' fmt-on' : ''}`}
        style={win === 'normal' && !phone ? { width: size.w, height: size.h } : undefined}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.tb-popup')) close();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {win === 'normal' && !phone && (
          <>
            <span className="grip grip-l" onPointerDown={(e) => startResize(e, true, false)} />
            <span className="grip grip-t" onPointerDown={(e) => startResize(e, false, true)} />
            <span className="grip grip-tl" onPointerDown={(e) => startResize(e, true, true)} />
          </>
        )}
        {phone ? (
          <header ref={head} className="compose-head">
            <button type="button" className="icon-btn" onClick={() => close()} aria-label="Close and keep as a draft" title="Close (kept in Drafts)">
              <X size={20} />
            </button>
            <span className="compose-title">{title}</span>
            <button type="button" className="primary-btn compose-send lp" onClick={send} disabled={!valid} aria-label="Send. Hold for Send later" {...holdSend}>
              <Send size={16} /> Send
            </button>
          </header>
        ) : (
          <header className="compose-head" onClick={() => win === 'min' && setWin('normal')}>
            <span className="compose-title">{title}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn sm" onClick={() => setWin(win === 'min' ? 'normal' : 'min')} title="Minimize">
                <Minus size={15} />
              </button>
              <button className="icon-btn sm" onClick={() => setWin(win === 'max' ? 'normal' : 'max')} title={win === 'max' ? 'Exit full screen' : 'Full screen'}>
                {win === 'max' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="icon-btn sm" onClick={() => close()} title="Save draft & close (Esc)">
                <X size={15} />
              </button>
            </div>
          </header>
        )}

        <div className="compose-main">
          {accounts.length > 1 && (
            <label className="compose-field from-field">
              <span>From</span>
              <Select value={fromId} onChange={setFromId} label="From" className="sel-flat from-sel" width={340} options={accounts.map((a) => ({ value: a.id, label: `${a.name} <${a.email}>`, hint: a.kind === 'shared' ? 'Shared inbox' : undefined }))} />
            </label>
          )}
          <RecipientInput
            label="To"
            value={to}
            contacts={contacts}
            autoFocus={!to.length}
            onChange={setTo}
            trailing={
              !showCc && (
                <button type="button" className="cc-toggle" onClick={() => setShowCc(true)}>
                  Cc/Bcc
                </button>
              )
            }
          />
          {showCc && (
            <div className="cc-rows">
              <RecipientInput label="Cc" value={cc} contacts={contacts} onChange={setCc} />
              <RecipientInput label="Bcc" value={bcc} contacts={contacts} onChange={setBcc} />
            </div>
          )}
          <label className="compose-field">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
          </label>

          <RichEditor ref={editor} autoFocus={to.length > 0} initialHtml={body.html} placeholder="Write something great…" onChange={(html, text) => setBody({ html, text })} onSubmit={send} />

          {files.length > 0 && (
            <div className="compose-files">
              {files.map((f, i) => (
                <div key={f.url} className="file-chip">
                  <FileText size={15} />
                  <span className="fc-name">{f.name}</span>
                  <span className="fc-size">{fmtSize(f.size)}</span>
                  <button onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} aria-label="Remove attachment">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {aiOpen && (
          <AIWriter
            hasText={!!ownText}
            currentText={ownText}
            me={accounts.find((a) => a.id === fromId)?.name ?? ''}
            to={to[0]?.name}
            subject={subject}
            onClose={() => setAiOpen(false)}
            onResult={(text) => {
              editor.current?.setHtml(textToHtml(text) + (signature ? `<p><br></p>${signature}` : ''));
              setAiOpen(false);
            }}
          />
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        {phone ? (
          // The bar above the keyboard: attach, AI, templates, formatting, tracking; Discard at the end.
          <footer className="compose-foot kb-bar" onMouseDown={(e) => e.preventDefault()}>
            <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Attach files" title="Attach files">
              <Paperclip size={19} />
            </button>
            <button type="button" className={`icon-btn${aiOpen ? ' on' : ''}`} onClick={() => setAiOpen((o) => !o)} aria-pressed={aiOpen} aria-label="Write with AI" title="Write with AI">
              <Sparkles size={19} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setTplOpen(true)} aria-label="Templates" title="Templates">
              <FileText size={19} />
            </button>
            <button type="button" className={`icon-btn${format ? ' on' : ''}`} onClick={() => setFormat((f) => !f)} aria-pressed={format} aria-label="Formatting" title="Formatting">
              <Type size={19} />
            </button>
            {canTrack && (
              <button type="button" className={`icon-btn track-icon${track ? ' on' : ''}`} disabled={!external.length} onClick={() => setTrackChoice(!track)} aria-pressed={track} aria-label={track ? 'Read tracking is on' : 'Read tracking is off'} title={trackTitle}>
                {track ? <Eye size={19} /> : <EyeOff size={19} />}
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="icon-btn" onClick={discard} aria-label="Discard" title="Discard">
              <Trash2 size={18} />
            </button>
          </footer>
        ) : (
          <footer className="compose-foot">
            <button ref={laterBtn} className="ghost-btn sm" disabled={!valid} onClick={() => setLaterOpen((o) => !o)} title="Send later">
              <Clock size={14} /> Later
            </button>
            <button className="primary-btn" onClick={send} disabled={!valid}>
              <Send size={15} /> Send <kbd>⌘↵</kbd>
            </button>
            <button className="icon-btn" title="Attach files" onClick={() => fileInput.current?.click()}>
              <Paperclip size={17} />
            </button>
            <button className={`icon-btn ai-btn ${aiOpen ? 'on' : ''}`} title="Write with AI" onClick={() => setAiOpen((o) => !o)}>
              <Sparkles size={17} />
            </button>
            <button ref={tplBtn} className={`icon-btn ${tplOpen ? 'on' : ''}`} title="Templates" onClick={() => setTplOpen((o) => !o)}>
              <FileText size={17} />
            </button>
            {canTrack && (
              <div className="track-split">
                <button className={`track-toggle ${track ? 'on' : ''}`} disabled={!external.length} onClick={() => setTrackChoice(!track)} title={trackTitle}>
                  {track ? <Eye size={15} /> : <EyeOff size={15} />}
                  <span>{track ? 'Tracking' : !external.length && to.length ? 'Teammates aren’t tracked' : 'Not tracked'}</span>
                </button>
                {track && (
                  <button className={`track-more ${optsOpen ? 'on' : ''}`} onClick={() => setOptsOpen((o) => !o)} title="Choose what to track">
                    <ChevronUp size={14} />
                  </button>
                )}
                {track && optsOpen && (
                  <div className="track-menu" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOptsOpen(false))}>
                    <div className="tm-title">What do you want to know?</div>
                    {(
                      [
                        ['opens', Eye, 'Opens', 'When and how often they open it'],
                        ['clicks', MousePointerClick, 'Link clicks', 'Which links they click'],
                        ['notify', Bell, 'Notify me', 'The first time each person opens it'],
                      ] as const
                    ).map(([key, Icon, label, hint]) => (
                      <label key={key} className="tm-row">
                        <Icon size={16} />
                        <span>
                          <strong>{label}</strong>
                          <small>{hint}</small>
                        </span>
                        <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))} />
                      </label>
                    ))}
                    <div className="tm-remind">
                      <span>
                        <strong>Remind me if no reply</strong>
                        <small>Tells you, and moves it to “Waiting for a reply”</small>
                      </span>
                      <div className="segmented">
                        {[0, 1, 3, 7].map((d) => (
                          <button key={d} className={opts.remindDays === d ? 'on' : ''} onClick={() => setOpts((o) => ({ ...o, remindDays: d }))}>
                            {d ? `${d}d` : 'Off'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="tm-foot">Tracking {external.map((p) => p.name.split(' ')[0]).join(', ')}. Teammates are never tracked. Apple Mail and some mail filters load pictures by themselves; those opens show as maybe automatic.</div>
                  </div>
                )}
              </div>
            )}
            <span className="spacer" />
            <button className="icon-btn" title="Discard" onClick={discard}>
              <Trash2 size={16} />
            </button>
          </footer>
        )}

        {dragOver && <div className="drop-hint">Drop files to attach</div>}
      </div>
      <SendLaterPicker open={laterOpen} onClose={() => setLaterOpen(false)} anchor={phone ? undefined : laterBtn} onPick={(at) => close(true, at)} />
      <TemplatesPicker open={tplOpen} onClose={() => setTplOpen(false)} anchor={phone ? undefined : tplBtn} userId={userId} current={ownText} onInsert={insertTemplate} />
    </>
  );
}
