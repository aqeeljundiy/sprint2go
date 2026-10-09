import { useMemo, useRef, useState, type ReactNode } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { User } from '../../types';
import { Avatar } from '../Avatar';
import { fullDate } from '../../utils';
import { t } from '../../i18n';
import { fmtDate } from '../../i18n/format';

type Note = { id: string; by: string; text: string; at: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of a comment with @mentions of teammates picked out. */
function withMentions(text: string, people: User[]): ReactNode {
  const names = [...new Set(people.map((u) => u.name.split(' ')[0]).filter(Boolean))];
  if (!names.length) return text;
  const re = new RegExp(`(@(?:${names.map(escapeRe).join('|')}))\\b`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <b key={i} className="mc-mention">{part}</b> : part));
}

/** A comment inside the thread: tinted, with who and when, never sent to anyone outside. */
export function MailComment({ note, people, meId }: { note: Note; people: User[]; meId: string }) {
  const u = people.find((x) => x.id === note.by);
  const time = fmtDate(note.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (
    <div className="mail-comment">
      <Avatar person={u ?? { name: t('Someone'), email: note.by }} size={28} />
      <div className="mc-main">
        <div className="mc-head">
          <strong>{note.by === meId ? t('You') : (u?.name ?? t('Someone'))}</strong>
          <time title={fullDate(note.at)}>{time}</time>
          <span className="mc-tag">
            <MessageSquare size={12} /> {t('Comment')}
          </span>
        </div>
        <p className="mc-text">{withMentions(note.text, people)}</p>
      </div>
    </div>
  );
}

/**
 * Writing a comment for the team, with @ to mention someone (they're told). Its own tinted box with its own button,
 * so a comment never goes to the sender by mistake. `bar`: the phone's version, pinned at the bottom of the reader.
 */
export function CommentBox({ people, onPost, bar, onFocusChange, autoFocus }: { people: User[]; onPost: (text: string) => void; bar?: boolean; onFocusChange?: (on: boolean) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const asking = /(?:^|\s)@([\p{L}\p{N}]*)$/u.exec(text.slice(0, caret));
  const matches = useMemo(() => {
    if (!asking) return [];
    const q = asking[1].toLowerCase();
    return people.filter((u) => u.name.toLowerCase().split(' ').some((w) => w.startsWith(q))).slice(0, 5);
  }, [asking?.[1], people]); // eslint-disable-line react-hooks/exhaustive-deps
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  const mention = (u: User) => {
    if (!asking) return;
    const first = u.name.split(' ')[0];
    const start = caret - asking[1].length - 1;
    const next = `${text.slice(0, start)}@${first} ${text.slice(caret)}`;
    setText(next);
    const at = start + first.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
      setCaret(at);
      grow();
    });
  };
  const post = () => {
    const said = text.trim();
    if (!said) return;
    onPost(said);
    setText('');
    setCaret(0);
    requestAnimationFrame(grow);
    if (bar) ref.current?.blur(); // posted: the keyboard goes and the email's actions come back
  };
  return (
    <div className={`mc-box${bar ? ' docked' : ''}`}>
      {matches.length > 0 && (
        <div className="cb-mentions" role="listbox" aria-label={t('Mention someone')}>
          {matches.map((u, i) => (
            <button key={u.id} type="button" role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseDown={(e) => (e.preventDefault(), mention(u))}>
              <Avatar person={u} size={24} />
              <span>{u.name}</span>
            </button>
          ))}
        </div>
      )}
      <MessageSquare size={16} className="cb-icon" aria-hidden="true" />
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder={bar ? t('Comment for the team') : t('Comment for the team, @ to mention someone')}
        title={t('Only people with this inbox see comments, never the sender')}
        aria-label={t('Comment for the team')}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => setTimeout(() => onFocusChange?.(document.activeElement === ref.current), 120)}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setHi(0);
          grow();
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
          } else if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            mention(matches[hi] ?? matches[0]);
          } else if (e.key === 'Enter' && !e.shiftKey && (!bar || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            post();
          } else if (e.key === 'Escape' && text) {
            e.stopPropagation();
            setText('');
          }
        }}
      />
      <button type="button" className={bar ? 'icon-btn cb-send' : 'primary-btn sm cb-send'} disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={post} aria-label={t('Post the comment')}>
        {bar ? <Send size={18} /> : t('Comment')}
      </button>
    </div>
  );
}
