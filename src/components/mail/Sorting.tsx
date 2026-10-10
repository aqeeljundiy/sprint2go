// Mail's sorting on screen: the search options panel (Gmail's arrow) and the chips under a search, saved searches,
// the inbox tabs (desktop) and their rows on phones, multiple inboxes, the Spam and Trash notice, the Important
// marker, and the inbox settings (desktop and phone). The logic is in ./sorting.ts and src/mailQuery.ts.
import { useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronRight, Inbox, Info, ListFilter, MessagesSquare, Plus, Search, SlidersHorizontal, Tag, Trash2, Users, X, type LucideIcon } from 'lucide-react';
import type { Thread } from '../../types';
import { CATEGORIES, EMPTY_FORM, formToQuery, hasTerm, queryToForm, toggleTerm, type Category, type SearchForm } from '../../mailQuery';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { PushScreen } from '../ui/PushScreen';
import { Group, SwitchRow, ChoiceRow, GRow } from '../ui/Grouped';
import { usePhone } from '../../mobile/media';
import { toast } from '../../toast';
import { lastMessage, listDate, participants } from '../../utils';
import type { Person } from '../../types';
import { CATEGORY_HINT, categoryName, deleteForever, newId, ruleFromSearch, tabOf, tabsOn, useMailPrefs, type Advance, type InboxType, type SavedSearch } from './sortPrefs';
import { t, tn } from '../../i18n';

export const CATEGORY_ICON: Record<Category, LucideIcon> = { primary: Inbox, promotions: Tag, social: Users, updates: Info, forums: MessagesSquare };

/* ---------- search ---------- */

const withinWords = () => [
  { value: '', label: t('Any time') },
  { value: '1d', label: t('1 day') },
  { value: '3d', label: t('3 days') },
  { value: '7d', label: t('1 week') },
  { value: '14d', label: t('2 weeks') },
  { value: '1m', label: t('1 month') },
  { value: '2m', label: t('2 months') },
  { value: '6m', label: t('6 months') },
  { value: '1y', label: t('1 year') },
];
const inWords = () => [
  { value: '', label: t('All mail') },
  { value: 'inbox', label: t('Inbox') },
  { value: 'starred', label: t('Starred') },
  { value: 'sent', label: t('Sent') },
  { value: 'drafts', label: t('Drafts') },
  { value: 'archive', label: t('Archive') },
  { value: 'unread', label: t('Unread') },
  { value: 'spam', label: t('Spam') },
  { value: 'trash', label: t('Trash') },
  { value: 'anywhere', label: t('Mail, Spam and Trash') },
];

/** Saves a search for the drawer (named after itself). */
function useSaveSearch() {
  const [prefs, update] = useMailPrefs();
  return (q: string) => {
    const s = q.trim();
    if (!s) return;
    if (prefs.saved.some((x) => x.q === s)) return toast({ text: t('This search is already saved') });
    const item = { id: newId(), name: s.length > 40 ? s.slice(0, 38) + '…' : s, q: s };
    update((p) => ({ saved: [...p.saved, item] }));
    toast({ text: t('Search saved. It’s in the sidebar.'), action: { label: t('Undo'), run: () => update((p) => ({ saved: p.saved.filter((x) => x.id !== item.id) })) } });
  };
}
const makeRule = (q: string) => {
  if (!ruleFromSearch(q)) toast({ text: t('Rules aren’t available here yet. The search stays saved in the box.') });
};

/**
 * Gmail's search options: the arrow in the search box opens a form (From, To, Subject, Has the words, Doesn't have,
 * Size, Date within, Search in, and a few ticks). Search fills the box with the operators it makes.
 */
export function SearchOptions({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<SearchForm>(EMPTY_FORM);
  const save = useSaveSearch();
  const q = formToQuery(f);
  const set = (patch: Partial<SearchForm>) => setF((x) => ({ ...x, ...patch }));
  const text = (key: 'from' | 'to' | 'subject' | 'words' | 'without', label: string) => (
    <label className="so-row">
      <span>{label}</span>
      <input value={f[key]} onChange={(e) => set({ [key]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
    </label>
  );
  const run = () => (onQuery(q), setOpen(false));
  const tick = (key: 'attachment' | 'unread' | 'starred' | 'important', label: string) => (
    <label className="check-row">
      <input type="checkbox" checked={f[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon-btn sm so-btn${open ? ' on' : ''}`}
        onClick={(e) => (e.preventDefault(), setF(queryToForm(query)), setOpen((o) => !o))}
        aria-expanded={open}
        aria-label={t('Search options')}
        title={t('Search options')}
      >
        <SlidersHorizontal size={15} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={460} align="end" title={t('Search options')}>
        <form className="so-form" onSubmit={(e) => (e.preventDefault(), run())}>
          {text('from', t('From'))}
          {text('to', t('To'))}
          {text('subject', t('Subject'))}
          {text('words', t('Has the words'))}
          {text('without', t('Doesn’t have'))}
          <div className="so-row">
            <span>{t('Size')}</span>
            <div className="so-size">
              <Select
                value={f.size?.op ?? 'larger'}
                options={[
                  { value: 'larger', label: t('greater than') },
                  { value: 'smaller', label: t('less than') },
                ]}
                onChange={(op) => set({ size: { op, n: f.size?.n ?? '', unit: f.size?.unit ?? 'MB' } })}
                label={t('Size')}
                width={160}
              />
              <input inputMode="decimal" value={f.size?.n ?? ''} onChange={(e) => set({ size: { op: f.size?.op ?? 'larger', n: e.target.value.replace(/[^\d.]/g, ''), unit: f.size?.unit ?? 'MB' } })} aria-label={t('Size')} />
              <Select value={f.size?.unit ?? 'MB'} options={[{ value: 'MB', label: 'MB' }, { value: 'KB', label: 'KB' }]} onChange={(unit) => set({ size: { op: f.size?.op ?? 'larger', n: f.size?.n ?? '', unit } })} label={t('Unit')} width={100} />
            </div>
          </div>
          <div className="so-row">
            <span>{t('Date within')}</span>
            <Select value={f.within} options={withinWords()} onChange={(within) => set({ within: within as SearchForm['within'] })} label={t('Date within')} />
          </div>
          <div className="so-row">
            <span>{t('Search in')}</span>
            <Select value={f.in} options={inWords()} onChange={(v) => set({ in: v as SearchForm['in'] })} label={t('Search in')} />
          </div>
          <div className="so-row">
            <span>{t('Tab')}</span>
            <Select value={f.category} options={[{ value: '', label: t('Any tab') }, ...CATEGORIES.map((c) => ({ value: c, label: categoryName(c) }))]} onChange={(v) => set({ category: v as SearchForm['category'] })} label={t('Tab')} />
          </div>
          <div className="so-ticks">
            {tick('attachment', t('Has attachment'))}
            {tick('unread', t('Unread'))}
            {tick('starred', t('Starred'))}
            {tick('important', t('Important'))}
          </div>
          <div className="so-query" aria-live="polite">
            {q ? <code>{q}</code> : <span>{t('Fill in what you’re looking for.')}</span>}
          </div>
          <footer className="so-foot">
            <button type="button" className="link-btn" disabled={!q} onClick={() => (makeRule(q), setOpen(false))}>
              {t('Make a rule from this search')}
            </button>
            <span className="so-foot-end">
              <button type="button" className="ghost-btn sm" disabled={!q} onClick={() => (save(q), setOpen(false))}>
                {t('Save search')}
              </button>
              <button type="submit" className="primary-btn sm" disabled={!q}>
                {t('Search')}
              </button>
            </span>
          </footer>
        </form>
      </Popover>
    </>
  );
}

/** Gmail's chips under a search (desktop): each switches one operator in the box; Save and Make a rule at the end. */
export function SearchChips({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const save = useSaveSearch();
  const chip = (field: string, value: string, label: string) => {
    const on = hasTerm(query, field, value) !== null;
    return (
      <button key={field + value} type="button" className={`mail-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onQuery(toggleTerm(query, field, value))}>
        {label}
      </button>
    );
  };
  const when = hasTerm(query, 'newer_than');
  return (
    <div className="mail-chips so-chips" role="group" aria-label={t('Narrow the search')}>
      {chip('has', 'attachment', t('Has attachment'))}
      {chip('is', 'unread', t('Unread'))}
      {chip('is', 'starred', t('Starred'))}
      {chip('is', 'important', t('Important'))}
      <button type="button" className={`mail-chip${when ? ' on' : ''}`} aria-pressed={!!when} onClick={() => onQuery(toggleTerm(query, 'newer_than', when ? null : '7d'))}>
        {when ? t('Within {span}', { span: withinWords().find((w) => w.value === when)?.label ?? when }) : t('Last 7 days')}
      </button>
      {chip('in', 'anywhere', t('Include Spam and Trash'))}
      <button type="button" className="mail-chip so-save" onClick={() => save(query)}>
        <Bookmark size={13} /> {t('Save')}
      </button>
      <button type="button" className="mail-chip so-save" onClick={() => makeRule(query)}>
        <ListFilter size={13} /> {t('Make a rule')}
      </button>
    </div>
  );
}

/** Saved searches in the sidebar (desktop) and the drawer (phones). */
export function SavedSearches({ query, onRun }: { query: string; onRun: (q: string) => void }) {
  const [prefs, update] = useMailPrefs();
  const phone = usePhone();
  if (!prefs.saved.length) return null;
  const remove = (s: SavedSearch) => {
    update((p) => ({ saved: p.saved.filter((x) => x.id !== s.id) }));
    toast({ text: t('Saved search removed'), action: { label: t('Undo'), run: () => update((p) => ({ saved: [...p.saved, s] })) } });
  };
  if (phone)
    return (
      <>
        <div className="gm-sep" />
        <div className="gm-head">{t('Saved searches')}</div>
        <nav className="gm-nav-group" aria-label={t('Saved searches')}>
          {prefs.saved.map((s) => (
            <button key={s.id} type="button" className={`gm-nav${query === s.q ? ' active' : ''}`} aria-current={query === s.q || undefined} onClick={() => onRun(s.q)}>
              <Search size={20} />
              <span className="gm-nav-label">{s.name}</span>
            </button>
          ))}
        </nav>
      </>
    );
  return (
    <>
      <div className="nav-heading sb-label">{t('Saved searches')}</div>
      <nav className="nav saved-nav">
        {prefs.saved.map((s) => (
          <div key={s.id} className={`nav-item saved-row ${query === s.q ? 'active' : ''}`}>
            <button type="button" className="saved-open" onClick={() => onRun(s.q)} title={s.q}>
              <Search size={17} />
              <span className="sb-label">{s.name}</span>
            </button>
            <button type="button" className="icon-btn sm saved-x sb-label" onClick={() => remove(s)} aria-label={t('Remove saved search {name}', { name: s.name })} title={t('Remove')}>
              <X size={14} />
            </button>
          </div>
        ))}
      </nav>
    </>
  );
}

/* ---------- inbox tabs ---------- */

/** New mail in a tab (unread in the inbox), with who it's from: what makes a tab worth opening. */
function tabNews(threads: Thread[], c: Category, on: Category[]) {
  const fresh = threads.filter((th) => th.unread && tabOf(th, on) === c);
  const names = [...new Set(fresh.map((th) => lastMessage(th).from.name || lastMessage(th).from.email))].slice(0, 3);
  return { n: fresh.length, names };
}

/** The inbox's tabs on desktop (Primary, Promotions, Social, Updates, Forums, the ones switched on). */
export function InboxTabs({ inbox, current, onPick }: { inbox: Thread[]; current: Category; onPick: (c: Category) => void }) {
  const [prefs] = useMailPrefs();
  const on = tabsOn(prefs);
  if (on.length < 2) return null;
  return (
    <div className="cs-tabs mail-tabs" role="tablist" aria-label={t('Inbox tabs')}>
      {on.map((c) => {
        const Icon = CATEGORY_ICON[c];
        const news = c === 'primary' ? null : tabNews(inbox, c, on);
        return (
          <button key={c} type="button" role="tab" aria-selected={current === c} className={current === c ? 'on' : ''} onClick={() => onPick(c)} title={news?.names.length ? news.names.join(', ') : t(CATEGORY_HINT[c])}>
            <Icon size={15} />
            {categoryName(c)}
            {news && news.n > 0 && current !== c && <span className="mail-tab-new">{tn(news.n, '{n} new', '{n} new')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Phones, top of Primary: a row for each other tab with new mail (Gmail's), tap to open it. */
export function TabRows({ inbox, onPick }: { inbox: Thread[]; onPick: (c: Category) => void }) {
  const [prefs] = useMailPrefs();
  const on = tabsOn(prefs);
  const rows = on.filter((c) => c !== 'primary').map((c) => ({ c, ...tabNews(inbox, c, on) })).filter((r) => r.n > 0);
  if (!rows.length) return null;
  return (
    <div className="tab-rows">
      {rows.map((r) => {
        const Icon = CATEGORY_ICON[r.c];
        return (
          <button key={r.c} type="button" className={`tab-row tab-${r.c}`} onClick={() => onPick(r.c)}>
            <span className="tab-row-icon">
              <Icon size={20} />
            </span>
            <span className="tab-row-words">
              <b>{categoryName(r.c)}</b>
              <small>{r.names.join(', ')}</small>
            </span>
            <span className="tab-row-new">{tn(r.n, '{n} new', '{n} new')}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The tabs in the phone drawer, under the inbox. */
export function TabNav({ current, inbox, onPick }: { current: Category | null; inbox: Thread[]; onPick: (c: Category) => void }) {
  const [prefs] = useMailPrefs();
  const on = tabsOn(prefs);
  if (on.length < 2) return null;
  return (
    <>
      {on
        .filter((c) => c !== 'primary')
        .map((c) => {
          const Icon = CATEGORY_ICON[c];
          const n = tabNews(inbox, c, on).n;
          return (
            <button key={c} type="button" className={`gm-nav${current === c ? ' active' : ''}`} aria-current={current === c || undefined} onClick={() => onPick(c)}>
              <Icon size={20} />
              <span className="gm-nav-label">{categoryName(c)}</span>
              {n ? <span className="gm-nav-count gm-nav-new">{tn(n, '{n} new', '{n} new')}</span> : null}
            </button>
          );
        })}
    </>
  );
}

/* ---------- multiple inboxes ---------- */

/** Extra sections above the inbox (desktop), each a search with its first few emails. */
export function InboxSections({ match, me, onOpen, onQuery }: { match: (q: string) => Thread[]; me: Person; onOpen: (id: string) => void; onQuery: (q: string) => void }) {
  const [prefs] = useMailPrefs();
  const [shut, setShut] = useState<Set<string>>(new Set());
  const lists = useMemo(() => prefs.sections.map((s) => ({ s, list: match(s.q) })), [prefs.sections, match]);
  if (!lists.length) return null;
  return (
    <div className="mx-sections">
      {lists.map(({ s, list }) => {
        const open = !shut.has(s.id);
        return (
          <section key={s.id} className="mx-section">
            <header className="mx-head">
              <button type="button" className="mx-title" aria-expanded={open} onClick={() => setShut((x) => (x.has(s.id) ? new Set([...x].filter((y) => y !== s.id)) : new Set([...x, s.id])))}>
                <ChevronRight size={14} className={`rot-chev${open ? ' open' : ''}`} />
                {s.name}
              </button>
              {list.length > 5 && (
                <button type="button" className="link-btn small" onClick={() => onQuery(s.q)}>
                  {t('See all')}
                </button>
              )}
            </header>
            <div className={`fold${open ? ' open' : ''}`}>
              <div>
                {list.length === 0 ? (
                  <p className="mx-empty">{t('Nothing here right now.')}</p>
                ) : (
                  <ul className="mx-rows">
                    {list.slice(0, 5).map((th) => (
                      <li key={th.id}>
                        <button type="button" className={`mx-row${th.unread ? ' unread' : ''}`} onClick={() => onOpen(th.id)}>
                          <span className="mx-who">{participants(th, me)}</span>
                          <span className="mx-subj">{th.subject}</span>
                          <time>{listDate(lastMessage(th).date)}</time>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Spam and Trash ---------- */

/** Above Spam and Trash: they empty themselves after 30 days; Empty now, after asking. */
export function KeepNotice({ where, ids }: { where: 'spam' | 'trash'; ids: string[] }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="keep-notice">
      <Trash2 size={14} />
      <span>{where === 'spam' ? t('Mail in Spam for more than 30 days is deleted for good.') : t('Mail in Trash for more than 30 days is deleted for good.')}</span>
      {ids.length > 0 &&
        (asking ? (
          <span className="keep-ask">
            <button type="button" className="ghost-btn sm" onClick={() => setAsking(false)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="primary-btn sm danger-btn"
              onClick={() => {
                deleteForever(ids);
                setAsking(false);
                toast({ text: where === 'spam' ? t('Spam is empty') : t('Trash is empty') });
              }}
            >
              {tn(ids.length, 'Delete {n} for good', 'Delete {n} for good')}
            </button>
          </span>
        ) : (
          <button type="button" className="link-btn small" onClick={() => setAsking(true)}>
            {where === 'spam' ? t('Empty Spam now') : t('Empty Trash now')}
          </button>
        ))}
    </div>
  );
}

/* ---------- Important ---------- */

/** Gmail's Important marker, before the subject. */
export function ImportantMark({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span className="imp-mark" role="img" aria-label={t('Important')} title={t('Important: learned from what you open, reply to and star')}>
      <svg viewBox="0 0 16 12" width="14" height="11" aria-hidden="true">
        <path d="M1 1h9.5L15 6l-4.5 5H1l4-5z" fill="currentColor" />
      </svg>
    </span>
  );
}

/* ---------- settings ---------- */

const typeWords = (): { value: InboxType; label: string; hint: string }[] => [
  { value: 'default', label: t('Newest first'), hint: t('Every email in the order it came in') },
  { value: 'important', label: t('Important first'), hint: t('Important mail on top, then everything else') },
  { value: 'unread', label: t('Unread first'), hint: t('What you haven’t opened on top') },
  { value: 'starred', label: t('Starred first'), hint: t('Starred mail on top') },
];
const advanceWords = (): { value: Advance; label: string; hint: string }[] => [
  { value: 'auto', label: t('As usual'), hint: t('The next email on a computer, the list on a phone') },
  { value: 'older', label: t('Go to the older email'), hint: t('The one below it in the list') },
  { value: 'newer', label: t('Go to the newer email'), hint: t('The one above it in the list') },
  { value: 'list', label: t('Go back to the list'), hint: t('Nothing opens by itself') },
];

/** The inbox settings in Settings, Mail (desktop). */
export function InboxSettings() {
  const [prefs, update] = useMailPrefs();
  const [newName, setNewName] = useState('');
  const [newQ, setNewQ] = useState('');
  const addSection = () => {
    const q = newQ.trim();
    if (!q) return;
    update((p) => ({ sections: [...p.sections, { id: newId(), name: newName.trim() || q, q }] }));
    setNewName('');
    setNewQ('');
  };
  const tabSwitch = (c: Exclude<Category, 'primary'>) => (
    <label key={c} className="set-row toggle-row">
      <span>
        <strong>{categoryName(c)}</strong>
        <small>{t(CATEGORY_HINT[c])}</small>
      </span>
      <button type="button" role="switch" aria-checked={!!prefs.tabs[c]} className={`switch ${prefs.tabs[c] ? 'on' : ''}`} onClick={() => update((p) => ({ tabs: { ...p.tabs, [c]: !p.tabs[c] } }))}>
        <span />
      </button>
    </label>
  );
  return (
    <div className="inbox-settings">
      <h3>{t('Inbox tabs')}</h3>
      <small className="set-hint">{t('New mail is sorted when it arrives. Move an email to another tab and that sender’s mail goes there from now on. A tab that’s off stays in Primary.')}</small>
      {(['promotions', 'social', 'updates', 'forums'] as const).map(tabSwitch)}

      <h3>{t('Inbox order')}</h3>
      <div className="set-row">
        <span>
          <strong>{t('Show first')}</strong>
          <small>{typeWords().find((x) => x.value === prefs.inboxType)?.hint}</small>
        </span>
        <Select value={prefs.inboxType} options={typeWords().map((x) => ({ value: x.value, label: x.label }))} onChange={(inboxType) => update({ inboxType })} label={t('Show first')} />
      </div>

      <h3>{t('Multiple inboxes')}</h3>
      <small className="set-hint">{t('Sections above your inbox, each one a search: is:starred, label:finance, from:nadia.')}</small>
      {prefs.sections.length > 0 && (
        <div className="acct-list">
          {prefs.sections.map((s) => (
            <div key={s.id} className="acct-row">
              <span className="acct-icon">
                <Inbox size={15} />
              </span>
              <span className="acct-info">
                <strong>{s.name}</strong>
                <small>{s.q}</small>
              </span>
              <button type="button" className="ghost-btn outline sm" onClick={() => update((p) => ({ sections: p.sections.filter((x) => x.id !== s.id) }))}>
                {t('Remove')}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mx-add">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('Name, e.g. Starred')} aria-label={t('Section name')} />
        <input value={newQ} onChange={(e) => setNewQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSection()} placeholder={t('Search, e.g. is:starred')} aria-label={t('Section search')} />
        <button type="button" className="ghost-btn outline sm" disabled={!newQ.trim()} onClick={addSection}>
          <Plus size={14} /> {t('Add section')}
        </button>
      </div>
      {prefs.sections.length === 0 && (
        <div className="mx-quick">
          <button type="button" className="mail-chip" onClick={() => update((p) => ({ sections: [...p.sections, { id: newId(), name: t('Starred'), q: 'is:starred' }] }))}>
            <Plus size={13} /> {t('Starred')}
          </button>
          <button type="button" className="mail-chip" onClick={() => update((p) => ({ sections: [...p.sections, { id: newId(), name: t('Important and unread'), q: 'is:important is:unread' }] }))}>
            <Plus size={13} /> {t('Important and unread')}
          </button>
        </div>
      )}

      <h3>{t('Reading')}</h3>
      <label className="set-row toggle-row">
        <span>
          <strong>{t('Conversation view')}</strong>
          <small>{prefs.conversation ? t('Replies are kept together with the email they answer.') : t('Each email is its own row in the list.')}</small>
        </span>
        <button type="button" role="switch" aria-checked={prefs.conversation} className={`switch ${prefs.conversation ? 'on' : ''}`} onClick={() => update((p) => ({ conversation: !p.conversation }))}>
          <span />
        </button>
      </label>
      <div className="set-row">
        <span>
          <strong>{t('After Done or Delete')}</strong>
          <small>{advanceWords().find((x) => x.value === prefs.advance)?.hint}</small>
        </span>
        <Select value={prefs.advance} options={advanceWords().map((x) => ({ value: x.value, label: x.label }))} onChange={(advance) => update({ advance })} label={t('After Done or Delete')} width={260} />
      </div>
    </div>
  );
}

/** Mail settings, Inbox on phones: tabs, order, reading (iOS rows). */
export function InboxSettingsScreen({ onBack }: { onBack: () => void }) {
  const [prefs, update] = useMailPrefs();
  return (
    <PushScreen title={t('Inbox')} onBack={onBack} iconBack className="g-page gm-settings">
      <Group title={t('Inbox tabs')} footer={t('Primary shows the rest. Move an email to another tab and that sender’s mail goes there from now on.')}>
        {(['promotions', 'social', 'updates', 'forums'] as const).map((c) => (
          <SwitchRow key={c} label={categoryName(c)} sub={t(CATEGORY_HINT[c])} on={!!prefs.tabs[c]} onChange={(v) => update((p) => ({ tabs: { ...p.tabs, [c]: v } }))} />
        ))}
      </Group>
      <Group title={t('Inbox order')}>
        <ChoiceRow label={t('Show first')} value={prefs.inboxType} options={typeWords().map((x) => ({ value: x.value, label: x.label, hint: x.hint }))} onChange={(inboxType) => update({ inboxType })} />
      </Group>
      <Group title={t('Reading')} footer={prefs.conversation ? t('Replies are kept together with the email they answer.') : t('Each email is its own row in the list.')}>
        <SwitchRow label={t('Conversation view')} on={prefs.conversation} onChange={(conversation) => update({ conversation })} />
        <ChoiceRow label={t('After Done or Delete')} value={prefs.advance} options={advanceWords().map((x) => ({ value: x.value, label: x.label, hint: x.hint }))} onChange={(advance) => update({ advance })} />
      </Group>
      {prefs.saved.length > 0 && (
        <Group title={t('Saved searches')} footer={t('Saved from search. They’re in the drawer.')}>
          {prefs.saved.map((s) => (
            <GRow key={s.id} label={s.name} sub={s.q} accessory={
              <button type="button" className="icon-btn" aria-label={t('Remove saved search {name}', { name: s.name })} onClick={() => update((p) => ({ saved: p.saved.filter((x) => x.id !== s.id) }))}>
                <X size={20} />
              </button>
            } />
          ))}
        </Group>
      )}
    </PushScreen>
  );
}

/** What the inbox settings say in one line (the phone's Mail settings row). */
export function inboxSummary(p: ReturnType<typeof useMailPrefs>[0]) {
  const n = tabsOn(p).length;
  return n > 1 ? tn(n, '{n} tab', '{n} tabs') + ', ' + typeWords().find((x) => x.value === p.inboxType)!.label : typeWords().find((x) => x.value === p.inboxType)!.label;
}

/** Phones: a saved search running on the list, with the search itself and a way back to the inbox. */
export function QueryBar({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="gm-query-bar">
      <Search size={16} />
      <span>{query}</span>
      <button type="button" className="gm-icon" onClick={onClear} aria-label={t('Clear search')}>
        <X size={20} />
      </button>
    </div>
  );
}
