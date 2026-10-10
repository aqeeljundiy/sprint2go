import { LanguagePicker } from '../LanguagePicker';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { term, brand as product } from '../../terms';
import { AlertTriangle, ArrowDown, ArrowUp, Cloud, Copy, Download, FileText, HardDrive, Plus, ShieldCheck, Users, Video, X } from 'lucide-react';
import { DEFAULT_PERMISSIONS, type MemberPermissions } from '../../types';
import type { AppId, DriveItem, MeetingSettings, Plan, StorageSettings, Team, User, Workspace } from '../../types';
import { fmtSize } from '../../data/drive';
import { storageGB, rp } from '../../data/pricing';
import { DEFAULT_MEETINGS } from '../../data/workspaces';
import { APPS, useAppOrder } from '../AppRail';
import { Avatar } from '../Avatar';
import { Badge, PersonCell } from '../ui/Person';
import { Select, type Option } from '../ui/Select';
import { ChoiceRow, ChoiceSheet, EditScreen, GField, GRow, Group, TextRow } from '../ui/Grouped';
import { PushScreen } from '../ui/PushScreen';
import { usePhone } from '../../mobile/media';
import { languagesLabel } from '../../data/languages';
import { server } from '../../sync';
import { caps } from '../../caps';
import { relative } from '../../utils';
import { loadTwoStep } from '../TwoStep';
import { JOIN_MODES } from '../../meetingLinks';
import { isSandbox } from '../../sandbox';
import { mark, t, tn, tx } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtDate, fmtNumber, fmtPercent, fmtWeekdayLong } from '../../i18n/format';

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

/**
 * A choice in a settings row. Phones (iOS Settings): the label and its hint on the left, the current choice on the right
 * with a chevron, and a sheet with a tick. Desktop: the dropdown beside the label.
 */
function PickRow<V extends string>({ title, hint, value, options, onChange, label, disabled, width }: { title: React.ReactNode; hint?: string; value: V; options: Option<V>[]; onChange: (v: V) => void; label: string; disabled?: boolean; width?: number }) {
  const phone = usePhone();
  if (phone) return <ChoiceRow<V> label={title} title={label} sub={hint} value={value} options={options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} onChange={onChange} disabled={disabled} />;
  return (
    <Row title={title} hint={hint}>
      <Select<V> value={value} onChange={onChange} options={options} label={label} width={width} disabled={disabled} />
    </Row>
  );
}

/* ---------------- What Members can do ---------------- */

export function PermissionsSection({ ws, canManage, onWorkspace }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void }) {
  const p = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  const set = (k: keyof MemberPermissions, v: boolean) => onWorkspace({ permissions: { ...ws.permissions, [k]: v } });
  const rows: { k: keyof MemberPermissions; title: string; hint: string }[] = [
    { k: 'createProjects', title: t('Start new {projects}', { projects: term.many }), hint: t('They become the {project}’s Lead', { project: term.one }) },
    { k: 'seeAllProjects', title: t('See every {project}', { project: term.one }), hint: t('Off: only the {projects} they’re on', { projects: term.many }) },
    { k: 'inviteGuests', title: t('Invite guests'), hint: t('Bring a {who}’s people into a {project}. Its Lead always can.', { who: term.who, project: term.one }) },
    { k: 'editTables', title: t('Change how tables work'), hint: t('Columns, views and automations. Adding and editing rows is always allowed.') },
    { k: 'createTeams', title: t('Create teams'), hint: t('They lead the team they make') },
    { k: 'deleteThings', title: t('Delete things'), hint: t('{Projects}, tables and channels, and other people’s notes and files. Their own are always theirs to delete.', { projects: term.many }) },
    { k: 'seeBilling', title: t('See plan, billing and AI usage'), hint: t('What the company pays and what the AI costs') },
  ];
  return (
    <>
      <h2>{t('Permissions')}</h2>
      <p className="set-intro">{t('Owners and admins can do everything. These switches decide what people with the Member role can do. A {project}’s Lead can always manage that {project}: its people, guests and settings.', { project: term.one })}</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>{t('What Members can do')}</h3>
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
  const phone = usePhone();
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
        { name: t('Files'), size: Math.max(0, (room?.used ?? 0) - (room?.video ?? 0) - mailBytes), color: '#10b981' },
        { name: t('Videos'), size: room?.video ?? 0, color: '#f97316' },
        { name: t('Email attachments'), size: mailBytes, color: '#8b5cf6' },
      ]
    : [
        { name: t('Mail'), size: 1.3 * 1024 ** 3 * Math.max(1, people / 3), color: 'var(--accent)' },
        { name: t('Files'), size: sum(files.filter((d) => !d.channelId && d.kind !== 'video' && d.kind !== 'audio')), color: '#10b981' },
        { name: t('Videos'), size: sum(files.filter((d) => d.kind === 'video')), color: '#f97316' },
        { name: t('Chat files'), size: sum(files.filter((d) => d.channelId)), color: '#8b5cf6' },
        { name: t('Meeting recordings'), size: 3 * 1.1 * 1024 ** 3, color: '#ec4899' },
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
      <h2>{t('Storage')}</h2>
      <p className="set-intro">
        {live && !room
          ? t('Adding up what your files take…')
          : plan.unlimited
            ? t('{used} used. Unlimited has no storage limit of its own: {left} free on the server right now, shared by the whole company.', { used: fmtSize(used), left: fmtSize(Math.max(0, pool - used)) })
            : t('{used} of {total} used, shared by the whole company. A heavy video editor uses the team’s pool, not their own.', { used: fmtSize(used), total: fmtSize(pool) })}
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
      {live && <p className="muted small">{t('Counts files uploaded to Drive, chat, tables and the shared spaces, and email attachments. The text of emails and meeting recordings aren’t counted.')}</p>}
      {used / pool > 0.8 && !plan.unlimited && (
        <p className="trial-note">
          {tj('You’ve used {percent}. Add 50 GB for {price} a month, or {plans}.', {
            percent: fmtPercent(used / pool),
            price: rp(39_000),
            plans: (
              <button className="link-btn" onClick={onBilling}>
                {t('see plans')}
              </button>
            ),
          })}
        </p>
      )}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>{t('Big files')}</h3>
          <PickRow
            title={t('Ask before saving big files')}
            hint={t('Anyone uploading something bigger is asked first, with its size and the storage the company has left.')}
            value={String(st.askOver)}
            onChange={(v) => onStorage({ ...st, askOver: Number(v) as StorageSettings['askOver'] })}
            label={t('Ask before saving big files')}
            options={[
              { value: '200', label: t('Over {size}', { size: '200 MB' }) },
              { value: '500', label: t('Over {size}', { size: '500 MB' }) },
              { value: '1000', label: t('Over {size}', { size: '1 GB' }) },
              { value: '0', label: t('Never ask') },
            ]}
          />
          {live && caps.maxUploadMb > 0 && <p className="muted small">{t('One file can be up to {size}.', { size: caps.maxUploadMb >= 1024 ? `${fmtNumber(caps.maxUploadMb / 1024, { maximumFractionDigits: 1 })} GB` : `${fmtNumber(caps.maxUploadMb)} MB` })}</p>}
          <Row title={<><Cloud size={14} /> {t('Use your own storage')}</>} hint={t('Coming soon: raw footage and huge files kept in your own Google Drive, Dropbox or Backblaze B2, still showing on the {project} page. Until then everything is saved in {product}.', { project: term.one, product: product.name })}>
            <Badge>{tx('feature', 'Not yet')}</Badge>
          </Row>
        </div>
      </fieldset>

      {phone ? (
        <div className="set-rows">
          <Group title={t('Biggest files')}>
            {biggest.length === 0 ? <GRow label={t('No files in Drive yet.')} /> : biggest.map((f) => <GRow key={f.id} icon={f.kind === 'video' ? Video : FileText} plainIcon label={f.name} value={fmtSize(f.size)} />)}
          </Group>
          <Group title={t('By channel')}>
            {byChannel.length === 0 ? <GRow label={t('No files shared in chat yet.')} /> : byChannel.map((c) => <GRow key={c.name} label={`# ${c.name}`} value={fmtSize(c.size)} />)}
          </Group>
          <Group title={t('By person')}>
            {byPerson.length === 0 ? <GRow label={live && room ? t('Nobody has uploaded anything yet.') : t('Adding up what your files take…')} /> : byPerson.map(({ user: u, bytes }) => <GRow key={u.id} pic={<Avatar person={u} size={32} />} label={u.name} value={fmtSize(bytes)} />)}
          </Group>
        </div>
      ) : (
      <>
      <div className="set-block">
        <h3>{t('Biggest files')}</h3>
        {biggest.length === 0 && <p className="muted small">{t('No files in Drive yet.')}</p>}
        {biggest.map((f) => (
          <div key={f.id} className="pa-row">
            <span className="cf-icon">{f.kind === 'video' ? <Video size={15} /> : <FileText size={15} />}</span>
            <span className="pa-title">{f.name}</span>
            <span className="muted small">{fmtSize(f.size)}</span>
          </div>
        ))}
      </div>
      <div className="set-block">
        <h3>{t('By channel')}</h3>
        {byChannel.length === 0 && <p className="muted small">{t('No files shared in chat yet.')}</p>}
        {byChannel.map((c) => (
          <div key={c.name} className="pa-row">
            <span className="pa-title"># {c.name}</span>
            <span className="muted small">{fmtSize(c.size)}</span>
          </div>
        ))}
      </div>
      <div className="set-block">
        <h3>{t('By person')}</h3>
        {live && room && byPerson.length === 0 && <p className="muted small">{t('Nobody has uploaded anything yet.')}</p>}
        {byPerson.map(({ user: u, bytes }) => (
          <div key={u.id} className="pa-row">
            <PersonCell person={u} sub={null} size={24} />
            <span className="muted small">{fmtSize(bytes)}</span>
          </div>
        ))}
      </div>
      </>
      )}
    </>
  );
}

/* ---------------- Meetings ---------------- */

// Audio is the default and the most reliable; video (Beta) also saves cameras and screen shares, with a separate
// audio file kept alongside so the transcript never depends on the video.
// Getters, so the words are read in the person's language each time (docs/i18n.md).
export const KEEP: { value: MeetingSettings['keep']; readonly label: string; readonly hint: string }[] = [
  {
    value: 'audio',
    get label() {
      return t('Audio and notes');
    },
    get hint() {
      return t('About {size} per hour', { size: '30 MB' });
    },
  },
  {
    value: 'video',
    get label() {
      return t('Video, audio and notes (Beta)');
    },
    get hint() {
      return t('About {size} per hour', { size: '1 GB' });
    },
  },
  {
    value: 'notes',
    get label() {
      return t('Notes and transcript only');
    },
    get hint() {
      return t('Under {size} per hour', { size: '1 MB' });
    },
  },
];

export function MeetingsSection({ ws, canManage, onMeetings }: { ws: Workspace; canManage: boolean; onMeetings: (m: MeetingSettings) => void }) {
  const m = ws.meetings ?? DEFAULT_MEETINGS;
  const set = (p: Partial<MeetingSettings>) => onMeetings({ ...m, ...p });
  const phone = usePhone();
  const [langs, setLangs] = useState(false);
  return (
    <>
      <h2>{t('Meetings')}</h2>
      <p className="set-intro">{t('The notetaker records the whole meeting so the notes are accurate, then keeps only what you choose here. People can still change it for a single meeting.')}</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>{t('What to keep')}</h3>
          <PickRow title={t('{Who} meetings', { who: term.who })} hint={t('Meetings with a {who} on the invite', { who: term.who })} value={m.clientMeetings} onChange={(v) => set({ clientMeetings: v })} options={KEEP} label={t('{Who} meetings', { who: term.who })} width={300} />
          <PickRow title={t('Internal meetings')} hint={t('Standups, team syncs')} value={m.internalMeetings} onChange={(v) => set({ internalMeetings: v })} options={KEEP} label={t('Internal meetings')} width={300} />
          <div className={`fold ${m.clientMeetings === 'video' || m.internalMeetings === 'video' ? 'open' : ''}`}>
            <div className="fold-in">
              <PickRow
                title={t('Turn old video into audio')}
                hint={t('Keeps the audio, transcript and notes; frees about 97% of the space')}
                value={String(m.downgradeAfter)}
                onChange={(v) => set({ downgradeAfter: Number(v) as MeetingSettings['downgradeAfter'] })}
                label={t('Turn old video into audio')}
                options={[
                  { value: '30', label: t('After {n} days', { n: 30 }) },
                  { value: '60', label: t('After {n} days', { n: 60 }) },
                  { value: '90', label: t('After {n} days', { n: 90 }) },
                  { value: '0', label: t('Never') },
                ]}
              />
              <p className="muted small">{t('Video is in Beta: the picture can stutter on a busy server. The audio is saved separately, so transcripts and notes are never affected.')}</p>
            </div>
          </div>
        </div>
        {phone ? (
          <div className="set-rows">
            <Group title={t('Languages')} footer={t('What your meetings are spoken in. The transcript only ever comes out in these, so Indonesian is never mistaken for Spanish. Pick two (say Indonesian and English) if people mix them; the first is the main one.')}>
              <GRow label={t('Meeting languages')} value={m.languages?.length ? languagesLabel(m.languages) : t('Guessed')} onClick={canManage ? () => setLangs(true) : undefined} />
            </Group>
          </div>
        ) : (
        <div className="set-block">
          <h3>{t('Languages')}</h3>
          <p className="muted small">{t('What your meetings are spoken in. The transcript only ever comes out in these, so Indonesian is never mistaken for Spanish. Pick two (say Indonesian and English) if people mix them; the first is the main one.')}</p>
          <LanguagePicker value={m.languages ?? []} onChange={(languages) => set({ languages })} />
          {!(m.languages?.length) && <p className="muted small">{t('Nothing picked: the speech service guesses the language for each meeting.')}</p>}
        </div>
        )}
        <div className="set-block">
          <h3>{t('Permissions')}</h3>
          <PickRow
            title={t('Who can record')}
            hint={t('Who can invite the notetaker to a meeting')}
            value={m.whoCanRecord}
            onChange={(v) => set({ whoCanRecord: v })}
            label={t('Who can record')}
            options={[
              { value: 'everyone', label: t('Everyone') },
              { value: 'admins', label: t('Only admins') },
            ]}
          />
          <Row title={t('Share notes with the {who} by default', { who: term.who })} hint={t('Notes from {who} meetings appear in their shared space. Recordings never do unless someone shares them', { who: term.who })}>
            <Switch on={m.shareNotesWithClient} onChange={(v) => set({ shareNotesWithClient: v })} />
          </Row>
          <p className="muted small">{t('On each meeting you can choose who can watch or download the recording, who sees the transcript, and whether the {who} sees the notes.', { who: term.who })}</p>
        </div>
        <div className="set-block">
          <h3>{t('Notetaker')}</h3>
          {/* The server sends the notetaker by itself (server/autojoin.ts), once the recorder is there to send. */}
          {/* JOIN_MODES' words belong to Meet (src/meetingLinks.ts): translated where they're shown. */}
          <PickRow
            title={t('Join meetings from calendars automatically')}
            hint={
              !server.on || caps.demo || caps.recorder
                ? t('Google Meet and Zoom calls on people’s calendars. It joins a minute before; anyone can switch it off for one meeting in Meet, Upcoming.')
                : t('The notetaker isn’t available on this server yet, so it can’t join meetings by itself. This starts working as soon as it is.')
            }
            value={m.joinMode ?? 'accepted'}
            onChange={(v) => set({ joinMode: v })}
            options={JOIN_MODES.map((x) => ({ value: x.value, label: t(x.label), hint: t(x.hint) }))}
            label={t('Join meetings from calendars automatically')}
            width={300}
            disabled={!(!server.on || caps.demo || caps.recorder)}
          />
          <Row title={t('Announce recording')} hint={t('The bot says it’s recording when it joins. The host can stop it at any time')}>
            <Switch on={m.announce} onChange={(v) => set({ announce: v })} />
          </Row>
          {phone ? (
            <TextRow label={t('Bot name')} value={m.botName} allowEmpty={false} disabled={!canManage} footer={t('The name people see when the notetaker joins.')} onSave={(v) => set({ botName: v })} />
          ) : (
          <div className="set-row">
            <span>
              <strong>{t('Bot name')}</strong>
            </span>
            <input className="inline-input" value={m.botName} onChange={(e) => set({ botName: e.target.value })} />
          </div>
          )}
        </div>
      </fieldset>
      {langs && (
        <PushScreen title={t('Meeting languages')} onBack={() => setLangs(false)} className="g-page g-edit">
          <div className="g-body set-langs">
            <LanguagePicker value={m.languages ?? []} onChange={(languages) => set({ languages })} />
            <p className="g-foot">{m.languages?.length ? t('What your meetings are spoken in. The transcript only ever comes out in these, so Indonesian is never mistaken for Spanish. Pick two (say Indonesian and English) if people mix them; the first is the main one.') : t('Nothing picked: the speech service guesses the language for each meeting.')}</p>
          </div>
        </PushScreen>
      )}
    </>
  );
}

/* ---------------- Teams ---------------- */

/** Teams have their own app now; Settings points there. */
export function TeamsLink({ teams, users, onOpen }: { teams: Team[]; users: User[]; onOpen: (id?: string) => void }) {
  const phone = usePhone();
  return (
    <>
      <h2>{t('Teams')}</h2>
      <p className="set-intro">{t('Departments like Video editing or Finance. Teams have their own app in the sidebar: make teams, add people (someone can be in several), set who can join, and see each team’s work and workload.')}</p>
      {phone ? (
        <div className="set-rows">
          <Group footer={t('Teams have their own app: make teams, add people, set who can join, and see each team’s work.')}>
            {teams.map((tm) => {
              const lead = users.find((u) => u.id === tm.leadId);
              const size = tn(tm.members.length, '{n} person', '{n} people');
              return <GRow key={tm.id} pic={<span className="g-dot" style={{ background: tm.color }} />} className="has-dot" label={tm.name} sub={lead ? t('{people} · led by {name}', { people: size, name: lead.name }) : size} onClick={() => onOpen(tm.id)} />;
            })}
            <GRow icon={Users} plainIcon action label={t('Open Teams')} onClick={() => onOpen()} />
          </Group>
        </div>
      ) : (
      <div className="set-block">
        {teams.map((tm) => {
          const lead = users.find((u) => u.id === tm.leadId);
          const size = tn(tm.members.length, '{n} person', '{n} people');
          return (
            <Row key={tm.id} title={<><span className="team-square" style={{ background: tm.color }} /> {tm.name}</>} hint={lead ? t('{people} · led by {name}', { people: size, name: lead.name }) : size}>
              <button type="button" className="ghost-btn sm" onClick={() => onOpen(tm.id)}>
                {t('Open')}
              </button>
            </Row>
          );
        })}
        <div className="set-foot">
          <button type="button" className="primary-btn sm" onClick={() => onOpen()}>
            <Users size={14} /> {t('Open Teams')}
          </button>
        </div>
      </div>
      )}
    </>
  );
}

/* ---------------- Apps & chat ---------------- */

export function AppsSection({ ws, canManage, onWorkspace, projects }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void; projects: { id: string; name: string; color: string }[] }) {
  const apps = ws.apps ?? APPS.map((a) => a.id);
  const chat = { gifs: true, celebrations: true, whoCanCreate: 'everyone' as const, history: 'forever' as const, ...ws.chat };
  const toggleApp = (id: AppId) => onWorkspace({ apps: apps.includes(id) ? apps.filter((a) => a !== id) : [...apps, id] });
  return (
    <>
      <h2>{t('Apps')}</h2>
      <p className="set-intro">{t('Switch off what your company doesn’t use. Nothing is deleted; switching an app back on brings everything back.')}</p>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          {APPS.filter((a) => a.id !== 'home').map((a) => (
            <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>}>
              <Switch on={apps.includes(a.id)} onChange={() => toggleApp(a.id)} />
            </Row>
          ))}
        </div>
        {!isSandbox(ws) && (
          <div className="set-block">
            <h3>{t('Demo company')}</h3>
            <Row title={t('Let our people open the demo company')} hint={t('Everyone gets their own private copy of a sample agency to try things in. Nobody else sees it, and nothing in it is sent anywhere. Guests never see it.')}>
              <Switch on={ws.demoCompany !== false} onChange={(v) => onWorkspace({ demoCompany: v })} />
            </Row>
          </div>
        )}
        {!isSandbox(ws) && <WhatsAppBlock ws={ws} canManage={canManage} />}
        <div className="set-block">
          <h3>{t('Chat')}</h3>
          <Row title={t('Celebrate finished work')} hint={t('A small confetti and a note in the {project}’s channel when a task is done', { project: term.one })}>
            <Switch on={chat.celebrations} onChange={(v) => onWorkspace({ chat: { ...chat, celebrations: v } })} />
          </Row>
          <PickRow
            title={t('Who can create channels')}
            hint={chat.whoCanCreate === 'admins' ? t('Members can still message people directly, and teams get their own channel.') : undefined}
            value={chat.whoCanCreate}
            onChange={(v) => onWorkspace({ chat: { ...chat, whoCanCreate: v } })}
            label={t('Who can create channels')}
            options={[
              { value: 'everyone', label: t('Everyone') },
              { value: 'admins', label: t('Only admins') },
            ]}
          />
          <PickRow
            title={t('Delete old messages')}
            hint={chat.history === 'forever' ? t('Chat is kept for good.') : undefined}
            value={chat.history}
            onChange={(v) => onWorkspace({ chat: { ...chat, history: v } })}
            label={t('Delete old messages')}
            width={260}
            options={[
              { value: 'forever', label: t('Never: keep everything') },
              { value: '1y', label: t('Older than 1 year') },
              { value: '90d', label: t('Older than 90 days') },
            ]}
          />
          <RetentionDetails ws={ws} chat={chat} projects={projects} onWorkspace={onWorkspace} />
        </div>
      </fieldset>
    </>
  );
}

/**
 * Settings, Apps & chat, "Delete old messages" switched on: what it does (the server deletes, server/retention.ts),
 * when it starts (a week after it was switched on), the last run, and the projects that keep everything.
 */
function RetentionDetails({ ws, chat, projects, onWorkspace }: { ws: Workspace; chat: NonNullable<Workspace['chat']>; projects: { id: string; name: string; color: string }[]; onWorkspace: (p: Partial<Workspace>) => void }) {
  const on = !!chat.history && chat.history !== 'forever';
  // Kept while folding closed, so the words don't change on the way out (the setting, translated where it's shown).
  const [kept, setKept] = useState(chat.history === '90d' ? '90d' : '1y');
  useEffect(() => {
    if (on) setKept(chat.history === '90d' ? '90d' : '1y');
  }, [on, chat.history]);
  const period = kept === '90d' ? t('90 days') : t('1 year');
  const keep = chat.keep ?? [];
  const status = !server.on
    ? t('In this demo nothing is deleted.')
    : chat.lastRun
      ? chat.lastRun.deleted
        ? tn(chat.lastRun.deleted, 'Last run {when}: {n} message deleted. It runs once a day.', 'Last run {when}: {n} messages deleted. It runs once a day.', { when: relative(chat.lastRun.at) })
        : t('Last run {when}: nothing old enough to delete. It runs once a day.', { when: relative(chat.lastRun.at) })
      : chat.deleteFrom && chat.deleteFrom > new Date().toISOString()
        ? t('Nothing is deleted before {day}. Admins got a notice; switch it back to Never before then to keep everything.', { day: fmtWeekdayLong(chat.deleteFrom) })
        : chat.deleteFrom
          ? t('Deleting starts today.')
          : t('Deleting starts a week after you switch it on, with a notice to admins first.');
  const setKeep = (ids: string[]) => onWorkspace({ chat: { ...chat, keep: ids } });
  const phone = usePhone();
  const [picking, setPicking] = useState(false);
  return (
    <div className={`fold ${on ? 'open' : ''}`}>
      <div className="fold-in">
        <div className="retention-warn" role="note">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <p>
              <strong>{t('Chat messages older than {period} are deleted for everyone, every day, and can’t be brought back.', { period })}</strong> {t('Pinned messages, conversations still going and the {projects} below stay. Files shared in deleted messages stay in Drive.', { projects: term.many })}
            </p>
            <p>{status}</p>
          </div>
        </div>
        {phone ? (
          <>
            {keep.map((id) => {
              const x = projects.find((c) => c.id === id);
              const name = x?.name ?? t('A removed {project}', { project: term.one });
              return (
                <GRow
                  key={id}
                  pic={<span className="g-dot" style={{ background: x?.color ?? 'var(--text-3)' }} />}
                  className="has-dot"
                  label={name}
                  sub={t('Keeps everything')}
                  accessory={
                    <button type="button" className="g-btn" onClick={() => setKeep(keep.filter((k) => k !== id))} aria-label={t('Stop keeping everything for {name}', { name })}>
                      <X size={20} />
                    </button>
                  }
                />
              );
            })}
            <GRow icon={Plus} plainIcon action label={t('Keep everything for a {project}', { project: term.one })} onClick={() => setPicking(true)} />
            {picking && (
              <ChoiceSheet
                title={t('Keep everything for a {project}', { project: term.one })}
                value={keep}
                options={projects.filter((x) => !keep.includes(x.id)).map((x) => ({ value: x.id, label: x.name, icon: <span className="sel-dot" style={{ background: x.color }} /> }))}
                onClose={() => setPicking(false)}
                onPick={(id) => (setPicking(false), setKeep([...keep, id]))}
              />
            )}
          </>
        ) : (
        <>
        <Row title={t('Keep everything for these {projects}', { projects: term.many })} hint={keep.length ? undefined : t('Their channels keep all their messages, for {projects} with a contract or a legal reason to.', { projects: term.many })}>
          <Select
            value={null}
            onChange={(id) => setKeep([...keep, id])}
            label={t('Keep everything for a {project}', { project: term.one })}
            placeholder={t('Add a {project}', { project: term.one })}
            width={240}
            options={projects.filter((x) => !keep.includes(x.id)).map((x) => ({ value: x.id, label: x.name, icon: <span className="sel-dot" style={{ background: x.color }} /> }))}
          />
        </Row>
        {!!keep.length && (
          <div className="retention-keep">
            {keep.map((id) => {
              const x = projects.find((c) => c.id === id);
              const name = x?.name ?? t('A removed {project}', { project: term.one });
              return (
                <span key={id} className="retention-chip">
                  <span className="sel-dot" style={{ background: x?.color ?? 'var(--text-3)' }} />
                  {name}
                  <button type="button" className="icon-btn sm" onClick={() => setKeep(keep.filter((k) => k !== id))} aria-label={t('Stop keeping everything for {name}', { name })}>
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

/* ---------------- WhatsApp Business ---------------- */

/**
 * WhatsApp for guests: messages from a project's guests land in that project's shared channel, and the team can
 * write back from a guest's row. Needs a WhatsApp Business number on Meta's Cloud API; the token stays on the server.
 */
function WhatsAppBlock({ ws, canManage }: { ws: Workspace; canManage: boolean }) {
  const [phoneId, setPhoneId] = useState(ws.whatsapp?.phoneNumberId ?? '');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [display, setDisplay] = useState(ws.whatsapp?.displayPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const on = !!ws.whatsapp?.connected;
  // Meta signs every message with the app's secret; without it, nothing can be checked, so nothing is read.
  const needsSecret = !caps.whatsappAppSecret;
  const unchecked = on && !ws.whatsapp?.secured;
  const hook = `${location.origin}/api/whatsapp/webhook`;
  const connect = async () => {
    setBusy(true);
    setErr('');
    const r = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, phoneNumberId: phoneId, token, displayPhone: display, appSecret: secret || undefined }) });
    setBusy(false);
    if (!r.ok) return setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? mark('Couldn’t connect.'));
    setToken('');
    setSecret('');
    setOpen(false);
  };
  const disconnect = () => confirm(t('Disconnect WhatsApp? Messages from guests stop arriving here.')) && void fetch('/api/whatsapp/connect', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id }) });
  const shownAs = ws.whatsapp?.displayPhone;
  // Phones (iOS Settings): one row with its state; connecting is a screen with the fields, connected a screen with the
  // webhook details and Disconnect.
  if (phone) {
    const steps = unchecked
      ? t('In Meta for Developers: your app, App settings, Basic. Copy the app secret.')
      : needsSecret
        ? t('In Meta for Developers: your app, WhatsApp, API setup. Copy the phone number ID and make a permanent access token (a system user with the WhatsApp permissions). The app secret is under App settings, Basic.')
        : t('In Meta for Developers: your app, WhatsApp, API setup. Copy the phone number ID and make a permanent access token (a system user with the WhatsApp permissions).');
    const ready = unchecked ? secret.length >= 32 : !!phoneId.trim() && token.trim().length >= 20 && (!needsSecret || secret.length >= 32);
    const copy = (v: string) => void navigator.clipboard?.writeText(v);
    return (
      <div className="set-block">
        <h3>WhatsApp</h3>
        <GRow
          label={t('WhatsApp for guests')}
          sub={on ? (shownAs ? t('Connected as {phone}', { phone: shownAs }) : t('Connected')) : t('Guests message your WhatsApp Business number; it lands in their project’s shared channel. Needs a number on Meta’s Cloud API.')}
          value={on ? (unchecked ? t('Needs the app secret') : undefined) : t('Off')}
          onClick={canManage ? () => setOpen(true) : undefined}
        />
        {open && (!on || unchecked) && (
          <EditScreen
            title="WhatsApp"
            saveLabel={unchecked ? t('Save') : t('Connect')}
            canSave={ready}
            onBack={() => (setOpen(false), setErr(''))}
            onSave={async () => {
              const r = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, phoneNumberId: phoneId, token, displayPhone: display, appSecret: secret || undefined }) });
              if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? mark('Couldn’t connect.');
              setToken('');
              setSecret('');
              return null;
            }}
          >
            <p className="g-note">{steps}</p>
            {!unchecked && (
              <>
                <Group title={t('Phone number ID')}>
                  <GField value={phoneId} onChange={setPhoneId} label={t('Phone number ID')} placeholder={t('e.g. {example}', { example: '103912345678901' })} inputMode="numeric" mono />
                </Group>
                <Group title={t('Access token')}>
                  <GField value={token} onChange={setToken} label={t('Access token')} placeholder="EAAG…" type="password" autoComplete="off" mono />
                </Group>
              </>
            )}
            {(needsSecret || unchecked) && (
              <Group title={t('App secret')}>
                <GField value={secret} onChange={(v) => setSecret(v.trim())} label={t('App secret')} placeholder={t('32 letters and numbers')} type="password" autoComplete="off" mono />
              </Group>
            )}
            {!unchecked && (
              <Group title={t('Shown as')}>
                <GField value={display} onChange={setDisplay} label={t('Shown as')} placeholder={t('{example} (optional)', { example: '+62 812 0000 0000' })} inputMode="tel" />
              </Group>
            )}
          </EditScreen>
        )}
        {open && on && !unchecked && ws.whatsapp && (
          <PushScreen title="WhatsApp" onBack={() => setOpen(false)} className="g-page g-edit">
            <div className="g-body">
              <Group footer={t('Guests’ messages land in their project’s shared channel; write back from the Guests tab.')}>
                <GRow label={t('Status')} value={t('Connected')} />
                {shownAs && <GRow label={t('Shown as')} value={shownAs} />}
              </Group>
              <Group title={t('Webhook')} footer={t('Guests need their WhatsApp number on their invite (Guests tab) so we know whose message it is. Numbers we don’t know go to admins as a notification.')}>
                <GRow label="URL" sub={<span className="mono">{hook}</span>} accessory={<button type="button" className="g-btn" aria-label={t('Copy')} onClick={() => copy(hook)}><Copy size={20} /></button>} />
                <GRow label={tx('webhook', 'Verify')} sub={<span className="mono">{ws.whatsapp.verifyToken}</span>} accessory={<button type="button" className="g-btn" aria-label={t('Copy')} onClick={() => copy(ws.whatsapp!.verifyToken)}><Copy size={20} /></button>} />
              </Group>
              <Group>
                <GRow label={t('Disconnect')} danger onClick={() => (disconnect(), setOpen(false))} />
              </Group>
            </div>
          </PushScreen>
        )}
      </div>
    );
  }
  return (
    <div className="set-block">
      <h3>WhatsApp</h3>
      <Row
        title={t('WhatsApp for guests')}
        hint={
          on
            ? shownAs
              ? t('Connected as {phone}. Guests’ messages land in their project’s shared channel; write back from the Guests tab.', { phone: shownAs })
              : t('Connected. Guests’ messages land in their project’s shared channel; write back from the Guests tab.')
            : t('Guests message your WhatsApp Business number; it lands in their project’s shared channel. Needs a number on Meta’s Cloud API.')
        }
      >
        {on && !unchecked ? (
          <button type="button" className="ghost-btn sm" onClick={disconnect} disabled={!canManage}>
            {t('Disconnect')}
          </button>
        ) : (
          <button type="button" className="ghost-btn sm" onClick={() => setOpen((x) => !x)} disabled={!canManage}>
            {unchecked ? t('Add the app secret') : t('Connect')}
          </button>
        )}
      </Row>
      {unchecked && <p className="warn-note small">{t('Messages from WhatsApp aren’t read yet: Meta signs each one with your app’s secret, and we need it to check that they really come from Meta. Add the app secret to switch it on.')}</p>}
      <div className={`fold ${open && (!on || unchecked) ? 'open' : ''}`}>
        <div className="fold-in wa-form">
          <p className="muted small">
            {unchecked
              ? t('In Meta for Developers: your app, App settings, Basic. Copy the app secret.')
              : needsSecret
                ? t('In Meta for Developers: your app, WhatsApp, API setup. Copy the phone number ID and make a permanent access token (a system user with the WhatsApp permissions). The app secret is under App settings, Basic.')
                : t('In Meta for Developers: your app, WhatsApp, API setup. Copy the phone number ID and make a permanent access token (a system user with the WhatsApp permissions).')}
          </p>
          {!unchecked && (
            <>
              <label className="team-field">
                <span>{t('Phone number ID')}</span>
                <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder={t('e.g. {example}', { example: '103912345678901' })} />
              </label>
              <label className="team-field">
                <span>{t('Access token')}</span>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" autoComplete="off" />
              </label>
            </>
          )}
          {(needsSecret || unchecked) && (
            <label className="team-field">
              <span>{t('App secret')}</span>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder={t('32 letters and numbers')} autoComplete="off" />
            </label>
          )}
          {!unchecked && (
            <label className="team-field">
              <span>{t('Shown as')}</span>
              <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder={t('{example} (optional)', { example: '+62 812 0000 0000' })} />
            </label>
          )}
          {err && <p className="err small">{t(err)}</p>}
          <div className="wl-new-actions">
            <button type="button" className="primary-btn sm" disabled={busy || (unchecked ? secret.length < 32 : !phoneId.trim() || token.trim().length < 20 || (needsSecret && secret.length < 32))} onClick={() => void connect()}>
              {busy ? t('Saving…') : unchecked ? t('Save the app secret') : t('Connect')}
            </button>
          </div>
        </div>
      </div>
      {on && ws.whatsapp && (
        <div className="wa-hook">
          <p className="small">{tj('In Meta, under Webhooks, subscribe to {messages} with:', { messages: <b>messages</b> })}</p>
          <div className="wl-dns">
            <span className="mono">URL</span>
            <span className="mono wa-wide">{hook}</span>
            <button type="button" className="icon-btn sm" title={t('Copy')} onClick={() => void navigator.clipboard?.writeText(hook)}>
              <Download size={13} />
            </button>
          </div>
          <div className="wl-dns">
            {/* Meta's "Verify token" field. */}
            <span className="mono">{tx('webhook', 'Verify')}</span>
            <span className="mono wa-wide">{ws.whatsapp.verifyToken}</span>
            <button type="button" className="icon-btn sm" title={t('Copy')} onClick={() => void navigator.clipboard?.writeText(ws.whatsapp!.verifyToken)}>
              <Download size={13} />
            </button>
          </div>
          <p className="muted small">{t('Guests need their WhatsApp number on their invite (Guests tab) so we know whose message it is. Numbers we don’t know go to admins as a notification.')}</p>
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
      <h2>{t('Your apps')}</h2>
      <p className="set-intro">{t('Put your apps in the order you use them (or drag them in the left rail), and hide the ones you don’t. Your team still has them, and you can show them again any time.')}</p>
      <div className="set-block">
        {on.map((a, i) => (
          <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>} hint={hidden.includes(a.id) ? t('Hidden for you') : undefined}>
            <span className="app-order">
              <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(a.id, -1)} aria-label={t('Move {app} up', { app: a.name })}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className="icon-btn sm" disabled={i === on.length - 1} onClick={() => move(a.id, 1)} aria-label={t('Move {app} down', { app: a.name })}>
                <ArrowDown size={13} />
              </button>
              <Switch on={!hidden.includes(a.id)} onChange={() => onHidden(hidden.includes(a.id) ? hidden.filter((x) => x !== a.id) : [...hidden, a.id])} />
            </span>
          </Row>
        ))}
        <div className="app-order-foot">
          {order.mine && (
            <button type="button" className="link-btn small" onClick={order.reset}>
              {order.shared.defaults.rail ? t('Use the company’s order') : t('Back to the usual order')}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="link-btn small" onClick={() => order.shared.set('rail', { order: ids, hidden: [] })}>
              {t('Make this everyone’s order')}
            </button>
          )}
        </div>
      </div>
      {off.length > 0 && (
        <div className="set-block">
          <h3>{t('Off for {company}', { company: ws.name || t('the company') })}</h3>
          <p className="muted small">{isAdmin ? t('Switch one on and it appears for everyone.') : t('An admin decides which apps the company uses. Ask, and they get a notification that takes them straight to the switch.')}</p>
          {off.map((a) => (
            <Row key={a.id} title={<><a.icon size={15} /> {a.name}</>}>
              {isAdmin ? (
                <button className="ghost-btn sm outline" onClick={() => onCompanyApp(a.id)}>
                  {t('Switch on for everyone')}
                </button>
              ) : asked.includes(a.id) ? (
                <span className="muted small">{t('Asked')}</span>
              ) : (
                <button className="ghost-btn sm outline" onClick={() => onAsk(a.id)}>
                  {t('Ask an admin')}
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
// A function, so the words are read in the person's language each time (docs/i18n.md).
const grace = () => [
  { value: '0', label: t('Right away'), hint: t('At their next sign-in') },
  ...[3, 7, 14].map((n) => ({ value: String(n), label: tn(n, '{n} day', '{n} days') })),
];
const longDay = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'long' });

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
  const days = sec.graceDays ?? 7;
  const co = ws.name || t('the company');
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
    const timer = setTimeout(load, info ? 700 : 0);
    return () => clearTimeout(timer);
  }, [ws.id, sec.twoStep, days, live, canManage]); // eslint-disable-line react-hooks/exhaustive-deps
  // When it starts to apply: the day it was switched on (now, if it just was) plus the days people were given.
  const from = new Date(Date.parse(sec.twoStepSince ?? new Date().toISOString()) + days * 86_400_000).toISOString();
  const biting = from <= new Date().toISOString();
  const nameOf = (id: string | null) => (id === null ? t('{product} support', { product: product.name }) : id === me ? t('You') : users.find((u) => u.id === id)?.name ?? t('Someone who left'));
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
      .then((d: { sent?: number; error?: string }) => (toast(d.error ? t(d.error) : tn(d.sent ?? 0, 'Reminded {n} person', 'Reminded {n} people')), load()))
      .finally(() => setBusy(false));
  };
  const phone = usePhone();
  const [deleting, setDeleting] = useState(false);
  const OTHER = [
    { k: 'google', title: t('Sign in with Google'), why: caps.signIn.googleApp ? t('Coming soon.') : t('Coming soon. Needs a Google sign-in app set up by {product}.', { product: product.name }) },
    { k: 'microsoft', title: t('Sign in with Microsoft'), why: caps.signIn.microsoftApp ? t('Coming soon.') : t('Coming soon. Needs a Microsoft sign-in app set up by {product}.', { product: product.name }) },
    { k: 'saml', title: t('Single sign-on (SAML)'), why: t('Coming soon: Okta, Azure AD or Google Workspace as your company’s sign-in.') },
  ] as const;

  return (
    <>
      <h2>{t('Security & data')}</h2>
      <p className="set-intro">{t('How people sign in to {company}, what it may track, and the company’s data.', { company: co })}</p>
      <div className="set-block">
        <h3>{t('Sign-in')}</h3>
        {canManage ? (
          <>
            <Row
              title={t('Require two-step sign-in')}
              hint={[t('Everyone in the company signs in with a code from an authenticator app, not just a password.'), !isOwner ? t('Only owners change this.') : !sec.twoStep && mine === false ? t('Turn it on for your own account first.') : ''].filter(Boolean).join(' ')}
            >
              {isOwner && !sec.twoStep && mine === false && phone ? (
                <button type="button" className="g-save" onClick={onAccount}>
                  {t('Turn yours on')}
                </button>
              ) : isOwner && !sec.twoStep && mine === false ? (
                <button type="button" className="ghost-btn outline sm" onClick={onAccount}>
                  {t('Turn yours on')}
                </button>
              ) : (
                <Switch on={sec.twoStep} disabled={!isOwner || mine === null} onChange={(v) => onWorkspace({ security: { ...sec, twoStep: v, graceDays: days } })} />
              )}
            </Row>
            <div className={`fold ${sec.twoStep ? 'open' : ''}`}>
              <div className="fold-in">
                <PickRow
                  title={t('Time to set it up')}
                  hint={sec.twoStep ? (biting ? t('It applies now: anyone without it sets it up before they can go on.') : t('From {day}, anyone without it sets it up at sign-in before they can go on. They got a notification.', { day: longDay(from) })) : undefined}
                  value={String(days)}
                  disabled={!isOwner}
                  onChange={(v) => onWorkspace({ security: { ...sec, graceDays: Number(v) } })}
                  label={t('Time to set it up')}
                  options={grace()}
                  width={200}
                />
              </div>
            </div>
            {OTHER.map((o) => (
              <Row key={o.k} title={o.title} hint={o.why}>
                <Badge>{tx('feature', 'Not yet')}</Badge>
              </Row>
            ))}
          </>
        ) : (
          <Row
            title={t('Two-step sign-in')}
            hint={
              sec.twoStep
                ? biting
                  ? t('{company} requires a code from an authenticator app when you sign in.', { company: ws.name })
                  : t('{company} requires a code from an authenticator app when you sign in, from {day}.', { company: ws.name, day: longDay(from) })
                : t('A code from an authenticator app when you sign in. Turn it on for your own account.')
            }
          >
            <button type="button" className="ghost-btn outline sm" onClick={onAccount}>
              {t('Your settings')}
            </button>
          </Row>
        )}
      </div>

      {canManage && live && (
        <div className="set-block">
          <h3>{t('Two-step sign-in by person')}</h3>
          {!info ? (
            <p className="muted small">{t('Loading…')}</p>
          ) : (
            <>
              {phone ? (
                <>
                  {missing.length > 0 && <GRow label={busy ? t('Sending…') : t('Send a reminder')} sub={missing.length === 1 ? t('{name} hasn’t turned it on yet.', { name: missing[0].user.name.split(' ')[0] }) : tn(missing.length, '{n} person hasn’t turned it on yet.', '{n} people haven’t turned it on yet.')} action onClick={busy ? undefined : remind} />}
                  {people.map((x) => (
                    <GRow
                      key={x.userId}
                      pic={<Avatar person={x.user} size={32} />}
                      label={
                        <>
                          {x.user.name} {x.userId === me && <Badge tone="accent">{t('You')}</Badge>}
                        </>
                      }
                      value={x.on ? t('On') : tx('feature', 'Not yet')}
                      onClick={canReset(x) ? () => setResetting(x.user) : undefined}
                    />
                  ))}
                </>
              ) : (
              <>
              {missing.length > 0 && (
                <div className="ts-remind">
                  <span>{missing.length === 1 ? t('{name} hasn’t turned it on yet.', { name: missing[0].user.name.split(' ')[0] }) : tn(missing.length, '{n} person hasn’t turned it on yet.', '{n} people haven’t turned it on yet.')}</span>
                  <button type="button" className="ghost-btn outline sm" disabled={busy} onClick={remind}>
                    {busy ? t('Sending…') : t('Send a reminder')}
                  </button>
                </div>
              )}
              <div className={`ts-people ${people.some(canReset) ? 'has-actions' : ''}`}>
                {people.map((x) => {
                  return (
                    <div key={x.userId} className="pa-row ts-person">
                      <PersonCell person={x.user} badges={x.userId === me && <Badge tone="accent">{t('You')}</Badge>} />
                      <Badge tone={x.on ? 'good' : 'warn'}>{x.on ? t('On') : t('Not yet')}</Badge>
                      <span className="ts-person-act">
                        {canReset(x) && (
                          <button type="button" className="ghost-btn sm" onClick={() => setResetting(x.user)}>
                            {tx('two-step', 'Reset')}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              </>
              )}
              <p className="muted small">
                {sec.twoStep
                  ? t('Someone lost their phone and their backup codes? Reset theirs: they sign in with just their password, then set it up again.')
                  : t('Someone lost their phone and their backup codes? Reset theirs: they sign in with just their password, then set it up again if they want.')}
              </p>
            </>
          )}
        </div>
      )}

      {canManage && (
        <div className="set-block">
          <h3>
            <ShieldCheck size={15} /> {t('Security log')}
          </h3>
          {!live ? (
            DEMO_LOG.map(([who, what, when], i) => (
              <div key={i} className="pa-row">
                {users.find((u) => u.name.startsWith(who)) && <Avatar person={users.find((u) => u.name.startsWith(who))!} size={20} />}
                <span className="pa-title">
                  <b>{who}</b>&nbsp;{t(what)}
                </span>
                <span className="muted small">{t(when)}</span>
              </div>
            ))
          ) : !info ? (
            <p className="muted small">{t('Loading…')}</p>
          ) : info.log.length === 0 ? (
            <p className="muted small">{t('Nothing yet. Changes to the sign-in rules and to people’s two-step sign-in show up here.')}</p>
          ) : (
            info.log.map((e, i) => {
              const u = e.userId ? users.find((x) => x.id === e.userId) : undefined;
              return (
                <div key={i} className="pa-row ts-log">
                  {u && <Avatar person={u} size={20} />}
                  <span className="pa-title">
                    {/* The server writes the detail in English: its fixed ones are in this area's dictionary. */}
                    <b>{nameOf(e.userId)}</b>&nbsp;{e.detail && t(e.detail)}
                  </span>
                  <span className="muted small">{relative(e.at)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="set-block">
        <h3>{t('Privacy')}</h3>
        <Row
          title={t('Read tracking on email to people outside the company')}
          hint={[
            ws.readTracking !== false
              ? t('People can choose to see when someone outside {company} opens their email and which links they click. Teammates are never tracked.', { company: co })
              : t('Off: nobody in {company} can track email, and pictures in mail already sent stop counting.', { company: co }),
            canManage ? '' : t('Only owners and admins change this.'),
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Switch on={ws.readTracking !== false} disabled={!canManage} onChange={(v) => onWorkspace({ readTracking: v })} />
        </Row>
        <Row
          title={t('Let people connect AI apps')}
          hint={[
            ws.aiApps !== false
              ? t('People can connect Claude, ChatGPT and other AI apps to {company}. An app sees only what its person sees, works under their name, and mail or messages to guests stay drafts they send themselves.', { company: co })
              : t('Off: AI apps can’t reach {company}, and the ones people connected stop working until it’s back on.', { company: co }),
            canManage ? '' : t('Only owners and admins change this.'),
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Switch on={ws.aiApps !== false} disabled={!canManage} onChange={(v) => onWorkspace({ aiApps: v })} />
        </Row>
      </div>

      <div className="set-block">
        <h3>{t('Your data')}</h3>
        {phone ? (
          <>
            <GRow label={t('Export everything')} sub={t('Mail, chat, tasks, {projects}, calendars and file lists as one download. Always free, on every plan', { projects: term.many })} action onClick={onExport} />
            {isOwner && <GRow label={t('Delete {company}', { company: ws.name })} danger onClick={() => setDeleting(true)} />}
          </>
        ) : (
        <>
        <Row title={<><Download size={14} /> {t('Export everything')}</>} hint={t('Mail, chat, tasks, {projects}, calendars and file lists as one download. Always free, on every plan', { projects: term.many })}>
          <button type="button" className="ghost-btn sm" onClick={onExport}>
            <HardDrive size={14} /> {t('Download')}
          </button>
        </Row>
        {isOwner && (
          <div className="danger-zone">
            <strong>{t('Delete {company}', { company: ws.name })}</strong>
            <small>{t('Removes the company and everything in it for everyone. Type the company name to confirm.')}</small>
            <div className="add-prov inline">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={ws.name} />
              <button type="button" className="danger-btn sm" disabled={typed !== ws.name} onClick={onDelete}>
                {t('Delete company')}
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
      {deleting && (
        <EditScreen title={t('Delete {company}', { company: ws.name })} saveLabel={t('Delete')} danger canSave={typed === ws.name} onBack={() => (setDeleting(false), setTyped(''))} onSave={() => void onDelete()}>
          <p className="g-note">{t('Removes the company and everything in it for everyone. Type the company name to confirm.')}</p>
          <Group>
            <GField value={typed} onChange={setTyped} label={t('Company name')} placeholder={ws.name} autoFocus />
          </Group>
        </EditScreen>
      )}
      {resetting && (
        <ResetTwoStep
          person={resetting}
          required={sec.twoStep}
          onClose={() => setResetting(null)}
          onReset={async () => {
            const r = await fetch('/api/security/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, userId: resetting.id }) });
            const d = (await r.json().catch(() => ({}))) as { error?: string };
            if (!r.ok) throw new Error(d.error ?? mark('Couldn’t reset it.'));
            toast(t('Two-step sign-in reset for {name}', { name: resetting.name.split(' ')[0] }));
            setResetting(null);
            load();
          }}
        />
      )}
    </>
  );
}

/** The demo's sample log (no server: nothing has really happened). Translated where it's shown. */
const DEMO_LOG = [
  ['Raka', mark('changed the AI setup to Balanced'), mark('2 hours ago')],
  ['Hendra', mark('added an Anthropic key'), mark('3 days ago')],
  ['Raka', mark('invited Laras Anindita as a guest in #kopinara'), mark('2 weeks ago')],
  ['Intan', mark('downloaded the September invoice'), mark('1 month ago')],
];

/** Confirming a reset: what happens to them, and a nudge to be sure it's really them asking. */
function ResetTwoStep({ person, required, onClose, onReset }: { person: User; required: boolean; onClose: () => void; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = person.name.split(' ')[0];
  return createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal ts-modal sm" role="dialog" aria-label={t('Reset two-step sign-in for {name}', { name: person.name })} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <ShieldCheck size={15} /> {t('Reset two-step sign-in')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <p className="ts-text">
            {required
              ? t('{name} is signed out everywhere and signs in next time with just their password, then sets two-step sign-in up again, since the company requires it. They get an email about it.', { name: first })
              : t('{name} is signed out everywhere and signs in next time with just their password. They get an email about it.', { name: first })}
          </p>
          <p className="muted small">{t('Only do this when you’re sure it’s {name} asking, for example on a call or in person.', { name: first })}</p>
          {error && <p className="err small">{t(error)}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="primary-btn danger-btn" disabled={busy} onClick={() => (setBusy(true), setError(''), void onReset().catch((e: Error) => (setError(e.message), setBusy(false))))}>
            {busy ? t('Resetting…') : t('Reset for {name}', { name: first })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
