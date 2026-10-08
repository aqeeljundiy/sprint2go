// What a company calls the things it works on. "Projects" by default (any kind of work), or "Clients" for
// agencies that prefer it (Settings, General). Inside the code they're still "clients"; only the words change.
export type TermWord = 'project' | 'client';

const state: { word: TermWord } = { word: 'project' };

export function setTermWord(w: TermWord | undefined) {
  state.word = w ?? 'project';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const term = {
  get one() {
    return state.word;
  },
  get One() {
    return cap(state.word);
  },
  get many() {
    return state.word + 's';
  },
  get Many() {
    return cap(state.word) + 's';
  },
  get word() {
    return state.word;
  },
  /** The people on the other side: "client" for agencies that say clients, "guest" otherwise. */
  get who() {
    return state.word === 'client' ? 'client' : 'guest';
  },
  get Who() {
    return state.word === 'client' ? 'Client' : 'Guest';
  },
  get whos() {
    return state.word === 'client' ? 'clients' : 'guests';
  },
  get Whos() {
    return state.word === 'client' ? 'Clients' : 'Guests';
  },
};

/** The kinds of projects (a label, for filtering): an agency can still see "just my clients". */
export const PROJECT_TYPES = ['Client', 'Internal', 'Partner', 'Vendor', 'Event', 'Other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * The product's name as people see it: "Sprint2go", or an agency's own name when it runs the app under its brand
 * (white label). Set from the workspace on screen, or from the address the app was opened at.
 */
const brandState: { name: string } = { name: 'Sprint2go' };
export function setBrandName(n: string | undefined) {
  brandState.name = n?.trim() || 'Sprint2go';
}
export const brand = {
  get name() {
    return brandState.name;
  },
  /** True when an agency's name replaces ours. */
  get white() {
    return brandState.name !== 'Sprint2go';
  },
};

/** The name a workspace shows for the product: its own brand, or ours. */
export function brandOf(ws?: { whiteLabel?: { enabled: boolean; name: string } }) {
  return ws?.whiteLabel?.enabled ? ws.whiteLabel.name : undefined;
}
/** Where this company's clients sign in: its own address when it has one, else here. */
export function portalOrigin(ws?: { whiteLabel?: { enabled: boolean; domain?: string; domainStatus?: string; slug?: string } }) {
  const wl = ws?.whiteLabel;
  if (!wl?.enabled) return location.origin;
  if (wl.domain && wl.domainStatus === 'verified') return `https://${wl.domain}`;
  if (wl.slug && location.hostname === 'localhost') return `${location.protocol}//${wl.slug}.localhost${location.port ? `:${location.port}` : ''}`;
  return location.origin;
}
