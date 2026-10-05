import { useEffect, useRef, useState } from 'react';
import { History, Plus, Send, Sparkles, X } from 'lucide-react';
import { relative } from '../utils';
import { Select } from './ui/Select';

/** What the assistant is looking at. */
export type AskScope = { kind: 'all' } | { kind: 'client'; id: string } | { kind: 'meeting'; id: string } | { kind: 'channel'; id: string };

export interface AskChat {
  id: string;
  title: string;
  scope: AskScope;
  messages: { role: 'user' | 'ai'; text: string }[];
  at: string;
}

export const scopeKey = (s: AskScope) => (s.kind === 'all' ? 'all' : `${s.kind}:${s.id}`);
export const keyScope = (k: string): AskScope => {
  if (k === 'all') return { kind: 'all' };
  const [kind, ...rest] = k.split(':');
  return { kind: kind as 'client', id: rest.join(':') };
};

const CHIPS: Record<AskScope['kind'], string[]> = {
  all: ['What’s urgent today?', 'What did we promise clients this week?', 'Which tasks are overdue?'],
  client: ['Where do things stand with this client?', 'What is still open, and who owns it?', 'What are the biggest risks right now?'],
  meeting: ['Summarize this meeting in 3 bullets', 'What did we promise the client?', 'Draft a follow-up email'],
  channel: ['What did I miss here?', 'What was decided?', 'Which questions are still open?'],
};

interface Props {
  scope: AskScope;
  setScope: (s: AskScope) => void;
  scopeOptions: { value: string; label: string; group?: string }[];
  chats: AskChat[];
  setChats: (c: AskChat[]) => void;
  ask: (question: string, scope: AskScope, history: { role: 'user' | 'ai'; text: string }[]) => Promise<string>;
  /** Citations look like [M:id], [M:id@ms], [E:id], [C:id]: meetings, emails, chat channels. */
  citeLabel: (kind: string, id: string) => string;
  onCite: (kind: string, id: string, at?: number) => void;
  live: boolean; // a real AI is connected
  onClose: () => void;
  /** Ask this straight away (e.g. from search). */
  seed?: string;
}

/** The one assistant: everything, a client, a channel or a meeting. Answers link to their sources. */
export function Assistant(p: Props) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const chat = p.chats.find((c) => c.id === chatId);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat?.messages.length, busy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop, .modal-scrim') && p.onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [p]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const id = chat?.id ?? Math.random().toString(36).slice(2);
    const base: AskChat = chat ?? { id, title: q.slice(0, 80), scope: p.scope, messages: [], at: new Date().toISOString() };
    const next: AskChat = { ...base, messages: [...base.messages, { role: 'user', text: q }], at: new Date().toISOString() };
    p.setChats([next, ...p.chats.filter((c) => c.id !== id)].slice(0, 50));
    setChatId(id);
    setText('');
    setBusy(true);
    let answer: string;
    try {
      answer = await p.ask(q, p.scope, base.messages.slice(-12));
    } catch (e) {
      answer = `**Couldn't answer:** ${(e as Error).message}`;
    }
    p.setChats([{ ...next, messages: [...next.messages, { role: 'ai' as const, text: answer }] }, ...p.chats.filter((c) => c.id !== id)].slice(0, 50));
    setBusy(false);
  };

  // A question handed over from search: ask it once, in a fresh chat.
  const seeded = useRef('');
  useEffect(() => {
    if (p.seed && seeded.current !== p.seed) {
      seeded.current = p.seed;
      setChatId(null);
      setTimeout(() => void ask(p.seed!), 0);
    }
  }, [p.seed]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Light markdown plus source links. */
  const render = (t: string) =>
    t.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\[[MECT]:[\w-]+(?:@\d+)?\])/g);
      const body = parts.map((part, j) => {
        const cite = part.match(/^\[([MECT]):([\w-]+)(?:@(\d+))?\]$/);
        if (cite)
          return (
            <button key={j} className="cite" onClick={() => p.onCite(cite[1], cite[2], cite[3] ? Number(cite[3]) : undefined)}>
              {p.citeLabel(cite[1], cite[2])}
            </button>
          );
        return part.startsWith('**') ? <b key={j}>{part.slice(2, -2)}</b> : part;
      });
      return line.startsWith('- ') || line.startsWith('• ') ? (
        <li key={i}>{body.map((b, k) => (k === 0 && typeof b === 'string' ? b.slice(2) : b))}</li>
      ) : (
        <p key={i}>{body}</p>
      );
    });

  return (
    <aside className="ask-drawer" role="dialog" aria-label="Ask AI">
      <header className="cs-head">
        <Sparkles size={15} />
        <strong>Ask AI</strong>
        {!p.live && <span className="demo-tag">Demo AI</span>}
        <span className="spacer" />
        <button className="icon-btn sm" title="Past chats" onClick={() => setHistory((h) => !h)}>
          <History size={15} />
        </button>
        <button className="icon-btn sm" title="New chat" onClick={() => (setChatId(null), setHistory(false))}>
          <Plus size={15} />
        </button>
        <button className="icon-btn sm" onClick={p.onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className="ask-scope">
        <span className="muted small">Looking at</span>
        <Select value={scopeKey(p.scope)} onChange={(v) => p.setScope(keyScope(v))} label="Looking at" className="sel-flat" width={300} searchable options={p.scopeOptions} />
      </div>
      <div className="cs-body">
        {history ? (
          <div className="people-list">
            {p.chats.length === 0 && <p className="te-empty">No chats yet. Ask your first question below.</p>}
            {p.chats.map((c) => (
              <div key={c.id} className="pl-row">
                <button className="pl-text" onClick={() => (setChatId(c.id), p.setScope(c.scope), setHistory(false))}>
                  <strong>{c.title}</strong>
                  <small>
                    {relative(c.at)}
                    {c.scope.kind !== 'all' ? ` · ${c.scope.kind}` : ''}
                  </small>
                </button>
                <button className="icon-btn sm" onClick={() => p.setChats(p.chats.filter((x) => x.id !== c.id))} aria-label="Delete chat">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : !chat ? (
          <div className="ask-empty">
            <Sparkles size={22} />
            <strong>Ask anything about your work</strong>
            <p className="muted small">Answers come from your emails, chat, meetings and tasks, with links to the source.</p>
            {CHIPS[p.scope.kind].map((c) => (
              <button key={c} className="ask-chip" onClick={() => ask(c)}>
                {c}
              </button>
            ))}
          </div>
        ) : (
          <div className="ask-msgs">
            {chat.messages.map((msg, i) => (
              <div key={i} className={`ask-msg ${msg.role}`}>
                {msg.role === 'ai' ? render(msg.text) : msg.text}
              </div>
            ))}
            {busy && (
              <div className="ask-msg ai typing">
                <i />
                <i />
                <i />
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="thread-compose">
        <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask(text))} placeholder="Ask about a client, a meeting, open tasks…" />
        <div className="tc-foot">
          <span className="muted small">Uses AI when you send</span>
          <button className="ai-send chat-send" onClick={() => ask(text)} disabled={!text.trim() || busy} aria-label="Ask">
            <Send size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
