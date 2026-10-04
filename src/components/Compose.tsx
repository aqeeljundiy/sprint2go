import { useRef, useState } from 'react';
import { Bell, ChevronUp, Clock, Sparkles, Eye, EyeOff, FileText, Maximize2, MousePointerClick, Minimize2, Minus, Paperclip, Send, Trash2, X } from 'lucide-react';
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

export interface OutgoingFile {
  name: string;
  size: number;
  url: string;
}

export interface Outgoing {
  to: Person[];
  cc: Person[];
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
  accounts: Account[];
  defaultFrom: string;
  /** Re-opening a draft or an undone send. */
  initial?: Outgoing;
  onSend: (m: Outgoing) => void;
  /** Called with the unsent message (or null if it was empty). */
  onClose: (draft: Outgoing | null) => void;
}

type WinState = 'normal' | 'min' | 'max';

export function Compose({ contacts, signature, trackByDefault, accounts, defaultFrom, initial, onSend, onClose }: Props) {
  const [to, setTo] = useState<Person[]>(initial?.to ?? []);
  const [cc, setCc] = useState<Person[]>(initial?.cc ?? []);
  const [showCc, setShowCc] = useState(!!initial?.cc.length);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(
    initial ? { html: initial.html, text: initial.text } : { html: signature ? `<p><br></p>${signature}` : '', text: '' },
  );
  const [files, setFiles] = useState<OutgoingFile[]>(initial?.files ?? []);
  const [trackChoice, setTrackChoice] = useState<boolean | null>(initial ? initial.track : null);
  const [opts, setOpts] = useState<TrackOptions>(initial?.trackOptions ?? DEFAULT_TRACK_OPTIONS);
  const [optsOpen, setOptsOpen] = useState(false);
  const [fromId, setFromId] = useState(initial?.fromId && accounts.some((a) => a.id === initial.fromId) ? initial.fromId : defaultFrom);
  const [win, setWin] = useState<WinState>('normal');
  const [size, setSize] = usePersisted('pm-compose-size', { w: 560, h: 560 });
  const [closing, setClosing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<RichEditorHandle>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const sigText = signature ? htmlToText(signature) : '';
  const ownText = (sigText ? body.text.replace(sigText, '') : body.text).trim();

  const external = [...to, ...cc].filter((p) => !isTeam(p.email));
  // Follows the default until you flip it yourself.
  const track = external.length > 0 && (trackChoice ?? trackByDefault);
  const message = (): Outgoing => ({ to, cc, subject: subject.trim(), html: body.html, text: body.text, files, track, trackOptions: opts, fromId });
  const typed = hasOwnText(body.text, signature);
  const hasContent = to.length > 0 || subject.trim() || typed || files.length > 0;
  const valid = to.length > 0 && (typed || files.length > 0);

  const close = (sent?: boolean, sendAt?: string) => {
    setClosing(true);
    setTimeout(() => (sent ? onSend({ ...message(), sendAt }) : onClose(hasContent ? message() : null)), 160);
  };
  const send = () => valid && close(true);
  const [laterOpen, setLaterOpen] = useState(false);
  const at = (days: number, h: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const monday = () => {
    const d = new Date();
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
    d.setHours(9, 0, 0, 0);
    return d;
  };

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

  const title = subject.trim() || 'New message';

  return (
    <>
      {win === 'max' && <div className={`compose-scrim ${closing ? 'out' : ''}`} onClick={() => setWin('normal')} />}
      <div
        className={`compose ${win} ${closing ? 'closing' : ''} ${dragOver ? 'drag' : ''}`}
        style={win === 'normal' ? { width: size.w, height: size.h } : undefined}
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
        {win === 'normal' && (
          <>
            <span className="grip grip-l" onPointerDown={(e) => startResize(e, true, false)} />
            <span className="grip grip-t" onPointerDown={(e) => startResize(e, false, true)} />
            <span className="grip grip-tl" onPointerDown={(e) => startResize(e, true, true)} />
          </>
        )}
        <header className="compose-head" onClick={() => win === 'min' && setWin('normal')}>
          <span className="compose-title">{title}</span>
          <div onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn sm hide-mobile" onClick={() => setWin(win === 'min' ? 'normal' : 'min')} title="Minimize">
              <Minus size={15} />
            </button>
            <button
              className="icon-btn sm hide-mobile"
              onClick={() => setWin(win === 'max' ? 'normal' : 'max')}
              title={win === 'max' ? 'Exit full screen' : 'Full screen'}
            >
              {win === 'max' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="icon-btn sm" onClick={() => close()} title="Save draft & close (Esc)">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="compose-main">
          {accounts.length > 1 && (
            <label className="compose-field from-field">
              <span>From</span>
              <Select
                value={fromId}
                onChange={setFromId}
                label="From"
                className="sel-flat from-sel"
                width={340}
                options={accounts.map((a) => ({ value: a.id, label: `${a.name} <${a.email}>`, hint: a.kind === 'shared' ? 'Shared inbox' : undefined }))}
              />
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
                <button className="cc-toggle" onClick={() => setShowCc(true)}>
                  Cc
                </button>
              )
            }
          />
          {showCc && <RecipientInput label="Cc" value={cc} contacts={contacts} onChange={setCc} />}
          <label className="compose-field">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
          </label>

          <RichEditor
            ref={editor}
            autoFocus={to.length > 0}
            initialHtml={body.html}
            placeholder="Write something great…"
            onChange={(html, text) => setBody({ html, text })}
            onSubmit={send}
          />

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
        <footer className="compose-foot">
          <span className="later-wrap">
            <button className="ghost-btn sm" disabled={!valid} onClick={() => setLaterOpen((o) => !o)} title="Send later">
              <Clock size={14} /> Later
            </button>
            {laterOpen && (
              <span className="later-menu">
                {(
                  [
                    ['In 1 hour', new Date(Date.now() + 3_600_000)],
                    ['Tomorrow 9:00', at(1, 9)],
                    ['Monday 9:00', monday()],
                  ] as const
                ).map(([l, d]) => (
                  <button key={l} onClick={() => (setLaterOpen(false), close(true, d.toISOString()))}>
                    {l}
                    <small>{d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                  </button>
                ))}
              </span>
            )}
          </span>
          <button className="primary-btn" onClick={send} disabled={!valid}>
            <Send size={15} /> Send <kbd>⌘↵</kbd>
          </button>
          <button className="icon-btn" title="Attach files" onClick={() => fileInput.current?.click()}>
            <Paperclip size={17} />
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <button className={`icon-btn ai-btn ${aiOpen ? 'on' : ''}`} title="Write with AI" onClick={() => setAiOpen((o) => !o)}>
            <Sparkles size={17} />
          </button>
          <div className="track-split">
            <button
              className={`track-toggle ${track ? 'on' : ''}`}
              disabled={!external.length}
              onClick={() => setTrackChoice(!track)}
              title={
                !external.length
                  ? 'Your team’s mail is never tracked'
                  : track
                    ? `You’ll see when ${external.length === 1 ? external[0].name : `${external.length} people`} open this email`
                    : 'Opens won’t be tracked'
              }
            >
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
                    ['notify', Bell, 'Notify me', 'A pop-up the moment it happens'],
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
                    <small>Moves it to “Waiting for a reply”</small>
                  </span>
                  <div className="segmented">
                    {[0, 1, 3, 7].map((d) => (
                      <button key={d} className={opts.remindDays === d ? 'on' : ''} onClick={() => setOpts((o) => ({ ...o, remindDays: d }))}>
                        {d ? `${d}d` : 'Off'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tm-foot">Tracking {external.map((p) => p.name.split(' ')[0]).join(', ')} · teammates are never tracked. Apple Mail can show opens that didn’t happen, so treat opens as a hint.</div>
              </div>
            )}
          </div>
          <span className="spacer" />
          <button className="icon-btn" title="Discard" onClick={() => {
            setClosing(true);
            setTimeout(() => onClose(null), 160);
          }}>
            <Trash2 size={16} />
          </button>
        </footer>

        {dragOver && <div className="drop-hint">Drop files to attach</div>}
      </div>
    </>
  );
}
