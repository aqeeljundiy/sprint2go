import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Bold,
  Check,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react';
import { htmlToText, sanitize } from '../sanitize';
import { mark, t } from '../i18n';

export interface RichEditorHandle {
  focus: () => void;
  clear: () => void;
  /** Replace the content (used by AI drafting). */
  setHtml: (html: string) => void;
}

interface Props {
  initialHtml?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (html: string, text: string) => void;
  onSubmit?: () => void;
  /** Extra buttons shown at the end of the toolbar (e.g. attach). */
  extra?: React.ReactNode;
}

type Cmd = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList';

const BUTTONS: { cmd: Cmd; icon: LucideIcon; label: string; key?: string }[] = [
  { cmd: 'bold', icon: Bold, label: mark('Bold'), key: '⌘B' },
  { cmd: 'italic', icon: Italic, label: mark('Italic'), key: '⌘I' },
  { cmd: 'underline', icon: Underline, label: mark('Underline'), key: '⌘U' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: mark('Strikethrough') },
];
const LISTS: { cmd: Cmd; icon: LucideIcon; label: string }[] = [
  { cmd: 'insertUnorderedList', icon: List, label: mark('Bulleted list') },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: mark('Numbered list') },
];
const COLORS = ['inherit', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', '#5b5bf6', '#d946ef', '#6b7280'];
const SIZES = [
  { label: mark('Small'), size: '2', px: 12 },
  { label: mark('Normal'), size: '3', px: 14 },
  { label: mark('Large'), size: '5', px: 19 },
  { label: mark('Huge'), size: '6', px: 24 },
];

// document.execCommand is old but still the simplest way to format a contentEditable
// in every browser. A real-backend version can swap this for TipTap without UI changes.
const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialHtml = '', placeholder, autoFocus, onChange, onSubmit, extra },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [empty, setEmpty] = useState(!initialHtml);
  const [popup, setPopup] = useState<'link' | 'color' | 'size' | null>(null);
  const [linkUrl, setLinkUrl] = useState('');

  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    clear: () => {
      if (el.current) el.current.innerHTML = '';
      emit();
    },
    setHtml: (html: string) => {
      if (!el.current) return;
      el.current.innerHTML = sanitize(html);
      el.current.classList.remove('ai-in');
      void el.current.offsetWidth; // restart the highlight animation
      el.current.classList.add('ai-in');
      emit();
    },
  }));

  useEffect(() => {
    if (el.current) el.current.innerHTML = sanitize(initialHtml);
    if (autoFocus) {
      el.current?.focus();
      // Put the caret at the start, above any signature.
      const sel = getSelection();
      if (sel && el.current) {
        sel.removeAllRanges();
        const r = document.createRange();
        r.setStart(el.current, 0);
        r.collapse(true);
        sel.addRange(r);
      }
    }
    exec('styleWithCSS', 'false');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = useCallback(() => {
    const html = el.current?.innerHTML ?? '';
    const text = htmlToText(html);
    setEmpty(!text && !/<(ul|ol|blockquote|img)/.test(html));
    onChange(html, text);
  }, [onChange]);

  const refreshActive = useCallback(() => {
    const sel = getSelection();
    if (!sel || !el.current?.contains(sel.anchorNode)) return;
    const next = new Set<string>();
    for (const c of [...BUTTONS, ...LISTS]) if (document.queryCommandState(c.cmd)) next.add(c.cmd);
    if (sel.anchorNode && (sel.anchorNode.parentElement?.closest('blockquote'))) next.add('quote');
    setActive(next);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive);
    return () => document.removeEventListener('selectionchange', refreshActive);
  }, [refreshActive]);

  const saveSelection = () => {
    const sel = getSelection();
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    el.current?.focus();
    const sel = getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const run = (cmd: string, value?: string) => {
    restoreSelection();
    exec(cmd, value);
    emit();
    refreshActive();
  };

  const toggleQuote = () => run('formatBlock', active.has('quote') ? 'P' : 'BLOCKQUOTE');

  const openPopup = (p: 'link' | 'color' | 'size') => {
    saveSelection();
    if (p === 'link') {
      const a = getSelection()?.anchorNode?.parentElement?.closest('a');
      setLinkUrl(a?.getAttribute('href') ?? '');
    }
    setPopup((cur) => (cur === p ? null : p));
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setPopup(null);
    if (!url) return run('unlink');
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    restoreSelection();
    if (getSelection()?.isCollapsed) exec('insertHTML', `<a href="${href.replace(/"/g, '%22')}">${url.replace(/</g, '&lt;')}</a>`);
    else exec('createLink', href);
    emit();
  };

  // Mouse-down on toolbar buttons must not steal the editor's selection.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="rich">
      <div className="rich-toolbar" onMouseDown={keep}>
        <div className="tb-group">
          <button className={`tb ${popup === 'size' ? 'on' : ''}`} title={t('Text size')} onClick={() => openPopup('size')}>
            <Type size={15} />
          </button>
          {BUTTONS.map(({ cmd, icon: Icon, label, key }) => (
            <button
              key={cmd}
              className={`tb ${active.has(cmd) ? 'on' : ''}`}
              title={key ? `${t(label)} (${key})` : t(label)}
              onClick={() => run(cmd)}
            >
              <Icon size={15} />
            </button>
          ))}
          <button className={`tb ${popup === 'color' ? 'on' : ''}`} title={t('Text color')} onClick={() => openPopup('color')}>
            <Palette size={15} />
          </button>
        </div>
        <span className="tb-sep" />
        <div className="tb-group">
          {LISTS.map(({ cmd, icon: Icon, label }) => (
            <button key={cmd} className={`tb ${active.has(cmd) ? 'on' : ''}`} title={t(label)} onClick={() => run(cmd)}>
              <Icon size={15} />
            </button>
          ))}
          <button className={`tb ${active.has('quote') ? 'on' : ''}`} title={t('Quote')} onClick={toggleQuote}>
            <Quote size={15} />
          </button>
          <button className={`tb ${popup === 'link' ? 'on' : ''}`} title={t('Link (⌘K)')} onClick={() => openPopup('link')}>
            <Link2 size={15} />
          </button>
          <button className="tb" title={t('Clear formatting')} onClick={() => run('removeFormat')}>
            <RemoveFormatting size={15} />
          </button>
        </div>
        {extra && (
          <>
            <span className="tb-sep" />
            <div className="tb-group">{extra}</div>
          </>
        )}

        {popup && (
          <div className="tb-popup" onMouseDown={(e) => popup !== 'link' && e.preventDefault()}>
            {popup === 'link' && (
              <div className="link-pop">
                <Link2 size={14} />
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLink();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setPopup(null);
                    }
                  }}
                  placeholder={t('Paste or type a link')}
                />
                <button className="tb" onMouseDown={keep} onClick={applyLink} title={t('Apply')}>
                  <Check size={14} />
                </button>
                <button className="tb" onMouseDown={keep} onClick={() => setPopup(null)} title={t('Cancel')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {popup === 'color' && (
              <div className="color-pop">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: c === 'inherit' ? 'var(--text)' : c }}
                    title={c === 'inherit' ? t('Default') : c}
                    onClick={() => {
                      setPopup(null);
                      run('foreColor', c === 'inherit' ? getComputedStyle(el.current!).color : c);
                    }}
                  />
                ))}
              </div>
            )}
            {popup === 'size' && (
              <div className="size-pop">
                {SIZES.map((s) => (
                  <button
                    key={s.size}
                    onClick={() => {
                      setPopup(null);
                      run('fontSize', s.size);
                    }}
                  >
                    <span style={{ fontSize: s.px }}>{t(s.label)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        ref={el}
        className={`rich-body ${empty ? 'empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={saveSelection}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit?.();
          } else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            openPopup('link');
          }
        }}
        onPaste={(e) => {
          const html = e.clipboardData.getData('text/html');
          if (!html) return;
          e.preventDefault();
          exec('insertHTML', sanitize(html));
          emit();
        }}
      />
    </div>
  );
});
