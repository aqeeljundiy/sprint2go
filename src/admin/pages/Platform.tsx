import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Download, HardDrive, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';

import { rel, bytes, dateTime, post, type PersonRow } from '../api';
import { testRelay } from '../../ice';
import { Badge, Empty, Failed, Loading, Page, Section, Stat, Stats, Table, Tabs, useAct, useAdmin, useApi } from '../ui';

export function Platform({ tab }: { tab: string }) {
  const { go } = useAdmin();
  return (
    <Page title="Platform" sub="The server, its mail, its errors and its backups.">
      <Tabs
        value={tab}
        onChange={(t) => go(`/admin/platform/${t}`)}
        items={[
          { id: 'health', label: 'Health' },
          { id: 'mail', label: 'Mail' },
          { id: 'errors', label: 'Errors' },
          { id: 'backups', label: 'Backups' },
          { id: 'safety', label: 'Safety' },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {tab === 'mail' ? <Mail /> : tab === 'errors' ? <Errors /> : tab === 'backups' ? <Backups /> : tab === 'safety' ? <Safety /> : <Health />}
      </div>
    </Page>
  );
}

function Check2({ ok }: { ok: boolean }) {
  return <span className={`adm-ok-dot ${ok ? 'yes' : 'no'}`}>{ok ? <Check size={13} /> : <AlertTriangle size={13} />}</span>;
}
function Rows({ rows }: { rows: { label: string; value: ReactNode; ok?: boolean }[] }) {
  return (
    <div className="adm-mini-list">
      {rows.map((r) => (
        <div key={r.label} className={`adm-mini-row ${r.ok === false ? 'warn' : ''}`}>
          <span className="adm-row-label">{r.label}</span>
          <span className="grow adm-wrap">{r.value}</span>
          {r.ok !== undefined && <Check2 ok={r.ok} />}
        </div>
      ))}
    </div>
  );
}

interface System {
  version: string;
  commit: string | null;
  built: string | null;
  node: string;
  uptimeSeconds: number;
  production: boolean;
  publicUrl: string;
  https: boolean;
  disk: { free: number; total: number } | null;
  dbBytes: number;
  backups: { file: string; bytes: number; at: string }[];
  lastBackupAt: string | null;
  build: { builtAt: string; bundle: string | null; commit: string | null } | null;
  offsite: { configured: boolean; where: string | null; last: { at: string; file: string; bytes: number; kept: number } | null; error: { at: string; message: string } | null };
  cert: Cert;
  systemMail: 'ses' | 'own' | 'log';
  noreply: string;
  mailOn: boolean;
  mailHost: string;
  supportEmail: string;
  liveConnections: number;
  sessions: number;
  flags: { key: string; set: boolean }[];
  recorder: { configured: boolean; reachable: boolean; bots: number | null };
  relay: { configured: boolean; addresses: string[]; reachable: boolean | null; checked: string | null };
  warnings: { kind: string; text: string; level: string; to?: string }[];
  alerts: { kind: string; at: string; text: string }[];
  backupTest: { at: string; file: string; ok: boolean; detail: string } | null;
}
interface Cert {
  source: 'file' | 'acme' | 'self-signed' | 'none';
  issuer: string | null;
  validTo: string | null;
  daysLeft: number | null;
  trusted: boolean;
  acme: boolean;
  error: { at: string; message: string } | null;
}
/** The mail server's certificate in one line, and whether it's trusted. */
const certRow = (c: Cert) => ({
  label: 'Mail certificate',
  value: c.trusted
    ? `${c.issuer ?? 'Trusted'}${c.source === 'acme' ? ' (renews itself)' : ''}, valid until ${c.validTo?.slice(0, 10)}`
    : c.source === 'none'
      ? 'None: mail arrives without encryption'
      : c.acme
        ? `Self-signed until Let’s Encrypt issues one${c.error ? `: ${c.error.message}` : ''}`
        : c.error
          ? `Self-signed: ${c.error.message}`
          : 'Self-signed: Google routes that require a CA-signed one bounce. Set CF_DNS_TOKEN or MAIL_TLS_CERT',
  ok: c.trusted,
});
/** The newest off-site upload failed (or there's none yet while it's set up). */
const offsiteFailing = (o: System['offsite']) => !!o.error && (!o.last || o.error.at > o.last.at);
const uptime = (s: number) => (s > 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s > 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

function Health() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<System>('system', [], 60_000);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={8} />;
  return (
    <>
      <Stats>
        <Stat label="Running" value={uptime(data.uptimeSeconds)} hint={`v${data.version}${data.commit ? ` · ${data.commit.slice(0, 7)}` : ''}`} />
        <Stat label="Disk free" value={data.disk ? bytes(data.disk.free) : 'unknown'} hint={data.disk ? `of ${bytes(data.disk.total)}` : undefined} tone={data.disk && data.disk.free / data.disk.total < 0.1 ? 'bad' : undefined} />
        <Stat label="Database" value={bytes(data.dbBytes)} hint={data.lastBackupAt ? `backed up ${rel(data.lastBackupAt)}` : 'no backup yet'} onClick={() => go('/admin/platform/backups')} />
        <Stat label="Online now" value={data.liveConnections} hint={`${data.sessions} signed-in devices`} />
      </Stats>
      {data.warnings.length > 0 && (
        <Section title="Needs attention">
          <div className="adm-mini-list">
            {data.warnings.map((w) => (
              <button key={w.kind} type="button" className={`adm-mini-row ${w.level === 'high' ? 'bad' : 'warn'}`} onClick={() => w.to && go(w.to)}>
                <AlertTriangle size={14} />
                <span className="grow">{w.text}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="adm-split">
        <Section title="Services">
          <Rows
            rows={[
              { label: 'Address', value: data.publicUrl, ok: data.https || !data.production },
              { label: 'Mail', value: `Our server at ${data.mailHost}${data.mailOn ? ' · Boosted available' : ''}` },
              {
                label: 'Codes and notices',
                value: data.systemMail === 'ses' ? 'Sent through Amazon SES' : data.systemMail === 'own' ? `Sent from ${data.noreply} by our mail server` : 'Not sent: sign-up codes go to the server log',
                ok: data.systemMail !== 'log' || !data.production,
              },
              certRow(data.cert),
              { label: 'Support address', value: data.supportEmail },
              { label: 'Meeting recorder', value: !data.recorder.configured ? 'Not set up' : data.recorder.reachable ? `Answering · ${data.recorder.bots ?? 0} bots busy` : 'Not answering', ok: !data.recorder.configured || data.recorder.reachable },
              {
                label: 'Off-site backups',
                value: !data.offsite.configured ? 'Not set up: add S3_* to keep a copy off this server' : offsiteFailing(data.offsite) ? `Failing: ${data.offsite.error!.message}` : data.offsite.last ? `Copied ${rel(data.offsite.last.at)}, ${bytes(data.offsite.last.bytes)}` : 'Set up: the first copy goes with the next daily backup',
                ok: data.offsite.configured && !offsiteFailing(data.offsite),
              },
              { label: 'Build', value: data.build ? `Running build from ${dateTime(data.build.builtAt)}${data.build.commit ? ` · ${data.build.commit.slice(0, 7)}` : ''} · Node ${data.node}` : data.built ? `Built ${dateTime(data.built)} · Node ${data.node}` : 'unknown' },
              { label: 'Call relay', value: <Relay relay={data.relay} />, ok: data.relay.configured && !!data.relay.reachable },
            ]}
          />
        </Section>
        <Section title="Settings on the server" hint="Set in Dokploy">
          <div className="adm-flags">
            {data.flags.map((f) => (
              <span key={f.key} className={`adm-flag ${f.set ? 'on' : ''}`} title={f.set ? 'Set' : 'Not set'}>
                {f.key}
              </span>
            ))}
          </div>
        </Section>
      </div>
      <Section title="Alerts sent" hint="To operators with alerts on, in the app and by email">
        {data.alerts.length === 0 ? (
          <Empty title="No alerts yet" />
        ) : (
          <div className="adm-mini-list">
            {data.alerts.map((a) => (
              <div key={a.kind + a.at} className="adm-mini-row">
                <span className="grow">{a.text}</span>
                <small className="muted">{rel(a.at)}</small>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/** The call relay (TURN) for huddles: whether it's set up and answers, and a check of the whole chain from this browser. */
function Relay({ relay }: { relay: System['relay'] }) {
  const [test, setTest] = useState<{ ok: boolean; text: string } | 'running' | null>(null);
  if (!relay.configured)
    return <>Not set up: huddles fail on networks that block direct calls. Add TURN_URLS and TURN_SECRET in Dokploy (steps in docs/turn.md).</>;
  const run = () => {
    setTest('running');
    void testRelay().then(setTest, () => setTest({ ok: false, text: 'This browser couldn’t run the test.' }));
  };
  return (
    <>
      {relay.reachable ? `Answering at ${relay.checked}` : `Set up, but nothing answers at ${relay.checked ?? relay.addresses.join(', ')}`}
      {' · '}
      <button type="button" className="adm-link muted" onClick={run} disabled={test === 'running'}>
        {test === 'running' ? 'Testing…' : 'Test from this browser'}
      </button>
      {test && test !== 'running' && (
        <small key={test.text} className={`adm-block adm-relay-result ${test.ok ? 'muted' : 'err'}`}>
          {test.text}
        </small>
      )}
    </>
  );
}

interface MailData {
  host: string;
  ip: string;
  supportEmail: string;
  limits: { hour: number; day: number };
  health: Record<'ptr' | 'a' | 'port25' | 'inbound', { ok: boolean; found: string; want: string }>;
  cert: Cert;
  blocklists: { list: string; listed: boolean | 'unknown' }[];
  queued: { id: string; company: string; route: string; fromAddr: string; toAddr: string; attempts: number; nextAt: string; error: string | null; createdAt: string }[];
  failed: { id: string; company: string; route: string; fromAddr: string; toAddr: string; attempts: number; error: string | null; createdAt: string }[];
  paused: { workspaceId: string; company: string; accountId: string; email: string; at: string; reason: string }[];
  month: { in: number; out: number; failed: number; spam: number; boosted: number };
}
function Mail() {
  const { go, may } = useAdmin();
  const { data, error, reload } = useApi<MailData>('mail', [], 30_000);
  const act = useAct();
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={8} />;
  const HEALTH: Record<string, string> = { inbound: 'Receiving (port 25 in)', port25: 'Sending (port 25 out)', a: `Address record of ${data.host}`, ptr: `Reverse DNS of ${data.ip || 'our IP'}` };
  return (
    <>
      <Stats>
        <Stat label="Received this month" value={data.month.in} hint={`${data.month.spam} to spam`} />
        <Stat label="Sent this month" value={data.month.out} hint={`${data.month.boosted} boosted`} />
        <Stat label="Couldn’t deliver" value={data.month.failed} tone={data.month.failed ? 'warn' : undefined} />
        <Stat label="On the way" value={data.queued.length} tone={data.queued.some((q) => q.attempts > 2) ? 'warn' : undefined} />
      </Stats>
      <div className="adm-split">
        <Section title="Can we send and receive?">
          <Rows rows={[...(['inbound', 'port25', 'a', 'ptr'] as const).map((k) => ({ label: HEALTH[k], value: data.health[k].ok ? data.health[k].found : `${data.health[k].found} (wanted ${data.health[k].want})`, ok: data.health[k].ok })), certRow(data.cert)]} />
        </Section>
        <Section title="Blocklists" hint={data.ip || 'set MAIL_IP to check'}>
          {data.blocklists.length === 0 ? (
            <Empty title="Not checked" text="Set MAIL_IP on the server." />
          ) : (
            <Rows rows={data.blocklists.map((b) => ({ label: b.list, value: b.listed === 'unknown' ? 'No answer (some lists refuse public resolvers)' : b.listed ? 'Listed' : 'Not listed', ok: b.listed === 'unknown' ? undefined : !b.listed }))} />
          )}
        </Section>
      </div>
      {data.paused.length > 0 && (
        <Section title="Mailboxes paused for bouncing">
          <div className="adm-mini-list">
            {data.paused.map((p) => (
              <div key={p.accountId} className="adm-mini-row warn">
                <span className="grow">
                  <strong>{p.email}</strong>{' '}
                  <button type="button" className="adm-link muted" onClick={() => go(`/admin/companies/${p.workspaceId}/email`)}>
                    {p.company}
                  </button>
                  <small className="muted"> · {p.reason}</small>
                </span>
                {may('platform') && (
                  <button className="ghost-btn sm" onClick={() => void act(() => post('mailbox/unpause', { workspaceId: p.workspaceId, accountId: p.accountId }), 'Sending resumed').then(reload)}>
                    Resume
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="On the way" hint={`Retried for a day; each mailbox can send ${data.limits.hour} an hour, ${data.limits.day} a day`}>
        <Table
          id="mail-queue"
          rows={data.queued}
          rowKey={(q) => q.id}
          dense
          empty={{ title: 'Nothing waiting', text: 'Everything sent has been delivered or given up on.' }}
          bulk={
            may('platform')
              ? (sel, clear) => (
                  <>
                    <button className="ghost-btn sm" onClick={() => void act(() => post('mail/retry', { ids: sel.map((q) => q.id) }), 'Retrying now').then(() => (clear(), reload()))}>
                      Retry now
                    </button>
                    <button className="ghost-btn sm" onClick={() => void act(() => post('mail/retry', { ids: sel.map((q) => q.id), drop: true }), 'Dropped').then(() => (clear(), reload()))}>
                      Drop
                    </button>
                  </>
                )
              : undefined
          }
          cols={[
            { key: 'to', label: 'To', width: 'minmax(0, 1.6fr)', sort: (q) => q.toAddr, render: (q) => <span className="adm-cell-main"><strong>{q.toAddr}</strong><small>from {q.fromAddr} · {q.company}</small></span> },
            { key: 'tries', label: 'Tries', width: '60px', align: 'right', sort: (q) => q.attempts, render: (q) => q.attempts },
            { key: 'error', label: 'Last answer', width: 'minmax(0, 2fr)', hide: 'phone', render: (q) => <span className="adm-ellipsis muted">{q.error ?? 'not tried yet'}</span> },
            { key: 'next', label: 'Next try', width: '100px', align: 'right', sort: (q) => q.nextAt, render: (q) => <span className="muted">{rel(q.nextAt)}</span> },
          ]}
        />
      </Section>
      <Section title="Couldn’t deliver" hint="Recent">
        {data.failed.length === 0 ? (
          <Empty title="Nothing failed" />
        ) : (
          <div className="adm-mini-list">
            {data.failed.slice(0, 30).map((f) => (
              <div key={f.id} className="adm-mini-row">
                <span className="grow">
                  <strong>{f.toAddr}</strong> <small className="muted">from {f.fromAddr} · {f.company} · {rel(f.createdAt)}</small>
                  <small className="adm-block muted">{f.error}</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

interface ErrorGroup {
  id: string;
  source: 'server' | 'client';
  message: string;
  sample: string;
  path: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  users: number;
  workspaces: number;
  companies: string[];
  resolvedAt: string | null;
}
function Errors() {
  const { may } = useAdmin();
  const { data, error, reload } = useApi<{ errors: ErrorGroup[] }>('errors', [], 60_000);
  const [open, setOpen] = useState<string | null>(null);
  const act = useAct();
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={6} />;
  return (
    <Table
      id="errors"
      rows={data.errors}
      rowKey={(e) => e.id}
      onOpen={(e) => setOpen(open === e.id ? null : e.id)}
      search={(e) => `${e.message} ${e.path ?? ''} ${e.companies.join(' ')}`}
      initialSort={{ key: 'last', dir: -1 }}
      views={[
        { id: 'open', label: 'Happening', test: (e) => !e.resolvedAt },
        { id: 'server', label: 'Server', test: (e) => !e.resolvedAt && e.source === 'server' },
        { id: 'client', label: 'In browsers', test: (e) => !e.resolvedAt && e.source === 'client' },
        { id: 'resolved', label: 'Resolved', test: (e) => !!e.resolvedAt },
      ]}
      empty={{ title: 'No errors', text: 'Server errors and crashes in people’s browsers are grouped here, with how many people they hit.' }}
      bulk={may('platform') ? (sel, clear) => <button className="ghost-btn sm" onClick={() => void act(() => post('error/resolve', { ids: sel.map((e) => e.id) }), 'Marked resolved; they reopen if they happen again').then(() => (clear(), reload()))}>Mark resolved</button> : undefined}
      cols={[
        {
          key: 'msg',
          label: 'Error',
          width: 'minmax(0, 3fr)',
          sort: (e) => e.message,
          render: (e) => (
            <span className="adm-cell-main">
              <strong className="adm-wrap">
                <Badge tone={e.source === 'server' ? 'bad' : 'warn'}>{e.source === 'server' ? 'Server' : 'Browser'}</Badge> {e.message}
              </strong>
              <small>
                {e.path ?? ''}
                {e.companies.length ? ` · ${e.companies.join(', ')}` : ''}
                <ChevronDown size={11} className={`rot-chev ${open === e.id ? 'open' : ''}`} />
              </small>
              <div className={`fold ${open === e.id ? 'open' : ''}`}>
                <div className="fold-in">
                  <pre className="adm-pre">{e.sample}</pre>
                  <small className="muted">First {dateTime(e.firstAt)}</small>
                </div>
              </div>
            </span>
          ),
        },
        { key: 'count', label: 'Times', width: '70px', align: 'right', sort: (e) => e.count, render: (e) => e.count },
        { key: 'users', label: 'People', width: '70px', align: 'right', hide: 'phone', sort: (e) => e.users, render: (e) => e.users },
        { key: 'last', label: 'Last', width: '100px', align: 'right', sort: (e) => e.lastAt, render: (e) => <span className="muted">{rel(e.lastAt)}</span> },
      ]}
    />
  );
}

function Backups() {
  const { may } = useAdmin();
  const { data, error, reload } = useApi<System>('system');
  const act = useAct();
  const [busy, setBusy] = useState<'now' | 'test' | null>(null);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={6} />;
  const t = data.backupTest;
  return (
    <>
      <Section
        title="Backups"
        hint="One a day, the last 14 kept, on the server’s data volume"
        actions={
          may('platform') && (
            <>
              <button className="ghost-btn sm" disabled={!!busy} onClick={() => (setBusy('test'), void act(() => post('backup/test'), 'Latest backup tested').then(() => (setBusy(null), reload())))}>
                <RefreshCw size={13} className={busy === 'test' ? 'spin' : ''} /> Test the latest
              </button>
              <button className="primary-btn sm" disabled={!!busy} onClick={() => (setBusy('now'), void act(() => post('backup/now'), 'Backup made').then(() => (setBusy(null), reload())))}>
                <HardDrive size={13} /> Back up now
              </button>
            </>
          )
        }
      >
        {t && (
          <div className={`adm-banner ${t.ok ? 'good' : 'bad'}`}>
            {t.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
            <span>
              {t.ok ? 'The latest backup opens and is intact' : 'The latest backup failed its test'}: {t.detail} ({t.file}, tested {rel(t.at)}).
            </span>
          </div>
        )}
        {data.backups.length === 0 ? (
          <Empty title="No backups yet" text="The first one is made a minute after the server starts." />
        ) : (
          <div className="adm-mini-list">
            {data.backups.map((b) => (
              <div key={b.file} className="adm-mini-row">
                <HardDrive size={14} />
                <span className="grow adm-mono">{b.file}</span>
                <span className="muted">{bytes(b.bytes)}</span>
                {may('platform') && (
                  <a className="ghost-btn sm" href={`/api/admin/backup?file=${encodeURIComponent(b.file)}`}>
                    <Download size={13} /> Download
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="adm-note">Labelled copies (before a cleanup, or made with Back up now) sit outside the 14-day rotation.</p>
      </Section>
      <Section title="Off-site copy" hint={data.offsite.where ?? 'S3, Cloudflare R2 or Backblaze B2'}>
        {!data.offsite.configured ? (
          <Empty title="Not set up" text="Add S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_KEY and S3_SECRET on the server to keep a copy off this server. Each daily backup then goes there gzipped, and the last 30 are kept." />
        ) : (
          <>
            {offsiteFailing(data.offsite) && (
              <div className="adm-banner bad">
                <AlertTriangle size={15} />
                <span>
                  The last copy failed {rel(data.offsite.error!.at)}: {data.offsite.error!.message}
                </span>
              </div>
            )}
            {data.offsite.last ? (
              <Rows
                rows={[
                  { label: 'Last copy', value: `${data.offsite.last.file}, ${bytes(data.offsite.last.bytes)}, ${rel(data.offsite.last.at)}`, ok: !offsiteFailing(data.offsite) },
                  { label: 'Kept there', value: `${data.offsite.last.kept} daily copies (up to 30)` },
                ]}
              />
            ) : (
              !offsiteFailing(data.offsite) && <Empty title="No copy yet" text="The first one goes up with the next daily backup." />
            )}
          </>
        )}
      </Section>
    </>
  );
}

function Safety() {
  const { go } = useAdmin();
  const people = useApi<{ people: PersonRow[] }>('people');
  const today = useApi<{ queue: { deletions: { id: string; workspaceId: string; company: string | null; runAt: string; requestedBy: string }[] } }>('today');
  const tickets = useApi<{ tickets: { id: string; number: number; subject: string; tags: string[]; status: string; updatedAt: string; requester: { email: string } }[] }>('tickets');
  const flagged = (people.data?.people ?? []).filter((p) => p.disposable);
  const abuse = (tickets.data?.tickets ?? []).filter((t) => t.tags.includes('abuse') || t.tags.includes('postmaster'));
  const deletions = today.data?.queue.deletions ?? [];
  return (
    <>
      <Section title="Reports to abuse@ and postmaster@" hint="They arrive as tickets tagged abuse">
        {!tickets.data ? (
          <Loading rows={2} />
        ) : abuse.length === 0 ? (
          <Empty title="No reports" text="Someone complaining about mail from our server, or reporting misuse, lands here." />
        ) : (
          <div className="adm-mini-list">
            {abuse.map((t) => (
              <button key={t.id} type="button" className="adm-mini-row" onClick={() => go(`/admin/tickets/${t.id}`)}>
                <ShieldAlert size={14} />
                <span className="grow">
                  #{t.number} {t.subject} <small className="muted">· {t.requester.email} · {rel(t.updatedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>
      <div className="adm-split">
        <Section title="Throwaway sign-ups" hint="Temporary email services">
          {!people.data ? (
            <Loading rows={2} />
          ) : flagged.length === 0 ? (
            <Empty title="None" />
          ) : (
            <div className="adm-mini-list">
              {flagged.map((p) => (
                <button key={p.id} type="button" className="adm-mini-row" onClick={() => go(`/admin/people/${p.id}`)}>
                  <span className="grow">
                    <strong>{p.name}</strong> <small className="muted">{p.email}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title="Data deletion requests" hint="Run automatically when their time comes">
          {deletions.length === 0 ? (
            <Empty title="None scheduled" text="Schedule one from a company’s More menu when they ask for their data to be removed." />
          ) : (
            <div className="adm-mini-list">
              {deletions.map((d) => (
                <button key={d.id} type="button" className="adm-mini-row" onClick={() => go(`/admin/companies/${d.workspaceId}`)}>
                  <Trash2 size={14} />
                  <span className="grow">
                    <strong>{d.company ?? d.workspaceId}</strong> <small className="muted">· {rel(d.runAt)} · asked by {d.requestedBy}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
