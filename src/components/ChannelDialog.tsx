import { useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { term } from '../terms';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { Archive, Globe, Hash, Lock, Mail, Megaphone, Plus, Users, X } from 'lucide-react';
import type { Channel, ChannelCategory, Client, Guest, Policy, Team, User } from '../types';
import { Badge, PersonCell } from './ui/Person';
import { Dot, Select } from './ui/Select';
import { mark, t, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtMoney } from '../i18n/format';

// The category names stay English here (mark): ChatApp saves CATEGORY_NAME into the company's chat layout, which
// everyone reads. Show them with categoryText(CATEGORY_NAME[c]) / categoryText(CATEGORY_ONE[c]).
export const CATEGORY_NAME: Record<ChannelCategory, string> = { get client() { return term.word === 'client' ? mark('Clients') : mark('Projects'); }, shared: mark('Shared'), team: mark('Teams'), get project() { return term.word === 'project' ? mark('Other') : mark('Projects'); }, social: mark('Social') };
/** The name on one channel's category. */
export const CATEGORY_ONE: Record<ChannelCategory, string> = { get client() { return term.word === 'client' ? mark('Client (internal)') : mark('Project (internal)'); }, shared: mark('Shared'), team: mark('Team'), get project() { return term.word === 'project' ? mark('Other') : mark('Project'); }, social: mark('Social') };
/** A category's name (from CATEGORY_NAME or CATEGORY_ONE) in the reader's language. "Shared" is a kind of channel
 *  here ("Bersama"), not "shared with" ("Dibagikan"), so it has its own key. */
export const categoryText = (name: string) => (name === 'Shared' ? tx('category', 'Shared') : t(name));
/** What each category is for, in the reader's language. */
const categoryHint = (c: ChannelCategory) =>
  c === 'client'
    ? t('Our team about one {project}. They never see it', { project: term.one })
    : c === 'shared'
      ? t('With people from outside, invited as {guests}', { guests: term.whos })
      : c === 'team'
        ? t('A department or the whole company')
        : c === 'project'
          ? term.word === 'project'
            ? t('Planning, hiring, anything that isn’t one project')
            : t('A piece of work with an end date')
          : t('Lunch, wins, weekend plans');

export type ChannelDraft = Omit<Channel, 'id' | 'workspaceId' | 'kind'>;

interface Props {
  channel?: Channel; // editing; otherwise creating
  users: User[];
  clients: Client[];
  teams: Team[];
  me: string;
  canManage: boolean; // owner/admin or the channel's owner
  guestsAllowed: boolean; // the plan allows more client guests
  summaryCost: string; // what one AI summary costs this company, in plain words
  onSave: (c: ChannelDraft) => void;
  onArchive?: () => void;
  onClose: () => void;
}

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');

/** New channel, and later the same window as channel settings: about, people, permissions. */
export function ChannelDialog({ channel, users, clients, teams, me, canManage, guestsAllowed, summaryCost, onSave, onArchive, onClose }: Props) {
  const editing = !!channel;
  const [tab, setTab] = useState<'about' | 'people' | 'permissions'>('about');
  const [name, setName] = useState(channel?.name ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [category, setCategory] = useState<ChannelCategory>(channel?.category ?? 'project');
  const [clientId, setClientId] = useState(channel?.clientId ?? '');
  const [teamId, setTeamId] = useState(channel?.teamId ?? '');
  const [priv, setPriv] = useState(!!channel?.private);
  const [members, setMembers] = useState<string[]>(channel?.members ?? [me]);
  const [guests, setGuests] = useState<Guest[]>(channel?.guests ?? []);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [postPolicy, setPostPolicy] = useState<Policy>(channel?.postPolicy ?? 'everyone');
  const [invitePolicy, setInvitePolicy] = useState<Policy>(channel?.invitePolicy ?? 'everyone');
  const [q, setQ] = useState('');
  const shared = channel?.sharedWith ?? null; // shared channels between companies are parked
  const [schedule, setSchedule] = useState<NonNullable<Channel['summary']>['schedule']>(channel?.summary?.schedule ?? (channel?.digest ? 'daily' : 'monthly'));
  const [postSummary, setPostSummary] = useState(channel?.summary?.post ?? false);

  const client = clients.find((c) => c.id === clientId);
  const pickCategory = (c: ChannelCategory) => {
    setCategory(c);
    if (c !== 'client' && c !== 'shared') setClientId('');
    if (c !== 'team') setTeamId('');
  };
  const pickClient = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c && !name) setName(slug(c.name));
  };
  const pickTeam = (id: string) => {
    setTeamId(id);
    const team = teams.find((x) => x.id === id);
    if (team) {
      if (!name) setName(slug(team.name));
      setMembers((m) => [...new Set([...m, ...team.members])]);
    }
  };
  const addGuest = () => {
    const email = guestEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || guests.some((g) => g.email === email)) return;
    setGuests((g) => [...g, { email, name: guestName.trim() || email.split('@')[0], status: 'invited', invitedBy: me, at: new Date().toISOString() }]);
    setGuestName('');
    setGuestEmail('');
  };
  const guestDomainWarn = client?.domain && guestEmail.includes('@') && !guestEmail.toLowerCase().endsWith('@' + client.domain);

  const save = () => {
    if (!name.trim()) return;
    onSave({
      name: slug(name),
      topic: topic.trim() || undefined,
      category,
      clientId: clientId || undefined,
      teamId: teamId || undefined,
      private: priv,
      members: [...new Set([...members, me])],
      guests: category === 'shared' ? guests : [],
      postPolicy,
      invitePolicy,
      sharedWith: shared ?? undefined,
      summary: { schedule, post: postSummary, history: channel?.summary?.history ?? [] },
      ownerId: channel?.ownerId ?? me,
      createdAt: channel?.createdAt ?? new Date().toISOString(),
    });
  };

  const shownUsers = users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
  const readOnly = editing && !canManage;

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal chan-modal" role="dialog" aria-label={editing ? t('Channel settings') : t('New channel')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            {priv ? <Lock size={15} /> : <Hash size={15} />} {editing ? `#${channel!.name}` : t('New channel')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="client-tabs dialog-tabs" role="tablist">
          {(
            [
              ['about', t('About'), 0],
              ['people', t('People'), members.length + guests.length],
              ['permissions', t('Permissions'), 0],
            ] as const
          ).map(([id, l, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {l}
              {n > 0 && <span className="tab-count">{n}</span>}
            </button>
          ))}
        </div>

        <div className="modal-body chan-body">
          <SmoothHeight>
          <TabPane key={tab}>
          {readOnly && <p className="muted small">{t('Only the channel owner and admins can change these settings.')}</p>}
          {tab === 'about' && (
            <fieldset disabled={readOnly}>
              <label className="field">
                <span>{t('Name')}</span>
                <div className="chan-name">
                  <Hash size={15} />
                  <input autoFocus={!editing} value={name} onChange={(e) => setName(slug(e.target.value))} placeholder={t('e.g. glowkind-launch')} maxLength={60} />
                </div>
              </label>
              <label className="field">
                <span>{t('What’s it for?')}</span>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('One line people see under the name')} />
              </label>
              <div className="field">
                <span>{t('Category')}</span>
                <div className="cat-pick">
                  {(Object.keys(CATEGORY_NAME) as ChannelCategory[]).map((c) => (
                    <button key={c} type="button" className={category === c ? 'on' : ''} onClick={() => pickCategory(c)}>
                      <strong>{categoryText(CATEGORY_ONE[c])}</strong>
                      <small>{categoryHint(c)}</small>
                    </button>
                  ))}
                </div>
              </div>
              {(category === 'client' || category === 'shared') && (
                <div className="field">
                  <span>{term.One}</span>
                  <ProjectPicker value={clientId} onChange={pickClient} projects={clients} />
                </div>
              )}
              {category === 'team' && (
                <div className="field">
                  <span>{t('Team')}</span>
                  <Select value={teamId} onChange={pickTeam} label={t('Team')} placeholder={t('Pick a team (optional)')} options={teams.map((tm) => ({ value: tm.id, label: tm.name, icon: <Dot color={tm.color} /> }))} />
                </div>
              )}
              <div className="field">
                <span>{t('AI summary of this channel')}</span>
                <div className="summary-pick">
                  <Select
                    value={schedule}
                    onChange={setSchedule}
                    label={t('AI summary')}
                    width={300}
                    options={[
                      { value: 'monthly', label: t('Monthly (default)'), hint: t('On the 1st, for the month before') },
                      { value: 'weekly', label: t('Weekly'), hint: t('Every Monday, for the week before') },
                      { value: 'daily', label: t('Daily'), hint: t('Only on days with new messages. For busy channels') },
                      { value: 'off', label: t('Off'), hint: t('People can still ask for one on the Summary tab') },
                    ]}
                  />
                  <small className="muted">{schedule === 'off' ? t('No automatic summaries.') : t('Each update uses {cost}. Skipped when nothing happened.', { cost: summaryCost })}</small>
                </div>
                {schedule !== 'off' && (
                  <label className="check-row small">
                    <input type="checkbox" checked={postSummary} onChange={(e) => setPostSummary(e.target.checked)} /> {t('Also post each summary in the channel')}
                  </label>
                )}
              </div>
              <div className="field">
                <span>{t('Who can find it')}</span>
                <div className="segmented wide">
                  <button type="button" className={!priv ? 'on' : ''} onClick={() => setPriv(false)}>
                    <Globe size={14} /> {t('Public')}
                  </button>
                  <button type="button" className={priv ? 'on' : ''} onClick={() => setPriv(true)}>
                    <Lock size={14} /> {t('Private')}
                  </button>
                </div>
                <small className="muted">{priv ? t('Invite only: people join when someone adds them.') : t('Anyone in the company can find it and join.')}</small>
              </div>
            </fieldset>
          )}

          {tab === 'people' && (
            <fieldset disabled={readOnly}>
              <label className="sel-search boxed">
                <Users size={14} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find teammates…')} />
              </label>
              <div className="people-pick">
                {shownUsers.map((u) => {
                  const on = members.includes(u.id);
                  return (
                    <label key={u.id} className={`pp-row ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={u.id === me} onChange={() => setMembers((m) => (on ? m.filter((x) => x !== u.id) : [...m, u.id]))} />
                      <PersonCell person={u} size={28} sub={u.title || u.email} badges={u.id === me && <Badge tone="accent">{t('You')}</Badge>} />
                    </label>
                  );
                })}
              </div>
              <div className="pp-actions">
                <button type="button" className="link-btn" onClick={() => setMembers(users.map((u) => u.id))}>
                  {t('Add everyone')}
                </button>
                {teamId && (
                  <button type="button" className="link-btn" onClick={() => setMembers((m) => [...new Set([...m, ...(teams.find((tm) => tm.id === teamId)?.members ?? [])])])}>
                    {t('Add the whole team')}
                  </button>
                )}
              </div>

              {category === 'shared' ? (
              <div className="guest-box">
                <div className="gb-head">
                  <Mail size={15} />
                  <strong>{t('Guests')}</strong>
                  <span className="muted small">{t('People outside the company. They only see channels you add them to.')}</span>
                </div>
                {guests.map((g) => (
                  <div key={g.email} className="guest-row">
                    <PersonCell person={g} size={28} />
                    <Badge tone={g.status === 'joined' ? 'good' : 'neutral'}>{g.status === 'joined' ? t('Joined') : t('Invite sent')}</Badge>
                    <button type="button" className="icon-btn sm" onClick={() => setGuests((x) => x.filter((y) => y.email !== g.email))} aria-label={t('Remove guest')}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {guestsAllowed ? (
                  <div className="guest-add">
                    <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={t('Name')} />
                    <input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGuest()} placeholder={client?.domain ? t('name@{domain}', { domain: client.domain }) : t('name@client.com')} />
                    <button type="button" className="ghost-btn sm" onClick={addGuest}>
                      <Plus size={13} /> {t('Invite')}
                    </button>
                  </div>
                ) : (
                  <p className="gate">
                    {tj('Free includes 1 guest. {upgrade} to invite more {guests}.', {
                      upgrade: <strong>{t('Upgrade to Small ({price} per person)', { price: fmtMoney(39000) })}</strong>,
                      guests: term.whos,
                    })}
                  </p>
                )}
                {guestDomainWarn && <p className="muted small">{t('Heads up: this address isn’t at @{domain}.', { domain: client!.domain! })}</p>}
              </div>
              ) : (
                <p className="muted small guest-note">
                  {category === 'client' ? t('Only your team is here. To talk with the {guest}, make a channel with the “Shared” category.', { guest: term.who }) : t('Only your team is here. Guests can only join “Shared” channels.')}
                </p>
              )}
            </fieldset>
          )}

          {tab === 'permissions' && (
            <fieldset disabled={readOnly}>
              <div className="field">
                <span>{t('Who can post')}</span>
                <Select<Policy>
                  value={postPolicy}
                  onChange={setPostPolicy}
                  label={t('Who can post')}
                  options={[
                    { value: 'everyone', label: t('Everyone in the channel'), icon: <Users size={15} /> },
                    { value: 'admins', label: t('Only admins and the owner'), hint: t('For announcements. Others can still react and reply in threads'), icon: <Megaphone size={15} /> },
                  ]}
                />
              </div>
              <div className="field">
                <span>{t('Who can add people')}</span>
                <Select<Policy>
                  value={invitePolicy}
                  onChange={setInvitePolicy}
                  label={t('Who can add people')}
                  options={[
                    { value: 'everyone', label: t('Anyone in the channel') },
                    { value: 'admins', label: t('Only admins and the owner') },
                  ]}
                />
              </div>
              <ul className="perm-notes">
                <li>{t('Guests can read and post here, react and reply. They can’t see other channels, people’s profiles or your tasks unless you share them.')}</li>
                <li>{priv ? t('Private: only members see this channel and its files.') : t('Public: anyone in the company can find and join it.')}</li>
              </ul>
            </fieldset>
          )}
          </TabPane>
          </SmoothHeight>
        </div>

        <footer className="modal-foot">
          {editing && onArchive && canManage && (
            <button className="ghost-btn danger-text" onClick={onArchive}>
              <Archive size={14} /> {t('Archive channel')}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {readOnly ? t('Close') : t('Cancel')}
          </button>
          {!readOnly && (
            <button className="primary-btn" onClick={save} disabled={!name.trim() || ((category === 'client' || category === 'shared') && !clientId)}>
              {editing ? t('Save') : t('Create channel')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
