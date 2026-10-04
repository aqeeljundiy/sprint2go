import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, FileText, ListChecks, Loader2, Mail, MessagesSquare, Mic, MicOff, Plus, Sparkles, UserPlus, X } from 'lucide-react';
import type { Client, Team, User } from '../types';
import { ai, AI_LIVE, type DumpBrief, type DumpTask } from '../ai';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { clientOptions, peopleOptions, teamOptions } from './TasksView';

export interface DumpResult {
  tasks: { title: string; clientId?: string; teamId?: string; userId: string; due?: string; priority: 'high' | 'normal' }[];
  brief?: { title: string; context: string; clientId?: string; userId: string; due?: string };
  notify: { chat: boolean; email: boolean };
  text: string;
  learned: Record<string, string>; // names the user explained: "andi" -> user id, or "contact"
}

interface Props {
  users: User[];
  clients: Client[];
  teams: Team[];
  me: string;
  aliases: Record<string, string>;
  initialText?: string;
  onCreate: (r: DumpResult) => void;
  onInvite: (name: string, email: string) => User;
  onClose: () => void;
}

type Row = DumpTask & { key: number; resolved?: 'person' | 'contact' };

const EXAMPLES = [
  'KopiKita wants the Q4 concepts by Thursday. Rizky, do the ad structure. Dewi handle the invoice for Nadia by Tuesday. Also someone follow up with Dimas at Arunika about the retainer next week. Faisal can you prepare the 12.12 budget for Lumina by Friday.',
  'Glowkind launch campaign. Goal is 500 pre-orders before 11.11, the founder Rina wants it to feel clean and science-y. Sekar design the key visual and 4 statics by Friday. Nanda edit three 15s hooks for TikTok next week. Kiki set up the Meta campaign structure by Thursday. Andi send the moodboard to Rina tomorrow.',
];

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

export function BrainDump({ users, clients, teams, me, aliases, initialText, onCreate, onInvite, onClose }: Props) {
  const [text, setText] = useState(initialText ?? '');
  const [step, setStep] = useState<'write' | 'thinking' | 'review'>('write');
  const [rows, setRows] = useState<Row[]>([]);
  const [brief, setBrief] = useState<DumpBrief | null>(null);
  const [asBrief, setAsBrief] = useState(false);
  const [chat, setChat] = useState(true);
  const [email, setEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [learned, setLearned] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState<{ key: number; name: string; email: string } | null>(null);
  const dict = useDictation((t) => setText((x) => (x ? x.replace(/\s*$/, ' ') : '') + t.trim()));

  const plan = async () => {
    if (!text.trim()) return;
    setStep('thinking');
    setError(null);
    try {
      const out = await ai.braindump({
        text,
        people: users.map((u) => ({ id: u.id, name: u.name, nicknames: u.nicknames, teamIds: teams.filter((t) => t.members.includes(u.id)).map((t) => t.id) })),
        clients: clients.map((c) => ({ id: c.id, name: c.name })),
        teams: teams.map((t) => ({ id: t.id, name: t.name, keywords: t.keywords })),
        meId: me,
        aliases: { ...aliases, ...learned },
      });
      setRows(out.tasks.map((r, i) => ({ ...r, key: i })));
      setBrief(out.brief ?? { title: '', context: text.trim(), clientId: out.tasks[0]?.clientId ?? null, ownerId: me, due: null });
      setAsBrief(!!out.brief);
      setStep('review');
    } catch (e) {
      setError((e as Error).message || 'Could not read that. Try again.');
      setStep('write');
    }
  };

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const asking = rows.filter((r) => r.unknownName && !r.resolved);
  const others = rows.filter((r) => r.assigneeId && r.assigneeId !== me).length;
  const queued = rows.filter((r) => !r.assigneeId && !r.unknownName).length;

  /** "Andi is Andika", "Andi is a client contact", or invite Andi. Applies to every row with that name. */
  const resolve = (name: string, choice: string) => {
    const k = name.toLowerCase();
    if (choice === '__contact') {
      setLearned((l) => ({ ...l, [k]: 'contact' }));
      setRows((rs) => rs.map((r) => (r.unknownName === name ? { ...r, resolved: 'contact', contact: name, assigneeId: r.assigneeId ?? me } : r)));
    } else if (choice === '__invite') {
      const row = rows.find((r) => r.unknownName === name);
      if (row) setInviting({ key: row.key, name, email: '' });
    } else {
      setLearned((l) => ({ ...l, [k]: choice }));
      setRows((rs) => rs.map((r) => (r.unknownName === name ? { ...r, resolved: 'person', assigneeId: choice } : r)));
    }
  };

  const sendInvite = () => {
    if (!inviting || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviting.email)) return;
    const u = onInvite(inviting.name, inviting.email.trim().toLowerCase());
    setLearned((l) => ({ ...l, [inviting.name.toLowerCase()]: u.id }));
    setRows((rs) => rs.map((r) => (r.unknownName === inviting.name ? { ...r, resolved: 'person', assigneeId: u.id } : r)));
    setInviting(null);
  };

  const create = () =>
    onCreate({
      text,
      learned,
      notify: { chat, email },
      brief: asBrief && brief ? { title: brief.title.trim() || 'New brief', context: brief.context, clientId: brief.clientId ?? undefined, userId: brief.ownerId, due: brief.due ?? undefined } : undefined,
      tasks: rows
        .filter((r) => r.title.trim())
        .map((r) => ({
          title: r.title.trim(),
          clientId: (asBrief ? (r.clientId ?? brief?.clientId) : r.clientId) ?? undefined,
          teamId: r.teamId ?? undefined,
          userId: r.assigneeId ?? (r.teamId ? '' : me),
          due: r.due ?? undefined,
          priority: r.priority,
        })),
    });

  const nameOptions = (name: string) => [
    ...users.map((u) => ({ value: u.id, label: `${name} is ${u.name}`, hint: u.title, icon: <Avatar person={u} size={22} />, group: 'A teammate' })),
    { value: '__contact', label: `${name} is a client contact`, hint: 'Not on our team. The task stays with you', icon: <span className="avatar-empty sm">C</span>, group: 'Someone else' },
    { value: '__invite', label: `Invite ${name} to the team`, hint: 'Sends an invite by email', icon: <UserPlus size={16} />, group: 'Someone else' },
  ];

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal dump-modal" role="dialog" aria-label="Brain dump" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
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
              <div className="dump-examples">
                <button className="link-btn dump-example" onClick={() => setText(EXAMPLES[0])}>
                  Try: quick tasks
                </button>
                <button className="link-btn dump-example" onClick={() => setText(EXAMPLES[1])}>
                  Try: a campaign brief
                </button>
              </div>
            )}
            {error && <p className="aw-error">{error}</p>}
          </div>
        ) : (
          <div className="modal-body">
            <div className="dump-mode">
              <div className="segmented">
                <button className={!asBrief ? 'on' : ''} onClick={() => setAsBrief(false)}>
                  <ListChecks size={14} /> Separate tasks
                </button>
                <button className={asBrief ? 'on' : ''} onClick={() => setAsBrief(true)}>
                  <FileText size={14} /> Brief with tasks
                </button>
              </div>
              <span className="muted small">
                {asBrief ? 'One person in charge, the context in one place, tasks for each person.' : `${rows.length} task${rows.length === 1 ? '' : 's'} found. Check names, teams and dates.`}
              </span>
            </div>

            {asBrief && brief && (
              <div className="dump-brief">
                <input className="dr-title" value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} placeholder="Brief title, e.g. Glowkind launch campaign" aria-label="Brief title" />
                <div className="dr-fields">
                  <Select value={brief.ownerId} options={peopleOptions(users, me, false)} onChange={(v) => setBrief({ ...brief, ownerId: v })} label="In charge" renderValue={(o) => <>{o?.icon}<span className="sel-text">{o ? `${o.label.replace(' (me)', '')} in charge` : 'Who is in charge?'}</span></>} />
                  <Select value={brief.clientId ?? ''} options={clientOptions(clients)} onChange={(v) => setBrief({ ...brief, clientId: v || null })} label="Client" />
                  <DatePicker value={brief.due ?? ''} onChange={(v) => setBrief({ ...brief, due: v || null })} label="Brief due" placeholder="Due" />
                </div>
                <textarea className="drawer-notes" value={brief.context} onChange={(e) => setBrief({ ...brief, context: e.target.value })} placeholder="Goal, background, deliverables, links…" aria-label="Context" />
              </div>
            )}

            {asking.length > 0 && (
              <p className="dump-ask">
                {asking.length === 1 ? `I don’t know who “${asking[0].unknownName}” is.` : `I don’t know ${asking.length} names.`} Tell me once and I’ll remember it.
              </p>
            )}

            <div className="dump-rows">
              {rows.map((r) => (
                <div key={r.key} className={`dump-row ${r.unknownName && !r.resolved ? 'asking' : ''}`}>
                  <input className="dr-title" value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} aria-label="Task" />
                  {r.unknownName && !r.resolved && (
                    <div className="who-is">
                      <span className="who-q">Who is “{r.unknownName}”?</span>
                      <Select value={null} options={nameOptions(r.unknownName)} onChange={(v) => resolve(r.unknownName!, v)} placeholder="Choose…" label={`Who is ${r.unknownName}?`} width={300} searchable />
                      {inviting?.key === r.key && (
                        <span className="who-invite">
                          <input autoFocus value={inviting.email} onChange={(e) => setInviting({ ...inviting, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && sendInvite()} placeholder={`${r.unknownName.toLowerCase()}@company.com`} />
                          <button className="primary-btn sm" onClick={sendInvite}>
                            Invite
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {r.contact && (r.resolved === 'contact' || !r.unknownName) && <span className="contact-note">Client contact: {r.contact}</span>}
                  <div className="dr-fields">
                    {!asBrief && <Select value={r.clientId ?? ''} options={clientOptions(clients)} onChange={(v) => patch(r.key, { clientId: v || null })} label="Client" />}
                    <Select value={r.teamId ?? ''} options={teamOptions(teams)} onChange={(v) => patch(r.key, { teamId: v || null })} label="Team" />
                    <Select
                      value={r.assigneeId ?? ''}
                      options={peopleOptions(users, me, !!r.teamId)}
                      onChange={(v) => patch(r.key, { assigneeId: v || null, resolved: r.unknownName ? 'person' : r.resolved })}
                      label="Assignee"
                      placeholder={r.teamId ? 'Team queue' : 'Me'}
                      className={!r.assigneeId && !r.teamId ? 'missing' : ''}
                    />
                    <DatePicker value={r.due ?? ''} onChange={(v) => patch(r.key, { due: v || null })} label="Due" placeholder="Due" />
                    <button className="icon-btn sm" title="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="ghost-btn sm" onClick={() => setRows((rs) => [...rs, { key: Date.now(), title: '', clientId: brief?.clientId ?? null, teamId: null, assigneeId: null, due: null, priority: 'normal' }])}>
                <Plus size={13} /> Add a task
              </button>
            </div>
            {queued > 0 && <p className="muted small">{queued} task{queued === 1 ? '' : 's'} without a person go to the team’s queue, and the team lead is told.</p>}
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
              <button className="primary-btn" onClick={create} disabled={!rows.some((r) => r.title.trim()) || asking.length > 0} title={asking.length ? 'Tell me who the unknown names are first' : undefined}>
                {asking.length ? `${asking.length} name${asking.length > 1 ? 's' : ''} to check` : asBrief ? `Create brief + ${rows.length} task${rows.length === 1 ? '' : 's'}` : `Create ${rows.length} task${rows.length === 1 ? '' : 's'}`}
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
