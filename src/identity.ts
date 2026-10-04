// Who "you" are across every connected account, and which domains count as your team.
// App keeps these in sync with the active workspace.

let mine = new Set<string>();
let teamDomains: string[] = [];

export function setIdentity(addresses: string[], domains: string[]) {
  mine = new Set(addresses.map((a) => a.toLowerCase()));
  teamDomains = domains.map((d) => d.toLowerCase().trim()).filter(Boolean);
}

/** True for any of your own addresses (all accounts, all workspaces). */
export const isMine = (email: string) => mine.has(email.toLowerCase());

/** True for people at your workspace's domains — their mail is never tracked. */
export const isTeam = (email: string) => isMine(email) || teamDomains.includes(email.split('@')[1]?.toLowerCase() ?? '');
