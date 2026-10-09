import { useState, type RefObject } from 'react';
import { Bookmark, ChevronRight, X } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { Avatar } from '../Avatar';
import { term } from '../../terms';
import type { User } from '../../types';
import type { Display, GroupBy, Layout, Only, SortBy, Who } from './display';
import { SORT_LABEL } from './display';

export const TASK_FIELDS: { id: string; name: string }[] = [
  { id: 'due', name: 'Due date' },
  { id: 'assignee', name: 'Who’s on it' },
  { id: 'project', name: 'Project' },
  { id: 'team', name: 'Team' },
  { id: 'brief', name: 'Brief' },
  { id: 'priority', name: 'High priority ring' },
  { id: 'checklist', name: 'Checklist progress' },
  { id: 'comments', name: 'Comments' },
  { id: 'updated', name: 'Last change' },
];

const Pic = ({ kind }: { kind: Layout }) => (
  <svg viewBox="0 0 60 40" aria-hidden="true" className="ds-pic-svg">
    {kind === 'list' && [8, 18, 28].map((y) => <g key={y}><circle cx="10" cy={y} r="3" /><rect x="17" y={y - 2} width={y === 18 ? 26 : 34} height="4" rx="2" /></g>)}
    {kind === 'board' && [6, 24, 42].map((x) => <g key={x}><rect x={x} y="6" width="13" height="8" rx="2" /><rect x={x} y="17" width="13" height={x === 24 ? 8 : 14} rx="2" opacity=".55" /></g>)}
    {kind === 'calendar' && (
      <g>
        <rect x="6" y="6" width="48" height="6" rx="2" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={6 + i * 7} y="16" width="5" height="5" rx="1.5" opacity={i === 2 ? 1 : 0.45} />)}
        <rect x="6" y="26" width="34" height="4" rx="2" opacity=".55" />
      </g>
    )}
  </svg>
);

/**
 * Display, for one task view: the layout as picture cards (List, Board, Calendar), completed tasks, grouping, order,
 * who and what's shown, and what each row shows. A popover on a computer, a sheet on a phone.
 */
export function DisplaySheet({
  anchor,
  open,
  onClose,
  d,
  set,
  reset,
  layouts,
  groups,
  users,
  me,
  waitingWord,
  fields,
  onFields,
  views,
  onSaveView,
  onDeleteView,
  activeView,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  d: Display;
  set: (d: Display) => void;
  reset: () => void;
  layouts: Layout[];
  groups: GroupBy[];
  users: User[];
  me: string;
  waitingWord?: string; // "Waiting on guest" when the company has a waiting stage
  fields: string[];
  onFields: (ids: string[]) => void;
  views: { id: string; name: string }[];
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  activeView?: string;
}) {
  const [name, setName] = useState('');
  const [rowsOpen, setRowsOpen] = useState(false);
  const patch = (p: Partial<Display>) => set({ ...d, ...p });
  const toggleOnly = (o: Only) => patch({ only: d.only.includes(o) ? d.only.filter((x) => x !== o) : [...d.only, o] });
  const groupName = (g: GroupBy) => (g === 'client' ? term.One : g === 'date' ? 'Date' : g === 'team' ? 'Team' : g === 'person' ? 'Person' : g === 'stage' ? 'Stage' : 'None');
  const whoValue = d.who === 'people' ? `p:${d.people[0] ?? ''}` : d.who;
  const sw = (on: boolean, run: () => void, label: string) => (
    <button type="button" className="ds-row" onClick={run} role="switch" aria-checked={on}>
      <span>{label}</span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={340} align="end" title="Display">
      <div className="ds">
        {layouts.length > 1 && (
          <div className="ds-pics" role="radiogroup" aria-label="Layout">
            {layouts.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={d.layout === l} className={`ds-pic${d.layout === l ? ' on' : ''}`} onClick={() => patch({ layout: l })}>
                <Pic kind={l} />
                <span>{l === 'list' ? 'List' : l === 'board' ? 'Board' : 'Calendar'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ds-sec">
          {sw(d.completed, () => patch({ completed: !d.completed }), 'Show completed tasks')}
          {d.layout === 'list' && groups.length > 1 && (
            <div className="ds-row">
              <span>Group by</span>
              <Select<GroupBy> value={d.group} onChange={(g) => patch({ group: g })} label="Group by" className="sel-flat" options={groups.map((g) => ({ value: g, label: groupName(g) }))} width={200} />
            </div>
          )}
          <div className="ds-row">
            <span>Order</span>
            <Select<SortBy> value={d.sort} onChange={(s) => patch({ sort: s })} label="Order" className="sel-flat" options={(Object.keys(SORT_LABEL) as SortBy[]).map((s) => ({ value: s, label: SORT_LABEL[s], hint: s === 'smart' ? 'By day, high priority first' : undefined }))} width={220} />
          </div>
        </div>
        <div className="ds-sec">
          <div className="ds-row">
            <span>Who</span>
            <Select<string>
              value={whoValue}
              onChange={(v) => (v.startsWith('p:') ? patch({ who: 'people', people: [v.slice(2)] }) : patch({ who: v as Who, people: [] }))}
              label="Whose tasks"
              className="sel-flat"
              width={260}
              options={[
                { value: 'any', label: 'Anyone' },
                { value: 'me', label: 'Me' },
                { value: 'me-none', label: 'Me and not assigned' },
                { value: 'none', label: 'Not assigned' },
                ...users.filter((u) => u.id !== me).map((u) => ({ value: `p:${u.id}`, label: u.name, icon: <Avatar person={u} size={20} />, group: 'People' })),
              ]}
            />
          </div>
          {sw(d.only.includes('late'), () => toggleOnly('late'), 'Only late')}
          {sw(d.only.includes('high'), () => toggleOnly('high'), 'Only high priority')}
          {waitingWord && sw(d.only.includes('waiting'), () => toggleOnly('waiting'), `Only ${waitingWord.charAt(0).toLowerCase()}${waitingWord.slice(1)}`)}
        </div>
        <div className="ds-sec">
          <button type="button" className="ds-row ds-fold" onClick={() => setRowsOpen((o) => !o)} aria-expanded={rowsOpen}>
            <span>On each {d.layout === 'board' ? 'card' : 'row'}</span>
            <ChevronRight size={16} className={`rot-chev ${rowsOpen ? 'open' : ''}`} />
          </button>
          <div className={`fold ${rowsOpen ? 'open' : ''}`}>
            <div className="fold-in">
              {TASK_FIELDS.map((f) => sw(fields.includes(f.id), () => onFields(fields.includes(f.id) ? fields.filter((x) => x !== f.id) : [...fields, f.id]), f.name))}
            </div>
          </div>
        </div>
        <div className="ds-sec ds-views">
          <div className="ds-save">
            <Bookmark size={15} className="muted" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save this as a view…" aria-label="View name" onKeyDown={(e) => e.key === 'Enter' && name.trim() && (onSaveView(name.trim()), setName(''))} />
            <button type="button" className="ghost-btn sm" disabled={!name.trim()} onClick={() => (onSaveView(name.trim()), setName(''))}>
              Save
            </button>
          </div>
          {views.map((v) => (
            <div key={v.id} className={`ds-view${v.id === activeView ? ' on' : ''}`}>
              <span>{v.name}</span>
              <button type="button" className="icon-btn sm" aria-label={`Delete the view ${v.name}`} onClick={() => onDeleteView(v.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="link-btn small ds-reset" onClick={reset}>
          Back to the usual
        </button>
      </div>
    </Popover>
  );
}
