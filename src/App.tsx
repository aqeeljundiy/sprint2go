import { TabDefaultsCtx } from './components/ui/TabBar';
import { Assistant, BlockDialog, BrainDump, CalendarView, ClientApp, ConnectCalendar, DriveView, EndClientDialog, EventEditor, MeetSidebar, MeetView, NewTeamDialog, NoteEditor, NotesList, QuickNote, Onboarding, SendBotDialog, SettingsPage, ShareDialog, SharedHome, SharedPage, TableScreen, TeamPage, TeamsHome, TeamsSidebar, TemplateDialog, TrackingDashboard, VaultSidebar, VaultView } from './lazy';
import { NewTableDialog, TablesHome, TablesSidebar, makeTable } from './components/tables/TablesApp';
import type { TeamActions } from './components/teams/TeamsApp';
import type { TemplateId } from './components/tables/fields';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { term, setTermWord, brand as product, setBrandName, brandOf, portalOrigin } from './terms';
import { setPhotos } from './photos';
import { TempAddressDialog, lifeLeft } from './components/TempAddress';
import { AppSetupCard } from './components/AppSetupCard';
import { ProjectsCtx } from './components/ProjectPicker';
import { ProjectsSidebar } from './components/ProjectsSidebar';
import { ProjectsHome } from './components/ProjectsHome';
import { Popover } from './components/ui/Popover';
import { Brain, Briefcase, Building2, CalendarPlus, Copy, FileText, Hash, ListChecks, Mail, PenLine, Send, Sparkles, Timer, Trash2, Undo2, Upload, User as UserIcon, Video, Table2, MessagesSquare, AlertTriangle, Menu, Inbox, Search as SearchIcon, Paperclip, Contact, House, MessageCircle, Bell, Sun, CalendarRange, CircleCheck, Layers, List, CalendarDays, NotebookPen, Users, Star, Folder, UserRound, Archive, UsersRound, NotebookText } from 'lucide-react';
import { DEFAULT_PERMISSIONS } from './types';
import type { Quote, Team, Note, Account, AppId, Attachment, BlockRule, CalEvent, Channel, ChannelCategory, Client, ClientPerson, ChatFile, ChatMessage, CommentFile, Meeting, Message, Notice, RsvpStatus, TaskEvent, TaskStatus, Todo, DriveItem, DriveSection, Location, Person, Thread, User, View, Workspace, FolderId } from './types';
import { useMailOrganize } from './components/mail/Organize';
import { CALENDARS, externalEvents } from './data/calendar';
import { JOBS, costPer100 } from './data/aiCatalog';
import { rp, storageGB } from './data/pricing';
import { MAIL_USAGE, QUOTA, kindOf, parseSize, sizeText } from './data/drive';
import { fmtTime, fmtTimeRange } from './calendarUtils';
import { fullDate, lastMessage, uid, localDay, nextDue, addWorkdays } from './utils';
import { templatesFor, tplText, type TaskTemplate } from './data/templates';
import type { NotesFilter } from './components/NotesApp';
import type { NotesApi } from './components/notes/useNoteMenu';
import type { VaultItem } from './components/VaultApp';
import { eventsOn, monthGrid } from './calendarUtils';
import { answerSeries, changeSeries, changesRule, expandEvents, findEvent, removeFromSeries, startOnRule, timeLike, type Scope, type SeriesChange } from './repeat';
import { askScope as askRepeatScope, ScopeHost, type ScopeAt } from './components/calendar/RepeatScope';
import { botJoins, callKey, meetingLinkOf, notetakerJoins, MEETING_NAME } from './meetingLinks';
import { setHolidayDays } from './holidayDays';
import { holidayCalendarId, holidayCountry } from './data/holidays';
import { lsKey, useSettings, usePersisted, usePrefsSync } from './settings';
import { DEFAULT_TRACK_OPTIONS, REPLY_TRACK_OPTIONS, isTeam } from './tracking';
import { isMine, setIdentity } from './identity';
import { scanned, session, store, useStored } from './store';
// Mail for teams (src/components/mail/): Contacts, compose suggestions (most contacted first), mail kept offline and
// written offline, the data loss rules' warnings.
import { ContactsView, useComposeContacts } from './components/mail/Contacts';
import { flushOutbox, keepOffline, sendMail } from './components/mail/offline';
import { dlpWords, type DlpStop } from './components/mail/teamsApi';
import { live, reloadAll, resync, server, uploadFile, uploadPolicy, wasSkipped } from './sync';
import { FilesView } from './components/mail/FilesView';
import { threadHasAttachment } from './mailAttachments';
import { makeLinks as makeFileLinks, saveToDrive as saveAttachments } from './components/mail/attachApi'; // Mail attachments round
import { TRY_KEYS, isSandbox, isSandboxId, sandboxWsId, type TryKey } from './sandbox';
import { DemoCompanyBar, DemoInvite, ResetDemoDialog, TryList, demoCompanySeen, hideDemoCompany, openDemoCompany, resetDemoCompany, useDemoState } from './components/DemoCompany';
import { InviteCard, type InviteState } from './components/InviteCard';
import { inviteCalendarTimes, inviteSeries } from './inviteTimes';
import { isPersonalHoliday, personalHolidayId, regionsToSave, useHolidayRegions } from './holidayRegions';
import { OutOfOffice } from './components/OutOfOffice';
import { caps } from './caps';
import { EmailDeliverySection } from './components/admin/EmailDelivery';
import { ai, aiLive } from './ai';
import type { AskChat } from './components/Assistant';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { InviteMember, NewAccount, RemoveMailbox } from './components/WorkspaceForms';
import { applyBranding } from './components/WorkspaceLogo';
import { Sidebar, SIDEBAR_MAX, SIDEBAR_MIN, folderName, type Mode } from './components/Sidebar';
import { MessageList, type MailActions, type MailFilter } from './components/MessageList';
import { needsReply, snoozePatch, wakeThread, whenWords } from './mailRules';
import { MailSettingsScreen } from './components/mail/MailSettings';
import { peopleOf, recipientsOf, replyPeople } from './mailPeople';
import { extrasOf, sendersOf, signatureFor, type ReplyOpts } from './components/mail/composeExtras';
/** What a saved draft asked for (an alias as From, Reply-To, priority, confidential, plain text), back in Compose. */
const draftExtras = (m: Message) => ({
  ...(m.sendOptions?.fromAddress ? { fromAddress: m.sendOptions.fromAddress } : m.from?.email ? { fromAddress: m.from.email } : {}),
  ...(m.replyTo?.length ? { replyTo: m.replyTo } : {}),
  ...(m.priority ? { priority: m.priority } : {}),
  ...(m.sendOptions?.confidential && Date.parse(m.sendOptions.confidential.expiresAt) > Date.now() ? { confidential: m.sendOptions.confidential } : {}),
  ...(m.plain ? { plain: true } : {}),
});
// Search operators, inbox tabs, Important, mute, multiple inboxes, auto-advance, conversation view, shortcuts.
import { advanceTo, rowOf, sortInbox, splitRows, tabOf, tabsOn, useMailPrefs, categoryName } from './components/mail/sortPrefs';
import { InboxSections, InboxSettings, InboxTabs, KeepNotice, QueryBar, SavedSearches, TabNav, TabRows } from './components/mail/Sorting';
import { MailShortcuts } from './components/mail/Shortcuts';
import { matchThread, parseQuery, type Category } from './mailQuery';
import { Reader } from './components/Reader';
import { Compose, type Outgoing, type OutgoingFile } from './components/Compose';
import type { CalView } from './components/CalendarView';
import { CalendarSidebar } from './components/CalendarSidebar';
import { ScheduleTask } from './components/calendar/ScheduleTask';
import { AccountMenu, type SettingsSection } from './components/AccountMenu';
import { DriveSidebar, DRIVE_SECTIONS } from './components/DriveSidebar';
import { DrivePreview } from './components/DrivePreview';
import { AppRail, APPS, appWord } from './components/AppRail';
import { AppSettingsButton, appSettingsLinks } from './components/AppSettings';
import { Avatar } from './components/Avatar';
import { Notifications, NoticesScreen } from './components/Notifications';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { HomeView } from './components/HomeView';
import { TaskDrawer } from './components/TaskDrawer';
import { TasksView, dueLabel, isBrief, type TaskScope } from './components/TasksView';
import { TasksSidebar } from './components/TasksSidebar';
import type { DumpResult } from './components/BrainDump';
import { ChatSidebar, ChatView, NewMessageSheet, StatusPicker, statusText, fullLayout, sectionIdOf, sectionPeople, sectionTitle, type ChatPage, type GuestOption, type Presence, type Recipients, type SendPayload } from './components/ChatApp';
import { ChatPages } from './components/chat/Pages';
import { useDockRef } from './components/chat/huddleDock';
import { ChatPrefsHost, isMutedValue } from './components/chat/chatPrefs';
import { chatRecipients, isGroupDm } from './chatFollow';
import { chanName } from './components/chat/Sheets';
import { preview as msgPreview } from './components/chat/Message';
import { ChannelDialog, CATEGORY_ONE, categoryText } from './components/ChannelDialog';
import { CompanySheet, MobileTop } from './components/MobileTop';
import { MailAvatar } from './components/mail/MailTop';
import { TopBar } from './mobile/TopBar';
import { openSettingsList } from './components/settingsList';
import { PushScreen } from './components/ui/PushScreen';
import { Sheet } from './components/ui/Sheet';
import { offerInstall } from './components/InstallPrompt';
import { AppBar, CreateFab } from './mobile/AppBar';
import { Launcher, type LauncherApp, type Recent } from './mobile/Launcher';
import { EditApps } from './mobile/EditApps';
import { launchGrow, launchShrink } from './mobile/launchMotion';
import { duplicateOf } from './components/tasks/taskOps';
import { needsYou } from './needsYou';
import { plainTiles } from './mobile/BarDefaults';
import { companyApps as companyAppOrder, launcherApps, migrateBar, normalize as normalizeApps, type AppOrder, type LauncherId } from './mobile/launcherApps';
import { historySteps, parseRoute, routePath, startPath, RESUME_MS, SECTIONS as SECTIONS_OF, type Route } from './route';
import { setVaultUnlocked } from './vaultCrypto';
import { useEdgeSwipe } from './components/ui/SideDrawer';
import { openCompanySheet, useAppSections, useChrome, useFocusedScreen, useTitleMenu, useTitleTucked, type AppSection, type AppSections } from './mobile/chrome';
import { PHONE, TABLET, isPhone, useMedia } from './mobile/media';
import { usePullToSearch } from './mobile/usePullToSearch';
import { useKeyboard } from './mobile/keyboard';
import { SEARCHABLE } from './components/CommandPalette';
import type { ToastMsg } from './toast';
import { clientActions } from './clientActions';
import { accessFor, afterEnd, clientInbox, clientPeople, portalsFor, requestStatus, teamLabel } from './clientView';
import { firstOf as firstStage, kindOf as stageKind, registerStages, stageAfterMove, stageIdFor, stageName, stageOf, stagePhrase, stagesForTask } from './stages';
import { celebrate } from './components/ui/confetti';
import type { AskScope, MeetPage } from './components/MeetApp';
import { DEFAULT_MEETINGS, trialPlan } from './data/workspaces';
import { DEMO_SCRIPT } from './data/team';
import { htmlToText, sanitize, textToHtml } from './sanitize';
import { rowName } from './components/tables/core';
import { Huddle } from './components/Huddle';
import { usePushBridge } from './pushBridge';
import { routeBase } from './tryOut';
import { useAppLanguage, useLang } from './i18n/useLang';
import { mark, msg, phrase, t, textOf, tn, type Msg } from './i18n';
import { fmtDay, fmtList, fmtNumber, fmtWeekday } from './i18n/format';
import { setBrand } from './brandInk';

/** For words saved in a msg(): "today", "tomorrow", "overdue" lower-case mid-sentence (each reader's language), a date as "Thu 8 Oct". */
const dueWords = (d: string) => {
  const l = dueLabel(d);
  return l.cls ? l.en.toLowerCase() : l.en;
};
/** The same on screen, in the reader's language: "today", "besok", "Kam, 8 Okt". */
const dueWordsHere = (d: string) => {
  const l = dueLabel(d);
  return l.cls ? t(l.en.toLowerCase()) : l.text;
};
/** A repeat in a history line ("set it to repeat weekly"): a phrase each reader sees in their own language. */
const repeatPhrase = (r: Todo['repeat']) => phrase(r === 'weekdays' ? 'every weekday' : r === 'daily' ? 'daily' : r === 'weekly' ? 'weekly' : 'monthly');

const APP_IDS = APPS.map((a) => a.id) as string[];
// app.sprint2go.com/mail, /chat… on a real server; #/mail when opened as a local file.
const hashRouting = !location.protocol.startsWith('http');
/** The path after the app's base: "/tasks/upcoming" (src/route.ts), or the hash's when opened as a local file. */
const pathNow = () => (hashRouting ? location.hash.replace(/^#/, '') : location.pathname.slice(routeBase.length)) || '/';
function setPath(path: string, how: 'push' | 'replace') {
  try {
    if (hashRouting) history.replaceState(null, '', `#${path}`); // a local file: no history entries
    else if (how === 'push') history.pushState(null, '', `${routeBase}${path}`);
    else history.replaceState(null, '', `${routeBase}${path}${pathNow() === path ? location.search : ''}`);
  } catch {
    /* some previews forbid history changes */
  }
}
/** Where the phone was last (the app and section), for "back within 10 minutes reopens it". */
const LAST_PLACE = 's2g-last-place';
const readLastPlace = (): { path: string; at: number } | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_PLACE) ?? 'null');
  } catch {
    return null;
  }
};
/** Where the app opens, read once before the first render. Phones: the URL's app, else the last app when it was under
 * 10 minutes ago, else the launcher. A phone that opens straight into an app gets the launcher under it in history, so
 * Back leads there before leaving. */
let bootStack: string[] = []; // the history entries bootRoute made, oldest first
function bootRoute(): Route {
  const phone = isPhone();
  const url = pathNow();
  if (!phone) return parseRoute(url, false);
  const to = startPath(url, readLastPlace(), Date.now());
  const r = parseRoute(to, true);
  if (!r.launcher && !hashRouting) {
    setPath('/', 'replace');
    bootStack = ['/'];
    for (const step of historySteps('/', to, true)) (setPath(step, 'push'), bootStack.push(step));
  } else if (to !== url) setPath(to, 'replace');
  return r;
}

/** A mailbox in the URL (/mail/starred, /mail/label/<id>); the inbox is /mail itself. */
const mailId = (v: View) => (v.kind === 'folder' ? (v.id === 'inbox' ? undefined : v.id) : v.kind === 'label' || v.kind === 'category' || v.kind === 'project' ? `${v.kind}/${v.id}` : v.kind === 'todos' || v.kind === 'tracking' ? v.kind : undefined);

const fromMe = (t: Thread) => t.messages.some((m) => isMine(m.from.email));

/** What a mail list needs to know beyond the thread: who's looking, which emails gave them to-dos, each one's project. */
type ViewCtx = { me?: string; todo?: Set<string>; projectOf?: (t: Thread) => string | undefined; tabs?: Category[] };

function inView(t: Thread, v: View, ctx: ViewCtx = {}): boolean {
  if (v.kind === 'tracking' || v.kind === 'files') return false;
  // Inbox tabs (mail/sortPrefs.ts): the inbox is Primary when tabs are on; each tab is its own part of the inbox.
  if (v.kind === 'category') return inView(t, { kind: 'folder', id: 'inbox' }) && tabOf(t, ctx.tabs ?? []) === v.id;
  if (v.kind === 'folder' && v.id === 'inbox' && (ctx.tabs?.length ?? 0) > 1 && tabOf(t, ctx.tabs!) !== 'primary') return false;
  const kept = t.location !== 'trash' && t.location !== 'spam';
  if (v.kind === 'todos') return kept && !!ctx.todo?.has(t.id);
  if (v.kind === 'project') return kept && t.location !== 'drafts' && ctx.projectOf?.(t) === v.id;
  if (v.kind === 'label') return t.labels.includes(v.id) && kept;
  const snoozed = !!t.snoozedUntil && t.snoozedUntil > new Date().toISOString();
  switch (v.id) {
    case 'inbox':
      return t.location === 'inbox' && !snoozed;
    case 'snoozed':
      return snoozed && t.location !== 'trash';
    case 'scheduled':
      return !!t.sendAt;
    case 'assigned':
      return !!ctx.me && t.assignee === ctx.me && t.location !== 'trash' && !snoozed;
    case 'drafts':
      return t.location === 'drafts' && !t.sendAt;
    case 'starred':
      return t.starred && t.location !== 'trash';
    case 'sent':
      return fromMe(t) && t.location !== 'trash' && t.location !== 'drafts';
    default:
      return t.location === v.id;
  }
}

/** Settings for one app, opened from the phone's title switcher: the same section, full screen over the app. */
function PushedSettings({ push, onBack, children }: { push: { label: string } | null; onBack: () => void; children: React.ReactNode }) {
  return push ? (
    <PushScreen title={push.label} onBack={onBack} className="settings-push">
      {children}
    </PushScreen>
  ) : (
    <>{children}</>
  );
}

/** `quiet`: news nobody asked for just now (to-dos found in the background). Gone after 4 s. */
type Toast = { id: number; text: string; action?: { label: string; run: () => void }; also?: { label: string; run: () => void }; ms?: number; quiet?: boolean };
type ComposeState = { key: number; draftId?: string; initial?: Outgoing; parked?: boolean; replyThreadId?: string }; // replyThreadId: a reply popped out of the reader, sent into its conversation

interface AppProps {
  user: User;
  signedInUsers: User[];
  allUsers: User[];
  workspaces: Workspace[];
  setWorkspaces: (fn: (w: Workspace[]) => Workspace[]) => void;
  onSwitchUser: (id: string) => void;
  onAddUser: () => void;
  onSignOut: () => void;
  onInvite: (u: User) => Promise<string | null>; // the invite link, when the local server makes one
  onWorkspace?: (id: string) => void;
  onUpdateUser: (patch: Partial<User>) => void;
  /** A bar on top of everything (the try-out's "You're trying sprint2go"). */
  topBar?: React.ReactNode;
}

export default function App({ user, signedInUsers, allUsers, workspaces: allWorkspaces, setWorkspaces, onSwitchUser, onAddUser, onSignOut, onInvite: inviteUser, onWorkspace, onUpdateUser, topBar }: AppProps) {
  const [settings, updateSettings] = useSettings(user);
  const [previewOnboarding, setPreviewOnboarding] = useState(() => new URLSearchParams(location.search).get('preview') === 'onboarding');
  setPhotos(allUsers); // every Avatar finds people's photos by email

  // Keep the user's profile in step with their settings.
  useEffect(() => {
    if (settings.name !== user.name || settings.title !== user.title || settings.avatarColor !== user.color)
      onUpdateUser({ name: settings.name, title: settings.title, color: settings.avatarColor });
  }, [settings.name, settings.title, settings.avatarColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Workspaces: one per business, each with its own brand and accounts.
  // A user only sees workspaces they're a member of, and only mailboxes they've been given.
  const workspaces = allWorkspaces.filter((w) => w.members.some((m) => m.userId === user.id));
  usePrefsSync(user.id); // settings, saved views and Ask AI chats follow this person between devices
  const [wsId, setWsId] = usePersisted(`pm-ws:${user.id}`, workspaces[0]?.id ?? '');
  const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0];
  session.wsId = ws?.id ?? '';
  // Their own demo company (src/sandbox.ts): everything in it behaves as the demo, and nothing in it leaves it.
  // `real`: what's on screen is real, so the server does the real thing (sending, the notetaker, calendar links).
  const inSandbox = isSandbox(ws);
  const real = server.on && !inSandbox;
  const demo = useDemoState(); // their demo company: allowed, and not made yet, open or hidden
  const [demoBusy, setDemoBusy] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoInviteOff, setDemoInviteOff] = usePersisted(`s2g-demo-invite-off:${user.id}`, false);
  // Looking at the demo company: it isn't unused (the server removes ones nobody opened for a month).
  useEffect(() => {
    if (inSandbox && server.on) demoCompanySeen();
  }, [inSandbox, ws.id]);
  // Uploads ask before big files (Settings, Storage); the demo has no server to ask, so it uses these.
  uploadPolicy.askOverMb = ws?.storage?.askOver ?? 500;
  uploadPolicy.storageTotal = ws ? storageGB(ws.plan ?? trialPlan(ws.name, ''), ws.members.length) * 1024 ** 3 : 0;
  setBrandName(brandOf(ws)); // white label: an agency's name in place of ours
  setTermWord(ws?.terms?.word); // "Projects" or "Clients", before anything below renders words
  useAppLanguage(settings.language, ws?.language); // theirs, else the company's, else the device's (docs/i18n.md)
  const lang = useLang(); // for the memos below that build words
  registerStages(allWorkspaces, ws?.id); // each company's task stages, so every screen reads a task's stage from its company
  // Companies this person is a client of (same sign-in): their portals sit in the workspace switcher.
  const [portalKey, setPortalKey] = usePersisted(`s2g-portal:${user.id}`, '');
  useEffect(() => onWorkspace?.(portalKey && allWorkspaces.some((w) => portalKey.startsWith(w.id + ':')) ? portalKey.split(':')[0] : ws.id), [ws.id, ws.ai, portalKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Adds the person; with the local server, also makes a link where they set their password. */
  const onInvite = (u: User) =>
    void inviteUser(u).then(
      (link) =>
        link &&
        showToast({
          text: t('{name} can join with their invite link', { name: u.name.split(' ')[0] }),
          action: { label: t('Copy link'), run: () => void navigator.clipboard?.writeText(link) },
          ms: 20000,
        }),
    );
  const role = ws.members.find((m) => m.userId === user.id)?.role ?? 'member';
  // Your personal mailbox first, then shared inboxes.
  // Mailboxes someone gave you access to (delegation, src/components/mail/MailAccess.tsx) come after your own.
  const opens = (a: Account) => a.users.includes(user.id) || !!a.delegates?.some((d) => d.userId === user.id);
  const myAccounts = useMemo(
    () => ws.accounts.filter(opens).sort((a, b) => Number(a.kind === 'shared') - Number(b.kind === 'shared') || Number(!a.users.includes(user.id)) - Number(!b.users.includes(user.id))),
    [ws.accounts, user.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // What really works (worked out on the server). The standalone demo, demo servers and the demo company have everything on.
  const demoOk = !server.on || caps.demo || inSandbox;
  const ready = ws.mailReady;
  const boxReady = (id: string): { receive: boolean; send: boolean; why?: string; sendWhy?: string } => (demoOk ? { receive: true, send: true } : ready?.mailboxes?.[id] ?? { receive: false, send: false, why: ready ? undefined : 'Checking your email setup…' });
  const delegatedIds = useMemo(() => new Set(myAccounts.filter((a) => !a.users.includes(user.id)).map((a) => a.id)), [myAccounts, user.id]);
  const mailIn = myAccounts.some((a) => boxReady(a.id).receive);
  const mailOut = myAccounts.some((a) => boxReady(a.id).send);
  const whyFor = (k: 'receive' | 'send') =>
    myAccounts
      .map((a) => boxReady(a.id))
      .filter((b) => !b[k])
      .map((b) => (k === 'send' ? (b.sendWhy ?? b.why) : b.why))
      .find(Boolean);
  const mailWhy = { receive: whyFor('receive') ?? ready?.why?.receive, send: whyFor('send') ?? ready?.why?.send };
  const sendable = myAccounts.filter((a) => boxReady(a.id).send);
  // AI: on when the company has it (included or its own key), or in a demo.
  const [aiOn, setAiOn] = useState(true);
  const [aiWhy, setAiWhy] = useState<'no-key' | 'down' | 'used-up' | 'off' | null>(null); // why it's off: nothing set up, our AI is down, or the allowance is used up
  useEffect(() => {
    if (!server.on || inSandbox) return (setAiOn(true), setAiWhy(null)); // the demo company answers with samples
    let on = true;
    fetch(`/api/ai/status?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { live: false }))
      .then((d: { live: boolean; why?: 'no-key' | 'down' | 'used-up' | 'off' | null }) => on && (setAiOn(d.live || caps.demo), setAiWhy(d.why ?? null)), () => on && setAiOn(caps.demo));
    return () => {
      on = false;
    };
  }, [ws.id, ws.ai]);
  const [activeAccount, setActiveAccount] = useState<string>('all');
  const [newWs, setNewWs] = useState(false);
  const [newAcct, setNewAcct] = useState(false);
  const [removeAcct, setRemoveAcct] = useState<Account | null>(null); // asking what happens to its mail
  // Throwaway addresses: the dialog (new or editing one) and the little menu on each.
  const [tempDialog, setTempDialog] = useState<{ editing?: Account } | null>(null);
  const [tempMenu, setTempMenu] = useState<Account | null>(null);
  const tempAnchor = useRef<HTMLElement | null>(null);
  const [inviting, setInviting] = useState(false);
  const allAccounts = allWorkspaces.flatMap((w) => w.accounts);
  const mine = workspaces.flatMap((w) => w.accounts.filter(opens));
  setIdentity(mine.map((a) => a.email), ws.domains);
  const primary = myAccounts.find((a) => a.id === activeAccount) ?? myAccounts[0] ?? { email: user.email };
  const ME: Person & { color: string } = { name: settings.name || user.name, email: primary.email, color: settings.avatarColor };
  const accountOf = (id: string) => allAccounts.find((a) => a.id === id);
  const senderFor = (a: Account | undefined): Person =>
    a ? { name: a.kind === 'shared' || !a.users.includes(user.id) ? a.name : settings.name || a.name, email: a.email } : ME; // a delegated mailbox sends under its owner's name
  /** Team mail: a mailbox more than one person opens (a shared inbox, or one given to several). Comments live there. */
  const teamMail = (t: Thread) => {
    const a = accountOf(t.accountId);
    return !!a && (a.kind === 'shared' || a.users.length > 1);
  };

  useEffect(() => {
    if (myPortals.some((pt) => pt.key === portalKey)) return; // the portal brands itself
    applyBranding(ws);
    const root = document.documentElement;
    // The workspace colour is the brand; tokens.css turns it into a light- or dark-friendly accent.
    setBrand(ws.color, root);
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-soft');
  }, [ws, portalKey]); // also when coming back from a client portal (it uses the other company's brand)

  const patchWorkspace = (id: string, patch: Partial<Workspace>) => setWorkspaces((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const mobile = useMedia(PHONE);

  // Shell
  // Where the app opened (src/route.ts): the URL names the app, its section and the thing open in it. The rest of the
  // routing (Back, sections, the launcher) is with the phone shell further down.
  const [boot] = useState(bootRoute);
  const [mode, setMode] = useState<Mode>(() => (APP_IDS.includes(boot.mode) || boot.mode === 'settings' ? (boot.mode as Mode) : 'home'));
  const [lastMode, setLastMode] = useState<AppId>(() => (boot.mode === 'settings' || !APP_IDS.includes(boot.mode) ? 'home' : (boot.mode as AppId)));
  // Phones: the launcher is on screen (research/launcher/plan.md). The app under it stays as it was.
  const [launcher, setLauncherState] = useState(boot.launcher);
  // Tablets (iPad portrait, small landscape): the sidebar starts folded to icons so the page gets the room.
  // Each size keeps its own choice, so opening it on the iPad doesn't change the laptop.
  const tablet = useMedia(TABLET);
  const [collapsedWide, setCollapsedWide] = usePersisted('pm-sidebar-collapsed', false);
  const [collapsedTablet, setCollapsedTablet] = usePersisted('pm-sidebar-collapsed-tablet', true);
  const collapsed = tablet ? collapsedTablet : collapsedWide;
  const setCollapsed = tablet ? setCollapsedTablet : setCollapsedWide;
  const [sidebarW, setSidebarW] = usePersisted('pm-sidebar-w', 248);
  const [listW, setListW] = usePersisted('pm-list-w', 400);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = (t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() });
  // Shared pieces (SwipeRow, sheets) send their toasts here through src/toast.ts.
  useEffect(() => {
    const on = (e: Event) => setToast({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    window.addEventListener('s2g:toast', on);
    return () => window.removeEventListener('s2g:toast', on);
  }, []);
  // News from the sprint2go team (operator backend, Product), minus what this person dismissed on this device.
  const [news, setNews] = useState<{ id: string; text: string; link?: string; kind: 'news' | 'warning' }[]>([]);
  const [newsSeen, setNewsSeen] = usePersisted<string[]>('s2g-news-dismissed', []);
  useEffect(() => {
    if (!server.on) return;
    const load = () =>
      fetch('/api/announcements')
        .then((r) => (r.ok ? r.json() : { announcements: [] }))
        .then((d: { announcements: typeof news }) => setNews(d.announcements), () => {});
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 15 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Mail
  const [threads, setThreads] = useStored('threads');
  // Threads in mailboxes this user can open in this workspace, narrowed to one inbox when picked.
  const wsThreads = useMemo(() => threads.filter((t) => myAccounts.some((a) => a.id === t.accountId)), [threads, myAccounts]);

  /* ---------------- Throwaway addresses ---------------- */

  const withAccounts = (wsId: string, fn: (list: Account[]) => Account[]) => setWorkspaces((list) => list.map((w) => (w.id === wsId ? { ...w, accounts: fn(w.accounts) } : w)));
  /** Delete one, its mail with it. A person doing it gets Undo; the timer does it quietly. */
  const deleteTemp = (a: Account, quiet = false) => {
    const w = workspaces.find((x) => x.accounts.some((y) => y.id === a.id));
    if (!w) return;
    const gone = threads.filter((t) => t.accountId === a.id);
    withAccounts(w.id, (l) => l.filter((x) => x.id !== a.id));
    setThreads((ts) => ts.filter((t) => t.accountId !== a.id));
    if (activeAccount === a.id) setActiveAccount('all');
    if (!quiet)
      showToast({
        text: t('{email} deleted', { email: a.email }),
        // The address goes back first; its mail follows once the server knows the address again (or it would be refused).
        action: { label: t('Undo'), run: () => (withAccounts(w.id, (l) => [...l, a]), setTimeout(() => setThreads((ts) => [...ts, ...gone]), 900)) },
      });
  };
  // Time's up: the people who can see an address clear it out (whoever opens the app first).
  const sweepRef = useRef(() => {});
  sweepRef.current = () => {
    const now = new Date().toISOString();
    workspaces.forEach((w) => w.accounts.filter((a) => a.temp?.expiresAt && a.temp.expiresAt < now && a.users.includes(user.id)).forEach((a) => deleteTemp(a, true)));
  };
  useEffect(() => {
    sweepRef.current();
    const t = setInterval(() => sweepRef.current(), 60_000);
    return () => clearInterval(t);
  }, []);
  /** Until real mail flows in: a test message, so you can see how codes show up. */
  const testTemp = (a: Account) => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setThreads((ts) => [
      {
        id: uid(),
        accountId: a.id,
        subject: t('Test: your verification code is {code}', { code }),
        location: 'inbox',
        starred: false,
        unread: true,
        labels: [],
        messages: [{ id: uid(), from: { name: 'sprint2go test', email: 'test@s2g.email' }, to: [{ name: a.email, email: a.email }], date: nowIso(), body: t('This is a test message for {email}.\n\nYour verification code is {code}. It expires in 10 minutes.', { email: a.email, code }) }],
      },
      ...ts,
    ]);
    setActiveAccount(a.id);
    if (mode !== 'mail') go('mail');
  };
  // Blocked senders (per user): their mail never shows outside Trash.
  const [blocked, setBlocked] = usePersisted<BlockRule[]>(`pm-blocked:${user.id}`, []);
  const [unsubscribed, setUnsubscribed] = usePersisted<Record<string, string>>(`pm-unsub:${user.id}`, {});
  const isBlocked = (email: string) => {
    const e = email.toLowerCase();
    return blocked.some((b) => (b.kind === 'address' ? b.value === e : e.endsWith('@' + b.value)));
  };
  const incomingFrom = (t: Thread) => [...t.messages].reverse().find((m) => !isMine(m.from.email))?.from;
  const fromBlocked = (t: Thread) => {
    const f = incomingFrom(t);
    return !!f && isBlocked(f.email);
  };
  const scopedAll = useMemo(() => (activeAccount === 'all' ? wsThreads : wsThreads.filter((t) => t.accountId === activeAccount)), [wsThreads, activeAccount]);
  const scoped = useMemo(() => scopedAll.filter((t) => t.location === 'trash' || !fromBlocked(t)), [scopedAll, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // AI to-dos
  const [todos, setTodos] = useStored('todos');
  const myTodos = useMemo(() => todos.filter((t) => t.userId === user.id), [todos, user.id]);
  const todosRef = useRef(todos);
  todosRef.current = todos;
  const [, setScanning] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Thread | null>(null);
  const [view, setView] = useState<View>({ kind: 'folder', id: 'inbox' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readerOpen, setReaderOpen] = useState(false); // narrow screens: list vs reader
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MailFilter>('all');
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Latest values for timers that fire later.
  const latest = useRef({ threads, notifyOpens: settings.notifyOpens, workspaces: allWorkspaces });
  latest.current = { threads, notifyOpens: settings.notifyOpens, workspaces: allWorkspaces };

  // Calendar
  const [events, setEvents] = useStored('events');
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [extCals, setExtCals] = useStored('calendars');
  const [shownMates, setShownMates] = useState<Set<string>>(new Set());
  const [connectCal, setConnectCal] = useState<false | true | 'holidays'>(false);
  const [calCursor, setCalCursor] = useState(new Date());
  // The last view, remembered on this device (phones and wide screens each keep their own).
  const [calViewPhone, setCalViewPhone] = usePersisted<CalView>('s2g-cal-view:phone', 'schedule');
  const [calViewWide, setCalViewWide] = usePersisted<CalView>('s2g-cal-view:wide', 'week');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [newEventAt, setNewEventAt] = useState<Date | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Todo | null>(null); // a task getting a time (Schedule)
  const calView = mobile ? calViewPhone : calViewWide;
  const setCalView = (v: CalView) => (mobile ? setCalViewPhone(v) : setCalViewWide(v));

  // Drive
  const [drive, setDrive] = useStored('drive');
  const [driveSection, setDriveSection] = useState<DriveSection>('my');
  const [driveFolder, setDriveFolder] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ item: DriveItem; list: DriveItem[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Team: clients, chat, notifications, meetings
  const [clients, setClients] = useStored('clients');
  const [channels, setChannels] = useStored('channels');
  const [quotes, setQuotes] = useStored('quotes');
  const [messages, setMessages] = useStored('messages');
  const [notices, setNotices] = useStored('notices');
  const [meetings, setMeetings] = useStored('meetings');
  const [taskScope, setTaskScope] = usePersisted<TaskScope>('s2g-task-scope', { kind: 'today' }); // the last one used, on this device
  const [taskBrowse, setTaskBrowse] = useState(false); // phones: Tasks' Browse, the root of its stack (TasksView)
  // The Projects app: all projects, past ones, or one project's hub.
  const [projScope, setProjScope] = useState<TaskScope>({ kind: 'projects' });
  const [projNew, setProjNew] = useState(0); // bumps to open the "new project" form
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'workload' | 'quotes' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal' | undefined>(undefined);
  const [teams, setTeams] = useStored('teams');
  registerStages([], undefined, { clients, teams }); // projects and teams with stages of their own
  const [statuses, setStatuses] = useStored('statuses');
  const [savedTemplates, setSavedTemplates] = useStored('templates');
  const [tplOpen, setTplOpen] = useState<{ clientId?: string } | null>(null);
  const [chanDialog, setChanDialog] = useState<{ id?: string } | null>(null);
  const [notes, setNotes] = useStored('notes');
  // Tables: the company's own databases (leads, pipelines…). Table structure and rows sync separately.
  const [tables, setTables] = useStored('tables');
  const [tableRows, setTableRows] = useStored('rows');
  const [tableId, setTableId] = usePersisted<string | null>('s2g-table', null);
  const [tableRow, setTableRow] = useState<string | null>(null);
  const [newTableFor, setNewTableFor] = useState<{ clientId?: string } | null>(null);
  const [teamId, setTeamId] = usePersisted<string | null>('s2g-team', null);
  const [newTeam, setNewTeam] = useState(false);
  // Vault: only titles and who can use them are loaded; passwords come from the server one at a time.
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultFilter, setVaultFilter] = useState('');
  const [vaultEditing, setVaultEditing] = useState<VaultItem | 'new' | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notesFilter, setNotesFilter] = useState<NotesFilter>('all');
  const [noteOpenAt, setNoteOpenAt] = useState<{ find?: string; fresh?: boolean }>({}); // open a note at a search match, or new
  // Quick capture: a note from anywhere (More's New row), or text and links shared from another app (/notes/new).
  const [quickNote, setQuickNote] = useState<{ shared?: { title?: string; text?: string; url?: string } } | null>(() => {
    if (!/^\/notes\/new\/?$/.test(location.pathname)) return null;
    const q = new URLSearchParams(location.search);
    const shared = { title: q.get('title') ?? undefined, text: q.get('text') ?? undefined, url: q.get('url') ?? undefined };
    return { shared: shared.title || shared.text || shared.url ? shared : undefined };
  });
  const [askSeed, setAskSeed] = useState(''); // a question handed to Ask AI from search
  const [focusMsg, setFocusMsg] = useState<string | null>(null); // a notification lands on this chat message
  const [viewAs, setViewAs] = useState<{ clientId: string; email: string } | null>(null); // "View as client"
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatPage, setChatPage] = useState<ChatPage | null>(null); // Catch up, Threads, Drafts and sent, Saved
  const [huddleId, setHuddleId] = useState<string | null>(null); // the channel whose huddle I'm in
  const [meetPage, setMeetPage] = useState<MeetPage>({ kind: 'list' });
  const [sendBotOpen, setSendBotOpen] = useState(false);
  // Sending the notetaker to a calendar event that has no link it can join: the dialog asks, with the event filled in.
  const [sendBotSeed, setSendBotSeed] = useState<{ title: string; fromEvent: string; attendees: string[]; note?: string } | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [sharedPreview, setSharedPreview] = useState<string | null>(null);
  const [askScope, setAskScope] = useState<AskScope | null>(null);
  // The launcher's apps on phones: the person's own order (Edit apps), else their team's or company's (Settings, Apps
  // on phones), else the usual one. A phone bar saved before the launcher moves over: its apps first.
  const [oldBar] = useState(() => {
    try {
      const bar = JSON.parse(localStorage.getItem(lsKey(`s2g-tabbar:${user.id}`)) ?? 'null') as string[] | null;
      return migrateBar(bar, JSON.parse(localStorage.getItem(lsKey(`s2g-tabbar:own:${user.id}`)) ?? 'false') === true);
    } catch {
      return null;
    }
  });
  const [ownApps, setOwnApps] = usePersisted<AppOrder | null>(`s2g-launcher:${user.id}`, oldBar);
  const [editingApps, setEditingApps] = useState(false);
  const [askChats, setAskChats] = usePersisted<AskChat[]>(`s2g-ask-chats:${user.id}`, []);
  const [joinOverrides, setJoinOverrides] = usePersisted<Record<string, boolean>>(`s2g-join:${user.id}`, {});
  const [sentEvents, setSentEvents] = useState<Record<string, string>>({});
  const botTimers = useRef<Record<string, number[]>>({});
  // The real meeting recorder (recorder/), when this server has one; otherwise the bot is a demo.
  const [recorderOn, setRecorderOn] = useState(false);
  useEffect(() => {
    if (server.on) void fetch('/api/meet/status').then((r) => (r.ok ? r.json() : null)).then((x) => setRecorderOn(!!x?.recorder && x.reachable !== false), () => {});
  }, []);
  const meetingsRef = useRef<Meeting[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [dump, setDump] = useState<string | null>(null); // null = closed
  // Chat's read markers and mutes (the conversation marks itself read: src/components/chat/Conversation.tsx).
  const [lastRead] = usePersisted<Record<string, string>>(`s2g-read:${user.id}`, {});
  const [chatMuted] = usePersisted<Record<string, string>>(`s2g-chat-muted:${user.id}`, {});

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ms ?? (toast.quiet ? 4000 : 5000));
    return () => clearTimeout(t);
  }, [toast]);

  /** A feature that depends on something not set up: say what's missing (and where to fix it, for admins). */
  const explainOff = (text: string, fix?: SettingsSection) =>
    showToast({ text, ms: 7000, action: fix && ws.members.some((m) => m.userId === user.id && m.role !== 'member') ? { label: t('Set it up'), run: () => (setSettingsSection(fix), go('settings')) } : undefined });
  /** AI is off: why, in one sentence (`notSetUp`: what it means where it was asked for, when AI isn't set up). */
  const aiOff = (notSetUp = t('AI isn’t set up for this company yet. An admin can add an AI key in Settings, AI, or switch to the AI plan.')) =>
    // Unlimited (the operators' Whitelist): nothing to buy; an admin set this person's AI, or the month's limit is reached.
    aiWhy === 'off'
      ? explainOff(t('AI is switched off for you here. Ask your admin.'))
      : aiWhy === 'used-up' && ws.plan?.unlimited
      ? explainOff(t('This month’s AI is used up. Ask your admin.'))
      : aiWhy === 'used-up'
      ? explainOff(t('The company’s AI allowance for this month is used up. An admin can add a top-up in Settings, Plan & billing.'), 'billing')
      : aiWhy === 'down'
        ? explainOff(t('AI isn’t available right now. We’ve been told; try again in a few minutes.'))
        : explainOff(notSetUp, 'ai');
  const openDump = (text: string) => (aiOn ? setDump(text) : aiOff(t('AI isn’t set up for this company yet, so the brain dump can’t turn notes into tasks. An admin can add an AI key in Settings, AI, or switch to the AI plan.')));
  const openAsk = (scope: AskScope) => (aiOn ? setAskScope(scope) : aiOff());
  const botOn = !server.on || caps.demo || inSandbox || recorderOn;
  const openSendBot = () => (botOn ? (setSendBotSeed(null), setSendBotOpen(true)) : explainOff(t('The meeting notetaker isn’t available yet. Recordings and notes start working as soon as it is.')));
  const calendarsOn = !server.on || caps.demo || inSandbox || caps.googleCalendar || caps.microsoftCalendar || caps.calendarLinks;
  const go = (m: Mode) => {
    if (m !== 'settings') setLastMode(m);
    if (m !== mode) window.dispatchEvent(new CustomEvent('s2g:app', { detail: m })); // a calm moment (the install prompt waits for one)
    setMode(m);
    setLauncherState(false);
    setSidebarOpen(false);
    setAccountOpen(false);
    setNoticesOpen(false);
  };

  /* ---------------- Mail ---------------- */

  // New mail arrives live. Refresh pulls the mailboxes again, reconnects when the live connection dropped, and asks
  // the server to check the mail setup again; the list says when mail last came in fresh.
  const [mailLive, setMailLive] = useState(() => ({ down: live.down, at: live.mailAt || Date.now(), offline: live.offline }));
  useEffect(() => {
    const on = () => setMailLive({ down: live.down, at: live.mailAt, offline: live.offline });
    window.addEventListener('s2g:live', on);
    return () => window.removeEventListener('s2g:live', on);
  }, []);
  // Mail offline (src/components/mail/offline.ts): the latest mail is kept on this device a moment after it changes,
  // and email written offline goes out once the connection is back.
  useEffect(() => {
    if (!real || mailLive.offline) return;
    const timer = setTimeout(() => void keepOffline(user.id, store), 4000);
    return () => clearTimeout(timer);
  }, [threads, workspaces, real, mailLive.offline, user.id]);
  useEffect(() => {
    if (!real) return;
    const flush = () =>
      void flushOutbox(user.id, (r) =>
        showToast(r.ok ? { text: t('Sent now that you’re back online: {subject}', { subject: r.subject || t('(no subject)') }) } : { text: r.dlp ? t('Not sent once you were back online: {subject}. {why}', { subject: r.subject || t('(no subject)'), why: dlpWords(r.dlp as DlpStop) }) : t('Not sent once you were back online: {subject}. {why}', { subject: r.subject || t('(no subject)'), why: t(r.why ?? 'The mail engine refused it.') }), ms: 10000 }),
      );
    flush();
    addEventListener('online', flush);
    return () => removeEventListener('online', flush);
  }, [real, user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const readyAsked = useRef(0);
  const refreshMail = async () => {
    if (!real) return void setMailLive({ down: false, at: Date.now(), offline: false });
    // The mailbox check looks at DNS and the server's ports: once a minute is plenty.
    if (Date.now() - readyAsked.current > 60_000) {
      readyAsked.current = Date.now();
      void fetch('/api/mail/ready', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id }) }).catch(() => {});
    }
    try {
      await resync(['threads', 'workspaces']);
    } catch {
      showToast({ text: t('Couldn’t reach the server. Check your connection, then try again.') });
    }
  };

  // Emails that asked you to do something (the AI's to-dos from mail, not done yet): Mail's To-do list.
  const todoThreads = useMemo(() => new Set(myTodos.filter((t) => t.threadId && !t.done).map((t) => t.threadId!)), [myTodos]);
  // The project an email is with, by the sender's domain (as clientForThread, which is defined further down).
  const projectOfThread = (t: Thread) => clients.find((c) => c.workspaceId === ws.id && c.domain && t.messages.some((m) => peopleOf(m).some((p) => p.email.toLowerCase().endsWith('@' + c.domain))))?.id;
  // The person's inbox settings: tabs, order, conversation view, auto-advance (components/mail/sortPrefs.ts).
  const [mailPrefs] = useMailPrefs();
  const mailTabs = useMemo(() => tabsOn(mailPrefs), [JSON.stringify(mailPrefs.tabs)]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewCtx: ViewCtx = { me: user.id, todo: todoThreads, projectOf: projectOfThread, tabs: mailTabs };
  // The search box reads Gmail's operators (src/mailQuery.ts, the same as the server, the AI connector and IMAP).
  const parsedQuery = useMemo(() => parseQuery(query), [query]);
  const queryCtx = { isMine, labelName: (id: string) => store.mailLabels.find((l) => l.id === id)?.name }; // label:Clients in a search (labels: src/components/mail/Organize.tsx)
  /** Whether an email passes the chip under the title (Unread, Needs reply, Assigned to me, Attachments) and the search. */
  const passes = (t: Thread) =>
    (filter === 'all' ||
      (filter === 'unread' && t.unread) ||
      (filter === 'reply' && needsReply(t, isMine)) ||
      (filter === 'assigned' && t.assignee === user.id) ||
      (filter === 'files' && threadHasAttachment(t))) && // pictures inside the words don't count (src/mailAttachments.ts)
    (!parsedQuery || matchThread(parsedQuery, t, queryCtx));
  /** A search looks through all mail, as in Gmail (in:inbox, label: and the rest narrow it); otherwise the view. */
  const inList = (t: Thread) => (parsedQuery ? true : inView(t, view, viewCtx)) && passes(t);
  const visible = useMemo(() => {
    const list = scoped.filter(inList).sort((a, b) => lastMessage(b).date.localeCompare(lastMessage(a).date));
    const ordered = !parsedQuery && view.kind === 'folder' && view.id === 'inbox' ? sortInbox(list, mailPrefs.inboxType) : list;
    return mailPrefs.conversation ? ordered : splitRows(ordered); // conversation view off: a row per email
  }, [scoped, view, filter, parsedQuery, todoThreads, clients, mailTabs, mailPrefs.inboxType, mailPrefs.conversation]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Whether an email would still be in this list after a change (a swipe only slides out what really leaves). */
  const staysInList = (t: Thread, patch: Partial<Thread>) => inList({ ...t, ...patch });
  /** With conversation view off, the open row is one email of the conversation (`thread~message`). */
  const [rowMsg, setRowMsg] = useState<string | null>(null);
  /** The whole inbox (every tab), for the tabs' news; a section's search for multiple inboxes. */
  const inboxAll = useMemo(() => scoped.filter((t) => inView(t, { kind: 'folder', id: 'inbox' })), [scoped]);
  const sectionMatch = useCallback(
    (q: string) => scoped.filter((t) => matchThread(parseQuery(q), t, queryCtx)).sort((a, b) => lastMessage(b).date.localeCompare(lastMessage(a).date)),
    [scoped], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selectedRow = selectedId && !mailPrefs.conversation && rowMsg && visible.some((r) => r.id === selectedId + '~' + rowMsg) ? selectedId + '~' + rowMsg : selectedId;

  const counts = useMemo(
    () => ({
      inbox: scoped.filter((t) => inView(t, { kind: 'folder', id: 'inbox' }) && t.unread).length,
      drafts: scoped.filter((t) => t.location === 'drafts' && !t.sendAt).length,
      scheduled: scoped.filter((t) => t.sendAt).length,
      assigned: scoped.filter((t) => inView(t, { kind: 'folder', id: 'assigned' }, { me: user.id }) && t.location === 'inbox').length,
      spam: scoped.filter((t) => t.location === 'spam' && t.unread).length,
    }),
    [scoped],
  );

  const accountUnread = useMemo(() => {
    const r: Record<string, number> = { all: 0 };
    for (const t of wsThreads) if (t.location === 'inbox' && t.unread) {
      r[t.accountId] = (r[t.accountId] ?? 0) + 1;
      r.all++;
    }
    return r;
  }, [wsThreads]);

  const wsUnread = useMemo(() => {
    const r: Record<string, number> = {};
    for (const w of workspaces)
      r[w.id] = threads.filter((t) => t.location === 'inbox' && t.unread && w.accounts.some((a) => a.id === t.accountId && a.users.includes(user.id))).length;
    return r;
  }, [threads, workspaces]);

  const switchWorkspace = (id: string) => {
    if (id === ws.id) return;
    setWsId(id);
    setActiveAccount('all');
    setSelectedId(null);
    setReaderOpen(false);
    setView({ kind: 'folder', id: 'inbox' });
    setQuery('');
    setDriveFolder(null);
    setSelectedEventId(null);
    setSidebarOpen(false);
    if (mode === 'settings') setMode(lastMode);
  };

  /* ---------------- The demo company (src/sandbox.ts, server/sandbox.ts) ---------------- */

  const sandboxWs = workspaces.find((w) => isSandbox(w));
  /** Opens their own demo company: made the first time, shown again when it was hidden. */
  const openDemo = async () => {
    if (sandboxWs) return (switchWorkspace(sandboxWs.id), go('home'));
    setDemoBusy(true);
    const r = await openDemoCompany();
    if (r.error) return (setDemoBusy(false), showToast({ text: r.error, ms: 7000 }));
    await reloadAll().catch(() => {});
    setDemoBusy(false);
    if (r.workspaceId) switchWorkspace(r.workspaceId);
    go('home');
  };
  const hideDemo = async () => {
    const other = workspaces.find((w) => !isSandbox(w));
    setDemoBusy(true);
    const err = await hideDemoCompany();
    setDemoBusy(false);
    if (err) return showToast({ text: err });
    if (other) switchWorkspace(other.id);
    await reloadAll().catch(() => {});
    showToast({ text: t('The demo company is hidden. Help & support brings it back.'), ms: 7000, action: { label: t('Undo'), run: () => void openDemo() } });
  };
  const resetDemo = async (): Promise<boolean> => {
    const err = await resetDemoCompany();
    if (err) return (showToast({ text: err }), false);
    await reloadAll().catch(() => {});
    setResettingDemo(false);
    go('home');
    showToast({ text: t('The demo company is new again') });
    return true;
  };
  /** In the switcher until it's made: "Demo company". Hidden ones come back from Help & support, not from here. */
  const demoEntry = !sandboxWs && demo?.allowed && demo.state === 'none' ? { busy: demoBusy, onOpen: () => void openDemo() } : null;
  /** Ticks something off the demo company's "Try this" list (only when it was really done there). */
  const tried = (key: TryKey) => {
    if (!inSandbox) return;
    setWorkspaces((list) => list.map((w) => (w.id === ws.id && w.sandbox && !w.sandbox.tried?.includes(key) ? { ...w, sandbox: { ...w.sandbox, tried: [...(w.sandbox.tried ?? []), key] } } : w)));
  };
  /** "Try this" back on the demo company's Home (from Help & support). */
  const showTryList = () => {
    if (!sandboxWs?.sandbox) return void openDemo();
    patchWorkspace(sandboxWs.id, { sandbox: { ...sandboxWs.sandbox, listOff: false } });
    switchWorkspace(sandboxWs.id);
    go('home');
  };
  /** "Show me": where each thing on the list is done (it doesn't do it for them). */
  const goTry = (key: TryKey) => {
    const id = (seedId: string) => `${sandboxWsId(user.id)}-${seedId}`;
    const has = <T extends { id: string }>(list: T[], x: string) => list.some((d) => d.id === x);
    switch (key) {
      case 'reply':
      case 'email-task':
        return has(threads, id('t1')) ? openThread(id('t1')) : go('mail');
      case 'stage':
        return openTasks({ kind: 'mine' });
      case 'ask':
        return openAsk(has(clients, id('c-kopinara')) ? { kind: 'client', id: id('c-kopinara') } : { kind: 'all' });
      case 'guest':
        return has(clients, id('c-kopinara')) ? openClient(id('c-kopinara'), 'portal') : go(enabled.has('projects') ? 'projects' : 'tasks');
      case 'voice':
        return openChannel(has(channels, id('dm-raka-bima')) ? id('dm-raka-bima') : (wsChannels[0]?.id ?? ''));
      case 'event':
        return (go('calendar'), openNewEvent());
      case 'meeting':
        return has(meetings, id('mt-kopinara')) ? openMeeting(id('mt-kopinara')) : go('meet');
    }
  };

  // Compose suggests saved contacts and the people you write to most first (server/mailContacts.ts), then the rest.
  const ranked = useComposeContacts(ws.id);
  const contacts = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of ranked) if (!isMine(p.email)) map.set(p.email, p);
    const first = map.size;
    for (const t of wsThreads) for (const m of t.messages) for (const p of peopleOf(m)) map.set(p.email, p);
    for (const e of events) for (const g of e.guests ?? []) map.set(g.email, g);
    for (const e of [...map.keys()]) if (isMine(e)) map.delete(e);
    const all = [...map.values()];
    return [...all.slice(0, first), ...all.slice(first).sort((a, b) => a.name.localeCompare(b.name))];
  }, [wsThreads, events, ranked]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = threads.find((t) => t.id === selectedId) ?? null;
  const selectedAcct = selected ? accountOf(selected.accountId) : undefined;
  const wsAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');

  const update = (id: string, patch: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const openCompose = (init?: Omit<ComposeState, 'key'>) => {
    // No mailbox can send yet: say why instead of opening a window that can't send.
    if (!mailOut && myAccounts.length) {
      showToast({ text: mailWhy.send ? t('Sending isn’t set up yet. {why}', { why: t(mailWhy.send) }) : t('Sending isn’t set up yet.'), ms: 7000, action: wsAdmin ? { label: t('Set it up'), run: () => (setSettingsSection('email'), go('settings')) } : undefined });
      return;
    }
    // An email already being written (parked as a pill on a phone, or minimised): Compose brings it back; anything
    // else opening over it keeps it in Drafts first, so nothing written is ever lost.
    if (compose) {
      if (!init && compose.parked) return void setCompose({ ...compose, parked: false });
      const was = composeNow.current?.();
      if (was) closeCompose(was);
    }
    setCompose({ key: Date.now(), ...init });
    setSidebarOpen(false);
  };
  /** What the open Compose holds right now (Compose fills this in). */
  const composeNow = useRef<(() => Outgoing | null) | null>(null);

  const open = useCallback(
    (row: string) => {
      // Conversation view off: a row is one email of a conversation (components/mail/sortPrefs.ts).
      const { thread: id, message } = rowOf(row);
      setRowMsg(message ?? null);
      const t = threads.find((x) => x.id === id);
      if (t?.location === 'drafts') {
        const m = t.messages[0];
        openCompose({
          draftId: t.id,
          initial: { to: m.to, cc: m.cc ?? [], bcc: m.bcc ?? [], subject: t.subject === '(no subject)' ? '' : t.subject, html: m.html ?? m.body.replace(/\n/g, '<br>'), text: m.body, files: filesOf(m), track: settings.trackByDefault, trackOptions: m.trackOptions ?? DEFAULT_TRACK_OPTIONS, fromId: t.accountId, ...draftExtras(m) },
        });
        return;
      }
      setSelectedId(id);
      setReaderOpen(true);
      setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, unread: false } : x)));
      // Seen here: its notices (given to you, a mention) are read too, so no phone buzzes for it later.
      if (notices.some((n) => !n.read && n.userId === user.id && n.link?.app === 'mail' && n.link.id === id)) setNotices((ns) => ns.map((n) => (!n.read && n.userId === user.id && n.link?.app === 'mail' && n.link.id === id ? { ...n, read: true } : n)));
    },
    [threads, notices], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * After emails leave the list: the reader moves on to the next one on desktop, and goes back to the list on phones
   * (where the row folding away is the clearest sign it worked).
   */
  const leaveReader = (gone: string[]) => {
    if (!selectedId || !gone.includes(selectedId)) return;
    // Auto-advance (Settings, Mail): the newer or older email, or back to the list. As usual: the next one on a
    // computer, the list on a phone.
    const to = advanceTo(mailPrefs.advance, mobile);
    if (to === 'list') return mobile ? setReaderOpen(false) : (setSelectedId(null), setReaderOpen(false));
    const base = (r: Thread) => rowOf(r.id).thread;
    const idx = visible.findIndex((t) => base(t) === selectedId);
    const after = visible.slice(idx + 1).find((t) => !gone.includes(base(t)));
    const before = visible.slice(0, Math.max(0, idx)).reverse().find((t) => !gone.includes(base(t)));
    const next = to === 'older' ? (after ?? (mobile ? undefined : before)) : (before ?? (mobile ? undefined : after));
    if (next) open(next.id);
    else (setSelectedId(null), setReaderOpen(false));
  };
  /**
   * One change to one or several emails: the list folds away whatever leaves it, the reader moves on, and the toast's
   * Undo puts back only what this changed (not anything else that happened since).
   */
  const changeMail = (ids: string[], patch: (t: Thread) => Partial<Thread>, text: string | null) => {
    const set = new Set(ids.map((id) => rowOf(id).thread)); // rows of single emails act on their conversation
    const list = threads.filter((t) => set.has(t.id));
    if (!list.length) return;
    const old = new Map(list.map((t) => [t.id, Object.fromEntries(Object.keys(patch(t)).map((k) => [k, t[k as keyof Thread]])) as Partial<Thread>]));
    leaveReader(list.filter((t) => !staysInList(t, patch(t))).map((t) => t.id));
    setThreads((ts) => ts.map((t) => (set.has(t.id) ? { ...t, ...patch(t) } : t)));
    if (text) showToast({ text, action: { label: t('Undo'), run: () => setThreads((ts) => ts.map((x) => (old.has(x.id) ? { ...x, ...old.get(x.id) } : x))) } });
  };
  const n1 = (ids: string[]) => ids.length === 1;
  const mailActions: MailActions = {
    done: (ids) => changeMail(ids, () => ({ location: 'archive' }), n1(ids) ? t('Marked done. It’s in Archive') : t('{n} emails marked done', { n: ids.length })),
    inbox: (ids) => changeMail(ids, () => ({ location: 'inbox' }), n1(ids) ? t('Moved to Inbox') : t('{n} emails moved to Inbox', { n: ids.length })),
    trash: (ids) => changeMail(ids, () => ({ location: 'trash' }), n1(ids) ? t('Moved to Trash') : t('{n} emails moved to Trash', { n: ids.length })),
    spam: (ids) => changeMail(ids, () => ({ location: 'spam' }), n1(ids) ? t('Reported as spam') : t('{n} emails reported as spam', { n: ids.length })),
    star: (ids, on) => changeMail(ids, () => ({ starred: on }), ids.length > 1 ? (on ? t('{n} emails starred', { n: ids.length }) : t('{n} emails unstarred', { n: ids.length })) : null),
    read: (ids, unread) => changeMail(ids, () => ({ unread }), ids.length > 1 ? (unread ? t('{n} emails marked as unread', { n: ids.length }) : t('{n} emails marked as read', { n: ids.length })) : null),
    snooze: (ids, until, ifNoReply) => {
      const when = whenWords(new Date(until));
      const n = ids.length;
      const text = n === 1 ? (ifNoReply ? t('Snoozed until {when}, if nobody replies', { when }) : t('Snoozed until {when}', { when })) : ifNoReply ? t('{n} emails snoozed until {when}, if nobody replies', { n, when }) : t('{n} emails snoozed until {when}', { n, when });
      changeMail(ids, (th) => snoozePatch(th, until, ifNoReply), text);
    },
  };
  const archive = (id: string) => mailActions.done([id]);
  const trash = (id: string) => mailActions.trash([id]);
  const spam = (id: string) => mailActions.spam([id]);
  const toInbox = (id: string) => mailActions.inbox([id]);
  const star = (id: string) => mailActions.star([id], !threads.find((t) => t.id === id)?.starred);
  const markUnread = (id: string) => {
    update(id, { unread: true });
    setSelectedId(null);
    setReaderOpen(false);
  };
  /** Where the open email sits in the list: its neighbours are the reader's previous and next. */
  const selIdx = visible.findIndex((t) => t.id === selectedRow);
  /** A teammate by an address of theirs: their sign-in, or a personal mailbox that's theirs. */
  const userForEmail = (email: string) => {
    const e = email.toLowerCase();
    return members.find((u) => u.email.toLowerCase() === e) ?? members.find((u) => ws.accounts.some((a) => a.kind === 'personal' && a.email.toLowerCase() === e && a.users.includes(u.id)));
  };
  /** A message's files as Compose takes them (drafts, forwards): the ones kept on the server, not pictures inside it. */
  const filesOf = (m: Message) => (m.attachments ?? []).filter((a) => a.url && !a.inline && !a.cid && !a.blocked).map((a) => ({ name: a.name, size: parseSize(a.size), url: a.url!, type: a.type }));
  /** Forward: a new email with the last message quoted under your signature, and its files attached. */
  const forward = (th: Thread, one?: Message) => {
    const m = one ?? lastMessage(th);
    // A confidential email someone sent here can't be forwarded (its words aren't in it; server/mailConfidential.ts).
    if (m.confidential && !m.confidential.sender) return showToast({ text: t('Confidential: it can’t be forwarded') });
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<p><br></p>${settings.signature}<p><br></p><p>${esc(t('Forwarded message from {name} <{email}>, {date}', { name: m.from.name, email: m.from.email, date: fullDate(m.date) }))}</p><blockquote>${m.html ? sanitize(m.html) : textToHtml(m.body)}</blockquote>`;
    openCompose({
      initial: {
        to: [],
        cc: [],
        bcc: [],
        subject: /^fwd?:/i.test(th.subject) ? th.subject : `Fwd: ${th.subject}`,
        html,
        text: htmlToText(html),
        files: filesOf(m),
        track: settings.trackByDefault,
        trackOptions: DEFAULT_TRACK_OPTIONS,
        fromId: th.accountId,
      },
    });
  };

  const replyWhy = (acct: { id: string; email: string }) => {
    const own = boxReady(acct.id).sendWhy;
    if (own) return t(own);
    const why = boxReady(acct.id).why ?? mailWhy.send;
    return why ? t('Replies can’t go out from {email} yet. {why}', { email: acct.email, why: t(why) }) : t('Replies can’t go out from {email} yet.', { email: acct.email });
  };
  const replyBlocked = (acct: { id: string; email: string }) =>
    showToast({ text: replyWhy(acct), ms: 7000, action: wsAdmin ? { label: t('Set it up'), run: () => (setSettingsSection('email'), go('settings')) } : undefined });
  /**
   * Undo send for real: the mail engine keeps each email for the sender's Undo window (Settings, Mail) before anything
   * leaves, so taking it back means nobody gets it. `then` runs once the server has it back.
   */
  const takeBack = (threadId: string, messageId: string, then: () => void) =>
    void fetch('/api/mail/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId, messageId }) }).then(
      async (r) => (r.ok ? then() : showToast({ text: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? t('It couldn’t be taken back.') })),
      () => showToast({ text: t('No connection: it couldn’t be taken back.') }),
    );
  /** After the mail engine took an email: "sent", with Undo for as long as it's still waiting there. */
  const sentToast = async (r: Response, text: string, undo: () => void) => {
    const d = (await r.json().catch(() => ({}))) as { held?: boolean; until?: string; note?: string };
    const left = d.held && d.until ? Date.parse(d.until) - Date.now() - 300 : 0;
    // `note`: a local server kept it on this computer instead of sending it out.
    if (d.note) text = d.note;
    showToast(left > 1000 ? { text, ms: Math.max(left, d.note ? 6000 : 0), action: { label: t('Undo'), run: undo } } : { text, ms: d.note ? 6000 : undefined });
  };
  const [restoreReply, setRestoreReply] = useState<{ threadId: string; html: string; text: string; key: number; files?: OutgoingFile[] } | null>(null);

  /** Why the mail engine didn't take an email, as a sentence that ends properly. */
  const refusal = async (r: Response | null, fallback: string) => {
    const why = (r ? (((await r.json().catch(() => ({}))) as { error?: string }).error ?? fallback) : t('There’s no connection.')).trim();
    return /[.!?]$/.test(why) ? why : `${why}.`;
  };

  /** Files in `opts.files` are uploaded already; big ones go as Drive links, made first (attachments round). */
  const reply = (id: string, html: string, text: string, track = false, all = false, opts: ReplyOpts = {}) => {
    const big = (opts.files ?? []).filter((f) => f.link);
    const th0 = threads.find((x) => x.id === id);
    if (real && big.length && th0) {
      const last0 = lastMessage(th0);
      const people = (opts.to || opts.cc ? [...(opts.to ?? []), ...(opts.cc ?? [])] : [last0.from, ...last0.to]).map((p) => p.email).filter((e) => !isMine(e));
      void makeFileLinks(big.map((f) => ({ name: f.name, url: f.url, size: f.size ?? 0 })), 'recipients', people, ws.id).then(
        (add) => replyNow(id, html + (add?.html ?? ''), text + (add?.text ?? ''), track, all, { ...opts, files: (opts.files ?? []).filter((f) => !f.link) }),
        (e: Error) => showToast({ text: t('Reply not sent. {why} What you wrote is back in the reply box.', { why: e.message }), ms: 10000 }),
      );
      return;
    }
    replyNow(id, html, text, track, all, opts);
  };
  /**
   * A reply in its conversation. Who it goes to follows Gmail (src/mailPeople.ts: Reply-To, Reply all keeps Cc as Cc)
   * unless the reply box changed it (`opts`: the people, the subject, priority, plain text).
   */
  const replyNow = (id: string, html: string, text: string, track: boolean, all: boolean, opts: ReplyOpts & { dlpAck?: boolean }) => {
    const th = threads.find((x) => x.id === id);
    if (!th) return;
    const acct = accountOf(th.accountId);
    if (acct && !boxReady(acct.id).send) return replyBlocked(acct);
    const last = lastMessage(th);
    const people = replyPeople(last, all, isMine);
    const to = opts.to ?? people.to;
    const cc = opts.cc ?? people.cc;
    const bcc = opts.bcc ?? [];
    const subject = opts.subject?.trim() || (/^re:/i.test(th.subject) ? th.subject : `Re: ${th.subject}`);
    // From the address it was written to (an alias of this mailbox), with that address's signature.
    const fromAddress = opts.fromAddress ?? replyAddress(th);
    const from = { ...senderFor(acct), email: fromAddress || senderFor(acct).email };
    const msgId = uid();
    // Tracked like a new email: only people outside the team, and only when the company allows it.
    const outside = [...to, ...cc].filter((p) => !isTeam(p.email));
    const tracked = track && ws.readTracking !== false && outside.length > 0 && !opts.confidential;
    const tracking = tracked ? Object.fromEntries(outside.map((p) => [p.email, { opens: [], clicks: [] }])) : undefined;
    const attachments = opts.files?.length ? opts.files.map((f) => ({ name: f.name, size: sizeText(f.size ?? 0), url: f.url, ...(f.type ? { type: f.type } : {}) })) : undefined;
    const sendHtml = opts.plain ? undefined : html;
    setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: [...x.messages, { id: msgId, from, to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), ...(opts.replyTo?.length ? { replyTo: opts.replyTo } : {}), ...(opts.priority ? { priority: opts.priority } : {}), ...(opts.plain ? { plain: true } : {}), date: new Date().toISOString(), body: text, html: sendHtml, ...(attachments ? { attachments } : {}), ...(tracked ? { tracking, trackOptions: REPLY_TRACK_OPTIONS } : {}) }] } : x)));
    /** It didn't go: the reply leaves the conversation and its words go back in the reply box, to send again or change. */
    const notSent = (why: string, again?: () => void) => {
      setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: x.messages.filter((m) => m.id !== msgId) } : x)));
      const back = () => setRestoreReply({ threadId: id, html, text, key: Date.now(), files: opts.files?.map((f) => ({ ...f, size: f.size ?? 0 })) });
      back();
      // A data loss warning (server/mailCompliance.ts): "Send anyway" sends it, confirmed.
      showToast({ text: t('Reply not sent. {why} What you wrote is back in the reply box.', { why }), ms: 10000, action: again ? { label: t('Send anyway'), run: again } : { label: t('Open'), run: () => (setSelectedId(id), setReaderOpen(true), back()) } });
    };
    // With the server, the mail engine sends it for real, threaded under the message it answers.
    if (real && acct && (!acct.provider || acct.provider === 'sprint2go')) {
      const refs = th.messages.map((m) => m.mid).filter(Boolean) as string[];
      // With no connection it waits on this device and goes out once the connection is back (Mail offline).
      void sendMail(user.id, { workspaceId: ws.id, accountId: acct.id, threadId: th.id, messageId: msgId, to, cc, bcc, subject, text, html: sendHtml, files: (opts.files ?? []).map((f) => ({ name: f.name, url: f.url })), inReplyTo: last.mid, references: refs, track: tracked, trackOptions: tracked ? { opens: REPLY_TRACK_OPTIONS.opens, clicks: REPLY_TRACK_OPTIONS.clicks, notify: REPLY_TRACK_OPTIONS.notify } : undefined, undoSeconds: settings.undoSend, ...extrasOf({ fromAddress, replyTo: opts.replyTo, priority: opts.priority, confidential: opts.confidential }, acct) , dlpAck: opts.dlpAck }).then(
        async (r) => {
          const stop = await dlpOf(r);
          if (stop) return notSent(dlpWords(stop), stop.action === 'warn' ? () => replyNow(id, html, text, track, all, { ...opts, dlpAck: true }) : undefined);
          return r.ok
            ? sentToast(r, t('Reply sent'), () =>
                takeBack(id, msgId, () => {
                  setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: x.messages.filter((m) => m.id !== msgId) } : x)));
                  setRestoreReply({ threadId: id, html, text, key: Date.now(), files: opts.files?.map((f) => ({ ...f, size: f.size ?? 0 })) });
                }),
              )
            : notSent(await refusal(r, t('The mail engine refused it.')));
        },
        async () => notSent(await refusal(null, '')),
      );
    } else showToast({ text: inSandbox ? t('Reply sent in the demo company. Nothing left it.') : t('Reply sent') });
    if (inSandbox && clientForThread(th)) tried('reply');
  };
  /** The address of this mailbox a conversation was written to: one of its aliases, when that's where it arrived. */
  const replyAddress = (th: Thread): string | undefined => {
    const acct = accountOf(th.accountId);
    if (!acct) return undefined;
    const mine = sendersOf(ws, acct).slice(1);
    const hit = th.messages.flatMap((m) => recipientsOf(m)).find((p) => mine.includes(p.email.toLowerCase()));
    return hit?.email.toLowerCase();
  };
  /** Opens a reply in the full compose window (Gmail's "Pop out reply"), with what the reply box held. */
  const popOutReply = (id: string, draft: { to: Person[]; cc: Person[]; bcc?: Person[]; subject: string; html: string; text: string }) => {
    const th = threads.find((x) => x.id === id);
    if (!th) return;
    const fromAddress = replyAddress(th);
    openCompose({ replyThreadId: id, initial: { to: draft.to, cc: draft.cc, bcc: draft.bcc ?? [], subject: draft.subject, html: draft.html, text: draft.text, files: [], track: settings.trackByDefault, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: th.accountId, ...(fromAddress ? { fromAddress } : {}) } });
  };

  /** `scheduled`: a "send later" draft keeps its tracking, so the server tracks it when it goes out. */
  const toThread = (m: Outgoing, location: Location, id = uid(), scheduled = false): Thread => ({
    id,
    accountId: m.fromId,
    subject: m.subject || '(no subject)',
    location,
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: uid(),
        from: { ...senderFor(accountOf(m.fromId)), ...(m.fromAddress ? { email: m.fromAddress } : {}) },
        to: m.to,
        ...(m.cc.length ? { cc: m.cc } : {}),
        ...(m.bcc?.length ? { bcc: m.bcc } : {}),
        date: new Date().toISOString(),
        body: m.text,
        html: m.plain ? undefined : m.html,
        ...(m.replyTo?.length ? { replyTo: m.replyTo } : {}),
        ...(m.priority ? { priority: m.priority } : {}),
        ...(m.plain ? { plain: true } : {}),
        // A draft (and a scheduled one) keeps what it asked for, so it goes out the same way later (server/mailExtras.ts).
        ...(location === 'drafts' && (m.fromAddress || m.confidential || m.replyTo?.length || m.priority) ? { sendOptions: extrasOf(m, accountOf(m.fromId)) } : {}),
        // With their addresses: a draft, a scheduled email and the sent copy keep their files (attachments round).
        attachments: m.files.length ? m.files.map((f) => ({ name: f.name, size: sizeText(f.size), url: f.url, ...(f.type ? { type: f.type } : {}) })) : undefined,
        trackOptions: m.track && (location !== 'drafts' || scheduled) ? m.trackOptions : undefined,
        tracking:
          m.track && (location !== 'drafts' || scheduled)
            ? Object.fromEntries([...m.to, ...m.cc, ...(m.bcc ?? [])].filter((p) => !isTeam(p.email)).map((p) => [p.email, { opens: [], clicks: [] }]))
            : undefined,
      },
    ],
  });

  /** Files a sent copy and drops copies straight into any of our own recipients' inboxes. */
  const deliver = (m: Outgoing, draftId?: string) => {
    const thread = toThread(m, 'archive');
    // Mail to one of our own mailboxes arrives straight in its inbox (an alias: in each of its mailboxes). With the
    // server, the mail engine does that, for mailboxes this person can't open too.
    // The demo company delivers only to its own mailboxes: nothing in it reaches a real one.
    const pool = inSandbox ? [ws] : allWorkspaces;
    const boxesFor = (email: string) => {
      const e = email.toLowerCase();
      const direct = pool.flatMap((w) => w.accounts).filter((a) => a.email === e);
      return direct.length ? direct : pool.flatMap((w) => (w.mailAliases ?? []).filter((al) => al.address === e).flatMap((al) => w.accounts.filter((a) => al.to.includes(a.id))));
    };
    const delivered: Thread[] = (real ? [] : [...new Map([...m.to, ...m.cc, ...(m.bcc ?? [])].flatMap((p) => boxesFor(p.email)).filter((a) => a.id !== m.fromId).map((a) => [a.id, a] as const)).values()])
      .map((a) => ({
        ...thread,
        id: uid(),
        accountId: a.id,
        location: 'inbox' as const,
        unread: true,
        messages: thread.messages.map((msg) => ({ ...msg, bcc: undefined, tracking: undefined, trackOptions: undefined })),
      }));
    setThreads((ts) => [thread, ...delivered, ...ts.filter((t) => t.id !== draftId)]);
    return { thread, delivered };
  };

  /**
   * The mail engine didn't take it (the mailbox can't send yet, a sending limit, a paused company) or it never got
   * there: nobody got it, so it isn't kept as sent. It goes back to Drafts, untracked, with the reason and a way to
   * open it again (to change it, or to send it once the problem is fixed).
   */
  const notSent = (thread: Thread, m: Outgoing, why: string, again?: () => void) => {
    const draft = toThread(m, 'drafts');
    setThreads((ts) => [draft, ...ts.filter((x) => x.id !== thread.id)]);
    // A data loss warning (server/mailCompliance.ts): "Send anyway" sends the draft, confirmed.
    showToast({ text: t('Not sent. {why} It’s in Drafts.', { why }), ms: 10000, action: again ? { label: t('Send anyway'), run: () => (setThreads((ts) => ts.filter((x) => x.id !== draft.id)), again()) } : { label: t('Open draft'), run: () => openCompose({ draftId: draft.id, initial: m }) } });
  };
  /** The data loss rules' answer to a send (a 409 with `dlp`), or null. */
  const dlpOf = async (r: Response): Promise<DlpStop | null> => (r.status === 409 ? (((await r.clone().json().catch(() => ({}))) as { dlp?: DlpStop }).dlp ?? null) : null);

  /**
   * Files too big for the email go as Drive links (src/components/mail/attachApi.ts): the links are made first and added
   * at the end of what's written, then the email goes as any other. The demo has no links to make: files stay attached.
   */
  const send = (m: Outgoing) => {
    const big = m.files.filter((f) => f.link);
    // Nothing to share yet when it can't go out (sendNow says why and keeps the draft).
    if (!real || !big.length || (!m.sendAt && !boxReady(m.fromId).send)) return sendNow(m);
    const people = [...m.to, ...m.cc, ...(m.bcc ?? [])].map((p) => p.email);
    void makeFileLinks(big, m.linkAccess ?? 'recipients', people, ws.id).then(
      (add) => sendNow({ ...m, files: m.files.filter((f) => !f.link), html: m.html + (add?.html ?? ''), text: m.text + (add?.text ?? '') }),
      (e: Error) => {
        setCompose(null);
        showToast({ text: t('Not sent. {why}', { why: e.message }), ms: 10000, action: { label: t('Open'), run: () => openCompose({ initial: m }) } });
      },
    );
  };
  const sendNow = (m: Outgoing, dlpAck = false) => {
    if (m.sendAt) {
      // Send later: kept as a scheduled draft until its time (the server does this for real).
      const th = { ...toThread(m, 'drafts', undefined, true), sendAt: m.sendAt };
      setThreads((ts) => [th, ...ts.filter((x) => x.id !== compose?.draftId)]);
      setCompose(null);
      // Undo: not scheduled any more, back to the draft it was (the server sends only what's still scheduled at its time).
      showToast({
        text: t('Scheduled for {when}', { when: whenWords(new Date(m.sendAt)) }),
        action: {
          label: t('Undo'),
          run: () => {
            setThreads((ts) => ts.map((x) => (x.id === th.id ? { ...x, sendAt: undefined } : x)));
            openCompose({ draftId: th.id, initial: { ...m, sendAt: undefined } });
          },
        },
      });
      return;
    }
    const from = accountOf(m.fromId);
    // With the server, a mailbox that can't send keeps the message open instead of pretending it went out.
    if (!demoOk && (!from || !boxReady(from.id).send)) {
      showToast({ text: from ? replyWhy(from) : t('Choose a mailbox that can send.'), ms: 7000, action: wsAdmin ? { label: t('Set it up'), run: () => (setSettingsSection('email'), go('settings')) } : undefined });
      return;
    }
    // A reply popped out of the reader goes into its conversation, like one sent from the reply box.
    if (compose?.replyThreadId) {
      const tid = compose.replyThreadId;
      setCompose(null);
      reply(tid, m.html, m.text, m.track, false, { to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, fromAddress: m.fromAddress, replyTo: m.replyTo, priority: m.priority, confidential: m.confidential, plain: m.plain, files: m.files });
      return;
    }
    // A reply drafted in a connected AI app keeps the conversation's headers, so it lands in the same thread.
    const replyOf = compose?.draftId ? threads.find((x) => x.id === compose.draftId)?.replyTo : undefined;
    const { thread, delivered } = deliver(m, compose?.draftId);
    setCompose(null);
    // With the server: the mail engine really sends it (our own mailboxes already have their copies).
    const handedOver = real && !!from && (!from.provider || from.provider === 'sprint2go');
    if (handedOver) {
      void sendMail(user.id, { workspaceId: ws.id, accountId: from.id, threadId: thread.id, messageId: thread.messages[0].id, ...extrasOf(m, from), to: m.to, cc: m.cc, bcc: m.bcc ?? [], subject: m.subject, text: m.text, html: m.plain ? undefined : m.html, files: m.files.map((f) => ({ name: f.name, url: f.url })), inReplyTo: replyOf?.mid, references: replyOf?.references, track: m.track, trackOptions: m.track ? { opens: m.trackOptions.opens, clicks: m.trackOptions.clicks, notify: m.trackOptions.notify, remindDays: m.trackOptions.remindDays } : undefined, undoSeconds: settings.undoSend , dlpAck }).then(
        async (r) => {
          const stop = await dlpOf(r);
          if (stop) return notSent(thread, m, dlpWords(stop), stop.action === 'warn' ? () => sendNow(m, true) : undefined);
          if (!r.ok) return notSent(thread, m, await refusal(r, t('The mail engine refused it.')));
          // Undo while the mail engine still has it waiting: it comes back as a draft, and nobody got it.
          await sentToast(r, t('Message sent'), () =>
            takeBack(thread.id, thread.messages[0].id, () => {
              setThreads((ts) => ts.map((x) => (x.id === thread.id ? { ...x, location: 'drafts', messages: x.messages.map((msg) => ({ ...msg, delivery: undefined })) } : x)));
              openCompose({ draftId: thread.id, initial: m });
            }),
          );
        },
        async () => notSent(thread, m, await refusal(null, '')),
      );
      return;
    } else if (demoOk && thread.messages[0].tracking) simulateOpen(thread);
    // Without the mail engine (the demo), nothing has left yet: Undo just puts it back.
    const canUndo = !!settings.undoSend && !real;
    showToast({
      text: inSandbox ? t('Sent in the demo company. Nothing left it.') : t('Message sent'),
      ms: canUndo ? settings.undoSend * 1000 : 4000,
      action: canUndo
        ? {
            label: t('Undo'),
            run: () => {
              const gone = new Set([thread.id, ...delivered.map((d) => d.id)]);
              setThreads((ts) => ts.filter((t) => !gone.has(t.id)));
              openCompose({ initial: m });
            },
          }
        : undefined,
    });
  };

  /**
   * DEMO ONLY: pretends the first external recipient opens the email a few seconds
   * after sending, so the live "just opened" flow can be tried without a server.
   * The real tracking service (pixel + click redirects) replaces this.
   */
  const simulateOpen = (thread: Thread) => {
    const msg = thread.messages[0];
    const email = Object.keys(msg.tracking ?? {})[0];
    if (!email) return;
    const who = msg.to.find((p) => p.email === email)?.name ?? email;
    setTimeout(() => {
      if (!latest.current.threads.some((t) => t.id === thread.id)) return; // send was undone
      const open = { at: new Date().toISOString(), device: 'Windows PC · Outlook' };
      setThreads((ts) =>
        ts.map((t) =>
          t.id !== thread.id
            ? t
            : {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === msg.id && m.tracking
                    ? { ...m, tracking: { ...m.tracking, [email]: { ...m.tracking[email], opens: [...m.tracking[email].opens, open] } } }
                    : m,
                ),
              },
        ),
      );
      if (latest.current.notifyOpens)
        showToast({ text: t('{name} just opened “{subject}”', { name: who, subject: thread.subject }), action: { label: t('View'), run: () => openThread(thread.id) } });
    }, 9000);
  };

  const closeCompose = (draft: Outgoing | null) => {
    const draftId = compose?.draftId;
    setCompose(null);
    if (!draft) return;
    const replyTo = draftId ? threads.find((x) => x.id === draftId)?.replyTo : undefined;
    const th = { ...toThread(draft, 'drafts', draftId), ...(replyTo ? { replyTo } : {}) };
    setThreads((ts) => (draftId ? ts.map((x) => (x.id === draftId ? th : x)) : [th, ...ts]));
    showToast({ text: t('Draft saved'), action: { label: t('Open'), run: () => openCompose({ draftId: th.id, initial: draft }) } });
  };

  const selectView = (v: View) => {
    setView(v);
    setSelectedId(null);
    setReaderOpen(false);
    setSidebarOpen(false);
    setQuery('');
    if (v.kind === 'folder' && v.id === 'assigned' && filter === 'assigned') setFilter('all'); // that chip isn't there
    if (mode !== 'mail') go('mail');
  };

  // Scheduled mail goes out on time; snoozed mail comes back to the inbox (the backend does both on the server, for
  // real mailboxes; here only for the demo and the demo company's mailboxes).
  useEffect(() => {
    const tick = () => {
      const now = new Date().toISOString();
      const demoBoxes = new Set(latest.current.workspaces.filter((w) => isSandbox(w)).flatMap((w) => w.accounts.map((a) => a.id)));
      const ours = (t: Thread) => !server.on || demoBoxes.has(t.accountId);
      const due = (t: Thread) => ours(t) && ((!!t.sendAt && t.sendAt <= now) || (!!t.snoozedUntil && t.snoozedUntil <= now));
      if (!latest.current.threads.some(due)) return;
      setThreads((ts) =>
        ts.map((t) => {
          if (!ours(t)) return t;
          if (t.sendAt && t.sendAt <= now) return { ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m) => ({ ...m, date: now })) };
          return wakeThread(t, now) ?? t; // the same rule as the server's (src/mailRules.ts)
        }),
      );
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Task reminders: ping everyone doing the task when its time comes (the backend does this for real companies, with
  // push and email too; here only for the demo and the demo company).
  useEffect(() => {
    const tick = () => {
      const now = new Date().toISOString();
      const due = todosRef.current.filter((t) => (!server.on || isSandboxId(t.workspaceId)) && t.remindAt && !t.reminded && !t.done && t.remindAt <= now);
      if (!due.length) return;
      setTodos((ts) => ts.map((t) => (due.some((d) => d.id === t.id) ? { ...t, reminded: true } : t)));
      setNotices((ns) => [
        ...due.flatMap((t) =>
          (t.assignees?.length ? t.assignees : [t.userId || t.createdBy || '']).filter(Boolean).map((who) => ({ id: uid(), userId: who, workspaceId: t.workspaceId ?? '', kind: 'task' as const, ...(t.due ? msg('Reminder: “{title}”, due {due}', { title: t.title, due: phrase(dueWords(t.due)) }) : msg('Reminder: “{title}”', { title: t.title })), at: now, read: false, link: { app: 'tasks' as const, id: t.id } })),
        ),
        ...ns,
      ]);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A time block for a task just ended and the task isn't done: offer to extend it (once per block).
  const askedBlocks = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const ended = events.find(
        (e) => e.taskId && (e.userId ?? user.id) === user.id && !askedBlocks.current.has(e.id) && new Date(e.end).getTime() <= now && now - new Date(e.end).getTime() < 15 * 60_000 && todos.some((t) => t.id === e.taskId && !t.done),
      );
      if (!ended) return;
      askedBlocks.current.add(ended.id);
      showToast({
        text: t('Time’s up for “{title}”, but it isn’t done', { title: ended.title }),
        action: { label: t('Extend 30 min'), run: () => setEvents((es) => es.map((e) => (e.id === ended.id ? { ...e, end: new Date(Math.max(Date.now(), new Date(e.end).getTime()) + 30 * 60_000).toISOString() } : e))) },
        ms: 15000,
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [events, todos]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchThread = (id: string, patch: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /* ---------------- AI to-dos ---------------- */

  /** Reads new inbox mail and adds the tasks it asks of you. */
  const scan = async (force = false) => {
    // Automatic, once, and only for real client mail: the admin can switch it off, and newsletters,
    // receipts and no-reply senders never reach the AI.
    if (!force && ws.ai?.auto.emailTodos === false) return;
    const clientDomains = new Set(wsClients.map((c) => c.domain).filter(Boolean) as string[]);
    const known = new Set(wsThreads.flatMap((t) => (t.messages.some((m) => isMine(m.from.email)) ? t.messages.flatMap((m) => recipientsOf(m).map((p) => p.email.toLowerCase())) : [])));
    const fresh = wsThreads.filter((t) => {
      if (t.location !== 'inbox' || fromBlocked(t)) return false;
      const last = t.messages[t.messages.length - 1];
      if (isMine(last.from.email) || last.listUnsubscribe) return false;
      const from = last.from.email.toLowerCase();
      if (/no-?reply|notifications?@|billing@|receipts?@|invoice/i.test(from)) return false;
      if (!force && !clientDomains.has(from.split('@')[1]) && !known.has(from) && !isTeam(from)) return false;
      return force || (!scanned.has(`${user.id}:${t.id}:${last.id}`) && !t.scannedFor?.includes(`${user.id}:${last.id}`));
    });
    if (!fresh.length) return;
    // Claim every thread up front so overlapping scans never read the same email twice.
    for (const t of fresh) scanned.add(`${user.id}:${t.id}:${t.messages[t.messages.length - 1].id}`);
    setScanning(true);
    let added = 0;
    for (const t of fresh) {
      const last = t.messages[t.messages.length - 1];
      try {
        const found = await ai.todos(t, settings.name || user.name);
        // A project's email is shared work: if a teammate's app already made this to-do, don't make it again for you.
        const shared = !!clientForThread(t);
        const have = new Set(todosRef.current.filter((x) => x.threadId === t.id && (shared || x.userId === user.id)).map((x) => x.title.toLowerCase()));
        const next = found
          .filter((f) => !have.has(f.title.toLowerCase()))
          .map<Todo>((f) => ({ id: uid(), title: f.title, due: f.due ?? undefined, priority: f.priority, done: false, status: stageIdFor({ workspaceId: ws.id, clientId: clientForThread(t)?.id }, 'open'), threadId: t.id, source: 'ai', userId: user.id, createdBy: user.id, workspaceId: ws.id, clientId: clientForThread(t)?.id, createdAt: new Date().toISOString() }));
        // Remember it on the email itself, so no reload or other device reads it again.
        const mark = `${user.id}:${last.id}`;
        setThreads((ts) => ts.map((x) => (x.id === t.id && !x.scannedFor?.includes(mark) ? { ...x, scannedFor: [...(x.scannedFor ?? []), mark].slice(-20) } : x)));
        if (next.length) {
          todosRef.current = [...todosRef.current, ...next];
          setTodos((list) => [...list, ...next]);
          added += next.length;
        }
      } catch {
        // AI unavailable — try again on the next scan
        scanned.delete(`${user.id}:${t.id}:${last.id}`);
      }
    }
    setScanning(false);
    setTimeout(() => {
      if (added)
        showToast({
          text: tn(added, '✨ Found {n} to-do in your email', '✨ Found {n} to-dos in your email'),
          action: { label: t('View'), run: () => openTasks({ kind: 'mine' }) },
          quiet: true,
        });
      else if (force) showToast({ text: t('No new to-dos found') });
    });
  };

  useEffect(() => {
    scan();
  }, [wsThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Make a task" on an email: a task from it for you, with its project and a link back to the email. */
  const taskFromThread = (id: string) => {
    const th = threads.find((x) => x.id === id);
    if (!th) return;
    const task = createTask({ title: th.subject.replace(/^((re|fwd?)\s*:\s*)+/i, '').trim() || t('Follow up on this email'), userId: user.id, source: 'ai', threadId: th.id, clientId: clientForThread(th)?.id });
    tried('email-task');
    showToast({ text: t('Task made from this email'), action: { label: t('Open'), run: () => openTask(task.id) } });
  };
  const toggleTodo = (id: string) => {
    const t = todos.find((x) => x.id === id);
    if (t) setTaskStatus(id, stageIdFor(t, t.done ? 'open' : 'done'));
  };
  /** Deletes tasks, with Undo (quiet: no toast, e.g. undoing an add that just happened). */
  const deleteTodo = (ids: string | string[], quiet = false) => {
    const gone = new Set(Array.isArray(ids) ? ids : [ids]);
    const snapshot = todos;
    setTodos((list) => list.filter((t) => !gone.has(t.id)));
    if (!quiet) showToast({ text: tn(gone.size, 'Task deleted', '{n} tasks deleted'), action: { label: t('Undo'), run: () => setTodos(snapshot) } });
  };
  /** A task gets a time: how long, then a free slot (the Schedule sheet). From the task's panel, its row and Calendar. */
  const todoToCalendar = (t: Todo) => setScheduling(t);
  const blockTask = (task: Todo, start: Date, minutes: number) => {
    const ev: CalEvent = {
      id: uid(),
      title: task.title,
      calendarId: 'work',
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      threadId: task.threadId,
      taskId: task.id,
      workspaceId: ws.id,
      userId: user.id,
    };
    setEvents((es) => [...es, ev]);
    setScheduling(null);
    showToast({
      text: t('Blocked {when} for “{title}”', { when: whenWords(start), title: task.title }),
      action: { label: t('Undo'), run: () => setEvents((es) => es.filter((e) => e.id !== ev.id)) },
    });
  };

  /* ---------------- Unsubscribe & block ---------------- */

  const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? email;

  const unsubscribe = (th: Thread) => {
    const m = [...th.messages].reverse().find((x) => x.listUnsubscribe);
    const from = incomingFrom(th);
    if (!m || !from) return;
    const at = new Date().toISOString();
    const link = m.listUnsubscribe!.url;
    const openPage = () => /^https?:\/\//i.test(link) && window.open(link, '_blank', 'noopener,noreferrer');
    if (!demoOk) {
      // Senders without one-click unsubscribe: their own page, opened from this click so it isn't blocked.
      if (!m.listUnsubscribe!.oneClick) {
        openPage();
        setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
        showToast({ text: t('{name}’s unsubscribe page is open. Finish there.', { name: from.name }), ms: 6000 });
        return;
      }
      // One-click senders (RFC 8058): the server sends the request for you.
      void fetch('/api/mail/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: th.id }) })
        .then(async (r) => ({ ok: r.ok, d: (await r.json().catch(() => ({}))) as { error?: string; open?: string } }))
        .then(
          ({ ok, d }) => {
            if (ok) {
              setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
              showToast({ text: t('Unsubscribed from {name}', { name: from.name }) });
            } else showToast({ text: d.error ?? t('Couldn’t unsubscribe. Try again.'), ms: 7000, action: d.open ? { label: t('Open their page'), run: () => void openPage() } : undefined });
          },
          () => showToast({ text: t('No connection. Try again.') }),
        );
      return;
    }
    setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
    showToast({ text: m.listUnsubscribe!.oneClick ? t('Unsubscribed from {name}', { name: from.name }) : t('Unsubscribed from {name}, request sent', { name: from.name }) });

    // DEMO ONLY: senders without one-click unsubscribe often keep mailing. Simulate that,
    // so the "still sending → Block" flow can be tried.
    if (demoOk && !m.listUnsubscribe!.oneClick)
      setTimeout(() => {
        const again: Thread = {
          id: uid(),
          accountId: th.accountId,
          subject: 'LAST CHANCE 🔥 Extra 10% off ends tonight',
          location: 'inbox',
          starred: false,
          unread: true,
          labels: [],
          messages: [
            { id: uid(), from, to: th.messages[0].to, date: new Date().toISOString(), body: 'Final hours! Use code LAST10 for an extra 10% off.', listUnsubscribe: m.listUnsubscribe, trackersBlocked: 4 },
          ],
        };
        setThreads((ts) => [again, ...ts]);
        showToast({ text: t('{name} emailed you again after you unsubscribed', { name: from.name }), ms: 8000, action: { label: t('Block'), run: () => setBlockTarget(again) } });
      }, 8000);
  };

  const blockSender = (rule: { value: string; kind: 'address' | 'domain' }, deleteExisting: boolean) => {
    const prevThreads = threads;
    const r: BlockRule = { id: uid(), ...rule, value: rule.value.toLowerCase(), at: new Date().toISOString() };
    const matches = (email: string) => (r.kind === 'address' ? email.toLowerCase() === r.value : email.toLowerCase().endsWith('@' + r.value));
    setBlocked((b) => [...b, r]);
    if (deleteExisting)
      setThreads((ts) => ts.map((t) => (myAccounts.some((a) => a.id === t.accountId) && incomingFrom(t) && matches(incomingFrom(t)!.email) ? { ...t, location: 'trash' } : t)));
    if (blockTarget && selectedId === blockTarget.id) {
      setSelectedId(null);
      setReaderOpen(false);
    }
    setBlockTarget(null);
    showToast({
      text: t('Blocked {who}. Future emails are deleted on arrival', { who: r.kind === 'domain' ? '@' + r.value : r.value }),
      ms: 7000,
      action: {
        label: t('Undo'),
        run: () => {
          setBlocked((b) => b.filter((x) => x.id !== r.id));
          setThreads(prevThreads);
        },
      },
    });
  };


  /* ---------------- Team: tasks, clients, chat, notifications ---------------- */

  // The company's apps, minus the ones this person hid from their own sidebar (Settings, Your apps).
  // Projects used to live inside Tasks: companies that chose their apps before it existed get it with Tasks.
  // Projects and Teams came after some companies picked their apps: they're on wherever Tasks is.
  const companyApps: AppId[] = ws.apps ? (ws.apps.includes('tasks') ? [...new Set<AppId>([...ws.apps, 'projects', 'teams'])] : ws.apps) : APPS.map((a) => a.id);
  const myHidden: AppId[] = user.hiddenApps ?? [];
  const imAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');
  // Members only see an app once it works; admins still see it, with the steps to set it up.
  const notReady = new Set<AppId>(!imAdmin && !demoOk && myAccounts.length && !mailIn && !mailOut ? ['mail'] : []);
  const enabledApps: AppId[] = companyApps.filter((a) => a === 'home' || (!myHidden.includes(a) && !notReady.has(a)));
  const enabled = new Set<string>(enabledApps);
  const setMyHidden = (list: AppId[]) => {
    onUpdateUser({ hiddenApps: list });
    if (list.includes(mode as AppId)) go('home');
  };
  const [askedApps, setAskedApps] = useState<AppId[]>([]);
  /** Someone wants an app the company switched off: every owner and admin gets a notification with a way to switch it on. */
  const askForApp = (id: AppId) => {
    const admins = ws.members.filter((m) => m.role !== 'member' && m.userId !== user.id).map((m) => m.userId);
    admins.forEach((a) => notify(a, 'task', msg('{name} asked to switch on {app} for {company}', { name: myFirst, app: phrase(appWord(id)), company: ws.name }), { app: 'settings', id: 'apps' }));
    setAskedApps((l) => [...l, id]);
    showToast({ text: admins.length ? t('Asked {names}', { names: fmtList(admins.map(firstOf)) }) : t('There’s no other admin to ask yet') });
  };
  useEffect(() => {
    if (mode !== 'settings' && !enabled.has(mode)) setMode('home');
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => ws.members.map((m) => allUsers.find((u) => u.id === m.userId)).filter(Boolean) as User[], [ws.members, allUsers]);
  // Every client, including past ones (client pages, search, history) …
  const wsClientsAll = useMemo(() => clients.filter((c) => c.workspaceId === ws.id), [clients, ws.id]);
  // … and the ones you work with now (pickers, sidebars, Home, filing).
  const wsClients = useMemo(() => wsClientsAll.filter((c) => c.status !== 'ended'), [wsClientsAll]);
  const wsTeams = useMemo(() => teams.filter((t) => t.workspaceId === ws.id), [teams, ws.id]);
  /** A new project, from anywhere (any project picker, ⌘K, the Projects app). Returns it so the picker can select it. */
  const createProject = (name: string, extra: Partial<Client> = {}): Client => {
    const c: Client = { id: uid(), workspaceId: ws.id, name: name.trim(), color: ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'][wsClientsAll.length % 6], status: 'active', since: nowIso(), ownerId: user.id, ...extra };
    setClients((cs) => [...cs, c]);
    showToast({ text: t('{name} added', { name: c.name }), action: { label: t('Open'), run: () => openClient(c.id) } });
    return c;
  };
  const projectsCtx = useMemo(() => ({ create: (name: string) => createProject(name) }), [ws.id, wsClientsAll.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const allWsTasks = useMemo(() => todos.filter((t) => (t.workspaceId ?? 'pnp') === ws.id), [todos, ws.id]);
  // Who sees which tasks: owners and admins see everything; everyone else sees their own work,
  // their teams' work, the clients they work on, and the channels they're in.
  const isAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');
  const perms = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  // Mail's labels and filters (src/components/mail/Organize.tsx): the sidebar's Labels, "Label as", "Filter messages
  // like this", the chips and "Filed by" line on an email, Settings' sections and their dialogs.
  const organize = useMailOrganize({ ws, me: user.id, isAdmin, myAccounts, threads: wsThreads, setThreads: (fn) => setThreads(fn), people: members, view, onView: selectView, toast: showToast });
  // What the server didn't keep, and a session that ended elsewhere.
  useEffect(() => {
    const failed = (e: Event) => {
      const why = (e as CustomEvent<{ error?: string }>).detail.error;
      showToast({ text: why ? t(why) : t('That change couldn’t be saved.'), ms: 7000 });
    };
    const out = () => showToast({ text: t('You were signed out (your password changed, or the session ended). Sign in again.'), action: { label: t('Sign in'), run: () => location.reload() }, ms: 20000 });
    window.addEventListener('s2g:save-failed', failed);
    window.addEventListener('s2g:signed-out', out);
    return () => (window.removeEventListener('s2g:save-failed', failed), window.removeEventListener('s2g:signed-out', out));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* quotes and contracts */
  const wsQuotes = useMemo(() => quotes.filter((q) => q.workspaceId === ws.id), [quotes, ws.id]);
  const saveQuote = (q: Quote) => setQuotes((qs) => (qs.some((x) => x.id === q.id) ? qs.map((x) => (x.id === q.id ? q : x)) : [...qs, q]));
  const sendQuote = (q: Quote) => {
    const sent: Quote = { ...q, status: 'sent', sentAt: nowIso() };
    saveQuote(sent);
    const client = wsClientsAll.find((c) => c.id === q.clientId);
    // The guests who can accept hear about it in their shared space.
    (client ? clientPeople(client, channels) : []).filter((x) => x.status !== 'pending' && x.role === 'approver').forEach((x) => notify(clientInbox(x.email), 'task', msg('{company} sent you a quote: {title}', { company: ws.name, title: q.title }), { app: 'projects', id: q.clientId }));
    showToast({ text: client ? t('Sent to {name}. They see it in their shared space.', { name: client.name }) : t('Sent') });
  };
  /** An accepted quote becomes a brief: one task per line, due by its days (or spaced a few days apart). */
  const briefFromQuote = (q: Quote) => {
    const client = wsClientsAll.find((c) => c.id === q.clientId);
    const start = localDay();
    const lines = q.items.map((i) => `${i.title} (${i.qty} × ${i.price})`).join(', ');
    const brief = createTask({ kind: 'brief', title: q.title, context: [q.intro, q.terms ? t('Terms: {terms}', { terms: q.terms }) : '', q.signature ? t('Quote accepted by {name}: {lines}', { name: q.signature, lines }) : t('Quote accepted: {lines}', { lines })].filter(Boolean).join('\n\n'), clientId: q.clientId, userId: user.id, due: addWorkdays(start, Math.max(5, ...q.items.map((i, k) => i.days ?? (k + 1) * 3))), source: 'manual' });
    q.items.forEach((i, k) => createTask({ title: i.title, briefId: brief.id, clientId: q.clientId, userId: '', due: addWorkdays(start, i.days ?? (k + 1) * 3), source: 'manual' }));
    saveQuote({ ...q, briefId: brief.id });
    showToast({ text: client ? t('Brief made from the quote for {name}', { name: client.name }) : t('Brief made from the quote'), action: { label: t('Open'), run: () => openTask(brief.id) } });
  };
  /** A guest's answer, when they're viewed or hosted from here (real guests answer through the server's rules). */
  const decideQuote = (email: string) => (id: string, status: 'accepted' | 'declined', text: string) => {
    setQuotes((qs) => qs.map((x) => (x.id === id && x.status === 'sent' ? { ...x, status, decidedAt: nowIso(), decidedBy: email, signature: status === 'accepted' ? text || email : undefined, note: status === 'declined' && text ? text : undefined } : x)));
    const q = quotes.find((x) => x.id === id);
    if (q) notify(q.createdBy, 'task', status === 'accepted' ? msg('{who} accepted your quote “{title}”', { who: email, title: q.title }) : msg('{who} declined your quote “{title}”', { who: email, title: q.title }), { app: 'projects', id: q.clientId });
  };
  // A quote accepted by a guest: tell its author (notices to teammates come from the app that saw the change).
  const seenQuotes = useRef(new Map<string, string>());
  useEffect(() => {
    for (const q of wsQuotes) {
      const was = seenQuotes.current.get(q.id);
      if (was && was === 'sent' && (q.status === 'accepted' || q.status === 'declined') && q.decidedBy?.includes('@') && q.createdBy === user.id)
        showToast({ text: q.status === 'accepted' ? t('{who} accepted “{title}”', { who: q.decidedBy, title: q.title }) : t('{who} declined “{title}”', { who: q.decidedBy, title: q.title }), action: q.status === 'accepted' && !q.briefId ? { label: t('Make the brief'), run: () => briefFromQuote(q) } : undefined });
      seenQuotes.current.set(q.id, q.status);
    }
  }, [wsQuotes]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Out of the huddle: off the channel's list; the huddle ends when nobody is left. */
  const leaveHuddle = () => {
    const id = huddleId;
    setHuddleId(null);
    if (!id) return;
    setChannels((cs) =>
      cs.map((c) => {
        if (c.id !== id || !c.huddle) return c;
        const members = c.huddle.members.filter((m) => m !== user.id);
        return { ...c, huddle: members.length ? { ...c.huddle, members } : undefined };
      }),
    );
  };
  const huddleChannel = huddleId ? channels.find((c) => c.id === huddleId) : undefined;
  // Dropped from the list elsewhere (the huddle ended, or this account left on another device): stop here too.
  useEffect(() => {
    if (huddleId && !huddleChannel?.huddle?.members.includes(user.id)) setHuddleId(null);
  }, [huddleId, huddleChannel?.huddle?.members, user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const myTeamIds = useMemo(() => teams.filter((t) => t.workspaceId === ws.id && (t.members.includes(user.id) || t.leadId === user.id)).map((t) => t.id), [teams, ws.id, user.id]);
  const myClientIds = useMemo(
    () =>
      clients
        .filter(
          (c) =>
            c.workspaceId === ws.id &&
            (c.ownerId === user.id ||
              (c.members ?? []).some((m) => m.userId === user.id) ||
              channels.some((ch) => ch.clientId === c.id && ch.members.includes(user.id)) ||
              allWsTasks.some((t) => t.clientId === c.id && (t.userId === user.id || t.assignees?.includes(user.id) || t.supervisorId === user.id))),
        )
        .map((c) => c.id),
    [clients, channels, allWsTasks, ws.id, user.id],
  );
  const wsTasks = useMemo(
    () =>
      isAdmin
        ? allWsTasks
        : allWsTasks.filter(
            (t) =>
              t.userId === user.id ||
              t.assignees?.includes(user.id) ||
              t.supervisorId === user.id ||
              t.followers?.includes(user.id) ||
              t.createdBy === user.id ||
              (t.teamId && myTeamIds.includes(t.teamId)) ||
              (t.clientId && (perms.seeAllProjects || myClientIds.includes(t.clientId))) ||
              (t.channelId && channels.some((c) => c.id === t.channelId && c.members.includes(user.id))),
          ),
    [allWsTasks, isAdmin, user.id, myTeamIds, myClientIds, channels, perms.seeAllProjects],
  );
  const wsChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && c.members.includes(user.id) && !c.archived), [channels, ws.id, user.id]);
  // Channels I can see in the sidebar: mine, plus public ones I could join.
  const visibleChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && !c.archived && (c.members.includes(user.id) || (c.kind === 'channel' && !c.private))), [channels, ws.id, user.id]);
  const myRole = ws.members.find((m) => m.userId === user.id)?.role ?? 'member';
  const myPortals = useMemo(() => portalsFor(user.email, workspaces.map((w) => w.id), allWorkspaces, clients, channels), [user.email, workspaces, allWorkspaces, clients, channels]);
  const portalItems = myPortals.map((pt) => ({ key: pt.key, ws: pt.ws, client: pt.client, unread: notices.filter((n) => !n.read && n.workspaceId === pt.ws.id && (n.userId === user.id || n.userId === clientInbox(user.email))).length }));
  const myNotices = useMemo(() => notices.filter((n) => n.userId === user.id && n.workspaceId === ws.id), [notices, user.id, ws.id]);
  const wsMeetings = useMemo(() => meetings.filter((m) => m.workspaceId === ws.id), [meetings, ws.id]);
  const firstOf = (id?: string) => (allUsers.find((u) => u.id === id)?.name ?? 'Someone').split(' ')[0];
  const myFirst = (settings.name || user.name).split(' ')[0];
  const nowIso = () => new Date().toISOString();

  /** Which client an email belongs to, by the sender's domain. */
  function clientForThread(t: Thread) {
    return wsClientsAll.find((c) => c.domain && t.messages.some((m) => peopleOf(m).some((p) => p.email.toLowerCase().endsWith('@' + c.domain))));
  }

  const chatUnread = useMemo(() => {
    const out: Record<string, number> = {};
    const fallback = new Date(Date.now() - 90 * 60_000).toISOString();
    for (const c of wsChannels) {
      if (isMutedValue(chatMuted[c.id])) continue;
      const since = lastRead[c.id] ?? fallback;
      const n = messages.filter((m) => m.channelId === c.id && m.userId !== user.id && !m.sendAt && m.at > since && (!m.parentId || m.alsoInChannel)).length;
      if (n) out[c.id] = n;
    }
    return out;
  }, [wsChannels, messages, lastRead, chatMuted, user.id]);
  // The messages of the conversations I'm in (the chat list's last messages, Catch up, Threads, Drafts and sent).
  const wsMessages = useMemo(() => {
    const ids = new Set(wsChannels.map((c) => c.id));
    return messages.filter((m) => ids.has(m.channelId));
  }, [messages, wsChannels]);
  const chatUnreadTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0);

  // Chat always opens on a channel (the first one, usually #general), also after switching workspace.
  useEffect(() => {
    if (mode === 'chat' && !mobile && !wsChannels.some((c) => c.id === chatId) && wsChannels.length) setChatId(wsChannels[0].id);
  }, [mode, chatId, wsChannels]);

  // "Since my last visit" needs the time I last read a channel, before opening it now marks it read.
  const [sinceRead, setSinceRead] = useState(() => new Date(Date.now() - 90 * 60_000).toISOString());
  useEffect(() => {
    if (chatId) setSinceRead(lastRead[chatId] ?? new Date(Date.now() - 90 * 60_000).toISOString());
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What one AI channel summary costs this company, said plainly. */
  const summaryCost = (() => {
    const trial = !!ws.plan?.trialEnds && ws.plan.trialEnds > nowIso();
    const included = ((ws.plan?.track === 'ai' && ws.plan.tier !== 'free') || trial) && ws.ai?.payer !== 'own';
    if (included) return t('about 1 summary from your AI allowance');
    const job = ws.ai?.jobs.digest ?? ws.ai?.jobs.summary;
    const c = job ? costPer100(JOBS.find((j) => j.id === 'digest')!, job.provider, job.model) : null;
    return c !== null && c !== undefined ? t('about {cost} on your own AI key', { cost: rp(c / 100) }) : t('a small amount on your own AI key');
  })();

  /** A notice for someone else. Its words come from msg(), so each reader sees them in their own language (docs/i18n.md). */
  const notify = (userId: string, kind: Notice['kind'], words: { text: string; tr: Msg }, link?: Notice['link']) => {
    if (userId === user.id) return;
    setNotices((ns) => [{ id: uid(), userId, workspaceId: ws.id, kind, ...words, at: nowIso(), read: false, link }, ...ns]);
  };

  /** Saves this company's teams. A new team gets its own channel; people added to a team join it and hear about it. */
  const saveTeams = (list: Team[]) => {
    const fresh = list.filter((x) => !wsTeams.some((y) => y.id === x.id));
    fresh.forEach((tm) => {
      const id = uid();
      setChannels((cs) => [...cs, { id, workspaceId: ws.id, kind: 'channel', name: tm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), members: [...new Set([user.id, ...tm.members])], teamId: tm.id, topic: t('{team} team', { team: tm.name }), category: 'team', ownerId: user.id, createdAt: nowIso() }]);
    });
    list.forEach((tm) => {
      const before = wsTeams.find((x) => x.id === tm.id);
      tm.members.filter((m) => m !== user.id && !before?.members.includes(m)).forEach((m) => notify(m, 'team', msg('{name} added you to {team}', { name: user.name, team: tm.name }), { app: 'teams', id: tm.id }));
      setChannels((cs) => cs.map((c) => (c.teamId === tm.id ? { ...c, members: [...new Set([...c.members, ...tm.members])] } : c)));
    });
    setTeams((all) => [...all.filter((x) => x.workspaceId !== ws.id), ...list]);
  };
  const teamActions: TeamActions = {
    patch: (id, p) => saveTeams(wsTeams.map((tm) => (tm.id === id ? { ...tm, ...p } : tm))),
    direct: (tm) => tm.join === 'open' || isAdmin,
    join: (tm) => {
      if (tm.join === 'open' || isAdmin) {
        saveTeams(wsTeams.map((x) => (x.id === tm.id ? { ...x, members: [...new Set([...x.members, user.id])], requests: (x.requests ?? []).filter((r) => r.userId !== user.id) } : x)));
        return showToast({ text: t('You joined {team}', { team: tm.name }) });
      }
      saveTeams(wsTeams.map((x) => (x.id === tm.id ? { ...x, requests: [...(x.requests ?? []).filter((r) => r.userId !== user.id), { userId: user.id, at: nowIso() }] } : x)));
      const to = tm.leadId ? [tm.leadId] : ws.members.filter((m) => m.role !== 'member').map((m) => m.userId);
      to.forEach((id) => notify(id, 'team', msg('{name} asked to join {team}', { name: user.name, team: tm.name }), { app: 'teams', id: tm.id }));
      showToast({ text: tm.leadId ? t('Asked {name} to add you', { name: firstOf(tm.leadId) }) : t('Asked an admin to add you') });
    },
    leave: (tm) => {
      saveTeams(wsTeams.map((x) => (x.id === tm.id ? { ...x, members: x.members.filter((m) => m !== user.id), leadId: x.leadId === user.id ? undefined : x.leadId } : x)));
      showToast({ text: t('You left {team}', { team: tm.name }) });
    },
    remove: (tm) => {
      saveTeams(wsTeams.filter((x) => x.id !== tm.id));
      setTeamId(null);
      showToast({ text: t('{team} deleted. Its tasks keep their {projects}', { team: tm.name, projects: term.many }) });
    },
  };
  const canCreateTeams = isAdmin || perms.createTeams;
  const canCreateProjects = isAdmin || perms.createProjects;
  const seesAllProjects = isAdmin || perms.seeAllProjects;

  /** The DM channel between me and someone (created on first use). */
  const dmWith = (otherId: string) => dmFor({ userIds: [otherId], guests: [] });
  /**
   * The direct or group message with exactly these people (and guests of one project), made on first use. The server
   * checks who may be in it (server/chatRules.ts).
   */
  const dmFor = (to: Recipients) => {
    const want = new Set([user.id, ...to.userIds]);
    const mails = new Set(to.guests.map((g) => g.email.toLowerCase()));
    const found = channels.find((c) => c.workspaceId === ws.id && c.kind === 'dm' && c.members.length === want.size && c.members.every((m) => want.has(m)) && (c.guests ?? []).length === mails.size && (c.guests ?? []).every((g) => mails.has(g.email.toLowerCase())));
    if (found) return found.id;
    const id = uid();
    const guests = to.guests.length ? { clientId: to.guests[0].clientId, guests: to.guests.map((g) => ({ email: g.email, name: g.name, status: 'joined' as const, invitedBy: user.id, at: nowIso() })) } : {};
    setChannels((cs) => [...cs, { id, workspaceId: ws.id, kind: 'dm', name: '', members: [...want], createdAt: nowIso(), ...guests }]);
    return id;
  };
  /** Guests I may write to: people who joined a project where I may invite guests (the server's rule, chatRules.ts). */
  const dmGuests: GuestOption[] = wsClients
    .filter((c) => c.status !== 'ended' && (isAdmin || perms.inviteGuests || c.ownerId === user.id || (c.members ?? []).some((m) => m.userId === user.id && m.role === 'lead')))
    .flatMap((c) => clientPeople(c, channels).filter((x) => x.status === 'joined').map((x) => ({ email: x.email, name: x.name, clientId: c.id, project: c.name })));
  /** A group message becomes a private channel: the same people and history, more people may come in (Slack). */
  const convertToChannel = (id: string, name: string, add: string[]) => {
    const c = channels.find((x) => x.id === id);
    if (!c) return;
    setChannels((cs) => cs.map((x) => (x.id === id ? { ...x, kind: 'channel', private: true, name, members: [...new Set([...x.members, ...add])], ownerId: user.id, ...(x.guests?.length ? { category: 'shared' as const } : {}) } : x)));
    // A system line, as when a channel is made (Message.tsx puts the author's name in front).
    setMessages((ms) => [...ms, { id: uid(), channelId: id, userId: user.id, text: `made this a private channel, #${name}`, tr: phrase('{name} made this a private channel, #{channel}', { name: myFirst, channel: name }), at: nowIso(), kind: 'system' }]);
    add.forEach((m) => notify(m, 'mention', msg('{name} added you to #{channel}', { name: myFirst, channel: name }), { app: 'chat', id }));
  };

  const postChat = (channelId: string, text: string, taskId?: string, fromId = user.id, tr?: Msg) =>
    setMessages((ms) => [...ms, { id: uid(), channelId, userId: fromId, text, at: nowIso(), taskId, ...(tr ? { tr } : {}) }]);

  /** A short email from me to a teammate (used for task notifications). */
  const emailTeammate = (toId: string, subject: string, text: string) => {
    const to = allUsers.find((u) => u.id === toId);
    const from = myAccounts.find((a) => a.kind === 'personal') ?? myAccounts[0];
    if (!to || !from) return;
    deliver({ to: [{ name: to.name, email: to.email }], cc: [], subject, html: textToHtml(text) + settings.signature, text, files: [], track: false, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: from.id });
  };

  const describe = (t: Pick<Todo, 'title' | 'clientId' | 'due'>) => {
    const c = wsClients.find((x) => x.id === t.clientId);
    return `“${t.title}”${c ? ` for ${c.name}` : ''}${t.due ? `, due ${dueWords(t.due)}` : ''}`;
  };
  /** The same for a notice: a phrase each reader sees in their own language. */
  const describeP = (task: Pick<Todo, 'title' | 'clientId' | 'due'>) => {
    const c = wsClients.find((x) => x.id === task.clientId);
    const title = task.title;
    if (c && task.due) return phrase('“{title}” for {project}, due {due}', { title, project: c.name, due: phrase(dueWords(task.due)) });
    if (c) return phrase('“{title}” for {project}', { title, project: c.name });
    if (task.due) return phrase('“{title}”, due {due}', { title, due: phrase(dueWords(task.due)) });
    return phrase('“{title}”', { title });
  };

  /** A task's first history line: "created this from an email for Intan", in each reader's language. */
  const createdLine = (from: Todo['source'] | 'note', forName: string) => {
    const src = { note: 'a note', ai: 'an email', manual: '', braindump: 'a brain dump', chat: 'chat', meeting: 'a meeting', request: 'a request', import: 'an import' }[from];
    if (src && forName) return msg('created this from {source} for {name}', { source: phrase(src), name: forName });
    if (src) return msg('created this from {source}', { source: phrase(src) });
    if (forName) return msg('created this for {name}', { name: forName });
    return msg('created this');
  };

  const createTask = (
    t: {
      title: string;
      clientId?: string;
      teamId?: string;
      briefId?: string;
      meetingId?: string;
      saidAt?: number;
      channelId?: string;
      kind?: Todo['kind'];
      context?: string;
      userId: string;
      due?: string;
      priority?: 'high' | 'normal';
      source: Todo['source'];
      threadId?: string;
      checklist?: Todo['checklist'];
      repeat?: Todo['repeat'];
      noteId?: string;
      assignees?: string[]; // everyone doing it (Quick Add's "+intan +bima"); userId is the first
      remindAt?: string;
      status?: TaskStatus;
      notes?: string;
    },
    tell: { chat?: boolean; email?: boolean } = {},
  ) => {
    const task: Todo = {
      id: uid(),
      kind: t.kind,
      title: t.title,
      clientId: t.clientId,
      teamId: t.teamId,
      briefId: t.briefId,
      meetingId: t.meetingId,
      saidAt: t.saidAt,
      channelId: t.channelId,
      context: t.context,
      userId: t.userId,
      due: t.due,
      priority: t.priority ?? 'normal',
      done: false,
      // A stage it was given (Quick Add's /stage, a board column) when it's one of its own stages (its project's or team's, else the company's).
      status: t.status && stagesForTask({ workspaceId: ws.id, clientId: t.clientId, teamId: t.teamId }).some((s) => s.id === t.status && s.kind !== 'done') ? t.status : stageIdFor({ workspaceId: ws.id, clientId: t.clientId, teamId: t.teamId }, t.kind === 'brief' ? 'active' : 'open'),
      source: t.source,
      createdBy: user.id,
      workspaceId: ws.id,
      threadId: t.threadId,
      checklist: t.checklist,
      repeat: t.repeat,
      noteId: t.noteId,
      ...(t.remindAt ? { remindAt: t.remindAt, reminded: false } : {}),
      ...(t.notes ? { notes: t.notes } : {}),
      createdAt: nowIso(),
      assignees: t.assignees?.length ? t.assignees : t.userId ? [t.userId] : [],
      supervisorId: user.id, // whoever assigns it supervises it, unless someone changes it
      history: [{ id: uid(), at: nowIso(), by: user.id, kind: 'created', ...createdLine(t.noteId ? 'note' : t.source, t.userId && t.userId !== user.id ? firstOf(t.userId) : '') }],
    };
    setTodos((ts) => [...ts, task]);
    // Not assigned yet: tell the team lead it's waiting in their queue.
    if (!t.userId && t.teamId) {
      const tm = wsTeams.find((x) => x.id === t.teamId);
      if (tm?.leadId && tm.leadId !== user.id) notify(tm.leadId, 'task', msg('New in {team}’s queue: {task}. Pick someone for it.', { team: tm.name, task: describeP(task) }), { app: 'tasks', id: task.id });
    }
    for (const who of (task.assignees ?? []).filter((x) => x !== user.id)) {
      notify(who, 'task', msg('{name} assigned you {task}', { name: myFirst, task: describeP(task) }), { app: 'tasks', id: task.id });
      if (tell.chat) {
        const line = msg('📌 New task for you: {task}', { task: describeP(task) });
        postChat(dmWith(who), line.text, task.id, undefined, line.tr);
      }
      if (tell.email)
        emailTeammate(who, `New task: ${task.title}`, `Hi ${firstOf(who)},\n\nI've assigned you a task: ${describe(task)}.\n\nYou'll find it in ${product.name} under Tasks.`);
    }
    return task;
  };

  function setTaskStatus(id: string, requested: TaskStatus, quiet = false) {
    const task = todos.find((x) => x.id === id);
    if (!task) return;
    // The task's own stages (its project's or team's, else the company's); what happens depends on the kind, not the name.
    const list = stagesForTask(task);
    const target = list.find((s) => s.id === requested);
    if (!target) return;
    const from = stageOf(task, list);
    // The review step: when the team asks for it, finishing a task sends it to the supervisor first.
    const team = teams.find((x) => x.id === task.teamId);
    const reviewStage = firstStage('review', list);
    const needsReview = target.kind === 'done' && !!reviewStage && !!team?.review && !!task.supervisorId && task.supervisorId !== user.id && !doersOf(task).includes(task.supervisorId) && from.kind !== 'review';
    const to = needsReview ? reviewStage : target;
    const status: TaskStatus = to.id;
    const done = to.kind === 'done';
    const before = { status: task.status, done: task.done, doneAt: task.doneAt, doneBy: task.doneBy, history: task.history };
    if (to.id !== from.id) {
      tried('stage');
      const line = needsReview
        ? msg('finished it and sent it for review')
        : done && !task.done
          ? from.kind === 'review'
            ? msg('approved it')
            : msg('marked it done')
          : !done && task.done
            ? to.kind === 'open'
              ? msg('reopened it')
              : msg('reopened it ({stage})', { stage: stagePhrase(to) })
            : to.kind === 'active' && from.kind === 'open'
              ? msg('started it')
              : msg('moved it to {stage}', { stage: stagePhrase(to) });
      logTask(id, needsReview || from.kind === 'review' ? 'review' : 'status', line);
    }
    if (needsReview) {
      setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status, done: false } : x)));
      notify(task.supervisorId!, 'task', msg('{name} finished {task}. Ready for your review', { name: myFirst, task: describeP(task) }), { app: 'tasks', id });
      if (!quiet) showToast({ text: t('Sent to {name} for review', { name: firstOf(task.supervisorId) }) });
      return;
    }
    // A repeating task: finishing it creates the next one.
    const next: Todo | undefined =
      done && !task.done && task.repeat
        ? {
            ...task,
            id: uid(),
            status: stageIdFor(task, 'open', list),
            done: false,
            doneAt: undefined,
            doneBy: undefined,
            due: nextDue(task.due, task.repeat),
            remindAt: task.remindAt && task.due ? new Date(new Date(task.remindAt).getTime() + (new Date(nextDue(task.due, task.repeat)).getTime() - new Date(task.due).getTime())).toISOString() : undefined,
            reminded: false,
            checklist: task.checklist?.map((c) => ({ ...c, done: false })),
            approval: undefined,
            createdAt: nowIso(),
            history: [{ id: uid(), at: nowIso(), by: user.id, kind: 'created', ...msg('created this (repeats {repeat})', { repeat: repeatPhrase(task.repeat) }) }],
          }
        : undefined;
    if (next) setTodos((ts) => [...ts, next]);
    setTodos((ts) =>
      ts.map((x) =>
        x.id === id ? { ...x, status, done, doneAt: done ? (x.done ? x.doneAt : nowIso()) : undefined, doneBy: done ? (x.done ? x.doneBy : user.id) : undefined } : x,
      ),
    );
    // Requests: the client sees each status change.
    if (task.requestedBy && requestStatus(task).label !== requestStatus({ ...task, status, done }).label) tellClient(task, msg('Your request “{title}” is now: {status}', { title: task.title, status: phrase(requestStatus({ ...task, status, done }).label) }));
    else if (task.visibleToClient && done && !task.done) tellClient(task, msg('“{title}” is done', { title: task.title }));
    if (done && !task.done) {
      const tell = new Set([task.supervisorId ?? task.createdBy, ...(task.followers ?? []), ...(from.kind === 'review' ? doersOf(task) : [])].filter((x): x is string => !!x && x !== user.id));
      tell.forEach((uid2) => notify(uid2, 'done', from.kind === 'review' ? msg('{name} approved {task}', { name: myFirst, task: describeP(task) }) : msg('{name} finished {task}', { name: myFirst, task: describeP(task) }), { app: 'tasks', id: task.id }));
      // Finishing the last task of a brief tells the person in charge.
      const br = task.briefId ? todos.find((x) => x.id === task.briefId) : undefined;
      if (br && br.userId !== user.id && todos.filter((x) => x.briefId === br.id && x.id !== id).every((x) => x.done))
        notify(br.userId, 'done', msg('All tasks in the brief “{title}” are done', { title: br.title }), { app: 'tasks', id: br.id });
      // Celebrate in the client's (or team's) channel, and with a little confetti for the person who finished it.
      if (ws.chat?.celebrations !== false && !isBrief(task)) {
        const ch = channels.find((c) => c.workspaceId === ws.id && !c.archived && c.kind === 'channel' && c.category !== 'shared' && ((task.clientId && c.clientId === task.clientId) || (!task.clientId && task.teamId && c.teamId === task.teamId)));
        if (ch) setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: user.id, ...msg('{name} finished “{task}”', { name: myFirst, task: task.title }), at: nowIso(), kind: 'celebration', taskId: task.id }]);
        if (!quiet) celebrate();
      }
      if (!quiet) offerInstall(); // finishing something is a good moment to offer the app
      if (!quiet)
        showToast({
          text: next ? t('Done. The next one is due {day}', { day: dueWordsHere(next.due!) }) : t('Done: {title}', { title: task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title }),
          action: { label: t('Undo'), run: () => setTodos((ts) => ts.filter((x) => x.id !== next?.id).map((x) => (x.id === id ? { ...x, ...before } : x))) },
          ms: 6000,
        });
    }
  }

  const doersOf = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
  /** Adds a line to a task's history: a msg() (English text for the AI connector, and a `tr` for each reader's language). */
  const logTask = (id: string, kind: TaskEvent['kind'], line: { text: string; tr: Msg }, by = user.id) =>
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, history: [...(x.history ?? []), { id: uid(), at: nowIso(), by, kind, ...line }] } : x)));

  const patchTask = (id: string, patch: Partial<Todo>) => {
    const task = todos.find((x) => x.id === id);
    // Keep userId (first person doing it) and assignees in step.
    if (patch.userId !== undefined && patch.assignees === undefined && task) patch = { ...patch, assignees: patch.userId ? [patch.userId, ...doersOf(task).filter((x) => x !== patch.userId && x !== task.userId)] : [] };
    if (patch.assignees && patch.userId === undefined) patch = { ...patch, userId: patch.assignees[0] ?? '' };
    // Moving to a project or team with stages of its own: the stage of the same name there, else its first stage.
    const moved = task && !('status' in patch) && (('clientId' in patch && patch.clientId !== task.clientId) || ('teamId' in patch && patch.teamId !== task.teamId)) ? stageAfterMove(task, { ...task, ...patch }) : null;
    if (moved) patch = { ...patch, status: moved.stage.id, done: moved.stage.kind === 'done', ...(moved.stage.kind === 'done' ? {} : { doneAt: undefined, doneBy: undefined }) };
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!task) return;
    if (moved) {
      const toProject = 'clientId' in patch && patch.clientId !== task.clientId;
      const name = toProject ? clients.find((c) => c.id === patch.clientId)?.name : teams.find((x) => x.id === patch.teamId)?.name;
      const where = name ?? (toProject ? phrase('no project') : phrase('no team'));
      const whereHere = name ?? (toProject ? t('no {project}', { project: term.one }) : t('no team'));
      logTask(id, 'status', moved.kept ? msg('kept it in {stage} when it moved to {where}', { stage: stagePhrase(moved.stage), where }) : msg('moved it to {stage} when it moved to {where}, which has no {from} stage', { stage: stagePhrase(moved.stage), where, from: stagePhrase(moved.from) }));
      showToast({ text: moved.kept ? t('Moved to {where}, still in “{stage}”.', { where: whereHere, stage: stageName(moved.stage) }) : t('Moved to {where}, which has no “{from}” stage, so the task is in “{stage}” now.', { where: whereHere, from: stageName(moved.from), stage: stageName(moved.stage) }), ms: moved.kept ? undefined : 7000 });
    }
    const before = doersOf(task);
    if (patch.assignees) {
      const added = patch.assignees.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !patch.assignees!.includes(x));
      if (added.length || removed.length) {
        const a = added.map(firstOf).join(', ');
        const r = removed.map(firstOf).join(', ');
        logTask(id, 'assigned', a && r ? msg('added {added} and removed {removed}', { added: a, removed: r }) : a ? msg('added {names}', { names: a }) : msg('removed {names}', { names: r }));
      }
      added.filter((x) => x !== user.id).forEach((x) => notify(x, 'task', msg('{name} assigned you {task}', { name: myFirst, task: describeP(task) }), { app: 'tasks', id }));
      if (added.length === 1 && added[0] !== user.id) showToast({ text: t('Assigned to {name}', { name: firstOf(added[0]) }) });
    }
    if (patch.supervisorId && patch.supervisorId !== task.supervisorId) {
      logTask(id, 'supervisor', patch.supervisorId === user.id ? msg('made themselves the supervisor') : msg('made {name} the supervisor', { name: firstOf(patch.supervisorId) }));
      if (patch.supervisorId !== user.id) notify(patch.supervisorId, 'task', msg('{name} asked you to supervise {task}', { name: myFirst, task: describeP(task) }), { app: 'tasks', id });
    }
    if ('repeat' in patch && patch.repeat !== task.repeat) logTask(id, 'edit', patch.repeat ? msg('set it to repeat {repeat}', { repeat: repeatPhrase(patch.repeat) }) : msg('stopped it repeating'));
    if ('due' in patch && patch.due !== task.due) logTask(id, 'due', patch.due ? (task.due ? msg('moved the due date from {from} to {to}', { from: phrase(dueWords(task.due)), to: phrase(dueWords(patch.due)) }) : msg('moved the due date to {to}', { to: phrase(dueWords(patch.due)) })) : msg('removed the due date'));
    if (patch.followers) {
      const added = patch.followers.filter((x) => !(task.followers ?? []).includes(x));
      const others = added.filter((x) => x !== user.id).map(firstOf).join(', ');
      const self = added.includes(user.id);
      if (added.length)
        logTask(id, 'edit', self && others ? msg('added themselves and {names} as followers', { names: others }) : self ? msg('added themselves as a follower') : added.length > 1 ? msg('added {names} as followers', { names: others }) : msg('added {names} as a follower', { names: others }));
    }
  };

  /** A comment on a task: everyone on it hears about it (mentions too). */
  const commentTask = (id: string, text: string, toClient = false, files?: CommentFile[]) => {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, history: [...(x.history ?? []), { id: uid(), at: nowIso(), by: user.id, kind: 'comment', text, ...(toClient ? { toClient: true } : {}), ...(files?.length ? { files } : {}) }] } : x)));
    // A comment that is only files: the notices name them.
    if (!text) text = (files ?? []).map((f) => f.name).join(', ');
    if (toClient) {
      const c = clients.find((x) => x.id === t.clientId);
      // "{company} team" is read in each guest's own language; a name is a name.
      const name = !c ? myFirst : accessFor(ws, c).teamNames === 'hide' ? phrase('{company} team', { company: ws.name }) : teamLabel(user, accessFor(ws, c), ws.name);
      tellClient(t, msg('{name} replied on “{title}”: “{text}”', { name, title: t.title, text: text.slice(0, 80) }));
    }
    const tell = new Set([...doersOf(t), t.supervisorId, ...(t.followers ?? []), ...members.filter((u) => new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(text)).map((u) => u.id)].filter((x): x is string => !!x && x !== user.id));
    tell.forEach((x) => notify(x, 'task', msg('{name} commented on “{title}”: “{text}”', { name: myFirst, title: t.title, text: text.slice(0, 80) }), { app: 'tasks', id }));
  };

  /** The supervisor sends a finished task back with a note. */
  const sendBack = (id: string, note: string) => {
    const task = todos.find((x) => x.id === id);
    if (!task) return;
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status: stageIdFor(x, 'active'), done: false } : x)));
    logTask(id, 'review', msg('sent it back: “{note}”', { note }));
    doersOf(task)
      .filter((x) => x !== user.id)
      .forEach((x) => notify(x, 'task', msg('{name} sent back “{title}”: “{note}”', { name: myFirst, title: task.title, note: note.slice(0, 80) }), { app: 'tasks', id }));
    showToast({ text: t('Sent back with your note') });
  };

  /** Creates a brief and its tasks from a template, spaced out in working days. Tasks go to the matching team's queue. */
  const fromTemplate = (tpl: TaskTemplate, o: { clientId?: string; start: string; ownerId: string; skip: number[] }) => {
    const client = wsClients.find((c) => c.id === o.clientId);
    const name = tplText(tpl, tpl.name); // a built-in template in the language of the person who starts it
    const brief = createTask({ kind: 'brief', title: client ? `${name}: ${client.name}` : name, context: tplText(tpl, tpl.description), clientId: o.clientId, userId: o.ownerId, due: addWorkdays(o.start, Math.max(0, ...tpl.tasks.map((x) => x.days))), source: 'manual' });
    tpl.tasks.forEach((x, i) => {
      if (o.skip.includes(i)) return;
      const tl = x.title.toLowerCase();
      // The team whose keywords match the most (longer matches win ties).
      const team = wsTeams
        .map((tm) => ({ tm, hits: (tm.keywords ?? []).filter((k) => tl.includes(k)) }))
        .filter((x) => x.hits.length)
        .sort((a, b) => b.hits.length - a.hits.length || Math.max(...b.hits.map((k) => k.length)) - Math.max(...a.hits.map((k) => k.length)))[0]?.tm;
      createTask({
        title: tplText(tpl, x.title),
        briefId: brief.id,
        clientId: o.clientId,
        teamId: team?.id,
        userId: team ? '' : o.ownerId,
        due: addWorkdays(o.start, x.days),
        source: 'manual',
        checklist: x.checklist?.map((text) => ({ id: uid(), text: tplText(tpl, text), done: false })),
        repeat: x.repeat,
      });
    });
    setTplOpen(null);
    setTaskOpen(brief.id);
    showToast({ text: tn(tpl.tasks.length - o.skip.length, 'Brief created with {n} task', 'Brief created with {n} tasks') });
  };
  /** Saves a brief and its tasks as a template the whole company can reuse. */
  const saveTemplate = (briefId: string) => {
    const br = todos.find((x) => x.id === briefId);
    if (!br) return;
    const subs = todos.filter((x) => x.briefId === briefId);
    const start = subs.map((x) => x.due).filter(Boolean).sort()[0] ?? localDay();
    const workdaysBetween = (a: string, b: string) => {
      let n = 0;
      while (a < b && n < 200) ((a = addWorkdays(a, 1)), n++);
      return n;
    };
    const client = wsClients.find((c) => c.id === br.clientId);
    const name = client ? br.title.replace(new RegExp(`[:\\s-]*${client.name}`, 'i'), '').trim() || br.title : br.title;
    setSavedTemplates((ts) => [
      { id: uid(), name, description: br.context ?? '', workspaceId: ws.id, tasks: subs.map((x) => ({ title: x.title, days: x.due ? workdaysBetween(start, x.due) : 0, checklist: x.checklist?.map((c) => c.text), repeat: x.repeat })) },
      ...ts,
    ]);
    showToast({ text: t('Saved “{name}” as a template', { name }) });
  };

  /** Gives people (and whole teams) every channel in a section of the company sidebar. */
  const setSectionAccess = (sectionId: string, access: { userIds: string[]; teamIds: string[] }) => {
    const layout = fullLayout(ws.chat?.layout);
    const sec = layout.sections.find((x) => x.id === sectionId);
    if (!sec) return;
    const next = { ...sec, access };
    const before = sectionPeople(sec, wsTeams);
    const after = sectionPeople(next, wsTeams);
    const removed = before.filter((x) => !after.includes(x));
    patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout: { ...layout, sections: layout.sections.map((x) => (x.id === sectionId ? next : x)) } } });
    const inSection = channels.filter((c) => c.workspaceId === ws.id && c.kind === 'channel' && !c.archived && sectionIdOf(layout, c) === sectionId);
    setChannels((cs) => cs.map((c) => (inSection.some((x) => x.id === c.id) ? { ...c, members: [...new Set([...c.members.filter((m) => !removed.includes(m) || m === c.ownerId), ...after])] } : c)));
    after.filter((x) => !before.includes(x) && x !== user.id).forEach((x) => notify(x, 'mention', msg('{name} gave you access to the {section} channels', { name: myFirst, section: sec.category ? phrase(sec.name) : sec.name }), { app: 'chat' }));
    const inChannels = tn(inSection.length, '{n} channel', '{n} channels');
    showToast({ text: after.length === 1 ? t('1 person has access to {section} ({channels})', { section: sectionTitle(sec), channels: inChannels }) : tn(after.length, '{n} people have access to {section} ({channels})', '{n} people have access to {section} ({channels})', { section: sectionTitle(sec), channels: inChannels }) });
  };
  // Section access stays up to date: channels moved or created in a section, and new team members, get the right people.
  useEffect(() => {
    const layout = fullLayout(ws.chat?.layout);
    if (!layout.sections.some((s) => s.access)) return;
    const missing = channels.filter((c) => {
      if (c.workspaceId !== ws.id || c.kind !== 'channel' || c.archived) return false;
      const sec = layout.sections.find((s) => s.id === sectionIdOf(layout, c));
      return !!sec?.access && sectionPeople(sec, wsTeams).some((x) => !c.members.includes(x));
    });
    if (!missing.length) return;
    setChannels((cs) =>
      cs.map((c) => {
        if (!missing.some((m) => m.id === c.id)) return c;
        const sec = layout.sections.find((s) => s.id === sectionIdOf(layout, c))!;
        return { ...c, members: [...new Set([...c.members, ...sectionPeople(sec, wsTeams)])] };
      }),
    );
  }, [channels, ws.chat?.layout, wsTeams]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Settings, Apps & chat: "Who can create channels" (the server checks it too). */
  const canStartChannels = myRole !== 'member' || ws.chat?.whoCanCreate !== 'admins';
  /** The channel owner and admins can change a channel's category for everyone. */
  const canManageChannel = (c: Channel) => myRole !== 'member' || c.ownerId === user.id;
  /** Moves a channel to another category (sidebar menu or drag and drop). */
  const moveChannel = (id: string, category: ChannelCategory) => {
    const c = channels.find((x) => x.id === id);
    if (!c) return;
    const label = CATEGORY_ONE[category];
    // A client channel needs to know which client: ask in the settings.
    if ((category === 'client' || category === 'shared') && !c.clientId) {
      setChanDialog({ id });
      showToast({ text: t('Pick the {project}, then choose the category', { project: term.one }) });
      return;
    }
    const apply = () => {
      const before = c;
      setChannels((cs) => cs.map((x) => (x.id === id ? { ...x, category, guests: category === 'shared' ? x.guests : [] } : x)));
      showToast({ text: t('#{channel} moved to {category}', { channel: c.name, category: categoryText(label) }), action: { label: t('Undo'), run: () => setChannels((cs) => cs.map((x) => (x.id === id ? before : x))) } });
    };
    // Leaving "With client" removes the client's guests, so ask first.
    if (c.category === 'shared' && category !== 'shared' && c.guests?.length) {
      showToast({ text: tn(c.guests.length, 'Moving #{channel} out of Shared removes {n} guest', 'Moving #{channel} out of Shared removes {n} guests', { channel: c.name }), action: { label: t('Move anyway'), run: apply }, ms: 8000 });
      return;
    }
    apply();
  };

  const openTasks = (scope: TaskScope) => {
    if ((scope.kind === 'client' || scope.kind === 'past') && enabled.has('projects')) return (setProjScope(scope), go('projects'));
    setTaskScope(scope);
    setTaskBrowse(false);
    go('tasks');
  };
  /** The project page is the hub: overview, tasks, chat, mail, meetings, files, notes, logins, guests. It lives in the Projects app. */
  const openClient = (id: string, tab?: typeof clientTab) => {
    setClientTab(tab);
    openTasks({ kind: 'client', id });
  };
  const newProjectFlow = () => {
    setProjScope({ kind: 'projects' });
    setProjNew((n) => n + 1);
    go('projects');
  };
  const openChannel = (id: string) => {
    setChatId(id);
    setChatPage(null);
    go('chat');
  };
  const openMeeting = (id: string) => {
    setMeetPage({ kind: 'meeting', id });
    go('meet');
  };
  /** Opens a task or brief in the detail panel, on a task page where it shows up. */
  const openTask = (id: string) => {
    const t = todos.find((x) => x.id === id);
    // From the launcher (phones) it opens in Tasks, so Back goes to Tasks, then the launcher.
    if (mode !== 'tasks' && (mode !== 'home' || launcher)) openTasks(t?.userId === user.id ? { kind: 'mine' } : t?.clientId ? { kind: 'client', id: t.clientId } : { kind: 'all' });
    setLauncherState(false);
    setTaskOpen(id);
  };

  const createFromDump = (r: DumpResult) => {
    const br = r.brief ? createTask({ ...r.brief, kind: 'brief', priority: 'normal', source: 'braindump' }, r.notify) : null;
    const made = r.tasks.map((t) => createTask({ ...t, briefId: br?.id, source: 'braindump' }, r.notify));
    if (Object.keys(r.learned).length) patchWorkspace(ws.id, { aliases: { ...(ws.aliases ?? {}), ...r.learned } });
    setDump(null);
    const people = new Set(made.filter((t) => t.userId && t.userId !== user.id).map((t) => t.userId));
    const what = br ? tn(made.length, 'Brief and {n} task created', 'Brief and {n} tasks created') : tn(made.length, 'Created {n} task', 'Created {n} tasks');
    showToast({
      text: people.size ? t('{what}, {told}', { what, told: tn(people.size, '{n} person notified', '{n} people notified') }) : what,
      action: br ? { label: t('Open brief'), run: () => openTask(br.id) } : { label: t('View'), run: () => openTasks({ kind: 'all' }) },
    });
  };

  /** Ask the client to approve a task: it becomes visible in their portal and the guests are told in the client channel. */
  const askApproval = (id: string) => {
    const task = todos.find((x) => x.id === id);
    if (!task) return;
    patchTask(id, { visibleToClient: true, approval: { status: 'waiting', askedBy: user.id, askedAt: nowIso() } });
    const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === task.clientId && c.guests?.length);
    // The request is a message from you to the guests: in your words.
    if (ch) setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: user.id, text: t('Could you approve “{title}”? It’s waiting for you in your shared space 🙏', { title: task.title }), at: nowIso(), taskId: id }]);
    showToast({ text: ch ? t('Approval requested. {names} will see it in the shared space', { names: fmtList(ch.guests!.map((g) => g.name.split(' ')[0])) }) : t('Approval requested in the shared space') });
  };



  const patchClient = (id: string, patch: Partial<Client>) => {
    const before = clients.find((c) => c.id === id);
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Teammates added to a project hear about it (and it shows in their sidebar from now on).
    if (before && patch.members)
      for (const m of patch.members.filter((x) => x.userId !== user.id && !(before.members ?? []).some((y) => y.userId === x.userId)))
        notify(m.userId, 'task', m.role === 'lead' ? msg('{name} added you to {project} as lead', { name: user.name.split(' ')[0], project: before.name }) : msg('{name} added you to {project}', { name: user.name.split(' ')[0], project: before.name }), { app: 'projects', id: id });
  };
  /** With the local server: a link where a client person sets their password and signs in to their portal. */
  const makeClientInvite = (clientId: string) => async (p: { name: string; email: string }) => {
    if (!real) return null; // the demo, and the demo company: nobody gets a link
    const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, clientId, ...p }) });
    if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${portalOrigin(ws)}${link}` : null; // null: they already sign in, nothing to send. Guests get the company's own address.
  };
  /** Gives someone at a client access to their portal: added to the client's people and its shared channels. */
  const giveClientAccess = async (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string; phone?: string }, status: ClientPerson['status']) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const entry: ClientPerson = { ...person, status, invitedBy: user.id, at: nowIso() };
    setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, people: [...(x.people ?? []).filter((p) => p.email !== person.email), entry] } : x)));
    setChannels((chs) => chs.map((ch) => (ch.clientId === clientId && ch.category === 'shared' && !ch.guests?.some((g) => g.email === person.email) ? { ...ch, guests: [...(ch.guests ?? []), { email: person.email, name: person.name, status: 'invited', invitedBy: user.id, at: nowIso() }] } : ch)));
    const link = await makeClientInvite(clientId)(person);
    showToast(
      inSandbox
        ? { text: t('{name} added to {project}. It’s the demo company, so no invite goes out.', { name: person.name, project: c.name }), ms: 6000 }
        : link
          ? { text: t('{name} can sign in with their invite link', { name: person.name.split(' ')[0] }), action: { label: t('Copy link'), run: () => void navigator.clipboard?.writeText(link) }, ms: 20000 }
          : { text: t('{name} invited to {project}', { name: person.name, project: c.name }) },
    );
  };
  const inviteClientPerson = (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string; phone?: string }) => void giveClientAccess(clientId, person, 'invited');
  const approveClientPerson = (clientId: string, email: string) => {
    const p = clients.find((x) => x.id === clientId)?.people?.find((x) => x.email === email);
    if (p) void giveClientAccess(clientId, { name: p.name, email: p.email, role: p.role }, 'invited');
  };
  /** Ending work with a client: archive their channels, decide what their people keep, optionally close open tasks. */
  const [ending, setEnding] = useState<string | null>(null);
  const endClient = (id: string, o: { date: string; reason: string; archive: boolean; portal: 'readonly' | 'off'; closeTasks: boolean }) => {
    const chans = o.archive ? channels.filter((c) => c.clientId === id && !c.archived).map((c) => c.id) : [];
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'ended', endedAt: new Date(o.date + 'T12:00').toISOString(), endReason: o.reason || undefined, portalAfterEnd: o.portal, archivedOnEnd: chans } : c)));
    if (chans.length) setChannels((cs) => cs.map((c) => (chans.includes(c.id) ? { ...c, archived: true } : c)));
    if (o.closeTasks) setTodos((ts) => ts.map((t) => (t.clientId === id && !t.done ? { ...t, done: true, status: stageIdFor(t, 'done'), doneAt: nowIso(), doneBy: user.id } : t)));
    setEnding(null);
    const c = clients.find((x) => x.id === id);
    showToast({ text: t('Work with {name} ended. They’re in Past {projects}', { name: c?.name ?? '', projects: term.many }), action: { label: t('Undo'), run: () => reactivateClient(id) } });
  };
  const reactivateClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setClients((cs) => cs.map((x) => (x.id === id ? { ...x, status: 'active', endedAt: undefined, endReason: undefined, portalAfterEnd: undefined, archivedOnEnd: undefined } : x)));
    if (c.archivedOnEnd?.length) setChannels((cs) => cs.map((ch) => (c.archivedOnEnd!.includes(ch.id) ? { ...ch, archived: false } : ch)));
    showToast({ text: t('{name} is an active {project} again', { name: c.name, project: term.one }) });
  };

  const loadVault = () => {
    if (!real) return;
    void fetch(`/api/vault?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: VaultItem[] }) => setVaultItems(d.items));
  };
  useEffect(() => {
    // Vault itself, and a project's Logins tab (which lists the project's logins you can see).
    if (mode === 'vault' || mode === 'projects') loadVault();
  }, [mode, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Notes ---------------- */
  // Mine, and the ones shared with the company.
  // Tab orders an admin made everyone's default (each person can still arrange their own).
  const tabDefaults = useMemo(
    () => ({ defaults: ws.tabDefaults ?? {}, canSet: isAdmin, set: (key: string, prefs: { order: string[]; hidden: string[] } | null) => patchWorkspace(ws.id, { tabDefaults: Object.fromEntries(Object.entries({ ...(ws.tabDefaults ?? {}), [key]: prefs }).filter(([, v]) => v)) as Record<string, { order: string[]; hidden: string[] }> }) }),
    [ws.tabDefaults, ws.id, isAdmin], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wsTables = useMemo(() => tables.filter((t) => t.workspaceId === ws.id), [tables, ws.id]);
  const wsTableRows = useMemo(() => tableRows.filter((r) => r.workspaceId === ws.id), [tableRows, ws.id]);
  const currentTable = wsTables.find((t) => t.id === tableId);
  const openTable = (id: string, rowId?: string) => {
    setTableId(id);
    setTableRow(rowId ?? null);
    go('tables');
  };
  const createTable = (d: { name: string; clientId?: string; template: TemplateId }) => {
    const t = makeTable(d, ws.id, user.id);
    setTables((ts) => [...ts, t]);
    setNewTableFor(null);
    openTable(t.id);
  };
  // The company's notes this person sees (Recently deleted too, for its list), and the ones that aren't deleted.
  const wsNotesAll = useMemo(() => notes.filter((n) => n.workspaceId === ws.id && (n.visibility === 'team' || n.ownerId === user.id)), [notes, ws.id, user.id]);
  const wsNotes = useMemo(() => wsNotesAll.filter((n) => !n.deletedAt), [wsNotesAll]);
  const patchNote = (id: string, patch: Partial<Note>) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso(), updatedBy: user.id } : n)));
  /** A new note, open with its title ready to type (the keyboard comes up within the tap that asked for it). */
  const newNote = (title = '', clientId?: string, html = '') => {
    const n: Note = { id: uid(), workspaceId: ws.id, title, html, ownerId: user.id, visibility: clientId ? 'team' : 'private', clientId, createdAt: nowIso(), updatedAt: nowIso(), updatedBy: user.id };
    flushSync(() => {
      setNotes((ns) => [n, ...ns]);
      setNoteId(n.id);
      setNoteOpenAt({ fresh: !title });
      go('notes');
    });
    const focus = () => (document.querySelector(title ? '.note-text' : '.note-title') as HTMLElement | null)?.focus();
    focus();
    setTimeout(focus, 150); // the editor's code was still loading
    return n;
  };
  /** To Recently deleted (30 days), with Undo. */
  const deleteNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    setNotes((ns) => ns.map((x) => (x.id === id ? { ...x, deletedAt: nowIso(), deletedBy: user.id } : x)));
    if (noteId === id) setNoteId(null);
    showToast({ text: t('“{title}” is in Recently deleted', { title: n.title || t('Untitled') }), action: { label: t('Undo'), run: () => setNotes((ns) => ns.map((x) => (x.id === id ? { ...x, deletedAt: undefined, deletedBy: undefined } : x))) } });
  };
  const restoreNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    setNotes((ns) => ns.map((x) => (x.id === id ? { ...x, deletedAt: undefined, deletedBy: undefined } : x)));
    showToast({ text: t('“{title}” is back', { title: n.title || t('Untitled') }), action: { label: t('Open'), run: () => openNote(id) } });
  };
  const purgeNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    setNotes((ns) => ns.filter((x) => x.id !== id));
    if (noteId === id) setNoteId(null);
    showToast({ text: t('“{title}” deleted for good', { title: n.title || t('Untitled') }), action: { label: t('Undo'), run: () => setNotes((ns) => [n, ...ns]) } });
  };
  const duplicateNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    const copy: Note = { ...n, id: uid(), title: n.title ? t('{title} (copy)', { title: n.title }) : '', ownerId: user.id, visibility: n.visibility, pinned: false, html: n.html.replace(/<span class="note-task"[^>]*><\/span>/g, ''), createdAt: nowIso(), updatedAt: nowIso(), updatedBy: user.id, deletedAt: undefined, deletedBy: undefined };
    setNotes((ns) => [copy, ...ns]);
    showToast({ text: t('Copy made'), also: { label: t('Open'), run: () => openNote(copy.id) }, action: { label: t('Undo'), run: () => setNotes((ns) => ns.filter((x) => x.id !== copy.id)) } });
  };
  const openNote = (id: string, find?: string) => (setNoteId(id), setNoteOpenAt({ find }), go('notes'));
  const notesApi: NotesApi = {
    me: user.id,
    company: ws.name,
    clients: wsClientsAll,
    users: members,
    canDeleteOthers: isAdmin || !!perms.deleteThings,
    byId: (id) => notes.find((n) => n.id === id),
    patch: patchNote,
    remove: deleteNote,
    restore: restoreNote,
    purge: purgeNote,
    duplicate: duplicateNote,
  };
  // A link to a note (/notes/<id>) opens it; something shared from another app (/notes/new) is in quick capture.
  useEffect(() => {
    const m = location.pathname.match(/^\/notes\/([^/]+)\/?$/);
    if (!m) return;
    if (m[1] === 'new') return void history.replaceState(null, '', '/notes');
    const id = decodeURIComponent(m[1]);
    if (notes.some((n) => n.id === id)) openNote(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tells the client people who should know (the requester, or everyone at the client for shared work). */
  const tellClient = (t: Todo, words: { text: string; tr: Msg }) => {
    const c = clients.find((x) => x.id === t.clientId);
    if (!c) return;
    const to = t.requestedBy ? [t.requestedBy] : clientPeople(c, channels).filter((p) => p.status !== 'pending').map((p) => p.email);
    setNotices((ns) => [...to.map((e) => ({ id: uid(), userId: clientInbox(e), workspaceId: ws.id, kind: 'task' as const, ...words, at: nowIso(), read: false, link: { app: 'tasks' as const, id: t.id } })), ...ns]);
  };

  /** Inviting from the demo company: it says it's the demo, and where to invite people for real. */
  const demoNoInvites = () => {
    const realWs = workspaces.find((w) => !isSandbox(w));
    showToast({ text: t('This is the demo company, so nobody is invited from here. Invite your team in your real company.'), ms: 7000, action: realWs ? { label: t('Go to {name}', { name: realWs.name }), run: () => switchWorkspace(realWs.id) } : undefined });
  };
  /** Free covers 5 people: the 6th invite shows the price at that moment instead of a wall. */
  const openInvite = () => {
    if (inSandbox) return demoNoInvites();
    if (ws.plan?.tier === 'free' && members.length >= 5) {
      showToast({ text: t('Free covers 5 people. Add more on Small for {price} per person a month', { price: rp(39_000) }), action: { label: t('See plans'), run: () => (setSettingsSection('billing'), go('settings')) }, ms: 8000 });
      return;
    }
    setInviting(true);
  };

  /* ---------------- The one assistant ---------------- */

  /** Ask AI starts where you are: this meeting, this channel, this client, or everything. */
  const contextScope = (): AskScope =>
    mode === 'meet' && meetPage.kind === 'meeting'
      ? { kind: 'meeting', id: meetPage.id }
      : mode === 'meet' && meetPage.kind === 'folder'
        ? { kind: 'client', id: meetPage.clientId }
        : mode === 'chat' && chatId
          ? { kind: 'channel', id: chatId }
          : mode === 'tasks' && taskScope.kind === 'client'
            ? { kind: 'client', id: taskScope.id }
            : { kind: 'all' };
  const toggleAsk = () => (askScope ? setAskScope(null) : openAsk(contextScope()));
  const askOptions = [
    { value: 'all', label: 'Everything', group: 'Everywhere' },
    ...wsClients.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}` })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}`, group: 'Channels' })),
    ...[...wsMeetings].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12).map((m) => ({ value: `meeting:${m.id}`, label: m.title, group: 'Meetings' })),
  ];

  /** Sources for a scope: meetings, emails, chat and tasks, shaped the same way for the AI. */
  const askAnything = async (q: string, scope: AskScope) => {
    tried('ask');
    const client = scope.kind === 'client' ? wsClients.find((c) => c.id === scope.id) : undefined;
    const meetSrc = (m: Meeting) => ({ kind: 'M' as const, id: m.id, title: m.title, summary: m.summary, transcript: m.transcript ?? [], actions: m.actions.map((a) => ({ title: a.title, owner: a.owner, done: !!todos.find((t) => t.id === a.taskId)?.done })) });
    const mailSrc = (t: Thread) => ({ kind: 'E' as const, id: t.id, title: t.subject, summary: t.messages[t.messages.length - 1].body.slice(0, 300), transcript: t.messages.map((m, i) => ({ speaker: m.from.name, text: m.body.slice(0, 400), at: i })), actions: [] });
    const chanSrc = (c: Channel) => ({ kind: 'C' as const, id: c.id, title: `#${c.name}`, summary: c.topic ?? '', transcript: messages.filter((m) => m.channelId === c.id && m.text).slice(-60).map((m, i) => ({ speaker: allUsers.find((u) => u.id === m.userId)?.name.split(' ')[0] ?? 'Guest', text: m.text, at: i })), actions: [] });
    const taskSrc = (id: string, list: Todo[]) => ({ kind: 'T' as const, id, title: 'Tasks', summary: '', transcript: [], actions: list.filter((t) => t.kind !== 'brief').map((t) => ({ title: t.title + (t.due && t.due < localDay() && !t.done ? ' (overdue)' : ''), owner: allUsers.find((u) => u.id === t.userId)?.name.split(' ')[0], done: t.done })) });
    // Mail questions in the "everything" view use the inbox assistant.
    if (scope.kind === 'all' && /urgent|unread|inbox|email|mail|invoice/i.test(q)) {
      const r = await ai.assistant(q, scoped, settings.name || user.name);
      return r.answer + (r.threadIds.length ? '\n' + r.threadIds.map((id) => `[E:${id}]`).join(' ') : '');
    }
    const sources =
      scope.kind === 'meeting'
        ? wsMeetings.filter((m) => m.id === scope.id).map(meetSrc)
        : scope.kind === 'channel'
          ? wsChannels.filter((c) => c.id === scope.id).map(chanSrc)
          : scope.kind === 'client' && client
            ? [
                ...wsMeetings.filter((m) => m.clientId === client.id && m.summary).map(meetSrc),
                ...(client.domain ? wsThreads.filter((t) => t.messages.some((m) => peopleOf(m).some((x) => x.email.endsWith('@' + client.domain)))).map(mailSrc) : []),
                ...wsChannels.filter((c) => c.clientId === client.id).map(chanSrc),
                taskSrc(client.id, wsTasks.filter((t) => t.clientId === client.id)),
              ]
            : [...wsMeetings.filter((m) => m.summary).slice(0, 25).map(meetSrc), ...wsChannels.filter((c) => c.kind === 'channel').map(chanSrc), taskSrc('all', wsTasks)];
    return ai.askMeetings(q, sources);
  };

  /** Everything this company has, as one JSON file. Always free, on every plan. */
  const exportEverything = () => {
    const data = {
      exportedAt: nowIso(),
      workspace: { ...ws, ai: ws.ai && { ...ws.ai, providers: ws.ai.providers.map((p) => ({ ...p, keyLast4: '••••' })) } },
      people: members,
      teams: wsTeams,
      clients: wsClients,
      tasks: wsTasks,
      channels: channels.filter((c) => c.workspaceId === ws.id),
      messages: messages.filter((m) => channels.some((c) => c.id === m.channelId && c.workspaceId === ws.id)),
      meetings: wsMeetings,
      mail: wsThreads,
      events: events.filter((e) => e.feed !== 'link' && !e.busy && (e.workspaceId ?? 'pnp') === ws.id), // not people's own calendar links
      files: drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id).map((d) => ({ ...d, thumb: undefined })),
    };
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-export-${nowIso().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast({ text: t('Export downloaded') });
    } catch {
      showToast({ text: t('Your browser blocked the download') });
    }
  };

  /** Invite someone by name and email (from the brain dump's "Who is Andi?"). */
  const inviteByName = (name: string, email: string): User => {
    // The demo company's people are made up: nobody real is invited from it, so the work stays with you.
    if (inSandbox) return (demoNoInvites(), user);
    const existing = allUsers.find((u) => u.email.toLowerCase() === email);
    const u: User = existing ?? { id: uid(), name: name.charAt(0).toUpperCase() + name.slice(1), email, title: 'Invited', color: ['#0ea5e9', '#f97316', '#8b5cf6', '#10b981'][allUsers.length % 4] };
    if (!existing) onInvite(u);
    if (!ws.members.some((m) => m.userId === u.id)) patchWorkspace(ws.id, { members: [...ws.members, { userId: u.id, role: 'member' }] });
    showToast({ text: t('Invited {name} ({email})', { name: u.name, email }) });
    return u;
  };

  /** Who's around: in a meeting (from the calendar or their status), away, or active. */
  const presence = (id: string): Presence => {
    if (id === user.id) {
      const now = new Date().toISOString();
      return myNear.some((e) => !e.allDay && new Date(e.start).toISOString() <= now && new Date(e.end).toISOString() > now) ? 'meeting' : 'active';
    }
    if (statuses[id]?.emoji === '🗓️') return 'meeting';
    return id === 'u-intan' || id === 'u-tomas' ? 'away' : 'active';
  };

  /** Files shared in chat are saved to Drive, filed under the channel's client. */
  const saveChatFiles = (files: ChatFile[], ch: Channel): ChatFile[] =>
    files.map((f) => {
      const id = uid();
      setDrive((d) => [...d, { id, name: f.name, kind: kindOf(f), parentId: null, size: f.size, modified: nowIso(), workspaceId: ws.id, clientId: ch.clientId, channelId: ch.id, thumb: f.type.startsWith('image') ? f.url : undefined }]);
      return { ...f, driveId: id };
    });

  /** Who hears about a message as it goes out: the other side of a DM, people it mentions, whoever wrote what it answers. */
  const chatNotices = (m: ChatMessage, ch: Channel) => {
    const text = m.text;
    const where = ch.kind === 'dm' ? (isGroupDm(ch) ? phrase('a group message') : phrase('a message')) : `#${ch.name}`;
    if (m.kind === 'kudos' && m.kudosFor) notify(m.kudosFor, 'mention', text ? msg('🙌 {name} gave you kudos in {where}: “{text}”', { name: myFirst, where, text: text.slice(0, 80) }) : msg('🙌 {name} gave you kudos in {where}', { name: myFirst, where }), { app: 'chat', id: ch.id, msg: m.id });
    // Once each: the others in a DM or group message, people mentioned, a thread's followers (src/chatFollow.ts).
    const root = m.parentId ? messages.find((x) => x.id === m.parentId) : undefined;
    const thread = root ? { root, replies: messages.filter((x) => x.parentId === root.id && x.id !== m.id && !x.sendAt) } : null;
    const said = (text || msgPreview(m)).slice(0, 80);
    for (const { id, why } of chatRecipients(m, ch, thread, firstOf)) {
      if (id === m.kudosFor && m.kind === 'kudos') continue;
      const words =
        why === 'dm'
          ? msg('{name} messaged you: “{text}”', { name: myFirst, text: said })
          : why === 'group'
            ? msg('{name} in a group message: “{text}”', { name: myFirst, text: said })
            : why === 'reply'
              ? msg('{name} replied to your message in {where}: “{text}”', { name: myFirst, where, text: said })
              : why === 'thread'
                ? msg('{name} replied in a thread you follow in {where}: “{text}”', { name: myFirst, where, text: said })
                : msg('{name} mentioned you in {where}: “{text}”', { name: myFirst, where, text: said });
      notify(id, 'mention', words, { app: 'chat', id: ch.id, msg: m.id });
    }
  };
  const sendChat = (pl: SendPayload) => chatId && sendChatTo(chatId, pl);
  /** A message from me into a conversation; with `sendAt` it waits (the server sends it then, with its notices). */
  const sendChatTo = (channelId: string, pl: SendPayload & { forwarded?: ChatMessage['forwarded'] }) => {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) return;
    // Files already in Drive (shared from it) aren't saved there again.
    const files = pl.files ? [...saveChatFiles(pl.files.filter((f) => !f.driveId), ch), ...pl.files.filter((f) => f.driveId)] : undefined;
    const msgId = uid();
    if (pl.voice) tried('voice');
    const msg: ChatMessage = { id: msgId, channelId, userId: user.id, text: pl.text, at: nowIso(), parentId: pl.parentId, alsoInChannel: pl.alsoInChannel, files, voice: pl.voice, poll: pl.poll, kind: pl.kind, kudosFor: pl.kudosFor, taskId: pl.taskId, ref: pl.ref, forwarded: pl.forwarded, sendAt: pl.sendAt, ...(pl.tr ? { tr: pl.tr } : {}) };
    setMessages((ms) => [...ms, msg]);
    if (pl.sendAt) return;
    chatNotices(msg, ch);
    const text = pl.text;
    // DEMO ONLY: the other person answers a DM a few seconds later, so the chat feels alive.
    if (demoOk && ch.kind === 'dm' && !pl.parentId) {
      const other = ch.members.find((m) => m !== user.id)!;
      setTimeout(() => {
        const reply = pl.voice ? 'Got your voice note, will do 👍' : /\?/.test(text) ? 'Good question, let me check and get back to you shortly.' : /thank/i.test(text) ? 'Anytime! 🙌' : '👍 Got it, on it.';
        setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: other, text: reply, at: nowIso() }]);
      }, 3500);
    }
  };
  /** A message waiting to be sent goes now (Drafts and sent, "Send now"). */
  const sendChatNow = (id: string) => {
    const m = messages.find((x) => x.id === id);
    const ch = m && channels.find((c) => c.id === m.channelId);
    if (!m || !ch || !m.sendAt) return;
    const sent: ChatMessage = { ...m, at: nowIso(), sendAt: undefined };
    setMessages((ms) => ms.map((x) => (x.id === id ? sent : x)));
    chatNotices(sent, ch);
  };
  // Without a server (and in the demo company, which the server doesn't run) messages sent later go out from here.
  useEffect(() => {
    if (server.on && !inSandbox) return;
    const tick = () => {
      const now = nowIso();
      for (const m of messages) if (m.sendAt && m.userId === user.id && m.sendAt <= now) sendChatNow(m.id);
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [messages, inSandbox]); // eslint-disable-line react-hooks/exhaustive-deps
  const editMessage = (id: string, text: string) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, text, edited: true } : m)));
  const forwardMessage = (m: ChatMessage, to: { channelId?: string; userId?: string }, note: string) => {
    const target = to.channelId ?? (to.userId ? dmWith(to.userId) : null);
    const from = channels.find((c) => c.id === m.channelId);
    if (!target || !from) return;
    // Saved with the message: English, shown in each reader's language (Message.tsx).
    const who = m.guestEmail ? (from.guests?.find((g) => g.email === m.guestEmail)?.name ?? mark('A guest')) : (allUsers.find((u) => u.id === m.userId)?.name ?? m.authorName ?? mark('Someone'));
    // Next tick: a brand-new DM has to exist before its first message.
    setTimeout(() => {
      sendChatTo(target, { text: note, forwarded: { channelId: m.channelId, messageId: m.id, userId: m.userId, who, where: chanName(from, allUsers, user.id), text: m.text || msgPreview(m), at: m.at } });
      const toCh = channels.find((c) => c.id === target);
      showToast({ text: t('Forwarded to {name}', { name: toCh ? chanName(toCh, allUsers, user.id) : firstOf(to.userId) }), action: { label: t('Open'), run: () => openChannel(target) } });
    }, 0);
  };
  const leaveChannel = (id: string) => {
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: c.members.filter((x) => x !== user.id) } : c)));
    if (chatId === id) setChatId(null);
    showToast({ text: t('You left {name}', { name: chanName(ch, allUsers, user.id) }), action: ch.private ? undefined : { label: t('Undo'), run: () => setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: [...new Set([...c.members, user.id])] } : c))) } });
  };
  const openChatRef = (r: NonNullable<ChatMessage['ref']>) => {
    if (r.kind === 'note') return wsNotes.some((n) => n.id === r.id) ? openNote(r.id) : showToast({ text: t('That note is private, or isn’t here any more.') });
    if (r.kind === 'row') return r.tableId && wsTables.some((tb) => tb.id === r.tableId) ? openTable(r.tableId, r.id) : showToast({ text: t('You can’t open that table.') });
    const it = wsDrive.find((d) => d.id === r.id && !d.trashed);
    if (it) setPreview({ item: it, list: [it] });
    else showToast({ text: t('That file isn’t in Drive any more.') });
  };

  const reactTo = (id: string, emoji: string) =>
    setMessages((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const r = { ...(m.reactions ?? {}) };
        const who = r[emoji] ?? [];
        r[emoji] = who.includes(user.id) ? who.filter((x) => x !== user.id) : [...who, user.id];
        return { ...m, reactions: r };
      }),
    );
  /** Follow or unfollow a thread: my own choice on its root message (the server keeps everyone else's as it was). */
  const followThread = (rootId: string, on: boolean) => setMessages((ms) => ms.map((m) => (m.id === rootId ? { ...m, follow: { ...(m.follow ?? {}), [user.id]: on } } : m)));
  const votePoll = (id: string, option: number) =>
    setMessages((ms) =>
      ms.map((m) =>
        m.id === id && m.poll
          ? { ...m, poll: { ...m.poll, options: m.poll.options.map((o, i) => ({ ...o, votes: i === option ? (o.votes.includes(user.id) ? o.votes.filter((v) => v !== user.id) : [...o.votes, user.id]) : o.votes.filter((v) => v !== user.id) })) } }
          : m,
      ),
    );
  const deleteMessage = (id: string) => {
    const snapshot = messages;
    setMessages((ms) => ms.filter((m) => m.id !== id && m.parentId !== id));
    showToast({ text: t('Message deleted'), action: { label: t('Undo'), run: () => setMessages(snapshot) } });
  };

  const makeTaskFromMessage = (m: ChatMessage) => {
    const ch = channels.find((c) => c.id === m.channelId);
    const mentioned = members.find((u) => u.id !== m.userId && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(m.text));
    const assignee = mentioned?.id ?? (m.userId === user.id ? user.id : user.id);
    let title = m.text.replace(/@\w+\s*/g, '').replace(/^(can you|could you|please)\s+/i, '').replace(/[?!.]+$/, '').trim();
    title = (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 90);
    const task = createTask({ title, userId: assignee, clientId: ch?.clientId, source: 'chat' });
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, taskId: task.id } : x)));
    showToast({ text: assignee === user.id ? t('Task created for you') : t('Task created for {name}', { name: firstOf(assignee) }), action: { label: t('View'), run: () => openTask(task.id) } });
  };

  const DAY_WORDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dueFromWord = (w?: string) => {
    if (!w) return undefined;
    const l = w.toLowerCase();
    const d = new Date();
    if (l.startsWith('tomorrow')) d.setDate(d.getDate() + 1);
    else if (l.startsWith('next week')) d.setDate(d.getDate() + 7);
    else {
      const i = DAY_WORDS.findIndex((x) => l.startsWith(x));
      if (i < 0) return undefined;
      d.setDate(d.getDate() + (((i - d.getDay() + 7) % 7) || 7));
    }
    return localDay(d);
  };

  const meetingActionToTask = (m: Meeting, i: number, quiet = false) => {
    const a = m.actions[i];
    if (a.taskId) return;
    const owner = members.find((u) => a.owner && u.name.toLowerCase().startsWith(a.owner.toLowerCase()));
    const task = createTask({ title: a.title, userId: owner?.id ?? '', clientId: m.clientId, due: dueFromWord(a.due), source: 'meeting', meetingId: m.id, saidAt: a.saidAt }, { chat: true });
    setMeetings((ms) => ms.map((x) => (x.id === m.id ? { ...x, actions: x.actions.map((y, j) => (j === i ? { ...y, taskId: task.id } : y)) } : x)));
    if (!quiet) showToast({ text: owner ? `Task created for ${owner.id === user.id ? 'you' : owner.name.split(' ')[0]}` : 'Task created, not assigned yet' });
  };

  /* ---------------- Meet: the notetaker ---------------- */

  meetingsRef.current = meetings;
  const patchMeeting = (id: string, p: Partial<Meeting>) => setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const meetLog = (id: string, message: string, p: Partial<Meeting> = {}) =>
    setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, ...p, log: [...(m.log ?? []), { message, at: nowIso() }] } : m)));
  const later = (id: string, ms: number, fn: () => void) => {
    const t = window.setTimeout(fn, ms);
    botTimers.current[id] = [...(botTimers.current[id] ?? []), t];
  };
  const meetSettings = ws.meetings ?? DEFAULT_MEETINGS;

  /** Which client a meeting belongs to: the first matching rule, else the AI's suggestion. */
  const fileByRules = (m: Meeting, aiFolder: string) => {
    const speakers = (m.transcript ?? []).map((l) => l.speaker.toLowerCase());
    const text = `${m.title} ${m.summary}`.toLowerCase();
    const rule = (ws.meetingRules ?? []).find((r) =>
      r.kind === 'participant' ? speakers.includes(r.value.toLowerCase()) : r.kind === 'domain' ? (m.url ?? '').includes(r.value) || m.attendees.some((a) => a.toLowerCase().includes(r.value.split('.')[0])) : text.includes(r.value.toLowerCase()),
    );
    if (rule) return { clientId: rule.clientId, filedBy: 'rule' as const };
    const c = wsClients.find((x) => x.name.toLowerCase() === aiFolder.toLowerCase());
    return c ? { clientId: c.id, filedBy: 'ai' as const } : { clientId: undefined, filedBy: undefined };
  };

  /** After the bot leaves: write notes, file the meeting, make tasks. */
  const finishMeeting = (id: string, regenerate = false) => {
    const m = meetings.find((x) => x.id === id);
    meetLog(id, regenerate ? 'Writing notes again' : 'Writing notes', { status: 'processing' });
    later(id, 50, async () => {
      const current = meetingsRef.current.find((x) => x.id === id) ?? m;
      if (!current) return;
      if (!current.transcript?.length) {
        meetLog(id, 'No transcript, so no notes', { status: 'done' });
        return;
      }
      const notes = await ai.meetingNotes(current.title, current.transcript, wsClients.map((c) => c.name), members.map((u) => u.name.split(' ')[0]));
      const filed = current.filedBy === 'user' ? { clientId: current.clientId, filedBy: 'user' as const } : fileByRules({ ...current, summary: notes.summary }, notes.folder);
      const actions = notes.actions.map((a) => ({ ...a, taskId: undefined as string | undefined }));
      // Regenerating keeps tasks people edited; AI tasks nobody touched are replaced.
      if (regenerate) setTodos((ts) => ts.filter((t) => !(t.meetingId === id && t.source === 'meeting' && !t.done && t.createdBy === user.id && !t.notes)));
      const mins = Math.max(1, Math.round((current.transcript[current.transcript.length - 1].at + 60_000) / 60_000));
      const keep = filed.clientId ? meetSettings.clientMeetings : meetSettings.internalMeetings;
      const next: Meeting = {
        ...current,
        title: current.title || notes.title,
        summary: notes.summary,
        keyPoints: notes.keyPoints,
        decisions: notes.decisions,
        openQuestions: notes.openQuestions,
        topics: notes.topics,
        type: current.type ?? notes.type,
        tags: notes.tags,
        actions,
        minutes: current.minutes || mins,
        clientId: filed.clientId,
        filedBy: filed.filedBy,
        status: 'done',
        recording: current.recording ?? { keep, sizeMb: keep === 'video' ? mins * 18.3 : keep === 'audio' ? mins * 0.8 : 0.4 },
        sharedWithClient: current.sharedWithClient ?? (filed.clientId ? meetSettings.shareNotesWithClient : false),
      };
      setMeetings((ms) => ms.map((x) => (x.id === id ? { ...next, log: [...(x.log ?? []), ...(filed.filedBy === 'rule' ? [{ message: `Filed in ${wsClients.find((c) => c.id === filed.clientId)?.name} by rule`, at: nowIso() }] : filed.filedBy === 'ai' ? [{ message: `Filed in ${wsClients.find((c) => c.id === filed.clientId)?.name} by AI`, at: nowIso() }] : []), { message: `Kept: ${keep === 'video' ? 'video, audio and notes' : keep === 'audio' ? 'audio and notes' : 'notes and transcript only'}`, at: nowIso() }, { message: 'Done', at: nowIso() }] } : x)));
      if (meetSettings.autoTasks !== false && ws.ai?.auto.meetingNotes !== false) later(id, 60, () => next.actions.forEach((_, i) => meetingActionToTask(next, i, true)));
      notify(current.createdBy ?? user.id, 'meeting', actions.length === 1 ? msg('Notes are ready for “{title}” · 1 action item', { title: next.title }) : msg('Notes are ready for “{title}” · {n} action items', { title: next.title, n: actions.length }), { app: 'meet', id });
      if (current.createdBy !== user.id) return;
      showToast({ text: t('Notes ready for “{title}”', { title: next.title }), action: { label: t('Open'), run: () => openMeeting(id) } });
    });
  };

  // The recorder bot's notes were written on the server: the person who sent it gets the tasks and the heads-up.
  useEffect(() => {
    meetings
      .filter((m) => m.needsTasks && m.createdBy === user.id && m.workspaceId === ws.id)
      .forEach((m) => {
        patchMeeting(m.id, { needsTasks: false });
        // Notes written again (another language, say): AI tasks from the old notes that nobody touched make way for the new ones.
        setTodos((ts) => ts.filter((t) => !(t.meetingId === m.id && t.source === 'meeting' && !t.done && !t.notes && t.createdBy === user.id)));
        if (meetSettings.autoTasks !== false && ws.ai?.auto.meetingNotes !== false) m.actions.forEach((_, i) => meetingActionToTask(m, i, true));
        notify(user.id, 'meeting', m.actions.length === 1 ? msg('Notes are ready for “{title}” · 1 action item', { title: m.title }) : msg('Notes are ready for “{title}” · {n} action items', { title: m.title, n: m.actions.length }), { app: 'meet', id: m.id });
        showToast({ text: t('Notes ready for “{title}”', { title: m.title }), action: { label: t('Open'), run: () => openMeeting(m.id) } });
      });
  }, [meetings]); // eslint-disable-line react-hooks/exhaustive-deps

  // The demo company's "Try this": a meeting with notes was opened.
  useEffect(() => {
    if (inSandbox && mode === 'meet' && meetPage.kind === 'meeting' && meetings.some((m) => m.id === meetPage.id && !!m.summary)) tried('meeting');
  }, [inSandbox, mode, meetPage]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The demo bot: joins, waits to be let in, records a short sample conversation, leaves and writes notes. */
  const sendBot = (d: { url: string; title: string; botName: string; clientId: string; attendees?: string[]; fromEvent?: string; language?: string }) => {
    const id = uid();
    const zoom = /zoom/i.test(d.url);
    const m: Meeting = { id, workspaceId: ws.id, title: d.title, at: nowIso(), minutes: 0, clientId: d.clientId || undefined, filedBy: d.clientId ? 'user' : undefined, attendees: d.attendees ?? [], summary: '', actions: [], status: 'queued', platform: zoom ? 'zoom' : 'meet', url: d.url, botName: d.botName, transcript: [], log: [{ message: d.fromEvent ? `Sent from calendar: ${d.title}` : 'Queued', at: nowIso() }], createdBy: user.id };
    if (d.fromEvent) setSentEvents((s2) => ({ ...s2, [d.fromEvent!]: id }));
    setSendBotOpen(false);
    setMeetPage({ kind: 'meeting', id });
    go('meet');
    // With the real recorder, the server saves the meeting and the bot fills it in from there (never from the demo company).
    if (recorderOn && real) {
      const real = { ...m, bot: true, ...(d.language ? { language: d.language } : {}) };
      setMeetings((ms) => [real, ...ms]);
      void fetch('/api/meet/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meeting: real }) }).then(async (r) => {
        if (r.ok) return;
        const error = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t send the notetaker';
        // Refused before it was saved (no hours left, a read-only company): the meeting says so instead of waiting forever.
        setMeetings((ms) => ms.map((x) => (x.id === id && x.status === 'queued' ? { ...x, status: 'failed', error, log: [...(x.log ?? []), { message: `Couldn’t send the bot: ${error}`, at: nowIso() }] } : x)));
        showToast({ text: error, ms: 7000 });
      });
      return;
    }
    setMeetings((ms) => [m, ...ms]);
    later(id, 1200, () => meetLog(id, `Joining ${zoom ? 'Zoom' : 'Google Meet'} as “${d.botName}”`, { status: 'joining' }));
    later(id, 2800, () => meetLog(id, 'Waiting to be let in', { status: 'waiting_room' }));
    later(id, 5000, () => meetLog(id, `Let in. Posted in the meeting chat: “Hi, I'm ${d.botName}. I'm recording this meeting and taking notes.”`, { status: meetSettings.announce ? 'recording' : 'recording' }));
    DEMO_SCRIPT.forEach((line, i) =>
      later(id, 6500 + i * 2200, () =>
        setMeetings((ms) => ms.map((x) => (x.id === id && x.status === 'recording' ? { ...x, transcript: [...(x.transcript ?? []), { speaker: line.speaker === 'You' ? myFirst : line.speaker === `${term.One}` ? 'Guest' : line.speaker, text: line.text, at: 15_000 + i * 42_000 }] } : x))),
      ),
    );
    later(id, 6500 + DEMO_SCRIPT.length * 2200 + 1500, () => {
      if (meetingsRef.current.find((y) => y.id === id)?.status === 'recording') {
        meetLog(id, 'Everyone else left');
        finishMeeting(id);
      }
    });
  };

  const stopBot = (id: string) => {
    const m = meetings.find((x) => x.id === id);
    if (m?.bot) return void fetch(`/api/meet/stop/${id}`, { method: 'POST' });
    (botTimers.current[id] ?? []).forEach(clearTimeout);
    botTimers.current[id] = [];
    if (!m || m.status !== 'recording') {
      meetLog(id, 'Stopped before recording began', { status: 'stopped' });
      return;
    }
    meetLog(id, 'Asked to leave', { status: 'stopping' });
    later(id, 900, () => finishMeeting(id));
  };

  const deleteMeeting = (id: string) => {
    const snapshot = { meetings, todos };
    (botTimers.current[id] ?? []).forEach(clearTimeout);
    setMeetings((ms) => ms.filter((m) => m.id !== id));
    setTodos((ts) => ts.filter((t) => t.meetingId !== id || t.done));
    setMeetPage({ kind: 'list' });
    showToast({ text: t('Meeting deleted'), action: { label: t('Undo'), run: () => (setMeetings(snapshot.meetings), setTodos(snapshot.todos)) } });
  };

  const setMeetingFolder = (id: string, clientId: string | null, remember: boolean) => {
    const m = meetings.find((x) => x.id === id);
    patchMeeting(id, { clientId: clientId ?? undefined, filedBy: 'user' });
    if (remember && m && clientId) {
      const outsiders = [...new Set((m.transcript ?? []).map((l) => l.speaker))].filter((sp) => !members.some((u) => u.name.split(' ')[0] === sp.split(' ')[0]) && sp !== 'Guest');
      const rules = outsiders.map((v) => ({ id: uid(), kind: 'participant' as const, value: v, clientId }));
      patchWorkspace(ws.id, { meetingRules: [...(ws.meetingRules ?? []), ...rules] });
      showToast({ text: t('Meetings with {names} will be filed here', { names: fmtList(outsiders) }) });
    }
  };

  const writeOverview = async (clientId: string) => {
    const c = wsClients.find((x) => x.id === clientId);
    const list = wsMeetings.filter((m) => m.clientId === clientId && m.summary);
    if (!c) return;
    const found = wsTasks.filter((x) => x.meetingId && list.some((m) => m.id === x.meetingId));
    const o = await ai.folderOverview(c.name, list.map((m) => ({ title: m.title, summary: m.summary, decisions: m.decisions ?? [], openQuestions: m.openQuestions ?? [] })), found.filter((x) => !x.done).map((x) => x.title), found.filter((x) => x.done).length);
    setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, overview: { ...o, at: nowIso(), from: list.length } } : x)));
    showToast({ text: t('Overview updated') });
  };

  const openNotice = (n: Notice) => {
    setNotices((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setNoticesOpen(false);
    if (n.url) return void location.assign(n.url);
    if (!n.link) return;
    if (n.link.app === 'tasks') return n.link.id ? openTask(n.link.id) : openTasks({ kind: 'mine' });
    if (n.link.app === 'projects' && n.link.id) return openClient(n.link.id);
    if (n.link.app === 'chat') {
      if (n.link.msg) setFocusMsg(n.link.msg);
      return n.link.id ? openChannel(n.link.id) : go('chat');
    }
    if (n.link.app === 'mail' && n.link.id) return openThread(n.link.id);
    if (n.link.app === 'meet') return n.link.id ? openMeeting(n.link.id) : go('meet');
    if (n.link.app === 'tables' && n.link.id) return openTable(n.link.id, n.link.msg);
    if (n.link.app === 'teams') return (setTeamId(n.link.id ?? null), go('teams'));
    if (n.link.app === 'settings') return (setSettingsSection((n.link.id ?? 'account') as SettingsSection), go('settings'));
    if (n.link.app === 'notes' && n.link.id) return openNote(n.link.id);
    if (n.link.app === 'calendar' && n.link.id) {
      const ev = findEvent(events, n.link.id);
      if (ev) (setCalCursor(new Date(ev.start)), setSelectedEventId(ev.id));
    }
    go(n.link.app);
  };
  // Notifications on phones and computers: a tap opens the item, the icon shows the unread count (pushBridge.ts).
  usePushBridge({ userId: user.id, wsId: ws.id, workspaceIds: workspaces.map((w) => w.id), notices, switchWs: setWsId, open: openNotice, toast: showToast });
  // Someone just opened an email you sent (the server's notice, server/readTracking.ts): a toast too while you're here.
  const openedSeen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const opened = myNotices.filter((n) => n.event === 'opened');
    if (!openedSeen.current) return void (openedSeen.current = new Set(opened.map((n) => n.id)));
    for (const n of opened) {
      if (openedSeen.current.has(n.id)) continue;
      openedSeen.current.add(n.id);
      if (!n.read && Date.now() - Date.parse(n.at) < 120_000) showToast({ text: textOf(n), action: { label: t('View'), run: () => openNotice(n) } });
    }
  }, [myNotices]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Calendar ---------------- */

  // My outside calendars (personal: they show in every workspace), this company's public holidays, and teammates'
  // availability on top.
  // Public holidays: the countries this person chose (the company's until they choose), src/holidayRegions.ts.
  const holidays = useHolidayRegions({ chosen: settings.holidayRegions, companyCountry: ws.holidays?.country, live: server.on });
  const setHolidayRegions = (codes: string[]) => updateSettings({ holidayRegions: regionsToSave(codes, ws.holidays?.country) });
  const myExtCals = useMemo(() => [...extCals.filter((c) => c.ownerId === user.id || (c.source === 'holidays' && c.workspaceId === ws.id && holidays.showCompany)), ...holidays.calendars], [extCals, user.id, ws.id, holidays.showCompany, holidays.calendars]);
  const extIds = useMemo(() => new Set(extCals.map((c) => c.id)), [extCals]);
  // Public holidays by day, for the date picker and tasks due on a holiday (the countries this person sees).
  const holidayDays = useMemo(() => {
    const days = new Map<string, string>();
    for (const e of [...events, ...holidays.events]) {
      if (e.feed !== 'holidays' || (e.workspaceId ? e.workspaceId !== ws.id || !holidays.showCompany : false)) continue;
      for (let d = new Date(e.start); d < new Date(e.end); d.setDate(d.getDate() + 1)) {
        const day = localDay(d);
        days.set(day, days.has(day) ? `${days.get(day)}, ${e.title}` : e.title);
      }
    }
    return days;
  }, [events, ws.id, holidays.events, holidays.showCompany]);
  setHolidayDays(holidayDays);
  const mateCals = useMemo(() => members.filter((u) => shownMates.has(u.id)).map((u) => ({ id: `mate-${u.id}`, name: u.name, color: u.color })), [members, shownMates]);
  const allCals = useMemo(() => [...CALENDARS, ...myExtCals, ...mateCals], [myExtCals, mateCals]);
  const visibleEvents = useMemo(() => {
    const mine = events.filter((e) => {
      if (hiddenCals.has(e.calendarId)) return false;
      if (e.feed === 'holidays') return e.workspaceId === ws.id && holidays.showCompany; // the company's, unless they chose other countries
      return (e.userId ?? 'u-raka') === user.id && (extIds.has(e.calendarId) ? myExtCals.some((c) => c.id === e.calendarId) : (e.workspaceId ?? 'pnp') === ws.id);
    });
    const mates = events.flatMap((e) => {
      if (e.feed === 'holidays') return [];
      const owner = e.userId ?? 'u-raka';
      if (owner === user.id || !shownMates.has(owner)) return [];
      const ext = extCals.find((c) => c.id === e.calendarId);
      if (!ext && (e.workspaceId ?? 'pnp') !== ws.id) return [];
      const share = ext ? (ext.share ?? 'busy') : 'details';
      if (share === 'private') return [];
      const first = (allUsers.find((u) => u.id === owner)?.name ?? 'Someone').split(' ')[0];
      const busy = share === 'busy' || !!e.busy;
      // A repeating one keeps its dates; a date changed on its own shows only what the rest of it shows.
      const overrides = e.overrides?.map((o) => ({ occurrence: o.occurrence, start: o.start, end: o.end, ...(!busy && o.title ? { title: `${first}: ${o.title}` } : {}), ...(!busy && o.location !== undefined ? { location: o.location } : {}) }));
      return [{ ...e, id: `m-${e.id}`, calendarId: `mate-${owner}`, title: `${first}: ${busy ? 'Busy' : e.title}`, notes: undefined, guests: undefined, location: share === 'busy' ? undefined : e.location, threadId: undefined, meetUrl: undefined, answers: undefined, overrides }];
    });
    return [...mine, ...holidays.events.filter((e) => !hiddenCals.has(e.calendarId)), ...mates];
  }, [events, hiddenCals, ws.id, user.id, extIds, myExtCals, extCals, shownMates, allUsers, holidays.events, holidays.showCompany]);
  /** My events as stored: a repeating one once, as its series. The calendar draws its dates for what's on screen. */
  const myEvents = useMemo(() => visibleEvents.filter((e) => !e.calendarId.startsWith('mate-')), [visibleEvents]);
  /** My events around now, repeating ones as their dates (yesterday to two months on): Home, Meet, scheduling, who's in a meeting. */
  const calToday = localDay();
  const myNear = useMemo(() => {
    const from = new Date(`${calToday}T00:00`).getTime() - 86_400_000;
    return expandEvents(myEvents, from, from + 62 * 86_400_000);
  }, [myEvents, calToday]);
  // The notetaker joining by itself: the server does it when the real recorder answers; the demo keeps its switches.
  const autoJoin: 'live' | 'demo' | 'off' = recorderOn && real ? 'live' : demoOk ? 'demo' : 'off';
  // (It joins from two minutes before the start until a minute after; a meeting already going gets "Send now".)
  const botWillJoin = (e: CalEvent) => autoJoin === 'live' && (e.userId ?? user.id) === user.id && !e.calendarId.startsWith('mate-') && new Date(e.start).getTime() > Date.now() - 60_000 && botJoins(e, meetSettings.joinMode, joinOverrides, isMine);
  const setBotJoin = (eventId: string, join: boolean | null) =>
    setJoinOverrides((o) => {
      const n = { ...o };
      if (join === null) delete n[eventId];
      else n[eventId] = join;
      return n;
    });
  /** Events the notetaker was sent to (from here, or by itself from the calendar: the same call at the same time). */
  const sentFor = useMemo(() => {
    const out: Record<string, string> = { ...sentEvents };
    const auto = wsMeetings.filter((m) => m.auto && m.scheduledFor && m.url);
    if (!auto.length) return out;
    for (const e of myNear) {
      if (out[e.id]) continue;
      const link = meetingLinkOf(e);
      const start = new Date(e.start).toISOString();
      const hit = auto.find((m) => m.eventId === e.id || (!!link && m.scheduledFor === start && callKey(m.url!) === callKey(link.url)));
      if (hit) out[e.id] = hit.id;
    }
    return out;
  }, [sentEvents, wsMeetings, myNear]);
  // The side panel's mini month: days with something on them (repeating events too), for the month it shows.
  const calMonth = `${calCursor.getFullYear()}-${calCursor.getMonth()}`;
  const busyDays = useMemo(() => {
    const g = monthGrid(calCursor);
    return new Set(expandEvents(myEvents, g[0].getTime(), g[41].getTime() + 86_400_000).map((e) => new Date(e.start).toDateString()));
  }, [myEvents, calMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  function openNewEvent(at?: Date) {
    const d = at ?? new Date(calCursor);
    if (!at) d.setHours(new Date().getHours() + 1, 0, 0, 0);
    setNewEventAt(d);
    setSidebarOpen(false);
  }

  /** New event, or a new task with its time blocked (the editor's Event | Task switch). */
  const saveEvent = (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task' = 'event') => {
    const start = new Date(e.start);
    const task = kind === 'task' ? createTask({ title: e.title, userId: user.id, due: localDay(start), source: 'manual' }) : null;
    const { rrule, ...rest } = e;
    const ev: CalEvent = task ? { id: uid(), title: task.title, calendarId: 'work', start: e.start, end: e.end, allDay: e.allDay, notes: e.notes, remind: e.remind, taskId: task.id, workspaceId: ws.id, userId: user.id } : startOnRule({ ...rest, ...(rrule ? { rrule } : {}), id: uid(), workspaceId: ws.id, userId: user.id }); // a repeat starts on its first date
    tried('event');
    setEvents((es) => [...es, ev]);
    setNewEventAt(null);
    setCalCursor(new Date(ev.start));
    if (!mobile) setSelectedEventId(ev.rrule ? (findEvent([ev], ev.id)?.id ?? ev.id) : ev.id);
    showToast({
      text: task ? t('Task added, with {time} blocked for it', { time: fmtTime(start) }) : ev.rrule ? (ev.start === e.start ? t('Repeating event created') : t('Repeating event created. The first one is {day}', { day: fmtWeekday(ev.start) })) : t('Event created'),
      action: { label: t('Undo'), run: () => (setEvents((es) => es.filter((x) => x.id !== ev.id)), task && setTodos((ts) => ts.filter((x) => x.id !== task.id))) },
    });
  };

  /* ---------- repeating events: one date, this and following, or all ---------- */

  /** A change to a series (and its second half, after "This and following"), with Undo. */
  const applySeries = (change: SeriesChange, text: string) => {
    const touched = new Set([...change.upserts.map((x) => x.id), ...change.deletes]);
    const before = events.filter((x) => touched.has(x.id));
    const put = (list: CalEvent[], from: CalEvent[]) => {
      const byId = new Map(from.map((x) => [x.id, x]));
      const kept = list.filter((x) => !touched.has(x.id) || byId.has(x.id)).map((x) => byId.get(x.id) ?? x);
      return [...kept, ...from.filter((x) => !list.some((y) => y.id === x.id))];
    };
    setEvents((es) => put(es, change.upserts));
    showToast({ text, action: { label: t('Undo'), run: () => setEvents((es) => put(es, before)) } });
  };
  /** What a change to some dates of a series did, in words. */
  const scopeWords = (scope: Scope, what: 'saved' | 'moved' | 'times') =>
    ({
      saved: { one: t('Saved for this event'), following: t('Saved for this and following events'), all: t('Saved for all events') },
      moved: { one: t('Moved this event'), following: t('Moved this and the following events'), all: t('Moved all events') },
      times: { one: t('New times for this event'), following: t('New times for this and following events'), all: t('New times for all events') },
    })[what][scope];
  /** One date of a series and the series it's in, by the date's id. */
  const seriesOf = (id: string) => {
    const occ = findEvent(events, id);
    const series = occ?.seriesId ? events.find((x) => x.id === occ.seriesId && x.rrule) : undefined;
    return occ && series && occ.occurrence ? { occ, series, occurrence: occ.occurrence } : null;
  };
  /** Times from the editor or a drag, written the way the series writes them (an invite's all-day dates float). */
  const asSeriesTimes = (series: CalEvent, p: Partial<CalEvent>) => ({ ...p, ...(p.start ? { start: timeLike(series, new Date(p.start)) } : {}), ...(p.end ? { end: timeLike(series, new Date(p.end)) } : {}) });
  /** The same clock time `n` days later. */
  const addDaysTo = (iso: string, n: number) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + n);
    return d;
  };

  /** Moving one event (a drag, Move to tomorrow, Extend): one date of a series asks which dates, unless it was asked already. */
  const moveEvent = async (id: string, start: Date, end: Date, scope?: Scope, at?: ScopeAt) => {
    const s = seriesOf(id);
    const resized = (before: string) => new Date(before).getTime() === start.getTime();
    const text = (before: string) => (resized(before) ? t('Now {time}', { time: fmtTimeRange(start, end) }) : t('Moved to {when}', { when: `${fmtWeekday(start)} ${fmtTime(start)}` }));
    if (s) {
      const pick = scope ?? (await askRepeatScope(s.occ, t('Move a repeating event'), at));
      if (!pick) return;
      applySeries(changeSeries(s.series, s.occurrence, asSeriesTimes(s.series, { start: start.toISOString(), end: end.toISOString() }), pick, uid), pick === 'one' ? text(s.occ.start) : scopeWords(pick, resized(s.occ.start) ? 'times' : 'moved'));
      return;
    }
    const before = events.find((e) => e.id === id);
    if (!before) return;
    setEvents((es) => es.map((e) => (e.id === id ? { ...e, start: start.toISOString(), end: end.toISOString() } : e)));
    showToast({ text: text(before.start), action: { label: t('Undo'), run: () => setEvents((es) => es.map((e) => (e.id === id ? before : e))) } });
  };

  /** Changes from the editor. Times that moved set the reminder going again (the server keeps track). */
  const updateEvent = async (id: string, e: Omit<CalEvent, 'id'>, at?: ScopeAt) => {
    const s = seriesOf(id);
    if (s) {
      // A new rule (or all day, or another time zone) can't be for one date alone.
      const scope = await askRepeatScope(s.occ, t('Change a repeating event'), at, changesRule(s.series, s.occurrence, e) ? ['following', 'all'] : ['one', 'following', 'all']);
      if (!scope) return;
      applySeries(changeSeries(s.series, s.occurrence, asSeriesTimes(s.series, e), scope, uid), scopeWords(scope, 'saved'));
      setEditEventId(null);
      return;
    }
    const before = events.find((x) => x.id === id);
    if (!before) return;
    const { rrule, ...rest } = e;
    // Repeating from now on: the event becomes a series starting on its date.
    const repeat = rrule === undefined ? {} : rrule ? { rrule } : { rrule: undefined };
    setEvents((es) => es.map((x) => (x.id === id ? startOnRule({ ...x, ...rest, guests: e.guests, location: e.location, meetUrl: e.meetUrl, notes: e.notes, allDay: e.allDay, remind: e.remind, timeZone: e.timeZone, ...repeat }) : x)));
    setEditEventId(null);
    if (rrule) setSelectedEventId(null);
    showToast({ text: rrule ? t('Saved. It repeats now') : t('Event saved'), action: { label: t('Undo'), run: () => setEvents((es) => es.map((x) => (x.id === id ? before : x))) } });
  };
  const duplicateEvent = (id: string) => {
    const e = findEvent(events, id);
    if (!e) return;
    // A date of a repeating event: a copy of that one date.
    const { inviteUid: _u, sequence: _s, occurrence: _o, rsvp: _r, organizer: _org, remindedFor: _rf, feed: _f, rrule: _rr, exdates: _x, rdates: _rd, overrides: _ov, rsvpFrom: _fr, seriesId: _si, answers: _a, invite: _i, sendInvites: _si2, ...rest } = e;
    const copy: CalEvent = { ...rest, id: uid(), title: e.title, workspaceId: ws.id, userId: user.id };
    setEvents((es) => [...es, copy]);
    if (!mobile) setSelectedEventId(copy.id);
    showToast({ text: t('Copy of “{title}” added', { title: e.title }), action: { label: t('Undo'), run: () => setEvents((es) => es.filter((x) => x.id !== copy.id)) } });
  };

  /** My outside calendars other than holidays (links, and the demo's pretend Google and Outlook ones). */
  const linkCals = myExtCals.filter((c) => c.source !== 'holidays');
  /** Read all my calendar links again now (Meet's Upcoming). */
  const refreshLinks = async () => {
    const results = await Promise.all(
      linkCals
        .filter((c) => c.source === 'ics')
        .map((c) =>
          fetch(`/api/calendars/${c.id}/refresh`, { method: 'POST' })
            .then((r) => r.json() as Promise<{ ok?: boolean; error?: string }>)
            .catch(() => ({ ok: false, error: t('Couldn’t reach the server.') }))
            .then((r) => ({ name: c.name, ...r })),
        ),
    );
    const bad = results.find((r) => !r.ok);
    showToast({ text: bad ? `${bad.name}: ${bad.error ? t(bad.error) : t('couldn’t update it')}` : t('Your calendars are up to date'), ms: bad ? 8000 : undefined });
  };

  /** The standalone demo has no server to read holidays: its holiday calendar just follows the setting. */
  const demoHolidays = (country: string | null) => {
    const id = holidayCalendarId(ws.id);
    const c = holidayCountry(country ?? undefined);
    setExtCals((cs) => [...cs.filter((x) => x.id !== id), ...(c ? [{ id, name: t('Holidays in {country}', { country: t(c.name) }), color: '#dc2626', source: 'holidays' as const, workspaceId: ws.id, readOnly: true, share: 'details' as const, country: c.code }] : [])]);
    if (!c) setEvents((es) => es.filter((e) => e.calendarId !== id));
  };

  /**
   * The notetaker to an event's call: its real Meet or Zoom link. Without one it can join, the send dialog opens with the
   * event filled in and asks for the link (the demo makes one up when the event has none).
   */
  const sendNotetakerTo = (e: CalEvent) => {
    if (!botOn) return explainOff(t('The meeting notetaker isn’t available yet. Recordings and notes start working as soon as it is.'));
    const link = meetingLinkOf(e);
    const attendees = (e.guests ?? []).map((g) => g.name);
    const url = link && notetakerJoins(link.kind) ? link.url : !link && demoOk ? (/zoom/i.test(e.location ?? '') ? 'https://zoom.us/j/1234567890' : 'https://meet.google.com/abc-defg-hij') : null;
    if (!url) {
      setSendBotSeed({ title: e.title, fromEvent: e.id, attendees, note: link ? t('This is a {call} call, and the notetaker joins Google Meet and Zoom only.', { call: MEETING_NAME[link.kind] }) : undefined });
      setSendBotOpen(true);
      return;
    }
    sendBot({ url, title: e.title, botName: meetSettings.botName, clientId: '', attendees, fromEvent: e.id });
    setSentEvents((s2) => ({ ...s2, [e.id]: 'pending' }));
  };

  const deleteEvent = async (id: string, at?: ScopeAt) => {
    const s = seriesOf(id);
    if (s) {
      const scope = await askRepeatScope(s.occ, t('Delete a repeating event'), at);
      if (!scope) return;
      setSelectedEventId(null);
      applySeries(removeFromSeries(s.series, s.occurrence, scope), scope === 'one' ? t('Event deleted') : scope === 'following' ? t('This and following events deleted') : t('All events deleted'));
      return;
    }
    const snapshot = events;
    setEvents((es) => es.filter((e) => e.id !== id));
    setSelectedEventId(null);
    showToast({ text: t('Event deleted'), action: { label: t('Undo'), run: () => setEvents(snapshot) } });
  };

  const conflictsWith = (start: string, end: string) =>
    eventsOn(expandEvents(myEvents, Date.parse(start) - 86_400_000, Date.parse(end) + 86_400_000), new Date(start)).filter((e) => !e.allDay && e.start < end && e.end > start);

  const addInvite = (threadId: string) => {
    const th = threads.find((x) => x.id === threadId);
    if (!th?.invite) return;
    const from = th.messages[0].from;
    const ev: CalEvent = {
      id: uid(),
      title: th.invite.title,
      calendarId: 'clients',
      start: th.invite.start,
      end: th.invite.end,
      location: th.invite.location,
      guests: isMine(from.email) ? [] : [from],
      workspaceId: ws.id,
      userId: user.id,
      threadId,
    };
    setEvents((es) => [...es, ev]);
    showToast({
      text: t('Added to calendar'),
      action: {
        label: t('View'),
        run: () => {
          go('calendar');
          setCalCursor(new Date(ev.start));
          setSelectedEventId(ev.id);
        },
      },
    });
  };

  /* ---------------- Calendar invites in mail ---------------- */

  /** What's known around an invite: the answer given (in any of its emails), your calendar, later versions. */
  const inviteState = (t: Thread, m: Message): InviteState => {
    const inv = m.invite!;
    const related = threads.filter((x) => x.accountId === t.accountId).flatMap((x) => x.messages.filter((y) => y.invite?.uid === inv.uid).map((y) => ({ t: x, m: y, inv: y.invite! })));
    const sameDate = (x: { recurrenceId?: string }) => !x.recurrenceId || x.recurrenceId === inv.recurrenceId;
    const cancelled = related.some((r) => (r.inv.method === 'CANCEL' || !!r.inv.cancelled) && r.inv.sequence >= inv.sequence && sameDate(r.inv));
    const newer = related.find((r) => (r.inv.method === 'REQUEST' || r.inv.method === 'PUBLISH') && r.inv.sequence > inv.sequence && (r.inv.recurrenceId ?? '') === (inv.recurrenceId ?? ''));
    const last = related.map((r) => r.inv.answer).filter((a) => !!a).sort((a, b) => b!.at.localeCompare(a!.at))[0];
    // A shared inbox answers as the mailbox: say who did.
    const answer = last && { status: last.status, sent: last.sent, who: last.by === user.id ? undefined : firstOf(last.by) };
    const mine = events.some((e) => e.inviteUid === inv.uid && (e.userId ?? 'u-raka') === user.id);
    return { answer, onCalendar: mine, cancelled, newer: newer && newer.t.id !== t.id ? () => openThread(newer.t.id) : undefined };
  };
  /** Opens the calendar on this invite's next date. */
  const showInvite = (uid: string, start: string) => {
    const now = Date.now();
    const mine = events.filter((e) => e.inviteUid === uid && (e.userId ?? 'u-raka') === user.id);
    // A repeating one: its next date.
    const dates = expandEvents(mine, now - 86_400_000, now + 400 * 86_400_000).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const ev = dates.find((e) => new Date(e.end).getTime() >= now) ?? findEvent(mine, mine[0]?.id);
    go('calendar');
    setCalCursor(new Date(ev?.start ?? start));
    if (ev) setSelectedEventId(ev.id);
  };
  /**
   * Yes, Maybe or No: the organiser hears it from this mailbox, and the event goes on (or off) your calendar. A
   * repeating invite becomes one repeating event; answering one date of it (`only`) answers that date, or that date
   * and the following ones, and the rest keep their answer (or wait for one).
   */
  const answerInvite = async (th: Thread, m: Message, status: RsvpStatus, only?: { scope: Scope; occurrence: string }): Promise<boolean> => {
    const inv = m.invite!;
    const org = inv.organizer?.name.split(' ')[0];
    const tell = (sent: boolean, extra = '') =>
      showToast({
        text: `${[status === 'accepted' ? (inv.method === 'PUBLISH' ? t('Added to your calendar') : t('You’re going')) : status === 'tentative' ? t('You said maybe') : t('You said no'), sent && org ? t('{name} knows', { name: org }) : ''].filter(Boolean).join('. ')}.${extra ? ` ${extra}` : ''}`,
        ms: extra ? 8000 : 5000,
        action: status !== 'declined' ? { label: t('View'), run: () => showInvite(inv.uid, inv.start) } : undefined,
      });
    if (real) {
      try {
        const r = await fetch('/api/mail/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: th.id, messageId: m.id, answer: status, ...(only && only.scope !== 'all' ? only : {}) }) });
        const d = (await r.json().catch(() => ({}))) as { error?: string; sent?: boolean; firstOnly?: boolean };
        if (!r.ok) {
          showToast({ text: d.error ?? t('Your answer couldn’t be saved. Try again.'), ms: 7000, action: r.status === 409 && wsAdmin ? { label: t('Set it up'), run: () => (setSettingsSection('email'), go('settings')) } : undefined });
          return false;
        }
        tell(!!d.sent, d.firstOnly ? t('Only the first date is on your calendar: this kind of repeat can’t be read yet.') : '');
        return true;
      } catch {
        showToast({ text: t('No connection: your answer wasn’t sent.') });
        return false;
      }
    }
    // The demo (no server, or the demo company): answered here, and nothing is sent.
    const at = nowIso();
    const mineNow = (e: CalEvent) => e.inviteUid === inv.uid && (e.userId ?? 'u-raka') === user.id;
    const made = (rsvp?: RsvpStatus): CalEvent => ({ id: uid(), title: inv.title, calendarId: 'work', ...inviteCalendarTimes(inv, inv.allDay), allDay: inv.allDay, location: inv.location, meetUrl: inv.url, guests: [...(inv.organizer ? [inv.organizer] : []), ...inv.attendees].filter((g, i, all) => !isMine(g.email) && all.findIndex((x) => x.email === g.email) === i).map((g) => ({ name: g.name, email: g.email })), threadId: th.id, workspaceId: ws.id, userId: user.id, inviteUid: inv.uid, sequence: inv.sequence, ...(rsvp ? { rsvp } : {}), organizer: inv.organizer, ...inviteSeries(inv) });
    if (only && only.scope !== 'all' && inv.rrule) {
      // Some dates of a repeating invite: the series is on the calendar, with this answer for those dates.
      const cur = events.find((e) => mineNow(e) && e.rrule) ?? made();
      const next = answerSeries(cur, only.occurrence, status, only.scope);
      setEvents((es) => [...es.filter((e) => !mineNow(e)), next]);
      tell(false, t('Demo: no answer is sent.'));
      return true;
    }
    setThreads((ts) => ts.map((x) => (x.id !== th.id ? x : { ...x, messages: x.messages.map((y) => (y.id === m.id ? { ...y, invite: { ...inv, answer: { status, at, by: user.id, sent: false } } } : y)) })));
    setEvents((es) => [...es.filter((e) => !mineNow(e)), ...(status === 'declined' ? [] : [made(status)])]);
    tell(false, t('Demo: no answer is sent.'));
    return true;
  };
  const inviteCard = (t: Thread, m: Message) => {
    const inv = m.invite!;
    const acct = accountOf(t.accountId);
    return (
      <InviteCard
        key={m.id}
        invite={inv}
        state={inviteState(t, m)}
        conflicts={conflictsWith(inv.start, inv.end).filter((e) => e.inviteUid !== inv.uid)}
        answerOff={acct && !boxReady(acct.id).send ? replyWhy(acct) : undefined}
        onAnswerOff={() => acct && replyBlocked(acct)}
        onAnswer={(st) => answerInvite(t, m, st)}
        onOpenCalendar={() => showInvite(inv.uid, inv.start)}
      />
    );
  };


  /**
   * Invites waiting for an answer in my mail, shown on the calendar (dashed) so they can be answered there too. Once
   * answered they become ordinary events (the server makes them), so they're never shown twice.
   */
  const pendingInvites = useMemo(() => {
    const now = Date.now();
    const out: CalEvent[] = [];
    const seen = new Set<string>();
    for (const t of wsThreads) {
      if (t.location === 'trash' || t.location === 'spam') continue;
      for (const m of t.messages) {
        const inv = m.invite;
        // (A repeating one may have dates to come although its first is over: the calendar draws those.)
        if (!inv || inv.method !== 'REQUEST' || inv.cancelled || (Date.parse(inv.end) < now && !inv.rrule)) continue;
        const key = `${inv.uid}|${inv.recurrenceId ?? ''}`;
        if (seen.has(key)) continue;
        const st = inviteState(t, m);
        if (st.answer || st.onCalendar || st.cancelled || st.newer) continue;
        seen.add(key);
        out.push({
          id: `inv:${t.id}:${m.id}`,
          title: inv.title,
          calendarId: 'work',
          // All-day invites come as noon UTC on the first and last day: here they cover those days, wherever you are.
          ...inviteCalendarTimes(inv, inv.allDay),
          ...inviteSeries(inv),
          allDay: inv.allDay,
          location: inv.location,
          meetUrl: inv.url,
          notes: inv.description,
          guests: [...(inv.organizer ? [inv.organizer] : []), ...inv.attendees].filter((g, i, all) => !isMine(g.email) && all.findIndex((x) => x.email === g.email) === i).map((g) => ({ name: g.name, email: g.email })),
          threadId: t.id,
          inviteUid: inv.uid,
          organizer: inv.organizer,
          workspaceId: ws.id,
          userId: user.id,
        });
      }
    }
    return out;
  }, [wsThreads, events]); // eslint-disable-line react-hooks/exhaustive-deps
  const calEvents = useMemo(() => (pendingInvites.length ? [...visibleEvents, ...pendingInvites] : visibleEvents), [visibleEvents, pendingInvites]);
  // One date of a repeating event is found by its id too (the id says which date).
  const selectedEvent = findEvent(events, selectedEventId) ?? findEvent(calEvents, selectedEventId);
  // The event being edited (one date of a repeating one: that date, with the series' repeat).
  const editingEvent = findEvent(events, editEventId);
  /** Calendars a new event can go in (not read-only ones like links and holidays). */
  const addToCals = useMemo(() => [...CALENDARS, ...myExtCals.filter((c) => !c.readOnly)], [myExtCals]);
  /** People to invite besides teammates: the projects' guests and anyone already a guest of my events. */
  const guestContacts = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const c of wsClients) for (const p of c.people ?? []) seen.set(p.email.toLowerCase(), { name: p.name, email: p.email });
    for (const e of myEvents) for (const g of e.guests ?? []) if (!seen.has(g.email.toLowerCase())) seen.set(g.email.toLowerCase(), g);
    return [...seen.values()].filter((p) => !members.some((u) => u.email.toLowerCase() === p.email.toLowerCase()));
  }, [wsClients, myEvents, members]);
  /** Schedule: my open tasks with a due date (and the ones done today), each on its day with its checkbox. */
  const myDueTasks = useMemo(
    () => wsTasks.filter((t) => t.due && !isBrief(t) && doersOf(t).includes(user.id) && (!t.done || (!!t.doneAt && localDay(new Date(t.doneAt)) === localDay()))).map((t) => ({ id: t.id, title: t.title, due: t.due!, done: t.done })),
    [wsTasks, user.id],
  );
  /** The invite email behind an event (the newest one), to answer it from the calendar. */
  const inviteOf = (e: CalEvent) => {
    const id = e.seriesId ?? e.id; // a date of a repeating one: its series
    if (id.startsWith('inv:')) {
      const [, tid, mid] = id.split(':');
      const t = threads.find((x) => x.id === tid);
      const m = t?.messages.find((x) => x.id === mid);
      return t && m ? { t, m } : null;
    }
    if (!e.inviteUid) return null;
    const t = threads.find((x) => x.id === e.threadId) ?? wsThreads.find((x) => x.messages.some((m) => m.invite?.uid === e.inviteUid));
    const m = t && [...t.messages].reverse().find((x) => x.invite?.uid === e.inviteUid && x.invite?.method !== 'REPLY');
    return t && m ? { t, m } : null;
  };
  const rsvpEvent = async (e: CalEvent, status: RsvpStatus, at?: ScopeAt) => {
    const found = inviteOf(e);
    if (!found) return showToast({ text: t('The invite email for this event isn’t here any more, so the answer can’t be sent from sprint2go.') });
    // One date of a repeating invite: for that date, from it on, or all of them.
    let only: { scope: Scope; occurrence: string } | undefined;
    if (e.seriesId && e.occurrence && found.m.invite?.rrule) {
      const scope = await askRepeatScope(e, t('Answer “{answer}” for', { answer: status === 'accepted' ? t('Yes') : status === 'tentative' ? t('Maybe') : t('No') }), at);
      if (!scope) return;
      only = { scope, occurrence: e.occurrence };
    }
    if (e.id.startsWith('inv:') || status === 'declined') setSelectedEventId(null);
    void answerInvite(found.t, found.m, status, only);
  };
  /** What the guests answered: by email to an invite I sent (on the event), or as the invite I got says it. */
  const answersOf = (e: CalEvent) => {
    if (e.answers) return e.answers;
    const inv = inviteOf(e)?.m.invite;
    return inv ? Object.fromEntries(inv.attendees.map((a) => [a.email.toLowerCase(), a.status])) : undefined;
  };


  /** Removing a mailbox: its mail moves to another mailbox or goes with it, and its address stops receiving. */
  const removeMailbox = async (a: Account, moveTo: string | null): Promise<boolean> => {
    const target = moveTo ? ws.accounts.find((x) => x.id === moveTo) : undefined;
    if (real) {
      const r = await fetch('/api/mail/mailbox/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, accountId: a.id, moveTo }) }).catch(() => null);
      if (!r?.ok) {
        showToast({ text: ((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? t('No connection: the mailbox wasn’t removed.') });
        return false;
      }
    } else {
      setThreads((ts) => (target ? ts.map((t) => (t.accountId === a.id ? { ...t, accountId: target.id } : t)) : ts.filter((t) => t.accountId !== a.id)));
      patchWorkspace(ws.id, { accounts: ws.accounts.filter((x) => x.id !== a.id), mailAliases: (ws.mailAliases ?? []).map((al) => ({ ...al, to: al.to.filter((id) => id !== a.id) })).filter((al) => al.to.length) });
    }
    if (activeAccount === a.id) setActiveAccount('all');
    setRemoveAcct(null);
    showToast({ text: target ? t('{email} removed. Its mail is in {target} now', { email: a.email, target: target.email }) : t('{email} and its mail removed', { email: a.email }) });
    return true;
  };

  /**
   * Opens an email inside Mail (a notification, a calendar event, search): its list underneath, so Back goes to that
   * list. Tapped before the mail has loaded (a notification opening the app), it opens as soon as the email arrives.
   */
  const [pendingThread, setPendingThread] = useState<{ id: string; at: number } | null>(null);
  const openThread = (threadId: string) => {
    const t = threads.find((x) => x.id === threadId);
    if (!t) return void setPendingThread({ id: threadId, at: Date.now() });
    setPreview(null);
    go('mail');
    if (activeAccount !== 'all' && activeAccount !== t.accountId) setActiveAccount('all');
    const snoozedNow = !!t.snoozedUntil && t.snoozedUntil > new Date().toISOString();
    setView({ kind: 'folder', id: snoozedNow ? 'snoozed' : t.location });
    setFilter('all');
    setQuery('');
    setSelectedId(threadId);
    setReaderOpen(true);
    update(threadId, { unread: false });
    setNotices((ns) => (ns.some((n) => !n.read && n.userId === user.id && n.link?.app === 'mail' && n.link.id === threadId) ? ns.map((n) => (!n.read && n.userId === user.id && n.link?.app === 'mail' && n.link.id === threadId ? { ...n, read: true } : n)) : ns));
  };
  useEffect(() => {
    if (!pendingThread) return;
    if (threads.some((t) => t.id === pendingThread.id)) {
      setPendingThread(null);
      openThread(pendingThread.id);
    } else if (Date.now() - pendingThread.at > 15_000) setPendingThread(null); // not one this person can open
  }, [threads, pendingThread]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Drive ---------------- */

  // Attachments from email show up in Drive automatically.
  const attachments = useMemo<DriveItem[]>(
    () =>
      wsThreads
        .filter((t) => t.location !== 'trash' && t.location !== 'spam')
        .flatMap((t) =>
          t.messages.flatMap((m) =>
            (m.attachments ?? []).filter((a) => !a.inline && !a.blocked).map((a) => ({
              id: `att:${t.id}:${m.id}:${a.name}`,
              name: a.name,
              url: a.url,
              kind: kindOf({ name: a.name }),
              parentId: null,
              size: parseSize(a.size),
              modified: m.date,
              threadId: t.id,
            })),
          ),
        ),
    [wsThreads],
  );
  const wsDrive = useMemo(() => drive.filter((i) => (i.workspaceId ?? 'pnp') === ws.id), [drive, ws.id]);
  const allDrive = useMemo(() => [...wsDrive, ...attachments], [wsDrive, attachments]);

  // What mail really takes on the server (server/mailStorage.ts); the demo keeps its made-up figure.
  const [mailBytes, setMailBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!real) return void setMailBytes(null);
    let on = true;
    void fetch(`/api/storage?workspaceId=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mail?: number } | null) => on && typeof d?.mail === 'number' && setMailBytes(d.mail), () => {});
    return () => void (on = false);
  }, [ws.id, real, mode === 'settings']); // eslint-disable-line react-hooks/exhaustive-deps
  const usage = useMemo(() => {
    const own = wsDrive.filter((i) => i.kind !== 'folder');
    return {
      mail: mailBytes ?? MAIL_USAGE,
      drive: own.reduce((s, i) => s + i.size, 0),
      media: own.filter((i) => i.kind === 'image' || i.kind === 'video').reduce((s, i) => s + i.size, 0),
      quota: QUOTA,
    };
  }, [wsDrive, mailBytes]);

  const patchDrive = (id: string, patch: Partial<DriveItem>) => setDrive((d) => d.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const upload = async (files: FileList) => {
    const parentId = driveSection === 'my' ? driveFolder : null;
    // Each file goes to the server first (a data URL in the demo), so it's still there tomorrow and on other devices.
    const added: DriveItem[] = [];
    for (const f of Array.from(files)) {
      const kind = kindOf(f);
      try {
        const up = await uploadFile(f, ws.id);
        added.push({ id: uid(), name: f.name, kind, parentId, size: f.size, modified: new Date().toISOString(), url: up.url, thumb: kind === 'image' || kind === 'video' ? up.url : undefined, workspaceId: ws.id, uploadedBy: user.id });
      } catch (e) {
        if (!wasSkipped(e)) showToast({ text: `${f.name}: ${(e as Error).message}` });
      }
    }
    if (!added.length) return;
    setDrive((d) => [...d, ...added]);
    if (!['my', 'recent', 'media'].includes(driveSection)) setDriveSection('my');
    showToast({ text: tn(added.length, 'Uploaded {n} file', 'Uploaded {n} files') });
  };

  const newFolder = () => {
    const parentId = driveSection === 'my' ? driveFolder : null;
    const f: DriveItem = { id: uid(), name: t('Untitled folder'), kind: 'folder', parentId, size: 0, modified: new Date().toISOString(), workspaceId: ws.id };
    setDrive((d) => [...d, f]);
    setDriveSection('my');
    setDriveFolder(parentId);
    setRenamingId(f.id);
    go('drive');
  };

  const trashDrive = (id: string) => {
    patchDrive(id, { trashed: true });
    showToast({ text: t('Moved to trash'), action: { label: t('Undo'), run: () => patchDrive(id, { trashed: false }) } });
  };

  const deleteForever = (id: string) => {
    const snapshot = drive;
    setDrive((d) => d.filter((i) => i.id !== id && i.parentId !== id));
    showToast({ text: t('Deleted forever'), action: { label: t('Undo'), run: () => setDrive(snapshot) } });
  };

  const savedToDrive = (name: string) => wsDrive.some((i) => i.name === name && i.threadId === selectedId && !i.trashed);
  // Save to Drive copies the real file (server/mailFiles.ts); the reader's own buttons pick a folder.
  const saveToDrive = (threadId: string, a: Attachment) => {
    const msg = threads.find((t) => t.id === threadId)?.messages.find((m) => m.attachments?.some((x) => x.name === a.name));
    void saveAttachments({ threadId, messageId: msg?.id, atts: [a], folderId: null, date: msg?.date, wsId: ws.id }).then(
      () =>
        showToast({
          text: t('Saved to My Drive'),
          action: {
            label: t('View'),
            run: () => {
              setDriveSection('my');
              setDriveFolder(null);
              go('drive');
            },
          },
        }),
      (e: Error) => showToast({ text: e.message, ms: 7000 }),
    );
  };

  /* ---------------- Keyboard ---------------- */

  const gPressed = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleAsk();
        return;
      }
      // ⌥1–9 switches workspace (works everywhere)
      if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        const target = workspaces[Number(e.code.slice(5)) - 1];
        if (target) {
          e.preventDefault();
          switchWorkspace(target.id);
        }
        return;
      }
      if (el.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') (el as HTMLInputElement).blur?.();
        return;
      }
      if (compose || newEventAt || preview || dump !== null || paletteOpen || newWs) return;

      // "g" then m / c / d jumps between sections
      if (e.key === 'g') {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1000) {
        const target = ({ h: 'home', m: 'mail', c: 'chat', t: 'tasks', l: 'calendar', d: 'drive', e: 'meet' } as Record<string, Mode>)[e.key];
        gPressed.current = 0;
        if (target) {
          e.preventDefault();
          go(target);
          return;
        }
      }
      if (e.key === '[') {
        setCollapsed((c) => !c);
        return;
      }
      if (mode === 'calendar') {
        if (e.key === 'c') {
          e.preventDefault();
          openNewEvent();
        }
        return;
      }
      if (mode !== 'mail') return;

      const idx = visible.findIndex((t) => t.id === selectedRow);
      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          const n = visible[Math.min(idx + 1, visible.length - 1)];
          if (n) open(n.id);
          break;
        }
        case 'k':
        case 'ArrowUp': {
          const n = visible[Math.max(idx - 1, 0)];
          if (n) open(n.id);
          break;
        }
        case 'e':
          if (selectedId) archive(selectedId);
          break;
        case '#':
          if (selectedId) trash(selectedId);
          break;
        case 's':
          if (selectedId) star(selectedId);
          break;
        case 'u':
          if (selectedId) markUnread(selectedId);
          break;
        case 'l':
          if (selectedId) organize.openPicker([selectedId]);
          break;
        case 'c':
          openCompose();
          break;
        case '/':
          searchRef.current?.focus();
          break;
        case 'Escape':
          setSelectedId(null);
          setReaderOpen(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------- Render ---------------- */

  const title = mode === 'mail' && parsedQuery ? t('Search results') : view.kind === 'category' ? categoryName(view.id) : view.kind === 'contacts' ? t('Contacts') : view.kind === 'folder' ? folderName(view.id) : view.kind === 'tracking' ? t('Waiting for reply') : view.kind === 'files' ? t('Files') : view.kind === 'todos' ? t('To-do') : view.kind === 'project' ? (wsClientsAll.find((c) => c.id === view.id)?.name ?? term.one) : organize.labelTitle(view.id);
  const appMode = mode === 'settings' ? lastMode : mode;

  /** Each app's gear: Settings at that app's section (only sections this person can use). */
  const appSettings = (app: Mode, place: 'sidebar' | 'phone') => (
    <AppSettingsButton
      app={APPS.find((a) => a.id === app)?.name ?? 'App'}
      links={appSettingsLinks(app, { admin: isAdmin, perms })}
      onOpen={(id) => (setSettingsSection(id), setSidebarOpen(false), go('settings'))}
      className={place === 'sidebar' ? 'sb-settings' : 'mt-settings'}
      big={place === 'phone'}
    />
  );

  /** Calendar's side panel: calendars on and off, teammates, holidays, connect, tasks to plan (a sheet on phones). */
  const calendarPanel = (
    <CalendarSidebar
      cursor={calCursor}
      calendars={CALENDARS}
      external={myExtCals}
      teammates={members.filter((u) => u.id !== user.id)}
      shownMates={shownMates}
      onToggleMate={(id) =>
        setShownMates((m) => {
          const n = new Set(m);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        })
      }
      onAddCalendar={() => (calendarsOn ? setConnectCal(true) : explainOff('Connecting Google, Outlook and iCloud calendars comes soon. Events made here already sync to everyone.'))}
      toPlan={wsTasks
        .filter((t) => !t.done && !isBrief(t) && doersOf(t).includes(user.id) && !events.some((e) => e.taskId === t.id && new Date(e.end).getTime() > Date.now()))
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
        .map((t) => ({ id: t.id, title: t.title, sub: [wsClients.find((c) => c.id === t.clientId)?.name, t.due ? dueLabel(t.due).text : ''].filter(Boolean).join(' · '), late: !!t.due && t.due < localDay() }))}
      onPlan={(id) => {
        const t = todos.find((x) => x.id === id);
        if (t) todoToCalendar(t);
      }}
      onShare={(id, share) => setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, share } : c)))}
      onSync={async (id) => {
        const cal = extCals.find((c) => c.id === id);
        // Links and holidays are read by the server: ask it to read them again now.
        if (real && (cal?.source === 'ics' || cal?.source === 'holidays')) {
          const r = (await fetch(`/api/calendars/${id}/refresh`, { method: 'POST' })
            .then((x) => x.json())
            .catch(() => ({ ok: false, error: t('Couldn’t reach the server. Try again in a moment.') }))) as { ok?: boolean; error?: string };
          showToast({ text: r.ok ? t('{name} is up to date', { name: cal.name }) : t('{name} didn’t update. {why}', { name: cal.name, why: r.error ? t(r.error) : t('Try again later.') }), ms: r.ok ? undefined : 8000 });
          return;
        }
        setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, syncedAt: nowIso() } : c)));
        showToast({ text: t('Synced') });
      }}
      onRemove={(id) => {
        // Another country's holidays: off this person's list (Undo puts it back).
        if (isPersonalHoliday(id)) {
          const before = holidays.regions;
          setHolidayRegions(before.filter((c) => personalHolidayId(c) !== id));
          return showToast({ text: t('{name} removed from your calendar', { name: myExtCals.find((c) => c.id === id)?.name ?? t('Holidays') }), action: { label: t('Undo'), run: () => setHolidayRegions(before) } });
        }
        const cal = extCals.find((c) => c.id === id);
        if (!cal) return;
        const snapshot = { extCals, events };
        setExtCals((cs) => cs.filter((c) => c.id !== id));
        setEvents((es) => es.filter((e) => e.calendarId !== id));
        // A link is put back and read again by the server (its events come back with it).
        const relink = real && cal.source === 'ics';
        showToast({ text: t('{name} removed', { name: cal.name }), action: { label: t('Undo'), run: () => (relink ? setExtCals((cs) => [...cs, cal]) : (setExtCals(snapshot.extCals), setEvents(snapshot.events))) } });
      }}
      companyName={ws.name}
      isAdmin={isAdmin}
      onHolidays={() => setConnectCal('holidays')}
      holidayRegions={holidays.regions}
      companyHolidayCountry={ws.holidays?.country}
      onHolidayRegions={setHolidayRegions}
      onHolidaysOff={() => {
        const before = ws.holidays;
        patchWorkspace(ws.id, { holidays: undefined });
        if (!real) demoHolidays(null);
        showToast({ text: t('Public holidays removed for everyone'), action: { label: t('Undo'), run: () => (patchWorkspace(ws.id, { holidays: before }), !real && demoHolidays(before?.country ?? null)) } });
      }}
      hidden={hiddenCals}
      busyDays={busyDays}
      onCursor={(d) => {
        setCalCursor(d);
        setSidebarOpen(false);
        if (mode !== 'calendar') go('calendar');
      }}
      onToggle={(id) =>
        setHiddenCals((h) => {
          const n = new Set(h);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        })
      }
      onNew={() => openNewEvent()}
    />
  );

  // Unread in the inbox per label and per project: the drawer's counts.
  const tagUnread = useMemo(() => {
    const r: Record<string, number> = {};
    for (const th of scoped)
      if (th.location === 'inbox' && th.unread) {
        for (const l of th.labels) r[`label:${l}`] = (r[`label:${l}`] ?? 0) + 1;
        const pr = projectOfThread(th);
        if (pr) r[`project:${pr}`] = (r[`project:${pr}`] ?? 0) + 1;
      }
    return r;
  }, [scoped, clients]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mail on phones: the folders open as Gmail's drawer from the left; your picture in the search pill opens this.
  // Phones: the folders, labels and projects are the title switcher ("Inbox"), the launcher button is where ☰ was.
  useTitleMenu('mail', mobile && mode === 'mail' && (view.kind === 'folder' || view.kind === 'label' || view.kind === 'category' || view.kind === 'project' || view.kind === 'todos') && {
    label: t('Mailbox and folder'),
    value: mailId(view) ?? 'inbox',
    options: [
      ...(['inbox', 'starred', 'snoozed', 'sent', 'scheduled', 'drafts', 'assigned', 'archive', 'spam', 'trash'] as FolderId[]).map((id) => ({ value: id, label: folderName(id), group: t('Mail'), hint: (counts as Record<string, number>)[id] ? fmtNumber((counts as Record<string, number>)[id]) : undefined })),
      { value: 'todos', label: t('To-do'), group: t('Mail') },
      ...organize.chipLabels.map((l) => ({ value: `label/${l.id}`, label: l.name, group: t('Labels') })),
      ...wsClients.filter((c) => c.domain).map((c) => ({ value: `project/${c.id}`, label: c.name, group: term.Many })),
    ],
    onChange: (v: string) => selectView(v.startsWith('label/') ? { kind: 'label', id: v.slice(6) } : v.startsWith('project/') ? { kind: 'project', id: v.slice(8) } : v === 'todos' ? { kind: 'todos', id: 'todos' } : { kind: 'folder', id: v as FolderId }),
  });
  const [mailAccounts, setMailAccounts] = useState(false);
  /** Mail settings on phones: Mail & signature over the app, scrolled to the part that was tapped. */
  const pushMailSection = (heading?: string) => {
    setSettingsSection('mail');
    setPushed({ kind: 'section', id: 'mail', label: heading ?? t('Signature') });
    if (heading)
      setTimeout(() => {
        const h = [...document.querySelectorAll('.settings-push:not(.is-leaving) h3')].find((e) => e.textContent === heading);
        h?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }, 380);
  };
  const [mailSettingsOpen, setMailSettingsOpen] = useState(false);

  /** The phone's title switcher for each app (Mail registers its own above). */
  const mobileSwitcher = (() => {
    // Tasks registers its own switcher (TasksView, useTitleMenu).
    // Meet has its own drawer on phones (MeetView, Google Meet's).
    // Projects: the open project's name, and a quick way to another one (the sidebar isn't there on phones).
    if (mode === 'projects')
      return {
        label: term.Many,
        value: projScope.kind === 'client' ? projScope.id : projScope.kind === 'past' ? 'past' : 'all',
        options: [
          { value: 'all', label: t('All {projects}', { projects: term.many }), group: term.Many },
          ...wsClients.map((c) => ({ value: c.id, label: c.name, group: term.Many })),
          { value: 'past', label: t('Past {projects}', { projects: term.many }), group: t('More') },
        ],
        onChange: (v: string) => setProjScope(v === 'all' ? { kind: 'projects' } : v === 'past' ? { kind: 'past' } : { kind: 'client', id: v }),
      };
    if (mode === 'drive')
      return {
        label: t('Drive'),
        value: driveSection,
        options: DRIVE_SECTIONS.map((s) => ({ value: s.id, label: t(s.name) })),
        onChange: (v: string) => (setDriveSection(v as DriveSection), setDriveFolder(null)),
      };
    return undefined;
  })();

  /* ---------------- The phone shell (src/mobile/, docs/mobile-kit.md) ---------------- */

  // Where the huddle's slim bar sits on phones outside its channel: its own row under the top bar (chat/huddleDock.ts).
  const huddleDock = useDockRef();

  const chrome = useChrome(mode);
  const tucked = useTitleTucked(mode);
  const kb = useKeyboard();
  const [statusOpen, setStatusOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false); // Home's create button: New, with Brain dump first
  // The launcher's apps: your own order, else your team's or the company's (src/mobile/launcherApps.ts).
  const companyOrder = companyAppOrder(ws, myTeamIds);
  const appsOrder = normalizeApps(ownApps ?? companyOrder);
  const myApps = launcherApps(ownApps, companyOrder, (id) => enabled.has(id));
  // Tablets pin the first four of the same order in the rail.
  const tabApps: AppId[] = myApps.shown.filter((id): id is AppId => id !== 'settings').slice(0, 4);
  const setTabApps = (bar: string[]) => setOwnApps({ order: [...bar, ...appsOrder.order.filter((id) => !bar.includes(id))], hidden: appsOrder.hidden.filter((id) => !bar.includes(id)) });
  // Focused screens that live in this file: an open mail on a phone, and a project's page (its Back goes in the top bar).
  // Not while the guest view takes over the screen ("View as guest", a shared space): its own bar shows then.
  const guestView = !!viewAs || portalKey === '*' || myPortals.some((pt) => pt.key === portalKey);
  useFocusedScreen(mobile && mode === 'mail' && readerOpen && !guestView);
  useFocusedScreen(mobile && mode === 'projects' && projScope.kind === 'client' && !guestView, () => setProjScope({ kind: 'projects' }));
  // The bar steps aside on focused screens and while the keyboard is up.
  const barAway = chrome.focused || kb.open;
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('bar-away') !== barAway) root.classList.toggle('bar-away', barAway);
  }, [barAway]);
  useEffect(() => () => document.documentElement.classList.remove('bar-away'), []);
  // Chat's badge: what's written to you (direct messages) and mentions of you, not every channel's chatter.
  const chatForMe = useMemo(() => {
    const fallback = new Date(Date.now() - 90 * 60_000).toISOString();
    const name = myFirst.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    const at = new RegExp(`@${name}\\b`, 'i');
    let n = 0;
    for (const c of wsChannels) {
      if (c.kind === 'dm') n += chatUnread[c.id] ?? 0;
      // Mentions count even in a muted channel (muting stops the rest).
      else n += messages.filter((m) => m.channelId === c.id && m.userId !== user.id && !m.sendAt && m.at > (lastRead[c.id] ?? fallback) && at.test(m.text)).length;
    }
    return n;
  }, [chatUnread, wsChannels, messages, lastRead, myFirst, user.id]);
  // Home's badge: what's in its "Needs you" list (src/needsYou.ts, the same rules Home and the AI connector use).
  const needsNow = useMemo(
    () =>
        needsYou({
          me: user.id,
          today: localDay(),
          now: Date.now(),
          tasks: wsTasks,
          stageKind: (t) => stageKind(t as Todo),
          teams: wsTeams,
          clients: wsClients,
          isOwner: ws.members.some((m) => m.userId === user.id && m.role === 'owner'),
          firstName: (id) => firstOf(id),
          threads: scoped,
          mine: isMine,
          notices: myNotices,
        }),
    [wsTasks, wsTeams, wsClients, scoped, myNotices, user.id, ws.members], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Home's tab has no number (its list is on screen when you open it): a dot when something in Needs you is new since
  // you last looked at Home.
  const [needsSeen, setNeedsSeen] = usePersisted<string[]>(`s2g-needs-seen:${user.id}:${ws.id}`, []);
  const needKeys = needsNow.filter((x) => x.group !== 'today').map((x) => x.key);
  useEffect(() => {
    if (mode === 'home' && needKeys.some((k) => !needsSeen.includes(k))) setNeedsSeen(needKeys.slice(0, 200));
  }, [mode, needKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Search: inside the app on screen when it has things to search, with "All apps" one tap away.
  const [searchScope, setSearchScope] = useState<AppId | null>(null);
  const openSearch = (scope: AppId | null) => (setSearchScope(scope), setPaletteOpen(true));
  const searchHere = () => openSearch(mode !== 'settings' && SEARCHABLE.includes(mode) ? mode : null);
  usePullToSearch(searchHere, mobile && !paletteOpen);
  // An app's settings, opened over the app (Back returns to it) instead of jumping to the Settings page.
  const [pushed, setPushed] = useState<{ kind: 'own' | 'section'; id: string; label: string } | null>(null);
  useEffect(() => setPushed(null), [mode, ws.id]);
  const settingsRows =
    mode === 'settings'
      ? []
      : [
          // Mail's own settings screen (it was at the bottom of the folders drawer).
          ...(mode === 'mail' ? [{ id: 'mail-settings', label: t('Mail settings'), hint: t('Signature, undo send, out of office'), run: () => setMailSettingsOpen(true) }] : []),
          ...chrome.settings.map((e) => ({ id: `own:${e.id}`, label: e.label, hint: e.hint, run: () => setPushed({ kind: 'own', id: e.id, label: e.label }) })),
          ...appSettingsLinks(mode, { admin: isAdmin, perms }).map((l) => ({ id: l.id, label: l.name, hint: l.hint, run: () => (setSettingsSection(l.id), setPushed({ kind: 'section', id: l.id, label: l.name })) })),
        ];
  const ownSettings = pushed?.kind === 'own' ? chrome.settings.find((e) => e.id === pushed.id) : undefined;
  // More: New things from anywhere.
  const [newMessage, setNewMessage] = useState(false);
  const [taskAdd, setTaskAdd] = useState(0); // bumps to open Tasks' new task field
  const makeLinks = [
    ...(enabled.has('mail') && mailOut ? [{ id: 'email', label: t('Email'), icon: PenLine, run: () => openCompose() }] : []),
    ...(enabled.has('chat') ? [{ id: 'message', label: t('Message'), icon: MessagesSquare, run: () => setNewMessage(true) }] : []),
    ...(enabled.has('tasks') ? [{ id: 'task', label: t('Task'), icon: ListChecks, run: () => (openTasks({ kind: 'mine' }), setTaskAdd((n) => n + 1)) }] : []),
    ...(enabled.has('calendar') ? [{ id: 'event', label: t('Event'), icon: CalendarPlus, run: () => (go('calendar'), openNewEvent()) }] : []),
    ...(enabled.has('notes') ? [{ id: 'note', label: t('Note'), icon: FileText, run: () => setQuickNote({}) }] : []),
    ...(enabled.has('drive') ? [{ id: 'upload', label: t('Upload'), icon: Upload, run: () => (go('drive'), fileInput.current?.click()) }] : []),
  ];
  const meetLive = wsMeetings.some((m) => m.status === 'joining' || m.status === 'waiting_room' || m.status === 'recording');

  /* ---------------- The launcher and each app's own bar (research/launcher/plan.md) ---------------- */

  // What Needs you's one action per row does (the same as Home's, src/components/home/HomeParts.tsx).
  const nudgeTask = (id: string) => {
    const task = todos.find((x) => x.id === id);
    if (!task) return;
    doersOf(task).filter((x) => x !== user.id).forEach((x) => notify(x, 'task', task.due ? msg('{name} is checking on “{title}”, it was due {due}', { name: myFirst, title: task.title, due: phrase(dueWords(task.due)) }) : msg('{name} is checking on “{title}”', { name: myFirst, title: task.title }), { app: 'tasks', id }));
    logTask(id, 'comment', msg('sent a reminder'));
    showToast({ text: t('Reminded {names}', { names: fmtList(doersOf(task).map(firstOf)) }) });
  };
  const needActions = {
    me: user.id,
    users: members,
    teams: wsTeams,
    tasks: wsTasks,
    notices: myNotices,
    today: localDay(),
    onDone: toggleTodo,
    onStart: (id: string) => {
      const tk = todos.find((x) => x.id === id);
      if (tk) setTaskStatus(id, stageIdFor(tk, 'active'));
    },
    onAssign: (id: string, uid2: string) => patchTask(id, { userId: uid2 }),
    onNudge: nudgeTask,
    onReschedule: (id: string, day: string) => patchTask(id, { due: day || undefined }),
    onOpenTask: openTask,
    onOpenThread: openThread,
    onNotice: openNotice,
    onRead: (ids: string[]) => setNotices((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))),
  };

  // Counts only for what's yours to act on: unread mail, DMs and mentions, your tasks due today or late, table replies
  // and rows given to you. Calendar, Drive, Notes, Teams, Vault and Settings never show a number.
  const tasksDue = wsTasks.filter((tk) => !tk.done && tk.kind !== 'brief' && !!tk.due && tk.due <= localDay() && doersOf(tk).includes(user.id)).length;
  const tablesForMe = myNotices.filter((n) => !n.read && n.link?.app === 'tables').length;
  const badgeOf = (id: string) => (id === 'mail' ? (accountUnread.all ?? 0) : id === 'chat' ? chatForMe : id === 'tasks' ? tasksDue : id === 'tables' ? tablesForMe : 0);
  const dmUnread = wsChannels.filter((c) => c.kind === 'dm').reduce((n, c) => n + (chatUnread[c.id] ?? 0), 0);
  const chatActivity = myNotices.filter((n) => !n.read && n.link?.app === 'chat').length;
  const createFor = (id: string): LauncherApp['create'] => {
    const link = (k: string) => makeLinks.find((m) => m.id === k);
    const of = (k: string, label: string) => (link(k) ? { label, run: link(k)!.run } : undefined);
    if (id === 'mail') return of('email', t('New email'));
    if (id === 'chat') return of('message', t('New message'));
    if (id === 'tasks') return of('task', t('New task'));
    if (id === 'calendar') return of('event', t('New event'));
    if (id === 'notes') return of('note', t('New note'));
    if (id === 'drive') return of('upload', t('Upload'));
    if (id === 'projects' && canCreateProjects) return { label: t('New {project}', { project: term.one }), run: newProjectFlow };
    if (id === 'meet' && botOn) return { label: t('Take notes'), run: openSendBot };
    if (id === 'tables') return { label: t('New table'), run: () => (go('tables'), setNewTableFor({})) };
    if (id === 'teams' && canCreateTeams) return { label: t('New team'), run: () => (go('teams'), setNewTeam(true)) };
    return undefined;
  };
  const tileFor = (id: LauncherId): LauncherApp => {
    const base = plainTiles(() => true).find((x) => x.id === id)!;
    return { ...base, badge: badgeOf(id) || undefined, live: id === 'meet' && meetLive, create: createFor(id) };
  };
  const launcherTiles = myApps.shown.map(tileFor);
  const allTiles = [...myApps.shown, ...myApps.hidden].map(tileFor);

  // "Continue where you left off": the last few projects, notes, tables and channels opened, newest first.
  const [recentOpen, setRecentOpen] = usePersisted<{ kind: 'project' | 'note' | 'table' | 'channel'; id: string }[]>(`s2g-recent:${user.id}:${ws.id}`, []);
  const visit = (kind: 'project' | 'note' | 'table' | 'channel', id: string | null | undefined) => {
    if (!id) return;
    setRecentOpen((l) => (l[0]?.kind === kind && l[0].id === id ? l : [{ kind, id }, ...l.filter((x) => !(x.kind === kind && x.id === id))].slice(0, 8)));
  };
  const openProjectId = mode === 'projects' && projScope.kind === 'client' ? projScope.id : null;
  useEffect(() => visit('project', openProjectId), [openProjectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => visit('note', mode === 'notes' ? noteId : null), [mode, noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => visit('table', mode === 'tables' ? tableId : null), [mode, tableId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => visit('channel', mode === 'chat' ? chatId : null), [mode, chatId]); // eslint-disable-line react-hooks/exhaustive-deps
  const recents: Recent[] = recentOpen.flatMap((r): Recent[] => {
    if (r.kind === 'project') {
      const c = wsClients.find((x) => x.id === r.id);
      return c && enabled.has('projects') ? [{ key: 'p' + r.id, title: c.name, icon: Briefcase, app: 'projects', run: () => openClient(r.id) }] : [];
    }
    if (r.kind === 'note') {
      const n = wsNotesAll.find((x) => x.id === r.id && !x.deletedAt);
      return n && enabled.has('notes') ? [{ key: 'n' + r.id, title: n.title || t('Untitled'), icon: NotebookText, app: 'notes', run: () => openNote(r.id) }] : [];
    }
    if (r.kind === 'table') {
      const tb = wsTables.find((x) => x.id === r.id);
      return tb && enabled.has('tables') ? [{ key: 't' + r.id, title: tb.name, icon: Table2, app: 'tables', run: () => openTable(r.id) }] : [];
    }
    const c = wsChannels.find((x) => x.id === r.id);
    return c && enabled.has('chat') ? [{ key: 'c' + r.id, title: c.kind === 'dm' ? chanName(c, allUsers, user.id) : c.name, icon: c.kind === 'dm' ? MessageCircle : Hash, app: 'chat', run: () => openChannel(r.id) }] : [];
  });

  // The launcher button's dot: another app got something new since you left the launcher.
  const [leftWith, setLeftWith] = useState<Record<string, number> | null>(null);
  const launcherDot = !launcher && !!leftWith && myApps.shown.some((id) => id !== mode && badgeOf(id) > (leftWith[id] ?? 0));

  // Each app's sections on phones: what's selected now, and how to get to one (from its bar, the URL or Back).
  const [chatPart, setChatPart] = useState<'home' | 'dms' | 'activity'>('home');
  const [calMeetings, setCalMeetings] = useState(false);
  const [projMine, setProjMine] = useState(false);
  const [meetPart, setMeetPart] = useState<'meetings' | 'notes'>('meetings');
  const [teamsPart, setTeamsPart] = useState<'teams' | 'people'>('teams');
  const sectionNow = (app: Mode): string | undefined => {
    switch (app) {
      case 'mail':
        return view.kind === 'files' ? 'files' : view.kind === 'contacts' ? 'contacts' : 'inbox';
      case 'chat':
        return chatPart;
      case 'tasks':
        return taskBrowse || !['today', 'upcoming', 'mine'].includes(taskScope.kind) ? 'browse' : taskScope.kind;
      case 'calendar':
        return calMeetings ? 'meetings' : calView === 'month' ? 'month' : 'schedule';
      case 'notes':
        return notesFilter === 'shared' ? 'shared' : 'notes';
      case 'drive':
        return driveSection === 'recent' ? 'home' : driveSection === 'starred' ? 'starred' : driveSection === 'shared' ? 'shared' : driveSection === 'my' ? 'files' : undefined;
      case 'projects':
        return projScope.kind === 'past' ? 'past' : projMine ? 'mine' : 'active';
      case 'meet':
        return meetPage.kind === 'folders' || meetPage.kind === 'folder' || meetPage.kind === 'unfiled' || meetPage.kind === 'tasks' ? 'folders' : meetPage.kind === 'meeting' ? undefined : meetPart;
      case 'teams':
        return teamId ? 'teams' : teamsPart;
      default:
        return undefined;
    }
  };
  const setSectionFor = (app: Mode, id: string) => {
    switch (app) {
      case 'mail':
        return selectView(id === 'files' ? { kind: 'files', id: 'files' } : id === 'contacts' ? { kind: 'contacts', id: 'contacts' } : { kind: 'folder', id: 'inbox' });
      case 'chat':
        setChatId(null);
        setChatPage(null);
        return setChatPart(id as typeof chatPart);
      case 'tasks':
        setTaskOpen(null);
        if (id === 'browse') return setTaskBrowse(true);
        setTaskBrowse(false);
        return setTaskScope({ kind: id as 'today' | 'upcoming' | 'mine' });
      case 'calendar':
        setSelectedEventId(null);
        if (id === 'meetings') return setCalMeetings(true);
        setCalMeetings(false);
        return setCalView(id === 'month' ? 'month' : calViewPhone === 'month' ? 'schedule' : calViewPhone);
      case 'notes':
        setNoteId(null);
        return setNotesFilter(id === 'shared' ? 'shared' : 'all');
      case 'drive':
        setDriveFolder(null);
        return setDriveSection(id === 'home' ? 'recent' : id === 'starred' ? 'starred' : id === 'shared' ? 'shared' : 'my');
      case 'projects':
        setProjMine(id === 'mine');
        return setProjScope(id === 'past' ? { kind: 'past' } : { kind: 'projects' });
      case 'meet':
        if (id !== 'folders') setMeetPart(id as typeof meetPart);
        return setMeetPage(id === 'folders' ? { kind: 'folders' } : { kind: 'list' });
      case 'teams':
        setTeamId(null);
        return setTeamsPart(id as typeof teamsPart);
    }
  };
  // The thing open in the app (a task, a channel, a note…), for the URL.
  const itemNow = (app: Mode): string | undefined => {
    switch (app) {
      case 'tasks':
        return taskOpen ?? undefined;
      case 'chat':
        return chatId ?? undefined;
      case 'mail':
        return mailId(view);
      case 'notes':
        return noteId ?? undefined;
      case 'projects':
        return projScope.kind === 'client' ? projScope.id : undefined;
      case 'tables':
        return tableId ?? undefined;
      case 'meet':
        return meetPage.kind === 'meeting' ? meetPage.id : meetPage.kind === 'folder' ? `folder/${meetPage.clientId}` : meetPage.kind === 'unfiled' || meetPage.kind === 'tasks' ? meetPage.kind : undefined;
      case 'teams':
        return teamId ?? undefined;
      case 'settings':
        return settingsSection;
      default:
        return undefined;
    }
  };
  /** Opens what a URL names in an app; false while it isn't loaded yet (a link opened before the data came). */
  const setItemFor = (app: Mode, id: string | undefined, clear: boolean): boolean => {
    if (!id) {
      if (!clear) return true;
      if (app === 'tasks') setTaskOpen(null);
      if (app === 'chat') setChatId(null);
      if (app === 'notes') setNoteId(null);
      if (app === 'projects' && projScope.kind === 'client') setProjScope({ kind: 'projects' });
      if (app === 'meet' && (meetPage.kind === 'meeting' || meetPage.kind === 'folder' || meetPage.kind === 'unfiled' || meetPage.kind === 'tasks')) setMeetPage(meetPage.kind === 'meeting' ? { kind: 'list' } : { kind: 'folders' });
      if (app === 'teams') setTeamId(null);
      if (app === 'mail') setReaderOpen(false);
      return true;
    }
    switch (app) {
      case 'tasks':
        if (!todos.some((x) => x.id === id)) return false;
        return (setTaskOpen(id), true);
      case 'chat':
        if (!channels.some((c) => c.id === id)) return false;
        return (setChatId(id), setChatPage(null), true);
      case 'mail': {
        const [kind, rest] = id.includes('/') ? [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)] : ['folder', id];
        setView((kind === 'label' || kind === 'category' || kind === 'project' ? { kind, id: rest } : kind === 'folder' && (rest === 'todos' || rest === 'tracking') ? { kind: rest, id: rest } : { kind: 'folder', id: rest }) as View);
        return true;
      }
      case 'notes':
        if (id === 'new') return true;
        if (!notes.some((n) => n.id === id)) return false;
        return (setNoteId(id), true);
      case 'projects':
        if (!clients.some((c) => c.id === id)) return false;
        return (setProjScope({ kind: 'client', id }), true);
      case 'tables':
        if (!tables.some((x) => x.id === id)) return false;
        return (setTableId(id), true);
      case 'meet':
        if (id === 'unfiled' || id === 'tasks') return (setMeetPage({ kind: id }), true);
        if (id.startsWith('folder/')) return (setMeetPage({ kind: 'folder', clientId: id.slice(7) }), true);
        if (!meetings.some((m) => m.id === id)) return false;
        return (setMeetPage({ kind: 'meeting', id }), true);
      case 'teams':
        if (!teams.some((x) => x.id === id)) return false;
        return (setTeamId(id), true);
      case 'settings':
        return (setSettingsSection(id as SettingsSection), true);
      default:
        return true;
    }
  };
  const SEARCH_SECTIONS: Record<string, AppId> = { mail: 'mail', chat: 'chat', notes: 'notes' };
  /** Mail's Search tab: Gmail's search screen over the list (MessageList), from the inbox when another part is open. */
  const mailSearch = () => {
    if (view.kind === 'files' || view.kind === 'contacts' || view.kind === 'tracking') {
      selectView({ kind: 'folder', id: 'inbox' });
      return void setTimeout(() => dispatchEvent(new Event('s2g:mail-search')), 60);
    }
    dispatchEvent(new Event('s2g:mail-search'));
  };
  /** Shows what a route names: the launcher, or the app, its section and the thing open in it. */
  const applyRoute = (r: Route, clear: boolean): boolean => {
    if (r.launcher) return (setLauncherState(true), true);
    const m = (r.mode === 'settings' || APP_IDS.includes(r.mode) ? r.mode : 'home') as Mode;
    if (m !== 'settings' && m !== 'home' && !enabled.has(m)) return true;
    if (m !== mode) setMode(m);
    if (m !== 'settings') setLastMode(m as AppId);
    setLauncherState(false);
    const sec = r.section ?? (SECTIONS_OF[m]?.[0] as string | undefined);
    if (sec === 'search' && m === 'mail') setTimeout(mailSearch, 300);
    else if (sec === 'search' && SEARCH_SECTIONS[m]) openSearch(SEARCH_SECTIONS[m]);
    else if (sec && sec !== sectionNow(m)) setSectionFor(m, sec);
    return setItemFor(m, r.id, clear);
  };
  const appBar: AppSections | null = (() => {
    const cur = sectionNow(mode) ?? '';
    const bar = (sections: AppSection[]): AppSections => ({ sections, current: cur, onChange: (id) => setSectionFor(mode, id), onReselect: (id) => setSectionFor(mode, id) });
    switch (mode) {
      case 'mail':
        return bar([
          { id: 'inbox', label: t('Inbox'), icon: Inbox, badge: accountUnread.all ?? 0 },
          { id: 'search', label: t('Search'), icon: SearchIcon, run: mailSearch },
          { id: 'files', label: t('Files'), icon: Paperclip },
          { id: 'contacts', label: t('Contacts'), icon: Contact },
        ]);
      case 'chat':
        return bar([
          { id: 'home', label: t('Home'), icon: House },
          { id: 'dms', label: t('DMs'), icon: MessageCircle, badge: dmUnread },
          { id: 'activity', label: t('Activity'), icon: Bell, badge: chatActivity },
          { id: 'search', label: t('Search'), icon: SearchIcon, run: () => openSearch('chat') },
        ]);
      case 'tasks':
        return bar([
          { id: 'today', label: t('Today'), icon: Sun, badge: tasksDue },
          { id: 'upcoming', label: t('Upcoming'), icon: CalendarRange },
          { id: 'mine', label: t('My tasks'), icon: CircleCheck },
          { id: 'browse', label: t('Browse'), icon: Layers },
        ]);
      case 'calendar':
        return bar([
          { id: 'schedule', label: t('Schedule'), icon: List },
          { id: 'month', label: t('Month'), icon: CalendarDays },
          { id: 'meetings', label: t('Meetings'), icon: Video },
        ]);
      case 'notes':
        return bar([
          { id: 'notes', label: t('Notes'), icon: NotebookPen },
          { id: 'shared', label: t('Shared'), icon: Users },
          { id: 'search', label: t('Search'), icon: SearchIcon, run: () => openSearch('notes') },
        ]);
      case 'drive':
        return bar([
          { id: 'home', label: t('Home'), icon: House },
          { id: 'starred', label: t('Starred'), icon: Star },
          { id: 'shared', label: t('Shared'), icon: Users },
          { id: 'files', label: t('Files'), icon: Folder },
        ]);
      case 'projects':
        return bar([
          { id: 'active', label: t('Active'), icon: Briefcase },
          { id: 'mine', label: t('Mine'), icon: UserRound },
          { id: 'past', label: t('Past'), icon: Archive },
        ]);
      case 'meet':
        return bar([
          { id: 'meetings', label: t('Meetings'), icon: Video },
          { id: 'notes', label: t('Notes'), icon: FileText },
          { id: 'folders', label: t('Folders'), icon: Folder },
        ]);
      case 'teams':
        return bar([
          { id: 'teams', label: t('Teams'), icon: UsersRound },
          { id: 'people', label: t('People'), icon: Contact },
        ]);
      default:
        return null; // Home, Tables, Vault, Settings: no bar
    }
  })();
  useAppSections(mode === 'settings' ? 'home' : mode, mobile && mode !== 'settings' && appBar);
  const showAppBar = mobile && !launcher && !!chrome.sections && mode !== 'settings' && !guestView;
  useEffect(() => {
    const root = document.documentElement;
    const off = mobile && !showAppBar;
    if (root.classList.contains('no-app-bar') !== off) root.classList.toggle('no-app-bar', off);
  }, [mobile, showAppBar]);

  // The URL follows the screen: the launcher is "/", an app "/tasks", a section "/tasks/upcoming", the thing open in it
  // "/tasks/upcoming/<id>". Moving forward adds history (a thing opened from elsewhere gets its app under it); going
  // back to where we just were steps back instead, so Back walks the same way (src/route.ts).
  const routeNow: Route = launcher ? { launcher: true, mode: 'home' } : { launcher: false, mode, section: sectionNow(mode), id: itemNow(mode) };
  const pathWanted = routePath(routeNow);
  const stack = useRef<string[]>(bootStack.length ? bootStack : [pathNow()]);
  const ignorePops = useRef(0);
  const fromPop = useRef(false);
  const bootPending = useRef<Route | null>(boot.launcher ? null : boot);
  // A link opened before its data came: try again as things load, for a few seconds.
  useEffect(() => {
    const r = bootPending.current;
    if (!r) return;
    if (applyRoute(r, false)) bootPending.current = null;
  }, [todos.length, notes.length, channels.length, clients.length, tables.length, meetings.length, teams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => (bootPending.current = null), 5000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (bootPending.current) return;
    const cur = pathNow();
    if (pathWanted === cur.replace(/\/$/, '') || (pathWanted === '/' && cur === '/')) return;
    if (fromPop.current) return void ((fromPop.current = false), setPath(pathWanted, 'replace'));
    const st = stack.current;
    if (st.length > 1 && st[st.length - 2] === pathWanted && !hashRouting) {
      st.pop();
      ignorePops.current++;
      history.back();
      return;
    }
    for (const step of historySteps(cur, pathWanted, mobile)) {
      setPath(step, 'push');
      st.push(step);
    }
  }, [pathWanted]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyRef = useRef(applyRoute);
  applyRef.current = applyRoute;
  useEffect(() => {
    const pop = () => {
      if (ignorePops.current > 0) return void ignorePops.current--;
      const path = pathNow();
      const st = stack.current;
      const at = st.lastIndexOf(path);
      if (at >= 0) st.length = at + 1;
      else st.push(path);
      fromPop.current = true;
      bootPending.current = null;
      applyRef.current(parseRoute(path, isPhone()), true);
      setTimeout(() => (fromPop.current = false), 0);
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  // Where you were, for "back within 10 minutes reopens it"; after longer away, a phone opens on the launcher.
  const hiddenAt = useRef(0);
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(LAST_PLACE, JSON.stringify({ path: pathWanted, at: Date.now() }));
      } catch {
        /* private mode */
      }
    };
    save();
    const vis = () => {
      if (document.visibilityState === 'hidden') return (save(), void (hiddenAt.current = Date.now()));
      if (hiddenAt.current && Date.now() - hiddenAt.current > RESUME_MS && isPhone()) setLauncherState(true);
      hiddenAt.current = 0;
    };
    document.addEventListener('visibilitychange', vis);
    addEventListener('pagehide', save);
    return () => (document.removeEventListener('visibilitychange', vis), removeEventListener('pagehide', save));
  }, [pathWanted]);

  /** Back to the launcher: the app shrinks into its own tile. Each app keeps its section and scroll meanwhile. */
  const toLauncher = () => {
    if (launcher) return;
    launchShrink(document.querySelector<HTMLElement>(`.launcher [data-tile="${mode}"]`));
    setNoticesOpen(false);
    setSidebarOpen(false);
    setLauncherState(true);
  };
  /** An app from its tile: it grows out of the tile into the whole screen. */
  const fromLauncher = (id: LauncherId, tile: HTMLElement | null) => {
    setLeftWith(Object.fromEntries(myApps.shown.map((x) => [x, badgeOf(x)])));
    launchGrow(tile);
    if (id === 'settings') return (openSettingsList(), go('settings'));
    if (id === mode) return setLauncherState(false);
    go(id);
  };
  // The vault locks when you leave it for the launcher.
  useEffect(() => {
    if (launcher && mode === 'vault') setVaultUnlocked(user.id, null);
  }, [launcher]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = document.documentElement;
    const on = mobile && launcher;
    if (root.classList.contains('launcher-on') !== on) root.classList.toggle('launcher-on', on);
  }, [mobile, launcher]);
  // From the left edge on an app's first screen of a section: back to the launcher (inside a pushed screen the same
  // swipe is that screen's Back).
  const subScreen = (mode === 'tasks' && !taskBrowse && !['today', 'upcoming', 'mine'].includes(taskScope.kind)) || (mode === 'drive' && !!driveFolder) || (mode === 'teams' && !!teamId) || (mode === 'meet' && meetPage.kind !== 'list') || (mode === 'mail' && readerOpen);
  useEdgeSwipe(toLauncher, mobile && !launcher && !chrome.focused && !subScreen && !guestView);

  // ⌘K: everything you can jump to
  const today0 = localDay();
  // Search inside tables and chat too. Built only when they change: they're the biggest part of the list.
  const deepItems = useMemo<PaletteItem[]>(() => {
    const chanIds = new Set(wsChannels.map((c) => c.id));
    const rows = wsTableRows.slice(0, 3000).map((r) => {
      const tb = wsTables.find((x) => x.id === r.tableId);
      const name = tb ? rowName(tb, r) : t('Row');
      const cells = (Object.values(r.values) as unknown[])
        .flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v]))
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .join(' ');
      return { id: 'row-' + r.id, group: 'Rows', title: name || t('Untitled row'), sub: tb?.name, icon: Table2, keywords: cells.slice(0, 1200), run: () => openTable(r.tableId, r.id) };
    });
    const msgs = messages
      .filter((m) => chanIds.has(m.channelId) && m.text)
      .slice(-800)
      .reverse()
      .map((m) => {
        const c = wsChannels.find((x) => x.id === m.channelId)!;
        return { id: 'msg-' + m.id, group: 'Messages', title: m.text.replace(/\s+/g, ' ').slice(0, 90), sub: `${c.kind === 'dm' ? t('Direct message') : '#' + c.name} · ${firstOf(m.userId)}`, icon: MessagesSquare, keywords: m.text.slice(0, 1500), run: () => (setFocusMsg(m.id), openChannel(m.channelId)) };
      });
    return [...rows, ...msgs];
  }, [wsTableRows, wsTables, messages, wsChannels, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const paletteItems: PaletteItem[] = [
    // What needs you, so an empty search is already useful.
    ...wsTasks
      .filter((t) => !t.done && ((stageKind(t) === 'review' && t.supervisorId === user.id) || (doersOf(t).includes(user.id) && !!t.due && t.due <= today0)))
      .map((task) => ({ id: 'n-' + task.id, group: 'Needs you', title: task.title, sub: stageKind(task) === 'review' ? t('Waiting for your review') : task.due! < today0 ? t('Late') : t('Due today'), icon: ListChecks, run: () => openTask(task.id) })),
    { id: 'a-dump', group: 'Actions', title: t('Brain dump'), sub: t('Turn your thoughts into assigned tasks'), icon: Brain, app: 'tasks' as const, run: () => openDump('') },
    ...(enabled.has('mail') && mailOut ? [{ id: 'a-compose', group: 'Actions', title: t('Compose email'), icon: PenLine, app: 'mail' as const, run: () => openCompose() }] : []),
    { id: 'a-task', group: 'Actions', title: t('New task'), icon: ListChecks, app: 'tasks' as const, run: () => (openTasks({ kind: 'mine' }), setTaskAdd((n) => n + 1)) },
    ...(enabled.has('calendar') ? [{ id: 'a-event', group: 'Actions', title: t('New event'), icon: CalendarPlus, app: 'calendar' as const, run: () => { go('calendar'); openNewEvent(); } }] : []),
    ...APPS.filter((a) => enabled.has(a.id)).map((a) => ({ id: 'go-' + a.id, group: 'Go to', title: a.name, icon: a.icon, run: () => go(a.id) })),
    ...wsClientsAll.map((c) => ({ id: 'c-' + c.id, group: `${term.Many}`, title: c.name, sub: c.status === 'ended' ? t('Past {project}', { project: term.one }) : c.domain, icon: Building2, run: () => openClient(c.id) })),
    ...wsTasks.filter((task) => !task.done).map((task) => ({ id: 't-' + task.id, group: 'Tasks', title: task.title, sub: [wsClients.find((c) => c.id === task.clientId)?.name, task.userId ? firstOf(task.userId) : t('nobody yet')].filter(Boolean).join(' · '), icon: ListChecks, keywords: [task.notes, task.context].filter(Boolean).join(' ').slice(0, 1500), run: () => openTask(task.id) })),
    ...members.filter((u) => u.id !== user.id).map((u) => ({ id: 'p-' + u.id, group: 'People', title: u.name, sub: u.title || u.email, icon: UserIcon, run: () => openChannel(dmWith(u.id)) })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ id: 'ch-' + c.id, group: 'Channels', title: '#' + c.name, icon: Hash, run: () => openChannel(c.id) })),
    ...wsThreads.slice(0, 200).map((th) => ({ id: 'm-' + th.id, group: 'Emails', title: th.subject, sub: th.messages[th.messages.length - 1].from.name, icon: Mail, keywords: th.messages.slice(-2).map((m) => m.body).join(' ').slice(0, 1500), run: () => openThread(th.id) })),
    ...wsNotes.map((n) => ({ id: 'no-' + n.id, group: 'Notes', title: n.title || t('Untitled note'), sub: wsClientsAll.find((c) => c.id === n.clientId)?.name, icon: FileText, keywords: htmlToText(n.html).slice(0, 2000), run: () => openNote(n.id) })),
    ...wsMeetings.map((m) => ({ id: 'mt-' + m.id, group: 'Meetings', title: m.title, icon: Video, keywords: [m.summary, ...(m.keyPoints ?? []), ...(m.decisions ?? []), ...(m.transcript ?? []).map((l) => l.text)].join(' ').slice(0, 6000), run: () => openMeeting(m.id) })),
    ...deepItems,
    ...wsDrive.filter((i) => i.kind !== 'folder' && !i.trashed).map((i) => ({ id: 'f-' + i.id, group: 'Files', title: i.name, icon: FileText, run: () => { go('drive'); setPreview({ item: i, list: [i] }); } })),
  ];

  // Everything shared with this person by other companies, on one page (from the switcher, also on phones).
  if (portalKey === '*' && myPortals.length)
    return <SharedHome name={user.name} portals={myPortals} todos={todos} channels={channels} messages={messages} onOpen={setPortalKey} onStart={() => setPortalKey('')} onSignOut={onSignOut} ownWorkspace={ws.name} />;

  // A company this person is a client of: their portal, with the same sign-in.
  const portal = myPortals.find((pt) => pt.key === portalKey);
  if (portal) {
    const pws = portal.ws;
    setBrandName(brandOf(pws)); // guests see the brand of the company that invited them
    const ended = afterEnd(portal.client, portal.person, accessFor(pws, portal.client));
    const access = ended.access;
    const team = allUsers.filter((u) => pws.members.some((m) => m.userId === u.id));
    const inbox = [user.id, clientInbox(user.email)];
    const actions = clientActions({
      ws: pws,
      client: portal.client,
      person: ended.person,
      access,
      team,
      teams: teams.filter((t) => t.workspaceId === pws.id),
      todos,
      channels,
      messages,
      meetings: meetings.filter((m) => m.workspaceId === pws.id),
      drive,
      setTodos,
      setMessages,
      setDrive,
      setClients,
      setNotices,
      setChannels,
      makeInvite: async (pp) => {
        if (!server.on) return null;
        const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: pws.id, clientId: portal.client.id, ...pp }) });
        if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${location.origin}${link}` : null; // null: they already sign in, nothing to send
      },
    });
    return (
      <ClientApp
        key={portal.key}
        ws={pws}
        client={portal.client}
        person={ended.person}
        access={access}
        team={team}
        actions={actions}
        messages={messages}
        allTasks={todos}
        quotes={quotes.filter((q) => q.workspaceId === pws.id)}
        onDecideQuote={decideQuote(user.email)}
        notices={notices.filter((n) => n.workspaceId === pws.id && inbox.includes(n.userId))}
        onReadNotices={() => setNotices((ns) => ns.map((n) => (n.workspaceId === pws.id && inbox.includes(n.userId) ? { ...n, read: true } : n)))}
        onSignOut={onSignOut}
        account={{ me: user, theme: settings.theme, onTheme: (t) => updateSettings({ theme: t }), onProfile: (patch) => (patch.name !== undefined && updateSettings({ name: patch.name, title: patch.title ?? settings.title, avatarColor: patch.color ?? settings.avatarColor }), onUpdateUser(patch)) }}
        switcher={<WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined} workspaces={workspaces} current={pws} currentPortal={portal.key} unread={wsUnread} portals={portalItems} onPortal={setPortalKey} onSwitch={(id) => (setPortalKey(''), switchWorkspace(id))} />}
        mobileSwitch={{ workspaces, onWorkspace: (id) => (setPortalKey(''), switchWorkspace(id)), portals: portalItems, current: portal.key, onPortal: setPortalKey, onShared: myPortals.length > 1 ? () => setPortalKey('*') : undefined, onAdd: () => (setPortalKey(''), setNewWs(true)) }}
      />
    );
  }

  /** Meet's screens (the Meet app, and Calendar's Meetings section on phones). */
  const renderMeet = (extra: { part?: 'meetings' | 'notes'; embedded?: boolean }) => (
          <MeetView
            page={meetPage}
            meetings={wsMeetings}
            clients={wsClients}
            tasks={wsTasks}
            users={members}
            me={user.id}
            myRole={myRole}
            events={myNear}
            settings={meetSettings}
            overrides={joinOverrides}
            sentEvents={sentFor}
            autoJoin={autoJoin}
            onPage={setMeetPage}
            onStop={stopBot}
            onRegenerate={(id) => finishMeeting(id, true)}
            onTranscribeAgain={
              recorderOn && real
                ? (id, language) =>
                    void fetch(`/api/meet/again/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language }) }).then(async (r) =>
                      showToast({ text: r.ok ? 'Transcribing again. The notes update when it’s done.' : (((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t transcribe again') }),
                    )
                : undefined
            }
            onDelete={deleteMeeting}
            onFolder={setMeetingFolder}
            onPatch={patchMeeting}
            onShare={setShareFor}
            onToggleTask={toggleTodo}
            onPatchTask={patchTask}
            onBulk={(ids, action) =>
              action === 'delete'
                ? setTodos((ts) => ts.filter((t) => !ids.includes(t.id)))
                : setTodos((ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, done: action === 'done', status: stageIdFor(t, action === 'done' ? 'done' : 'open'), doneAt: action === 'done' ? nowIso() : undefined, doneBy: action === 'done' ? user.id : undefined } : t)))
            }
            onAddTask={(t) => createTask({ ...t, source: t.meetingId ? 'meeting' : 'manual' }, { chat: true })}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onWriteOverview={writeOverview}
            onJoinMode={(jm) => patchWorkspace(ws.id, { meetings: { ...meetSettings, joinMode: jm } })}
            onOverride={setBotJoin}
            onSendNow={(e) => sendNotetakerTo(e)}
            demo={demoOk}
            calendarsSyncedAt={linkCals.reduce<string | undefined>((a, c) => (c.syncedAt && (!a || c.syncedAt > a) ? c.syncedAt : a), undefined)}
            onSyncCalendars={real && linkCals.some((c) => c.source === 'ics') ? refreshLinks : demoOk ? () => showToast({ text: 'Synced' }) : undefined}
            onAsk={setAskScope}
            onSend={() => openSendBot()}
            canSendBot={botOn}
            onMenu={() => setSidebarOpen(true)}
            toast={(text) => showToast({ text })}
            company={ws}
            appSettings={settingsRows}
            onOpenEvent={(id) => {
              const e = findEvent(calEvents, id);
              go('calendar');
              if (e) setCalCursor(new Date(e.start));
              setSelectedEventId(id);
            }}
            {...extra}
          />
  );
  // "View as client": the whole app becomes exactly what this client person sees.
  if (viewAs) {
    const vc = wsClients.find((c) => c.id === viewAs.clientId);
    const people = vc ? clientPeople(vc, channels) : [];
    const person = people.find((x) => x.email === viewAs.email);
    if (vc && person) {
      const view = afterEnd(vc, person, accessFor(ws, vc));
      const access = view.access;
      const actions = clientActions({ ws, client: vc, person: view.person, access, team: members, teams: wsTeams, todos, channels, messages, meetings: wsMeetings, drive, setTodos, setMessages, setDrive, setClients, setNotices, setChannels, makeInvite: makeClientInvite(vc.id) });
      const inbox = clientInbox(person.email);
      return (
        <ClientApp
          ws={ws}
          client={vc}
          person={view.person}
          access={access}
          team={members}
          actions={actions}
          messages={messages}
          allTasks={wsTasks}
          quotes={wsQuotes}
          onDecideQuote={decideQuote(person.email)}
          notices={notices.filter((n) => n.userId === inbox)}
          onReadNotices={() => setNotices((ns) => ns.map((n) => (n.userId === inbox ? { ...n, read: true } : n)))}
          preview={{ onExit: () => setViewAs(null), people: people.filter((x) => x.status !== 'pending'), onSwitch: (email) => setViewAs({ clientId: vc.id, email }) }}
        />
      );
    }
  }

  return (
    <TabDefaultsCtx.Provider value={tabDefaults}>
    <ProjectsCtx.Provider value={projectsCtx}>
    {inSandbox ? <DemoCompanyBar busy={demoBusy} onReset={() => setResettingDemo(true)} onHide={() => void hideDemo()} /> : topBar}
    <div className={`app mode-${mode} ${readerOpen ? 'reading' : ''} ${collapsed ? 'sb-collapsed' : ''} ${['home', 'settings'].includes(mode) ? 'no-sidebar' : ''} ${inSandbox || topBar ? 'with-demo-bar' : ''}`}>
      <AppRail
        current={mode}
        enabled={enabledApps}
        pinned={tablet ? tabApps : undefined}
        onPinned={setTabApps}
        badges={{ mail: accountUnread.all, chat: chatUnreadTotal, tasks: wsTasks.filter((t) => t.userId === user.id && !t.done && t.due && t.due <= localDay()).length }}
        workspace={
          <WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            workspaces={workspaces}
            current={ws}
            unread={wsUnread}
            onSwitch={switchWorkspace}
            portals={portalItems}
            onPortal={setPortalKey}
            onAdd={() => setNewWs(true)}
            onSettings={() => {
              setSettingsSection('workspace');
              go('settings');
            }}
            demo={demoEntry}
          />
        }
        account={
          <div className="account-wrap">
            <button className={`rail-avatar ${accountOpen || mode === 'settings' ? 'on' : ''}`} onClick={() => setAccountOpen((o) => !o)} title={t('{name} · account & settings', { name: ME.name })}>
              <Avatar person={ME} size={32} />
            </button>
            {accountOpen && (
          <AccountMenu
            me={ME}
            settings={settings}
            used={usage.mail + usage.drive}
            quota={usage.quota}
            onTheme={(theme) => updateSettings({ theme })}
            onSettings={(s) => {
              setSettingsSection(s);
              go('settings');
            }}
            onSignOut={onSignOut}
            others={signedInUsers.filter((u) => u.id !== user.id)}
            onSwitchUser={onSwitchUser}
            onAddUser={onAddUser}
            onClose={() => setAccountOpen(false)}
          />
            )}
          </div>
        }
        notifications={<Notifications notices={myNotices} onOpen={openNotice} onReadAll={() => setNotices((ns) => ns.map((n) => (n.userId === user.id && n.workspaceId === ws.id ? { ...n, read: true } : n)))} onClose={() => setNoticesOpen(false)} />}
        unreadNotices={myNotices.filter((n) => !n.read).length}
        noticesOpen={noticesOpen}
        aiOpen={!!askScope}
        onApp={go}
        onSearch={() => setPaletteOpen(true)}
        onAskAI={toggleAsk}
        onNotices={() => setNoticesOpen((o) => !o)}
      />
      <Sidebar
        mode={appMode}
        title={({ home: t('Home'), mail: t('Mail'), chat: t('Chat'), tasks: t('Tasks'), calendar: t('Calendar'), notes: t('Notes'), drive: t('Drive'), meet: t('Meet'), vault: t('Vault'), settings: t('Settings'), projects: term.Many, tables: t('Tables'), teams: t('Teams') } as Record<string, string>)[appMode]}
        collapsed={collapsed && !mobile}
        onCollapse={setCollapsed}
        settings={appSettings(appMode, 'sidebar')}
        width={Math.min(Math.max(sidebarW, SIDEBAR_MIN), SIDEBAR_MAX)}
        onWidth={setSidebarW}
        mobileTop={
          <div className="drawer-top">
          <WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            workspaces={workspaces}
            current={ws}
            unread={wsUnread}
            onSwitch={switchWorkspace}
            portals={portalItems}
            onPortal={setPortalKey}
            onAdd={() => setNewWs(true)}
            onSettings={() => {
              setSettingsSection('workspace');
              go('settings');
            }}
            demo={demoEntry}
          />
            <button className="ghost-btn outline sm" onClick={() => go('settings')}>
              {t('Settings')}
            </button>
          </div>
        }
        panel={
          appMode === 'calendar' ? (
            calendarPanel
          ) : appMode === 'drive' ? (
          <DriveSidebar
            section={mode === 'drive' ? driveSection : null}
            used={usage.mail + usage.drive}
            quota={usage.quota}
            onSection={(s) => {
              setDriveSection(s);
              setDriveFolder(null);
              setSidebarOpen(false);
              if (mode !== 'drive') go('drive');
            }}
            onUpload={() => fileInput.current?.click()}
            onNewFolder={newFolder}
          />
          ) : appMode === 'projects' ? (
          <ProjectsSidebar
            scope={projScope}
            tasks={wsTasks}
            clients={wsClientsAll}
            isAdmin={seesAllProjects}
            myClientIds={myClientIds}
            onScope={(sc) => {
              setProjScope(sc);
              setSidebarOpen(false);
            }}
            onAddClient={
              canCreateProjects
                ? (name, domain, type) => {
                    const c = createProject(name, { domain, type });
                    setProjScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
          />
          ) : appMode === 'tasks' ? (
          <TasksSidebar
            scope={taskScope}
            tasks={wsTasks}
            clients={wsClientsAll}
            teams={wsTeams}
            me={user.id}
            isAdmin={isAdmin}
            myTeamIds={myTeamIds}
            myClientIds={myClientIds}
            onScope={(sc) => {
              openTasks(sc);
              setSidebarOpen(false);
            }}
            projectsApp={enabled.has('projects')}
            onBrainDump={() => openDump('')}
            onAddClient={
              canCreateProjects
                ? (name, domain, type) => {
                    const c = createProject(name, { domain, type });
                    setTaskScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
          />
          ) : appMode === 'meet' ? (
          <MeetSidebar
            page={meetPage}
            meetings={wsMeetings}
            clients={wsClients}
            canSend={meetSettings.whoCanRecord === 'everyone' || myRole !== 'member'}
            onPage={(pg) => (setMeetPage(pg), setSidebarOpen(false))}
            onSend={() => openSendBot()}
            onAsk={() => openAsk({ kind: 'all' })}
            onSettings={() => (setSettingsSection('meetings'), go('settings'))}
          />
          ) : appMode === 'chat' ? (
          <ChatSidebar
            variant="side"
            channels={visibleChannels}
            messages={wsMessages}
            users={members}
            me={user.id}
            myFirst={myFirst}
            workspaceId={ws.id}
            current={chatPage ? null : chatId}
            page={chatPage}
            onPage={(pg) => (setChatPage(pg), setSidebarOpen(false))}
            onLeave={leaveChannel}
            statuses={statuses}
            presence={presence}
            onOpen={(id) => {
              setChatId(id);
              setChatPage(null);
              setSidebarOpen(false);
            }}
            onJoin={(id) => {
              setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: [...c.members, user.id] } : c)));
              setChatId(id);
              setChatPage(null);
              setSidebarOpen(false);
            }}
            onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined}
            onNewMessage={(to) => setChatId(dmFor(to))}
            dmGuests={dmGuests}
            canManage={canManageChannel}
            onMove={moveChannel}
            onSettings={(id) => setChanDialog({ id })}
            isAdmin={isAdmin}
            layout={ws.chat?.layout}
            teams={wsTeams}
            onSectionAccess={setSectionAccess}
            onLayout={(layout) => patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout } })}
            onStatus={(st) =>
              setStatuses((all) => {
                const next = { ...all };
                if (st) next[user.id] = st;
                else delete next[user.id];
                return next;
              })
            }
          />
          ) : appMode === 'vault' ? (
            <VaultSidebar items={vaultItems} clients={wsClientsAll} filter={vaultFilter} onFilter={(f) => (setVaultFilter(f), setSidebarOpen(false))} onNew={() => setVaultEditing('new')} />
          ) : appMode === 'teams' ? (
            <TeamsSidebar teams={wsTeams} me={user.id} current={wsTeams.some((t) => t.id === teamId) ? teamId : null} canCreate={canCreateTeams} onOpen={(id) => (setTeamId(id), setSidebarOpen(false))} onNew={() => setNewTeam(true)} />
          ) : appMode === 'tables' ? (
            <TablesSidebar tables={wsTables} clients={wsClientsAll} current={currentTable?.id ?? null} onOpen={(id) => (openTable(id), setSidebarOpen(false))} onNew={() => setNewTableFor({})} />
          ) : appMode === 'notes' ? (
            <NotesList notes={wsNotesAll} api={notesApi} current={noteId} filter={notesFilter} onFilter={setNotesFilter} onOpen={(id, find) => (openNote(id, find), setSidebarOpen(false))} onNew={() => newNote()} phone={false} />
          ) : null
        }
        accounts={myAccounts}
        delegated={delegatedIds}
        activeAccount={activeAccount}
        accountUnread={accountUnread}
        onNewTemp={() => setTempDialog({})}
        onNewProject={enabled.has('projects') ? () => (newProjectFlow(), setSidebarOpen(false)) : undefined}
        onTempMenu={(a, el) => ((tempAnchor.current = el), setTempMenu(a))}
        onAccountFilter={(id) => {
          setActiveAccount(id);
          setSelectedId(null);
          setReaderOpen(false);
          setSidebarOpen(false);
          if (view.kind !== 'folder') setView({ kind: 'folder', id: 'inbox' });
          if (mode !== 'mail') go('mail');
        }}
        view={view}
        savedNav={<SavedSearches query={query} onRun={(q) => (selectView({ kind: 'folder', id: 'inbox' }), setQuery(q), mobile && setSidebarOpen(false))} />}
        tabNav={<TabNav current={view.kind === 'category' ? view.id : null} inbox={inboxAll} onPick={(c) => (activeAccount !== 'all' && setActiveAccount('all'), selectView({ kind: 'category', id: c }))} />}
        labels={organize.chipLabels}
        labelNav={organize.nav}
        clients={mobile ? wsClients.filter((c) => c.domain) : wsClients}
        phoneMail={{
          workspace: ws,
          email: myAccounts.find((a) => a.kind !== 'shared' && !a.temp)?.email ?? user.email,
          onAccounts: () => (setSidebarOpen(false), setMailAccounts(true)),
          labels: [],
          labelNav: organize.drawer,
          tagUnread,
          todo: todoThreads.size,
          onSettings: () => (setSidebarOpen(false), setMailSettingsOpen(true)),
          onHelp: () => (setSidebarOpen(false), setSettingsSection('help'), setPushed({ kind: 'section', id: 'help', label: t('Help') })),
        }}
        onClient={(id) => (openClient(id, 'emails'), setSidebarOpen(false))}
        counts={counts}
        open={sidebarOpen}
        onSelect={selectView}
        onCompose={() => openCompose()}
        composeOff={mailOut ? undefined : 'Sending isn’t set up yet'}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main" key={`${ws.id}:${mode}`}>
        {mobile && (
          <MobileTop
            title={mode === 'settings' ? t('Settings') : (APPS.find((a) => a.id === mode)?.name ?? '')}
            menu={chrome.title ?? mobileSwitcher}
            settings={settingsRows}
            back={chrome.back ?? (mode === 'home' ? toLauncher : undefined)}
            onLauncher={toLauncher}
            launcherDot={launcherDot}
            workspaces={workspaces}
            current={ws}
            unreadByWs={wsUnread}
            onWorkspace={switchWorkspace}
            onAddWorkspace={() => setNewWs(true)}
            demo={demoEntry}
            portals={portalItems}
            onPortal={setPortalKey}
            onShared={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            onSearch={searchHere}
            me={{ person: ME, onOpen: () => (setSettingsSection('account'), go('settings')) }}
            status={{ emoji: statuses[user.id]?.emoji, text: statuses[user.id] ? statusText(statuses[user.id]!) : t('Available'), run: () => setStatusOpen(true) }}
            onSettings={() => (openSettingsList(), go('settings'))}
            claim={chrome.bar}
            large={tucked}
          />
        )}
        {mobile && <div className="huddle-dock top-dock" ref={huddleDock} />}
        {mobile && mode === 'chat' && (
          <section className="mobile-list chat-list view-enter">
            <ChatSidebar
              variant="phone"
              part={chatPart}
              channels={visibleChannels}
              messages={wsMessages}
              users={members}
              me={user.id}
              myFirst={myFirst}
              workspaceId={ws.id}
              current={chatId}
              page={chatPage}
              onPage={setChatPage}
              onLeave={leaveChannel}
              statuses={statuses}
              presence={presence}
              onOpen={setChatId}
              onJoin={(id) => {
                setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: [...c.members, user.id] } : c)));
                setChatId(id);
              }}
              onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined}
              onNewMessage={(to) => setChatId(dmFor(to))}
              dmGuests={dmGuests}
              dmIdFor={dmWith}
              onFollow={followThread}
              notices={myNotices.filter((n) => n.link?.app === 'chat')}
              onOpenNotice={openNotice}
              onReadNotices={(ids, read) => setNotices((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read } : n)))}
              onHuddle={(id) => {
                if (!server.on) return setChatId(id);
                tried('voice');
                if (huddleId && huddleId !== id) leaveHuddle();
                setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, huddle: { by: c.huddle?.by ?? user.id, at: c.huddle?.at ?? nowIso(), members: [...new Set([...(c.huddle?.members ?? []), user.id])] } } : c)));
                setHuddleId(id);
                setChatId(id);
              }}
              canManage={canManageChannel}
              onMove={moveChannel}
              onSettings={(id) => setChanDialog({ id })}
              isAdmin={isAdmin}
              layout={ws.chat?.layout}
              teams={wsTeams}
              onSectionAccess={setSectionAccess}
              onLayout={(layout) => patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout } })}
              onStatus={(st) =>
                setStatuses((all) => {
                  const next = { ...all };
                  if (st) next[user.id] = st;
                  else delete next[user.id];
                  return next;
                })
              }
            />
          </section>
        )}
        {mobile && mode === 'mail' && (view.kind === 'tracking' || view.kind === 'files') && (
          <TopBar app="mail" search={false} actions={<MailAvatar me={ME} elsewhere={workspaces.some((w) => w.id !== ws.id && (wsUnread[w.id] ?? 0) > 0)} onAccounts={() => setMailAccounts(true)} />} />
        )}
        {mobile && mailSettingsOpen && (
          <MailSettingsScreen
            onBack={() => setMailSettingsOpen(false)}
            rows={[
              { id: 'signature', label: t('Signature'), value: settings.signature.replace(/<[^>]+>/g, '').trim() ? t('On') : t('Off'), run: () => pushMailSection() },
              { id: 'undo', label: t('Undo send'), value: settings.undoSend ? tn(settings.undoSend, '{n} second', '{n} seconds') : t('Off'), run: () => pushMailSection(t('Undo send')) },
              ...(ws.readTracking !== false ? [{ id: 'tracking', label: t('Read tracking'), value: settings.trackByDefault ? t('On') : t('Off'), run: () => pushMailSection(t('Read tracking')) }] : []),
              ...(myAccounts.some((a) => !a.temp) ? [{ id: 'away', label: t('Out of office'), value: myAccounts.some((a) => a.away?.on) ? t('On') : t('Off'), run: () => pushMailSection(t('Out of office')) }] : []),
              { id: 'blocked', label: t('Blocked senders'), run: () => pushMailSection(t('Blocked senders')) },
              ...(isAdmin ? [{ id: 'email', label: t('Email delivery'), value: t('Your domain, sending and the DNS records'), run: () => (setSettingsSection('email'), setPushed({ kind: 'section', id: 'email', label: t('Email delivery') })) }] : []),
            ]}
          />
        )}
        {mobile && mailAccounts && (
          <CompanySheet
            onClose={() => setMailAccounts(false)}
            workspaces={workspaces}
            current={ws}
            unreadByWs={wsUnread}
            onWorkspace={switchWorkspace}
            onAddWorkspace={() => setNewWs(true)}
            demo={demoEntry}
            portals={portalItems}
            onPortal={setPortalKey}
            onShared={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            me={{ person: ME, onOpen: () => (setSettingsSection('account'), go('settings')) }}
            status={{ emoji: statuses[user.id]?.emoji, text: statuses[user.id] ? statusText(statuses[user.id]!) : t('Available'), run: () => setStatusOpen(true) }}
            onSettings={() => (openSettingsList(), go('settings'))}
          />
        )}
        {mode === 'mail' && view.kind === 'tracking' && (
          <TrackingDashboard
            threads={scoped}
            me={ME}
            onOpenThread={openThread}
            onNudge={(t, p) =>
              openCompose({
                initial: {
                  to: [p],
                  cc: [],
                  subject: /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`,
                  html: `<p>Hi ${p.name.split(' ')[0]}, just bringing this back to the top of your inbox. Any thoughts?</p>${settings.signature}`,
                  text: 'Hi, just bringing this back to the top of your inbox',
                  files: [],
                  track: true,
                  trackOptions: DEFAULT_TRACK_OPTIONS,
                  fromId: t.accountId,
                },
              })
            }
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'home' && (
          <HomeView
            key={ws.id}
            me={user}
            firstName={myFirst}
            isOwner={ws.members.some((m) => m.userId === user.id && m.role === 'owner')}
            workspaceId={ws.id}
            defaultTemplate={ws.teamHome?.[wsTeams.find((t) => t.members.includes(user.id))?.id ?? '']}
            tasks={wsTasks}
            clients={wsClients}
            teams={wsTeams}
            users={members}
            onAssign={(id, uid2) => patchTask(id, { userId: uid2 })}
            onSearch={() => setPaletteOpen(true)}
            onNudge={(id) => {
              const task = todos.find((x) => x.id === id);
              if (!task) return;
              doersOf(task).filter((x) => x !== user.id).forEach((x) => notify(x, 'task', task.due ? msg('{name} is checking on “{title}”, it was due {due}', { name: myFirst, title: task.title, due: phrase(dueWords(task.due)) }) : msg('{name} is checking on “{title}”', { name: myFirst, title: task.title }), { app: 'tasks', id }));
              logTask(id, 'comment', msg('sent a reminder'));
              showToast({ text: t('Reminded {names}', { names: fmtList(doersOf(task).map(firstOf)) }) });
            }}
            onOpenTask={openTask}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenBriefs={() => openTasks({ kind: 'briefs' })}
            onOpenGrid={() => openTasks({ kind: 'grid' })}
            threads={scoped}
            events={myNear}
            meetings={wsMeetings}
            notices={myNotices}
            kudos={messages
              .filter((m) => m.kind === 'kudos' && m.kudosFor && channels.some((c) => c.id === m.channelId && c.workspaceId === ws.id) && m.at > new Date(Date.now() - 7 * 86_400_000).toISOString())
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((m) => ({ id: m.id, to: m.kudosFor!, from: m.userId, text: m.text, at: m.at }))}
            enabled={enabled}
            ai={aiOn}
            onDump={(text) => openDump(text ?? '')}
            onToggleTask={toggleTodo}
            onOpenTasks={() => openTasks({ kind: 'mine' })}
            onOpenThread={openThread}
            onOpenMail={() => go('mail')}
            onOpenCalendar={(id) => {
              go('calendar');
              if (id) setSelectedEventId(id);
            }}
            onOpenClient={openClient}
            onOpenMeeting={openMeeting}
            onNotice={openNotice}
            onStart={(id) => {
              const t = todos.find((x) => x.id === id);
              if (t) setTaskStatus(id, stageIdFor(t, 'active'));
            }}
            onReschedule={(id, day) => patchTask(id, { due: day || undefined })}
            onReadNotices={(ids) => setNotices((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)))}
            onAllNotices={() => setNoticesOpen(true)}
            calls={wsChannels
              .filter((c) => c.huddle && c.huddle.members.some((m) => m !== user.id) && huddleId !== c.id)
              .map((c) => ({ id: c.id, name: c.name, people: c.huddle!.members.filter((m) => m !== user.id).map((m) => allUsers.find((u) => u.id === m)).filter((u): u is User => !!u) }))}
            onJoinHuddle={
              server.on
                ? (id) => {
                    if (huddleId && huddleId !== id) leaveHuddle();
                    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, huddle: { by: c.huddle?.by ?? user.id, at: c.huddle?.at ?? nowIso(), members: [...new Set([...(c.huddle?.members ?? []), user.id])] } } : c)));
                    setHuddleId(id);
                    openChannel(id);
                  }
                : (id) => openChannel(id)
            }
            botWillJoin={autoJoin === 'live' ? (e) => !sentFor[e.id] && botWillJoin(e) : undefined}
            onBotJoin={
              autoJoin === 'live'
                ? (e, join) => {
                    const byRule = botJoins(e, meetSettings.joinMode, {}, isMine);
                    setBotJoin(e.id, join === byRule ? null : join);
                    showToast({ text: join ? t('The notetaker will join “{title}”', { title: e.title }) : t('The notetaker won’t join “{title}”', { title: e.title }), action: { label: t('Undo'), run: () => setBotJoin(e.id, e.id in joinOverrides ? joinOverrides[e.id] : null) } });
                  }
                : undefined
            }
            onSendNotetaker={botOn && autoJoin !== 'live' ? sendNotetakerTo : undefined}
            notetakerSent={sentFor}
            onMenu={() => setSidebarOpen(true)}
            onNew={() => setNewOpen(true)}
            topRow={inSandbox && ws.sandbox && !ws.sandbox.listOff ? { title: t('Try the demo'), sub: t('{n} of {total} done', { n: TRY_KEYS.filter((k) => ws.sandbox!.tried?.includes(k)).length, total: TRY_KEYS.length }) } : undefined}
            news={news.filter((n) => !newsSeen.includes(n.id))}
            onDismissNews={(id) => setNewsSeen((s) => [...s.slice(-50), id])}
            top={
              inSandbox && ws.sandbox && !ws.sandbox.listOff ? (
                <TryList
                  tried={ws.sandbox.tried ?? []}
                  onGo={goTry}
                  onClose={() => (patchWorkspace(ws.id, { sandbox: { ...ws.sandbox!, listOff: true } }), showToast({ text: t('The list is in Help & support whenever you want it') }))}
                  onDone={(() => {
                    const realWs = workspaces.find((w) => !isSandbox(w));
                    return realWs ? { label: t('Go to {name}', { name: realWs.name }), run: () => switchWorkspace(realWs.id) } : { label: t('Set up your company'), run: () => setNewWs(true) };
                  })()}
                />
              ) : !inSandbox && demo?.allowed && demo.state === 'none' && !demoInviteOff && !allWsTasks.length && !wsClientsAll.length ? (
                <DemoInvite busy={demoBusy} onOpen={() => void openDemo()} onClose={() => setDemoInviteOff(true)} />
              ) : undefined
            }
            setup={
              !inSandbox && ws.members.some((m) => m.userId === user.id && m.role !== 'member')
                ? [
                    {
                      key: 'email',
                      label: t('Email'),
                      hint:
                        ws.emailSetup === 'none'
                          ? t('Mail is off for this company')
                          : mailIn && mailOut
                            ? t('Receiving and sending work')
                            : [mailIn ? t('Receiving works.') : '', mailOut ? t('Sending works.') : '', t((!mailIn ? mailWhy.receive : mailWhy.send) ?? 'Add the records for your domain')].filter(Boolean).join(' '),
                      done: ws.emailSetup === 'none' || (mailIn && mailOut),
                      onOpen: () => (setSettingsSection('email'), go('settings')),
                    },
                    { key: 'people', label: t('Your team'), hint: ws.members.length > 1 ? tn(ws.members.length, '{n} person in', '{n} people in') : t('Invite the people you work with'), done: ws.members.length > 1, onOpen: () => (setSettingsSection('workspace'), go('settings')) },
                    { key: 'brand', label: t('Logo and colour'), hint: ws.logo ? t('Set') : t('Your logo on the app and in shared spaces'), done: !!ws.logo, onOpen: () => (setSettingsSection('workspace'), go('settings')) },
                    { key: 'plan', label: t('Plan'), hint: ws.plan?.unlimited ? t('Unlimited') : ws.plan?.payment ? t('Payment set up') : ws.plan?.trialEnds ? t('Trial ends {date}; pick a plan before then', { date: fmtDay(ws.plan.trialEnds) }) : t('Pick a plan'), done: !!ws.plan?.payment || ws.plan?.tier === 'free' || !!ws.plan?.unlimited, onOpen: () => (setSettingsSection('billing'), go('settings')) },
                  ]
                : undefined
            }
          />
        )}

        {mode === 'projects' && projScope.kind === 'projects' && (
          <ProjectsHome
            key={projNew}
            startAdding={projNew > 0}
            projects={seesAllProjects && !(mobile && projMine) ? wsClientsAll : wsClientsAll.filter((c) => myClientIds.includes(c.id))}
            tasks={wsTasks}
            users={members}
            onOpen={(id) => (setClientTab(undefined), setProjScope({ kind: 'client', id }))}
            onPast={mobile ? undefined : () => setProjScope({ kind: 'past' })}
            onCreate={
              canCreateProjects
                ? (name, type) => {
                    const c = createProject(name, { type });
                    setProjScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
            onMenu={() => setSidebarOpen(true)}
          />
        )}
        {(mode === 'tasks' || (mode === 'projects' && projScope.kind !== 'projects')) && (
          <TasksView
            scope={mode === 'projects' ? projScope : taskScope}
            canInviteGuests={isAdmin || perms.inviteGuests}
            quotes={wsQuotes}
            onQuote={{ save: saveQuote, remove: (id) => setQuotes((qs) => qs.filter((x) => x.id !== id)), send: sendQuote, brief: briefFromQuote }}
            tasks={wsTasks}
            clients={wsClientsAll}
            teams={wsTeams}
            onScope={(sc) => (mode === 'projects' && (sc.kind === 'client' || sc.kind === 'past' || sc.kind === 'projects') ? setProjScope(sc) : openTasks(sc))}
            logins={vaultItems.map((v) => ({ id: v.id, title: v.meta.title, url: v.meta.url, username: v.meta.username, clientId: v.meta.clientId, hasTotp: v.hasTotp }))}
            onOpenLogins={(clientId) => (setVaultFilter(clientId), go('vault'))}
            onNewLogin={(clientId) => (setVaultFilter(clientId), setVaultEditing('new'), go('vault'))}
            tables={enabled.has('tables') ? wsTables : undefined}
            tableRows={wsTableRows}
            onOpenTable={enabled.has('tables') ? (id) => openTable(id) : undefined}
            onNewTable={(clientId) => setNewTableFor({ clientId })}
            onOpenTask={setTaskOpen}
            myTeamIds={myTeamIds}
            myClientIds={myClientIds}
            files={drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id)}
            workspace={ws}
            canManage={isAdmin}
            onViewAs={(clientId, email) => (tried('guest'), setViewAs({ clientId, email }))}
            onPatchClient={patchClient}
            onInviteClientPerson={inviteClientPerson}
            onApproveClientPerson={approveClientPerson}
            onEndClient={setEnding}
            notes={wsNotes}
            onOpenNote={openNote}
            onNewNote={(clientId) => newNote('', clientId)}
            onReactivateClient={reactivateClient}
            messages={messages}
            clientTab={clientTab}
            onWriteOverview={writeOverview}
            onShareMeeting={(id, shared) => setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, sharedWithClient: shared } : m)))}
            onShareFile={(id, shared) => patchDrive(id, { sharedWithClient: shared })}
            users={members}
            me={user.id}
            threads={wsThreads}
            channels={wsChannels}
            meetings={wsMeetings}
            onAdd={(t) => createTask({ ...t, source: 'manual' }, { chat: true }).id}
            onOpenProject={enabled.has('projects') ? (id, tab) => openClient(id, tab) : undefined}
            app={mode === 'projects' ? 'projects' : 'tasks'}
            browse={mobile && mode === 'tasks' && taskBrowse}
            onBrowse={setTaskBrowse}
            settings={mode === 'tasks' ? settingsRows : undefined}
            onNewProject={enabled.has('projects') && canCreateProjects ? newProjectFlow : undefined}
            onPastProjects={enabled.has('projects') ? () => (setProjScope({ kind: 'past' }), go('projects')) : undefined}
            onStatus={setTaskStatus}
            onPatch={patchTask}
            onDelete={deleteTodo}
            onToCalendar={todoToCalendar}
            onOpenThread={openThread}
            onOpenChannel={openChannel}
            onOpenMeeting={openMeeting}
            onBrainDump={() => openDump('')}
            addKey={taskAdd}
            dumpInSidebar={mode === 'tasks'}
            onTemplate={() => setTplOpen({ clientId: taskScope.kind === 'client' ? taskScope.id : undefined })}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'chat' && !mobile && chatPage && (
          <ChatPages
            page={chatPage}
            phone={false}
            channels={wsChannels}
            messages={wsMessages}
            users={members}
            me={user.id}
            myFirst={myFirst}
            onClose={() => setChatPage(null)}
            onOpen={(id, msg) => (setChatId(id), setChatPage(null), msg && setFocusMsg(msg))}
            onSendTo={(id, text) => sendChatTo(id, { text })}
            onSendNow={sendChatNow}
            onFollow={followThread}
            onReschedule={(id, at) => setMessages((ms) => ms.map((m) => (m.id === id && m.sendAt ? { ...m, sendAt: at } : m)))}
            onDelete={(id) => setMessages((ms) => ms.filter((m) => m.id !== id))}
          />
        )}
        {mode === 'chat' && mobile && chatPage && (
          <ChatPages
            page={chatPage}
            phone
            channels={wsChannels}
            messages={wsMessages}
            users={members}
            me={user.id}
            myFirst={myFirst}
            onClose={() => setChatPage(null)}
            onOpen={(id, msg) => (setChatId(id), msg && setFocusMsg(msg))}
            onSendTo={(id, text) => sendChatTo(id, { text })}
            onReplyTo={(id, rootId, text) => sendChatTo(id, { text, parentId: rootId })}
            onSendNow={sendChatNow}
            onFollow={followThread}
            onReschedule={(id, at) => setMessages((ms) => ms.map((m) => (m.id === id && m.sendAt ? { ...m, sendAt: at } : m)))}
            onDelete={(id) => setMessages((ms) => ms.filter((m) => m.id !== id))}
          />
        )}
        {mode === 'chat' && (mobile ? !!chatId : !chatPage) && (
          <ChatView
            channels={wsChannels}
            library={{ tasks: wsTasks, notes: wsNotes, tables: wsTables, rows: wsTableRows, drive: wsDrive, newTask: (title) => createTask({ title, userId: user.id, clientId: channels.find((c) => c.id === chatId)?.clientId, channelId: chatId ?? undefined, source: 'chat' }, { chat: false }).id }}
            onEdit={editMessage}
            onForward={forwardMessage}
            onOpenRef={openChatRef}
            onOpenScheduled={() => setChatPage('drafts')}
            onLeave={() => chatId && leaveChannel(chatId)}
            onNewGroup={(to) => setChatId(dmFor(to))}
            onConvert={canStartChannels ? (name, add) => chatId && convertToChannel(chatId, name, add) : undefined}
            onLeaveGroup={() => {
              if (!chatId) return;
              setChannels((cs) => cs.map((c) => (c.id === chatId ? { ...c, members: c.members.filter((m) => m !== user.id) } : c)));
              setChatId(null);
              showToast({ text: t('You left the group message') });
            }}
            huddle={
              server.on && chatId
                ? {
                    joined: huddleId === chatId,
                    onOpen: () => window.dispatchEvent(new CustomEvent('s2g:huddle-open')),
                    onJoin: () => {
                      tried('voice');
                      if (huddleId && huddleId !== chatId) leaveHuddle();
                      setChannels((cs) => cs.map((c) => (c.id === chatId ? { ...c, huddle: { by: c.huddle?.by ?? user.id, at: c.huddle?.at ?? nowIso(), members: [...new Set([...(c.huddle?.members ?? []), user.id])] } } : c)));
                      setHuddleId(chatId);
                    },
                  }
                : undefined
            }
            focusId={focusMsg}
            onFocused={() => setFocusMsg(null)}
            timeZone={ws.timeZone}
            channel={wsChannels.find((c) => c.id === chatId) ?? null}
            messages={messages.filter((m) => m.channelId === chatId)}
            users={members}
            me={user.id}
            myRole={myRole}
            clients={wsClients}
            teams={wsTeams}
            tasks={wsTasks}
            mail={wsThreads}
            drive={(() => {
              const ch = channels.find((c) => c.id === chatId);
              const cl = wsClients.find((c) => c.id === ch?.clientId);
              const word = cl?.name.split(' ')[0].toLowerCase();
              return cl ? drive.filter((d) => !d.trashed && d.kind !== 'folder' && !d.channelId && (d.workspaceId ?? 'pnp') === ws.id && (d.clientId === cl.id || (!!word && d.name.toLowerCase().includes(word)))) : [];
            })()}
            statuses={statuses}
            presence={presence}
            gifs={ws.chat?.gifs !== false}
            meetUrl={ws.meetUrl}
            onSend={sendChat}
            onDelete={deleteMessage}
            onPin={(id) => {
              const m = messages.find((x) => x.id === id);
              setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));
              showToast({ text: m?.pinned ? 'Unpinned' : 'Pinned to the channel' });
            }}
            onToggleTask={toggleTodo}
            onChannel={(patch) => chatId && setChannels((cs) => cs.map((c) => (c.id === chatId ? { ...c, ...patch } : c)))}
            summaryCost={summaryCost}
            summaryOff={
              server.on && !aiOn
                ? {
                    text: aiWhy === 'off' ? t('AI is switched off for you here.') : aiWhy === 'used-up' && ws.plan?.unlimited ? t('this month’s AI is used up.') : aiWhy === 'used-up' ? t('the company’s AI allowance for this month is used up.') : aiWhy === 'down' ? t('AI isn’t available right now. They start again by themselves when it’s back.') : t('AI isn’t set up for this company yet.'),
                    fix: isAdmin && aiWhy !== 'down' && aiWhy !== 'off' && !(aiWhy === 'used-up' && ws.plan?.unlimited) ? { label: aiWhy === 'used-up' ? t('Add a top-up') : t('Set up AI'), run: () => (setSettingsSection(aiWhy === 'used-up' ? 'billing' : 'ai'), go('settings')) } : undefined,
                  }
                : undefined
            }
            since={sinceRead}
            onReact={reactTo}
            onFollow={followThread}
            onVote={votePoll}
            onMakeTask={makeTaskFromMessage}
            onCreateTask={(t) => {
              const ch = channels.find((c) => c.id === chatId);
              const task = createTask({ ...t, clientId: ch?.clientId, teamId: ch?.teamId, channelId: chatId ?? undefined, source: 'chat' }, { chat: false });
              if (chatId) setMessages((ms) => [...ms, { id: uid(), channelId: chatId, userId: user.id, ...(t.userId !== user.id ? msg('📌 New task for @{name}', { name: firstOf(t.userId) }) : msg('📌 New task')), at: nowIso(), taskId: task.id }]);
            }}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenMail={openThread}
            onSettings={() => chatId && setChanDialog({ id: chatId })}
            onMenu={() => setSidebarOpen(true)}
            onBack={mobile ? () => setChatId(null) : undefined}
          />
        )}

        {mode === 'meet' && (
          renderMeet({ part: meetPart })
        )}

        {mode === 'mail' && myAccounts.length === 0 && (
          <AppSetupCard
            icon={Mail}
            title={t('Your email isn’t here yet')}
            body={
              isAdmin
                ? t('Connect a mailbox to read and send email here, next to your tasks and chat. You can keep Gmail or Outlook and forward a copy, or move your email over.')
                : t('An admin connects mailboxes for the team. Ask them to add yours, or make a temporary address for a quick sign-up in the meantime.')
            }
            actions={
              <>
                {isAdmin ? (
                  <button className="primary-btn" onClick={() => setNewAcct(true)}>
                    <Mail size={15} /> {t('Connect a mailbox')}
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={() => {
                      const admins = ws.members.filter((m) => m.role !== 'member' && m.userId !== user.id).map((m) => m.userId);
                      admins.forEach((a) => notify(a, 'mail', msg('{name} asked for a mailbox in {company}', { name: myFirst, company: ws.name }), { app: 'settings', id: 'workspace' }));
                      showToast({ text: admins.length ? t('Asked {names}', { names: fmtList(admins.map(firstOf)) }) : t('There’s no other admin to ask yet') });
                    }}
                  >
                    {t('Ask for a mailbox')}
                  </button>
                )}
                <button className="ghost-btn outline" onClick={() => setTempDialog({})}>
                  <Timer size={15} /> {t('Make a temporary address')}
                </button>
              </>
            }
            onHide={() => setMyHidden([...myHidden, 'mail'])}
          />
        )}
        {mode === 'mail' && myAccounts.length > 0 && !mailIn && !mailOut && (
          <section className="settings-pane view-enter mail-setup">
            <header className="settings-head">
              <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label={t('Open menu')}>
                <Menu size={18} />
              </button>
              <h1>{t('Mail')}</h1>
            </header>
            <div className="mail-setup-body">
              <div className="mail-setup-lead">
                <strong>{t('Email isn’t working here yet')}</strong>
                <span>{isAdmin ? t('Mail opens as soon as your domain’s records are in place. Pick how it should work, add the records, then check.') : t('An admin is setting up email for the company. Mail opens here as soon as it works.')}</span>
                {(mailWhy.receive || mailWhy.send) && <small>{t(mailWhy.receive ?? mailWhy.send ?? '')}</small>}
              </div>
              {isAdmin && (
                <EmailDeliverySection ws={ws} canManage firstName={myFirst} onWorkspace={(p) => patchWorkspace(ws.id, p)} onAddAccount={() => setNewAcct(true)} onRemoveAccount={setRemoveAcct} toast={(text) => showToast({ text })} />
              )}
            </div>
          </section>
        )}
        {/* Mail, Contacts (src/components/mail/Contacts.tsx): in place of the list and the reader. */}
        {mode === 'mail' && view.kind === 'contacts' && (
          <ContactsView ws={ws} users={members} me={user.id} onMenu={() => setSidebarOpen(true)} toast={(text) => showToast({ text })} onCompose={(p) => openCompose({ initial: { to: [p], cc: [], subject: '', html: settings.signature, text: '', files: [], track: settings.trackByDefault, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: (sendable.find((a) => a.kind === 'personal') ?? sendable[0] ?? myAccounts[0])?.id ?? '' } })} />
        )}
        {/* Every attachment in one place (src/components/mail/FilesView.tsx). */}
        {mode === 'mail' && view.kind === 'files' && <FilesView threads={scoped} onOpenThread={openThread} onMenu={() => setSidebarOpen(true)} />}
        {mode === 'mail' && myAccounts.length > 0 && (mailIn || mailOut) && view.kind !== 'tracking' && view.kind !== 'files' && view.kind !== 'contacts' && (
          <div className="mail-view view-enter">
            <MessageList
              notice={
                !mailIn || !mailOut ? (
                  <div className="mail-gate">
                    <AlertTriangle size={14} />
                    <span>{!mailIn ? (mailWhy.receive ? t('Incoming mail isn’t connected yet. {why}', { why: t(mailWhy.receive) }) : t('Incoming mail isn’t connected yet.')) : t('Compose and Reply are off here. {why}', { why: t(mailWhy.send ?? 'Sending isn’t set up yet.') })}</span>
                    {isAdmin && (
                      <button type="button" className="link-btn small" onClick={() => (setSettingsSection('email'), go('settings'))}>
                        {t('Fix it')}
                      </button>
                    )}
                  </div>
                ) : undefined
              }
              top={
                // Inbox tabs, multiple inboxes and Spam's 30 days (components/mail/Sorting.tsx); none during a search.
                parsedQuery ? (mobile ? <QueryBar query={query} onClear={() => setQuery('')} /> : undefined) : (
                  <>
                    {!mobile && (view.kind === 'category' || (view.kind === 'folder' && view.id === 'inbox')) && (
                      <InboxTabs inbox={inboxAll} current={view.kind === 'category' ? view.id : 'primary'} onPick={(c) => selectView(c === 'primary' ? { kind: 'folder', id: 'inbox' } : { kind: 'category', id: c })} />
                    )}
                    {mobile && view.kind === 'folder' && view.id === 'inbox' && <TabRows inbox={inboxAll} onPick={(c) => selectView({ kind: 'category', id: c })} />}
                    {!mobile && view.kind === 'folder' && view.id === 'inbox' && <InboxSections match={sectionMatch} me={ME} onOpen={open} onQuery={setQuery} />}
                    {view.kind === 'folder' && (view.id === 'spam' || view.id === 'trash') && <KeepNotice where={view.id} ids={visible.map((r) => rowOf(r.id).thread)} />}
                  </>
                )
              }
              ref={searchRef}
              title={title}
              threads={visible}
              clientOf={clientForThread}
              labels={organize.chipLabels}
              moreActions={organize.listActions}
              onFilterSearch={organize.filterFromSearch}
              personOf={(id) => allUsers.find((u) => u.id === id)}
              meId={user.id}
              me={ME}
              teamMail={teamMail}
              sharedMail={(t) => accountOf(t.accountId)?.kind === 'shared'}
              assignChip={myAccounts.some((a) => a.kind === 'shared') && !(view.kind === 'folder' && view.id === 'assigned')}
              selectedId={selectedRow}
              query={query}
              filter={filter}
              showSnippets={settings.showSnippets}
              width={Math.min(Math.max(listW, 300), 560)}
              onWidth={setListW}
              onRefresh={refreshMail}
              onCompose={mailOut ? () => openCompose() : undefined}
              onDrafts={() => (setActiveAccount('all'), selectView({ kind: 'folder', id: 'drafts' }))}
              updatedAt={mailLive.at}
              offline={real && (mailLive.offline ? 'device' : mailLive.down)}
              onQuery={setQuery}
              onFilter={setFilter}
              onOpen={open}
              actions={mailActions}
              stays={staysInList}
              onMenu={() => setSidebarOpen(true)}
              onAccounts={() => setMailAccounts(true)}
              elsewhere={workspaces.some((w) => w.id !== ws.id && (wsUnread[w.id] ?? 0) > 0)}
              searchable={scoped.filter((th) => th.location !== 'spam' && th.location !== 'trash')}
              onAllApps={() => openSearch(null)}
              empty={(() => {
                if (view.kind === 'todos') return { title: t('Nothing to do from email'), sub: t('Emails that ask you to do something show here until their to-dos are done.') };
                if (view.kind === 'project') return { title: t('No email with {name} yet', { name: title }), sub: t('Email to and from {name}’s address shows here.', { name: title }) };
                const tmp = myAccounts.find((a) => a.id === activeAccount && a.temp);
                return tmp
                  ? {
                      title: t('Nothing here yet'),
                      sub: t('Mail sent to {email} lands here. {left}.', { email: tmp.email, left: lifeLeft(tmp) }),
                      action: (
                        <button className="ghost-btn sm outline" onClick={() => testTemp(tmp)}>
                          <Send size={14} /> {t('Send a test email')}
                        </button>
                      ),
                    }
                  : undefined;
              })()}
            />
            <MailShortcuts selectedId={selectedId} actions={mailActions} onForward={(id) => { const th = threads.find((x) => x.id === id); if (th) forward(th); }} />
            <Reader
              thread={!mailPrefs.conversation && selected && rowMsg && selected.messages.some((m) => m.id === rowMsg) ? { ...selected, messages: selected.messages.filter((m) => m.id === rowMsg) } : selected}
              restoreReply={restoreReply}
              replyOff={selectedAcct && !boxReady(selectedAcct.id).send ? t('Sending isn’t set up for this mailbox yet') : undefined}
              onReplyOff={() => selectedAcct && replyBlocked(selectedAcct)}
              open={readerOpen}
              backLabel={title}
              prevId={selIdx > 0 ? visible[selIdx - 1].id : undefined}
              nextId={selIdx >= 0 && selIdx < visible.length - 1 ? visible[selIdx + 1].id : undefined}
              onGo={open}
              meUser={user}
              teammates={selected ? members.filter((u) => ws.accounts.find((a) => a.id === selected.accountId)?.users.includes(u.id)) : []}
              team={!!selected && teamMail(selected)}
              shared={!!selected && ws.accounts.find((a) => a.id === selected.accountId)?.kind === 'shared'}
              userForEmail={userForEmail}
              presence={presence}
              aiOn={aiOn}
              onAiOff={() => aiOff(t('AI isn’t set up for this company yet, so it can’t summarize email. An admin can add an AI key in Settings, AI, or switch to the AI plan.'))}
              onAssign={(id, who) => {
                const th = threads.find((x) => x.id === id);
                const before = th?.assignee;
                if ((who || undefined) === before) return;
                patchThread(id, { assignee: who || undefined });
                if (who && who !== user.id) notify(who, 'mail', msg('{name} asked you to handle “{subject}”', { name: myFirst, subject: th?.subject ?? '' }), { app: 'mail', id });
                showToast({ text: who ? (who === user.id ? t('You handle this one now') : t('{name} handles this one now', { name: firstOf(who) })) : t('Nobody handles it now'), action: { label: t('Undo'), run: () => patchThread(id, { assignee: before }) } });
              }}
              onSnooze={(id, until, ifNoReply) => mailActions.snooze([id], until, ifNoReply)}
              onComment={(id, text) => {
                const t = threads.find((x) => x.id === id);
                patchThread(id, { notes: [...(t?.notes ?? []), { id: uid(), by: user.id, text, at: nowIso() }] });
                const box = accountOf(t?.accountId ?? '');
                members
                  .filter((u) => u.id !== user.id && box?.users.includes(u.id) && new RegExp(`@${u.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
                  .forEach((u) => notify(u.id, 'mention', msg('{name} mentioned you in a comment on “{subject}”', { name: myFirst, subject: t?.subject ?? '' }), { app: 'mail', id }));
              }}
              onForward={forward}
              client={selected ? clientForThread(selected) : undefined}
              onClient={(id) => openClient(id, 'emails')}
              me={ME}
              signature={settings.signature}
              signatureFor={(address) => signatureFor(settings, address)}
              replyAddress={(th) => replyAddress(th) ?? accountOf(th.accountId)?.email}
              defaultReply={settings.defaultReply ?? 'reply'}
              smartCompose={settings.smartCompose !== false}
              onPopOut={popOutReply}
              blockTrackers={settings.blockTrackers}
              myName={settings.name || user.name}
              todos={selected ? myTodos.filter((t) => t.threadId === selected.id) : []}
              onToggleTodo={toggleTodo}
              onMakeTask={enabled.has('tasks') ? taskFromThread : undefined}
              onOpenTodos={() => openTasks({ kind: 'mine' })}
              unsubscribedAt={selected && incomingFrom(selected) ? unsubscribed[domainOf(incomingFrom(selected)!.email)] : undefined}
              onUnsubscribe={unsubscribe}
              onBlock={setBlockTarget}
              labelChips={selected ? organize.chips(selected) : null}
              filedLine={selected ? organize.filed(selected) : null}
              organizeActions={organize.readerActions}
              inviteAdded={!!selected && events.some((e) => e.threadId === selected.id && e.start === selected.invite?.start)}
              inviteConflicts={selected?.invite ? conflictsWith(selected.invite.start, selected.invite.end) : []}
              savedToDrive={savedToDrive}
              onSaveToDrive={saveToDrive}
              onAddInvite={addInvite}
              inviteCard={(m) => selected && inviteCard(selected, m)}
              onBack={() => setReaderOpen(false)}
              onArchive={archive}
              onTrash={trash}
              onSpam={spam}
              onMoveToInbox={toInbox}
              onStar={star}
              onMarkUnread={markUnread}
              onReply={reply}
              canTrack={ws.readTracking !== false}
              trackByDefault={settings.trackByDefault}
            />
          </div>
        )}

        {mode === 'calendar' && mobile && calMeetings && (
          <>
            <TopBar app="calendar" title={<h1 className="mt-title plain"><span className="mt-title-text">{t('Meetings')}</span></h1>} />
            {renderMeet({ embedded: true })}
          </>
        )}
        {mode === 'calendar' && !(mobile && calMeetings) && (
          <CalendarView
            events={calEvents}
            calendars={allCals}
            addTo={addToCals}
            cursor={calCursor}
            view={calView}
            selected={selectedEvent}
            onCursor={setCalCursor}
            onView={setCalView}
            onSelect={setSelectedEventId}
            onCreate={(d) => openNewEvent(d)}
            onSave={saveEvent}
            onEdit={(id) => (setSelectedEventId(null), setEditEventId(id))}
            onDelete={deleteEvent}
            onDuplicate={duplicateEvent}
            onOpenThread={openThread}
            onRsvp={rsvpEvent}
            answersOf={answersOf}
            inviteNote={real ? undefined : t('Demo: invites aren’t emailed')}
            team={members}
            contacts={guestContacts}
            me={user.id}
            dueTasks={myDueTasks}
            onToggleTask={toggleTodo}
            onOpenTask={openTask}
            calendarsPanel={calendarPanel}
            dialogOpen={!!connectCal}
            company={ws}
            appSettings={settingsRows}
            canEdit={(e) => !e.calendarId.startsWith('mate-') && !e.feed && !extCals.find((c) => c.id === e.calendarId)?.readOnly && events.some((x) => x.id === (e.seriesId ?? e.id))}
            onNotetaker={botOn ? sendNotetakerTo : undefined}
            botWillJoin={autoJoin === 'live' ? (e) => !sentFor[e.id] && botWillJoin(e) : undefined}
            onBotJoin={
              autoJoin === 'live'
                ? (e, join) => {
                    const byRule = botJoins(e, meetSettings.joinMode, {}, isMine);
                    setBotJoin(e.id, join === byRule ? null : join);
                    showToast({ text: join ? t('The notetaker will join “{title}”', { title: e.title }) : t('The notetaker won’t join “{title}”', { title: e.title }), action: { label: t('Undo'), run: () => setBotJoin(e.id, e.id in joinOverrides ? joinOverrides[e.id] : null) } });
                  }
                : undefined
            }
            onMove={(id, start, end, scope) => void moveEvent(id, start, end, scope)}
            onSchedule={(taskId, start) => {
              const task = todos.find((x) => x.id === taskId);
              if (!task) return;
              const ev: CalEvent = { id: uid(), title: task.title, calendarId: 'work', start: start.toISOString(), end: new Date(start.getTime() + 60 * 60_000).toISOString(), taskId, threadId: task.threadId, workspaceId: ws.id, userId: user.id };
              setEvents((es) => [...es, ev]);
              showToast({ text: t('Blocked {time} for “{title}”. Drag the bottom edge to change how long', { time: fmtTime(start), title: task.title }), action: { label: t('Undo'), run: () => setEvents((es) => es.filter((e) => e.id !== ev.id)) } });
            }}
            taskOf={(e) => {
              const t = e.taskId ? todos.find((x) => x.id === e.taskId) : undefined;
              return t ? { title: t.title, done: t.done } : null;
            }}
            onExtend={(id, m) => {
              const e = findEvent(events, id);
              if (e?.seriesId) return void moveEvent(id, new Date(e.start), new Date(new Date(e.end).getTime() + m * 60_000));
              setEvents((es) => es.map((x) => (x.id === id ? { ...x, end: new Date(new Date(x.end).getTime() + m * 60_000).toISOString() } : x)));
            }}
            onTomorrow={(id) => {
              const e = findEvent(events, id);
              if (e?.seriesId) return void moveEvent(id, addDaysTo(e.start, 1), addDaysTo(e.end, 1));
              setEvents((es) => es.map((x) => (x.id === id ? { ...x, start: new Date(new Date(x.start).getTime() + 86_400_000).toISOString(), end: new Date(new Date(x.end).getTime() + 86_400_000).toISOString() } : x)));
            }}
            onTaskDone={(e) => e.taskId && setTaskStatus(e.taskId, stageIdFor(todos.find((x) => x.id === e.taskId) ?? { workspaceId: ws.id }, 'done'))}
            sentBot={(e) => {
              const mid = sentFor[e.id];
              return mid ? () => (setMeetPage({ kind: 'meeting', id: mid }), go('meet')) : undefined;
            }}
          />
        )}

        {mode === 'vault' && (
          <VaultView
            workspaceId={ws.id}
            items={vaultItems}
            reload={loadVault}
            filter={vaultFilter}
            onFilter={setVaultFilter}
            clients={wsClientsAll}
            users={members}
            teams={wsTeams}
            me={user.id}
            isAdmin={isAdmin}
            editing={vaultEditing}
            setEditing={setVaultEditing}
            toast={(text) => showToast({ text })}
            vaultKey={allUsers.find((u) => u.id === user.id)?.vaultKey}
            onVaultKey={(record) => onUpdateUser({ vaultKey: record })}
            adminIds={ws.members.filter((m) => m.role !== 'member').map((m) => m.userId)}
          />
        )}

        {mode === 'tables' &&
          (currentTable && !(mobile && !tableId) ? (
            <TableScreen
              key={currentTable.id}
              table={currentTable}
              tables={wsTables}
              rows={wsTableRows}
              users={members}
              clients={wsClientsAll}
              me={user.id}
              setTables={setTables}
              setRows={setTableRows}
              onOpenTable={openTable}
              openRow={tableRow}
              setOpenRow={setTableRow}
              onDeleted={() => setTableId(null)}
              onMenu={() => (mobile ? setTableId(null) : setSidebarOpen(true))}
              toast={showToast}
              channels={wsChannels}
              isAdmin={isAdmin}
              canEditTables={perms.editTables}
              canDeleteThings={perms.deleteThings}
              serverOn={real}
              inDemo={inSandbox}
              onCompose={(m) => openCompose({ initial: { to: m.to ? [{ name: m.to, email: m.to }] : [], cc: [], subject: m.subject, html: textToHtml(m.body) + settings.signature, text: m.body, files: [], track: settings.trackByDefault, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: (myAccounts.find((a) => a.kind === 'personal') ?? myAccounts[0])?.id ?? '' } })}
            />
          ) : (
            <TablesHome tables={wsTables} rows={wsTableRows} clients={wsClientsAll} onOpen={openTable} onNew={() => setNewTableFor({})} onMenu={() => setSidebarOpen(true)} />
          ))}
        {mode === 'teams' &&
          (() => {
            const team = wsTeams.find((t) => t.id === teamId);
            return team ? (
              <TeamPage
                key={team.id}
                team={team}
                teams={wsTeams}
                users={members}
                tasks={wsTasks}
                clients={wsClientsAll}
                me={user.id}
                isAdmin={isAdmin}
                actions={teamActions}
                homeTemplate={ws.teamHome?.[team.id]}
                onHomeTemplate={(v) => patchWorkspace(ws.id, { teamHome: { ...(ws.teamHome ?? {}), [team.id]: v } })}
                onOpenTask={openTask}
                onBack={() => setTeamId(null)}
                onOpen={setTeamId}
                companyName={ws.name}
                wordsKey={ws.terms?.word ?? ''}
                onMoveTasks={(moves) => {
                  const by = new Map(moves.map((m) => [m.id, m.patch]));
                  setTodos((ts) => ts.map((x) => (by.has(x.id) ? { ...x, ...by.get(x.id) } : x)));
                  if (moves.length) showToast({ text: tn(moves.length, 'Moved {n} task', 'Moved {n} tasks') });
                }}
              />
            ) : (
              <TeamsHome teams={wsTeams} users={members} tasks={wsTasks} me={user.id} canCreate={canCreateTeams} actions={teamActions} onOpen={setTeamId} onNew={() => setNewTeam(true)} onMenu={() => setSidebarOpen(true)} part={teamsPart} />
            );
          })()}
        {newTeam && (
          <NewTeamDialog
            users={members}
            me={user.id}
            count={wsTeams.length}
            onClose={() => setNewTeam(false)}
            onCreate={(tm) => {
              const id = 't-' + Date.now().toString(36);
              saveTeams([...wsTeams, { ...tm, id, workspaceId: ws.id }]);
              setTeamId(id);
              go('teams');
              showToast({ text: t('{team} created, with its own channel', { team: tm.name }) });
            }}
          />
        )}
        {newTableFor && <NewTableDialog clients={wsClients} clientId={newTableFor.clientId} onCreate={createTable} onClose={() => setNewTableFor(null)} />}

        {mode === 'notes' && (
          <>
            {mobile && <NotesList notes={wsNotesAll} api={notesApi} current={noteId} filter={notesFilter} onFilter={setNotesFilter} onOpen={(id, find) => openNote(id, find)} onNew={() => newNote()} phone />}
            {(!mobile || noteId) && (
              <NoteEditor
                note={wsNotesAll.find((n) => n.id === noteId)}
                notes={wsNotes}
                todos={wsTasks}
                api={notesApi}
                phone={mobile}
                find={noteOpenAt.find}
                fresh={noteOpenAt.fresh}
                onBack={mobile ? () => setNoteId(null) : undefined}
                onTask={(text, n) => createTask({ title: text.length > 120 ? text.slice(0, 117) + '…' : text, clientId: n.clientId, userId: user.id, source: 'manual', noteId: n.id })}
                onUndoTask={(id) => setTodos((ts) => ts.filter((t) => t.id !== id))}
                onOpenTask={(id) => setTaskOpen(id)}
                onOpenNote={(id) => openNote(id)}
                onMention={(uid, n) => uid !== user.id && notify(uid, 'mention', n.title ? msg('{name} mentioned you in the note “{title}”', { name: myFirst, title: n.title }) : msg('{name} mentioned you in an untitled note', { name: myFirst }), { app: 'notes', id: n.id })}
                onUpload={(f) => uploadFile(f, ws.id)}
              />
            )}
          </>
        )}

        {mode === 'drive' && (
          <DriveView
            items={allDrive}
            section={driveSection}
            folderId={driveFolder}
            renamingId={renamingId}
            senderOf={(id) => threads.find((t) => t.id === id)?.messages[0].from.name ?? ''}
            onFolder={(id) => {
              setDriveSection('my');
              setDriveFolder(id);
            }}
            onSection={setDriveSection}
            onOpen={(item, list) => setPreview({ item, list })}
            onStar={(id) => patchDrive(id, { starred: !drive.find((i) => i.id === id)?.starred })}
            onTrash={trashDrive}
            onRestore={(id) => patchDrive(id, { trashed: false })}
            onDeleteForever={deleteForever}
            onStartRename={setRenamingId}
            onRename={(id, name) => {
              setRenamingId(null);
              if (name && name.trim()) patchDrive(id, { name: name.trim(), modified: new Date().toISOString() });
            }}
            onPickFiles={() => fileInput.current?.click()}
            onDropFiles={upload}
            onOpenThread={openThread}
            onMenu={() => setSidebarOpen(true)}
            me={user.id}
            nameOf={(id) => allUsers.find((u) => u.id === id || u.email === id)?.name.split(' ')[0] ?? id}
            onMakeFolder={(name) => {
              const parentId = driveSection === 'my' ? driveFolder : null;
              setDrive((d) => [...d, { id: uid(), name, kind: 'folder', parentId, size: 0, modified: new Date().toISOString(), workspaceId: ws.id, uploadedBy: user.id }]);
              setDriveSection('my');
              showToast({ text: t('Folder made') });
            }}
            onMove={(id, parentId) => {
              const before = drive.find((i) => i.id === id)?.parentId ?? null;
              patchDrive(id, { parentId });
              showToast({ text: t('Moved to {folder}', { folder: parentId ? (drive.find((i) => i.id === parentId)?.name ?? '') : t('My Drive') }), action: { label: t('Undo'), run: () => patchDrive(id, { parentId: before }) } });
            }}
          />
        )}

        {(mode === 'settings' || pushed?.kind === 'section') && (
          <PushedSettings push={mode === 'settings' ? null : pushed} onBack={() => setPushed(null)}>
          <SettingsPage
            embedded={mode !== 'settings'}
            demo={
              demo && server.on
                ? { inDemo: inSandbox, allowed: demo.allowed, state: demo.state, listOff: !!sandboxWs?.sandbox?.listOff, busy: demoBusy, onOpen: () => void openDemo(), onList: showTryList, realWorkspaceId: workspaces.find((w) => !isSandbox(w))?.id }
                : undefined
            }
            email={ME.email}
            settings={settings}
            update={updateSettings}
            section={settingsSection}
            onSection={setSettingsSection}
            usage={usage}
            onMenu={() => setSidebarOpen(true)}
            workspace={ws}
            onWorkspace={(p) => patchWorkspace(ws.id, p)}
            onHolidays={(country) => {
              patchWorkspace(ws.id, { holidays: country ? { country } : undefined });
              if (!real) demoHolidays(country);
            }}
            holidayCal={extCals.find((c) => c.id === holidayCalendarId(ws.id))}
            onAddAccount={() => setNewAcct(true)}
            users={allUsers}
            me={user.id}
            onPhoto={(photo) => onUpdateUser({ photo })}
            onPreviewOnboarding={() => setPreviewOnboarding(true)}
            myApps={{ hidden: myHidden, asked: askedApps, onHidden: setMyHidden, onAsk: askForApp, onEdit: mobile ? () => setEditingApps(true) : undefined }}
            myRole={role}
            onInvite={() => openInvite()}
            onRole={(uid2, r) => patchWorkspace(ws.id, { members: ws.members.map((m) => (m.userId === uid2 ? { ...m, role: r } : m)) })}
            onRemoveMember={(uid2) => {
              patchWorkspace(ws.id, {
                members: ws.members.filter((m) => m.userId !== uid2),
                accounts: ws.accounts.map((a) => ({ ...a, users: a.users.filter((x) => x !== uid2) })),
              });
              showToast({ text: t('Removed from the workspace') });
            }}
            blocked={blocked}
            onUnblock={(id) => {
              setBlocked((b) => b.filter((x) => x.id !== id));
              showToast({ text: t('Unblocked. Their email will arrive again') });
            }}
            onAccess={(accountId, users) => {
              const before = ws.accounts.find((x) => x.id === accountId)?.users ?? [];
              patchWorkspace(ws.id, { accounts: ws.accounts.map((x) => (x.id === accountId ? { ...x, users } : x)) });
              const added = users.find((x) => !before.includes(x));
              const name = (id: string) => allUsers.find((u) => u.id === id)?.name.split(' ')[0] ?? t('They');
              showToast({ text: added ? t('{name} can now open this inbox', { name: name(added) }) : t('{name} no longer has access', { name: name(before.find((x) => !users.includes(x))!) }) });
            }}
            admin={{
              people: members.length,
              teams: wsTeams,
              projects: wsClientsAll.map((c) => ({ id: c.id, name: c.name, color: c.color })),
              drive: drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id),
              byChannel: channels
                .filter((c) => c.workspaceId === ws.id && c.kind === 'channel')
                .map((c) => ({ name: c.name, size: messages.filter((m) => m.channelId === c.id).flatMap((m) => m.files ?? []).reduce((s2, f) => s2 + f.size, 0) }))
                .filter((c) => c.size > 0)
                .sort((a, b) => b.size - a.size),
              onTeams: saveTeams,
              onOpenTeams: (id?: string) => (setTeamId(id ?? null), go('teams')),
              onTeamHome: (teamId, t) => patchWorkspace(ws.id, { teamHome: { ...(ws.teamHome ?? {}), [teamId]: t } }),
              onAI: (ai) => patchWorkspace(ws.id, { ai }),
              onPlan: (plan) => patchWorkspace(ws.id, { plan }),
              onMeetings: (m) => patchWorkspace(ws.id, { meetings: m }),
              onStorage: (st) => patchWorkspace(ws.id, { storage: st }),
              onExport: exportEverything,
              onDelete: () => {
                const rest = workspaces.filter((w) => w.id !== ws.id);
                setWorkspaces((list) => list.filter((w) => w.id !== ws.id));
                if (rest[0]) setWsId(rest[0].id);
                go('home');
                showToast({ text: t('{name} deleted', { name: ws.name }) });
              },
              toast: (text) => showToast({ text }),
              tasks: allWsTasks,
              onMoveTasks: (moves) => {
                const by = new Map(moves.map((m) => [m.id, m.patch]));
                setTodos((ts) => ts.map((t) => (by.has(t.id) ? { ...t, ...by.get(t.id) } : t)));
                if (moves.length) showToast({ text: tn(moves.length, 'Moved {n} task', 'Moved {n} tasks') });
              },
            }}
            onRemoveAccount={(id) => setRemoveAcct(ws.accounts.find((a) => a.id === id) ?? null)}
            mailTeams={{
              // Settings, Mail storage: delete for good (the server keeps what's on legal hold and says so).
              onDelete: (ids) => setThreads((ts) => ts.filter((x) => !ids.includes(x.id))),
              onEmpty: (where) => setThreads((ts) => ts.filter((x) => !(x.location === where && ws.accounts.some((a) => a.id === x.accountId && a.users.includes(user.id))))),
              onOpen: (id) => openThread(id),
            }}
            mailExtras={
              <>
              {/* Inbox tabs, order, multiple inboxes, conversation view, auto-advance (phones: Mail settings, Inbox). */}
              {!mobile && <InboxSettings />}
              <OutOfOffice
                accounts={myAccounts.filter((a) => !a.temp && a.users.includes(user.id))}
                canSend={(id) => (boxReady(id).send ? null : (boxReady(id).sendWhy ?? boxReady(id).why ?? 'Sending isn’t set up for this mailbox yet.'))}
                onSave={async (a, away) => {
                  if (!real) {
                    patchWorkspace(ws.id, { accounts: ws.accounts.map((x) => (x.id === a.id ? { ...x, away: { ...away, since: away.on ? nowIso() : undefined } } : x)) });
                    return null;
                  }
                  const r = await fetch('/api/mail/away', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, accountId: a.id, away }) }).catch(() => null);
                  const why = r?.ok ? null : ((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error;
                  return r?.ok ? null : why ? t(why) : t('No connection. Try again.');
                }}
              />
              {organize.settings}
              </>
            }
          />
          </PushedSettings>
        )}
      </main>

      {/* Phones (src/mobile/, research/launcher/plan.md): the app's own bar of sections and its create button, and the
          launcher over the app when it's open. */}
      {showAppBar && <AppBar bar={chrome.sections!} label={APPS.find((a) => a.id === mode)?.name ?? ''} />}
      {mobile && <CreateFab create={mode === 'settings' || launcher ? null : chrome.create} off={newOpen} />}
      {mobile && (
        <Launcher
          open={launcher}
          ws={ws}
          me={ME}
          firstName={myFirst}
          needs={needsNow}
          needActions={needActions}
          next={myNear.filter((e) => !e.allDay && new Date(e.start) > new Date() && new Date(e.start).toDateString() === new Date().toDateString()).sort((x, y) => x.start.localeCompare(y.start))[0]}
          recents={recents}
          apps={launcherTiles}
          unreadNotices={myNotices.filter((n) => !n.read).length}
          ai={aiOn}
          onCompany={openCompanySheet}
          onSearch={() => openSearch(null)}
          onAsk={toggleAsk}
          onBell={() => setNoticesOpen(true)}
          onAccount={() => (setSettingsSection('account'), go('settings'))}
          onSeeAll={() => (setLeftWith(Object.fromEntries(myApps.shown.map((x) => [x, badgeOf(x)]))), go('home'))}
          onApp={fromLauncher}
          onHide={(id) => setOwnApps({ order: appsOrder.order, hidden: [...appsOrder.hidden, id] })}
          onEdit={() => setEditingApps(true)}
          onNew={() => setNewOpen(true)}
        />
      )}
      {editingApps && (
        <EditApps
          apps={allTiles}
          value={appsOrder}
          own={!!ownApps}
          onChange={setOwnApps}
          onReset={() => setOwnApps(null)}
          onDone={() => setEditingApps(false)}
        />
      )}
      {noticesOpen && mobile && (
        <NoticesScreen
          notices={myNotices}
          users={allUsers}
          needs={needsNow.flatMap((x) => x.noticeIds)}
          onOpen={(n) => (setNoticesOpen(false), openNotice(n))}
          onRead={(ids, read) => setNotices((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read } : n)))}
          onReadAll={() => setNotices((ns) => ns.map((n) => (n.userId === user.id && n.workspaceId === ws.id ? { ...n, read: true } : n)))}
          onBack={() => setNoticesOpen(false)}
        />
      )}
      {statusOpen && (
        <Sheet onClose={() => setStatusOpen(false)} title={t('Your status')}>
          <StatusPicker
            status={statuses[user.id]}
            onStatus={(st) => (
              setStatuses((all) => {
                const next = { ...all };
                if (st) next[user.id] = st;
                else delete next[user.id];
                return next;
              }),
              setStatusOpen(false)
            )}
          />
        </Sheet>
      )}
      {newOpen && (
        <Sheet onClose={() => setNewOpen(false)} title={t('New')} className="new-sheet">
          <div className="as-list">
            {[...(aiOn && enabled.has('tasks') ? [{ id: 'dump', label: t('Brain dump'), hint: t('Type what’s on your mind; AI turns it into tasks'), icon: Sparkles, run: () => openDump('') }] : []), ...makeLinks].map((m) => (
              <button key={m.id} type="button" className="as-item" onClick={() => (setNewOpen(false), m.run())}>
                <m.icon size={20} className="as-icon" />
                <span className="as-label">
                  {m.label}
                  {'hint' in m && m.hint && <small>{m.hint}</small>}
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {newMessage && <NewMessageSheet users={members} me={user.id} guests={dmGuests} onPick={(to) => openChannel(dmFor(to))} onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined} onClose={() => setNewMessage(false)} />}
      {ownSettings && (
        <PushScreen title={ownSettings.label} onBack={() => setPushed(null)}>
          {ownSettings.render()}
        </PushScreen>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      {compose && (
        <Compose
          key={compose.key}
          contacts={contacts}
          signature={settings.signature}
          signatureFor={(address) => signatureFor(settings, address)}
          workspace={ws}
          smartCompose={settings.smartCompose !== false}
          aiOn={aiOn}
          myName={settings.name || user.name}
          replying={!!compose.replyThreadId}
          trackByDefault={settings.trackByDefault}
          canTrack={ws.readTracking !== false}
          accounts={sendable.length ? sendable : myAccounts}
          defaultFrom={activeAccount !== 'all' && sendable.some((a) => a.id === activeAccount) ? activeAccount : (sendable[0] ?? myAccounts[0])?.id}
          initial={compose.initial}
          userId={user.id}
          parked={!!compose.parked}
          onPark={(parked) => setCompose((c) => (c ? { ...c, parked } : c))}
          snapshot={composeNow}
          onSend={send}
          onClose={closeCompose}
        />
      )}
      {previewOnboarding && <Onboarding preview me={user} existingEmails={[]} onCreate={() => {}} onClose={() => (setPreviewOnboarding(false), new URLSearchParams(location.search).has('preview') && history.replaceState(null, '', location.pathname))} />}
      {tempDialog && (
        <TempAddressDialog
          ws={ws}
          me={user.id}
          people={members}
          editing={tempDialog.editing}
          onClose={() => setTempDialog(null)}
          onSave={(a) => {
            const editing = !!tempDialog.editing;
            withAccounts(ws.id, (l) => (editing ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]));
            setTempDialog(null);
            if (editing) return showToast({ text: t('Saved') });
            setActiveAccount(a.id);
            setView({ kind: 'folder', id: 'inbox' });
            go('mail');
            showToast({ text: t('{email} is ready', { email: a.email }), action: { label: t('Copy'), run: () => void navigator.clipboard?.writeText(a.email) } });
          }}
        />
      )}
      {tempMenu && (
        <Popover anchor={tempAnchor} open onClose={() => setTempMenu(null)} width={250} title={tempMenu.email}>
          <div className="sel-pop temp-pop">
            <button className="am-item" onClick={() => (void navigator.clipboard?.writeText(tempMenu.email), setTempMenu(null), showToast({ text: t('Address copied') }))}>
              <Copy size={15} /> {t('Copy address')}
            </button>
            <button className="am-item" onClick={() => (setTempDialog({ editing: tempMenu }), setTempMenu(null))}>
              <Timer size={15} /> {t('Who can see it, how long')}
            </button>
            <button className="am-item" onClick={() => (testTemp(tempMenu), setTempMenu(null))}>
              <Send size={15} /> {t('Send a test email')}
            </button>
            <div className="am-sep" />
            <button className="am-item danger" onClick={() => (deleteTemp(tempMenu), setTempMenu(null))}>
              <Trash2 size={15} /> {t('Delete now')}
            </button>
          </div>
        </Popover>
      )}
      {resettingDemo && inSandbox && <ResetDemoDialog onReset={resetDemo} onClose={() => setResettingDemo(false)} />}
      {newWs && (
        <Onboarding
          me={user}
          existingEmails={allUsers.map((u) => u.email.toLowerCase())}
          onClose={() => setNewWs(false)}
          onCreate={(w, newUsers) => {
            newUsers.forEach(onInvite);
            setWorkspaces((list) => [...list, w]);
            // Starter tables for what the company does, so Tables isn't empty on day one (named in the maker's language).
            const starters: Record<string, { name: string; template: TemplateId }[]> = {
              agency: [{ name: t('Leads'), template: 'leads' }, { name: t('Content pipeline'), template: 'pipeline' }],
              ecommerce: [{ name: t('Customers'), template: 'leads' }, { name: t('Product launches'), template: 'pipeline' }],
              consulting: [{ name: t('Prospects'), template: 'leads' }, { name: t('Engagements'), template: 'tracker' }],
              software: [{ name: t('Roadmap'), template: 'pipeline' }, { name: t('Bugs'), template: 'tracker' }],
              events: [{ name: t('Sponsors'), template: 'leads' }, { name: t('Vendors'), template: 'tracker' }],
            };
            const made = (starters[w.industry ?? ''] ?? []).map((d) => makeTable(d, w.id, user.id));
            if (made.length) setTables((ts) => [...ts, ...made]);
            // Every company starts with a #general channel for the whole team.
            setChannels((cs) => [...cs, { id: uid(), workspaceId: w.id, kind: 'channel', name: 'general', members: w.members.map((m) => m.userId), topic: 'Everyone at ' + w.name }]);
            setNewWs(false);
            setWsId(w.id);
            setActiveAccount('all');
            setSelectedId(null);
            setView({ kind: 'folder', id: 'inbox' });
            go('home');
            showToast({ text: newUsers.length ? tn(newUsers.length, '{name} is ready, {n} invite sent', '{name} is ready, {n} invites sent', { name: w.name }) : t('{name} is ready', { name: w.name }) });
          }}
        />
      )}
      {newAcct && (
        <NewAccount
          workspace={ws}
          userId={user.id}
          onClose={() => setNewAcct(false)}
          onAdd={(a) => {
            patchWorkspace(ws.id, { accounts: [...ws.accounts, a] });
            setNewAcct(false);
            showToast({ text: t('{email} added', { email: a.email }) });
          }}
        />
      )}
      {inviting && (
        <InviteMember
          workspace={ws}
          users={allUsers}
          onClose={() => setInviting(false)}
          onInvite={(u, r, box, shared) => {
            onInvite(u);
            patchWorkspace(ws.id, {
              members: [...ws.members, { userId: u.id, role: r }],
              accounts: [...ws.accounts.map((a) => (shared.includes(a.id) ? { ...a, users: [...a.users, u.id] } : a)), ...(box ? [box] : [])],
            });
            setInviting(false);
            showToast({ text: t('Invited {name}. They can sign in as {email}', { name: u.name, email: u.email }) });
          }}
        />
      )}
      {newEventAt && <EventEditor start={newEventAt} calendars={addToCals} team={members} contacts={guestContacts} me={user.id} onSave={saveEvent} onClose={() => setNewEventAt(null)} />}
      {editingEvent && (
        <EventEditor
          key={editingEvent.id}
          start={new Date(editingEvent.start)}
          event={editingEvent}
          calendars={addToCals}
          team={members}
          contacts={guestContacts}
          me={user.id}
          onSave={(e, _kind, at) => void updateEvent(editingEvent.id, e, at)}
          onClose={() => setEditEventId(null)}
        />
      )}
      <ScopeHost />
      {quickNote && (
        <QuickNote
          shared={quickNote.shared}
          clients={wsClientsAll}
          onClose={() => setQuickNote(null)}
          onSave={(q) => {
            const n: Note = { id: uid(), workspaceId: ws.id, title: q.title, html: q.html, ownerId: user.id, visibility: q.clientId ? 'team' : 'private', clientId: q.clientId, createdAt: nowIso(), updatedAt: nowIso(), updatedBy: user.id };
            setNotes((ns) => [n, ...ns]);
            setQuickNote(null);
            showToast({ text: q.clientId ? t('Note saved in {project}', { project: wsClientsAll.find((c) => c.id === q.clientId)?.name ?? '' }) : t('Note saved'), action: { label: t('Open'), run: () => openNote(n.id) } });
          }}
        />
      )}
      {scheduling && <ScheduleTask title={scheduling.title} events={myNear} onPick={(start, mins) => blockTask(scheduling, start, mins)} onClose={() => setScheduling(null)} />}
      {connectCal && (
        <ConnectCalendar
          me={{ id: user.id, email: user.email }}
          existing={myExtCals}
          workspace={ws}
          isAdmin={isAdmin}
          live={real}
          demo={demoOk}
          google={caps.googleCalendar}
          microsoft={caps.microsoftCalendar}
          start={connectCal === 'holidays' ? 'holidays' : undefined}
          holidayRegions={holidays.regions}
          onHolidayRegions={setHolidayRegions}
          onClose={() => setConnectCal(false)}
          onConnect={(cals) => {
            setExtCals((cs) => [...cs, ...cals]);
            setEvents((es) => [...es, ...cals.flatMap(externalEvents)]);
            setConnectCal(false);
            showToast({ text: cals.length > 1 ? t('{n} calendars connected', { n: cals.length }) : t('{name} connected', { name: cals[0].name }) });
          }}
          onLinked={(cal, upcoming) => {
            setConnectCal(false);
            setHiddenCals((h) => (h.has(cal.id) ? new Set([...h].filter((x) => x !== cal.id)) : h));
            showToast({ text: upcoming ? t('{name} added. It updates every 30 minutes.', { name: cal.name }) : t('{name} added, but it has nothing in the coming year. Check it’s the right calendar.', { name: cal.name }), ms: upcoming ? undefined : 9000 });
          }}
          onHolidays={(country) => {
            const before = ws.holidays;
            patchWorkspace(ws.id, { holidays: country ? { country } : undefined });
            if (!real) demoHolidays(country);
            setConnectCal(false);
            showToast({ text: country ? t('Holidays in {country} now show for everyone at {company}', { country: t(holidayCountry(country)?.name ?? country), company: ws.name }) : t('Public holidays removed for everyone'), action: { label: t('Undo'), run: () => (patchWorkspace(ws.id, { holidays: before }), !real && demoHolidays(before?.country ?? null)) } });
          }}
        />
      )}
      {preview && (
        <DrivePreview
          item={allDrive.find((i) => i.id === preview.item.id) ?? preview.item}
          list={preview.list}
          onNav={(item) => setPreview((p) => p && { ...p, item })}
          onClose={() => setPreview(null)}
          onStar={(id) => patchDrive(id, { starred: !drive.find((i) => i.id === id)?.starred })}
          onTrash={trashDrive}
          onOpenThread={openThread}
        />
      )}

      {taskOpen && wsTasks.some((t) => t.id === taskOpen) && (
        <TaskDrawer
          task={wsTasks.find((t) => t.id === taskOpen)!}
          tasks={wsTasks}
          clients={wsClientsAll}
          teams={wsTeams}
          users={members}
          me={user.id}
          onClose={() => setTaskOpen(null)}
          onOpen={setTaskOpen}
          onPatch={patchTask}
          onStatus={setTaskStatus}
          onDelete={deleteTodo}
          onToCalendar={todoToCalendar}
          onAddSubtask={(briefId, t) => {
            const br = wsTasks.find((x) => x.id === briefId);
            createTask({ ...t, briefId, clientId: br?.clientId, source: 'manual' }, { chat: true });
          }}
          onOpenThread={(id) => (setTaskOpen(null), openThread(id))}
          onAskApproval={askApproval}
          onComment={commentTask}
          clientNames={(() => {
            const c = wsClients.find((x) => x.id === wsTasks.find((t) => t.id === taskOpen)?.clientId);
            return c ? Object.fromEntries(clientPeople(c, channels).map((x) => [x.email.toLowerCase(), x.name])) : {};
          })()}
          onSendBack={sendBack}
          onSaveTemplate={saveTemplate}
          onDuplicate={(task) => {
            const copy = createTask({ ...duplicateOf(task), source: 'manual' });
            showToast({ text: t('Duplicated “{title}”', { title: task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title }), action: { label: t('Open'), run: () => setTaskOpen(copy.id) } });
          }}
          onOpenChannel={(clientId) => {
            const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId && c.category !== 'shared') ?? channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId);
            if (ch) (setTaskOpen(null), openChannel(ch.id));
            else showToast({ text: t('This {project} has no channel yet', { project: term.one }) });
          }}
        />
      )}
      {sendBotOpen && (
        <SendBotDialog
          clients={wsClients}
          botName={meetSettings.botName}
          languages={meetSettings.languages}
          real={recorderOn && real}
          workspaceId={ws.id}
          isOwner={ws.members.some((m) => m.userId === user.id && m.role === 'owner')}
          seed={sendBotSeed ?? undefined}
          upcoming={myNear}
          demo={demoOk}
          onSendEvent={(e) => (setSendBotOpen(false), sendNotetakerTo(e))}
          onSend={(d) => sendBot({ ...d, ...(sendBotSeed ? { fromEvent: sendBotSeed.fromEvent, attendees: sendBotSeed.attendees } : {}) })}
          onClose={() => setSendBotOpen(false)}
        />
      )}
      {removeAcct && (
        <RemoveMailbox
          account={removeAcct}
          workspace={ws}
          conversations={removeAcct.users.includes(user.id) ? threads.filter((t) => t.accountId === removeAcct.id).length : null}
          onRemove={(moveTo) => removeMailbox(removeAcct, moveTo)}
          onClose={() => setRemoveAcct(null)}
        />
      )}
      {shareFor && meetings.some((m) => m.id === shareFor) && (
        <ShareDialog
          m={meetings.find((m) => m.id === shareFor)!}
          toast={(text) => showToast({ text })}
          onClose={() => setShareFor(null)}
          onPreview={() => setSharedPreview(shareFor)}
          onOff={() => (patchMeeting(shareFor, { share: undefined }), showToast({ text: t('Link turned off') }))}
          onSave={(opts) => {
            const m = meetings.find((x) => x.id === shareFor)!;
            patchMeeting(shareFor, { share: { token: m.share?.token ?? Math.random().toString(36).slice(2, 10), ...opts } });
            showToast({ text: t('Link ready') });
          }}
        />
      )}
      {sharedPreview && meetings.some((m) => m.id === sharedPreview) && (
        <SharedPage m={meetings.find((m) => m.id === sharedPreview)!} brand={ws.name} tasks={wsTasks.filter((t) => t.meetingId === sharedPreview)} users={members} onClose={() => setSharedPreview(null)} />
      )}
      <ChatPrefsHost me={user.id} />
      {huddleChannel?.huddle?.members.includes(user.id) && <Huddle key={huddleChannel.id} channel={huddleChannel} users={allUsers} me={user.id} onLeave={leaveHuddle} onOpenChannel={() => openChannel(huddleChannel.id)} />}
      {askScope && (
        <Assistant
          scope={askScope}
          setScope={setAskScope}
          scopeOptions={askOptions}
          chats={askChats}
          setChats={setAskChats}
          ask={askAnything}
          seed={askSeed}
          live={aiLive()}
          citeLabel={(k, id) =>
            k === 'M' ? (meetings.find((m) => m.id === id)?.title ?? 'meeting') : k === 'E' ? (threads.find((t) => t.id === id)?.subject ?? 'email') : k === 'C' ? `#${channels.find((c) => c.id === id)?.name ?? 'channel'}` : 'Tasks'
          }
          onCite={(k, id, at) => {
            if (k === 'M') (setMeetPage({ kind: 'meeting', id }), go('meet'));
            else if (k === 'E') openThread(id);
            else if (k === 'C') openChannel(id);
            else openTasks(id === 'all' ? { kind: 'mine' } : { kind: 'client', id });
            void at;
            if (mobile) setAskScope(null);
          }}
          onClose={() => setAskScope(null)}
        />
      )}
      {chanDialog && (
        <ChannelDialog
          channel={chanDialog.id ? channels.find((c) => c.id === chanDialog.id) : undefined}
          users={members}
          clients={wsClients}
          teams={wsTeams}
          me={user.id}
          canManage={myRole !== 'member' || !chanDialog.id || channels.find((c) => c.id === chanDialog.id)?.ownerId === user.id}
          summaryCost={summaryCost}
          guestsAllowed={ws.plan?.tier !== 'free' || channels.filter((c) => c.workspaceId === ws.id).flatMap((c) => c.guests ?? []).length < 1}
          onClose={() => setChanDialog(null)}
          onArchive={() => {
            const id = chanDialog.id!;
            setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, archived: true } : c)));
            setChanDialog(null);
            setChatId(null);
            showToast({ text: t('Channel archived'), action: { label: t('Undo'), run: () => setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, archived: false } : c))) } });
          }}
          onSave={(d) => {
            if (chanDialog.id) {
              const before = channels.find((c) => c.id === chanDialog.id);
              setChannels((cs) => cs.map((c) => (c.id === chanDialog.id ? { ...c, ...d } : c)));
              const added = d.members.filter((m) => !before?.members.includes(m));
              added.forEach((m) => notify(m, 'mention', msg('{name} added you to #{channel}', { name: myFirst, channel: d.name }), { app: 'chat', id: chanDialog.id }));
              const newGuests = (d.guests ?? []).filter((g) => !before?.guests?.some((x) => x.email === g.email));
              showToast({ text: newGuests.length ? t('Saved. Invite sent to {names}', { names: fmtList(newGuests.map((g) => g.name)) }) : t('Channel saved') });
            } else {
              const id = uid();
              setChannels((cs) => [...cs, { ...d, id, workspaceId: ws.id, kind: 'channel' }]);
              d.members.forEach((m) => notify(m, 'mention', msg('{name} added you to #{channel}', { name: myFirst, channel: d.name }), { app: 'chat', id }));
              // A system line: Message.tsx puts the author's name in front ({name}); `text` stays as older versions show it.
              const made = d.topic ? phrase('{name} created #{channel}: {topic}', { name: myFirst, channel: d.name, topic: d.topic }) : phrase('{name} created #{channel}', { name: myFirst, channel: d.name });
              setMessages((ms) => [...ms, { id: uid(), channelId: id, userId: user.id, text: `created #${d.name}${d.topic ? `: ${d.topic}` : ''}`, tr: made, at: nowIso(), kind: 'system' }]);
              setChatId(id);
              go('chat');
              showToast({ text: d.guests?.length ? tn(d.guests.length, '#{channel} created, invite sent to {n} guest', '#{channel} created, invite sent to {n} guests', { channel: d.name }) : t('#{channel} created', { channel: d.name }) });
            }
            setChanDialog(null);
          }}
        />
      )}
      {ending && wsClientsAll.some((c) => c.id === ending) && (
        <EndClientDialog
          client={wsClientsAll.find((c) => c.id === ending)!}
          openTasks={wsTasks.filter((t) => t.clientId === ending && !t.done).length}
          channels={channels.filter((c) => c.clientId === ending && !c.archived).length}
          people={clientPeople(wsClientsAll.find((c) => c.id === ending)!, channels).length}
          onEnd={(o) => endClient(ending, o)}
          onClose={() => setEnding(null)}
        />
      )}
      {tplOpen && (
        <TemplateDialog
          templates={[...savedTemplates.filter((t) => t.workspaceId === ws.id), ...templatesFor(ws.industry)]}
          clients={wsClients}
          users={members}
          me={user.id}
          clientId={tplOpen.clientId}
          onCreate={fromTemplate}
          onDelete={(id) => setSavedTemplates((ts) => ts.filter((t) => t.id !== id))}
          onClose={() => setTplOpen(null)}
        />
      )}
      {dump !== null && (
        <BrainDump
          language={meetSettings.languages?.[0]}
          users={members}
          clients={wsClients}
          teams={wsTeams}
          me={user.id}
          aliases={ws.aliases ?? {}}
          initialText={dump}
          onCreate={createFromDump}
          onInvite={inviteByName}
          onClose={() => setDump(null)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          scope={searchScope}
          recentKey={`s2g-palette-recent:${user.id}:${ws.id}`}
          queryActions={(q) => {
            const group = t('Do with “{words}”', { words: q.length > 40 ? q.slice(0, 40) + '…' : q });
            return [
              { id: 'q-task', group, title: t('Create task “{name}”', { name: q }), sub: t('Assigned to you'), icon: ListChecks, run: () => { const task = createTask({ title: q.charAt(0).toUpperCase() + q.slice(1), userId: user.id, source: 'manual' }); showToast({ text: t('Task created'), action: { label: t('Open'), run: () => openTask(task.id) } }); } },
              { id: 'q-project', group, title: t('New {project} “{name}”', { project: term.one, name: q }), sub: t('Opens its page: tasks, chat, files, logins…'), icon: Briefcase, run: () => { const c = createProject(q.charAt(0).toUpperCase() + q.slice(1)); openClient(c.id); } },
              { id: 'q-note', group, title: t('New note “{name}”', { name: q }), sub: t('Only you can see it until you share it'), icon: FileText, run: () => newNote(q.charAt(0).toUpperCase() + q.slice(1)) },
              { id: 'q-ask', group, title: t('Ask AI: “{question}”', { question: q }), sub: t('Answers from your mail, chat, meetings and tasks'), icon: Sparkles, run: () => { setAskSeed(q); setAskScope({ kind: 'all' }); } },
            ];
          }}
          onClose={() => (setPaletteOpen(false), setSearchScope(null))}
        />
      )}

      {organize.overlays}

      {blockTarget && incomingFrom(blockTarget) && (
        <BlockDialog
          sender={incomingFrom(blockTarget)!}
          count={wsThreads.filter((t) => t.location !== 'trash' && incomingFrom(t)?.email === incomingFrom(blockTarget)!.email).length}
          domainCount={wsThreads.filter((t) => t.location !== 'trash' && domainOf(incomingFrom(t)?.email ?? '') === domainOf(incomingFrom(blockTarget)!.email)).length}
          onBlock={blockSender}
          onClose={() => setBlockTarget(null)}
        />
      )}

      {toast && (
        <div className={`toast${toast.quiet ? ' quiet' : ''}`} role="status" key={toast.id}>
          <span>{t(toast.text)}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {(toast.action.label === 'Undo' || toast.action.label === t('Undo')) && <Undo2 size={14} />} {t(toast.action.label)}
            </button>
          )}
          {toast.also && (
            <button
              onClick={() => {
                toast.also!.run();
                setToast(null);
              }}
            >
              {t(toast.also.label)}
            </button>
          )}
        </div>
      )}
    </div>
    </ProjectsCtx.Provider>
    </TabDefaultsCtx.Provider>
  );
}
