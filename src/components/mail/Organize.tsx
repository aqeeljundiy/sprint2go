// Labels and filters, wired into Mail: one hook App calls once, giving the sidebar's and drawer's Labels, the reader's
// and the list's actions ("Label as…", "Filter messages like this"), the chips and the "Filed by" line on an email, the
// Settings sections, and the dialogs they open. Saved through the synced collections `mailLabels` and `mailFilters`;
// the server checks every change (server/mailFilters.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Ban, Filter, GripVertical, MailPlus, MoreHorizontal, Pencil, Plus, Tag, Trash2, Eye, EyeOff, BellDot } from 'lucide-react';
import type { Account, Label, Thread, User, View, Workspace } from '../../types';
import { criteriaFromSearch, criteriaEmpty, factsOf, labelTree, matches, subtree, type FilterCriteria, type MailFilterRule, type MailLabel } from '../../mailFilterMatch';
import { useStored } from '../../store';
import { server } from '../../sync';
import { isMine } from '../../identity';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { Group, GRow } from '../ui/Grouped';
import { PushScreen } from '../ui/PushScreen';
import { Select } from '../ui/Select';
import { usePhone } from '../../mobile/media';
import { DeleteLabel, LabelChips, LabelDrawer, LabelEditor, LabelNav, LabelPicker, homesFor } from './Labels';
import { FilterEditor, actionWords, criteriaWords, filedWords, filterHomes, filterTitle } from './Filters';
import type { ToastMsg } from '../../toast';
import { fmtAgo } from '../../i18n/format';
import { t, tn } from '../../i18n';
import './organize.css';

/** Where the last click or tap was: "Label as" from a menu that closes (or the l key) opens there. */
let lastPoint = { x: 0, y: 0 };
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => void (lastPoint = { x: e.clientX, y: e.clientY }), true);
/** A fixed place on screen standing in for a button (the button may be gone a moment later, with its menu). */
const placeOf = (anchor?: RefObject<HTMLElement | null>): RefObject<HTMLElement | null> => {
  const el = anchor?.current;
  const r = el?.isConnected ? el.getBoundingClientRect() : new DOMRect(lastPoint.x || window.innerWidth / 2, lastPoint.y || 120, 0, 0);
  return { current: { getBoundingClientRect: () => r, closest: () => null, contains: () => false } as unknown as HTMLElement };
};
const uidOf = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const showWords = (s: MailLabel['show']) => (s === 'hide' ? t('Hidden') : s === 'unread' ? t('Show if unread') : t('Show'));

export interface OrganizeOpts {
  ws: Workspace;
  me: string;
  isAdmin: boolean;
  myAccounts: Account[]; // the mailboxes this person opens here
  threads: Thread[]; // their mail in this company
  setThreads: (fn: (ts: Thread[]) => Thread[]) => void;
  people: User[]; // the company's people
  view: View;
  onView: (v: View) => void;
  toast: (m: ToastMsg) => void;
}

export function useMailOrganize(o: OrganizeOpts) {
  const [allLabels, setAllLabels] = useStored('mailLabels');
  const [allFilters, setAllFilters] = useStored('mailFilters');
  const phone = usePhone();
  const boxes = o.myAccounts.filter((a) => !a.temp);
  // The labels this person sees here: the company's and their mailboxes'.
  const labels = useMemo(() => allLabels.filter((l) => l.workspaceId === o.ws.id && (l.accountId === null || o.myAccounts.some((a) => a.id === l.accountId))), [allLabels, o.ws.id, o.myAccounts]);
  const tree = useMemo(() => labelTree(labels, allLabels), [labels, allLabels]);
  const chipLabels: Label[] = useMemo(() => tree.map((x) => ({ id: x.label.id, name: x.path, color: x.label.color })), [tree]);
  const filters = useMemo(() => allFilters.filter((f) => f.workspaceId === o.ws.id), [allFilters, o.ws.id]);
  const unread = useMemo(() => {
    const r: Record<string, number> = {};
    for (const th of o.threads) if (th.unread && th.location !== 'trash' && th.location !== 'spam') for (const l of th.labels) r[l] = (r[l] ?? 0) + 1;
    return r;
  }, [o.threads]);
  const okFor = (l: MailLabel, th: Thread) => l.accountId === null || l.accountId === th.accountId;
  const mayEdit = (l: MailLabel) => (l.accountId === null ? o.isAdmin : boxes.some((a) => a.id === l.accountId));
  const mayEditFilter = (f: Pick<MailFilterRule, 'accountId'>) => {
    if (f.accountId === null) return o.isAdmin;
    const a = o.ws.accounts.find((x) => x.id === f.accountId);
    return !!a && (a.kind === 'shared' ? o.isAdmin : a.users.includes(o.me));
  };

  const [picker, setPicker] = useState<{ ids: string[]; anchor?: RefObject<HTMLElement | null> } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ label?: MailLabel; parentId?: string | null; home?: string } | null>(null);
  const [labelDel, setLabelDel] = useState<MailLabel | null>(null);
  const [filterEdit, setFilterEdit] = useState<Partial<MailFilterRule> | null>(null);
  const [screen, setScreen] = useState<'labels' | 'filters' | null>(null); // phones: Settings' Labels or Filters screen

  /* ---------- labels ---------- */

  const saveLabel = (l: MailLabel): string | null => {
    if (!mayEdit(l)) return l.accountId === null ? t('Only admins can change company labels.') : t('Not your mailbox.');
    const same = allLabels.some((x) => x.id !== l.id && x.workspaceId === l.workspaceId && (x.accountId ?? null) === (l.accountId ?? null) && (x.parentId ?? null) === (l.parentId ?? null) && x.name.toLowerCase() === l.name.toLowerCase());
    if (same) return t('There’s already a label with that name there.');
    setAllLabels((ls) => (ls.some((x) => x.id === l.id) ? ls.map((x) => (x.id === l.id ? l : x)) : [...ls, l]));
    return null;
  };
  /** A new label from a typed name (the picker's and the filter editor's "Create"). */
  const quickLabel = (name: string, accountId: string | null): MailLabel | null => {
    const clean = name.trim().replace(/\s*\/\s*/g, '/');
    if (!clean) return null;
    // "Clients/KopiKita" nests under Clients (made too when it isn't there).
    let parent: MailLabel | null = null;
    const made: MailLabel[] = [];
    for (const part of clean.split('/').filter(Boolean)) {
      const pool: MailLabel[] = [...allLabels, ...made];
      const found: MailLabel | undefined = pool.find((x) => x.workspaceId === o.ws.id && (x.accountId ?? null) === accountId && (x.parentId ?? null) === (parent?.id ?? null) && x.name.toLowerCase() === part.toLowerCase());
      if (found) {
        parent = found;
        continue;
      }
      const l: MailLabel = { id: uidOf('lb'), workspaceId: o.ws.id, accountId, name: part.slice(0, 80), parentId: parent?.id ?? null, color: parent?.color ?? '#64748b', show: 'show', order: Date.now() + made.length, createdBy: o.me, createdAt: new Date().toISOString() };
      made.push(l);
      parent = l;
    }
    if (accountId === null && !o.isAdmin) return null;
    if (made.length) setAllLabels((ls) => [...ls, ...made]);
    return parent;
  };
  /** Takes a label (and what's inside it) off everything, with Undo. */
  const deleteLabel = (l: MailLabel) => {
    const ids = subtree(l.id, allLabels);
    const gone = allLabels.filter((x) => ids.includes(x.id));
    const had = o.threads.filter((th) => th.labels.some((x) => ids.includes(x))).map((th) => ({ id: th.id, labels: th.labels }));
    setAllLabels((ls) => ls.filter((x) => !ids.includes(x.id)));
    o.setThreads((ts) => ts.map((th) => (th.labels.some((x) => ids.includes(x)) ? { ...th, labels: th.labels.filter((x) => !ids.includes(x)) } : th)));
    if (o.view.kind === 'label' && ids.includes(o.view.id)) o.onView({ kind: 'folder', id: 'inbox' });
    o.toast({
      text: t('Label “{name}” deleted', { name: l.name }),
      action: {
        label: t('Undo'),
        run: () => {
          setAllLabels((ls) => [...ls, ...gone]);
          setTimeout(() => o.setThreads((ts) => ts.map((th) => { const h = had.find((x) => x.id === th.id); return h ? { ...th, labels: [...new Set([...th.labels, ...h.labels])] } : th; })), 600);
        },
      },
    });
  };
  const setShow = (l: MailLabel, show: MailLabel['show']) => setAllLabels((ls) => ls.map((x) => (x.id === l.id ? { ...x, show } : x)));
  const homeFor = (ths: Thread[]) => {
    const accts = [...new Set(ths.map((th) => th.accountId))];
    return accts.length === 1 && boxes.some((a) => a.id === accts[0]) ? accts[0] : o.isAdmin ? 'company' : boxes[0]?.id ?? 'company';
  };
  /** A label's actions: the sidebar's "…", right-click, long-press in the drawer, and Settings. */
  const labelActions = (l: MailLabel): SheetAction[] => {
    const can = mayEdit(l);
    return [
      { label: t('Open'), icon: Tag, run: () => o.onView({ kind: 'label', id: l.id }) },
      ...(can
        ? [
            { label: t('Edit'), icon: Pencil, run: () => setLabelEdit({ label: l }) },
            { label: t('Add a label inside'), icon: Plus, run: () => setLabelEdit({ parentId: l.id }) },
          ]
        : []),
      { id: 'show', label: t('Show'), icon: Eye, group: 'show', checked: l.show === 'show', disabled: !can, run: () => setShow(l, 'show') },
      { id: 'unread', label: t('Show if unread'), icon: BellDot, group: 'show', checked: l.show === 'unread', disabled: !can, run: () => setShow(l, 'unread') },
      { id: 'hide', label: t('Hide'), icon: EyeOff, group: 'show', checked: l.show === 'hide', disabled: !can, run: () => setShow(l, 'hide') },
      { label: t('Make a filter for this label'), icon: Filter, group: 'filter', run: () => setFilterEdit({ accountId: l.accountId, criteria: {}, actions: { labels: [l.id] } }) },
      ...(can ? [{ label: t('Delete label'), icon: Trash2, danger: true, group: 'end', run: () => setLabelDel(l) }] : []),
    ];
  };

  /** Puts labels on emails and takes them off ("Label as"), with Undo. */
  const applyLabels = (ids: string[], add: string[], remove: string[]) => {
    const before = o.threads.filter((th) => ids.includes(th.id)).map((th) => ({ id: th.id, labels: th.labels }));
    const byId = new Map(allLabels.map((l) => [l.id, l]));
    o.setThreads((ts) =>
      ts.map((th) => {
        if (!ids.includes(th.id)) return th;
        const plus = add.filter((id) => { const l = byId.get(id); return l ? okFor(l, th) : true; });
        return { ...th, labels: [...new Set([...th.labels.filter((x) => !remove.includes(x)), ...plus])] };
      }),
    );
    const one = add.length + remove.length === 1 ? byId.get(add[0] ?? remove[0]) : undefined;
    o.toast({
      text: one ? (add.length ? tn(ids.length, 'Labelled “{name}”', '{n} emails labelled “{name}”', { name: one.name }) : tn(ids.length, 'Took “{name}” off', 'Took “{name}” off {n} emails', { name: one.name })) : tn(ids.length, 'Labels changed', 'Labels changed on {n} emails'),
      action: { label: t('Undo'), run: () => o.setThreads((ts) => ts.map((th) => { const b = before.find((x) => x.id === th.id); return b ? { ...th, labels: b.labels } : th; })) },
    });
  };
  const openPicker = (ids: string[], anchor?: RefObject<HTMLElement | null>) => {
    if (!ids.length) return;
    setPicker({ ids, anchor: placeOf(anchor) });
  };

  /* ---------- filters ---------- */

  const company = useMemo(() => [...o.ws.accounts.map((a) => a.email.toLowerCase()), ...(o.ws.mailAliases ?? []).map((x) => x.address.toLowerCase())], [o.ws]);
  const forwardTo = async (accountId: string | null): Promise<string[]> => {
    const own = accountId ? company.filter((x) => x !== o.ws.accounts.find((a) => a.id === accountId)?.email.toLowerCase()) : company;
    if ((o.ws.mailForwarding ?? 'verified') === 'off') return [];
    if (!server.on || !accountId) return own;
    const r = await fetch(`/api/mail/forwarding?accountId=${encodeURIComponent(accountId)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const checked = ((r?.addresses ?? []) as { address: string; verified: boolean }[]).filter((x) => x.verified).map((x) => x.address);
    return (o.ws.mailForwarding ?? 'verified') === 'company' ? own : [...new Set([...checked, ...own])];
  };
  /** The marks a filter puts on mail already here, in the demo (the real server does this itself). */
  const markHere = (f: MailFilterRule): number => {
    let n = 0;
    o.setThreads((ts) =>
      ts.map((th) => {
        if ((f.accountId && th.accountId !== f.accountId) || th.location === 'drafts' || !th.messages.some((m) => !isMine(m.from.email) && matches(f.criteria, factsOf(th.subject, m)))) return th;
        const a = f.actions;
        n++;
        return {
          ...th,
          labels: [...new Set([...th.labels, ...(a.labels ?? [])])],
          unread: a.read ? false : th.unread,
          starred: a.star ? true : th.starred,
          important: a.important ? a.important === 'yes' : th.important,
          location: a.trash ? 'trash' : a.spam ? 'spam' : a.neverSpam && th.location === 'spam' ? 'inbox' : a.archive && th.location === 'inbox' ? 'archive' : th.location,
          filed: [...(th.filed ?? []), { filterId: f.id, name: filterTitle(f), scope: f.accountId === null ? 'company' : 'mine', at: new Date().toISOString() }],
        } as Thread;
      }),
    );
    return n;
  };
  const applyExisting = async (f: MailFilterRule) => {
    if (!server.on) {
      const n = markHere(f);
      return o.toast({ text: tn(n, 'Filter created and applied to {n} email', 'Filter created and applied to {n} emails') });
    }
    // The filter reaches the server first (it's saved a moment after it's made), then the server files what matches.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500 + i * 300));
      const r = await fetch('/api/mail/filters/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id }) }).catch(() => null);
      if (r?.status === 404) continue;
      const d = r?.ok ? ((await r.json()) as { changed: number; undo: string | null }) : null;
      if (!d) return o.toast({ text: t('The filter is saved, but it couldn’t be applied to existing mail. Try again from Settings, Mail.') });
      return o.toast({
        text: tn(d.changed, 'Filter created and applied to {n} email', 'Filter created and applied to {n} emails'),
        action: d.undo ? { label: t('Undo'), run: () => void fetch('/api/mail/filters/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ undo: d.undo }) }) } : undefined,
      });
    }
  };
  const saveFilter = (f: MailFilterRule, apply: boolean) => {
    const had = allFilters.some((x) => x.id === f.id);
    setAllFilters((fs) => (had ? fs.map((x) => (x.id === f.id ? { ...x, ...f } : x)) : [...fs, f]));
    if (apply) void applyExisting(f);
    else o.toast({ text: had ? t('Filter saved') : t('Filter created. New mail that matches is filtered from now on') });
  };
  const removeFilter = (f: MailFilterRule) => {
    setAllFilters((fs) => fs.filter((x) => x.id !== f.id));
    o.toast({ text: t('Filter deleted'), action: { label: t('Undo'), run: () => setAllFilters((fs) => [...fs, f]) } });
  };
  const toggleFilter = (f: MailFilterRule) => setAllFilters((fs) => fs.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)));
  /** Run order inside a group: up or down one, or dropped at a place. */
  const moveFilter = (f: MailFilterRule, group: MailFilterRule[], to: number) => {
    const list = group.filter((x) => x.id !== f.id);
    list.splice(Math.max(0, Math.min(to, list.length)), 0, f);
    const order = new Map(list.map((x, i) => [x.id, i]));
    setAllFilters((fs) => fs.map((x) => (order.has(x.id) && x.order !== order.get(x.id) ? { ...x, order: order.get(x.id)! } : x)));
  };
  const homes = filterHomes(o.ws.accounts.filter((a) => a.users.includes(o.me) || (a.kind === 'shared' && o.isAdmin)), o.me, o.isAdmin);
  /** "Filter messages like this": this sender, from the email's mailbox. */
  const filterLike = (th: Thread) => {
    const m = [...th.messages].reverse().find((x) => !isMine(x.from.email)) ?? th.messages[0];
    const acct = th.accountId;
    const home = homes.some((h) => h.value === acct) ? acct : homes[0]?.value ?? null;
    let list = '';
    try {
      list = m.listUnsubscribe?.url ? new URL(m.listUnsubscribe.url).hostname : '';
    } catch {}
    setFilterEdit({ accountId: home === 'company' ? null : home, criteria: list ? { list } : { from: m.from.email }, actions: {} });
  };
  /** "Create filter from this search": every operator becomes a criterion. */
  const filterFromSearch = (q: string, extra: { from?: string; to?: string; files?: boolean } = {}) => {
    const c: FilterCriteria = { ...criteriaFromSearch(q) };
    if (extra.from) c.from = c.from ? `${c.from}, ${extra.from}` : extra.from;
    if (extra.to) c.to = c.to ? `${c.to}, ${extra.to}` : extra.to;
    if (extra.files) c.hasAttachment = true;
    if (criteriaEmpty(c)) return;
    setFilterEdit({ accountId: homes[0]?.value === 'company' ? null : homes[0]?.value ?? null, criteria: c, actions: {} });
  };

  /* ---------- the parts App places ---------- */

  const navProps = {
    tree,
    unread,
    view: o.view,
    onPick: (id: string) => o.onView({ kind: 'label', id }),
    onNew: () => setLabelEdit({ home: boxes[0]?.id }),
    actions: labelActions,
  };
  const readerActions = (th: Thread): SheetAction[] => [
    ...(th.location !== 'drafts' ? [{ id: 'label', label: t('Label as…'), icon: Tag, group: 'organize', run: () => openPicker([th.id]) }] : []),
    ...(homes.length && th.messages.some((m) => !isMine(m.from.email)) ? [{ id: 'filter', label: t('Filter messages like this'), icon: Filter, group: 'organize', run: () => filterLike(th) }] : []),
  ];
  const listActions = (list: Thread[], anchor?: RefObject<HTMLElement | null>): SheetAction[] => [
    { id: 'label', label: t('Label as…'), icon: Tag, group: 'organize', run: () => openPicker(list.map((th) => th.id), anchor) },
    ...(list.length === 1 && homes.length && list[0].messages.some((m) => !isMine(m.from.email)) ? [{ id: 'filter', label: t('Filter messages like this'), icon: Filter, group: 'organize', run: () => filterLike(list[0]) }] : []),
  ];
  const chips = (th: Thread): ReactNode => {
    const mine = labels.filter((l) => th.labels.includes(l.id));
    if (!mine.length) return null;
    return <LabelChips labels={mine} all={allLabels} onOpen={(id) => o.onView({ kind: 'label', id })} onRemove={(id) => applyLabels([th.id], [], [id])} />;
  };
  const filed = (th: Thread): ReactNode => {
    const last = th.filed?.[th.filed.length - 1];
    if (!last) return null;
    const f = filters.find((x) => x.id === last.filterId);
    return (
      <p className="filed-line">
        {last.scope === 'block' ? <Ban size={13} aria-hidden /> : <Filter size={13} aria-hidden />}
        <span>{filedWords(last)}</span>
        {f && mayEditFilter(f) && (
          <button type="button" className="link-btn" onClick={() => setFilterEdit(f)}>
            {t('Edit filter')}
          </button>
        )}
      </p>
    );
  };

  const pickerThreads = picker ? o.threads.filter((th) => picker.ids.includes(th.id)) : [];
  const settingsProps = {
    ws: o.ws,
    me: o.me,
    isAdmin: o.isAdmin,
    boxes,
    tree,
    allLabels,
    filters,
    people: o.people,
    phone,
    labelActions,
    onNewLabel: () => setLabelEdit({ home: boxes[0]?.id }),
    mayEditFilter,
    onNewFilter: () => setFilterEdit({ accountId: homes[0]?.value === 'company' ? null : homes[0]?.value ?? null, criteria: {}, actions: {} }),
    onEditFilter: (f: MailFilterRule) => setFilterEdit(f),
    onToggleFilter: toggleFilter,
    onDeleteFilter: removeFilter,
    onMoveFilter: moveFilter,
    onApplyFilter: (f: MailFilterRule) => void applyExisting(f),
    canMakeFilters: homes.length > 0,
    screen,
    onScreen: setScreen,
  };
  const overlays = (
    <>
      {phone && screen && <OrganizeSettings {...settingsProps} part="screens" />}
      {picker && (
        <LabelPicker
          threads={pickerThreads}
          labels={labels.filter((l) => pickerThreads.some((th) => okFor(l, th)))}
          all={allLabels}
          anchor={picker.anchor}
          onApply={(add, remove) => applyLabels(picker.ids, add, remove)}
          onCreate={(name) => {
            const home = homeFor(pickerThreads);
            return quickLabel(name, home === 'company' ? null : home);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {labelEdit && <LabelEditor label={labelEdit.label} parentId={labelEdit.parentId} home={labelEdit.home} homes={homesFor(boxes, o.isAdmin)} all={labels} workspaceId={o.ws.id} me={o.me} onSave={saveLabel} onClose={() => setLabelEdit(null)} />}
      {labelDel && <DeleteLabel label={labelDel} inside={subtree(labelDel.id, allLabels).length - 1} onDelete={() => deleteLabel(labelDel)} onClose={() => setLabelDel(null)} />}
      {filterEdit && (
        <FilterEditor
          key={filterEdit.id ?? 'new'}
          initial={filterEdit}
          wsId={o.ws.id}
          me={o.me}
          homes={filterEdit.createdAt ? [{ value: filterEdit.accountId ?? 'company', label: '' }] : homes}
          accounts={o.ws.accounts}
          labels={labels}
          people={o.people}
          threads={o.threads}
          forwardTo={forwardTo}
          onNewLabel={(name, accountId) => quickLabel(name, accountId)}
          onSave={saveFilter}
          onClose={() => setFilterEdit(null)}
        />
      )}
    </>
  );

  return {
    labels,
    tree,
    chipLabels,
    labelTitle: (id: string) => tree.find((x) => x.label.id === id)?.path ?? '',
    nav: <LabelNav {...navProps} />,
    drawer: <LabelDrawer {...navProps} />,
    openPicker,
    readerActions,
    listActions,
    chips,
    filed,
    filterFromSearch,
    newFilter: () => setFilterEdit({ accountId: homes[0]?.value === 'company' ? null : homes[0]?.value ?? null, criteria: {}, actions: {} }),
    openScreen: setScreen,
    settings: <OrganizeSettings {...settingsProps} part="page" />,
    overlays,
  };
}

/* ---------- Settings, Mail: Labels, Filters, Forwarding ---------- */

type SettingsProps = {
  ws: Workspace;
  me: string;
  isAdmin: boolean;
  boxes: Account[];
  tree: { label: MailLabel; depth: number; path: string }[];
  allLabels: MailLabel[];
  filters: MailFilterRule[];
  people: User[];
  phone: boolean;
  labelActions: (l: MailLabel) => SheetAction[];
  onNewLabel: () => void;
  mayEditFilter: (f: MailFilterRule) => boolean;
  onNewFilter: () => void;
  onEditFilter: (f: MailFilterRule) => void;
  onToggleFilter: (f: MailFilterRule) => void;
  onDeleteFilter: (f: MailFilterRule) => void;
  onMoveFilter: (f: MailFilterRule, group: MailFilterRule[], to: number) => void;
  onApplyFilter: (f: MailFilterRule) => void;
  canMakeFilters: boolean;
  screen: 'labels' | 'filters' | null; // phones: the Labels or Filters screen that's open
  onScreen: (s: 'labels' | 'filters' | null) => void;
  part: 'page' | 'screens'; // the rows in Mail settings, or (phones) the pushed screens, rendered over everything
};

/** The filters in run order: the company's, then each shared inbox's, then each of the person's mailboxes. */
function filterGroups(p: SettingsProps) {
  const sorted = (l: MailFilterRule[]) => [...l].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups: { key: string; title: string; list: MailFilterRule[]; locked: boolean }[] = [];
  const company = p.filters.filter((f) => f.accountId === null);
  if (company.length) groups.push({ key: 'company', title: t('Company filters (run first)'), list: sorted(company), locked: !p.isAdmin });
  for (const a of p.ws.accounts.filter((x) => !x.temp)) {
    const list = p.filters.filter((f) => f.accountId === a.id);
    if (!list.length) continue;
    groups.push({ key: a.id, title: a.kind === 'shared' ? t('{email} (shared inbox)', { email: a.email }) : p.boxes.length > 1 ? a.email : t('Your filters'), list: sorted(list), locked: a.kind === 'shared' ? !p.isAdmin : !a.users.includes(p.me) });
  }
  return groups;
}

/** One filter in Settings: what it does, its switch, and its actions (Edit, Move up or down, Apply, Delete). */
function FilterRow({ f, p, group, index, locked, drag }: { f: MailFilterRule; p: SettingsProps; group: MailFilterRule[]; index: number; locked: boolean; drag: { start: (id: string) => void; over: (i: number) => void; end: () => void; dragging: string | null } }) {
  const more = useRef<HTMLButtonElement>(null);
  const acts = (): SheetAction[] =>
    locked
      ? []
      : [
          { label: t('Edit'), icon: Pencil, run: () => p.onEditFilter(f) },
          ...(index > 0 ? [{ label: t('Move up'), icon: ArrowUp, group: 'move', run: () => p.onMoveFilter(f, group, index - 1) }] : []),
          ...(index < group.length - 1 ? [{ label: t('Move down'), icon: ArrowDown, group: 'move', run: () => p.onMoveFilter(f, group, index + 1) }] : []),
          { label: t('Apply to existing mail'), icon: MailPlus, group: 'run', run: () => p.onApplyFilter(f) },
          { label: t('Delete filter'), icon: Trash2, danger: true, group: 'end', run: () => p.onDeleteFilter(f) },
        ];
  const menu = useActionMenu(acts, { title: filterTitle(f), disabled: locked });
  const what = actionWords(f.actions, p.allLabels, p.people);
  const when = f.lastHitAt ? t('Last used {when}', { when: fmtAgo(f.lastHitAt) }) : '';
  if (p.phone)
    return (
      // A grouped row of our own (long-press opens Move up and down, Delete; tap edits).
      <>
      <div className={`g-row two lp flt-grow${f.enabled ? '' : ' off'}`} {...menu.bind}>
        <button type="button" className="flt-grow-main" onClick={locked ? undefined : () => p.onEditFilter(f)} disabled={locked}>
          <span className="g-label">
            <span className="g-text">{filterTitle(f)}</span>
            <small className="g-sub">{f.problem ? <span className="flt-problem">{t(f.problem)}</span> : what}</small>
          </span>
        </button>
        <button type="button" role="switch" aria-checked={f.enabled} aria-label={filterTitle(f)} disabled={locked} className={`switch ${f.enabled ? 'on' : ''}`} onClick={() => p.onToggleFilter(f)}>
          <span />
        </button>
      </div>
      {menu.menu}
      </>
    );
  return (
    <>
    {menu.menu}
    <div
      className={`flt-row${f.enabled ? '' : ' off'}${drag.dragging === f.id ? ' dragging' : ''}`}
      draggable={!locked}
      onDragStart={(e) => (e.dataTransfer.setData('text/plain', f.id), (e.dataTransfer.effectAllowed = 'move'), drag.start(f.id))}
      onDragOver={(e) => (e.preventDefault(), drag.over(index))}
      onDragEnd={drag.end}
      onDrop={(e) => (e.preventDefault(), drag.end())}
      {...menu.bind}
    >
      {!locked ? <GripVertical size={16} className="flt-grip" aria-hidden /> : <span className="flt-grip" aria-hidden />}
      <span className="flt-row-words">
        <strong>{filterTitle(f)}</strong>
        <small>{f.name ? `${criteriaWords(f.criteria)}: ${what}` : what}</small>
        {f.problem ? <small className="flt-problem">{t('Needs attention: {why}', { why: t(f.problem) })}</small> : when ? <small>{when}</small> : null}
      </span>
      <button type="button" role="switch" aria-checked={f.enabled} aria-label={f.enabled ? t('Switch off') : t('Switch on')} disabled={locked} className={`switch ${f.enabled ? 'on' : ''}`} onClick={() => p.onToggleFilter(f)}>
        <span />
      </button>
      {!locked && (
        <button type="button" ref={more} className="icon-btn sm" onClick={() => menu.openFrom(more)} aria-label={t('More for this filter')} title={t('More')}>
          <MoreHorizontal size={15} />
        </button>
      )}
    </div>
    </>
  );
}

/** A label in Settings: the tree, whether it shows, and its actions. */
function LabelRow({ x, p }: { x: SettingsProps['tree'][number]; p: SettingsProps }) {
  const more = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(() => p.labelActions(x.label), { title: x.path });
  if (p.phone)
    return (
      <>
      <button type="button" className="g-row has-pic lp lb-grow" style={{ ['--depth' as string]: x.depth }} onClick={() => menu.openAt(0, 0)} {...menu.bind}>
        <span className="g-pic" aria-hidden>
          <span className="lb-dot" style={{ background: x.label.color }} />
        </span>
        <span className="g-label">
          <span className="g-text">{x.label.name}</span>
          {x.label.accountId === null && <small className="g-sub">{t('Company label')}</small>}
        </span>
        <span className="g-val">{showWords(x.label.show)}</span>
      </button>
      {menu.menu}
      </>
    );
  return (
    <>
    <div className="lb-set-row" style={{ ['--depth' as string]: x.depth }} {...menu.bind}>
      <span className="lb-dot" style={{ background: x.label.color }} />
      <span className="lb-set-name">
        <strong>{x.label.name}</strong>
        {x.label.accountId === null && <small>{t('Company label')}</small>}
      </span>
      <span className="lb-set-show">{showWords(x.label.show)}</span>
      <button type="button" ref={more} className="icon-btn sm" onClick={() => menu.openFrom(more)} aria-label={t('More for {name}', { name: x.label.name })} title={t('More')}>
        <MoreHorizontal size={15} />
      </button>
    </div>
    {menu.menu}
    </>
  );
}

/** Forwarding addresses for one mailbox: the company's are ready; outside ones confirm by email first. */
function Forwarding({ box, phone, policy }: { box: Account; phone: boolean; policy: 'off' | 'company' | 'verified' }) {
  const [list, setList] = useState<{ address: string; verified: boolean }[] | null>(null);
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const load = () =>
    fetch(`/api/mail/forwarding?accountId=${encodeURIComponent(box.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setList(d?.addresses ?? []))
      .catch(() => setList([]));
  useEffect(() => void (server.on ? load() : setList([])), [box.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    const address = adding.trim();
    if (!address) return;
    const r = await fetch('/api/mail/forwarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: box.id, address }) }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { verified?: boolean; error?: string } | undefined;
    if (!r?.ok) return setNote(d?.error ? t(d.error) : t('No connection. Try again.'));
    setAdding('');
    setNote(d?.verified ? t('{address} is one of your company’s addresses, so it’s ready.', { address }) : t('We emailed {address} a link. Forwarding to it works once someone there opens it.', { address }));
    void load();
  };
  const remove = (address: string) => void fetch('/api/mail/forwarding/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: box.id, address }) }).then(load);
  const rows = (list ?? []).map((x) =>
    phone ? (
      <GRow key={x.address} label={x.address} value={x.verified ? t('Ready') : t('Waiting for the link')} accessory={<button type="button" className="text-btn danger" onClick={() => remove(x.address)}>{t('Remove')}</button>} />
    ) : (
      <div key={x.address} className="acct-row">
        <span className="acct-info">
          <strong>{x.address}</strong>
          <small>{x.verified ? t('Ready for filters') : t('Waiting: someone at that address opens the link we sent')}</small>
        </span>
        <button className="ghost-btn outline sm" onClick={() => remove(x.address)}>
          {t('Remove')}
        </button>
      </div>
    ),
  );
  const form = (
    <form className="flt-fwd-add" onSubmit={(e) => (e.preventDefault(), void add())}>
      <input value={adding} onChange={(e) => (setAdding(e.target.value), setNote(''))} placeholder={policy === 'company' ? t('An address at your company') : t('name@example.com')} inputMode="email" aria-label={t('Forwarding address')} />
      <button type="submit" className="ghost-btn outline sm" disabled={!adding.trim()}>
        {t('Add')}
      </button>
    </form>
  );
  if (phone)
    return (
      <Group title={box.email} footer={note || undefined}>
        {rows}
        <div className="g-row flt-fwd-row">{form}</div>
      </Group>
    );
  return (
    <div className="flt-fwd">
      <strong className="flt-fwd-box">{box.email}</strong>
      {rows.length > 0 && <div className="acct-list">{rows}</div>}
      {form}
      {note && <small className="set-hint">{note}</small>}
    </div>
  );
}

function OrganizeSettings(p: SettingsProps) {
  const [ws, setWorkspaces] = [p.ws, useStored('workspaces')[1]];
  const groups = filterGroups(p);
  const [dragging, setDragging] = useState<{ id: string; group: string; to: number } | null>(null);
  const { screen, onScreen: setScreen } = p;
  const policy = ws.mailForwarding ?? 'verified';
  const setPolicy = (v: string) => setWorkspaces((list) => list.map((w) => (w.id === ws.id ? { ...w, mailForwarding: v as Workspace['mailForwarding'] } : w)));
  const personal = p.boxes.filter((a) => a.kind !== 'shared' && a.users.includes(p.me));
  const policyOptions = [
    { value: 'verified', label: t('To the company and confirmed addresses') },
    { value: 'company', label: t('Only to the company’s own addresses') },
    { value: 'off', label: t('Off') },
  ];
  const groupRows = (g: (typeof groups)[number]) => {
    const drag = {
      dragging: dragging?.group === g.key ? dragging.id : null,
      start: (id: string) => setDragging({ id, group: g.key, to: g.list.findIndex((f) => f.id === id) }),
      over: (i: number) => setDragging((d) => (d && d.group === g.key && d.to !== i ? { ...d, to: i } : d)),
      end: () => {
        if (dragging?.group === g.key) {
          const f = g.list.find((x) => x.id === dragging.id);
          if (f && g.list.indexOf(f) !== dragging.to) p.onMoveFilter(f, g.list, dragging.to);
        }
        setDragging(null);
      },
    };
    return g.list.map((f, i) => <FilterRow key={f.id} f={f} p={p} group={g.list} index={i} locked={g.locked} drag={drag} />);
  };

  if (p.phone && p.part === 'page')
    return (
      <Group title={t('Labels and filters')}>
        <GRow icon={Tag} color="indigo" label={t('Labels')} onClick={() => setScreen('labels')} />
        <GRow icon={Filter} color="teal" label={t('Filters and forwarding')} onClick={() => setScreen('filters')} />
      </Group>
    );
  if (p.part === 'screens') {
    if (!p.phone) return null;
    return (
      <>
        {screen === 'labels' && (
          <PushScreen title={t('Labels')} onBack={() => setScreen(null)} className="g-page" actions={<button type="button" className="g-save" onClick={p.onNewLabel}>{t('New')}</button>}>
            <div className="g-body">
              <Group footer={t('Hold a label to edit it, nest it, hide it or delete it. Deleting a label keeps its emails.')}>
                {p.tree.length ? p.tree.map((x) => <LabelRow key={x.label.id} x={x} p={p} />) : <GRow label={t('No labels yet')} action onClick={p.onNewLabel} />}
              </Group>
            </div>
          </PushScreen>
        )}
        {screen === 'filters' && (
          <PushScreen title={t('Filters')} onBack={() => setScreen(null)} className="g-page" actions={p.canMakeFilters ? <button type="button" className="g-save" onClick={p.onNewFilter}>{t('New')}</button> : undefined}>
            <div className="g-body">
              {groups.length === 0 && (
                <Group footer={t('A filter files new mail for you the moment it arrives: label it, skip the inbox, forward it, make a task.')}>
                  <GRow label={t('Make a filter')} action onClick={p.onNewFilter} />
                </Group>
              )}
              {groups.map((g) => (
                <Group key={g.key} title={g.title} footer={g.locked ? (g.key === 'company' ? t('Admins set these, and they run before yours.') : t('Admins set a shared inbox’s filters.')) : t('Filters run top to bottom. Hold one to move it.')}>
                  {groupRows(g)}
                </Group>
              ))}
              {p.isAdmin && (
                <Group title={t('Automatic forwarding')} footer={t('Who filters may forward your company’s mail to.')}>
                  <GRow label={t('Allowed')} accessory={<Select value={policy} options={policyOptions} onChange={setPolicy} title={t('Automatic forwarding')} />} />
                </Group>
              )}
              {server.on && policy !== 'off' && personal.map((b) => <Forwarding key={b.id} box={b} phone policy={policy} />)}
            </div>
          </PushScreen>
        )}
      </>
    );
  }

  return (
    <div className="organize-settings">
      <h3 id="mail-labels">{t('Labels')}</h3>
      {p.tree.length === 0 ? (
        <small className="set-hint" style={{ marginTop: 0 }}>
          {t('Labels sort mail your way, and an email can have several. Make one here, or from “Label as” on any email.')}
        </small>
      ) : (
        <div className="lb-set-list">{p.tree.map((x) => <LabelRow key={x.label.id} x={x} p={p} />)}</div>
      )}
      <button type="button" className="ghost-btn outline sm lb-set-new" onClick={p.onNewLabel}>
        <Plus size={14} /> {t('New label')}
      </button>

      <h3 id="mail-filters">{t('Filters')}</h3>
      {groups.length === 0 ? (
        <small className="set-hint" style={{ marginTop: 0 }}>
          {t('A filter files new mail for you the moment it arrives: label it, skip the inbox, forward it, make a task. Start one here, or with “Filter messages like this” on an email.')}
        </small>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flt-group">
            <h4>{g.title}</h4>
            {g.locked && <small className="set-hint flt-locked">{g.key === 'company' ? t('Admins set these, and they run before yours.') : t('Admins set a shared inbox’s filters.')}</small>}
            <div className="flt-list">{groupRows(g)}</div>
          </section>
        ))
      )}
      {p.canMakeFilters && (
        <button type="button" className="ghost-btn outline sm lb-set-new" onClick={p.onNewFilter}>
          <Plus size={14} /> {t('New filter')}
        </button>
      )}

      <h3 id="mail-forwarding">{t('Forwarding addresses')}</h3>
      {p.isAdmin && (
        <div className="set-row">
          <span>
            <strong>{t('Automatic forwarding')}</strong>
            <small>{t('Who filters may forward your company’s mail to.')}</small>
          </span>
          <Select value={policy} options={policyOptions} onChange={setPolicy} title={t('Automatic forwarding')} />
        </div>
      )}
      {policy === 'off' ? (
        <small className="set-hint">{t('Your company has automatic forwarding switched off.')}</small>
      ) : server.on ? (
        personal.map((b) => <Forwarding key={b.id} box={b} phone={false} policy={policy} />)
      ) : (
        <small className="set-hint">{t('Filters can forward to your company’s own addresses.')}</small>
      )}
    </div>
  );
}

export type MailOrganize = ReturnType<typeof useMailOrganize>;
