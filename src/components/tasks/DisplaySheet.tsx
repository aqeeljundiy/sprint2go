import { useState, type RefObject } from 'react';
import { Bookmark, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { TabPane } from '../ui/Smooth';
import { usePhone } from '../../mobile/media';
import { Select } from '../ui/Select';
import { Avatar } from '../Avatar';
import { term } from '../../terms';
import type { User } from '../../types';
import type { Display, GroupBy, Layout, Only, SortBy, Who } from './display';
import { SORTS, sortLabel } from './display';
import { mark, t, tn } from '../../i18n';

/** What a row or card can show. Show the names with t(name). */
export const TASK_FIELDS: { id: string; name: string }[] = [
  { id: 'due', name: mark('Due date') },
  { id: 'assignee', name: mark('Who’s on it') },
  { id: 'project', name: mark('Project') },
  { id: 'team', name: mark('Team') },
  { id: 'brief', name: mark('Brief') },
  { id: 'priority', name: mark('High priority ring') },
  { id: 'checklist', name: mark('Checklist progress') },
  { id: 'comments', name: mark('Comments') },
  { id: 'updated', name: mark('Last change') },
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
  const phone = usePhone();
  const [sub, setSub] = useState<'' | 'group' | 'sort' | 'who' | 'rows'>(''); // phones: a list pushed inside the sheet
  const [naming, setNaming] = useState(false); // phones: "Save as view" asks for a name in its row
  const patch = (p: Partial<Display>) => set({ ...d, ...p });
  const toggleOnly = (o: Only) => patch({ only: d.only.includes(o) ? d.only.filter((x) => x !== o) : [...d.only, o] });
  const groupName = (g: GroupBy) => (g === 'client' ? term.One : g === 'date' ? t('Date') : g === 'team' ? t('Team') : g === 'person' ? t('Person') : g === 'stage' ? t('Stage') : t('None'));
  const whoValue = d.who === 'people' ? `p:${d.people[0] ?? ''}` : d.who;
  const sw = (on: boolean, run: () => void, label: string) => (
    <button type="button" className="ds-row" onClick={run} role="switch" aria-checked={on}>
      <span>{label}</span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
  const whoLabel = d.who === 'people' ? (users.find((u) => u.id === d.people[0])?.name ?? t('Anyone')) : d.who === 'me' ? t('Me') : d.who === 'me-none' ? t('Me and not assigned') : d.who === 'none' ? t('Not assigned') : t('Anyone');

  // Phones: Todoist's Display sheet. X, the title and a check (changes apply as you make them); grouped cards; Sort and
  // the filters push a list inside the sheet.
  if (phone) {
    if (!open) return null;
    const close = () => (setSub(''), setNaming(false), onClose());
    const pickRow = (on: boolean, label: string, run: () => void, icon?: React.ReactNode) => (
      <button key={label} type="button" className="ds-prow" role="radio" aria-checked={on} onClick={run}>
        {icon}
        <span className="ds-plabel">{label}</span>
        {on && <Check size={18} className="ds-pcheck" />}
      </button>
    );
    const swRow = (on: boolean, run: () => void, label: string) => (
      <button key={label} type="button" className="ds-prow" onClick={run} role="switch" aria-checked={on}>
        <span className="ds-plabel">{label}</span>
        <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>
    );
    const navRow = (label: string, value: string, to: typeof sub) => (
      <button type="button" className="ds-prow" onClick={() => setSub(to)}>
        <span className="ds-plabel">{label}</span>
        <span className="ds-pvalue">{value}</span>
        <ChevronRight size={18} className="ds-pchev" />
      </button>
    );
    const subTitle = sub === 'group' ? t('Grouping') : sub === 'sort' ? t('Sorting') : sub === 'who' ? t('Assignee') : sub === 'rows' ? (d.layout === 'board' ? t('On each card') : t('On each row')) : '';
    return (
      <Sheet onClose={close} label={t('Display')} size="tall" className="ds-sheet">
        <header className="ds-phead">
          {sub ? (
            <button type="button" className="ds-pback" onClick={() => setSub('')} aria-label={t('Back to {screen}', { screen: t('Display') })}>
              <ChevronLeft size={22} />
            </button>
          ) : (
            <button type="button" className="ds-pcircle" onClick={close} aria-label={t('Close')}>
              <X size={20} />
            </button>
          )}
          <h2>{sub ? subTitle : t('Display')}</h2>
          <button type="button" className="ds-pcircle accent" onClick={close} aria-label={t('Done')}>
            <Check size={20} strokeWidth={2.5} />
          </button>
        </header>
        <TabPane key={sub || 'main'}>
          {sub === '' && (
            <div className="ds-pbody">
              <h3 className="ds-plab">{t('Layout')}</h3>
              <div className="ds-card">
                {layouts.length > 1 && (
                  <div className="ds-pics" role="radiogroup" aria-label={t('Layout')}>
                    {layouts.map((l) => (
                      <button key={l} type="button" role="radio" aria-checked={d.layout === l} className={`ds-pic${d.layout === l ? ' on' : ''}`} onClick={() => patch({ layout: l })}>
                        <Pic kind={l} />
                        <span>{l === 'list' ? t('List') : l === 'board' ? t('Board') : t('Calendar')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {swRow(d.completed, () => patch({ completed: !d.completed }), t('Completed tasks'))}
              </div>
              <h3 className="ds-plab">{t('Sort')}</h3>
              <div className="ds-card">
                {d.layout === 'list' && groups.length > 1 && navRow(t('Grouping'), groupName(d.group), 'group')}
                {navRow(t('Sorting'), sortLabel(d.sort), 'sort')}
              </div>
              <h3 className="ds-plab">{t('Filter')}</h3>
              <div className="ds-card">
                {navRow(t('Assignee'), whoLabel, 'who')}
                {swRow(d.only.includes('late'), () => toggleOnly('late'), t('Only late'))}
                {swRow(d.only.includes('high'), () => toggleOnly('high'), t('Only high priority'))}
                {waitingWord && swRow(d.only.includes('waiting'), () => toggleOnly('waiting'), t('Only {stage}', { stage: waitingWord.charAt(0).toLowerCase() + waitingWord.slice(1) }))}
              </div>
              <h3 className="ds-plab">{t('Rows')}</h3>
              <div className="ds-card">{navRow(d.layout === 'board' ? t('On each card') : t('On each row'), tn(fields.length, '{n} shown', '{n} shown'), 'rows')}</div>
              <h3 className="ds-plab">{t('Views')}</h3>
              <div className="ds-card">
                {views.map((v) => (
                  <div key={v.id} className={`ds-prow ds-pview${v.id === activeView ? ' on' : ''}`}>
                    <Bookmark size={18} className="ds-picon" />
                    <span className="ds-plabel">{v.name}</span>
                    <button type="button" className="icon-btn" aria-label={t('Delete the view {name}', { name: v.name })} onClick={() => onDeleteView(v.id)}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {naming ? (
                  <div className="ds-prow ds-pname">
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('View name')} aria-label={t('View name')} enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && name.trim() && (onSaveView(name.trim()), setName(''), setNaming(false))} />
                    <button type="button" className="link-btn" disabled={!name.trim()} onClick={() => (onSaveView(name.trim()), setName(''), setNaming(false))}>
                      {t('Save')}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="ds-prow" onClick={() => setNaming(true)}>
                    <span className="ds-plabel accent">{t('Save as view')}</span>
                  </button>
                )}
                <button type="button" className="ds-prow" onClick={reset}>
                  <span className="ds-plabel danger">{t('Reset to default')}</span>
                </button>
              </div>
            </div>
          )}
          {sub === 'group' && <div className="ds-pbody"><div className="ds-card">{groups.map((g) => pickRow(d.group === g, groupName(g), () => (patch({ group: g }), setSub(''))))}</div></div>}
          {sub === 'sort' && <div className="ds-pbody"><div className="ds-card">{SORTS.map((x) => pickRow(d.sort === x, sortLabel(x), () => (patch({ sort: x }), setSub(''))))}</div></div>}
          {sub === 'who' && (
            <div className="ds-pbody">
              <div className="ds-card">
                {pickRow(d.who === 'any', t('Anyone'), () => (patch({ who: 'any', people: [] }), setSub('')))}
                {pickRow(d.who === 'me', t('Me'), () => (patch({ who: 'me', people: [] }), setSub('')))}
                {pickRow(d.who === 'me-none', t('Me and not assigned'), () => (patch({ who: 'me-none', people: [] }), setSub('')))}
                {pickRow(d.who === 'none', t('Not assigned'), () => (patch({ who: 'none', people: [] }), setSub('')))}
              </div>
              <h3 className="ds-plab">{t('People')}</h3>
              <div className="ds-card">
                {users.filter((u) => u.id !== me).map((u) => pickRow(d.who === 'people' && d.people[0] === u.id, u.name, () => (patch({ who: 'people', people: [u.id] }), setSub('')), <Avatar person={u} size={24} />))}
              </div>
            </div>
          )}
          {sub === 'rows' && (
            <div className="ds-pbody">
              <div className="ds-card">{TASK_FIELDS.map((f) => swRow(fields.includes(f.id), () => onFields(fields.includes(f.id) ? fields.filter((x) => x !== f.id) : [...fields, f.id]), f.id === 'project' ? term.One : t(f.name)))}</div>
            </div>
          )}
        </TabPane>
      </Sheet>
    );
  }

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={340} align="end" title={t('Display')}>
      <div className="ds">
        {layouts.length > 1 && (
          <div className="ds-pics" role="radiogroup" aria-label={t('Layout')}>
            {layouts.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={d.layout === l} className={`ds-pic${d.layout === l ? ' on' : ''}`} onClick={() => patch({ layout: l })}>
                <Pic kind={l} />
                <span>{l === 'list' ? t('List') : l === 'board' ? t('Board') : t('Calendar')}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ds-sec">
          {sw(d.completed, () => patch({ completed: !d.completed }), t('Show completed tasks'))}
          {d.layout === 'list' && groups.length > 1 && (
            <div className="ds-row">
              <span>{t('Group by')}</span>
              <Select<GroupBy> value={d.group} onChange={(g) => patch({ group: g })} label={t('Group by')} className="sel-flat" options={groups.map((g) => ({ value: g, label: groupName(g) }))} width={200} />
            </div>
          )}
          <div className="ds-row">
            <span>{t('Order')}</span>
            <Select<SortBy> value={d.sort} onChange={(s) => patch({ sort: s })} label={t('Order')} className="sel-flat" options={SORTS.map((s) => ({ value: s, label: sortLabel(s), hint: s === 'smart' ? t('By day, high priority first') : undefined }))} width={220} />
          </div>
        </div>
        <div className="ds-sec">
          <div className="ds-row">
            <span>{t('Who')}</span>
            <Select<string>
              value={whoValue}
              onChange={(v) => (v.startsWith('p:') ? patch({ who: 'people', people: [v.slice(2)] }) : patch({ who: v as Who, people: [] }))}
              label={t('Whose tasks')}
              className="sel-flat"
              width={260}
              options={[
                { value: 'any', label: t('Anyone') },
                { value: 'me', label: t('Me') },
                { value: 'me-none', label: t('Me and not assigned') },
                { value: 'none', label: t('Not assigned') },
                ...users.filter((u) => u.id !== me).map((u) => ({ value: `p:${u.id}`, label: u.name, icon: <Avatar person={u} size={20} />, group: t('People') })),
              ]}
            />
          </div>
          {sw(d.only.includes('late'), () => toggleOnly('late'), t('Only late'))}
          {sw(d.only.includes('high'), () => toggleOnly('high'), t('Only high priority'))}
          {waitingWord && sw(d.only.includes('waiting'), () => toggleOnly('waiting'), t('Only {stage}', { stage: waitingWord.charAt(0).toLowerCase() + waitingWord.slice(1) }))}
        </div>
        <div className="ds-sec">
          <button type="button" className="ds-row ds-fold" onClick={() => setRowsOpen((o) => !o)} aria-expanded={rowsOpen}>
            <span>{d.layout === 'board' ? t('On each card') : t('On each row')}</span>
            <ChevronRight size={16} className={`rot-chev ${rowsOpen ? 'open' : ''}`} />
          </button>
          <div className={`fold ${rowsOpen ? 'open' : ''}`}>
            <div className="fold-in">
              {TASK_FIELDS.map((f) => sw(fields.includes(f.id), () => onFields(fields.includes(f.id) ? fields.filter((x) => x !== f.id) : [...fields, f.id]), f.id === 'project' ? term.One : t(f.name)))}
            </div>
          </div>
        </div>
        <div className="ds-sec ds-views">
          <div className="ds-save">
            <Bookmark size={15} className="muted" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Save this as a view…')} aria-label={t('View name')} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (onSaveView(name.trim()), setName(''))} />
            <button type="button" className="ghost-btn sm" disabled={!name.trim()} onClick={() => (onSaveView(name.trim()), setName(''))}>
              {t('Save')}
            </button>
          </div>
          {views.map((v) => (
            <div key={v.id} className={`ds-view${v.id === activeView ? ' on' : ''}`}>
              <span>{v.name}</span>
              <button type="button" className="icon-btn sm" aria-label={t('Delete the view {name}', { name: v.name })} onClick={() => onDeleteView(v.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="link-btn small ds-reset" onClick={reset}>
          {t('Back to the usual')}
        </button>
      </div>
    </Popover>
  );
}
