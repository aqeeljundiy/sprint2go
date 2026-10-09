/**
 * The app's toast, from anywhere. App.tsx owns the toast on screen; shared pieces (SwipeRow, sheets) that aren't
 * handed `showToast` call this instead and it lands in the same place, with the same Undo button.
 */
export type ToastMsg = { text: string; action?: { label: string; run: () => void }; ms?: number };

export function toast(t: ToastMsg) {
  window.dispatchEvent(new CustomEvent<ToastMsg>('s2g:toast', { detail: t }));
}

/** Toast with Undo: the usual way to confirm something that can be taken back. */
export function toastUndo(text: string, undo: () => void, ms?: number) {
  toast({ text, action: { label: 'Undo', run: undo }, ms });
}
