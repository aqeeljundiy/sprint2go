// Notes: who may change what, and Recently deleted.
// - A note shared with the team can be "view only" (`teamCan: 'view'`): then only its owner changes it.
// - Who sees a note, who may edit it and who owns it are the owner's to change.
// - Deleting puts a note in Recently deleted (`deletedAt`, `deletedBy`) for 30 days; whoever could delete it can put it
//   back. After 30 days the server deletes it for good (purgeNotes, a few times a day).
import type * as dbm from './db.ts';

export const KEEP_DAYS = 30;

type Note = dbm.Doc & { ownerId?: string; visibility?: string; teamCan?: string; deletedAt?: string; deletedBy?: string };

/**
 * A change to a note someone else may also see. `canDelete`: whether this person may delete it (its owner, admins,
 * members allowed to delete things). Returns what's stored, or null with the reason when nothing of it may change.
 */
export function guardNote(d: Note, before: Note, me: string, canDelete: boolean): { doc: Note | null; why?: string } {
  const owner = before.ownerId === me;
  if (!owner && before.visibility === 'team' && before.teamCan === 'view') return { doc: null, why: 'This note is view only: its owner keeps it as it is.' };
  let doc: Note = d;
  let why: string | undefined;
  // Sharing is the owner's.
  if (!owner && (d.visibility !== before.visibility || (d.teamCan ?? null) !== (before.teamCan ?? null) || d.ownerId !== before.ownerId)) {
    doc = { ...doc, visibility: before.visibility, teamCan: before.teamCan, ownerId: before.ownerId };
    why = 'Only the note’s owner changes who sees it.';
  }
  // Into Recently deleted and back out: the people who may delete it.
  if ((d.deletedAt ?? null) !== (before.deletedAt ?? null)) {
    if (!canDelete) {
      doc = { ...doc, deletedAt: before.deletedAt, deletedBy: before.deletedBy };
      why = 'Only the note’s owner or an admin can delete it.';
    } else doc = { ...doc, deletedBy: d.deletedAt ? me : undefined };
  }
  return { doc, why };
}

/** Notes deleted more than 30 days ago: gone for good. */
export function expiredNotes(notes: Note[], now = Date.now()) {
  const cut = now - KEEP_DAYS * 86_400_000;
  return notes.filter((n) => typeof n.deletedAt === 'string' && Date.parse(n.deletedAt) < cut);
}
