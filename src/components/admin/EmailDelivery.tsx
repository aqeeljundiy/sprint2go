import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Cloud, Copy, Loader2, MailX, RefreshCw, Server, Shuffle, Zap, type LucideIcon } from 'lucide-react';
import type { EmailSetup, MailProvider, Workspace } from '../../types';
import { brand as product } from '../../terms';
import { relative } from '../../utils';
import { SmoothHeight } from '../ui/Smooth';
import { EmailSetupGuide } from '../EmailSetupGuide';
import { providerName } from '../Onboarding';

interface Setup {
  host: string;
  ip: string;
  domain: string;
  ownDomain: boolean;
  route: 'own' | 'boosted';
  boostedAvailable: boolean;
  credits: number;
  records: { type: string; host: string; value: string; note: string; key: string }[];
  checks: { at: string; allOk: boolean; checks: { key: string; ok: boolean; found: string; want: string }[] } | null;
  stats: { received: number; spam: number; sent: number; boosted: number; failed: number; queued: number };
  health: Record<'ptr' | 'a' | 'port25' | 'inbound', { ok: boolean; found: string; want: string }>;
}

/** Built when shown, so a white-labelled company sees its own name. */
const receive = (): { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] => [
  { id: 'keep', icon: Cloud, title: 'Keep Gmail or Outlook', body: `Mail stays where it is. ${product.name} sends from your domain; nothing incoming shows here.` },
  { id: 'mix', icon: Shuffle, title: 'Some of each', body: `Google or Microsoft keeps the domain and passes the addresses it doesn’t know to ${product.name}.` },
  { id: 'hosted', icon: Server, title: `Move to ${product.name}`, body: 'The domain’s mail comes here. Cancel the other licences.' },
  { id: 'none', icon: MailX, title: 'No email here', body: 'Mail stays off. Chat, Tasks, Calendar and the rest keep working.' },
];
const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho' },
];
const PACKS = [
  { n: 1000, rp: 15_000 },
  { n: 5000, rp: 59_000 },
  { n: 25_000, rp: 249_000 },
];
const KEY_NAME: Record<string, string> = { mx: 'Where mail arrives (MX)', spf: 'Who may send (SPF)', dkim: 'Signature (DKIM)', dmarc: 'Policy (DMARC)', ptr: 'Reverse DNS of the server', a: 'The server’s address record', port25: 'Outgoing port 25', inbound: 'Incoming mail port' };
const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

/** Settings, Email delivery: where a company's mail lives, how it goes out, the records to add, and whether they're there. */
export function EmailDeliverySection({ ws, canManage, firstName, onWorkspace, toast }: { ws: Workspace; canManage: boolean; firstName: string; onWorkspace: (p: Partial<Workspace>) => void; toast: (t: string) => void }) {
  const [info, setInfo] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [guide, setGuide] = useState(false);
  const load = () =>
    fetch(`/api/mail/setup?ws=${encodeURIComponent(ws.id)}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not load.')))
      .catch(() => setError('No connection.'));
  useEffect(() => {
    void load();
  }, [ws.id, ws.emailSetup, ws.mailRoute, ws.domains.join(','), ws.mailChecks?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`/api/mail/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as { error?: string }).error ?? 'Something went wrong.');
    return data;
  };
  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(''), 1500);
  };
  const check = async () => {
    setChecking(true);
    try {
      const r = (await post('check', { workspaceId: ws.id })) as Setup['checks'];
      toast(r?.allOk ? 'All records are in place.' : 'Some records are still missing.');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const setRoute = async (route: 'own' | 'boosted') => {
    if (!info || info.route === route) return;
    setBusy(true);
    try {
      await post('route', { workspaceId: ws.id, route });
      toast(route === 'boosted' ? 'Boosted sending is on. Add the three signing records.' : 'Mail goes out from the sprint2go server.');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const buy = async (n: number) => {
    setBusy(true);
    try {
      await post('credits', { workspaceId: ws.id, add: n });
      toast(`${n.toLocaleString('id-ID')} emails added.`);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // The mailboxes follow the choice: moving here hosts every mailbox on the company's domains; keeping the provider
  // hands them back to it. "Some of each" leaves each mailbox where it is (set per person under General & email).
  const accountsFor = (next: EmailSetup) =>
    ws.accounts.map((a) => {
      const ours = ws.domains.some((d) => a.email.toLowerCase().endsWith('@' + d.toLowerCase()));
      if (!ours || a.temp) return a;
      if (next === 'hosted') return { ...a, provider: 'sprint2go' as MailProvider };
      if (next === 'keep') return { ...a, provider: (ws.emailProvider ?? 'google') as MailProvider };
      return a;
    });
  const setup = ws.emailSetup ?? 'none';
  const provider = ws.emailProvider ?? 'google';
  const route = info?.route ?? ws.mailRoute ?? 'own';
  const checks = info?.checks ?? ws.mailChecks ?? null;
  const resultFor = (key: string) => checks?.checks.find((c) => c.key === key);

  return (
    <>
      <h2>Email delivery</h2>
      <p className="set-intro">Two decisions you can change any time: where your domain’s mail lives, and how mail from {product.name} goes out. Nothing switches until the records are really there.</p>
      {error && <p className="modal-note">{error}</p>}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>Where your mail lives</h3>
          <div className="ob-setups ed-cards">
            {receive().map(({ id, icon: Icon, title, body }) => (
              <button key={id} type="button" className={`ob-setup ${setup === id ? 'on' : ''}`} onClick={() => onWorkspace({ emailSetup: id, mailChecks: undefined, accounts: accountsFor(id) })}>
                <Icon size={20} />
                <span>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </span>
              </button>
            ))}
          </div>
          <SmoothHeight>
            {(setup === 'keep' || setup === 'mix') && (
              <div className="field ob-provider">
                <label>Which provider</label>
                <div className="aw-tones">
                  {PROVIDERS.map((p) => (
                    <button key={p.id} type="button" className={provider === p.id ? 'on' : ''} onClick={() => onWorkspace({ emailProvider: p.id })}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {setup === 'mix' && (
              <p className="small muted">
                {providerName(provider)} keeps the domain. In its admin console, one routing rule sends mail for unknown addresses to <code className="mono">{info?.host ?? '…'}</code>. People on {product.name} mail can write to colleagues on {providerName(provider)} as usual.
              </p>
            )}
            {setup === 'hosted' && ws.domains[0] && <p className="small muted">When the MX record below points here, new mail for {ws.domains[0]} arrives in {product.name}. Old mail can be imported from {providerName(provider)} afterwards.</p>}
            {setup !== 'none' && setup !== 'hosted' && (
              <>
                <button type="button" className="link-btn small" onClick={() => setGuide((g) => !g)}>
                  {guide ? 'Hide the steps' : `Show the ${setup === 'mix' ? 'routing' : 'forwarding'} steps`}
                </button>
                <div className={`fold ${guide ? 'open' : ''}`}>
                  <div className="fold-in">
                    <EmailSetupGuide mode={setup === 'mix' ? 'split' : 'forward'} provider={provider} domain={ws.domains[0] ?? ''} first={firstName.toLowerCase()} />
                  </div>
                </div>
              </>
            )}
          </SmoothHeight>
        </div>

        <div className="set-block">
          <h3>How your mail goes out</h3>
          <div className="ed-routes">
            <button type="button" className={`ed-route ${route === 'own' ? 'on' : ''}`} disabled={busy} onClick={() => void setRoute('own')}>
              <span className="ed-route-head">
                <Server size={18} />
                <strong>{product.name} mail server</strong>
                <em>Included</em>
              </span>
              <ul>
                <li className="pro">Free, no limits</li>
                <li className="pro">Your own server, your own reputation</li>
                <li className="con">A brand-new domain can land in spam at Gmail and Outlook for the first weeks</li>
                <li className="con">Needs SPF, DKIM and DMARC records on your domain</li>
              </ul>
            </button>
            <button type="button" className={`ed-route ${route === 'boosted' ? 'on' : ''} ${!info?.boostedAvailable ? 'off' : ''}`} disabled={busy || !info?.boostedAvailable} onClick={() => void setRoute('boosted')}>
              <span className="ed-route-head">
                <Zap size={18} />
                <strong>Boosted sending</strong>
                <em>{info?.boostedAvailable ? 'Credits' : 'Coming soon'}</em>
              </span>
              <ul>
                <li className="pro">Proven delivery to Gmail and Outlook from day one</li>
                <li className="pro">Bounces and complaints handled for you</li>
                <li className="con">Paid per email: {PACKS.map((p) => `${p.n.toLocaleString('id-ID')} for ${rp(p.rp)}`).join(', ')}</li>
                <li className="con">Three extra signing records on your domain</li>
              </ul>
            </button>
          </div>
          <SmoothHeight>
            {route === 'boosted' && info && (
              <div className="ed-credits">
                <span>
                  <strong>{info.credits.toLocaleString('id-ID')}</strong> emails left{info.credits === 0 ? '. Mail goes out from our server until you top up.' : '.'}
                </span>
                <span className="ed-packs">
                  {PACKS.map((p) => (
                    <button key={p.n} type="button" className="ghost-btn sm" disabled={busy} onClick={() => void buy(p.n)}>
                      +{p.n.toLocaleString('id-ID')} · {rp(p.rp)}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </SmoothHeight>
        </div>

        <div className="set-block">
          <div className="ed-head">
            <h3>Records for {info?.domain ?? ws.domains[0] ?? 'your domain'}</h3>
            {info?.ownDomain && (
              <button type="button" className="ghost-btn sm outline" disabled={checking} onClick={() => void check()}>
                {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {checking ? 'Checking…' : checks ? 'Check again' : 'Check the records'}
              </button>
            )}
          </div>
          {!info && !error && <div className="lazy-wait" aria-hidden />}
          {info && !info.ownDomain && (
            <p className="small muted">
              Your addresses live at <code className="mono">{info.host}</code>, so there is nothing to add: mail to them arrives here as it is. To use your own domain, add it under General.
            </p>
          )}
          {info && info.ownDomain && (
            <>
              <p className="small muted">Add these where you manage {info.domain} (Cloudflare, Niagahoster, GoDaddy…). Changes can take up to an hour to show.</p>
              <div className="ed-records">
                {info.records.map((r) => {
                  const res = resultFor(r.key);
                  return (
                    <div key={r.key + r.host} className={`ed-record ${res ? (res.ok ? 'ok' : 'bad') : ''}`}>
                      <span className="ed-rec-type mono">{r.type}</span>
                      <span className="ed-rec-main">
                        <span className="ed-rec-host mono">{r.host}</span>
                        <span className="ed-rec-value">
                          <code className="mono">{r.value}</code>
                          {!r.value.startsWith('(') && (
                            <button type="button" className="icon-btn sm" title="Copy" onClick={() => copy(r.value)}>
                              {copied === r.value ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          )}
                        </span>
                        <small className="muted">{r.note}</small>
                        {res && !res.ok && <small className="ed-found">Found: {res.found}</small>}
                      </span>
                      <span className="ed-rec-state">{res ? res.ok ? <Check size={15} /> : <AlertTriangle size={15} /> : null}</span>
                    </div>
                  );
                })}
              </div>
              {checks && (
                <p className={`small ${checks.allOk ? 'ed-ok' : 'muted'}`}>
                  {checks.allOk ? 'Everything is in place.' : `${checks.checks.filter((c) => !c.ok).length} of ${checks.checks.length} still missing.`} Checked {relative(checks.at)}.
                </p>
              )}
            </>
          )}
        </div>

        {ws.accounts.filter((a) => !a.temp).length > 0 && ws.emailSetup !== 'none' && (
          <div className="set-block">
            <div className="ed-head">
              <h3>Your mailboxes</h3>
              <button
                type="button"
                className="ghost-btn sm outline"
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void post('ready', { workspaceId: ws.id })
                    .then(() => toast('Checked again.'))
                    .catch((e: Error) => toast(e.message))
                    .finally(() => setChecking(false));
                }}
              >
                {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Check again
              </button>
            </div>
            <div className="ed-records">
              {ws.accounts
                .filter((a) => !a.temp)
                .map((a) => {
                  const r = ws.mailReady?.mailboxes?.[a.id];
                  // Kept with Google or Microsoft: copies arriving here is all it can do, so that counts as working.
                  const kept = !!a.provider && a.provider !== 'sprint2go';
                  const both = kept ? r?.receive : r?.receive && r?.send;
                  return (
                    <div key={a.id} className={`ed-record ${!r ? '' : both ? 'ok' : 'bad'}`}>
                      <span className="ed-rec-main">
                        <strong>{a.email}</strong>
                        <small className="muted">
                          {!r ? 'Not checked yet' : kept ? (r.receive ? 'Copies arrive here' : 'No copies yet') : `${r.receive ? 'Receives' : 'Doesn’t receive yet'} · ${r.send ? 'sends' : 'doesn’t send yet'}`}
                          {r?.why ? `. ${r.why}` : ''}
                        </small>
                      </span>
                      <span className="ed-rec-state">{r ? both ? <Check size={15} /> : <AlertTriangle size={15} /> : null}</span>
                    </div>
                  );
                })}
            </div>
            {ws.mailReady && <p className="small muted">Checked {relative(ws.mailReady.at)}. Mail unlocks for everyone as soon as a mailbox works.</p>}
          </div>
        )}

        {info && (
          <div className="set-block">
            <h3>The {product.name} server</h3>
            <p className="small muted">These are ours to fix, not yours; they decide whether Gmail and Outlook accept mail from here.</p>
            <div className="ed-records">
              {(['inbound', 'port25', 'a', 'ptr'] as const).map((k) => {
                const h = info.health[k];
                return (
                  <div key={k} className={`ed-record ${h.ok ? 'ok' : 'bad'}`}>
                    <span className="ed-rec-main">
                      <strong>{KEY_NAME[k]}</strong>
                      <small className="muted">{h.ok ? h.found : `Found: ${h.found}. Wanted: ${h.want}.`}</small>
                    </span>
                    <span className="ed-rec-state">{h.ok ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {info && (info.stats.received || info.stats.sent || info.stats.failed || info.stats.queued) ? (
          <div className="set-block">
            <h3>This month</h3>
            <p className="small">
              {info.stats.received} received{info.stats.spam ? ` (${info.stats.spam} to spam)` : ''} · {info.stats.sent} sent{info.stats.boosted ? ` (${info.stats.boosted} boosted)` : ''}
              {info.stats.failed ? ` · ${info.stats.failed} could not be delivered` : ''}
              {info.stats.queued ? ` · ${info.stats.queued} on the way` : ''}
            </p>
          </div>
        ) : null}
      </fieldset>
    </>
  );
}
