import { LanguagePicker } from '../LanguagePicker';
import { useState } from 'react';
import { term } from '../../terms';
import { ArrowDown, ArrowUp, Cloud, Download, FileText, HardDrive, Lock, Plus, ShieldCheck, Trash2, Video, X } from 'lucide-react';
import type { AppId, DriveItem, HomeTemplateId, MeetingSettings, Plan, StorageSettings, Team, User, Workspace } from '../../types';
import { fmtSize } from '../../data/drive';
import { storageGB, rp } from '../../data/pricing';
import { DEFAULT_MEETINGS } from '../../data/workspaces';
import { APPS, useAppOrder } from '../AppRail';
import { HOME_TEMPLATES } from '../HomeView';
import { Avatar } from '../Avatar';
import { Select } from '../ui/Select';

const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
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

/* ---------------- Storage ---------------- */

export function StorageSection({ ws, people, plan, drive, users, byChannel, canManage, onStorage, onBilling, toast }: {
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
  const pool = storageGB(plan, people) * 1024 ** 3;
  const files = drive.filter((d) => !d.trashed && d.kind !== 'folder');
  const sum = (list: DriveItem[]) => list.reduce((s, d) => s + d.size, 0);
  const parts = [
    { name: 'Mail', size: 1.3 * 1024 ** 3 * Math.max(1, people / 3), color: 'var(--accent)' },
    { name: 'Files', size: sum(files.filter((d) => !d.channelId && d.kind !== 'video' && d.kind !== 'audio')), color: '#10b981' },
    { name: 'Videos', size: sum(files.filter((d) => d.kind === 'video')), color: '#f97316' },
    { name: 'Chat files', size: sum(files.filter((d) => d.channelId)), color: '#8b5cf6' },
    { name: 'Meeting recordings', size: 3 * 1.1 * 1024 ** 3, color: '#ec4899' },
  ];
  const used = parts.reduce((s, x) => s + x.size, 0);
  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  const [connecting, setConnecting] = useState<'gdrive' | 'dropbox' | 'b2' | null>(null);
  const [acct, setAcct] = useState('');
  const pct = (n: number) => `${Math.max(0.5, (n / pool) * 100)}%`;
  const OWN = { gdrive: 'Google Drive', dropbox: 'Dropbox', b2: 'Backblaze B2' } as const;

  return (
    <>
      <h2>Storage</h2>
      <p className="set-intro">
        {fmtSize(used)} of {fmtSize(pool)} used, shared by the whole company. A heavy video editor uses the team’s pool, not their own.
      </p>
      <div className="stack-bar">
        {parts.map((x) => (
          <span key={x.name} style={{ width: pct(x.size), background: x.color }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((x) => (
          <span key={x.name}>
            <i style={{ background: x.color }} /> {x.name} · {fmtSize(x.size)}
          </span>
        ))}
      </div>
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
          <h3>Use your own storage for big files</h3>
          <p className="muted small">Raw footage and huge files can live in your own cloud. They still show on the {term.one} page, but they don’t use Sprint2go storage.</p>
          {st.own ? (
            <Row title={<><Cloud size={14} /> {OWN[st.own.provider]} · {st.own.account}</>} hint={`Files over ${st.own.forFilesOver >= 1000 ? `${st.own.forFilesOver / 1000} GB` : `${st.own.forFilesOver} MB`} are saved there`}>
              <button type="button" className="ghost-btn sm" onClick={() => (onStorage({ ...st, own: undefined }), toast('Disconnected. Files already there stay there'))}>
                Disconnect
              </button>
            </Row>
          ) : connecting ? (
            <div className="add-prov">
              <input autoFocus value={acct} onChange={(e) => setAcct(e.target.value)} placeholder={connecting === 'b2' ? 'Bucket name' : 'Account email'} />
              <div className="add-prov-foot">
                <button type="button" className="ghost-btn sm" onClick={() => setConnecting(null)}>
                  Cancel
                </button>
                <button type="button" className="primary-btn sm" disabled={!acct.trim()} onClick={() => (onStorage({ ...st, own: { provider: connecting, account: acct.trim(), forFilesOver: 1000 } }), setConnecting(null), toast(`${OWN[connecting]} connected`))}>
                  Connect {OWN[connecting]}
                </button>
              </div>
            </div>
          ) : (
            <div className="chip-pick">
              {(Object.keys(OWN) as (keyof typeof OWN)[]).map((k) => (
                <button key={k} type="button" onClick={() => setConnecting(k)}>
                  <Cloud size={13} /> {OWN[k]}
                </button>
              ))}
            </div>
          )}
          <Row title="Ask before saving big files here" hint="Uploading something bigger shows: save to your own cloud, keep it here, or cancel">
            <Select
              value={String(st.askOver)}
              onChange={(v) => onStorage({ ...st, askOver: Number(v) as StorageSettings['askOver'] })}
              label="Ask over"
              options={[
                { value: '200', label: 'Over 200 MB' },
                { value: '500', label: 'Over 500 MB' },
                { value: '1000', label: 'Over 1 GB' },
                { value: '0', label: 'Never ask' },
              ]}
            />
          </Row>
        </div>
      </fieldset>

      <div className="set-block">
        <h3>Biggest files</h3>
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
        {users.slice(0, 6).map((u, i) => (
          <div key={u.id} className="pa-row">
            <Avatar person={u} size={22} />
            <span className="pa-title">{u.name}</span>
            <span className="muted small">{fmtSize((1.3 + ((i * 7) % 5) * 2.1) * 1024 ** 3)}</span>
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
          <Row title="Join meetings from calendars automatically" hint="From Google, Outlook and Sprint2go calendars">
            <Switch on={m.autoJoin} onChange={(v) => set({ autoJoin: v })} />
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

export function TeamsSection({ ws, teams, users, canManage, onTeams, onTeamHome, toast }: {
  ws: Workspace;
  teams: Team[];
  users: User[];
  canManage: boolean;
  onTeams: (t: Team[]) => void;
  onTeamHome: (teamId: string, t: HomeTemplateId) => void;
  toast: (t: string) => void;
}) {
  const [name, setName] = useState('');
  const colors = ['#0ea5e9', '#10b981', '#f97316', '#8b5cf6', '#d946ef', '#ef4444', '#f59e0b'];
  const patch = (id: string, p: Partial<Team>) => onTeams(teams.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = () => {
    if (!name.trim()) return;
    onTeams([...teams, { id: 't-' + Date.now().toString(36), workspaceId: ws.id, name: name.trim(), color: colors[teams.length % colors.length], members: [], keywords: [] }]);
    setName('');
    toast(`${name.trim()} added`);
  };
  return (
    <>
      <h2>Teams</h2>
      <p className="set-intro">Departments like Video editing or Finance. Tasks belong to a {term.one} and a team, so you can see work both ways. Each team’s Home template is the default for its people.</p>
      <fieldset className="plain" disabled={!canManage}>
        {teams.map((t) => (
          <div key={t.id} className="team-card">
            <div className="tc-head">
              <span className="team-square big" style={{ background: t.color }} />
              <input className="inline-input strong" value={t.name} onChange={(e) => patch(t.id, { name: e.target.value })} />
              <button type="button" className="icon-btn sm" title="Delete team" onClick={() => (onTeams(teams.filter((x) => x.id !== t.id)), toast(`${t.name} deleted. Its tasks keep their ${term.many}`))}>
                <Trash2 size={15} />
              </button>
            </div>
            <div className="tc-fields">
              <label>Lead</label>
              <Select value={t.leadId ?? ''} onChange={(v) => patch(t.id, { leadId: v || undefined, members: v && !t.members.includes(v) ? [...t.members, v] : t.members })} label="Lead" options={[{ value: '', label: 'No lead' }, ...users.map((u) => ({ value: u.id, label: u.name, icon: <Avatar person={u} size={20} /> }))]} />
              <label>People</label>
              <div className="tc-members">
                {t.members.map((id) => {
                  const u = users.find((x) => x.id === id);
                  return (
                    u && (
                      <span key={id} className="member-chip">
                        <Avatar person={u} size={18} /> {u.name.split(' ')[0]}
                        <button type="button" onClick={() => patch(t.id, { members: t.members.filter((x) => x !== id) })} aria-label={`Remove ${u.name}`}>
                          <X size={12} />
                        </button>
                      </span>
                    )
                  );
                })}
                <Select value={null} onChange={(v) => patch(t.id, { members: [...t.members, v] })} placeholder="Add" label="Add person" className="sel-flat" options={users.filter((u) => !t.members.includes(u.id)).map((u) => ({ value: u.id, label: u.name, icon: <Avatar person={u} size={20} /> }))} />
              </div>
              <label>Home</label>
              <Select<HomeTemplateId> value={ws.teamHome?.[t.id] ?? null} onChange={(v) => onTeamHome(t.id, v)} placeholder="Guess from role" label="Default Home" options={(Object.keys(HOME_TEMPLATES) as HomeTemplateId[]).map((k) => ({ value: k, label: HOME_TEMPLATES[k].name, hint: HOME_TEMPLATES[k].hint }))} />
              <label>Review</label>
              <label className="check-row small">
                <input type="checkbox" checked={!!t.review} onChange={(e) => patch(t.id, { review: e.target.checked })} /> Finished tasks wait for the supervisor before they count as done
              </label>
              <label>Keywords</label>
              <input className="inline-input" value={(t.keywords ?? []).join(', ')} onChange={(e) => patch(t.id, { keywords: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} placeholder="video, reel, edit (the brain dump uses these)" />
            </div>
          </div>
        ))}
        <div className="add-prov inline">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="New team, e.g. Copywriting" />
          <button type="button" className="ghost-btn sm" onClick={add} disabled={!name.trim()}>
            <Plus size={14} /> Add team
          </button>
        </div>
      </fieldset>
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
        <div className="set-block">
          <h3>Chat</h3>
          <Row title="GIFs and stickers" hint="Off for a more formal workspace">
            <Switch on={chat.gifs} onChange={(v) => onWorkspace({ chat: { ...chat, gifs: v } })} />
          </Row>
          <Row title="Celebrate finished work" hint={`A small confetti and a note in the ${term.one}’s channel when a task is done`}>
            <Switch on={chat.celebrations} onChange={(v) => onWorkspace({ chat: { ...chat, celebrations: v } })} />
          </Row>
          <Row title="Who can create channels">
            <Select value={chat.whoCanCreate} onChange={(v) => onWorkspace({ chat: { ...chat, whoCanCreate: v } })} label="Who can create channels" options={[{ value: 'everyone', label: 'Everyone' }, { value: 'admins', label: 'Only admins' }]} />
          </Row>
          <Row title="Keep chat history" hint="Older messages are deleted for everyone">
            <Select value={chat.history} onChange={(v) => onWorkspace({ chat: { ...chat, history: v } })} label="Keep chat history" options={[{ value: 'forever', label: 'Forever' }, { value: '1y', label: '1 year' }, { value: '90d', label: '90 days' }]} />
          </Row>
        </div>
      </fieldset>
    </>
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

export function SecuritySection({ ws, isOwner, onWorkspace, onExport, onDelete, users }: {
  ws: Workspace;
  isOwner: boolean;
  onWorkspace: (p: Partial<Workspace>) => void;
  onExport: () => void;
  onDelete: () => void;
  users: User[];
}) {
  const sec = ws.security ?? { twoStep: false, google: true, microsoft: true, sso: false };
  const [typed, setTyped] = useState('');
  const business = ws.plan?.tier === 'business';
  const audit = [
    ['Aqeel', 'changed the AI setup to Balanced', '2 hours ago'],
    ['Faisal', 'added an Anthropic key', '3 days ago'],
    ['Aqeel', 'invited Nadia Putri as a guest in #kopikita', '2 weeks ago'],
    ['Dewi', 'downloaded the September invoice', '1 month ago'],
  ];
  return (
    <>
      <h2>Security & data</h2>
      <fieldset className="plain" disabled={!isOwner}>
        <div className="set-block">
          <h3>Sign-in</h3>
          <Row title="Require two-step sign-in" hint="Everyone in the company confirms sign-ins with an app or passkey">
            <Switch on={sec.twoStep} onChange={(v) => onWorkspace({ security: { ...sec, twoStep: v } })} />
          </Row>
          <Row title="Sign in with Google">
            <Switch on={sec.google} onChange={(v) => onWorkspace({ security: { ...sec, google: v } })} />
          </Row>
          <Row title="Sign in with Microsoft">
            <Switch on={sec.microsoft} onChange={(v) => onWorkspace({ security: { ...sec, microsoft: v } })} />
          </Row>
          <Row title={<><Lock size={14} /> Single sign-on (SAML)</>} hint={business ? 'Okta, Azure AD, Google Workspace' : 'Included in Business'}>
            <Switch on={sec.sso && business} onChange={(v) => business && onWorkspace({ security: { ...sec, sso: v } })} />
          </Row>
        </div>
        <div className="set-block">
          <h3>
            <ShieldCheck size={15} /> Audit log {business ? '' : <span className="muted small">· full log in Business</span>}
          </h3>
          {audit.map(([who, what, when], i) => (
            <div key={i} className="pa-row">
              {users.find((u) => u.name.startsWith(who)) && <Avatar person={users.find((u) => u.name.startsWith(who))!} size={20} />}
              <span className="pa-title">
                <b>{who}</b>&nbsp;{what}
              </span>
              <span className="muted small">{when}</span>
            </div>
          ))}
        </div>
      </fieldset>
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
    </>
  );
}

