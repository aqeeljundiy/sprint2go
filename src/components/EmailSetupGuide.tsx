import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Mail, Plus, Send } from 'lucide-react';
import type { MailProvider } from '../types';
import { providerName } from './Onboarding';
import { mailInfo, server } from '../sync';
import { brand as product } from '../terms';
import { caps } from '../caps';

/** The provider inside a sentence: "stays with Google Workspace", "stays with your mail provider". */
export const providerLabel = (p?: MailProvider) => (p === 'imap' ? 'your mail provider' : providerName(p));

/** "Some of each" only works for an address the provider doesn't know. What that means at each one. */
export const notAtProvider = (p?: MailProvider) =>
  p === 'microsoft'
    ? 'Nobody in Microsoft 365 may have it as a mailbox, group or mail contact, or Microsoft keeps the mail.'
    : p === 'zoho'
      ? 'Nobody in Zoho Mail may have it as an account or alias, or Zoho keeps the mail.'
      : p === 'imap'
        ? 'Your mail provider must not have a mailbox for it, or the provider keeps the mail.'
        : 'No Google Workspace user, alias or group may have it, or Google keeps the mail. A suspended user, or one with Gmail turned off, is fine.';

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
  const d = domain || 'yourcompany.com';
  const slug = d.split('.')[0].replace(/[^a-z0-9]/g, '') || 'company';
  const mine = address || `${first || 'you'}@${d}`;
  // A copy of their mail, forwarded here. Only the server's own name works, so the preview shows a stand-in.
  const inbox = address && company && mailInfo.host ? forwardAddress(address, company, mailInfo.host) : `${first || 'you'}.${slug}@${mailInfo.host || 'in.sprint2go.com'}`;
  const prov = providerLabel(provider);
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
      if (!r.ok) throw new Error((x as { error?: string }).error ?? 'The check didn’t go through. Try again.');
      return x as any;
    });
  const routeHint =
    provider === 'microsoft'
      ? `Check that ${d} is set to Internal relay, that the connector is on, and that nobody in Microsoft 365 has the address. Changes can take up to an hour.`
      : provider === 'zoho'
        ? 'Check that the route is on (Status) with Split Delivery, and that nobody in Zoho Mail has the address.'
        : provider === 'imap'
          ? `Ask your provider whether split delivery is on for ${d}.`
          : 'Google can take up to an hour to start using a new rule. Check that no Google user has the address, and that the rule says “only on non-recognized addresses”.';
  /** Real checks: the records, or whether mail has arrived here yet. */
  const check = async (key: string): Promise<{ ok: boolean; why?: string }> => {
    if (key === 'dns') {
      const r = await post('/api/mail/check');
      const bad = ((r.checks ?? []) as { key: string; ok: boolean; found: string }[]).filter((c) => !c.ok);
      if (r.allOk) return { ok: true };
      const spfMany = bad.some((c) => c.key === 'spf' && /SPF records/.test(c.found));
      return { ok: false, why: `Not found yet: ${bad.map((c) => RECORD_NAME[c.key] ?? c.key).join(', ')}.${spfMany ? ` ${d} has more than one SPF record; merge them into one.` : ''} New records can take a few minutes to show.` };
    }
    const r = await post('/api/mail/ready');
    if (key === 'route-test' && mode === 'split' && r.routing) {
      const g = r.routing as { hosted: string[]; arrived: string[] };
      if (g.arrived.length) return { ok: true };
      if (!g.hosted.length) return { ok: false, why: `There’s no ${product.name} mailbox at ${d} yet. Add one first (step ${mailboxStep}), then send to it.` };
      return { ok: false, why: `Nothing has arrived for ${g.hosted.slice(0, 2).join(' or ')}${g.hosted.length > 2 ? ' or the others' : ''} yet. ${routeHint}` };
    }
    return { ok: !!r.receive, why: r.receive ? undefined : 'Nothing has arrived yet. It can take a minute; try again.' };
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
      if (!r.ok || !x.token) return finish(false, x.error ?? 'The test couldn’t be sent. Try again.');
      const waiting = `Sent to ${x.address}. Waiting for ${prov} to pass it on…`;
      setProbeNote(waiting);
      for (let i = 0; i < 60 && alive.current; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const st = (await fetch(`/api/mail/routing-test?ws=${encodeURIComponent(workspaceId ?? '')}&token=${x.token}`).then((q) => q.json(), () => null)) as { state?: string; why?: string; leaving?: boolean } | null;
        if (st?.state === 'arrived') return finish(true);
        if (st?.state === 'failed') return finish(false, `${st.why ?? 'It didn’t arrive.'} ${routeHint}`);
        if (st?.state === 'unsent') return finish(false, 'The test couldn’t leave our server. Try again later.');
        if (alive.current) setProbeNote(st?.leaving ? `Sending to ${x.address}…` : waiting);
      }
      finish(false, `It hasn’t arrived yet. ${routeHint} We keep watching for it; the result shows under Mail routing.`);
    } catch {
      finish(false, 'No connection. Try again.');
    }
  };
  const Btn = ({ k, idle, wait, ok, ms }: { k: string; idle: string; wait: string; ok: string; ms?: number }) =>
    real && !workspaceId ? (
      <p className="muted small">Once your company is set up, check this in Settings, Email delivery.</p>
    ) : (
      <span className="esg-check">
        <button className="ghost-btn outline sm" disabled={done[k] === 'wait'} onClick={() => void run(k, ms)}>
          {done[k] === 'wait' ? <Loader2 size={14} className="spin" /> : done[k] === 'ok' ? <Check size={14} /> : <Mail size={14} />} {done[k] === 'ok' ? ok : done[k] === 'wait' ? wait : done[k] === 'no' ? 'Check again' : idle}
        </button>
        {done[k] === 'no' && why[k] && <small className="muted">{why[k]}</small>}
      </span>
    );
  const Value = ({ v, plain }: { v: string; plain?: boolean }) => (
    <span className="esg-value">
      <span className="mono esg-sel">{v}</span>
      {!plain && (
        <button className="icon-btn sm" title="Copy" onClick={() => void copy(v)}>
          {copied === v ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </span>
  );

  // The real server name comes from /api/brand once signed in; before that (the preview) a placeholder stands in.
  const mx = mailInfo.host || 'mail.sprint2go.com';
  const spfUs = mailInfo.ip ? `ip4:${mailInfo.ip}` : `a:${mx}`;
  const dkimLocal: Rec = { type: 'TXT', host: 's2g._domainkey', value: 'v=DKIM1; k=rsa; p=… (the exact value is in Settings, Email delivery)', note: `Signs mail sent from ${product.name}` };
  const dmarc: Rec = { type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${d}`, note: 'Protects your domain from spoofing' };
  const sendRecords: Rec[] = [{ type: 'TXT', host: '@', value: `v=spf1 ${spfUs} ~all`, note: 'Add to your SPF record (keep what’s there)' }, dkimLocal];
  const moveRecords: Rec[] = [
    { type: 'MX', host: '@', value: mx, note: 'Priority 10. Replaces your current MX records' },
    ...sendRecords.map((r) => (r.host === '@' ? { ...r, note: 'Replaces your SPF record' } : r)),
    dmarc,
  ];
  const Records = ({ list }: { list: Rec[] }) => (
    <div className="table esg-records">
      <table>
        <tbody>
          {list.map((r) => (
            <tr key={r.type + r.host}>
              <td className="mono">{r.type}</td>
              <td className="mono">{r.host}</td>
              <td>
                <Value v={r.value} plain={r.value.startsWith('(') || r.host.startsWith('(') || r.value.includes('…')} />
                <small>{r.note}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const where =
    provider === 'microsoft'
      ? 'In Outlook on the web: Settings, Mail, Forwarding. Turn forwarding on and paste the address.'
      : provider === 'zoho'
        ? 'In Zoho Mail: Settings, Mail forwarding and POP/IMAP, Add forwarding address.'
        : provider === 'imap'
          ? 'In your mail provider’s settings, find Forwarding and add the address.'
          : 'In Gmail: Settings (gear), See all settings, Forwarding and POP/IMAP, Add a forwarding address.';
  const app = provider === 'microsoft' ? 'Outlook' : provider === 'zoho' ? 'Zoho Mail' : provider === 'imap' ? 'your usual mail app' : 'Gmail';

  /* ---------- "Some of each": the steps at each provider, with the labels their admin screens really use ---------- */

  const provSpf = provider === 'microsoft' ? 'include:spf.protection.outlook.com' : provider === 'zoho' ? 'include:zohomail.com' : provider === 'imap' ? '' : 'include:_spf.google.com';
  const splitLocal: Rec[] = [
    provSpf
      ? { type: 'TXT', host: '@', value: `v=spf1 ${provSpf} ${spfUs} ~all`, note: `Lets ${prov} and ${product.name} send as ${d}. A domain has one SPF record: if ${d} already has one, change it to this and keep any other include: it lists.` }
      : { type: 'TXT', host: '@', value: `v=spf1 ${spfUs} ~all`, note: `Your mail provider most likely has an SPF record for ${d} already. Don’t add a second one: put ${spfUs} into it, before the ~all or -all.` },
    dkimLocal,
    { ...dmarc, note: `Tells receivers what to do with mail that fails the checks. If ${d} already has a DMARC record, keep yours.` },
  ];
  // The server's list has the real DKIM key (or Boosted sending's records); its MX row only says the MX stays put.
  const splitRecords = info ? info.records.filter((r) => r.key !== 'mx') : splitLocal;
  const mailboxStep = provider === 'google' ? 4 : provider === 'imap' ? 3 : 2;
  const routeHow =
    provider === 'microsoft'
      ? `With ${d} set to Internal relay and one connector, Microsoft 365 passes mail for addresses it doesn’t know on to ${product.name}.`
      : provider === 'zoho'
        ? `Split delivery passes mail for addresses Zoho doesn’t know on to ${product.name}.`
        : provider === 'imap'
          ? `If your provider offers split delivery, it passes mail for addresses it doesn’t host on to ${product.name}.`
          : `One routing rule there passes mail for addresses Google doesn’t know on to ${product.name}.`;
  const signTip =
    provider === 'microsoft' ? (
      <>
        <b>Turn on Microsoft’s own signature too.</b> In the Microsoft Defender portal (security.microsoft.com): <b>Email authentication settings</b>, <b>DKIM</b>, pick {d}, add the two CNAME records it shows, then turn signing on. With DMARC on, mail from your Microsoft 365 people should be signed as well.
      </>
    ) : provider === 'zoho' ? (
      <>
        <b>Turn on Zoho’s own signature too.</b> In the Zoho Mail Admin Console: Domains, {d}, <b>Email configuration</b>, <b>DKIM</b>. Add the record it shows, then verify it. With DMARC on, mail from your Zoho people should be signed as well.
      </>
    ) : provider === 'imap' ? (
      <>If your mail provider can sign mail with DKIM, turn that on too: with DMARC on, mail from the people who stay there should be signed as well.</>
    ) : (
      <>
        <b>Turn on Google’s own signature too.</b> In admin.google.com: Apps, Google Workspace, Gmail, <b>Authenticate email</b>. Generate a new record, add it with the others, then click <b>Start authentication</b>. With DMARC on, mail from your Google Workspace people should be signed as well.
      </>
    );
  const dnsLine = info?.dnsHost ? (
    <p>
      {d}’s DNS is at <b>{info.dnsHost.name}</b>, so the records go there: {info.dnsHost.where}.
    </p>
  ) : (
    <p>
      Add them where {d}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain, and often not {prov}.
      {info?.nameservers.length ? ` ${d} uses ${info.nameservers.join(' and ')}.` : ''}
    </p>
  );

  const how = {
    title: 'How it works',
    body: (
      <>
        <p>
          {d} stays with {prov}. People who keep a licence there carry on as today. Everyone else gets a real <b>name@{d}</b> mailbox in {product.name}, and you stop paying {prov} for them.
        </p>
        <p>
          Mail always reaches {prov} first. {routeHow} If an address exists in neither, the sender gets the usual “doesn’t exist” reply.
        </p>
        <p className="esg-tipline">
          <b>One place per person.</b> When someone moves to {product.name}, free up their address at {prov}. {notAtProvider(provider)}
        </p>
        <p className="muted small">You need admin access to {prov} and to {d}’s DNS. It’s done once for the whole company.</p>
      </>
    ),
  };
  const mailbox = {
    title: 'Give people a mailbox here',
    body: (
      <>
        <p>Each person who leaves {prov} gets a mailbox here with the same address.</p>
        {!workspaceId ? (
          <ol className="esg-list">
            <li>
              In the next step, Team, pick <b>Mailbox on {product.name}</b> for each of them.
            </li>
            <li>
              Later, add more in Settings, <b>General &amp; email</b>, <b>Email accounts</b>.
            </li>
          </ol>
        ) : (
          <ol className="esg-list">
            <li>
              In {product.name}: Settings, <b>General &amp; email</b>, <b>Email accounts</b>.
            </li>
            <li>
              Click <b>Add an email account</b>, choose <b>New {product.name} mailbox</b> and type <b>name@{d}</b>.
            </li>
            <li>
              For someone new, use <b>Invite someone</b> instead, with <b>Create a {product.name} mailbox for them</b> ticked.
            </li>
          </ol>
        )}
        <p className="esg-tipline">
          <b>The address must be free at {prov}.</b> {notAtProvider(provider)}
        </p>
        {onAddMailbox && (
          <button type="button" className="ghost-btn outline sm" onClick={onAddMailbox}>
            <Plus size={14} /> Add a mailbox
          </button>
        )}
      </>
    ),
  };
  const records = {
    title: 'Sending records',
    body: (
      <>
        <p>So mail from {product.name} mailboxes isn’t marked as spam, add these records for {d}. Once for the whole company.</p>
        {dnsLine}
        <Records list={splitRecords} />
        {provider === 'zoho' && <p className="muted small">Zoho shows the exact include for your account under Domains, {d}, Email configuration, SPF. In its EU or India data centre it’s include:zohomail.eu or include:zohomail.in.</p>}
        <Btn k="dns" idle="Check the records" wait="Checking DNS…" ok="All records found" />
        <p className="esg-tipline">{signTip}</p>
      </>
    ),
  };
  // The server sends its own test when it can send mail; a company that isn't saved yet checks later, in Settings.
  const canProbe = real && caps.routingCheck && !!workspaceId;
  const test = {
    title: 'Check it works',
    body: (
      <>
        {real ? (
          <p>
            {canProbe ? `Send a test and we mail an address at ${d} that only ${product.name} knows. Or, from your phone or any address outside ${d}, send an email to an address at ${d} that only exists in ${product.name}, like a mailbox from step ${mailboxStep}.` : `From your phone, or any address outside ${d}, send an email to an address at ${d} that only exists in ${product.name}, like a mailbox from step ${mailboxStep}.`} If it arrives here, {prov} passes mail on correctly.
          </p>
        ) : (
          <p>
            We send a test to <b>check@{d}</b>, an address only {product.name} has. If it arrives here, {prov} passes mail on correctly and you can give people {product.name} mailboxes.
          </p>
        )}
        <div className="esg-checks">
          {canProbe && (
            <span className="esg-check">
              <button className="ghost-btn outline sm" disabled={done.probe === 'wait'} onClick={() => void sendTest()}>
                {done.probe === 'wait' ? <Loader2 size={14} className="spin" /> : done.probe === 'ok' ? <Check size={14} /> : <Send size={14} />} {done.probe === 'ok' ? 'It arrived: routing works' : done.probe === 'wait' ? 'Testing…' : done.probe === 'no' ? 'Send another test' : 'Send a test'}
              </button>
              {done.probe === 'wait' && probeNote && <small className="muted">{probeNote}</small>}
              {done.probe === 'no' && why.probe && <small className="muted">{why.probe}</small>}
            </span>
          )}
          <Btn k="route-test" idle={real ? 'I sent it' : 'Send the test'} wait={real ? 'Looking for it…' : `Waiting for it to pass through ${prov}…`} ok="It arrived: routing works" ms={2600} />
        </div>
      </>
    ),
  };
  const ipAlt = mailInfo.ip ? (
    <>
      {' '}If it doesn’t take the name, use the address <Value v={mailInfo.ip} />
    </>
  ) : null;

  const splitSteps: { title: string; body: ReactNode }[] =
    provider === 'microsoft'
      ? [
          how,
          mailbox,
          {
            title: 'Let unknown addresses through',
            body: (
              <>
                <ol className="esg-list">
                  <li>
                    Open the Exchange admin center, <b>admin.exchange.microsoft.com</b>: Mail flow, <b>Accepted domains</b>.
                  </li>
                  <li>
                    Click <b>{d}</b>, set it to <b>Internal relay</b> and click <b>Save</b>.
                  </li>
                </ol>
                <p className="muted small">Internal relay means mail for anyone Microsoft 365 knows is still delivered there, and the rest may go on to another server. The next step names that server.</p>
              </>
            ),
          },
          {
            title: 'Add a connector',
            body: (
              <>
                <ol className="esg-list">
                  <li>
                    Mail flow, <b>Connectors</b>, <b>Add a connector</b>.
                  </li>
                  <li>
                    Connection from <b>Office 365</b>, connection to <b>Partner organization</b>. Next.
                  </li>
                  <li>
                    Name: <Value v={product.name} />, with <b>Turn it on</b> ticked. Next.
                  </li>
                  <li>
                    Use of connector: <b>Only when email messages are sent to these domains</b>. Add <Value v={d} />, then Next.
                  </li>
                  <li>
                    Routing: <b>Route email through these smart hosts</b>. Add <Value v={mx} />, then Next.
                  </li>
                  <li>
                    Security restrictions: keep <b>Always use Transport Layer Security (TLS) to secure the connection</b> and pick <b>Any digital certificate, including self-signed certificates</b>. Our certificate is self-signed for now. Next.
                  </li>
                  <li>
                    Validation email: an address at {d} that only exists in {product.name}, like the mailbox from step 2. Click <b>Validate</b>, and when it passes, <b>Next</b> and <b>Create connector</b>.
                  </li>
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
              title: 'Add the route',
              body: (
                <>
                  <ol className="esg-list">
                    <li>
                      Open the <b>Zoho Mail Admin Console</b>: Mail Settings, <b>Email Routing</b>. Click <b>Configure routing</b> (or <b>Add</b>).
                    </li>
                    <li>
                      Domain: <b>{d}</b>.
                    </li>
                    <li>
                      Destination Host: <Value v={mx} />
                      {ipAlt}
                    </li>
                    <li>
                      Verification Email Address: an address at {d} that only exists in {product.name}, like the mailbox from step 2. Click <b>Add</b>.
                    </li>
                    <li>Zoho emails that address to confirm the route. It arrives in Mail here: open it and confirm.</li>
                  </ol>
                </>
              ),
            },
            {
              title: 'Turn on split delivery',
              body: (
                <>
                  <ol className="esg-list">
                    <li>
                      In Email Routing, click the new route, then <b>Basic settings</b>.
                    </li>
                    <li>
                      Type of email distribution: <b>Split Delivery: Deliver Emails to Non-existing accounts only</b>.
                    </li>
                    <li>
                      Under <b>Routing Details</b>, slide <b>Status</b> on.
                    </li>
                  </ol>
                  <p className="esg-tipline">
                    <b>Not Dual Delivery.</b> That one copies mail for people Zoho knows and bounces everyone else, so {product.name} mailboxes get nothing.
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
                title: 'Ask your provider',
                body: (
                  <>
                    <p>
                      Ask your mail provider for <b>split delivery</b> for {d}: mail for addresses they don’t host goes on to another server instead of bouncing. Some call it routing for unknown recipients. Give them:
                    </p>
                    <ol className="esg-list">
                      <li>
                        Server: <Value v={mx} />
                        {ipAlt}
                      </li>
                      <li>
                        Port <b>25</b>, with TLS. Our certificate is self-signed for now, so they must not require a CA-signed one.
                      </li>
                      <li>Only for addresses they don’t host. Everyone who has a mailbox there keeps getting mail there.</li>
                    </ol>
                    <p className="esg-tipline">
                      <b>Many shared hosts can’t do this</b>, such as cPanel hosting, Hostinger email and Niagahoster. Then the clean way is <b>Move to {product.name}</b> in Settings, Email delivery: all of {d}’s mail comes here, and you can stop paying for the old mailboxes.
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
                title: `Add ${product.name} as a host`,
                body: (
                  <>
                    <ol className="esg-list">
                      <li>
                        Open <b>admin.google.com</b>: Apps, Google Workspace, Gmail, <b>Hosts</b>. Click <b>Add Route</b>.
                      </li>
                      <li>
                        Name: <Value v={product.name} />
                      </li>
                      <li>
                        Specify email server: <b>Single host</b>, with <Value v={mx} /> and port <b>25</b>.
                      </li>
                      <li>
                        Options: keep <b>Require mail to be transmitted over a secure transport (TLS) connection</b> ticked. Untick <b>Require CA signed certificate</b> and <b>Validate certificate hostname</b>. Leave <b>Perform MX lookup on host</b> unticked.
                      </li>
                      <li>
                        Click <b>Save</b>.
                      </li>
                    </ol>
                    <p className="muted small">Our certificate is self-signed for now. With either certificate box ticked, Google can’t deliver here and the mail bounces.</p>
                  </>
                ),
              },
              {
                title: 'Send unknown addresses there',
                body: (
                  <>
                    <ol className="esg-list">
                      <li>
                        Back in the Gmail settings, open <b>Default routing</b> and click <b>Configure</b> (or <b>Add another rule</b>).
                      </li>
                      <li>
                        Specify envelope recipients to match: <b>All recipients</b>.
                      </li>
                      <li>
                        If the envelope recipient matches the above, do the following: keep <b>Modify message</b> and leave the header and subject boxes unticked. Under Route, tick <b>Change the route</b> and pick <b>{product.name}</b>. Leave <b>Also reroute spam</b> unticked, so only real mail comes through.
                      </li>
                      <li>
                        Options: <b>Perform this action only on non-recognized addresses</b>.
                      </li>
                      <li>
                        Click <b>Save</b>.
                      </li>
                    </ol>
                    <p className="esg-tipline">
                      <b>The last option is the one that matters.</b> Without it, every email for {d} goes to {product.name}, including mail for your Google Workspace people.
                    </p>
                    <p className="muted small">The rule usually works within an hour; Google says it can take up to 24.</p>
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
            title: 'Your address',
            body: (
              <>
                <p>Everyone gets a private {product.name} address that only receives forwarded mail. Yours:</p>
                <Value v={inbox} />
              </>
            ),
          },
          {
            title: 'Forward a copy',
            body: (
              <>
                <p>{where}</p>
                {provider === 'google' && (
                  <>
                    {real ? (
                      <>
                        <p>Gmail sends a confirmation email to that address. It shows up in Mail here, with the code and a Copy button.</p>
                        <Btn k="code" idle="Look for Gmail’s email" wait="Looking for it…" ok="It arrived: open Mail for the code" />
                      </>
                    ) : (
                      <>
                        <p>Gmail sends a confirmation code to that address. It arrives here, so you don’t have to go looking:</p>
                        <Btn k="code" idle="Show Gmail’s code" wait="Waiting for Gmail…" ok="Code: 482 913" />
                      </>
                    )}
                    <p className="muted small">Paste it in Gmail, then choose “Forward a copy of incoming mail” and “keep Gmail’s copy in the Inbox”.</p>
                  </>
                )}
                {real ? (
                  <p className="esg-tipline">
                    <b>Everyone who keeps {prov}</b> does this once in their own {app}, with their own address. Each person finds theirs here, in Settings, Email delivery.
                    {provider === 'microsoft' && ' Microsoft 365 blocks forwarding outside the company until an admin allows it: Microsoft Defender portal, Anti-spam policies, the outbound policy, Automatic forwarding rules: On.'}
                  </p>
                ) : (
                  <p className="esg-tipline">
                    <b>Admins:</b>{' '}
                    {provider === 'microsoft'
                      ? 'one mail flow rule in the Exchange admin center copies everyone’s mail, so nobody has to do this step.'
                      : provider === 'google'
                        ? 'one routing rule in the Google Admin console (“Also deliver to”) copies everyone’s mail, so nobody has to do this step.'
                        : 'most providers can copy everyone’s mail with one admin rule. Ask us.'}
                  </p>
                )}
              </>
            ),
          },
          real
            ? {
                title: 'Replies',
                body: (
                  <p>
                    While a mailbox stays with {prov}, you read its mail here and reply from {app}. To send from {product.name} as <b>{mine}</b>, move the mailbox over in Settings, Email delivery.
                  </p>
                ),
              }
            : {
                title: 'Reply as yourself',
                body: (
                  <>
                    <p>
                      So replies leave as <b>{mine}</b> and don’t land in spam, add two records where you manage {d}. Once for the whole company.
                    </p>
                    <Records list={sendRecords} />
                    <Btn k="dns" idle="Check the records" wait="Checking DNS…" ok="Both records found" />
                  </>
                ),
              },
          {
            title: 'Test it',
            body: (
              <>
                <p>Send any email to {mine} from your phone.</p>
                <Btn k="test" idle="I sent it" wait={real ? 'Looking for it…' : 'Watching for it…'} ok={`Arrived in ${product.name}`} ms={2200} />
              </>
            ),
          },
        ]
      : [
          {
            title: 'Add the records',
            body: (
              <>
                <p>Where {d}’s DNS is managed, usually where you bought it (Hostinger, Niagahoster, Cloudflare, GoDaddy…). Until the MX record changes, mail still goes to your current provider, so nothing is lost.</p>
                <Records list={moveRecords} />
                <Btn k="dns" idle="Check my records" wait="Checking DNS…" ok="All records found" />
              </>
            ),
          },
          {
            title: 'Bring old mail',
            body: (
              <>
                {real ? (
                  <p>Bringing old mail over isn’t available yet. Your old mail stays in {prov}, so keep that account until you’ve saved what you need.</p>
                ) : (
                  <>
                    <p>Sign in to {prov} once and we copy every folder in the background. People can work while it runs.</p>
                    <Btn k="import" idle={`Connect ${providerName(provider)}`} wait="Importing 12,480 emails…" ok="Imported 12,480 emails" ms={2600} />
                  </>
                )}
              </>
            ),
          },
          {
            title: 'Switch day',
            body: <p>When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox{real ? ', so look there too until then.' : '; we keep pulling it in until the switch is complete.'}</p>,
          },
          {
            title: 'Cancel the old plan',
            body: <p>After 30 days with nothing arriving there, cancel {prov}.{real ? '' : ' We remind you.'}</p>,
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
          <ArrowLeft size={14} /> Back
        </button>
        <span className="muted small">
          Step {at + 1} of {steps.length}
        </span>
        <button type="button" className="ghost-btn sm outline" disabled={at === steps.length - 1} onClick={() => setCur(at + 1)}>
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
