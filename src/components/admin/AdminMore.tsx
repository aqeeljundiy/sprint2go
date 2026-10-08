import { LanguagePicker } from '../LanguagePicker';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { term, brand as product } from '../../terms';
import { ArrowDown, ArrowUp, Cloud, Download, FileText, HardDrive, ShieldCheck, Users, Video, X } from 'lucide-react';
import { DEFAULT_PERMISSIONS, type MemberPermissions } from '../../types';
import type { AppId, DriveItem, MeetingSettings, Plan, StorageSettings, Team, User, Workspace } from '../../types';
import { fmtSize } from '../../data/drive';
import { storageGB, rp } from '../../data/pricing';
import { DEFAULT_MEETINGS } from '../../data/workspaces';
import { APPS, useAppOrder } from '../AppRail';
import { Avatar } from '../Avatar';
import { Select } from '../ui/Select';
import { server } from '../../sync';
import { caps } from '../../caps';
import { relative } from '../../utils';
import { loadTwoStep } from '../TwoStep';
import { JOIN_MODES } from '../../meetingLinks';

const Switch = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
    <span />
  </button>
);
const Row = ({ title, hint, children }: { title: React.ReactNode; hint?: string; children: React.ReactNode }) => (
  <div className="set-row">
    <span>
      <strong>{title}</strong>
      {hint && <small>{hint}</small>}
    </span>
    {children}
  </div>
);

/* ---------------- What Members can do ---------------- */

export function PermissionsSection({ ws, canManage, onWorkspace }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void }) {
  const p = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  const set = (k: keyof MemberPermissions, v: boolean) => onWorkspace({ permissions: { ...ws.permissions, [k]: v } });
  const rows: { k: keyof MemberPermissions; title: string; hint: string }[] = [
    { k: 'createProjects', title: `Start new ${term.many}`, hint: `They become the ${term.one}’s Lead` },
    { k: 'seeAllProjects', title: `See every ${term.one}`, hint: `Off: only the ${term.many} they’re on` },
    { k: 'inviteGuests', title: 'Invite guests', hint: `Bring a ${term.who}’s people into a ${term.one}. Its Lead always can.` },
    { k: 'editTables', title: 'Change how tables work', hint: 'Columns, views and automations. Adding and editing rows is always allowed.' },
    { k: 'createTeams', title: 'Create teams', hint: 'They lead the team they make' },
    { k: 'deleteThings', title: 'Delete things', hint: `${term.Many}, tables and channels, and other people’s notes and files. Their own are always theirs to delete.` },
    { k: 'seeBilling', title: 'See plan, billing and AI usage', hint: 'What the company pays and what the AI costs' },
  ];
  return (
    <>
      <h2>Permissions</h2>
      <p className="set-intro">Owners and admins can do everything. These switches decide what people with the Member role can do. A {term.one}’s Lead can always manage that {term.one}: its people, guests and settings.</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>What Members can do</h3>
          {rows.map(({ k, title, hint }) => (
            <Row key={k} title={title} hint={hint}>
              <Switch on={p[k]} onChange={(v) => set(k, v)} />
            </Row>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/* ---------------- Storage ---------------- */

type Room = { used: number; total: number; left: number; video?: number; byPerson?: { userId: string; bytes: number }[] };

export function StorageSection({ ws, people, plan, drive, users, byChannel, canManage, onStorage, onBilling }: {
  ws: Workspace;
  byChannel: { name: string; size: number }[];
  people: number;
  plan: Plan;
  drive: DriveItem[];
  users: User[];
  canManage: boolean;
  onStorage: (s: StorageSettings) => void;
  onBilling: () => void;
  toast: (t: string) => void;
}) {
  const st = ws.storage ?? { askOver: 500 };
  const files = drive.filter((d) => !d.trashed && d.kind !== 'folder');
  const sum = (list: DriveItem[]) => list.reduce((s, d) => s + d.size, 0);
  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  // On a real server the numbers are what the company's uploaded files really take; the demo shows an example.
  const live = server.on;
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => {
    if (!live) return;
    void fetch(`/api/storage?workspaceId=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Room>) : null))
      .then(setRoom)
      .catch(() => {});
  }, [ws.id, live]);
  const pool = live ? room?.total ?? storageGB(plan, people) * 1024 ** 3 : storageGB(plan, people) * 1024 ** 3;
  const mailBytes = room?.byPerson?.find((x) => x.userId === 'mail')?.bytes ?? 0;
  const parts = live
    ? [
        { name: 'Files', size: Math.max(0, (room?.used ?? 0) - (room?.video ?? 0) - mailBytes), color: '#10b981' },
        { name: 'Videos', size: room?.video ?? 0, color: '#f97316' },
        { name: 'Email attachments', size: mailBytes, color: '#8b5cf6' },
      ]
    : [
        { name: 'Mail', size: 1.3 * 1024 ** 3 * Math.max(1, people / 3), color: 'var(--accent)' },
        { name: 'Files', size: sum(files.filter((d) => !d.channelId && d.kind !== 'video' && d.kind !== 'audio')), color: '#10b981' },
        { name: 'Videos', size: sum(files.filter((d) => d.kind === 'video')), color: '#f97316' },
        { name: 'Chat files', size: sum(files.filter((d) => d.channelId)), color: '#8b5cf6' },
        { name: 'Meeting recordings', size: 3 * 1.1 * 1024 ** 3, color: '#ec4899' },
      ];
  const used = live ? room?.used ?? 0 : parts.reduce((s, x) => s + x.size, 0);
  const byPerson = live
    ? (room?.byPerson ?? [])
        .filter((x) => x.userId !== 'mail')
        .map((x) => ({ user: users.find((u) => u.id === x.userId), bytes: x.bytes }))
        .filter((x): x is { user: User; bytes: number } => !!x.user)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 6)
    : users.slice(0, 6).map((u, i) => ({ user: u, bytes: (1.3 + ((i * 7) % 5) * 2.1) * 1024 ** 3 }));
  const pct = (n: number) => `${Math.max(0.5, (n / pool) * 100)}%`;

  return (
    <>
      <h2>Storage</h2>
      <p className="set-intro">
        {live && !room ? 'Adding up what your files take…' : `${fmtSize(used)} of ${fmtSize(pool)} used, shared by the whole company. A heavy video editor uses the team’s pool, not their own.`}
      </p>
      <div className="stack-bar">
        {parts.map((x) => (
          <span key={x.name} style={{ width: x.size > 0 ? pct(x.size) : 0, background: x.color }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((x) => (
          <span key={x.name}>
            <i style={{ background: x.color }} /> {x.name} · {fmtSize(x.size)}
          </span>
        ))}
      </div>
      {live && <p className="muted small">Counts files uploaded to Drive, chat, tables and the shared spaces, and email attachments. The text of emails and meeting recordings aren’t counted.</p>}
      {used / pool > 0.8 && (
        <p className="trial-note">
          You’ve used {Math.round((used / pool) * 100)}%. Add 50 GB for {rp(39_000)} a month, or{' '}
          <button className="link-btn" onClick={onBilling}>
            see plans
          </button>
          .
        </p>
      )}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>Big files</h3>
          <Row title="Ask before saving big files" hint="Anyone uploading something bigger is asked first, with its size and the storage the company has left.">
            <Select
              value={String(st.askOver)}
              onChange={(v) => onStorage({ ...st, askOver: Number(v) as StorageSettings['askOver'] })}
              label="Ask before saving big files"
              options={[
                { value: '200', label: 'Over 200 MB' },
                { value: '500', label: 'Over 500 MB' },
                { value: '1000', label: 'Over 1 GB' },
                { value: '0', label: 'Never ask' },
              ]}
            />
          </Row>
          {live && caps.maxUploadMb > 0 && <p className="muted small">One file can be up to {caps.maxUploadMb >= 1024 ? `${+(caps.maxUploadMb / 1024).toFixed(1)} GB` : `${caps.maxUploadMb} MB`}.</p>}
          <Row title={<><Cloud size={14} /> Use your own storage</>} hint={`Coming soon: raw footage and huge files kept in your own Google Drive, Dropbox or Backblaze B2, still showing on the ${term.one} page. Until then everything is saved in ${product.name}.`}>
            <span className="badge-soon">Not yet</span>
          </Row>
        </div>
      </fieldset>

      <div className="set-block">
        <h3>Biggest files</h3>
        {biggest.length === 0 && <p className="muted small">No files in Drive yet.</p>}
        {biggest.map((f) => (
          <div key={f.id} className="pa-row">
            <span className="cf-icon">{f.kind === 'video' ? <Video size={15} /> : <FileText size={15} />}</span>
            <span className="pa-title">{f.name}</span>
            <span className="muted small">{fmtSize(f.size)}</span>
          </div>
        ))}
      </div>
      <div className="set-block">
        <h3>By channel</h3>
        {byChannel.length === 0 && <p className="muted small">No files shared in chat yet.</p>}
        {byChannel.map((c) => (
          <div key={c.name} className="pa-row">
            <span className="pa-title"># {c.name}</span>
            <span className="muted small">{fmtSize(c.size)}</span>
          </div>
        ))}
      </div>
      <div className="set-block">
        <h3>By person</h3>
        {live && room && byPerson.length === 0 && <p className="muted small">Nobody has uploaded anything yet.</p>}
        {byPerson.map(({ user: u, bytes }) => (
          <div key={u.id} className="pa-row">
            <Avatar person={u} size={22} />
            <span className="pa-title">{u.name}</span>
            <span className="muted small">{fmtSize(bytes)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Meetings ---------------- */

// Audio is the default and the most reliable; video (Beta) also saves cameras and screen shares, with a separate
// audio file kept alongside so the transcript never depends on the video.
export const KEEP: { value: MeetingSettings['keep']; label: string; hint: string }[] = [
  { value: 'audio', label: 'Audio and notes', hint: 'About 30 MB per hour' },
  { value: 'video', label: 'Video, audio and notes (Beta)', hint: 'About 1 GB per hour' },
  { value: 'notes', label: 'Notes and transcript only', hint: 'Under 1 MB per hour' },
];

export function MeetingsSection({ ws, canManage, onMeetings }: { ws: Workspace; canManage: boolean; onMeetings: (m: MeetingSettings) => void }) {
  const m = ws.meetings ?? DEFAULT_MEETINGS;
  const set = (p: Partial<MeetingSettings>) => onMeetings({ ...m, ...p });
  return (
    <>
      <h2>Meetings</h2>
      <p className="set-intro">The notetaker records the whole meeting so the notes are accurate, then keeps only what you choose here. People can still change it for a single meeting.</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>What to keep</h3>
          <Row title={`${term.Who} meetings`} hint={`Meetings with a ${term.who} on the invite`}>
            <Select value={m.clientMeetings} onChange={(v) => set({ clientMeetings: v })} options={KEEP} label={`${term.Who} meetings`} width={300} />
          </Row>
          <Row title="Internal meetings" hint="Standups, team syncs">
            <Select value={m.internalMeetings} onChange={(v) => set({ internalMeetings: v })} options={KEEP} label="Internal meetings" width={300} />
          </Row>
          <div className={`fold ${m.clientMeetings === 'video' || m.internalMeetings === 'video' ? 'open' : ''}`}>
            <div className="fold-in">
              <Row title="Turn old video into audio" hint="Keeps the audio, transcript and notes; frees about 97% of the space">
                <Select
                  value={String(m.downgradeAfter)}
                  onChange={(v) => set({ downgradeAfter: Number(v) as MeetingSettings['downgradeAfter'] })}
                  label="Turn old video into audio"
                  options={[
                    { value: '30', label: 'After 30 days' },
                    { value: '60', label: 'After 60 days' },
                    { value: '90', label: 'After 90 days' },
                    { value: '0', label: 'Never' },
                  ]}
                />
              </Row>
              <p className="muted small">Video is in Beta: the picture can stutter on a busy server. The audio is saved separately, so transcripts and notes are never affected.</p>
            </div>
          </div>
        </div>
        <div className="set-block">
          <h3>Languages</h3>
          <p className="muted small">What your meetings are spoken in. The transcript only ever comes out in these, so Indonesian is never mistaken for Spanish. Pick two (say Indonesian and English) if people mix them; the first is the main one.</p>
          <LanguagePicker value={m.languages ?? []} onChange={(languages) => set({ languages })} />
          {!(m.languages?.length) && <p className="muted small">Nothing picked: the speech service guesses the language for each meeting.</p>}
        </div>
        <div className="set-block">
          <h3>Permissions</h3>
          <Row title="Who can record" hint="Who can invite the notetaker to a meeting">
            <Select
              value={m.whoCanRecord}
              onChange={(v) => set({ whoCanRecord: v })}
              label="Who can record"
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'admins', label: 'Only admins' },
              ]}
            />
          </Row>
          <Row title={`Share notes with the ${term.who} by default`} hint={`Notes from ${term.who} meetings appear in their shared space. Recordings never do unless someone shares them`}>
            <Switch on={m.shareNotesWithClient} onChange={(v) => set({ shareNotesWithClient: v })} />
          </Row>
          <p className="muted small">On each meeting you can choose who can watch or download the recording, who sees the transcript, and whether the {term.who} sees the notes.</p>
        </div>
        <div className="set-block">
          <h3>Notetaker</h3>
          {/* The server sends the notetaker by itself (server/autojoin.ts), once the recorder is there to send. */}
          <Row
            title="Join meetings from calendars automatically"
            hint={
              !server.on || caps.demo || caps.recorder
                ? 'Google Meet and Zoom calls on people’s calendars. It joins a minute before; anyone can switch it off for one meeting in Meet, Upcoming.'
                : 'The notetaker isn’t available on this server yet, so it can’t join meetings by itself. This starts working as soon as it is.'
            }
          >
            <Select value={m.joinMode ?? 'accepted'} onChange={(v) => set({ joinMode: v })} options={JOIN_MODES.map((x) => ({ value: x.value, label: x.label, hint: x.hint }))} label="Join meetings from calendars automatically" width={300} disabled={!(!server.on || caps.demo || caps.recorder)} />
          </Row>
          <Row title="Announce recording" hint="The bot says it’s recording when it joins. The host can stop it at any time">
            <Switch on={m.announce} onChange={(v) => set({ announce: v })} />
          </Row>
          <div className="set-row">
            <span>
              <strong>Bot name</strong>
            </span>
            <input className="inline-input" value={m.botName} onChange={(e) => set({ botName: e.target.value })} />
          </div>
        </div>
      </fieldset>
    </>
  );
}

/* ---------------- Teams ---------------- */

/** Teams have their own app now; Settings points there. */
export function TeamsLink({ teams, users, onOpen }: { teams: Team[]; users: User[]; onOpen: (id?: string) => void }) {
  return (
    <>
      <h2>Teams</h2>
      <p className="set-intro">Departments like Video editing or Finance. Teams have their own app in the sidebar: make teams, add people (someone can be in several), set who can join, and see each team’s work and workload.</p>
      <div className="set-block">
        {teams.map((t) => {
          const lead = users.find((u) => u.id === t.leadId);
          return (
            <Row key={t.id} title={<><span className="team-square" style={{ background: t.color }} /> {t.name}</>} hint={`${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}${lead ? ` · led by ${lead.name}` : ''}`}>
              <button type="button" className="ghost-btn sm" onClick={() => onOpen(t.id)}>
                Open
              </button>
            </Row>
          );
        })}
        <div className="set-foot">
          <button type="button" className="primary-btn sm" onClick={() => onOpen()}>
            <Users size={14} /> Open Teams
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Apps & chat ---------------- */

export function AppsSection({ ws, canManage, onWorkspace }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void }) {
  const apps = ws.apps ?? APPS.map((a) => a.id);
  const chat = { gifs: true, celebrations: true, whoCanCreate: 'everyone' as const, history: 'forever' as const, ...ws.chat };
  const toggleApp = (id: AppId) => onWorkspace({ apps: apps.includes(id) ? apps.filter((a) => a !== id) : [...apps, id] });
  return (
    <>
      <h2>Apps</h2>
      <p className="set-intro">Switch off what your company doesn’t use. Nothing is deleted; switching an app back on brings everything back.</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          {APPS.filter((a) => a.id !== 'home').map((a) => (
            <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>}>
              <Switch on={apps.includes(a.id)} onChange={() => toggleApp(a.id)} />
            </Row>
          ))}
        </div>
        <WhatsAppBlock ws={ws} canManage={canManage} />
        <div className="set-block">
          <h3>Chat</h3>
          <Row title="Celebrate finished work" hint={`A small confetti and a note in the ${term.one}’s channel when a task is done`}>
            <Switch on={chat.celebrations} onChange={(v) => onWorkspace({ chat: { ...chat, celebrations: v } })} />
          </Row>
          <Row title="Who can create channels" hint={chat.whoCanCreate === 'admins' ? 'Members can still message people directly, and teams get their own channel.' : undefined}>
            <Select value={chat.whoCanCreate} onChange={(v) => onWorkspace({ chat: { ...chat, whoCanCreate: v } })} label="Who can create channels" options={[{ value: 'everyone', label: 'Everyone' }, { value: 'admins', label: 'Only admins' }]} />
          </Row>
          <Row title="Delete old messages" hint="Coming soon: deleting messages older than a year or 90 days, for everyone. Until then chat history is kept.">
            <span className="badge-soon">Not yet</span>
          </Row>
        </div>
      </fieldset>
    </>
  );
}

/* ---------------- WhatsApp Business ---------------- */

/**
 * WhatsApp for guests: messages from a project's guests land in that project's shared channel, and the team can
 * write back from a guest's row. Needs a WhatsApp Business number on Meta's Cloud API; the token stays on the server.
 */
function WhatsAppBlock({ ws, canManage }: { ws: Workspace; canManage: boolean }) {
  const [phoneId, setPhoneId] = useState('');
  const [token, setToken] = useState('');
  const [display, setDisplay] = useState(ws.whatsapp?.displayPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const on = !!ws.whatsapp?.connected;
  const hook = `${location.origin}/api/whatsapp/webhook`;
  const connect = async () => {
    setBusy(true);
    setErr('');
    const r = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, phoneNumberId: phoneId, token, displayPhone: display }) });
    setBusy(false);
    if (!r.ok) return setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t connect.');
    setToken('');
    setOpen(false);
  };
  const disconnect = () => confirm('Disconnect WhatsApp? Messages from guests stop arriving here.') && void fetch('/api/whatsapp/connect', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id }) });
  return (
    <div className="set-block">
      <h3>WhatsApp</h3>
      <Row title="WhatsApp for guests" hint={on ? `Connected${ws.whatsapp?.displayPhone ? ` as ${ws.whatsapp.displayPhone}` : ''}. Guests’ messages land in their project’s shared channel; write back from the Guests tab.` : 'Guests message your WhatsApp Business number; it lands in their project’s shared channel. Needs a number on Meta’s Cloud API.'}>
        {on ? (
          <button type="button" className="ghost-btn sm" onClick={disconnect} disabled={!canManage}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="ghost-btn sm" onClick={() => setOpen((x) => !x)} disabled={!canManage}>
            Connect
          </button>
        )}
      </Row>
      <div className={`fold ${open && !on ? 'open' : ''}`}>
        <div className="fold-in wa-form">
          <p className="muted small">In Meta for Developers: your app, WhatsApp, API setup. Copy the phone number ID and make a permanent access token (a system user with the WhatsApp permissions).</p>
          <label className="team-field">
            <span>Phone number ID</span>
            <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="e.g. 103912345678901" />
          </label>
          <label className="team-field">
            <span>Access token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" autoComplete="off" />
          </label>
          <label className="team-field">
            <span>Shown as</span>
            <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="+62 812 0000 0000 (optional)" />
          </label>
          {err && <p className="err small">{err}</p>}
          <div className="wl-new-actions">
            <button type="button" className="primary-btn sm" disabled={busy || !phoneId.trim() || token.trim().length < 20} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
      {on && ws.whatsapp && (
        <div className="wa-hook">
          <p className="small">In Meta, under Webhooks, subscribe to <b>messages</b> with:</p>
          <div className="wl-dns">
            <span className="mono">URL</span>
            <span className="mono wa-wide">{hook}</span>
            <button type="button" className="icon-btn sm" title="Copy" onClick={() => void navigator.clipboard?.writeText(hook)}>
              <Download size={13} />
            </button>
          </div>
          <div className="wl-dns">
            <span className="mono">Verify</span>
            <span className="mono wa-wide">{ws.whatsapp.verifyToken}</span>
            <button type="button" className="icon-btn sm" title="Copy" onClick={() => void navigator.clipboard?.writeText(ws.whatsapp!.verifyToken)}>
              <Download size={13} />
            </button>
          </div>
          <p className="muted small">Guests need their WhatsApp number on their invite (Guests tab) so we know whose message it is. Numbers we don’t know go to admins as a notification.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- Your apps (per person) ---------------- */

/**
 * Each person's own sidebar: hide apps you don't use (the company keeps them). Apps the company switched off show
 * here too: admins switch them on, everyone else can ask an admin.
 */
export function MyAppsSection({ ws, hidden, isAdmin, asked, onHidden, onCompanyApp, onAsk }: { ws: Workspace; hidden: AppId[]; isAdmin: boolean; asked: AppId[]; onHidden: (list: AppId[]) => void; onCompanyApp: (id: AppId) => void; onAsk: (id: AppId) => void }) {
  const company = ws.apps ?? APPS.map((a) => a.id);
  const order = useAppOrder();
  const on = order.arranged(APPS).filter((a) => a.id !== 'home' && company.includes(a.id));
  const off = APPS.filter((a) => a.id !== 'home' && !company.includes(a.id));
  const ids: string[] = order.arranged(APPS).map((a) => a.id as string);
  const move = (id: string, d: -1 | 1) => {
    const visible: string[] = on.map((a) => a.id as string);
    const swap = visible[visible.indexOf(id) + d];
    if (!swap) return;
    const next = [...ids];
    const i = next.indexOf(id), j = next.indexOf(swap);
    [next[i], next[j]] = [next[j], next[i]];
    order.setOrder(next);
  };
  return (
    <>
      <h2>Your apps</h2>
      <p className="set-intro">Put your apps in the order you use them (or drag them in the left rail), and hide the ones you don’t. Your team still has them, and you can show them again any time.</p>
      <div className="set-block">
        {on.map((a, i) => (
          <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>} hint={hidden.includes(a.id) ? 'Hidden for you' : undefined}>
            <span className="app-order">
              <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(a.id, -1)} aria-label={`Move ${a.name} up`}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className="icon-btn sm" disabled={i === on.length - 1} onClick={() => move(a.id, 1)} aria-label={`Move ${a.name} down`}>
                <ArrowDown size={13} />
              </button>
              <Switch on={!hidden.includes(a.id)} onChange={() => onHidden(hidden.includes(a.id) ? hidden.filter((x) => x !== a.id) : [...hidden, a.id])} />
            </span>
          </Row>
        ))}
        <div className="app-order-foot">
          {order.mine && (
            <button type="button" className="link-btn small" onClick={order.reset}>
              {order.shared.defaults.rail ? 'Use the company’s order' : 'Back to the usual order'}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="link-btn small" onClick={() => order.shared.set('rail', { order: ids, hidden: [] })}>
              Make this everyone’s order
            </button>
          )}
        </div>
      </div>
      {off.length > 0 && (
        <div className="set-block">
          <h3>Off for {ws.name || 'the company'}</h3>
          <p className="muted small">{isAdmin ? 'Switch one on and it appears for everyone.' : 'An admin decides which apps the company uses. Ask, and they get a notification that takes them straight to the switch.'}</p>
          {off.map((a) => (
            <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>}>
              {isAdmin ? (
                <button className="ghost-btn sm outline" onClick={() => onCompanyApp(a.id)}>
                  Switch on for everyone
                </button>
              ) : asked.includes(a.id) ? (
                <span className="muted small">Asked</span>
              ) : (
                <button className="ghost-btn sm outline" onClick={() => onAsk(a.id)}>
                  Ask an admin
                </button>
              )}
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Security & data ---------------- */

type SecurityInfo = {
  people: { userId: string; role: string; on: boolean }[];
  required: { since: string | null; from: string; graceDays: number } | null;
  log: { at: string; type: string; userId: string | null; detail: string | null }[];
};
const GRACE = [
  { value: '0', label: 'Right away', hint: 'At their next sign-in' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
];
const longDay = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'long' });

export function SecuritySection({ ws, me, isOwner, canManage, onWorkspace, onExport, onDelete, onAccount, users, toast }: {
  ws: Workspace;
  me: string;
  isOwner: boolean;
  canManage: boolean; // owners and admins
  onWorkspace: (p: Partial<Workspace>) => void;
  onExport: () => void;
  onDelete: () => void;
  onAccount: () => void;
  users: User[];
  toast: (t: string) => void;
}) {
  const sec = { twoStep: false, google: false, microsoft: false, sso: false, ...ws.security };
  const grace = sec.graceDays ?? 7;
  const [typed, setTyped] = useState('');
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const live = server.on;
  // Requiring it needs your own on first (the server checks too), so nobody locks themselves out.
  const [mine, setMine] = useState<boolean | null>(live ? null : true);
  useEffect(() => {
    if (live && isOwner) void loadTwoStep().then((st) => setMine(!!st?.on));
  }, [live, isOwner]);
  const load = () =>
    void fetch(`/api/security?workspaceId=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<SecurityInfo>) : null))
      .then((d) => d && setInfo(d))
      .catch(() => {});
  // A switch just changed: the save goes out a moment later, then the list and the log are read again.
  useEffect(() => {
    if (!live || !canManage) return;
    const t = setTimeout(load, info ? 700 : 0);
    return () => clearTimeout(t);
  }, [ws.id, sec.twoStep, grace, live, canManage]); // eslint-disable-line react-hooks/exhaustive-deps
  // When it starts to apply: the day it was switched on (now, if it just was) plus the days people were given.
  const from = new Date(Date.parse(sec.twoStepSince ?? new Date().toISOString()) + grace * 86_400_000).toISOString();
  const biting = from <= new Date().toISOString();
  const nameOf = (id: string | null) => (id === null ? `${product.name} support` : id === me ? 'You' : users.find((u) => u.id === id)?.name ?? 'Someone who left');
  const people = (info?.people ?? [])
    .map((x) => ({ ...x, user: users.find((u) => u.id === x.userId) }))
    .filter((x): x is typeof x & { user: User } => !!x.user)
    .sort((a, b) => Number(a.on) - Number(b.on) || a.user.name.localeCompare(b.user.name));
  const missing = people.filter((x) => !x.on && x.userId !== me);
  const myRole = ws.members.find((m) => m.userId === me)?.role;
  const canReset = (x: { on: boolean; userId: string; role: string }) => x.on && x.userId !== me && !(x.role === 'owner' && myRole !== 'owner');
  const remind = () => {
    setBusy(true);
    void fetch('/api/security/remind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id }) })
      .then((r) => r.json())
      .then((d: { sent?: number; error?: string }) => (toast(d.error ?? `Reminded ${d.sent} ${d.sent === 1 ? 'person' : 'people'}`), load()))
      .finally(() => setBusy(false));
  };
  const OTHER = [
    { k: 'google', title: 'Sign in with Google', why: caps.signIn.googleApp ? 'Coming soon.' : `Coming soon. Needs a Google sign-in app set up by ${product.name}.` },
    { k: 'microsoft', title: 'Sign in with Microsoft', why: caps.signIn.microsoftApp ? 'Coming soon.' : `Coming soon. Needs a Microsoft sign-in app set up by ${product.name}.` },
    { k: 'saml', title: 'Single sign-on (SAML)', why: 'Coming soon: Okta, Azure AD or Google Workspace as your company’s sign-in.' },
  ] as const;

  return (
    <>
      <h2>Security & data</h2>
      <p className="set-intro">How people sign in to {ws.name || 'the company'}, and the company’s data.</p>
      <div className="set-block">
        <h3>Sign-in</h3>
        {canManage ? (
          <>
            <Row title="Require two-step sign-in" hint={`Everyone in the company signs in with a code from an authenticator app, not just a password.${!isOwner ? ' Only owners change this.' : !sec.twoStep && mine === false ? ' Turn it on for your own account first.' : ''}`}>
              {isOwner && !sec.twoStep && mine === false ? (
                <button type="button" className="ghost-btn outline sm" onClick={onAccount}>
                  Turn yours on
                </button>
              ) : (
                <Switch on={sec.twoStep} disabled={!isOwner || mine === null} onChange={(v) => onWorkspace({ security: { ...sec, twoStep: v, graceDays: grace } })} />
              )}
            </Row>
            <div className={`fold ${sec.twoStep ? 'open' : ''}`}>
              <div className="fold-in">
                <Row title="Time to set it up" hint={sec.twoStep ? (biting ? 'It applies now: anyone without it sets it up before they can go on.' : `From ${longDay(from)}, anyone without it sets it up at sign-in before they can go on. They got a notification.`) : undefined}>
                  <Select value={String(grace)} disabled={!isOwner} onChange={(v) => onWorkspace({ security: { ...sec, graceDays: Number(v) } })} label="Time to set it up" options={GRACE} width={200} />
                </Row>
              </div>
            </div>
            {OTHER.map((o) => (
              <Row key={o.k} title={o.title} hint={o.why}>
                <span className="badge-soon">Not yet</span>
              </Row>
            ))}
          </>
        ) : (
          <Row title="Two-step sign-in" hint={sec.twoStep ? `${ws.name} requires a code from an authenticator app when you sign in${biting ? '.' : `, from ${longDay(from)}.`}` : 'A code from an authenticator app when you sign in. Turn it on for your own account.'}>
            <button type="button" className="ghost-btn outline sm" onClick={onAccount}>
              Your settings
            </button>
          </Row>
        )}
      </div>

      {canManage && live && (
        <div className="set-block">
          <h3>Two-step sign-in by person</h3>
          {!info ? (
            <p className="muted small">Loading…</p>
          ) : (
            <>
              {missing.length > 0 && (
                <div className="ts-remind">
                  <span>{missing.length === 1 ? `${missing[0].user.name.split(' ')[0]} hasn’t turned it on yet.` : `${missing.length} people haven’t turned it on yet.`}</span>
                  <button type="button" className="ghost-btn outline sm" disabled={busy} onClick={remind}>
                    {busy ? 'Sending…' : 'Send a reminder'}
                  </button>
                </div>
              )}
              <div className={`ts-people ${people.some(canReset) ? 'has-actions' : ''}`}>
                {people.map((x) => {
                  return (
                    <div key={x.userId} className="pa-row ts-person">
                      <Avatar person={x.user} size={24} />
                      <span className="pa-title">
                        {x.user.name}
                        {x.userId === me && <span className="you-tag">You</span>}
                      </span>
                      <span className={`acct-status ${x.on ? 'ok' : ''}`}>{x.on ? 'On' : 'Not yet'}</span>
                      <span className="ts-person-act">
                        {canReset(x) && (
                          <button type="button" className="ghost-btn sm" onClick={() => setResetting(x.user)}>
                            Reset
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="muted small">Someone lost their phone and their backup codes? Reset theirs: they sign in with just their password, then set it up again{sec.twoStep ? '' : ' if they want'}.</p>
            </>
          )}
        </div>
      )}

      {canManage && (
        <div className="set-block">
          <h3>
            <ShieldCheck size={15} /> Security log
          </h3>
          {!live ? (
            DEMO_LOG.map(([who, what, when], i) => (
              <div key={i} className="pa-row">
                {users.find((u) => u.name.startsWith(who)) && <Avatar person={users.find((u) => u.name.startsWith(who))!} size={20} />}
                <span className="pa-title">
                  <b>{who}</b>&nbsp;{what}
                </span>
                <span className="muted small">{when}</span>
              </div>
            ))
          ) : !info ? (
            <p className="muted small">Loading…</p>
          ) : info.log.length === 0 ? (
            <p className="muted small">Nothing yet. Changes to the sign-in rules and to people’s two-step sign-in show up here.</p>
          ) : (
            info.log.map((e, i) => {
              const u = e.userId ? users.find((x) => x.id === e.userId) : undefined;
              return (
                <div key={i} className="pa-row ts-log">
                  {u && <Avatar person={u} size={20} />}
                  <span className="pa-title">
                    <b>{nameOf(e.userId)}</b>&nbsp;{e.detail}
                  </span>
                  <span className="muted small">{relative(e.at)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="set-block">
        <h3>Your data</h3>
        <Row title={<><Download size={14} /> Export everything</>} hint={`Mail, chat, tasks, ${term.many}, calendars and file lists as one download. Always free, on every plan`}>
          <button type="button" className="ghost-btn sm" onClick={onExport}>
            <HardDrive size={14} /> Download
          </button>
        </Row>
        {isOwner && (
          <div className="danger-zone">
            <strong>Delete {ws.name}</strong>
            <small>Removes the company and everything in it for everyone. Type the company name to confirm.</small>
            <div className="add-prov inline">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={ws.name} />
              <button type="button" className="danger-btn sm" disabled={typed !== ws.name} onClick={onDelete}>
                Delete company
              </button>
            </div>
          </div>
        )}
      </div>
      {resetting && (
        <ResetTwoStep
          person={resetting}
          required={sec.twoStep}
          onClose={() => setResetting(null)}
          onReset={async () => {
            const r = await fetch('/api/security/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, userId: resetting.id }) });
            const d = (await r.json().catch(() => ({}))) as { error?: string };
            if (!r.ok) throw new Error(d.error ?? 'Couldn’t reset it.');
            toast(`Two-step sign-in reset for ${resetting.name.split(' ')[0]}`);
            setResetting(null);
            load();
          }}
        />
      )}
    </>
  );
}

/** The demo's sample log (no server: nothing has really happened). */
const DEMO_LOG = [
  ['Aqeel', 'changed the AI setup to Balanced', '2 hours ago'],
  ['Faisal', 'added an Anthropic key', '3 days ago'],
  ['Aqeel', 'invited Nadia Putri as a guest in #kopikita', '2 weeks ago'],
  ['Dewi', 'downloaded the September invoice', '1 month ago'],
];

/** Confirming a reset: what happens to them, and a nudge to be sure it's really them asking. */
function ResetTwoStep({ person, required, onClose, onReset }: { person: User; required: boolean; onClose: () => void; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = person.name.split(' ')[0];
  return createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal ts-modal sm" role="dialog" aria-label={`Reset two-step sign-in for ${person.name}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <ShieldCheck size={15} /> Reset two-step sign-in
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <p className="ts-text">
            {first} is signed out everywhere and signs in next time with just their password{required ? ', then sets two-step sign-in up again, since the company requires it' : ''}. They get an email about it.
          </p>
          <p className="muted small">Only do this when you’re sure it’s {first} asking, for example on a call or in person.</p>
          {error && <p className="err small">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn danger-btn" disabled={busy} onClick={() => (setBusy(true), setError(''), void onReset().catch((e: Error) => (setError(e.message), setBusy(false))))}>
            {busy ? 'Resetting…' : `Reset for ${first}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
