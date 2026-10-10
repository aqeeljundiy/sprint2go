import { useState } from 'react';
import type { AppId, Team, Workspace } from '../types';
import { APPS } from '../components/AppRail';
import { Sheet } from '../components/ui/Sheet';
import { EditBar } from './EditBar';
import { t } from '../i18n';
import { usePhone } from './media';
import { GRow, Group } from '../components/ui/Grouped';

/** The bar everyone starts with on phones, unless their company or team set another. */
export const DEFAULT_BAR: AppId[] = ['home', 'mail', 'chat', 'tasks'];
/** Where a company's default bar is kept: the workspace's tab defaults, under "bar" (everyone) or "bar:<team id>". */
export const barKey = (teamId?: string) => (teamId ? `bar:${teamId}` : 'bar');
/** The order of the apps in More (Calendar first), and in the list for editing a bar. */
export const MORE_ORDER: AppId[] = ['calendar', 'projects', 'meet', 'drive', 'notes', 'tables', 'teams', 'vault', 'home', 'mail', 'chat', 'tasks'];

/** The company's bar for this person: their first team's, else everyone's, else none. */
export function companyBar(ws: Workspace, myTeamIds: string[]): AppId[] | null {
  const d = ws.tabDefaults ?? {};
  for (const t of myTeamIds) if (d[barKey(t)]?.order.length) return d[barKey(t)].order as AppId[];
  return d.bar?.order.length ? (d.bar.order as AppId[]) : null;
}

/**
 * Settings, Apps & chat: the phone bar an admin sets for everyone, and per team (a client-facing team might want
 * Calendar instead of Tasks). People can still change their own; this is where they start, and what "Use the
 * company's bar" goes back to.
 */
export function BarDefaults({ ws, teams, canManage, onWorkspace }: { ws: Workspace; teams: Team[]; canManage: boolean; onWorkspace: (p: Partial<Workspace>) => void }) {
  const [editing, setEditing] = useState<string | null>(null); // '' = everyone, else a team id
  const companyApps = (ws.apps ?? APPS.map((a) => a.id)) as AppId[];
  const apps = MORE_ORDER.filter((id) => id === 'home' || companyApps.includes(id)).map((id) => APPS.find((a) => a.id === id)!);
  const d = ws.tabDefaults ?? {};
  const barOf = (teamId?: string) => (d[barKey(teamId)]?.order as AppId[] | undefined) ?? null;
  const save = (teamId: string | undefined, bar: string[] | null) => {
    const next = { ...d };
    if (bar) next[barKey(teamId)] = { order: bar, hidden: [] };
    else delete next[barKey(teamId)];
    onWorkspace({ tabDefaults: next });
  };
  const rows = [{ id: '', name: t('Everyone'), hint: t('Unless their team has its own') }, ...teams.filter((tm) => tm.workspaceId === ws.id).map((tm) => ({ id: tm.id, name: tm.name, hint: barOf(tm.id) ? t('Its own bar') : t('Same as everyone') }))];
  const icons = (bar: string[]) => bar.map((id) => APPS.find((a) => a.id === id)).filter((a): a is (typeof APPS)[number] => !!a);
  const editingTeam = editing === null ? undefined : editing || undefined;
  const phone = usePhone();
  const sheet = editing !== null && (
    <Sheet
      onClose={() => setEditing(null)}
      title={editing ? t('Phone bar for {team}', { team: rows.find((r) => r.id === editing)?.name ?? t('the team') }) : t('Phone bar for everyone')}
      head={
        <button type="button" className="primary-btn sm" onClick={() => setEditing(null)}>
          {t('Done')}
        </button>
      }
    >
      <EditBar apps={apps} bar={barOf(editingTeam) ?? (editingTeam ? (barOf() ?? DEFAULT_BAR) : DEFAULT_BAR)} onChange={(bar) => save(editingTeam, bar)} />
      {barOf(editingTeam) && (
        <button type="button" className="link-btn small more-reset" onClick={() => (save(editingTeam, null), setEditing(null))}>
          {editingTeam ? t('Use the same bar as everyone') : t('Back to Home, Mail, Chat and Tasks')}
        </button>
      )}
    </Sheet>
  );
  // Phones (iOS Settings): a row per bar with its four icons on the right; tapping one opens the bar to arrange.
  if (phone)
    return (
      <div className="set-rows">
        <Group title={t('Phone bar')} footer={t('The four apps at the bottom of everyone’s phone. People can still change their own.')}>
          {rows.map((r) => {
            const bar = barOf(r.id || undefined) ?? (r.id ? (barOf() ?? DEFAULT_BAR) : DEFAULT_BAR);
            return (
              <GRow
                key={r.id || 'all'}
                label={r.name}
                sub={r.hint}
                accessory={
                  <span className="bar-defaults-icons" aria-label={icons(bar).map((a) => a.name).join(', ')}>
                    {icons(bar).map((a) => (
                      <a.icon key={a.id} size={16} />
                    ))}
                  </span>
                }
                chevron={canManage}
                onClick={canManage ? () => setEditing(r.id) : undefined}
              />
            );
          })}
        </Group>
        {sheet}
      </div>
    );
  return (
    <div className="set-block bar-defaults">
      <h3>{t('Phone bar')}</h3>
      <p className="set-intro">{t('The four apps at the bottom of everyone’s phone. People can still change their own.')}</p>
      {rows.map((r) => {
        const bar = barOf(r.id || undefined) ?? (r.id ? (barOf() ?? DEFAULT_BAR) : DEFAULT_BAR);
        return (
          <div key={r.id || 'all'} className="set-row">
            <span>
              <strong>{r.name}</strong>
              <small>{r.hint}</small>
            </span>
            <span className="bar-defaults-icons" aria-label={icons(bar).map((a) => a.name).join(', ')}>
              {icons(bar).map((a) => (
                <a.icon key={a.id} size={16} />
              ))}
            </span>
            <button type="button" className="ghost-btn sm" disabled={!canManage} onClick={() => setEditing(r.id)}>
              {t('Change')}
            </button>
          </div>
        );
      })}
      {sheet}
    </div>
  );
}
