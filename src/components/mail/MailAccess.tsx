import { useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, Plus, X } from 'lucide-react';
import type { User, Workspace } from '../../types';
import { server } from '../../sync';
import { Select, type Option } from '../ui/Select';
import { PersonSelect } from '../ui/PeoplePicker';
import { PersonCell, Badge } from '../ui/Person';
import { SmoothHeight, useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { loadAccess, postJson, type AccessInfo, type Forwarding, type Keep } from './teamsApi';
import { BusyButton, ErrorLine, MailLog, SwitchLine } from './teamsBits';
import { mark, t } from '../../i18n';
import { fmtDay } from '../../i18n/format';
import './teams.css';

/*
 * Settings, Mailbox access (You): Gmail's "Accounts" and "Forwarding and POP/IMAP" in one place.
 *  - Who else opens your mailbox (delegation), and how they send: as you, or "on your behalf". Taken back any time.
 *  - The mailboxes others gave you, which you pick in Mail's list of inboxes.
 *  - Forwarding: an address proved with a code, then all new mail goes on to it, with what happens to the copy here.
 *  - POP for apps that only fetch, and downloading a mailbox as mbox.
 *  - What happened to your mailboxes lately (the mail log).
 */
export const MAIL_ACCESS_SECTION = { id: 'mailaccess' as const, name: mark('Mailbox access'), icon: KeyRound, group: 'You' as const };

const KEEPS: { value: Keep; label: string }[] = [
  { value: 'keep', label: mark('Keep it in the inbox') },
  { value: 'read', label: mark('Keep it, marked read') },
  { value: 'archive', label: mark('Archive it') },
  { value: 'trash', label: mark('Move it to Trash') },
];

export function MailAccess({ ws, users, me, isAdmin, onImport, toast }: { ws: Workspace; users: User[]; me: string; isAdmin: boolean; onImport?: () => void; toast: (text: string) => void }) {
  const [info, setInfo] = useState<AccessInfo | null | 'failed'>(null);
  const load = () => void loadAccess(ws.id).then(setInfo, () => setInfo('failed'));
  useEffect(() => {
    if (server.on) load();
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!server.on)
    return (
      <>
        <h2>{t('Mailbox access')}</h2>
        <p className="set-intro">{t('Let a teammate read and send from your mailbox, forward your mail, and fetch it with POP. This works with sprint2go on a server; this demo has none.')}</p>
      </>
    );
  const d = info && info !== 'failed' ? info : null;
  const own = d?.mailboxes.filter((m) => m.mine) ?? [];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? t('Someone');
  return (
    <>
      <h2>{t('Mailbox access')}</h2>
      <p className="set-intro">{t('Who else opens your mailbox, where your mail is forwarded, and other ways to get it.')}</p>
      <SmoothHeight>
        {info === null ? (
          <p className="muted small">{t('Checking…')}</p>
        ) : info === 'failed' ? (
          <p className="set-hint">{t('Couldn’t check right now. Try again in a moment.')}</p>
        ) : (
          <div className="mx-sections">
            {own
              .filter((m) => m.delegable)
              .map((m) => (
                <Delegates key={m.id} ws={ws} users={users} me={me} box={m} multiple={own.filter((x) => x.delegable).length > 1} onSaved={(delegates) => setInfo((x) => (x && x !== 'failed' ? { ...x, mailboxes: x.mailboxes.map((b) => (b.id === m.id ? { ...b, delegates } : b)) } : x))} toast={toast} />
              ))}
            {d!.delegatedToMe.length > 0 && (
              <section className="set-block">
                <h3>{t('Mailboxes you can open for others')}</h3>
                <div className="acct-list">
                  {d!.delegatedToMe.map((x) => (
                    <div key={x.id} className="acct-row">
                      <span className="acct-info">
                        <strong>{x.email}</strong>
                        <small>{x.send === 'behalf' ? t('From {name}. What you send shows as sent by you on their behalf.', { name: x.owners.map(nameOf).join(', ') }) : t('From {name}. What you send shows as coming from the mailbox.', { name: x.owners.map(nameOf).join(', ') })}</small>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="set-hint">{t('Pick one in Mail’s list of inboxes to read and answer its mail.')}</p>
              </section>
            )}
            <ForwardingBlock ws={ws} boxes={d!.mailboxes.filter((m) => m.forwarding)} domains={d!.domains} onChange={(id, f) => setInfo((x) => (x && x !== 'failed' ? { ...x, mailboxes: x.mailboxes.map((b) => (b.id === id ? { ...b, forwarding: f } : b)) } : x))} reload={load} toast={toast} />
            <PopBlock info={d!} onPrefs={(prefs) => setInfo((x) => (x && x !== 'failed' ? { ...x, pop: { ...x.pop, prefs } } : x))} toast={toast} />
            <section className="set-block">
              <h3>{t('Export and import')}</h3>
              {d!.mailboxes
                .filter((m) => m.mine || (isAdmin && m.kind === 'shared'))
                .map((m) => (
                  <div key={m.id} className="set-row">
                    <span>
                      <strong>{m.email}</strong>
                      <small>{t('Every email as an .mbox file in a zip, which Gmail, Thunderbird and Apple Mail can open.')}</small>
                    </span>
                    <a className="ghost-btn outline sm" href={`/api/mail/export?ws=${encodeURIComponent(ws.id)}&account=${encodeURIComponent(m.id)}`} download onClick={() => toast(t('Your download starts in a moment. A big mailbox takes a while.'))}>
                      <Download size={14} /> {t('Download')}
                    </a>
                  </div>
                ))}
              {onImport && (
                <div className="set-row">
                  <span>
                    <strong>{t('Bring in Gmail history')}</strong>
                    <small>{t('Import a Google Takeout of Gmail, or an .mbox file, into any mailbox here.')}</small>
                  </span>
                  <button type="button" className="ghost-btn outline sm" onClick={onImport}>
                    {t('Import')}
                  </button>
                </div>
              )}
            </section>
            <section className="set-block">
              <h3>{t('Lately')}</h3>
              <MailLog entries={d!.log} users={users} mailbox={(id) => d!.mailboxes.find((m) => m.id === id)?.email} />
            </section>
          </div>
        )}
      </SmoothHeight>
    </>
  );
}

/* ---------- delegation ---------- */

function Delegates({ ws, users, me, box, multiple, onSaved, toast }: { ws: Workspace; users: User[]; me: string; box: AccessInfo['mailboxes'][number]; multiple: boolean; onSaved: (d: AccessInfo['mailboxes'][number]['delegates']) => void; toast: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = useLeaving(box.delegates, (x) => x.userId);
  const team = users.filter((u) => ws.members.some((m) => m.userId === u.id) && u.id !== me && !box.delegates.some((x) => x.userId === u.id));
  const sendOptions = (): Option<'as' | 'behalf'>[] => [
    { value: 'as', label: t('Sends as the mailbox'), hint: t('People see the mailbox’s name') },
    { value: 'behalf', label: t('Sends on my behalf'), hint: t('People see “sent by” with their name') },
  ];
  const save = async (next: { userId: string; send: 'as' | 'behalf' }[], done?: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ delegates: AccessInfo['mailboxes'][number]['delegates'] }>('/api/mail/delegates', { workspaceId: ws.id, accountId: box.id, delegates: next });
      onSaved(r.delegates);
      if (done) toast(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? t('Someone');
  return (
    <section className="set-block">
      <h3>{multiple ? t('Who else opens {email}', { email: box.email }) : t('Who else opens your mailbox')}</h3>
      <div className="acct-list mx-people">
        {rows.length === 0 && <EmptyState compact text={t('Only you. Give a teammate access and they can read, answer and send from it.')} />}
        {rows.map(({ item: x, leaving }) => {
          const u = users.find((y) => y.id === x.userId);
          return (
            <div key={x.userId} className={`acct-row mx-person ${leaving ? 'row-leaving' : ''}`}>
              <PersonCell person={{ name: u?.name ?? t('Someone'), email: u?.email, color: u?.color, photo: u?.photo }} sub={t('Since {when}', { when: fmtDay(x.at) })} />
              <span className="mx-person-tools">
                <Select value={x.send} options={sendOptions()} onChange={(send) => void save(box.delegates.map((y) => (y.userId === x.userId ? { userId: y.userId, send } : { userId: y.userId, send: y.send })))} label={t('How {name} sends', { name: name(x.userId) })} title={t('How they send')} width={280} disabled={busy} />
                <button type="button" className="icon-btn sm" aria-label={t('Take access back from {name}', { name: name(x.userId) })} title={t('Take access back')} disabled={busy || leaving} onClick={() => void save(box.delegates.filter((y) => y.userId !== x.userId).map((y) => ({ userId: y.userId, send: y.send })), t('{name} can no longer open your mailbox', { name: name(x.userId) }))}>
                  <X size={15} />
                </button>
              </span>
            </div>
          );
        })}
        {team.length > 0 && (
          <div className="acct-row mx-add-row">
            <Plus size={16} className="mx-add-icon" />
            <PersonSelect value={null} users={team} me={me} onChange={(id) => void save([...box.delegates.map((y) => ({ userId: y.userId, send: y.send })), { userId: id, send: 'as' }], t('{name} can now open your mailbox', { name: name(id) }))} label={t('Give a teammate access')} placeholder={t('Give a teammate access')} className="mx-add-person sel-flat" />
          </div>
        )}
      </div>
      <ErrorLine text={error} />
      <p className="set-hint">{t('They read, answer and send from it, and pick it in Mail’s list of inboxes. Everything they send is in the log below, and you can take access back at any time.')}</p>
    </section>
  );
}

/* ---------- forwarding ---------- */

function ForwardingBlock({ ws, boxes, domains, onChange, reload, toast }: { ws: Workspace; boxes: AccessInfo['mailboxes']; domains: string[]; onChange: (id: string, f: Forwarding) => void; reload: () => void; toast: (text: string) => void }) {
  const [pick, setPick] = useState(boxes.find((b) => b.mine)?.id ?? boxes[0]?.id ?? '');
  const box = boxes.find((b) => b.id === pick) ?? boxes[0];
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const f = box?.forwarding;
  const verified = useMemo(() => f?.addresses.filter((a) => a.verified) ?? [], [f]);
  const addrRows = useLeaving(f?.addresses ?? [], (a) => a.address);
  if (!box || !f) return null;
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      if (done) toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  // The forwarding addresses are the same ones filters use (one confirmation, server/mailFilters.ts).
  const ask = (a: string) =>
    run(`a:${a}`, async () => {
      const r = await postJson<{ verified: boolean; sent?: boolean }>('/api/mail/forwarding', { accountId: box.id, address: a });
      reload();
      toast(r.verified ? t('{address} is ready', { address: a }) : r.sent === false ? t('This server can’t send the link yet: an admin finds it in the server log.') : t('We emailed a link to {address}. It forwards once someone opens it.', { address: a }));
    });
  const setAll = (key: string, body: Record<string, unknown>, done?: string) =>
    run(key, async () => onChange(box.id, (await postJson<{ forwarding: Forwarding }>('/api/mail/forward-all', { workspaceId: ws.id, accountId: box.id, ...body })).forwarding), done);
  const off = f.policy === 'off';
  return (
    <section className="set-block">
      <h3>{t('Forwarding')}</h3>
      {boxes.length > 1 && (
        <div className="set-row">
          <span>
            <strong>{t('Mailbox')}</strong>
          </span>
          <Select value={box.id} options={boxes.map((b) => ({ value: b.id, label: b.email, hint: b.kind === 'shared' ? t('Shared inbox') : undefined }))} onChange={setPick} label={t('Mailbox')} title={t('Mailbox')} width={300} />
        </div>
      )}
      {off ? (
        <p className="mx-note">{t('Your company has automatic forwarding switched off.')}</p>
      ) : (
        f.blocked && <p className="mx-note">{f.policy === 'company' ? t('Forwarding is stopped: your company only allows forwarding to its own addresses now.') : t('Forwarding is stopped: that address isn’t confirmed any more.')}</p>
      )}
      <SwitchLine
        on={f.on && !f.blocked}
        disabled={!verified.length || !!busy || off}
        label={t('Forward all new mail')}
        hint={!verified.length ? t('Add an address first. An outside one forwards once someone opens the link it gets.') : f.on && f.address ? t('To {address}.', { address: f.address }) : t('Spam isn’t forwarded.')}
        onChange={(on) => void setAll('switch', { on, address: f.address ?? verified[0]?.address, keep: f.keep }, on ? t('Forwarding is on') : t('Forwarding is off'))}
      />
      <div className={`fold ${f.on && !f.blocked && verified.length ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="set-row">
            <span>
              <strong>{t('Forward to')}</strong>
            </span>
            <Select value={f.address ?? verified[0]?.address} options={verified.map((a) => ({ value: a.address, label: a.address }))} onChange={(addr) => void setAll('to', { on: true, address: addr, keep: f.keep })} label={t('Forward to')} title={t('Forward to')} width={300} />
          </div>
          <div className="set-row">
            <span>
              <strong>{t('Then the copy here')}</strong>
            </span>
            <Select value={f.keep} options={KEEPS.map((k) => ({ value: k.value, label: t(k.label) }))} onChange={(keep) => void setAll('keep', { on: true, address: f.address, keep })} label={t('Then the copy here')} title={t('Then the copy here')} width={260} />
          </div>
        </div>
      </div>
      <div className="acct-list mx-addresses">
        {addrRows.map(({ item: a, leaving }) => (
          <div key={a.address} className={`acct-row mx-address ${leaving ? 'row-leaving' : ''}`}>
            <span className="acct-info">
              <strong>
                {a.address} {a.verified ? <Badge small tone="good">{t('Confirmed')}</Badge> : <Badge small tone="warn">{t('Waiting for its link')}</Badge>}
              </strong>
              {!a.verified && (
                <small>
                  {t('Someone at that address opens the link we emailed.')}{' '}
                  <button type="button" className="link-btn small" disabled={!!busy} onClick={() => void ask(a.address)}>
                    {t('Send it again')}
                  </button>
                </small>
              )}
            </span>
            <button type="button" className="icon-btn sm" aria-label={t('Remove {address}', { address: a.address })} title={t('Remove')} disabled={!!busy || leaving} onClick={() => void run(`x:${a.address}`, async () => (await postJson('/api/mail/forwarding/remove', { accountId: box.id, address: a.address }), reload()))}>
              <X size={15} />
            </button>
          </div>
        ))}
        {box.mine && !off && (
          <form
            className="acct-row mx-add-address"
            onSubmit={(e) => {
              e.preventDefault();
              const a = address.trim().toLowerCase();
              if (a) void ask(a).then((ok) => ok && setAddress(''));
            }}
          >
            <input type="email" inputMode="email" autoComplete="email" placeholder={t('Add a forwarding address')} aria-label={t('Add a forwarding address')} value={address} onChange={(e) => setAddress(e.target.value)} />
            <BusyButton type="submit" busy={!!busy && busy.startsWith('a:')} className="ghost-btn outline sm" disabled={!address.includes('@')}>
              {t('Add')}
            </BusyButton>
          </form>
        )}
      </div>
      <ErrorLine text={error} />
      <p className="set-hint">{f.policy === 'company' ? t('Your company only allows forwarding to its own addresses ({domains}).', { domains: domains.join(', ') || t('none yet') }) : t('The same addresses work for filters. An outside address is emailed a link first, so mail only goes where someone agreed to get it.')}</p>
    </section>
  );
}

/* ---------- POP ---------- */

function PopBlock({ info, onPrefs, toast }: { info: AccessInfo; onPrefs: (p: AccessInfo['pop']['prefs']) => void; toast: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const p = info.pop;
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ prefs: AccessInfo['pop']['prefs'] }>('/api/mail/pop', body);
      onPrefs(r.prefs);
      if ('on' in body) toast(body.on ? t('POP is on for you') : t('POP is off for you'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="set-block">
      <h3>{t('POP')}</h3>
      {!p.on && <p className="mx-note">{p.missing === 'switch' ? t('POP isn’t switched on for this sprint2go server. IMAP in Phone mail apps works for most mail apps.') : t('Not available yet: it waits on a trusted certificate for the mail server.')}</p>}
      <SwitchLine on={p.prefs.on} disabled={busy} label={t('Let apps fetch my mail with POP')} hint={t('For apps that only download mail. They sign in with an app password from Phone mail apps.')} onChange={(on) => void save({ on, from: p.prefs.since ? 'now' : 'all' })} />
      <div className={`fold ${p.prefs.on ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="set-row">
            <span>
              <strong>{t('Which mail')}</strong>
            </span>
            <Select value={p.prefs.since ? 'now' : 'all'} options={[{ value: 'all', label: t('All mail, from the start') }, { value: 'now', label: t('Only mail that arrives from now on') }]} onChange={(from) => void save({ from })} label={t('Which mail')} title={t('Which mail')} width={300} disabled={busy} />
          </div>
          <div className="set-row">
            <span>
              <strong>{t('Once an app has fetched it')}</strong>
            </span>
            <Select value={p.prefs.after} options={KEEPS.map((k) => ({ value: k.value, label: t(k.label) }))} onChange={(after) => void save({ after })} label={t('Once an app has fetched it')} title={t('Once an app has fetched it')} width={260} disabled={busy} />
          </div>
          {p.on && (
            <div className="set-row">
              <span>
                <strong>{t('Server')}</strong>
                <small>{t('{host}, port {port} with SSL/TLS', { host: p.host, port: p.ports.pop3s })}</small>
              </span>
            </div>
          )}
        </div>
      </div>
      <ErrorLine text={error} />
    </section>
  );
}
