import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Building2, Check, Copy, Loader2, RefreshCw, Upload } from 'lucide-react';
import type { DomainCheck, DomainStatus, WhiteLabel, Workspace } from '../../types';
import { term } from '../../terms';
import { caps } from '../../caps';
import { server } from '../../sync';
import { relative } from '../../utils';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { mark, t } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtList } from '../../i18n/format';

/**
 * Client portal & brand: the company's own name and look in place of sprint2go, and its own address where clients
 * sign in. Clients see the brand on the sign-in page, in their shared space and on the phone app; the team keeps
 * the full app. One workspace, no reselling: the clients are this company's guests.
 */
export function AgencySection({ ws, canManage, brandingAddon, onWorkspace, onBilling, toast }: { ws: Workspace; canManage: boolean; brandingAddon: boolean; onWorkspace: (p: Partial<Workspace>) => void; onBilling: () => void; toast: (t: string) => void }) {
  const wl: WhiteLabel = ws.whiteLabel ?? { enabled: false, name: ws.name };
  const set = (p: Partial<WhiteLabel>) => onWorkspace({ whiteLabel: { ...wl, ...p } });
  const file = useRef<HTMLInputElement>(null);
  const slug = wl.slug ?? (ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company');
  const pickLogo = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => set({ logo: String(r.result) });
    r.readAsDataURL(f);
  };

  return (
    <>
      <h2>{t('Client portal & brand')}</h2>
      <p className="set-intro">
        {t('Your {whos} sign in at your own address and see your name and logo, never ours: on the sign-in page, in their shared space and on their phone. Your team keeps the full app.', { whos: term.whos })} {brandingAddon ? '' : t('Part of the branding add-on.')}
      </p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <label className="set-row toggle-row">
            <span>
              <strong>{t('Show our brand instead of sprint2go')}</strong>
              <small>{t('Sign-in page, the app, the shared space, invites and the install prompt.')}</small>
            </span>
            <button type="button" role="switch" aria-checked={wl.enabled} className={`switch ${wl.enabled ? 'on' : ''}`} onClick={() => set({ enabled: !wl.enabled, slug })}>
              <span />
            </button>
          </label>
          <div className={`fold ${wl.enabled ? 'open' : ''}`}>
            <div className="fold-in wl-brand">
              <label className="team-field">
                <span>{t('Name')}</span>
                <input value={wl.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('e.g. {example}', { example: 'Nusa Studio' })} />
              </label>
              <div className="team-field">
                <span>{t('Logo')}</span>
                <span className="wl-logo">
                  {wl.logo || ws.logo ? <img src={wl.logo ?? ws.logo} alt="" /> : <Building2 size={18} />}
                  <button type="button" className="ghost-btn sm" onClick={() => file.current?.click()}>
                    <Upload size={13} /> {wl.logo ? t('Change') : t('Upload')}
                  </button>
                  <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pickLogo(e.target.files?.[0])} />
                </span>
              </div>
              <div className="team-field">
                <span>{t('Colour')}</span>
                <input type="color" className="wl-color" value={wl.color ?? ws.color} onChange={(e) => set({ color: e.target.value })} aria-label={t('Brand colour')} />
              </div>
            </div>
          </div>
          {!brandingAddon && (
            <p className="muted small">
              {tj('The branding add-on is on your plan page: {link}', {
                link: (
                  <button type="button" className="link-btn small" onClick={onBilling}>
                    {t('Plan & billing')}
                  </button>
                ),
              })}
            </p>
          )}
        </div>

        <div className={`fold cd-fold ${wl.enabled ? 'open' : ''}`}>
          <div>
            <OwnAddress ws={ws} wl={wl} slug={slug} canManage={canManage} brandingAddon={brandingAddon} onBilling={onBilling} toast={toast} />
          </div>
        </div>
      </fieldset>
    </>
  );
}

// Labels marked here, translated where they're shown (docs/i18n.md).
const STEPS: { id: DomainStatus; label: string }[] = [
  { id: 'waiting', label: mark('Record') },
  { id: 'found', label: mark('Found') },
  { id: 'issuing', label: mark('Certificate') },
  { id: 'live', label: mark('Live') },
];
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'or', 'web', 'my', 'go', 'sch', 'gov', 'edu', 'biz']);
/** Before the server has looked: the record we expect, guessed from the address (the server's answer replaces it). */
function guessRecord(host: string): DomainCheck['record'] {
  const l = host.split('.');
  const keep = l.length >= 3 && SECOND_LEVEL.has(l[l.length - 2]) ? 3 : 2;
  return l.length <= keep ? { type: 'A', host: '@', value: mark('shown after the first check') } : { type: 'CNAME', host: l.slice(0, -keep).join('.'), value: caps.customTarget };
}

/**
 * The company's own address: type it, add the one DNS record shown, and it moves through four steps by itself
 * (record, found, certificate, live). The server checks it and owns the state; this only shows it and asks for checks.
 */
function OwnAddress({ ws, wl, slug, canManage, brandingAddon, onBilling, toast }: { ws: Workspace; wl: WhiteLabel; slug: string; canManage: boolean; brandingAddon: boolean; onBilling: () => void; toast: (t: string) => void }) {
  // What the server last said, until the same news arrives through live updates (whichever comes first).
  const [echo, setEcho] = useState<WhiteLabel | null>(null);
  useEffect(() => setEcho(null), [wl.domain, wl.domainStatus, wl.domainCheck?.at]);
  const cur = echo ?? wl;
  const domain = cur.domain ?? '';
  const status: DomainStatus | undefined = domain ? cur.domainStatus ?? 'waiting' : undefined;
  const chk = cur.domainCheck;
  const [draft, setDraft] = useState(domain);
  useEffect(() => setDraft(domain), [domain]);
  const [busy, setBusy] = useState<'' | 'save' | 'check' | 'remove'>('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'' | 'change' | 'remove'>('');
  const [copied, setCopied] = useState('');
  const live = status === 'live';
  const clean = draft.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  const dirty = clean !== domain;
  const real = server.on;

  const call = async (path: 'domain' | 'check', body: Record<string, unknown>) => {
    const r = await fetch(`/api/white-label/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, ...body }) }).catch(() => null);
    const d = ((await r?.json().catch(() => ({}))) ?? {}) as { error?: string; whiteLabel?: WhiteLabel };
    if (!r?.ok) throw new Error(d.error ?? (r ? mark('Something went wrong. Try again.') : mark('No connection. Try again.')));
    if (d.whiteLabel) setEcho(d.whiteLabel);
    return d.whiteLabel ?? null;
  };
  const save = async (next: string | null, sure = false) => {
    setError('');
    // Moving away from a live or nearly live address breaks the links guests already have: ask first.
    if (!sure && domain && (status === 'live' || status === 'issuing')) return setConfirm(next ? 'change' : 'remove');
    setConfirm('');
    setBusy(next ? 'save' : 'remove');
    try {
      const w = await call('domain', { domain: next });
      if (!next) toast(t('Address removed.'));
      else if (w?.domainStatus === 'live') toast(t('{address} is live.', { address: next }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || busy) return;
    if (!real) return toast(t('Addresses are checked on the live app.'));
    void save(clean || null);
  };
  const checkNow = async () => {
    setError('');
    setBusy('check');
    try {
      const w = await call('check', {});
      const s = w?.domainStatus;
      toast(s === 'live' ? t('{address} is live.', { address: domain }) : s === 'issuing' ? t('The record is right. Getting the certificate now.') : s === 'found' ? t('The record is right.') : t('Not there yet. We check again every hour.'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(''), 1500);
  };

  const record = chk?.record ?? (domain ? guessRecord(domain) : null);
  const zone = chk?.zone ?? (record?.type === 'A' ? domain : domain.split('.').slice(-2).join('.'));
  const blocked = chk?.blocked;
  const paused = live && !brandingAddon;
  // The step we're at (4: all done), and whether it waits on something the company has to do.
  const active = status === 'waiting' ? 0 : status === 'live' ? (paused ? 3 : 4) : 2;
  const stuck = (status === 'waiting' && !!chk?.problem) || (status === 'found' && (!!blocked || !!chk?.certError)) || paused;
  // Closing folds keep their last words while they fold away.
  const lastError = useRef('');
  if (error) lastError.current = error;
  const lastConfirm = useRef<'change' | 'remove'>('remove');
  if (confirm) lastConfirm.current = confirm;
  const asked = confirm || lastConfirm.current;
  const local = location.hostname === 'localhost' || location.hostname.endsWith('.localhost');
  const tryUrl = `${location.protocol}//${slug}.localhost${location.port ? `:${location.port}` : ''}`;
  const tryLink = (
    <a className="link-btn small" href={tryUrl} target="_blank" rel="noreferrer">
      {tryUrl.replace(/^https?:\/\//, '')}
    </a>
  );

  const checkButton = (
    <button type="button" className="ghost-btn sm outline" disabled={!!busy || !real} onClick={() => void checkNow()}>
      {busy === 'check' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {busy === 'check' ? t('Checking…') : t('Check now')}
    </button>
  );

  return (
    <div className="set-block cd-block">
      <h3>{t('Where {whos} sign in', { whos: term.whos })}</h3>
      <p className="small muted">{t('Your own address, for example portal.youragency.com. Once it’s live, invite links for {whos} use it.', { whos: term.whos })}</p>
      <form className="cd-address" onSubmit={submit}>
        <input value={draft} onChange={(e) => (setDraft(e.target.value), setError(''), setConfirm(''))} placeholder={t('portal.youragency.com')} aria-label={t('Your address')} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={!canManage || !!busy} />
        <button type="submit" className="primary-btn sm" disabled={!dirty || !!busy || !canManage}>
          {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} {busy === 'save' ? t('Checking…') : domain && !clean ? t('Remove') : t('Save')}
        </button>
      </form>
      <div className={`fold cd-fold ${error ? 'open' : ''}`}>
        <div>
          <p className="cd-error small" role="alert">
            {t(error || lastError.current)}
          </p>
        </div>
      </div>
      <div className={`fold cd-fold ${confirm ? 'open' : ''}`}>
        <div>
          <div className="cd-confirm">
            <p className="small">
              {asked === 'change' ? t('Your {whos} use {domain} now. Their links to it stop working once you switch to {next}.', { whos: term.whos, domain, next: clean }) : t('Remove {domain}? {Whos} who open it see a plain page instead of your sign-in.', { domain, whos: term.whos })}
            </p>
            <span className="cd-confirm-actions">
              <button type="button" className="ghost-btn sm" onClick={() => (setConfirm(''), setDraft(domain))}>
                {t('Keep {domain}', { domain })}
              </button>
              <button type="button" className={`primary-btn sm ${asked === 'remove' ? 'danger-btn' : ''}`} disabled={!confirm || !!busy} onClick={() => void save(asked === 'change' ? clean : null, true)}>
                {asked === 'change' ? t('Switch') : t('Remove')}
              </button>
            </span>
          </div>
        </div>
      </div>

      {real && !caps.customDomains && !live && !(status === 'found' && blocked === 'off') && <p className="cd-note small">{t('Ready once sprint2go turns on custom addresses. You can add the record now; it goes live from then.')}</p>}

      <SmoothHeight>
        {domain && status && record && (
          <div className="cd-state">
            <ol className="cd-steps" aria-label={t('Progress')}>
              {STEPS.map((s, i) => {
                const cls = i < active ? 'done' : i === active ? (stuck ? 'stuck' : 'now') : '';
                return (
                  <li key={s.id} className={cls} aria-current={i === active ? 'step' : undefined}>
                    <span className="cd-dot">{cls === 'done' ? <Check size={11} strokeWidth={3} /> : cls === 'stuck' ? <AlertTriangle size={10} strokeWidth={2.6} /> : cls === 'now' && status === 'issuing' ? <Loader2 size={11} className="spin" /> : null}</span>
                    <span className="cd-step-label">{t(s.label)}</span>
                  </li>
                );
              })}
            </ol>

            <TabPane key={`${status}-${blocked ?? ''}-${paused}`}>
              {status === 'waiting' && (
                <div className="cd-now">
                  <strong>{t('Add this record where {zone}’s DNS is managed', { zone })}</strong>
                  <p className="small muted">
                    {/* Where to click at the DNS host is the server's (English, with the host's own menu names). */}
                    {chk?.dnsHost ? (
                      tj('{zone}’s DNS is at {host}: {where}.', { zone, host: <b>{chk.dnsHost.name}</b>, where: chk.dnsHost.where })
                    ) : (
                      <>
                        {t('Usually where you bought the domain.')}
                        {chk?.nameservers?.length ? ` ${t('{zone} uses {nameservers}.', { zone, nameservers: fmtList(chk.nameservers) })}` : ''}
                      </>
                    )}{' '}
                    {record.type === 'A' ? t('This address is the domain itself, and most DNS hosts don’t allow a CNAME there, so it’s an A record.') : ''}
                  </p>
                  <div className="ed-records">
                    <div className={`ed-record ${chk?.problem ? 'bad' : ''}`}>
                      <span className="ed-rec-type mono">{record.type}</span>
                      <span className="ed-rec-main">
                        <span className="ed-rec-value">
                          <small className="cd-k">{t('Name')}</small>
                          <code className="mono">{record.host}</code>
                          <button type="button" className="icon-btn sm" title={t('Copy the name')} aria-label={t('Copy the name')} onClick={() => copy(record.host)}>
                            {copied === record.host ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </span>
                        <span className="ed-rec-value">
                          <small className="cd-k">{record.type === 'A' ? t('Address') : t('Points to')}</small>
                          {/* A host name or an address; before the first check, or with no address yet, the app's or the server's words. */}
                          <code className="mono">{t(record.value)}</code>
                          <button type="button" className="icon-btn sm" title={t('Copy the value')} aria-label={t('Copy the value')} onClick={() => copy(record.value)}>
                            {copied === record.value ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </span>
                        {chk && (chk.problem ? <small className="ed-found">{t(chk.problem)}</small> : <small className="muted">{chk.found === 'nothing yet' ? t('Not there yet. New records can take up to an hour to show.') : t('Found: {record}', { record: chk.found })}</small>)}
                      </span>
                      <span className="ed-rec-state">{chk?.problem ? <AlertTriangle size={15} /> : null}</span>
                    </div>
                  </div>
                  <div className="cd-actions">
                    {checkButton}
                    <small className="muted">{chk ? t('Checked {when}. We look again every hour and move on by ourselves.', { when: relative(chk.at) }) : t('We look again every hour and move on by ourselves.')}</small>
                  </div>
                </div>
              )}

              {status === 'found' && (
                <div className="cd-now">
                  <strong>{t('The record is right')}</strong>
                  {blocked === 'addon' ? (
                    <p className="small muted">
                      {t('Turn on the branding add-on to go live. The certificate follows within minutes.')}{' '}
                      <button type="button" className="link-btn small" onClick={onBilling}>
                        {t('Plan & billing')}
                      </button>
                    </p>
                  ) : blocked === 'off' ? (
                    <p className="small muted">{t('Ready once sprint2go turns on custom addresses. Nothing else to do on your side.')}</p>
                  ) : (
                    <>
                      <p className="small muted">{chk?.certError ? t(chk.certError) : t('Asking for the certificate.')}</p>
                      <div className="cd-actions">{checkButton}</div>
                    </>
                  )}
                </div>
              )}

              {status === 'issuing' && (
                <div className="cd-now">
                  <strong>{t('Getting the certificate for {domain}', { domain })}</strong>
                  <p className="small muted">{chk?.problem ? t(chk.problem) : t('Usually a few minutes. This page updates by itself, and you get a notice when it’s live.')}</p>
                </div>
              )}

              {live && paused && (
                <div className="cd-now">
                  <strong>{t('Paused: the branding add-on is off')}</strong>
                  <p className="small muted">
                    {t('{Whos} see a plain page at {domain} until it’s back on.', { whos: term.whos, domain })}{' '}
                    <button type="button" className="link-btn small" onClick={onBilling}>
                      {t('Plan & billing')}
                    </button>
                  </p>
                </div>
              )}
              {live && !paused && (
                <div className="cd-now">
                  <strong className="ed-ok">{t('Live at {domain}', { domain })}</strong>
                  <p className="small muted">
                    {t('With its own secure connection. {Whos} get a sign-in page with your name, then their shared space.', { whos: term.whos })}{' '}
                    <a className="link-btn small" href={`https://${domain}`} target="_blank" rel="noreferrer">
                      {t('Open {domain}', { domain })}
                    </a>
                  </p>
                </div>
              )}
            </TabPane>
          </div>
        )}
      </SmoothHeight>

      {!live && (local ? (
        <p className="small muted">
          {domain ? tj('Until then, try it here: {link}', { link: tryLink }) : tj('Try your sign-in page here: {link}', { link: tryLink })}
        </p>
      ) : (
        <p className="small muted">{domain ? t('Until then, invite links use {host}.', { host: location.host }) : t('Until you add one, invite links use {host}.', { host: location.host })}</p>
      ))}
      {domain && canManage && real && !confirm && (
        <button type="button" className="link-btn small cd-remove" disabled={!!busy} onClick={() => void save(null)}>
          {busy === 'remove' ? t('Removing…') : t('Remove {domain}', { domain })}
        </button>
      )}
    </div>
  );
}
