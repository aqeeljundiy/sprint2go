export type FolderId = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';

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
}

/** A meeting proposed inside an email, offered as "Add to calendar". */
export interface Invite {
  title: string;
  start: string; // ISO
  end: string; // ISO
  location?: string;
}

export interface CalendarDef {
  id: string;
  name: string;
  color: string;
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
}

/** Which part of Drive is showing. */
export type DriveSection = 'my' | 'recent' | 'media' | 'email' | 'starred' | 'trash';

export interface Account {
  id: string;
  email: string;
  name: string; // display name on outgoing mail
  kind: 'personal' | 'shared';
  connected: boolean; // false until the mail server is linked
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
}

export type Role = 'owner' | 'admin' | 'member';

export interface Member {
  userId: string;
  role: Role;
}

/** A person who signs in to Elkiya Mail. */
export interface User {
  id: string;
  name: string;
  email: string; // sign-in address
  title: string;
  color: string;
}

export interface Todo {
  id: string;
  title: string;
  due?: string; // YYYY-MM-DD
  done: boolean;
  priority: 'high' | 'normal';
  threadId?: string; // the email it came from
  source: 'ai' | 'manual';
  userId: string;
  createdAt: string;
}

/** Mail from these senders never reaches the inbox (a server-side rule later). */
export interface BlockRule {
  id: string;
  value: string; // an address, or a domain
  kind: 'address' | 'domain';
  at: string;
}
