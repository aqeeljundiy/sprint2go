// The apps on the phone's launcher and their order (research/launcher/plan.md, section 2). Admins set the company's
// order and hidden apps (Settings, Company, Apps on phones), for everyone and per team; each person can still arrange
// their own (Edit apps) and go back to the company's. Pure: the unit tests import it.
import type { AppId, Workspace } from '../types';

export type LauncherId = AppId | 'settings';

/** One order for everyone who hasn't been given another: the launcher's grid, top left to bottom right. */
export const DEFAULT_APPS: LauncherId[] = ['mail', 'chat', 'tasks', 'calendar', 'projects', 'meet', 'drive', 'notes', 'tables', 'teams', 'vault', 'settings'];

/** An order and what's hidden. Kept as the workspace's `tabDefaults.bar` (everyone) and `bar:<team id>` (a team), and
 * as the person's own on their device. */
export interface AppOrder {
  order: string[];
  hidden: string[];
}

/** Where a company's order is kept (the keys today's phone bar defaults already use). */
export const appsKey = (teamId?: string) => (teamId ? `bar:${teamId}` : 'bar');

/** Every launcher app once, in the given order first, then the rest in the default order. Home is not a tile (it's the
 * launcher's own "See all"); Settings can't be hidden. */
export function normalize(o: Partial<AppOrder> | null | undefined): AppOrder {
  const known = new Set<string>(DEFAULT_APPS);
  const order: string[] = [];
  for (const id of o?.order ?? []) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const id of DEFAULT_APPS) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set((o?.hidden ?? []).filter((id) => known.has(id) && id !== 'settings'))];
  return { order, hidden };
}

/** The company's order for this person: their first team's, else everyone's, else none (the default). An old four-app
 * bar (it had Home in it) reads as its apps first, then the rest. */
export function companyApps(ws: Pick<Workspace, 'tabDefaults'>, myTeamIds: string[]): AppOrder | null {
  const d = ws.tabDefaults ?? {};
  for (const t of myTeamIds) if (d[appsKey(t)]?.order.length) return normalize(d[appsKey(t)]);
  return d.bar?.order.length ? normalize(d.bar) : null;
}

/** The old phone bar (Home, Mail, Chat, Tasks and More's order) as a launcher order: the old four first, then More's. */
const OLD_DEFAULT_BAR = ['home', 'mail', 'chat', 'tasks'];
const OLD_MORE_ORDER = ['calendar', 'projects', 'meet', 'drive', 'notes', 'tables', 'teams', 'vault'];
export function migrateBar(bar: string[] | null | undefined, own: boolean): AppOrder | null {
  if (!bar || (!own && bar.join() === OLD_DEFAULT_BAR.join())) return null; // never changed: follow the company
  return normalize({ order: [...bar, ...OLD_MORE_ORDER], hidden: [] });
}

/** What the launcher shows: the person's own order when they made one, else the company's, else the default; only
 * apps the company has switched on (Settings always). */
export function launcherApps(own: AppOrder | null, company: AppOrder | null, enabled: (id: string) => boolean): { shown: LauncherId[]; hidden: LauncherId[] } {
  const o = normalize(own ?? company);
  const on = o.order.filter((id) => id === 'settings' || enabled(id)) as LauncherId[];
  return { shown: on.filter((id) => !o.hidden.includes(id)), hidden: on.filter((id) => o.hidden.includes(id)) };
}
