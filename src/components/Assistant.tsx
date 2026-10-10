import { useEffect, useRef, useState } from 'react';
import { term } from '../terms';
import { ArrowLeft, History, Minus, Plus, Send, Sparkles, X } from 'lucide-react';
import { relative } from '../utils';
import { Select } from './ui/Select';
import { EmptyState } from './ui/EmptyState';
import { t, tx } from '../i18n';

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
  get all() { return [t('What’s urgent today?'), t('What did we promise {projects} this week?', { projects: term.many }), t('Which tasks are overdue?')]; },
  get client() { return [t('Where do things stand with this {project}?', { project: term.one }), t('What is still open, and who owns it?'), t('What are the biggest risks right now?')]; },
  get meeting() { return [t('Summarize this meeting in 3 bullets'), t('What did we promise the {who}?', { who: term.who }), t('Draft a follow-up email')]; },
  get channel() { return [t('What did I miss here?'), t('What was decided?'), t('Which questions are still open?')]; },
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
  const [min, setMin] = useState(false); // tucked into a pill in the corner, chat kept
  const chat = p.chats.find((c) => c.id === chatId);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat?.messages.length, busy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !min && !document.querySelector('.pop, .modal-scrim') && p.onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [p, min]);

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

  if (min)
    return (
      <button type="button" className="ask-pill" onClick={() => setMin(false)} aria-label={t('Open Ask AI')}>
        <Sparkles size={16} />
        {t('Ask AI')}
        {busy && <small>{t('Answering…')}</small>}
      </button>
    );

  return (
    <aside className="ask-drawer" role="dialog" aria-label={t('Ask AI')}>
      <header className="cs-head ask-head">
        {/* Phones: a full screen with Back on the left (the window controls below are desktop's). */}
        <button className="icon-btn ask-back" onClick={p.onClose} aria-label={t('Back')}>
          <ArrowLeft size={24} />
        </button>
        <Sparkles size={15} className="ask-mark" />
        <strong>{t('Ask AI')}</strong>
        {!p.live && <span className="demo-tag">{t('Demo AI')}</span>}
        <span className="spacer" />
        <button className="icon-btn sm" title={t('Past chats')} aria-label={t('Past chats')} onClick={() => setHistory((h) => !h)}>
          <History size={15} />
        </button>
        <button className="icon-btn sm" title={t('New chat')} aria-label={t('New chat')} onClick={() => (setChatId(null), setHistory(false))}>
          <Plus size={15} />
        </button>
        <button className="icon-btn sm ask-min" title={t('Minimize')} aria-label={t('Minimize')} onClick={() => setMin(true)}>
          <Minus size={15} />
        </button>
        <button className="icon-btn sm ask-close" onClick={p.onClose} aria-label={t('Close')}>
          <X size={16} />
        </button>
      </header>
      <div className="ask-scope">
        <span className="muted small">{t('Looking at')}</span>
        <Select value={scopeKey(p.scope)} onChange={(v) => p.setScope(keyScope(v))} label={t('Looking at')} className="sel-flat" width={300} searchable options={p.scopeOptions} />
      </div>
      <div className="cs-body">
        {history ? (
          <div className="people-list">
            {p.chats.length === 0 && <EmptyState compact text={t('No chats yet. Ask your first question below.')} />}
            {p.chats.map((c) => (
              <div key={c.id} className="pl-row">
                <button className="pl-text" onClick={() => (setChatId(c.id), p.setScope(c.scope), setHistory(false))}>
                  <strong>{c.title}</strong>
                  <small>
                    {relative(c.at)}
                    {c.scope.kind !== 'all' ? ` · ${tx('scope', c.scope.kind)}` : ''}
                  </small>
                </button>
                <button className="icon-btn sm" onClick={() => p.setChats(p.chats.filter((x) => x.id !== c.id))} aria-label={t('Delete chat')}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : !chat ? (
          <div className="ask-empty">
            <Sparkles size={22} />
            <strong>{t('Ask anything about your work')}</strong>
            <p className="muted small">{t('Answers come from your emails, chat, meetings and tasks, with links to the source.')}</p>
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
        <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask(text))} placeholder={t('Ask about a {project}, a meeting, open tasks…', { project: term.one })} />
        <div className="tc-foot">
          <span className="muted small">{t('Uses AI when you send')}</span>
          <button className="ai-send chat-send" onClick={() => ask(text)} disabled={!text.trim() || busy} aria-label={t('Ask')}>
            <Send size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
