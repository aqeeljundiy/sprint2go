import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, AtSign, Bold, ChevronDown, Highlighter, Italic, Link2, ListChecks, ListIndentDecrease, ListIndentIncrease, ListTodo, Paperclip, Strikethrough, Type, Underline, Undo2 } from 'lucide-react';
import type { Caret } from './NoteText';
import { t } from '../../i18n';

export interface BarActions {
  checklist: () => void;
  task: () => void;
  format: () => void; // Aa
  mention: () => void; // @
  attach: () => void;
  undo: () => void;
  hide: () => void; // close the keyboard
  indent: (dir: 1 | -1) => void;
  move: (dir: -1 | 1) => void;
  cmd: (name: string) => void;
  highlight: () => void;
  link: () => void;
}

type Btn = { id: string; label: string; icon: LucideIcon; run: () => void; on?: boolean };

/**
 * The bar above the phone's keyboard while a note is being written: at most seven buttons, and they change with the
 * cursor. Normally Checklist, Make task, Aa, @, Attach, Undo; in a list the list tools come first; with words
 * selected, their styles. Closing the keyboard stays at the right.
 */
export function NoteBar({ caret, a, canTask }: { caret: Caret; a: BarActions; canTask: boolean }) {
  const task: Btn = { id: 'task', label: t('Make a task from this line'), icon: ListTodo, run: a.task };
  const list: Btn[] = caret.selection
    ? [
        { id: 'b', label: t('Bold'), icon: Bold, run: () => a.cmd('bold'), on: caret.on.has('bold') },
        { id: 'i', label: t('Italic'), icon: Italic, run: () => a.cmd('italic'), on: caret.on.has('italic') },
        { id: 'u', label: t('Underline'), icon: Underline, run: () => a.cmd('underline'), on: caret.on.has('underline') },
        { id: 's', label: t('Strikethrough'), icon: Strikethrough, run: () => a.cmd('strikeThrough'), on: caret.on.has('strikeThrough') },
        { id: 'hl', label: t('Highlight'), icon: Highlighter, run: a.highlight },
        { id: 'link', label: t('Link'), icon: Link2, run: a.link },
      ]
    : caret.inList
      ? [
          { id: 'out', label: t('Outdent'), icon: ListIndentDecrease, run: () => a.indent(-1) },
          { id: 'in', label: t('Indent'), icon: ListIndentIncrease, run: () => a.indent(1) },
          { id: 'up', label: t('Move line up'), icon: ArrowUp, run: () => a.move(-1) },
          { id: 'down', label: t('Move line down'), icon: ArrowDown, run: () => a.move(1) },
          ...(canTask ? [task] : []),
          { id: 'aa', label: t('Text styles'), icon: Type, run: a.format },
        ]
      : [
          { id: 'check', label: t('Checklist'), icon: ListChecks, run: a.checklist, on: caret.inChecklist },
          ...(canTask ? [task] : []),
          { id: 'aa', label: t('Text styles'), icon: Type, run: a.format },
          { id: 'at', label: t('Mention a person or a note'), icon: AtSign, run: a.mention },
          { id: 'attach', label: t('Attach a file'), icon: Paperclip, run: a.attach },
          { id: 'undo', label: t('Undo'), icon: Undo2, run: a.undo },
        ];
  return (
    <div className="note-bar" role="toolbar" aria-label={t('Writing tools')}>
      <div className="nb-tools" key={caret.selection ? 'sel' : caret.inList ? 'list' : 'text'}>
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`nb-btn${b.on ? ' on' : ''}`}
            aria-label={b.label}
            aria-pressed={b.on}
            title={b.label}
            // The editor keeps the keyboard and the selection until the tool says otherwise (the bar would go first).
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
          >
            <b.icon size={21} />
          </button>
        ))}
      </div>
      <button type="button" className="nb-btn nb-hide" aria-label={t('Close the keyboard')} title={t('Close the keyboard')} onPointerDown={(e) => e.preventDefault()} onClick={a.hide}>
        <ChevronDown size={22} />
      </button>
    </div>
  );
}
