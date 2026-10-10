// The mail log for a company: who gave whom access to a mailbox, forwarding switched on or off, groups changed,
// retention and legal holds, data loss rules that warned or blocked, mailboxes exported. Admins read it in Settings,
// Mail retention & rules; each person sees the entries about their own mailboxes in Settings, Mailbox access.
// Kept apart from the operator audit (db.audit), which is sprint2go's own, not the company's.
import * as db from './db.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, account_id TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS mail_audit_ws ON mail_audit (workspace_id, id);
`);

export interface MailAuditEntry {
  id: number;
  at: string;
  actor: string; // a user id, or 'system'
  action: string; // e.g. delegate.grant, forward.on, dlp.block
  accountId: string | null;
  detail: string | null;
}

export function log(workspaceId: string, actor: string, action: string, accountId: string | null, detail?: string) {
  db.db.prepare('INSERT INTO mail_audit (workspace_id, at, actor, action, account_id, detail) VALUES (?, ?, ?, ?, ?, ?)').run(workspaceId, new Date().toISOString(), actor, action, accountId, detail ? detail.slice(0, 500) : null);
}

const rows = (r: any[]): MailAuditEntry[] => r.map((x) => ({ id: x.id, at: x.at, actor: x.actor, action: x.action, accountId: x.account_id, detail: x.detail }));

/** The company's log, newest first. */
export const list = (workspaceId: string, limit = 200) => rows(db.db.prepare('SELECT * FROM mail_audit WHERE workspace_id = ? ORDER BY id DESC LIMIT ?').all(workspaceId, limit) as any[]);
/** The entries about these mailboxes, newest first. */
export function forAccounts(workspaceId: string, accountIds: string[], limit = 100) {
  if (!accountIds.length) return [];
  return rows(db.db.prepare(`SELECT * FROM mail_audit WHERE workspace_id = ? AND account_id IN (${accountIds.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`).all(workspaceId, ...accountIds, limit) as any[]);
}
