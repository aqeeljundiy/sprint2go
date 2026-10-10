import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Minus } from 'lucide-react';
import { PushScreen } from '../components/ui/PushScreen';
import { useLongPress } from '../components/ui/useLongPress';
import { AppTile, type LauncherApp } from './Launcher';
import { normalize, type AppOrder } from './launcherApps';
import { t } from '../i18n';

const COLS = 4;
const CELL_H = 104; // a tile (60), its name, the gaps between rows

/**
 * The launcher's grid to arrange (Teams' Reorder, iOS's jiggle without the jiggle): hold an app and drag it to move
 * it, the others slide out of the way; "−" hides it (Settings can't be hidden). With a mouse, drag straight away;
 * Alt and the arrow keys move the focused app. Used by Edit apps (each person) and by Apps on phones (admins).
 */
export function AppsGrid({ apps, value, onChange }: { apps: LauncherApp[]; value: AppOrder; onChange: (o: AppOrder) => void }) {
  const byId = new Map(apps.map((a) => [a.id as string, a]));
  const shownIds = normalize(value).order.filter((id) => byId.has(id) && !value.hidden.includes(id));
  const [items, setItemsState] = useState(shownIds);
  const itemsRef = useRef(items);
  const setItems = (l: string[]) => ((itemsRef.current = l), setItemsState(l));
  const key = shownIds.join(',');
  const dragging = useRef<{ id: string; from: number; x0: number; y0: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!dragging.current) setItems(key ? key.split(',') : []);
  }, [key]);
  const grid = useRef<HTMLDivElement>(null);
  const cellW = () => (grid.current?.clientWidth ?? 358) / COLS;
  const pos = (i: number) => ({ x: (i % COLS) * cellW(), y: Math.floor(i / COLS) * CELL_H });

  const commit = (list: string[]) => {
    const rest = normalize(value).order.filter((id) => !list.includes(id));
    onChange({ order: [...list, ...rest], hidden: value.hidden });
  };
  const start = (id: string) => {
    const from = itemsRef.current.indexOf(id);
    const p = pos(from);
    dragging.current = { id, from, x0: p.x, y0: p.y };
    setDrag({ id, x: p.x, y: p.y });
  };
  const moveBy = (dx: number, dy: number) => {
    const d = dragging.current;
    if (!d) return;
    const n = itemsRef.current.length;
    const x = Math.max(0, Math.min((COLS - 1) * cellW(), d.x0 + dx));
    const y = Math.max(0, Math.min(Math.floor((n - 1) / COLS) * CELL_H, d.y0 + dy));
    const at = Math.min(n - 1, Math.round(y / CELL_H) * COLS + Math.round(x / cellW()));
    if (at !== itemsRef.current.indexOf(d.id)) {
      const l = itemsRef.current.filter((x) => x !== d.id);
      l.splice(at, 0, d.id);
      setItems(l);
    }
    setDrag({ id: d.id, x, y });
  };
  const end = () => {
    const d = dragging.current;
    dragging.current = null;
    setDrag(null);
    if (d) commit(itemsRef.current);
  };
  const keyMove = (id: string, by: number) => {
    const l = itemsRef.current.filter((x) => x !== id);
    l.splice(Math.max(0, Math.min(l.length, itemsRef.current.indexOf(id) + by)), 0, id);
    setItems(l);
    commit(l);
  };
  const hide = (id: string) => onChange({ order: normalize(value).order, hidden: [...value.hidden, id] });
  const rows = Math.max(1, Math.ceil(items.length / COLS));
  return (
    <div className="ea-well">
      <div className="ea-grid" ref={grid} role="list" style={{ height: rows * CELL_H } as CSSProperties}>
        {items.map((id, i) => {
          const a = byId.get(id)!;
          const p = drag?.id === id ? { x: drag.x, y: drag.y } : pos(i);
          return <EditTile key={id} app={a} x={p.x} y={p.y} lifted={drag?.id === id} onStart={() => start(id)} onMove={moveBy} onEnd={end} onHide={id === 'settings' ? undefined : () => hide(id)} onKey={(by) => keyMove(id, by)} />;
        })}
      </div>
    </div>
  );
}

function EditTile({ app, x, y, lifted, onStart, onMove, onEnd, onHide, onKey }: { app: LauncherApp; x: number; y: number; lifted: boolean; onStart: () => void; onMove: (dx: number, dy: number) => void; onEnd: () => void; onHide?: () => void; onKey: (by: number) => void }) {
  const press = useLongPress(onStart, { mouse: true, onDrag: (p) => onMove(p.dx, p.dy), onDragEnd: onEnd });
  return (
    <div
      className={`ea-cell${lifted ? ' lifted' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      role="listitem"
      tabIndex={0}
      aria-label={t('{app}. Alt and arrow keys move it.', { app: app.name })}
      onKeyDown={(e) => {
        if (!e.altKey) return;
        const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -COLS : e.key === 'ArrowDown' ? COLS : 0;
        if (!by) return;
        e.preventDefault();
        onKey(by);
      }}
    >
      <AppTile app={{ ...app, badge: undefined, live: undefined }} press={press} />
      {onHide && (
        <button type="button" className="ea-hide" onClick={onHide} aria-label={t('Hide {app}', { app: app.name })}>
          <Minus size={16} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/** The hidden apps under the grid, each with Show. */
export function HiddenApps({ apps, value, onChange }: { apps: LauncherApp[]; value: AppOrder; onChange: (o: AppOrder) => void }) {
  const hidden = apps.filter((a) => value.hidden.includes(a.id));
  return (
    <section className="ea-sec">
      <h2 className="ea-h">{t('Hidden')}</h2>
      {hidden.length ? (
        <div className="ea-card">
          {hidden.map((a) => (
            <div key={a.id} className="ea-row" data-app={a.id}>
              <span className="ea-row-icon">
                <a.icon size={20} />
              </span>
              <span className="ea-row-name">{a.name}</span>
              <button type="button" className="link-btn" onClick={() => onChange({ order: normalize(value).order, hidden: value.hidden.filter((x) => x !== a.id) })}>
                {t('Show')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="ea-note">{t('Nothing hidden. Tap − on an app to hide it; it stays one search away.')}</p>
      )}
    </section>
  );
}

/**
 * Edit apps (phones): the person's own order of the launcher, full screen. From "Edit" on the launcher, a tile's
 * long-press, or Settings, You, Edit apps. Their own order until they go back to the company's.
 */
export function EditApps({ apps, value, own, onChange, onReset, onDone }: { apps: LauncherApp[]; value: AppOrder; own: boolean; onChange: (o: AppOrder) => void; onReset: () => void; onDone: () => void }) {
  return (
    <PushScreen
      title={t('Edit apps')}
      onBack={onDone}
      className="edit-apps"
      actions={
        <button type="button" className="link-btn ea-done" onClick={onDone}>
          {t('Done')}
        </button>
      }
    >
      <div className="ea-body">
        <p className="ea-lede">{t('Hold an app and drag it to move it. Tap − to hide it from your launcher; it stays one search away.')}</p>
        <section className="ea-sec">
          <h2 className="ea-h">{t('On your launcher')}</h2>
          <AppsGrid apps={apps} value={value} onChange={onChange} />
        </section>
        <HiddenApps apps={apps} value={value} onChange={onChange} />
        <p className="ea-foot">
          {own ? (
            <>
              {t('This is your own order.')}{' '}
              <button type="button" className="link-btn" onClick={onReset}>
                {t('Use the company’s order')}
              </button>
            </>
          ) : (
            t('This is the company’s order. Changing it makes it your own.')
          )}
        </p>
      </div>
    </PushScreen>
  );
}
