import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, UserPlus, X } from 'lucide-react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';
import { brand as product, setBrandName } from '../terms';

/** The brand at this address: an agency's (white label), or ours. Read once and shared by the sign-in screens. */
type BrandInfo = { name?: string; logo?: string; color?: string };
let brandAt: Promise<BrandInfo> | null = null;
function useBrandAt() {
  const [b, setB] = useState<BrandInfo>({});
  useEffect(() => {
    brandAt ??= fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    void brandAt.then((x: BrandInfo) => {
      if (x.name) {
        setBrandName(x.name);
        if (x.color) document.documentElement.style.setProperty('--brand', x.color);
        document.title = x.name;
      }
      setB(x);
    });
  }, []);
  return b;
}
/** Our wordmark, or the agency's logo and name. */
function BrandMark() {
  const b = useBrandAt();
  if (!b.name) return <Wordmark height={30} />;
  return (
    <span className="signin-brand">
      {b.logo && <img src={b.logo} alt="" />}
      <strong>{b.name}</strong>
    </span>
  );
}

interface Props {
  users: User[];
  signedIn: User[];
  onPick: (id: string) => void;
  onSignIn: (email: string, password: string) => string | null | Promise<string | null>; // an error message, or null when it worked
  realPasswords?: boolean; // the local server checks passwords
  onCreate?: () => void; // "Create an account" (the local server only)
  onForget: (id: string) => void;
}

/** "Choose an account", like Google's account chooser. */
export function SignIn({ signedIn, onPick, onSignIn, onForget, realPasswords, onCreate }: Props) {
  const [adding, setAdding] = useState(signedIn.length === 0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await onSignIn(email.trim(), password));
    setBusy(false);
  };

  return (
    <div className="signin">
      <div className="signin-card" key={adding ? 'add' : 'pick'}>
        <BrandMark />
        {adding && forgot ? (
          <ForgotPassword email={email} onBack={() => setForgot(false)} />
        ) : adding ? (
          <>
            <h1>Sign in to {product.name}</h1>
            <p className="signin-sub">Use the email address your workspace gave you.</p>
            <form onSubmit={submit} className="signin-form">
              <div className="field">
                <label>Email</label>
                <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" autoComplete="username" />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              {error && <p className="signin-error">{error}</p>}
              <button className="primary-btn signin-btn" disabled={!email.includes('@') || busy || (realPasswords && !password)}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              {!realPasswords && <p className="signin-note">Demo: any password works here. The local server checks real passwords.</p>}
              {realPasswords && (
                <button type="button" className="link-btn small signin-forgot" onClick={() => setForgot(true)}>
                  Forgot your password?
                </button>
              )}
            </form>
            {onCreate && !product.white && (
              <p className="signin-switch">
                New to {product.name}?{' '}
                <button type="button" className="link-btn" onClick={onCreate}>
                  Create an account
                </button>
              </p>
            )}
            {signedIn.length > 0 && (
              <button className="ghost-btn signin-back" onClick={() => setAdding(false)}>
                <ArrowLeft size={15} /> Back to accounts
              </button>
            )}
          </>
        ) : (
          <>
            <h1>Choose an account</h1>
            <p className="signin-sub">Signed in on this device</p>
            <div className="signin-list">
              {signedIn.map((u) => (
                <div key={u.id} className="signin-user">
                  <button onClick={() => onPick(u.id)}>
                    <Avatar person={u} size={40} />
                    <span className="su-text">
                      <strong>{u.name}</strong>
                      <small>{u.email}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button className="icon-btn sm" title="Remove from this device" onClick={() => onForget(u.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button className="signin-add" onClick={() => setAdding(true)}>
                <span>
                  <UserPlus size={18} />
                </span>
                Use another account
              </button>
            </div>
          </>
        )}
      </div>
      <p className="signin-foot">One app for your whole team</p>
    </div>
  );
}

/**
 * A new account: name, email and password, then the 6-digit code we email. Until email is wired up, the code shows on
 * screen (outside production) and in the server log.
 */
export function SignUp({ onDone, onSignIn }: { onDone: () => void; onSignIn: () => void }) {
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; devCode?: string };
      if (!r.ok) setError(d.error ?? 'Something went wrong. Try again.');
      return r.ok ? d : null;
    } catch {
      setError(`Can’t reach ${product.name}. Check your connection.`);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = await post('/api/signup', { name, email, password: pw });
    if (d) (setDevCode(d.devCode ?? null), setStep('code'));
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await post('/api/signup/verify', { email, code })) onDone();
  };
  return (
    <div className="signin">
      <div className="signin-card" key={step}>
        <BrandMark />
        {step === 'details' ? (
          <>
            <h1>Create your account</h1>
            <p className="signin-sub">Free for up to 5 people. No card needed.</p>
            <form onSubmit={start} className="signin-form">
              <div className="field">
                <label>Your name</label>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
              </div>
              <div className="field">
                <label>Work email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
              {error && <p className="signin-error">{error}</p>}
              <button className="primary-btn signin-btn" disabled={name.trim().length < 2 || !email.includes('@') || pw.length < 8 || busy}>
                {busy ? 'Sending a code…' : 'Continue'}
              </button>
            </form>
            <p className="signin-switch">
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={onSignIn}>
                Sign in
              </button>
            </p>
          </>
        ) : (
          <>
            <h1>Check your email</h1>
            <p className="signin-sub">We sent a 6-digit code to {email}. It works for 15 minutes.</p>
            {devCode && (
              <p className="signin-dev">
                Email isn’t connected yet, so here’s your code: <b>{devCode}</b>
              </p>
            )}
            <form onSubmit={verify} className="signin-form">
              <div className="field">
                <label>Code</label>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </div>
              {error && <p className="signin-error">{error}</p>}
              <button className="primary-btn signin-btn" disabled={code.length !== 6 || busy}>
                {busy ? 'Checking…' : 'Create account'}
              </button>
            </form>
            <button className="ghost-btn signin-back" onClick={() => (setStep('details'), setCode(''), setError(null))}>
              <ArrowLeft size={15} /> Change email
            </button>
          </>
        )}
      </div>
      <p className="signin-foot">One app for your whole team</p>
    </div>
  );
}

/** Opened from an invite link: the new person picks a password and is signed in. */
export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/invite/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (r) => ((await r.json()) as { email?: string; error?: string }))
      .then((d) => (d.email ? setEmail(d.email) : setError(d.error ?? 'This invite link does not work.')));
  }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('The two passwords are different.');
    setBusy(true);
    const r = await fetch('/api/invite/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
    setBusy(false);
    if (!r.ok) return setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not save your password.');
    onDone();
  };
  return (
    <div className="signin">
      <div className="signin-card">
        <BrandMark />
        <h1>Welcome to {product.name}</h1>
        {email ? (
          <form onSubmit={submit} className="signin-form">
            <p className="signin-sub">Pick a password for {email}.</p>
            <div className="field">
              <label>Password</label>
              <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
            </div>
            <div className="field">
              <label>Same password again</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="signin-error">{error}</p>}
            <button className="primary-btn signin-btn" disabled={pw.length < 8 || !pw2 || busy}>
              {busy ? 'Saving…' : `Set password and open ${product.name}`}
            </button>
          </form>
        ) : (
          <p className="signin-sub">{error ?? 'Checking your invite…'}</p>
        )}
      </div>
    </div>
  );
}

/** Forgot the password: a code by email, then a new password. Every other session of the account ends. */
function ForgotPassword({ email: start, onBack }: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(start);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; devCode?: string };
    if (!r.ok) throw new Error(d.error ?? 'Something went wrong.');
    return d;
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await post('/api/reset', { email: email.trim() });
      setDevCode(d.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/reset/verify', { email: email.trim(), code, password: pw });
      location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>{step === 'email' ? 'Reset your password' : 'Check your email'}</h1>
      <p className="signin-sub">{step === 'email' ? 'We send a 6-digit code to the address on your account.' : `If ${email.trim()} has an account, a code is on its way. It works for 15 minutes.`}</p>
      {step === 'email' ? (
        <form onSubmit={send} className="signin-form">
          <div className="field">
            <label>Email</label>
            <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          {error && <p className="signin-error">{error}</p>}
          <button className="primary-btn signin-btn" disabled={!email.includes('@') || busy}>
            {busy ? 'Sending…' : 'Send the code'}
          </button>
        </form>
      ) : (
        <form onSubmit={finish} className="signin-form">
          <div className="field">
            <label>Code</label>
            <input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 digits" autoComplete="one-time-code" />
            {devCode && <small className="signin-note">No email is set up on this server, so here’s the code: {devCode}</small>}
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
          </div>
          {error && <p className="signin-error">{error}</p>}
          <button className="primary-btn signin-btn" disabled={code.replace(/\D/g, '').length !== 6 || pw.length < 8 || busy}>
            {busy ? 'Saving…' : 'Set the new password'}
          </button>
        </form>
      )}
      <p className="signin-switch">
        <button type="button" className="link-btn" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </>
  );
}
