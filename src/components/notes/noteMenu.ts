import { CopyPlus, FolderInput, Link2, Lock, Pin, PinOff, Trash2, Users } from 'lucide-react';
import type { Note } from '../../types';
import { term } from '../../terms';
import type { SheetAction } from '../ui/ActionSheet';
import { t } from '../../i18n';

export interface NoteMenuCtx {
  me: string;
  canDelete: (n: Note) => boolean;
  canEdit: (n: Note) => boolean;
  pin: (n: Note) => void;
  move: (n: Note) => void;
  share: (n: Note) => void;
  copyLink: (n: Note) => void;
  duplicate: (n: Note) => void;
  remove: (n: Note) => void;
}

/** One note's actions, in this order everywhere (the row's long-press, right-click and "…", and the open note's "…"). */
export function noteActions(n: Note, c: NoteMenuCtx): SheetAction[] {
  const owner = n.ownerId === c.me;
  const edit = c.canEdit(n);
  return [
    ...(edit ? [{ label: n.pinned ? t('Unpin') : t('Pin to the top'), icon: n.pinned ? PinOff : Pin, run: () => c.pin(n) }] : []),
    ...(edit ? [{ label: t('Move to a {project}', { project: term.one }), icon: FolderInput, run: () => c.move(n) }] : []),
    ...(owner ? [{ label: n.visibility === 'team' ? t('Who sees it') : t('Share'), icon: n.visibility === 'team' ? Users : Lock, hint: n.visibility === 'team' ? undefined : t('Only you see it now'), run: () => c.share(n) }] : []),
    { label: t('Copy link'), icon: Link2, group: 'copy', run: () => c.copyLink(n) },
    { label: t('Duplicate'), icon: CopyPlus, group: 'copy', run: () => c.duplicate(n) },
    ...(c.canDelete(n) ? [{ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => c.remove(n) }] : []),
  ];
}
