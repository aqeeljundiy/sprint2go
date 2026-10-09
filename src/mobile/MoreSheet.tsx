import { Bell, PenSquare, Search, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import { Sheet } from '../components/ui/Sheet';
import { SmoothHeight, TabPane } from '../components/ui/Smooth';
import { EditBar, type EditApp } from './EditBar';

export interface MoreApp {
  id: string;
  name: string;
  icon: LucideIcon;
  badge?: number;
  live?: string; // something on right now ("Live"): a dot and the word
}
export interface MoreLink {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

/**
 * More, on phones: jump (search), make something new, open another app, pick up where you were (Recent), then Ask AI,
 * Notifications, editing the bar and Account. Editing the bar happens in the same sheet.
 */
export function MoreSheet({
  onClose,
  onSearch,
  make,
  apps,
  onApp,
  current,
  recent,
  notices,
  onNotices,
  onAsk,
  onAccount,
  editing,
  onEditing,
  edit,
}: {
  onClose: () => void;
  onSearch: () => void;
  make: MoreLink[];
  apps: MoreApp[];
  onApp: (id: string) => void;
  current: string;
  recent: MoreLink[];
  notices: number;
  onNotices: () => void;
  onAsk?: () => void;
  onAccount: () => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  edit: { apps: EditApp[]; bar: string[]; onChange: (bar: string[]) => void; reset?: { label: string; run: () => void } };
}) {
  return (
    <Sheet
      onClose={onClose}
      className="more-panel"
      aboveBar
      label={editing ? 'Edit the bar' : 'More'}
      title={editing ? 'Edit the bar' : undefined}
      head={
        editing ? (
          <button type="button" className="primary-btn sm" onClick={() => onEditing(false)}>
            Done
          </button>
        ) : undefined
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
              <button type="button" className="more-search" onClick={onSearch}>
                <Search size={18} />
                <span>Search or jump to an app, project or person</span>
              </button>

              {make.length > 0 && (
                <section className="more-new" aria-label="New">
                  <h3 className="as-group">New</h3>
                  <div className="more-new-row">
                    {make.map((m) => (
                      <button key={m.id} type="button" onClick={() => (onClose(), m.run())}>
                        <span className="more-new-icon">
                          <m.icon size={19} />
                        </span>
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {apps.length > 0 && (
                <section className="more-apps2" aria-label="Apps">
                  {apps.map((a) => (
                    <button key={a.id} type="button" className={current === a.id ? 'on' : ''} aria-current={current === a.id ? 'page' : undefined} onClick={() => onApp(a.id)}>
                      <span className="more-app-icon">
                        <a.icon size={22} />
                        {a.badge ? <i>{a.badge > 99 ? '99+' : a.badge}</i> : null}
                        {a.live && !a.badge ? <i className="live" aria-label={a.live} /> : null}
                      </span>
                      <span className="more-app-name">{a.name}</span>
                      {a.live && <small className="more-app-live">{a.live}</small>}
                    </button>
                  ))}
                </section>
              )}

              {recent.length > 0 && (
                <section aria-label="Recent">
                  <h3 className="as-group">Recent</h3>
                  <div className="as-list">
                    {recent.map((r) => (
                      <button key={r.id} type="button" className="as-item" onClick={() => (onClose(), r.run())}>
                        <r.icon size={18} className="as-icon" />
                        <span className="as-label">
                          <span className="more-ellipsis">{r.label}</span>
                          {r.hint && <small>{r.hint}</small>}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="as-sep" />
              <div className="as-list">
                <button type="button" className="as-item" onClick={onNotices}>
                  <Bell size={18} className="as-icon" />
                  <span className="as-label">Notifications</span>
                  {notices > 0 && <b className="more-count">{notices > 99 ? '99+' : notices}</b>}
                </button>
                {onAsk && (
                  <button type="button" className="as-item" onClick={() => (onClose(), onAsk())}>
                    <Sparkles size={18} className="as-icon" />
                    <span className="as-label">Ask AI</span>
                  </button>
                )}
                <button type="button" className="as-item" onClick={() => onEditing(true)}>
                  <PenSquare size={18} className="as-icon" />
                  <span className="as-label">Edit the bar</span>
                </button>
                <button type="button" className="as-item" onClick={onAccount}>
                  <UserRound size={18} className="as-icon" />
                  <span className="as-label">Account and settings</span>
                </button>
              </div>
            </div>
          )}
        </TabPane>
      </SmoothHeight>
    </Sheet>
  );
}
