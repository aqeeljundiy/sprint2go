import { useState } from 'react';
import { Check, Copy, Dices, Timer, X } from 'lucide-react';
import type { Account, User, Workspace } from '../types';
import { uid } from '../utils';
import { Avatar } from './Avatar';
import { SmoothHeight } from './ui/Smooth';
import { Select } from './ui/Select';

/** Throwaway addresses live on a Sprint2go domain, so they work at once whatever the company's own email setup. */
export const tempDomain = (ws: Workspace) => {
  const base = (ws.domains[0]?.split('.')[0] ?? ws.name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'team';
  return `${base}.s2g.email`;
};

const LIFETIMES = [
  ['1', '1 day'],
  ['7', '7 days'],
  ['30', '30 days'],
  ['', 'Until I delete it'],
] as const;

const WORDS = ['test', 'trial', 'signup', 'try', 'demo', 'check'];
const randomName = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.random().toString(36).slice(2, 6)}`;

/** "Deletes in 6 days", "Deletes today", or "Kept until you delete it". */
export function lifeLeft(a: Account) {
  if (!a.temp?.expiresAt) return 'Kept until you delete it';
  const days = Math.ceil((new Date(a.temp.expiresAt).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? 'Deletes today' : days === 1 ? 'Deletes tomorrow' : `Deletes in ${days} days`;
}

/**
 * Make (or change) a throwaway address: a name, who can see it, and how long it lives. When the company's domain is
 * hosted with us, it can also be on the company's own domain.
 */
export function TempAddressDialog({ ws, me, people, editing, onSave, onClose }: { ws: Workspace; me: string; people: User[]; editing?: Account; onSave: (a: Account) => void; onClose: () => void }) {
  const ownDomain = ws.emailSetup === 'hosted' && ws.domains[0] ? ws.domains[0] : null;
  const [name, setName] = useState(editing ? editing.email.split('@')[0] : '');
  const [domain, setDomain] = useState(editing ? editing.email.split('@')[1] : tempDomain(ws));
  const [who, setWho] = useState<string[]>(editing?.users ?? [me]);
  const [life, setLife] = useState<string>(editing ? 'same' : '7');
  const [copied, setCopied] = useState(false);
  const local = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const email = `${local}@${domain}`;
  const taken = !editing && ws.accounts.some((a) => a.email === email);
  const ok = local.length >= 2 && !taken && who.length > 0;
  const toggle = (id: string) => setWho((w) => (w.includes(id) ? (w.length > 1 ? w.filter((x) => x !== id) : w) : [...w, id]));
  const save = () => {
    if (!ok) return;
    const expiresAt = life === 'same' ? editing?.temp?.expiresAt : life ? new Date(Date.now() + Number(life) * 86_400_000).toISOString() : undefined;
    onSave(
      editing
        ? { ...editing, users: who, temp: { ...editing.temp!, expiresAt } }
        : { id: uid(), email, name: local, kind: 'shared', connected: true, provider: 'sprint2go', users: who, temp: { createdBy: me, createdAt: new Date().toISOString(), expiresAt } },
    );
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal temp-modal" role="dialog" aria-label={editing ? 'Temporary address' : 'New temporary address'} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Timer size={15} /> {editing ? editing.email : 'New temporary address'}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            {!editing && (
              <>
                <p className="muted small">For a quick sign-up or a test. Only the people you pick see what arrives, and it deletes itself when you’re done.</p>
                <label className="field">
                  <span>Address</span>
                  <span className="temp-addr">
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="tiktok-test" />
                    <span className="temp-at">@</span>
                    {ownDomain ? (
                      <Select<string> value={domain} onChange={setDomain} label="Domain" className="sel-flat temp-domain-sel" options={[{ value: tempDomain(ws), label: tempDomain(ws), hint: 'Works straight away' }, { value: ownDomain, label: ownDomain, hint: 'Your company’s domain' }]} />
                    ) : (
                      <span className="temp-domain">{domain}</span>
                    )}
                    <button type="button" className="icon-btn sm" title="Make one up" onClick={() => setName(randomName())}>
                      <Dices size={15} />
                    </button>
                  </span>
                  {taken ? (
                    <small className="err">That address already exists.</small>
                  ) : (
                    local.length >= 2 && (
                      <small className="temp-preview">
                        {email}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => void navigator.clipboard?.writeText(email).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1400)))}
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                        </button>
                      </small>
                    )
                  )}
                </label>
              </>
            )}
            <div className="field">
              <span>Who can see it</span>
              <div className="temp-people">
                {people.map((u) => (
                  <button key={u.id} type="button" className={who.includes(u.id) ? 'on' : ''} onClick={() => toggle(u.id)} aria-pressed={who.includes(u.id)}>
                    <Avatar person={u} size={20} /> {u.id === me ? 'You' : u.name.split(' ')[0]}
                    {who.includes(u.id) && <Check size={12} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>{editing ? 'Keep it for' : 'Delete it after'}</span>
              <div className="segmented">
                {(editing ? [['same', 'No change'] as const, ...LIFETIMES] : LIFETIMES).map(([v, l]) => (
                  <button key={l} type="button" className={life === v ? 'on' : ''} onClick={() => setLife(v)}>
                    {l}
                  </button>
                ))}
              </div>
              {editing && <small className="muted">{lifeLeft(editing)}. Picking a length counts from today.</small>}
            </div>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!ok} onClick={save}>
            {editing ? 'Save' : 'Create address'}
          </button>
        </footer>
      </div>
    </div>
  );
}
