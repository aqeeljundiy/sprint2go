export type FolderId = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash' | 'snoozed' | 'scheduled' | 'assigned';

/** Where a thread physically lives. "starred" and "sent" are views, not locations. */
export type Location = 'inbox' | 'drafts' | 'archive' | 'spam' | 'trash';

export type View = { kind: 'folder'; id: FolderId } | { kind: 'label'; id: string } | { kind: 'tracking'; id: 'tracking' } | { kind: 'todos'; id: 'todos' };

export interface Person {
  name: string;
  email: string;
}

export interface Attachment {
  name: string;
  size: string;
}

export interface Message {
  id: string;
  from: Person;
  to: Person[];
  date: string; // ISO
  body: string; // plain-text version (used for snippets and search)
  html?: string; // rich version, when the message was written with formatting
  attachments?: Attachment[];
  /** Read tracking on emails you sent: one entry per tracked recipient (by email). */
  tracking?: Record<string, RecipientTracking>;
  /** What you chose to track when sending. */
  trackOptions?: TrackOptions;
  /** Tracking pixels removed from an email you received. */
  trackersBlocked?: number;
  /** The sender's official unsubscribe link (List-Unsubscribe header). */
  listUnsubscribe?: { url: string; oneClick: boolean };
}

export interface OpenEvent {
  at: string; // ISO
  device: string; // e.g. "iPhone · Apple Mail"
  place?: string; // rough location from IP
  /** Opened by a machine (Apple Mail Privacy Protection, a security scanner), not a person. */
  auto?: 'apple' | 'scanner';
}

export interface ClickEvent {
  at: string;
  label: string;
  url: string;
}

/** An attachment sent as a tracked link and viewed online. */
export interface DocEvent {
  at: string;
  file: string;
  seconds: number; // time spent viewing
  pages?: string; // e.g. "6 of 8"
}

export interface RecipientTracking {
  opens: OpenEvent[];
  clicks: ClickEvent[];
  docs?: DocEvent[];
}

export interface TrackOptions {
  opens: boolean;
  clicks: boolean;
  attachments: boolean; // send attachments as tracked links
  details: boolean; // device, email app and rough location
  remindDays: number; // 0 = no follow-up reminder
  notify: boolean;
}

export interface Thread {
  id: string;
  accountId: string; // which of your mailboxes it belongs to
  subject: string;
  location: Location;
  starred: boolean;
  unread: boolean;
  labels: string[];
  messages: Message[];
  invite?: Invite;
  assignee?: string; // shared inboxes: who is handling it
  notes?: { id: string; by: string; text: string; at: string }[]; // internal notes, only the team sees them
  snoozedUntil?: string; // hidden from the inbox until then
  scannedFor?: string[]; // `${userId}:${lastMessageId}`: already read for to-dos (so the AI reads each email once)
  sendAt?: string; // scheduled to send
}

/** A meeting proposed inside an email, offered as "Add to calendar". */
export interface Invite {
  title: string;
  start: string; // ISO
  end: string; // ISO
  location?: string;
}

export type CalendarSource = 'sprint2go' | 'google' | 'microsoft' | 'icloud' | 'ics' | 'holidays';

export interface CalendarDef {
  id: string;
  name: string;
  color: string;
  source?: CalendarSource; // missing = a Sprint2go calendar
  account?: string; // the connected account, e.g. aqeel@gmail.com
  ownerId?: string; // whose connection it is (outside calendars are personal)
  readOnly?: boolean; // calendar links and holidays
  url?: string; // .ics address
  share?: 'busy' | 'details' | 'private'; // what teammates see
  syncedAt?: string;
}

export interface CalEvent {
  id: string;
  title: string;
  calendarId: string;
  start: string; // ISO
  end: string; // ISO
  allDay?: boolean;
  location?: string;
  guests?: Person[];
  notes?: string;
  threadId?: string; // the email this event came from
  workspaceId?: string; // defaults to the first workspace
  userId?: string; // whose calendar (defaults to the first user)
  taskId?: string; // a time block for this task
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export type DriveKind = 'folder' | 'image' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'zip' | 'audio' | 'other';

export interface DriveItem {
  id: string;
  name: string;
  kind: DriveKind;
  parentId: string | null; // null = My Drive root
  size: number; // bytes (0 for folders)
  modified: string; // ISO
  starred?: boolean;
  trashed?: boolean;
  /** Preview image: an object URL for uploads, or a generated gradient. */
  thumb?: string;
  duration?: string; // videos
  threadId?: string; // saved from an email
  workspaceId?: string; // defaults to the first workspace
  clientId?: string; // filed under a client (e.g. shared in its chat channel)
  channelId?: string; // shared in this chat channel
  sharedWithClient?: boolean; // visible in the client portal
  url?: string; // uploaded content (prototype: a data URL)
  uploadedBy?: string; // a client person's email when they uploaded it
}

/** Which part of Drive is showing. */
export type DriveSection = 'my' | 'recent' | 'media' | 'email' | 'starred' | 'trash';

export interface Account {
  id: string;
  email: string;
  name: string; // display name on outgoing mail
  kind: 'personal' | 'shared';
  connected: boolean; // false until the mail server is linked
  provider?: MailProvider; // default: sprint2go
  users: string[]; // user ids who can open this mailbox
}

/** One business: its own brand, domains, mailboxes, calendar and drive. */
export interface Workspace {
  id: string;
  name: string;
  color: string; // brand colour, used as the app accent
  logo?: string; // data URL of an uploaded logo
  domains: string[];
  accounts: Account[];
  members: Member[];
  apps?: AppId[]; // switched-on apps (default: all)
  emailSetup?: EmailSetup; // what the company chose at onboarding
  emailProvider?: MailProvider; // where the domain's mail lives when not hosted by us
  meetUrl?: string;
  meetingRules?: MeetingRule[];
  clientAccess?: ClientAccess; // what clients see and do in their portal
  chat?: {
    gifs: boolean;
    celebrations: boolean;
    whoCanCreate: Policy;
    history?: 'forever' | '1y' | '90d';
    layout?: ChatLayout; // the company's Default sidebar, set by admins
  };
  plan?: Plan;
  ai?: AISettings;
  meetings?: MeetingSettings;
  storage?: StorageSettings;
  security?: { twoStep: boolean; google: boolean; microsoft: boolean; sso: boolean };
  aliases?: Record<string, string>; // learned names: "andi" -> user id, or "contact:<name>"
  teamHome?: Record<string, HomeTemplateId>; // default Home template per team
}

export type Role = 'owner' | 'admin' | 'member';

export interface Member {
  userId: string;
  role: Role;
}

/** A person who signs in to Sprint2go. */
export interface User {
  id: string;
  name: string;
  email: string; // sign-in address
  title: string;
  color: string;
  nicknames?: string[]; // "Kiki" for Rizky; used by the brain dump
  clientOf?: { workspaceId: string; clientId: string }; // someone at a client: signs in to their portal only
}

/** A task. `userId` is the person it's assigned to ('' = not assigned yet, e.g. waiting in a team's queue). */
export interface Todo {
  id: string;
  kind?: 'task' | 'brief'; // a brief has an owner (userId), context and subtasks
  title: string;
  teamId?: string;
  briefId?: string; // the brief this task belongs to
  context?: string; // a brief's goal, background, deliverables and links
  doneAt?: string;
  doneBy?: string;
  visibleToClient?: boolean; // shows in the client portal
  approval?: Approval; // the client is asked to approve this
  meetingId?: string; // said in this meeting
  channelId?: string; // on this chat channel's to-do list
  saidAt?: number; // ms into the recording
  due?: string; // YYYY-MM-DD
  done: boolean;
  status?: TaskStatus; // board column; kept in step with `done`
  priority: 'high' | 'normal';
  threadId?: string; // the email it came from
  source: 'ai' | 'manual' | 'braindump' | 'chat' | 'meeting' | 'request';
  requestedBy?: string; // a client person's email (requests from the portal)
  userId: string; // first person doing it ('' = waiting in a team queue); kept for older code
  assignees?: string[]; // everyone doing it (userId is the first)
  supervisorId?: string; // checks the work; by default whoever assigned it
  followers?: string[]; // get updates, no responsibility
  history?: TaskEvent[];
  createdBy?: string;
  clientId?: string;
  workspaceId?: string;
  notes?: string;
  repeat?: Repeat; // when done, the next one is created
  remindAt?: string; // ISO time to ping the doers
  reminded?: boolean;
  checklist?: { id: string; text: string; done: boolean }[];
  createdAt: string;
}
export type Task = Todo;
export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'review' | 'done'; // waiting = on the client; review = waiting for the supervisor

/** One line in a task's history: what changed, or a comment. */
export interface TaskEvent {
  id: string;
  at: string;
  by: string; // user id, or a guest email
  kind: 'created' | 'assigned' | 'status' | 'due' | 'edit' | 'comment' | 'review' | 'supervisor';
  text: string;
  toClient?: boolean; // a comment the client can read (team comments are internal unless marked)
}

export interface Approval {
  status: 'waiting' | 'approved' | 'changes';
  askedBy: string;
  askedAt: string;
  by?: string; // guest email
  at?: string;
  note?: string;
}

/** A department: Video editing, Design, Performance, Finance… */
export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  leadId?: string;
  members: string[];
  keywords?: string[]; // words that route brain-dump tasks to this team
  review?: boolean; // finished tasks wait for the supervisor before they count as done
}

export type HomeTemplateId = 'founder' | 'lead' | 'maker' | 'account' | 'finance';

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  domain?: string; // their email domain, used to find their emails
  color: string;
  status: 'active' | 'lead' | 'paused' | 'ended';
  since?: string; // when the work started
  endedAt?: string; // when the work ended (status 'ended')
  endReason?: string;
  portalAfterEnd?: 'readonly' | 'off'; // what their people keep after the end
  archivedOnEnd?: string[]; // channels archived when ending (unarchived if they come back)
  ownerId: string;
  overview?: { headline: string; summary: string; progress: string; wins: string[]; risks: string[]; next: string[]; at: string; from: number };
  people?: ClientPerson[]; // the client's own people who can sign in to their portal
  access?: Partial<ClientAccess>; // this client's own settings (otherwise the company's)
  aiUsage?: { month: string; count: number }; // client questions to AI this month
}

/** Someone at a client who can sign in to see what's shared with them. */
export interface ClientPerson {
  email: string;
  name: string;
  role: 'viewer' | 'collaborator' | 'approver'; // viewer reads; collaborator also comments, uploads and asks; approver also approves work
  status: 'invited' | 'joined' | 'pending'; // pending = waiting for an admin to OK it
  invitedBy: string; // a team user id, or a client person's email
  at: string;
}

/** What clients can see and do, set for the company (Settings, Client access) and changeable per client. */
export interface ClientAccess {
  teamNames: 'full' | 'first' | 'hide';
  requests: boolean;
  requestsTo: string; // 'owner' (the client's account manager) or a team id
  meetingNotes: 'auto' | 'manual'; // auto = notes of meetings they attended
  recordings: 'off' | 'audio' | 'video';
  invites: 'direct' | 'approve' | 'off';
  ai: boolean;
  aiQuestions: number; // per client per month
  uploads: boolean;
  hideBranding: boolean; // needs the branding add-on
}
export const DEFAULT_CLIENT_ACCESS: ClientAccess = {
  teamNames: 'first',
  requests: true,
  requestsTo: 'owner',
  meetingNotes: 'auto',
  recordings: 'off',
  invites: 'direct',
  ai: false,
  aiQuestions: 30,
  uploads: true,
  hideBranding: false,
};

/** The company's Default chat sidebar: sections in order, and which section a channel sits in. */
export interface ChatLayout {
  sections: ChatSection[];
  placement: Record<string, string>; // channel id -> section id (otherwise the section for its category)
}
export interface ChatSection {
  id: string;
  name: string;
  category?: ChannelCategory; // the built-in section for this kind of channel (can be renamed, not deleted)
  access?: { userIds: string[]; teamIds: string[] }; // these people are in every channel of the section, now and later
}
export type ChannelCategory = 'client' | 'shared' | 'team' | 'project' | 'social'; // client = our team about a client; shared = with the client's people
export type Policy = 'everyone' | 'admins';

export interface Channel {
  id: string;
  workspaceId: string;
  kind: 'channel' | 'dm';
  name: string; // channel name, or '' for DMs
  members: string[]; // user ids
  clientId?: string;
  teamId?: string;
  topic?: string; // purpose
  category?: ChannelCategory;
  private?: boolean;
  ownerId?: string;
  postPolicy?: Policy; // who can post ('admins' = announcements)
  invitePolicy?: Policy; // who can add people
  guests?: Guest[]; // people from outside the company (clients)
  sharedWith?: { workspaceName: string; domain: string; status: 'pending' | 'connected' }; // shared channel with another Sprint2go company
  digest?: boolean; // old name for summary.schedule === 'daily'
  summary?: ChannelSummary;
  bookmarks?: { id: string; title: string; url: string; addedBy: string; at: string }[];
  materials?: Materials; // folders of files, links and docs for this channel
  archived?: boolean;
  createdAt?: string;
}

/** Someone outside the company, invited by email into specific channels (and their client page). */
export interface Guest {
  email: string;
  name: string;
  status: 'invited' | 'joined';
  invitedBy: string;
  at: string;
}

/** A channel's materials: folders (e.g. "Project A") holding files, links and simple docs. */
export interface Materials {
  folders: { id: string; name: string; color?: string }[];
  items: Material[];
  /** Files and links shared in chat (key: "file:<msgId>:<name>", "link:<url>", "drive:<id>") filed into a folder. */
  placed: Record<string, string>;
}
export interface Material {
  id: string;
  kind: 'link' | 'doc' | 'file';
  title: string;
  folderId?: string;
  url?: string; // link
  html?: string; // doc
  file?: { name: string; type: string; size: number; url?: string }; // uploaded here
  addedBy: string;
  at: string;
  editedBy?: string;
  editedAt?: string;
}

export interface ChatFile {
  name: string;
  size: number; // bytes
  type: string; // mime
  driveId?: string; // saved to Drive under the client's folder
  url?: string; // object URL in the prototype
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  text: string;
  at: string;
  taskId?: string; // a task created from (or announced by) this message
  parentId?: string; // a reply in a thread
  alsoInChannel?: boolean; // a thread reply also shown in the channel
  reactions?: Record<string, string[]>; // emoji -> user ids
  voice?: { seconds: number; url?: string; transcript?: string };
  poll?: { question: string; options: { text: string; votes: string[] }[] };
  files?: ChatFile[];
  kind?: 'message' | 'celebration' | 'kudos' | 'system';
  kudosFor?: string; // user id
  guestEmail?: string; // written by a guest
  edited?: boolean;
  pinned?: boolean;
}

export interface Status {
  emoji: string;
  text: string;
  until?: string;
}

export interface Notice {
  id: string;
  userId: string; // who receives it
  workspaceId: string;
  kind: 'task' | 'mention' | 'meeting' | 'mail' | 'done';
  text: string;
  at: string;
  read: boolean;
  link?: { app: AppId; id?: string; msg?: string }; // msg: the exact chat message to land on
}

export type MeetingStatus = 'queued' | 'joining' | 'waiting_room' | 'recording' | 'stopping' | 'processing' | 'done' | 'failed' | 'stopped';
export type MeetingType = 'sales' | 'client' | 'internal' | 'hiring' | 'partner' | 'one_on_one' | 'other';

export interface Meeting {
  id: string;
  workspaceId: string;
  title: string;
  at: string;
  minutes: number;
  clientId?: string; // the folder (a client); empty = Unfiled
  filedBy?: 'rule' | 'ai' | 'user';
  attendees: string[]; // names
  summary: string;
  actions: { title: string; owner?: string; due?: string; taskId?: string; saidAt?: number }[];
  sharedWithClient?: boolean; // notes visible in the client portal
  // From the notetaker
  status?: MeetingStatus;
  error?: string;
  platform?: 'meet' | 'zoom';
  url?: string;
  botName?: string;
  type?: MeetingType;
  tags?: string[];
  keyPoints?: string[];
  decisions?: string[];
  openQuestions?: string[];
  topics?: { name: string; at: number }[]; // ms
  transcript?: { speaker: string; text: string; at: number }[]; // ms since start
  log?: { message: string; at: string }[];
  recording?: { keep: 'video' | 'audio' | 'notes'; sizeMb: number; downgradeOn?: string };
  share?: { token: string; transcript: boolean; video: boolean };
  access?: { watch: 'everyone' | 'attendees' | 'admins'; download: boolean; transcript: 'everyone' | 'attendees' };
  createdBy?: string;
}

export interface MeetingRule {
  id: string;
  kind: 'participant' | 'domain' | 'keyword';
  value: string;
  clientId: string;
}

export type AppId = 'home' | 'mail' | 'chat' | 'tasks' | 'calendar' | 'notes' | 'drive' | 'meet' | 'vault';

/** A note: private, or shared with the whole company; can belong to a client. */
export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  html: string;
  ownerId: string;
  visibility: 'private' | 'team';
  clientId?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Where a mailbox actually lives. */
export type MailProvider = 'sprint2go' | 'google' | 'microsoft' | 'zoho' | 'imap';
export type EmailSetup = 'keep' | 'mix' | 'hosted' | 'none';

/** Mail from these senders never reaches the inbox (a server-side rule later). */
export interface BlockRule {
  id: string;
  value: string; // an address, or a domain
  kind: 'address' | 'domain';
  at: string;
}

/* ---------- Plans, billing, AI and storage (workspace admin) ---------- */

export type Track = 'own' | 'ai'; // bring your own AI keys, or AI included
export type Tier = 'free' | 'small' | 'studio' | 'agency' | 'business';

export interface Plan {
  track: Track;
  tier: Tier;
  cycle: 'monthly' | 'yearly';
  trialEnds?: string; // reverse trial of Studio AI
  paused?: boolean;
  addons: { mailboxes: number; storage50: number; meetHours10: number; branding: boolean };
  autoTopUp?: { on: boolean; limit: number }; // rupiah per month
  topUps?: number; // bought this month
  payment?: { method: 'qris' | 'va' | 'card' | 'ewallet'; label: string };
  billing: { company: string; npwp?: string; address?: string; emails: string[] };
  since: string;
}

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'qwen'
  | 'mistral'
  | 'sumopod'
  | 'openrouter'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'custom'
  | 'deepgram'
  | 'groq';

export type AIJobId = 'braindump' | 'ask' | 'meeting' | 'draft' | 'summary' | 'digest' | 'replies' | 'todos' | 'sorting' | 'translate' | 'speech';

export interface ProviderConn {
  id: ProviderId;
  keyLast4: string; // the full key never comes back to the browser
  addedAt: string;
  addedBy: string;
  status: 'ok' | 'error';
  baseUrl?: string; // custom / Azure / Bedrock region
  capUsd?: number; // monthly cap (estimated spend)
  spentUsd: number; // this month, estimated from the cost log
}

export interface AISettings {
  payer: 'sprint2go' | 'own' | 'both';
  providers: ProviderConn[];
  preset: 'best' | 'balanced' | 'cheap' | 'custom';
  jobs: Partial<Record<AIJobId, { provider: ProviderId | 'included'; model: string; fallback?: ProviderId }>>;
  auto: { meetingNotes: boolean; emailTodos: boolean; digests: boolean };
  blocked: ProviderId[];
  alerts: boolean;
}

export interface MeetingSettings {
  keep: 'video' | 'audio' | 'notes'; // default
  clientMeetings: 'video' | 'audio' | 'notes';
  internalMeetings: 'video' | 'audio' | 'notes';
  downgradeAfter: 0 | 30 | 60 | 90; // days until video becomes audio (0 = never)
  whoCanRecord: 'everyone' | 'admins';
  shareNotesWithClient: boolean;
  autoJoin: boolean;
  joinMode?: 'accepted' | 'organizer' | 'all' | 'off';
  autoTasks?: boolean; // create tasks from action items
  botName: string;
  announce: boolean;
}

export interface StorageSettings {
  own?: { provider: 'gdrive' | 'dropbox' | 'b2'; account: string; forFilesOver: number }; // MB
  askOver: 0 | 200 | 500 | 1000; // MB, 0 = never ask
}

/** A way to arrange the chat sidebar. Built-in views, or one a person makes. */
export interface ChatView {
  id: string;
  name: string;
  sections: { id: string; name: string; channelIds: string[] }[];
  showRest: boolean; // channels not in any section go under "Other channels"
}

/** An AI summary of a channel, on a schedule. Uses the company's AI allowance or its own keys. */
export interface ChannelSummary {
  schedule: 'off' | 'daily' | 'weekly' | 'monthly';
  post: boolean; // also post each new summary into the channel
  history: { id: string; text: string; period: string; at: string; auto: boolean; by?: string }[];
}
