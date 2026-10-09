import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { Todo } from '../../types';
import { addPill, blockOf, cleanStyles, decorate, findText, lineText, sanitizeNote } from './noteHtml';
import { t } from '../../i18n';

/** Where the caret is, for the keyboard bar and the toolbar: it changes with the cursor. */
export interface Caret {
  inList: boolean;
  inChecklist: boolean;
  selection: boolean; // some text selected
  on: Set<string>; // bold, italic, underline, strikeThrough, insertUnorderedList, insertOrderedList, h1, h2, h3, quote
}

export interface NoteTextHandle {
  focus: (atEnd?: boolean) => void;
  blur: () => void;
  /** Formatting on what's selected (or from the caret on). */
  cmd: (name: string, value?: string) => void;
  block: (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE') => void;
  checklist: () => void;
  highlight: (color: string | null) => void;
  moveLine: (dir: -1 | 1) => void;
  insertHtml: (html: string) => void;
  link: (href: string, text?: string) => void;
  /** The line under the caret (or the selected words) and the line itself, for Make a task. */
  line: () => { text: string; block: HTMLElement | null };
  pill: (block: HTMLElement, taskId: string) => void;
  unpill: (taskId: string) => void;
  /** Remembers the selection before a sheet takes the keyboard's place, and puts it back after. */
  save: () => void;
  restore: () => void;
  /** Scrolls to the first place `q` is written and marks it for a moment. */
  showMatch: (q: string) => void;
  /** Starts typing where the finger landed (the tap itself brings the phone's keyboard up). */
  focusAt: (x: number, y: number) => void;
  /** Lines were changed from outside (the line menu): save them. */
  changed: () => void;
  root: () => HTMLElement | null;
}

// document.execCommand is old but still the simplest way to format a contentEditable in every browser.
const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

/** Shows the placeholder while there's nothing written (only touching the class when it changes). */
function markEmpty(root: HTMLElement) {
  const empty = !(root.textContent ?? '').trim() && !root.querySelector('ul, ol, hr, blockquote, .note-task');
  if (root.classList.contains('is-empty') !== empty) root.classList.toggle('is-empty', empty);
}

/**
 * The note's text: edited in place. `editable` off is the reading view (viewers always; on phones until a tap puts
 * the caret there, so scrolling never edits). A tap on a checklist's box ticks it; a tap on a task's pill opens the
 * task; a long-press on a line (reading view, phones) opens the line's menu.
 */
export const NoteText = forwardRef<NoteTextHandle, {
  html: string;
  editable: boolean;
  tasks: Map<string, Todo>;
  placeholder?: string;
  onChange: (html: string) => void;
  onCaret?: (c: Caret) => void;
  onFocus?: (on: boolean) => void;
  onOpenTask?: (id: string) => void;
  onOpenNote?: (id: string) => void;
  /** Reading view: a tap at x, y starts editing there. */
  onTapToEdit?: (x: number, y: number) => void;
  /** Reading view on touch: hold a line for its menu. */
  onLineMenu?: (block: HTMLElement, x: number, y: number) => void;
}>(function NoteText(p, ref) {
  const el = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const cb = useRef(p);
  cb.current = p;

  // The text goes in once (the editor owns it after that); a note opened again remounts it (key by note id).
  useLayoutEffect(() => {
    const root = el.current!;
    root.innerHTML = sanitizeNote(p.html) || '<p><br></p>';
    decorate(root, p.tasks);
    markEmpty(root);
    exec('defaultParagraphSeparator', 'p');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Someone else changed it (or a draft came back) while it isn't being typed in: show theirs.
  useEffect(() => {
    const root = el.current!;
    if (document.activeElement === root) return;
    const mine = sanitizeNote(root.innerHTML);
    const next = sanitizeNote(p.html);
    if (mine !== next && next !== '') {
      root.innerHTML = next;
      decorate(root, p.tasks);
      markEmpty(root);
    }
  }, [p.html]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (el.current) decorate(el.current, p.tasks);
  }, [p.tasks]);

  const emit = useCallback(() => {
    const root = el.current;
    if (!root) return;
    decorate(root, cb.current.tasks);
    markEmpty(root);
    cb.current.onChange(sanitizeNote(root.innerHTML));
  }, []);

  const caret = useCallback(() => {
    const root = el.current;
    const sel = getSelection();
    if (!root || !sel || !sel.anchorNode || !root.contains(sel.anchorNode)) return;
    const b = blockOf(sel.anchorNode, root);
    const list = b?.closest('ul, ol');
    const on = new Set<string>();
    for (const c of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) if (document.queryCommandState(c)) on.add(c);
    if (b?.matches('li.done')) on.delete('strikeThrough'); // a ticked line is struck through by its look, not by a style
    const head = b?.closest('h1, h2, h3, blockquote');
    if (head) on.add(head.tagName === 'BLOCKQUOTE' ? 'quote' : head.tagName.toLowerCase());
    cb.current.onCaret?.({ inList: !!list && root.contains(list), inChecklist: !!list?.classList.contains('checklist'), selection: !sel.isCollapsed, on });
  }, []);
  useEffect(() => {
    document.addEventListener('selectionchange', caret);
    return () => document.removeEventListener('selectionchange', caret);
  }, [caret]);

  const run = (fn: () => void) => {
    const root = el.current;
    if (!root) return;
    if (document.activeElement !== root) {
      root.focus({ preventScroll: true });
      if (saved.current) {
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(saved.current);
      }
    }
    fn();
    emit();
    caret();
  };

  useImperativeHandle(ref, () => ({
    focus: (atEnd) => {
      const root = el.current;
      if (!root) return;
      root.focus({ preventScroll: !atEnd });
      if (atEnd) {
        const r = document.createRange();
        r.selectNodeContents(root);
        r.collapse(false);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(r);
      }
    },
    blur: () => el.current?.blur(),
    cmd: (name, value) => run(() => exec(name, value)),
    block: (tag) =>
      run(() => {
        const root = el.current!;
        const b = blockOf(getSelection()?.anchorNode ?? null, root);
        // The same style again turns it back into plain text.
        const same = b && (b.tagName === tag || (tag === 'BLOCKQUOTE' && b.closest('blockquote')));
        exec('formatBlock', same && tag !== 'P' ? 'P' : tag);
      }),
    checklist: () =>
      run(() => {
        const root = el.current!;
        const sel = getSelection();
        const keep = sel?.anchorNode ? { node: sel.anchorNode, at: sel.anchorOffset } : null;
        const b = blockOf(sel?.anchorNode ?? null, root);
        if (!b) return;
        const ul = b.closest('ul, ol');
        const inList = !!ul && root.contains(ul);
        if (inList && ul!.classList.contains('checklist')) {
          // Back to a plain line (the browser splits the list where needed).
          exec('insertUnorderedList');
        } else if (inList && ul!.tagName === 'UL') {
          ul!.classList.add('checklist'); // this list becomes a checklist
        } else {
          // A plain line becomes a checklist line: joined to a checklist right above, else its own (never merged
          // into a bulleted list next to it).
          const li = document.createElement('li');
          while (b.firstChild) li.appendChild(b.firstChild);
          if (!li.childNodes.length) li.appendChild(document.createElement('br'));
          const prev = b.previousElementSibling;
          if (prev?.matches('ul.checklist')) {
            prev.appendChild(li);
            b.remove();
          } else {
            const list = document.createElement('ul');
            list.className = 'checklist';
            list.appendChild(li);
            b.replaceWith(list);
          }
        }
        // The caret stays where it was.
        if (keep?.node.isConnected && root.contains(keep.node)) {
          const r = document.createRange();
          r.setStart(keep.node, Math.min(keep.at, keep.node.nodeType === 3 ? (keep.node.textContent ?? '').length : keep.node.childNodes.length));
          r.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }),
    highlight: (color) =>
      run(() => {
        exec('styleWithCSS', 'true');
        exec('hiliteColor', color ?? 'transparent');
        exec('styleWithCSS', 'false');
      }),
    moveLine: (dir) =>
      run(() => {
        const root = el.current!;
        const b = blockOf(getSelection()?.anchorNode ?? null, root);
        if (!b || !b.parentNode) return;
        const other = dir < 0 ? b.previousElementSibling : b.nextElementSibling;
        if (!other) return;
        const sel = getSelection();
        const r = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        b.parentNode.insertBefore(b, dir < 0 ? other : other.nextSibling);
        if (r) (sel!.removeAllRanges(), sel!.addRange(r));
        b.scrollIntoView({ block: 'nearest' });
      }),
    insertHtml: (html) => run(() => exec('insertHTML', sanitizeNote(html))),
    link: (href, text) =>
      run(() => {
        const sel = getSelection();
        const safe = href.replace(/"/g, '%22');
        if (!sel || sel.isCollapsed) exec('insertHTML', `<a href="${safe}">${(text ?? href).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a>&nbsp;`);
        else exec('createLink', safe);
      }),
    line: () => {
      const root = el.current!;
      const sel = getSelection();
      const node = sel?.anchorNode && root.contains(sel.anchorNode) ? sel.anchorNode : saved.current?.startContainer ?? null;
      const b = blockOf(node, root);
      const picked = sel && !sel.isCollapsed && root.contains(sel.anchorNode) ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      return { text: picked || (b ? lineText(b) : ''), block: b };
    },
    pill: (block, taskId) => {
      addPill(block, taskId);
      emit();
    },
    unpill: (taskId) => {
      el.current?.querySelectorAll(`.note-task[data-task="${CSS.escape(taskId)}"]`).forEach((x) => x.remove());
      emit();
    },
    save: () => {
      const sel = getSelection();
      if (sel?.rangeCount && el.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    },
    restore: () => {
      const root = el.current;
      if (!root || !saved.current) return;
      root.focus({ preventScroll: true });
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(saved.current);
    },
    focusAt: (x, y) => {
      const root = el.current;
      if (!root) return;
      root.focus({ preventScroll: true });
      const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      let r: Range | null = document.caretRangeFromPoint?.(x, y) ?? null;
      if (!r && d.caretPositionFromPoint) {
        const pos = d.caretPositionFromPoint(x, y);
        if (pos) {
          r = document.createRange();
          r.setStart(pos.offsetNode, pos.offset);
        }
      }
      if (r && root.contains(r.startContainer)) {
        r.collapse(true);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(r);
      }
    },
    changed: () => emit(),
    root: () => el.current,
    showMatch: (q) => {
      const root = el.current;
      const r = root && findText(root, q);
      if (!r) return;
      const box = r.getBoundingClientRect();
      const scroller = root.closest('.note-scroll') as HTMLElement | null;
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + box.top - scroller.getBoundingClientRect().top - scroller.clientHeight / 3, behavior: 'smooth' });
      // A highlight that fades (the CSS Custom Highlight API where there is one; otherwise just the scroll).
      const H = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
      const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
      if (H && reg) {
        reg.set('note-match', new H(r));
        setTimeout(() => reg.delete('note-match'), 2400);
      }
    },
  }));

  // Touch in the reading view: a hold opens the line's menu, a tap starts editing where it landed.
  const press = useRef<{ x: number; y: number; t: number; timer: number; fired: boolean } | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return (
    <div
      ref={el}
      className={`note-text${p.editable ? '' : ' reading'}`}
      contentEditable={p.editable}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={t('Note')}
      aria-readonly={!p.editable}
      data-placeholder={p.placeholder}
      onInput={(e) => {
        // The browser's own font sizes on split or joined lines go (the caret's line only: cheap enough per key).
        const here = blockOf(getSelection()?.anchorNode ?? null, el.current!);
        if (here?.querySelector('[style*="font"]')) {
          const sel = getSelection();
          const keep = sel?.anchorNode ? { node: sel.anchorNode, at: sel.anchorOffset } : null;
          cleanStyles(here);
          if (keep?.node.isConnected) sel?.collapse(keep.node, keep.at);
        }
        // A new checklist line starts unticked.
        if ((e.nativeEvent as InputEvent).inputType === 'insertParagraph') {
          const b = blockOf(getSelection()?.anchorNode ?? null, el.current!);
          if (b?.matches('li.done') && !lineText(b)) b.classList.remove('done');
          b?.querySelectorAll('.note-task').forEach((x) => x.remove()); // the pill stays with the line it was made from
        }
        emit();
      }}
      onFocus={() => p.onFocus?.(true)}
      onBlur={() => {
        const sel = getSelection();
        if (sel?.rangeCount && el.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
        p.onFocus?.(false);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          // The toolbar's link field (desktop) listens for this.
          el.current?.dispatchEvent(new CustomEvent('note-link', { bubbles: true }));
        }
      }}
      onPaste={(e) => {
        const html = e.clipboardData.getData('text/html');
        if (!html) return;
        e.preventDefault();
        exec('insertHTML', sanitizeNote(html));
        emit();
      }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const pill = t.closest<HTMLElement>('.note-task');
        if (pill?.dataset.task) return void (e.preventDefault(), p.onOpenTask?.(pill.dataset.task));
        const a = t.closest<HTMLAnchorElement>('a[href^="/notes/"]');
        if (a && (!p.editable || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          return p.onOpenNote?.(decodeURIComponent(a.getAttribute('href')!.slice(7)));
        }
        // The box at the start of a checklist line ticks it.
        const li = t.closest<HTMLElement>('ul.checklist > li');
        if (li && el.current?.contains(li) && e.clientX - li.getBoundingClientRect().left < 0 && (p.editable || p.onTapToEdit)) {
          li.classList.toggle('done');
          emit();
          return;
        }
        if (!p.editable && !a && p.onTapToEdit && (e.nativeEvent as PointerEvent).pointerType !== 'mouse') p.onTapToEdit(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        if (p.editable || !p.onLineMenu || e.touches.length !== 1) return;
        const t = e.touches[0];
        const x = t.clientX;
        const y = t.clientY;
        cancelPress();
        const timer = window.setTimeout(() => {
          const b = blockOf(document.elementFromPoint(x, y), el.current!);
          if (!b || !press.current) return;
          press.current.fired = true;
          b.classList.add('line-held');
          setTimeout(() => b.classList.remove('line-held'), 400);
          navigator.vibrate?.(8);
          cb.current.onLineMenu?.(b, x, y);
        }, 420);
        press.current = { x, y, t: Date.now(), timer, fired: false };
      }}
      onTouchMove={(e) => {
        const s = press.current;
        if (s && Math.hypot(e.touches[0].clientX - s.x, e.touches[0].clientY - s.y) > 8) cancelPress();
      }}
      onTouchEnd={(e) => {
        if (press.current?.fired) e.preventDefault(); // no tap after a hold
        cancelPress();
      }}
      onContextMenu={(e) => !p.editable && p.onLineMenu && e.preventDefault()}
    />
  );
});
