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
