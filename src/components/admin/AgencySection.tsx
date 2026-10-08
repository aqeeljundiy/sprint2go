import { useRef, useState } from 'react';
import { Building2, Check, Copy, ExternalLink, Loader2, Plus, Upload } from 'lucide-react';
import type { WhiteLabel, Workspace } from '../../types';
import { term } from '../../terms';
import { WorkspaceLogo } from '../WorkspaceLogo';

/**
 * White label and agency: the agency's own name and look in place of Sprint2go (for its team, its guests and the
 * workspaces it runs for clients), its own address, and the client workspaces it runs.
 */
export function AgencySection({ ws, canManage, clientWorkspaces, onWorkspace, onNewClientWorkspace, onOpenWorkspace }: {
  ws: Workspace;
  canManage: boolean;
  clientWorkspaces: Workspace[];
  onWorkspace: (p: Partial<Workspace>) => void;
  onNewClientWorkspace: (name: string, owner?: { name: string; email: string }) => void;
  onOpenWorkspace: (id: string) => void;
}) {
  const wl: WhiteLabel = ws.whiteLabel ?? { enabled: false, name: ws.name };
  const set = (p: Partial<WhiteLabel>) => onWorkspace({ whiteLabel: { ...wl, ...p } });
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [client, setClient] = useState({ name: '', owner: '', email: '' });
  const slug = wl.slug ?? (ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency');
  const localUrl = `${location.protocol}//${slug}.localhost${location.port ? `:${location.port}` : ''}`;
  const pickLogo = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => set({ logo: String(r.result) });
    r.readAsDataURL(f);
  };
  const create = () => {
    if (!client.name.trim()) return;
    onNewClientWorkspace(client.name.trim(), client.email.includes('@') ? { name: client.owner.trim() || client.email.split('@')[0], email: client.email.trim().toLowerCase() } : undefined);
    setClient({ name: '', owner: '', email: '' });
    setAdding(false);
  };

  if (ws.agency)
    return (
      <>
        <h2>Run by {ws.agency.name || 'an agency'}</h2>
        <p className="set-intro">This workspace is run by {ws.agency.name || 'an agency'}. Your plan and billing are with them, so ask them about anything to do with your subscription.</p>
      </>
    );

  return (
    <>
      <h2>White label and agency</h2>
      <p className="set-intro">For agencies: run this under your own name and look, for your team, your {term.whos} and the workspaces you run for your clients. Nobody sees “Sprint2go”.</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <label className="set-row toggle-row">
            <span>
              <strong>Use our own brand</strong>
              <small>Your name and logo replace Sprint2go everywhere: sign-in, the app, the guest portal and the install prompt.</small>
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
        </div>

        {wl.enabled && (
          <div className="set-block">
            <h3>Your address</h3>
            <p className="small muted">People sign in at your own address, for example app.youragency.com. Add one record where you manage that domain:</p>
            <label className="team-field">
              <span>Address</span>
              <input value={wl.domain ?? ''} onChange={(e) => set({ domain: e.target.value.trim().toLowerCase() || undefined, domainStatus: undefined })} placeholder="app.youragency.com" />
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
                      ? 'Saved. We check the record and set up the secure connection once Sprint2go is online; until then use the local address below.'
                      : 'DNS changes can take up to an hour to show.'}
                </small>
              </div>
            )}
            <p className="small">
              Try it on this computer:{' '}
              <a className="link-btn" href={localUrl} target="_blank" rel="noreferrer">
                {slug}.localhost <ExternalLink size={12} />
              </a>
            </p>
          </div>
        )}

        <div className="set-block">
          <h3>Client workspaces</h3>
          <p className="small muted">Run a whole workspace for a client: their own team, mail, chat and tasks, under your brand. You manage it and can open it from the workspace switcher; they don’t pay Sprint2go, you bill them.</p>
          <div className="acct-list">
            {clientWorkspaces.map((c) => (
              <div key={c.id} className="acct-row">
                <WorkspaceLogo ws={c} size={30} />
                <span className="acct-info">
                  <strong>{c.name}</strong>
                  <small>
                    {c.members.length} {c.members.length === 1 ? 'person' : 'people'}
                    {c.domains[0] ? ` · ${c.domains[0]}` : ''}
                  </small>
                </span>
                <button type="button" className="ghost-btn sm" onClick={() => onOpenWorkspace(c.id)}>
                  Open
                </button>
              </div>
            ))}
            {!clientWorkspaces.length && !adding && <p className="muted small wl-empty">No client workspaces yet.</p>}
            {adding ? (
              <div className="wl-new">
                <input autoFocus value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} placeholder="Client’s company, e.g. KopiKita" />
                <input value={client.owner} onChange={(e) => setClient({ ...client, owner: e.target.value })} placeholder="Their main person (optional)" />
                <input value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} placeholder="Their email, to invite them (optional)" onKeyDown={(e) => e.key === 'Enter' && create()} />
                <div className="wl-new-actions">
                  <button type="button" className="ghost-btn sm" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn sm" disabled={!client.name.trim()} onClick={create}>
                    Create workspace
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="acct-add" onClick={() => setAdding(true)}>
                <Plus size={16} /> New client workspace
              </button>
            )}
          </div>
          <p className="muted small">Pricing: you pay Sprint2go’s agency price per client workspace and charge your clients what you like. Agency prices are set when billing goes live.</p>
        </div>
      </fieldset>
    </>
  );
}
