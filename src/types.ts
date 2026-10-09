import type { SandboxMark } from './sandbox';
import type { SummaryRun } from './jobTimes';

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
  url?: string; // where the file is (uploaded or received by the mail engine)
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
  mid?: string; // the Message-ID on the wire, so replies land in the same thread
  delivery?: { state: 'held' | 'sending' | 'sent' | 'failed' | 'local'; at: string; error?: string; until?: string; kept?: string[] }; // set by the mail engine for mail you sent (held: waiting out the Undo window until `until`; local: a local server kept it on this computer, `kept` are the outside addresses)
  auth?: string; // what the checks said about a received message (spf, dkim, dmarc)
  invite?: MailInvite; // a calendar invite in this email (Google Calendar, Outlook...), read by the mail engine
}

export type RsvpStatus = 'accepted' | 'tentative' | 'declined';
export interface InviteGuest extends Person {
  status: RsvpStatus | 'needs-action' | 'delegated';
  optional?: boolean;
}
/** A calendar invite that came by email: the organiser's event, and the answer given from here. */
export interface MailInvite {
  method: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH'; // an invite or update, a cancellation, someone's answer, or a plain event to add
  uid: string; // the event's id in the organiser's calendar
  sequence: number; // goes up with each change the organiser makes
  title: string;
  start: string; // ISO. All-day: noon UTC on the first day
  end: string; // ISO. All-day: a minute past noon UTC on the last day
  allDay?: boolean;
  tz?: string; // the organiser's time zone, when the invite names it
  location?: string;
  description?: string;
  url?: string; // the meeting link (Google Meet, Zoom, Teams, Webex)
  organizer?: Person;
  attendees: InviteGuest[];
  rrule?: string; // repeats, e.g. FREQ=WEEKLY;BYDAY=MO
  recurrenceId?: string; // one changed occurrence of a repeating event
  cancelled?: boolean;
  you?: string; // the address of yours that was invited
  answer?: { status: RsvpStatus; at: string; by: string; sent: boolean }; // sent: the organiser was told
}

export interface OpenEvent {
  at: string; // ISO
  device: string; // a rough device from the mail app, e.g. "iPhone · Apple Mail"; empty when it's hidden
  place?: string; // a country, only when the server knows it for sure (never guessed)
  /** Maybe opened by a machine, not a person: Apple Mail Privacy Protection, a security filter. Not counted. */
  auto?: 'apple' | 'scanner';
  /** Opened through the provider's picture proxy: a person opened it, the device is hidden. */
  via?: 'gmail' | 'yahoo' | 'outlook';
}

export interface ClickEvent {
  at: string;
  label: string;
  url: string;
  /** A link checked by a mail filter, not followed by a person. Not counted. */
  auto?: 'scanner';
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
  details: boolean; // not offered: the rough device always shows, a place only when it's known for sure
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
  workspaceId?: string; // set by the server for mail it received
  replyTo?: { threadId: string; mid?: string; references?: string[] }; // a reply drafted in a connected AI app: when sent, it carries that conversation's headers so it lands in the same thread
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
  source?: CalendarSource; // missing = a sprint2go calendar
  account?: string; // the connected account, e.g. aqeel@gmail.com
  ownerId?: string; // whose connection it is (outside calendars are personal)
  readOnly?: boolean; // calendar links and holidays
  url?: string; // .ics address (only its owner ever gets it from the server)
  share?: 'busy' | 'details' | 'private'; // what teammates see
  syncedAt?: string; // last time it was read successfully
  checkedAt?: string; // calendar links and holidays: last time the server tried
  error?: string; // calendar links and holidays: why the last try failed (cleared when one works)
  workspaceId?: string; // a company's own calendar (public holidays): everyone in it sees it
  country?: string; // public holidays: which country
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
  meetUrl?: string; // its video call link: from an invite, a calendar link the server read, or added by hand
  inviteUid?: string; // came from an emailed invite: the organiser's event id
  sequence?: number; // the invite version it shows
  occurrence?: string; // one of a repeating invite's dates (its original start)
  rsvp?: RsvpStatus; // what you answered
  organizer?: Person;
  feed?: 'link' | 'holidays'; // made by the server from a calendar link or public holidays: read only
  busy?: boolean; // a teammate's event shown as busy only (no title or details)
  remind?: number; // minutes before the start to remind its owner (a notification; the server sends it)
  remindedFor?: string; // the start the reminder went out for (the server's: moving the event sets it again)
  timeZone?: string; // set in another time zone: its times are shown in that zone too ("10:00 Singapore time")
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
  /** A throwaway address: made in seconds, shared with a few people, deleted by itself (or by hand). */
  temp?: { createdBy: string; createdAt: string; expiresAt?: string };
  away?: AwayReply; // out of office
}

/** Out of office: an automatic answer, once per sender every 4 days, while it's on and inside its dates. */
export interface AwayReply {
  on: boolean;
  from?: string; // YYYY-MM-DD, the first day away (as the person picked it)
  until?: string; // YYYY-MM-DD, the last day away
  fromAt?: string; // ISO: the start of the first day, where the person is
  untilAt?: string; // ISO: the end of the last day
  subject: string;
  message: string;
  since?: string; // set by the server when it was switched on or changed: everyone gets the new answer
}

/** Another address that delivers into mailboxes: sales@ into Dewi's and Bayu's, or info@ into the hello@ shared inbox. */
export interface MailAlias {
  id: string;
  address: string;
  to: string[]; // mailbox (account) ids
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
  /** "Some of each": the domain stays with Google or Microsoft, which passes unknown addresses on to sprint2go. */
  mailRouting?: { verifiedAt?: string; dailyCheck: boolean; lastCheck?: { at: string; ok: boolean } };
  emailProvider?: MailProvider; // where the domain's mail lives when not hosted by us
  mailRoute?: 'own' | 'boosted'; // how mail goes out: from the sprint2go server, or through Amazon on our account
  mailCredits?: number; // emails left on Boosted sending
  mailCreditsNotified?: boolean;
  mailAliases?: MailAlias[]; // extra addresses that deliver into mailboxes (set through the server)
  mailChecks?: { at: string; allOk: boolean; checks: { key: string; ok: boolean; found: string; want: string }[] }; // the last DNS check
  /** What really works, worked out by the server: mail in, mail out, per mailbox, with the reason when it doesn't. */
  mailReady?: { at: string; receive: boolean; send: boolean; why: { receive?: string; send?: string }; mailboxes: Record<string, { receive: boolean; send: boolean; why?: string; sendWhy?: string }> };
  meetUrl?: string;
  meetingRules?: MeetingRule[];
  clientAccess?: ClientAccess; // what guests see and do in the shared space
  clientAccessByType?: Record<string, Partial<ClientAccess>>; // changes for one project type (Partner, Vendor…) on top of the company's
  terms?: { word: 'project' | 'client' }; // what the company calls its work: Projects (default) or Clients
  taskStages?: TaskStage[]; // the company's task stages, in board order (default: To do, In progress, Waiting, Review, Done)
  chat?: {
    gifs: boolean;
    celebrations: boolean;
    whoCanCreate: Policy;
    history?: 'forever' | '1y' | '90d'; // delete chat messages older than this, every day (server/retention.ts)
    keep?: string[]; // projects whose channels keep everything
    deleteFrom?: string; // set by the server: deleting starts here, a week after it was switched on
    lastRun?: { at: string; deleted: number; files: number; before: string }; // set by the server
    layout?: ChatLayout; // the company's Default sidebar, set by admins
  };
  plan?: Plan;
  ai?: AISettings;
  meetings?: MeetingSettings;
  storage?: StorageSettings;
  security?: { twoStep: boolean; google: boolean; microsoft: boolean; sso: boolean; graceDays?: number; twoStepSince?: string }; // twoStepSince: set by the server when the requirement is switched on
  aliases?: Record<string, string>; // learned names: "andi" -> user id, or "contact:<name>"
  teamHome?: Record<string, HomeTemplateId>; // default Home template per team
  tabDefaults?: Record<string, { order: string[]; hidden: string[] }>; // tab orders an admin set for everyone
  permissions?: Partial<MemberPermissions>;
  whiteLabel?: WhiteLabel; // an agency running the app under its own brand
  industry?: Industry; // what the company does: picks the starter tables and brief templates
  holidays?: { country: string }; // public holidays in everyone's calendar (src/data/holidays.ts)
  /** Where the company is (an IANA name, Settings, General): when scheduled summaries are written, and the clock for
   *  digests and table rules when a person's own isn't known. Missing: Asia/Jakarta (src/jobTimes.ts). */
  timeZone?: string;
  createdAt?: string;
  suspended?: { at: string; by: string; reason: string }; // set by an operator: read-only for everyone until lifted
  bimi?: { fileId: string; name: string; at: string; by: string }; // the server's: the BIMI logo (Settings, Email delivery)
  whatsapp?: { phoneNumberId: string; displayPhone?: string; connected: boolean; verifyToken: string; secured?: boolean }; // WhatsApp Business (Meta Cloud API); the token and app secret stay on the server. secured: Meta's signatures can be checked, so messages are read
  /** Read tracking on mail to people outside the company (Settings, Security & data). Off: nobody can track. */
  readTracking?: boolean;
  /** "Let our people open the demo company" (Settings, Apps & chat). Missing: on. */
  demoCompany?: boolean;
  /** "Let people connect AI apps" (Settings, Security & data): Claude, ChatGPT and others through /mcp. Missing: on. */
  aiApps?: boolean;
  /** Set on someone's own demo company only (src/sandbox.ts): whose it is, and their "Try this" list. */
  sandbox?: SandboxMark;
}

/** The company's own brand in place of sprint2go: for its team and, above all, for its clients at its own address. */
export interface WhiteLabel {
  enabled: boolean;
  name: string; // shown wherever the app would say sprint2go
  logo?: string; // defaults to the workspace's logo
  color?: string;
  domain?: string; // e.g. portal.theiragency.com, pointed at us with one DNS record; set through /api/white-label/domain
  // Set by the server only: waiting (for the record) → found → issuing (the certificate) → live.
  domainStatus?: DomainStatus;
  domainCheck?: DomainCheck;
  slug?: string; // try it locally at <slug>.localhost
}
export type DomainStatus = 'waiting' | 'found' | 'issuing' | 'live';
/** The server's last look at a company's own address (server/customDomains.ts). */
export interface DomainCheck {
  at: string;
  record: { type: 'CNAME' | 'A'; host: string; value: string }; // the one record to add
  zone: string; // the domain whose DNS holds it
  dnsHost: { name: string; where: string } | null; // who runs that DNS
  nameservers: string[];
  found: string; // what the address points at now
  problem?: string; // why it isn't right yet
  blocked?: 'addon' | 'off'; // record found; going live waits for the branding add-on, or for sprint2go to turn custom addresses on
  since?: string; // when the certificate was asked for
  certError?: string;
  liveAt?: string;
}

export type Industry = 'agency' | 'ecommerce' | 'consulting' | 'software' | 'events' | 'other';
export const INDUSTRIES: { id: Industry; name: string; hint: string }[] = [
  { id: 'agency', name: 'Agency or studio', hint: 'Clients, campaigns, content' },
  { id: 'ecommerce', name: 'Brand or online shop', hint: 'Products, launches, suppliers' },
  { id: 'consulting', name: 'Consulting or services', hint: 'Prospects, proposals, engagements' },
  { id: 'software', name: 'Software or startup', hint: 'Releases, bugs, customers' },
  { id: 'events', name: 'Events', hint: 'Venues, vendors, sponsors' },
  { id: 'other', name: 'Something else', hint: 'Start plain' },
];

/** A quote or contract for a project: lines of work with prices; the guest accepts by typing their name, and it becomes a brief. */
export interface Quote {
  id: string;
  workspaceId: string;
  clientId: string;
  title: string;
  intro?: string; // a few lines above the items
  items: { id: string; title: string; qty: number; price: number; days?: number }[]; // days: when it becomes a task, due this many workdays in
  terms?: string; // payment terms, what's included, validity
  currency: 'IDR' | 'USD';
  validUntil?: string; // YYYY-MM-DD
  status: 'draft' | 'sent' | 'accepted' | 'declined';
  createdBy: string;
  createdAt: string;
  sentAt?: string;
  decidedAt?: string;
  decidedBy?: string; // the guest's email
  signature?: string; // the name they typed to accept
  note?: string; // what they said when declining
  briefId?: string; // the brief made from it when accepted
}

/** What Members can do. Each project's Lead can always manage that project. */
export interface MemberPermissions {
  createProjects: boolean;
  inviteGuests: boolean;
  seeAllProjects: boolean; // off: only the projects they're on
  editTables: boolean; // columns, views and automations (rows are always editable)
  deleteThings: boolean; // projects, tables, channels, notes and files
  seeBilling: boolean; // plan, billing and AI usage
  createTeams: boolean;
}
export const DEFAULT_PERMISSIONS: MemberPermissions = { createProjects: true, inviteGuests: true, seeAllProjects: false, editTables: true, deleteThings: false, seeBilling: false, createTeams: false };

export type Role = 'owner' | 'admin' | 'member';

export interface Member {
  userId: string;
  role: Role;
}

/** A person who signs in to sprint2go. */
export interface User {
  id: string;
  name: string;
  email: string; // sign-in address
  title: string;
  color: string;
  photo?: string; // profile photo, a small square JPEG data URL
  hiddenApps?: AppId[]; // apps this person hid from their own sidebar (the company still has them)
  nicknames?: string[]; // "Kiki" for Rizky; used by the brain dump
  clientOf?: { workspaceId: string; clientId: string }; // someone at a client: signs in to their portal only
  suspended?: { at: string; by: string; reason: string }; // set by an operator: can't sign in
  deletedAt?: string; // the account was deleted; the record stays so old messages keep a name
  vaultKey?: { pub: JsonWebKey; wrapped: string; salt: string; iv: string }; // the Vault's end-to-end keys: public, and private locked by their passphrase
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
  noteId?: string; // made from a line of this note
  source: 'ai' | 'manual' | 'braindump' | 'chat' | 'meeting' | 'request' | 'import'; // import: brought over from another app (Settings, Import)
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
/** A stage id: one of the company's task stages (src/stages.ts). The five built-in ones are 'todo', 'doing', 'waiting', 'review' and 'done'. */
export type TaskStatus = string;
/**
 * What a stage means, whatever the company calls it: not started, being worked on, waiting on the guest, waiting
 * for the supervisor's check, or finished. Everything that reacts to a task's stage (Home, reminders, approvals,
 * the guest portal) looks at this, never at a stage's id or name.
 */
export type StageKind = 'open' | 'active' | 'waiting' | 'review' | 'done';
export type StageColor = 'gray' | 'accent' | 'blue' | 'violet' | 'teal';
/** One column of the task board. */
export interface TaskStage {
  id: string;
  kind: StageKind;
  name?: string; // empty on a built-in stage: its usual name (which follows the company's words)
  color?: StageColor; // waiting stages are always amber and done stages green
}

/** One line in a task's history: what changed, or a comment. */
export interface TaskEvent {
  id: string;
  at: string;
  by: string; // user id, or a guest email
  byName?: string; // brought in by an import from someone who isn't a member here: their name (by is "former:…")
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
  about?: string; // what the team does, one line
  join?: 'open' | 'lead'; // open: anyone can join; lead (default): the lead or an admin adds people, others ask
  requests?: { userId: string; at: string }[]; // people who asked to join
  taskStages?: TaskStage[]; // the team's own task stages (its queue's tasks), instead of the company's; missing: the company's
}

export type HomeTemplateId = 'founder' | 'lead' | 'maker' | 'account' | 'finance';

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  domain?: string; // their email domain, used to find their emails
  color: string;
  status: 'active' | 'lead' | 'paused' | 'ended';
  type?: string; // a label: Client, Internal, Partner… (see PROJECT_TYPES)
  since?: string; // when the work started
  endedAt?: string; // when the work ended (status 'ended')
  endReason?: string;
  portalAfterEnd?: 'readonly' | 'off'; // what their people keep after the end
  taskStages?: TaskStage[]; // the project's own task stages, instead of its team's or the company's; missing: theirs
  archivedOnEnd?: string[]; // channels archived when ending (unarchived if they come back)
  ownerId: string;
  photo?: string; // a small square picture or logo (data URL); otherwise the first letter on its colour
  members?: { userId: string; role: 'lead' | 'member'; addedBy: string; at: string }[]; // teammates on this project
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
  company?: string; // where they work, shown as "Name · Company" (from the invite, or their email domain)
  phone?: string; // for WhatsApp, with the country code
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
  sharedWith?: { workspaceName: string; domain: string; status: 'pending' | 'connected' }; // shared channel with another sprint2go company
  digest?: boolean; // old name for summary.schedule === 'daily'
  summary?: ChannelSummary;
  bookmarks?: { id: string; title: string; url: string; addedBy: string; at: string }[];
  materials?: Materials; // folders of files, links and docs for this channel
  archived?: boolean;
  huddle?: { by: string; at: string; members: string[] }; // a quick voice call going on in this channel
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
  missing?: string; // brought in by an import without the file itself: why (e.g. "not in the export")
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
  kind?: 'message' | 'celebration' | 'kudos' | 'system' | 'summary'; // summary: a channel's scheduled AI summary, posted by sprint2go
  kudosFor?: string; // user id
  summaryOf?: string; // kind 'summary': the period it covers
  guestEmail?: string; // written by a guest
  authorName?: string; // brought in by an import from someone who isn't a member here: their name (userId is "former:…")
  via?: 'whatsapp'; // came in from, or went out on, WhatsApp
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
  kind: 'task' | 'mention' | 'meeting' | 'mail' | 'done' | 'team';
  text: string;
  at: string;
  read: boolean;
  link?: { app: AppId | 'settings'; id?: string; msg?: string }; // msg: the exact chat message to land on; settings: id is the section
  url?: string; // a page outside the app (operators: a ticket in the backend)
  fromGuest?: boolean; // written by a guest (set by the server), for the "Guests" choice in Settings, Notifications
  event?: 'opened'; // someone opened an email you sent (server/readTracking.ts): also a toast while you're in the app
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
  recording?: { keep: 'video' | 'audio' | 'notes'; sizeMb: number; downgradeOn?: string; seconds?: number; url?: string; videoUrl?: string; videoMb?: number }; // url / videoUrl: from the recorder bot
  language?: string; // this meeting's language when it differs from the company's (a code from MEETING_LANGUAGES)
  bot?: boolean; // sent with the real recorder (the server and the bot update it)
  needsTasks?: boolean; // the server wrote notes; the sender's app turns the actions into tasks
  share?: { token: string; transcript: boolean; video: boolean };
  access?: { watch: 'everyone' | 'attendees' | 'admins'; download: boolean; transcript: 'everyone' | 'attendees' };
  createdBy?: string;
  // Sent by the server because the calendar said so ("Bot joins automatically")
  auto?: boolean;
  eventId?: string; // the calendar event it came from
  scheduledFor?: string; // when that event starts
}

export interface MeetingRule {
  id: string;
  kind: 'participant' | 'domain' | 'keyword';
  value: string;
  clientId: string;
}

export type AppId = 'home' | 'mail' | 'chat' | 'tasks' | 'projects' | 'teams' | 'calendar' | 'notes' | 'drive' | 'meet' | 'vault' | 'tables';

/** A note: private, or shared with the whole company; can belong to a client. */
export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  html: string;
  ownerId: string;
  visibility: 'private' | 'team';
  teamCan?: 'edit' | 'view'; // shared notes: whether the others can change it (edit when missing)
  clientId?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string; // in Recently deleted (for 30 days, then the server deletes it for good)
  deletedBy?: string;
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
  comp?: { until: string; note?: string; by?: string }; // free months given by an operator
  discount?: { code: string; kind: 'percent' | 'amount'; value: number; until?: string }; // from a coupon
  addons: { mailboxes: number; storage50: number; meetHours10: number; branding: boolean };
  autoTopUp?: { on: boolean; limit: number }; // rupiah per month
  topUps?: number; // bought this month
  payment?: { method: 'qris' | 'va' | 'card' | 'ewallet'; label: string };
  billing: { company: string; npwp?: string; address?: string; emails: string[] };
  since: string;
  pauses?: { from: string; to?: string }[]; // the server's record of pauses: up to 3 months in any year
  cancelAt?: string; // cancelled: the plan moves to Free then, at the end of the period that's paid for (the server's)
  cancel?: boolean; // the app asks to cancel (true) or to keep the plan (false); the server turns it into cancelAt
  adjustments?: PlanAdjustment[]; // the server's: prorated plan switches waiting for the next invoice
  trialRefused?: string; // the server's: why this company started on Free instead of a trial (one per person and domain)
}

/**
 * A plan switch, prorated: a charge (positive) or a credit (negative) on the next invoice. `invoiced`: the period's
 * invoice was already made at the old price, so this is the rest of the period; otherwise the period's invoice (still
 * to come) bills the new price in full and this puts right the days before the switch.
 */
export interface PlanAdjustment {
  id: string;
  at: string; // the (first) switch
  period: string; // "2026-10" (a yearly plan: the month its year started)
  invoiced: boolean;
  from: string; // plan names, "Studio AI"
  to: string;
  daysBefore: number;
  days: number;
  amount: number; // rupiah; negative: a credit
  text: string; // how the invoice and the billing page say it
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
  model?: string; // the model this key uses by default (picked when it was added, or since)
  typed?: boolean; // that model was typed in (not on the provider's list), checked with one call
}

export interface AISettings {
  payer: 'sprint2go' | 'own' | 'both';
  providers: ProviderConn[];
  preset: 'best' | 'balanced' | 'cheap' | 'custom';
  jobs: Partial<Record<AIJobId, { provider: ProviderId | 'included'; model: string; fallback?: ProviderId; typed?: boolean }>>; // typed: a model id typed in, not on the provider's list
  notes?: { id: string; at: string; text: string }[]; // set by the server: a model a provider stopped offering, and where its jobs went
  auto: { meetingNotes: boolean; emailTodos: boolean; digests: boolean };
  blocked: ProviderId[];
  alerts: boolean;
  caps?: { companyRp?: number; personRp?: number }; // monthly limits on own-key spending; AI stops when reached
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
  languages?: string[]; // what meetings are spoken in, main one first (codes from MEETING_LANGUAGES); empty = detect
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
  last?: SummaryRun; // what the server last did on the schedule (set by the server only)
}

/* ---------- Tables: flexible databases (leads, pipelines, anything) ---------- */

export type FieldType = 'text' | 'longtext' | 'number' | 'money' | 'date' | 'select' | 'multi' | 'person' | 'email' | 'phone' | 'url' | 'checkbox' | 'link' | 'button' | 'files' | 'rating' | 'formula' | 'rollup' | 'created' | 'edited' | 'creator';

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

export interface TableField {
  id: string;
  name: string;
  type: FieldType;
  options?: FieldOption[]; // select, multi
  currency?: 'IDR' | 'USD' | 'SGD' | 'EUR'; // money
  linkTable?: string; // link: the table its rows come from
  button?: ButtonDef; // button: what pressing it does
  description?: string; // what this field is for (shown in its menu and the row page)
  formula?: string; // formula: e.g. {Value} * 0.1, or {Name} & " · " & {City}
  rollup?: { linkField: string; targetField?: string; fn: 'count' | 'filled' | 'sum' | 'avg' | 'min' | 'max' | 'list' }; // rollup: from the rows a link field points to
  max?: number; // rating: how many stars (default 5)
}

/** A file on a row (kept small: pictures and documents up to a few MB). */
export interface FileRef {
  name: string;
  size: number;
  type: string;
  url: string;
}

/**
 * Something a button or a rule does to a row. Text can use {Field name} to fill in the row's values.
 * Values for "set" can be "@today", "@me" (whoever pressed) or "@now".
 */
export type TableAction =
  | { kind: 'set'; values: Record<string, CellValue> }
  | { kind: 'copy' | 'move'; tableId: string } // fields go across by matching names
  | { kind: 'linked'; tableId: string; linkFieldId?: string } // a new row there, linked back to this one
  | { kind: 'task'; title: string; assignee?: string; dueDays?: number } // assignee: a person field's id, a user id, or "@me"
  | { kind: 'email'; toField?: string; subject: string; body: string } // opens a new email, filled in
  | { kind: 'chat'; channelId: string; text: string }
  | { kind: 'notify'; who: string; text: string } // who: a person field's id, a user id, or "@me"
  | { kind: 'webhook'; url: string; fields?: { fieldId: string; key: string }[]; replyTo?: { path: string; fieldId: string }[] }
  | { kind: 'open'; url: string } // a link built from the row, like https://wa.me/{Phone}
  | { kind: 'assign'; fieldId: string; among: string[] }; // a person field, filled with the next of these people in turn

export interface ButtonDef {
  label: string;
  color?: string;
  confirm?: boolean; // ask "Are you sure?" first
  ask?: string[]; // fields to fill in before it runs (e.g. "Why lost?")
  who?: 'team' | 'admins'; // who can press it
  showWhen?: TableFilter; // only shown on rows that match
  actions: TableAction[];
}

/** Runs actions by itself: when a row is added, changed, or a field becomes a value. */
export interface TableRule {
  id: string;
  name: string;
  on: 'created' | 'updated' | 'becomes' | 'schedule';
  fieldId?: string; // becomes: this field…
  value?: string; // …becomes this (a choice id, "yes" for a checkbox, or text)
  schedule?: { days: number[]; hour: number; tz: string }; // schedule: these weekdays (0 = Sunday) at this hour, in this time zone
  where?: TableFilter[]; // schedule: only rows that match
  actions: TableAction[];
  enabled: boolean;
}

/** Data arriving at a table's own URL (forms, ads, Zapier, scripts): which incoming key fills which field. */
export interface TableIntake {
  token: string; // the secret part of the URL
  enabled: boolean;
  mapping: Record<string, string>; // incoming key (dot path, e.g. data.email) -> field id
  dedupeField?: string; // same value here = update that row instead of adding one
  sample?: Record<string, unknown>; // the last delivery, flattened, to map from
  listening?: boolean; // waiting for a test delivery: the next one is only captured to map from, no row is made
  testAt?: string; // when the last test delivery arrived
  listenFrom?: string; // when "Listen for a test" was pressed (only a press after the last test counts)
}

export interface TableLogEntry {
  at: string;
  dir: 'in' | 'out';
  ok: boolean;
  text: string; // what happened, in a sentence
  rowId?: string;
}

export interface TableFilter {
  fieldId: string;
  op: 'is' | 'not' | 'has' | 'empty' | 'filled' | 'gt' | 'lt';
  value?: string;
}

export type CalcKind = 'count' | 'filled' | 'empty' | 'percent' | 'sum' | 'avg' | 'min' | 'max' | 'unique';

export interface TableViewDef {
  id: string;
  name: string;
  kind: 'grid' | 'board' | 'list' | 'gallery' | 'calendar';
  groupBy?: string; // board: its columns (a single choice field); grid and list: group rows by any field
  sort?: { fieldId: string; dir: 'asc' | 'desc' }; // older views: one sort
  sorts?: { fieldId: string; dir: 'asc' | 'desc' }[]; // sort by this, then by that
  filters?: TableFilter[];
  filterMode?: 'and' | 'or'; // all conditions, or any
  hidden?: string[]; // field ids not shown in this view
  order?: string[]; // field order in this view (others follow in the table's order)
  widths?: Record<string, number>; // grid column widths
  pinned?: number; // grid: how many columns stay in view when scrolling sideways (default none)
  wrap?: string[]; // grid: fields whose text wraps onto more lines
  calcs?: Record<string, CalcKind>; // grid: a total under each column
  collapsed?: string[]; // grouped: groups folded shut
  dateField?: string; // calendar: which date field places rows
  cover?: string; // gallery and board: the files field whose first picture is the card's cover
  cardFields?: string[]; // board: fields on each card, in order (default: a few useful ones)
  cardSize?: 'compact' | 'roomy'; // board
  hiddenGroups?: string[]; // board: choice columns hidden in this view ('' = the "No status" column)
  hideEmptyGroups?: boolean; // board: columns without cards are hidden
}

export interface DataTable {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  clientId?: string; // belongs to a project; empty = the whole company
  description?: string;
  fields: TableField[]; // the first is the row's name
  views: TableViewDef[];
  rules?: TableRule[];
  intake?: TableIntake;
  signingSecret?: string; // signs outgoing webhooks (X-sprint2go-Signature)
  share?: TableShare; // shown to the project's guests
  page?: { order?: string[]; hidden?: string[]; hideEmpty?: boolean }; // the row page: field order, fields kept off it, empty ones folded
  ruleRuns?: Record<string, string>; // scheduled rule id -> the day it last ran (the server's)
  turns?: Record<string, number>; // "assign in turns": whose turn is next, per person field (the server's)
  log?: TableLogEntry[]; // the last webhook deliveries, both ways
  createdBy: string;
  createdAt: string;
}

export type CellValue = string | number | boolean | string[] | FileRef[] | null;

export interface TableRow {
  id: string;
  workspaceId: string;
  tableId: string;
  values: Record<string, CellValue>;
  order: number; // manual order (new rows go last)
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  comments?: { id: string; by: string; at: string; text: string }[];
  extra?: Record<string, unknown>; // incoming data no field was mapped to (kept, never lost)
  runs?: { fieldId: string; at: string; by: string; ok: boolean; note: string }[]; // button presses on this row
  history?: { by: string; at: string; fieldId: string; from: CellValue; to: CellValue }[];
}

/** What a project's guests get of a table: which fields they see, which they can change, which buttons they can press. */
export interface TableShare {
  enabled: boolean;
  fields: string[]; // visible (the first field, each row's name, always is)
  edit: string[]; // they can change these (a subset of visible)
  buttons: string[]; // Button fields they can press
  add?: boolean; // they can add rows
  download?: boolean; // they can download CSV
}
