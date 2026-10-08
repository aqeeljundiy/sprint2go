import { useEffect, useState } from 'react';
import { seed, type Collections, type CollectionKey } from './seed';
import { pushChange } from './sync';

// Mail, calendar, drive, tasks, chat, people and workspaces live here (outside React) so they survive switching users.
// With the local server running, every change is saved there and other people's changes arrive live (see sync.ts).
export const store: Collections = seed();

/** The workspace on screen, for helpers outside React (e.g. which teams to show next to a person). */
export const session = { wsId: '' };

/** Threads already scanned for to-dos (key: user:thread:lastMessage). */
export const scanned = new Set<string>();

const listeners: Partial<Record<CollectionKey, Set<(v: never) => void>>> = {};

/** Replaces a collection with what the server sent (no echo back to the server). */
export function applyRemote<K extends CollectionKey>(key: K, value: Collections[K]) {
  store[key] = value;
  listeners[key]?.forEach((fn) => (fn as (v: Collections[K]) => void)(value));
}

export function useStored<K extends CollectionKey>(key: K) {
  const [value, setValue] = useState<Collections[K]>(() => store[key]);
  useEffect(() => {
    const set = (listeners[key] ??= new Set());
    set.add(setValue as (v: never) => void);
    // A change may have arrived between the first render and now.
    if (store[key] !== value) setValue(store[key]);
    return () => void set.delete(setValue as (v: never) => void);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (store[key] === value) return;
    store[key] = value;
    // Other parts of the app showing the same collection see the change too.
    listeners[key]?.forEach((fn) => fn !== (setValue as unknown) && (fn as (v: Collections[K]) => void)(value));
    pushChange(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
