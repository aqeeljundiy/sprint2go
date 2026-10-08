import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { term, brand as product } from '../terms';
import { Handshake, Ban, Bell, Building2, ChevronDown, Columns3, CreditCard, HardDrive, KeyRound, KeySquare, Stamp, LayoutGrid, UserPlus, Inbox, Plus, Sparkles, Trash2, Users, Keyboard, Menu, Palette, PenLine, ShieldCheck, UserRound, Video, type LucideIcon, FlaskConical, Send, LifeBuoy } from 'lucide-react';
import { ACCENTS, type Settings } from '../settings';
import { DEFAULT_PERMISSIONS } from '../types';
import type { AISettings, AppId, BlockRule, DriveItem, HomeTemplateId, MeetingSettings, Plan, Role, StorageSettings, Team, Todo, User, Workspace } from '../types';
import { TaskStagesSection } from './admin/TaskStages';
import { AISection } from './admin/AISection';
import { BillingSection } from './admin/BillingSection';
import { AppsSection, MyAppsSection, MeetingsSection, PermissionsSection, SecuritySection, StorageSection, TeamsLink } from './admin/AdminMore';
import { trialPlan } from '../data/workspaces';
import { Avatar } from './Avatar';
import { BrandFields } from './WorkspaceForms';
import { WorkspaceLogo } from './WorkspaceLogo';
import type { SettingsSection } from './AccountMenu';
import { RichEditor } from './RichEditor';
import { PhotoPicker } from './PhotoPicker';
import { ClientAccessForm } from './admin/ClientAccessForm';
import { accessFor } from '../clientView';
import { Select } from './ui/Select';
import { changePassword, server } from '../sync';
import { EmailSetupGuide, providerLabel } from './EmailSetupGuide';
import { caps } from '../caps';
import { relative } from '../utils';
import { PROJECT_TYPES } from '../terms';
import { AgencySection } from './admin/AgencySection';
import { EmailDeliverySection } from './admin/EmailDelivery';
import { HelpSection } from './HelpSection';

const SECTIONS: { id: SettingsSection; name: string; icon: LucideIcon; group: 'Company' | 'You' }[] = [
  { id: 'workspace', name: 'General & email', icon: Building2, group: 'Company' },
  { id: 'email', name: 'Email delivery', icon: Send, group: 'Company' },
  { id: 'permissions', name: 'Permissions', icon: KeySquare, group: 'Company' },
  { id: 'agency', name: 'Client portal & brand', icon: Stamp, group: 'Company' },
  { id: 'teams', name: 'Teams', icon: Users, group: 'Company' },
  { id: 'stages', name: 'Task stages', icon: Columns3, group: 'Company' },
  { id: 'clients', get name() { return `${term.Who} access`; }, icon: Handshake, group: 'Company' },
  { id: 'apps', name: 'Apps & chat', icon: LayoutGrid, group: 'Company' },
  { id: 'meetings', name: 'Meetings', icon: Video, group: 'Company' },
  { id: 'ai', name: 'AI', icon: Sparkles, group: 'Company' },
  { id: 'billing', name: 'Plan & billing', icon: CreditCard, group: 'Company' },
  { id: 'storage', name: 'Storage', icon: HardDrive, group: 'Company' },
  { id: 'security', name: 'Security & data', icon: ShieldCheck, group: 'Company' },
  { id: 'account', name: 'Account', icon: UserRound, group: 'You' },
  { id: 'appearance', name: 'Appearance', icon: Palette, group: 'You' },
  { id: 'myapps', name: 'Your apps', icon: LayoutGrid, group: 'You' },
  { id: 'mail', name: 'Mail & signature', icon: PenLine, group: 'You' },
  { id: 'notifications', name: 'Notifications', icon: Bell, group: 'You' },
  { id: 'help', name: 'Help & support', icon: LifeBuoy, group: 'You' },
  { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard, group: 'You' },
  { id: 'developer', name: 'Developer', icon: FlaskConical, group: 'You' },
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
  ['Tasks: new task', ['N']],
  ['Calendar: today', ['T']],
  ['Calendar: day / week / month', ['D', 'W', 'M']],
];

interface Props {
  email: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  usage?: { mail: number; drive: number; media: number; quota: number };
  onMenu: () => void;
  workspace: Workspace;
  onWorkspace: (p: Partial<Workspace>) => void;
  onAddAccount: () => void;
  onRemoveAccount: (id: string) => void;
  users: User[];
  me: string; // current user id
  onPhoto?: (photo: string | undefined) => void;
  onPreviewOnboarding?: () => void;
  myApps?: { hidden: AppId[]; asked: AppId[]; onHidden: (l: AppId[]) => void; onAsk: (id: AppId) => void };
  myRole: Role;
  onInvite: () => void;
  onRole: (userId: string, role: Role) => void;
  onRemoveMember: (userId: string) => void;
  onAccess: (accountId: string, users: string[]) => void;
  blocked: BlockRule[];
  onUnblock: (id: string) => void;
  admin: {
    people: number;
    teams: Team[];
    drive: DriveItem[];
    byChannel: { name: string; size: number }[];
    onTeams: (t: Team[]) => void;
    onOpenTeams: (id?: string) => void;
    onTeamHome: (teamId: string, t: HomeTemplateId) => void;
    onAI: (a: AISettings) => void;
    onPlan: (p: Plan) => void;
    onMeetings: (m: MeetingSettings) => void;
    onStorage: (s: StorageSettings) => void;
    onExport: () => void;
    onDelete: () => void;
    toast: (t: string) => void;
    tasks: Todo[]; // the company's tasks, for Task stages (where a removed stage's tasks go)
    onMoveTasks: (moves: { id: string; patch: Partial<Todo> }[]) => void;
  };
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

export function SettingsPage({ email, settings: s, update, section, onSection, onMenu, workspace: ws, onWorkspace, onAddAccount, onRemoveAccount, users, me, onPhoto, onPreviewOnboarding, myApps, myRole, onInvite, onRole, onRemoveMember, onAccess, blocked, onUnblock, admin }: Props) {
  const wsUsers = users.filter((u) => ws.members.some((m) => m.userId === u.id));
  const plan = ws.plan ?? trialPlan(ws.name, email);
  const [accessOpen, setAccessOpen] = useState<string | null>(null);
  const [routingGuide, setRoutingGuide] = useState(false);
  const [accessType, setAccessType] = useState(''); // Guest access: '' = every project, or one project type
  const canManage = myRole !== 'member';
  const realMail = server.on && !caps.demo; // a real server, not the standalone demo
  const perms = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  // Members see the company's money (plan, billing, AI costs) only when the company allows it.
  const sections = SECTIONS.filter((x) => (canManage || perms.seeBilling || (x.id !== 'billing' && x.id !== 'ai' && x.id !== 'storage')));
  const nameOf = (id: string) => (id === me ? 'You' : users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'Someone');

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
          {sections.map(({ id, name, icon: Icon, group }, i) => (
            <span key={id} className="settings-nav-item">
              {(i === 0 || sections[i - 1].group !== group) && <span className="settings-group">{group === 'Company' ? ws.name || 'Company' : 'You'}</span>}
              <button className={section === id ? 'on' : ''} onClick={() => onSection(id)}>
                <Icon size={16} /> {name}
              </button>
            </span>
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
              <div className="field">
                <label>What you call your work</label>
                <Select<'project' | 'client'>
                  value={ws.terms?.word ?? 'project'}
                  onChange={(v) => onWorkspace({ terms: { word: v } })}
                  label="What you call your work"
                  options={[
                    { value: 'project', label: 'Projects', hint: 'Any kind of work: clients, partners, internal' },
                    { value: 'client', label: 'Clients', hint: 'For agencies that work for clients' },
                  ]}
                />
                <small>Changes the word everywhere in the app. With Projects, the people you invite are called guests.</small>
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

              {ws.emailSetup === 'mix' && (
                <>
                  <h3>Mail routing</h3>
                  <div className="set-block routing-block">
                    <p className="small">
                      {ws.domains[0] ?? 'Your domain'} stays with {providerLabel(ws.emailProvider)}, which passes mail for addresses it doesn’t know on to {product.name}.{' '}
                      {ws.mailRouting?.lastCheck
                        ? ws.mailRouting.lastCheck.ok
                          ? `Last check ${relative(ws.mailRouting.lastCheck.at)}: working.`
                          : `Last check ${relative(ws.mailRouting.lastCheck.at)}: the test didn’t arrive. Check the routing rule.`
                        : ws.mailRouting?.verifiedAt
                          ? `Checked ${relative(ws.mailRouting.verifiedAt)} during setup.`
                          : `Not checked yet: mail to ${product.name} mailboxes may not arrive.`}
                    </p>
                    {/* The server sends a real test each day when it can send mail (caps.routingCheck); the demo plays it. */}
                    {(!realMail || caps.routingCheck) && (
                      <Toggle
                        on={ws.mailRouting?.dailyCheck ?? true}
                        onChange={(v) => canManage && onWorkspace({ mailRouting: { ...(ws.mailRouting ?? {}), dailyCheck: v } })}
                        label="Check every day"
                        hint={
                          realMail
                            ? `Once a day we send a test to an address at ${ws.domains[0] ?? 'your domain'} that only ${product.name} knows. If two tests in a row don’t arrive, admins get a notice and an email.${ws.mailRouting?.verifiedAt ? '' : ' It starts once routing has worked.'}`
                            : `A test email each morning. If it stops arriving, admins hear about it straight away. Runs once ${product.name} mail is live.`
                        }
                      />
                    )}
                    <button type="button" className="link-btn small" onClick={() => setRoutingGuide((x) => !x)}>
                      {routingGuide ? 'Hide the setup steps' : 'Show the setup steps'}
                    </button>
                    <div className={`fold ${routingGuide ? 'open' : ''}`}>
                      <div className="fold-in">
                        <SmoothHeight>
                          <EmailSetupGuide
                            workspaceId={ws.id}
                            mode="split"
                            provider={ws.emailProvider ?? 'google'}
                            domain={ws.domains[0] ?? ''}
                            first={(users.find((u) => u.id === me)?.name ?? '').split(' ')[0].toLowerCase()}
                            onAddMailbox={canManage ? onAddAccount : undefined}
                            onVerified={() => onWorkspace({ mailRouting: { ...(ws.mailRouting ?? { dailyCheck: true }), verifiedAt: new Date().toISOString(), lastCheck: { at: new Date().toISOString(), ok: true } } })}
                          />
                        </SmoothHeight>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <h3>Email accounts</h3>
              <div className="acct-list">
                {ws.accounts.filter((a) => !a.temp).map((a) => (
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
                  <SmoothHeight>
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
                  </SmoothHeight>
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
                <PhotoPicker name={s.name} email={email} color={s.avatarColor} photo={users.find((u) => u.id === me)?.photo} onChange={(ph) => onPhoto?.(ph)} />
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
              <PasswordRow />
              <DeleteAccountRow />
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

          {section === 'developer' && (
            <>
              <h2>Developer</h2>
              <p className="set-intro">Walk through flows that can’t run for real yet. Nothing here changes your data.</p>
              <div className="set-row">
                <span>
                  <strong>Sign-up and onboarding</strong>
                  <small>Account, company, apps, email (forward from Gmail or Outlook, or move fully) and team. Waits like Gmail’s code and the DNS check are simulated.</small>
                </span>
                <button className="ghost-btn outline" onClick={onPreviewOnboarding}>
                  Open preview
                </button>
              </div>
              <div className="set-row">
                <span>
                  <strong>Link to the preview</strong>
                  <small className="mono">{location.origin}/?preview=onboarding</small>
                </span>
              </div>
            </>
          )}

          {section === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <p className="set-intro">Make {product.name} feel like yours.</p>
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

          {section === 'storage' && sections.some((x) => x.id === 'storage') && <StorageSection ws={ws} people={admin.people} plan={plan} drive={admin.drive} byChannel={admin.byChannel} users={wsUsers} canManage={canManage} onStorage={admin.onStorage} onBilling={() => onSection('billing')} toast={admin.toast} />}
          {section === 'clients' && (
            <>
              <h2>{term.Who} access</h2>
              <p className="set-intro">What your clients see and can do when they sign in to their portal. You can change any of these for one client on its client page (Portal tab).</p>
              <div className="access-types">
                <span className="muted small">Settings for</span>
                <div className="segmented sm">
                  {['', ...PROJECT_TYPES].map((tp) => (
                    <button key={tp || 'all'} type="button" className={accessType === tp ? 'on' : ''} onClick={() => setAccessType(tp)}>
                      {tp ? `${tp}${ws.clientAccessByType?.[tp] && Object.keys(ws.clientAccessByType[tp]).length ? ' •' : ''}` : `Every ${term.one}`}
                    </button>
                  ))}
                </div>
              </div>
              {accessType && (
                <p className="muted small">
                  Changes here apply to {term.many} of the type {accessType}, on top of the settings for every {term.one}.{' '}
                  {ws.clientAccessByType?.[accessType] && Object.keys(ws.clientAccessByType[accessType]).length > 0 && canManage && (
                    <button type="button" className="link-btn small" onClick={() => onWorkspace({ clientAccessByType: { ...ws.clientAccessByType, [accessType]: {} } })}>
                      Use the settings for every {term.one}
                    </button>
                  )}
                </p>
              )}
              <ClientAccessForm
                key={accessType || 'all'}
                value={accessFor(ws, { type: accessType || undefined })}
                teams={admin.teams.filter((t) => t.workspaceId === ws.id)}
                canManage={canManage}
                brandingAvailable={!!plan.addons.branding}
                onChange={(p) =>
                  accessType
                    ? onWorkspace({ clientAccessByType: { ...ws.clientAccessByType, [accessType]: { ...(ws.clientAccessByType?.[accessType] ?? {}), ...p } } })
                    : onWorkspace({ clientAccess: { ...accessFor(ws, {}), ...p } })
                }
              />
              <p className="muted small">{term.Whos} never see Mail, Calendar, Drive, your team’s channels, internal comments or other {term.many}. To check, open a {term.one}’s page and choose “View as guest”.</p>
            </>
          )}
          {section === 'help' && <HelpSection workspaceId={ws.id} toast={admin.toast} />}
          {section === 'email' && (
            <EmailDeliverySection
              ws={ws}
              canManage={canManage}
              firstName={users.find((u) => u.id === me)?.name.split(' ')[0] ?? 'you'}
              myEmail={ws.accounts.find((a) => !a.temp && a.kind === 'personal' && a.users.includes(me))?.email}
              onWorkspace={onWorkspace}
              onAddAccount={canManage ? onAddAccount : undefined}
              toast={admin.toast}
            />
          )}
          {section === 'agency' && <AgencySection ws={ws} canManage={canManage} onWorkspace={onWorkspace} brandingAddon={!!plan.addons.branding} onBilling={() => onSection('billing')} />}
          {section === 'permissions' && <PermissionsSection ws={ws} canManage={canManage} onWorkspace={onWorkspace} />}
          {section === 'teams' && <TeamsLink teams={admin.teams} users={wsUsers} onOpen={admin.onOpenTeams} />}
          {section === 'stages' && <TaskStagesSection ws={ws} canManage={canManage} tasks={admin.tasks} teams={admin.teams} me={me} onWorkspace={onWorkspace} onMoveTasks={admin.onMoveTasks} />}
          {section === 'apps' && <AppsSection ws={ws} canManage={canManage} onWorkspace={onWorkspace} />}
          {section === 'myapps' && myApps && (
            <MyAppsSection
              ws={ws}
              hidden={myApps.hidden}
              isAdmin={canManage}
              asked={myApps.asked}
              onHidden={myApps.onHidden}
              onAsk={myApps.onAsk}
              onCompanyApp={(id) => onWorkspace({ apps: [...(ws.apps ?? []), id] })}
            />
          )}
          {section === 'meetings' && <MeetingsSection ws={ws} canManage={canManage} onMeetings={admin.onMeetings} />}
          {!sections.some((x) => x.id === section) && <p className="muted">Ask an admin about this.</p>}
          {section === 'ai' && sections.some((x) => x.id === 'ai') && <AISection ws={ws} people={admin.people} users={wsUsers} me={me} canManage={canManage} onAI={admin.onAI} onBilling={() => onSection('billing')} toast={admin.toast} />}
          {section === 'billing' && sections.some((x) => x.id === 'billing') && <BillingSection ws={ws} people={admin.people} isOwner={myRole === 'owner'} onPlan={admin.onPlan} onExport={admin.onExport} toast={admin.toast} />}
          {section === 'security' && <SecuritySection ws={ws} isOwner={myRole === 'owner'} onWorkspace={onWorkspace} onExport={admin.onExport} onDelete={admin.onDelete} users={wsUsers} />}
        </div>
      </div>
    </section>
  );
}

/** Change your sign-in password (the local server checks it). */
export function PasswordRow() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    const err = await changePassword(cur, next);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Password changed.' });
    if (!err) (setOpen(false), setCur(''), setNext(''));
  };
  return (
    <>
      <div className="set-row">
        <span>
          <strong>Password</strong>
          <small>{server.on ? (msg?.ok ? msg.text : `Used to sign in to ${product.name}.`) : 'Passwords are checked when the local server runs.'}</small>
        </span>
        <button className="ghost-btn outline" disabled={!server.on} onClick={() => (setOpen((o) => !o), setMsg(null))}>
          Change password
        </button>
      </div>
      <SmoothHeight>
      {open && (
        <div className="pw-form">
          <div className="field">
            <label>Current password</label>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
          </div>
          {msg && !msg.ok && <p className="err">{msg.text}</p>}
          <button className="primary-btn sm" disabled={!cur || next.length < 8} onClick={() => void save()}>
            Save new password
          </button>
        </div>
      )}
      </SmoothHeight>
    </>
  );
}

/** Deleting the account: the sign-in goes, work stays with its company. The only owner of a company must hand over first. */
function DeleteAccountRow() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!confirm('Delete your account? This can’t be undone. Your tasks, messages and files stay with your company.')) return;
    setBusy(true);
    const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) return setMsg(d.error ?? 'Couldn’t delete the account.');
    location.href = '/';
  };
  if (!server.on) return null;
  return (
    <div className="danger-zone">
      <div className="set-row">
        <span>
          <strong>Delete your account</strong>
          <small>Your sign-in goes for good. What you made stays with the company, marked as a deleted account.</small>
        </span>
        <button type="button" className="ghost-btn sm danger" onClick={() => setOpen((x) => !x)}>
          {open ? 'Cancel' : 'Delete…'}
        </button>
      </div>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in pw-form">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password, to be sure it’s you" autoComplete="current-password" />
          {msg && <p className="err small">{msg}</p>}
          <button type="button" className="primary-btn sm danger" disabled={!pw || busy} onClick={() => void go()}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
