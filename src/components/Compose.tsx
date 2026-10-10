import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Bell, ChevronDown, ChevronUp, Clock, Sparkles, Eye, EyeOff, FileText, HardDrive, Maximize2, MousePointerClick, Minimize2, Minus, MoreVertical, Paperclip, Send, SendHorizontal, Trash2, Type, X } from 'lucide-react';
import { ActionSheet } from './ui/ActionSheet';
import type { Person } from '../types';
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
import { startAtTop } from './mail/caret';
import { t, tx, getLang } from '../i18n';
import { ConfidentialSheet, OptionChips, defaultSpell, moreOptions, sendersOf, swapSignature, type SendExtras, type SpellLang } from './mail/composeExtras';
import { suggestNext } from './mail/smartCompose';
import type { Workspace } from '../types';
// Attachments (src/components/mail/DraftFiles.tsx): uploaded when added, big ones as Drive links, Insert from Drive,
// pictures pasted into the words.
import { DraftFilesList, useDraftFiles } from './mail/DraftFiles';
import { DrivePicker } from './mail/DrivePicker';
import { uploadForMail, type LinkAccess } from './mail/attachApi';
import { toast } from '../toast';

export interface OutgoingFile {
  name: string;
  size: number;
  url: string;
  type?: string;
  link?: boolean; // goes as a Drive link (too big for the email, or picked as a link)
}

export interface Outgoing extends SendExtras {
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
  /** Who can open the files that go as Drive links. */
  linkAccess?: LinkAccess;
}

interface Props {
  contacts: Person[];
  signature: string;
  /** Each address's own signature (Settings, Mail); switching From switches it. Missing: `signature` for all. */
  signatureFor?: (address: string) => string;
  /** The company: its aliases are offered as From under the mailbox they deliver into. */
  workspace?: Pick<Workspace, 'id' | 'domains' | 'mailAliases'>;
  /** Smart compose: on (Settings, Mail), and whether the company's AI writes it (else everyday phrases do). */
  smartCompose?: boolean;
  aiOn?: boolean;
  myName?: string;
  /** A reply popped out of the reader: it goes into that conversation (the title says so). */
  replying?: boolean;
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

export function Compose({ contacts, signature: baseSignature, signatureFor, workspace, smartCompose = true, aiOn = false, myName, replying = false, trackByDefault, canTrack = true, accounts, defaultFrom, userId, initial, onSend, onClose, parked = false, onPark, snapshot }: Props) {
  const phone = usePhone();
  // From: a mailbox, or one of its aliases (sent as that address, with that address's signature).
  const startFrom = initial?.fromId && accounts.some((a) => a.id === initial.fromId) ? initial.fromId : defaultFrom;
  const addressOf = (id: string) => accounts.find((a) => a.id === id)?.email.toLowerCase() ?? '';
  // An address it can't send as any more (an alias removed since the draft was saved) falls back to the mailbox's own.
  const startAddress = initial?.fromAddress?.toLowerCase();
  const [fromAddress, setFromAddress] = useState(startAddress && (!workspace || sendersOf(workspace, accounts.find((a) => a.id === startFrom) ?? { id: '', email: '' }).includes(startAddress)) ? startAddress : addressOf(startFrom));
  const sigOf = (address: string) => (signatureFor ? signatureFor(address) : baseSignature);
  const signature = sigOf(fromAddress);
  const [extras, setExtras] = useState<SendExtras>({ replyTo: initial?.replyTo, priority: initial?.priority, confidential: initial?.confidential, plain: initial?.plain });
  const setX = (patch: Partial<SendExtras>) => setExtras((x) => ({ ...x, ...patch }));
  const [showReplyTo, setShowReplyTo] = useState(!!initial?.replyTo?.length);
  const [spell, setSpell] = usePersisted<SpellLang | ''>('s2g-mail-spell', '');
  const spellLang: SpellLang = spell || defaultSpell();
  const [confOpen, setConfOpen] = useState(false);
  const [deskMore, setDeskMore] = useState(false);
  const deskMoreBtn = useRef<HTMLButtonElement>(null);
  const [to, setTo] = useState<Person[]>(initial?.to ?? []);
  const [cc, setCc] = useState<Person[]>(initial?.cc ?? []);
  const [bcc, setBcc] = useState<Person[]>(initial?.bcc ?? []);
  const [showCc, setShowCc] = useState(!!initial?.cc.length || !!initial?.bcc?.length);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial ? { html: initial.html, text: initial.text } : { html: signature ? `<p><br></p>${signature}` : '', text: '' });
  const df = useDraftFiles(initial?.files ?? [], body.html.length);
  const [linkAccess, setLinkAccess] = useState<LinkAccess>(initial?.linkAccess ?? 'recipients');
  const [drivePick, setDrivePick] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const clipBtn = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const [trackChoice, setTrackChoice] = useState<boolean | null>(initial ? initial.track : null);
  const [opts, setOpts] = useState<TrackOptions>(initial?.trackOptions ?? DEFAULT_TRACK_OPTIONS);
  const [optsOpen, setOptsOpen] = useState(false);
  const [fromId, setFromId] = useState(startFrom);
  /** Picking another From: the signature in the body becomes that address's. */
  const pickFrom = (value: string) => {
    const [id, address] = value.split('|');
    const next = address || addressOf(id);
    const was = signature;
    setFromId(id);
    setFromAddress(next);
    const now = sigOf(next);
    if (now !== was) editor.current?.setHtml(swapSignature(bodyRef.current.html, was, now));
  };
  const fromChoices = accounts.flatMap((a) => {
    const all = workspace ? sendersOf(workspace, a) : [a.email.toLowerCase()];
    return all.map((address, i) => ({ value: `${a.id}|${address}`, label: i === 0 ? `${a.name} <${a.email}>` : `${a.name} <${address}>`, hint: i ? t('Alias') : a.kind === 'shared' ? t('Shared inbox') : undefined, group: all.length > 1 ? a.email : undefined }));
  });
  const [deskWin, setWin] = useState<WinState>('normal');
  // Phones: one full-screen compose (Gmail's); closing keeps a draft, Drafts is in the drawer. No parked pill.
  const win: WinState = phone ? 'normal' : deskWin;
  void parked;
  void onPark;
  const [phoneMore, setPhoneMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
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
  const files = df.out();
  const message = (): Outgoing => ({ to, cc, bcc, subject: subject.trim(), html: body.html, text: body.text, files, track: track && !extras.confidential, trackOptions: opts, fromId, linkAccess, ...extras, replyTo: showReplyTo && extras.replyTo?.length ? extras.replyTo : undefined, ...(fromAddress && fromAddress !== addressOf(fromId) ? { fromAddress } : {}) });
  const typed = hasOwnText(body.text, signature);
  const hasContent = to.length > 0 || cc.length > 0 || bcc.length > 0 || !!subject.trim() || typed || files.length > 0;
  // Not while a file is still uploading (it would go without it).
  const valid = to.length + cc.length + bcc.length > 0 && (typed || files.length > 0) && !df.busy;
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

  const addFiles = (list: FileList | null) => df.add(list);
  /** Pictures pasted or dropped into the words: uploaded, then shown where they were put (cid images when sent). */
  const inlineImages = (pics: File[]) =>
    Promise.all(
      pics.map((f) =>
        uploadForMail(f).then(
          (up) => ({ url: up.url, name: f.name }),
          (e: Error) => (toast({ text: e.message }), null),
        ),
      ),
    );

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

  const title = subject.trim() || (replying ? t('Reply') : t('New message'));
  /** Plain text mode: the formatting goes, the words stay. */
  const setPlain = (on: boolean) => {
    if (on) editor.current?.setHtml(textToHtml(bodyRef.current.text));
    setX({ plain: on });
  };
  const setXs = (patch: Partial<SendExtras>) => ('plain' in patch ? setPlain(!!patch.plain) : setX(patch));
  const more = () =>
    moreOptions(extras, setXs, {
      showReplyTo,
      onReplyTo: () => setShowReplyTo((v) => !v),
      onConfidential: () => setConfOpen(true),
      spell: spellLang,
      onSpell: (l) => setSpell(l),
    });
  const suggest = smartCompose ? (before: string) => suggestNext(before, { aiOn, workspaceId: workspace?.id ?? '', subject, to: to[0]?.name || to[0]?.email, me: myName, lang: getLang() === 'id' ? 'Indonesian' : undefined }) : undefined;
  const discard = () => {
    setClosing(true);
    setTimeout(() => onClose(null), 160);
  };
  const insertTemplate = (text: string) => {
    editor.current?.setHtml(textToHtml(text) + (signature ? `<p><br></p>${signature}` : ''));
    requestAnimationFrame(() => editor.current?.focus());
  };
  const trackTitle = !external.length
    ? t('Your team’s mail is never tracked')
    : track
      ? external.length === 1
        ? t('{name}’s copy gets an invisible picture and links that pass through {product}, so you see when it’s opened and which links are clicked. Teammates are never tracked. Apple Mail can load pictures by itself, so treat opens as a hint.', { name: external[0].name, product: product.name })
        : t('Each of the {n} people outside the team gets a copy with an invisible picture and links that pass through {product}, so you see when it’s opened and which links are clicked. Teammates are never tracked. Apple Mail can load pictures by itself, so treat opens as a hint.', { n: external.length, product: product.name })
      : t('Not tracked. Turn on to see when people outside the team open it and which links they click.');

  return (
    <>
      {win === 'max' && <div className={`compose-scrim ${closing ? 'out' : ''}`} onClick={() => setWin('normal')} />}
      <div
        ref={box}
        className={`compose ${win} ${closing ? 'closing' : ''} ${dragOver ? 'drag' : ''}${phone ? ' phone' : ''}${format ? ' fmt-on' : ''}${!phone && win === 'normal' && size.w < 640 ? ' narrow' : ''}`}
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
            <button type="button" className="icon-btn" onClick={() => close()} aria-label={t('Close and keep as a draft')} title={t('Close (kept in Drafts)')}>
              <X size={22} />
            </button>
            <span className="compose-title">{t('Compose')}</span>
            <button type="button" ref={clipBtn} className="icon-btn" onClick={() => setAttachMenu(true)} aria-label={t('Attach files')} title={t('Attach files')}>
              <Paperclip size={22} />
            </button>
            <button type="button" className={`icon-btn compose-send-icon lp${valid ? ' ready' : ''}`} onClick={send} aria-disabled={!valid} aria-label={t('Send. Hold for Send later')} title={t('Send')} {...holdSend}>
              <SendHorizontal size={22} />
            </button>
            <button type="button" ref={moreBtn} className="icon-btn" onClick={() => setPhoneMore(true)} aria-label={t('More')} title={t('More')}>
              <MoreVertical size={22} />
            </button>
          </header>
        ) : (
          <header className="compose-head" onClick={() => win === 'min' && setWin('normal')}>
            <span className="compose-title">{title}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn sm" onClick={() => setWin(win === 'min' ? 'normal' : 'min')} title={t('Minimize')}>
                <Minus size={15} />
              </button>
              <button className="icon-btn sm" onClick={() => setWin(win === 'max' ? 'normal' : 'max')} title={win === 'max' ? t('Exit full screen') : t('Full screen')}>
                {win === 'max' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="icon-btn sm" onClick={() => close()} title={t('Save draft & close (Esc)')}>
                <X size={15} />
              </button>
            </div>
          </header>
        )}

        <div className="compose-main">
          {fromChoices.length > 1 && (
            <label className="compose-field from-field">
              <span>{tx('mail', 'From')}</span>
              <Select value={`${fromId}|${fromAddress}`} onChange={pickFrom} label={tx('mail', 'From')} className="sel-flat from-sel" width={340} options={fromChoices} />
            </label>
          )}
          <RecipientInput
            label={t('To')}
            value={to}
            contacts={contacts}
            autoFocus={!to.length}
            onChange={setTo}
            trailing={
              !showCc &&
              (phone ? (
                <button type="button" className="icon-btn cc-caret" onClick={() => setShowCc(true)} aria-label={t('Add Cc and Bcc')} title="Cc/Bcc">
                  <ChevronDown size={20} />
                </button>
              ) : (
                <button type="button" className="cc-toggle" onClick={() => setShowCc(true)}>
                  Cc/Bcc
                </button>
              ))
            }
          />
          {showCc && (
            <div className="cc-rows">
              <RecipientInput label="Cc" value={cc} contacts={contacts} onChange={setCc} />
              <RecipientInput label="Bcc" value={bcc} contacts={contacts} onChange={setBcc} />
            </div>
          )}
          {showReplyTo && <RecipientInput label={t('Reply to')} value={extras.replyTo ?? []} contacts={contacts} autoFocus={!extras.replyTo?.length} onChange={(v) => setX({ replyTo: v })} />}
          <label className="compose-field">
            <span>{t('Subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={phone ? t('Subject') : t('What’s this about?')} />
          </label>
          <OptionChips x={extras} set={setXs} onConfidential={() => setConfOpen(true)} />

          <div className="compose-body" onClick={(e) => startAtTop(e, typed)}>
            <RichEditor ref={editor} autoFocus={to.length > 0} initialHtml={body.html} placeholder={phone ? t('Compose email') : t('Write something great…')} onChange={(html, text) => setBody({ html, text })} onSubmit={send} spellLang={spellLang} plain={!!extras.plain} suggest={suggest} onImages={inlineImages} />
          </div>

          <DraftFilesList state={df} access={linkAccess} onAccess={setLinkAccess} />
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
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        {phone ? (
          // The strip above the keyboard (only while it's up): help writing, formatting, templates.
          <footer className="compose-foot kb-bar" onMouseDown={(e) => e.preventDefault()}>
            <button type="button" className={`icon-btn kb-ai${aiOpen ? ' on' : ''}${!ownText ? ' labelled' : ''}`} onClick={() => setAiOpen((o) => !o)} aria-pressed={aiOpen} aria-label={t('Help me write')} title={t('Help me write')}>
              <Sparkles size={19} />
              {!ownText && <span>{t('Help me write')}</span>}
            </button>
            <button type="button" className={`icon-btn${format ? ' on' : ''}`} onClick={() => setFormat((f) => !f)} aria-pressed={format} aria-label={t('Formatting')} title={t('Formatting')}>
              <Type size={19} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setTplOpen(true)} aria-label={t('Templates')} title={t('Templates')}>
              <FileText size={19} />
            </button>
            <span className="spacer" />
          </footer>
        ) : (
          <footer className="compose-foot">
            <button ref={laterBtn} className="ghost-btn sm" disabled={!valid} onClick={() => setLaterOpen((o) => !o)} title={t('Send later')}>
              <Clock size={14} /> {t('Later')}
            </button>
            <button className="primary-btn" onClick={send} disabled={!valid} title={df.busy ? t('Wait for the files to finish uploading') : undefined}>
              <Send size={15} /> {t('Send')} <kbd>⌘↵</kbd>
            </button>
            <button className="icon-btn" title={t('Attach files')} onClick={() => fileInput.current?.click()}>
              <Paperclip size={17} />
            </button>
            <button className="icon-btn" title={t('Insert from Drive')} aria-label={t('Insert from Drive')} onClick={() => setDrivePick(true)}>
              <HardDrive size={17} />
            </button>
            <button className={`icon-btn ai-btn ${aiOpen ? 'on' : ''}`} title={t('Write with AI')} onClick={() => setAiOpen((o) => !o)}>
              <Sparkles size={17} />
            </button>
            <button ref={tplBtn} className={`icon-btn ${tplOpen ? 'on' : ''}`} title={t('Templates')} onClick={() => setTplOpen((o) => !o)}>
              <FileText size={17} />
            </button>
            <button ref={deskMoreBtn} className={`icon-btn ${deskMore ? 'on' : ''}`} title={t('More options')} aria-label={t('More options')} onClick={() => setDeskMore((o) => !o)}>
              <MoreVertical size={17} />
            </button>
            {canTrack && !extras.confidential && (
              <div className="track-split">
                <button className={`track-toggle ${track ? 'on' : ''}`} disabled={!external.length} onClick={() => setTrackChoice(!track)} title={trackTitle}>
                  {track ? <Eye size={15} /> : <EyeOff size={15} />}
                  <span>{track ? t('Tracking') : !external.length && to.length ? t('Teammates aren’t tracked') : t('Not tracked')}</span>
                </button>
                {track && (
                  <button className={`track-more ${optsOpen ? 'on' : ''}`} onClick={() => setOptsOpen((o) => !o)} title={t('Choose what to track')}>
                    <ChevronUp size={14} />
                  </button>
                )}
                {track && optsOpen && (
                  <div className="track-menu" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOptsOpen(false))}>
                    <div className="tm-title">{t('What do you want to know?')}</div>
                    {(
                      [
                        ['opens', Eye, t('Opens'), t('When and how often they open it')],
                        ['clicks', MousePointerClick, t('Link clicks'), t('Which links they click')],
                        ['notify', Bell, t('Notify me'), t('The first time each person opens it')],
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
                        <strong>{t('Remind me if no reply')}</strong>
                        <small>{t('Tells you, and moves it to “Waiting for reply”')}</small>
                      </span>
                      <div className="segmented">
                        {[0, 1, 3, 7].map((d) => (
                          <button key={d} className={opts.remindDays === d ? 'on' : ''} onClick={() => setOpts((o) => ({ ...o, remindDays: d }))}>
                            {d ? t('{n}d', { n: d }) : tx('remind', 'Off')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="tm-foot">{t('Tracking {names}. Teammates are never tracked. Apple Mail and some mail filters load pictures by themselves; those opens show as maybe automatic.', { names: external.map((p) => p.name.split(' ')[0]).join(', ') })}</div>
                  </div>
                )}
              </div>
            )}
            <span className="spacer" />
            <button className="icon-btn" title={t('Discard')} onClick={discard}>
              <Trash2 size={16} />
            </button>
          </footer>
        )}

        {dragOver && <div className="drop-hint">{t('Drop files to attach')}</div>}
      </div>
      {phone && (
        <ActionSheet
          open={phoneMore}
          onClose={() => setPhoneMore(false)}
          anchor={moreBtn}
          menu
          actions={[
            { label: t('Send later'), icon: Clock, disabled: !valid, run: () => setLaterOpen(true) },
            { label: t('Templates'), icon: FileText, run: () => setTplOpen(true) },
            ...(canTrack && !extras.confidential ? [{ label: t('Read tracking'), icon: track ? Eye : EyeOff, checked: track, disabled: !external.length, hint: external.length ? undefined : t('Your team’s mail is never tracked'), run: () => setTrackChoice(!track) }] : []),
            ...more(),
            { label: t('Discard'), icon: Trash2, danger: true, group: 'end', run: discard },
          ]}
        />
      )}
      {phone && (
        <ActionSheet
          open={attachMenu}
          onClose={() => setAttachMenu(false)}
          anchor={clipBtn}
          menu
          actions={[
            { label: t('Attach file'), icon: Paperclip, run: () => fileInput.current?.click() },
            { label: t('Insert from Drive'), icon: HardDrive, run: () => setDrivePick(true) },
          ]}
        />
      )}
      {drivePick && <DrivePicker onClose={() => setDrivePick(false)} onPick={(list) => df.addExisting(list)} />}
      {!phone && <ActionSheet open={deskMore} onClose={() => setDeskMore(false)} anchor={deskMoreBtn} title={t('More options')} width={280} actions={deskMore ? more() : []} />}
      {confOpen && <ConfidentialSheet value={extras.confidential} onSave={(c) => setX({ confidential: c })} onClose={() => setConfOpen(false)} />}
      <SendLaterPicker open={laterOpen} onClose={() => setLaterOpen(false)} anchor={phone ? undefined : laterBtn} onPick={(at) => close(true, at)} />
      <TemplatesPicker open={tplOpen} onClose={() => setTplOpen(false)} anchor={phone ? undefined : tplBtn} userId={userId} current={ownText} onInsert={insertTemplate} />
    </>
  );
}
