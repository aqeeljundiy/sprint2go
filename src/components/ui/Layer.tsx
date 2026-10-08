import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Puts a dialog or drawer at the top of the page instead of inside the pane that opened it. A pane, sidebar or page
 * with a transform, filter or container-type would otherwise hold a "position: fixed" scrim inside itself: the dialog
 * shows squeezed into that box (or off screen, in a closed phone drawer) instead of over the whole window.
 */
export function Layer({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
}
