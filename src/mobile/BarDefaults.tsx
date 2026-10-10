import { useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import type { AppId, Team, Workspace } from '../types';
import { APPS } from '../components/AppRail';
import { Sheet } from '../components/ui/Sheet';
import { AppsGrid, HiddenApps } from './EditApps';
import type { LauncherApp } from './Launcher';
import { DEFAULT_APPS, appsKey, normalize, type AppOrder, type LauncherId } from './launcherApps';
import { t } from '../i18n';
import { usePhone } from './media';
import { GRow, Group } from '../components/ui/Grouped';

/** The launcher's tiles, plain (no counts): an app's name and icon, Settings last. */
export function plainTiles(enabled: (id: string) => boolean): LauncherApp[] {
  return DEFAULT_APPS.filter((id) => id === 'settings' || enabled(id)).map((id) => {
    const a = APPS.find((x) => x.id === id);
    return a ? { id: a.id as LauncherId, name: a.name, icon: a.icon } : { id: 'settings' as const, name: t('Settings'), icon: SettingsIcon };
  });
}

/**
 * Settings, Apps & chat: "Apps on phones". The order of the launcher's apps and the hidden ones, for everyone and per
 * team (a client-facing team might want Calendar first). People can still arrange their own; this is where they start,
 * and what "Use the company's order" goes back to. Kept where the phone bar's defaults were (`tabDefaults.bar`,
 * `bar:<team id>`).
 */
export function BarDefaults({ ws, teams, canManage, onWorkspace }: { ws: Workspace; teams: Team[]; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void }) {
  const [editing, setEditing] = useState<string | null>(null); // '' = everyone, else a team id
  const companyApps = (ws.apps ?? APPS.map((a) => a.id)) as AppId[];
  const tiles = plainTiles((id) => companyApps.includes(id as AppId));
  const d = ws.tabDefaults ?? {};
  const orderOf = (teamId?: string): AppOrder | null => (d[appsKey(teamId)]?.order.length ? normalize(d[appsKey(teamId)]) : null);
  const save = (teamId: string | undefined, o: AppOrder | null) => {
    const next = { ...d };
    if (o) next[appsKey(teamId)] = { order: o.order, hidden: o.hidden };
    else delete next[appsKey(teamId)];
    onWorkspace({ tabDefaults: next });
  };
  const rows = [{ id: '', name: t('Everyone'), hint: t('Unless their team has its own') }, ...teams.filter((tm) => tm.workspaceId === ws.id).map((tm) => ({ id: tm.id, name: tm.name, hint: orderOf(tm.id) ? t('Its own order') : t('Same as everyone') }))];
  const editingTeam = editing === null ? undefined : editing || undefined;
  const current = (teamId?: string) => orderOf(teamId) ?? (teamId ? orderOf() : null) ?? normalize(null);
  const firstFour = (o: AppOrder) => o.order.filter((id) => !o.hidden.includes(id)).map((id) => tiles.find((x) => x.id === id)).filter((x): x is LauncherApp => !!x).slice(0, 4);
  const phone = usePhone();
  const sheet = editing !== null && (
    <Sheet
      onClose={() => setEditing(null)}
      size="tall"
      title={editing ? t('Apps on phones for {team}', { team: rows.find((r) => r.id === editing)?.name ?? t('the team') }) : t('Apps on phones for everyone')}
      head={
        <button type="button" className="primary-btn sm" onClick={() => setEditing(null)}>
          {t('Done')}
        </button>
      }
    >
      <div className="ea-body ea-admin">
        <p className="ea-lede">{t('Hold an app and drag it to move it. Tap − to hide it; people still find it in search.')}</p>
        <AppsGrid apps={tiles} value={current(editingTeam)} onChange={(o) => save(editingTeam, o)} />
        <HiddenApps apps={tiles} value={current(editingTeam)} onChange={(o) => save(editingTeam, o)} />
        {orderOf(editingTeam) && (
          <button type="button" className="link-btn small ea-reset" onClick={() => (save(editingTeam, null), setEditing(null))}>
            {editingTeam ? t('Use the same order as everyone') : t('Back to the usual order')}
          </button>
        )}
      </div>
    </Sheet>
  );
  const icons = (o: AppOrder) => (
    <span className="bar-defaults-icons" aria-label={firstFour(o).map((a) => a.name).join(', ')}>
      {firstFour(o).map((a) => (
        <a.icon key={a.id} size={16} />
      ))}
    </span>
  );
  // Phones (iOS Settings): a row per order with its first four icons; tapping one opens the grid to arrange.
  if (phone)
    return (
      <div className="set-rows">
        <Group title={t('Apps on phones')} footer={t('The order of the apps on everyone’s phone. People can still arrange their own.')}>
          {rows.map((r) => (
            <GRow key={r.id || 'all'} label={r.name} sub={r.hint} accessory={icons(current(r.id || undefined))} chevron={canManage} onClick={canManage ? () => setEditing(r.id) : undefined} />
          ))}
        </Group>
        {sheet}
      </div>
    );
  return (
    <div className="set-block bar-defaults">
      <h3>{t('Apps on phones')}</h3>
      <p className="set-intro">{t('The order of the apps on everyone’s phone. People can still arrange their own.')}</p>
      {rows.map((r) => (
        <div key={r.id || 'all'} className="set-row">
          <span>
            <strong>{r.name}</strong>
            <small>{r.hint}</small>
          </span>
          {icons(current(r.id || undefined))}
          <button type="button" className="ghost-btn sm" disabled={!canManage} onClick={() => setEditing(r.id)}>
            {t('Change')}
          </button>
        </div>
      ))}
      {sheet}
    </div>
  );
}
