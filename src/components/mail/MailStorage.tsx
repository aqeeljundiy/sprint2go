import { useEffect, useState } from 'react';
import { HardDrive, Paperclip, ShieldAlert, Trash2 } from 'lucide-react';
import type { Workspace } from '../../types';
import { server } from '../../sync';
import { fmtSize } from '../../data/drive';
import { SmoothHeight, TabPane, useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { loadStorage, type StorageInfo } from './teamsApi';
import { BusyButton } from './teamsBits';
import { mark, t, tn } from '../../i18n';
import { fmtDay } from '../../i18n/format';
import './teams.css';

/*
 * Settings, Mail storage (You): what your mail really takes (server/mailStorage.ts), and Google's storage manager:
 * your largest emails and attachments, Spam and Trash, each deleted for good in a step. Mail counts toward the
 * company's storage together with Drive. A mailbox on legal hold can't delete for good; it says so.
 */
export const MAIL_STORAGE_SECTION = { id: 'mailstorage' as const, name: mark('Mail storage'), icon: HardDrive, group: 'You' as const };

type Tab = 'largest' | 'attachments';

export function MailStorage({ ws, onDelete, onEmpty, onOpen }: { ws: Workspace; onDelete: (threadIds: string[]) => void; onEmpty: (where: 'spam' | 'trash') => void; onOpen?: (threadId: string) => void }) {
  const [info, setInfo] = useState<StorageInfo | null | 'failed'>(null);
  const [tab, setTab] = useState<Tab>('largest');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const load = () => void loadStorage(ws.id).then((d) => (setInfo(d), setGone(new Set())), () => setInfo('failed'));
  useEffect(() => {
    if (server.on) load();
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = info && info !== 'failed' ? info : null;
  const largest = useLeaving((d?.largest ?? []).filter((x) => !gone.has(x.threadId)), (x) => x.threadId);
  const files = useLeaving((d?.attachments ?? []).filter((x) => !gone.has(x.threadId)), (x) => `${x.threadId}:${x.name}`);
  if (!server.on)
    return (
      <>
        <h2>{t('Mail storage')}</h2>
        <p className="set-intro">{t('See what your mail takes and clean it up. This works with sprint2go on a server; this demo has none.')}</p>
      </>
    );
  const held = (accountId: string) => !!d?.held.includes(accountId);
  const del = (ids: string[]) => {
    onDelete(ids);
    setGone((g) => new Set([...g, ...ids]));
    setPicked(new Set());
    setTimeout(load, 1500);
  };
  const share = d && d.company.total ? Math.min(1, d.company.used / d.company.total) : 0;
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const pickedHeld = [...picked].some((id) => held(d?.largest.find((x) => x.threadId === id)?.accountId ?? d?.attachments.find((x) => x.threadId === id)?.accountId ?? ''));
  return (
    <>
      <h2>{t('Mail storage')}</h2>
      <p className="set-intro">{t('Your mail counts toward the company’s storage, with Drive. Delete what you don’t need: big emails, old attachments, Spam and Trash.')}</p>
      <SmoothHeight>
        {info === null ? (
          <p className="muted small">{t('Checking…')}</p>
        ) : !d ? (
          <p className="set-hint">{t('Couldn’t check right now. Try again in a moment.')}</p>
        ) : (
          <div className="mx-sections">
            <section className="set-block">
              <h3>{t('Your mail')}</h3>
              {d.mailboxes.map((m) => (
                <div key={m.id} className="set-row">
                  <span>
                    <strong>{m.email}</strong>
                    <small>{m.attachments ? t('{size}, of which attachments {files}', { size: fmtSize(m.bytes), files: fmtSize(m.attachments) }) : fmtSize(m.bytes)}</small>
                  </span>
                  {held(m.id) && <span className="badge is-warn sm">{t('Legal hold')}</span>}
                </div>
              ))}
              <div className="set-row mx-meter-row">
                <span>
                  <strong>{t('The company’s storage')}</strong>
                  <small>{t('{used} of {total} used, {mail} of it mail', { used: fmtSize(d.company.used), total: fmtSize(d.company.total), mail: fmtSize(d.company.mail) })}</small>
                  <span className="mx-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={t('The company’s storage')}>
                    <span style={{ transform: `scaleX(${Math.max(0.01, share)})` }} />
                  </span>
                </span>
              </div>
            </section>
            <section className="set-block">
              <h3>{t('Spam and Trash')}</h3>
              {(['spam', 'trash'] as const).map((w) => {
                const x = d[w];
                return (
                  <div key={w} className="set-row">
                    <span className="mx-row-icon">
                      {w === 'spam' ? <ShieldAlert size={16} /> : <Trash2 size={16} />}
                      <span>
                        <strong>{w === 'spam' ? t('Spam') : t('Trash')}</strong>
                        <small>{x.count ? t('{emails}, {size}', { emails: tn(x.count, '{n} conversation', '{n} conversations'), size: fmtSize(x.bytes) }) : t('Empty')}</small>
                      </span>
                    </span>
                    <button type="button" className="ghost-btn outline sm" disabled={!x.count} onClick={() => (onEmpty(w), setTimeout(load, 1500))}>
                      {w === 'spam' ? t('Empty Spam') : t('Empty Trash')}
                    </button>
                  </div>
                );
              })}
            </section>
            <section className="set-block">
              <h3>{t('Clean up')}</h3>
              <div className="segmented mx-tabs" role="tablist" aria-label={t('Clean up')}>
                <button type="button" role="tab" aria-selected={tab === 'largest'} className={tab === 'largest' ? 'on' : ''} onClick={() => (setTab('largest'), setPicked(new Set()))}>
                  {t('Largest emails')}
                </button>
                <button type="button" role="tab" aria-selected={tab === 'attachments'} className={tab === 'attachments' ? 'on' : ''} onClick={() => (setTab('attachments'), setPicked(new Set()))}>
                  {t('Big attachments')}
                </button>
              </div>
              <SmoothHeight>
                <TabPane key={tab}>
                  <div className="acct-list mx-clean">
                    {tab === 'largest' &&
                      (largest.length ? (
                        largest.map(({ item: x, leaving }) => (
                          <label key={x.threadId} className={`acct-row mx-clean-row ${leaving ? 'row-leaving' : ''}`}>
                            <input type="checkbox" className="mx-check" checked={picked.has(x.threadId)} onChange={() => toggle(x.threadId)} aria-label={t('Pick {subject}', { subject: x.subject })} />
                            <span className="acct-info">
                              <strong>{x.subject || t('(no subject)')}</strong>
                              <small>{t('{from}, {date}', { from: x.from, date: fmtDay(x.date) })}</small>
                            </span>
                            <span className="mx-size">{fmtSize(x.bytes)}</span>
                            {onOpen && (
                              <button type="button" className="link-btn small" onClick={(e) => (e.preventDefault(), onOpen(x.threadId))}>
                                {t('Open')}
                              </button>
                            )}
                          </label>
                        ))
                      ) : (
                        <EmptyState compact text={t('No mail yet.')} />
                      ))}
                    {tab === 'attachments' &&
                      (files.length ? (
                        files.map(({ item: x, leaving }) => (
                          <label key={`${x.threadId}:${x.name}`} className={`acct-row mx-clean-row ${leaving ? 'row-leaving' : ''}`}>
                            <input type="checkbox" className="mx-check" checked={picked.has(x.threadId)} onChange={() => toggle(x.threadId)} aria-label={t('Pick {subject}', { subject: x.name })} />
                            <Paperclip size={15} className="mx-clip" />
                            <span className="acct-info">
                              <strong>{x.name}</strong>
                              <small>{t('In “{subject}”, {date}', { subject: x.subject || t('(no subject)'), date: fmtDay(x.date) })}</small>
                            </span>
                            <span className="mx-size">{fmtSize(x.bytes)}</span>
                          </label>
                        ))
                      ) : (
                        <EmptyState compact text={t('No attachments over 100 KB.')} />
                      ))}
                  </div>
                </TabPane>
              </SmoothHeight>
              <div className={`fold ${picked.size ? 'open' : ''}`}>
                <div className="fold-in">
                  <div className="mx-actions">
                    <small>{pickedHeld ? t('A mailbox on legal hold keeps its mail: those emails stay.') : tab === 'attachments' ? t('The whole email goes, with its attachments.') : t('Deleted for good, for everyone on the mailbox.')}</small>
                    <BusyButton className="primary-btn sm danger" onClick={() => del([...picked])}>
                      {tn(picked.size, 'Delete {n} conversation for good', 'Delete {n} conversations for good')}
                    </BusyButton>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </SmoothHeight>
    </>
  );
}
