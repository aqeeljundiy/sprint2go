import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Bell, CalendarDays, Check, Flag, Hash, Repeat as RepeatIcon, UserRound, Columns3 } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { PeopleList } from '../ui/PeopleList';
import { Avatar } from '../Avatar';
import { asToken, parseQuickAdd, remindText, triggerAt, type QuickToken } from '../../quickAdd';
import { addDays, dateTone, dayDate, dueText, hhmmText } from '../../taskDates';
import { stageName, stagesForTask, toneOf } from '../../stages';
import { term } from '../../terms';
import type { Repeat, TaskStage } from '../../types';
import { DayPicker, dayWords, toastAdded } from './TaskSheets';
import { quoted, type NewTask, type TaskOps } from './taskOps';
import { t, tx } from '../../i18n';
import { fmtList, fmtTime } from '../../i18n/format';
import { useLang } from '../../i18n/useLang';

export interface QuickDefaults {
  userId?: string; // '' puts it in the team's queue
  clientId?: string;
  teamId?: string;
  due?: string;
  status?: string;
}

type Picks = { due?: string; assignees?: string[]; clientId?: string; priority?: 'high' | 'normal'; status?: string; remindAt?: string; repeat?: Repeat | '' };
type PickerId = 'date' | 'who' | 'project' | 'stage' | 'remind' | 'repeat';

let draft = ''; // what was typed when the sheet was closed: it's there again next time

const repeats = (): [Repeat | '', string][] => [
  ['', t('Doesn’t repeat')],
  ['daily', t('Every day')],
  ['weekdays', t('Every weekday')],
  ['weekly', t('Every week')],
  ['monthly', t('Every month')],
];

/**
 * Quick Add: one field that reads the task as it's typed ("Send invoice tomorrow 3pm #kopi +dewi p1") and shows what it
 * understood twice, highlighted in the text and as chips. Tap a highlight to keep those words as words; tap a chip to
 * change it. After adding it stays open in the same project and stage for the next one. On phones it's a sheet on top
 * of the keyboard that opens with just the field; on desktop it opens in place above the list.
 */
export function QuickAdd({ ops, defaults, mode, onClose, where, inputRef }: { ops: TaskOps; defaults: QuickDefaults; mode: 'sheet' | 'inline'; onClose: () => void; where: string; inputRef?: RefObject<HTMLTextAreaElement | null> }) {
  const own = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? own;
  const [text, setText] = useState(mode === 'sheet' ? draft : '');
  const [off, setOff] = useState<string[]>([]);
  const [picks, setPicks] = useState<Picks>({});
  const [cursor, setCursor] = useState(0);
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [hi, setHi] = useState(0);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const projects = useMemo(() => ops.clients.filter((c) => c.status !== 'ended'), [ops.clients]);
  const has = (k: keyof Picks) => Object.prototype.hasOwnProperty.call(picks, k);
  const lang = useLang(); // the chips' words come from the parse: read again in a new language

  // "/stage" reads the stages of where the task goes: its project's or team's own, else the company's. The project
  // can come from the same text ("#kopi"), so it reads once for the project, then with that project's stages.
  const read = (list: TaskStage[]) =>
    parseQuickAdd(text, {
      today: ops.today,
      projects: projects.map((c) => ({ id: c.id, name: c.name })),
      people: ops.users.map((u) => ({ id: u.id, name: u.name })),
      stages: list.map((s) => ({ id: s.id, name: stageName(s) })),
      off,
    });
  const stagesOfTarget = (clientId?: string) => stagesForTask({ workspaceId: ops.wsId, clientId, teamId: defaults.teamId });
  const pickedClient = has('clientId') ? picks.clientId || undefined : undefined;
  const first = useMemo(() => read(stagesOfTarget(pickedClient ?? defaults.clientId)), [text, off, ops.today, projects, ops.users, pickedClient, defaults.clientId, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = has('clientId') ? pickedClient : (first.clientId ?? defaults.clientId);
  const stages = stagesOfTarget(target);
  const parsed = useMemo(() => (stages === stagesOfTarget(pickedClient ?? defaults.clientId) ? first : read(stages)), [first, stages]); // eslint-disable-line react-hooks/exhaustive-deps
  const due = has('due') ? picks.due || undefined : (parsed.due ?? defaults.due);
  const assignees = picks.assignees ?? (parsed.assignees.length ? parsed.assignees : defaults.userId === '' ? [] : [defaults.userId ?? ops.me]);
  const clientId = has('clientId') ? picks.clientId || undefined : (parsed.clientId ?? defaults.clientId);
  const priority = picks.priority ?? parsed.priority ?? 'normal';
  const status = picks.status ?? parsed.stageId ?? defaults.status;
  const remindAt = has('remindAt') ? picks.remindAt || undefined : parsed.remindAt;
  const repeat = has('repeat') ? picks.repeat || undefined : parsed.repeat;
  const tokenOf = (kind: QuickToken['kind']) => parsed.tokens.find((tok) => tok.kind === kind);

  // The field grows with the text (two or three lines on a phone).
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, field]);

  const trigger = triggerAt(text, cursor);
  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const hit = (name: string) => !q || name.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(q)) || name.toLowerCase().replace(/\s+/g, '').startsWith(q);
    if (trigger.char === '#') return projects.filter((c) => hit(c.name)).slice(0, 6).map((c) => ({ id: c.id, name: c.name, icon: <span className="dot" style={{ background: c.color }} /> }));
    if (trigger.char === '+') return ops.users.filter((u) => hit(u.name)).slice(0, 6).map((u) => ({ id: u.id, name: u.name, icon: <Avatar person={u} size={20} /> }));
    return stages.filter((s) => hit(stageName(s))).map((s) => ({ id: s.id, name: stageName(s), icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} /> }));
  }, [trigger?.char, trigger?.query, projects, ops.users, stages]); // eslint-disable-line react-hooks/exhaustive-deps

  const refocus = () => requestAnimationFrame(() => field.current?.focus());
  /** Takes a token's words out of the text (its chip now holds the value). */
  const dropToken = (kind: QuickToken['kind'] | 'person-all') => {
    const toks = kind === 'person-all' ? parsed.tokens.filter((tok) => tok.kind === 'person') : parsed.tokens.filter((tok) => tok.kind === kind).slice(0, 1);
    if (!toks.length) return;
    let next = text;
    for (const tok of [...toks].sort((a, b) => b.start - a.start)) next = next.slice(0, tok.start) + next.slice(tok.end);
    setText(next.replace(/ {2,}/g, ' ').replace(/^ /, ''));
  };
  const pick = (patch: Picks, kind?: QuickToken['kind'] | 'person-all', close = true) => {
    setPicks((p) => ({ ...p, ...patch }));
    if (kind) dropToken(kind);
    if (close) setPicker(null);
    refocus();
  };

  const applySuggestion = (name: string) => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(cursor).replace(/^\S*/, '');
    const ins = asToken(trigger.char, name) + ' ';
    const next = before + ins + after.replace(/^\s+/, '');
    setText(next);
    const at = before.length + ins.length;
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(at, at);
      setCursor(at);
    });
  };

  const submit = () => {
    const title = parsed.title.trim();
    if (!title) return;
    const input: NewTask = { title, userId: assignees[0] ?? '', assignees, clientId, teamId: defaults.teamId, due: due ?? (repeat ? ops.today : undefined), priority, repeat, remindAt, status };
    const id = ops.add(input);
    const who = assignees.filter((x) => x !== ops.me).map((x) => ops.users.find((u) => u.id === x)?.name.split(' ')[0]).filter(Boolean);
    const c = ops.clients.find((x) => x.id === clientId);
    // "Added “Send invoice” to Kopi Harian, due tomorrow, for Dewi": the sentence, then each detail on its own.
    const where = c && c.id !== defaults.clientId ? t('to {name}', { name: c.name }) : !assignees.length && defaults.teamId ? t('to the team’s queue') : '';
    const bits = [due && due !== defaults.due ? t('due {day}', { day: dayWords(due, ops.today) }) : '', who.length ? t('for {names}', { names: fmtList(who as string[]) }) : ''].filter(Boolean);
    toastAdded([[t('Added {title}', { title: quoted(title) }), where].filter(Boolean).join(' '), ...bits].join(', '), () => ops.remove([id], true), () => ops.open(id));
    setText('');
    draft = '';
    setOff([]);
    setPicks((p) => ({ ...(has('clientId') ? { clientId: p.clientId } : {}), ...(has('status') ? { status: p.status } : {}) })); // same place for the next one
    field.current?.focus();
  };

  // The highlights, drawn under the field's own text.
  const mirror: ReactNode[] = [];
  let at = 0;
  for (const tok of parsed.tokens) {
    if (tok.start > at) mirror.push(text.slice(at, tok.start));
    mirror.push(
      <mark key={tok.key} className={`qa-tok k-${tok.kind}`} data-keys={tok.keys.join('|')}>
        {text.slice(tok.start, tok.end)}
      </mark>,
    );
    at = tok.end;
  }
  mirror.push(text.slice(at) + '​');

  const onTapField = (e: React.PointerEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const mark = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList.contains('qa-tok')) as HTMLElement | undefined;
    const keys = mark?.dataset.keys?.split('|');
    if (keys?.length) setOff((o) => [...o, ...keys]); // these words stay words
  };

  const chips = text.trim().length > 0 || mode === 'inline';
  const person = (id: string) => ops.users.find((u) => u.id === id);
  const chip = (id: PickerId, icon: ReactNode, label: string, on: boolean, fromText: boolean, extra = '') => (
    <button
      key={id}
      type="button"
      ref={(el) => void (chipRefs.current[id] = el)}
      className={`qa-chip${on ? ' on' : ''}${fromText ? ' from-text' : ''}${extra}`}
      onClick={() => setPicker(picker === id ? null : id)}
      aria-expanded={picker === id}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const tone = due ? dateTone(due, ops.today) : '';
  const stageNow = stages.find((s) => s.id === status);
  const proj = ops.clients.find((x) => x.id === clientId);
  const anchor = (id: string) => ({ current: chipRefs.current[id] ?? null });
  const remindChoices = (() => {
    const at9 = (day: string, back = 0) => {
      const d = dayDate(addDays(day, -back));
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    };
    const nine = fmtTime(new Date(2026, 0, 1, 9, 0));
    const list: [string, string][] = [
      [t('In 1 hour'), new Date(Date.now() + 3_600_000).toISOString()],
      [t('Tomorrow, {time}', { time: nine }), at9(addDays(ops.today, 1))],
      ...(due ? ([[t('The day before, {time}', { time: nine }), at9(due, 1)], [t('On the day, {time}', { time: nine }), at9(due)]] as [string, string][]) : []),
    ];
    return list.filter(([, v]) => v > new Date().toISOString());
  })();

  const body = (
    <div className={`qa qa-${mode}`} onKeyDown={(e) => e.key === 'Escape' && picker && (e.stopPropagation(), setPicker(null))}>
      <div className="qa-field">
        <div className="qa-mirror" aria-hidden="true">
          {mirror}
        </div>
        <textarea
          ref={field}
          rows={1}
          value={text}
          enterKeyHint="send"
          placeholder={mode === 'sheet' ? t('What needs doing?') : t('Task name, then a date, #project, +person, p1…')}
          aria-label={t('New task')}
          onChange={(e) => {
            setText(e.target.value);
            if (mode === 'sheet') draft = e.target.value;
            setCursor(e.target.selectionStart ?? e.target.value.length);
            setHi(0);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onPointerUp={onTapField}
          onKeyDown={(e) => {
            if (suggestions.length && trigger) {
              if (e.key === 'ArrowDown') return void (e.preventDefault(), setHi((h) => Math.min(h + 1, suggestions.length - 1)));
              if (e.key === 'ArrowUp') return void (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
              if (e.key === 'Enter' || e.key === 'Tab') return void (e.preventDefault(), applySuggestion(suggestions[hi]?.name ?? suggestions[0].name));
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape' && mode === 'inline') {
              e.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      {trigger && suggestions.length > 0 && (
        <div className="qa-suggest" role="listbox" aria-label={trigger.char === '#' ? term.Many : trigger.char === '+' ? t('People') : t('Stages')}>
          {suggestions.map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={i === hi} className={`qa-sug${i === hi ? ' hi' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={() => applySuggestion(s.name)}>
              <span className="qa-sug-icon">{s.icon}</span>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className={`qa-chips-wrap${chips ? ' open' : ''}`} aria-hidden={!chips}>
        <div className="qa-chips-clip">
        <div className="qa-chips" role="group" aria-label={t('Details')}>
          {chip('date', <CalendarDays size={15} />, due ? (!has('due') && parsed.time ? t('{day} {time}', { day: dueText(due, ops.today), time: hhmmText(parsed.time) }) : dueText(due, ops.today)) : t('Date'), !!due, !!tokenOf('date') && !has('due'), tone ? ` tone-${tone}` : '')}
          {chip(
            'who',
            assignees.length && person(assignees[0]) ? <Avatar person={person(assignees[0])!} size={18} /> : <UserRound size={15} />,
            assignees.length ? assignees.map((x) => (x === ops.me ? t('Me') : (person(x)?.name.split(' ')[0] ?? ''))).join(', ') : t('Not assigned'),
            assignees.length > 0 && !(assignees.length === 1 && assignees[0] === ops.me),
            !!tokenOf('person') && !picks.assignees,
          )}
          {chip('project', proj ? <span className="dot" style={{ background: proj.color }} /> : <Hash size={15} />, proj ? proj.name : term.One, !!proj, !!tokenOf('project') && !has('clientId'))}
          <button type="button" className={`qa-chip${priority === 'high' ? ' on p-high' : ''}${tokenOf('priority') && !picks.priority ? ' from-text' : ''}`} onClick={() => pick({ priority: priority === 'high' ? 'normal' : 'high' }, 'priority', false)} aria-pressed={priority === 'high'}>
            <Flag size={15} />
            <span>{priority === 'high' ? t('High priority') : t('Priority')}</span>
          </button>
          {chip('stage', stageNow ? <span className={`stage-dot k-${stageNow.kind} tone-${toneOf(stageNow)}`} /> : <Columns3 size={15} />, stageNow ? stageName(stageNow) : t('Stage'), !!stageNow && stageNow.kind !== 'open', !!tokenOf('stage') && !picks.status)}
          {chip('remind', <Bell size={15} />, remindAt ? remindText(remindAt, ops.today) : t('Remind'), !!remindAt, !!tokenOf('reminder') && !has('remindAt'))}
          {chip('repeat', <RepeatIcon size={15} />, repeat ? (repeats().find(([v]) => v === repeat)?.[1] ?? t('Repeats')) : t('Repeat'), !!repeat, !!tokenOf('repeat') && !has('repeat'))}
        </div>
        </div>
      </div>
      <div className="qa-foot">
        <span className="qa-where">
          {proj ? (
            <>
              <span className="dot" style={{ background: proj.color }} /> {proj.name}
              {stageNow && stageNow.kind !== 'open' ? ` · ${stageName(stageNow)}` : ''}
            </>
          ) : (
            where
          )}
        </span>
        {mode === 'inline' && (
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
        )}
        <button type="button" className={`primary-btn ${mode === 'sheet' ? 'qa-send' : 'sm'}`} onPointerDown={(e) => e.preventDefault()} onClick={submit} disabled={!parsed.title.trim()} aria-label={t('Add task')}>
          {mode === 'sheet' ? <ArrowUp size={20} /> : t('Add task')}
        </button>
      </div>

      <Popover anchor={anchor('date')} open={picker === 'date'} onClose={() => setPicker(null)} width={300} title={t('Date')}>
        <DayPicker today={ops.today} value={due} onPick={(d) => pick({ due: d }, 'date')} noDate={!!due} />
      </Popover>
      <Popover anchor={anchor('who')} open={picker === 'who'} onClose={() => setPicker(null)} width={300} title={t('Who’s doing it')}>
        <PeopleList
          users={ops.users}
          me={ops.me}
          selected={assignees}
          extra={defaults.teamId ? [{ value: '', label: t('Not assigned'), hint: t('Waits in the team’s queue'), icon: <span className="avatar-empty sm">?</span> }] : []}
          onPick={(id) => pick({ assignees: !id ? [] : assignees.includes(id) ? assignees.filter((x) => x !== id) : [...assignees, id] }, 'person-all', false)}
        />
      </Popover>
      <Popover anchor={anchor('project')} open={picker === 'project'} onClose={() => setPicker(null)} width={280} title={term.One}>
        <div className="as-list qa-list">
          {[{ id: '', name: t('No {project}', { project: term.one }), color: 'var(--text-3)' }, ...projects].map((c) => (
            <button key={c.id || 'none'} type="button" className={`as-item${(clientId ?? '') === c.id ? ' on' : ''}`} onClick={() => pick({ clientId: c.id }, 'project')}>
              <span className="as-icon ts-dot">
                <span className="dot" style={{ background: c.color }} />
              </span>
              <span className="as-label">
                <span className="more-ellipsis">{c.name}</span>
              </span>
              {(clientId ?? '') === c.id && <Check size={16} className="as-check" />}
            </button>
          ))}
        </div>
      </Popover>
      <Popover anchor={anchor('stage')} open={picker === 'stage'} onClose={() => setPicker(null)} width={240} title={t('Stage')}>
        <div className="as-list qa-list">
          {stages.map((s) => (
            <button key={s.id} type="button" className={`as-item${status === s.id ? ' on' : ''}`} onClick={() => pick({ status: s.id }, 'stage')}>
              <span className="as-icon ts-dot">
                <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />
              </span>
              <span className="as-label">{stageName(s)}</span>
              {status === s.id && <Check size={16} className="as-check" />}
            </button>
          ))}
        </div>
      </Popover>
      <Popover anchor={anchor('remind')} open={picker === 'remind'} onClose={() => setPicker(null)} width={260} title={t('Remind')}>
        <div className="as-list qa-list">
          {remindChoices.map(([l, v]) => (
            <button key={l} type="button" className="as-item" onClick={() => pick({ remindAt: v }, 'reminder')}>
              <Bell size={16} className="as-icon" />
              <span className="as-label">{l}</span>
            </button>
          ))}
          {remindAt && (
            <button type="button" className="as-item" onClick={() => pick({ remindAt: '' }, 'reminder')}>
              <span className="as-icon" />
              <span className="as-label">{tx('option', 'No reminder')}</span>
            </button>
          )}
        </div>
      </Popover>
      <Popover anchor={anchor('repeat')} open={picker === 'repeat'} onClose={() => setPicker(null)} width={240} title={t('Repeat')}>
        <div className="as-list qa-list">
          {repeats().map(([v, l]) => (
            <button key={v || 'none'} type="button" className={`as-item${(repeat ?? '') === v ? ' on' : ''}`} onClick={() => pick({ repeat: v }, 'repeat')}>
              <RepeatIcon size={16} className="as-icon" />
              <span className="as-label">{l}</span>
              {(repeat ?? '') === v && <Check size={16} className="as-check" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );

  if (mode === 'inline') return body;
  return (
    <Sheet onClose={onClose} className="qa-sheet" label={t('New task')}>
      {body}
    </Sheet>
  );
}
