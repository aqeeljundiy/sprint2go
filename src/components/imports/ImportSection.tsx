import { useEffect, useState } from 'react';
import type { ImportJob, ImportSource } from '../../importTypes';
import { SOURCE_NAME } from '../../importTypes';
import type { User, Workspace } from '../../types';
import { stagesFor } from '../../stages';
import { relative } from '../../utils';
import { Badge } from '../ui/Person';
import { Layer } from '../ui/Layer';
import { listImports } from './importApi';
import { ImportDialog } from './ImportDialog';
import { HOW, ProgressBar, SOURCE_ICON, madeWords, shareOf, untilWords } from './importWords';
import './imports.css';

const SOURCES: ImportSource[] = ['slack', 'trello', 'drive'];
const live = (j: ImportJob) => j.status === 'reading' || j.status === 'running';

/** What one import is doing, in a line. */
function statusLine(j: ImportJob): string {
  switch (j.status) {
    case 'reading':
      return j.progress?.phase ?? 'Reading the file';
    case 'ready':
      return 'Waiting for you to check it and start';
    case 'running':
      return j.progress?.phase && j.progress.phase !== 'Starting' ? `Bringing in ${j.progress.phase}` : 'Starting';
    case 'done': {
      const made = j.summary ? madeWords(j.summary.made) : '';
      return `${made ? `${made}, ` : 'Done '}${relative(j.finishedAt ?? j.createdAt)}`;
    }
    case 'failed':
      return j.error ?? 'It stopped';
    case 'undone':
      return `Undone ${relative(j.undoneAt ?? j.createdAt)}`;
    default:
      return 'Cancelled';
  }
}

/**
 * Settings, Import (owners and admins): bring a team's history over from Slack, Trello or Google Drive. Each import is
 * a dialog of its own (ImportDialog); this lists the company's recent ones, with the one going on and its progress,
 * so someone who left the page finds it again.
 */
export function ImportSection({ ws, members, projects, toast }: { ws: Workspace; members: User[]; projects: { id: string; name: string; color: string }[]; toast: (text: string) => void }) {
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [caps, setCaps] = useState<{ upload: number; json: number } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ source: ImportSource; job?: ImportJob } | null>(null);

  const load = () =>
    listImports(ws.id).then(
      (d) => {
        setJobs(d.jobs);
        setCaps(d.limits);
        setError('');
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    setJobs(null);
    void load();
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While one is being read or run, keep its progress fresh.
  const anyLive = !!jobs?.some(live);
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [anyLive, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (j: ImportJob) => setJobs((list) => (list ? [j, ...list.filter((x) => x.id !== j.id)].filter((x) => x.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [j]));
  // One import at a time: one being read or run holds the others back. A preview waiting for its admin doesn't (a
  // new upload takes its place), but its source opens it again instead of starting over.
  const busy = jobs?.find(live);
  const waiting = (s: ImportSource) => jobs?.find((j) => j.source === s && (live(j) || j.status === 'ready'));

  return (
    <>
      <h2>Import</h2>
      <p className="set-intro">Bring your team’s history over from Slack, Trello or Google Drive. You check what comes in before anything is made, and you can undo an import for a day after.</p>
      <div className="acct-list imp-sources">
        {SOURCES.map((s) => {
          const Icon = SOURCE_ICON[s];
          const mine = waiting(s);
          const held = !!busy && busy.source !== s;
          return (
            <div key={s} className="acct-row imp-source">
              <span className="acct-icon">
                <Icon size={16} />
              </span>
              <span className="acct-info">
                <strong>{SOURCE_NAME[s]}</strong>
                <small>{HOW[s].line()}</small>
              </span>
              <button type="button" className="ghost-btn sm" disabled={held} title={held ? 'Another import is going on' : undefined} onClick={() => setOpen(mine ? { source: s, job: mine } : { source: s })}>
                {mine ? 'Open' : 'Import'}
              </button>
            </div>
          );
        })}
      </div>
      {busy && <p className="set-hint">One import at a time: the others can start once this one is done.</p>}
      {error && <p className="err">{error}</p>}

      {!!jobs?.length && (
        <>
          <h3>Recent imports</h3>
          <div className="acct-list imp-recent">
            {jobs.map((j) => {
              const Icon = SOURCE_ICON[j.source];
              return (
                <div key={j.id} className="acct-row imp-job">
                  <span className="acct-icon">
                    <Icon size={16} />
                  </span>
                  <span className="acct-info">
                    <strong>
                      {SOURCE_NAME[j.source]}
                      <span className="imp-file-name">{j.preview?.board?.name ?? j.fileName}</span>
                      {j.status === 'failed' && (
                        <Badge small tone="bad">
                          Stopped
                        </Badge>
                      )}
                    </strong>
                    <small>{statusLine(j)}</small>
                    {live(j) && <ProgressBar share={shareOf(j)} label={`${SOURCE_NAME[j.source]} import`} />}
                    {j.undoUntil && <small className="imp-undo-hint">Can be undone until {untilWords(j.undoUntil)}</small>}
                  </span>
                  {j.status !== 'cancelled' && (
                    <button type="button" className="ghost-btn sm" onClick={() => setOpen({ source: j.source, job: j })}>
                      {j.status === 'ready' ? 'Continue' : 'Open'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {open && (
        <Layer>
          <ImportDialog
            source={open.source}
            workspaceId={ws.id}
            job={open.job}
            members={members}
            stages={stagesFor(ws.id)}
            projects={projects}
            maxUpload={caps ? (open.source === 'trello' ? Math.min(caps.upload, caps.json) : caps.upload) : null}
            onChanged={changed}
            onClose={() => (setOpen(null), void load())}
            toast={toast}
          />
        </Layer>
      )}
    </>
  );
}
