import { useEffect, useRef } from 'react';
import { HardDrive, Keyboard, LogOut, Monitor, Moon, ServerCog, Settings as Cog, Sun, UserPlus, UserRound, LifeBuoy } from 'lucide-react';
import { server } from '../sync';
import type { Person, User } from '../types';
import type { Settings, ThemePref } from '../settings';
import { fmtSize } from '../data/drive';
import { Avatar } from './Avatar';
import { t } from '../i18n';

export type SettingsSection = 'workspace' | 'email' | 'agency' | 'permissions' | 'teams' | 'stages' | 'clients' | 'apps' | 'meetings' | 'ai' | 'billing' | 'storage' | 'security' | 'import' | 'account' | 'appearance' | 'mail' | 'notifications' | 'shortcuts' | 'developer' | 'myapps' | 'help' | 'mailapps';

interface Props {
  me: Person & { color?: string };
  settings: Settings;
  used: number;
  quota: number;
  onSettings: (s: SettingsSection) => void;
  onTheme: (t: ThemePref) => void;
  onSignOut: () => void;
  onClose: () => void;
  others: User[]; // other people signed in on this device
  onSwitchUser: (id: string) => void;
  onAddUser: () => void;
}

export function AccountMenu({ me, settings, used, quota, onSettings, onTheme, onSignOut, onClose, others, onSwitchUser, onAddUser }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.account-wrap')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const pct = Math.max(1, Math.round((used / quota) * 100));

  return (
    <div className="account-menu" ref={ref} role="menu">
      <div className="am-head">
        <Avatar person={me} size={42} />
        <div>
          <strong>{me.name}</strong>
          <small>{me.email}</small>
          <small>{settings.title}</small>
        </div>
      </div>

      <div className="am-theme segmented wide">
        {([
          ['light', Sun, t('Light')],
          ['dark', Moon, t('Dark')],
          ['system', Monitor, t('Auto')],
        ] as const).map(([id, Icon, label]) => (
          <button key={id} className={settings.theme === id ? 'on' : ''} onClick={() => onTheme(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <button className="am-item" onClick={() => onSettings('account')}>
        <UserRound size={16} /> {t('Account')}
      </button>
      <button className="am-item" onClick={() => onSettings('appearance')}>
        <Cog size={16} /> {t('Settings')}
      </button>
      <button className="am-item" onClick={() => onSettings('help')}>
        <LifeBuoy size={16} /> {t('Help & support')}
      </button>
      <button className="am-item" onClick={() => onSettings('shortcuts')}>
        <Keyboard size={16} /> {t('Keyboard shortcuts')}
      </button>
      <button className="am-item am-storage" onClick={() => onSettings('storage')}>
        <HardDrive size={16} />
        <span>
          {t('Storage')}
          <span className="bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <small>{t('{used} of {total} used', { used: fmtSize(used), total: fmtSize(quota) })}</small>
        </span>
      </button>
      <div className="am-sep" />
      <div className="am-label">{t('Switch user')}</div>
      {others.map((u) => (
        <button key={u.id} className="am-item am-user" onClick={() => onSwitchUser(u.id)}>
          <Avatar person={u} size={26} />
          <span className="amu-text">
            <strong>{u.name}</strong>
            <small>{u.email}</small>
          </span>
        </button>
      ))}
      <button className="am-item" onClick={onAddUser}>
        <UserPlus size={16} /> {t('Add another user')}
      </button>
      <div className="am-sep" />
      {server.operator && (
        <a className="am-item" href="/admin">
          <ServerCog size={16} /> {t('Operator backend')}
        </a>
      )}
      <button className="am-item danger" onClick={onSignOut}>
        <LogOut size={16} /> {t('Sign out of {name}', { name: me.name.split(' ')[0] })}
      </button>
    </div>
  );
}
