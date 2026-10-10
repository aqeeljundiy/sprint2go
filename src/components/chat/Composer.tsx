import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, AtSign, Bold, Camera, Check, ChevronDown, Code, FileText, HardDrive, Image as ImageIcon, Italic, Link2, List, ListOrdered, Mic, Paperclip, Plus, Quote, SendHorizontal, Smile, SquareCheck, SquareCode, Strikethrough, Table2, Type, Video } from 'lucide-react';
import type { ChatFile, ChatMessage, DataTable, DriveItem, Note, TableRow, Todo, User } from '../../types';
import { Avatar } from '../Avatar';
import { Sheet } from '../ui/Sheet';
import { Popover } from '../ui/Popover';
import { useLongPress } from '../ui/useLongPress';
import { EmojiGrid, EmojiSheet, PickSheet, WhenSheet } from './Sheets';
import { useDraft, whenText, type ChatState } from './chatPrefs';
import { fmtSecs, fmtSize } from './Message';
import { mark, t, tn } from '../../i18n';
import { fmtDay } from '../../i18n/format';

/** sprint2go things the + can put in a message. */
export interface Library {
  tasks: Todo[];
  notes: Note[];
  tables: DataTable[];
  rows: TableRow[];
  drive: DriveItem[];
  /** A new task made from what's typed, shared in the message. */
  newTask?: (title: string) => string | undefined;
}

export type Outgoing = { text: string; sendAt?: string; files?: ChatFile[]; voice?: ChatMessage['voice']; taskId?: string; ref?: ChatMessage['ref'] };

// Phones get Slack's whole Aa bar (link, numbered list, code block too); wider screens keep the short one.
const FORMATS = [
  { id: 'bold', label: mark('Bold'), icon: Bold, wrap: '*' },
  { id: 'italic', label: mark('Italic'), icon: Italic, wrap: '_' },
  { id: 'strike', label: mark('Strikethrough'), icon: Strikethrough, wrap: '~' },
  { id: 'code', label: mark('Code'), icon: Code, wrap: '`' },
  { id: 'link', label: mark('Link'), icon: Link2, put: 'https://', phone: true },
  { id: 'numbered', label: mark('Numbered list'), icon: ListOrdered, line: '1. ', phone: true },
  { id: 'list', label: mark('List'), icon: List, line: '- ' },
  { id: 'quote', label: mark('Quote'), icon: Quote, line: '> ' },
  { id: 'block', label: mark('Code block'), icon: SquareCode, fence: '```', phone: true },
] as const;

const rowName = (r: TableRow, tb?: DataTable) => {
  const v = tb ? r.values[tb.fields[0]?.id] : undefined;
  return typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : t('Untitled row');
};

/**
 * The message box: the field on top, one row of tools under it (+, Aa, emoji, @) and Send on the right. Hold Send (or
 * use its arrow on wider screens) to send later. + adds photos, files, a voice clip, or something from sprint2go.
 * What's typed is kept as a draft for this conversation (or thread) until it's sent.
 */
export function Composer(p: {
  chat: ChatState;
  draftKey: string | null;
  text: string;
  setText: (t: string | ((t: string) => string)) => void;
  placeholder: string;
  users: User[];
  me: string;
  phone: boolean;
  guest?: boolean;
  autoFocus?: boolean;
  commands?: { cmd: string; hint: string }[];
  onCommand?: (text: string) => boolean;
  onSend: (o: Outgoing) => void;
  upload: (file: File | Blob, name?: string) => Promise<ChatFile | null>;
  editing?: ChatMessage | null;
  onEdit?: (id: string, text: string) => void;
  onCancelEdit?: () => void;
  also?: { label: string; on: boolean; set: (v: boolean) => void };
  canSchedule?: boolean;
  library?: Library;
  onKudos?: () => void;
  onMeetLink?: () => void;
  className?: string;
}) {
  const { text, setText, phone } = p;
  const input = useRef<HTMLTextAreaElement>(null);
  const sendBtn = useRef<HTMLButtonElement>(null);
  const plusBtn = useRef<HTMLButtonElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [fmt, setFmt] = useState(false);
  const [tall, setTall] = useState(false); // phones: the box dragged up by its handle
  const [sheet, setSheet] = useState<null | 'plus' | 'emoji' | 'later' | 'task' | 'note' | 'table' | 'drive'>(null);
  const [table, setTable] = useState<DataTable | null>(null);
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<{ start: number; secs: number; stream?: MediaStream; recorder?: MediaRecorder; chunks: Blob[] } | null>(null);
  const draft = useDraft(p.chat, p.editing ? null : p.draftKey, text, setText);

  // Editing a message: its words go in the box; leaving the edit puts the draft back.
  const editId = p.editing?.id;
  useEffect(() => {
    if (!p.editing) return;
    setText(p.editing.text);
    requestAnimationFrame(() => {
      const el = input.current;
      if (el) (el.focus(), el.setSelectionRange(el.value.length, el.value.length));
    });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The field grows with what's typed (up to about six lines), and shrinks back after sending.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = tall ? `${Math.round(window.innerHeight * 0.45)}px` : `${Math.min(el.scrollHeight, phone ? 140 : 180)}px`;
  }, [text, phone, tall]);

  useEffect(() => {
    if (p.autoFocus && !phone) input.current?.focus();
  }, [p.draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rec) return;
    const timer = setInterval(() => setRec((r) => r && { ...r, secs: (Date.now() - r.start) / 1000 }), 250);
    return () => clearInterval(timer);
  }, [rec?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const before = text.slice(0, caret);
  const mention = /(?:^|\s)@(\w*)$/.exec(before)?.[1] ?? null;
  const suggestions = mention === null ? [] : p.users.filter((u) => u.id !== p.me && u.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5);
  const slash = !p.guest && p.commands && text.startsWith('/') && !text.includes(' ') ? p.commands.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];
  const track = () => setCaret(input.current?.selectionStart ?? text.length);

  const insert = (s: string, select = 0) => {
    const el = input.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = a + s.length - select;
      el.setSelectionRange(at, at);
      setCaret(at);
    });
  };
  const pickMention = (u: { name: string }) => {
    const name = u.name.split(' ')[0];
    const start = before.lastIndexOf('@');
    const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
    setText(next);
    requestAnimationFrame(() => {
      const el = input.current;
      const at = start + name.length + 2;
      el?.focus();
      el?.setSelectionRange(at, at);
      setCaret(at);
    });
  };
  const format = (f: (typeof FORMATS)[number]) => {
    const el = input.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if ('put' in f) return insert(f.put);
    if ('fence' in f) {
      const sel = text.slice(a, b);
      const lead = a > 0 && text[a - 1] !== '\n' ? '\n' : '';
      const next = `${text.slice(0, a)}${lead}${f.fence}\n${sel}\n${f.fence}${text.slice(b)}`;
      setText(next);
      const at = a + lead.length + f.fence.length + 1 + sel.length;
      requestAnimationFrame(() => (el.focus(), el.setSelectionRange(at, at)));
      return;
    }
    if ('wrap' in f) {
      const sel = text.slice(a, b) || '';
      const next = text.slice(0, a) + f.wrap + sel + f.wrap + text.slice(b);
      setText(next);
      requestAnimationFrame(() => (el.focus(), sel ? el.setSelectionRange(a, b + 2) : el.setSelectionRange(a + 1, a + 1)));
    } else {
      // Every line the selection touches starts with it (or stops, when they all do already).
      const start = text.lastIndexOf('\n', a - 1) + 1;
      const end = text.indexOf('\n', b) === -1 ? text.length : text.indexOf('\n', b);
      const lines = text.slice(start, end).split('\n');
      const numbered = f.id === 'numbered';
      const all = lines.every((l) => (numbered ? /^\d+\.\s/.test(l) : l.startsWith(f.line)));
      const body = lines.map((l, i) => (all ? l.replace(numbered ? /^\d+\.\s/ : f.line, '') : (numbered ? `${i + 1}. ` : f.line) + l)).join('\n');
      setText(text.slice(0, start) + body + text.slice(end));
      requestAnimationFrame(() => (el.focus(), el.setSelectionRange(start + body.length, start + body.length)));
    }
  };

  const send = (extra: Partial<Outgoing> = {}) => {
    const typed = text.trim();
    if (p.editing) {
      if (typed && typed !== p.editing.text) p.onEdit?.(p.editing.id, typed);
      p.onCancelEdit?.();
      setText('');
      return;
    }
    if (!typed && !extra.files && !extra.voice && !extra.taskId && !extra.ref) return;
    if (typed.startsWith('/') && !extra.sendAt && p.onCommand?.(typed)) {
      setText('');
      draft.sent();
      return;
    }
    p.onSend({ text: typed, ...extra });
    draft.sent();
    setText('');
    setFmt(false);
    setTall(false);
  };
  const sendFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const out: ChatFile[] = [];
    for (const f of [...list]) {
      const up = await p.upload(f);
      if (up) out.push(up);
    }
    setBusy(false);
    if (out.length) send({ files: out });
  };

  // Voice clips: the browser's recorder when allowed; otherwise a timed clip with no sound.
  const startRec = async () => {
    setSheet(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      setRec({ start: Date.now(), secs: 0, stream, recorder, chunks });
    } catch {
      setRec({ start: Date.now(), secs: 0, chunks: [] });
    }
  };
  const stopRec = (keep: boolean) => {
    if (!rec) return;
    const secs = Math.max(1, Math.round((Date.now() - rec.start) / 1000));
    const finish = (url?: string) => {
      rec.stream?.getTracks().forEach((tr) => tr.stop());
      if (keep) p.onSend({ text: '', voice: { seconds: secs, url } });
      setRec(null);
    };
    if (rec.recorder && rec.recorder.state !== 'inactive') {
      rec.recorder.onstop = () => {
        const blob = new Blob(rec.chunks, { type: 'audio/webm' });
        void p.upload(blob, 'voice-note.webm').then((up) => finish(up?.url ?? URL.createObjectURL(blob)), () => finish(URL.createObjectURL(blob)));
      };
      rec.recorder.stop();
    } else finish();
  };

  const can = !!text.trim();
  const holdSend = useLongPress(() => p.canSchedule && can && !p.editing && setSheet('later'), { disabled: !p.canSchedule || !can || !!p.editing });
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault(); // tools don't take the focus (the keyboard stays up)
  const lib = p.library;

  // Phones: drag the handle up for a taller box (Slack), down to bring it back.
  const grab = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.clientY < y0 - 24) setTall(true);
      else if (ev.clientY > y0 + 24) setTall(false);
    };
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const formats = FORMATS.filter((f) => phone || !('phone' in f));
  const sendLabel = p.canSchedule ? t('Send (hold to send later)') : t('Send');

  return (
    <div className={`composer${phone ? ' is-phone' : ''}${p.editing ? ' is-editing' : ''}${tall ? ' is-tall' : ''} ${p.className ?? ''}`}>
      {phone && <div className="cmp-grab" onPointerDown={grab} onClick={() => setTall((v) => !v)} role="button" tabIndex={-1} aria-label={tall ? t('Make the message box smaller') : t('Make the message box bigger')} />}
      {p.editing && (
        <div className="cmp-editing">
          <span>{t('Editing your message')}</span>
          <button type="button" className="link-btn" onClick={() => (p.onCancelEdit?.(), setText(''))}>
            {t('Cancel')}
          </button>
        </div>
      )}
      {(suggestions.length > 0 || slash.length > 0) && (
        <div className="mention-pop" role="listbox" aria-label={suggestions.length ? t('People') : t('Commands')}>
          {suggestions.map((u) => (
            <button key={u.id} type="button" role="option" aria-selected={false} onPointerDown={keep} onClick={() => pickMention(u)}>
              <Avatar person={u} size={phone ? 28 : 22} /> {u.name}
            </button>
          ))}
          {slash.map((c) => (
            <button key={c.cmd} type="button" role="option" aria-selected={false} onPointerDown={keep} onClick={() => (setText(c.cmd + ' '), input.current?.focus())}>
              <b>{c.cmd}</b> <span className="muted small">{c.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`fold cmp-fmt-fold${fmt ? ' open' : ''}`} aria-hidden={!fmt}>
        <div>
          <div className="cmp-fmt" role="toolbar" aria-label={t('Formatting')}>
            {formats.map((f) => (
              <button key={f.id} type="button" className="icon-btn" tabIndex={fmt ? 0 : -1} onPointerDown={keep} onClick={() => format(f)} aria-label={t(f.label)} title={t(f.label)}>
                <f.icon size={phone ? 20 : 17} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="cmp-box">
        {rec ? (
          <div className="rec-bar">
            <span className="rec-dot" /> {t('Recording {time}', { time: fmtSecs(rec.secs) })}
            {!rec.recorder && <span className="muted small">{t('No microphone here')}</span>}
            <span className="spacer" />
            <button type="button" className="ghost-btn sm" onClick={() => stopRec(false)}>
              {t('Cancel')}
            </button>
            <button type="button" className="primary-btn sm" onClick={() => stopRec(true)}>
              {t('Send clip')}
            </button>
          </div>
        ) : (
          <textarea
            ref={input}
            className="cmp-field"
            rows={1}
            value={text}
            aria-label={p.placeholder}
            onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart))}
            onSelect={track}
            onKeyUp={track}
            onPaste={(e) => {
              if (!e.clipboardData.files.length) return;
              e.preventDefault();
              void sendFiles(e.clipboardData.files);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !phone) {
                e.preventDefault();
                if (suggestions.length) pickMention(suggestions[0]);
                else if (slash.length === 1 && text.trim() !== slash[0].cmd) setText(slash[0].cmd + ' ');
                else send();
              }
              if (e.key === 'Escape') {
                if (p.editing) (p.onCancelEdit?.(), setText(''));
                else if (fmt) setFmt(false);
              }
              if (e.key === 'ArrowUp' && !text && !p.editing) {
                // Up in an empty box edits your last message, like most chat apps.
                window.dispatchEvent(new CustomEvent('s2g:chat-edit-last'));
              }
            }}
            placeholder={p.placeholder}
          />
        )}
        {!rec &&
          p.also &&
          (phone ? (
            // Slack: a checkbox on its own row under the field.
            <button type="button" role="checkbox" aria-checked={p.also.on} className={`cmp-also is-check${p.also.on ? ' on' : ''}`} onPointerDown={keep} onClick={() => p.also!.set(!p.also!.on)}>
              <span className="cmp-check" aria-hidden>
                <Check size={14} />
              </span>
              <span>{p.also.label}</span>
            </button>
          ) : (
            <label className="cmp-also">
              <button type="button" role="switch" aria-checked={p.also.on} className={`switch sm ${p.also.on ? 'on' : ''}`} onClick={() => p.also!.set(!p.also!.on)}>
                <span />
              </button>
              <span>{p.also.label}</span>
            </label>
          ))}
        {!rec && (
          <div className="cmp-tools">
            <button ref={plusBtn} type="button" className={`icon-btn cmp-plus${sheet === 'plus' ? ' on' : ''}`} onClick={() => setSheet('plus')} aria-label={t('Add: photos, files, a voice clip, or something from sprint2go')} title={t('Add')}>
              {phone ? (
                <span className="cmp-plus-ring">
                  <Plus size={20} />
                </span>
              ) : (
                <Plus size={19} />
              )}
            </button>
            <button type="button" className={`icon-btn cmp-aa${fmt ? ' on' : ''}`} onPointerDown={keep} onClick={() => setFmt((f) => !f)} aria-label={t('Formatting')} aria-pressed={fmt} title={t('Formatting')}>
              {phone ? <span className="cmp-aa-text">Aa</span> : <Type size={18} />}
            </button>
            <button ref={emojiBtn} type="button" className="icon-btn" onPointerDown={phone ? undefined : keep} onClick={() => setSheet('emoji')} aria-label={t('Emoji')} title={t('Emoji')}>
              <Smile size={phone ? 21 : 18} />
            </button>
            {!p.guest && (
              <button type="button" className="icon-btn" onPointerDown={keep} onClick={() => insert(text && !/\s$/.test(text.slice(0, input.current?.selectionStart ?? text.length)) ? ' @' : '@')} aria-label={t('Mention someone')} title={t('Mention someone')}>
                <AtSign size={phone ? 21 : 18} />
              </button>
            )}
            <span className="spacer" />
            {busy && <span className="muted small cmp-busy">{t('Uploading…')}</span>}
            {p.editing ? (
              <button ref={sendBtn} type="button" className="ai-send chat-send" onClick={() => send()} aria-label={t('Save the change')} disabled={!can}>
                <Check size={17} />
              </button>
            ) : phone ? (
              // Slack's split Send: send on the left, "Schedule for later" on the right; grey until there's something to send.
              <span className={`cmp-split${can ? ' ready' : ''}${p.canSchedule ? '' : ' single'}`}>
                <button ref={sendBtn} type="button" className="cmp-split-send lp" {...holdSend} onClick={() => send()} aria-label={sendLabel} disabled={!can}>
                  <SendHorizontal size={18} />
                </button>
                {p.canSchedule && (
                  <button type="button" className="cmp-split-later" onPointerDown={keep} onClick={() => setSheet('later')} disabled={!can} aria-label={t('Schedule for later')} title={t('Schedule for later')}>
                    <ChevronDown size={16} />
                  </button>
                )}
              </span>
            ) : can || p.guest || p.also ? (
              <span className="cmp-send">
                <button ref={sendBtn} type="button" className="ai-send chat-send lp" {...holdSend} onClick={() => send()} aria-label={sendLabel} title={t('Send')} disabled={!can}>
                  <ArrowUp size={17} />
                </button>
                {p.canSchedule && (
                  <button type="button" className="cmp-later" onClick={() => setSheet('later')} disabled={!can} aria-label={t('Send later')} title={t('Send later')}>
                    <ChevronDown size={14} />
                  </button>
                )}
              </span>
            ) : (
              <button type="button" className="icon-btn mic-btn" onClick={startRec} aria-label={t('Record a voice clip')} title={t('Record a voice clip')}>
                <Mic size={18} />
              </button>
            )}
          </div>
        )}
      </div>

      <input ref={files} type="file" multiple hidden onChange={(e) => (void sendFiles(e.target.files), (e.target.value = ''))} />
      <input ref={photos} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (void sendFiles(e.target.files), (e.target.value = ''))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void sendFiles(e.target.files), (e.target.value = ''))} />

      {sheet === 'plus' && (
        <Sheet title={t('Add to message')} onClose={() => setSheet(null)} className="plus-sheet">
          <div className="as-list">
            <button type="button" className="as-item" onClick={() => (setSheet(null), photos.current?.click())}>
              <ImageIcon size={18} className="as-icon" />
              <span className="as-label">{t('Photos')}</span>
            </button>
            <button type="button" className="as-item" onClick={() => (setSheet(null), camera.current?.click())}>
              <Camera size={18} className="as-icon" />
              <span className="as-label">{t('Camera')}</span>
            </button>
            <button type="button" className="as-item" onClick={() => (setSheet(null), files.current?.click())}>
              <Paperclip size={18} className="as-icon" />
              <span className="as-label">{t('File')}</span>
            </button>
            {!p.guest && (
              <button type="button" className="as-item" onClick={startRec}>
                <Mic size={18} className="as-icon" />
                <span className="as-label">{t('Voice clip')}</span>
              </button>
            )}
            {lib && !p.guest && (
              <>
                <div className="as-sep" role="separator" />
                <div className="as-group">{t('From sprint2go')}</div>
                <button type="button" className="as-item" onClick={() => setSheet('task')}>
                  <SquareCheck size={18} className="as-icon" />
                  <span className="as-label">
                    {t('A task')}
                    <small>{text.trim() ? t('Make one from what you typed, or share one') : t('Share one with its stage and who’s on it')}</small>
                  </span>
                </button>
                <button type="button" className="as-item" onClick={() => setSheet('note')}>
                  <FileText size={18} className="as-icon" />
                  <span className="as-label">{t('A note')}</span>
                </button>
                <button type="button" className="as-item" onClick={() => (setTable(null), setSheet('table'))}>
                  <Table2 size={18} className="as-icon" />
                  <span className="as-label">{t('A table row')}</span>
                </button>
                <button type="button" className="as-item" onClick={() => setSheet('drive')}>
                  <HardDrive size={18} className="as-icon" />
                  <span className="as-label">{t('A Drive file')}</span>
                </button>
                {p.onKudos && (
                  <button type="button" className="as-item" onClick={() => (setSheet(null), p.onKudos!())}>
                    <span className="as-icon emoji-icon">🙌</span>
                    <span className="as-label">{t('Give kudos')}</span>
                  </button>
                )}
                {p.onMeetLink && (
                  <button type="button" className="as-item" onClick={() => (setSheet(null), p.onMeetLink!())}>
                    <Video size={18} className="as-icon" />
                    <span className="as-label">{t('Share the meeting link')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'emoji' &&
        (phone ? (
          <EmojiSheet onPick={(e) => insert(e)} onClose={() => setSheet(null)} />
        ) : (
          <Popover anchor={emojiBtn} open onClose={() => setSheet(null)} width={320} title={t('Emoji')}>
            <EmojiGrid onPick={(e) => (setSheet(null), insert(e))} />
          </Popover>
        ))}
      {sheet === 'later' && (
        <WhenSheet
          title={phone ? t('Schedule message') : t('Send later')}
          kind="send"
          note={<p className="when-note">{t('“{text}” waits until then. Only you see it before it goes; you can change it in Drafts and sent.', { text: text.trim().slice(0, 80) })}</p>}
          onPick={(at) => send({ sendAt: at })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'task' && lib && (
        <PickSheet
          title={t('Share a task')}
          items={lib.tasks.filter((task) => !task.done && task.kind !== 'brief').slice(0, 200)}
          label={(task) => task.title}
          hint={(task) => (task.due ? t('Due {date}', { date: fmtDay(task.due) }) : undefined)}
          icon={() => <SquareCheck size={18} className="as-icon" />}
          empty={t('No open tasks to share')}
          top={
            text.trim() && lib.newTask ? (
              <button
                type="button"
                className="as-item"
                onClick={() => {
                  setSheet(null);
                  const id = lib.newTask!(text.trim());
                  if (id) send({ taskId: id });
                }}
              >
                <Plus size={18} className="as-icon" />
                <span className="as-label">
                  {t('New task: {title}', { title: text.trim().slice(0, 60) })}
                  <small>{t('Made for you, and shared here')}</small>
                </span>
              </button>
            ) : null
          }
          onPick={(task) => send({ taskId: task.id })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'note' && lib && (
        <PickSheet
          title={t('Share a note')}
          items={[...lib.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
          label={(n) => n.title || t('Untitled note')}
          hint={(n) => (n.visibility === 'private' ? t('Private: only you can open it') : undefined)}
          icon={() => <FileText size={18} className="as-icon" />}
          empty={t('No notes yet')}
          onPick={(n) => send({ ref: { kind: 'note', id: n.id, title: n.title || t('Untitled note') } })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'table' && lib && !table && (
        <PickSheet title={t('Which table')} items={lib.tables} label={(tb) => tb.name} icon={() => <Table2 size={18} className="as-icon" />} empty={t('No tables yet')} onPick={(tb) => setTimeout(() => (setTable(tb), setSheet('table')), 0)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'table' && lib && table && (
        <PickSheet
          title={table.name}
          items={lib.rows.filter((r) => r.tableId === table.id)}
          label={(r) => rowName(r, table)}
          icon={() => <Table2 size={18} className="as-icon" />}
          empty={t('No rows in this table yet')}
          onPick={(r) => send({ ref: { kind: 'row', id: r.id, tableId: table.id, title: rowName(r, table) } })}
          onClose={() => (setSheet(null), setTable(null))}
        />
      )}
      {sheet === 'drive' && lib && (
        <PickSheet
          title={t('Share a Drive file')}
          items={lib.drive.filter((d) => d.kind !== 'folder' && !d.trashed).sort((a, b) => b.modified.localeCompare(a.modified))}
          label={(d) => d.name}
          hint={(d) => fmtSize(d.size)}
          icon={() => <HardDrive size={18} className="as-icon" />}
          empty={t('Nothing in Drive yet')}
          onPick={(d) => (d.url ? send({ files: [{ name: d.name, size: d.size, type: d.kind === 'image' ? 'image/*' : d.kind === 'video' ? 'video/*' : 'application/octet-stream', url: d.url, driveId: d.id }] }) : send({ ref: { kind: 'file', id: d.id, title: d.name } }))}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** The line above the box while messages wait to be sent later. */
export function ScheduledLine({ list, onSee }: { list: ChatMessage[]; onSee: () => void }) {
  const last = useRef(list);
  if (list.length) last.current = list;
  const l = list.length ? list : last.current;
  const next = [...l].sort((a, b) => (a.sendAt ?? '').localeCompare(b.sendAt ?? ''))[0];
  return (
    <div className={`fold sched-fold${list.length ? ' open' : ''}`} aria-hidden={!list.length}>
      <div>
        {next?.sendAt && (
          <div className="sched-line" role="status">
            <span>
              {l.length === 1 ? t('1 message goes {when}', { when: whenText(next.sendAt) }) : tn(l.length, '{n} messages wait to be sent, the next {when}', '{n} messages wait to be sent, the next {when}', { when: whenText(next.sendAt) })}
            </span>
            <button type="button" className="link-btn" tabIndex={list.length ? 0 : -1} onClick={onSee}>
              {t('See')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
