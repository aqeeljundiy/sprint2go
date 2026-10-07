import { useState } from 'react';
import { Check, Copy, Loader2, Mail } from 'lucide-react';
import type { MailProvider } from '../types';
import { providerName } from './Onboarding';

/**
 * How mail gets into Sprint2go, step by step. Two ways:
 *  - forward: mail stays at Gmail or Outlook; a copy of everything is forwarded to the person's Sprint2go address,
 *    and replies go out through Sprint2go (Amazon SES) from their own address.
 *  - move: the domain's mail moves to Sprint2go (MX records), old mail is imported, the old provider is cancelled.
 * Until the mail server runs, the waits (Gmail's code, the DNS check, the import, the test email) are simulated.
 */
export function EmailSetupGuide({ mode, provider, domain, first }: { mode: 'forward' | 'move'; provider: MailProvider; domain: string; first: string }) {
  const d = domain || 'yourcompany.com';
  const slug = d.split('.')[0].replace(/[^a-z0-9]/g, '') || 'company';
  const inbox = `${first || 'you'}.${slug}@in.sprint2go.com`;
  const [copied, setCopied] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'wait' | 'ok'>>({});
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
    setTimeout(() => setDone((x) => ({ ...x, [key]: 'ok' })), ms);
  };
  const Btn = ({ k, idle, wait, ok, ms }: { k: string; idle: string; wait: string; ok: string; ms?: number }) => (
    <button className="ghost-btn outline sm" disabled={done[k] === 'wait'} onClick={() => run(k, ms)}>
      {done[k] === 'wait' ? <Loader2 size={14} className="spin" /> : done[k] === 'ok' ? <Check size={14} /> : <Mail size={14} />} {done[k] === 'ok' ? ok : done[k] === 'wait' ? wait : idle}
    </button>
  );
  const Value = ({ v }: { v: string }) => (
    <span className="esg-value">
      <span className="mono sel">{v}</span>
      <button className="icon-btn sm" title="Copy" onClick={() => void copy(v)}>
        {copied === v ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  );

  const sendRecords = [
    { type: 'TXT', host: '@', value: 'v=spf1 include:amazonses.com ~all', note: 'Add to your SPF record (keep what’s there)' },
    { type: 'CNAME', host: 's2g._domainkey', value: `s2g.${d}.dkim.sprint2go.com`, note: 'Signs mail sent from Sprint2go' },
  ];
  const moveRecords = [
    { type: 'MX', host: '@', value: 'mx.sprint2go.com', note: 'Priority 10. Replaces your current MX records' },
    ...sendRecords.map((r) => (r.type === 'TXT' ? { ...r, value: 'v=spf1 include:amazonses.com include:spf.sprint2go.com ~all', note: 'Replaces your SPF record' } : r)),
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

  if (mode === 'forward')
    return (
      <ol className="esg">
        <li>
          <strong>Your Sprint2go address</strong>
          <p>Everyone gets a private address that only receives forwarded mail. Yours:</p>
          <Value v={inbox} />
        </li>
        <li>
          <strong>Forward a copy from {providerName(provider)}</strong>
          <p>{where}</p>
          {provider === 'google' && (
            <>
              <p>Gmail sends a confirmation code to that address. It arrives here, so you don’t have to go looking:</p>
              <Btn k="code" idle="Show Gmail’s code" wait="Waiting for Gmail…" ok="Code: 482 913" />
              <p className="muted small">Paste it in Gmail, then choose “Forward a copy of incoming mail to {inbox}” and “keep Gmail’s copy in the Inbox”.</p>
            </>
          )}
        </li>
        <li>
          <strong>Reply as yourself</strong>
          <p>
            So replies leave as <b>{first || 'you'}@{d}</b> and don’t land in spam, add two records where you manage {d} (once for the whole company):
          </p>
          <Records list={sendRecords} />
          <Btn k="dns" idle="Check the records" wait="Checking DNS…" ok="Both records found" />
        </li>
        <li>
          <strong>Test it</strong>
          <p>Send any email to {first || 'you'}@{d} from your phone.</p>
          <Btn k="test" idle="I sent it" wait="Watching for it…" ok="Arrived in Sprint2go" ms={2200} />
        </li>
        <li className="esg-tip">
          <strong>Admins: do everyone at once</strong>
          <p>
            {provider === 'microsoft'
              ? 'In the Exchange admin center, one mail flow rule can copy everyone’s mail to Sprint2go. Nobody has to set up forwarding.'
              : provider === 'google'
                ? 'In the Google Admin console, one routing rule (Gmail, Routing, “Also deliver to”) copies everyone’s mail to Sprint2go. Nobody has to set up forwarding.'
                : 'Ask us: most providers can copy everyone’s mail with one admin rule.'}
          </p>
        </li>
      </ol>
    );

  return (
    <ol className="esg">
      <li>
        <strong>Add the records for {d}</strong>
        <p>Where you bought the domain (GoDaddy, Niagahoster, Cloudflare…). Until the MX record changes, mail still goes to your current provider, so nothing is lost.</p>
        <Records list={moveRecords} />
        <Btn k="dns" idle="Check my records" wait="Checking DNS…" ok="All records found" />
      </li>
      <li>
        <strong>Bring your old mail</strong>
        <p>Sign in to {providerName(provider)} once and we copy every folder in the background. People can work while it runs.</p>
        <Btn k="import" idle={`Connect ${providerName(provider)}`} wait="Importing 12,480 emails…" ok="Imported 12,480 emails" ms={2600} />
      </li>
      <li>
        <strong>Switch day</strong>
        <p>When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox; we keep pulling it in until the switch is complete.</p>
      </li>
      <li>
        <strong>Cancel the old plan</strong>
        <p>After 30 days with nothing arriving there, cancel {providerName(provider)}. We remind you.</p>
      </li>
    </ol>
  );
}
