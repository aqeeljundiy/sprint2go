import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Mail } from 'lucide-react';
import type { MailProvider } from '../types';
import { providerName } from './Onboarding';
import { mailInfo } from '../sync';
import { brand as product } from '../terms';

/**
 * How mail gets into sprint2go, step by step. Two ways:
 *  - forward: mail stays at Gmail or Outlook; a copy of everything is forwarded to the person's sprint2go address,
 *    and replies go out through sprint2go (Amazon SES) from their own address.
 *  - move: the domain's mail moves to sprint2go (MX records), old mail is imported, the old provider is cancelled.
 *  - split: "some of each". The domain stays with Google or Microsoft; one routing rule there passes mail for
 *    addresses it doesn't know on to sprint2go, so people without a licence get a real name@domain mailbox here.
 * Until the mail server runs, the waits (Gmail's code, the DNS check, the import, the test email) are simulated.
 */
export function EmailSetupGuide({ mode, provider, domain, first, onVerified }: { mode: 'forward' | 'move' | 'split'; provider: MailProvider; domain: string; first: string; onVerified?: () => void }) {
  const d = domain || 'yourcompany.com';
  const slug = d.split('.')[0].replace(/[^a-z0-9]/g, '') || 'company';
  const inbox = `${first || 'you'}.${slug}@${mailInfo.host || 'in.sprint2go.com'}`; // a copy of their mail, forwarded here
  const [copied, setCopied] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'wait' | 'ok'>>({});
  const [cur, setCur] = useState(0);
  useEffect(() => setCur(0), [mode]); // a different path starts at its first step
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  };
  // DEMO: each wait resolves after a moment. The real ones are a webhook from the mail server or a DNS lookup.
  const run = (key: string, ms = 1600) => {
    setDone((x) => ({ ...x, [key]: 'wait' }));
    setTimeout(() => {
      setDone((x) => ({ ...x, [key]: 'ok' }));
      if (key === 'route-test') onVerified?.();
    }, ms);
  };
  const Btn = ({ k, idle, wait, ok, ms }: { k: string; idle: string; wait: string; ok: string; ms?: number }) => (
    <button className="ghost-btn outline sm" disabled={done[k] === 'wait'} onClick={() => run(k, ms)}>
      {done[k] === 'wait' ? <Loader2 size={14} className="spin" /> : done[k] === 'ok' ? <Check size={14} /> : <Mail size={14} />} {done[k] === 'ok' ? ok : done[k] === 'wait' ? wait : idle}
    </button>
  );
  const Value = ({ v }: { v: string }) => (
    <span className="esg-value">
      <span className="mono esg-sel">{v}</span>
      <button className="icon-btn sm" title="Copy" onClick={() => void copy(v)}>
        {copied === v ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  );

  // The real server name comes from /api/brand once signed in; before that (the preview) a placeholder stands in.
  const mx = mailInfo.host || 'mail.sprint2go.com';
  const spfUs = mailInfo.ip ? `ip4:${mailInfo.ip}` : `a:${mx}`;
  const sendRecords = [
    { type: 'TXT', host: '@', value: `v=spf1 ${spfUs} ~all`, note: 'Add to your SPF record (keep what’s there)' },
    { type: 'TXT', host: 's2g._domainkey', value: 'v=DKIM1; k=rsa; p=… (the exact value is in Settings, Email delivery)', note: `Signs mail sent from ${product.name}` },
  ];
  const moveRecords = [
    { type: 'MX', host: '@', value: mx, note: 'Priority 10. Replaces your current MX records' },
    ...sendRecords.map((r) => (r.host === '@' ? { ...r, note: 'Replaces your SPF record' } : r)),
    { type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${d}`, note: 'Protects your domain from spoofing' },
  ];
  const Records = ({ list }: { list: typeof sendRecords }) => (
    <div className="table esg-records">
      <table>
        <tbody>
          {list.map((r) => (
            <tr key={r.type + r.host}>
              <td className="mono">{r.type}</td>
              <td className="mono">{r.host}</td>
              <td>
                <Value v={r.value} />
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


  const routeHow =
    provider === 'microsoft' ? (
      <ol className="esg-list">
        <li>In the Exchange admin center: Mail flow, Accepted domains. Open {d} and set it to <b>Internal relay</b>.</li>
        <li>Mail flow, Connectors, Add a connector: from Office 365 to <b>Partner organization</b>, used only for {d}.</li>
        <li>Route it through this smart host, with TLS:</li>
      </ol>
    ) : provider === 'zoho' ? (
      <ol className="esg-list">
        <li>In the Zoho Mail admin console: Mail settings, Email routing.</li>
        <li>Add a route for {d} that sends mail for addresses that don’t exist in Zoho to this host:</li>
      </ol>
    ) : provider === 'imap' ? (
      <ol className="esg-list">
        <li>Ask your provider for <b>split delivery</b> (sometimes called routing for unknown recipients) for {d}.</li>
        <li>Mail for addresses they don’t host should go to this host:</li>
      </ol>
    ) : (
      <ol className="esg-list">
        <li>In the Google Admin console: Apps, Google Workspace, Gmail, <b>Default routing</b>, Configure.</li>
        <li>Envelope recipients to match: all recipients. Account types to affect: tick only <b>Unrecognized / Catch-all</b>.</li>
        <li>Route: change route to a new host, with TLS required:</li>
      </ol>
    );
  const splitRecords = sendRecords.map((r) => (r.type === 'TXT' ? { ...r, value: `v=spf1 ${provider === 'microsoft' ? 'include:spf.protection.outlook.com' : provider === 'zoho' ? 'include:zoho.com' : 'include:_spf.google.com'} include:amazonses.com ~all`, note: 'One SPF record listing both. Keep anything else already in it' } : r));
  const steps: { title: string; body: ReactNode }[] =
    mode === 'split'
      ? [
          {
            title: 'How it works',
            body: (
              <>
                <p>
                  {d} stays with {providerName(provider)}. People who keep a licence there carry on as today. Everyone else gets a real <b>name@{d}</b> mailbox in {product.name}, and you stop paying {providerName(provider)} for them.
                </p>
                <p>
                  Mail always reaches {providerName(provider)} first. One rule there passes anything for an address it doesn’t know on to {product.name}. If an address exists in neither, the sender gets the usual “doesn’t exist” reply.
                </p>
                <p className="esg-tipline">
                  <b>One place per person.</b> When someone moves to {product.name}, remove their {providerName(provider)} licence; while it exists, {providerName(provider)} keeps their mail.
                </p>
              </>
            ),
          },
          {
            title: 'Pass the rest on',
            body: (
              <>
                {routeHow}
                <Value v={mx} />
                <p className="muted small">Port 25. Only an admin of {d} can add this rule, once for the whole company.</p>
              </>
            ),
          },
          {
            title: 'Sending',
            body: (
              <>
                <p>So mail from {product.name} mailboxes isn’t marked as spam, add these where you manage {d}. Once for the whole company.</p>
                <Records list={splitRecords} />
                <Btn k="dns" idle="Check the records" wait="Checking DNS…" ok="Both records found" />
              </>
            ),
          },
          {
            title: 'Check it works',
            body: (
              <>
                <p>
                  We send a test to <b>check@{d}</b>, an address only {product.name} has. If it arrives here, {providerName(provider)} passes mail on correctly and you can give people {product.name} mailboxes.
                </p>
                <Btn k="route-test" idle="Send the test" wait={`Waiting for it to pass through ${providerName(provider)}…`} ok="It arrived: routing works" ms={2600} />
                <p className="muted small">After this we send the same test every day and tell admins straight away if it stops arriving, for example when someone changes the rule.</p>
              </>
            ),
          },
        ]
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
                    <p>Gmail sends a confirmation code to that address. It arrives here, so you don’t have to go looking:</p>
                    <Btn k="code" idle="Show Gmail’s code" wait="Waiting for Gmail…" ok="Code: 482 913" />
                    <p className="muted small">Paste it in Gmail, then choose “Forward a copy of incoming mail” and “keep Gmail’s copy in the Inbox”.</p>
                  </>
                )}
                <p className="esg-tipline">
                  <b>Admins:</b>{' '}
                  {provider === 'microsoft'
                    ? 'one mail flow rule in the Exchange admin center copies everyone’s mail, so nobody has to do this step.'
                    : provider === 'google'
                      ? 'one routing rule in the Google Admin console (“Also deliver to”) copies everyone’s mail, so nobody has to do this step.'
                      : 'most providers can copy everyone’s mail with one admin rule. Ask us.'}
                </p>
              </>
            ),
          },
          {
            title: 'Reply as yourself',
            body: (
              <>
                <p>
                  So replies leave as <b>{first || 'you'}@{d}</b> and don’t land in spam, add two records where you manage {d}. Once for the whole company.
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
                <p>Send any email to {first || 'you'}@{d} from your phone.</p>
                <Btn k="test" idle="I sent it" wait="Watching for it…" ok={`Arrived in ${product.name}`} ms={2200} />
              </>
            ),
          },
        ]
      : [
          {
            title: 'Add the records',
            body: (
              <>
                <p>Where you bought {d} (GoDaddy, Niagahoster, Cloudflare…). Until the MX record changes, mail still goes to your current provider, so nothing is lost.</p>
                <Records list={moveRecords} />
                <Btn k="dns" idle="Check my records" wait="Checking DNS…" ok="All records found" />
              </>
            ),
          },
          {
            title: 'Bring old mail',
            body: (
              <>
                <p>Sign in to {providerName(provider)} once and we copy every folder in the background. People can work while it runs.</p>
                <Btn k="import" idle={`Connect ${providerName(provider)}`} wait="Importing 12,480 emails…" ok="Imported 12,480 emails" ms={2600} />
              </>
            ),
          },
          {
            title: 'Switch day',
            body: <p>When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox; we keep pulling it in until the switch is complete.</p>,
          },
          {
            title: 'Cancel the old plan',
            body: <p>After 30 days with nothing arriving there, cancel {providerName(provider)}. We remind you.</p>,
          },
        ];

  return (
    <div className="esg-wiz">
      <div className="esg-steps" role="tablist">
        {steps.map((st, i) => (
          <button key={st.title} type="button" role="tab" aria-selected={i === cur} className={i === cur ? 'on' : i < cur ? 'done' : ''} onClick={() => setCur(i)}>
            <b>{i < cur ? <Check size={11} /> : i + 1}</b>
            <span>{st.title}</span>
          </button>
        ))}
      </div>
      <div className="esg-card" key={`${mode}-${cur}-${provider}`}>
        {steps[cur].body}
      </div>
      <div className="esg-nav">
        <button type="button" className="ghost-btn sm" disabled={cur === 0} onClick={() => setCur((c) => c - 1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="muted small">
          Step {cur + 1} of {steps.length}
        </span>
        <button type="button" className="ghost-btn sm outline" disabled={cur === steps.length - 1} onClick={() => setCur((c) => c + 1)}>
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
