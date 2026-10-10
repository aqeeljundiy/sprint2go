import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { Popover } from './Popover';
import { Sheet } from './Sheet';
import { useLongPress } from './useLongPress';
import { isPhone } from '../../mobile/media';

export interface SheetAction {
  id?: string;
  label: string;
  icon?: LucideIcon;
  hint?: string; // a second line ("Tomorrow, 09:00")
  danger?: boolean; // red, and kept last
  disabled?: boolean;
  checked?: boolean; // a tick on the right (Mute: on)
  group?: string; // actions with the same group sit together; a new group starts after a divider
  run: () => void;
}

/** A point on screen standing in for a button: where a right-click or long-press happened. */
function pointAnchor(x: number, y: number): RefObject<HTMLElement> {
  const at = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0), closest: () => null, contains: () => false };
  return { current: at as unknown as HTMLElement };
}

/**
 * One list of actions, shown the right way for the device: a bottom sheet on phones (long-press), a menu next to the
 * button or the pointer on desktop (the "…" button, right-click). Pass `anchor` (the "…" button) or `at` (a point).
 * Usually made by `useActionMenu`, which wires long-press and right-click to it.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
  anchor,
  at,
  header,
  width = 240,
  className,
  menu = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: SheetAction[];
  anchor?: RefObject<HTMLElement | null>;
  at?: { x: number; y: number } | null;
  header?: ReactNode; // above the list (a row of reactions, a preview)
  width?: number;
  className?: string; // on the phone's sheet (a kind of question the page can make room for)
  menu?: boolean; // opened from a button on a phone: a dropdown by the button instead of a sheet (Gmail's overflow menu)
}) {
  const point = useMemo(() => (at ? pointAnchor(at.x, at.y) : null), [at]);
  if (!open) return null;
  const list = (
    <div className="as-list" role="menu" aria-label={title}>
      {actions.map((a, i) => {
        const Icon = a.icon;
        const divide = i > 0 && (a.group ?? '') !== (actions[i - 1].group ?? '');
        return (
          <div key={a.id ?? a.label} role="none">
            {divide && <div className="as-sep" role="separator" />}
            <button type="button" role="menuitem" className={`as-item${a.danger ? ' danger' : ''}`} disabled={a.disabled} onClick={() => (onClose(), a.run())}>
              {Icon && <Icon size={18} className="as-icon" />}
              <span className="as-label">
                {a.label}
                {a.hint && <small>{a.hint}</small>}
              </span>
              {a.checked && <Check size={16} className="as-check" />}
            </button>
          </div>
        );
      })}
    </div>
  );
  if ((isPhone() && !(menu && anchor)) || (!anchor && !point))
    return (
      <Sheet onClose={onClose} title={title} className={`action-sheet${className ? ` ${className}` : ''}`}>
        {header}
        {list}
      </Sheet>
    );
  return (
    <Popover anchor={(anchor ?? point)!} open onClose={onClose} width={width} title={title} menu={menu} align={menu && isPhone() ? 'end' : 'start'}>
      {header}
      {list}
    </Popover>
  );
}

/**
 * Long-press on phones and right-click on desktop open the same actions. Spread `bind` on the row (and give it the `lp`
 * class), put `menu` anywhere in the tree, and call `openFrom(button)` from a "…" button.
 *
 *   const m = useActionMenu(() => [{ label: 'Pin', icon: Pin, run: pin }, …], { title: note.title });
 *   <div className="note-row lp" {...m.bind}>…<button ref={more} onClick={() => m.openFrom(more)}>…</button></div>
 *   {m.menu}
 */
export function useActionMenu(actions: SheetAction[] | (() => SheetAction[]), opts: { title?: string; header?: ReactNode; disabled?: boolean; menu?: boolean } = {}) {
  const [state, setState] = useState<{ at?: { x: number; y: number }; anchor?: RefObject<HTMLElement | null> } | null>(null);
  const list = useRef(actions);
  list.current = actions;
  const press = useLongPress((p) => setState({ at: { x: p.x, y: p.y } }), { disabled: opts.disabled });
  const resolved = state ? (typeof list.current === 'function' ? list.current() : list.current) : [];
  return {
    open: !!state,
    close: () => setState(null),
    openAt: (x: number, y: number) => setState({ at: { x, y } }),
    openFrom: (anchor: RefObject<HTMLElement | null>) => setState({ anchor }),
    bind: {
      ...press,
      onContextMenu: (e: React.MouseEvent) => {
        press.onContextMenu(e);
        if (opts.disabled || e.defaultPrevented) return;
        e.preventDefault();
        setState({ at: { x: e.clientX, y: e.clientY } });
      },
    },
    menu: <ActionSheet open={!!state} onClose={() => setState(null)} title={opts.title} header={opts.header} actions={resolved} anchor={state?.anchor} at={state?.at ?? null} menu={opts.menu} />,
  };
}
