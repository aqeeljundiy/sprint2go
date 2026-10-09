import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SmoothHeight, useLeaving } from './ui/Smooth';
import { EmptyState } from './ui/EmptyState';
import { Badge } from './ui/Person';
import { server } from '../sync';
import { relative } from '../utils';
import '../connector.css';

interface Grant {
  id: string;
  app: string;
  host: string;
  workspaceId: string;
  company: string;
  demo?: boolean;
  off?: boolean; // the company switched AI apps off (or they left it): it doesn't work right now
  createdAt: string;
  usedAt: string | null;
}

/**
 * Settings, Account: the AI apps this person connected (Claude, ChatGPT…), which company each reaches, when it was
 * last used, and Disconnect. Under them, the address to add in Claude. The server keeps the list (server/connector.ts).
 */
export function ConnectedApps({ toast }: { toast?: (t: string) => void }) {
  const [data, setData] = useState<{ url: string; grants: Grant[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!server.on) return;
    fetch('/api/oauth/grants')
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string; grants: Grant[] }>) : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);
  const rows = useLeaving(data?.grants ?? [], (g) => g.id);
  if (!server.on) return null; // the browser-only demo has no server to connect to

  const url = data?.url ?? `${location.origin}/mcp`;
  const copy = () =>
    void navigator.clipboard?.writeText(url).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
      () => toast?.('Couldn’t copy it. Select the address and copy it yourself.'),
    );
  const disconnect = async (g: Grant) => {
    setBusy(g.id);
    const r = await fetch('/api/oauth/grants/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: g.id }) }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return toast?.('Couldn’t disconnect it. Try again.');
    setData((d) => d && { ...d, grants: d.grants.filter((x) => x.id !== g.id) });
    toast?.(`${g.app} is disconnected from ${g.company}`);
  };

  return (
    <>
      <h3>Connected AI apps</h3>
      <p className="set-hint cn-hint">Claude, ChatGPT and other AI apps you connected. Each one sees only what you see in the company you picked, and mail or messages to guests stay drafts.</p>
      <SmoothHeight>
        {data === null ? (
          <p className="muted small cn-loading">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState compact text="No AI apps connected yet." />
        ) : (
          rows.map(({ item: g, leaving }) => (
            <div key={g.id} className={`set-row cn-grant ${leaving ? 'row-leaving' : ''}`}>
              <span>
                <strong>
                  {g.app} {g.demo && <Badge small>Demo</Badge>} {g.off && <Badge small tone="warn">Not working</Badge>}
                </strong>
                <small>
                  {g.company}
                  {g.host ? ` · ${g.host}` : ''} · {g.usedAt ? `last used ${relative(g.usedAt)}` : `connected ${relative(g.createdAt)}, not used yet`}
                  {g.off ? `. ${g.company} switched AI apps off, or you’re no longer on its team.` : ''}
                </small>
              </span>
              <button type="button" className="ghost-btn outline sm" disabled={busy === g.id || leaving} onClick={() => void disconnect(g)}>
                {busy === g.id ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ))
        )}
      </SmoothHeight>
      <div className="set-row cn-add">
        <span>
          <strong>Add sprint2go to Claude</strong>
          <small>In Claude, open Settings, Connectors, Add custom connector, and paste this address. ChatGPT and other apps that connect to MCP servers use the same one.</small>
          <code className="cn-url">{url}</code>
        </span>
        <button type="button" className="ghost-btn outline sm cn-copy" onClick={copy} aria-label="Copy the address">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </>
  );
}
