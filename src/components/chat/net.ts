import { useEffect, useReducer, useState } from 'react';
import { live, server, unsent } from '../../sync';
import type { CollectionKey } from '../../seed';

/** Whether this device can reach the server right now: fine, connecting again, or offline. */
export function useConnection(): 'ok' | 'connecting' | 'offline' {
  const read = () => (!server.on ? 'ok' : typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : live.down ? 'connecting' : 'ok');
  const [state, setState] = useState<'ok' | 'connecting' | 'offline'>(read);
  useEffect(() => {
    let timer = 0;
    // "Connecting" only after a moment: a connection that comes straight back isn't worth a line.
    const on = () => {
      const now = read();
      window.clearTimeout(timer);
      if (now === 'connecting') timer = window.setTimeout(() => setState(read()), 2000);
      else setState(now);
    };
    window.addEventListener('s2g:live', on);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('s2g:live', on);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  return state;
}

/** What's made here but not on the server yet (see sync.ts), kept up to date. */
export function useUnsent(k: CollectionKey) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    window.addEventListener('s2g:unsent', bump);
    window.addEventListener('s2g:live', bump);
    return () => (window.removeEventListener('s2g:unsent', bump), window.removeEventListener('s2g:live', bump));
  }, []);
  const u = unsent(k);
  return { ids: u.ids, failed: u.failed || (server.on && (live.down || navigator.onLine === false)) };
}
