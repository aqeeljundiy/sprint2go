import { useState } from 'react';
import { ArrowLeft, ChevronRight, UserPlus, X } from 'lucide-react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { Wordmark } from './Logo';

interface Props {
  users: User[];
  signedIn: User[];
  onPick: (id: string) => void;
  onSignIn: (email: string) => string | null; // returns an error message, or null when it worked
  onForget: (id: string) => void;
}

/** "Choose an account", like Google's account chooser. */
export function SignIn({ signedIn, onPick, onSignIn, onForget }: Props) {
  const [adding, setAdding] = useState(signedIn.length === 0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(onSignIn(email.trim()));
  };

  return (
    <div className="signin">
      <div className="signin-card" key={adding ? 'add' : 'pick'}>
        <Wordmark height={30} />
        {adding ? (
          <>
            <h1>Sign in to Elkiya Mail</h1>
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
              <button className="primary-btn signin-btn" disabled={!email.includes('@')}>
                Sign in
              </button>
              <p className="signin-note">Prototype: passwords are checked once the mail server is connected.</p>
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
      <p className="signin-foot">
        elkiyamail.com · part of <a href="https://elkiyagroup.com">Elkiya Group</a>
      </p>
    </div>
  );
}
