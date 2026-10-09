import { useEffect, useRef, useState } from 'react';
import type { Note } from '../../types';
import { live } from '../../sync';
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

export type SaveState = 'saved' | 'device' | 'failed';

/** Whether changes reach the server: "Saved", "Saved on this device, will sync", or a save that was refused. */
export function useSaveState() {
  const [state, setState] = useState<SaveState>(() => (navigator.onLine === false || live.down ? 'device' : 'saved'));
  const failed = useRef('');
  useEffect(() => {
    const check = () => setState((s) => (navigator.onLine === false || live.down ? 'device' : s === 'device' ? 'saved' : s));
    const fail = (e: Event) => {
      const d = (e as CustomEvent<{ coll: string; error?: string }>).detail;
      if (d?.coll !== 'notes') return;
      failed.current = d.error ?? '';
      setState('failed');
    };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    window.addEventListener('s2g:live', check);
    window.addEventListener('s2g:save-failed', fail);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      window.removeEventListener('s2g:live', check);
      window.removeEventListener('s2g:save-failed', fail);
    };
  }, []);
  return { state, why: failed.current, edited: () => state === 'failed' && setState(navigator.onLine === false || live.down ? 'device' : 'saved') };
}
