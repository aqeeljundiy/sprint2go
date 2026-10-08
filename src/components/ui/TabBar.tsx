import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal } from 'lucide-react';
import { usePersisted } from '../../settings';
import { Popover } from './Popover';

export interface TabPrefs {
  order: string[];
  hidden: string[];
}

/** The company's default tab orders (set by an admin), and whether this person may set them. */
export const TabDefaultsCtx = createContext<{ defaults: Record<string, TabPrefs>; canSet: boolean; set: (key: string, p: TabPrefs | null) => void }>({ defaults: {}, canSet: false, set: () => {} });

/** Items in the order this person chose (else the company's, else the built-in one); new items go last. */
export function arrange<T extends { id: string }>(items: T[], prefs: TabPrefs | null | undefined): T[] {
  if (!prefs?.order.length) return items;
  const pos = new Map(prefs.order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (pos.get(a.id) ?? 1e6 + items.indexOf(a)) - (pos.get(b.id) ?? 1e6 + items.indexOf(b)));
}

export interface TabItem {
  id: string;
  label: ReactNode;
  name?: string; // plain name for the edit list (when label has icons or counts)
  title?: string;
}

/**
 * A row of tabs you can rearrange: drag a tab to move it, or use the edit list (works with a keyboard and on
 * phones) to move, hide and show them. The order is this person's; an admin can make it everyone's default.
 * Controlled mode (order + onOrder) is for tabs whose order is shared data, like a table's views.
 */
export function TabBar({
  storageKey,
  items,
  value,
  onSelect,
  className = 'client-tabs',
  fixed = [],
  extra,
  trailing,
  order,
  onOrder,
  role = 'tablist',
  canHide = true,
}: {
  canHide?: boolean; // false: tabs can be moved, not hidden (e.g. a table's views, shared by everyone)
  storageKey: string;
  items: TabItem[];
  value: string;
  onSelect: (id: string) => void;
  className?: string;
  fixed?: string[]; // can't be hidden (e.g. Overview)
  extra?: ReactNode; // after the tabs (an "add" button…)
  trailing?: ReactNode; // at the far end, after the arrange button (actions like Copy)
  order?: TabPrefs; // controlled: shared order kept in the data
  onOrder?: (p: TabPrefs) => void;
  role?: string;
}) {
  const shared = useContext(TabDefaultsCtx);
  const [mine, setMine] = usePersisted<TabPrefs | null>(`s2g-tabs:${storageKey}`, null);
  const prefs = (onOrder ? order : (mine ?? order)) ?? shared.defaults[storageKey] ?? null; // shared data order, unless you can't change it (then your own)
  const setPrefs = (p: TabPrefs) => (onOrder ? onOrder(p) : setMine(p));
  const all = arrange(items, prefs);
  const hidden = new Set((prefs?.hidden ?? []).filter((id) => !fixed.includes(id)));
  const shown = all.filter((t) => !hidden.has(t.id) || t.id === value);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);

  const ids = all.map((t) => t.id);
  const save = (nextIds: string[], nextHidden = [...hidden]) => setPrefs({ order: nextIds, hidden: nextHidden });
  const move = (id: string, to: number) => {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    save(rest);
  };
  const drop = () => {
    if (drag && over && drag !== over.id) {
      const rest = ids.filter((x) => x !== drag);
      const at = rest.indexOf(over.id) + (over.after ? 1 : 0);
      rest.splice(at, 0, drag);
      save(rest);
    }
    setDrag(null);
    setOver(null);
  };
  const toggleHidden = (id: string) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id);
    else h.add(id);
    save(ids, [...h]);
    if (h.has(id) && id === value) onSelect(all.find((t) => !h.has(t.id))?.id ?? value);
  };

  return (
    <div className={`${className} tab-bar`} role={role} onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => (e.preventDefault(), drop())}>
      {shown.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`${value === t.id ? 'on' : ''}${drag === t.id ? ' tab-dragging' : ''}${over?.id === t.id && drag !== t.id ? (over.after ? ' drop-after' : ' drop-before') : ''}`}
          title={t.title}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
            setDrag(t.id);
          }}
          onDragEnd={() => (setDrag(null), setOver(null))}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            if (over?.id !== t.id || over.after !== after) setOver({ id: t.id, after });
          }}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
      {extra}
      <button ref={editRef} type="button" className="tab-edit" onClick={() => setEditing(true)} title="Arrange tabs" aria-label="Arrange tabs">
        <MoreHorizontal size={15} />
      </button>
      <Popover anchor={editRef} open={editing} onClose={() => setEditing(false)} width={260} align="end" title="Arrange tabs">
        <div className="tab-edit-list">
          <p className="muted small">{canHide ? 'Drag tabs to move them, or use the arrows. Hidden tabs stay one click away here.' : 'Drag tabs to move them, or use the arrows. The order is the same for everyone.'}</p>
          {all.map((t, i) => (
            <div key={t.id} className={`tab-edit-row${hidden.has(t.id) ? ' off' : ''}`}>
              <GripVertical size={14} className="muted" />
              <span className="tab-edit-name">{t.name ?? t.label}</span>
              <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(t.id, i - 1)} aria-label="Move up">
                <ArrowUp size={13} />
              </button>
              <button type="button" className="icon-btn sm" disabled={i === all.length - 1} onClick={() => move(t.id, i + 1)} aria-label="Move down">
                <ArrowDown size={13} />
              </button>
              {canHide && <button type="button" className="icon-btn sm" disabled={fixed.includes(t.id)} onClick={() => toggleHidden(t.id)} aria-label={hidden.has(t.id) ? `Show ${t.name ?? ''}` : `Hide ${t.name ?? ''}`} title={fixed.includes(t.id) ? 'Always shown' : hidden.has(t.id) ? 'Show' : 'Hide'}>
                {hidden.has(t.id) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>}
            </div>
          ))}
          <div className="tab-edit-foot">
            {!onOrder && (mine || shared.defaults[storageKey]) && (
              <button type="button" className="link-btn small" onClick={() => (setMine(null), setEditing(false))}>
                {shared.defaults[storageKey] ? 'Use the company’s order' : 'Back to the usual order'}
              </button>
            )}
            {!onOrder && shared.canSet && (
              <button type="button" className="link-btn small" onClick={() => (shared.set(storageKey, { order: ids, hidden: [...hidden] }), setEditing(false))}>
                Make this everyone’s order
              </button>
            )}
          </div>
        </div>
      </Popover>
      {trailing}
    </div>
  );
}
