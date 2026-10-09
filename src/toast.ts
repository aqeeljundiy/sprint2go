/**
 * The app's toast, from anywhere. App.tsx owns the toast on screen; shared pieces (SwipeRow, sheets) that aren't
 * handed `showToast` call this instead and it lands in the same place, with the same Undo button.
 */
import { t } from './i18n';

export type ToastMsg = { text: string; action?: { label: string; run: () => void }; also?: { label: string; run: () => void }; ms?: number };

export function toast(msg: ToastMsg) {
  window.dispatchEvent(new CustomEvent<ToastMsg>('s2g:toast', { detail: msg }));
}

/** Toast with Undo: the usual way to confirm something that can be taken back. */
export function toastUndo(text: string, undo: () => void, ms?: number) {
  toast({ text, action: { label: t('Undo'), run: undo }, ms });
}
