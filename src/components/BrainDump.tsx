import { MEETING_LANGUAGES } from '../data/languages';
import { useEffect, useRef, useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { SmoothHeight } from './ui/Smooth';
import { term, brand as product } from '../terms';
import { ArrowLeft, Bell, FileText, ListChecks, Loader2, Mail, MessagesSquare, Mic, MicOff, Plus, Sparkles, UserPlus, X } from 'lucide-react';
import type { Client, Team, User } from '../types';
import { ai, aiLive, type DumpBrief, type DumpTask } from '../ai';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { peopleOptions, teamOptions } from './TasksView';
import { personOption } from './ui/PeopleList';
import { t, tn, tx } from '../i18n';

export interface DumpResult {
  tasks: { title: string; clientId?: string; teamId?: string; userId: string; due?: string; priority: 'high' | 'normal' }[];
  brief?: { title: string; context: string; clientId?: string; userId: string; due?: string };
  notify: { chat: boolean; email: boolean };
  text: string;
  learned: Record<string, string>; // names the user explained: "andi" -> user id, or "contact"
}

interface Props {
  language?: string; // main meeting language code, for dictation
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
  'Kopinara wants the Q4 concepts by Thursday. Bima, do the ad structure. Intan handle the invoice for Laras by Tuesday. Also someone follow up with Yusuf at Teduh about the retainer next week. Hendra can you prepare the 12.12 budget for Selara by Friday.',
  'Brightleaf launch campaign. Goal is 500 pre-orders before 11.11, the founder Nina wants it to feel clean and science-y. Emma design the key visual and 4 statics by Friday. Joko edit three 15s hooks for TikTok next week. Bim set up the Meta campaign structure by Thursday. Andi send the moodboard to Nina tomorrow.',
];

/** Speech-to-text where the browser supports it (Chrome, Edge, Safari). */
function useDictation(onText: (said: string) => void, lang?: string) {
  const rec = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [on, setOn] = useState(false);
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = () => {
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = false;
      r.lang = lang || navigator.language || 'en-US'; // the company's main meeting language when it has one
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

export function BrainDump({ users, clients, teams, me, aliases, initialText, language, onCreate, onInvite, onClose }: Props) {
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
  const dict = useDictation((said) => setText((x) => (x ? x.replace(/\s*$/, ' ') : '') + said.trim()), MEETING_LANGUAGES.find((l) => l.code === language)?.speech);

  const plan = async () => {
    if (!text.trim()) return;
    setStep('thinking');
    setError(null);
    try {
      const out = await ai.braindump({
        text,
        people: users.map((u) => ({ id: u.id, name: u.name, nicknames: u.nicknames, teamIds: teams.filter((tm) => tm.members.includes(u.id)).map((tm) => tm.id) })),
        clients: clients.map((c) => ({ id: c.id, name: c.name })),
        teams: teams.map((tm) => ({ id: tm.id, name: tm.name, keywords: tm.keywords })),
        meId: me,
        aliases: { ...aliases, ...learned },
      });
      setRows(out.tasks.map((r, i) => ({ ...r, key: i })));
      setBrief(out.brief ?? { title: '', context: text.trim(), clientId: out.tasks[0]?.clientId ?? null, ownerId: me, due: null });
      setAsBrief(!!out.brief);
      setStep('review');
    } catch (e) {
      setError((e as Error).message ? t((e as Error).message) : t('Could not read that. Try again.'));
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
      brief: asBrief && brief ? { title: brief.title.trim() || t('New brief'), context: brief.context, clientId: brief.clientId ?? undefined, userId: brief.ownerId, due: brief.due ?? undefined } : undefined,
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
    ...users.map((u) => ({ ...personOption(u), label: t('{name} is {person}', { name, person: u.name }), hint: u.title, icon: <Avatar person={u} size={22} />, group: t('A teammate') })),
    { value: '__contact', label: t('{name} is a {who} contact', { name, who: term.who }), hint: t('Not on our team. The task stays with you'), icon: <span className="avatar-empty sm">C</span>, group: t('Someone else') },
    { value: '__invite', label: t('Invite {name} to the team', { name }), hint: t('Sends an invite by email'), icon: <UserPlus size={16} />, group: t('Someone else') },
  ];

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal dump-modal" role="dialog" aria-label={t('Brain dump')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Sparkles size={15} /> {t('Brain dump')} {!aiLive() && <span className="demo-tag">{t('Demo AI')}</span>}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>

        {step !== 'review' ? (
          <div className="modal-body">
            <SmoothHeight>
            <p className="modal-intro">{t('Say or type everything on your mind: {projects}, who should do what, by when. You’ll check the plan before anything is sent.', { projects: term.many })}</p>
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
                placeholder={t('Kopinara wants the Q4 concepts by Thursday. Bima, do the ad structure…')}
              />
              {dict.supported && (
                <button className={`mic ${dict.on ? 'on' : ''}`} onClick={dict.on ? dict.stop : dict.start} title={dict.on ? t('Stop dictation') : t('Dictate')} aria-label={dict.on ? t('Stop dictation') : t('Dictate')}>
                  {dict.on ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
            </div>
            {!text && (
              <div className="dump-examples">
                <button className="link-btn dump-example" onClick={() => setText(EXAMPLES[0])}>
                  {t('Try: quick tasks')}
                </button>
                <button className="link-btn dump-example" onClick={() => setText(EXAMPLES[1])}>
                  {t('Try: a campaign brief')}
                </button>
              </div>
            )}
            {error && <p className="aw-error">{error}</p>}
            </SmoothHeight>
          </div>
        ) : (
          <div className="modal-body">
            <SmoothHeight>
            <div className="dump-mode">
              <div className="segmented">
                <button className={!asBrief ? 'on' : ''} onClick={() => setAsBrief(false)}>
                  <ListChecks size={14} /> {t('Separate tasks')}
                </button>
                <button className={asBrief ? 'on' : ''} onClick={() => setAsBrief(true)}>
                  <FileText size={14} /> {t('Brief with tasks')}
                </button>
              </div>
              <span className="muted small">
                {asBrief ? t('One person in charge, the context in one place, tasks for each person.') : tn(rows.length, '{n} task found. Check names, teams and dates.', '{n} tasks found. Check names, teams and dates.')}
              </span>
            </div>

            {asBrief && brief && (
              <div className="dump-brief">
                <input className="dr-title" value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} placeholder={t('Brief title, e.g. Brightleaf launch campaign')} aria-label={t('Brief title')} />
                <div className="dr-fields">
                  <Select value={brief.ownerId} options={peopleOptions(users, me, false)} onChange={(v) => setBrief({ ...brief, ownerId: v })} label={t('In charge')} renderValue={(o) => <>{o?.icon}<span className="sel-text">{o ? t('{name} in charge', { name: users.find((u) => u.id === o.value)?.name ?? '' }) : t('Who is in charge?')}</span></>} />
                  <ProjectPicker value={brief.clientId ?? ''} projects={clients} none={t('No {project}', { project: term.one })} onChange={(v) => setBrief({ ...brief, clientId: v || null })} />
                  <DatePicker value={brief.due ?? ''} onChange={(v) => setBrief({ ...brief, due: v || null })} label={t('Brief due')} placeholder={t('Due')} />
                </div>
                <textarea className="drawer-notes" value={brief.context} onChange={(e) => setBrief({ ...brief, context: e.target.value })} placeholder={t('Goal, background, deliverables, links…')} aria-label={t('Context')} />
              </div>
            )}

            {asking.length > 0 && (
              <p className="dump-ask">
                {asking.length === 1 ? t('I don’t know who “{name}” is. Tell me once and I’ll remember it.', { name: asking[0].unknownName ?? '' }) : tn(asking.length, 'I don’t know {n} name. Tell me once and I’ll remember it.', 'I don’t know {n} names. Tell me once and I’ll remember it.')}
              </p>
            )}

            <div className="dump-rows">
              {rows.map((r) => (
                <div key={r.key} className={`dump-row ${r.unknownName && !r.resolved ? 'asking' : ''}`}>
                  <input className="dr-title" value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} aria-label={t('Task')} />
                  {r.unknownName && !r.resolved && (
                    <div className="who-is">
                      <span className="who-q">{t('Who is “{name}”?', { name: r.unknownName })}</span>
                      <Select value={null} options={nameOptions(r.unknownName)} onChange={(v) => resolve(r.unknownName!, v)} placeholder={t('Choose…')} label={t('Who is {name}?', { name: r.unknownName })} width={300} searchable />
                      {inviting?.key === r.key && (
                        <span className="who-invite">
                          <input autoFocus value={inviting.email} onChange={(e) => setInviting({ ...inviting, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && sendInvite()} placeholder={t('{name}@company.com', { name: r.unknownName.toLowerCase() })} />
                          <button className="primary-btn sm" onClick={sendInvite}>
                            {t('Invite')}
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {r.contact && (r.resolved === 'contact' || !r.unknownName) && <span className="contact-note">{t('{Who} contact: {name}', { who: term.who, name: r.contact })}</span>}
                  <div className="dr-fields">
                    {!asBrief && <ProjectPicker value={r.clientId ?? ''} projects={clients} none={t('No {project}', { project: term.one })} onChange={(v) => patch(r.key, { clientId: v || null })} />}
                    <Select value={r.teamId ?? ''} options={teamOptions(teams)} onChange={(v) => patch(r.key, { teamId: v || null })} label={t('Team')} />
                    <Select
                      value={r.assigneeId ?? ''}
                      options={peopleOptions(users, me, !!r.teamId)}
                      onChange={(v) => patch(r.key, { assigneeId: v || null, resolved: r.unknownName ? 'person' : r.resolved })}
                      label={tx('field', 'Doing it')}
                      placeholder={r.teamId ? t('Team queue') : t('Me')}
                      className={!r.assigneeId && !r.teamId ? 'missing' : ''}
                    />
                    <DatePicker value={r.due ?? ''} onChange={(v) => patch(r.key, { due: v || null })} label={t('Due')} placeholder={t('Due')} />
                    <button className="icon-btn sm" title={t('Remove')} aria-label={t('Remove')} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="ghost-btn sm" onClick={() => setRows((rs) => [...rs, { key: Date.now(), title: '', clientId: brief?.clientId ?? null, teamId: null, assigneeId: null, due: null, priority: 'normal' }])}>
                <Plus size={13} /> {t('Add a task')}
              </button>
            </div>
            {queued > 0 && <p className="muted small">{tn(queued, '{n} task without a person goes to the team’s queue, and the team lead is told.', '{n} tasks without a person go to the team’s queue, and the team lead is told.')}</p>}
            {others > 0 && (
              <div className="dump-notify">
                <span>
                  <Bell size={14} /> {tn(others, 'Tell the person you assigned:', 'Tell the {n} people you assigned:')}
                </span>
                <label className="check-row">
                  <input type="checkbox" checked disabled /> {t('In {product}', { product: product.name })}
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} />
                  <MessagesSquare size={13} /> {t('Chat message from you')}
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
                  <Mail size={13} /> {t('Email')}
                </label>
              </div>
            )}
            </SmoothHeight>
          </div>
        )}

        <footer className="modal-foot">
          {step === 'review' ? (
            <>
              <button className="ghost-btn" onClick={() => setStep('write')}>
                <ArrowLeft size={14} /> {t('Edit text')}
              </button>
              <button className="primary-btn" onClick={create} disabled={!rows.some((r) => r.title.trim()) || asking.length > 0} title={asking.length ? t('Tell me who the unknown names are first') : undefined}>
                {asking.length ? tn(asking.length, '{n} name to check', '{n} names to check') : asBrief ? tn(rows.length, 'Create brief + {n} task', 'Create brief + {n} tasks') : tn(rows.length, 'Create {n} task', 'Create {n} tasks')}
              </button>
            </>
          ) : (
            <>
              <button className="ghost-btn" onClick={onClose}>
                {t('Cancel')}
              </button>
              <button className="primary-btn" onClick={plan} disabled={!text.trim() || step === 'thinking'}>
                {step === 'thinking' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {step === 'thinking' ? t('Reading…') : t('Turn into tasks')}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
