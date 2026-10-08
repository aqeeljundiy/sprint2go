import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Search, X } from 'lucide-react';
import { SmoothHeight } from '../components/ui/Smooth';
import { Popover } from '../components/ui/Popover';
import { Select } from '../components/ui/Select';
import { get, type Perm } from './api';
import { Avatar } from '../components/Avatar';
import { Badge as UiBadge, PersonCell } from '../components/ui/Person';
import { EmptyState } from '../components/ui/EmptyState';
import { Layer } from '../components/ui/Layer';

/* ---------- the backend's shared state ---------- */

export interface Me {
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'support' | 'finance' | 'readonly';
  perms: Perm[];
  supportEmail: string;
}
export interface Ctx {
  me: Me;
  may: (p: Perm) => boolean;
  go: (to: string) => void;
  toast: (text: string, action?: { label: string; run: () => void }) => void;
  signInAs: (userId: string, ticket?: number) => void;
  /** Bumped after changes so lists elsewhere reload (e.g. the ticket count in the nav). */
  tick: number;
  bump: () => void;
}
export const AdminCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAdmin = () => useContext(AdminCtx);

/** Loads one admin endpoint; reloads when `deps` or the shared tick change, and every `poll` ms when asked. */
export function useApi<T>(path: string | null, deps: unknown[] = [], poll?: number) {
  const { tick } = useAdmin();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let on = true;
    get<T>(path).then(
      (d) => on && (setData(d), setError(null)),
      (e: Error) => on && setError(e.message),
    );
    return () => {
      on = false;
    };
  }, [path, tick, n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => document.visibilityState === 'visible' && setN((x) => x + 1), poll);
    return () => clearInterval(t);
  }, [poll]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

/** Runs a change, then toasts and reloads; errors become a toast too. */
export function useAct() {
  const { toast, bump } = useAdmin();
  return async (run: () => Promise<unknown>, done?: string) => {
    try {
      await run();
      if (done) toast(done);
      bump();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    }
  };
}

/* ---------- layout ---------- */

export function Page({ title, sub, actions, children, back, wide }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; back?: { label: string; to: string }; wide?: boolean }) {
  const { go } = useAdmin();
  return (
    <div className={`adm-page ${wide ? 'wide' : ''}`}>
      {back && (
        <button type="button" className="adm-back" onClick={() => go(back.to)}>
          ← {back.label}
        </button>
      )}
      <header className="adm-head">
        <div className="adm-head-text">
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="adm-head-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
export function Section({ title, actions, children, hint }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="adm-section">
      {(title || actions) && (
        <div className="adm-section-head">
          {title && <h2>{title}</h2>}
          {hint && <span className="adm-hint">{hint}</span>}
          {actions && <div className="adm-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
export function Tabs<T extends string>({ value, items, onChange }: { value: T; items: { id: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="client-tabs adm-tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? <span className="adm-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- numbers ---------- */

export function Stats({ children }: { children: ReactNode }) {
  return <div className="adm-stats">{children}</div>;
}
/** A number with what it means: a trend against before, and whether up is good. */
export function Stat({ label, value, hint, delta, onClick, tone, i = 0 }: { label: string; value: ReactNode; hint?: ReactNode; delta?: { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } | null; onClick?: () => void; tone?: 'warn' | 'bad'; i?: number }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`adm-stat ${tone ?? ''} ${onClick ? 'click' : ''}`} onClick={onClick} style={{ ['--i' as string]: i }}>
      <span className="adm-stat-label">{label}</span>
      <b>{value}</b>
      {(delta || hint) && (
        <span className="adm-stat-foot">
          {delta && delta.dir !== 'flat' && (
            <span className={`adm-delta ${delta.good ? 'good' : 'bad'}`}>
              {delta.dir === 'up' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              {delta.text}
            </span>
          )}
          {hint && <span className="adm-stat-hint">{hint}</span>}
        </span>
      )}
    </Tag>
  );
}
export function deltaOf(now: number, before: number | null | undefined, upIsGood = true, fmt: (n: number) => string = (n) => `${n}`) {
  if (before === null || before === undefined) return null;
  const diff = now - before;
  if (!diff) return { text: 'same as before', dir: 'flat' as const, good: true };
  const pct = before ? Math.round((Math.abs(diff) / before) * 100) : null;
  return { text: pct !== null && pct < 1000 ? `${pct}%` : fmt(Math.abs(diff)), dir: diff > 0 ? ('up' as const) : ('down' as const), good: diff > 0 === upIsGood };
}

/* ---------- small parts ---------- */

/** The app's own pill (components/ui/Person.tsx): the console and the app share one look. */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'info'; children: ReactNode }) {
  return <UiBadge tone={tone}>{children}</UiBadge>;
}
export function HealthPill({ h }: { h: { score: number; label: string } }) {
  return (
    <span className={`adm-health ${h.label}`} title={`Health ${h.score} of 100`}>
      <span className="adm-health-track">
        <i style={{ width: `${Math.max(6, h.score)}%` }} />
      </span>
      <em>{h.score}</em>
    </span>
  );
}
export function Dot({ color }: { color: string }) {
  return <i className="adm-dot" style={{ background: color }} />;
}
/** A face for someone with no photo here: the app's avatar, in their colour. */
export function Initials({ name, color, size = 28, email }: { name: string; color?: string | null; size?: number; email?: string }) {
  return <Avatar person={{ name, email: email ?? name, color: color || undefined }} size={size} />;
}
/** Someone in a table: the app's person cell (avatar centred on name and email, badges as pills on the name's line). */
export function Who({ name, email, color, badges, sub }: { name: string; email?: string; color?: string | null; badges?: ReactNode; sub?: ReactNode | null }) {
  return <PersonCell person={{ name, email, color }} badges={badges} sub={sub} />;
}
/** An empty list: the app's empty state (title, a line on what to do, the action). */
export function Empty({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return <EmptyState className="adm-empty-state" icon={icon} title={title} text={text} action={action} />;
}
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="adm-skel" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ ['--i' as string]: i }} />
      ))}
    </div>
  );
}
export function Failed({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Empty
      title="Couldn’t load this"
      text={error}
      action={
        retry && (
          <button className="ghost-btn sm" onClick={retry}>
            Try again
          </button>
        )
      }
    />
  );
}
export function CopyBtn({ text, label = 'Copy', iconOnly }: { text: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={iconOnly ? 'icon-btn sm' : 'ghost-btn sm'}
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {!iconOnly && (done ? ' Copied' : ` ${label}`)}
    </button>
  );
}
export function KV({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="adm-kv">
      {items.map((x, i) => (
        <div key={i}>
          <dt>{x.k}</dt>
          <dd>{x.v}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`adm-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Switch({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="adm-switch-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  );
}

/** A small menu next to a button (more actions). Becomes a bottom sheet on phones. */
export function Menu({ label, items, icon, align = 'end' }: { label: ReactNode; icon?: ReactNode; align?: 'start' | 'end'; items: ({ label: string; run: () => void; danger?: boolean; hint?: string } | null | false)[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const list = items.filter(Boolean) as { label: string; run: () => void; danger?: boolean; hint?: string }[];
  if (!list.length) return null;
  return (
    <>
      <button ref={ref} type="button" className="ghost-btn sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {icon}
        {label}
        <ChevronDown size={13} className={`rot-chev ${open ? 'open' : ''}`} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240} align={align} title={typeof label === 'string' ? label : 'Actions'}>
        <div className="adm-menu" role="menu">
          {list.map((x) => (
            <button
              key={x.label}
              type="button"
              role="menuitem"
              className={x.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                x.run();
              }}
            >
              <span>{x.label}</span>
              {x.hint && <small>{x.hint}</small>}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** A rupiah amount shown with thousands dots (2.499.000), typed as plain digits. */
export function MoneyInput({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; label?: string }) {
  return (
    <input
      className="adm-money"
      inputMode="numeric"
      value={value ? value.toLocaleString('id-ID') : '0'}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  );
}

/* ---------- dialogs ---------- */

export function Dialog({ title, onClose, children, foot, size = 'md' }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <Layer>
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className={`modal adm-modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="dump-title">{title}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>{children}</SmoothHeight>
        </div>
        {foot && <footer className="modal-foot">{foot}</footer>}
      </div>
    </div>
    </Layer>
  );
}

export const WHY = [
  { value: 'unpaid', label: 'Didn’t pay' },
  { value: 'price', label: 'Too expensive' },
  { value: 'features', label: 'Missing features' },
  { value: 'competitor', label: 'Moved to another tool' },
  { value: 'closed', label: 'Business closed' },
  { value: 'abuse', label: 'Abuse or spam' },
  { value: 'test', label: 'Test or duplicate' },
  { value: 'other', label: 'Something else' },
];

/** Asks before something that matters: a reason (with why, for churn), or a typed word for what can't be undone. */
export function Confirm({ title, text, action, danger, word, reason, why, onClose, onConfirm }: { title: string; text: ReactNode; action: string; danger?: boolean; word?: string; reason?: string; why?: boolean; onClose: () => void; onConfirm: (v: { reason: string; why: string }) => Promise<unknown> }) {
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [w, setW] = useState(why ? '' : 'other');
  const [busy, setBusy] = useState(false);
  const ok = (!word || typed === word) && (!why || !!w);
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? 'primary-btn danger-btn' : 'primary-btn'}
            disabled={busy || !ok}
            onClick={() => {
              setBusy(true);
              void onConfirm({ reason: note, why: w }).finally(() => setBusy(false));
            }}
          >
            {action}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-dialog-text">{text}</p>
        {why && (
          <Field label="Why">
            <Select value={w || null} placeholder="Pick a reason" options={WHY} onChange={setW} label="Why" />
          </Field>
        )}
        {reason !== undefined && (
          <Field label={reason}>
            <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus={!word && !why} />
          </Field>
        )}
        {word && (
          <Field label={`Type ${word} to confirm`}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/* ---------- the table every list uses ---------- */

export interface Col<T> {
  key: string;
  label: string;
  render: (r: T) => ReactNode;
  sort?: (r: T) => string | number;
  width?: string; // a grid column, e.g. '2fr' or '120px'
  align?: 'right';
  hide?: 'phone' | 'tablet'; // gone below this width
}
export interface View<T> {
  id: string;
  label: string;
  test: (r: T) => boolean;
}

/**
 * Sortable list with views (filters with counts), search, row selection and bulk actions. The chosen view and sort are
 * remembered per operator on this device.
 */
export function Table<T>({ id, rows, cols, rowKey, onOpen, views, search, bulk, empty, initialSort, dense, rowTone }: { id: string; rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; onOpen?: (r: T) => void; views?: View<T>[]; search?: (r: T) => string; bulk?: (sel: T[], clear: () => void) => ReactNode; empty?: { title: string; text?: string }; initialSort?: { key: string; dir: 1 | -1 }; dense?: boolean; rowTone?: (r: T) => string | undefined }) {
  const store = `s2g-admin-table:${id}`;
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(store) ?? 'null') as { view?: string; sort?: { key: string; dir: 1 | -1 } } | null;
    } catch {
      return null;
    }
  }, [store]);
  // The view picked last time; otherwise the first one with something in it.
  const [view, setView] = useState(saved?.view && views?.some((v) => v.id === saved.view) ? saved.view : (views?.find((v) => rows.some(v.test)) ?? views?.[0])?.id ?? '');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(saved?.sort ?? initialSort ?? null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      localStorage.setItem(store, JSON.stringify({ view, sort }));
    } catch {
      /* private mode */
    }
  }, [store, view, sort]);
  const v = views?.find((x) => x.id === view);
  const counted = views?.map((x) => ({ ...x, n: rows.filter(x.test).length }));
  let shown = v ? rows.filter(v.test) : rows;
  if (q && search) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    shown = shown.filter((r) => words.every((w) => search(r).toLowerCase().includes(w)));
  }
  if (sort) {
    const c = cols.find((x) => x.key === sort.key);
    if (c?.sort) shown = [...shown].sort((a, b) => {
      const x = c.sort!(a), y = c.sort!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }
  const selected = shown.filter((r) => sel.has(rowKey(r)));
  const template = [bulk ? '36px' : null, ...cols.map((c) => c.width ?? '1fr')].filter(Boolean).join(' ');
  // Narrower panes drop the columns marked hide: 'tablet', so the grid keeps lining up.
  const templateT = [bulk ? '36px' : null, ...cols.filter((c) => c.hide !== 'tablet').map((c) => c.width ?? '1fr')].filter(Boolean).join(' ');
  const allOn = shown.length > 0 && selected.length === shown.length;
  return (
    <div className="adm-table-wrap">
      {(views || search) && (
        <div className="adm-table-bar">
          {counted && (
            <div className="segmented sm adm-views">
              {counted.map((x) => (
                <button key={x.id} type="button" className={view === x.id ? 'on' : ''} onClick={() => (setView(x.id), setSel(new Set()))}>
                  {x.label}
                  <span className="adm-count">{x.n}</span>
                </button>
              ))}
            </div>
          )}
          {search && (
            <label className="adm-search">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter" />
              {q && (
                <button type="button" className="icon-btn xs" onClick={() => setQ('')} aria-label="Clear">
                  <X size={12} />
                </button>
              )}
            </label>
          )}
        </div>
      )}
      <SmoothHeight>
        {bulk && selected.length > 0 && (
          <div className="adm-bulk">
            <strong>{selected.length} selected</strong>
            {bulk(selected, () => setSel(new Set()))}
            <button type="button" className="link-btn small" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </div>
        )}
      </SmoothHeight>
      {shown.length === 0 ? (
        <Empty title={q ? 'Nothing matches' : empty?.title ?? 'Nothing here'} text={q ? 'Try fewer words.' : empty?.text} />
      ) : (
        <div className={`adm-table ${dense ? 'dense' : ''}`} role="table" style={{ ['--cols' as string]: template, ['--cols-t' as string]: templateT }}>
          <div className="adm-tr head" role="row">
            {bulk && (
              <label className="adm-check">
                <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(rowKey)))} />
              </label>
            )}
            {cols.map((c) => (
              <span key={c.key} role="columnheader" className={`${c.align === 'right' ? 'r' : ''} ${c.hide ? `hide-${c.hide}` : ''}`}>
                {c.sort ? (
                  <button type="button" className={`adm-sort ${sort?.key === c.key ? 'on' : ''}`} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: -1 }))}>
                    {c.label}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                ) : (
                  c.label
                )}
              </span>
            ))}
          </div>
          {shown.map((r, i) => {
            const k = rowKey(r);
            return (
              <div key={k} role="row" className={`adm-tr ${onOpen ? 'click' : ''} ${sel.has(k) ? 'sel' : ''} ${rowTone?.(r) ?? ''}`} style={{ ['--i' as string]: Math.min(i, 12) }} onClick={(e) => onOpen && !(e.target as HTMLElement).closest('button, a, input, .adm-check') && onOpen(r)} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => onOpen && e.key === 'Enter' && onOpen(r)}>
                {bulk && (
                  <label className="adm-check">
                    <input type="checkbox" aria-label="Select" checked={sel.has(k)} onChange={() => setSel((s) => {
                      const n = new Set(s);
                      n.has(k) ? n.delete(k) : n.add(k);
                      return n;
                    })} />
                  </label>
                )}
                {cols.map((c, ci) => (
                  <span key={c.key} role="cell" className={`${ci === 0 ? 'first' : ''} ${c.align === 'right' ? 'r' : ''} ${c.hide ? `hide-${c.hide}` : ''}`} data-label={c.label}>
                    {c.render(r)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- charts (plain bars, no library) ---------- */

export function Bars({ data, height = 120, fmt = (n: number) => String(n) }: { data: { label: string; parts: { value: number; tone: 'accent' | 'good' | 'warn' | 'bad' | 'muted'; name: string }[] }[]; height?: number; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.parts.reduce((n, p) => n + Math.max(0, p.value), 0)));
  return (
    <div className="adm-bars" style={{ ['--h' as string]: `${height}px` }}>
      {data.map((d) => {
        const total = d.parts.reduce((n, p) => n + Math.max(0, p.value), 0);
        return (
          <div key={d.label} className="adm-bar-col" title={`${d.label}: ${d.parts.map((p) => `${p.name} ${fmt(p.value)}`).join(', ')}`}>
            <div className="adm-bar-stack">
              {d.parts.map((p) => (
                <span key={p.name} className={p.tone} style={{ height: `${(Math.max(0, p.value) / max) * 100}%` }} />
              ))}
            </div>
            <small>{d.label}</small>
            <em>{total ? fmt(total) : ''}</em>
          </div>
        );
      })}
    </div>
  );
}
export function Legend({ items }: { items: { tone: string; name: string }[] }) {
  return (
    <div className="adm-legend">
      {items.map((i) => (
        <span key={i.name}>
          <i className={i.tone} /> {i.name}
        </span>
      ))}
    </div>
  );
}
