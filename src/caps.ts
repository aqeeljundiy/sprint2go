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
  relay: false, // a call relay (TURN) for huddles on networks that block direct calls
  desktopUrl: null as string | null, // the desktop app's download page
  desktopMac: null as string | null, // its installers, when the newest release has them
  desktopWin: null as string | null,
  push: false, // notifications on phones and computers (needs the server)
  /** Sign-in methods that work on this server (none yet), and whether its Google and Microsoft sign-in apps exist. */
  signIn: { google: false, microsoft: false, saml: false, googleApp: false, microsoftApp: false },
  ownStorage: false, // saving big files to a company's own cloud
  maxUploadMb: 0, // the largest single upload this server takes
  mailHost: '',
  trustedCert: false, // our mail server's certificate is CA-signed, so providers may require that
  routingCheck: false, // the server can send "Some of each" routing tests (daily and "Send a test")
  customDomains: false, // agencies' own addresses can get certificates (sprint2go has Dokploy set up)
  customTarget: 'custom.sprint2go.com', // what those addresses point at
  emailNotes: false, // the server can email people (teammates' away email, guests' notices)
};
export function loadCaps() {
  if (!location.protocol.startsWith('http')) return Promise.resolve(caps);
  return fetch('/api/caps')
    .then((r) => (r.ok ? r.json() : null))
    .then((c: Partial<typeof caps> | null) => (c ? Object.assign(caps, c, { loaded: true }) : caps), () => caps);
}
