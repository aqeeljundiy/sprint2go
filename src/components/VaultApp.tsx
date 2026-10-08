import { ProjectBadge } from './ProjectBadge';
import { useEffect, useRef, useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { Copy, Eye, History, KeyRound, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import type { Client, Team, User } from '../types';
import { relative } from '../utils';
import { server } from '../sync';
import { Popover } from './ui/Popover';
import { PeoplePicker } from './ui/PeoplePicker';

/** What the browser knows about a login. The password, 2FA secret and notes stay on the server. */
export interface VaultItem {
  id: string;
  workspaceId: string;
  meta: { title: string; url?: string; username?: string; clientId?: string; access: { everyone: boolean; userIds: string[]; teamIds: string[] } };
  hasPassword: boolean;
  hasTotp: boolean;
  hasNotes: boolean;
  createdBy: string;
  updatedAt: string;
  canEdit: boolean;
}

const host = (u?: string) => (u ? u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '');
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'Something went wrong.');
  return d as T;
};
/** Copies, then clears the clipboard after 30 seconds (if this tab still has focus). */
const copySecret = async (text: string) => {
  await navigator.clipboard?.writeText(text);
  setTimeout(() => void navigator.clipboard?.writeText('').catch(() => {}), 30_000);
};

/** The sidebar: all logins, or one client's. */
export function VaultSidebar({ items, clients, filter, onFilter, onNew }: { items: VaultItem[]; clients: Client[]; filter: string; onFilter: (f: string) => void; onNew: () => void }) {
  const withItems = clients.filter((c) => items.some((i) => i.meta.clientId === c.id));
  return (
    <>
      <button className="compose-btn" onClick={onNew} disabled={!server.on} title="Add a login">
        <Plus size={16} />
        <span className="sb-label">Add a login</span>
      </button>
      <nav className="nav">
        <button className={`nav-item ${filter === '' ? 'active' : ''}`} onClick={() => onFilter('')}>
          <KeyRound size={16} />
          <span className="sb-label">All logins</span>
        </button>
        <button className={`nav-item ${filter === 'company' ? 'active' : ''}`} onClick={() => onFilter('company')}>
          <Lock size={16} />
          <span className="sb-label">Company logins</span>
        </button>
      </nav>
      {withItems.length > 0 && (
        <>
          <div className="nav-heading sb-label">{term.Many}</div>
          <nav className="nav">
            {withItems.map((c) => (
              <button key={c.id} className={`nav-item ${filter === c.id ? 'active' : ''}`} onClick={() => onFilter(c.id)}>
                <ProjectBadge p={c} kind="client-dot" />
                <span className="sb-label">{c.name}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      <p className="muted small sb-label sb-note vault-note">
        <ShieldCheck size={13} /> Passwords stay encrypted on the server. Copying one is logged, and the clipboard clears after 30 seconds.
      </p>
    </>
  );
}

/** The logins, with copy username / copy password / 2FA code on each row. */
export function VaultView({
  workspaceId,
  items,
  reload,
  filter,
  clients,
  users,
  teams,
  me,
  isAdmin,
  editing,
  setEditing,
  toast,
}: {
  workspaceId: string;
  items: VaultItem[];
  reload: () => void;
  filter: string;
  clients: Client[];
  users: User[];
  teams: Team[];
  me: string;
  isAdmin: boolean;
  editing: VaultItem | 'new' | null;
  setEditing: (v: VaultItem | 'new' | null) => void;
  toast: (t: string) => void;
}) {
  const [code, setCode] = useState<{ id: string; code: string; left: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [reading, setReading] = useState<{ title: string; value: string } | null>(null);
  const [log, setLog] = useState<{ item: VaultItem; rows: { userId: string; what: string; at: string }[] } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  // The 2FA code counts down and refreshes itself while it's shown.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setCode((c) => (c ? { ...c, left: c.left - 1 } : c)), 1000);
    return () => clearInterval(t);
  }, [code?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (code && code.left <= 0) void showCode(code.id);
  }, [code?.left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!server.on)
    return (
      <section className="tasks-pane view-enter">
        <div className="empty">
          <div className="empty-art">
            <KeyRound size={22} />
          </div>
          <p className="empty-title">The Vault needs the Sprint2go server</p>
          <p className="empty-sub">Passwords are never kept in the browser. Run the local server (npm run server) and sign in to use it.</p>
        </div>
      </section>
    );

  const shown = items.filter((i) => (filter === '' ? true : filter === 'company' ? !i.meta.clientId : i.meta.clientId === filter));
  const copyPassword = async (it: VaultItem) => {
    try {
      const { value } = await api<{ value: string }>(`/api/vault/${it.id}/reveal`, { method: 'POST', body: JSON.stringify({ field: 'password' }) });
      await copySecret(value);
      toast(`Password for ${it.meta.title} copied. The clipboard clears in 30 seconds`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  async function showCode(id: string) {
    try {
      const r = await api<{ code: string; secondsLeft: number }>(`/api/vault/${id}/code`, { method: 'POST' });
      setCode({ id, code: r.code, left: r.secondsLeft });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const who = (id: string) => users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'Someone';
  const accessLabel = (it: VaultItem) =>
    it.meta.access.everyone ? 'Everyone' : [...it.meta.access.teamIds.map((t) => teams.find((x) => x.id === t)?.name).filter(Boolean), ...it.meta.access.userIds.map(who)].join(', ') || `Only ${it.createdBy === me ? 'you' : who(it.createdBy)}`;
  const current = items.find((i) => i.id === menu);

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <div className="th-text">
          <h1>{filter === '' ? 'All logins' : filter === 'company' ? 'Company logins' : (clients.find((c) => c.id === filter)?.name ?? 'Logins')}</h1>
          <p>Shared logins and 2FA codes, only for the people you choose</p>
        </div>
        <button className="primary-btn sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add a login
        </button>
      </header>
      <div className="tracking-scroll">
        {shown.length === 0 && (
          <div className="empty">
            <div className="empty-art">
              <KeyRound size={22} />
            </div>
            <p className="empty-title">No logins here yet</p>
            <p className="empty-sub">Add the client logins your team shares (Meta, Shopify, Google Ads). Paste the 2FA setup key and everyone with access gets the codes here, without anyone’s phone.</p>
          </div>
        )}
        <div className="todo-group">
          {shown.map((it) => {
            const c = clients.find((x) => x.id === it.meta.clientId);
            return (
              <div key={it.id} className="task vault-row">
                <span className="vault-icon">{it.meta.title.charAt(0).toUpperCase()}</span>
                <div className="task-main">
                  <span className="task-title-btn">{it.meta.title}</span>
                  <div className="task-meta">
                    {it.meta.username && <span className="src">{it.meta.username}</span>}
                    {it.meta.url && <span className="src">{host(it.meta.url)}</span>}
                    {c && (
                      <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                        {c.name}
                      </span>
                    )}
                    <span className="src">
                      <Users size={11} /> {accessLabel(it)}
                    </span>
                  </div>
                </div>
                {code?.id === it.id ? (
                  <button className="vault-code" onClick={() => void copySecret(code.code).then(() => toast('Code copied'))} title="Copy the code">
                    <b>
                      {code.code.slice(0, 3)} {code.code.slice(3)}
                    </b>
                    <small>{code.left}s</small>
                  </button>
                ) : (
                  it.hasTotp && (
                    <button className="row-act" onClick={() => void showCode(it.id)}>
                      <ShieldCheck size={12} /> 2FA code
                    </button>
                  )
                )}
                {it.meta.username && (
                  <button className="icon-btn sm" title="Copy username" onClick={() => void navigator.clipboard?.writeText(it.meta.username!).then(() => toast('Username copied'))}>
                    <Copy size={14} />
                  </button>
                )}
                {it.hasPassword && (
                  <button className="row-act primary" onClick={() => void copyPassword(it)}>
                    Copy password
                  </button>
                )}
                <button
                  className="icon-btn sm"
                  aria-label="More"
                  onClick={(e) => {
                    anchor.current = e.currentTarget;
                    setMenu(it.id);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Popover anchor={anchor} open={!!current} onClose={() => setMenu(null)} width={230} title={current?.meta.title ?? ''}>
        {current && (
          <div className="sel-pop">
            {current.meta.url && (
              <a className="sel-opt" href={current.meta.url} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>
                <RefreshCw size={14} /> Open {host(current.meta.url)}
              </a>
            )}
            {current.hasNotes && (
              <button
                className="sel-opt"
                onClick={async () => {
                  setMenu(null);
                  const { value } = await api<{ value: string }>(`/api/vault/${current.id}/reveal`, { method: 'POST', body: JSON.stringify({ field: 'notes' }) });
                  setReading({ title: current.meta.title, value });
                }}
              >
                <Eye size={14} /> Read notes
              </button>
            )}
            {current.canEdit && (
              <>
                <button className="sel-opt" onClick={() => (setMenu(null), setEditing(current))}>
                  <Pencil size={14} /> Edit and access
                </button>
                <button
                  className="sel-opt"
                  onClick={async () => {
                    setMenu(null);
                    const { log: rows } = await api<{ log: { userId: string; what: string; at: string }[] }>(`/api/vault/${current.id}/log`);
                    setLog({ item: current, rows });
                  }}
                >
                  <History size={14} /> Who used it
                </button>
                <button
                  className="sel-opt danger"
                  onClick={async () => {
                    setMenu(null);
                    if (!confirm(`Delete the login “${current.meta.title}”? This can’t be undone.`)) return;
                    await api(`/api/vault/${current.id}`, { method: 'DELETE' });
                    reload();
                    toast('Login deleted');
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </Popover>

      {editing && (
        <VaultEditor
          item={editing === 'new' ? null : editing}
          defaultClient={filter && filter !== 'company' ? filter : undefined}
          workspaceId={workspaceId}
          clients={clients}
          users={users}
          teams={teams}
          me={me}
          isAdmin={isAdmin}
          onSaved={() => (setEditing(null), reload(), toast('Login saved'))}
          onClose={() => setEditing(null)}
        />
      )}
      {reading && (
        <div className="modal-scrim" onMouseDown={() => setReading(null)}>
          <div className="modal vault-log" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <span className="dump-title">
                <Lock size={15} /> Notes for “{reading.title}”
              </span>
              <button className="icon-btn sm" onClick={() => setReading(null)} aria-label="Close">
                <X size={15} />
              </button>
            </header>
            <div className="modal-body">
              <SmoothHeight>
              <p className="vault-notes">{reading.value}</p>
              <p className="muted small">Reading notes is logged, like copying a password.</p>
              </SmoothHeight>
            </div>
          </div>
        </div>
      )}
      {log && (
        <div className="modal-scrim" onMouseDown={() => setLog(null)}>
          <div className="modal vault-log" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <span className="dump-title">
                <History size={15} /> Who used “{log.item.meta.title}”
              </span>
              <button className="icon-btn sm" onClick={() => setLog(null)} aria-label="Close">
                <X size={15} />
              </button>
            </header>
            <div className="modal-body">
              <SmoothHeight>
              {log.rows.length === 0 && <p className="te-empty">Nobody has used it yet.</p>}
              <ul className="home-list">
                {log.rows.map((r, i) => (
                  <li key={i} className="vault-log-row">
                    <span>
                      <b>{r.userId === me ? 'You' : who(r.userId)}</b> {r.what}
                    </span>
                    <time>{relative(r.at)}</time>
                  </li>
                ))}
              </ul>
              </SmoothHeight>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Pull the secret out of an otpauth:// link, or tidy a pasted setup key. */
const parseTotp = (raw: string) => {
  const t = raw.trim();
  if (t.startsWith('otpauth://')) {
    try {
      return new URL(t).searchParams.get('secret') ?? '';
    } catch {
      return t;
    }
  }
  return t.replace(/\s+/g, '');
};
const strongPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  const a = new Uint32Array(20);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('');
};

function VaultEditor({
  item,
  defaultClient,
  workspaceId,
  clients,
  users,
  teams,
  me,
  isAdmin,
  onSaved,
  onClose,
}: {
  item: VaultItem | null;
  defaultClient?: string;
  workspaceId: string;
  clients: Client[];
  users: User[];
  teams: Team[];
  me: string;
  isAdmin: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item?.meta.title ?? '');
  const [url, setUrl] = useState(item?.meta.url ?? '');
  const [username, setUsername] = useState(item?.meta.username ?? '');
  const [password, setPassword] = useState(''); // empty = keep the saved one
  const [totp, setTotp] = useState('');
  const [notes, setNotes] = useState('');
  const [clientId, setClientId] = useState(item?.meta.clientId ?? defaultClient ?? '');
  const [everyone, setEveryone] = useState(item?.meta.access.everyone ?? false);
  const [userIds, setUserIds] = useState<string[]>(item?.meta.access.userIds ?? []);
  const [teamIds, setTeamIds] = useState<string[]>(item?.meta.access.teamIds ?? []);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/vault', {
        method: 'POST',
        body: JSON.stringify({
          id: item?.id,
          workspaceId,
          meta: { title, url: url || undefined, username: username || undefined, clientId: clientId || undefined, access: { everyone, userIds, teamIds } },
          password: password || undefined,
          totp: totp ? parseTotp(totp) : undefined,
          notes: notes || undefined,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal vault-modal" role="dialog" aria-label={item ? 'Edit login' : 'Add a login'} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <KeyRound size={15} /> {item ? `Edit “${item.meta.title}”` : 'Add a login'}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body vault-body">
          <SmoothHeight>
          <div className="vault-grid">
            <label className="field">
              <span>Name</span>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. KopiKita Meta Business" />
            </label>
            <label className="field">
              <span>Website</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://business.facebook.com" />
            </label>
            <label className="field">
              <span>Username or email</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <div className="field">
              <span>Password{item?.hasPassword ? ' (leave empty to keep it)' : ''}</span>
              <span className="pw-row">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={item?.hasPassword ? '••••••••' : ''} />
                <button type="button" className="icon-btn sm" onClick={() => setShowPw((s) => !s)} title={showPw ? 'Hide' : 'Show'}>
                  <Eye size={14} />
                </button>
                <button type="button" className="ghost-btn sm" onClick={() => (setPassword(strongPassword()), setShowPw(true))}>
                  Generate
                </button>
              </span>
            </div>
          </div>
          <label className="field">
            <span>2FA setup key{item?.hasTotp ? ' (saved; paste a new one to replace it)' : ' (optional)'}</span>
            <input value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="The key shown when you set up an authenticator app, or the otpauth:// link" autoComplete="off" />
          </label>
          <label className="field">
            <span>Notes{item?.hasNotes ? ' (saved; type to replace)' : ' (optional)'}</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Backup codes, security questions, who to ask" autoComplete="off" />
          </label>
          <div className="field">
            <span>{term.One}</span>
            <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none={`Company login (no ${term.one})`} />
          </div>
          <div className="field">
            <span>Who can use it</span>
            <label className="check-row">
              <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Everyone in the company
            </label>
            <div className={`fold ${everyone ? '' : 'open'}`} aria-hidden={everyone}>
              <div className="fold-in">
                <div className="team-toggles">
                  {teams.map((t) => (
                    <button key={t.id} type="button" className={teamIds.includes(t.id) ? 'on' : ''} onClick={() => setTeamIds((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
                      <span className="team-square" style={{ background: t.color }} /> {t.name}
                    </button>
                  ))}
                </div>
                <PeoplePicker value={userIds} users={users.filter((u) => u.id !== me)} me={me} onChange={setUserIds} label="People" emptyText="Add people" />
                <small className="muted">You{isAdmin ? '' : ' and admins'} can always see it.</small>
              </div>
            </div>
          </div>
          {error && <p className="err">{error}</p>}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!title.trim() || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save login'}
          </button>
        </footer>
      </div>
    </div>
  );
}
