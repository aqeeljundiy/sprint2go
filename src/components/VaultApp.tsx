import { ProjectBadge } from './ProjectBadge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { SmoothHeight } from './ui/Smooth';
import { term, brand as product } from '../terms';
import { Copy, Eye, History, KeyRound, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import type { Client, Team, User } from '../types';
import { t, tn } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtAgo, fmtDateTime, fmtList } from '../i18n/format';
import { server } from '../sync';
import { isSandboxId } from '../sandbox';
import { Popover } from './ui/Popover';
import { PeoplePicker } from './ui/PeoplePicker';
import { decryptSecret, encryptSecret, isEncrypted, makeVaultKeys, newItemKeys, rewrapVaultKey, setVaultUnlocked, totp as totpCode, unlockVaultKey, unwrapWith, vaultUnlocked, wrapFor, type VaultKeyRecord, type WrappedKey } from '../vaultCrypto';
import { EmptyState } from './ui/EmptyState';

/** What the browser knows about a login. The password, 2FA secret and notes stay on the server. */
export interface VaultItem {
  id: string;
  workspaceId: string;
  meta: { title: string; url?: string; username?: string; clientId?: string; access: { everyone: boolean; userIds: string[]; teamIds: string[] }; keys?: Record<string, WrappedKey> };
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
  // The server answers in English: its fixed messages are translated here (src/i18n/id/vault.ts).
  const error = (d as { error?: string }).error;
  if (!r.ok) throw new Error(error ? t(error) : t('Something went wrong.'));
  return d as T;
};
/** One line of a login's history, a whole sentence from what the server wrote ("copied the password"). */
function logLine(who: ReactNode, what: string): ReactNode {
  switch (what) {
    case 'copied the password':
      return tj('{who} copied the password', { who });
    case 'used a 2FA code':
      return tj('{who} used a 2FA code', { who });
    case 'read the notes':
      return tj('{who} read the notes', { who });
    case 'added it':
      return tj('{who} added it', { who });
    case 'changed it':
      return tj('{who} changed it', { who });
  }
  const shared = /^re-shared with (\d+) people$/.exec(what);
  if (shared) return tj('{who} re-shared it with {people}', { who, people: tn(Number(shared[1]), '{n} person', '{n} people') });
  return (
    <>
      {who} {what}
    </>
  );
}
/** Copies, then clears the clipboard after 30 seconds (if this tab still has focus). */
const copySecret = async (text: string) => {
  await navigator.clipboard?.writeText(text);
  setTimeout(() => void navigator.clipboard?.writeText('').catch(() => {}), 30_000);
};

/** The sidebar: all logins, or one client's. */
export function VaultSidebar({ items, clients, filter, onFilter, onNew, workspaceId }: { items: VaultItem[]; clients: Client[]; filter: string; onFilter: (f: string) => void; onNew: () => void; workspaceId?: string }) {
  const withItems = clients.filter((c) => items.some((i) => i.meta.clientId === c.id));
  return (
    <>
      <button className="compose-btn" onClick={onNew} disabled={!server.on || isSandboxId(workspaceId)} title={t('Add a login')}>
        <Plus size={16} />
        <span className="sb-label">{t('Add a login')}</span>
      </button>
      <nav className="nav">
        <button className={`nav-item ${filter === '' ? 'active' : ''}`} onClick={() => onFilter('')}>
          <KeyRound size={16} />
          <span className="sb-label">{t('All logins')}</span>
        </button>
        <button className={`nav-item ${filter === 'company' ? 'active' : ''}`} onClick={() => onFilter('company')}>
          <Lock size={16} />
          <span className="sb-label">{t('Company logins')}</span>
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
        <ShieldCheck size={13} /> {t('Passwords stay encrypted on the server. Copying one is logged, and the clipboard clears after 30 seconds.')}
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
  vaultKey,
  onVaultKey,
  adminIds = [],
}: {
  vaultKey?: VaultKeyRecord; // this person's end-to-end keys (none yet: they set a passphrase first)
  onVaultKey: (r: VaultKeyRecord) => void;
  adminIds?: string[]; // admins can always open a login, so they get a key too
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
  const [, setTick] = useState(0); // re-render after unlocking
  const [menu, setMenu] = useState<string | null>(null);
  const [reading, setReading] = useState<{ title: string; value: string } | null>(null);
  const [log, setLog] = useState<{ item: VaultItem; rows: { userId: string; what: string; at: string }[] } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  // The 2FA code counts down and refreshes itself while it's shown.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setCode((c) => (c ? { ...c, left: c.left - 1 } : c)), 1000);
    return () => clearInterval(timer);
  }, [code?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (code && code.left <= 0) void showCode(code.id);
  }, [code?.left]); // eslint-disable-line react-hooks/exhaustive-deps

  // The demo company has made-up people: real passwords never go in it.
  if (isSandboxId(workspaceId))
    return (
      <section className="tasks-pane view-enter">
        <EmptyState icon={<KeyRound size={22} />} title={t('The Vault isn’t part of the demo company')} text={t('It keeps real passwords and two-step codes, so it opens in your real company only.')} />
      </section>
    );
  if (!server.on)
    return (
      <section className="tasks-pane view-enter">
        <EmptyState
          icon={<KeyRound size={22} />}
          title={t('The Vault needs the {product} server', { product: product.name })}
          text={t('Passwords are never kept in the browser. Run the local server (npm run server) and sign in to use it.')}
        />
      </section>
    );

  // Locked until the passphrase is typed once in this tab: the private key lives only in memory.
  const priv = vaultUnlocked(me);
  /** Every login I hold the key to: wrap it for each allowed person who has a Vault key but no copy yet. */
  const reshareAll = async () => {
    if (!priv) return;
    let people = 0, logins = 0;
    for (const it of items) {
      const mine = it.meta.keys?.[me];
      if (!mine) continue;
      const inTeam = (u: User) => it.meta.access.teamIds.some((tid) => teams.find((x) => x.id === tid)?.members.includes(u.id));
      const missing = users.filter((u) => u.vaultKey && !it.meta.keys?.[u.id] && (adminIds.includes(u.id) || it.meta.access.everyone || it.meta.access.userIds.includes(u.id) || inTeam(u)));
      if (!missing.length) continue;
      try {
        const itemKey = await unwrapWith(priv, mine);
        const keys: Record<string, WrappedKey> = {};
        for (const u of missing) keys[u.id] = await wrapFor(itemKey, u.vaultKey!.pub);
        await api(`/api/vault/${it.id}/keys`, { method: 'POST', body: JSON.stringify({ keys }) });
        people += missing.length;
        logins++;
      } catch (e) {
        toast(e instanceof Error ? e.message : t('Could not re-share a login.'));
      }
    }
    toast(
      logins
        ? t('Re-shared {logins} with {people}.', { logins: tn(logins, '{n} login', '{n} logins'), people: tn(people, '{n} person', '{n} people') })
        : t('Everyone who may open your logins already holds the keys.'),
    );
    reload();
  };
  if (!priv) return <VaultGate record={vaultKey} me={me} onUnlocked={(k, record) => (setVaultUnlocked(me, k), record && onVaultKey(record), setTick((n) => n + 1))} />;

  const shown = items.filter((i) => (filter === '' ? true : filter === 'company' ? !i.meta.clientId : i.meta.clientId === filter));
  /** A secret of an end-to-end login, decrypted here; a server-locked (older) one comes back as is. */
  const secretOf = async (it: VaultItem, field: 'password' | 'totp' | 'notes') => {
    const { value } = await api<{ value: string }>(`/api/vault/${it.id}/reveal`, { method: 'POST', body: JSON.stringify({ field }) });
    if (!isEncrypted(value)) return value;
    const w = it.meta.keys?.[me];
    if (!w) throw new Error(t('You don’t hold the key to this login. Ask whoever added it to edit and save it, so it’s shared with you.'));
    return decryptSecret(await unwrapWith(priv, w), value);
  };
  const copyPassword = async (it: VaultItem) => {
    try {
      const value = await secretOf(it, 'password');
      await copySecret(value);
      toast(t('Password for {title} copied. The clipboard clears in 30 seconds', { title: it.meta.title }));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  async function showCode(id: string) {
    try {
      const it = items.find((x) => x.id === id);
      // End-to-end: the secret is decrypted here and the code worked out here. Older logins: the server does it.
      const r = it?.meta.keys ? await totpCode(await secretOf(it, 'totp')) : await api<{ code: string; secondsLeft: number }>(`/api/vault/${id}/code`, { method: 'POST' });
      setCode({ id, code: r.code, left: r.secondsLeft });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const who = (id: string) => users.find((u) => u.id === id)?.name.split(' ')[0] ?? t('Someone');
  const accessLabel = (it: VaultItem) => {
    if (it.meta.access.everyone) return t('Everyone');
    const names = [...it.meta.access.teamIds.map((tid) => teams.find((x) => x.id === tid)?.name).filter((n): n is string => !!n), ...it.meta.access.userIds.map(who)];
    if (names.length) return fmtList(names);
    return it.createdBy === me ? t('Only you') : t('Only {name}', { name: who(it.createdBy) });
  };
  const current = items.find((i) => i.id === menu);

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <div className="th-text">
          <h1>{filter === '' ? t('All logins') : filter === 'company' ? t('Company logins') : (clients.find((c) => c.id === filter)?.name ?? t('Logins'))}</h1>
          <p>{t('Shared logins and 2FA codes, only for the people you choose')}</p>
        </div>
        {priv && items.some((it) => it.meta.keys?.[me]) && (
          <button className="ghost-btn sm" title={t('Give everyone who may open a login the key to it (after they set up their Vault, or lost their passphrase)')} onClick={() => void reshareAll()}>
            <Users size={14} /> {t('Re-share all')}
          </button>
        )}
        <button className="primary-btn sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> {t('Add a login')}
        </button>
      </header>
      <div className="tracking-scroll">
        {shown.length === 0 && (
          <EmptyState
            icon={<KeyRound size={22} />}
            title={t('No logins here yet')}
            text={t('Add the client logins your team shares (Meta, Shopify, Google Ads). Paste the 2FA setup key and everyone with access gets the codes here, without anyone’s phone.')}
          />
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
                    <span className={`src vault-e2e${it.meta.keys ? ' on' : ''}`} title={it.meta.keys ? t('Encrypted on your devices; the server can’t read it') : t('Locked by the server. Edit and save to move it to end-to-end')}>
                      <Lock size={11} /> {it.meta.keys ? t('End-to-end') : t('Server-locked')}
                    </span>
                  </div>
                </div>
                {code?.id === it.id ? (
                  <button className="vault-code" onClick={() => void copySecret(code.code).then(() => toast(t('Code copied')))} title={t('Copy the code')}>
                    <b>
                      {code.code.slice(0, 3)} {code.code.slice(3)}
                    </b>
                    <small>{code.left}s</small>
                  </button>
                ) : (
                  it.hasTotp && (
                    <button className="row-act" onClick={() => void showCode(it.id)}>
                      <ShieldCheck size={12} /> {t('2FA code')}
                    </button>
                  )
                )}
                {it.meta.username && (
                  <button className="icon-btn sm" title={t('Copy username')} onClick={() => void navigator.clipboard?.writeText(it.meta.username!).then(() => toast(t('Username copied')))}>
                    <Copy size={14} />
                  </button>
                )}
                {it.hasPassword && (
                  <button className="row-act primary" onClick={() => void copyPassword(it)}>
                    {t('Copy password')}
                  </button>
                )}
                <button
                  className="icon-btn sm"
                  aria-label={t('More')}
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
                <RefreshCw size={14} /> {t('Open {site}', { site: host(current.meta.url) })}
              </a>
            )}
            {current.hasNotes && (
              <button
                className="sel-opt"
                onClick={async () => {
                  setMenu(null);
                  try {
                    setReading({ title: current.meta.title, value: await secretOf(current, 'notes') });
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <Eye size={14} /> {t('Read notes')}
              </button>
            )}
            {current.canEdit && (
              <>
                <button className="sel-opt" onClick={() => (setMenu(null), setEditing(current))}>
                  <Pencil size={14} /> {t('Edit and access')}
                </button>
                <button
                  className="sel-opt"
                  onClick={async () => {
                    setMenu(null);
                    try {
                      const { log: rows } = await api<{ log: { userId: string; what: string; at: string }[] }>(`/api/vault/${current.id}/log`);
                      setLog({ item: current, rows });
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <History size={14} /> {t('Who used it')}
                </button>
                <button
                  className="sel-opt danger"
                  onClick={async () => {
                    setMenu(null);
                    if (!confirm(t('Delete the login “{title}”? This can’t be undone.', { title: current.meta.title }))) return;
                    try {
                      await api(`/api/vault/${current.id}`, { method: 'DELETE' });
                      reload();
                      toast(t('Login deleted'));
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={14} /> {t('Delete')}
                </button>
              </>
            )}
          </div>
        )}
      </Popover>

      {editing && (
        <VaultEditor
          priv={priv}
          adminIds={adminIds}
          item={editing === 'new' ? null : editing}
          defaultClient={filter && filter !== 'company' ? filter : undefined}
          workspaceId={workspaceId}
          clients={clients}
          users={users}
          teams={teams}
          me={me}
          isAdmin={isAdmin}
          onSaved={() => (setEditing(null), reload(), toast(t('Login saved')))}
          onClose={() => setEditing(null)}
        />
      )}
      {reading && (
        <div className="modal-scrim" onMouseDown={() => setReading(null)}>
          <div className="modal vault-log" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <span className="dump-title">
                <Lock size={15} /> {t('Notes for “{name}”', { name: reading.title })}
              </span>
              <button className="icon-btn sm" onClick={() => setReading(null)} aria-label={t('Close')}>
                <X size={15} />
              </button>
            </header>
            <div className="modal-body">
              <SmoothHeight>
              <p className="vault-notes">{reading.value}</p>
              <p className="muted small">{t('Reading notes is logged, like copying a password.')}</p>
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
                <History size={15} /> {t('Who used “{name}”', { name: log.item.meta.title })}
              </span>
              <button className="icon-btn sm" onClick={() => setLog(null)} aria-label={t('Close')}>
                <X size={15} />
              </button>
            </header>
            <div className="modal-body">
              <SmoothHeight>
              {log.rows.length === 0 && <EmptyState compact text={t('Nobody has used it yet.')} />}
              <ul className="home-list">
                {log.rows.map((r, i) => (
                  <li key={i} className="vault-log-row">
                    <span>{logLine(<b>{r.userId === me ? t('You') : who(r.userId)}</b>, r.what)}</span>
                    <time dateTime={r.at} title={fmtDateTime(r.at)}>
                      {fmtAgo(r.at)}
                    </time>
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
  const s = raw.trim();
  if (s.startsWith('otpauth://')) {
    try {
      return new URL(s).searchParams.get('secret') ?? '';
    } catch {
      return s;
    }
  }
  return s.replace(/\s+/g, '');
};
const strongPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  const a = new Uint32Array(20);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('');
};

function VaultEditor({
  priv,
  adminIds,
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
  priv: CryptoKey;
  adminIds: string[];
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
  const [noKey, setNoKey] = useState<string[]>([]); // people who'd get access but haven't set up their Vault yet
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // Who may open it: me, admins, and the people and teams chosen (everyone, when it's for everyone).
      const inTeam = (u: User) => teamIds.some((tid) => teams.find((x) => x.id === tid)?.members.includes(u.id));
      const allowed = users.filter((u) => u.id === me || adminIds.includes(u.id) || everyone || userIds.includes(u.id) || inTeam(u));
      const withKey = allowed.filter((u) => u.vaultKey);
      setNoKey(allowed.filter((u) => !u.vaultKey && u.id !== me).map((u) => u.name.split(' ')[0]));
      // The item key: the one this login already has (if I hold it), or a fresh one.
      let itemKey: CryptoKey;
      let keys: Record<string, WrappedKey> = {};
      const mine = item?.meta.keys?.[me];
      if (item?.meta.keys && !mine) throw new Error(t('You don’t hold the key to this login, so you can’t change it. Ask whoever added it to edit and save it, so it’s shared with you.'));
      if (mine) {
        itemKey = await unwrapWith(priv, mine);
        for (const u of withKey) keys[u.id] = item!.meta.keys![u.id] ?? (await wrapFor(itemKey, u.vaultKey!.pub));
      } else {
        const made = await newItemKeys(withKey.map((u) => ({ id: u.id, pub: u.vaultKey!.pub })));
        itemKey = made.key;
        keys = made.keys;
      }
      // Secrets: what was typed, else what's saved. An older server-locked login moves to end-to-end on the way.
      const current = async (field: 'password' | 'totp' | 'notes', has: boolean) => {
        if (!item || !has) return undefined;
        const { value } = await api<{ value: string }>(`/api/vault/${item.id}/reveal`, { method: 'POST', body: JSON.stringify({ field }) });
        return isEncrypted(value) ? (mine ? value : await encryptSecret(itemKey, await decryptSecret(await unwrapWith(priv, mine!), value))) : value ? await encryptSecret(itemKey, value) : undefined;
      };
      const enc = async (v: string) => encryptSecret(itemKey, v);
      await api('/api/vault', {
        method: 'POST',
        body: JSON.stringify({
          id: item?.id,
          workspaceId,
          meta: { title, url: url || undefined, username: username || undefined, clientId: clientId || undefined, access: { everyone, userIds, teamIds }, keys },
          password: password ? await enc(password) : await current('password', !!item?.hasPassword),
          totp: totp ? await enc(parseTotp(totp)) : await current('totp', !!item?.hasTotp),
          notes: notes ? await enc(notes) : await current('notes', !!item?.hasNotes),
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
      <div className="modal vault-modal" role="dialog" aria-label={item ? t('Edit login') : t('Add a login')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <KeyRound size={15} /> {item ? t('Edit “{name}”', { name: item.meta.title }) : t('Add a login')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body vault-body">
          <SmoothHeight>
          <div className="vault-grid">
            <label className="field">
              <span>{t('Name')}</span>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. {example}', { example: 'KopiKita Meta Business' })} />
            </label>
            <label className="field">
              <span>{t('Website')}</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://business.facebook.com" />
            </label>
            <label className="field">
              <span>{t('Username or email')}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <div className="field">
              <span>{item?.hasPassword ? t('Password (leave empty to keep it)') : t('Password')}</span>
              <span className="pw-row">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={item?.hasPassword ? '••••••••' : ''} />
                <button type="button" className="icon-btn sm" onClick={() => setShowPw((s) => !s)} title={showPw ? t('Hide') : t('Show')}>
                  <Eye size={14} />
                </button>
                <button type="button" className="ghost-btn sm" onClick={() => (setPassword(strongPassword()), setShowPw(true))}>
                  {t('Generate')}
                </button>
              </span>
            </div>
          </div>
          <label className="field">
            <span>{item?.hasTotp ? t('2FA setup key (saved; paste a new one to replace it)') : t('2FA setup key (optional)')}</span>
            <input value={totp} onChange={(e) => setTotp(e.target.value)} placeholder={t('The key shown when you set up an authenticator app, or the otpauth:// link')} autoComplete="off" />
          </label>
          <label className="field">
            <span>{item?.hasNotes ? t('Notes (saved; type to replace)') : t('Notes (optional)')}</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Backup codes, security questions, who to ask')} autoComplete="off" />
          </label>
          <div className="field">
            <span>{term.One}</span>
            <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none={t('Company login (no {project})', { project: term.one })} />
          </div>
          <div className="field">
            <span>{t('Who can use it')}</span>
            <label className="check-row">
              <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> {t('Everyone in the company')}
            </label>
            <div className={`fold ${everyone ? '' : 'open'}`} aria-hidden={everyone}>
              <div className="fold-in">
                <div className="team-toggles">
                  {teams.map((team) => (
                    <button key={team.id} type="button" className={teamIds.includes(team.id) ? 'on' : ''} onClick={() => setTeamIds((x) => (x.includes(team.id) ? x.filter((y) => y !== team.id) : [...x, team.id]))}>
                      <span className="team-square" style={{ background: team.color }} /> {team.name}
                    </button>
                  ))}
                </div>
                <PeoplePicker value={userIds} users={users.filter((u) => u.id !== me)} me={me} onChange={setUserIds} label={t('People')} emptyText={t('Add people')} />
                <small className="muted">
                  {isAdmin
                    ? t('You can always see it. People who haven’t set up their Vault yet get the key once you save again after they do.')
                    : t('You and admins can always see it. People who haven’t set up their Vault yet get the key once you save again after they do.')}
                </small>
                {noKey.length > 0 && <small className="muted">{t('Not set up yet: {names}.', { names: fmtList(noKey) })}</small>}
              </div>
            </div>
          </div>
          {error && <p className="err">{error}</p>}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!title.trim() || busy} onClick={() => void save()}>
            {busy ? t('Saving…') : t('Save login')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The door to the Vault: a passphrase that only this person knows. The first time, it makes their key pair and
 * locks the private key with it; after that, it unlocks the key for this tab. Nothing about it reaches the server
 * in the clear, so a lost passphrase can't be recovered: logins would have to be re-shared by others.
 */
function VaultGate({ record, me, onUnlocked }: { record?: VaultKeyRecord; me: string; onUnlocked: (priv: CryptoKey, record?: VaultKeyRecord) => void }) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fresh = !record;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      if (fresh) {
        if (pass.length < 8) throw new Error(t('Use at least 8 characters.'));
        if (pass !== again) throw new Error(t('The two don’t match.'));
        const made = await makeVaultKeys(pass);
        onUnlocked(made.priv, made.record);
      } else onUnlocked(await unlockVaultKey(record!, pass));
    } catch (e) {
      setError(fresh ? (e as Error).message : t('That’s not it. Try again.'));
    }
    setBusy(false);
  };
  return (
    <section className="tasks-pane view-enter">
      <div className="vault-gate">
        <div className="vault-gate-card">
          <KeyRound size={22} />
          <h2>{fresh ? t('Set your Vault passphrase') : t('Unlock the Vault')}</h2>
          <p className="muted">
            {fresh
              ? t('Logins are encrypted on your devices with keys only you hold; the server never sees a password. This passphrase locks your key. There is no reset: if it’s lost, teammates re-share logins with you.')
              : t('Your key stays in this tab until you close it.')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder={t('Passphrase')} autoComplete={fresh ? 'new-password' : 'current-password'} />
            {fresh && <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder={t('Once more')} autoComplete="new-password" />}
            {error && <p className="err small">{error}</p>}
            <button className="primary-btn" disabled={busy || !pass}>
              {busy ? t('Working…') : fresh ? t('Set and open') : t('Unlock')}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

/** A new passphrase for the same keys (for the header's "Change passphrase"). */
export async function changeVaultPassphrase(me: string, record: VaultKeyRecord, next: string) {
  const priv = vaultUnlocked(me);
  if (!priv) throw new Error(t('Unlock the Vault first.'));
  return rewrapVaultKey(priv, record.pub, next);
}
