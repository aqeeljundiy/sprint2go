import { useEffect, useState } from 'react';
import { Inbox, Plus, Users, UsersRound, X } from 'lucide-react';
import type { MailGroup, User, Workspace } from '../../types';
import { server } from '../../sync';
import { Layer } from '../ui/Layer';
import { Select, type Option } from '../ui/Select';
import { PeoplePicker } from '../ui/PeoplePicker';
import { SmoothHeight, useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { Badge } from '../ui/Person';
import { loadGroups, saveGroups, type GroupsInfo } from './teamsApi';
import { BusyButton, ErrorLine } from './teamsBits';
import { mark, t, tn, tx } from '../../i18n';
import './teams.css';

/*
 * Settings, Groups & shared inboxes (company): addresses like sales@ that deliver to several people (a group) or into
 * one shared inbox they work from together, where a conversation can be given to one of them (server/mailGroups.ts).
 * Admins make and remove them; a group's owners change who's in it and who may write to it. Each one is edited in a
 * dialog (a job with a start and an end).
 */
export const MAIL_GROUPS_SECTION = { id: 'mailgroups' as const, name: mark('Groups & shared inboxes'), icon: UsersRound, group: 'Company' as const };

const POST: { value: MailGroup['whoCanPost']; label: string; hint: string }[] = [
  { value: 'anyone', label: mark('Anyone'), hint: mark('Customers and other outside people can write to it') },
  { value: 'company', label: mark('People at the company'), hint: mark('Only addresses at your domain') },
  { value: 'members', label: mark('Only its people'), hint: mark('Its owners and members') },
];
const postWords = (w: MailGroup['whoCanPost']) => t(POST.find((p) => p.value === w)?.label ?? 'Anyone');

export function MailGroups({ ws, users, me, toast }: { ws: Workspace; users: User[]; me: string; toast: (text: string) => void }) {
  const [info, setInfo] = useState<GroupsInfo | null | 'failed'>(null);
  const [editing, setEditing] = useState<Partial<MailGroup> | null>(null);
  useEffect(() => {
    if (server.on) void loadGroups(ws.id).then(setInfo, () => setInfo('failed'));
  }, [ws.id]);
  const d = info && info !== 'failed' ? info : null;
  const rows = useLeaving(d?.groups ?? [], (g) => g.id);
  const team = users.filter((u) => ws.members.some((m) => m.userId === u.id));
  if (!server.on)
    return (
      <>
        <h2>{t('Groups & shared inboxes')}</h2>
        <p className="set-intro">{t('Addresses like sales@ for several people. This works with sprint2go on a server; this demo has none.')}</p>
      </>
    );
  const save = async (list: Partial<MailGroup>[], done: string) => {
    const r = await saveGroups(ws.id, list);
    setInfo((x) => (x && x !== 'failed' ? { ...x, groups: r.groups } : x));
    toast(done);
  };
  return (
    <>
      <h2>{t('Groups & shared inboxes')}</h2>
      <p className="set-intro">{t('An address like sales@ that reaches several people. A group sends a copy to each person’s own inbox; a shared inbox keeps one copy everyone works from, and each conversation can be given to one person.')}</p>
      <SmoothHeight>
        {info === null ? (
          <p className="muted small">{t('Checking…')}</p>
        ) : !d ? (
          <p className="set-hint">{t('Couldn’t check right now. Try again in a moment.')}</p>
        ) : (
          <section className="set-block">
            {!d.hosted && <p className="mx-note">{t('Groups need your domain’s mail here (Settings, Email delivery). While it stays with your provider, make groups there.')}</p>}
            <div className="acct-list">
              {rows.length === 0 && <EmptyState compact text={d.admin ? t('No groups yet. Make one for sales@, support@ or the whole team.') : t('You aren’t in any group yet.')} />}
              {rows.map(({ item: g, leaving }) => {
                const mine = d.admin || g.owners.includes(me);
                return (
                  <div key={g.id} className={`acct-row ${leaving ? 'row-leaving' : ''}`}>
                    <span className="acct-icon">{g.kind === 'inbox' ? <Inbox size={16} /> : <Users size={16} />}</span>
                    <span className="acct-info">
                      <strong>
                        {g.address} {g.kind === 'inbox' && <Badge small>{t('Shared inbox')}</Badge>}
                      </strong>
                      <small>{t('{people}. Who can write: {who}.', { people: tn(new Set([...g.owners, ...g.members]).size, '{n} person', '{n} people'), who: postWords(g.whoCanPost) })}</small>
                    </span>
                    {mine && (
                      <button type="button" className="ghost-btn sm" onClick={() => setEditing(g)}>
                        {t('Edit')}
                      </button>
                    )}
                  </div>
                );
              })}
              {d.admin && d.hosted && (
                <button type="button" className="acct-add" onClick={() => setEditing({ kind: 'list', whoCanPost: 'company', owners: [me], members: [], address: '', name: '' })}>
                  <Plus size={16} /> {t('New group or shared inbox')}
                </button>
              )}
            </div>
          </section>
        )}
      </SmoothHeight>
      {editing && d && (
        <Layer>
          <GroupDialog
            group={editing}
            admin={d.admin}
            domains={d.domains}
            team={team}
            me={me}
            onClose={() => setEditing(null)}
            onSave={async (g) => {
              const list = g.id ? d.groups.map((x) => (x.id === g.id ? { ...x, ...g } : x)) : [...d.groups, g];
              await save(list, g.id ? t('{address} saved', { address: g.address ?? '' }) : t('{address} is ready', { address: g.address ?? '' }));
              setEditing(null);
            }}
            onRemove={
              d.admin && editing.id
                ? async () => {
                    await save(d.groups.filter((x) => x.id !== editing.id), editing.kind === 'inbox' ? t('{address} removed. Its shared inbox stays, with its mail.', { address: editing.address ?? '' }) : t('{address} removed', { address: editing.address ?? '' }));
                    setEditing(null);
                  }
                : undefined
            }
          />
        </Layer>
      )}
    </>
  );
}

function GroupDialog({ group, admin, domains, team, me, onClose, onSave, onRemove }: { group: Partial<MailGroup>; admin: boolean; domains: string[]; team: User[]; me: string; onClose: () => void; onSave: (g: Partial<MailGroup>) => Promise<void>; onRemove?: () => Promise<void> }) {
  const [local, setLocal] = useState((group.address ?? '').split('@')[0] ?? '');
  const [domain, setDomain] = useState((group.address ?? '').split('@')[1] || domains[0] || '');
  const [name, setName] = useState(group.name ?? '');
  const [kind, setKind] = useState<MailGroup['kind']>(group.kind ?? 'list');
  const [owners, setOwners] = useState<string[]>(group.owners ?? [me]);
  const [members, setMembers] = useState<string[]>((group.members ?? []).filter((x) => !(group.owners ?? []).includes(x)));
  const [who, setWho] = useState<MailGroup['whoCanPost']>(group.whoCanPost ?? 'company');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const fixed = !!group.id && !admin; // owners change people and posting, not the address or kind
  const address = `${local.trim().toLowerCase()}@${domain}`;
  const run = async (what: 'save' | 'remove', fn: () => Promise<void>) => {
    setBusy(what);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const domainOptions: Option[] = domains.map((x) => ({ value: x, label: `@${x}` }));
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal mx-group-modal" role="dialog" aria-label={group.id ? t('Edit {address}', { address: group.address ?? '' }) : t('New group or shared inbox')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span>{group.id ? group.address : t('New group or shared inbox')}</span>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <div className="kind-pick mx-kind">
              <button type="button" className={kind === 'list' ? 'on' : ''} disabled={fixed} onClick={() => setKind('list')}>
                <strong>{tx('mail group', 'Group')}</strong>
                <small>{t('A copy goes to each person’s own inbox')}</small>
              </button>
              <button type="button" className={kind === 'inbox' ? 'on' : ''} disabled={fixed} onClick={() => setKind('inbox')}>
                <strong>{t('Shared inbox')}</strong>
                <small>{t('One inbox they work from together; each conversation can be given to one person')}</small>
              </button>
            </div>
            <div className="field">
              <label htmlFor="mx-g-local">{t('Address')}</label>
              <div className="mx-address-field">
                <input id="mx-g-local" value={local} disabled={fixed} placeholder="sales" autoComplete="off" onChange={(e) => setLocal(e.target.value.replace(/\s/g, ''))} />
                {domains.length > 1 && !fixed ? <Select value={domain} options={domainOptions} onChange={setDomain} label={t('Domain')} title={t('Domain')} width={220} /> : <span className="mx-domain">@{domain}</span>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="mx-g-name">{t('Name')}</label>
              <input id="mx-g-name" value={name} placeholder={t('Sales')} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <small>{t('Shown as the sender when someone answers from the shared inbox.')}</small>
            </div>
            <div className="field">
              <label>{t('Owners')}</label>
              <PeoplePicker value={owners} users={team} me={me} onChange={(ids) => (setOwners(ids), setMembers((m) => m.filter((x) => !ids.includes(x))))} label={t('Owners')} emptyText={t('Pick at least one')} />
              <small>{t('Owners change who’s in it and who can write to it.')}</small>
            </div>
            <div className="field">
              <label>{t('Members')}</label>
              <PeoplePicker value={members} users={team.filter((u) => !owners.includes(u.id))} me={me} onChange={setMembers} label={t('Members')} emptyText={t('Nobody else yet')} />
            </div>
            <div className="field">
              <label>{t('Who can write to it')}</label>
              <Select value={who} options={POST.map((p) => ({ value: p.value, label: t(p.label), hint: t(p.hint) }))} onChange={setWho} label={t('Who can write to it')} title={t('Who can write to it')} width={320} />
            </div>
            <ErrorLine text={error} />
            <div className={`fold ${confirm ? 'open' : ''}`}>
              <div className="fold-in">
                <p className="mx-note">{kind === 'inbox' ? t('The address stops taking mail. The shared inbox stays, with its mail, until an admin removes it in Email delivery.') : t('The address stops taking mail. What its people already got stays in their inboxes.')}</p>
              </div>
            </div>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {onRemove && (
            <BusyButton className={confirm ? 'ghost-btn danger' : 'ghost-btn'} busy={busy === 'remove'} onClick={() => (confirm ? void run('remove', onRemove) : setConfirm(true))}>
              {confirm ? t('Remove it') : t('Remove')}
            </BusyButton>
          )}
          <span className="spacer" />
          <button type="button" className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <BusyButton busy={busy === 'save'} className="primary-btn" disabled={!local.trim() || !owners.length || !domain} onClick={() => void run('save', () => onSave({ ...group, address, name: name.trim() || local.trim(), kind, owners, members, whoCanPost: who }))}>
            {group.id ? t('Save') : kind === 'inbox' ? t('Make shared inbox') : t('Make group')}
          </BusyButton>
        </footer>
      </div>
    </div>
  );
}
