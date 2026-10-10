import { useEffect, useState } from 'react';
import { usePhone } from '../../mobile/media';
import { GRow, Group } from '../ui/Grouped';
import type { ImportJob, ImportSource } from '../../importTypes';
import { SOURCE_NAME } from '../../importTypes';
import type { User, Workspace } from '../../types';
import { stagesFor } from '../../stages';
import { relative } from '../../utils';
import { Badge } from '../ui/Person';
import { Layer } from '../ui/Layer';
import { listImports } from './importApi';
import { ImportDialog } from './ImportDialog';
import { HOW, ProgressBar, SOURCE_ICON, madeWords, runningWords, shareOf, untilWords } from './importWords';
import { t } from '../../i18n';
import './imports.css';

const SOURCES: ImportSource[] = ['slack', 'trello', 'drive', 'mail'];
const live = (j: ImportJob) => j.status === 'reading' || j.status === 'running';

/** What one import is doing, in a line. */
function statusLine(j: ImportJob): string {
  switch (j.status) {
    case 'reading':
      return t(j.progress?.phase ?? 'Reading the file');
    case 'ready':
      return t('Waiting for you to check it and start');
    case 'running':
      return runningWords(j.progress?.phase);
    case 'done': {
      const made = j.summary ? madeWords(j.summary.made) : '';
      const when = relative(j.finishedAt ?? j.createdAt);
      return made ? t('{made}, {when}', { made, when }) : t('Done {when}', { when });
    }
    case 'failed':
      return t(j.error ?? 'It stopped');
    case 'undone':
      return t('Undone {when}', { when: relative(j.undoneAt ?? j.createdAt) });
    default:
      return t('Cancelled');
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
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [anyLive, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (j: ImportJob) => setJobs((list) => (list ? [j, ...list.filter((x) => x.id !== j.id)].filter((x) => x.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [j]));
  // One import at a time: one being read or run holds the others back. A preview waiting for its admin doesn't (a
  // new upload takes its place), but its source opens it again instead of starting over.
  const busy = jobs?.find(live);
  const waiting = (s: ImportSource) => jobs?.find((j) => j.source === s && (live(j) || j.status === 'ready'));

  const phone = usePhone();
  const dialog = open && (
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
  );
  // Phones (iOS Settings): a row per source and per recent import; tapping one opens its import.
  if (phone)
    return (
      <>
        <h2>{t('Import')}</h2>
        <div className="set-rows">
          <Group footer={busy ? t('One import at a time: the others can start once this one is done.') : t('Bring your team’s history over from Slack, Trello, Google Drive or Gmail. You check what comes in before anything is made, and you can undo an import for a day after.')}>
            {SOURCES.map((s) => {
              const Icon = SOURCE_ICON[s];
              const mine = waiting(s);
              const held = !!busy && busy.source !== s;
              return <GRow key={s} pic={<span className="acct-icon"><Icon size={20} /></span>} label={SOURCE_NAME[s]} sub={HOW[s].line()} value={mine ? t('Open') : undefined} className={held ? 'is-off' : ''} onClick={held ? undefined : () => setOpen(mine ? { source: s, job: mine } : { source: s })} />;
            })}
          </Group>
          {error && <p className="g-foot g-err">{t(error)}</p>}
          {!!jobs?.length && (
            <Group title={t('Recent imports')}>
              {jobs.map((j) => {
                const Icon = SOURCE_ICON[j.source];
                return (
                  <GRow
                    key={j.id}
                    pic={<span className="acct-icon"><Icon size={20} /></span>}
                    label={`${SOURCE_NAME[j.source]} · ${j.preview?.board?.name ?? j.fileName}`}
                    sub={j.undoUntil ? `${statusLine(j)}. ${t('Can be undone until {when}', { when: untilWords(j.undoUntil) })}` : statusLine(j)}
                    value={j.status === 'failed' ? t('Stopped') : j.status === 'ready' ? t('Continue') : undefined}
                    onClick={j.status !== 'cancelled' ? () => setOpen({ source: j.source, job: j }) : undefined}
                  />
                );
              })}
            </Group>
          )}
        </div>
        {dialog}
      </>
    );
  return (
    <>
      <h2>{t('Import')}</h2>
      <p className="set-intro">{t('Bring your team’s history over from Slack, Trello, Google Drive or Gmail. You check what comes in before anything is made, and you can undo an import for a day after.')}</p>
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
              <button type="button" className="ghost-btn sm" disabled={held} title={held ? t('Another import is going on') : undefined} onClick={() => setOpen(mine ? { source: s, job: mine } : { source: s })}>
                {mine ? t('Open') : t('Import')}
              </button>
            </div>
          );
        })}
      </div>
      {busy && <p className="set-hint">{t('One import at a time: the others can start once this one is done.')}</p>}
      {error && <p className="err">{t(error)}</p>}

      {!!jobs?.length && (
        <>
          <h3>{t('Recent imports')}</h3>
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
                          {t('Stopped')}
                        </Badge>
                      )}
                    </strong>
                    <small>{statusLine(j)}</small>
                    {live(j) && <ProgressBar share={shareOf(j)} label={t('{source} import', { source: SOURCE_NAME[j.source] })} />}
                    {j.undoUntil && <small className="imp-undo-hint">{t('Can be undone until {when}', { when: untilWords(j.undoUntil) })}</small>}
                  </span>
                  {j.status !== 'cancelled' && (
                    <button type="button" className="ghost-btn sm" onClick={() => setOpen({ source: j.source, job: j })}>
                      {j.status === 'ready' ? t('Continue') : t('Open')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {dialog}
    </>
  );
}
