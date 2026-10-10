import { useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleCheck, Copy, FileArchive, RotateCcw, TriangleAlert, Upload, X } from 'lucide-react';
import { SOURCE_NAME, type ImportChoices, type ImportJob, type ImportSource } from '../../importTypes';
import type { TaskStage, User } from '../../types';
import { fmtSize } from '../../data/drive';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { cancelImport, getImport, startImport, undoCheck, undoImport, uploadImport } from './importApi';
import { ImportPreviewStep, blocker } from './ImportPreview';
import { HOW, ProgressBar, SOURCE_ICON, madeWords, num, runningWords, shareOf, title, untilWords } from './importWords';
import { mark, t, tn } from '../../i18n';
import { fmtList, fmtPercent } from '../../i18n/format';

interface Props {
  source: ImportSource;
  workspaceId: string;
  job?: ImportJob; // an import already under way (or done), opened from Settings
  members: User[];
  stages: TaskStage[];
  projects: { id: string; name: string; color: string }[];
  maxUpload: number | null;
  onChanged: (job: ImportJob) => void;
  onClose: () => void;
  toast: (text: string) => void;
}

type Step = 'pick' | 'uploading' | 'reading' | 'preview' | 'running' | 'summary';
const STEPS: { key: string; label: string; of: Step[] }[] = [
  { key: 'up', label: mark('Upload'), of: ['pick', 'uploading', 'reading'] },
  { key: 'check', label: mark('Check'), of: ['preview'] },
  { key: 'run', label: mark('Import'), of: ['running', 'summary'] },
];

/** The choices a preview starts with: matches kept, the server's suggestions, everything in, big files out. */
function startingChoices(job: ImportJob): ImportChoices {
  const p = job.preview!;
  return {
    people: Object.fromEntries(p.people.map((x) => [x.key, x.match ? { action: 'map' as const, userId: x.match } : { action: x.suggested }])),
    leaveOut: [],
    stages: Object.fromEntries((p.lists ?? []).map((l) => [l.key, l.suggested])),
    projectId: p.board?.sameName ?? '',
    archived: false,
    big: false,
    mailbox: p.mail?.suggested ?? p.mail?.mailboxes[0]?.id,
  };
}

/**
 * One import, start to end, in one dialog: upload the export, wait while the server reads it, check the preview and
 * make the choices it needs, start, watch it (or close and come back: it runs on the server), then the summary with
 * Undo for 24 hours.
 */
export function ImportDialog({ source, workspaceId, job: initial, members, stages, projects, maxUpload, onChanged, onClose, toast }: Props) {
  const [job, setJob] = useState<ImportJob | null>(initial ?? null);
  const [upload, setUpload] = useState<{ name: string; size: number; share: number; abort: () => void } | null>(null);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<ImportChoices | null>(initial?.status === 'ready' && initial.preview ? startingChoices(initial) : null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [undoAsk, setUndoAsk] = useState<number | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const how = HOW[source];
  const Icon = SOURCE_ICON[source];

  // A file that couldn't be read goes back to the first step, with why, so another file can go in.
  const unreadable = job?.status === 'failed' && !job.startedAt;
  const step: Step = !job || unreadable ? (upload ? 'uploading' : 'pick') : job.status === 'reading' ? 'reading' : job.status === 'ready' ? 'preview' : job.status === 'running' ? 'running' : 'summary';
  const update = (j: ImportJob) => {
    setJob(j);
    onChanged(j);
    if (j.status === 'ready' && j.preview) setChoices((c) => c ?? startingChoices(j));
  };

  // While the server reads or runs it, look again every moment.
  useEffect(() => {
    if (!job || (job.status !== 'reading' && job.status !== 'running')) return;
    let stop = false;
    const timer = setInterval(() => {
      void getImport(job.id).then(
        (j) => !stop && update(j),
        () => {},
      );
    }, 800);
    return () => ((stop = true), clearInterval(timer));
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    upload?.abort();
    onClose();
  };

  const send = (file: File) => {
    setError('');
    if (unreadable) setJob(null);
    const lower = file.name.toLowerCase();
    if (source === 'trello' ? !lower.endsWith('.json') : source === 'mail' ? !lower.endsWith('.zip') && !lower.endsWith('.mbox') : !lower.endsWith('.zip'))
      return setError(how.wrongFile());
    if (maxUpload && file.size > maxUpload) return setError(t('That file is {size}; imports take up to {max}.', { size: fmtSize(file.size), max: fmtSize(maxUpload) }));
    const up = uploadImport(workspaceId, source, file, (share) => setUpload((u) => (u ? { ...u, share } : u)));
    setUpload({ name: file.name, size: file.size, share: 0, abort: up.abort });
    up.done.then(
      (j) => {
        setUpload(null);
        update(j);
      },
      (e: Error) => {
        setUpload(null);
        if (e.message !== 'aborted') setError(e.message);
      },
    );
  };

  const start = async () => {
    if (!job || !choices) return;
    setBusy(true);
    setError('');
    try {
      update(await startImport(job.id, choices));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!job) return onClose();
    setBusy(true);
    try {
      onChanged(await cancelImport(job.id));
    } catch {
      /* already gone: closing is what they wanted */
    }
    setBusy(false);
    onClose();
  };
  const askUndo = async () => {
    if (!job) return;
    try {
      setUndoAsk(await undoCheck(job.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const undo = async () => {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      update(await undoImport(job.id));
      setUndoAsk(null);
      toast(t('The {source} import is undone', { source: SOURCE_NAME[source] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = choices && job?.preview ? blocker(job.preview, choices) : null;
  const summary = job?.summary;
  const made = summary ? madeWords(summary.made) : '';

  return (
    <div className="modal-scrim" onMouseDown={() => step !== 'uploading' && close()}>
      <div className="modal imp-modal" role="dialog" aria-modal="true" aria-label={title(source)} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && step !== 'uploading' && close()}>
        <header className="modal-head">
          <span className="dump-title">
            <Icon size={15} /> {title(source)}
          </span>
          <button type="button" className="icon-btn sm" onClick={close} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <ol className="imp-steps" aria-label={t('Steps')}>
            {STEPS.map((s, i) => {
              // A finished import has all three ticked.
              const at = step === 'summary' && job?.status === 'done' ? STEPS.length : STEPS.findIndex((x) => x.of.includes(step));
              return (
                <li key={s.key} className={i === at ? 'on' : i < at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}>
                  <span className="imp-step-n">{i < at ? <CircleCheck size={14} /> : i + 1}</span>
                  {t(s.label)}
                </li>
              );
            })}
          </ol>
          <SmoothHeight>
            <TabPane key={step}>
              <div className="imp-step">
                {step === 'pick' && (
                  <>
                    <p className="imp-lead">{how.lead()}</p>
                    <ol className="imp-how">
                      {how.steps().map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      className={`imp-drop${over ? ' over' : ''}`}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => (e.preventDefault(), setOver(true))}
                      onDragLeave={() => setOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) send(f);
                      }}
                    >
                      <Upload size={20} />
                      <strong>{how.drop()}</strong>
                      <small>{maxUpload ? t('Up to {size}. You check what comes in before anything is made.', { size: fmtSize(maxUpload) }) : t('You check what comes in before anything is made.')}</small>
                    </button>
                    <input ref={fileRef} type="file" accept={how.accept} hidden onChange={(e) => (e.target.files?.[0] && send(e.target.files[0]), (e.target.value = ''))} />
                    {how.note && <p className="imp-note">{how.note()}</p>}
                  </>
                )}
                {step === 'uploading' && upload && (
                  <div className="imp-live">
                    <span className="imp-file">
                      <FileArchive size={18} />
                      <span>
                        <strong>{upload.name}</strong>
                        <small>{fmtSize(upload.size)}</small>
                      </span>
                    </span>
                    <ProgressBar share={upload.share} label={t('Uploading')} />
                    <p className="imp-line muted">{upload.share >= 1 ? t('Uploaded. Opening it…') : t('Uploading, {percent}. Keep this open until it’s up.', { percent: fmtPercent(upload.share) })}</p>
                  </div>
                )}
                {step === 'reading' && job && (
                  <div className="imp-live">
                    <p className="imp-phase">{t(job.progress?.phase ?? 'Reading the file')}</p>
                    <ProgressBar share={shareOf(job)} label={t('Reading the export')} />
                    <p className="imp-line muted">{t('Looking through it to show you what comes in. Nothing is made yet.')}</p>
                  </div>
                )}
                {step === 'preview' && job?.preview && choices && <ImportPreviewStep preview={job.preview} choices={choices} onChoices={setChoices} members={members} stages={stages} projects={projects} />}
                {step === 'running' && job && (
                  <div className="imp-live">
                    <p className="imp-phase">{runningWords(job.progress?.phase)}</p>
                    <ProgressBar share={shareOf(job)} label={t('Importing')} />
                    <p className="imp-line muted">{t('You can close this. It keeps going on the server, and you’ll get a notification when it’s done.')}</p>
                  </div>
                )}
                {step === 'summary' && job && (
                  <div className="imp-summary">
                    {job.status === 'done' && (
                      <p className="imp-result ok">
                        <CircleCheck size={18} />
                        <span>{made ? t('{made} came over.', { made }) : t('Done. There was nothing new to bring over.')}</span>
                      </p>
                    )}
                    {job.status === 'failed' && (
                      <p className="imp-result bad">
                        <TriangleAlert size={18} />
                        <span>
                          {t(job.error ?? 'It stopped.')}
                          {made ? ` ${t('Before it stopped: {made}.', { made })}` : ''}
                        </span>
                      </p>
                    )}
                    {job.status === 'undone' && (
                      <p className="imp-result">
                        <RotateCcw size={18} />
                        <span>
                          {t('Undone: everything it made was removed.')}
                          {summary?.kept?.length ? ` ${t('{names} already joined, so they stay on the team.', { names: fmtList(summary.kept) })}` : ''}
                        </span>
                      </p>
                    )}
                    {job.status === 'cancelled' && <p className="imp-result">{t('This import was cancelled before it started.')}</p>}
                    {job.status !== 'undone' && summary && summary.invited.length > 0 && (
                      <section className="imp-sec">
                        <h4>{t('Invited')}</h4>
                        <p className="imp-line muted">{t('Send each their link to pick a password. Links work for 7 days.')}</p>
                        <div className="imp-list" role="list">
                          {summary.invited.map((x) => (
                            <div key={x.email} role="listitem" className="imp-row">
                              <span className="imp-row-text">
                                <strong>{x.name}</strong>
                                <small>{x.email}</small>
                              </span>
                              {x.link ? (
                                <button
                                  type="button"
                                  className="ghost-btn sm"
                                  onClick={() => void navigator.clipboard?.writeText(`${location.origin}${x.link}`).then(() => toast(t('{name}’s invite link is copied', { name: x.name.split(' ')[0] })))}
                                >
                                  <Copy size={13} /> {t('Copy link')}
                                </button>
                              ) : (
                                <small className="muted">{t('Already signs in')}</small>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {job.status !== 'undone' && summary && summary.missing.length > 0 && (
                      <section className="imp-sec">
                        <button type="button" className="imp-fold-btn" aria-expanded={showMissing} onClick={() => setShowMissing((x) => !x)}>
                          <ChevronRight size={14} className={`rot-chev ${showMissing ? 'open' : ''}`} />
                          {(() => {
                            const n = summary.missing.length + summary.missingMore;
                            const files = summary.missing.every((m) => m.kind !== 'conversation');
                            return files ? tn(n, '{n} file didn’t come over', '{n} files didn’t come over') : tn(n, '{n} thing didn’t come over', '{n} things didn’t come over');
                          })()}
                        </button>
                        <div className={`fold ${showMissing ? 'open' : ''}`}>
                          <div className="fold-in">
                            <div className="imp-list imp-missing" role="list">
                              {summary.missing.map((m, i) => (
                                <div key={`${m.name}-${i}`} role="listitem" className="imp-row">
                                  <span className="imp-row-text">
                                    <strong>{m.name}</strong>
                                    <small>
                                      {m.where ? `${t(m.where)}: ` : ''}
                                      {t(m.why)}
                                    </small>
                                  </span>
                                </div>
                              ))}
                              {summary.missingMore > 0 && <p className="imp-line muted">{t('And {n} more.', { n: num(summary.missingMore) })}</p>}
                            </div>
                          </div>
                        </div>
                      </section>
                    )}
                    {job.undoUntil && (
                      <section className="imp-sec imp-undo">
                        {undoAsk === null ? (
                          <p className="imp-line muted">
                            {job.status === 'failed'
                              ? t('It made a few things before it stopped. You can take them out until {when}.', { when: untilWords(job.undoUntil) })
                              : t('Not what you wanted? You can undo it until {when}.', { when: untilWords(job.undoUntil) })}{' '}
                            <button type="button" className="link-btn small" onClick={() => void askUndo()}>
                              {job.status === 'failed' ? t('Undo what it made') : t('Undo this import')}
                            </button>
                          </p>
                        ) : (
                          <div className="imp-confirm">
                            <p className="imp-line">
                              {undoAsk > 0
                                ? tn(
                                    undoAsk,
                                    'Undo removes everything this import made, and {n} thing people added inside it since. People it invited who already joined stay.',
                                    'Undo removes everything this import made, and {n} things people added inside it since. People it invited who already joined stay.',
                                  )
                                : t('Undo removes everything this import made. People it invited who already joined stay.')}
                            </p>
                            <div className="imp-confirm-actions">
                              <button type="button" className="ghost-btn sm" onClick={() => setUndoAsk(null)} disabled={busy}>
                                {t('Keep it')}
                              </button>
                              <button type="button" className="ghost-btn sm danger-text" onClick={() => void undo()} disabled={busy}>
                                {busy ? t('Undoing…') : t('Undo import')}
                              </button>
                            </div>
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                )}
                {(error || (unreadable && step === 'pick' && job?.error)) && <p className="err">{t(error || job?.error || '')}</p>}
                {step === 'preview' && stop && <p className="imp-note warn">{stop}</p>}
              </div>
            </TabPane>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {step === 'preview' ? (
            <>
              <button type="button" className="ghost-btn" onClick={() => void cancel()} disabled={busy}>
                {t('Cancel import')}
              </button>
              <span className="spacer" />
              <button type="button" className="primary-btn" onClick={() => void start()} disabled={busy || !!stop}>
                {busy ? t('Starting…') : t('Start import')}
              </button>
            </>
          ) : step === 'uploading' ? (
            <button type="button" className="ghost-btn" onClick={() => (upload?.abort(), setUpload(null))}>
              {t('Stop upload')}
            </button>
          ) : step === 'summary' ? (
            <button type="button" className="primary-btn" onClick={close}>
              {t('Done')}
            </button>
          ) : (
            <button type="button" className="ghost-btn" onClick={close}>
              {step === 'pick' ? t('Cancel') : t('Close')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
