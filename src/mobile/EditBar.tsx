import { useEffect, useRef, useState } from 'react';
import { GripVertical, Menu as MenuIcon, type LucideIcon } from 'lucide-react';
import { useLongPress } from '../components/ui/useLongPress';

export interface EditApp {
  id: string;
  name: string;
  icon: LucideIcon;
}

const ROW = 52;
const MORE = '__more';
export const BAR_MAX = 4;

/**
 * Edit the bottom bar: one list of the apps with a "More" line in it. What's above the line is on the bar (four at
 * most: a fifth pushes the last one down into More), the rest live in More. Drag a row by its handle with a mouse,
 * or hold it and move on a touch screen; Alt and the arrow keys move the focused row. The bar above the list shows the
 * result as you go.
 */
export function EditBar({ apps, bar, onChange }: { apps: EditApp[]; bar: string[]; onChange: (bar: string[]) => void }) {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const onBar = bar.filter((id) => byId.has(id)).slice(0, BAR_MAX);
  const rest = apps.map((a) => a.id).filter((id) => !onBar.includes(id));
  const [items, setItemsState] = useState<string[]>(() => [...onBar, MORE, ...rest]);
  const itemsRef = useRef(items);
  const setItems = (list: string[]) => ((itemsRef.current = list), setItemsState(list));
  // The list follows changes made elsewhere (another device, a reset), except mid-drag.
  const dragging = useRef<{ id: string; from: number; dy: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; y: number } | null>(null);
  const key = [...onBar, MORE, ...rest].join(',');
  useEffect(() => {
    if (!dragging.current) setItems(key.split(','));
  }, [key]);

  const commit = (list: string[]) => {
    const cut = list.indexOf(MORE);
    let top = list.slice(0, cut);
    let below = list.slice(cut + 1);
    if (top.length > BAR_MAX) (below = [...top.slice(BAR_MAX), ...below]), (top = top.slice(0, BAR_MAX));
    const next = [...top, MORE, ...below];
    setItems(next);
    if (top.join(',') !== onBar.join(',')) onChange(top);
  };

  const moveTo = (id: string, to: number) => {
    const list = itemsRef.current.filter((x) => x !== id);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, id);
    setItems(list);
    return list;
  };

  const start = (id: string) => {
    const from = itemsRef.current.indexOf(id);
    dragging.current = { id, from, dy: 0 };
    setDrag({ id, y: from * ROW });
  };
  const moveBy = (dy: number) => {
    const d = dragging.current;
    if (!d) return;
    d.dy = dy;
    const y = Math.max(0, Math.min((itemsRef.current.length - 1) * ROW, d.from * ROW + dy));
    const at = Math.round(y / ROW);
    if (at !== itemsRef.current.indexOf(d.id)) moveTo(d.id, at);
    setDrag({ id: d.id, y });
  };
  const end = () => {
    const d = dragging.current;
    dragging.current = null;
    setDrag(null);
    if (d) commit(itemsRef.current);
  };

  // Mouse: drag straight away from the handle.
  const mouseDown = (id: string) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    start(id);
    const mv = (ev: PointerEvent) => moveBy(ev.clientY - y0);
    const up = () => (end(), removeEventListener('pointermove', mv), removeEventListener('pointerup', up));
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  const cut = items.indexOf(MORE);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const preview = items.slice(0, Math.min(cut, BAR_MAX)).map((id) => byId.get(id)!).filter(Boolean); // a fifth goes to More on drop
  return (
    <div className="bar-edit">
      <div className="bar-preview" aria-hidden="true">
        {preview.map((a) => (
          <span key={a.id}>
            <a.icon size={18} />
            {a.name}
          </span>
        ))}
        <span>
          <MenuIcon size={18} />
          More
        </span>
      </div>
      <p className="bar-edit-hint">{touch ? 'Hold an app and drag it.' : 'Drag an app by its handle.'} The four above the line are on the bar; the rest are in More.</p>
      <div className="bar-list" style={{ height: items.length * ROW }} role="list">
        {items.map((id, i) =>
          id === MORE ? (
            <div key={MORE} className="bar-cut" role="separator" style={{ transform: `translateY(${i * ROW}px)` }}>
              <span>In More</span>
            </div>
          ) : (
            <BarRow
              key={id}
              app={byId.get(id)!}
              y={drag?.id === id ? drag.y : i * ROW}
              lifted={drag?.id === id}
              onBar={i < cut}
              onStart={() => start(id)}
              onMove={moveBy}
              onEnd={end}
              onMouse={mouseDown(id)}
              onKey={(dir) => commit(moveTo(id, i + dir))}
            />
          ),
        )}
      </div>
    </div>
  );
}

function BarRow({ app, y, lifted, onBar, onStart, onMove, onEnd, onMouse, onKey }: { app: EditApp; y: number; lifted: boolean; onBar: boolean; onStart: () => void; onMove: (dy: number) => void; onEnd: () => void; onMouse: (e: React.PointerEvent) => void; onKey: (dir: -1 | 1) => void }) {
  const press = useLongPress(onStart, { onDrag: (p) => onMove(p.dy), onDragEnd: onEnd });
  return (
    <div
      className={`bar-row lp${lifted ? ' lifted' : ''}${onBar ? ' on-bar' : ''}`}
      style={{ transform: `translateY(${y}px)` }}
      role="listitem"
      tabIndex={0}
      aria-label={`${app.name}, ${onBar ? 'on the bar' : 'in More'}. Alt and arrow keys move it.`}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        onKey(e.key === 'ArrowUp' ? -1 : 1);
      }}
      {...press}
    >
      <app.icon size={19} className="bar-row-icon" />
      <span className="bar-row-name">{app.name}</span>
      <span className="bar-grip" onPointerDown={onMouse} aria-hidden="true">
        <GripVertical size={18} />
      </span>
    </div>
  );
}
