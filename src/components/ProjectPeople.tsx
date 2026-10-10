import { useRef, useState } from 'react';
import { UserPlus, Users, X } from 'lucide-react';
import type { Client, User } from '../types';
import { term } from '../terms';
import { Avatar } from './Avatar';
import { Badge, PersonCell } from './ui/Person';
import { Popover } from './ui/Popover';
import { Select } from './ui/Select';
import { personOption } from './ui/PeopleList';
import { t } from '../i18n';

/**
 * Who's on a project: the owner, teammates (Lead or Member) and guests. Teammates on it see it in their
 * sidebar and get its news; guests are invited from the Guests tab.
 */
export function ProjectPeople({ client, users, me, canEdit, canInvite = canEdit, onPatch, onGuests, compact }: { client: Client; users: User[]; me: string; canEdit: boolean; canInvite?: boolean; onPatch: (p: Partial<Client>) => void; onGuests: () => void; compact?: boolean /* the phone's top bar: a people icon */ }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const members = client.members ?? [];
  const owner = users.find((u) => u.id === client.ownerId);
  const team = [owner, ...members.map((m) => users.find((u) => u.id === m.userId))].filter((u, i, a): u is User => !!u && a.findIndex((x) => x?.id === u.id) === i);
  const guests = (client.people ?? []).filter((x) => x.status !== 'pending');
  const free = users.filter((u) => u.id !== client.ownerId && !members.some((m) => m.userId === u.id));
  const add = (id: string) => onPatch({ members: [...members, { userId: id, role: 'member', addedBy: me, at: new Date().toISOString() }] });
  return (
    <>
      {compact ? (
        <button ref={ref} type="button" className="icon-btn tv-pill-btn" onClick={() => setOpen(true)} aria-label={t('People on this {project}', { project: term.one })} title={t('People on this {project}', { project: term.one })}>
          <Users size={20} />
        </button>
      ) : (
      <button ref={ref} type="button" className="proj-people" onClick={() => setOpen(true)} title={t('People on this {project}', { project: term.one })}>
        <span className="avatar-stack">
          {team.slice(0, 4).map((u) => (
            <Avatar key={u.id} person={u} size={24} />
          ))}
        </span>
        {team.length + guests.length > 4 && <span className="muted small">+{team.length + guests.length - 4}</span>}
        <span className="proj-people-add">
          <UserPlus size={14} /> <span className="lbl">{t('Invite')}</span>
        </span>
      </button>
      )}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={320} align="end" title={t('People on {name}', { name: client.name })}>
        <div className="pp-list">
          <span className="pp-head">{t('Team')}</span>
          {owner && (
            <div className="pp-row">
              <PersonCell person={owner} size={28} sub={null} badges={owner.id === me && <Badge tone="accent">{t('You')}</Badge>} />
              <span className="muted small">{t('Owner')}</span>
            </div>
          )}
          {members
            .filter((m) => m.userId !== client.ownerId)
            .map((m) => {
              const u = users.find((x) => x.id === m.userId);
              if (!u) return null;
              return (
                <div key={m.userId} className="pp-row">
                  <PersonCell person={u} size={28} sub={null} badges={u.id === me && <Badge tone="accent">{t('You')}</Badge>} />
                  {canEdit ? (
                    <>
                      <Select<'lead' | 'member'>
                        value={m.role}
                        onChange={(role) => onPatch({ members: members.map((x) => (x.userId === m.userId ? { ...x, role } : x)) })}
                        label={t('Role')}
                        className="sel-flat"
                        options={[
                          { value: 'lead', label: t('Lead'), hint: t('Runs it day to day') },
                          { value: 'member', label: t('Member'), hint: t('Works on it') },
                        ]}
                      />
                      <button type="button" className="icon-btn sm" aria-label={t('Take {name} off', { name: u.name })} onClick={() => onPatch({ members: members.filter((x) => x.userId !== m.userId) })}>
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <span className="muted small">{m.role === 'lead' ? t('Lead') : t('Member')}</span>
                  )}
                </div>
              );
            })}
          {canEdit && free.length > 0 && (
            <Select<string>
              value={null}
              onChange={add}
              placeholder={t('+ Add a teammate')}
              label={t('Add a teammate')}
              className="sel-flat"
              searchable
              options={free.map((u) => ({ ...personOption(u), label: u.name, hint: u.title, icon: <Avatar person={u} size={20} /> }))}
            />
          )}
          <span className="pp-head">{t('Guests')}</span>
          {guests.length ? (
            guests.map((g) => (
              <div key={g.email} className="pp-row">
                <PersonCell person={{ name: g.name, email: g.email, color: client.color }} size={28} sub={g.company ?? null} />
                <span className="muted small">{g.status === 'invited' ? t('Invited') : g.role === 'approver' ? t('Approver') : g.role === 'viewer' ? t('Viewer') : t('Collaborator')}</span>
              </div>
            ))
          ) : (
            <p className="muted small">{t('No guests yet. Guests see what you share in their own space.')}</p>
          )}
          {canInvite && (
            <button type="button" className="ghost-btn sm" onClick={() => (setOpen(false), onGuests())}>
              <UserPlus size={13} /> {t('Invite a guest')}
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}
