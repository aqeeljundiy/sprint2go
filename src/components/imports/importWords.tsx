// Words and small pieces the import screens share: how to get each export, what an import made, a progress bar.
import { FolderInput, MessagesSquare, SquareKanban, type LucideIcon } from 'lucide-react';
import { term } from '../../terms';
import { SOURCE_NAME, type ImportJob, type ImportSource, type ImportSummary } from '../../importTypes';

export const SOURCE_ICON: Record<ImportSource, LucideIcon> = { slack: MessagesSquare, trello: SquareKanban, drive: FolderInput };

/** What each source brings, and how to get its export, in the order someone does it. */
export const HOW: Record<ImportSource, { line: () => string; lead: () => string; steps: string[]; accept: string; kind: string; note?: string }> = {
  slack: {
    line: () => 'Channels, messages, threads and files from a workspace export',
    lead: () => 'Channels and their history come over with who wrote what, threads, reactions and files.',
    steps: [
      'In Slack, open your workspace’s name, then Tools & settings, then Workspace settings.',
      'Choose Import/Export Data, then Export, and pick the dates.',
      'When Slack emails you, download the zip and drop it here.',
    ],
    accept: '.zip,application/zip,application/x-zip-compressed',
    kind: 'zip',
    note: 'Private channels and direct messages come over only when your Slack plan put them in the export.',
  },
  trello: {
    line: () => `A board becomes a ${term.one}, its cards become tasks`,
    lead: () => `The board becomes a ${term.one}. Its cards become tasks with their descriptions, due dates, labels, checklists and comments.`,
    steps: ['Open the board in Trello, then its menu.', 'Choose Print, export and share, then Export as JSON.', 'Save the page that opens as a .json file and drop it here.'],
    accept: '.json,application/json',
    kind: 'JSON file',
  },
  drive: {
    line: () => 'Folders and files from a Google Takeout, no Google sign-in',
    lead: () => 'Your folders and files come over into Drive, in a folder called Google Drive import. Google Docs, Sheets and Slides arrive as Word, Excel and PowerPoint files.',
    steps: [
      'Go to takeout.google.com and press Deselect all.',
      'Tick Drive, then Next step, then Create export.',
      'When Google emails you, download the zip and drop it here. A Takeout in several parts goes in one part at a time.',
    ],
    accept: '.zip,application/zip,application/x-zip-compressed',
    kind: 'zip',
  },
};

export const title = (s: ImportSource) => `Import from ${SOURCE_NAME[s]}`;
export const num = (n: number) => n.toLocaleString('en');
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

/** "12 channels, 4,210 messages and 36 files", in the company's words. */
export function madeWords(made: ImportSummary['made']): string {
  const words: Record<string, [string, string]> = {
    channels: ['channel', 'channels'],
    'direct messages': ['direct message', 'direct messages'],
    messages: ['message', 'messages'],
    files: ['file', 'files'],
    folders: ['folder', 'folders'],
    tasks: ['task', 'tasks'],
    projects: [term.one, term.many],
  };
  const parts = made.filter((m) => m.what !== 'people invited' && m.n > 0).map((m) => plural(m.n, ...(words[m.what] ?? [m.what, m.what])));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** When Undo stops working, the way people say it: "today at 16:20", "tomorrow at 09:05". */
export function untilWords(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  return `${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' })} at ${time}`;
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
