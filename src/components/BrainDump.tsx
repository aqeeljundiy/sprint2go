import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Loader2, Mail, MessagesSquare, Mic, MicOff, Plus, Sparkles, X } from 'lucide-react';
import type { Client, User } from '../types';
import { ai, AI_LIVE, type DumpTask } from '../ai';

export interface DumpResult {
  tasks: { title: string; clientId?: string; userId: string; due?: string; priority: 'high' | 'normal' }[];
  notify: { chat: boolean; email: boolean };
  text: string;
}

interface Props {
  users: User[];
  clients: Client[];
  me: string;
  initialText?: string;
  onCreate: (r: DumpResult) => void;
  onClose: () => void;
}

type Row = DumpTask & { key: number };

const EXAMPLE =
  'KopiKita wants the Q4 concepts by Thursday. Rizky, do the ad structure. Dewi handle the invoice for Nadia by Tuesday. Also someone follow up with Dimas at Arunika about the retainer next week. Faisal can you prepare the 12.12 budget for Lumina by Friday.';

/** Speech-to-text where the browser supports it (Chrome, Edge, Safari). */
function useDictation(onText: (t: string) => void) {
  const rec = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [on, setOn] = useState(false);
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = () => {
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = false;
      r.lang = navigator.language || 'en-US';
      r.onresult = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const said = Array.from(e.results as ArrayLike<any>) // eslint-disable-line @typescript-eslint/no-explicit-any
          .slice(e.resultIndex)
          .map((x) => x[0].transcript)
          .join(' ');
        onText(said);
      };
      r.onend = () => setOn(false);
      r.onerror = () => setOn(false);
      r.start();
      rec.current = r;
      setOn(true);
    } catch {
      setOn(false);
    }
  };
  const stop = () => {
    rec.current?.stop();
    setOn(false);
  };
  useEffect(() => () => rec.current?.stop(), []);
  return { supported: !!Ctor, on, start, stop };
}

export function BrainDump({ users, clients, me, initialText, onCreate, onClose }: Props) {
  const [text, setText] = useState(initialText ?? '');
  const [step, setStep] = useState<'write' | 'thinking' | 'review'>('write');
  const [rows, setRows] = useState<Row[]>([]);
  const [chat, setChat] = useState(true);
  const [email, setEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dict = useDictation((t) => setText((x) => (x ? x.replace(/\s*$/, ' ') : '') + t.trim()));

  const plan = async () => {
    if (!text.trim()) return;
    setStep('thinking');
    setError(null);
    try {
      const out = await ai.braindump(
        text,
        users.map((u) => ({ id: u.id, name: u.name })),
        clients.map((c) => ({ id: c.id, name: c.name })),
        me,
      );
      setRows(out.map((r, i) => ({ ...r, key: i })));
      setStep('review');
    } catch (e) {
      setError((e as Error).message || 'Could not read that. Try again.');
      setStep('write');
    }
  };

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const unassigned = rows.filter((r) => !r.assigneeId).length;
  const others = rows.filter((r) => r.assigneeId && r.assigneeId !== me).length;

  const create = () =>
    onCreate({
      text,
      notify: { chat, email },
      tasks: rows
        .filter((r) => r.title.trim())
        .map((r) => ({ title: r.title.trim(), clientId: r.clientId ?? undefined, userId: r.assigneeId ?? me, due: r.due ?? undefined, priority: r.priority })),
    });

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal dump-modal" role="dialog" aria-label="Brain dump" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Sparkles size={15} /> Brain dump {!AI_LIVE && <span className="demo-tag">Demo AI</span>}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        {step !== 'review' ? (
          <div className="modal-body">
            <p className="modal-intro">Say or type everything on your mind: clients, who should do what, by when. You’ll check the plan before anything is sent.</p>
            <div className="dump-input">
              <textarea
                id="dump-text"
                autoFocus
                rows={7}
                value={text}
                disabled={step === 'thinking'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) plan();
                }}
                placeholder="KopiKita wants the Q4 concepts by Thursday. Rizky, do the ad structure…"
              />
              {dict.supported && (
                <button className={`mic ${dict.on ? 'on' : ''}`} onClick={dict.on ? dict.stop : dict.start} title={dict.on ? 'Stop dictation' : 'Dictate'}>
                  {dict.on ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
            </div>
            {!text && (
              <button className="link-btn dump-example" onClick={() => setText(EXAMPLE)}>
                Try an example
              </button>
            )}
            {error && <p className="aw-error">{error}</p>}
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-intro">
              {rows.length} task{rows.length === 1 ? '' : 's'} found. Check names, clients and dates, then create.
              {unassigned > 0 && ` ${unassigned} without an owner will be assigned to you.`}
            </p>
            <div className="dump-rows">
              {rows.map((r) => (
                <div key={r.key} className="dump-row">
                  <input className="dr-title" value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} aria-label="Task" />
                  <div className="dr-fields">
                    <select value={r.clientId ?? ''} onChange={(e) => patch(r.key, { clientId: e.target.value || null })} aria-label="Client">
                      <option value="">No client</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select className={r.assigneeId ? '' : 'missing'} value={r.assigneeId ?? ''} onChange={(e) => patch(r.key, { assigneeId: e.target.value || null })} aria-label="Assignee">
                      <option value="">Unassigned (me)</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.id === me ? `${u.name} (me)` : u.name}
                        </option>
                      ))}
                    </select>
                    <input type="date" value={r.due ?? ''} onChange={(e) => patch(r.key, { due: e.target.value || null })} aria-label="Due" />
                    <button className="icon-btn sm" title="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="ghost-btn sm" onClick={() => setRows((rs) => [...rs, { key: Date.now(), title: '', clientId: null, assigneeId: null, due: null, priority: 'normal' }])}>
                <Plus size={13} /> Add a task
              </button>
            </div>
            {others > 0 && (
              <div className="dump-notify">
                <span>
                  <Bell size={14} /> Tell the {others === 1 ? 'person' : `${others} people`} you assigned:
                </span>
                <label className="check-row">
                  <input type="checkbox" checked disabled /> In Sprint2go
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} />
                  <MessagesSquare size={13} /> Chat message from you
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
                  <Mail size={13} /> Email
                </label>
              </div>
            )}
          </div>
        )}

        <footer className="modal-foot">
          {step === 'review' ? (
            <>
              <button className="ghost-btn" onClick={() => setStep('write')}>
                <ArrowLeft size={14} /> Edit text
              </button>
              <button className="primary-btn" onClick={create} disabled={!rows.some((r) => r.title.trim())}>
                Create {rows.length} task{rows.length === 1 ? '' : 's'}
              </button>
            </>
          ) : (
            <>
              <button className="ghost-btn" onClick={onClose}>
                Cancel
              </button>
              <button className="primary-btn" onClick={plan} disabled={!text.trim() || step === 'thinking'}>
                {step === 'thinking' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {step === 'thinking' ? 'Reading…' : 'Turn into tasks'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
