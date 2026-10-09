import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, KeyRound, Smartphone } from 'lucide-react';
import type { Workspace } from '../types';
import { SmoothHeight, TabPane, useLeaving } from './ui/Smooth';
import { EmptyState } from './ui/EmptyState';
import { server } from '../sync';
import { relative } from '../utils';
import '../phoneMailApps.css';

/*
 * Settings, Phone mail apps: sprint2go mail in iPhone Mail, Gmail, Outlook and Thunderbird (server/mailApps.ts).
 * Each person makes named app passwords here (shown once), removes them, and gets plain setup steps per app with the
 * server settings. Admins switch other mail apps on or off for the company. When the server can't offer it yet, it
 * says what's missing.
 */

/** Its place in Settings (one line in SettingsPage's SECTIONS). */
export const MAIL_APPS_SECTION = { id: 'mailapps' as const, name: 'Phone mail apps', icon: Smartphone, group: 'You' as const };

interface AppPassword {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedBy: 'imap' | 'smtp' | null;
}
interface Info {
  on: boolean;
  missing: 'switch' | 'certificate' | 'ports' | null;
  detail: string | null;
  acme: boolean; // the Cloudflare token is set, so Let's Encrypt can issue the certificate
  host: string;
  ports: { imap: number; imapStarttls: number; smtp: number; smtpStarttls: number };
  username: string;
  mailboxes: { email: string; name: string; shared: boolean; company: string; top: boolean; sends: boolean }[];
  passwords: AppPassword[];
  off: { id: string; name: string }[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? 'Something went wrong. Try again.');
  return d;
}
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** A value to type into a mail app, with Copy. */
function Value({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="pm-value">
      <code>{text}</code>
      <button
        type="button"
        className="icon-btn sm pm-copy"
        aria-label={`Copy the ${label}`}
        title={copied ? 'Copied' : 'Copy'}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1600)), () => {})}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}

type AppTab = 'iphone' | 'android' | 'outlook' | 'thunderbird';
const TABS: { id: AppTab; name: string }[] = [
  { id: 'iphone', name: 'iPhone' },
  { id: 'android', name: 'Android' },
  { id: 'outlook', name: 'Outlook' },
  { id: 'thunderbird', name: 'Thunderbird' },
];

export function PhoneMailApps({ ws, canManage, onWorkspace, toast }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void; toast?: (t: string) => void }) {
  const [info, setInfo] = useState<Info | null | 'failed'>(null);
  const [tab, setTab] = useState<AppTab>(() => (/android/i.test(navigator.userAgent) ? 'android' : 'iphone'));
  const [step, setStep] = useState<'closed' | 'form' | 'shown'>('closed');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const load = () =>
    void fetch('/api/mailapps')
      .then((r) => (r.ok ? (r.json() as Promise<Info>) : null))
      .then((d) => setInfo(d ?? 'failed'), () => setInfo('failed'));
  useEffect(() => {
    if (server.on) load();
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Again once an admin's switch here is saved (a moment later), so the mailboxes and notes follow.
  const firstSwitch = useRef(true);
  useEffect(() => {
    if (firstSwitch.current) return void (firstSwitch.current = false);
    if (!server.on) return;
    const t = setTimeout(load, 900);
    return () => clearTimeout(t);
  }, [ws.mailApps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step === 'form') setTimeout(() => nameRef.current?.focus(), 60);
  }, [step]);
  const rows = useLeaving(info && info !== 'failed' ? info.passwords : [], (p) => p.id);

  if (!server.on)
    return (
      <>
        <h2>Phone mail apps</h2>
        <p className="set-intro">Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. This works with sprint2go on a server; this demo has none.</p>
      </>
    );

  const d = info && info !== 'failed' ? info : null;
  const top = d?.mailboxes.find((m) => m.top);
  const others = d?.mailboxes.filter((m) => !m.top) ?? [];
  const here = ws.mailApps !== false;

  const make = async () => {
    if (!name.trim() || !pw || busy) return;
    setBusy('make');
    setError(null);
    try {
      const r = await post<{ id: string; name: string; password: string; createdAt: string }>('/api/mailapps/passwords', { name: name.trim(), password: pw });
      setMade({ name: r.name, password: r.password });
      setStep('shown');
      setPw('');
      setInfo((x) => (x && x !== 'failed' ? { ...x, passwords: [{ id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: null, lastUsedBy: null }, ...x.passwords] } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'It couldn’t be made. Try again.');
      setPw('');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (p: AppPassword) => {
    setBusy(p.id);
    try {
      await post('/api/mailapps/passwords/remove', { id: p.id });
      setInfo((x) => (x && x !== 'failed' ? { ...x, passwords: x.passwords.filter((y) => y.id !== p.id) } : x));
      toast?.(`“${p.name}” removed. Mail apps using it are signed out.`);
    } catch (e) {
      toast?.(e instanceof Error ? e.message : 'It couldn’t be removed. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const close = () => {
    setStep('closed');
    setError(null);
    setTimeout(() => (setMade(null), setName(''), setCopied(false)), 280);
  };
  const missingText =
    d?.missing === 'switch'
      ? 'Not available yet: other mail apps aren’t switched on for this sprint2go server.'
      : d?.missing === 'certificate'
        ? `Not available yet: it waits on a trusted certificate for ${d.host}${d.acme ? '' : ', which waits on the Cloudflare token'}.`
        : d?.missing === 'ports'
          ? 'Not available yet: the mail app ports couldn’t open on this server.'
          : null;
  const canMake = !!d?.on && d.mailboxes.length > 0;
  const used = (p: AppPassword) => (p.lastUsedAt ? `used ${relative(p.lastUsedAt)}${p.lastUsedBy === 'smtp' ? ' to send' : ''}` : 'not used yet');

  // The title and intro sit straight in the section (a phone's screen title takes their place); the rest reacts to its width.
  return (
    <>
      <h2>Phone mail apps</h2>
      <p className="set-intro">Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. Reading, moving and deleting there changes the same mail here.</p>
      <div className="pm">
        <SmoothHeight>
          {info === null ? (
            <p className="muted small pm-loading">Checking…</p>
          ) : info === 'failed' ? (
            <p className="pm-note">Couldn’t check right now. Try again in a moment.</p>
          ) : (
            <>
              {missingText && (
                <p className="pm-note">
                  {missingText}
                  {d?.detail && d.missing !== 'switch' && <small>{d.detail}</small>}
                </p>
              )}
              {d && d.off.length > 0 && (
                <p className="pm-note">
                  {d.off.map((o) => o.name).join(', ')} switched other mail apps off, so {d.off.length === 1 ? 'its' : 'their'} mailboxes don’t show in mail apps.
                  {canManage && d.off.some((o) => o.id === ws.id) && <small>You can switch it back on at the bottom of this page.</small>}
                </p>
              )}
              {d?.on && !d.mailboxes.length && !d.off.length && <p className="pm-note">You aren’t on any mailbox here yet, so there’s nothing to open in a mail app.</p>}
            </>
          )}
        </SmoothHeight>

        {d && (canMake || d.passwords.length > 0) && (
          <div className="set-block pm-block">
            <h3>App passwords</h3>
            <p className="set-hint pm-hint">Each mail app signs in with its own app password. Your sprint2go password never works there, so two-step sign-in stays safe. Remove one and that app is signed out at once.</p>
            <SmoothHeight>
              {rows.length === 0 ? (
                <EmptyState compact text="No app passwords yet." />
              ) : (
                rows.map(({ item: p, leaving }) => (
                  <div key={p.id} className={`set-row pm-pw ${leaving ? 'row-leaving' : ''}`}>
                    <span>
                      <strong>
                        <KeyRound size={14} /> {p.name}
                      </strong>
                      <small>
                        Made {day(p.createdAt)}, {used(p)}
                      </small>
                    </span>
                    <button type="button" className="ghost-btn outline sm" disabled={busy === p.id || leaving} onClick={() => void remove(p)}>
                      {busy === p.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))
              )}
            </SmoothHeight>
            {canMake && (
              <>
                <div className={`fold pm-fold ${step === 'closed' ? '' : 'open'}`} aria-hidden={step === 'closed'}>
                  <div className="fold-in">
                    <div className="pm-fold-body">
                      <SmoothHeight>
                        <TabPane key={step === 'shown' ? 'shown' : 'form'}>
                          {step === 'shown' && made ? (
                            <div className="pm-made">
                              <span className="pm-made-label">Your app password for “{made.name}”</span>
                              <span className="pm-secret">
                                <code>{made.password}</code>
                                <button type="button" className="ghost-btn sm" onClick={() => void navigator.clipboard?.writeText(made.password).then(() => setCopied(true), () => {})}>
                                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                                </button>
                              </span>
                              <small>Type it into your mail app as the password, with your email address as the user name. You won’t see it here again.</small>
                              <div className="pm-actions">
                                <button type="button" className="primary-btn sm" onClick={close}>
                                  Done
                                </button>
                              </div>
                            </div>
                          ) : (
                            <form
                              className="pm-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void make();
                              }}
                            >
                              <div className="field">
                                <label htmlFor="pm-name">Name</label>
                                <input id="pm-name" ref={nameRef} value={name} maxLength={60} placeholder="iPhone, Work laptop…" autoComplete="off" onChange={(e) => setName(e.target.value)} tabIndex={step === 'form' ? 0 : -1} />
                              </div>
                              <div className="field">
                                <label htmlFor="pm-pw">Your sprint2go password</label>
                                <input id="pm-pw" type="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} tabIndex={step === 'form' ? 0 : -1} />
                                <small>So nobody at an unlocked computer can add a way into your mail.</small>
                              </div>
                              <SmoothHeight>{error ? <p className="pm-error" role="alert">{error}</p> : null}</SmoothHeight>
                              <div className="pm-actions">
                                <button type="button" className="ghost-btn sm" onClick={close} tabIndex={step === 'form' ? 0 : -1}>
                                  Cancel
                                </button>
                                <button type="submit" className="primary-btn sm" disabled={!name.trim() || !pw || busy === 'make'} tabIndex={step === 'form' ? 0 : -1}>
                                  {busy === 'make' ? 'Making it…' : 'Make app password'}
                                </button>
                              </div>
                            </form>
                          )}
                        </TabPane>
                      </SmoothHeight>
                    </div>
                  </div>
                </div>
                <div className={`fold ${step === 'closed' ? 'open' : ''}`} aria-hidden={step !== 'closed'}>
                  <div className="fold-in">
                    <div className="pm-add">
                      <button type="button" className={d.passwords.length ? 'ghost-btn outline sm' : 'primary-btn sm'} onClick={() => setStep('form')} tabIndex={step === 'closed' ? 0 : -1}>
                        <KeyRound size={14} /> New app password
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {d?.on && top && (
          <div className="set-block pm-block">
            <h3>Set up your mail app</h3>
            <div className="segmented pm-tabs" role="tablist" aria-label="Mail app">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
            <SmoothHeight>
              <TabPane key={tab}>
                <ol className="pm-steps">
                  {tab === 'iphone' && (
                    <>
                      <li>
                        On the iPhone or iPad, open this page and download the setup profile: it fills in everything but the password.
                        <a className="ghost-btn outline sm pm-profile" href={`/api/mailapps/profile?mailbox=${encodeURIComponent(top.email)}`} download>
                          <Download size={14} /> Setup profile for {top.email}
                        </a>
                      </li>
                      <li>Open Settings, tap Profile Downloaded near the top, then Install. When it asks for a password, type an app password.</li>
                      <li>Or by hand: Settings, Apps, Mail, Mail Accounts, Add Account, Other, Add Mail Account. Choose IMAP and type the settings below for both servers.</li>
                    </>
                  )}
                  {tab === 'android' && (
                    <>
                      <li>In the Gmail app, tap your picture, then Add another account, then Other.</li>
                      <li>Type your email address, tap Manual setup and choose Personal (IMAP).</li>
                      <li>Type an app password, then the settings below for the incoming and outgoing servers, with SSL/TLS.</li>
                    </>
                  )}
                  {tab === 'outlook' && (
                    <>
                      <li>In Outlook, add an account and type your email address.</li>
                      <li>When it asks which kind, choose IMAP, then open the advanced settings.</li>
                      <li>Type the settings below and an app password for both servers.</li>
                    </>
                  )}
                  {tab === 'thunderbird' && (
                    <>
                      <li>In Thunderbird, choose New, Existing Email Account.</li>
                      <li>Type your name, your email address and an app password. Thunderbird finds the rest by itself.</li>
                      <li>If it can’t, choose Configure manually and type the settings below.</li>
                    </>
                  )}
                </ol>
              </TabPane>
            </SmoothHeight>
            <dl className="pm-settings">
              <dt>Incoming mail (IMAP)</dt>
              <dd>
                <Value text={d.host} label="incoming server" />
                <small>
                  Port {d.ports.imap}, SSL/TLS (or {d.ports.imapStarttls} with STARTTLS)
                </small>
              </dd>
              <dt>Outgoing mail (SMTP)</dt>
              <dd>
                <Value text={d.host} label="outgoing server" />
                <small>
                  Port {d.ports.smtp}, SSL/TLS (or {d.ports.smtpStarttls} with STARTTLS), sign-in on
                </small>
              </dd>
              <dt>User name</dt>
              <dd>
                <Value text={top.email} label="user name" />
              </dd>
              <dt>Password</dt>
              <dd>
                <small className="pm-plain">An app password from above, never your sprint2go password</small>
              </dd>
            </dl>
            <p className="set-hint pm-hint">
              {top.email} shows at the top: Inbox, Sent, Drafts, Archive (your Done), Snoozed, Trash, Spam and your labels.
              {others.length > 0 && ` ${others.map((m) => m.email).join(', ')} ${others.length === 1 ? 'shows' : 'show'} as folders inside it.`} Mail you send there goes out from sprint2go and shows in Sent here too.
            </p>
            {others.some((m) => m.shared) && (
              <p className="set-hint pm-hint">
                {others.filter((m) => m.shared).length === 1 ? 'The shared inbox follows' : 'Shared inboxes follow'} who is on {others.filter((m) => m.shared).length === 1 ? 'it' : 'them'} in sprint2go: take someone off and it leaves their mail app.
              </p>
            )}
          </div>
        )}

        {canManage && d && (
          <div className="set-block pm-block">
            <h3>{ws.name || 'Your company'}</h3>
            <div className="set-row">
              <span>
                <strong>Let people use other mail apps</strong>
                <small>
                  {here
                    ? `People at ${ws.name || 'the company'} can open their mailboxes here in iPhone Mail, Gmail, Outlook and Thunderbird, with app passwords.`
                    : `Off: nobody at ${ws.name || 'the company'} can open its mailboxes in other mail apps, and open connections ended.`}
                </small>
              </span>
              <button type="button" role="switch" aria-checked={here} aria-label="Let people use other mail apps" className={`switch ${here ? 'on' : ''}`} onClick={() => onWorkspace({ mailApps: !here })}>
                <span />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
