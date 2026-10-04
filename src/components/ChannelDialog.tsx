import { useState } from 'react';
import { Archive, Globe, Hash, Lock, Mail, Megaphone, Plus, Users, X } from 'lucide-react';
import type { Channel, ChannelCategory, Client, Guest, Policy, Team, User } from '../types';
import { Avatar } from './Avatar';
import { Dot, Select } from './ui/Select';

export const CATEGORY_NAME: Record<ChannelCategory, string> = { client: 'Clients', team: 'Teams', project: 'Projects', social: 'Social' };
const CATEGORY_HINT: Record<ChannelCategory, string> = {
  client: 'Everything about one client',
  team: 'A department or the whole company',
  project: 'A piece of work with an end date',
  social: 'Lunch, wins, weekend plans',
};

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
    if (c !== 'client') setClientId('');
    if (c !== 'team') setTeamId('');
  };
  const pickClient = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c && !name) setName(slug(c.name));
  };
  const pickTeam = (id: string) => {
    setTeamId(id);
    const t = teams.find((x) => x.id === id);
    if (t) {
      if (!name) setName(slug(t.name));
      setMembers((m) => [...new Set([...m, ...t.members])]);
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
      guests,
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
      <div className="modal chan-modal" role="dialog" aria-label={editing ? 'Channel settings' : 'New channel'} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            {priv ? <Lock size={15} /> : <Hash size={15} />} {editing ? `#${channel!.name}` : 'New channel'}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="client-tabs chan-tabs">
          {(
            [
              ['about', 'About'],
              ['people', `People · ${members.length + guests.length}`],
              ['permissions', 'Permissions'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {l}
            </button>
          ))}
        </div>

        <div className="modal-body chan-body">
          {readOnly && <p className="muted small">Only the channel owner and admins can change these settings.</p>}
          {tab === 'about' && (
            <fieldset disabled={readOnly}>
              <label className="field">
                <span>Name</span>
                <div className="chan-name">
                  <Hash size={15} />
                  <input autoFocus={!editing} value={name} onChange={(e) => setName(slug(e.target.value))} placeholder="e.g. glowkind-launch" maxLength={60} />
                </div>
              </label>
              <label className="field">
                <span>What’s it for?</span>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="One line people see under the name" />
              </label>
              <div className="field">
                <span>Category</span>
                <div className="cat-pick">
                  {(Object.keys(CATEGORY_NAME) as ChannelCategory[]).map((c) => (
                    <button key={c} type="button" className={category === c ? 'on' : ''} onClick={() => pickCategory(c)}>
                      <strong>{CATEGORY_NAME[c].replace(/s$/, '')}</strong>
                      <small>{CATEGORY_HINT[c]}</small>
                    </button>
                  ))}
                </div>
              </div>
              {category === 'client' && (
                <div className="field">
                  <span>Client</span>
                  <Select value={clientId} onChange={pickClient} label="Client" placeholder="Pick a client" options={clients.map((c) => ({ value: c.id, label: c.name, hint: c.domain ? '@' + c.domain : undefined, icon: <Dot color={c.color} /> }))} />
                </div>
              )}
              {category === 'team' && (
                <div className="field">
                  <span>Team</span>
                  <Select value={teamId} onChange={pickTeam} label="Team" placeholder="Pick a team (optional)" options={teams.map((t) => ({ value: t.id, label: t.name, icon: <Dot color={t.color} /> }))} />
                </div>
              )}
              <div className="field">
                <span>AI summary of this channel</span>
                <div className="summary-pick">
                  <Select
                    value={schedule}
                    onChange={setSchedule}
                    label="AI summary"
                    width={300}
                    options={[
                      { value: 'monthly', label: 'Monthly (default)', hint: 'On the 1st, for the month before' },
                      { value: 'weekly', label: 'Weekly', hint: 'Every Monday, for the week before' },
                      { value: 'daily', label: 'Daily', hint: 'Only on days with new messages. For busy channels' },
                      { value: 'off', label: 'Off', hint: 'People can still ask for one on the Summary tab' },
                    ]}
                  />
                  <small className="muted">{schedule === 'off' ? 'No automatic summaries.' : `Each update uses ${summaryCost}. Skipped when nothing happened.`}</small>
                </div>
                {schedule !== 'off' && (
                  <label className="check-row small">
                    <input type="checkbox" checked={postSummary} onChange={(e) => setPostSummary(e.target.checked)} /> Also post each summary in the channel
                  </label>
                )}
              </div>
              <div className="field">
                <span>Who can find it</span>
                <div className="segmented wide">
                  <button type="button" className={!priv ? 'on' : ''} onClick={() => setPriv(false)}>
                    <Globe size={14} /> Public: anyone in the company can join
                  </button>
                  <button type="button" className={priv ? 'on' : ''} onClick={() => setPriv(true)}>
                    <Lock size={14} /> Private: invite only
                  </button>
                </div>
              </div>
            </fieldset>
          )}

          {tab === 'people' && (
            <fieldset disabled={readOnly}>
              <label className="sel-search boxed">
                <Users size={14} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find teammates…" />
              </label>
              <div className="people-pick">
                {shownUsers.map((u) => {
                  const on = members.includes(u.id);
                  return (
                    <label key={u.id} className={`pp-row ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={u.id === me} onChange={() => setMembers((m) => (on ? m.filter((x) => x !== u.id) : [...m, u.id]))} />
                      <Avatar person={u} size={26} />
                      <span>
                        <strong>
                          {u.name}
                          {u.id === me ? ' (you)' : ''}
                        </strong>
                        <small>{u.title}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="pp-actions">
                <button type="button" className="link-btn" onClick={() => setMembers(users.map((u) => u.id))}>
                  Add everyone
                </button>
                {teamId && (
                  <button type="button" className="link-btn" onClick={() => setMembers((m) => [...new Set([...m, ...(teams.find((t) => t.id === teamId)?.members ?? [])])])}>
                    Add the whole team
                  </button>
                )}
              </div>

              <div className="guest-box">
                <div className="gb-head">
                  <Mail size={15} />
                  <strong>Client guests</strong>
                  <span className="muted small">People outside the company. They only see channels you add them to.</span>
                </div>
                {guests.map((g) => (
                  <div key={g.email} className="guest-row">
                    <span className="guest-av">{g.name.charAt(0).toUpperCase()}</span>
                    <span className="gr-text">
                      <strong>{g.name}</strong>
                      <small>{g.email}</small>
                    </span>
                    <span className={`guest-status ${g.status}`}>{g.status === 'joined' ? 'Joined' : 'Invite sent'}</span>
                    <button type="button" className="icon-btn sm" onClick={() => setGuests((x) => x.filter((y) => y.email !== g.email))} aria-label="Remove guest">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {guestsAllowed ? (
                  <div className="guest-add">
                    <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Name" />
                    <input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGuest()} placeholder={client?.domain ? `name@${client.domain}` : 'name@client.com'} />
                    <button type="button" className="ghost-btn sm" onClick={addGuest}>
                      <Plus size={13} /> Invite
                    </button>
                  </div>
                ) : (
                  <p className="gate">
                    Free includes 1 client guest. <strong>Upgrade to Small (Rp 39.000 per person)</strong> to invite more clients.
                  </p>
                )}
                {guestDomainWarn && <p className="muted small">Heads up: this address isn’t at @{client!.domain}.</p>}
              </div>
            </fieldset>
          )}

          {tab === 'permissions' && (
            <fieldset disabled={readOnly}>
              <div className="field">
                <span>Who can post</span>
                <Select<Policy>
                  value={postPolicy}
                  onChange={setPostPolicy}
                  label="Who can post"
                  options={[
                    { value: 'everyone', label: 'Everyone in the channel', icon: <Users size={15} /> },
                    { value: 'admins', label: 'Only admins and the owner', hint: 'For announcements. Others can still react and reply in threads', icon: <Megaphone size={15} /> },
                  ]}
                />
              </div>
              <div className="field">
                <span>Who can add people</span>
                <Select<Policy>
                  value={invitePolicy}
                  onChange={setInvitePolicy}
                  label="Who can add people"
                  options={[
                    { value: 'everyone', label: 'Anyone in the channel' },
                    { value: 'admins', label: 'Only admins and the owner' },
                  ]}
                />
              </div>
              <ul className="perm-notes">
                <li>Client guests can read and post here, react and reply. They can’t see other channels, people’s profiles or your tasks unless you share them.</li>
                <li>{priv ? 'Private: only members see this channel and its files.' : 'Public: anyone in the company can find and join it.'}</li>
              </ul>
            </fieldset>
          )}
        </div>

        <footer className="modal-foot">
          {editing && onArchive && canManage && (
            <button className="ghost-btn danger-text" onClick={onArchive}>
              <Archive size={14} /> Archive channel
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button className="primary-btn" onClick={save} disabled={!name.trim() || (category === 'client' && !clientId)}>
              {editing ? 'Save' : 'Create channel'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
