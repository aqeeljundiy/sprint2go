import { useRef, useState } from 'react';
import { ImagePlus, Inbox, Shield, UserRound, Users, X } from 'lucide-react';
import type { Account, Role, User, Workspace } from '../types';
import { WORKSPACE_COLORS } from '../data/workspaces';
import { uid } from '../utils';
import { readLogo, WorkspaceLogo } from './WorkspaceLogo';

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Logo picker + brand colour, shared by "new workspace" and settings. */
export function BrandFields({
  value,
  onChange,
}: {
  value: Pick<Workspace, 'name' | 'logo' | 'color'>;
  onChange: (p: Partial<Workspace>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="brand-fields">
      <div className="logo-pick">
        <button className="logo-drop" onClick={() => input.current?.click()} title="Upload logo">
          <WorkspaceLogo ws={value} size={64} />
          <span className="logo-over">
            <ImagePlus size={18} />
          </span>
        </button>
        <div>
          <strong>Logo</strong>
          <small>PNG, JPG or SVG · square works best</small>
          <div className="logo-actions">
            <button className="ghost-btn outline sm" onClick={() => input.current?.click()}>
              Upload
            </button>
            {value.logo && (
              <button className="ghost-btn sm" onClick={() => onChange({ logo: undefined })}>
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange({ logo: await readLogo(f) });
            e.target.value = '';
          }}
        />
      </div>
      <div className="field">
        <label>Brand colour</label>
        <div className="accent-row">
          {WORKSPACE_COLORS.map((c) => (
            <button key={c} className={`accent ${value.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ color: c })} aria-label={c} />
          ))}
          <label className="accent custom" title="Custom colour" style={{ background: WORKSPACE_COLORS.includes(value.color) ? undefined : value.color }}>
            <input type="color" value={value.color} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>{title}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function NewWorkspace({ userId, userName, onCreate, onClose }: { userId: string; userName: string; onCreate: (w: Workspace) => void; onClose: () => void }) {
  const [ws, setWs] = useState<Pick<Workspace, 'name' | 'logo' | 'color'>>({ name: '', color: WORKSPACE_COLORS[2] });
  const [email, setEmail] = useState('');
  const [name, setName] = useState(userName);
  const domain = email.split('@')[1] ?? '';
  const valid = ws.name.trim() && isEmail(email);

  const create = () =>
    valid &&
    onCreate({
      id: uid(),
      name: ws.name.trim(),
      logo: ws.logo,
      color: ws.color,
      domains: domain ? [domain.toLowerCase()] : [],
      accounts: [{ id: uid(), email: email.trim().toLowerCase(), name: name.trim() || email, kind: 'personal', connected: false, users: [userId] }],
      members: [{ userId, role: 'owner' }],
    });

  return (
    <Modal title="New workspace" onClose={onClose}>
      <div className="modal-body">
        <p className="modal-intro">A workspace is one business, with its own brand, email accounts, calendar and drive.</p>
        <div className="field">
          <label>Business name</label>
          <input autoFocus value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} placeholder="e.g. Continue" />
        </div>
        <BrandFields value={ws} onChange={(p) => setWs({ ...ws, ...p })} />
        <div className="field">
          <label>Your email address there</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" onKeyDown={(e) => e.key === 'Enter' && create()} />
          {domain && <small>People at @{domain} count as your team (never tracked).</small>}
        </div>
        <div className="field">
          <label>Name people see</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <footer className="modal-foot">
        <button className="ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-btn" onClick={create} disabled={!valid}>
          Create workspace
        </button>
      </footer>
    </Modal>
  );
}

export function NewAccount({ workspace, userId, onAdd, onClose }: { workspace: Workspace; userId: string; onAdd: (a: Account) => void; onClose: () => void }) {
  const [email, setEmail] = useState(workspace.domains[0] ? `@${workspace.domains[0]}` : '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Account['kind']>('personal');
  const taken = workspace.accounts.some((a) => a.email === email.trim().toLowerCase());
  const valid = isEmail(email) && !taken;

  const add = () =>
    valid && onAdd({ id: uid(), email: email.trim().toLowerCase(), name: name.trim() || (kind === 'shared' ? workspace.name : email.split('@')[0]), kind, connected: false, users: [userId] });

  return (
    <Modal title={`Add an account to ${workspace.name}`} onClose={onClose}>
      <div className="modal-body">
        <div className="kind-pick">
          <button className={kind === 'personal' ? 'on' : ''} onClick={() => setKind('personal')}>
            <UserRound size={18} />
            <strong>Personal</strong>
            <small>Your own address</small>
          </button>
          <button className={kind === 'shared' ? 'on' : ''} onClick={() => setKind('shared')}>
            <Users size={18} />
            <strong>Shared inbox</strong>
            <small>hello@, support@, sales@</small>
          </button>
        </div>
        <div className="field">
          <label>Email address</label>
          <input
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={(e) => email.startsWith('@') && e.target.setSelectionRange(0, 0)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="name@business.com"
          />
          {taken && <small className="err">That account is already added.</small>}
        </div>
        <div className="field">
          <label>Name people see</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'shared' ? workspace.name : 'Your name'} />
        </div>
        <p className="modal-note">
          <Inbox size={14} /> The account signs in once your mail server is connected. Until then it shows as “Not connected”.
        </p>
      </div>
      <footer className="modal-foot">
        <button className="ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-btn" onClick={add} disabled={!valid}>
          Add account
        </button>
      </footer>
    </Modal>
  );
}

const PALETTE = ['#10b981', '#f59e0b', '#0ea5e9', '#d946ef', '#ef4444', '#14b8a6', '#8b5cf6'];

/** Invite a colleague: creates their user, their mailbox, and gives them shared inboxes. */
export function InviteMember({
  workspace,
  users,
  onInvite,
  onClose,
}: {
  workspace: Workspace;
  users: User[];
  onInvite: (u: User, role: Role, mailbox: Account | null, shared: string[]) => void;
  onClose: () => void;
}) {
  const domain = workspace.domains[0] ?? '';
  const [name, setName] = useState('');
  const [local, setLocal] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [mailbox, setMailbox] = useState(true);
  const shared = workspace.accounts.filter((a) => a.kind === 'shared');
  const [access, setAccess] = useState<string[]>(shared.map((a) => a.id));
  const email = `${local.trim().toLowerCase()}@${domain}`;
  const exists = users.some((u) => u.email === email) || workspace.accounts.some((a) => a.email === email);
  const valid = name.trim() && /^[a-z0-9._+-]+$/i.test(local.trim()) && domain && !exists;

  const invite = () => {
    if (!valid) return;
    const user: User = { id: uid(), name: name.trim(), email, title: '', color: PALETTE[users.length % PALETTE.length] };
    const box: Account | null = mailbox ? { id: uid(), email, name: name.trim(), kind: 'personal', connected: false, users: [user.id] } : null;
    onInvite(user, role, box, access);
  };

  return (
    <Modal title={`Invite someone to ${workspace.name}`} onClose={onClose}>
      <div className="modal-body">
        <div className="field">
          <label>Full name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!local || local === name.split(' ')[0].toLowerCase()) setLocal(e.target.value.split(' ')[0].toLowerCase());
            }}
            placeholder="e.g. Dewi Lestari"
          />
        </div>
        <div className="field">
          <label>Their email address</label>
          <div className="email-split">
            <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="dewi" onKeyDown={(e) => e.key === 'Enter' && invite()} />
            <span>@{domain || 'add a domain in settings'}</span>
          </div>
          {exists && <small className="err">Someone already uses that address.</small>}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={mailbox} onChange={(e) => setMailbox(e.target.checked)} />
          Create a mailbox for them on your mail server
        </label>
        <div className="field">
          <label>Role</label>
          <div className="kind-pick three">
            {(
              [
                ['member', UserRound, 'Member', 'Their own mail'],
                ['admin', Shield, 'Admin', 'Manage people & settings'],
                ['owner', Users, 'Owner', 'Everything, incl. billing'],
              ] as const
            ).map(([id, Icon, label, hint]) => (
              <button key={id} className={role === id ? 'on' : ''} onClick={() => setRole(id)}>
                <Icon size={18} />
                <strong>{label}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </div>
        </div>
        {shared.length > 0 && (
          <div className="field">
            <label>Shared inboxes they can open</label>
            {shared.map((a) => (
              <label key={a.id} className="check-row">
                <input
                  type="checkbox"
                  checked={access.includes(a.id)}
                  onChange={(e) => setAccess((x) => (e.target.checked ? [...x, a.id] : x.filter((i) => i !== a.id)))}
                />
                {a.email}
              </label>
            ))}
          </div>
        )}
        <p className="modal-note">
          <Inbox size={14} /> Admins can manage people, but nobody can read someone else’s personal mailbox.
        </p>
      </div>
      <footer className="modal-foot">
        <button className="ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-btn" onClick={invite} disabled={!valid}>
          Send invite
        </button>
      </footer>
    </Modal>
  );
}
