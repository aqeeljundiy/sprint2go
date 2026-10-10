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
import { mark, t, tn } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtDay, fmtList, fmtMoney, fmtNumber } from '../../i18n/format';

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
  /** Unlimited: Boosted sending has a monthly limit instead of credits (`mine`: whether it's on for this person). */
  unlimited?: { limit: number; used: number; mine: boolean } | null;
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
const PROVEN_BY: Record<string, string> = { mx: mark('its MX record points here'), dkim: mark('its signing record'), txt: mark('its sprint2go-verify record') };

/** Built when shown, so a white-labelled company sees its own name. */
const receive = (): { id: EmailSetup; icon: LucideIcon; title: string; body: string }[] => [
  { id: 'keep', icon: Cloud, title: t('Keep Gmail or Outlook'), body: t('Mail stays where it is. A forwarded copy shows here to read, and replies go out from Gmail or Outlook.') },
  { id: 'mix', icon: Shuffle, title: t('Some of each'), body: t('Google, Microsoft or Zoho keeps the domain and passes the addresses it doesn’t know to {product}.', { product: product.name }) },
  { id: 'hosted', icon: Server, title: t('Move to {product}', { product: product.name }), body: t('The domain’s mail comes here. Cancel the other licences.') },
  { id: 'none', icon: MailX, title: t('No email here'), body: t('Mail stays off. Chat, Tasks, Calendar and the rest keep working.') },
];
const PROVIDERS: { id: MailProvider; name: string }[] = [
  { id: 'google', name: 'Google Workspace' },
  { id: 'microsoft', name: 'Microsoft 365' },
  { id: 'zoho', name: 'Zoho' },
  { id: 'imap', name: mark('Another provider') },
];
const KEY_NAME: Record<string, string> = { verify: mark('Proof the domain is yours (TXT)'), mx: mark('Where mail arrives (MX)'), spf: mark('Who may send (SPF)'), dkim: mark('Signature (DKIM)'), dmarc: mark('Policy (DMARC)'), ptr: mark('Reverse DNS of the server'), a: mark('The server’s address record'), port25: mark('Outgoing port 25'), inbound: mark('Incoming mail port') };

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
      (e: Error) => e.message, // already in the reader's language (post)
    );
  };
  // The records follow what's picked on screen, even before the change has reached the server.
  const load = () =>
    fetch(`/api/mail/setup?ws=${encodeURIComponent(ws.id)}&setup=${ws.emailSetup ?? 'none'}&provider=${ws.emailProvider ?? ''}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? mark('Could not load.'))))
      .catch(() => setError(mark('No connection.')));
  useEffect(() => {
    void load();
  }, [ws.id, ws.emailSetup, ws.emailProvider, ws.mailRoute, ws.domains.join(','), ws.mailChecks?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`/api/mail/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    const err = (data as { error?: string }).error;
    if (!r.ok) throw new Error(err ? t(err) : t('Something went wrong.'));
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
      toast(r?.allOk ? t('All records are in place.') : t('Some records are still missing.'));
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
      toast(route === 'boosted' ? t('Boosted sending is on. Add the three signing records.') : t('Mail goes out from the sprint2go server.'));
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
      toast(t('Invoice {number} for {total} is in Plan & billing. The {n} emails are added when it’s paid.', { number: r.invoice.number, total: fmtMoney(r.invoice.total), n: fmtNumber(n) }));
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
      <h2>{t('Email delivery')}</h2>
      <p className="set-intro">{t('Two decisions you can change any time: where your domain’s mail lives, and how mail from {product} goes out. Nothing switches until the records are really there.', { product: product.name })}</p>
      {error && <p className="modal-note">{t(error)}</p>}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>{t('Where your mail lives')}</h3>
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
                <label>{t('Which provider')}</label>
                <div className="aw-tones wrap">
                  {PROVIDERS.map((p) => (
                    <button key={p.id} type="button" className={provider === p.id ? 'on' : ''} onClick={() => onWorkspace({ emailProvider: p.id })}>
                      {t(p.name)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {setup === 'mix' && (
              <p className="small muted">
                {tj('{provider} keeps the domain and its MX records. In its admin settings, mail for addresses it doesn’t know is routed on to {host}. People on {product} mail can write to colleagues on {other} as usual.', {
                  provider: provider === 'imap' ? t('Your mail provider') : providerName(provider),
                  host: <code className="mono">{info?.host ?? '…'}</code>,
                  product: product.name,
                  other: providerLabel(provider),
                })}
              </p>
            )}
            {setup === 'hosted' && ws.domains[0] && <p className="small muted">{t('When the MX record below points here, new mail for {domain} arrives in {product}. Old mail stays where it is for now: bringing it over isn’t available yet.', { domain: ws.domains[0], product: product.name })}</p>}
            {setup !== 'none' && setup !== 'hosted' && (
              <>
                <button type="button" className="link-btn small" onClick={() => setGuide((g) => !g)}>
                  {guide ? t('Hide the steps') : setup === 'mix' ? t('Show the routing steps') : t('Show the forwarding steps')}
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
          <h3>{t('How your mail goes out')}</h3>
          {/* Boosted sending only where this server has it: otherwise there's nothing to choose (or buy). */}
          {server.on && info && !info.boostedAvailable ? (
            <p className="small muted">
              {t('Mail goes out from the {product} mail server, signed with your domain’s own key.', { product: product.name })}
              {route === 'boosted' ? ` ${t('Boosted sending isn’t available on this server, so it isn’t used.')}` : ''}
            </p>
          ) : (
          <div className="ed-routes">
            <button type="button" className={`ed-route ${route === 'own' ? 'on' : ''}`} disabled={busy} onClick={() => void setRoute('own')}>
              <span className="ed-route-head">
                <Server size={18} />
                <strong>{t('{product} mail server', { product: product.name })}</strong>
                <em>{t('Included')}</em>
              </span>
              <ul>
                <li className="pro">{t('Free, no limits')}</li>
                <li className="pro">{t('Your own server, your own reputation')}</li>
                <li className="con">{t('A brand-new domain can land in spam at Gmail and Outlook for the first weeks')}</li>
                <li className="con">{t('Needs SPF, DKIM and DMARC records on your domain')}</li>
              </ul>
            </button>
            <button type="button" className={`ed-route ${route === 'boosted' ? 'on' : ''} ${!info?.boostedAvailable ? 'off' : ''}`} disabled={busy || !info?.boostedAvailable} onClick={() => void setRoute('boosted')}>
              <span className="ed-route-head">
                <Zap size={18} />
                <strong>{t('Boosted sending')}</strong>
                <em>{!info?.boostedAvailable ? t('Coming soon') : info.unlimited ? t('Included') : t('Credits')}</em>
              </span>
              <ul>
                <li className="pro">{t('Proven delivery to Gmail and Outlook from day one')}</li>
                <li className="pro">{t('Bounces and complaints handled for you')}</li>
                {info?.unlimited ? (
                  <li className="pro">{t('Included with Unlimited: {n} emails a month', { n: fmtNumber(info.unlimited.limit) })}</li>
                ) : (
                  <li className="con">{t('Paid per email: {packs}', { packs: MAIL_PACKS.map((p) => t('{n} for {price}', { n: fmtNumber(p.n), price: fmtMoney(p.price) })).join(', ') })}</li>
                )}
                <li className="con">{t('Three extra signing records on your domain')}</li>
              </ul>
            </button>
          </div>
          )}
          <SmoothHeight>
            {route === 'boosted' && info?.boostedAvailable && info.unlimited && (
              <div className="ed-credits">
                <span>
                  {info.unlimited.used >= info.unlimited.limit
                    ? t('This month’s {n} Boosted emails are used up, so mail goes out from our server until the 1st. Ask your admin.', { n: fmtNumber(info.unlimited.limit) })
                    : tj('{used} of {n} Boosted emails used this month.', { used: <strong>{fmtNumber(info.unlimited.used)}</strong>, n: fmtNumber(info.unlimited.limit) })}
                  {!info.unlimited.mine && <small className="ed-orders">{t('Boosted sending is switched off for you, so your mail goes out from our server.')}</small>}
                </span>
              </div>
            )}
            {route === 'boosted' && info?.boostedAvailable && !info.unlimited && (
              <div className="ed-credits">
                <span>
                  {info.credits === 0
                    ? tj('{n} emails left. Mail goes out from our server until you top up.', { n: <strong>{fmtNumber(0)}</strong> })
                    : info.credits === 1
                      ? tj('{n} email left.', { n: <strong>{fmtNumber(1)}</strong> })
                      : tj('{n} emails left.', { n: <strong>{fmtNumber(info.credits)}</strong> })}
                  {!!info.creditOrders?.orders.length && (
                    <small className="ed-orders">
                      {t('Waiting for payment: {orders}. They’re added when it’s paid.', {
                        orders: info.creditOrders.orders.map((o) => t('{n} emails (invoice {number}, {total}, due {date})', { n: fmtNumber(o.credits), number: o.number, total: fmtMoney(o.total), date: fmtDay(o.dueAt) })).join('; '),
                      })}
                    </small>
                  )}
                </span>
                {info.creditOrders?.blocked ? (
                  <small className="muted">{t(info.creditOrders.blocked)}</small>
                ) : ordering ? (
                  <span className="cancel-confirm">
                    <small>
                      {info.creditOrders?.bank
                        ? t('An invoice for {price} plus PPN, paid by bank transfer to {bank}. The emails arrive when it’s paid.', { price: fmtMoney(ordering.price), bank: info.creditOrders.bank })
                        : t('An invoice for {price} plus PPN, paid by bank transfer. The emails arrive when it’s paid.', { price: fmtMoney(ordering.price) })}
                    </small>
                    <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => setOrdering(null)}>
                      {t('Not now')}
                    </button>
                    <button type="button" className="primary-btn sm" disabled={busy || !canManage} onClick={() => void buy(ordering.n)}>
                      {busy ? t('Ordering…') : t('Order {n}', { n: fmtNumber(ordering.n) })}
                    </button>
                  </span>
                ) : (
                  <span className="ed-packs">
                    {MAIL_PACKS.map((p) => (
                      <button key={p.n} type="button" className="ghost-btn sm" disabled={busy || !canManage} onClick={() => setOrdering(p)}>
                        +{fmtNumber(p.n)} · {fmtMoney(p.price)}
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
            <h3>{t('Records for {domain}', { domain: info?.domain ?? ws.domains[0] ?? t('your domain') })}</h3>
            {info?.ownDomain && (
              <button type="button" className="ghost-btn sm outline" disabled={checking} onClick={() => void check()}>
                {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {checking ? t('Checking…') : checks ? t('Check again') : t('Check the records')}
              </button>
            )}
          </div>
          {!info && !error && <div className="lazy-wait" aria-hidden />}
          {info && !info.ownDomain && (
            <p className="small muted">
              {tj('Your addresses live at {host}, so there is nothing to add: mail to them arrives here as it is. To use your own domain, add it under General.', { host: <code className="mono">{info.host}</code> })}
            </p>
          )}
          {info?.ownership && (info.ownership.state === 'held' || info.ownership.state === 'taken') && (
            <p className="ed-owner bad">
              <AlertTriangle size={15} />
              <span>
                <strong>{t('Another company uses {domain}.', { domain: info.ownership.domain })}</strong> {t('Its mail can’t arrive here or go out from {product} for you until you prove the domain is yours with the record below.', { product: product.name })}
              </span>
            </p>
          )}
          {info && info.ownDomain && (
            <>
              <p className="small muted">
                {info.dnsHost ? (
                  tj('{domain}’s DNS is at {host}, so add these there: {where}.', { domain: info.domain, host: <b>{info.dnsHost.name}</b>, where: info.dnsHost.where })
                ) : (
                  <>
                    {setup === 'keep' || setup === 'mix'
                      ? t('Add these where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain, and often not {provider}.', { domain: info.domain, provider: providerLabel(provider) })
                      : t('Add these where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain.', { domain: info.domain })}
                    {info.nameservers?.length ? ` ${t('{domain} uses {nameservers}.', { domain: info.domain, nameservers: fmtList(info.nameservers) })}` : ''}
                  </>
                )}{' '}
                {t('Changes can take up to an hour to show.')}
              </p>
              <div className="ed-records">
                {info.records.map((r) => {
                  const res = resultFor(r.key);
                  return (
                    <div key={r.key + r.host} className={`ed-record ${res ? (res.ok ? 'ok' : 'bad') : ''}`}>
                      <span className="ed-rec-type mono">{r.type}</span>
                      <span className="ed-rec-main">
                        <span className="ed-rec-host mono">{r.host.startsWith('(') ? t(r.host) : r.host}</span>
                        <span className="ed-rec-value">
                          <code className="mono">{r.value.startsWith('(') || r.host.startsWith('(') ? t(r.value) : r.value}</code>
                          {!r.value.startsWith('(') && (
                            <button type="button" className="icon-btn sm" title={t('Copy')} onClick={() => copy(r.value)}>
                              {copied === r.value ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          )}
                        </span>
                        <small className="muted">{t(r.note)}</small>
                        {res && !res.ok && <small className="ed-found">{t('Found: {found}', { found: t(res.found) })}</small>}
                      </span>
                      <span className="ed-rec-state">{res ? res.ok ? <Check size={15} /> : <AlertTriangle size={15} /> : null}</span>
                    </div>
                  );
                })}
              </div>
              {checks && (
                <p className={`small ${checks.allOk ? 'ed-ok' : 'muted'}`}>
                  {checks.allOk ? t('Everything is in place.') : t('{missing} of {total} still missing.', { missing: checks.checks.filter((c) => !c.ok).length, total: checks.checks.length })} {t('Checked {ago}.', { ago: relative(checks.at) })}
                </p>
              )}
              {info.ownership?.state === 'verified' && (
                <p className="small ed-ok">
                  {info.ownership.how && PROVEN_BY[info.ownership.how]
                    ? t('{domain} is verified as yours by {how}.', { domain: info.ownership.domain, how: t(PROVEN_BY[info.ownership.how]) })
                    : t('{domain} is verified as yours.', { domain: info.ownership.domain })}
                </p>
              )}
              {info.ownership?.state === 'pending' && (
                <p className="small muted ed-owner-line">
                  <span>
                    {setup === 'hosted'
                      ? tj('{domain} isn’t verified as yours yet. That happens by itself once the MX record points here, or add this TXT record at {at}:', { domain: info.ownership.domain, at: <code className="mono">@</code> })
                      : route === 'own'
                        ? tj('{domain} isn’t verified as yours yet. That happens by itself once the DKIM record is in place, or add this TXT record at {at}:', { domain: info.ownership.domain, at: <code className="mono">@</code> })
                        : tj('{domain} isn’t verified as yours yet. That happens by itself once a record proves it, or add this TXT record at {at}:', { domain: info.ownership.domain, at: <code className="mono">@</code> })}
                  </span>
                  <span className="ed-rec-value">
                    <code className="mono">{info.ownership.record.value}</code>
                    <button type="button" className="icon-btn sm" title={t('Copy')} onClick={() => copy(info.ownership!.record.value)}>
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
              <h3>{t('Your mailboxes')}</h3>
              <span className="ed-head-actions">
                {mailboxes.length > 0 && (
                  <button
                    type="button"
                    className="ghost-btn sm outline"
                    disabled={checking}
                    onClick={() => {
                      setChecking(true);
                      void post('ready', { workspaceId: ws.id })
                        .then(() => toast(t('Checked again.')))
                        .catch((e: Error) => toast(e.message))
                        .finally(() => setChecking(false));
                    }}
                  >
                    {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {t('Check again')}
                  </button>
                )}
                {canManage && onAddAccount && (
                  <button type="button" className="ghost-btn sm outline" onClick={onAddAccount}>
                    <Plus size={14} /> {t('Add a mailbox')}
                  </button>
                )}
              </span>
            </div>
            {/* The plan's room for hosted mailboxes, where people add them (the server holds the same rule). */}
            {(setup === 'hosted' || setup === 'mix') && (
              <p className={`small ${boxRoom.used > boxRoom.total ? 'ed-room over' : 'muted'}`}>
                {boxRoom.total === Infinity
                  ? tn(boxRoom.used, '{n} hosted mailbox in use. Unlimited has room for as many as you need.', '{n} hosted mailboxes in use. Unlimited has room for as many as you need.')
                  : boxRoom.sharedFree
                  ? tn(boxRoom.total, '{used} of {n} hosted mailbox in use: one comes with the plan for each person, and shared inboxes are free.', '{used} of {n} hosted mailboxes in use: one comes with the plan for each person, and shared inboxes are free.', { used: fmtNumber(boxRoom.used) })
                  : tn(boxRoom.total, '{used} of {n} hosted mailbox in use: on Free, each hosted mailbox is an add-on.', '{used} of {n} hosted mailboxes in use: on Free, each hosted mailbox is an add-on.', { used: fmtNumber(boxRoom.used) })}
                {boxRoom.used > boxRoom.total ? ` ${t('{n} of them receive mail but can’t send until there’s room.', { n: fmtNumber(boxRoom.used - boxRoom.total) })}` : ''}
                {boxRoom.used >= boxRoom.total ? ` ${t('For more, an owner adds mailboxes in Settings, Plan & billing, Add-ons.')}` : ''}
              </p>
            )}
            {mailboxes.length === 0 ? (
              <p className="small muted">{t('No mailboxes yet. Add one for each person, and shared inboxes like hello@ for the team.')}</p>
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
                          {a.kind === 'shared' ? `${t('Shared inbox')} · ` : ''}
                          {!r ? t('Not checked yet') : kept ? (r.receive ? t('Copies arrive here') : t('No copies yet')) : `${r.receive ? t('Receives') : t('Doesn’t receive yet')} · ${r.send ? t('sends') : t('doesn’t send yet')}`}
                          {r?.why ? `. ${t(r.why)}` : ''}
                        </small>
                        {extra.length > 0 && <small className="muted">{t('Also gets mail for {addresses}', { addresses: fmtList(extra) })}</small>}
                      </span>
                      <span className="ed-rec-state">{r ? both ? <Check size={15} /> : <AlertTriangle size={15} /> : null}</span>
                      {canManage && onRemoveAccount && (
                        <button type="button" className="icon-btn sm ed-rec-del" title={t('Remove {address}', { address: a.email })} aria-label={t('Remove {address}', { address: a.email })} onClick={() => onRemoveAccount(a)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {ws.mailReady && mailboxes.length > 0 && <p className="small muted">{t('Checked {ago}.', { ago: relative(ws.mailReady.at) })} {t('Mail unlocks for everyone as soon as a mailbox works.')}</p>}
          </div>
        )}

        {(setup === 'hosted' || setup === 'mix') && hostedBoxes.length > 0 && (
          <div className="set-block">
            <div className="ed-head">
              <h3>{t('Other addresses')}</h3>
              {canManage && (
                <button type="button" className={`ghost-btn sm outline ${ws.domains.length ? '' : 'off'}`} aria-disabled={ws.domains.length ? undefined : true} title={ws.domains.length ? undefined : t('Add your domain under General first')} onClick={() => (ws.domains.length ? setAliasEdit('new') : toast(t('Add your domain under General first: addresses live at your own domain.')))}>
                  <Plus size={14} /> {t('Add an address')}
                </button>
              )}
            </div>
            <p className="small muted">{t('Addresses like sales@ or info@ that deliver into mailboxes here: into a shared inbox, or a copy to each of several people.')}</p>
            {aliases.length > 0 && (
              <div className="ed-records">
                {aliases.map((al) => (
                  <div key={al.id} className={`ed-record ${leaving.includes(al.id) ? 'leaving' : ''}`}>
                    <span className="ed-rec-main">
                      <strong>{al.address}</strong>
                      <small className="muted">
                        {al.to.length > 1
                          ? t('A copy to each of {mailboxes}', { mailboxes: fmtList(al.to.map((id) => ws.accounts.find((a) => a.id === id)?.email ?? t('a removed mailbox'))) })
                          : t('Into {mailbox}', { mailbox: al.to.map((id) => ws.accounts.find((a) => a.id === id)?.email ?? t('a removed mailbox')).join(', ') })}
                      </small>
                    </span>
                    {canManage && (
                      <span className="ed-rec-tools">
                        <button type="button" className="icon-btn sm" title={t('Change {address}', { address: al.address })} aria-label={t('Change {address}', { address: al.address })} onClick={() => setAliasEdit(al)}>
                          <PenLine size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn sm"
                          title={t('Remove {address}', { address: al.address })}
                          aria-label={t('Remove {address}', { address: al.address })}
                          onClick={() => {
                            setLeaving((l) => [...l, al.id]);
                            setTimeout(
                              () =>
                                void saveAliases(aliases.filter((x) => x.id !== al.id)).then((err) => {
                                  setLeaving((l) => l.filter((x) => x !== al.id));
                                  toast(err ?? t('{address} removed. Mail to it is refused from now on.', { address: al.address }));
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
            <h3>{t('The {product} server', { product: product.name })}</h3>
            <p className="small muted">{t('These are ours to fix, not yours; they decide whether Gmail and Outlook accept mail from here.')}</p>
            <div className="ed-records">
              {(['inbound', 'port25', 'a', 'ptr'] as const).map((k) => {
                const h = info.health[k];
                return (
                  <div key={k} className={`ed-record ${h.ok ? 'ok' : 'bad'}`}>
                    <span className="ed-rec-main">
                      <strong>{t(KEY_NAME[k])}</strong>
                      <small className="muted">{h.ok ? t(h.found) : t('Found: {found}. Wanted: {want}.', { found: t(h.found), want: t(h.want) })}</small>
                    </span>
                    <span className="ed-rec-state">{h.ok ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                  </div>
                );
              })}
              {/* Operators only (the server sends it to them alone): customers have nothing to do about it. */}
              {info.cert && (
                <div className={`ed-record ${info.cert.trusted ? 'ok' : 'bad'}`}>
                  <span className="ed-rec-main">
                    <strong>{t('Mail server certificate')}</strong>
                    <small className="muted">
                      {info.cert.trusted
                        ? t('{issuer}, valid until {date}.', { issuer: info.cert.issuer ?? t('A trusted authority'), date: info.cert.validTo ? fmtDay(info.cert.validTo) : '' })
                        : info.cert.acme
                          ? info.cert.error
                            ? t('Self-signed until Let’s Encrypt issues one: {error}', { error: info.cert.error.message })
                            : t('Self-signed until Let’s Encrypt issues one.')
                          : info.cert.error
                            ? t('Self-signed: {error}', { error: info.cert.error.message })
                            : t('Self-signed: providers that require a CA-signed certificate refuse it. Set CF_DNS_TOKEN or MAIL_TLS_CERT on the server.')}{' '}
                      {t('Only operators see this.')}
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
            <h3>{t('This month')}</h3>
            <p className="small">
              {info.stats.spam ? t('{received} received ({spam} to spam)', { received: fmtNumber(info.stats.received), spam: fmtNumber(info.stats.spam) }) : t('{received} received', { received: fmtNumber(info.stats.received) })} ·{' '}
              {info.stats.boosted ? t('{sent} sent ({boosted} boosted)', { sent: fmtNumber(info.stats.sent), boosted: fmtNumber(info.stats.boosted) }) : t('{sent} sent', { sent: fmtNumber(info.stats.sent) })}
              {info.stats.failed ? ` · ${t('{n} could not be delivered', { n: fmtNumber(info.stats.failed) })}` : ''}
              {info.stats.queued ? ` · ${t('{n} on the way', { n: fmtNumber(info.stats.queued) })}` : ''}
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
              toast(aliasEdit === 'new' ? t('{address} added. Send it a test to see it arrive.', { address: al.address }) : t('{address} saved', { address: al.address }));
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
      const err = (d as { error?: string }).error;
      if (!r.ok) throw Object.assign(new Error(err ? t(err) : t('Something went wrong.')), { problems: (d as { problems?: string[] }).problems ?? [] });
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
      toast(t('Logo saved. Add the record below to publish it.'));
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
      toast(t('Logo removed. Remove the default._bimi record too.'));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows: { key: string; ok: boolean; title: string; text: string }[] = st
    ? [
        { key: 'logo', ok: !!st.logo, title: t('The logo'), text: st.logo ? t('{name}, checked {ago}.', { name: st.logo.name, ago: relative(st.logo.at) }) : t('None yet. Upload an SVG Tiny PS file: square, with a title, no scripts or links to other files.') },
        { key: 'https', ok: st.https, title: t('Its address'), text: st.https ? st.url : t('{url}: inboxes only read logos over https, so this works once it’s on the live server.', { url: st.url }) },
        { key: 'record', ok: st.dns.matches, title: t('The record'), text: st.dns.matches ? t('default._bimi.{domain} points at this logo.', { domain: st.domain }) : st.dns.found ? t('default._bimi.{domain} has a different record: {found}', { domain: st.domain, found: st.dns.found }) : t('Not in DNS yet.') },
        { key: 'dmarc', ok: st.dmarc.enforced, title: t('DMARC policy'), text: st.dmarc.enforced ? t('p={policy}, as BIMI needs.', { policy: st.dmarc.policy ?? '' }) : st.dmarc.found ? t('BIMI needs p=quarantine or p=reject for all mail; {domain} has p={policy}.', { domain: st.domain, policy: st.dmarc.policy ?? 'none' }) : t('BIMI needs a DMARC record with p=quarantine or p=reject; {domain} has none.', { domain: st.domain }) },
      ]
    : [];
  return (
    <div className="set-block">
      <div className="ed-head">
        <h3>{t('Logo in inboxes (BIMI)')}</h3>
        <span className="ed-head-actions">
          {st?.logo && (
            <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={14} /> {t('Remove')}
            </button>
          )}
          <button type="button" className="ghost-btn sm outline" disabled={busy || !st} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {st?.logo ? t('Replace') : t('Upload a logo')}
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
      <p className="small muted">{t('Optional. Some inboxes show your logo next to mail from {domain}. Gmail also needs a VMC or CMC certificate for it: those need 12 months of the logo in use, or a registered trademark. Until you have one, the logo doesn’t show in Gmail.', { domain: st?.domain ?? t('your domain') })}</p>
      <div className={`fold ${problems.length ? 'open' : ''}`}>
        <div>
          {problems.length > 0 && (
            <div className="ed-owner bad bimi-problems" role="alert">
              <AlertTriangle size={15} />
              <span>
                <strong>{t('This logo can’t be used yet:')}</strong>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{t(p)}</li>
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
            <span className="bimi-logo" aria-label={st.logo ? t('Your logo') : t('No logo yet')}>{st.logo ? <img src={`/bimi/${encodeURIComponent(ws.id)}.svg?v=${encodeURIComponent(st.logo.at)}`} alt="" /> : <ImageOff size={18} />}</span>
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
                    <button type="button" className="icon-btn sm" title={t('Copy')} onClick={() => copy(st.record.value)}>
                      {copied === st.record.value ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                  <small className="muted">{t('Points inboxes at your logo. The empty a= is where a VMC or CMC certificate goes once you have one.')}</small>
                </span>
                <span className="ed-rec-state">{st.dns.matches ? <Check size={15} /> : null}</span>
              </div>
            </div>
            </div>
          </div>
          <p className="small muted">{st.logo && st.dns.matches && st.dmarc.enforced && st.https ? t('Ready for inboxes that show logos without a certificate. Not in Gmail: it needs the VMC or CMC certificate.') : t('Not showing anywhere yet.')}</p>
        </>
      )}
    </div>
  );
}
