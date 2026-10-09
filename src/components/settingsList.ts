/**
 * Phones show Settings as a list of sections, each opened over it with Back. Opened as a whole (More's "Account and
 * settings", or the address /settings when the page loads) it starts on that list; opened for one section (a "Set it
 * up" link, a notice, the company switcher's Settings) it starts on that section, with Back to the list.
 * A separate file so App can say which without loading the Settings screen early.
 */
let listNext = (() => {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return /\/settings\/?(?:[?#]|$)|#\/settings$/.test(nav?.name ?? location.href);
  } catch {
    return false;
  }
})();

/** The next time Settings opens on a phone, it starts on the list of sections. */
export const openSettingsList = () => void (listNext = true);

/**
 * Read by the Settings screen as it opens: true when it should start on the list. Reading doesn't use it up (React may
 * render a screen more than once before showing it); `doneSettingsList` does, once the screen is on.
 */
export const takeSettingsList = () => listNext;
export const doneSettingsList = () => void (listNext = false);
