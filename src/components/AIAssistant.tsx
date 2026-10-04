import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mail, Sparkles, X } from 'lucide-react';
import type { Thread } from '../types';
import { ai, AI_LIVE } from '../ai';

interface Msg {
  role: 'user' | 'ai';
  text: string;
  threadIds?: string[];
  error?: boolean;
}

const SUGGESTIONS = ['What’s urgent today?', 'Catch me up on unread mail', 'What did Nadia ask for?', 'Any emails about invoices?'];

/** Tiny formatter: **bold** and "• " bullets, nothing else (answers are plain text). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i} className={line.startsWith('• ') ? 'bullet' : ''}>
          {line
            .replace(/^• /, '')
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) => (part.startsWith('**') ? <b key={j}>{part.slice(2, -2)}</b> : part))}
        </p>
      ))}
    </>
  );
}

interface Props {
  open: boolean;
  threads: Thread[];
  me: string;
  onClose: () => void;
  onOpenThread: (id: string) => void;
}

export function AIAssistant({ open, threads, me, onClose, onOpenThread }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 150);
  }, [open]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setText('');
    setMsgs((m) => [...m, { role: 'user', text: q.trim() }]);
    setBusy(true);
    try {
      const r = await ai.assistant(q.trim(), threads, me);
      setMsgs((m) => [...m, { role: 'ai', text: r.answer, threadIds: r.threadIds }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: (e as Error).message || 'Something went wrong.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`ai-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
      <header className="ai-head">
        <span className="ai-orb">
          <Sparkles size={15} />
        </span>
        <div>
          <strong>Ask Sprint2go</strong>
          <small>{AI_LIVE ? 'Powered by Claude' : 'Demo mode. Connect Claude on the server'}</small>
        </div>
        <button className="icon-btn sm" onClick={onClose} title="Close (⌘J)">
          <X size={16} />
        </button>
      </header>

      <div className="ai-scroll" ref={scroll}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            <p>Ask anything about your email and I’ll read it for you.</p>
            <div className="ai-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'ai' ? <Rich text={m.text} /> : <p>{m.text}</p>}
            {m.threadIds && m.threadIds.length > 0 && (
              <div className="ai-sources">
                {m.threadIds.map((id) => {
                  const t = threads.find((x) => x.id === id);
                  return t ? (
                    <button key={id} onClick={() => onOpenThread(id)}>
                      <Mail size={12} /> {t.subject}
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="ai-msg ai typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Ask about your email…"
        />
        <button className="ai-send" disabled={!text.trim() || busy} aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}
