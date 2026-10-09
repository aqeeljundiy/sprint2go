/**
 * An email with nothing written yet holds only the signature, with an empty line above it. A tap on the blank space
 * below would put the caret after the signature; this puts it on that first line instead, where the email starts.
 * Use on the editor's wrapper: onClick={(e) => startAtTop(e, written)}.
 */
export function startAtTop(e: React.MouseEvent, written: boolean) {
  if (written) return;
  const ed = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.rich-body');
  if (!ed || e.target !== ed) return; // a tap on the signature itself edits the signature
  const r = document.createRange();
  r.setStart(ed.firstChild ?? ed, 0);
  r.collapse(true);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
