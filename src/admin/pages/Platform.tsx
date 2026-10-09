import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Download, HardDrive, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';

import { rel, bytes, dateTime, day, post, type PersonRow } from '../api';
import { testRelay } from '../../ice';
import { Badge, CopyBtn, Empty, Failed, Loading, Page, Section, Stat, Stats, Table, Tabs, useAct, useAdmin, useApi } from '../ui';
import { t, tn, tx } from '../../i18n';
import { fmtNumber } from '../../i18n/format';

export function Platform({ tab }: { tab: string }) {
  const { go } = useAdmin();
  return (
    <Page title={t('Platform')} sub={t('The server, its mail, its errors and its backups.')}>
      <Tabs
        value={tab}
        onChange={(id) => go(`/admin/platform/${id}`)}
        items={[
          { id: 'health', label: t('Health') },
          { id: 'mail', label: t('Mail') },
          { id: 'errors', label: t('Errors') },
          { id: 'backups', label: t('Backups') },
          { id: 'safety', label: t('Safety') },
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
  demoCompanies?: { total: number; activeWeek: number; bytes: number; keepDays: number };
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
/** The mail server's certificate in one line, and whether it's trusted. Called while rendering, so it's in the console's language. */
const certRow = (c: Cert) => ({
  label: t('Mail certificate'),
  value: c.trusted
    ? c.source === 'acme'
      ? t('{issuer} (renews itself), valid until {date}', { issuer: c.issuer ?? t('Trusted'), date: day(c.validTo) })
      : t('{issuer}, valid until {date}', { issuer: c.issuer ?? t('Trusted'), date: day(c.validTo) })
    : c.source === 'none'
      ? t('None: mail arrives without encryption')
      : c.acme
        ? c.error
          ? t('Self-signed until Let’s Encrypt issues one: {error}', { error: c.error.message })
          : t('Self-signed until Let’s Encrypt issues one')
        : c.error
          ? t('Self-signed: {error}', { error: c.error.message })
          : t('Self-signed: Google routes that require a CA-signed one bounce. Set CF_DNS_TOKEN or MAIL_TLS_CERT'),
  ok: c.trusted,
});
/** The newest off-site upload failed (or there's none yet while it's set up). */
const offsiteFailing = (o: System['offsite']) => !!o.error && (!o.last || o.error.at > o.last.at);
const uptime = (s: number) =>
  s > 86400
    ? t('{d} d {h} h', { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600) })
    : s > 3600
      ? t('{h} h {m} min', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
      : t('{m} min', { m: Math.floor(s / 60) });

function Health() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<System>('system', [], 60_000);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={8} />;
  const demo = data.demoCompanies;
  return (
    <>
      <Stats>
        <Stat label={t('Running')} value={uptime(data.uptimeSeconds)} hint={`v${data.version}${data.commit ? ` · ${data.commit.slice(0, 7)}` : ''}`} />
        <Stat label={t('Disk free')} value={data.disk ? bytes(data.disk.free) : t('unknown')} hint={data.disk ? t('of {total}', { total: bytes(data.disk.total) }) : undefined} tone={data.disk && data.disk.free / data.disk.total < 0.1 ? 'bad' : undefined} />
        <Stat label={t('Database')} value={bytes(data.dbBytes)} hint={data.lastBackupAt ? t('backed up {when}', { when: rel(data.lastBackupAt) }) : t('no backup yet')} onClick={() => go('/admin/platform/backups')} />
        <Stat label={t('Online now')} value={data.liveConnections} hint={tn(data.sessions, '{n} signed-in device', '{n} signed-in devices')} />
      </Stats>
      {data.warnings.length > 0 && (
        <Section title={t('Needs attention')}>
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
        <Section title={t('Services')}>
          <Rows
            rows={[
              { label: t('Address'), value: data.publicUrl, ok: data.https || !data.production },
              { label: t('Mail'), value: data.mailOn ? t('Our server at {host} · Boosted available', { host: data.mailHost }) : t('Our server at {host}', { host: data.mailHost }) },
              {
                label: t('Codes and notices'),
                value: data.systemMail === 'ses' ? t('Sent through Amazon SES') : data.systemMail === 'own' ? t('Sent from {address} by our mail server', { address: data.noreply }) : t('Not sent: sign-up codes go to the server log'),
                ok: data.systemMail !== 'log' || !data.production,
              },
              certRow(data.cert),
              { label: t('Support address'), value: data.supportEmail },
              { label: t('Meeting recorder'), value: !data.recorder.configured ? t('Not set up') : data.recorder.reachable ? tn(data.recorder.bots ?? 0, 'Answering · {n} bot busy', 'Answering · {n} bots busy') : t('Not answering'), ok: !data.recorder.configured || data.recorder.reachable },
              {
                label: t('Off-site backups'),
                value: !data.offsite.configured
                  ? t('Not set up: add S3_* to keep a copy off this server')
                  : offsiteFailing(data.offsite)
                    ? t('Failing: {error}', { error: data.offsite.error!.message })
                    : data.offsite.last
                      ? t('Copied {when}, {size}', { when: rel(data.offsite.last.at), size: bytes(data.offsite.last.bytes) })
                      : t('Set up: the first copy goes with the next daily backup'),
                ok: data.offsite.configured && !offsiteFailing(data.offsite),
              },
              {
                label: t('Build'),
                value: data.build
                  ? data.build.commit
                    ? t('Running build from {when} · {commit} · Node {node}', { when: dateTime(data.build.builtAt), commit: data.build.commit.slice(0, 7), node: data.node })
                    : t('Running build from {when} · Node {node}', { when: dateTime(data.build.builtAt), node: data.node })
                  : data.built
                    ? t('Built {when} · Node {node}', { when: dateTime(data.built), node: data.node })
                    : t('unknown'),
              },
              { label: t('Call relay'), value: <Relay relay={data.relay} />, ok: data.relay.configured && !!data.relay.reachable },
              ...(demo
                ? [
                    {
                      label: t('Demo companies'),
                      value: (demo.total
                        ? [tn(demo.total, '{n} person has their own, {week} used this week', '{n} people have their own, {week} used this week', { week: fmtNumber(demo.activeWeek) }), bytes(demo.bytes)]
                        : [t('Nobody has opened one yet')]
                      )
                        .concat(tn(demo.keepDays, 'removed after {n} day unused', 'removed after {n} days unused'))
                        .join(' · '),
                    },
                  ]
                : []),
            ]}
          />
        </Section>
        <Section title={t('Settings on the server')} hint={t('Set in Dokploy')}>
          <div className="adm-flags">
            {data.flags.map((f) => (
              <span key={f.key} className={`adm-flag ${f.set ? 'on' : ''}`} title={f.set ? t('Set') : t('Not set')}>
                {f.key}
              </span>
            ))}
          </div>
        </Section>
      </div>
      <Section title={t('Alerts sent')} hint={t('To operators with alerts on, in the app and by email')}>
        {data.alerts.length === 0 ? (
          <Empty title={t('No alerts yet')} />
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
    return <>{t('Not set up: huddles fail on networks that block direct calls. Add TURN_URLS and TURN_SECRET in Dokploy (steps in docs/turn.md).')}</>;
  const run = () => {
    setTest('running');
    void testRelay().then(setTest, () => setTest({ ok: false, text: t('This browser couldn’t run the test.') }));
  };
  return (
    <>
      {relay.reachable ? t('Answering at {address}', { address: relay.checked ?? '' }) : t('Set up, but nothing answers at {address}', { address: relay.checked ?? relay.addresses.join(', ') })}
      {' · '}
      <button type="button" className="adm-link muted" onClick={run} disabled={test === 'running'}>
        {test === 'running' ? t('Testing…') : t('Test from this browser')}
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
  dkim: { domain: string; host: string; value: string; use: string; state: 'ok' | 'missing' | 'different' | 'local'; found: string }[];
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
  const HEALTH: Record<string, string> = {
    inbound: t('Receiving (port 25 in)'),
    port25: t('Sending (port 25 out)'),
    a: t('Address record of {host}', { host: data.host }),
    ptr: data.ip ? t('Reverse DNS of {ip}', { ip: data.ip }) : t('Reverse DNS of our IP'),
  };
  return (
    <>
      <Stats>
        <Stat label={t('Received this month')} value={data.month.in} hint={t('{n} to spam', { n: fmtNumber(data.month.spam) })} />
        <Stat label={t('Sent this month')} value={data.month.out} hint={t('{n} boosted', { n: fmtNumber(data.month.boosted) })} />
        <Stat label={t('Couldn’t deliver')} value={data.month.failed} tone={data.month.failed ? 'warn' : undefined} />
        <Stat label={t('On the way')} value={data.queued.length} tone={data.queued.some((q) => q.attempts > 2) ? 'warn' : undefined} />
      </Stats>
      <div className="adm-split">
        <Section title={t('Can we send and receive?')}>
          <Rows rows={[...(['inbound', 'port25', 'a', 'ptr'] as const).map((k) => ({ label: HEALTH[k], value: data.health[k].ok ? data.health[k].found : t('{found} (wanted {want})', { found: data.health[k].found, want: data.health[k].want }), ok: data.health[k].ok })), certRow(data.cert)]} />
        </Section>
        <Section title={t('Blocklists')} hint={data.ip || t('set MAIL_IP to check')}>
          {data.blocklists.length === 0 ? (
            <Empty title={t('Not checked')} text={t('Set MAIL_IP on the server.')} />
          ) : (
            <Rows rows={data.blocklists.map((b) => ({ label: b.list, value: b.listed === 'unknown' ? t('No answer (some lists refuse public resolvers)') : b.listed ? t('Listed') : t('Not listed'), ok: b.listed === 'unknown' ? undefined : !b.listed }))} />
          )}
        </Section>
      </div>
      <Section title={t('Signing our own mail')} hint={t('DKIM, a TXT record per name')}>
        <div className="adm-dkim">
          {data.dkim.map((k) => (
            <div key={k.host} className={`adm-dkim-row ${k.state === 'missing' || k.state === 'different' ? 'warn' : ''}`}>
              <div className="adm-dkim-head">
                <span className="grow">
                  <strong className="adm-mono-sm">{k.host}</strong>
                  <small className="adm-block muted">
                    {k.use}.{' '}
                    {k.state === 'ok'
                      ? t('Published, so Gmail and Outlook can check it.')
                      : k.state === 'local'
                        ? t('{domain} isn’t a real name, so there’s nothing to publish here.', { domain: k.domain })
                        : k.state === 'different'
                          ? t('DNS has a different key: replace it with this one.')
                          : t('Not in DNS yet: add it as a TXT record. Until then, receivers can’t check the signature.')}
                  </small>
                </span>
                {k.state !== 'local' && <Check2 ok={k.state === 'ok'} />}
              </div>
              <div className="adm-linkbox">
                <code title={k.value}>{k.value}</code>
                <CopyBtn text={k.value} iconOnly />
              </div>
            </div>
          ))}
        </div>
      </Section>
      {data.paused.length > 0 && (
        <Section title={t('Mailboxes paused for bouncing')}>
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
                  <button className="ghost-btn sm" onClick={() => void act(() => post('mailbox/unpause', { workspaceId: p.workspaceId, accountId: p.accountId }), t('Sending resumed')).then(reload)}>
                    {t('Resume')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title={t('On the way')} hint={t('Retried for a day; each mailbox can send {hour} an hour, {day} a day', { hour: fmtNumber(data.limits.hour), day: fmtNumber(data.limits.day) })}>
        <Table
          id="mail-queue"
          rows={data.queued}
          rowKey={(q) => q.id}
          dense
          empty={{ title: t('Nothing waiting'), text: t('Everything sent has been delivered or given up on.') }}
          bulk={
            may('platform')
              ? (sel, clear) => (
                  <>
                    <button className="ghost-btn sm" onClick={() => void act(() => post('mail/retry', { ids: sel.map((q) => q.id) }), t('Retrying now')).then(() => (clear(), reload()))}>
                      {t('Retry now')}
                    </button>
                    <button className="ghost-btn sm" onClick={() => void act(() => post('mail/retry', { ids: sel.map((q) => q.id), drop: true }), t('Dropped')).then(() => (clear(), reload()))}>
                      {t('Drop')}
                    </button>
                  </>
                )
              : undefined
          }
          cols={[
            { key: 'to', label: t('To'), width: 'minmax(0, 1.6fr)', sort: (q) => q.toAddr, render: (q) => <span className="adm-cell-main"><strong>{q.toAddr}</strong><small>{t('from {address} · {company}', { address: q.fromAddr, company: q.company })}</small></span> },
            { key: 'tries', label: t('Tries'), width: '60px', align: 'right', sort: (q) => q.attempts, render: (q) => q.attempts },
            { key: 'error', label: t('Last answer'), width: 'minmax(0, 2fr)', hide: 'phone', render: (q) => <span className="adm-ellipsis muted">{q.error ?? t('not tried yet')}</span> },
            { key: 'next', label: t('Next try'), width: '100px', align: 'right', sort: (q) => q.nextAt, render: (q) => <span className="muted">{rel(q.nextAt)}</span> },
          ]}
        />
      </Section>
      <Section title={t('Couldn’t deliver')} hint={t('Recent')}>
        {data.failed.length === 0 ? (
          <Empty title={t('Nothing failed')} />
        ) : (
          <div className="adm-mini-list">
            {data.failed.slice(0, 30).map((f) => (
              <div key={f.id} className="adm-mini-row">
                <span className="grow">
                  <strong>{f.toAddr}</strong> <small className="muted">{t('from {address} · {company} · {when}', { address: f.fromAddr, company: f.company, when: rel(f.createdAt) })}</small>
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
        { id: 'open', label: t('Happening'), test: (e) => !e.resolvedAt },
        { id: 'server', label: t('Server'), test: (e) => !e.resolvedAt && e.source === 'server' },
        { id: 'client', label: t('In browsers'), test: (e) => !e.resolvedAt && e.source === 'client' },
        { id: 'resolved', label: tx('error', 'Resolved'), test: (e) => !!e.resolvedAt },
      ]}
      empty={{ title: t('No errors'), text: t('Server errors and crashes in people’s browsers are grouped here, with how many people they hit.') }}
      bulk={may('platform') ? (sel, clear) => <button className="ghost-btn sm" onClick={() => void act(() => post('error/resolve', { ids: sel.map((e) => e.id) }), t('Marked resolved; they reopen if they happen again')).then(() => (clear(), reload()))}>{t('Mark resolved')}</button> : undefined}
      cols={[
        {
          key: 'msg',
          label: t('Error'),
          width: 'minmax(0, 3fr)',
          sort: (e) => e.message,
          render: (e) => (
            <span className="adm-cell-main">
              <strong className="adm-wrap">
                <Badge tone={e.source === 'server' ? 'bad' : 'warn'}>{e.source === 'server' ? t('Server') : t('Browser')}</Badge> {e.message}
              </strong>
              <small>
                {e.path ?? ''}
                {e.companies.length ? ` · ${e.companies.join(', ')}` : ''}
                <ChevronDown size={11} className={`rot-chev ${open === e.id ? 'open' : ''}`} />
              </small>
              <div className={`fold ${open === e.id ? 'open' : ''}`}>
                <div className="fold-in">
                  <pre className="adm-pre">{e.sample}</pre>
                  <small className="muted">{t('First {when}', { when: dateTime(e.firstAt) })}</small>
                </div>
              </div>
            </span>
          ),
        },
        { key: 'count', label: t('Times'), width: '70px', align: 'right', sort: (e) => e.count, render: (e) => e.count },
        { key: 'users', label: t('People'), width: '70px', align: 'right', hide: 'phone', sort: (e) => e.users, render: (e) => e.users },
        { key: 'last', label: t('Last'), width: '100px', align: 'right', sort: (e) => e.lastAt, render: (e) => <span className="muted">{rel(e.lastAt)}</span> },
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
  const bt = data.backupTest;
  return (
    <>
      <Section
        title={t('Backups')}
        hint={t('One a day, the last 14 kept, on the server’s data volume')}
        actions={
          may('platform') && (
            <>
              <button className="ghost-btn sm" disabled={!!busy} onClick={() => (setBusy('test'), void act(() => post('backup/test'), t('Latest backup tested')).then(() => (setBusy(null), reload())))}>
                <RefreshCw size={13} className={busy === 'test' ? 'spin' : ''} /> {t('Test the latest')}
              </button>
              <button className="primary-btn sm" disabled={!!busy} onClick={() => (setBusy('now'), void act(() => post('backup/now'), t('Backup made')).then(() => (setBusy(null), reload())))}>
                <HardDrive size={13} /> {t('Back up now')}
              </button>
            </>
          )
        }
      >
        {bt && (
          <div className={`adm-banner ${bt.ok ? 'good' : 'bad'}`}>
            {bt.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
            <span>
              {bt.ok
                ? t('The latest backup opens and is intact: {detail} ({file}, tested {when}).', { detail: bt.detail, file: bt.file, when: rel(bt.at) })
                : t('The latest backup failed its test: {detail} ({file}, tested {when}).', { detail: bt.detail, file: bt.file, when: rel(bt.at) })}
            </span>
          </div>
        )}
        {data.backups.length === 0 ? (
          <Empty title={t('No backups yet')} text={t('The first one is made a minute after the server starts.')} />
        ) : (
          <div className="adm-mini-list">
            {data.backups.map((b) => (
              <div key={b.file} className="adm-mini-row">
                <HardDrive size={14} />
                <span className="grow adm-mono">{b.file}</span>
                <span className="muted">{bytes(b.bytes)}</span>
                {may('platform') && (
                  <a className="ghost-btn sm" href={`/api/admin/backup?file=${encodeURIComponent(b.file)}`}>
                    <Download size={13} /> {t('Download')}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="adm-note">{t('Labelled copies (before a cleanup, or made with Back up now) sit outside the 14-day rotation.')}</p>
      </Section>
      <Section title={t('Off-site copy')} hint={data.offsite.where ?? t('S3, Cloudflare R2 or Backblaze B2')}>
        {!data.offsite.configured ? (
          <Empty title={t('Not set up')} text={t('Add S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_KEY and S3_SECRET on the server to keep a copy off this server. Each daily backup then goes there gzipped, and the last 30 are kept.')} />
        ) : (
          <>
            {offsiteFailing(data.offsite) && (
              <div className="adm-banner bad">
                <AlertTriangle size={15} />
                <span>{t('The last copy failed {when}: {error}', { when: rel(data.offsite.error!.at), error: data.offsite.error!.message })}</span>
              </div>
            )}
            {data.offsite.last ? (
              <Rows
                rows={[
                  { label: t('Last copy'), value: `${data.offsite.last.file}, ${bytes(data.offsite.last.bytes)}, ${rel(data.offsite.last.at)}`, ok: !offsiteFailing(data.offsite) },
                  { label: t('Kept there'), value: tn(data.offsite.last.kept, '{n} daily copy (up to 30)', '{n} daily copies (up to 30)') },
                ]}
              />
            ) : (
              !offsiteFailing(data.offsite) && <Empty title={t('No copy yet')} text={t('The first one goes up with the next daily backup.')} />
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
  const abuse = (tickets.data?.tickets ?? []).filter((tk) => tk.tags.includes('abuse') || tk.tags.includes('postmaster'));
  const deletions = today.data?.queue.deletions ?? [];
  return (
    <>
      <Section title={t('Reports to abuse@ and postmaster@')} hint={t('They arrive as tickets tagged abuse')}>
        {!tickets.data ? (
          <Loading rows={2} />
        ) : abuse.length === 0 ? (
          <Empty title={t('No reports')} text={t('Someone complaining about mail from our server, or reporting misuse, lands here.')} />
        ) : (
          <div className="adm-mini-list">
            {abuse.map((tk) => (
              <button key={tk.id} type="button" className="adm-mini-row" onClick={() => go(`/admin/tickets/${tk.id}`)}>
                <ShieldAlert size={14} />
                <span className="grow">
                  #{tk.number} {tk.subject} <small className="muted">· {tk.requester.email} · {rel(tk.updatedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>
      <div className="adm-split">
        <Section title={t('Throwaway sign-ups')} hint={t('Temporary email services')}>
          {!people.data ? (
            <Loading rows={2} />
          ) : flagged.length === 0 ? (
            <Empty title={t('None')} />
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
        <Section title={t('Data deletion requests')} hint={t('Run automatically when their time comes')}>
          {deletions.length === 0 ? (
            <Empty title={t('None scheduled')} text={t('Schedule one from a company’s More menu when they ask for their data to be removed.')} />
          ) : (
            <div className="adm-mini-list">
              {deletions.map((d) => (
                <button key={d.id} type="button" className="adm-mini-row" onClick={() => go(`/admin/companies/${d.workspaceId}`)}>
                  <Trash2 size={14} />
                  <span className="grow">
                    <strong>{d.company ?? d.workspaceId}</strong> <small className="muted">· {rel(d.runAt)} · {t('asked by {who}', { who: d.requestedBy })}</small>
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
