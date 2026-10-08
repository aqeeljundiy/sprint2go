import { useRef, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { Client, User } from '../types';
import { term } from '../terms';
import { Avatar } from './Avatar';
import { Popover } from './ui/Popover';
import { Select } from './ui/Select';

/**
 * Who's on a project: the owner, teammates (Lead or Member) and guests. Teammates on it see it in their
 * sidebar and get its news; guests are invited from the Guests tab.
 */
export function ProjectPeople({ client, users, me, canEdit, onPatch, onGuests }: { client: Client; users: User[]; me: string; canEdit: boolean; onPatch: (p: Partial<Client>) => void; onGuests: () => void }) {
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
      <button ref={ref} type="button" className="proj-people" onClick={() => setOpen(true)} title={`People on this ${term.one}`}>
        <span className="avatar-stack">
          {team.slice(0, 4).map((u) => (
            <Avatar key={u.id} person={u} size={24} />
          ))}
        </span>
        {team.length + guests.length > 4 && <span className="muted small">+{team.length + guests.length - 4}</span>}
        <span className="proj-people-add">
          <UserPlus size={14} /> <span className="lbl">Invite</span>
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={320} align="end" title={`People on ${client.name}`}>
        <div className="pp-list">
          <span className="pp-head">Team</span>
          {owner && (
            <div className="pp-row">
              <Avatar person={owner} size={26} />
              <span className="pp-name">{owner.name}</span>
              <span className="muted small">Owner</span>
            </div>
          )}
          {members
            .filter((m) => m.userId !== client.ownerId)
            .map((m) => {
              const u = users.find((x) => x.id === m.userId);
              if (!u) return null;
              return (
                <div key={m.userId} className="pp-row">
                  <Avatar person={u} size={26} />
                  <span className="pp-name">{u.name}</span>
                  {canEdit ? (
                    <>
                      <Select<'lead' | 'member'>
                        value={m.role}
                        onChange={(role) => onPatch({ members: members.map((x) => (x.userId === m.userId ? { ...x, role } : x)) })}
                        label="Role"
                        className="sel-flat"
                        options={[
                          { value: 'lead', label: 'Lead', hint: 'Runs it day to day' },
                          { value: 'member', label: 'Member', hint: 'Works on it' },
                        ]}
                      />
                      <button type="button" className="icon-btn sm" aria-label={`Take ${u.name} off`} onClick={() => onPatch({ members: members.filter((x) => x.userId !== m.userId) })}>
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <span className="muted small">{m.role === 'lead' ? 'Lead' : 'Member'}</span>
                  )}
                </div>
              );
            })}
          {canEdit && free.length > 0 && (
            <Select<string>
              value={null}
              onChange={add}
              placeholder="+ Add a teammate"
              label="Add a teammate"
              className="sel-flat"
              searchable
              options={free.map((u) => ({ value: u.id, label: u.name, hint: u.title, icon: <Avatar person={u} size={20} /> }))}
            />
          )}
          <span className="pp-head">Guests</span>
          {guests.length ? (
            guests.map((g) => (
              <div key={g.email} className="pp-row">
                <Avatar person={{ name: g.name, email: g.email, color: client.color }} size={26} />
                <span className="pp-name">
                  {g.name}
                  {g.company ? <small className="muted"> · {g.company}</small> : null}
                </span>
                <span className="muted small">{g.status === 'invited' ? 'Invited' : g.role === 'approver' ? 'Approver' : g.role === 'viewer' ? 'Viewer' : 'Collaborator'}</span>
              </div>
            ))
          ) : (
            <p className="muted small">No guests yet. Guests see what you share in their own space.</p>
          )}
          <button type="button" className="ghost-btn sm" onClick={() => (setOpen(false), onGuests())}>
            <UserPlus size={13} /> Invite a guest
          </button>
        </div>
      </Popover>
    </>
  );
}
