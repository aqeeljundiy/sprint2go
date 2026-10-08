import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, ShieldCheck, X } from 'lucide-react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { brand as product } from '../terms';
import { server, signOut } from '../sync';
import { BrandMark } from './SignIn';

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
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string; restart?: boolean };
  if (!r.ok) throw Object.assign(new Error(d.error ?? 'Something went wrong. Try again.'), { restart: !!d.restart });
  return d;
}
export const loadTwoStep = (): Promise<TwoStepStatus | null> =>
  fetch('/api/2fa')
    .then((r) => (r.ok ? (r.json() as Promise<TwoStepStatus>) : null))
    .catch(() => null);

const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const list = (names: string[]) => (names.length < 2 ? names[0] ?? 'Your company' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** "Pixel & Profits requires it from 16 Oct" or "...requires it now". */
export const requiredText = (r: NonNullable<TwoStepStatus['required']>) => `${list(r.companies)} require${r.companies.length === 1 ? 's' : ''} it ${r.from > new Date().toISOString() ? `from ${day(r.from)}` : 'now'}`;

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
      aria-label="Backup code"
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
      aria-label="Six-digit code"
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
        <div className="ts-qr">{setup ? <img src={setup.qr} alt="QR code to scan with your authenticator app" width={168} height={168} /> : <span className="ts-qr-wait" aria-label="Making your code" />}</div>
        <ol className="ts-how">
          <li>Open an authenticator app on your phone, like Google Authenticator, Microsoft Authenticator or 1Password.</li>
          <li>Add an account and scan this code.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
      </div>
      <div className="ts-key">
        {setup ? (
          <>
            <span>Can’t scan it? Enter this key instead:</span>
            <span className="ts-key-row">
              <code className="mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <button type="button" className="icon-btn sm" aria-label="Copy the key" title={copied ? 'Copied' : 'Copy'} onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true))}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </span>
            <a className="link-btn small ts-open-app" href={setup.otpauth}>
              Or open it in an authenticator app on this phone
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
        {error && <p className="signin-error">{error}</p>}
        <button className="primary-btn ts-submit" disabled={!setup || !codeReady(code, false) || busy}>
          {busy ? 'Checking…' : 'Turn on'}
        </button>
      </form>
    </div>
  );
}

/** The ten backup codes, shown once: copy or download them, then go on. `renewed`: replacing older ones. */
export function BackupCodes({ codes, onDone, doneLabel, renewed }: { codes: string[]; onDone: () => void; doneLabel: string; renewed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const text = `${product.name} backup codes\nEach code works once, when you can’t use your authenticator app.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: `${product.name.toLowerCase().replace(/\s+/g, '-')}-backup-codes.txt` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="ts-step">
      {!renewed && (
        <p className="ts-lead">
          <Check size={16} /> Two-step sign-in is on.
        </p>
      )}
      <p className="ts-text">
        {renewed ? 'Your old backup codes no longer work. ' : 'If you ever can’t use your phone, sign in with one of these codes. '}Each works once. Keep them somewhere safe, like your password manager: you won’t see them again.
      </p>
      <ul className="ts-backup" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c}>
            <code className="mono">{c}</code>
          </li>
        ))}
      </ul>
      <div className="ts-backup-actions">
        <button type="button" className="ghost-btn outline sm" onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true))}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="ghost-btn outline sm" onClick={download}>
          <Download size={14} /> Download
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
      <p className="ts-text">{backup ? 'Enter one of your backup codes. It gets used up.' : text}</p>
      <CodeField backup={backup} value={code} onChange={setCode} onComplete={submit} autoFocus />
      {error && <p className="signin-error">{error}</p>}
      <button type="button" className="link-btn small ts-switch" onClick={() => (setBackup((b) => !b), setCode(''), setError(null))}>
        {backup ? 'Use the code from your app' : 'Use a backup code'}
      </button>
      <button className="primary-btn ts-submit" disabled={!codeReady(code, backup) || busy}>
        {busy ? 'Checking…' : action}
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
        {step === 'prove' && <ProveStep text="First, a code from the app you use now (or a backup code), so we know it’s you." action="Continue" onProof={(c) => start(c)} />}
        {step === 'scan' && (error ? <p className="signin-error">{error}</p> : <ScanStep setup={setup} onEnabled={(c) => (setCodes(c), setStep('codes'), onEnabled?.())} />)}
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
    </div>
  );
}

function CodeGate({ email }: { email?: string }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restart, setRestart] = useState(false);
  const submit = (c = code) => {
    if (!codeReady(c, backup) || busy) return;
    setBusy(true);
    setError(null);
    post('/api/2fa/verify', { code: c })
      .then(() => location.reload())
      .catch((e: Error & { restart?: boolean }) => (setError(e.message), setRestart(!!e.restart), setCode(''), setBusy(false)));
  };
  return (
    <>
      <h1>{backup ? 'Use a backup code' : 'Enter your code'}</h1>
      <p className="signin-sub">{backup ? 'One of the ten codes you saved when you turned on two-step sign-in. Each works once.' : `Open your authenticator app and enter the 6-digit code for ${product.name}${email ? ` (${email})` : ''}.`}</p>
      {restart ? (
        <>
          <p className="signin-error">{error}</p>
          <button className="primary-btn signin-btn" onClick={() => location.reload()}>
            Sign in again
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
          {error && <p className="signin-error">{error}</p>}
          <button className="primary-btn signin-btn" disabled={!codeReady(code, backup) || busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" className="link-btn small ts-switch" onClick={() => (setBackup((b) => !b), setCode(''), setError(null))}>
            {backup ? 'Use the code from your app' : 'Use a backup code'}
          </button>
        </form>
      )}
      <p className="signin-switch">
        Lost your phone and your backup codes? An admin at your company can reset two-step sign-in for you.{' '}
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </p>
    </>
  );
}

function SetupGate({ companies }: { companies: string[] }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <h1>{done ? 'Save your backup codes' : 'Set up two-step sign-in'}</h1>
      {!done && (
        <p className="signin-sub">
          {list(companies)} require{companies.length === 1 ? 's' : ''} a code from an authenticator app each time you sign in, so a stolen password isn’t enough. It takes a minute.
        </p>
      )}
      <div className="ts-gate-body">
        <SetupFlow onEnabled={() => setDone(true)} onDone={() => location.reload()} doneLabel={`I’ve saved them, open ${product.name}`} />
      </div>
      <p className="signin-switch">
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          Sign out
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
  useEffect(() => {
    if (server.on) load();
  }, []);

  if (!server.on)
    return (
      <div className="set-row">
        <span>
          <strong>Two-step sign-in</strong>
          <small>Works when you sign in with a password. This demo has no sign-in.</small>
        </span>
        <button type="button" className="ghost-btn outline" disabled>
          Turn on
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
            Two-step sign-in {s?.on && <span className="acct-status ok">On</span>}
            {s && !s.on && s.required && <span className="acct-status">Required</span>}
          </strong>
          <small>
            {!st
              ? 'Checking…'
              : st === 'failed'
                ? 'Couldn’t check right now.'
                : st.on
                  ? `On since ${day(st.since!)}. ${low ? `Only ${st.backupLeft} backup code${st.backupLeft === 1 ? '' : 's'} left: get new ones.` : `${st.backupLeft} backup codes left.`}`
                  : st.required
                    ? `${requiredText(st.required)}. A code from an authenticator app each time you sign in, so a stolen password isn’t enough.`
                    : 'A code from an authenticator app each time you sign in, so a stolen password isn’t enough.'}
          </small>
        </span>
        {s?.on ? (
          <button type="button" className={`ghost-btn outline ${manage ? 'on' : ''}`} onClick={() => setManage((m) => !m)} aria-expanded={manage}>
            Manage
          </button>
        ) : (
          <button type="button" className={s?.required ? 'primary-btn sm' : 'ghost-btn outline'} disabled={!s} onClick={() => setDialog('on')}>
            Turn on
          </button>
        )}
      </div>
      <div className={`fold ${manage && s?.on ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="ts-manage">
            <div className="ts-manage-row">
              <span>
                <strong>Backup codes</strong>
                <small>Ten new ones; the old ones stop working.</small>
              </span>
              <button type="button" className={`ghost-btn sm ${low ? 'outline' : ''}`} onClick={() => setDialog('backup')}>
                Get new codes
              </button>
            </div>
            <div className="ts-manage-row">
              <span>
                <strong>New phone</strong>
                <small>Move two-step sign-in to another app or phone.</small>
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => setDialog('again')}>
                Set up again
              </button>
            </div>
            <div className="ts-manage-row">
              <span>
                <strong>Turn off</strong>
                <small>{s?.required ? `${requiredText(s.required)}, so it stays on.` : 'Sign in with just your password again.'}</small>
              </span>
              <button type="button" className="ghost-btn sm danger" disabled={!!s?.required} onClick={() => setDialog('off')}>
                Turn off
              </button>
            </div>
          </div>
        </div>
      </div>
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

const TITLES: Record<DialogMode, string> = { on: 'Turn on two-step sign-in', again: 'Set up on a new phone', backup: 'New backup codes', off: 'Turn off two-step sign-in' };

function TwoStepDialog({ mode, onClose, onChanged }: { mode: DialogMode; onClose: () => void; onChanged: (toast?: string) => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [locked, setLocked] = useState(false); // backup codes on screen: only Done or the close button closes it
  const [pw, setPw] = useState('');
  // On the page body: Settings' scrolling pane would otherwise hold a fixed overlay inside itself.
  return createPortal(
    <div className="modal-scrim" onMouseDown={() => !locked && onClose()}>
      <div className="modal ts-modal" role="dialog" aria-label={TITLES[mode]} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !locked && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <ShieldCheck size={15} /> {TITLES[mode]}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          {(mode === 'on' || mode === 'again') && (
            <SetupFlow
              again={mode === 'again'}
              onEnabled={() => (setLocked(true), onChanged(mode === 'again' ? 'Two-step sign-in moved to your new app' : undefined))}
              onDone={onClose}
              doneLabel="I’ve saved them"
            />
          )}
          {mode === 'backup' && (
            <SmoothHeight>
              <TabPane key={codes ? 'codes' : 'prove'}>
                {codes ? (
                  <BackupCodes codes={codes} renewed onDone={onClose} doneLabel="I’ve saved them" />
                ) : (
                  <ProveStep text="Enter a code from your authenticator app to make new backup codes." action="Make new codes" onProof={(code) => post<{ backupCodes: string[] }>('/api/2fa/backup', { code }).then((d) => (setCodes(d.backupCodes), setLocked(true), onChanged()))} />
                )}
              </TabPane>
            </SmoothHeight>
          )}
          {mode === 'off' && (
            <div className="ts-step">
              <p className="ts-text">Signing in will only need your password. Your password and a code from your app, to be sure it’s you:</p>
              <div className="field">
                <label>Password</label>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
              </div>
              <ProveStep text="And the 6-digit code from your authenticator app." action="Turn off" onProof={(code) => post('/api/2fa/off', { password: pw, code }).then(() => (onChanged('Two-step sign-in is off'), onClose()))} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
