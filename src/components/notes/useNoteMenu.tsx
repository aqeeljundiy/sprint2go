import { useState } from 'react';
import type { Client, Note, User } from '../../types';
import { toast } from '../../toast';
import { MoveSheet, ShareSheet } from './NoteSheets';
import { noteUrl } from './noteHtml';
import type { NoteMenuCtx } from './noteMenu';
import { t } from '../../i18n';

/** What the notes screens need from the app: the notes' changes and who may make them. */
export interface NotesApi {
  me: string;
  company: string;
  clients: Client[];
  users: User[];
  canDeleteOthers: boolean; // admins, and members allowed to delete things
  byId: (id: string) => Note | undefined;
  patch: (id: string, p: Partial<Note>) => void;
  remove: (id: string) => void; // to Recently deleted
  restore: (id: string) => void;
  purge: (id: string) => void; // gone for good
  duplicate: (id: string) => void;
}

export const canEditNote = (n: Note, me: string) => n.ownerId === me || (n.visibility === 'team' && n.teamCan !== 'view');

/** The note menu's actions and the sheets they open (Move to a project, Who sees it). */
export function useNoteMenu(api: NotesApi) {
  const [sheet, setSheet] = useState<{ kind: 'move' | 'share'; id: string } | null>(null);
  const ctx: NoteMenuCtx = {
    me: api.me,
    canEdit: (n) => canEditNote(n, api.me),
    canDelete: (n) => n.ownerId === api.me || api.canDeleteOthers,
    pin: (n) => {
      api.patch(n.id, { pinned: !n.pinned });
      toast({ text: n.pinned ? t('Unpinned') : t('Pinned to the top'), action: { label: t('Undo'), run: () => api.patch(n.id, { pinned: !!n.pinned }) } });
    },
    move: (n) => setSheet({ kind: 'move', id: n.id }),
    share: (n) => setSheet({ kind: 'share', id: n.id }),
    copyLink: (n) =>
      navigator.clipboard?.writeText(noteUrl(n.id)).then(
        () => toast({ text: n.visibility === 'team' ? t('Link copied') : t('Link copied. Only you can open it until you share the note') }),
        () => toast({ text: t('Couldn’t copy the link here.') }),
      ),
    duplicate: (n) => api.duplicate(n.id),
    remove: (n) => api.remove(n.id),
  };
  return { ctx, setSheet, sheets: <NoteMenuSheets api={api} sheet={sheet} onClose={() => setSheet(null)} /> };
}

/** The sheets a note's menu opens, given the note they're for (it may change or go while open). */
function NoteMenuSheets({ api, sheet, onClose }: { api: NotesApi; sheet: { kind: 'move' | 'share'; id: string } | null; onClose: () => void }) {
  const n = sheet ? api.byId(sheet.id) : undefined;
  if (!sheet || !n) return null;
  const project = api.clients.find((c) => c.id === n.clientId)?.name;
  if (sheet.kind === 'move')
    return (
      <MoveSheet
        note={n}
        clients={api.clients}
        onClose={onClose}
        onPick={(clientId) => {
          const before = n.clientId;
          api.patch(n.id, { clientId });
          const name = api.clients.find((c) => c.id === clientId)?.name;
          toast({ text: name ? t('Moved to {name}', { name }) : t('Taken out of its project'), action: { label: t('Undo'), run: () => api.patch(n.id, { clientId: before }) } });
        }}
      />
    );
  return <ShareSheet note={n} company={api.company} project={project} onClose={onClose} onChange={(p) => api.patch(n.id, p)} />;
}
