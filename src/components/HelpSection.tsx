import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePhone } from '../mobile/media';
import { EditScreen, GField, GRow, Group, SwitchRow } from './ui/Grouped';
import { PushScreen } from './ui/PushScreen';
import { ArrowLeft, Check, LifeBuoy, Loader2, Paperclip, Send, X } from 'lucide-react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { uploadFile, wasSkipped } from '../sync';
import { diagnostics } from '../diagnostics';
import { relative } from '../utils';
import { EmptyState } from './ui/EmptyState';
import { mark, t, tn } from '../i18n';

interface Ticket {
  id: string;
  number: number;
  subject: string;
  status: 'new' | 'open' | 'waiting' | 'resolved' | 'closed';
  updatedAt: string;
  createdAt: string;
  unread: boolean;
  rating: 'good' | 'okay' | 'bad' | null;
}
interface Message {
  id: string;
  at: string;
  kind: 'customer' | 'operator' | 'system';
  authorName: string | null;
  body: string;
  attachments: { name: string; url: string }[];
}
type File2 = { name: string; url: string; size?: string };

const statusText = (tk: Ticket) => (tk.status === 'waiting' ? t('We replied') : tk.status === 'resolved' || tk.status === 'closed' ? t('Solved') : t('Waiting for us'));

/** Settings, Help & support: write to the sprint2go team and follow the answers here (they come by email too). Always sprint2go, also for white-labelled companies: this is for their team, not their guests. */
export function HelpSection({ workspaceId, toast, extra }: { workspaceId: string; toast: (t: string) => void; extra?: ReactNode }) {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [supportEmail, setSupportEmail] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const load = () =>
    fetch('/api/support')
      .then((r) => (r.ok ? r.json() : { tickets: [] }))
      .then((d: { tickets: Ticket[]; supportEmail?: string }) => (setList(d.tickets), setSupportEmail(d.supportEmail ?? '')), () => setList([]));
  useEffect(() => {
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => clearInterval(timer);
  }, []);
  const view = open ? 'thread' : writing ? 'new' : 'list';
  const phone = usePhone();
  // Phones (iOS Settings): Ask for help and each conversation are rows; each opens on its own screen.
  if (phone) {
    const tk = list?.find((x) => x.id === open);
    return (
      <>
        <h2>{t('Help & support')}</h2>
        <div className="set-rows">
          <Group footer={t('Questions about email setup, billing, guests or anything that doesn’t work: we usually answer within a few hours.')}>
            <GRow icon={Send} plainIcon action label={t('Ask for help')} onClick={() => setWriting(true)} />
          </Group>
          {list !== null && list.length > 0 && (
            <Group title={t('Conversations')}>
              {list.map((x) => (
                <GRow key={x.id} className={x.unread ? 'is-unread' : ''} label={x.subject} sub={`#${x.number} · ${relative(x.updatedAt)}`} value={x.unread ? t('New reply') : statusText(x)} onClick={() => setOpen(x.id)} />
              ))}
            </Group>
          )}
        </div>
        {extra && <div className="help-extra">{extra}</div>}
        {writing && <NewTicketPhone workspaceId={workspaceId} toast={toast} onBack={() => setWriting(false)} onSent={(id) => (void load(), setOpen(id))} />}
        {open && (
          <PushScreen title={tk?.subject ?? t('Help & support')} onBack={() => (setOpen(null), void load())} className="g-page help-push">
            <div className="help-push-body">
              <Thread id={open} onBack={() => (setOpen(null), void load())} toast={toast} workspaceId={workspaceId} />
            </div>
          </PushScreen>
        )}
      </>
    );
  }
  return (
    <>
      <h2>{t('Help & support')}</h2>
      <p className="set-intro">
        {supportEmail
          ? t('Ask the sprint2go team anything, or tell us what went wrong. Answers show up here and by email; you can also write to {email}.', { email: supportEmail })
          : t('Ask the sprint2go team anything, or tell us what went wrong. Answers show up here and by email.')}
      </p>
      <SmoothHeight>
        <TabPane key={view}>
          {view === 'thread' && open && <Thread id={open} onBack={() => (setOpen(null), void load())} toast={toast} workspaceId={workspaceId} />}
          {view === 'new' && <NewTicket workspaceId={workspaceId} toast={toast} onCancel={() => setWriting(false)} onSent={(id) => (setWriting(false), void load(), setOpen(id))} />}
          {view === 'list' && (
            <>
              <div className="help-top">
                <button type="button" className="primary-btn sm" onClick={() => setWriting(true)}>
                  <Send size={14} /> {t('Ask for help')}
                </button>
              </div>
              {list === null ? (
                <p className="muted small">{t('Loading…')}</p>
              ) : list.length === 0 ? (
                <EmptyState className="help-empty" icon={<LifeBuoy size={20} />} title={t('No conversations yet')} text={t('Questions about email setup, billing, guests or anything that doesn’t work: we usually answer within a few hours.')} />
              ) : (
                <div className="help-list">
                  {list.map((tk) => (
                    <button key={tk.id} type="button" className={`help-row ${tk.unread ? 'unread' : ''}`} onClick={() => setOpen(tk.id)}>
                      <span className="help-row-main">
                        <strong>{tk.subject}</strong>
                        <small>
                          #{tk.number} · {relative(tk.updatedAt)}
                        </small>
                      </span>
                      <span className={`help-status s-${tk.status}`}>{tk.unread ? t('New reply') : statusText(tk)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </TabPane>
      </SmoothHeight>
      {extra && <div className="help-extra">{extra}</div>}
    </>
  );
}

function Attach({ files, setFiles, workspaceId, toast }: { files: File2[]; setFiles: (f: File2[]) => void; workspaceId: string; toast: (t: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="help-attach">
      {files.map((f) => (
        <span key={f.url} className="help-file">
          <Paperclip size={12} /> {f.name}
          <button type="button" className="icon-btn xs" aria-label={t('Remove {name}', { name: f.name })} onClick={() => setFiles(files.filter((x) => x.url !== f.url))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={13} className="spin" /> : <Paperclip size={13} />} {t('Attach a screenshot or file')}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        onChange={async (e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, 5);
          e.target.value = '';
          if (!picked.length) return;
          setBusy(true);
          try {
            const up = await Promise.all(picked.map((f) => uploadFile(f, workspaceId)));
            setFiles([...files, ...up.map((u) => ({ name: u.name, url: u.url }))]);
          } catch (err) {
            if (!wasSkipped(err)) toast(t('That file couldn’t be uploaded. {error}', { error: (err as Error).message }));
          } finally {
            setBusy(false);
          }
        }}
      />
    </span>
  );
}

function NewTicket({ workspaceId, toast, onCancel, onSent }: { workspaceId: string; toast: (t: string) => void; onCancel: () => void; onSent: (id: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [share, setShare] = useState(true);
  const [files, setFiles] = useState<File2[]>([]);
  const [busy, setBusy] = useState(false);
  const d = diagnostics();
  const send = async () => {
    setBusy(true);
    const r = await fetch('/api/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, body, urgent, workspaceId, attachments: files, context: share ? d : undefined }) }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    const why = (data as { error?: string }).error;
    if (!r?.ok) return toast(why ? t(why) : t('Couldn’t send. Check your connection and try again.'));
    toast(t('Sent. We’ll reply here and by email (ticket #{number}).', { number: (data as { number: number }).number }));
    onSent((data as { id: string }).id);
  };
  return (
    <div className="help-form">
      <button type="button" className="link-btn small help-back" onClick={onCancel}>
        <ArrowLeft size={13} /> {t('Back')}
      </button>
      <label className="field">
        <span>{t('What’s it about?')}</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('e.g. Mail from our domain lands in spam')} autoFocus maxLength={200} />
      </label>
      <label className="field">
        <span>{t('Tell us more')}</span>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('What you did, what you expected, what happened instead.')} />
      </label>
      <Attach files={files} setFiles={setFiles} workspaceId={workspaceId} toast={toast} />
      <label className="check-row">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> {t('It’s stopping our work')}
      </label>
      <label className="check-row">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />{' '}
        {d.errors.length
          ? tn(d.errors.length, 'Include what helps us fix it: this page, {browser}, the app version and {n} recent error', 'Include what helps us fix it: this page, {browser}, the app version and {n} recent errors', { browser: d.browser })
          : t('Include what helps us fix it: this page, {browser}, the app version', { browser: d.browser })}
      </label>
      <div className="help-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="button" className="primary-btn" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void send()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t('Send')}
        </button>
      </div>
    </div>
  );
}

function Thread({ id, onBack, toast, workspaceId }: { id: string; onBack: () => void; toast: (t: string) => void; workspaceId: string }) {
  const [data, setData] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File2[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = () =>
    fetch(`/api/support/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData, () => {});
  useEffect(() => {
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000);
    return () => clearInterval(timer);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <p className="muted small">{t('Loading…')}</p>;
  const tk = data.ticket;
  const solved = tk.status === 'resolved' || tk.status === 'closed';
  const reply = async () => {
    setBusy(true);
    const r = await fetch(`/api/support/${encodeURIComponent(id)}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: text, attachments: files }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return toast(t('Couldn’t send. Try again.'));
    setText('');
    setFiles([]);
    void load();
  };
  const rate = async (rating: 'good' | 'okay' | 'bad') => {
    await fetch(`/api/support/${encodeURIComponent(id)}/rate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating, note }) }).catch(() => null);
    toast(t('Thanks for telling us.'));
    void load();
  };
  return (
    <div className="help-thread">
      <button type="button" className="link-btn small help-back" onClick={onBack}>
        <ArrowLeft size={13} /> {t('All conversations')}
      </button>
      <p className="help-title">
        {tk.subject} <span className="muted">#{tk.number}</span>
      </p>
      <div className="help-msgs">
        {data.messages.map((m) => (
          <div key={m.id} className={`help-msg ${m.kind}`}>
            <div className="help-msg-head">
              <strong>{m.kind === 'operator' ? `${m.authorName ?? t('Support')} · sprint2go` : t('You')}</strong>
              <small>{relative(m.at)}</small>
            </div>
            <div className="help-msg-body">{m.body}</div>
            {m.attachments.length > 0 && (
              <div className="help-attach">
                {m.attachments.map((a) => (
                  <a key={a.url} className="help-file" href={a.url} target="_blank" rel="noreferrer">
                    <Paperclip size={12} /> {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {solved && !tk.rating && (
        <div className="help-rate">
          <strong>{t('Did this solve it?')}</strong>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Anything to add? (optional)')} />
          <span className="help-rate-btns">
            <button type="button" className="ghost-btn sm" onClick={() => void rate('good')}>
              {t('Yes, thanks')}
            </button>
            <button type="button" className="ghost-btn sm" onClick={() => void rate('okay')}>
              {t('Partly')}
            </button>
            <button type="button" className="ghost-btn sm" onClick={() => void rate('bad')}>
              {t('Not really')}
            </button>
          </span>
        </div>
      )}
      {tk.rating && (
        <p className="muted small">
          <Check size={13} /> {t('You rated this answer. Write below if it comes back.')}
        </p>
      )}
      <div className="help-reply">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={solved ? t('Write to open it again') : t('Write a reply')} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && void reply()} />
        <div className="help-actions">
          <Attach files={files} setFiles={setFiles} workspaceId={workspaceId} toast={toast} />
          <button type="button" className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void reply()}>
            {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />} {t('Send')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asking for help on a phone (iOS): Cancel and Send at the top, the subject and the message as rows, then the choices. */
function NewTicketPhone({ workspaceId, toast, onBack, onSent }: { workspaceId: string; toast: (t: string) => void; onBack: () => void; onSent: (id: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [share, setShare] = useState(true);
  const [files, setFiles] = useState<File2[]>([]);
  const d = diagnostics();
  return (
    <EditScreen
      title={t('Ask for help')}
      saveLabel={t('Send')}
      canSave={!!subject.trim() && !!body.trim()}
      onBack={onBack}
      onSave={async () => {
        const r = await fetch('/api/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, body, urgent, workspaceId, attachments: files, context: share ? d : undefined }) }).catch(() => null);
        const data = r ? await r.json().catch(() => ({})) : {};
        const why = (data as { error?: string }).error;
        if (!r?.ok) return why ?? mark('Couldn’t send. Check your connection and try again.');
        toast(t('Sent. We’ll reply here and by email (ticket #{number}).', { number: (data as { number: number }).number }));
        // After this screen has gone: the conversation opens on its own screen.
        setTimeout(() => onSent((data as { id: string }).id), 0);
        return null;
      }}
    >
      <Group title={t('What’s it about?')}>
        <GField value={subject} onChange={setSubject} label={t('What’s it about?')} placeholder={t('e.g. Mail from our domain lands in spam')} maxLength={200} autoFocus />
      </Group>
      <Group title={t('Tell us more')}>
        <GField value={body} onChange={setBody} label={t('Tell us more')} placeholder={t('What you did, what you expected, what happened instead.')} multiline />
      </Group>
      <div className="help-phone-attach">
        <Attach files={files} setFiles={setFiles} workspaceId={workspaceId} toast={toast} />
      </div>
      <Group
        footer={
          d.errors.length
            ? tn(d.errors.length, 'Include what helps us fix it: this page, {browser}, the app version and {n} recent error', 'Include what helps us fix it: this page, {browser}, the app version and {n} recent errors', { browser: d.browser })
            : t('Include what helps us fix it: this page, {browser}, the app version', { browser: d.browser })
        }
      >
        <SwitchRow label={t('It’s stopping our work')} on={urgent} onChange={setUrgent} />
        <SwitchRow label={t('Include what helps us fix it')} on={share} onChange={setShare} />
      </Group>
    </EditScreen>
  );
}
