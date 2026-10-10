import { SignaturesPhone, WritingPhone } from './mail/MailWriting';
import { useState, type ReactNode } from 'react';
import { Ban, Inbox, Plus, UserPlus, Users } from 'lucide-react';
import type { Account, BlockRule, CalendarDef, Role, User, Workspace } from '../types';
import { ACCENTS, type Settings } from '../settings';
import { HOLIDAY_COUNTRIES } from '../data/holidays';
import { companyTz } from '../jobTimes';
import { zoneOptions } from './ui/zones';
import { PushScreen } from './ui/PushScreen';
import { useLeaving } from './ui/Smooth';
import { Badge } from './ui/Person';
import { ChoiceRow, EditScreen, GRow, Group, SwitchRow, TextRow } from './ui/Grouped';
import { Avatar } from './Avatar';
import { PhotoPicker } from './PhotoPicker';
import { WorkspaceLogo } from './WorkspaceLogo';
import { BrandFields } from './WorkspaceForms';
import { LANGS, getLang, t, tn, tx, type Lang } from '../i18n';
import { fmtDate } from '../i18n/format';

/*
 * Settings on phones, iOS Settings' way: every setting is a row with its value on the right. Text opens a screen of its
 * own with Cancel and Save; choices open a sheet with a tick; a thing in a list (a member, a mailbox, a blocked sender)
 * opens its own screen with what can be done to it. Desktop keeps SettingsPage's forms.
 */

const roleName = (r: Role) => (r === 'owner' ? t('Owner') : r === 'admin' ? t('Admin') : t('Member'));
const roleOptions = () => [
  { value: 'member' as Role, label: t('Member'), hint: t('Uses the apps') },
  { value: 'admin' as Role, label: t('Admin'), hint: t('Manages people, apps and settings') },
  { value: 'owner' as Role, label: t('Owner'), hint: t('Everything, including billing') },
];

/** General & email: the business, its words, its calendar and language. */
export function WorkspacePhone({ ws, canManage, onWorkspace, onHolidays, holidayCal }: { ws: Workspace; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void; onHolidays: (country: string | null) => void; holidayCal?: CalendarDef }) {
  const [brand, setBrand] = useState(false);
  const holidayNote = !ws.holidays
    ? t('Show your country’s public holidays as all-day items in everyone’s calendar here. Tasks due on a holiday get a note.')
    : holidayCal?.error
      ? t('Couldn’t update them: {error}', { error: t(holidayCal.error) })
      : t('In everyone’s calendar, and a note on tasks due that day.');
  const edit = canManage ? undefined : true;
  return (
    <>
      {!canManage && <p className="g-foot set-only">{t('Only owners and admins can change workspace settings.')}</p>}
      <Group footer={t('People at these domains are your team, so their email is never tracked.')}>
        <TextRow label={t('Business name')} value={ws.name} empty={t('Untitled')} disabled={edit} allowEmpty={false} onSave={(v) => onWorkspace({ name: v })} />
        <GRow
          label={t('Logo and colour')}
          accessory={
            <span className="set-brand-val">
              <WorkspaceLogo ws={ws} size={24} />
              <i className="set-dot" style={{ background: ws.color }} />
            </span>
          }
          chevron={canManage}
          onClick={canManage ? () => setBrand(true) : undefined}
        />
        <TextRow
          label={t('Email domains')}
          value={ws.domains.join(', ')}
          empty={t('None yet')}
          disabled={edit}
          placeholder={t('business.com')}
          inputMode="url"
          footer={t('People at these domains are your team, so their email is never tracked. Separate them with commas.')}
          onSave={(v) => onWorkspace({ domains: v.split(/[,\s]+/).map((d) => d.replace(/^@/, '').toLowerCase()).filter(Boolean) })}
        />
      </Group>
      <Group footer={t('Changes the word everywhere in the app. With Projects, the people you invite are called guests.')}>
        <ChoiceRow<'project' | 'client'>
          label={t('What you call your work')}
          value={ws.terms?.word ?? 'project'}
          onChange={(v) => onWorkspace({ terms: { word: v } })}
          disabled={!canManage}
          options={[
            { value: 'project', label: t('Projects'), hint: t('Any kind of work: clients, partners, internal') },
            { value: 'client', label: t('Clients'), hint: t('For agencies that work for clients') },
          ]}
        />
      </Group>
      <Group footer={holidayNote}>
        <ChoiceRow label={t('Public holidays')} value={ws.holidays?.country ?? ''} onChange={(v) => onHolidays(v || null)} disabled={!canManage} options={[{ value: '', label: t('Off') }, ...HOLIDAY_COUNTRIES.map((c) => ({ value: c.code, label: t(c.name) }))]} />
        <ChoiceRow label={t('Time zone')} value={companyTz(ws)} onChange={(v) => onWorkspace({ timeZone: v })} disabled={!canManage} options={zoneOptions(companyTz(ws)).map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group }))} />
        <ChoiceRow<'' | Lang> label={t('Language')} value={ws.language ?? ''} onChange={(v) => onWorkspace({ language: v || undefined })} disabled={!canManage} options={[{ value: '', label: t('Each person’s browser') }, ...LANGS.map((l) => ({ value: l.id, label: l.name }))]} />
      </Group>
      {brand && (
        <PushScreen title={t('Logo and colour')} onBack={() => setBrand(false)} className="set-edit">
          <div className="set-edit-body set-brand">
            <BrandFields value={ws} onChange={onWorkspace} />
          </div>
        </PushScreen>
      )}
    </>
  );
}

/** Members: a row each (photo, name, email, role); tapping one opens them with their role and Remove. */
export function MembersPhone({ ws, users, me, canManage, onRole, onRemove, onInvite }: { ws: Workspace; users: User[]; me: string; canManage: boolean; onRole: (id: string, r: Role) => void; onRemove: (id: string) => void; onInvite: () => void }) {
  const rows = useLeaving(ws.members, (m) => m.userId);
  const [open, setOpen] = useState<string | null>(null);
  const owners = ws.members.filter((x) => x.role === 'owner').length;
  const m = ws.members.find((x) => x.userId === open);
  const u = m && users.find((x) => x.id === m.userId);
  const canRole = (id: string, role: Role) => canManage && id !== me && !(role === 'owner' && owners === 1);
  return (
    <>
      <Group title={t('Members')}>
        {rows.map(({ item: mm, leaving }) => {
          const p = users.find((x) => x.id === mm.userId);
          if (!p) return null;
          return (
            <GRow
              key={mm.userId}
              className={leaving ? 'row-leaving' : ''}
              pic={<Avatar person={p} size={40} />}
              label={
                <>
                  {p.name} {mm.userId === me && <Badge tone="accent">{t('You')}</Badge>}
                </>
              }
              sub={p.email}
              value={roleName(mm.role)}
              onClick={() => setOpen(mm.userId)}
            />
          );
        })}
        {canManage && <GRow icon={UserPlus} plainIcon action label={t('Invite someone')} onClick={onInvite} />}
      </Group>
      {m && u && (
        <PushScreen title={u.name} onBack={() => setOpen(null)} className="g-page g-edit">
          <div className="g-body">
            <div className="g-hero">
              <Avatar person={u} size={56} />
              <strong>{u.name}</strong>
              <small>{u.title ? `${u.title} · ${u.email}` : u.email}</small>
            </div>
            <Group footer={canRole(m.userId, m.role) ? undefined : m.userId === me ? t('Another owner or admin can change your role.') : m.role === 'owner' && owners === 1 ? t('A company always has an owner. Make someone else owner first.') : undefined}>
              {canRole(m.userId, m.role) ? <ChoiceRow<Role> label={t('Role')} value={m.role} onChange={(r) => onRole(m.userId, r)} options={roleOptions()} /> : <GRow label={t('Role')} value={roleName(m.role)} />}
            </Group>
            {canManage && m.userId !== me && m.role !== 'owner' && (
              <Group>
                <GRow label={t('Remove from workspace')} danger onClick={() => (onRemove(m.userId), setOpen(null))} />
              </Group>
            )}
          </div>
        </PushScreen>
      )}
    </>
  );
}

/** Email accounts: a row per mailbox; its screen has who opens it (shared inboxes), its state and Remove. */
export function MailboxesPhone({ ws, users, me, canManage, nameOf, onAccess, onAdd, onRemove }: { ws: Workspace; users: User[]; me: string; canManage: boolean; nameOf: (id: string) => string; onAccess: (accountId: string, users: string[]) => void; onAdd: () => void; onRemove: (id: string) => void }) {
  const list = ws.accounts.filter((a) => !a.temp);
  const rows = useLeaving(list, (a) => a.id);
  const [open, setOpen] = useState<string | null>(null);
  const a = list.find((x) => x.id === open);
  const pic = (x: Account) => <span className="acct-icon">{x.kind === 'shared' ? <Users size={20} /> : <Inbox size={20} />}</span>;
  return (
    <>
      <Group title={t('Email accounts')}>
        {rows.map(({ item: x, leaving }) => (
          <GRow
            key={x.id}
            className={leaving ? 'row-leaving' : ''}
            pic={pic(x)}
            label={x.email}
            sub={x.kind === 'shared' ? t('Shared inbox') : t('Personal')}
            value={x.connected ? undefined : t('Not connected')}
            onClick={() => setOpen(x.id)}
          />
        ))}
        {canManage && <GRow icon={Plus} plainIcon action label={t('Add an email account')} onClick={onAdd} />}
      </Group>
      {a && (
        <PushScreen title={a.email} onBack={() => setOpen(null)} className="g-page g-edit">
          <div className="g-body">
            <Group footer={a.users.length ? t('opened by {names}', { names: a.users.map(nameOf).join(', ') }) : t('opened by nobody')}>
              <GRow label={t('Kind')} value={a.kind === 'shared' ? t('Shared inbox') : t('Personal')} />
              <GRow label={t('Status')} value={a.connected ? t('Connected') : t('Not connected')} />
            </Group>
            {canManage && a.kind === 'shared' && (
              <Group title={t('Who can read and send from {email}', { email: a.email })} footer={t('At least one person needs access')}>
                {ws.members.map((mm) => {
                  const u = users.find((x) => x.id === mm.userId);
                  if (!u) return null;
                  const on = a.users.includes(u.id);
                  return (
                    <SwitchRow
                      key={u.id}
                      label={
                        <>
                          {u.name} {u.id === me && <Badge tone="accent">{t('You')}</Badge>}
                        </>
                      }
                      on={on}
                      disabled={on && a.users.length === 1}
                      onChange={() => onAccess(a.id, on ? a.users.filter((x) => x !== u.id) : [...a.users, u.id])}
                    />
                  );
                })}
              </Group>
            )}
            {canManage && ws.accounts.length > 1 && (
              <Group>
                <GRow label={t('Remove account')} danger onClick={() => (onRemove(a.id), setOpen(null))} />
              </Group>
            )}
          </div>
        </PushScreen>
      )}
    </>
  );
}

/** Account: photo, name, title, address and language, each a row. */
export function AccountPhone({ s, update, email, me, onPhoto, security }: { s: Settings; update: (p: Partial<Settings>) => void; email: string; me?: User; onPhoto?: (p: string | undefined) => void; security: ReactNode }) {
  const [photo, setPhoto] = useState(false);
  const person = { name: s.name || me?.name || email, email, color: s.avatarColor, photo: me?.photo };
  return (
    <>
      <Group>
        <GRow pic={<Avatar person={person} size={40} />} label={t('Photo and colour')} onClick={() => setPhoto(true)} />
      </Group>
      <Group footer={t('Your address is set up by your administrator.')}>
        <TextRow label={t('Display name')} value={s.name} allowEmpty={false} autoComplete="name" onSave={(v) => update({ name: v })} />
        <TextRow label={t('Title')} value={s.title} onSave={(v) => update({ title: v })} />
        <GRow label={t('Email address')} value={email} />
      </Group>
      <Group footer={t('The app’s words, dates and numbers. It follows you to your other devices.')}>
        <ChoiceRow<Lang> label={t('Language')} value={s.language ?? getLang()} onChange={(v) => update({ language: v })} options={LANGS.map((l) => ({ value: l.id, label: l.name }))} />
      </Group>
      {security}
      {photo && (
        <PushScreen title={t('Photo and colour')} onBack={() => setPhoto(false)} className="g-page g-edit">
          <div className="g-body">
            <div className="g-hero">
              <PhotoPicker name={s.name} email={email} color={s.avatarColor} photo={me?.photo} onChange={(ph) => onPhoto?.(ph)} />
            </div>
            <Group title={t('Avatar colour')} footer={t('Shown when there’s no photo.')}>
              <div className="g-row set-swatches">
                {ACCENTS.map((c) => (
                  <button key={c} type="button" className={`swatch ${s.avatarColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => update({ avatarColor: c })} aria-label={t('Avatar colour {color}', { color: c })} />
                ))}
              </div>
            </Group>
          </div>
        </PushScreen>
      )}
    </>
  );
}

/** Mail & signature: the signature on its own screen, undo send, read tracking and blocked senders. */
export function MailPhone({ s, update, ws, me, canManage, blocked, onUnblock, onSecurity, extras }: { s: Settings; update: (p: Partial<Settings>) => void; ws: Workspace; me: string; canManage: boolean; blocked: BlockRule[]; onUnblock: (id: string) => void; onSecurity: () => void; extras?: ReactNode }) {
  const [rule, setRule] = useState<string | null>(null);
  const b = blocked.find((x) => x.id === rule);
  const who = (x: BlockRule) => (x.kind === 'domain' ? t('Everyone at @{domain}', { domain: x.value }) : x.value);
  return (
    <>
      {/* A signature per address you send from, smart compose and the default reply (src/components/mail/MailWriting.tsx). */}
      <SignaturesPhone s={s} update={update} ws={ws} me={me} />
      {extras}
      <WritingPhone s={s} update={update} />
      <Group footer={s.undoSend ? tn(s.undoSend, 'Your email waits {n} second before it goes out, so Undo can take it back and nobody gets it.', 'Your email waits {n} seconds before it goes out, so Undo can take it back and nobody gets it.') : t('Your email goes out the moment you press Send.')}>
        <ChoiceRow
          label={t('Undo send')}
          value={String(s.undoSend)}
          onChange={(v) => update({ undoSend: Number(v) })}
          options={[0, 5, 10, 20, 30].map((n) => ({ value: String(n), label: n ? t('{n}s', { n }) : tx('undo send', 'Off') }))}
        />
      </Group>
      {ws.readTracking === false ? (
        <Group title={t('Read tracking')} footer={canManage ? t('You can turn it back on in Security & data.') : t('An owner or admin turned it off for everyone.')}>
          <GRow label={t('Read tracking is off for {company}', { company: ws.name || t('your company') })} onClick={canManage ? onSecurity : undefined} />
          <GRow label={t('Trackers in emails you receive are blocked')} value={t('Always on')} />
        </Group>
      ) : (
        <Group title={t('Read tracking')} footer={t('Your team’s internal email is never tracked. If you email people in the EU, mention tracking in your privacy policy.')}>
          <SwitchRow label={t('Track opens on emails to people outside the team')} on={s.trackByDefault} onChange={(v) => update({ trackByDefault: v })} />
          <SwitchRow label={t('Tell me when someone opens')} on={s.notifyOpens} onChange={(v) => update({ notifyOpens: v })} />
          <GRow label={t('Trackers in emails you receive are blocked')} value={t('Always on')} />
        </Group>
      )}
      <Group title={t('Blocked senders')} footer={blocked.length ? undefined : t('Nobody yet. Use “Block” on any email to stop a sender for good.')}>
        {blocked.length === 0 ? <GRow label={t('Nobody blocked')} /> : blocked.map((x) => <GRow key={x.id} icon={Ban} plainIcon label={who(x)} onClick={() => setRule(x.id)} />)}
      </Group>

      {b && (
        <PushScreen title={t('Blocked sender')} onBack={() => setRule(null)} className="g-page g-edit">
          <div className="g-body">
            <Group footer={t('Their email is deleted on arrival. Unblock to get it in your inbox again.')}>
              <GRow label={b.kind === 'domain' ? t('Domain') : t('Address')} value={who(b)} />
              <GRow label={t('Blocked')} value={fmtDate(b.at, { day: 'numeric', month: 'short', year: 'numeric' })} />
            </Group>
            <Group>
              <GRow label={t('Unblock')} action onClick={() => (onUnblock(b.id), setRule(null))} />
            </Group>
          </div>
        </PushScreen>
      )}
    </>
  );
}

/** Change your password on a phone: current and new on their own screen. */
export function PasswordPhone({ on, save }: { on: boolean; save: (cur: string, next: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GRow label={t('Password')} value={on ? undefined : t('Not available')} onClick={on ? () => setOpen(true) : undefined} />
      {open && <PasswordScreen save={save} onBack={() => setOpen(false)} />}
    </>
  );
}

function PasswordScreen({ save, onBack }: { save: (cur: string, next: string) => Promise<string | null>; onBack: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <EditScreen title={t('Change password')} onBack={onBack} canSave={!!cur && next.length >= 8} onSave={() => save(cur, next)}>
      <Group footer={t('At least 8 characters')}>
        <div className="g-row g-field-row">
          <input className="g-input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={t('Current password')} aria-label={t('Current password')} autoComplete="current-password" autoFocus />
        </div>
        <div className="g-row g-field-row">
          <input className="g-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={t('New password')} aria-label={t('New password')} autoComplete="new-password" />
        </div>
      </Group>
    </EditScreen>
  );
}

/** Delete your account on a phone: a red row; its screen asks for the password. */
export function DeleteAccountPhone({ go }: { go: (pw: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  return (
    <>
      <Group footer={t('Your sign-in goes for good. What you made stays with the company, marked as a deleted account.')}>
        <GRow label={t('Delete your account')} danger onClick={() => setOpen(true)} />
      </Group>
      {open && (
        <EditScreen title={t('Delete your account')} saveLabel={t('Delete')} danger onBack={() => (setOpen(false), setPw(''))} canSave={!!pw} onSave={() => go(pw)}>
          <p className="g-note">{t('Your sign-in goes for good. What you made stays with the company, marked as a deleted account.')}</p>
          <Group>
            <div className="g-row g-field-row">
              <input className="g-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password, to be sure it’s you')} aria-label={t('Password')} autoComplete="current-password" autoFocus />
            </div>
          </Group>
        </EditScreen>
      )}
    </>
  );
}

