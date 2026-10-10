// Words and small pieces the import screens share: how to get each export, what an import made, a progress bar.
import { FolderInput, Mail, MessagesSquare, SquareKanban, type LucideIcon } from 'lucide-react';
import { term } from '../../terms';
import { SOURCE_NAME, type ImportJob, type ImportSource, type ImportSummary } from '../../importTypes';
import { mark, t, tn } from '../../i18n';
import { fmtList, fmtNumber, fmtTime, weekdayName } from '../../i18n/format';

export const SOURCE_ICON: Record<ImportSource, LucideIcon> = { slack: MessagesSquare, trello: SquareKanban, drive: FolderInput, mail: Mail };

/**
 * What each source brings, and how to get its export, in the order someone does it. Words are functions, so they come
 * in the language on screen; `accept` is for the file input.
 */
export const HOW: Record<ImportSource, { line: () => string; lead: () => string; steps: () => string[]; accept: string; drop: () => string; wrongFile: () => string; note?: () => string }> = {
  slack: {
    line: () => t('Channels, messages, threads and files from a workspace export'),
    lead: () => t('Channels and their history come over with who wrote what, threads, reactions and files.'),
    steps: () => [
      t('In Slack, open your workspace’s name, then Tools & settings, then Workspace settings.'),
      t('Choose Import/Export Data, then Export, and pick the dates.'),
      t('When Slack emails you, download the zip and drop it here.'),
    ],
    accept: '.zip,application/zip,application/x-zip-compressed',
    drop: () => t('Drop the zip here, or choose it'),
    wrongFile: () => t('That’s not a zip. The export comes as a .zip file.'),
    note: () => t('Private channels and direct messages come over only when your Slack plan put them in the export.'),
  },
  trello: {
    line: () => t('A board becomes a {project}, its cards become tasks', { project: term.one }),
    lead: () => t('The board becomes a {project}. Its cards become tasks with their descriptions, due dates, labels, checklists and comments.', { project: term.one }),
    steps: () => [t('Open the board in Trello, then its menu.'), t('Choose Print, export and share, then Export as JSON.'), t('Save the page that opens as a .json file and drop it here.')],
    accept: '.json,application/json',
    drop: () => t('Drop the JSON file here, or choose it'),
    wrongFile: () => t('That’s not a JSON file. Trello exports a board as a .json file.'),
  },
  drive: {
    line: () => t('Folders and files from a Google Takeout, no Google sign-in'),
    lead: () => t('Your folders and files come over into Drive, in a folder called Google Drive import. Google Docs, Sheets and Slides arrive as Word, Excel and PowerPoint files.'),
    steps: () => [
      t('Go to takeout.google.com and press Deselect all.'),
      t('Tick Drive, then Next step, then Create export.'),
      t('When Google emails you, download the zip and drop it here. A Takeout in several parts goes in one part at a time.'),
    ],
    accept: '.zip,application/zip,application/x-zip-compressed',
    drop: () => t('Drop the zip here, or choose it'),
    wrongFile: () => t('That’s not a zip. The export comes as a .zip file.'),
  },
  // Mail (server/importMail.ts): a Google Takeout of Gmail, or an mbox from a mail app, into one mailbox here.
  mail: {
    line: () => t('Email from a Google Takeout of Gmail, or an mbox file, into a mailbox'),
    lead: () => t('Every email comes over into the mailbox you pick, in the place Gmail had it: Inbox, Sent, archived, Spam or Trash, starred and unread too. Replies join their conversations and attachments come with them.'),
    steps: () => [
      t('Go to takeout.google.com and press Deselect all.'),
      t('Tick Mail, then Next step, then Create export.'),
      t('When Google emails you, download the zip and drop it here. From Thunderbird or Apple Mail, export the mailbox as an .mbox file instead.'),
    ],
    accept: '.zip,.mbox,application/zip,application/x-zip-compressed,application/mbox',
    drop: () => t('Drop the zip or .mbox file here, or choose it'),
    wrongFile: () => t('That’s not a zip or an .mbox file.'),
  },
};

export const title = (s: ImportSource) => t('Import from {source}', { source: SOURCE_NAME[s] });
export const num = (n: number) => fmtNumber(n);

/** What the server calls each thing it made, as a count in the person's words. */
function madeCount(what: string, n: number): string {
  switch (what) {
    case 'channels':
      return tn(n, '{n} channel', '{n} channels');
    case 'direct messages':
      return tn(n, '{n} direct message', '{n} direct messages');
    case 'messages':
      return tn(n, '{n} message', '{n} messages');
    case 'files':
      return tn(n, '{n} file', '{n} files');
    case 'folders':
      return tn(n, '{n} folder', '{n} folders');
    case 'tasks':
      return tn(n, '{n} task', '{n} tasks');
    case 'projects':
      return tn(n, '{n} {project}', '{n} {projects}', { project: term.one, projects: term.many });
    default:
      return `${num(n)} ${what}`;
  }
}

/** "12 channels, 4,210 messages and 36 files", in the company's words. */
export function madeWords(made: ImportSummary['made']): string {
  return fmtList(made.filter((m) => m.what !== 'people invited' && m.n > 0).map((m) => madeCount(m.what, m.n)));
}

/** When Undo stops working, the way people say it: "today at 16:20", "tomorrow at 09:05". */
export function untilWords(iso: string) {
  const d = new Date(iso);
  const time = fmtTime(d);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return t('today at {time}', { time });
  if (days === 1) return t('tomorrow at {time}', { time });
  return t('{day} at {time}', { day: weekdayName(d.getDay()), time });
}

/** The server's own running phases (server/imports.ts, importTrello.ts, importDrive.ts): words, not something it brings in. */
const RUN_PHASES = new Set([mark('Making tasks'), 'Done']);

/** What a running import says it's doing: "Bringing in" what the server is on ("#general", a file's name), or its own phase. */
export function runningWords(phase: string | undefined): string {
  if (!phase || phase === 'Starting') return t('Starting');
  return RUN_PHASES.has(phase) ? t(phase) : t('Bringing in {what}', { what: phase });
}

/** A thin bar for live progress. `share` null: still working, how far isn't known yet. */
export function ProgressBar({ share, label }: { share: number | null; label: string }) {
  return (
    <div className={`imp-bar ${share === null ? 'unknown' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share === null ? undefined : Math.round(share * 100)}>
      <span style={share === null ? undefined : { transform: `scaleX(${Math.max(0.02, Math.min(1, share))})` }} />
    </div>
  );
}

/** How far a reading or running import is, as a share (null before it knows). */
export const shareOf = (job: Pick<ImportJob, 'progress'>) => (job.progress && job.progress.total > 0 ? Math.min(1, job.progress.done / job.progress.total) : null);
