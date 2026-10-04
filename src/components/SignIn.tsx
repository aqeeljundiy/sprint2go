import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, UserPlus, X } from 'lucide-react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';

interface Props {
  users: User[];
  signedIn: User[];
  onPick: (id: string) => void;
  onSignIn: (email: string, password: string) => string | null | Promise<string | null>; // an error message, or null when it worked
  realPasswords?: boolean; // the local server checks passwords
  onForget: (id: string) => void;
}

/** "Choose an account", like Google's account chooser. */
export function SignIn({ signedIn, onPick, onSignIn, onForget, realPasswords }: Props) {
  const [adding, setAdding] = useState(signedIn.length === 0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await onSignIn(email.trim(), password));
    setBusy(false);
  };

  return (
    <div className="signin">
      <div className="signin-card" key={adding ? 'add' : 'pick'}>
        <Wordmark height={30} />
        {adding ? (
          <>
            <h1>Sign in to Sprint2go</h1>
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
            </form>
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
        <Wordmark height={30} />
        <h1>Welcome to Sprint2go</h1>
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
              {busy ? 'Saving…' : 'Set password and open Sprint2go'}
            </button>
          </form>
        ) : (
          <p className="signin-sub">{error ?? 'Checking your invite…'}</p>
        )}
      </div>
    </div>
  );
}
