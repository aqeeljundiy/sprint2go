import { useEffect, useState, type ReactNode } from 'react';
import { SmoothHeight, useLeaving } from './ui/Smooth';
import { PushScreen } from './ui/PushScreen';
import { usePhone } from '../mobile/media';
import { doneSettingsList, takeSettingsList } from './settingsList';
import { term, brand as product } from '../terms';
import { Handshake, Ban, Bell, Building2, ChevronDown, ChevronRight, Columns3, CreditCard, HardDrive, KeyRound, KeySquare, Stamp, LayoutGrid, UserPlus, Inbox, Plus, Sparkles, Trash2, Users, Keyboard, Menu, Palette, PenLine, ShieldCheck, UserRound, Video, type LucideIcon, FlaskConical, Send, LifeBuoy, FolderInput } from 'lucide-react';
import { ACCENTS, type Settings } from '../settings';
import { DEFAULT_PERMISSIONS } from '../types';
import type { AISettings, AppId, BlockRule, CalendarDef, DriveItem, HomeTemplateId, MeetingSettings, Plan, Role, StorageSettings, Team, Todo, User, Workspace } from '../types';
import { TaskStagesSection } from './admin/TaskStages';
import { HOLIDAY_COUNTRIES } from '../data/holidays';
import { AISection } from './admin/AISection';
import { BillingSection } from './admin/BillingSection';
import { AppsSection, MyAppsSection, MeetingsSection, PermissionsSection, SecuritySection, StorageSection, TeamsLink } from './admin/AdminMore';
import { trialPlan } from '../data/workspaces';
import { Badge, PersonCell } from './ui/Person';
import { BrandFields } from './WorkspaceForms';
import { WorkspaceLogo } from './WorkspaceLogo';
import type { SettingsSection } from './AccountMenu';
import { RichEditor } from './RichEditor';
import { PhotoPicker } from './PhotoPicker';
import { ClientAccessForm } from './admin/ClientAccessForm';
import { accessFor } from '../clientView';
import { Select } from './ui/Select';
import { zoneOptions } from './ui/zones';
import { SUMMARY_HOUR, companyTz } from '../jobTimes';
import { changePassword, server } from '../sync';
import { EmailSetupGuide, providerLabel } from './EmailSetupGuide';
import { caps } from '../caps';
import { hasBranding } from '../data/pricing';
import { relative } from '../utils';
import { PROJECT_TYPES } from '../terms';
import { AgencySection } from './admin/AgencySection';
import { EmailDeliverySection } from './admin/EmailDelivery';
import { HelpSection } from './HelpSection';
import { NotificationSettings } from './NotificationSettings';
import { TwoStepRow } from './TwoStep';
import { DemoCompanyBlock, type DemoSettings } from './DemoCompany';
import { ConnectedApps } from './ConnectedApps';
import { ImportSection } from './imports/ImportSection';
import { BarDefaults } from '../mobile/BarDefaults';
import { MAIL_APPS_SECTION, PhoneMailApps } from './PhoneMailApps';
import { LANGS, getLang, mark, t, tn, type Lang, tx } from '../i18n';
import { fmtDate, fmtTime } from '../i18n/format';

const SECTIONS: { id: SettingsSection; name: string; icon: LucideIcon; group: 'Company' | 'You' }[] = [
  { id: 'workspace', name: mark('General & email'), icon: Building2, group: 'Company' },
  { id: 'email', name: mark('Email delivery'), icon: Send, group: 'Company' },
  { id: 'permissions', name: mark('Permissions'), icon: KeySquare, group: 'Company' },
  { id: 'agency', name: mark('Client portal & brand'), icon: Stamp, group: 'Company' },
  { id: 'teams', name: mark('Teams'), icon: Users, group: 'Company' },
  { id: 'stages', name: mark('Task stages'), icon: Columns3, group: 'Company' },
  { id: 'clients', get name() { return t('{Who} access', { who: term.who }); }, icon: Handshake, group: 'Company' },
  { id: 'apps', name: mark('Apps & chat'), icon: LayoutGrid, group: 'Company' },
  { id: 'meetings', name: mark('Meetings'), icon: Video, group: 'Company' },
  { id: 'ai', name: mark('AI'), icon: Sparkles, group: 'Company' },
  { id: 'billing', name: mark('Plan & billing'), icon: CreditCard, group: 'Company' },
  { id: 'storage', name: mark('Storage'), icon: HardDrive, group: 'Company' },
  { id: 'security', name: mark('Security & data'), icon: ShieldCheck, group: 'Company' },
  { id: 'import', name: mark('Import'), icon: FolderInput, group: 'Company' },
  { id: 'account', name: mark('Account'), icon: UserRound, group: 'You' },
  { id: 'appearance', name: mark('Appearance'), icon: Palette, group: 'You' },
  { id: 'myapps', name: mark('Your apps'), icon: LayoutGrid, group: 'You' },
  { id: 'mail', name: mark('Mail & signature'), icon: PenLine, group: 'You' },
  MAIL_APPS_SECTION,
  { id: 'notifications', name: mark('Notifications'), icon: Bell, group: 'You' },
  { id: 'help', name: mark('Help & support'), icon: LifeBuoy, group: 'You' },
  { id: 'shortcuts', name: mark('Shortcuts'), icon: Keyboard, group: 'You' },
  { id: 'developer', name: mark('Developer'), icon: FlaskConical, group: 'You' },
];


/** Settings the demo company leaves out: they reach the real world (billing, AI keys, mail delivery, brand, security). */
const DEMO_OUT: SettingsSection[] = ['email', 'agency', 'ai', 'billing', 'storage', 'security', 'import', 'mailapps'];

const SHORTCUTS: [string, string[]][] = [
  [mark('Compose'), ['C']],
  [mark('Search'), ['/']],
  [mark('Next / previous conversation'), ['J', 'K']],
  [mark('Reply'), ['R']],
  [mark('Archive'), ['E']],
  [mark('Delete'), ['#']],
  [mark('Star'), ['S']],
  [mark('Mark unread'), ['U']],
  [mark('Send'), ['⌘', '↵']],
  [mark('Collapse sidebar'), ['[']],
  [mark('Switch workspace'), ['⌥', '1–9']],
  [mark('Search everything'), ['⌘', 'K']],
  [mark('Ask AI'), ['⌘', 'J']],
  [mark('Go to Home / Mail / Chat / Tasks'), ['G', mark('then H / M / C / T')]],
  [mark('Go to Calendar / Drive / Meet'), ['G', mark('then L / D / E')]],
  [mark('Tasks: new task'), ['N']],
  [mark('Calendar: today'), ['T']],
  [mark('Calendar: day / week / month'), ['D', 'W', 'M']],
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
  /** Public holidays in everyone's calendar: a country, or none. */
  onHolidays: (country: string | null) => void;
  holidayCal?: CalendarDef; // the company's holiday calendar, for whether it's keeping up
  onAddAccount: () => void;
  onRemoveAccount: (id: string) => void;
  mailExtras?: React.ReactNode; // Mail & signature: out of office for your mailboxes
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
    projects: { id: string; name: string; color: string }[]; // for "Keep everything for these projects" (chat history)
    onMoveTasks: (moves: { id: string; patch: Partial<Todo> }[]) => void;
  };
  /** Their own demo company: Help & support and Your apps bring it back; inside it, money, keys and mail setup stay out. */
  demo?: DemoSettings;
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

/** A role as people read it (the value stays 'member', 'admin' or 'owner'). */
const roleName = (r: Role) => (r === 'owner' ? t('Owner') : r === 'admin' ? t('Admin') : t('Member'));

/**
 * Phones: Settings is a list of sections, grouped like the desktop's (the company, then you). Each opens full screen over
 * the list with Back. Keyboard shortcuts stay a desktop thing.
 */
function SettingsList({ sections, company, onOpen }: { sections: typeof SECTIONS; company: string; onOpen: (id: SettingsSection) => void }) {
  const shown = sections.filter((x) => x.id !== 'shortcuts');
  return (
    <div className="set-list">
      {(['Company', 'You'] as const).map((g) => {
        const rows = shown.filter((x) => x.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} className="set-list-group" aria-label={g === 'Company' ? company : t('You')}>
            <h2 className="set-list-head">{g === 'Company' ? company : t('You')}</h2>
            <div className="set-list-card">
              {rows.map(({ id, name, icon: Icon }) => (
                <button key={id} type="button" className="set-list-row" onClick={() => onOpen(id)}>
                  <span className="set-list-icon">
                    <Icon size={17} />
                  </span>
                  <span className="set-list-name">{t(name)}</span>
                  <ChevronRight size={18} className="set-list-chev" />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One section: in place on desktop; on phones, full screen over the list while it's open. */
function SectionScreen({ phone, open, title, onBack, children }: { phone: boolean; open: boolean; title: string; onBack: () => void; children: ReactNode }) {
  if (!phone) return <>{children}</>;
  return open ? (
    <PushScreen title={title} backLabel={t('Settings')} onBack={onBack} className="settings-push">
      {children}
    </PushScreen>
  ) : null;
}

export function SettingsPage({ email, settings: s, update, section, onSection, onMenu, workspace: ws, onWorkspace, onHolidays, holidayCal, onAddAccount, onRemoveAccount, mailExtras, users, me, onPhoto, onPreviewOnboarding, myApps, myRole, onInvite, onRole, onRemoveMember, onAccess, blocked, onUnblock, admin, demo, embedded }: Props & { embedded?: boolean }) {
  // Phones: the list of sections, and the one open over it (Settings opened for one section starts on it).
  const onPhone = usePhone();
  const phone = onPhone && !embedded;
  const [sectionOpen, setSectionOpen] = useState(() => !embedded && !takeSettingsList());
  useEffect(() => void (!embedded && doneSettingsList()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const wsUsers = users.filter((u) => ws.members.some((m) => m.userId === u.id));
  const plan = ws.plan ?? trialPlan(ws.name, email);
  const [accessOpen, setAccessOpen] = useState<string | null>(null);
  const [routingGuide, setRoutingGuide] = useState(false);
  const [accessType, setAccessType] = useState(''); // Guest access: '' = every project, or one project type
  // A removed member or mailbox folds away instead of vanishing (the remove happens in a dialog or in App).
  const memberRows = useLeaving(ws.members, (m) => m.userId);
  const accountRows = useLeaving(ws.accounts.filter((a) => !a.temp), (a) => a.id);
  const canManage = myRole !== 'member';
  const realMail = server.on && !caps.demo; // a real server, not the standalone demo
  const perms = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  // Members see the company's money (plan, billing, AI costs) only when the company allows it.
  // The demo company has no money, keys, mail delivery or sign-in rules of its own: those are the real company's.
  const sections = SECTIONS.filter((x) => (canManage || perms.seeBilling || (x.id !== 'billing' && x.id !== 'ai' && x.id !== 'storage')) && (canManage || x.id !== 'import') && !(demo?.inDemo && DEMO_OUT.includes(x.id)));
  const nameOf = (id: string) => (id === me ? t('You') : users.find((u) => u.id === id)?.name.split(' ')[0] ?? t('Someone'));

  return (
    <section className={`settings-pane view-enter${embedded ? ' embedded' : ''}`}>
      <header className="settings-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <h1>{t('Settings')}</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {sections.map(({ id, name, icon: Icon, group }, i) => (
            <span key={id} className="settings-nav-item">
              {(i === 0 || sections[i - 1].group !== group) && <span className="settings-group">{group === 'Company' ? ws.name || t('Company') : t('You')}</span>}
              <button className={section === id ? 'on' : ''} onClick={() => onSection(id)}>
                <Icon size={16} /> {t(name)}
              </button>
            </span>
          ))}
        </nav>
        {phone && <SettingsList sections={sections} company={ws.name || t('Company')} onOpen={(id) => (onSection(id), setSectionOpen(true))} />}

        <SectionScreen phone={phone} open={sectionOpen} title={t(SECTIONS.find((x) => x.id === section)?.name ?? 'Settings')} onBack={() => setSectionOpen(false)}>
        <div className="settings-content" key={section}>
          {section === 'workspace' && (
            <>
              <h2>{t('Workspace')}</h2>
              <p className="set-intro">
                {demo?.inDemo ? t('This is your demo company: change anything here, nothing leaves it. Billing, AI keys, mail delivery and security are set in your real company.') : t('Each business gets its own brand, email accounts, calendar and drive.')}
              </p>
              <div className="ws-preview">
                <WorkspaceLogo ws={ws} size={44} />
                <div>
                  <strong>{ws.name || t('Untitled')}</strong>
                  <small>{ws.domains.join(', ') || t('No domain yet')}</small>
                </div>
                <span className="ws-preview-btn" style={{ background: ws.color }}>
                  {t('Compose')}
                </span>
              </div>
              {!canManage && <p className="modal-note">{t('Only owners and admins can change workspace settings.')}</p>}
              <fieldset className="plain" disabled={!canManage}>
              <div className="field">
                <label>{t('Business name')}</label>
                <input value={ws.name} onChange={(e) => onWorkspace({ name: e.target.value })} />
              </div>
              <BrandFields value={ws} onChange={onWorkspace} />
              <div className="field">
                <label>{t('Email domains')}</label>
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
                  placeholder={t('business.com')}
                />
                <small>{t('People at these domains are your team, so their email is never tracked.')}</small>
              </div>
              <div className="field">
                <label>{t('What you call your work')}</label>
                <Select<'project' | 'client'>
                  value={ws.terms?.word ?? 'project'}
                  onChange={(v) => onWorkspace({ terms: { word: v } })}
                  label={t('What you call your work')}
                  options={[
                    { value: 'project', label: t('Projects'), hint: t('Any kind of work: clients, partners, internal') },
                    { value: 'client', label: t('Clients'), hint: t('For agencies that work for clients') },
                  ]}
                />
                <small>{t('Changes the word everywhere in the app. With Projects, the people you invite are called guests.')}</small>
              </div>
              <div className="field">
                <label>{t('Public holidays')}</label>
                <Select
                  value={ws.holidays?.country ?? ''}
                  onChange={(v) => onHolidays(v || null)}
                  label={t('Public holidays')}
                  searchable
                  options={[{ value: '', label: t('Don’t show holidays') }, ...HOLIDAY_COUNTRIES.map((c) => ({ value: c.code, label: t(c.name) }))]}
                />
                <small>
                  {!ws.holidays
                    ? t('Show your country’s public holidays as all-day items in everyone’s calendar here. Tasks due on a holiday get a note.')
                    : holidayCal?.error
                      ? holidayCal.syncedAt
                        ? t('Couldn’t update them: {error} The list from {when} still shows.', { error: t(holidayCal.error), when: relative(holidayCal.syncedAt) })
                        : t('Couldn’t update them: {error}', { error: t(holidayCal.error) })
                      : holidayCal?.syncedAt
                        ? t('In everyone’s calendar, and a note on tasks due that day. Checked {when}.', { when: relative(holidayCal.syncedAt) })
                        : t('Adding them to everyone’s calendar…')}
                </small>
              </div>
              <div className="field">
                <label>{t('Time zone')}</label>
                <Select value={companyTz(ws)} onChange={(v) => onWorkspace({ timeZone: v })} label={t('Time zone')} searchable options={zoneOptions(companyTz(ws))} />
                <small>{t('Scheduled channel summaries are written at {time} here. Email digests use it for anyone whose own time zone isn’t known yet.', { time: fmtTime(new Date(2000, 0, 1, SUMMARY_HOUR)) })}</small>
              </div>
              <div className="field">
                <label>{t('Language')}</label>
                <Select<'' | Lang>
                  value={ws.language ?? ''}
                  onChange={(v) => onWorkspace({ language: v || undefined })}
                  label={t('Language')}
                  options={[{ value: '', label: t('Each person’s browser') }, ...LANGS.map((l) => ({ value: l.id, label: l.name }))]}
                />
                <small>{t('For new members and anyone who hasn’t picked their own language in Settings, Account.')}</small>
              </div>
              </fieldset>

              <h3>{t('Members')}</h3>
              <div className="acct-list">
                {memberRows.map(({ item: m, leaving }) => {
                  const u = users.find((x) => x.id === m.userId);
                  if (!u) return null;
                  const owners = ws.members.filter((x) => x.role === 'owner').length;
                  return (
                    <div key={m.userId} className={`acct-row${leaving ? ' row-leaving' : ''}`}>
                      <PersonCell person={u} badges={m.userId === me && <Badge tone="accent">{t('You')}</Badge>} />
                      {canManage && m.userId !== me && !(m.role === 'owner' && owners === 1) ? (
                        <Select<Role>
                          value={m.role}
                          onChange={(v) => onRole(m.userId, v)}
                          label={t('Role')}
                          className="role-select"
                          options={[
                            { value: 'member', label: t('Member'), hint: t('Uses the apps') },
                            { value: 'admin', label: t('Admin'), hint: t('Manages people, apps and settings') },
                            { value: 'owner', label: t('Owner'), hint: t('Everything, including billing') },
                          ]}
                        />
                      ) : (
                        <span className="role-tag">{roleName(m.role)}</span>
                      )}
                      {canManage && m.userId !== me && m.role !== 'owner' && (
                        <button className="icon-btn sm" title={t('Remove from workspace')} onClick={() => onRemoveMember(m.userId)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {canManage && (
                  <button className="acct-add" onClick={onInvite}>
                    <UserPlus size={16} /> {t('Invite someone')}
                  </button>
                )}
              </div>

              {ws.emailSetup === 'mix' && !demo?.inDemo && (
                <>
                  <h3>{t('Mail routing')}</h3>
                  <div className="set-block routing-block">
                    <p className="small">
                      {t('{domain} stays with {provider}, which passes mail for addresses it doesn’t know on to {product}.', { domain: ws.domains[0] ?? t('Your domain'), provider: providerLabel(ws.emailProvider), product: product.name })}{' '}
                      {ws.mailRouting?.lastCheck
                        ? ws.mailRouting.lastCheck.ok
                          ? t('Last check {when}: working.', { when: relative(ws.mailRouting.lastCheck.at) })
                          : t('Last check {when}: the test didn’t arrive. Check the routing rule.', { when: relative(ws.mailRouting.lastCheck.at) })
                        : ws.mailRouting?.verifiedAt
                          ? t('Checked {when} during setup.', { when: relative(ws.mailRouting.verifiedAt) })
                          : t('Not checked yet: mail to {product} mailboxes may not arrive.', { product: product.name })}
                    </p>
                    {/* The server sends a real test each day when it can send mail (caps.routingCheck); the demo plays it. */}
                    {(!realMail || caps.routingCheck) && (
                      <Toggle
                        on={ws.mailRouting?.dailyCheck ?? true}
                        onChange={(v) => canManage && onWorkspace({ mailRouting: { ...(ws.mailRouting ?? {}), dailyCheck: v } })}
                        label={t('Check every day')}
                        hint={
                          realMail
                            ? t('Once a day we send a test to an address at {domain} that only {product} knows. If two tests in a row don’t arrive, admins get a notice and an email.', { domain: ws.domains[0] ?? t('your domain'), product: product.name }) +
                              (ws.mailRouting?.verifiedAt ? '' : ` ${t('It starts once routing has worked.')}`)
                            : t('A test email each morning. If it stops arriving, admins hear about it straight away. Runs once {product} mail is live.', { product: product.name })
                        }
                      />
                    )}
                    <button type="button" className="link-btn small" onClick={() => setRoutingGuide((x) => !x)}>
                      {routingGuide ? t('Hide the setup steps') : t('Show the setup steps')}
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

              <h3>{t('Email accounts')}</h3>
              <div className="acct-list">
                {accountRows.map(({ item: a, leaving }) => (
                  <div key={a.id} className={`acct-block${leaving ? ' row-leaving' : ''}`}>
                  <div className="acct-row">
                    <span className="acct-icon">{a.kind === 'shared' ? <Users size={16} /> : <Inbox size={16} />}</span>
                    <span className="acct-info">
                      <strong>{a.email}</strong>
                      <small>
                        {a.kind === 'shared' ? t('Shared inbox') : t('Personal')} · {a.users.length ? t('opened by {names}', { names: a.users.map(nameOf).join(', ') }) : t('opened by nobody')}
                      </small>
                    </span>
                    <Badge tone={a.connected ? 'good' : 'warn'}>{a.connected ? t('Connected') : t('Not connected')}</Badge>
                    {canManage && a.kind === 'shared' && (
                      <button
                        className={`ghost-btn outline sm access-btn ${accessOpen === a.id ? 'on' : ''}`}
                        onClick={() => setAccessOpen((x) => (x === a.id ? null : a.id))}
                      >
                        <KeyRound size={13} /> {t('Access')} <ChevronDown size={13} className="chev" />
                      </button>
                    )}
                    {canManage && ws.accounts.length > 1 && (
                      <button className="icon-btn sm" title={t('Remove account')} onClick={() => onRemoveAccount(a.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <SmoothHeight>
                  {accessOpen === a.id && (
                    <div className="access-panel">
                      <small>{t('Who can read and send from {email}', { email: a.email })}</small>
                      {ws.members.map((m) => {
                        const u = users.find((x) => x.id === m.userId);
                        if (!u) return null;
                        const on = a.users.includes(u.id);
                        const last = on && a.users.length === 1;
                        return (
                          <label key={u.id} className="access-row" title={last ? t('At least one person needs access') : ''}>
                            <PersonCell person={u} sub={null} size={24} badges={u.id === me && <Badge tone="accent">{t('You')}</Badge>} />
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
                    <Plus size={16} /> {t('Add an email account')}
                  </button>
                )}
              </div>
            </>
          )}

          {section === 'account' && (
            <>
              <h2>{t('Account')}</h2>
              <p className="set-intro">{t('How you appear to people you email.')}</p>
              <div className="profile-card">
                <PhotoPicker name={s.name} email={email} color={s.avatarColor} photo={users.find((u) => u.id === me)?.photo} onChange={(ph) => onPhoto?.(ph)} />
                <div className="avatar-colors">
                  <small>{t('Avatar colour')}</small>
                  <div>
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        className={`swatch ${s.avatarColor === c ? 'on' : ''}`}
                        style={{ background: c }}
                        onClick={() => update({ avatarColor: c })}
                        aria-label={t('Avatar colour {color}', { color: c })}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label>{t('Display name')}</label>
                <input value={s.name} onChange={(e) => update({ name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t('Title')}</label>
                <input value={s.title} onChange={(e) => update({ title: e.target.value })} />
              </div>
              <div className="field">
                <label>{t('Email address')}</label>
                <input value={email} readOnly />
                <small>{t('Your address is set up by your administrator.')}</small>
              </div>
              <div className="field">
                <label>{t('Language')}</label>
                <Select<Lang> value={s.language ?? getLang()} onChange={(v) => update({ language: v })} label={t('Language')} options={LANGS.map((l) => ({ value: l.id, label: l.name }))} />
                <small>{t('The app’s words, dates and numbers. It follows you to your other devices.')}</small>
              </div>

              <h3>{t('Security')}</h3>
              <PasswordRow />
              <TwoStepRow toast={admin.toast} />
              <ConnectedApps toast={admin.toast} />
              <DeleteAccountRow />
            </>
          )}

          {section === 'developer' && (
            <>
              <h2>{t('Developer')}</h2>
              <p className="set-intro">{t('Walk through flows that can’t run for real yet. Nothing here changes your data.')}</p>
              <div className="set-row">
                <span>
                  <strong>{t('Sign-up and onboarding')}</strong>
                  <small>{t('Account, company, apps, email (forward from Gmail or Outlook, or move fully) and team. Waits like Gmail’s code and the DNS check are simulated.')}</small>
                </span>
                <button className="ghost-btn outline" onClick={onPreviewOnboarding}>
                  {t('Open preview')}
                </button>
              </div>
              <div className="set-row">
                <span>
                  <strong>{t('Link to the preview')}</strong>
                  <small className="mono">{location.origin}/?preview=onboarding</small>
                </span>
              </div>
            </>
          )}

          {section === 'appearance' && (
            <>
              <h2>{t('Appearance')}</h2>
              <p className="set-intro">{t('Make {product} feel like yours.', { product: product.name })}</p>
              <h3>{t('Theme')}</h3>
              <div className="theme-cards">
                {(['light', 'dark', 'system'] as const).map((th) => (
                  <button key={th} className={`theme-card ${s.theme === th ? 'on' : ''}`} onClick={() => update({ theme: th })}>
                    <span className={`tc-preview tc-${th}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{th === 'system' ? t('Match system') : th === 'dark' ? t('Dark') : t('Light')}</span>
                  </button>
                ))}
              </div>
              <h3>{t('Accent colour')}</h3>
              <p className="set-hint" style={{ marginTop: 0 }}>
                {t('Comes from your workspace’s brand colour.')}{' '}
                <button className="link-btn" onClick={() => onSection('workspace')}>
                  {t('Change it in Workspace')}
                </button>
              </p>
              <h3>{t('Density')}</h3>
              <div className="segmented">
                {(['comfortable', 'compact'] as const).map((d) => (
                  <button key={d} className={s.density === d ? 'on' : ''} onClick={() => update({ density: d })}>
                    {d === 'compact' ? t('Compact') : t('Comfortable')}
                  </button>
                ))}
              </div>
              <Toggle on={s.showSnippets} onChange={(v) => update({ showSnippets: v })} label={t('Show message previews')} hint={t('A line of each email under the subject.')} />
            </>
          )}

          {section === 'mail' && (
            <>
              <h2>{t('Mail & signature')}</h2>
              <p className="set-intro">{t('Added to the end of every new email and reply.')}</p>
              <div className="signature-box">
                <RichEditor initialHtml={s.signature} placeholder={t('Your signature')} onChange={(html) => update({ signature: html })} />
              </div>
              {mailExtras}
              <h3>{t('Undo send')}</h3>
              {/* The mail engine keeps each email this long before anything leaves (server/mailer.ts, holdSend). */}
              <div className="segmented">
                {[0, 5, 10, 20, 30].map((n) => (
                  <button key={n} className={s.undoSend === n ? 'on' : ''} onClick={() => update({ undoSend: n })}>
                    {n ? t('{n}s', { n }) : tx('undo send', 'Off')}
                  </button>
                ))}
              </div>
              <small className="set-hint">{s.undoSend ? tn(s.undoSend, 'Your email waits {n} second before it goes out, so Undo can take it back and nobody gets it.', 'Your email waits {n} seconds before it goes out, so Undo can take it back and nobody gets it.') : t('Your email goes out the moment you press Send.')}</small>

              <h3>{t('Read tracking')}</h3>
              {ws.readTracking === false ? (
                // The company switched it off for everyone (Settings, Security & data).
                <div className="set-row">
                  <span>
                    <strong>{t('Read tracking is off for {company}', { company: ws.name || t('your company') })}</strong>
                    <small>{canManage ? t('You can turn it back on in Security & data.') : t('An owner or admin turned it off for everyone.')}</small>
                  </span>
                  {canManage && (
                    <button type="button" className="ghost-btn outline sm" onClick={() => onSection('security')}>
                      {t('Change')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Toggle
                    on={s.trackByDefault}
                    onChange={(v) => update({ trackByDefault: v })}
                    label={t('Track opens on emails to people outside the team')}
                    hint={t('See when they open your email and which links they click. You can switch it off per email. Apple Mail can open pictures by itself, so those opens show as maybe automatic.')}
                  />
                  <Toggle on={s.notifyOpens} onChange={(v) => update({ notifyOpens: v })} label={t('Tell me when someone opens')} hint={t('A notification the first time each person opens it.')} />
                </>
              )}
              {/* Pictures that load from elsewhere never load in mail you receive, so this is always on. */}
              <div className="set-row">
                <span>
                  <strong>{t('Trackers in emails you receive are blocked')}</strong>
                  <small>{t('Senders can’t see when or where you read their email.')}</small>
                </span>
                <Badge tone="good">{t('Always on')}</Badge>
              </div>
              {ws.readTracking !== false && <small className="set-hint">{t('Your team’s internal email is never tracked. If you email people in the EU, mention tracking in your privacy policy.')}</small>}

              <h3>{t('Blocked senders')}</h3>
              {blocked.length === 0 ? (
                <small className="set-hint" style={{ marginTop: 0 }}>
                  {t('Nobody yet. Use “Block” on any email to stop a sender for good.')}
                </small>
              ) : (
                <div className="acct-list">
                  {blocked.map((b) => (
                    <div key={b.id} className="acct-row">
                      <span className="acct-icon blocked">
                        <Ban size={15} />
                      </span>
                      <span className="acct-info">
                        <strong>{b.kind === 'domain' ? t('Everyone at @{domain}', { domain: b.value }) : b.value}</strong>
                        <small>{t('Blocked {date} · deleted on arrival', { date: fmtDate(b.at, { day: 'numeric', month: 'short', year: 'numeric' }) })}</small>
                      </span>
                      <button className="ghost-btn outline sm" onClick={() => onUnblock(b.id)}>
                        {t('Unblock')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {section === 'notifications' && <NotificationSettings s={s} update={update} />}
          {section === 'mailapps' && <PhoneMailApps ws={ws} canManage={canManage} onWorkspace={onWorkspace} toast={admin.toast} />}

          {section === 'shortcuts' && (
            <>
              <h2>{t('Keyboard shortcuts')}</h2>
              <p className="set-intro">{t('Fly through your inbox without touching the mouse.')}</p>
              <div className="shortcut-list">
                {SHORTCUTS.map(([label, keys]) => (
                  <div key={label} className="shortcut">
                    <span>{t(label)}</span>
                    <span>
                      {keys.map((k) => (k.includes(' ') ? <small key={k}>{t(k)}</small> : <kbd key={k}>{k}</kbd>))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {section === 'storage' && sections.some((x) => x.id === 'storage') && <StorageSection ws={ws} people={admin.people} plan={plan} drive={admin.drive} byChannel={admin.byChannel} users={wsUsers} canManage={canManage} onStorage={admin.onStorage} onBilling={() => onSection('billing')} toast={admin.toast} />}
          {section === 'clients' && (
            <>
              <h2>{t('{Who} access', { who: term.who })}</h2>
              <p className="set-intro">{t('What your clients see and can do when they sign in to their portal. You can change any of these for one client on its client page (Portal tab).')}</p>
              <div className="access-types">
                <span className="muted small">{t('Settings for')}</span>
                {/* Phones: five choices don't fit in a row, so they're a list that opens as a sheet. */}
                {onPhone && (
                  <Select
                    value={accessType}
                    onChange={setAccessType}
                    label={t('Settings for')}
                    className="access-type-sel"
                    options={['', ...PROJECT_TYPES].map((tp) => ({ value: tp, label: tp ? t(tp) : t('Every {project}', { project: term.one }), hint: tp && ws.clientAccessByType?.[tp] && Object.keys(ws.clientAccessByType[tp]).length ? t('Changed for this type') : undefined }))}
                  />
                )}
                <div className="segmented sm">
                  {['', ...PROJECT_TYPES].map((tp) => (
                    <button key={tp || 'all'} type="button" className={accessType === tp ? 'on' : ''} onClick={() => setAccessType(tp)}>
                      {tp ? `${t(tp)}${ws.clientAccessByType?.[tp] && Object.keys(ws.clientAccessByType[tp]).length ? ' •' : ''}` : t('Every {project}', { project: term.one })}
                    </button>
                  ))}
                </div>
              </div>
              {accessType && (
                <p className="muted small">
                  {t('Changes here apply to {projects} of the type {type}, on top of the settings for every {project}.', { projects: term.many, type: t(accessType), project: term.one })}{' '}
                  {ws.clientAccessByType?.[accessType] && Object.keys(ws.clientAccessByType[accessType]).length > 0 && canManage && (
                    <button type="button" className="link-btn small" onClick={() => onWorkspace({ clientAccessByType: { ...ws.clientAccessByType, [accessType]: {} } })}>
                      {t('Use the settings for every {project}', { project: term.one })}
                    </button>
                  )}
                </p>
              )}
              <ClientAccessForm
                key={accessType || 'all'}
                value={accessFor(ws, { type: accessType || undefined })}
                teams={admin.teams.filter((tm) => tm.workspaceId === ws.id)}
                canManage={canManage}
                brandingAvailable={!!plan.addons.branding}
                onChange={(p) =>
                  accessType
                    ? onWorkspace({ clientAccessByType: { ...ws.clientAccessByType, [accessType]: { ...(ws.clientAccessByType?.[accessType] ?? {}), ...p } } })
                    : onWorkspace({ clientAccess: { ...accessFor(ws, {}), ...p } })
                }
              />
              <p className="muted small">{t('{Whos} never see Mail, Calendar, Drive, your team’s channels, internal comments or other {projects}. To check, open a {project}’s page and choose “View as guest”.', { whos: term.whos, projects: term.many, project: term.one })}</p>
            </>
          )}
          {section === 'help' && <HelpSection workspaceId={demo?.inDemo && demo.realWorkspaceId ? demo.realWorkspaceId : ws.id} toast={admin.toast} extra={demo && <DemoCompanyBlock d={demo} />} />}
          {section === 'email' && (
            <EmailDeliverySection
              ws={ws}
              canManage={canManage}
              firstName={users.find((u) => u.id === me)?.name.split(' ')[0] ?? 'you'}
              myEmail={ws.accounts.find((a) => !a.temp && a.kind === 'personal' && a.users.includes(me))?.email}
              onWorkspace={onWorkspace}
              onAddAccount={canManage ? onAddAccount : undefined}
              onRemoveAccount={canManage ? (a) => onRemoveAccount(a.id) : undefined}
              toast={admin.toast}
            />
          )}
          {section === 'agency' && <AgencySection ws={ws} canManage={canManage} onWorkspace={onWorkspace} brandingAddon={hasBranding(plan)} onBilling={() => onSection('billing')} toast={admin.toast} />}
          {section === 'permissions' && <PermissionsSection ws={ws} canManage={canManage} onWorkspace={onWorkspace} />}
          {section === 'teams' && <TeamsLink teams={admin.teams} users={wsUsers} onOpen={admin.onOpenTeams} />}
          {section === 'stages' && <TaskStagesSection ws={ws} canManage={canManage} tasks={admin.tasks} teams={admin.teams} me={me} onWorkspace={onWorkspace} onMoveTasks={admin.onMoveTasks} />}
          {section === 'apps' && <AppsSection ws={ws} canManage={canManage} onWorkspace={onWorkspace} projects={admin.projects} />}
          {section === 'apps' && <BarDefaults ws={ws} teams={admin.teams} canManage={canManage} onWorkspace={onWorkspace} />}
          {section === 'myapps' && myApps && demo && demo.state !== 'on' && <DemoCompanyBlock d={demo} />}
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
          {!sections.some((x) => x.id === section) && <p className="muted">{demo?.inDemo && DEMO_OUT.includes(section) ? t('The demo company has no billing, AI keys, mail delivery, brand or sign-in rules of its own: they’re set in your real company.') : t('Ask an admin about this.')}</p>}
          {section === 'ai' && sections.some((x) => x.id === 'ai') && <AISection ws={ws} people={admin.people} users={wsUsers} me={me} canManage={canManage} onAI={admin.onAI} onBilling={() => onSection('billing')} toast={admin.toast} />}
          {section === 'billing' && sections.some((x) => x.id === 'billing') && <BillingSection ws={ws} people={admin.people} isOwner={myRole === 'owner'} onPlan={admin.onPlan} onExport={admin.onExport} toast={admin.toast} />}
          {section === 'import' && sections.some((x) => x.id === 'import') && <ImportSection ws={ws} members={wsUsers} projects={admin.projects} toast={admin.toast} />}
          {section === 'security' && <SecuritySection ws={ws} me={me} isOwner={myRole === 'owner'} canManage={canManage} onWorkspace={onWorkspace} onExport={admin.onExport} onDelete={admin.onDelete} onAccount={() => onSection('account')} users={wsUsers} toast={admin.toast} />}
        </div>
        </SectionScreen>
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
    setMsg(err ? { ok: false, text: err } : { ok: true, text: mark('Password changed.') }); // translated where it's shown, like the server's errors
    if (!err) (setOpen(false), setCur(''), setNext(''));
  };
  return (
    <>
      <div className="set-row">
        <span>
          <strong>{t('Password')}</strong>
          <small>{server.on ? (msg?.ok ? t(msg.text) : t('Used to sign in to {product}.', { product: product.name })) : t('Passwords are checked when the local server runs.')}</small>
        </span>
        <button className="ghost-btn outline" disabled={!server.on} onClick={() => (setOpen((o) => !o), setMsg(null))}>
          {t('Change password')}
        </button>
      </div>
      <SmoothHeight>
      {open && (
        <div className="pw-form">
          <div className="field">
            <label>{t('Current password')}</label>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>{t('New password')}</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder={t('At least 8 characters')} />
          </div>
          {msg && !msg.ok && <p className="err">{t(msg.text)}</p>}
          <button className="primary-btn sm" disabled={!cur || next.length < 8} onClick={() => void save()}>
            {t('Save new password')}
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
    if (!confirm(t('Delete your account? This can’t be undone. Your tasks, messages and files stay with your company.'))) return;
    setBusy(true);
    const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) return setMsg(d.error ?? mark('Couldn’t delete the account.')); // translated where it's shown, like the server's errors
    location.href = '/';
  };
  if (!server.on) return null;
  return (
    <div className="danger-zone">
      <div className="set-row">
        <span>
          <strong>{t('Delete your account')}</strong>
          <small>{t('Your sign-in goes for good. What you made stays with the company, marked as a deleted account.')}</small>
        </span>
        <button type="button" className="ghost-btn sm danger" onClick={() => setOpen((x) => !x)}>
          {open ? t('Cancel') : t('Delete…')}
        </button>
      </div>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in pw-form">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password, to be sure it’s you')} autoComplete="current-password" />
          {msg && <p className="err small">{t(msg)}</p>}
          <button type="button" className="primary-btn sm danger" disabled={!pw || busy} onClick={() => void go()}>
            {busy ? t('Deleting…') : t('Delete my account')}
          </button>
        </div>
      </div>
    </div>
  );
}
