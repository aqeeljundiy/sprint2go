import { useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import type { AppId, MemberPermissions } from '../types';
import type { SettingsSection } from './AccountMenu';
import { Popover } from './ui/Popover';

export type AppSettingsLink = { id: SettingsSection; name: string; hint: string };

/**
 * Where each app's settings live in Settings, for this person: only sections they can use (admins see the company's,
 * everyone sees their own). Apps without a section of their own point to the closest one.
 */
export function appSettingsLinks(app: AppId | 'settings', who: { admin: boolean; perms: MemberPermissions }): AppSettingsLink[] {
  const admin = who.admin;
  const money = admin || who.perms.seeBilling; // Storage sits with the plan and billing
  switch (app) {
    case 'mail':
      return [...(admin ? [{ id: 'email' as const, name: 'Email delivery', hint: 'Your domain, sending and the DNS records' }] : []), { id: 'mail', name: 'Mail & signature', hint: 'Your signature, undo send and read tracking' }];
    case 'tasks':
      return admin ? [{ id: 'stages', name: 'Task stages', hint: 'The board’s columns and what each one means' }] : [];
    case 'meet':
      return admin ? [{ id: 'meetings', name: 'Meetings', hint: 'What to keep, languages and the notetaker' }] : [];
    case 'chat':
      return admin ? [{ id: 'apps', name: 'Apps & chat', hint: 'GIFs, celebrations, channels and history' }] : [];
    case 'calendar':
      return [{ id: 'notifications', name: 'Notifications', hint: 'Event reminders and sounds' }];
    case 'drive':
      return money ? [{ id: 'storage', name: 'Storage', hint: 'Space used, and your own cloud for big files' }] : [];
    case 'notes':
      return admin ? [{ id: 'permissions', name: 'Permissions', hint: 'Who can delete other people’s notes' }] : [];
    case 'tables':
      return admin ? [{ id: 'permissions', name: 'Permissions', hint: 'Who can change columns, views and automations' }] : [];
    case 'teams':
      return admin ? [{ id: 'permissions', name: 'Permissions', hint: 'Who can create teams' }] : [];
    default:
      return [];
  }
}

/**
 * The gear in an app's sidebar header (and the phone's top bar): opens Settings at that app's section, or, when there
 * are two (Mail for admins), offers both.
 */
export function AppSettingsButton({ app, links, onOpen, className = '', big }: { app: string; links: AppSettingsLink[]; onOpen: (id: SettingsSection) => void; className?: string; big?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!links.length) return null;
  const one = links.length === 1;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon-btn ${big ? '' : 'sm'} app-settings-btn ${open ? 'on' : ''} ${className}`}
        onClick={() => (one ? onOpen(links[0].id) : setOpen(true))}
        title={one ? `${app} settings: ${links[0].name}` : `${app} settings`}
        aria-label={`${app} settings`}
        aria-haspopup={one ? undefined : 'menu'}
        aria-expanded={one ? undefined : open}
      >
        <Settings size={big ? 20 : 16} />
      </button>
      {!one && (
        <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={260} title={`${app} settings`}>
          <div className="app-settings-menu" role="menu">
            {links.map((l) => (
              <button key={l.id} type="button" role="menuitem" onClick={() => (setOpen(false), onOpen(l.id))}>
                <strong>{l.name}</strong>
                <small>{l.hint}</small>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
