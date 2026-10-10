// The app's addresses (research/launcher/plan.md, section 4). The same URLs on desktop and phone: `/<app>`, then an
// app's section, then the thing open in it (`/tasks/upcoming/<task id>`). Only `/` differs: the launcher on phones,
// Home on desktop. Pure: no React and no browser, so the unit tests can check every row of the table.

/** Each app's sections, in the order of its phone bar. The first is the app's root: `/tasks` means Today. */
export const SECTIONS: Record<string, readonly string[]> = {
  mail: ['inbox', 'search', 'files', 'contacts'],
  chat: ['home', 'dms', 'activity', 'search'],
  tasks: ['today', 'upcoming', 'mine', 'browse'],
  calendar: ['schedule', 'month', 'meetings'],
  notes: ['notes', 'shared', 'search'],
  drive: ['home', 'starred', 'shared', 'files'],
  projects: ['active', 'mine', 'past'],
  meet: ['meetings', 'notes', 'folders'],
  teams: ['teams', 'people'],
};

/** Every first part a URL can have (the apps, Settings). Anything else is `/`. */
export const ROUTE_APPS = ['home', 'mail', 'chat', 'tasks', 'projects', 'teams', 'tables', 'calendar', 'notes', 'drive', 'meet', 'vault', 'settings'] as const;

export interface Route {
  /** Phones: the launcher is on screen (the URL is `/`). */
  launcher: boolean;
  mode: string; // an app id or 'settings'
  section?: string; // one of SECTIONS[mode]; left out for the app's root section
  id?: string; // the thing open in it (a task, a channel, a mailbox, a settings section…)
}

const rootOf = (mode: string) => SECTIONS[mode]?.[0];

/** Reads a path ("/tasks/upcoming/t1", or a hash's "tasks/upcoming/t1"). */
export function parseRoute(path: string, phone: boolean): Route {
  const parts = path
    .replace(/^#/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const first = parts[0];
  if (!first || !(ROUTE_APPS as readonly string[]).includes(first)) return phone ? { launcher: true, mode: 'home' } : { launcher: false, mode: 'home' };
  const rest = parts.slice(1);
  const known = SECTIONS[first];
  let section: string | undefined;
  if (known && rest.length && known.includes(rest[0])) section = rest.shift();
  if (section === rootOf(first)) section = undefined;
  const id = rest.length ? rest.join('/') : undefined;
  return { launcher: false, mode: first, ...(section ? { section } : {}), ...(id ? { id } : {}) };
}

/** Writes a route as a path. The root section is left out (`/tasks`, not `/tasks/today`). */
export function routePath(r: Route): string {
  if (r.launcher) return '/';
  const section = r.section && r.section !== rootOf(r.mode) ? `/${r.section}` : '';
  const id = r.id ? `/${r.id.split('/').map(encodeURIComponent).join('/')}` : '';
  return `/${r.mode}${section}${id}`;
}

/** The section a route is in (the root one when the URL names none). */
export const sectionOf = (r: Route) => r.section ?? rootOf(r.mode);

/**
 * The history entries to add when the screen moves from `from` to `to`, so Back walks the way people expect: a thing
 * opened from somewhere else (a notification, a link, another app) first gets its app's section under it, so Back
 * from a task goes to Tasks, then to the launcher (research/launcher/plan.md, section 5).
 */
export function historySteps(from: string, to: string, phone: boolean): string[] {
  if (from === to) return [];
  const a = parseRoute(from, phone);
  const b = parseRoute(to, phone);
  if (b.id && !b.launcher && (a.launcher || a.mode !== b.mode)) {
    const under = routePath({ launcher: false, mode: b.mode, section: b.section });
    if (under !== from) return [under, to];
  }
  return [to];
}

/** Coming back to the app within this long reopens the last app and section; after that, the launcher. */
export const RESUME_MS = 10 * 60_000;

/** Where a cold start on a phone opens: the URL's app when it names one, the last app when it was under 10 minutes
 * ago, else the launcher. */
export function startPath(url: string, last: { path: string; at: number } | null, now: number): string {
  const r = parseRoute(url, true);
  if (!r.launcher) return routePath(r);
  if (last && now - last.at < RESUME_MS && !parseRoute(last.path, true).launcher) return last.path;
  return '/';
}
