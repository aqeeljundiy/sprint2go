import { useRef, useState } from 'react';
import { Building2, Check, Copy, ExternalLink, Loader2, Upload } from 'lucide-react';
import type { WhiteLabel, Workspace } from '../../types';
import { term } from '../../terms';

/**
 * Client portal & brand: the company's own name and look in place of Sprint2go, and its own address where clients
 * sign in. Clients see the brand on the sign-in page, in their shared space and on the phone app; the team keeps
 * the full app. One workspace, no reselling: the clients are this company's guests.
 */
export function AgencySection({ ws, canManage, brandingAddon, onWorkspace, onBilling }: { ws: Workspace; canManage: boolean; brandingAddon: boolean; onWorkspace: (p: Partial<Workspace>) => void; onBilling: () => void }) {
  const wl: WhiteLabel = ws.whiteLabel ?? { enabled: false, name: ws.name };
  const set = (p: Partial<WhiteLabel>) => onWorkspace({ whiteLabel: { ...wl, ...p } });
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const slug = wl.slug ?? (ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company');
  const localUrl = `${location.protocol}//${slug}.localhost${location.port ? `:${location.port}` : ''}`;
  const portal = wl.domain && wl.domainStatus === 'verified' ? `https://${wl.domain}` : localUrl;
  const pickLogo = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => set({ logo: String(r.result) });
    r.readAsDataURL(f);
  };

  return (
    <>
      <h2>Client portal & brand</h2>
      <p className="set-intro">
        Your {term.whos} sign in at your own address and see your name and logo, never ours: on the sign-in page, in their shared space and on their phone. Your team keeps the full app. {brandingAddon ? '' : 'Part of the branding add-on.'}
      </p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <label className="set-row toggle-row">
            <span>
              <strong>Show our brand instead of Sprint2go</strong>
              <small>Sign-in page, the app, the shared space, invites and the install prompt.</small>
            </span>
            <button type="button" role="switch" aria-checked={wl.enabled} className={`switch ${wl.enabled ? 'on' : ''}`} onClick={() => set({ enabled: !wl.enabled, slug })}>
              <span />
            </button>
          </label>
          <div className={`fold ${wl.enabled ? 'open' : ''}`}>
            <div className="fold-in wl-brand">
              <label className="team-field">
                <span>Name</span>
                <input value={wl.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Nusa Studio" />
              </label>
              <div className="team-field">
                <span>Logo</span>
                <span className="wl-logo">
                  {wl.logo || ws.logo ? <img src={wl.logo ?? ws.logo} alt="" /> : <Building2 size={18} />}
                  <button type="button" className="ghost-btn sm" onClick={() => file.current?.click()}>
                    <Upload size={13} /> {wl.logo ? 'Change' : 'Upload'}
                  </button>
                  <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pickLogo(e.target.files?.[0])} />
                </span>
              </div>
              <div className="team-field">
                <span>Colour</span>
                <input type="color" className="wl-color" value={wl.color ?? ws.color} onChange={(e) => set({ color: e.target.value })} aria-label="Brand colour" />
              </div>
            </div>
          </div>
          {!brandingAddon && (
            <p className="muted small">
              The branding add-on is on your plan page:{' '}
              <button type="button" className="link-btn small" onClick={onBilling}>
                Plan & billing
              </button>
            </p>
          )}
        </div>

        {wl.enabled && (
          <div className="set-block">
            <h3>Where {term.whos} sign in</h3>
            <p className="small muted">Your own address, for example portal.youragency.com. Invite links for {term.whos} use it. Add one record where you manage that domain:</p>
            <label className="team-field">
              <span>Address</span>
              <input value={wl.domain ?? ''} onChange={(e) => set({ domain: e.target.value.trim().toLowerCase() || undefined, domainStatus: undefined })} placeholder="portal.youragency.com" />
            </label>
            {wl.domain && (
              <div className="wl-dns">
                <span className="mono">CNAME</span>
                <span className="mono">{wl.domain.split('.')[0]}</span>
                <span className="mono">custom.sprint2go.com</span>
                <button type="button" className="icon-btn sm" title="Copy" onClick={() => void navigator.clipboard?.writeText('custom.sprint2go.com').then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            )}
            {wl.domain && (
              <div className="wl-check">
                <button type="button" className="ghost-btn sm outline" disabled={checking} onClick={() => (setChecking(true), setTimeout(() => (setChecking(false), set({ domainStatus: 'waiting' })), 1200))}>
                  {checking ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Check the record
                </button>
                <small className="muted">
                  {wl.domainStatus === 'verified'
                    ? `Live at ${wl.domain}, with its own secure connection.`
                    : wl.domainStatus === 'waiting'
                      ? 'Saved. We check the record and set up the secure connection once Sprint2go is online; until then the local address below works.'
                      : 'DNS changes can take up to an hour to show.'}
                </small>
              </div>
            )}
            <p className="small">
              {term.Whos} would see:{' '}
              <a className="link-btn" href={portal} target="_blank" rel="noreferrer">
                {portal.replace(/^https?:\/\//, '')} <ExternalLink size={12} />
              </a>
              <span className="muted"> · a sign-in page with your name, then their shared space.</span>
            </p>
          </div>
        )}
      </fieldset>
    </>
  );
}
