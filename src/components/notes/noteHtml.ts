import DOMPurify from 'dompurify';
import type { Note, Todo } from '../../types';
import { htmlToText } from '../../sanitize';

/*
 * A note's text is simple HTML: paragraphs, headings, lists (a checklist is <ul class="checklist">, a ticked line
 * <li class="done">), quotes, dividers, links, bold and friends, highlights (a background colour), and the small pill
 * of a task made from a line (<span class="note-task" data-task="…">, empty: the pill is drawn by CSS).
 */

const TAGS = ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'code', 'pre', 'hr', 'font'];
const ATTRS = ['href', 'style', 'color', 'class', 'data-task'];
const CLASSES = new Set(['checklist', 'done', 'note-task']);

/** What a note may hold (also what's saved): our own classes only, a task id only on a task pill. */
export function sanitizeNote(html: string) {
  const clean = DOMPurify.sanitize(html.replace(/url\s*\(/gi, 'url-off('), { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS }) as string;
  if (!/class=|data-task=|style=/.test(clean)) return clean;
  const box = document.createElement('div');
  box.innerHTML = clean;
  cleanStyles(box);
  box.querySelectorAll('[class]').forEach((el) => {
    const keep = [...el.classList].filter((c) => CLASSES.has(c));
    if (keep.length) el.setAttribute('class', keep.join(' '));
    else el.removeAttribute('class');
  });
  box.querySelectorAll('[data-task]').forEach((el) => {
    if (!el.classList.contains('note-task') || !/^[\w-]{1,64}$/.test(el.getAttribute('data-task') ?? '')) el.removeAttribute('data-task');
  });
  return box.innerHTML;
}

/**
 * Inline styles a note keeps: a highlight and a text colour. The browser's editing adds font sizes and families of
 * its own (to "preserve" a look when lines split or join); those go, and a span left with nothing goes too.
 */
export function cleanStyles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const keep: string[] = [];
    const bg = el.style.backgroundColor;
    const fg = el.style.color;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') keep.push(`background-color: ${bg}`);
    if (fg && el.tagName === 'SPAN') keep.push(`color: ${fg}`);
    const next = keep.join('; ');
    if (next) {
      if (el.getAttribute('style') !== next) el.setAttribute('style', next);
    } else el.removeAttribute('style');
    if (el.tagName === 'SPAN' && !el.attributes.length) el.replaceWith(...el.childNodes);
  });
}

const BLOCK = 'p, div, li, h1, h2, h3, blockquote, pre';

/** The line (block) a node sits in, inside the editor. */
export function blockOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.matches(BLOCK)) return el;
    el = el.parentNode;
  }
  return null;
}

/** A line's own words (not a nested list's, not a task pill). */
export function lineText(block: HTMLElement) {
  let t = '';
  block.childNodes.forEach((n) => {
    if (n instanceof HTMLElement && (n.matches('ul, ol') || n.classList.contains('note-task'))) return;
    t += n.textContent ?? '';
  });
  return t.replace(/\s+/g, ' ').trim();
}

/** Puts a task's pill at the end of a line (before a nested list). */
export function addPill(block: HTMLElement, taskId: string) {
  const pill = document.createElement('span');
  pill.className = 'note-task';
  pill.dataset.task = taskId;
  pill.contentEditable = 'false';
  const nested = [...block.children].find((c) => c.matches('ul, ol'));
  if (nested) block.insertBefore(pill, nested);
  else block.appendChild(pill);
  return pill;
}

/** After the HTML was set: pills can't be typed into, and say whether their task is done. */
export function decorate(root: HTMLElement, tasks: Map<string, Todo>) {
  root.querySelectorAll<HTMLElement>('.note-task').forEach((p) => {
    if (p.contentEditable !== 'false') p.contentEditable = 'false';
    const t = tasks.get(p.dataset.task ?? '');
    const state = !t ? 'gone' : t.done ? 'done' : 'open';
    if (p.dataset.state !== state) p.dataset.state = state;
    const label = !t ? 'Task (deleted)' : `Task: ${t.title}${t.done ? ', done' : ''}`;
    if (p.getAttribute('aria-label') !== label) {
      p.setAttribute('aria-label', label);
      p.setAttribute('role', 'button');
      p.title = label;
    }
  });
}

/** The note's link inside sprint2go (Copy link, and @ mentions of a note). */
export const noteLink = (id: string) => `/notes/${encodeURIComponent(id)}`;
export const noteUrl = (id: string) => `${location.origin}${noteLink(id)}`;

/** Notes and tasks that point at this note: what "Linked from" lists. */
export function linkedFrom(note: Note, notes: Note[], tasks: Todo[]) {
  const href = noteLink(note.id);
  return {
    notes: notes.filter((n) => n.id !== note.id && !n.deletedAt && n.html.includes(`href="${href}"`)),
    tasks: tasks.filter((t) => t.noteId === note.id || (t.notes ?? '').includes(href)),
  };
}

/** Does the note have tasks made from it (for the "Has tasks" chip)? */
export const hasTasks = (n: Note) => n.html.includes('note-task');

/** A short bit of the note around the first match, with where the match is. */
export function snippetAround(n: Note, q: string) {
  const text = `${n.title}\n${htmlToText(n.html)}`;
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return { before: htmlToText(n.html).slice(0, 110), hit: '', after: '' };
  const from = Math.max(0, i - 40);
  return { before: (from > 0 ? '…' : '') + text.slice(from, i).replace(/\s+/g, ' '), hit: text.slice(i, i + q.length), after: text.slice(i + q.length, i + q.length + 70).replace(/\s+/g, ' ') };
}

/** Finds the first place `q` is written in the editor (for opening a note at a search match). */
export function findText(root: HTMLElement, q: string): Range | null {
  if (!q) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const needle = q.toLowerCase();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.textContent ?? '').toLowerCase().indexOf(needle);
    if (i >= 0) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      return r;
    }
  }
  return null;
}
