import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, ShieldCheck, X } from 'lucide-react';
import { SmoothHeight, TabPane, useLeaving } from './ui/Smooth';
import { brand as product } from '../terms';
import { server, signOut } from '../sync';
import { BrandMark, LangSwitch } from './SignIn';
import { Badge } from './ui/Person';
import { mark, t, tn } from '../i18n';
import { usePhone } from '../mobile/media';
import { PushScreen } from './ui/PushScreen';
import { EditScreen, GRow, Group } from './ui/Grouped';
import { fmtDay, fmtList } from '../i18n/format';

/*
 * Two-step sign-in: after the password, a 6-digit code from an authenticator app (or one of ten backup codes).
 * The server keeps the secret and checks the codes (server/twostep.ts); these are the screens:
 * - TwoStepGate: the full screen after the password (enter the code), or before the app opens when a company
 *   requires it and the person hasn't set it up yet.
 * - TwoStepRow: Settings, Account, Security: turn it on, new backup codes, a new phone, turn it off.
 */

type Setup = { secret: string; otpauth: string; qr: string };
export interface TwoStepStatus {
  on: boolean;
  since: string | null;
  backupLeft: number;
  required: { from: string; companies: string[] } | null;
  devices?: RememberedDevice[];
}
/** A browser that signs in without the code for 30 days ("Remember this device"). */
export interface RememberedDevice {
  id: string;
  name: string;
  createdAt: string;
  usedAt: string;
  expiresAt: string;
  current: boolean; // this browser
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string; restart?: boolean };
  // The server's message stays English here; the screens show it with t(error).
  if (!r.ok) throw Object.assign(new Error(d.error ?? mark('Something went wrong. Try again.')), { restart: !!d.restart });
  return d;
}
export const loadTwoStep = (): Promise<TwoStepStatus | null> =>
  fetch('/api/2fa')
    .then((r) => (r.ok ? (r.json() as Promise<TwoStepStatus>) : null))
    .catch(() => null);

const day = (iso: string) => fmtDay(iso); // "16 Oct", with the year when it isn't this one
/** The server names a remembered device in English ("Chrome on Mac", "A browser"): the words read in the person's language. */
const deviceLabel = (name: string) => {
  const app = (a: string) => (a === 'sprint2go app' ? t('sprint2go app') : a);
  const m = /^(.+) on (.+)$/.exec(name);
  return m ? t('{app} on {os}', { app: app(m[1]), os: m[2] }) : name === 'A browser' ? t('A browser') : app(name);
};
const list = (names: string[]) => (names.length ? fmtList(names) : t('Your company'));
/** "sprint2go Studio requires it from 16 Oct" or "...requires it now". */
export const requiredText = (r: NonNullable<TwoStepStatus['required']>) => {
  const n = r.companies.length || 1; // no names: "Your company requires it"
  return r.from > new Date().toISOString()
    ? tn(n, '{companies} requires it from {date}', '{companies} require it from {date}', { companies: list(r.companies), date: day(r.from) })
    : tn(n, '{companies} requires it now', '{companies} require it now', { companies: list(r.companies) });
};

/* ---------- the code field: 6 digits from the app, or a backup code ---------- */

export const codeReady = (v: string, backup: boolean) => (backup ? v.replace(/[^a-z0-9]/g, '').length === 10 : v.replace(/\D/g, '').length === 6);

export function CodeField({ backup, value, onChange, onComplete, autoFocus, compact }: { backup: boolean; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [backup, autoFocus]);
  return backup ? (
    <input
      ref={ref}
      className={`ts-code backup ${compact ? 'compact' : ''}`}
      value={value}
      onChange={(e) => {
        const raw = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
        onChange(raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw);
      }}
      placeholder="xxxxx-xxxxx"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-label={t('Backup code')}
    />
  ) : (
    <input
      ref={ref}
      className={`ts-code ${compact ? 'compact' : ''}`}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
        onChange(v);
        // Six digits typed (or pasted, or filled in by the phone): go on without a click.
        if (v.length === 6 && value.length < 6) onComplete?.(v);
      }}
      placeholder="000000"
      aria-label={t('Six-digit code')}
    />
  );
}

/* ---------- setting it up: scan, confirm a code, save the backup codes ---------- */

function ScanStep({ setup, onEnabled }: { setup: Setup | null; onEnabled: (codes: string[]) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const submit = (c = code) => {
    if (!codeReady(c, false) || busy || !setup) return;
    setBusy(true);
    setError(null);
    post<{ backupCodes: string[] }>('/api/2fa/enable', { code: c })
      .then((d) => onEnabled(d.backupCodes))
      .catch((e: Error) => (setError(e.message), setCode('')))
      .finally(() => setBusy(false));
  };
  return (
    <div className="ts-step">
      <div className="ts-scan">
        <div className="ts-qr">{setup ? <img src={setup.qr} alt={t('QR code to scan with your authenticator app')} width={168} height={168} /> : <span className="ts-qr-wait" aria-label={t('Making your code')} />}</div>
        <ol className="ts-how">
          <li>{t('Open an authenticator app on your phone, like Google Authenticator, Microsoft Authenticator or 1Password.')}</li>
          <li>{t('Add an account and scan this code.')}</li>
          <li>{t('Type the 6-digit code it shows.')}</li>
        </ol>
      </div>
      <div className="ts-key">
        {setup ? (
          <>
            <span>{t('Can’t scan it? Enter this key instead:')}</span>
            <span className="ts-key-row">
              <code className="mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <button type="button" className="icon-btn sm" aria-label={t('Copy the key')} title={copied ? t('Copied') : t('Copy')} onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true))}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </span>
            <a className="link-btn small ts-open-app" href={setup.otpauth}>
              {t('Or open it in an authenticator app on this phone')}
            </a>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <form
        className="ts-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <CodeField backup={false} value={code} onChange={setCode} onComplete={submit} autoFocus={!!setup} />
        {error && <p className="signin-error">{t(error)}</p>}
        <button className="primary-btn ts-submit" disabled={!setup || !codeReady(code, false) || busy}>
          {busy ? t('Checking…') : t('Turn on')}
        </button>
      </form>
    </div>
  );
}

/** The ten backup codes, shown once: copy or download them, then go on. `renewed`: replacing older ones. */
export function BackupCodes({ codes, onDone, doneLabel, renewed }: { codes: string[]; onDone: () => void; doneLabel: string; renewed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const text = `${t('{product} backup codes', { product: product.name })}\n${t('Each code works once, when you can’t use your authenticator app.')}\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: `${product.name.toLowerCase().replace(/\s+/g, '-')}-backup-codes.txt` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="ts-step">
      {!renewed && (
        <p className="ts-lead">
          <Check size={16} /> {t('Two-step sign-in is on.')}
        </p>
      )}
      <p className="ts-text">
        {renewed ? t('Your old backup codes no longer work.') : t('If you ever can’t use your phone, sign in with one of these codes.')} {t('Each works once. Keep them somewhere safe, like your password manager: you won’t see them again.')}
      </p>
      <ul className="ts-backup" aria-label={t('Backup codes')}>
        {codes.map((c) => (
          <li key={c}>
            <code className="mono">{c}</code>
          </li>
        ))}
      </ul>
      <div className="ts-backup-actions">
        <button type="button" className="ghost-btn outline sm" onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true))}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy')}
        </button>
        <button type="button" className="ghost-btn outline sm" onClick={download}>
          <Download size={14} /> {t('Download')}
        </button>
      </div>
      <button type="button" className="primary-btn ts-submit" onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}

/** Asks for a code from the current app (or a backup code) before something that needs it. */
function ProveStep({ text, action, onProof }: { text: string; action: string; onProof: (code: string) => Promise<unknown> }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (c = code) => {
    if (!codeReady(c, backup) || busy) return;
    setBusy(true);
    setError(null);
    onProof(c)
      .catch((e: Error) => (setError(e.message), setCode('')))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="ts-step ts-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="ts-text">{backup ? t('Enter one of your backup codes. It gets used up.') : text}</p>
      <CodeField backup={backup} value={code} onChange={setCode} onComplete={submit} autoFocus />
      {error && <p className="signin-error">{t(error)}</p>}
      <button type="button" className="link-btn small ts-switch" onClick={() => (setBackup((b) => !b), setCode(''), setError(null))}>
        {backup ? t('Use the code from your app') : t('Use a backup code')}
      </button>
      <button className="primary-btn ts-submit" disabled={!codeReady(code, backup) || busy}>
        {busy ? t('Checking…') : action}
      </button>
    </form>
  );
}

/**
 * Turning it on (or moving it to a new phone): a new QR code, a code to confirm, then the backup codes.
 * `again`: it's on already, so a code from the current app comes first.
 */
export function SetupFlow({ again, onEnabled, onDone, doneLabel }: { again?: boolean; onEnabled?: () => void; onDone: () => void; doneLabel: string }) {
  const [step, setStep] = useState<'prove' | 'scan' | 'codes'>(again ? 'prove' : 'scan');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const start = (code?: string) => post<Setup>('/api/2fa/setup', code ? { code } : {}).then((s) => (setSetup(s), setStep('scan')));
  useEffect(() => {
    if (!again) void start().catch((e: Error) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SmoothHeight>
      <TabPane key={step}>
        {step === 'prove' && <ProveStep text={t('First, a code from the app you use now (or a backup code), so we know it’s you.')} action={t('Continue')} onProof={(c) => start(c)} />}
        {step === 'scan' && (error ? <p className="signin-error">{t(error)}</p> :<ScanStep setup={setup} onEnabled={(c) => (setCodes(c), setStep('codes'), onEnabled?.())} />)}
        {step === 'codes' && <BackupCodes codes={codes} onDone={onDone} doneLabel={doneLabel} />}
      </TabPane>
    </SmoothHeight>
  );
}

/* ---------- the full screen after the password ---------- */

export function TwoStepGate({ need, email, companies }: { need: 'code' | 'setup'; email?: string; companies?: string[] }) {
  return (
    <div className="signin">
      <div className={`signin-card ts-card ${need === 'setup' ? 'wide' : ''}`}>
        <BrandMark />
        <span className="ts-icon">
          <ShieldCheck size={20} />
        </span>
        {need === 'code' ? <CodeGate email={email} /> : <SetupGate companies={companies ?? []} />}
      </div>
      <LangSwitch />
    </div>
  );
}

/** "Remember this device for 30 days": our own tick box (a button that says whether it's ticked). */
function RememberBox({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className="ts-remember" onClick={() => onChange(!on)}>
      <span className={`ms-box ${on ? 'on' : ''}`} aria-hidden="true">
        <Check size={11} strokeWidth={3} />
      </span>
      <span>
        {t('Remember this device for 30 days')}
        <small>{t('Only on a device that’s yours. You can forget it in Settings, Account.')}</small>
      </span>
    </button>
  );
}

function CodeGate({ email }: { email?: string }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restart, setRestart] = useState(false);
  const [remember, setRemember] = useState(false);
  const submit = (c = code) => {
    if (!codeReady(c, backup) || busy) return;
    setBusy(true);
    setError(null);
    post('/api/2fa/verify', { code: c, remember })
      .then(() => location.reload())
      .catch((e: Error & { restart?: boolean }) => (setError(e.message), setRestart(!!e.restart), setCode(''), setBusy(false)));
  };
  return (
    <>
      <h1>{backup ? t('Use a backup code') : t('Enter your code')}</h1>
      <p className="signin-sub">
        {backup
          ? t('One of the ten codes you saved when you turned on two-step sign-in. Each works once.')
          : email
            ? t('Open your authenticator app and enter the 6-digit code for {product} ({email}).', { product: product.name, email })
            : t('Open your authenticator app and enter the 6-digit code for {product}.', { product: product.name })}
      </p>
      {restart ? (
        <>
          <p className="signin-error">{error && t(error)}</p>
          <button className="primary-btn signin-btn" onClick={() => location.reload()}>
            {t('Sign in again')}
          </button>
        </>
      ) : (
        <form
          className="signin-form ts-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <CodeField backup={backup} value={code} onChange={setCode} onComplete={submit} autoFocus />
          {error && <p className="signin-error">{t(error)}</p>}
          <RememberBox on={remember} onChange={setRemember} />
          <button className="primary-btn signin-btn" disabled={!codeReady(code, backup) || busy}>
            {busy ? t('Checking…') : t('Continue')}
          </button>
          <button type="button" className="link-btn small ts-switch" onClick={() => (setBackup((b) => !b), setCode(''), setError(null))}>
            {backup ? t('Use the code from your app') : t('Use a backup code')}
          </button>
        </form>
      )}
      <p className="signin-switch">
        {t('Lost your phone and your backup codes? An admin at your company can reset two-step sign-in for you.')}{' '}
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          {t('Sign out')}
        </button>
      </p>
    </>
  );
}

function SetupGate({ companies }: { companies: string[] }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <h1>{done ? t('Save your backup codes') : t('Set up two-step sign-in')}</h1>
      {!done && (
        <p className="signin-sub">
          {tn(
            companies.length || 1, // no names: "Your company requires"
            '{companies} requires a code from an authenticator app each time you sign in, so a stolen password isn’t enough. It takes a minute.',
            '{companies} require a code from an authenticator app each time you sign in, so a stolen password isn’t enough. It takes a minute.',
            { companies: list(companies) },
          )}
        </p>
      )}
      <div className="ts-gate-body">
        <SetupFlow onEnabled={() => setDone(true)} onDone={() => location.reload()} doneLabel={t('I’ve saved them, open {product}', { product: product.name })} />
      </div>
      <p className="signin-switch">
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          {t('Sign out')}
        </button>
      </p>
    </>
  );
}

/* ---------- Settings, Account: your own two-step sign-in ---------- */

type DialogMode = 'on' | 'again' | 'backup' | 'off';

export function TwoStepRow({ toast }: { toast?: (t: string) => void }) {
  const [st, setSt] = useState<TwoStepStatus | null | 'failed'>(null);
  const [manage, setManage] = useState(false);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const load = () => void loadTwoStep().then((s) => setSt(s ?? 'failed'));
  const phone = usePhone();
  useEffect(() => {
    if (server.on) load();
  }, []);
  if (phone && server.on) return <TwoStepPhone st={st} load={load} toast={toast} />;

  if (!server.on)
    return (
      <div className="set-row">
        <span>
          <strong>{t('Two-step sign-in')}</strong>
          <small>{t('Works when you sign in with a password. This demo has no sign-in.')}</small>
        </span>
        <button type="button" className="ghost-btn outline" disabled>
          {t('Turn on')}
        </button>
      </div>
    );
  const s = st && st !== 'failed' ? st : null;
  const low = !!s?.on && s.backupLeft <= 2;
  return (
    <>
      <div className="set-row ts-row">
        <span>
          <strong>
            {t('Two-step sign-in')} {s?.on && <Badge tone="good">{t('On')}</Badge>}
            {s && !s.on && s.required && <Badge tone="warn">{t('Required')}</Badge>}
          </strong>
          <small>
            {!st
              ? t('Checking…')
              : st === 'failed'
                ? t('Couldn’t check right now.')
                : st.on
                  ? `${t('On since {date}.', { date: day(st.since!) })} ${low ? tn(st.backupLeft, 'Only {n} backup code left: get new ones.', 'Only {n} backup codes left: get new ones.') : tn(st.backupLeft, '{n} backup code left.', '{n} backup codes left.')}`
                  : st.required
                    ? `${requiredText(st.required)}. ${t('A code from an authenticator app each time you sign in, so a stolen password isn’t enough.')}`
                    : t('A code from an authenticator app each time you sign in, so a stolen password isn’t enough.')}
          </small>
        </span>
        {s?.on ? (
          <button type="button" className={`ghost-btn outline ${manage ? 'on' : ''}`} onClick={() => setManage((m) => !m)} aria-expanded={manage}>
            {t('Manage')}
          </button>
        ) : (
          <button type="button" className={s?.required ? 'primary-btn sm' : 'ghost-btn outline'} disabled={!s} onClick={() => setDialog('on')}>
            {t('Turn on')}
          </button>
        )}
      </div>
      <div className={`fold ${manage && s?.on ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="ts-manage">
            <div className="ts-manage-row">
              <span>
                <strong>{t('Backup codes')}</strong>
                <small>{t('Ten new ones; the old ones stop working.')}</small>
              </span>
              <button type="button" className={`ghost-btn sm ${low ? 'outline' : ''}`} onClick={() => setDialog('backup')}>
                {t('Get new codes')}
              </button>
            </div>
            <div className="ts-manage-row">
              <span>
                <strong>{t('New phone')}</strong>
                <small>{t('Move two-step sign-in to another app or phone.')}</small>
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => setDialog('again')}>
                {t('Set up again')}
              </button>
            </div>
            <RememberedDevices devices={s?.devices ?? []} onChanged={(text) => (load(), text && toast?.(text))} />
            <div className="ts-manage-row">
              <span>
                <strong>{t('Turn off')}</strong>
                <small>{s?.required ? t('{required}, so it stays on.', { required: requiredText(s.required) }) : t('Sign in with just your password again.')}</small>
              </span>
              <button type="button" className="ghost-btn sm danger" disabled={!!s?.required} onClick={() => setDialog('off')}>
                {t('Turn off')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <SignOutEverywhere hasDevices={!!s?.devices?.length} onDone={(text) => (load(), toast?.(text))} />
      {dialog && (
        <TwoStepDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onChanged={(text) => {
            load();
            if (text) toast?.(text);
          }}
        />
      )}
    </>
  );
}

/** Browsers that sign in without the code for 30 days: which, since when, last used, and Forget. */
function RememberedDevices({ devices, onChanged }: { devices: RememberedDevice[]; onChanged: (toast?: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useLeaving(devices, (d) => d.id); // a forgotten device folds away
  const [error, setError] = useState<string | null>(null);
  const forget = (id: string | 'all') => {
    setBusy(id);
    setError(null);
    post('/api/2fa/devices/forget', id === 'all' ? { all: true } : { id })
      .then(() => onChanged(id === 'all' ? t('Every remembered device asks for the code again') : t('That device asks for the code again')))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  return (
    <div className="ts-manage-row ts-devices">
      <span>
        <strong>{t('Remembered devices')}</strong>
        <small>{devices.length ? t('These sign in with just your password until the date shown. Forget any you don’t use.') : t('None. Tick “Remember this device” when you enter a code to skip it for 30 days on that device.')}</small>
        {rows.length > 0 && (
          <ul className="ts-device-list">
            {rows.map(({ item: d, leaving }) => (
              <li key={d.id} className={leaving ? 'row-leaving' : ''}>
                <span>
                  <strong>
                    {deviceLabel(d.name)} {d.current && <Badge tone="info">{t('This device')}</Badge>}
                  </strong>
                  <small>{t('Since {created} · last used {used} · until {expires}', { created: day(d.createdAt), used: day(d.usedAt), expires: day(d.expiresAt) })}</small>
                </span>
                <button type="button" className="ghost-btn sm" disabled={!!busy} onClick={() => forget(d.id)}>
                  {t('Forget')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <small className="signin-error">{t(error)}</small>}
      </span>
      {devices.length > 1 && (
        <button type="button" className="ghost-btn sm" disabled={!!busy} onClick={() => forget('all')}>
          {t('Forget all')}
        </button>
      )}
    </div>
  );
}

/** Sign out everywhere else: every other session ends and every remembered device asks for the code again. */
function SignOutEverywhere({ hasDevices, onDone }: { hasDevices: boolean; onDone: (toast: string) => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setError(null);
    post('/api/2fa/signout-everywhere')
      .then(() => (setSure(false), onDone(t('Signed out everywhere else. You’re still signed in here.'))))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="set-row ts-row">
      <span>
        <strong>{t('Sign out everywhere')}</strong>
        <small>
          {!sure
            ? t('Lost a phone, or signed in on a computer that isn’t yours? End every other session.')
            : hasDevices
              ? t('Every other phone, computer and browser signed in as you signs out, and remembered devices ask for the code again. You stay signed in here.')
              : t('Every other phone, computer and browser signed in as you signs out. You stay signed in here.')}
        </small>
        {error && <small className="signin-error">{t(error)}</small>}
      </span>
      <span className="ts-sure">
        {sure && (
          <button type="button" className="ghost-btn sm" onClick={() => setSure(false)} disabled={busy}>
            {t('Cancel')}
          </button>
        )}
        <button type="button" className={`ghost-btn ${sure ? 'sm danger' : 'outline'}`} onClick={() => (sure ? go() : setSure(true))} disabled={busy}>
          {busy ? t('Signing out…') : sure ? t('Sign out everywhere else') : t('Sign out everywhere')}
        </button>
      </span>
    </div>
  );
}

// A function, so the titles are in the language shown now.
const titleOf = (mode: DialogMode) =>
  ({ on: t('Turn on two-step sign-in'), again: t('Set up on a new phone'), backup: t('New backup codes'), off: t('Turn off two-step sign-in') })[mode];

function TwoStepDialog({ mode, onClose, onChanged }: { mode: DialogMode; onClose: () => void; onChanged: (toast?: string) => void }) {
  const [locked, setLocked] = useState(false); // backup codes on screen: only Done or the close button closes it
  const title = titleOf(mode);
  // On the page body: Settings' scrolling pane would otherwise hold a fixed overlay inside itself.
  return createPortal(
    <div className="modal-scrim" onMouseDown={() => !locked && onClose()}>
      <div className="modal ts-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !locked && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <ShieldCheck size={15} /> {title}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <TwoStepSteps mode={mode} onClose={onClose} onChanged={onChanged} setLocked={setLocked} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What the two-step dialog walks through (turn on, new phone, new backup codes, turn off); on phones a pushed screen. */
function TwoStepSteps({ mode, onClose, onChanged, setLocked }: { mode: DialogMode; onClose: () => void; onChanged: (toast?: string) => void; setLocked: (v: boolean) => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState('');
  return (
    <>
      {(mode === 'on' || mode === 'again') && (
        <SetupFlow
          again={mode === 'again'}
          onEnabled={() => (setLocked(true), onChanged(mode === 'again' ? t('Two-step sign-in moved to your new app') : undefined))}
          onDone={onClose}
          doneLabel={t('I’ve saved them')}
        />
      )}
      {mode === 'backup' && (
        <SmoothHeight>
          <TabPane key={codes ? 'codes' : 'prove'}>
            {codes ? (
              <BackupCodes codes={codes} renewed onDone={onClose} doneLabel={t('I’ve saved them')} />
            ) : (
              <ProveStep text={t('Enter a code from your authenticator app to make new backup codes.')} action={t('Make new codes')} onProof={(code) => post<{ backupCodes: string[] }>('/api/2fa/backup', { code }).then((d) => (setCodes(d.backupCodes), setLocked(true), onChanged()))} />
            )}
          </TabPane>
        </SmoothHeight>
      )}
      {mode === 'off' && (
        <div className="ts-step">
          <p className="ts-text">{t('Signing in will only need your password. Your password and a code from your app, to be sure it’s you:')}</p>
          <div className="field">
            <label>{t('Password')}</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
          </div>
          <ProveStep text={t('And the 6-digit code from your authenticator app.')} action={t('Turn off')} onProof={(code) => post('/api/2fa/off', { password: pw, code }).then(() => (onChanged(t('Two-step sign-in is off')), onClose()))} />
        </div>
      )}
    </>
  );
}

/**
 * Phones (iOS Settings): "Two-step sign-in" with On or Off on the right opens its own screen; turning it on, a new phone,
 * new backup codes and turning it off are pushed screens over that. "Sign out everywhere" is a row of its own.
 */
function TwoStepPhone({ st, load, toast }: { st: TwoStepStatus | null | 'failed'; load: () => void; toast?: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<DialogMode | null>(null);
  const [signOutAll, setSignOutAll] = useState(false);
  const s = st && st !== 'failed' ? st : null;
  const low = !!s?.on && s.backupLeft <= 2;
  const changed = (text?: string) => (load(), text && toast?.(text));
  const value = !st ? t('Checking…') : !s ? '' : s.on ? t('On') : s.required ? t('Required') : t('Off');
  const about = t('A code from an authenticator app each time you sign in, so a stolen password isn’t enough.');
  return (
    <>
      <GRow label={t('Two-step sign-in')} value={value} onClick={s ? () => setOpen(true) : undefined} />
      <GRow label={t('Sign out everywhere')} onClick={() => setSignOutAll(true)} />
      {open && s && (
        <PushScreen title={t('Two-step sign-in')} onBack={() => setOpen(false)} className="g-page g-edit">
          <div className="g-body">
            {!s.on ? (
              <Group footer={s.required ? `${requiredText(s.required)}. ${about}` : about}>
                <GRow label={t('Turn on two-step sign-in')} action onClick={() => setStep('on')} />
              </Group>
            ) : (
              <>
                <Group footer={t('On since {date}.', { date: day(s.since!) })}>
                  <GRow label={t('Backup codes')} value={low ? tn(s.backupLeft, 'Only {n} left', 'Only {n} left') : tn(s.backupLeft, '{n} left', '{n} left')} onClick={() => setStep('backup')} />
                  <GRow label={t('New phone')} onClick={() => setStep('again')} />
                </Group>
                <PhoneDevices devices={s.devices ?? []} onChanged={changed} />
                <Group footer={s.required ? t('{required}, so it stays on.', { required: requiredText(s.required) }) : t('Sign in with just your password again.')}>
                  {s.required ? <GRow label={t('Turn off two-step sign-in')} value={t('Required')} /> : <GRow label={t('Turn off two-step sign-in')} danger onClick={() => setStep('off')} />}
                </Group>
              </>
            )}
          </div>
        </PushScreen>
      )}
      {step && <TwoStepPushed mode={step} onClose={() => setStep(null)} onChanged={changed} />}
      {signOutAll && <SignOutEverywhereScreen hasDevices={!!s?.devices?.length} onBack={() => setSignOutAll(false)} onDone={(text) => (load(), toast?.(text))} />}
    </>
  );
}

/** One of the two-step steps as a pushed screen; while new backup codes are on screen, only "I've saved them" leaves. */
function TwoStepPushed({ mode, onClose, onChanged }: { mode: DialogMode; onClose: () => void; onChanged: (toast?: string) => void }) {
  const [locked, setLocked] = useState(false);
  return (
    <PushScreen title={titleOf(mode)} onBack={() => !locked && onClose()} className="g-page ts-push">
      <div className="ts-push-body">
        <TwoStepSteps mode={mode} onClose={onClose} onChanged={onChanged} setLocked={setLocked} />
      </div>
    </PushScreen>
  );
}

/** Remembered devices on a phone: one row each with Forget, and Forget all when there are several. */
function PhoneDevices({ devices, onChanged }: { devices: RememberedDevice[]; onChanged: (toast?: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useLeaving(devices, (d) => d.id);
  const forget = (id: string | 'all') => {
    setBusy(id);
    setError(null);
    post('/api/2fa/devices/forget', id === 'all' ? { all: true } : { id })
      .then(() => onChanged(id === 'all' ? t('Every remembered device asks for the code again') : t('That device asks for the code again')))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  return (
    <Group title={t('Remembered devices')} footer={error ? t(error) : devices.length ? t('These sign in with just your password until the date shown. Forget any you don’t use.') : t('None. Tick “Remember this device” when you enter a code to skip it for 30 days on that device.')}>
      {rows.map(({ item: d, leaving }) => (
        <GRow
          key={d.id}
          className={leaving ? 'row-leaving' : ''}
          label={
            <>
              {deviceLabel(d.name)} {d.current && <Badge tone="info">{t('This device')}</Badge>}
            </>
          }
          sub={t('Until {expires}', { expires: day(d.expiresAt) })}
          accessory={
            <button type="button" className="g-save" disabled={!!busy} onClick={() => forget(d.id)}>
              {t('Forget')}
            </button>
          }
        />
      ))}
      {devices.length > 1 && <GRow label={t('Forget all')} danger onClick={busy ? undefined : () => forget('all')} />}
      {!devices.length && <GRow label={t('No remembered devices')} />}
    </Group>
  );
}

/** Sign out everywhere else, on a phone: what happens, and the button that does it. */
function SignOutEverywhereScreen({ hasDevices, onBack, onDone }: { hasDevices: boolean; onBack: () => void; onDone: (toast: string) => void }) {
  return (
    <EditScreen
      title={t('Sign out everywhere')}
      onBack={onBack}
      saveLabel={t('Sign out')}
      danger
      onSave={() =>
        post('/api/2fa/signout-everywhere')
          .then(() => (onDone(t('Signed out everywhere else. You’re still signed in here.')), null))
          .catch((e: Error) => e.message)
      }
    >
      <p className="g-note">{t('Lost a phone, or signed in on a computer that isn’t yours? End every other session.')}</p>
      <p className="g-note">{hasDevices ? t('Every other phone, computer and browser signed in as you signs out, and remembered devices ask for the code again. You stay signed in here.') : t('Every other phone, computer and browser signed in as you signs out. You stay signed in here.')}</p>
    </EditScreen>
  );
}
