// Imports (Settings, Import): what the server says about an import and what the admin picks before it starts. Shared
// by the app (src/components/imports/) and the server (server/imports.ts), so both read the same shapes.

export type ImportSource = 'slack' | 'trello' | 'drive' | 'mail'; // mail: an mbox or a Google Takeout of Gmail (server/importMail.ts)

/**
 * Where an import is: the server reads the upload (reading), waits for the admin's choices (ready), brings it in
 * (running), and ends done or failed. An admin can cancel it before it starts, and undo it for 24 hours after.
 */
export type ImportStatus = 'reading' | 'ready' | 'running' | 'done' | 'failed' | 'undone' | 'cancelled';

/** What happens to someone from the other app who isn't matched to a member here. */
export type PersonAction = 'invite' | 'map' | 'former';

/** Someone from the export: matched to a member here (by email or name), or waiting for the admin's choice. */
export interface ImportPerson {
  key: string; // their id in the other app
  name: string;
  email?: string;
  match?: string; // the member here they were matched to
  how?: 'email' | 'name';
  suggested: PersonAction; // what the choice starts at for someone not matched
  canInvite: boolean; // has an email, isn't a bot or a deleted account
  gone?: boolean; // deactivated in the other app, or a bot
}

/** A Slack conversation in the export. */
export interface ImportChannel {
  key: string;
  name: string;
  kind: 'public' | 'private' | 'dm' | 'group';
  messages: number;
  archived?: boolean;
  into?: string; // a channel here with the same name: its messages go into that one
}

/** A Trello list, and the stage here its cards go to. */
export interface ImportList {
  key: string;
  name: string;
  cards: number;
  archived?: boolean;
  suggested: string; // a stage id
}

export interface ImportPreview {
  source: ImportSource;
  title: string; // the workspace, board or "Google Drive"
  people: ImportPerson[];
  /** Slack: the conversations, their messages and the files they link. */
  channels?: ImportChannel[];
  files?: { linked: number; bytes: number; notInExport: number; big: number; bigBytes: number };
  /** Messages the company's "delete old chat messages" setting would remove on its next run. */
  oldMessages?: { n: number; period: string };
  /** Trello: the board, its lists and cards. */
  board?: { name: string; cards: number; archivedCards: number; comments: number; sameName?: string };
  lists?: ImportList[];
  /** Google Drive (Takeout): what goes into Drive. */
  drive?: { folders: number; files: number; bytes: number; big: number; bigBytes: number; otherParts: string[]; into: 'new' | 'existing' };
  /** Mail (an mbox, or a Google Takeout of Gmail): the messages it holds, and the company's mailboxes it can go into. */
  mail?: { messages: number; bytes: number; mboxes: string[]; tooBig: number; otherParts: string[]; mailboxes: { id: string; email: string; name: string; shared: boolean }[]; suggested?: string };
  /** The company's storage and its "ask before saving big files" size. */
  room: { left: number; total: number; askOverMb: number };
  /** On Free: how many more people can join (null: no limit). */
  seatsLeft: number | null;
}

/** What the admin picked in the preview. */
export interface ImportChoices {
  people: Record<string, { action: PersonAction; userId?: string }>;
  leaveOut?: string[]; // Slack: conversations not to bring in
  stages?: Record<string, string>; // Trello: list key to stage id
  projectId?: string; // Trello: into this project ('' or missing: a new one named after the board)
  archived?: boolean; // Trello: bring archived cards too
  big?: boolean; // save files over the company's "ask before" size
  mailbox?: string; // Mail: the mailbox it goes into
}

export interface ImportProgress {
  phase: string; // what it's doing, in a few words
  done: number;
  total: number;
}

/** What an import made and what it couldn't bring. */
export interface ImportSummary {
  made: { what: string; n: number }[];
  /** Files it couldn't bring, with why (not in the export, couldn't be fetched, too big, no room). */
  missing: { name: string; where: string; why: string; kind?: 'conversation' }[]; // files, unless it says otherwise
  missingMore: number; // beyond the ones listed
  invited: { name: string; email: string; link: string | null }[]; // link: null when they already sign in
  /** After an undo: what it removed, and people it kept because they already joined. */
  removed?: number;
  kept?: string[];
}

export interface ImportJob {
  id: string;
  workspaceId: string;
  source: ImportSource;
  status: ImportStatus;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  undoneAt?: string;
  fileName: string;
  fileSize: number;
  preview?: ImportPreview;
  choices?: ImportChoices;
  progress?: ImportProgress;
  summary?: ImportSummary;
  error?: string;
  /** Until when "Undo this import" works (24 hours after it finished). */
  undoUntil?: string;
}

/** The 24 hours an import can be undone in. */
export const UNDO_HOURS = 24;
export const SOURCE_NAME: Record<ImportSource, string> = { slack: 'Slack', trello: 'Trello', drive: 'Google Drive', mail: 'Gmail or mbox' };
/** The folder a Google Drive import goes into, at the top of Drive. */
export const DRIVE_FOLDER = 'Google Drive import';
