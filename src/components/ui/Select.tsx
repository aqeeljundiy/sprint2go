import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from './Popover';

export interface Option<V extends string = string> {
  value: V;
  label: string;
  hint?: string; // small text on the right or below
  icon?: ReactNode; // avatar, colour dot or icon
  group?: string;
  danger?: boolean;
}

/**
 * Sprint2go's dropdown. Replaces the browser's <select> everywhere:
 * search when there are many options, avatars and colours, keyboard support, bottom sheet on phones.
 */
export function Select<V extends string = string>({
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  label,
  title,
  compact,
  className = '',
  renderValue,
  searchable,
  width = 240,
  disabled,
}: {
  value: V | null | undefined;
  options: Option<V>[];
  onChange: (v: V) => void;
  placeholder?: string;
  label?: string; // aria-label
  title?: string; // sheet title on phones
  compact?: boolean; // icon-only trigger (e.g. an avatar)
  className?: string;
  renderValue?: (o: Option<V> | undefined) => ReactNode;
  searchable?: boolean;
  width?: number;
  disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const current = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > 7;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.hint?.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const pick = (o: Option<V>) => {
    onChange(o.value);
    setOpen(false);
    setQ('');
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[hi]) pick(shown[hi]);
    }
  };

  const openList = () => {
    if (disabled) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen((o) => !o);
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sel ${compact ? 'sel-compact' : ''} ${open ? 'open' : ''} ${current ? '' : 'empty'} ${className}`}
        onClick={openList}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openList();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
      >
        {renderValue ? (
          renderValue(current)
        ) : (
          <>
            {current?.icon}
            {!compact && <span className="sel-text">{current?.label ?? placeholder}</span>}
            {!compact && <ChevronDown size={14} className="sel-chev" />}
          </>
        )}
      </button>
      <Popover anchor={btn} open={open} onClose={() => (setOpen(false), setQ(''))} width={width} title={title ?? label}>
        <div className="sel-pop" onKeyDown={onKey}>
          {showSearch && (
            <label className="sel-search">
              <Search size={14} />
              <input autoFocus value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} placeholder="Search…" />
            </label>
          )}
          <ul role="listbox" tabIndex={-1} ref={(el) => {
              if (!showSearch) el?.focus();
            }} aria-label={label}>
            {shown.length === 0 && <li className="sel-empty">No matches</li>}
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.value} role="presentation">
                  {head && <div className="sel-group">{head}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    className={`sel-opt ${i === hi ? 'hi' : ''} ${o.danger ? 'danger' : ''}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(o)}
                  >
                    {o.icon && <span className="sel-icon">{o.icon}</span>}
                    <span className="sel-label">
                      {o.label}
                      {o.hint && <small>{o.hint}</small>}
                    </span>
                    {o.value === value && <Check size={14} className="sel-check" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Popover>
    </>
  );
}

/** A small coloured dot for options like clients and teams. */
export const Dot = ({ color }: { color: string }) => <span className="sel-dot" style={{ background: color }} />;
