import { useEffect, useRef, useState } from 'react';
import type { Note } from '../../types';
import { live, unsent } from '../../sync';
import { lsKey } from '../../settings';

/** How long Recently deleted keeps a note (the server deletes it for good after). */
export const KEEP_DAYS = 30;

type Draft = { title: string; html: string; at: string };
const key = (id: string) => lsKey(`s2g-note-draft:${id}`);
const read = (id: string): Draft | null => {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
};

/** Every change is kept on this device first, before anything goes over the network. */
export function keepDraft(id: string, title: string, html: string) {
  try {
    localStorage.setItem(key(id), JSON.stringify({ title, html, at: new Date().toISOString() }));
  } catch {
    /* private window, or full: the server copy is all there is */
  }
}

/**
 * Never lose a thought: while a note is open, a change kept on this device that the server doesn't have yet (written
 * offline, or lost when the connection came back and the app loaded everything again) is put back. Once the note
 * says the same as the kept copy, the copy goes.
 */
export function useNoteDraft(note: Note | undefined, patch: (id: string, p: Partial<Note>) => void) {
  useEffect(() => {
    if (!note) return;
    const d = read(note.id);
    if (!d) return;
    if (d.title === note.title && d.html === note.html) {
      if (!live.down && navigator.onLine !== false) localStorage.removeItem(key(note.id));
      return;
    }
    // Someone changed it after this device did: theirs stands.
    if (d.at < note.updatedAt) return void localStorage.removeItem(key(note.id));
    patch(note.id, { title: d.title, html: d.html });
  }, [note?.id, note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type SaveState = 'saved' | 'saving' | 'device' | 'failed';

/**
 * Whether this note's changes reached the server: "Saved", "Saving", "Saved on this device, will sync" (offline, or
 * the connection dropped: src/sync.ts sends them again when it's back), or a save the server refused.
 */
export function useSaveState(noteId: string) {
  const current = (): SaveState => {
    const u = unsent('notes');
    if (navigator.onLine === false || live.down || (u.failed && u.ids.has(noteId))) return 'device';
    return u.ids.has(noteId) ? 'saving' : 'saved';
  };
  const [state, setState] = useState<SaveState>(current);
  const failed = useRef('');
  useEffect(() => {
    const check = () => setState((s) => (s === 'failed' ? s : current()));
    const fail = (e: Event) => {
      const d = (e as CustomEvent<{ coll: string; error?: string }>).detail;
      if (d?.coll !== 'notes') return;
      failed.current = d.error ?? '';
      setState('failed');
    };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    window.addEventListener('s2g:live', check);
    window.addEventListener('s2g:unsent', check);
    window.addEventListener('s2g:save-failed', fail);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      window.removeEventListener('s2g:live', check);
      window.removeEventListener('s2g:unsent', check);
      window.removeEventListener('s2g:save-failed', fail);
    };
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, why: failed.current, edited: () => setState((s) => (s === 'failed' ? current() : s)) };
}
