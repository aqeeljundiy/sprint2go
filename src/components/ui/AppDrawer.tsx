import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Workspace } from '../../types';
import { WorkspaceLogo } from '../WorkspaceLogo';
import { SideDrawer } from './SideDrawer';
import { openCompanySheet } from '../../mobile/chrome';
import { t } from '../../i18n';

/**
 * An app's drawer on phones (Google Calendar's and Google Meet's): the company at the top (it opens the company sheet,
 * the one behind the top bar's logo, which the app's ☰ took the place of), then the app's rows. Rows share one shape:
 * 48 px, the icon or checkbox in a 56 px column, the current one on a tinted pill.
 *
 *   {open && <AppDrawer label={t('Calendar')} company={ws} onClose={close}><DrawerRow …/></AppDrawer>}
 */
export function AppDrawer({ label, company, onClose, children }: { label: string; company?: Pick<Workspace, 'name' | 'logo' | 'color'>; onClose: () => void; children: ReactNode }) {
  return (
    <SideDrawer label={label} onClose={onClose} className="app-drawer">
      {company && (
        <button
          type="button"
          className="ad-company"
          onClick={() => {
            onClose();
            openCompanySheet();
          }}
          aria-haspopup="dialog"
          aria-label={t('Workspace: {name}', { name: company.name })}
        >
          <WorkspaceLogo ws={company} size={28} />
          <span className="ad-company-name">{company.name}</span>
          <ChevronDown size={16} className="ad-company-chev" />
        </button>
      )}
      {children}
    </SideDrawer>
  );
}

/** One row of a drawer: an icon (or a checkbox) in the left column, a label and an optional second line. */
export function DrawerRow({
  icon,
  label,
  sub,
  on,
  onClick,
  end,
  pressed,
  title,
}: {
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  on?: boolean; // the current one (a view): the tinted pill
  onClick: () => void;
  end?: ReactNode; // a button at the right edge (⋯)
  pressed?: boolean; // a toggle row (a calendar shown or not)
  title?: string;
}) {
  return (
    <div className={`ad-row${on ? ' on' : ''}${end ? ' has-end' : ''}`}>
      <button type="button" className="ad-main" onClick={onClick} aria-current={on || undefined} aria-pressed={pressed} title={title}>
        <span className="ad-icon">{icon}</span>
        <span className="ad-text">
          <span className="ad-label">{label}</span>
          {sub && <small className="ad-sub">{sub}</small>}
        </span>
      </button>
      {end}
    </div>
  );
}

/** A calendar's checkbox in its colour (filled with a tick when it shows). */
export function DrawerCheck({ on, color }: { on: boolean; color: string }) {
  return (
    <span className={`ad-check${on ? ' on' : ''}`} style={{ ['--c' as string]: color }} aria-hidden>
      {on && <Check size={13} strokeWidth={3} />}
    </span>
  );
}

export function DrawerHeading({ children }: { children: ReactNode }) {
  return <div className="ad-heading">{children}</div>;
}

export function DrawerDivider() {
  return <div className="ad-divider" role="separator" />;
}
