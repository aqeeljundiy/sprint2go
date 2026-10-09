import type { ReactNode } from 'react';
import { EyeOff, type LucideIcon } from 'lucide-react';
import { t } from '../i18n';

/**
 * What an app shows when it isn't set up for this person yet (instead of an empty screen): what it's for, the one
 * thing to do next, and a way to hide the app for yourself. Calm: no badges or pop-ups anywhere else.
 */
export function AppSetupCard({ icon: Icon, title, body, actions, onHide }: { icon: LucideIcon; title: string; body: string; actions: ReactNode; onHide?: () => void }) {
  return (
    <section className="app-setup view-enter">
      <div className="app-setup-card">
        <span className="app-setup-ic">
          <Icon size={24} />
        </span>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="app-setup-actions">{actions}</div>
        {onHide && (
          <button className="link-btn app-setup-hide" onClick={onHide}>
            <EyeOff size={13} /> {t('Hide this app for me')}
          </button>
        )}
      </div>
    </section>
  );
}
