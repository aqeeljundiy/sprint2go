import { useEffect, useRef } from 'react';

/**
 * Side panels show one thing at a time: when one opens, any other open side panel closes.
 * Call it in every side panel (task, table row, guest task) with that panel's close.
 */
export function useOnePanel(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = Symbol('panel');
    window.dispatchEvent(new CustomEvent('s2g:panel', { detail: me }));
    const other = (e: Event) => (e as CustomEvent).detail !== me && close.current();
    window.addEventListener('s2g:panel', other);
    return () => window.removeEventListener('s2g:panel', other);
  }, []);
}
