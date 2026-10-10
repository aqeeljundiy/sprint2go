import { useEffect, useRef, useState } from 'react';
import { usePhone } from '../mobile/media';
import { EditScreen, GField, GRow, Group } from './ui/Grouped';
import { PushScreen } from './ui/PushScreen';
import { Check, Copy, Download, KeyRound, Plus, Smartphone } from 'lucide-react';
import type { Workspace } from '../types';
import { SmoothHeight, TabPane, useLeaving } from './ui/Smooth';
import { EmptyState } from './ui/EmptyState';
import { server } from '../sync';
import { relative } from '../utils';
import { mark, t, tn } from '../i18n';
import { fmtDay, fmtList } from '../i18n/format';
import '../phoneMailApps.css';

/*
 * Settings, Phone mail apps: sprint2go mail in iPhone Mail, Gmail, Outlook and Thunderbird (server/mailApps.ts).
 * Each person makes named app passwords here (shown once), removes them, and gets plain setup steps per app with the
 * server settings. Admins switch other mail apps on or off for the company. When the server can't offer it yet, it
 * says what's missing.
 */

/** Its place in Settings (one line in SettingsPage's SECTIONS). */
export const MAIL_APPS_SECTION = { id: 'mailapps' as const, name: mark('Phone mail apps'), icon: Smartphone, group: 'You' as const };

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
  if (!r.ok) throw new Error(d.error ? t(d.error) : t('Something went wrong. Try again.'));
  return d;
}

/** A value to type into a mail app, with Copy. */
function Value({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="pm-value">
      <code>{text}</code>
      <button
        type="button"
        className="icon-btn sm pm-copy"
        aria-label={t('Copy the {what}', { what: label })}
        title={copied ? t('Copied') : t('Copy')}
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
  const phone = usePhone();
  const [pwOpen, setPwOpen] = useState<string | null>(null); // phones: an app password on its own screen
  const justMade = useRef(false);

  if (!server.on)
    return (
      <>
        <h2>{t('Phone mail apps')}</h2>
        <p className="set-intro">{t('Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. This works with sprint2go on a server; this demo has none.')}</p>
      </>
    );

  const d = info && info !== 'failed' ? info : null;
  const top = d?.mailboxes.find((m) => m.top);
  const others = d?.mailboxes.filter((m) => !m.top) ?? [];
  const here = ws.mailApps !== false;

  /** Makes an app password; the error (also kept for the desktop form) when it couldn't. */
  const make = async (): Promise<string | null> => {
    if (!name.trim() || !pw || busy) return null;
    setBusy('make');
    setError(null);
    try {
      const r = await post<{ id: string; name: string; password: string; createdAt: string }>('/api/mailapps/passwords', { name: name.trim(), password: pw });
      setMade({ name: r.name, password: r.password });
      setStep('shown');
      setPw('');
      setInfo((x) => (x && x !== 'failed' ? { ...x, passwords: [{ id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: null, lastUsedBy: null }, ...x.passwords] } : x));
      return null;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('It couldn’t be made. Try again.');
      setError(m);
      setPw('');
      return m;
    } finally {
      setBusy(null);
    }
  };
  const remove = async (p: AppPassword) => {
    setBusy(p.id);
    try {
      await post('/api/mailapps/passwords/remove', { id: p.id });
      setInfo((x) => (x && x !== 'failed' ? { ...x, passwords: x.passwords.filter((y) => y.id !== p.id) } : x));
      toast?.(t('“{name}” removed. Mail apps using it are signed out.', { name: p.name }));
    } catch (e) {
      toast?.(e instanceof Error ? e.message : t('It couldn’t be removed. Try again.'));
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
      ? t('Not available yet: other mail apps aren’t switched on for this sprint2go server.')
      : d?.missing === 'certificate'
        ? d.acme
          ? t('Not available yet: it waits on a trusted certificate for {host}.', { host: d.host })
          : t('Not available yet: it waits on a trusted certificate for {host}, which waits on the Cloudflare token.', { host: d.host })
        : d?.missing === 'ports'
          ? t('Not available yet: the mail app ports couldn’t open on this server.')
          : null;
  const canMake = !!d?.on && d.mailboxes.length > 0;
  const opened = d?.passwords.find((p) => p.id === pwOpen);
  /** "Made 8 Oct, used 5 min ago": one sentence per state, so each language orders it its own way. */
  const madeLine = (p: AppPassword) =>
    !p.lastUsedAt
      ? t('Made {day}, not used yet', { day: fmtDay(p.createdAt) })
      : p.lastUsedBy === 'smtp'
        ? t('Made {day}, used {ago} to send', { day: fmtDay(p.createdAt), ago: relative(p.lastUsedAt) })
        : t('Made {day}, used {ago}', { day: fmtDay(p.createdAt), ago: relative(p.lastUsedAt) });

  // The title and intro sit straight in the section (a phone's screen title takes their place); the rest reacts to its width.
  return (
    <>
      <h2>{t('Phone mail apps')}</h2>
      <p className="set-intro">{t('Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. Reading, moving and deleting there changes the same mail here.')}</p>
      <div className="pm">
        <SmoothHeight>
          {info === null ? (
            <p className="muted small pm-loading">{t('Checking…')}</p>
          ) : info === 'failed' ? (
            <p className="pm-note">{t('Couldn’t check right now. Try again in a moment.')}</p>
          ) : (
            <>
              {missingText && (
                <p className="pm-note">
                  {missingText}
                  {d?.detail && d.missing !== 'switch' && <small>{t(d.detail)}</small>}
                </p>
              )}
              {d && d.off.length > 0 && (
                <p className="pm-note">
                  {tn(d.off.length, '{names} switched other mail apps off, so its mailboxes don’t show in mail apps.', '{names} switched other mail apps off, so their mailboxes don’t show in mail apps.', { names: fmtList(d.off.map((o) => o.name)) })}
                  {canManage && d.off.some((o) => o.id === ws.id) && <small>{t('You can switch it back on at the bottom of this page.')}</small>}
                </p>
              )}
              {d?.on && !d.mailboxes.length && !d.off.length && <p className="pm-note">{t('You aren’t on any mailbox here yet, so there’s nothing to open in a mail app.')}</p>}
            </>
          )}
        </SmoothHeight>

        {d && (canMake || d.passwords.length > 0) && phone && (
          <div className="set-rows">
            <Group title={t('App passwords')} footer={t('Each mail app signs in with its own app password. Your sprint2go password never works there, so two-step sign-in stays safe. Remove one and that app is signed out at once.')}>
              {rows.length === 0 && <GRow label={t('No app passwords yet.')} />}
              {rows.map(({ item: p, leaving }) => (
                <GRow key={p.id} icon={KeyRound} plainIcon className={leaving ? 'row-leaving' : ''} label={p.name} sub={madeLine(p)} onClick={() => setPwOpen(p.id)} />
              ))}
              {canMake && <GRow icon={Plus} plainIcon action label={t('New app password')} onClick={() => setStep('form')} />}
            </Group>
            {step === 'form' && (
              <EditScreen title={t('New app password')} saveLabel={t('Make')} canSave={!!name.trim() && !!pw} onBack={() => (justMade.current ? (justMade.current = false) : close())} onSave={async () => {
                const err = await make();
                // Made: this screen gives way to the one with the password (step 'shown'), so leaving it doesn't close that.
                if (!err) justMade.current = true;
                return err;
              }}>
                <Group title={t('Name')}>
                  <GField value={name} onChange={setName} label={t('Name')} placeholder={t('iPhone, Work laptop…')} maxLength={60} autoComplete="off" autoFocus />
                </Group>
                <Group title={t('Your sprint2go password')} footer={t('So nobody at an unlocked computer can add a way into your mail.')}>
                  <GField value={pw} onChange={setPw} label={t('Your sprint2go password')} type="password" autoComplete="current-password" />
                </Group>
              </EditScreen>
            )}
            {step === 'shown' && made && (
              <PushScreen title={made.name} onBack={close} className="g-page g-edit" actions={<button type="button" className="g-save" onClick={close}>{t('Done')}</button>}>
                <div className="g-body">
                  <Group title={t('Your app password for “{name}”', { name: made.name })} footer={t('Type it into your mail app as the password, with your email address as the user name. You won’t see it here again.')}>
                    <GRow
                      label={<code className="pm-secret-code">{made.password}</code>}
                      accessory={
                        <button type="button" className="g-btn" aria-label={t('Copy')} onClick={() => void navigator.clipboard?.writeText(made.password).then(() => setCopied(true), () => {})}>
                          {copied ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                      }
                    />
                  </Group>
                </div>
              </PushScreen>
            )}
            {opened && (
              <PushScreen title={opened.name} onBack={() => setPwOpen(null)} className="g-page g-edit">
                <div className="g-body">
                  <Group footer={t('Remove one and that app is signed out at once.')}>
                    <GRow label={madeLine(opened)} />
                  </Group>
                  <Group>
                    <GRow label={busy === opened.id ? t('Removing…') : t('Remove')} danger onClick={busy ? undefined : () => (setPwOpen(null), void remove(opened))} />
                  </Group>
                </div>
              </PushScreen>
            )}
          </div>
        )}

        {d && (canMake || d.passwords.length > 0) && !phone && (
          <div className="set-block pm-block">
            <h3>{t('App passwords')}</h3>
            <p className="set-hint pm-hint">{t('Each mail app signs in with its own app password. Your sprint2go password never works there, so two-step sign-in stays safe. Remove one and that app is signed out at once.')}</p>
            <SmoothHeight>
              {rows.length === 0 ? (
                <EmptyState compact text={t('No app passwords yet.')} />
              ) : (
                rows.map(({ item: p, leaving }) => (
                  <div key={p.id} className={`set-row pm-pw ${leaving ? 'row-leaving' : ''}`}>
                    <span>
                      <strong>
                        <KeyRound size={14} /> {p.name}
                      </strong>
                      <small>{madeLine(p)}</small>
                    </span>
                    <button type="button" className="ghost-btn outline sm" disabled={busy === p.id || leaving} onClick={() => void remove(p)}>
                      {busy === p.id ? t('Removing…') : t('Remove')}
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
                              <span className="pm-made-label">{t('Your app password for “{name}”', { name: made.name })}</span>
                              <span className="pm-secret">
                                <code>{made.password}</code>
                                <button type="button" className="ghost-btn sm" onClick={() => void navigator.clipboard?.writeText(made.password).then(() => setCopied(true), () => {})}>
                                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy')}
                                </button>
                              </span>
                              <small>{t('Type it into your mail app as the password, with your email address as the user name. You won’t see it here again.')}</small>
                              <div className="pm-actions">
                                <button type="button" className="primary-btn sm" onClick={close}>
                                  {t('Done')}
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
                                <label htmlFor="pm-name">{t('Name')}</label>
                                <input id="pm-name" ref={nameRef} value={name} maxLength={60} placeholder={t('iPhone, Work laptop…')} autoComplete="off" onChange={(e) => setName(e.target.value)} tabIndex={step === 'form' ? 0 : -1} />
                              </div>
                              <div className="field">
                                <label htmlFor="pm-pw">{t('Your sprint2go password')}</label>
                                <input id="pm-pw" type="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} tabIndex={step === 'form' ? 0 : -1} />
                                <small>{t('So nobody at an unlocked computer can add a way into your mail.')}</small>
                              </div>
                              <SmoothHeight>{error ? <p className="pm-error" role="alert">{error}</p> : null}</SmoothHeight>
                              <div className="pm-actions">
                                <button type="button" className="ghost-btn sm" onClick={close} tabIndex={step === 'form' ? 0 : -1}>
                                  {t('Cancel')}
                                </button>
                                <button type="submit" className="primary-btn sm" disabled={!name.trim() || !pw || busy === 'make'} tabIndex={step === 'form' ? 0 : -1}>
                                  {busy === 'make' ? t('Making it…') : t('Make app password')}
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
                        <KeyRound size={14} /> {t('New app password')}
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
            <h3>{t('Set up your mail app')}</h3>
            <div className="segmented pm-tabs" role="tablist" aria-label={t('Mail app')}>
              {TABS.map((tb) => (
                <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={tab === tb.id ? 'on' : ''} onClick={() => setTab(tb.id)}>
                  {tb.name}
                </button>
              ))}
            </div>
            <SmoothHeight>
              <TabPane key={tab}>
                <ol className="pm-steps">
                  {tab === 'iphone' && (
                    <>
                      <li>
                        {t('On the iPhone or iPad, open this page and download the setup profile: it fills in everything but the password.')}
                        <a className="ghost-btn outline sm pm-profile" href={`/api/mailapps/profile?mailbox=${encodeURIComponent(top.email)}`} download>
                          <Download size={14} /> {t('Setup profile for {email}', { email: top.email })}
                        </a>
                      </li>
                      <li>{t('Open Settings, tap Profile Downloaded near the top, then Install. When it asks for a password, type an app password.')}</li>
                      <li>{t('Or by hand: Settings, Apps, Mail, Mail Accounts, Add Account, Other, Add Mail Account. Choose IMAP and type the settings below for both servers.')}</li>
                    </>
                  )}
                  {tab === 'android' && (
                    <>
                      <li>{t('In the Gmail app, tap your picture, then Add another account, then Other.')}</li>
                      <li>{t('Type your email address, tap Manual setup and choose Personal (IMAP).')}</li>
                      <li>{t('Type an app password, then the settings below for the incoming and outgoing servers, with SSL/TLS.')}</li>
                    </>
                  )}
                  {tab === 'outlook' && (
                    <>
                      <li>{t('In Outlook, add an account and type your email address.')}</li>
                      <li>{t('When it asks which kind, choose IMAP, then open the advanced settings.')}</li>
                      <li>{t('Type the settings below and an app password for both servers.')}</li>
                    </>
                  )}
                  {tab === 'thunderbird' && (
                    <>
                      <li>{t('In Thunderbird, choose New, Existing Email Account.')}</li>
                      <li>{t('Type your name, your email address and an app password. Thunderbird finds the rest by itself.')}</li>
                      <li>{t('If it can’t, choose Configure manually and type the settings below.')}</li>
                    </>
                  )}
                </ol>
              </TabPane>
            </SmoothHeight>
            <dl className="pm-settings">
              <dt>{t('Incoming mail (IMAP)')}</dt>
              <dd>
                <Value text={d.host} label={t('incoming server')} />
                <small>{t('Port {port}, SSL/TLS (or {other} with STARTTLS)', { port: String(d.ports.imap), other: String(d.ports.imapStarttls) })}</small>
              </dd>
              <dt>{t('Outgoing mail (SMTP)')}</dt>
              <dd>
                <Value text={d.host} label={t('outgoing server')} />
                <small>{t('Port {port}, SSL/TLS (or {other} with STARTTLS), sign-in on', { port: String(d.ports.smtp), other: String(d.ports.smtpStarttls) })}</small>
              </dd>
              <dt>{t('User name')}</dt>
              <dd>
                <Value text={top.email} label={t('user name')} />
              </dd>
              <dt>{t('Password')}</dt>
              <dd>
                <small className="pm-plain">{t('An app password from above, never your sprint2go password')}</small>
              </dd>
            </dl>
            <p className="set-hint pm-hint">
              {t('{email} shows at the top: Inbox, Sent, Drafts, Archive (your Done), Snoozed, Trash, Spam and your labels.', { email: top.email })}
              {others.length > 0 && ` ${tn(others.length, '{list} shows as folders inside it.', '{list} show as folders inside it.', { list: fmtList(others.map((m) => m.email)) })}`} {t('Mail you send there goes out from sprint2go and shows in Sent here too.')}
            </p>
            {others.some((m) => m.shared) && (
              <p className="set-hint pm-hint">
                {tn(others.filter((m) => m.shared).length, 'The shared inbox follows who is on it in sprint2go: take someone off and it leaves their mail app.', 'Shared inboxes follow who is on them in sprint2go: take someone off and it leaves their mail app.')}
              </p>
            )}
          </div>
        )}

        {canManage && d && (
          <div className="set-block pm-block">
            <h3>{ws.name || t('Your company')}</h3>
            <div className="set-row">
              <span>
                <strong>{t('Let people use other mail apps')}</strong>
                <small>
                  {here
                    ? t('People at {company} can open their mailboxes here in iPhone Mail, Gmail, Outlook and Thunderbird, with app passwords.', { company: ws.name || t('the company') })
                    : t('Off: nobody at {company} can open its mailboxes in other mail apps, and open connections ended.', { company: ws.name || t('the company') })}
                </small>
              </span>
              <button type="button" role="switch" aria-checked={here} aria-label={t('Let people use other mail apps')} className={`switch ${here ? 'on' : ''}`} onClick={() => onWorkspace({ mailApps: !here })}>
                <span />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
