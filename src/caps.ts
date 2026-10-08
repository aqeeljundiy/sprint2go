/**
 * What this sprint2go server can really do (GET /api/caps). Features that depend on something missing are hidden or
 * disabled with the reason, instead of pretending. Without a server (the standalone demo) everything is on, as a demo.
 */
export const caps = {
  loaded: false,
  demo: true, // demo stand-ins allowed (canned AI answers, a pretend notetaker, pretend calendar connections)
  recorder: false,
  boosted: false,
  googleCalendar: false,
  microsoftCalendar: false,
  calendarLinks: false,
  payments: false,
  desktopUrl: null as string | null, // the desktop app's download page
  desktopMac: null as string | null, // its installers, when the newest release has them
  desktopWin: null as string | null,
  push: false, // notifications on phones and computers (needs the server)
  mailHost: '',
};
export function loadCaps() {
  if (!location.protocol.startsWith('http')) return Promise.resolve(caps);
  return fetch('/api/caps')
    .then((r) => (r.ok ? r.json() : null))
    .then((c: Partial<typeof caps> | null) => (c ? Object.assign(caps, c, { loaded: true }) : caps), () => caps);
}
