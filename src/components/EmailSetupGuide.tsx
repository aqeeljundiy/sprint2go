import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Mail, Plus, Send } from 'lucide-react';
import type { MailProvider } from '../types';
import { providerName } from './Onboarding';
import { mailInfo, server } from '../sync';
import { brand as product } from '../terms';
import { caps } from '../caps';
import { t, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtList, fmtNumber } from '../i18n/format';

/** The provider inside a sentence: "stays with Google Workspace", "stays with your mail provider". */
export const providerLabel = (p?: MailProvider) => (p === 'imap' ? t('your mail provider') : providerName(p));

/** "Some of each" only works for an address the provider doesn't know. What that means at each one. */
export const notAtProvider = (p?: MailProvider) =>
  p === 'microsoft'
    ? t('Nobody in Microsoft 365 may have it as a mailbox, group or mail contact, or Microsoft keeps the mail.')
    : p === 'zoho'
      ? t('Nobody in Zoho Mail may have it as an account or alias, or Zoho keeps the mail.')
      : p === 'imap'
        ? t('Your mail provider must not have a mailbox for it, or the provider keeps the mail.')
        : t('No Google Workspace user, alias or group may have it, or Google keeps the mail. A suspended user, or one with Gmail turned off, is fine.');

/** The private address a kept mailbox forwards a copy to. The server builds it the same way (localAccounts in server/mailer.ts). */
export const forwardAddress = (email: string, company: string, host: string) =>
  `${email.trim().toLowerCase().split('@')[0]}.${company.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'}@${host}`;

type Rec = { type: string; host: string; value: string; note: string; key?: string };
type SetupInfo = { records: Rec[]; dnsHost: { name: string; where: string } | null; nameservers: string[] };
const RECORD_NAME: Record<string, string> = { mx: 'MX', spf: 'SPF', dkim: 'DKIM', dmarc: 'DMARC' };

/**
 * How mail gets into sprint2go, step by step. Three ways:
 *  - forward: mail stays at Gmail or Outlook; a copy of everything is forwarded to the person's private sprint2go address.
 *  - move: the domain's mail moves to sprint2go (MX records), the old provider is cancelled.
 *  - split: "some of each". The domain stays with Google, Microsoft, Zoho or another host; routing there passes mail for
 *    addresses it doesn't know on to our server, so people without a licence get a real name@domain mailbox here.
 * With the server, every check asks it for real (records, mail that really arrived); steps it can't do yet say so. Only
 * the standalone demo plays the waits.
 * Menu names in Google's, Microsoft's and Zoho's admin screens stay as those screens write them (in English).
 */
export function EmailSetupGuide({
  mode,
  provider,
  domain,
  first,
  onVerified,
  workspaceId,
  onAddMailbox,
  company,
  address,
}: {
  mode: 'forward' | 'move' | 'split';
  provider: MailProvider;
  domain: string;
  first: string;
  onVerified?: () => void;
  workspaceId?: string;
  /** Opens "Add an email account" (admins in Settings), so the mailbox step can be done on the spot. */
  onAddMailbox?: () => void;
  /** The company's name and the person's own address: together they make the forwarding address, as the server does. */
  company?: string;
  address?: string;
}) {
  const real = server.on && !caps.demo;
  const d = domain || t('yourcompany.com');
  const slug = d.split('.')[0].replace(/[^a-z0-9]/g, '') || 'company';
  const you = tx('email', 'you');
  const mine = address || `${first || you}@${d}`;
  // A copy of their mail, forwarded here. Only the server's own name works, so the preview shows a stand-in.
  const inbox = address && company && mailInfo.host ? forwardAddress(address, company, mailInfo.host) : `${first || you}.${slug}@${mailInfo.host || 'in.sprint2go.com'}`;
  const prov = providerLabel(provider);
  const nameAt = `${tx('email', 'name')}@${d}`;
  const [copied, setCopied] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'wait' | 'ok' | 'no'>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [cur, setCur] = useState(0);
  useEffect(() => setCur(0), [mode, provider]); // a different path starts at its first step
  // "Send a test": where the server's routing test is ('' while idle).
  const [probeNote, setProbeNote] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  // Our certificate is CA-signed: providers can require that, and should.
  const trusted = real && caps.trustedCert;
  // "Some of each" with a real company: the records it really needs (the exact DKIM key) and who runs its DNS.
  const [info, setInfo] = useState<SetupInfo | null>(null);
  useEffect(() => {
    if (!real || !workspaceId || mode !== 'split') return;
    let live = true;
    fetch(`/api/mail/setup?ws=${encodeURIComponent(workspaceId)}&setup=mix&provider=${provider}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x: SetupInfo | null) => live && x && setInfo(x))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [real, workspaceId, mode, provider]);
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  };
  const post = (path: string) =>
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId }) }).then(async (r) => {
      const x = await r.json().catch(() => ({}));
      const err = (x as { error?: string }).error;
      if (!r.ok) throw new Error(err ? t(err) : t('The check didn’t go through. Try again.'));
      return x as any;
    });
  const routeHint =
    provider === 'microsoft'
      ? t('Check that {domain} is set to Internal relay, that the connector is on, and that nobody in Microsoft 365 has the address. Changes can take up to an hour.', { domain: d })
      : provider === 'zoho'
        ? t('Check that the route is on (Status) with Split Delivery, and that nobody in Zoho Mail has the address.')
        : provider === 'imap'
          ? t('Ask your provider whether split delivery is on for {domain}.', { domain: d })
          : t('Google can take up to an hour to start using a new rule. Check that no Google user has the address, and that the rule says “only on non-recognized addresses”.');
  /** Real checks: the records, or whether mail has arrived here yet. */
  const check = async (key: string): Promise<{ ok: boolean; why?: string }> => {
    if (key === 'dns') {
      const r = await post('/api/mail/check');
      const bad = ((r.checks ?? []) as { key: string; ok: boolean; found: string }[]).filter((c) => !c.ok);
      if (r.allOk) return { ok: true };
      const spfMany = bad.some((c) => c.key === 'spf' && /SPF records/.test(c.found));
      const lines = [t('Not found yet: {records}.', { records: fmtList(bad.map((c) => RECORD_NAME[c.key] ?? c.key)) })];
      if (spfMany) lines.push(t('{domain} has more than one SPF record; merge them into one.', { domain: d }));
      lines.push(t('New records can take a few minutes to show.'));
      return { ok: false, why: lines.join(' ') };
    }
    const r = await post('/api/mail/ready');
    if (key === 'route-test' && mode === 'split' && r.routing) {
      const g = r.routing as { hosted: string[]; arrived: string[] };
      if (g.arrived.length) return { ok: true };
      if (!g.hosted.length) return { ok: false, why: t('There’s no {product} mailbox at {domain} yet. Add one first (step {step}), then send to it.', { product: product.name, domain: d, step: mailboxStep }) };
      const addresses = fmtList(g.hosted.slice(0, 2), 'or');
      const nothing = g.hosted.length > 2 ? t('Nothing has arrived for {addresses} or the others yet.', { addresses }) : t('Nothing has arrived for {addresses} yet.', { addresses });
      return { ok: false, why: `${nothing} ${routeHint}` };
    }
    return { ok: !!r.receive, why: r.receive ? undefined : t('Nothing has arrived yet. It can take a minute; try again.') };
  };
  const run = async (key: string, ms = 1600) => {
    setDone((x) => ({ ...x, [key]: 'wait' }));
    if (!real) {
      // The standalone demo: each wait resolves after a moment.
      setTimeout(() => {
        setDone((x) => ({ ...x, [key]: 'ok' }));
        if (key === 'route-test') onVerified?.();
      }, ms);
      return;
    }
    const r = await check(key).catch((e: Error) => ({ ok: false, why: e.message }));
    setDone((x) => ({ ...x, [key]: r.ok ? 'ok' : 'no' }));
    setWhy((x) => ({ ...x, [key]: r.why ?? '' }));
    if (r.ok && key === 'route-test') onVerified?.();
  };
  /** The server sends a test to an address at the domain that only we know, then we watch for it to come back. */
  const sendTest = async () => {
    setDone((x) => ({ ...x, probe: 'wait' }));
    setWhy((x) => ({ ...x, probe: '' }));
    const finish = (ok: boolean, text = '') => {
      if (!alive.current) return;
      setDone((x) => ({ ...x, probe: ok ? 'ok' : 'no' }));
      setWhy((x) => ({ ...x, probe: text }));
      setProbeNote('');
      if (ok) onVerified?.();
    };
    try {
      const r = await fetch('/api/mail/routing-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
      const x = (await r.json().catch(() => ({}))) as { token?: string; address?: string; error?: string };
      if (!r.ok || !x.token) return finish(false, x.error ? t(x.error) : t('The test couldn’t be sent. Try again.'));
      const waiting = t('Sent to {address}. Waiting for {provider} to pass it on…', { address: x.address ?? '', provider: prov });
      setProbeNote(waiting);
      for (let i = 0; i < 60 && alive.current; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const st = (await fetch(`/api/mail/routing-test?ws=${encodeURIComponent(workspaceId ?? '')}&token=${x.token}`).then((q) => q.json(), () => null)) as { state?: string; why?: string; leaving?: boolean } | null;
        if (st?.state === 'arrived') return finish(true);
        if (st?.state === 'failed') return finish(false, `${st.why ? t(st.why) : t('It didn’t arrive.')} ${routeHint}`);
        if (st?.state === 'unsent') return finish(false, t('The test couldn’t leave our server. Try again later.'));
        if (alive.current) setProbeNote(st?.leaving ? t('Sending to {address}…', { address: x.address ?? '' }) : waiting);
      }
      finish(false, `${t('It hasn’t arrived yet.')} ${routeHint} ${t('We keep watching for it; the result shows under Mail routing.')}`);
    } catch {
      finish(false, t('No connection. Try again.'));
    }
  };
  const Btn = ({ k, idle, wait, ok, ms }: { k: string; idle: string; wait: string; ok: string; ms?: number }) =>
    real && !workspaceId ? (
      <p className="muted small">{t('Once your company is set up, check this in Settings, Email delivery.')}</p>
    ) : (
      <span className="esg-check">
        <button className="ghost-btn outline sm" disabled={done[k] === 'wait'} onClick={() => void run(k, ms)}>
          {done[k] === 'wait' ? <Loader2 size={14} className="spin" /> : done[k] === 'ok' ? <Check size={14} /> : <Mail size={14} />} {done[k] === 'ok' ? ok : done[k] === 'wait' ? wait : done[k] === 'no' ? t('Check again') : idle}
        </button>
        {done[k] === 'no' && why[k] && <small className="muted">{why[k]}</small>}
      </span>
    );
  const Value = ({ v, plain }: { v: string; plain?: boolean }) => (
    <span className="esg-value">
      <span className="mono esg-sel">{v}</span>
      {!plain && (
        <button className="icon-btn sm" title={t('Copy')} onClick={() => void copy(v)}>
          {copied === v ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </span>
  );

  // The real server name comes from /api/brand once signed in; before that (the preview) a placeholder stands in.
  const mx = mailInfo.host || 'mail.sprint2go.com';
  const spfUs = mailInfo.ip ? `ip4:${mailInfo.ip}` : `a:${mx}`;
  const dkimLocal: Rec = { type: 'TXT', host: 's2g._domainkey', value: t('v=DKIM1; k=rsa; p=… (the exact value is in Settings, Email delivery)'), note: t('Signs mail sent from {product}', { product: product.name }) };
  const dmarc: Rec = { type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${d}`, note: t('Protects your domain from spoofing') };
  const sendRecords: Rec[] = [{ type: 'TXT', host: '@', value: `v=spf1 ${spfUs} ~all`, note: t('Add to your SPF record (keep what’s there)') }, dkimLocal];
  const moveRecords: Rec[] = [
    { type: 'MX', host: '@', value: mx, note: t('Priority 10. Replaces your current MX records') },
    ...sendRecords.map((r) => (r.host === '@' ? { ...r, note: t('Replaces your SPF record') } : r)),
    dmarc,
  ];
  // The server's records (and their notes) are in English; a placeholder value such as "(3 records)" is words, not a value.
  const Records = ({ list }: { list: Rec[] }) => (
    <div className="table esg-records">
      <table>
        <tbody>
          {list.map((r) => (
            <tr key={r.type + r.host}>
              <td className="mono">{r.type}</td>
              <td className="mono">{r.host.startsWith('(') ? t(r.host) : r.host}</td>
              <td>
                <Value v={r.value.startsWith('(') || r.host.startsWith('(') ? t(r.value) : r.value} plain={r.value.startsWith('(') || r.host.startsWith('(') || r.value.includes('…')} />
                <small>{t(r.note)}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const where =
    provider === 'microsoft'
      ? t('In Outlook on the web: Settings, Mail, Forwarding. Turn forwarding on and paste the address.')
      : provider === 'zoho'
        ? t('In Zoho Mail: Settings, Mail forwarding and POP/IMAP, Add forwarding address.')
        : provider === 'imap'
          ? t('In your mail provider’s settings, find Forwarding and add the address.')
          : t('In Gmail: Settings (gear), See all settings, Forwarding and POP/IMAP, Add a forwarding address.');
  const app = provider === 'microsoft' ? 'Outlook' : provider === 'zoho' ? 'Zoho Mail' : provider === 'imap' ? t('your usual mail app') : 'Gmail';

  /* ---------- "Some of each": the steps at each provider, with the labels their admin screens really use ---------- */

  const provSpf = provider === 'microsoft' ? 'include:spf.protection.outlook.com' : provider === 'zoho' ? 'include:zohomail.com' : provider === 'imap' ? '' : 'include:_spf.google.com';
  const splitLocal: Rec[] = [
    provSpf
      ? { type: 'TXT', host: '@', value: `v=spf1 ${provSpf} ${spfUs} ~all`, note: t('Lets {provider} and {product} send as {domain}. A domain has one SPF record: if {domain} already has one, change it to this and keep any other include: it lists.', { provider: prov, product: product.name, domain: d }) }
      : { type: 'TXT', host: '@', value: `v=spf1 ${spfUs} ~all`, note: t('Your mail provider most likely has an SPF record for {domain} already. Don’t add a second one: put {spf} into it, before the ~all or -all.', { domain: d, spf: spfUs }) },
    dkimLocal,
    { ...dmarc, note: t('Tells receivers what to do with mail that fails the checks. If {domain} already has a DMARC record, keep yours.', { domain: d }) },
  ];
  // The server's list has the real DKIM key (or Boosted sending's records); its MX row only says the MX stays put.
  const splitRecords = info ? info.records.filter((r) => r.key !== 'mx') : splitLocal;
  const mailboxStep = provider === 'google' ? 4 : provider === 'imap' ? 3 : 2;
  const routeHow =
    provider === 'microsoft'
      ? t('With {domain} set to Internal relay and one connector, Microsoft 365 passes mail for addresses it doesn’t know on to {product}.', { domain: d, product: product.name })
      : provider === 'zoho'
        ? t('Split delivery passes mail for addresses Zoho doesn’t know on to {product}.', { product: product.name })
        : provider === 'imap'
          ? t('If your provider offers split delivery, it passes mail for addresses it doesn’t host on to {product}.', { product: product.name })
          : t('One routing rule there passes mail for addresses Google doesn’t know on to {product}.', { product: product.name });
  const signTip =
    provider === 'microsoft' ? (
      <>
        <b>{t('Turn on Microsoft’s own signature too.')}</b>{' '}
        {tj('In the Microsoft Defender portal (security.microsoft.com): {settings}, {dkim}, pick {domain}, add the two CNAME records it shows, then turn signing on. With DMARC on, mail from your Microsoft 365 people should be signed as well.', { settings: <b>Email authentication settings</b>, dkim: <b>DKIM</b>, domain: d })}
      </>
    ) : provider === 'zoho' ? (
      <>
        <b>{t('Turn on Zoho’s own signature too.')}</b>{' '}
        {tj('In the Zoho Mail Admin Console: Domains, {domain}, {config}, {dkim}. Add the record it shows, then verify it. With DMARC on, mail from your Zoho people should be signed as well.', { domain: d, config: <b>Email configuration</b>, dkim: <b>DKIM</b> })}
      </>
    ) : provider === 'imap' ? (
      <>{t('If your mail provider can sign mail with DKIM, turn that on too: with DMARC on, mail from the people who stay there should be signed as well.')}</>
    ) : (
      <>
        <b>{t('Turn on Google’s own signature too.')}</b>{' '}
        {tj('In admin.google.com: Apps, Google Workspace, Gmail, {auth}. Generate a new record, add it with the others, then click {start}. With DMARC on, mail from your Google Workspace people should be signed as well.', { auth: <b>Authenticate email</b>, start: <b>Start authentication</b> })}
      </>
    );
  const dnsLine = info?.dnsHost ? (
    <p>{tj('{domain}’s DNS is at {host}, so the records go there: {where}.', { domain: d, host: <b>{info.dnsHost.name}</b>, where: info.dnsHost.where })}</p>
  ) : (
    <p>
      {t('Add them where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain, and often not {provider}.', { domain: d, provider: prov })}
      {info?.nameservers.length ? ` ${t('{domain} uses {nameservers}.', { domain: d, nameservers: fmtList(info.nameservers) })}` : ''}
    </p>
  );

  const how = {
    title: t('How it works'),
    body: (
      <>
        <p>
          {t('{domain} stays with {provider}. People who keep a licence there carry on as today.', { domain: d, provider: prov })}{' '}
          {tj('Everyone else gets a real {address} mailbox in {product}, and you stop paying {provider} for them.', { address: <b>{nameAt}</b>, product: product.name, provider: prov })}
        </p>
        <p>
          {t('Mail always reaches {provider} first.', { provider: prov })} {routeHow} {t('If an address exists in neither, the sender gets the usual “doesn’t exist” reply.')}
        </p>
        <p className="esg-tipline">
          <b>{t('One place per person.')}</b> {t('When someone moves to {product}, free up their address at {provider}.', { product: product.name, provider: prov })} {notAtProvider(provider)}
        </p>
        <p className="muted small">{t('You need admin access to {provider} and to {domain}’s DNS. It’s done once for the whole company.', { provider: prov, domain: d })}</p>
      </>
    ),
  };
  const mailbox = {
    title: t('Give people a mailbox here'),
    body: (
      <>
        <p>{t('Each person who leaves {provider} gets a mailbox here with the same address.', { provider: prov })}</p>
        {!workspaceId ? (
          <ol className="esg-list">
            <li>{tj('In the next step, Team, pick {choice} for each of them.', { choice: <b>{t('Mailbox on {product}', { product: product.name })}</b> })}</li>
            <li>{tj('Later, add more in Settings, {general}, {accounts}.', { general: <b>{t('General & email')}</b>, accounts: <b>{t('Email accounts')}</b> })}</li>
          </ol>
        ) : (
          <ol className="esg-list">
            <li>{tj('In {product}: Settings, {general}, {accounts}.', { product: product.name, general: <b>{t('General & email')}</b>, accounts: <b>{t('Email accounts')}</b> })}</li>
            <li>
              {tj('Click {add}, choose {kind} and type {address}.', {
                add: <b>{t('Add an email account')}</b>,
                kind: <b>{t('New {product} mailbox', { product: product.name })}</b>,
                address: <b>{nameAt}</b>,
              })}
            </li>
            <li>{tj('For someone new, use {invite} instead, with {create} ticked.', { invite: <b>{t('Invite someone')}</b>, create: <b>{t('Create a {product} mailbox for them', { product: product.name })}</b> })}</li>
          </ol>
        )}
        <p className="esg-tipline">
          <b>{t('The address must be free at {provider}.', { provider: prov })}</b> {notAtProvider(provider)}
        </p>
        {onAddMailbox && (
          <button type="button" className="ghost-btn outline sm" onClick={onAddMailbox}>
            <Plus size={14} /> {t('Add a mailbox')}
          </button>
        )}
      </>
    ),
  };
  const records = {
    title: t('Sending records'),
    body: (
      <>
        <p>{t('So mail from {product} mailboxes isn’t marked as spam, add these records for {domain}. Once for the whole company.', { product: product.name, domain: d })}</p>
        {dnsLine}
        <Records list={splitRecords} />
        {provider === 'zoho' && <p className="muted small">{t('Zoho shows the exact include for your account under Domains, {domain}, Email configuration, SPF. In its EU or India data centre it’s include:zohomail.eu or include:zohomail.in.', { domain: d })}</p>}
        <Btn k="dns" idle={t('Check the records')} wait={t('Checking DNS…')} ok={t('All records found')} />
        <p className="esg-tipline">{signTip}</p>
      </>
    ),
  };
  // The server sends its own test when it can send mail; a company that isn't saved yet checks later, in Settings.
  const canProbe = real && caps.routingCheck && !!workspaceId;
  const test = {
    title: t('Check it works'),
    body: (
      <>
        {real ? (
          <p>
            {canProbe
              ? t('Send a test and we mail an address at {domain} that only {product} knows. Or, from your phone or any address outside {domain}, send an email to an address at {domain} that only exists in {product}, like a mailbox from step {step}.', { domain: d, product: product.name, step: mailboxStep })
              : t('From your phone, or any address outside {domain}, send an email to an address at {domain} that only exists in {product}, like a mailbox from step {step}.', { domain: d, product: product.name, step: mailboxStep })}{' '}
            {t('If it arrives here, {provider} passes mail on correctly.', { provider: prov })}
          </p>
        ) : (
          <p>{tj('We send a test to {address}, an address only {product} has. If it arrives here, {provider} passes mail on correctly and you can give people {product} mailboxes.', { address: <b>check@{d}</b>, product: product.name, provider: prov })}</p>
        )}
        <div className="esg-checks">
          {canProbe && (
            <span className="esg-check">
              <button className="ghost-btn outline sm" disabled={done.probe === 'wait'} onClick={() => void sendTest()}>
                {done.probe === 'wait' ? <Loader2 size={14} className="spin" /> : done.probe === 'ok' ? <Check size={14} /> : <Send size={14} />} {done.probe === 'ok' ? t('It arrived: routing works') : done.probe === 'wait' ? t('Testing…') : done.probe === 'no' ? t('Send another test') : t('Send a test')}
              </button>
              {done.probe === 'wait' && probeNote && <small className="muted">{probeNote}</small>}
              {done.probe === 'no' && why.probe && <small className="muted">{why.probe}</small>}
            </span>
          )}
          <Btn k="route-test" idle={real ? t('I sent it') : t('Send the test')} wait={real ? t('Looking for it…') : t('Waiting for it to pass through {provider}…', { provider: prov })} ok={t('It arrived: routing works')} ms={2600} />
        </div>
      </>
    ),
  };
  const ipAlt = mailInfo.ip ? (
    <>
      {' '}
      {tj('If it doesn’t take the name, use the address {ip}', { ip: <Value v={mailInfo.ip} /> })}
    </>
  ) : null;

  const splitSteps: { title: string; body: ReactNode }[] =
    provider === 'microsoft'
      ? [
          how,
          mailbox,
          {
            title: t('Let unknown addresses through'),
            body: (
              <>
                <ol className="esg-list">
                  <li>{tj('Open the Exchange admin center, {site}: Mail flow, {domains}.', { site: <b>admin.exchange.microsoft.com</b>, domains: <b>Accepted domains</b> })}</li>
                  <li>{tj('Click {domain}, set it to {relay} and click {save}.', { domain: <b>{d}</b>, relay: <b>Internal relay</b>, save: <b>Save</b> })}</li>
                </ol>
                <p className="muted small">{t('Internal relay means mail for anyone Microsoft 365 knows is still delivered there, and the rest may go on to another server. The next step names that server.')}</p>
              </>
            ),
          },
          {
            title: t('Add a connector'),
            body: (
              <>
                <ol className="esg-list">
                  <li>{tj('Mail flow, {connectors}, {add}.', { connectors: <b>Connectors</b>, add: <b>Add a connector</b> })}</li>
                  <li>{tj('Connection from {from}, connection to {to}. Next.', { from: <b>Office 365</b>, to: <b>Partner organization</b> })}</li>
                  <li>{tj('Name: {name}, with {on} ticked. Next.', { name: <Value v={product.name} />, on: <b>Turn it on</b> })}</li>
                  <li>{tj('Use of connector: {when}. Add {domain}, then Next.', { when: <b>Only when email messages are sent to these domains</b>, domain: <Value v={d} /> })}</li>
                  <li>{tj('Routing: {how}. Add {host}, then Next.', { how: <b>Route email through these smart hosts</b>, host: <Value v={mx} /> })}</li>
                  {trusted ? (
                    <li>
                      {tj('Security restrictions: keep {tls} and pick {ca}. Tick {san} and add {host}. Next.', {
                        tls: <b>Always use Transport Layer Security (TLS) to secure the connection</b>,
                        ca: <b>Issued by a trusted certificate authority (CA)</b>,
                        san: <b>And the subject name or subject alternative name (SAN) matches this domain name</b>,
                        host: <Value v={mx} />,
                      })}
                    </li>
                  ) : (
                    <li>
                      {tj('Security restrictions: keep {tls} and pick {any}. Our certificate is self-signed for now. Next.', {
                        tls: <b>Always use Transport Layer Security (TLS) to secure the connection</b>,
                        any: <b>Any digital certificate, including self-signed certificates</b>,
                      })}
                    </li>
                  )}
                  <li>{tj('Validation email: an address at {domain} that only exists in {product}, like the mailbox from step 2. Click {validate}, and when it passes, {next} and {create}.', { domain: d, product: product.name, validate: <b>Validate</b>, next: <b>Next</b>, create: <b>Create connector</b> })}</li>
                </ol>
              </>
            ),
          },
          records,
          test,
        ]
      : provider === 'zoho'
        ? [
            how,
            mailbox,
            {
              title: t('Add the route'),
              body: (
                <>
                  <ol className="esg-list">
                    <li>{tj('Open the {console}: Mail Settings, {routing}. Click {configure} (or {add}).', { console: <b>Zoho Mail Admin Console</b>, routing: <b>Email Routing</b>, configure: <b>Configure routing</b>, add: <b>Add</b> })}</li>
                    <li>{tj('Domain: {domain}.', { domain: <b>{d}</b> })}</li>
                    <li>
                      {tj('Destination Host: {host}', { host: <Value v={mx} /> })}
                      {ipAlt}
                    </li>
                    <li>{tj('Verification Email Address: an address at {domain} that only exists in {product}, like the mailbox from step 2. Click {add}.', { domain: d, product: product.name, add: <b>Add</b> })}</li>
                    <li>{t('Zoho emails that address to confirm the route. It arrives in Mail here: open it and confirm.')}</li>
                  </ol>
                </>
              ),
            },
            {
              title: t('Turn on split delivery'),
              body: (
                <>
                  <ol className="esg-list">
                    <li>{tj('In Email Routing, click the new route, then {basic}.', { basic: <b>Basic settings</b> })}</li>
                    <li>{tj('Type of email distribution: {split}.', { split: <b>Split Delivery: Deliver Emails to Non-existing accounts only</b> })}</li>
                    <li>{tj('Under {details}, slide {status} on.', { details: <b>Routing Details</b>, status: <b>Status</b> })}</li>
                  </ol>
                  <p className="esg-tipline">
                    <b>{t('Not Dual Delivery.')}</b> {t('That one copies mail for people Zoho knows and bounces everyone else, so {product} mailboxes get nothing.', { product: product.name })}
                  </p>
                </>
              ),
            },
            records,
            test,
          ]
        : provider === 'imap'
          ? [
              how,
              {
                title: t('Ask your provider'),
                body: (
                  <>
                    <p>{tj('Ask your mail provider for {split} for {domain}: mail for addresses they don’t host goes on to another server instead of bouncing. Some call it routing for unknown recipients. Give them:', { split: <b>split delivery</b>, domain: d })}</p>
                    <ol className="esg-list">
                      <li>
                        {tj('Server: {host}', { host: <Value v={mx} /> })}
                        {ipAlt}
                      </li>
                      <li>{trusted ? tj('Port {port}, with TLS. Our certificate is CA-signed, so they can require that.', { port: <b>25</b> }) : tj('Port {port}, with TLS. Our certificate is self-signed for now, so they must not require a CA-signed one.', { port: <b>25</b> })}</li>
                      <li>{t('Only for addresses they don’t host. Everyone who has a mailbox there keeps getting mail there.')}</li>
                    </ol>
                    <p className="esg-tipline">
                      {tj('{many}, such as cPanel hosting, Hostinger email and Niagahoster. Then the clean way is {move} in Settings, Email delivery: all of {domain}’s mail comes here, and you can stop paying for the old mailboxes.', {
                        many: <b>{t('Many shared hosts can’t do this')}</b>,
                        move: <b>{t('Move to {product}', { product: product.name })}</b>,
                        domain: d,
                      })}
                    </p>
                  </>
                ),
              },
              mailbox,
              records,
              test,
            ]
          : [
              how,
              {
                title: t('Add {product} as a host', { product: product.name }),
                body: (
                  <>
                    <ol className="esg-list">
                      <li>{tj('Open {site}: Apps, Google Workspace, Gmail, {hosts}. Click {add}.', { site: <b>admin.google.com</b>, hosts: <b>Hosts</b>, add: <b>Add Route</b> })}</li>
                      <li>{tj('Name: {name}', { name: <Value v={product.name} /> })}</li>
                      <li>{tj('Specify email server: {single}, with {host} and port {port}.', { single: <b>Single host</b>, host: <Value v={mx} />, port: <b>25</b> })}</li>
                      {trusted ? (
                        <li>
                          {tj('Options: tick {tls}, {ca} and {hostname}. Leave {lookup} unticked.', {
                            tls: <b>Require mail to be transmitted over a secure transport (TLS) connection</b>,
                            ca: <b>Require CA signed certificate</b>,
                            hostname: <b>Validate certificate hostname</b>,
                            lookup: <b>Perform MX lookup on host</b>,
                          })}
                        </li>
                      ) : (
                        <li>
                          {tj('Options: keep {tls} ticked. Untick {ca} and {hostname}. Leave {lookup} unticked.', {
                            tls: <b>Require mail to be transmitted over a secure transport (TLS) connection</b>,
                            ca: <b>Require CA signed certificate</b>,
                            hostname: <b>Validate certificate hostname</b>,
                            lookup: <b>Perform MX lookup on host</b>,
                          })}
                        </li>
                      )}
                      <li>{tj('Click {save}.', { save: <b>Save</b> })}</li>
                    </ol>
                    <p className="muted small">{trusted ? t('Our certificate for {host} is signed by a trusted authority, so Google can check it on every delivery.', { host: mx }) : t('Our certificate is self-signed for now. With either certificate box ticked, Google can’t deliver here and the mail bounces.')}</p>
                  </>
                ),
              },
              {
                title: t('Send unknown addresses there'),
                body: (
                  <>
                    <ol className="esg-list">
                      <li>{tj('Back in the Gmail settings, open {routing} and click {configure} (or {another}).', { routing: <b>Default routing</b>, configure: <b>Configure</b>, another: <b>Add another rule</b> })}</li>
                      <li>{tj('Specify envelope recipients to match: {all}.', { all: <b>All recipients</b> })}</li>
                      <li>
                        {tj('If the envelope recipient matches the above, do the following: keep {modify} and leave the header and subject boxes unticked. Under Route, tick {change} and pick {product}. Leave {spam} unticked, so only real mail comes through.', {
                          modify: <b>Modify message</b>,
                          change: <b>Change the route</b>,
                          product: <b>{product.name}</b>,
                          spam: <b>Also reroute spam</b>,
                        })}
                      </li>
                      <li>{tj('Options: {only}.', { only: <b>Perform this action only on non-recognized addresses</b> })}</li>
                      <li>{tj('Click {save}.', { save: <b>Save</b> })}</li>
                    </ol>
                    <p className="esg-tipline">
                      <b>{t('The last option is the one that matters.')}</b> {t('Without it, every email for {domain} goes to {product}, including mail for your Google Workspace people.', { domain: d, product: product.name })}
                    </p>
                    <p className="muted small">{t('The rule usually works within an hour; Google says it can take up to 24.')}</p>
                  </>
                ),
              },
              mailbox,
              records,
              test,
            ];

  const steps: { title: string; body: ReactNode }[] =
    mode === 'split'
      ? splitSteps
      : mode === 'forward'
      ? [
          {
            title: t('Your address'),
            body: (
              <>
                <p>{t('Everyone gets a private {product} address that only receives forwarded mail. Yours:', { product: product.name })}</p>
                <Value v={inbox} />
              </>
            ),
          },
          {
            title: t('Forward a copy'),
            body: (
              <>
                <p>{where}</p>
                {provider === 'google' && (
                  <>
                    {real ? (
                      <>
                        <p>{t('Gmail sends a confirmation email to that address. It shows up in Mail here, with the code and a Copy button.')}</p>
                        <Btn k="code" idle={t('Look for Gmail’s email')} wait={t('Looking for it…')} ok={t('It arrived: open Mail for the code')} />
                      </>
                    ) : (
                      <>
                        <p>{t('Gmail sends a confirmation code to that address. It arrives here, so you don’t have to go looking:')}</p>
                        <Btn k="code" idle={t('Show Gmail’s code')} wait={t('Waiting for Gmail…')} ok={t('Code: {code}', { code: '482 913' })} />
                      </>
                    )}
                    <p className="muted small">{t('Paste it in Gmail, then choose “Forward a copy of incoming mail” and “keep Gmail’s copy in the Inbox”.')}</p>
                  </>
                )}
                {real ? (
                  <p className="esg-tipline">
                    {tj('{everyone} does this once in their own {app}, with their own address. Each person finds theirs here, in Settings, Email delivery.', { everyone: <b>{t('Everyone who keeps {provider}', { provider: prov })}</b>, app })}
                    {provider === 'microsoft' && ` ${t('Microsoft 365 blocks forwarding outside the company until an admin allows it: Microsoft Defender portal, Anti-spam policies, the outbound policy, Automatic forwarding rules: On.')}`}
                  </p>
                ) : (
                  <p className="esg-tipline">
                    <b>{t('Admins:')}</b>{' '}
                    {provider === 'microsoft'
                      ? t('one mail flow rule in the Exchange admin center copies everyone’s mail, so nobody has to do this step.')
                      : provider === 'google'
                        ? t('one routing rule in the Google Admin console (“Also deliver to”) copies everyone’s mail, so nobody has to do this step.')
                        : t('most providers can copy everyone’s mail with one admin rule. Ask us.')}
                  </p>
                )}
              </>
            ),
          },
          real
            ? {
                title: t('Replies'),
                body: <p>{tj('While a mailbox stays with {provider}, you read its mail here and reply from {app}. To send from {product} as {address}, move the mailbox over in Settings, Email delivery.', { provider: prov, app, product: product.name, address: <b>{mine}</b> })}</p>,
              }
            : {
                title: t('Reply as yourself'),
                body: (
                  <>
                    <p>{tj('So replies leave as {address} and don’t land in spam, add two records where you manage {domain}. Once for the whole company.', { address: <b>{mine}</b>, domain: d })}</p>
                    <Records list={sendRecords} />
                    <Btn k="dns" idle={t('Check the records')} wait={t('Checking DNS…')} ok={t('Both records found')} />
                  </>
                ),
              },
          {
            title: t('Test it'),
            body: (
              <>
                <p>{t('Send any email to {address} from your phone.', { address: mine })}</p>
                <Btn k="test" idle={t('I sent it')} wait={real ? t('Looking for it…') : t('Watching for it…')} ok={t('Arrived in {product}', { product: product.name })} ms={2200} />
              </>
            ),
          },
        ]
      : [
          {
            title: t('Add the records'),
            body: (
              <>
                <p>{t('Where {domain}’s DNS is managed, usually where you bought it (Hostinger, Niagahoster, Cloudflare, GoDaddy…). Until the MX record changes, mail still goes to your current provider, so nothing is lost.', { domain: d })}</p>
                <Records list={moveRecords} />
                <Btn k="dns" idle={t('Check my records')} wait={t('Checking DNS…')} ok={t('All records found')} />
              </>
            ),
          },
          {
            title: t('Bring old mail'),
            body: (
              <>
                {real ? (
                  <p>{t('Bringing old mail over isn’t available yet. Your old mail stays in {provider}, so keep that account until you’ve saved what you need.', { provider: prov })}</p>
                ) : (
                  <>
                    <p>{t('Sign in to {provider} once and we copy every folder in the background. People can work while it runs.', { provider: prov })}</p>
                    <Btn k="import" idle={t('Connect {provider}', { provider: providerName(provider) })} wait={t('Importing {n} emails…', { n: fmtNumber(12480) })} ok={t('Imported {n} emails', { n: fmtNumber(12480) })} ms={2600} />
                  </>
                )}
              </>
            ),
          },
          {
            title: t('Switch day'),
            body: (
              <p>
                {real
                  ? t('When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox, so look there too until then.')
                  : t('When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox; we keep pulling it in until the switch is complete.')}
              </p>
            ),
          },
          {
            title: t('Cancel the old plan'),
            body: <p>{real ? t('After 30 days with nothing arriving there, cancel {provider}.', { provider: prov }) : t('After 30 days with nothing arriving there, cancel {provider}. We remind you.', { provider: prov })}</p>,
          },
        ];
  const at = Math.min(cur, steps.length - 1); // a provider with fewer steps never points past the end

  return (
    <div className="esg-wiz">
      <div className="esg-steps" role="tablist">
        {steps.map((st, i) => (
          <button key={st.title} type="button" role="tab" aria-selected={i === at} className={i === at ? 'on' : i < at ? 'done' : ''} onClick={() => setCur(i)}>
            <b>{i < at ? <Check size={11} /> : i + 1}</b>
            <span>{st.title}</span>
          </button>
        ))}
      </div>
      <div className="esg-card" key={`${mode}-${at}-${provider}`}>
        {steps[at].body}
      </div>
      <div className="esg-nav">
        <button type="button" className="ghost-btn sm" disabled={at === 0} onClick={() => setCur(at - 1)}>
          <ArrowLeft size={14} /> {t('Back')}
        </button>
        <span className="muted small">{t('Step {n} of {total}', { n: at + 1, total: steps.length })}</span>
        <button type="button" className="ghost-btn sm outline" disabled={at === steps.length - 1} onClick={() => setCur(at + 1)}>
          {t('Next')} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
