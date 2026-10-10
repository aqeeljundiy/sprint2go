import { Bell, ChevronRight, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { Sheet } from '../components/ui/Sheet';
import { SmoothHeight, TabPane } from '../components/ui/Smooth';
import { EditBar, type EditApp } from './EditBar';
import { t } from '../i18n';

export interface MoreApp {
  id: string;
  name: string;
  icon: LucideIcon;
  badge?: number;
  live?: string; // something on right now ("Live"): a dot and the word
}

/**
 * More, on phones (Teams' app drawer): a header with Edit, the other apps in a four-column grid in their own colours,
 * then Ask AI and Settings. Nothing else: search is in the top bar, creating is each app's own button, your account is
 * on the logo top left. Editing the bar happens in the same sheet. (A screen that has no Home, like a guest portal, can
 * pass onNotices to list notifications here.)
 */
export function MoreSheet({
  onClose,
  apps,
  onApp,
  current,
  notices,
  onNotices,
  onAsk,
  onSettings,
  editing,
  onEditing,
  edit,
}: {
  onClose: () => void;
  apps: MoreApp[];
  onApp: (id: string) => void;
  current: string;
  notices?: number;
  onNotices?: () => void;
  onAsk?: () => void;
  onSettings: () => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  edit: { apps: EditApp[]; bar: string[]; onChange: (bar: string[]) => void; reset?: { label: string; run: () => void } };
}) {
  return (
    <Sheet
      onClose={onClose}
      className="more-panel"
      aboveBar
      label={editing ? t('Edit the bar') : t('More')}
      title={editing ? t('Edit the bar') : t('More')}
      head={
        editing ? (
          <button type="button" className="link-btn more-head-btn" onClick={() => onEditing(false)}>
            {t('Done')}
          </button>
        ) : (
          <button type="button" className="link-btn more-head-btn" onClick={() => onEditing(true)}>
            {t('Edit')}
          </button>
        )
      }
    >
      <SmoothHeight>
        <TabPane key={String(editing)}>
          {editing ? (
            <div className="more-edit">
              <EditBar apps={edit.apps} bar={edit.bar} onChange={edit.onChange} />
              {edit.reset && (
                <button type="button" className="link-btn small more-reset" onClick={edit.reset.run}>
                  {edit.reset.label}
                </button>
              )}
            </div>
          ) : (
            <div className="more-main">
              {apps.length > 0 && (
                <section className="more-apps2" aria-label={t('Apps')}>
                  {apps.map((a) => (
                    <button key={a.id} type="button" data-app={a.id} className={current === a.id ? 'on' : ''} aria-current={current === a.id ? 'page' : undefined} onClick={() => onApp(a.id)}>
                      <span className="more-app-icon">
                        <a.icon size={24} />
                        {a.badge ? <i>{a.badge > 99 ? '99+' : a.badge}</i> : null}
                        {a.live && !a.badge ? <i className="live" aria-label={a.live} /> : null}
                      </span>
                      <span className="more-app-name">{a.name}</span>
                      {a.live && <small className="more-app-live">{a.live}</small>}
                    </button>
                  ))}
                </section>
              )}

              <div className="as-sep" />
              <div className="as-list more-rows">
                {onNotices && (
                  <button type="button" className="as-item" onClick={onNotices}>
                    <Bell size={20} className="as-icon" />
                    <span className="as-label">{t('Notifications')}</span>
                    {!!notices && <b className="more-count">{notices > 99 ? '99+' : notices}</b>}
                  </button>
                )}
                {onAsk && (
                  <button type="button" className="as-item" onClick={() => (onClose(), onAsk())}>
                    <Sparkles size={20} className="as-icon" />
                    <span className="as-label">{t('Ask AI')}</span>
                    <ChevronRight size={18} className="as-chev" />
                  </button>
                )}
                <button type="button" className="as-item" onClick={onSettings}>
                  <Settings size={20} className="as-icon" />
                  <span className="as-label">{t('Settings')}</span>
                  <ChevronRight size={18} className="as-chev" />
                </button>
              </div>
            </div>
          )}
        </TabPane>
      </SmoothHeight>
    </Sheet>
  );
}
