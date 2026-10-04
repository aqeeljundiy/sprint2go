import { useState } from 'react';
import { Ban, Bell, Building2, ChevronDown, HardDrive, KeyRound, UserPlus, Inbox, Plus, Trash2, Users, Keyboard, Menu, Palette, PenLine, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { ACCENTS, type Settings } from '../settings';
import type { BlockRule, Role, User, Workspace } from '../types';
import { Avatar } from './Avatar';
import { BrandFields } from './WorkspaceForms';
import { WorkspaceLogo } from './WorkspaceLogo';
import { fmtSize } from '../data/drive';
import { initials } from '../utils';
import type { SettingsSection } from './AccountMenu';
import { RichEditor } from './RichEditor';
import { Select } from './ui/Select';

const SECTIONS: { id: SettingsSection; name: string; icon: LucideIcon }[] = [
  { id: 'workspace', name: 'Workspace', icon: Building2 },
  { id: 'account', name: 'Account', icon: UserRound },
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'mail', name: 'Mail & signature', icon: PenLine },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard },
  { id: 'storage', name: 'Storage', icon: HardDrive },
];

const SHORTCUTS: [string, string[]][] = [
  ['Compose', ['C']],
  ['Search', ['/']],
  ['Next / previous conversation', ['J', 'K']],
  ['Reply', ['R']],
  ['Archive', ['E']],
  ['Delete', ['#']],
  ['Star', ['S']],
  ['Mark unread', ['U']],
  ['Send', ['⌘', '↵']],
  ['Collapse sidebar', ['[']],
  ['Switch workspace', ['⌥', '1–9']],
  ['Search everything', ['⌘', 'K']],
  ['Ask AI', ['⌘', 'J']],
  ['Go to Home / Mail / Chat / Tasks', ['G', 'then H / M / C / T']],
  ['Go to Calendar / Drive / Meet', ['G', 'then L / D / E']],
  ['Calendar: today', ['T']],
  ['Calendar: day / week / month', ['D', 'W', 'M']],
];

interface Props {
  email: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  usage: { mail: number; drive: number; media: number; quota: number };
  onMenu: () => void;
  workspace: Workspace;
  onWorkspace: (p: Partial<Workspace>) => void;
  onAddAccount: () => void;
  onRemoveAccount: (id: string) => void;
  users: User[];
  me: string; // current user id
  myRole: Role;
  onInvite: () => void;
  onRole: (userId: string, role: Role) => void;
  onRemoveMember: (userId: string) => void;
  onAccess: (accountId: string, users: string[]) => void;
  blocked: BlockRule[];
  onUnblock: (id: string) => void;
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="set-row toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
        <span />
      </button>
    </label>
  );
}

export function SettingsPage({ email, settings: s, update, section, onSection, usage, onMenu, workspace: ws, onWorkspace, onAddAccount, onRemoveAccount, users, me, myRole, onInvite, onRole, onRemoveMember, onAccess, blocked, onUnblock }: Props) {
  const [accessOpen, setAccessOpen] = useState<string | null>(null);
  const canManage = myRole !== 'member';
  const nameOf = (id: string) => (id === me ? 'You' : users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'Someone');
  const used = usage.mail + usage.drive;
  const pct = (n: number) => `${Math.max(0.6, (n / usage.quota) * 100)}%`;

  return (
    <section className="settings-pane view-enter">
      <header className="settings-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <h1>Settings</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.map(({ id, name, icon: Icon }) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => onSection(id)}>
              <Icon size={16} /> {name}
            </button>
          ))}
        </nav>

        <div className="settings-content" key={section}>
          {section === 'workspace' && (
            <>
              <h2>Workspace</h2>
              <p className="set-intro">Each business gets its own brand, email accounts, calendar and drive.</p>
              <div className="ws-preview">
                <WorkspaceLogo ws={ws} size={44} />
                <div>
                  <strong>{ws.name || 'Untitled'}</strong>
                  <small>{ws.domains.join(', ') || 'No domain yet'}</small>
                </div>
                <span className="ws-preview-btn" style={{ background: ws.color }}>
                  Compose
                </span>
              </div>
              {!canManage && <p className="modal-note">Only owners and admins can change workspace settings.</p>}
              <fieldset className="plain" disabled={!canManage}>
              <div className="field">
                <label>Business name</label>
                <input value={ws.name} onChange={(e) => onWorkspace({ name: e.target.value })} />
              </div>
              <BrandFields value={ws} onChange={onWorkspace} />
              <div className="field">
                <label>Email domains</label>
                <input
                  defaultValue={ws.domains.join(', ')}
                  key={ws.id}
                  onBlur={(e) =>
                    onWorkspace({
                      domains: e.target.value
                        .split(/[,\s]+/)
                        .map((d) => d.replace(/^@/, '').toLowerCase())
                        .filter(Boolean),
                    })
                  }
                  placeholder="business.com"
                />
                <small>People at these domains are your team, so their email is never tracked.</small>
              </div>
              </fieldset>

              <h3>Members</h3>
              <div className="acct-list">
                {ws.members.map((m) => {
                  const u = users.find((x) => x.id === m.userId);
                  if (!u) return null;
                  const owners = ws.members.filter((x) => x.role === 'owner').length;
                  return (
                    <div key={m.userId} className="acct-row">
                      <Avatar person={u} size={32} />
                      <span className="acct-info">
                        <strong>
                          {u.name}
                          {m.userId === me && <span className="you-tag">You</span>}
                        </strong>
                        <small>{u.email}</small>
                      </span>
                      {canManage && m.userId !== me && !(m.role === 'owner' && owners === 1) ? (
                        <Select<Role>
                          value={m.role}
                          onChange={(v) => onRole(m.userId, v)}
                          label="Role"
                          className="role-select"
                          options={[
                            { value: 'member', label: 'Member', hint: 'Uses the apps' },
                            { value: 'admin', label: 'Admin', hint: 'Manages people, apps and settings' },
                            { value: 'owner', label: 'Owner', hint: 'Everything, including billing' },
                          ]}
                        />
                      ) : (
                        <span className="role-tag">{m.role[0].toUpperCase() + m.role.slice(1)}</span>
                      )}
                      {canManage && m.userId !== me && m.role !== 'owner' && (
                        <button className="icon-btn sm" title="Remove from workspace" onClick={() => onRemoveMember(m.userId)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {canManage && (
                  <button className="acct-add" onClick={onInvite}>
                    <UserPlus size={16} /> Invite someone
                  </button>
                )}
              </div>

              <h3>Email accounts</h3>
              <div className="acct-list">
                {ws.accounts.map((a) => (
                  <div key={a.id} className="acct-block">
                  <div className="acct-row">
                    <span className="acct-icon">{a.kind === 'shared' ? <Users size={16} /> : <Inbox size={16} />}</span>
                    <span className="acct-info">
                      <strong>{a.email}</strong>
                      <small>
                        {a.kind === 'shared' ? 'Shared inbox' : 'Personal'} · opened by {a.users.map(nameOf).join(', ') || 'nobody'}
                      </small>
                    </span>
                    <span className={`acct-status ${a.connected ? 'ok' : ''}`}>{a.connected ? 'Connected' : 'Not connected'}</span>
                    {canManage && a.kind === 'shared' && (
                      <button
                        className={`ghost-btn outline sm access-btn ${accessOpen === a.id ? 'on' : ''}`}
                        onClick={() => setAccessOpen((x) => (x === a.id ? null : a.id))}
                      >
                        <KeyRound size={13} /> Access <ChevronDown size={13} className="chev" />
                      </button>
                    )}
                    {canManage && ws.accounts.length > 1 && (
                      <button className="icon-btn sm" title="Remove account" onClick={() => onRemoveAccount(a.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {accessOpen === a.id && (
                    <div className="access-panel">
                      <small>Who can read and send from {a.email}</small>
                      {ws.members.map((m) => {
                        const u = users.find((x) => x.id === m.userId);
                        if (!u) return null;
                        const on = a.users.includes(u.id);
                        const last = on && a.users.length === 1;
                        return (
                          <label key={u.id} className="access-row" title={last ? 'At least one person needs access' : ''}>
                            <Avatar person={u} size={24} />
                            <span>
                              {u.name}
                              {u.id === me && <span className="you-tag">You</span>}
                            </span>
                            <button
                              role="switch"
                              aria-checked={on}
                              disabled={last}
                              className={`switch ${on ? 'on' : ''}`}
                              onClick={() => onAccess(a.id, on ? a.users.filter((x) => x !== u.id) : [...a.users, u.id])}
                            >
                              <span />
                            </button>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  </div>
                ))}
                {canManage && (
                  <button className="acct-add" onClick={onAddAccount}>
                    <Plus size={16} /> Add an email account
                  </button>
                )}
              </div>
            </>
          )}

          {section === 'account' && (
            <>
              <h2>Account</h2>
              <p className="set-intro">How you appear to people you email.</p>
              <div className="profile-card">
                <span className="avatar big" style={{ background: s.avatarColor }}>
                  {initials(s.name)}
                </span>
                <div className="avatar-colors">
                  <small>Avatar colour</small>
                  <div>
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        className={`swatch ${s.avatarColor === c ? 'on' : ''}`}
                        style={{ background: c }}
                        onClick={() => update({ avatarColor: c })}
                        aria-label={`Avatar colour ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label>Display name</label>
                <input value={s.name} onChange={(e) => update({ name: e.target.value })} />
              </div>
              <div className="field">
                <label>Title</label>
                <input value={s.title} onChange={(e) => update({ title: e.target.value })} />
              </div>
              <div className="field">
                <label>Email address</label>
                <input value={email} readOnly />
                <small>Your address is set up by your administrator.</small>
              </div>

              <h3>Security</h3>
              <div className="set-row">
                <span>
                  <strong>Password</strong>
                  <small>Change it once the real mail server is connected.</small>
                </span>
                <button className="ghost-btn outline" disabled>
                  Change password
                </button>
              </div>
              <div className="set-row">
                <span>
                  <strong>Two-step verification</strong>
                  <small>Recommended for every account.</small>
                </span>
                <span className="badge-soon">
                  <ShieldCheck size={13} /> Coming soon
                </span>
              </div>
            </>
          )}

          {section === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <p className="set-intro">Make Sprint2go feel like yours.</p>
              <h3>Theme</h3>
              <div className="theme-cards">
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button key={t} className={`theme-card ${s.theme === t ? 'on' : ''}`} onClick={() => update({ theme: t })}>
                    <span className={`tc-preview tc-${t}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1)}</span>
                  </button>
                ))}
              </div>
              <h3>Accent colour</h3>
              <p className="set-hint" style={{ marginTop: 0 }}>
                Comes from your workspace’s brand colour.{' '}
                <button className="link-btn" onClick={() => onSection('workspace')}>
                  Change it in Workspace
                </button>
              </p>
              <h3>Density</h3>
              <div className="segmented">
                {(['comfortable', 'compact'] as const).map((d) => (
                  <button key={d} className={s.density === d ? 'on' : ''} onClick={() => update({ density: d })}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <Toggle on={s.showSnippets} onChange={(v) => update({ showSnippets: v })} label="Show message previews" hint="A line of each email under the subject." />
            </>
          )}

          {section === 'mail' && (
            <>
              <h2>Mail & signature</h2>
              <p className="set-intro">Added to the end of every new email and reply.</p>
              <div className="signature-box">
                <RichEditor initialHtml={s.signature} placeholder="Your signature" onChange={(html) => update({ signature: html })} />
              </div>
              <h3>Undo send</h3>
              <div className="segmented">
                {[0, 5, 10, 20].map((n) => (
                  <button key={n} className={s.undoSend === n ? 'on' : ''} onClick={() => update({ undoSend: n })}>
                    {n ? `${n}s` : 'Off'}
                  </button>
                ))}
              </div>
              <small className="set-hint">How long you have to take an email back after pressing Send.</small>

              <h3>Read tracking</h3>
              <Toggle
                on={s.trackByDefault}
                onChange={(v) => update({ trackByDefault: v })}
                label="Track opens on emails to people outside the team"
                hint="See who opened your email, how often, and which links they clicked. You can switch it off per email."
              />
              <Toggle on={s.notifyOpens} onChange={(v) => update({ notifyOpens: v })} label="Tell me when someone opens" hint="A quick notification the moment it happens." />
              <Toggle
                on={s.blockTrackers}
                onChange={(v) => update({ blockTrackers: v })}
                label="Block trackers in emails I receive"
                hint="Senders can’t see when or where you read their email."
              />
              <small className="set-hint">Your team’s internal email is never tracked. If you email people in the EU, mention tracking in your privacy policy.</small>

              <h3>Blocked senders</h3>
              {blocked.length === 0 ? (
                <small className="set-hint" style={{ marginTop: 0 }}>
                  Nobody yet. Use “Block” on any email to stop a sender for good.
                </small>
              ) : (
                <div className="acct-list">
                  {blocked.map((b) => (
                    <div key={b.id} className="acct-row">
                      <span className="acct-icon blocked">
                        <Ban size={15} />
                      </span>
                      <span className="acct-info">
                        <strong>{b.kind === 'domain' ? `Everyone at @${b.value}` : b.value}</strong>
                        <small>Blocked {new Date(b.at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} · deleted on arrival</small>
                      </span>
                      <button className="ghost-btn outline sm" onClick={() => onUnblock(b.id)}>
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {section === 'notifications' && (
            <>
              <h2>Notifications</h2>
              <p className="set-intro">Choose what deserves your attention.</p>
              <Toggle on={s.notifyNewMail} onChange={(v) => update({ notifyNewMail: v })} label="New email" hint="Show a notification when mail arrives." />
              <Toggle on={s.notifyEvents} onChange={(v) => update({ notifyEvents: v })} label="Event reminders" hint="10 minutes before a calendar event." />
              <Toggle on={s.notifySound} onChange={(v) => update({ notifySound: v })} label="Sound" hint="Play a soft chime with notifications." />
            </>
          )}

          {section === 'shortcuts' && (
            <>
              <h2>Keyboard shortcuts</h2>
              <p className="set-intro">Fly through your inbox without touching the mouse.</p>
              <div className="shortcut-list">
                {SHORTCUTS.map(([label, keys]) => (
                  <div key={label} className="shortcut">
                    <span>{label}</span>
                    <span>
                      {keys.map((k) => (k.includes(' ') ? <small key={k}>{k}</small> : <kbd key={k}>{k}</kbd>))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {section === 'storage' && (
            <>
              <h2>Storage</h2>
              <p className="set-intro">
                {fmtSize(used)} of {fmtSize(usage.quota)} used
              </p>
              <div className="stack-bar">
                <span style={{ width: pct(usage.mail), background: 'var(--accent)' }} />
                <span style={{ width: pct(usage.drive - usage.media), background: '#10b981' }} />
                <span style={{ width: pct(usage.media), background: '#f59e0b' }} />
              </div>
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--accent)' }} /> Mail · {fmtSize(usage.mail)}
                </span>
                <span>
                  <i style={{ background: '#10b981' }} /> Files · {fmtSize(usage.drive - usage.media)}
                </span>
                <span>
                  <i style={{ background: '#f59e0b' }} /> Photos & videos · {fmtSize(usage.media)}
                </span>
              </div>
              <small className="set-hint">Everything is stored on your own server, so there are no per-GB fees.</small>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
