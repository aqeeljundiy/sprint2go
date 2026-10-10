// Mail's labels in the app: the "Label as" picker (search, ticks, a dash for "some of them", Create new), the label
// editor (name, nest under, colour, which mailbox), the sidebar's and the phone drawer's Labels, and the chips on an
// email. What a label is and who may change it: src/mailFilterMatch.ts and server/mailFilters.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, ChevronRight, Minus, MoreHorizontal, Plus, Search, Tag, X } from 'lucide-react';
import type { Account, Thread, View } from '../../types';
import { LABEL_COLORS, labelPath, labelTree, subtree, type MailLabel } from '../../mailFilterMatch';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { PushScreen } from '../ui/PushScreen';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { usePhone } from '../../mobile/media';
import { t } from '../../i18n';
import './organize.css';

/** Ticked, not ticked, or ticked on some of the chosen emails. */
type Mark = 'on' | 'off' | 'some';

/** The picker's tick: a box with a tick, a dash, or nothing. */
function Tick({ mark, color }: { mark: Mark; color?: string }) {
  return (
    <span className={`ml-tick ${mark}`} style={color ? { ['--ml' as string]: color } : undefined} aria-hidden>
      {mark === 'on' ? <Check size={14} strokeWidth={3} /> : mark === 'some' ? <Minus size={14} strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * "Label as": the labels these emails can have, ticked where they all have it and a dash where some do. Typing
 * searches; a name nobody has yet offers "Create". Apply saves the change for all of them at once.
 */
export function LabelPicker(p: {
  threads: Thread[];
  labels: MailLabel[]; // the labels these emails' mailboxes have
  all: MailLabel[];
  anchor?: RefObject<HTMLElement | null>;
  onApply: (add: string[], remove: string[]) => void;
  onCreate: (name: string) => MailLabel | null; // a new label, made right away (null: not allowed)
  onClose: () => void;
}) {
  const phone = usePhone();
  const [q, setQ] = useState('');
  const start = useMemo(() => {
    const m: Record<string, Mark> = {};
    for (const l of p.labels) {
      const n = p.threads.filter((th) => th.labels.includes(l.id)).length;
      m[l.id] = n === 0 ? 'off' : n === p.threads.length ? 'on' : 'some';
    }
    return m;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [marks, setMarks] = useState<Record<string, Mark>>(start);
  const [made, setMade] = useState<MailLabel[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // The popover is hidden while it measures, and a hidden field can't take focus: focus a frame or two later.
  useEffect(() => {
    if (phone) return;
    let f = requestAnimationFrame(() => (f = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))));
    return () => cancelAnimationFrame(f);
  }, [phone]);
  const pool = [...p.labels, ...made.filter((m) => !p.labels.some((l) => l.id === m.id))];
  const tree = labelTree(pool, [...p.all, ...made]);
  const words = q.trim().toLowerCase();
  const shown = words ? tree.filter((x) => x.path.toLowerCase().includes(words)) : tree;
  const exact = tree.some((x) => x.path.toLowerCase() === words || x.label.name.toLowerCase() === words);
  const flip = (id: string) => setMarks((m) => ({ ...m, [id]: m[id] === 'on' ? 'off' : 'on' }));
  const changed = Object.entries(marks).filter(([id, v]) => v !== (start[id] ?? 'off') && v !== 'some');
  const apply = () => {
    p.onApply(
      changed.filter(([, v]) => v === 'on').map(([id]) => id),
      changed.filter(([, v]) => v === 'off').map(([id]) => id),
    );
    p.onClose();
  };
  const create = () => {
    const l = p.onCreate(q.trim());
    if (!l) return;
    setMade((m) => [...m, l]);
    setMarks((m) => ({ ...m, [l.id]: 'on' }));
    setQ('');
  };
  const body = (
    <div className="ml-pick">
      <label className={phone ? 'sheet-search ml-search' : 'ml-search'}>
        <Search size={16} aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Find or make a label')}
          aria-label={t('Find or make a label')}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (words && !exact) create();
            else if (shown.length === 1 && words) flip(shown[0].label.id);
            else if (changed.length) apply();
          }}
        />
      </label>
      <div className="ml-list" role="listbox" aria-multiselectable="true" aria-label={t('Labels')}>
        {shown.map(({ label: l, depth, path }) => (
          <button key={l.id} type="button" role="option" aria-selected={marks[l.id] === 'on'} className="ml-row" style={{ ['--depth' as string]: words ? 0 : depth }} onClick={() => flip(l.id)} title={path}>
            <Tick mark={marks[l.id] ?? 'off'} color={l.color} />
            <span className="ml-name">{words ? path : l.name}</span>
          </button>
        ))}
        {words && !exact && (
          <button type="button" className="ml-row ml-create" onClick={create}>
            <Plus size={16} aria-hidden />
            <span className="ml-name">{t('Create “{name}”', { name: q.trim() })}</span>
          </button>
        )}
        {!words && !tree.length && <p className="ml-empty">{t('No labels yet. Type a name to make one.')}</p>}
      </div>
      {!phone && (
        <div className="ml-foot">
          <button type="button" className="primary-btn sm" disabled={!changed.length} onClick={apply}>
            {t('Apply')}
          </button>
        </div>
      )}
    </div>
  );
  if (phone)
    return (
      <Sheet
        onClose={p.onClose}
        title={t('Label as')}
        size="tall"
        footer={
          <button type="button" className="primary-btn" disabled={!changed.length} onClick={apply}>
            {t('Apply')}
          </button>
        }
      >
        {body}
      </Sheet>
    );
  return (
    <Popover anchor={p.anchor ?? { current: null }} open onClose={p.onClose} width={300} title={t('Label as')}>
      {body}
    </Popover>
  );
}

/** Where a new label can live: the person's mailboxes, and (for admins) every mailbox at once. */
export type LabelHome = { value: string; label: string }; // value: an account id, or 'company'

/**
 * A new label or changes to one: its name, what it's nested under, its colour, and (new ones) which mailbox has it.
 * A dialog on desktop, a pushed screen on phones with Save in the bar.
 */
export function LabelEditor(p: {
  label?: MailLabel; // editing this one
  parentId?: string | null; // a new sub-label of this one
  homes: LabelHome[];
  home?: string; // where a new one goes first
  all: MailLabel[]; // every label the person sees (for "Nest under")
  workspaceId: string;
  me: string;
  onSave: (l: MailLabel) => string | null; // why it couldn't be saved, or null
  onClose: () => void;
}) {
  const phone = usePhone();
  const editing = p.label;
  const parent0 = editing?.parentId ?? p.parentId ?? null;
  const parentLabel = parent0 ? p.all.find((l) => l.id === parent0) : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [home, setHome] = useState<string>(editing ? editing.accountId ?? 'company' : parentLabel ? parentLabel.accountId ?? 'company' : p.home ?? p.homes[0]?.value ?? 'company');
  const [parentId, setParentId] = useState<string>(parent0 ?? '');
  const [color, setColor] = useState(editing?.color ?? parentLabel?.color ?? LABEL_COLORS[8]);
  const [error, setError] = useState('');
  const accountId = home === 'company' ? null : home;
  // Nest under a label of the same mailbox, never under itself or what's inside it.
  const no = new Set(editing ? subtree(editing.id, p.all) : []);
  const same = p.all.filter((l) => l.workspaceId === p.workspaceId && (l.accountId ?? null) === accountId && !no.has(l.id));
  const options = [{ value: '', label: t('Nothing (a top label)') }, ...labelTree(same, p.all).map((x) => ({ value: x.label.id, label: x.path, icon: <span className="ml-dot" style={{ background: x.label.color }} /> }))];
  const save = () => {
    const clean = name.trim();
    if (!clean) return setError(t('Give the label a name.'));
    if (clean.includes('/')) return setError(t('Use “Nest under” for a label inside another, not a slash.'));
    const l: MailLabel = {
      ...(editing ?? { id: `ml-${Math.random().toString(36).slice(2, 10)}`, workspaceId: p.workspaceId, show: 'show' as const, order: Date.now(), createdBy: p.me, createdAt: new Date().toISOString() }),
      accountId: editing ? editing.accountId : accountId,
      name: clean,
      parentId: parentId || null,
      color,
    };
    const why = p.onSave(l);
    if (why) setError(why);
    else p.onClose();
  };
  const fields = (
    <SmoothHeight>
      <div className="field">
        <label htmlFor="ml-name">{t('Name')}</label>
        <input id="ml-name" autoFocus={!phone} value={name} maxLength={80} onChange={(e) => (setName(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder={t('e.g. Invoices')} />
        {error && <small className="ml-error">{error}</small>}
      </div>
      {!editing && p.homes.length > 1 && (
        <div className="field">
          <label>{t('Which mailbox has it')}</label>
          <Select value={home} options={p.homes} onChange={(v) => (setHome(v), setParentId(''))} title={t('Which mailbox has it')} />
          <small>{home === 'company' ? t('Every mailbox in the company has it. Only admins change it.') : t('Everyone who opens this mailbox sees it.')}</small>
        </div>
      )}
      <div className="field">
        <label>{t('Nest under')}</label>
        <Select value={parentId} options={options} onChange={setParentId} title={t('Nest under')} searchable={options.length > 8} />
      </div>
      <div className="field">
        <label>{t('Colour')}</label>
        <div className="accent-row ml-colors" role="radiogroup" aria-label={t('Colour')}>
          {LABEL_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} className={`accent-swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      </div>
    </SmoothHeight>
  );
  const title = editing ? t('Edit label') : parentLabel ? t('New label in {name}', { name: parentLabel.name }) : t('New label');
  if (phone)
    return (
      <PushScreen
        title={title}
        onBack={p.onClose}
        cancel
        className="g-page g-edit ml-screen"
        actions={
          <button type="button" className="g-save" onClick={save}>
            {t('Save')}
          </button>
        }
      >
        <div className="ml-screen-body">{fields}</div>
      </PushScreen>
    );
  return (
    <div className="modal-scrim" onMouseDown={p.onClose}>
      <div className="modal ml-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose()}>
        <header className="modal-head">
          <span>{title}</span>
          <button className="icon-btn sm" onClick={p.onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">{fields}</div>
        <footer className="modal-foot">
          <button className="ghost-btn" onClick={p.onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={save}>
            {editing ? t('Save') : t('Create')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** "Delete the label Clients and its 2 sub-labels?": the mail stays. A dialog on desktop, a sheet on phones. */
export function DeleteLabel({ label, inside, onDelete, onClose }: { label: MailLabel; inside: number; onDelete: () => void; onClose: () => void }) {
  const phone = usePhone();
  const text = inside ? t('“{name}” and the {n} labels inside it come off every email. The emails stay where they are.', { name: label.name, n: inside }) : t('“{name}” comes off every email. The emails stay where they are.', { name: label.name });
  const go = () => (onDelete(), onClose());
  if (phone)
    return (
      <Sheet
        onClose={onClose}
        title={t('Delete label?')}
        footer={
          <button type="button" className="primary-btn danger-btn" onClick={go}>
            {t('Delete label')}
          </button>
        }
      >
        <p className="ml-confirm">{text}</p>
      </Sheet>
    );
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal ml-modal" role="alertdialog" aria-label={t('Delete label?')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>{t('Delete label?')}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <p className="ml-confirm">{text}</p>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn danger-btn" autoFocus onClick={go}>
            {t('Delete label')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What the sidebar and the drawer need to show labels. */
export interface LabelNavProps {
  tree: { label: MailLabel; depth: number; path: string }[]; // every label the person sees, in order
  unread: Record<string, number>;
  view: View;
  onPick: (id: string) => void;
  onNew: () => void;
  actions: (l: MailLabel) => SheetAction[];
}

/** Which labels show: Show always, Show if unread only with unread mail, Hide never (until "More labels"). */
const showsNow = (l: MailLabel, unread: number) => l.show === 'show' || (l.show === 'unread' && unread > 0);

function useFolds() {
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('s2g-label-folds') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      try {
        localStorage.setItem('s2g-label-folds', JSON.stringify([...n]));
      } catch {}
      return n;
    });
  return { closed, toggle };
}

/** Rows whose parents are all open (and, unless "More labels" is on, that show). */
function visibleRows(p: LabelNavProps, closed: Set<string>, more: boolean) {
  const byId = new Map(p.tree.map((x) => [x.label.id, x.label]));
  const hiddenUnder = (l: MailLabel) => {
    for (let x = l.parentId ? byId.get(l.parentId) : undefined, i = 0; x && i < 20; x = x.parentId ? byId.get(x.parentId) : undefined, i++) if (closed.has(x.id)) return true;
    return false;
  };
  const shows = (l: MailLabel) => more || showsNow(l, p.unread[l.id] ?? 0) || p.tree.some((x) => x.label.parentId === l.id && showsNow(x.label, p.unread[x.label.id] ?? 0));
  return p.tree.filter((x) => !hiddenUnder(x.label) && shows(x.label));
}

/** One label in the desktop sidebar: fold chevron (with labels inside), its dot, name and unread, and its "…". */
function NavRow({ x, p, open, hasKids, onFold }: { x: LabelNavProps['tree'][number]; p: LabelNavProps; open: boolean; hasKids: boolean; onFold: () => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(() => p.actions(x.label), { title: x.path });
  const active = p.view.kind === 'label' && p.view.id === x.label.id;
  const n = p.unread[x.label.id] ?? 0;
  return (
    <>
    <div className={`nav-item ml-nav-row${active ? ' active' : ''}`} style={{ ['--depth' as string]: x.depth }} {...menu.bind}>
      {hasKids ? (
        <button type="button" className="ml-fold sb-label" onClick={onFold} aria-expanded={open} aria-label={open ? t('Hide the labels inside {name}', { name: x.label.name }) : t('Show the labels inside {name}', { name: x.label.name })}>
          <ChevronRight size={14} className={`rot-chev${open ? ' open' : ''}`} />
        </button>
      ) : (
        <span className="ml-fold sb-label" aria-hidden />
      )}
      <button type="button" className="ml-open" onClick={() => p.onPick(x.label.id)} title={x.path}>
        <span className="ml-dot" style={{ background: x.label.color }} />
        <span className="sb-label ml-nav-name">{x.label.name}</span>
        {n > 0 && <span className="count">{n}</span>}
      </button>
      <button type="button" ref={more} className="icon-btn sm ml-more sb-label" onClick={() => menu.openFrom(more)} aria-label={t('More for {name}', { name: x.label.name })} title={t('More')}>
        <MoreHorizontal size={15} />
      </button>
    </div>
    {menu.menu}
    </>
  );
}

/** The sidebar's Labels (desktop): a heading with +, the tree with folds, "More labels" for the hidden ones. */
export function LabelNav(p: LabelNavProps) {
  const { closed, toggle } = useFolds();
  const [more, setMore] = useState(false);
  const rows = visibleRows(p, closed, more);
  const hidden = p.tree.length - visibleRows(p, new Set(), false).length;
  return (
    <>
      <div className="nav-heading sb-label ml-head">
        <span>{t('Labels')}</span>
        <button type="button" className="icon-btn sm" onClick={p.onNew} aria-label={t('New label')} title={t('New label')}>
          <Plus size={15} />
        </button>
      </div>
      <nav className="nav ml-nav" aria-label={t('Labels')}>
        {rows.map((x) => (
          <NavRow key={x.label.id} x={x} p={p} open={!closed.has(x.label.id)} hasKids={p.tree.some((y) => y.label.parentId === x.label.id)} onFold={() => toggle(x.label.id)} />
        ))}
        {hidden > 0 && (
          <button type="button" className="nav-item ml-morelabels" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronRight size={16} className={`rot-chev${more ? ' open' : ''}`} />
            <span className="sb-label">{more ? t('Fewer labels') : t('More labels')}</span>
          </button>
        )}
      </nav>
    </>
  );
}

/** One label in the phone drawer: long-press for its actions. */
function DrawerRow({ x, p }: { x: LabelNavProps['tree'][number]; p: LabelNavProps }) {
  const menu = useActionMenu(() => p.actions(x.label), { title: x.path });
  const on = p.view.kind === 'label' && p.view.id === x.label.id;
  const n = p.unread[x.label.id] ?? 0;
  return (
    <>
      <button type="button" className={`gm-nav lp ml-drawer-row${on ? ' active' : ''}`} aria-current={on || undefined} style={{ ['--depth' as string]: x.depth }} onClick={() => p.onPick(x.label.id)} {...menu.bind}>
        <Tag size={20} style={{ color: x.label.color }} />
        <span className="gm-nav-label">{x.label.name}</span>
        {n ? <span className="gm-nav-count">{n > 999 ? '999+' : n}</span> : null}
      </button>
      {menu.menu}
    </>
  );
}

/** The phone drawer's Labels (Gmail's): every label that shows, nested ones indented, and "Create new" last. */
export function LabelDrawer(p: LabelNavProps) {
  const [more, setMore] = useState(false);
  const rows = visibleRows(p, new Set(), more);
  const hidden = p.tree.length - visibleRows(p, new Set(), false).length;
  return (
    <>
      <div className="gm-sep" />
      <div className="gm-head">{t('Labels')}</div>
      <nav className="gm-nav-group" aria-label={t('Labels')}>
        {rows.map((x) => (
          <DrawerRow key={x.label.id} x={x} p={p} />
        ))}
        {hidden > 0 && (
          <button type="button" className="gm-nav" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronRight size={20} className={`rot-chev${more ? ' open' : ''}`} />
            <span className="gm-nav-label">{more ? t('Fewer labels') : t('More labels')}</span>
          </button>
        )}
        <button type="button" className="gm-nav" onClick={p.onNew}>
          <Plus size={20} />
          <span className="gm-nav-label">{t('Create new')}</span>
        </button>
      </nav>
    </>
  );
}

/** An email's labels in the reader: a chip each, with × to take it off. */
export function LabelChips({ labels, all, onRemove, onOpen }: { labels: MailLabel[]; all: MailLabel[]; onRemove: (id: string) => void; onOpen: (id: string) => void }): ReactNode {
  return labels.map((l) => (
    <span key={l.id} className="chip ml-chip" style={{ ['--c' as string]: l.color }}>
      <button type="button" className="ml-chip-name" onClick={() => onOpen(l.id)} title={t('Open {name}', { name: labelPath(l, all) })}>
        {labelPath(l, all)}
      </button>
      <button type="button" className="ml-chip-x" onClick={() => onRemove(l.id)} aria-label={t('Remove the label {name}', { name: l.name })} title={t('Remove label')}>
        <X size={12} />
      </button>
    </span>
  ));
}

/** The mailboxes a new label can go in, as the editor's choices. */
export function homesFor(accounts: Account[], isAdmin: boolean): LabelHome[] {
  const boxes = accounts.filter((a) => !a.temp);
  return [...boxes.map((a) => ({ value: a.id, label: a.kind === 'shared' ? t('{email} (shared)', { email: a.email }) : a.email })), ...(isAdmin ? [{ value: 'company', label: t('Every mailbox (a company label)') }] : [])];
}
