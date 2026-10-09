import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import type { StageColor, StageKind, TaskStage, Team, Todo, Workspace } from '../../types';
import { DEFAULT_STAGES, KIND_INFO, STAGE_COLORS, STAGE_KINDS, TONE_NAME, builtInName, cleanStages, fixedTone, projectStages, stageName, stageOf, teamStages, toneOf } from '../../stages';
import { Layer } from '../ui/Layer';
import { term } from '../../terms';
import { uid } from '../../utils';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';

export type Move = { id: string; patch: Partial<Todo> };

/**
 * Settings, Task stages: the company's board columns. Admins rename, add, reorder, colour and remove them. Each has a
 * kind (not started, in progress, waiting on the guest, review, done), which is what the rest of the app goes by.
 * Removing a stage that has tasks asks where they go.
 */
export function TaskStagesSection({ ws, canManage, tasks, teams, me, onWorkspace, onMoveTasks }: {
  ws: Workspace;
  canManage: boolean;
  tasks: Todo[]; // this company's tasks and briefs
  teams: Team[];
  me: string;
  onWorkspace: (p: Partial<Workspace>) => void;
  onMoveTasks: (moves: Move[]) => void;
}) {
  const stages = ws.taskStages?.length ? cleanStages(ws.taskStages) : DEFAULT_STAGES;
  // Tasks that follow a project's or team's own stages aren't in the company's columns.
  const companyTasks = tasks.filter((t) => !projectStages(t.clientId) && !teamStages(t.teamId));
  return (
    <>
      <h2>Task stages</h2>
      <p className="set-intro">The columns of the task board and the choices for a task’s status, for everyone at {ws.name || 'the company'}. Call them what you like: each stage has a kind, and Home, reminders, approvals and {term.whos}’ shared spaces go by the kind. A project or a team can use its own stages instead, in its settings.</p>
      {!canManage && <p className="modal-note">Only owners and admins can change the stages.</p>}
      <StageEditor
        stages={stages}
        save={(next) => onWorkspace({ taskStages: next })}
        canManage={canManage}
        tasks={companyTasks}
        teams={teams}
        me={me}
        wordsKey={ws.terms?.word ?? ''}
        onMoveTasks={onMoveTasks}
        reset={
          JSON.stringify(stages) !== JSON.stringify(DEFAULT_STAGES)
            ? { to: DEFAULT_STAGES, label: 'Back to the usual stages', title: 'Use the usual stages', text: `The board goes back to ${DEFAULT_STAGES.map((s) => stageName(s)).join(', ')}. Tasks in a stage that goes away move to the usual stage of the same kind.`, action: 'Use the usual stages', why: 'when the usual stages came back', onDone: () => onWorkspace({ taskStages: undefined }) }
            : undefined
        }
      />
      <div className="set-block">
        <h3>What each kind does</h3>
        <ul className="stage-kinds">
          {STAGE_KINDS.map((k) => (
            <li key={k}>
              <strong>{KIND_INFO[k].name}</strong>
              <span>{KIND_LONG[k]()}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Where tasks go when their stages give way to others: the stage of the same name, else the first of the same kind. */
export function movesToList(tasks: Todo[], from: TaskStage[], to: TaskStage[], me: string, why: string): Move[] {
  const at = new Date().toISOString();
  return tasks.flatMap((t) => {
    const s = stageOf(t, from);
    if (to.some((x) => x.id === s.id && x.kind === s.kind)) return [];
    const target = to.find((x) => stageName(x).toLowerCase() === stageName(s).toLowerCase() && (x.kind === 'done') === (s.kind === 'done')) ?? to.find((x) => x.kind === s.kind) ?? to.find((x) => x.kind === (s.kind === 'done' ? 'done' : 'open')) ?? to[0];
    const done = target.kind === 'done';
    return [{ id: t.id, patch: { status: target.id, done, doneAt: done ? (t.done ? t.doneAt : at) : undefined, doneBy: done ? (t.done ? t.doneBy : me) : undefined, history: [...(t.history ?? []), { id: uid(), at, by: me, kind: 'status' as const, text: `moved it to ${stageName(target)} ${why}` }] } }];
  });
}

/**
 * The stage list itself: rename, recolour, change the kind, reorder, add and remove (asking where a removed stage's
 * tasks go). The company's stages use it in Settings; a project or a team uses it for stages of its own.
 */
export function StageEditor({ stages, save, canManage, tasks, teams, me, wordsKey, onMoveTasks, reset }: {
  stages: TaskStage[];
  save: (next: TaskStage[]) => void;
  canManage: boolean;
  tasks: Todo[]; // the tasks that follow these stages
  teams: Team[];
  me: string;
  wordsKey: string; // the company's word for the work: built-in names follow it
  onMoveTasks: (moves: Move[]) => void;
  /** "Back to …": the stages it goes back to, and what the confirmation says. */
  reset?: { to: TaskStage[]; label: string; title: string; text: string; action: string; why: string; onDone: () => void };
}) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TaskStage | null>(null);
  const [resetting, setResetting] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null); // the stage just added: it slides in
  const [clash, setClash] = useState<string | null>(null); // a name another stage already has
  const lastClash = useRef('');
  if (clash) lastClash.current = clash; // the note keeps its words while it folds away
  useEffect(() => {
    if (focusId) setFocusId(null); // the new stage's name field took the focus (a layout effect, so it ran first)
  }, [focusId]);
  const patch = (id: string, p: Partial<TaskStage>) => save(stages.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const count = (kind: StageKind) => stages.filter((s) => s.kind === kind).length;
  const inStage = (id: string) => tasks.filter((t) => stageOf(t, stages).id === id);

  // Rows glide to their new place when they're reordered or one above them goes (instead of jumping).
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    rows.current.forEach((el, id) => {
      const top = el.offsetTop;
      const was = tops.current.get(id);
      if (!still && was !== undefined && Math.abs(was - top) > 1) el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      tops.current.set(id, top);
    });
  });

  const move = (i: number, d: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save(next);
  };
  const add = () => {
    const s: TaskStage = { id: `st-${uid()}`, kind: 'active', name: 'New stage' };
    const at = stages.findIndex((x) => x.kind === 'done'); // new stages go before Done
    save(at < 0 ? [...stages, s] : [...stages.slice(0, at), s, ...stages.slice(at)]);
    setFocusId(s.id);
    setFreshId(s.id);
    setTimeout(() => setFreshId((x) => (x === s.id ? null : x)), 400);
  };
  /** Takes the row away with a short fold, then moves its tasks (if any) and saves. */
  const remove = (s: TaskStage, to?: TaskStage) => {
    setRemoving(null);
    setLeaving(s.id);
    setTimeout(() => {
      if (to) onMoveTasks(movesTo(inStage(s.id), to, `moved it to ${stageName(to)} when the stage “${stageName(s)}” was removed`));
      save(stages.filter((x) => x.id !== s.id));
      setLeaving(null);
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  };
  /** Moving tasks to another stage keeps "done" in step with the stage's kind. */
  const movesTo = (list: Todo[], to: TaskStage, text: string): Move[] => {
    const at = new Date().toISOString();
    const done = to.kind === 'done';
    return list.map((t) => ({
      id: t.id,
      patch: { status: to.id, done, doneAt: done ? (t.done ? t.doneAt : at) : undefined, doneBy: done ? (t.done ? t.doneBy : me) : undefined, history: [...(t.history ?? []), { id: uid(), at, by: me, kind: 'status', text }] },
    }));
  };
  const doReset = () => {
    if (!reset) return;
    // Tasks in stages that go away move to the stage of the same name there, else the first of the same kind.
    const moves = movesToList(tasks, stages, reset.to, me, reset.why);
    if (moves.length) onMoveTasks(moves);
    reset.onDone();
    setResetting(false);
  };

  const reviewTeams = teams.filter((t) => t.review);
  return (
    <>
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <div className="stage-list" style={{ position: 'relative' }}>
            {stages.map((s, i) => {
              const onlyOne = (s.kind === 'open' || s.kind === 'done') && count(s.kind) === 1;
              // Whether tasks count as done follows the kind, so a stage only becomes (or stops being) a done stage while it's empty.
              const busy = inStage(s.id).length > 0;
              const fixedKind = onlyOne || (s.kind === 'done' && busy);
              return (
                <div
                  key={s.id}
                  className={`stage-row ${leaving === s.id ? 'leaving' : freshId === s.id ? 'fresh' : ''}`}
                  ref={(el) => {
                    if (el) rows.current.set(s.id, el);
                    else rows.current.delete(s.id);
                  }}
                >
                  <StageSwatch stage={s} disabled={!canManage} onColor={(color) => patch(s.id, { color })} />
                  <StageName
                    key={`${s.id}:${s.name ?? ''}:${wordsKey}`}
                    stage={s}
                    autoFocus={focusId === s.id}
                    taken={(name) => {
                      const dup = stages.find((x) => x.id !== s.id && stageName(x).toLowerCase() === name.toLowerCase());
                      setClash(dup ? stageName(dup) : null);
                      return !!dup;
                    }}
                    onName={(name) => patch(s.id, { name })}
                  />
                  {fixedKind ? (
                    <span className="stage-kind-fixed" title={onlyOne ? (s.kind === 'open' ? 'At least one stage is where new tasks start' : 'At least one stage is where finished tasks go') : 'Finished tasks are in it. Move them before it means something else.'}>
                      {KIND_INFO[s.kind].name}
                    </span>
                  ) : (
                    <Select<StageKind>
                      value={s.kind}
                      onChange={(kind) => patch(s.id, { kind, ...(fixedTone(kind) ? { color: undefined } : {}) })}
                      label={`What “${stageName(s)}” means`}
                      title="What this stage means"
                      className="sel-flat stage-kind"
                      disabled={!canManage}
                      options={STAGE_KINDS.filter((k) => k !== 'done' || !busy).map((k) => ({ value: k, label: KIND_INFO[k].name, hint: KIND_INFO[k].hint }))}
                    />
                  )}
                  {canManage && (
                    <>
                      <span className="stage-order">
                        <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${stageName(s)} left on the board`} title="Earlier on the board">
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" className="icon-btn sm" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${stageName(s)} right on the board`} title="Later on the board">
                          <ArrowDown size={14} />
                        </button>
                      </span>
                      <button
                        type="button"
                        className="icon-btn sm"
                        disabled={onlyOne || stages.length <= 2}
                        title={onlyOne ? (s.kind === 'open' ? 'New tasks need a stage to start in' : 'Finished tasks need a done stage') : `Remove ${stageName(s)}`}
                        aria-label={`Remove ${stageName(s)}`}
                        onClick={() => (inStage(s.id).length || (s.kind === 'review' && count('review') === 1 && reviewTeams.length) ? setRemoving(s) : remove(s))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className={`fold ${clash ? 'open' : ''}`}>
            <div className="fold-in">
              <p className="err small stage-clash">Another stage is already called “{lastClash.current}”. Each stage needs its own name.</p>
            </div>
          </div>
          {canManage && (
            <div className="stage-foot">
              <button type="button" className="ghost-btn sm" disabled={stages.length >= 20} onClick={add}>
                <Plus size={14} /> Add a stage
              </button>
              {reset && (
                <button type="button" className="link-btn small" onClick={() => setResetting(true)}>
                  {reset.label}
                </button>
              )}
            </div>
          )}
        </div>
      </fieldset>

      {removing && (
        <RemoveStage
          stage={removing}
          stages={stages}
          tasks={inStage(removing.id).length}
          reviewTeams={removing.kind === 'review' && count('review') === 1 ? reviewTeams : []}
          onRemove={(to) => remove(removing, inStage(removing.id).length ? to : undefined)}
          onClose={() => setRemoving(null)}
        />
      )}
      {resetting && reset && (
        <Layer>
          <div className="modal-scrim" onMouseDown={() => setResetting(false)}>
            <div className="modal" role="dialog" aria-label={reset.title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setResetting(false)}>
              <header className="modal-head">
                <span>{reset.title}</span>
                <button type="button" className="icon-btn sm" onClick={() => setResetting(false)} aria-label="Close">
                  <X size={15} />
                </button>
              </header>
              <div className="modal-body">
                <p className="small">{reset.text}</p>
              </div>
              <footer className="modal-foot">
                <button type="button" className="ghost-btn sm" onClick={() => setResetting(false)}>
                  Cancel
                </button>
                <button type="button" className="primary-btn sm" autoFocus onClick={doReset}>
                  {reset.action}
                </button>
              </footer>
            </div>
          </div>
        </Layer>
      )}
    </>
  );
}

const KIND_LONG: Record<StageKind, () => string> = {
  open: () => `New tasks and ${term.whos}’ requests land in the first one.`,
  active: () => `Someone is on it. Start moves a task to the first one, and ${term.whos} see “In progress”.`,
  waiting: () => `The next step is the ${term.who}’s. Their shared space says “Waiting on you”, and the “Waiting on ${term.who}” filter finds it.`,
  review: () => 'Finished, and waiting for the supervisor to approve it or send it back. In teams that check work, finished tasks go to the first one.',
  done: () => 'Finished. Ticking a task moves it to the first one; it counts as done everywhere.',
};

/** The stage's colour, and a small picker. Waiting and done stages keep their meaning's colour. */
function StageSwatch({ stage, disabled, onColor }: { stage: TaskStage; disabled: boolean; onColor: (c: StageColor) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const fixed = fixedTone(stage.kind);
  const tone = toneOf(stage);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="stage-swatch"
        disabled={disabled || fixed}
        onClick={() => setOpen(true)}
        title={fixed ? `${stage.kind === 'waiting' ? 'Waiting' : 'Done'} stages are always ${TONE_NAME[tone].toLowerCase()}` : `Colour: ${TONE_NAME[tone]}`}
        aria-label={`Colour of ${stageName(stage)}: ${TONE_NAME[tone]}`}
      >
        <span className={`stage-dot k-${stage.kind} tone-${tone}`} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={264} title={`Colour of ${stageName(stage)}`}>
        <div className="stage-colors" role="group" aria-label="Colours">
          {STAGE_COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={tone === c} title={TONE_NAME[c]} aria-label={TONE_NAME[c]} onClick={() => (onColor(c), setOpen(false))}>
              <span className={`stage-dot k-${stage.kind} tone-${c}`} />
            </button>
          ))}
        </div>
        <p className="muted small stage-colors-note">Red is kept for late work. Waiting stages are amber and done stages green, so they read the same everywhere.</p>
      </Popover>
    </>
  );
}

/** A stage's name, saved when you leave the field. Clearing a built-in stage's name brings back its usual one. */
function StageName({ stage, autoFocus, taken, onName }: { stage: TaskStage; autoFocus: boolean; taken: (name: string) => boolean; onName: (name: string | undefined) => void }) {
  const [v, setV] = useState(stageName(stage));
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (autoFocus) (ref.current?.focus(), ref.current?.select());
  }, [autoFocus]);
  const commit = () => {
    const name = v.trim().slice(0, 40);
    const usual = builtInName(stage.id);
    if (!name && usual) return (setV(usual), stage.name && onName(undefined)); // a built-in stage gets its usual name back
    if (!name || taken(name)) return setV(stageName(stage)); // a stage always has a name of its own
    const next = usual && name === usual ? undefined : name;
    if (next !== (stage.name?.trim() || undefined)) onName(next);
  };
  return (
    <input
      ref={ref}
      className="stage-name"
      value={v}
      maxLength={40}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') (setV(stageName(stage)), requestAnimationFrame(() => ref.current?.blur()));
      }}
      placeholder={builtInName(stage.id) ?? 'Stage name'}
      aria-label="Stage name"
    />
  );
}

/** "Waiting on guest" and "Waiting on the guest" say the same thing: no need for both. */
const sameWords = (a: string, b: string) => a.toLowerCase().replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();

/** Removing a stage that has tasks: where do they go? */
function RemoveStage({ stage, stages, tasks, reviewTeams, onRemove, onClose }: { stage: TaskStage; stages: TaskStage[]; tasks: number; reviewTeams: Team[]; onRemove: (to: TaskStage) => void; onClose: () => void }) {
  const others = stages.filter((s) => s.id !== stage.id);
  const i = stages.findIndex((s) => s.id === stage.id);
  const [to, setTo] = useState((others.find((s) => s.kind === stage.kind) ?? stages[i - 1] ?? others[0]).id);
  const target = others.find((s) => s.id === to)!;
  const n = `${tasks} task${tasks === 1 ? '' : 's'}`;
  const change = stage.kind !== 'done' && target.kind === 'done' ? `They’ll count as done.` : stage.kind === 'done' && target.kind !== 'done' ? `They’ll be open again.` : '';
  return (
    <Layer>
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={`Remove ${stageName(stage)}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span>Remove “{stageName(stage)}”</span>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body move-pick">
          <SmoothHeight>
            {tasks > 0 && (
              <>
                <p className="small">
                  {n} {tasks === 1 ? 'is' : 'are'} in this stage. Move {tasks === 1 ? 'it' : 'them'} to:
                </p>
                <Select<string>
                  value={to}
                  onChange={setTo}
                  label="Move the tasks to"
                  title="Move the tasks to"
                  options={others.map((s) => ({ value: s.id, label: stageName(s), hint: sameWords(stageName(s), KIND_INFO[s.kind].name) ? undefined : KIND_INFO[s.kind].name, icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} /> }))}
                />
                {change && <p className="muted small">{change}</p>}
              </>
            )}
            {reviewTeams.length > 0 && (
              <p className="muted small">
                {reviewTeams.map((t) => t.name).join(', ')} {reviewTeams.length === 1 ? 'checks' : 'check'} work before it counts as done. Without a review stage, finished work goes straight to done.
              </p>
            )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn sm" onClick={() => onRemove(target)}>
            {tasks === 0 ? 'Remove' : `Move ${tasks === 1 ? 'it' : 'them'} and remove`}
          </button>
        </footer>
      </div>
    </div>
    </Layer>
  );
}

/**
 * A project's or a team's own stages: off, it follows the company's (or, for a project, its team's); on, it starts from
 * a copy of them and edits its own with the same editor. Turning it off moves its tasks back by name, else by kind.
 */
export function OwnStages({ what, name, own, inherited, inheritedFrom, canManage, tasks, teams, me, wordsKey, onStages, onMoveTasks }: {
  what: 'project' | 'team';
  name: string;
  own: TaskStage[] | undefined; // its own list, when it has one
  inherited: TaskStage[]; // what it follows otherwise
  inheritedFrom: string; // "Pixel & Profits" (or the team's name)
  canManage: boolean;
  tasks: Todo[]; // its tasks
  teams: Team[];
  me: string;
  wordsKey: string;
  onStages: (next: TaskStage[] | undefined) => void;
  onMoveTasks: (moves: Move[]) => void;
}) {
  const on = !!own?.length;
  const list = on ? cleanStages(own) : inherited;
  const whose = inheritedFrom.endsWith('s') ? `${inheritedFrom}’` : `${inheritedFrom}’s`; // "Pixel & Profits’ stages"
  return (
    <div className="own-stages">
      <div className="set-row toggle-row">
        <span>
          <strong>Use {what === 'project' ? 'this project’s' : 'this team’s'} own stages</strong>
          <small>{on ? `${name} has its own board columns. Its tasks use them everywhere.` : `Off: ${name} uses ${whose} stages: ${inherited.map((s) => stageName(s)).join(', ')}.`}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`switch ${on ? 'on' : ''}`}
          disabled={!canManage}
          onClick={() => {
            if (!on) return onStages(inherited.map((s) => ({ ...s }))); // a copy to start from: same ids, so no task moves
            const moves = movesToList(tasks, list, inherited, me, `when ${name} went back to ${whose} stages`);
            if (moves.length) onMoveTasks(moves);
            onStages(undefined);
          }}
        >
          <span />
        </button>
      </div>
      <div className={`fold ${on ? 'open' : ''}`}>
        <div className="fold-in">
          {on && <StageEditor stages={list} save={(next) => onStages(next)} canManage={canManage} tasks={tasks} teams={teams} me={me} wordsKey={wordsKey} onMoveTasks={onMoveTasks} />}
        </div>
      </div>
    </div>
  );
}
