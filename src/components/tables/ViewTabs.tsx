import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { TableViewDef } from '../../types';
import { Popover } from '../ui/Popover';
import { viewIcon } from './viewKinds';

/**
 * A table's views as tabs. As many as fit the row show; the rest are one click away under "N more" (the open view
 * always shows). Click the open view, or right-click any, for its menu. Drag tabs to reorder (for people who may).
 */
export function ViewTabs({ views, current, canEdit, onSelect, onMenu, onReorder, onAdd }: {
  views: TableViewDef[];
  current: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onMenu?: (id: string, el: HTMLElement) => void;
  onReorder?: (ids: string[]) => void;
  onAdd?: (el: HTMLElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState(views.length);
  const [more, setMore] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const sig = views.map((v) => `${v.id}:${v.name}:${v.kind}`).join('|');

  // How many tabs fit: measured from a hidden copy of every tab, against the room the row has.
  useLayoutEffect(() => {
    const el = box.current;
    const m = measure.current;
    if (!el || !m || typeof ResizeObserver === 'undefined') return;
    const work = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth + 4);
      const room = el.clientWidth - 48 /* add */ - 4;
      let used = 0;
      let n = 0;
      for (const w of widths) {
        const last = n === widths.length - 1;
        if (used + w > room - (last ? 0 : 92 /* "N more" */)) break;
        used += w;
        n++;
      }
      setFit((x) => (x !== Math.max(1, n) ? Math.max(1, n) : x));
    };
    work();
    const ro = new ResizeObserver(work);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);

  // The open view always shows: it takes the last place that fits when it's further along.
  let shown = views.slice(0, fit);
  if (!shown.some((v) => v.id === current) && views.some((v) => v.id === current)) shown = [...views.slice(0, Math.max(0, fit - 1)), views.find((v) => v.id === current)!];
  const hidden = views.filter((v) => !shown.includes(v));
  const drop = () => {
    if (drag && over && drag !== over.id && onReorder) {
      const ids = views.map((v) => v.id).filter((x) => x !== drag);
      ids.splice(ids.indexOf(over.id) + (over.after ? 1 : 0), 0, drag);
      onReorder(ids);
    }
    setDrag(null);
    setOver(null);
  };
  return (
    <div className="tb-viewtabs" ref={box}>
      <div className="tb-views-measure" ref={measure} aria-hidden>
        {views.map((v) => {
          const I = viewIcon(v.kind);
          return (
            <span key={v.id} className="tb-vtab-m">
              <I size={13} /> {v.name}
            </span>
          );
        })}
      </div>
      <div className="client-tabs tb-views" role="tablist" aria-label="Views" onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => (e.preventDefault(), drop())}>
        {shown.map((v) => {
          const I = viewIcon(v.kind);
          const on = v.id === current;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`${on ? 'on' : ''}${drag === v.id ? ' tab-dragging' : ''}${over?.id === v.id && drag !== v.id ? (over.after ? ' drop-after' : ' drop-before') : ''}`}
              title={on && onMenu ? 'View options' : undefined}
              draggable={canEdit}
              onDragStart={(e) => ((e.dataTransfer.effectAllowed = 'move'), e.dataTransfer.setData('text/plain', v.id), setDrag(v.id))}
              onDragEnd={() => (setDrag(null), setOver(null))}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > r.left + r.width / 2;
                if (over?.id !== v.id || over.after !== after) setOver({ id: v.id, after });
              }}
              onClick={(e) => (on && onMenu ? onMenu(v.id, e.currentTarget) : onSelect(v.id))}
              onContextMenu={(e) => onMenu && (e.preventDefault(), onSelect(v.id), onMenu(v.id, e.currentTarget))}
            >
              <I size={13} /> {v.name}
              {on && onMenu && <ChevronDown size={12} className="tb-vtab-chev" />}
            </button>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <>
          <button ref={moreRef} type="button" className="tb-vmore" onClick={() => setMore(true)} aria-haspopup="menu">
            {hidden.length} more
            <ChevronDown size={13} />
          </button>
          <Popover anchor={moreRef} open={more} onClose={() => setMore(false)} width={240} title="More views">
            <div className="tb-menu">
              {hidden.map((v) => {
                const I = viewIcon(v.kind);
                return (
                  <button key={v.id} type="button" onClick={() => (onSelect(v.id), setMore(false))}>
                    <I size={14} /> {v.name}
                  </button>
                );
              })}
            </div>
          </Popover>
        </>
      )}
      {onAdd && (
        <button type="button" className="tb-add-view icon-btn sm" onClick={(e) => onAdd(e.currentTarget)} title="Add a view" aria-label="Add a view">
          <Plus size={15} />
        </button>
      )}
    </div>
  );
}
