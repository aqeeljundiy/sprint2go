import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from './Popover';
import type { Option } from './Select';

/** "Indonesia", "Indonesia and Singapore", "Indonesia and 2 more". */
export function summaryOf(labels: string[], none: string) {
  if (!labels.length) return none;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]} and ${labels.length - 1} more`;
}

/**
 * sprint2go's own multi-select: the same list as Select (search when there are many, groups, hints, a bottom sheet on
 * phones), where a tap ticks or unticks a choice and the list stays open. `trigger` draws the button's inside (a nav
 * row, say); by default it's a plain field with what's chosen.
 */
export function MultiSelect<V extends string = string>({
  values,
  options,
  onChange,
  label,
  title,
  none = 'None',
  searchable,
  width = 260,
  className = '',
  trigger,
  footer,
}: {
  values: V[];
  options: Option<V>[];
  onChange: (values: V[]) => void;
  label: string; // aria-label, and the sheet's title on phones
  title?: string;
  none?: string; // what the button says with nothing chosen
  searchable?: boolean;
  width?: number;
  className?: string;
  trigger?: (summary: string, open: boolean) => ReactNode;
  footer?: ReactNode; // a line under the list (what the choice does)
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const showSearch = searchable ?? options.length > 7;
  const chosen = new Set(values);
  const summary = summaryOf(
    options.filter((o) => chosen.has(o.value)).map((o) => o.label),
    none,
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => s.split(/\s+/).every((w) => `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(w))) : options;
  }, [options, q]);
  // Focus goes into the list (or its search) once the popover is placed (it's hidden while it measures).
  useEffect(() => {
    if (!open) return;
    const f = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(showSearch ? '.sel-search input' : '[role="listbox"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(f);
  }, [open, showSearch]);

  // Keeps the options' own order, whatever order they were ticked in.
  const toggle = (v: V) => onChange(options.map((o) => o.value).filter((x) => (x === v ? !chosen.has(v) : chosen.has(x))));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, shown.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
    else if (e.key === 'Enter' && shown[hi]) (e.preventDefault(), toggle(shown[hi].value));
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={trigger ? className : `sel ms-trigger ${open ? 'open' : ''} ${values.length ? '' : 'empty'} ${className}`}
        onClick={() => (setHi(0), setOpen((o) => !o))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        {trigger ? (
          trigger(summary, open)
        ) : (
          <>
            <span className="sel-text">{summary}</span>
            <ChevronDown size={14} className="sel-chev" />
          </>
        )}
      </button>
      <Popover anchor={btn} open={open} onClose={() => (setOpen(false), setQ(''))} width={width} title={title ?? label}>
        <div className="sel-pop ms-pop" ref={pop} onKeyDown={onKey}>
          {showSearch && (
            <label className="sel-search">
              <Search size={14} />
              <input value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} placeholder="Search…" />
            </label>
          )}
          <ul role="listbox" aria-multiselectable="true" tabIndex={-1} aria-label={label}>
            {shown.length === 0 && <li className="sel-empty">No matches</li>}
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const on = chosen.has(o.value);
              return (
                <li key={o.value} role="presentation">
                  {head && <div className="sel-group">{head}</div>}
                  <button type="button" role="option" aria-selected={on} className={`sel-opt ms-opt ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => toggle(o.value)}>
                    <span className={`ms-box ${on ? 'on' : ''}`} aria-hidden="true">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    <span className="sel-label">
                      {o.label}
                      {o.hint && <small>{o.hint}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {footer && <p className="ms-foot">{footer}</p>}
        </div>
      </Popover>
    </>
  );
}
