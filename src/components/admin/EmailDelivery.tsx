import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Cloud, Copy, ImageOff, Loader2, MailX, PenLine, Plus, RefreshCw, Server, Shuffle, Trash2, Upload, Zap, type LucideIcon } from 'lucide-react';
import type { Account, EmailSetup, MailAlias, MailProvider, Workspace } from '../../types';
import { AliasDialog } from '../WorkspaceForms';
import { server } from '../../sync';
import { brand as product } from '../../terms';
import { relative } from '../../utils';
import { SmoothHeight, useLeaving } from '../ui/Smooth';
import { EmailSetupGuide, providerLabel } from '../EmailSetupGuide';
import { providerName } from '../Onboarding';
import { MAIL_PACKS, countedMailboxes, mailboxRoom } from '../../data/pricing';
import { trialPlan } from '../../data/workspaces';

interface Setup {
  host: string;
  ip: string;
  domain: string;
  ownDomain: boolean;
  route: 'own' | 'boosted';
  boostedAvailable: boolean;
  credits: number;
  /** Boosted credits bought by bank transfer: invoices waiting for payment, and why buying isn't possible here (if so). */
  creditOrders?: { orders: { invoiceId: string; number: string; credits: number; total: number; dueAt: string }[]; blocked: string | null; bank: string | null };
  records: { type: string; host: string; value: string; note: string; key: string }[];
  checks: { at: string; allOk: boolean; checks: { key: string; ok: boolean; found: string; want: string }[] } | null;
  stats: { received: number; spam: number; sent: number; boosted: number; failed: number; queued: number };
  health: Record<'ptr' | 'a' | 'port25' | 'inbound', { ok: boolean; found: string; want: string }>;
  dnsHost?: { name: string; where: string } | null; // who runs the domain's DNS, from its nameservers
  nameservers?: string[];
  /** Whose domain it is: verified ours, ours but not proven yet, or another company's (held first, or proven). */
  ownership?: { domain: string; state: 'verified' | 'pending' | 'held' | 'taken'; at: string | null; how: string | null; record: { type: string; host: string; value: string } } | null;
  /** Operators only: the mail server's certificate. */
  cert?: { source: string; issuer: string | null; validTo: string | null; daysLeft: number | null; trusted: boolean; acme: boolean; error: { at: string; message: string } | null };
}
const PROVEN_BY: Record<string, string> = { mx: 'its MX record points here', dkim: 'its signing record', txt: 'its sprint2go-verify record' };

/** Built when shown, so a white-labelled company sees its own name. */
const receive = (): { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] => [
  { id: 'keep', icon: Cloud, title: 'Keep Gmail or Outlook', body: 'Mail stays where it is. A forwarded copy shows here to read, and replies go out from Gmail or Outlook.' },
  { id: 'mix', icon: Shuffle, title: 'Some of each', body: `Google, Microsoft or Zoho keeps the domain and passes the addresses it doesn’t know to ${product.name}.` },
  { id: 'hosted', icon: Server, title: `Move to ${product.name}`, body: 'The domain’s mail comes here. Cancel the other licences.' },
  { id: 'none', icon: MailX, title: 'No email here', body: 'Mail stays off. Chat, Tasks, Calendar and the rest keep working.' },
];
const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho' },
  { id: 'imap', name: 'Another provider' },
];
const KEY_NAME: Record<string, string> = { verify: 'Proof the domain is yours (TXT)', mx: 'Where mail arrives (MX)', spf: 'Who may send (SPF)', dkim: 'Signature (DKIM)', dmarc: 'Policy (DMARC)', ptr: 'Reverse DNS of the server', a: 'The server’s address record', port25: 'Outgoing port 25', inbound: 'Incoming mail port' };
const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

/** Settings, Email delivery: where a company's mail lives, how it goes out, the records to add, and whether they're there. */
export function EmailDeliverySection({
  ws,
  canManage,
  firstName,
  myEmail,
  onWorkspace,
  onAddAccount,
  onRemoveAccount,
  toast,
}: {
  ws: Workspace;
  canManage: boolean;
  firstName: string;
  myEmail?: string; // the person's own mailbox here, for their forwarding address
  onWorkspace: (p: Partial<Workspace>) => void;
  onAddAccount?: () => void; // admins: opens "Add an email account"
  onRemoveAccount?: (a: Account) => void; // admins: asks what happens to its mail, then removes it
  toast: (t: string) => void;
}) {
  const [info, setInfo] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [guide, setGuide] = useState(false);
  const [aliasEdit, setAliasEdit] = useState<MailAlias | 'new' | null>(null);
  const [leaving, setLeaving] = useState<string[]>([]); // addresses folding away while they're removed
  const mailboxes = ws.accounts.filter((a) => !a.temp);
  const mailboxRows = useLeaving(mailboxes, (a) => a.id); // a removed one folds away (the remove happens in a dialog)
  const hostedBoxes = mailboxes.filter((a) => !a.provider || a.provider === 'sprint2go');
  const room = mailboxRoom(ws.plan ?? trialPlan(ws.name, ''), Math.max(1, ws.members.length));
  const boxRoom = { ...room, used: countedMailboxes(ws.accounts, room.sharedFree) };
  const aliases = ws.mailAliases ?? [];
  /** Aliases are checked and kept by the server (at your domain, not taken); the demo keeps them here. */
  const saveAliases = async (list: MailAlias[]): Promise<string | null> => {
    if (!server.on) return (onWorkspace({ mailAliases: list }), null);
    return post('aliases', { workspaceId: ws.id, aliases: list }).then(
      () => null,
      (e: Error) => e.message,
    );
  };
  // The records follow what's picked on screen, even before the change has reached the server.
  const load = () =>
    fetch(`/api/mail/setup?ws=${encodeURIComponent(ws.id)}&setup=${ws.emailSetup ?? 'none'}&provider=${ws.emailProvider ?? ''}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not load.')))
      .catch(() => setError('No connection.'));
  useEffect(() => {
    void load();
  }, [ws.id, ws.emailSetup, ws.emailProvider, ws.mailRoute, ws.domains.join(','), ws.mailChecks?.at]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Credits are bought with an invoice paid by bank transfer: they arrive when it's paid, never before.
  const [ordering, setOrdering] = useState<(typeof MAIL_PACKS)[number] | null>(null);
  const buy = async (n: number) => {
    setBusy(true);
    try {
      const r = (await post('credits', { workspaceId: ws.id, pack: n })) as { invoice: { number: string; total: number } };
      toast(`Invoice ${r.invoice.number} for ${rp(r.invoice.total)} is in Plan & billing. The ${n.toLocaleString('id-ID')} emails are added when it’s paid.`);
      setOrdering(null);
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
                <div className="aw-tones wrap">
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
                {provider === 'imap' ? 'Your mail provider' : providerName(provider)} keeps the domain and its MX records. In its admin settings, mail for addresses it doesn’t know is routed on to <code className="mono">{info?.host ?? '…'}</code>. People on {product.name} mail can write to colleagues on {providerLabel(provider)} as usual.
              </p>
            )}
            {setup === 'hosted' && ws.domains[0] && <p className="small muted">When the MX record below points here, new mail for {ws.domains[0]} arrives in {product.name}. Old mail stays where it is for now: bringing it over isn’t available yet.</p>}
            {setup !== 'none' && setup !== 'hosted' && (
              <>
                <button type="button" className="link-btn small" onClick={() => setGuide((g) => !g)}>
                  {guide ? 'Hide the steps' : `Show the ${setup === 'mix' ? 'routing' : 'forwarding'} steps`}
                </button>
                <div className={`fold ${guide ? 'open' : ''}`}>
                  <div className="fold-in">
                    <EmailSetupGuide
                      workspaceId={ws.id}
                      mode={setup === 'mix' ? 'split' : 'forward'}
                      provider={provider}
                      domain={ws.domains[0] ?? ''}
                      first={firstName.toLowerCase()}
                      company={ws.name}
                      address={myEmail}
                      onAddMailbox={onAddAccount}
                      onVerified={setup === 'mix' && canManage ? () => onWorkspace({ mailRouting: { ...(ws.mailRouting ?? { dailyCheck: true }), verifiedAt: new Date().toISOString(), lastCheck: { at: new Date().toISOString(), ok: true } } }) : undefined}
                    />
                  </div>
                </div>
              </>
            )}
          </SmoothHeight>
        </div>

        <div className="set-block">
          <h3>How your mail goes out</h3>
          {/* Boosted sending only where this server has it: otherwise there's nothing to choose (or buy). */}
          {server.on && info && !info.boostedAvailable ? (
            <p className="small muted">
              Mail goes out from the {product.name} mail server, signed with your domain’s own key.{route === 'boosted' ? ' Boosted sending isn’t available on this server, so it isn’t used.' : ''}
            </p>
          ) : (
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
                <li className="con">Paid per email: {MAIL_PACKS.map((p) => `${p.n.toLocaleString('id-ID')} for ${rp(p.price)}`).join(', ')}</li>
                <li className="con">Three extra signing records on your domain</li>
              </ul>
            </button>
          </div>
          )}
          <SmoothHeight>
            {route === 'boosted' && info?.boostedAvailable && (
              <div className="ed-credits">
                <span>
                  <strong>{info.credits.toLocaleString('id-ID')}</strong> emails left{info.credits === 0 ? '. Mail goes out from our server until you top up.' : '.'}
                  {!!info.creditOrders?.orders.length && (
                    <small className="ed-orders">
                      Waiting for payment:{' '}
                      {info.creditOrders.orders.map((o) => `${o.credits.toLocaleString('id-ID')} emails (invoice ${o.number}, ${rp(o.total)}, due ${new Date(o.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`).join('; ')}
                      . They’re added when it’s paid.
                    </small>
                  )}
                </span>
                {info.creditOrders?.blocked ? (
                  <small className="muted">{info.creditOrders.blocked}</small>
                ) : ordering ? (
                  <span className="cancel-confirm">
                    <small>
                      An invoice for {rp(ordering.price)} plus PPN, paid by bank transfer{info.creditOrders?.bank ? ` to ${info.creditOrders.bank}` : ''}. The emails arrive when it’s paid.
                    </small>
                    <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => setOrdering(null)}>
                      Not now
                    </button>
                    <button type="button" className="primary-btn sm" disabled={busy || !canManage} onClick={() => void buy(ordering.n)}>
                      {busy ? 'Ordering…' : `Order ${ordering.n.toLocaleString('id-ID')}`}
                    </button>
                  </span>
                ) : (
                  <span className="ed-packs">
                    {MAIL_PACKS.map((p) => (
                      <button key={p.n} type="button" className="ghost-btn sm" disabled={busy || !canManage} onClick={() => setOrdering(p)}>
                        +{p.n.toLocaleString('id-ID')} · {rp(p.price)}
                      </button>
                    ))}
                  </span>
                )}
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
          {info?.ownership && (info.ownership.state === 'held' || info.ownership.state === 'taken') && (
            <p className="ed-owner bad">
              <AlertTriangle size={15} />
              <span>
                <strong>Another company uses {info.ownership.domain}.</strong> Its mail can’t arrive here or go out from {product.name} for you until you prove the domain is yours with the record below.
              </span>
            </p>
          )}
          {info && info.ownDomain && (
            <>
              <p className="small muted">
                {info.dnsHost ? (
                  <>
                    {info.domain}’s DNS is at <b>{info.dnsHost.name}</b>, so add these there: {info.dnsHost.where}.
                  </>
                ) : (
                  <>
                    Add these where {info.domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain{setup === 'keep' || setup === 'mix' ? `, and often not ${providerLabel(provider)}` : ''}.
                    {info.nameservers?.length ? ` ${info.domain} uses ${info.nameservers.join(' and ')}.` : ''}
                  </>
                )}{' '}
                Changes can take up to an hour to show.
              </p>
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
              {info.ownership?.state === 'verified' && (
                <p className="small ed-ok">
                  {info.ownership.domain} is verified as yours{info.ownership.how && PROVEN_BY[info.ownership.how] ? ` by ${PROVEN_BY[info.ownership.how]}` : ''}.
                </p>
              )}
              {info.ownership?.state === 'pending' && (
                <p className="small muted ed-owner-line">
                  <span>
                    {info.ownership.domain} isn’t verified as yours yet. That happens by itself once {setup === 'hosted' ? 'the MX record points here' : route === 'own' ? 'the DKIM record is in place' : 'a record proves it'}, or add this TXT record at <code className="mono">@</code>:
                  </span>
                  <span className="ed-rec-value">
                    <code className="mono">{info.ownership.record.value}</code>
                    <button type="button" className="icon-btn sm" title="Copy" onClick={() => copy(info.ownership!.record.value)}>
                      {copied === info.ownership.record.value ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                </p>
              )}
            </>
          )}
        </div>

        {info?.ownDomain && server.on && <BimiBlock ws={ws} copy={copy} copied={copied} toast={toast} />}

        {ws.emailSetup !== 'none' && (
          <div className="set-block">
            <div className="ed-head">
              <h3>Your mailboxes</h3>
              <span className="ed-head-actions">
                {mailboxes.length > 0 && (
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
                )}
                {canManage && onAddAccount && (
                  <button type="button" className="ghost-btn sm outline" onClick={onAddAccount}>
                    <Plus size={14} /> Add a mailbox
                  </button>
                )}
              </span>
            </div>
            {/* The plan's room for hosted mailboxes, where people add them (the server holds the same rule). */}
            {(setup === 'hosted' || setup === 'mix') && (
              <p className={`small ${boxRoom.used > boxRoom.total ? 'ed-room over' : 'muted'}`}>
                {boxRoom.used} of {boxRoom.total} hosted mailbox{boxRoom.total === 1 ? '' : 'es'} in use
                {boxRoom.sharedFree ? ': one comes with the plan for each person, and shared inboxes are free.' : ': on Free, each hosted mailbox is an add-on.'}
                {boxRoom.used > boxRoom.total ? ` ${boxRoom.used - boxRoom.total} of them receive mail but can’t send until there’s room.` : ''}
                {boxRoom.used >= boxRoom.total ? ' For more, an owner adds mailboxes in Settings, Plan & billing, Add-ons.' : ''}
              </p>
            )}
            {mailboxes.length === 0 ? (
              <p className="small muted">No mailboxes yet. Add one for each person, and shared inboxes like hello@ for the team.</p>
            ) : (
              <div className="ed-records">
                {mailboxRows.map(({ item: a, leaving: going }) => {
                  const r = ws.mailReady?.mailboxes?.[a.id];
                  // Kept with Google or Microsoft: copies arriving here is all it can do, so that counts as working.
                  const kept = !!a.provider && a.provider !== 'sprint2go';
                  const both = kept ? r?.receive : r?.receive && r?.send;
                  const extra = aliases.filter((al) => al.to.includes(a.id)).map((al) => al.address);
                  return (
                    <div key={a.id} className={`ed-record ${!r ? '' : both ? 'ok' : 'bad'}${going ? ' leaving' : ''}`}>
                      <span className="ed-rec-main">
                        <strong>{a.email}</strong>
                        <small className="muted">
                          {a.kind === 'shared' ? 'Shared inbox · ' : ''}
                          {!r ? 'Not checked yet' : kept ? (r.receive ? 'Copies arrive here' : 'No copies yet') : `${r.receive ? 'Receives' : 'Doesn’t receive yet'} · ${r.send ? 'sends' : 'doesn’t send yet'}`}
                          {r?.why ? `. ${r.why}` : ''}
                        </small>
                        {extra.length > 0 && <small className="muted">Also gets mail for {extra.join(', ')}</small>}
                      </span>
                      <span className="ed-rec-state">{r ? both ? <Check size={15} /> : <AlertTriangle size={15} /> : null}</span>
                      {canManage && onRemoveAccount && (
                        <button type="button" className="icon-btn sm ed-rec-del" title={`Remove ${a.email}`} aria-label={`Remove ${a.email}`} onClick={() => onRemoveAccount(a)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {ws.mailReady && mailboxes.length > 0 && <p className="small muted">Checked {relative(ws.mailReady.at)}. Mail unlocks for everyone as soon as a mailbox works.</p>}
          </div>
        )}

        {(setup === 'hosted' || setup === 'mix') && hostedBoxes.length > 0 && (
          <div className="set-block">
            <div className="ed-head">
              <h3>Other addresses</h3>
              {canManage && (
                <button type="button" className={`ghost-btn sm outline ${ws.domains.length ? '' : 'off'}`} aria-disabled={ws.domains.length ? undefined : true} title={ws.domains.length ? undefined : 'Add your domain under General first'} onClick={() => (ws.domains.length ? setAliasEdit('new') : toast('Add your domain under General first: addresses live at your own domain.'))}>
                  <Plus size={14} /> Add an address
                </button>
              )}
            </div>
            <p className="small muted">Addresses like sales@ or info@ that deliver into mailboxes here: into a shared inbox, or a copy to each of several people.</p>
            {aliases.length > 0 && (
              <div className="ed-records">
                {aliases.map((al) => (
                  <div key={al.id} className={`ed-record ${leaving.includes(al.id) ? 'leaving' : ''}`}>
                    <span className="ed-rec-main">
                      <strong>{al.address}</strong>
                      <small className="muted">
                        {al.to.length > 1 ? 'A copy to each of ' : 'Into '}
                        {al.to.map((id) => ws.accounts.find((a) => a.id === id)?.email ?? 'a removed mailbox').join(', ')}
                      </small>
                    </span>
                    {canManage && (
                      <span className="ed-rec-tools">
                        <button type="button" className="icon-btn sm" title={`Change ${al.address}`} aria-label={`Change ${al.address}`} onClick={() => setAliasEdit(al)}>
                          <PenLine size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn sm"
                          title={`Remove ${al.address}`}
                          aria-label={`Remove ${al.address}`}
                          onClick={() => {
                            setLeaving((l) => [...l, al.id]);
                            setTimeout(
                              () =>
                                void saveAliases(aliases.filter((x) => x.id !== al.id)).then((err) => {
                                  setLeaving((l) => l.filter((x) => x !== al.id));
                                  toast(err ?? `${al.address} removed. Mail to it is refused from now on.`);
                                }),
                              220,
                            );
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
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
              {/* Operators only (the server sends it to them alone): customers have nothing to do about it. */}
              {info.cert && (
                <div className={`ed-record ${info.cert.trusted ? 'ok' : 'bad'}`}>
                  <span className="ed-rec-main">
                    <strong>Mail server certificate</strong>
                    <small className="muted">
                      {info.cert.trusted
                        ? `${info.cert.issuer ?? 'A trusted authority'}, valid until ${info.cert.validTo?.slice(0, 10)}.`
                        : info.cert.acme
                          ? `Self-signed until Let’s Encrypt issues one${info.cert.error ? `: ${info.cert.error.message}` : '.'}`
                          : info.cert.error
                            ? `Self-signed: ${info.cert.error.message}`
                            : 'Self-signed: providers that require a CA-signed certificate refuse it. Set CF_DNS_TOKEN or MAIL_TLS_CERT on the server.'}{' '}
                      Only operators see this.
                    </small>
                  </span>
                  <span className="ed-rec-state">{info.cert.trusted ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                </div>
              )}
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
      {aliasEdit && (
        <AliasDialog
          workspace={ws}
          alias={aliasEdit === 'new' ? undefined : aliasEdit}
          onClose={() => setAliasEdit(null)}
          onSave={async (al) => {
            const err = await saveAliases(aliasEdit === 'new' ? [...aliases, al] : aliases.map((x) => (x.id === al.id ? al : x)));
            if (!err) {
              setAliasEdit(null);
              toast(aliasEdit === 'new' ? `${al.address} added. Send it a test to see it arrive.` : `${al.address} saved`);
            }
            return err;
          }}
        />
      )}
    </>
  );
}

type BimiState = {
  domain: string;
  url: string;
  https: boolean;
  logo: { name: string; at: string } | null;
  record: { type: string; host: string; value: string };
  dns: { found: string | null; matches: boolean };
  dmarc: { found: string | null; policy: string | null; enforced: boolean };
};

/**
 * Logo in inboxes (BIMI): the plumbing only. An SVG logo checked for the SVG Tiny PS basics, served at a stable https
 * address, and the exact default._bimi record with what DNS says. Gmail also needs a VMC or CMC certificate, which
 * this can't get, so it never says the logo shows.
 */
function BimiBlock({ ws, copy, copied, toast }: { ws: Workspace; copy: (v: string) => void; copied: string; toast: (t: string) => void }) {
  const [st, setSt] = useState<BimiState | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const call = (method: 'GET' | 'POST' | 'DELETE', body?: unknown) =>
    fetch(method === 'GET' ? `/api/mail/bimi?ws=${encodeURIComponent(ws.id)}` : '/api/mail/bimi', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error((d as { error?: string }).error ?? 'Something went wrong.'), { problems: (d as { problems?: string[] }).problems ?? [] });
      return d as BimiState;
    });
  useEffect(() => {
    void call('GET').then(setSt, () => setSt(null));
  }, [ws.id, ws.bimi?.fileId, ws.domains.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (f: File) => {
    setBusy(true);
    setProblems([]);
    try {
      setSt(await call('POST', { workspaceId: ws.id, name: f.name, svg: await f.text() }));
      toast('Logo saved. Add the record below to publish it.');
    } catch (e) {
      const list = (e as { problems?: string[] }).problems ?? [];
      if (list.length) setProblems(list);
      else toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      setSt(await call('DELETE', { workspaceId: ws.id }));
      toast('Logo removed. Remove the default._bimi record too.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows: { key: string; ok: boolean; title: string; text: string }[] = st
    ? [
        { key: 'logo', ok: !!st.logo, title: 'The logo', text: st.logo ? `${st.logo.name}, checked ${relative(st.logo.at)}.` : 'None yet. Upload an SVG Tiny PS file: square, with a title, no scripts or links to other files.' },
        { key: 'https', ok: st.https, title: 'Its address', text: st.https ? st.url : `${st.url}: inboxes only read logos over https, so this works once it’s on the live server.` },
        { key: 'record', ok: st.dns.matches, title: 'The record', text: st.dns.matches ? `default._bimi.${st.domain} points at this logo.` : st.dns.found ? `default._bimi.${st.domain} has a different record: ${st.dns.found}` : `Not in DNS yet.` },
        { key: 'dmarc', ok: st.dmarc.enforced, title: 'DMARC policy', text: st.dmarc.enforced ? `p=${st.dmarc.policy}, as BIMI needs.` : st.dmarc.found ? `BIMI needs p=quarantine or p=reject for all mail; ${st.domain} has p=${st.dmarc.policy ?? 'none'}.` : `BIMI needs a DMARC record with p=quarantine or p=reject; ${st.domain} has none.` },
      ]
    : [];
  return (
    <div className="set-block">
      <div className="ed-head">
        <h3>Logo in inboxes (BIMI)</h3>
        <span className="ed-head-actions">
          {st?.logo && (
            <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={14} /> Remove
            </button>
          )}
          <button type="button" className="ghost-btn sm outline" disabled={busy || !st} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {st?.logo ? 'Replace' : 'Upload a logo'}
          </button>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      <p className="small muted">Optional. Some inboxes show your logo next to mail from {st?.domain ?? 'your domain'}. Gmail also needs a VMC or CMC certificate for it: those need 12 months of the logo in use, or a registered trademark. Until you have one, the logo doesn’t show in Gmail.</p>
      <div className={`fold ${problems.length ? 'open' : ''}`}>
        <div>
          {problems.length > 0 && (
            <div className="ed-owner bad bimi-problems" role="alert">
              <AlertTriangle size={15} />
              <span>
                <strong>This logo can’t be used yet:</strong>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </span>
            </div>
          )}
        </div>
      </div>
      {!st && <div className="lazy-wait" aria-hidden />}
      {st && (
        <>
          <div className="bimi-main">
            <span className="bimi-logo" aria-label={st.logo ? 'Your logo' : 'No logo yet'}>{st.logo ? <img src={`/bimi/${encodeURIComponent(ws.id)}.svg?v=${encodeURIComponent(st.logo.at)}`} alt="" /> : <ImageOff size={18} />}</span>
            <div className="ed-records bimi-checks">
              {rows.map((r) => (
                <div key={r.key} className={`ed-record ${r.ok ? 'ok' : 'bad'}`}>
                  <span className="ed-rec-main">
                    <strong>{r.title}</strong>
                    <small className="muted">{r.text}</small>
                  </span>
                  <span className="ed-rec-state">{r.ok ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                </div>
              ))}
            </div>
          </div>
          {/* The record, once there's a logo for it to point at: folds open and closed with the logo. */}
          <div className={`fold ${st.logo ? 'open' : ''}`}>
            <div>
            <div className="ed-records">
              <div className={`ed-record ${st.dns.matches ? 'ok' : ''}`}>
                <span className="ed-rec-type mono">{st.record.type}</span>
                <span className="ed-rec-main">
                  <span className="ed-rec-host mono">{st.record.host}</span>
                  <span className="ed-rec-value">
                    <code className="mono">{st.record.value}</code>
                    <button type="button" className="icon-btn sm" title="Copy" onClick={() => copy(st.record.value)}>
                      {copied === st.record.value ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                  <small className="muted">Points inboxes at your logo. The empty a= is where a VMC or CMC certificate goes once you have one.</small>
                </span>
                <span className="ed-rec-state">{st.dns.matches ? <Check size={15} /> : null}</span>
              </div>
            </div>
            </div>
          </div>
          <p className="small muted">{st.logo && st.dns.matches && st.dmarc.enforced && st.https ? 'Ready for inboxes that show logos without a certificate. Not in Gmail: it needs the VMC or CMC certificate.' : 'Not showing anywhere yet.'}</p>
        </>
      )}
    </div>
  );
}
