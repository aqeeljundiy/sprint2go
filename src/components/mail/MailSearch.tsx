import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Clock, LayoutGrid, Search, X } from 'lucide-react';
import type { Client, Label, Person, Thread, User } from '../../types';
import { lastMessage } from '../../utils';
import { isMine } from '../../identity';
import { PushScreen } from '../ui/PushScreen';
import { Sheet } from '../ui/Sheet';
import { Avatar } from '../Avatar';
import { MailRow } from '../MessageList';
import { t } from '../../i18n';

type DateRange = '7' | '30' | '180' | '365';
type Filters = { unread: boolean; starred: boolean; files: boolean; assigned: boolean; from: Person | null; to: Person | null; date: DateRange | null };
const NONE: Filters = { unread: false, starred: false, files: false, assigned: false, from: null, to: null, date: null };
const dateWords = (d: DateRange) => ({ '7': t('Last 7 days'), '30': t('Last 30 days'), '180': t('Last 6 months'), '365': t('Last year') })[d];

const recentKey = (me: string) => `s2g-mail-searches:${me}`;
function readRecent(me: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(me)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function saveRecent(me: string, q: string) {
  const list = [q, ...readRecent(me).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
  try {
    localStorage.setItem(recentKey(me), JSON.stringify(list));
  } catch {}
  return list;
}

/**
 * Mail's search on phones (Gmail's): back, the field and clear in the same box as the inbox's pill; recent searches;
 * people as you type; results as inbox rows with the words in bold, under Gmail's filter chips. "All apps" opens the
 * suite's search.
 */
export function MailSearch(p: {
  threads: Thread[];
  me: Person;
  meId: string;
  clientOf: (t: Thread) => Client | undefined;
  labels: Label[];
  personOf: (id: string) => User | undefined;
  sharedMail: (t: Thread) => boolean;
  assignChip: boolean;
  showSnippets: boolean;
  onStar: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  onAllApps?: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [done, setDone] = useState(false); // Enter pressed: the keyboard goes and only results show
  const [f, setF] = useState<Filters>(NONE);
  const [recent, setRecent] = useState(() => readRecent(p.meId));
  const [pick, setPick] = useState<'from' | 'to' | 'date' | null>(null);
  const [pickQ, setPickQ] = useState('');
  const words = q.trim().toLowerCase();
  const filtering = f.unread || f.starred || f.files || f.assigned || !!f.from || !!f.to || !!f.date;

  // Everyone in these emails, most frequent first (the people suggestions and the From and To pickers).
  const people = useMemo(() => {
    const from = new Map<string, { p: Person; n: number }>();
    const to = new Map<string, { p: Person; n: number }>();
    for (const th of p.threads)
      for (const m of th.messages) {
        if (!isMine(m.from.email)) from.set(m.from.email.toLowerCase(), { p: m.from, n: (from.get(m.from.email.toLowerCase())?.n ?? 0) + 1 });
        for (const r of [...m.to, ...(m.cc ?? [])]) if (!isMine(r.email)) to.set(r.email.toLowerCase(), { p: r, n: (to.get(r.email.toLowerCase())?.n ?? 0) + 1 });
      }
    const sort = (m: Map<string, { p: Person; n: number }>) => [...m.values()].sort((a, b) => b.n - a.n).map((x) => x.p);
    return { from: sort(from), to: sort(to) };
  }, [p.threads]);

  const results = useMemo(() => {
    if (!words && !filtering) return [];
    const since = f.date ? new Date(Date.now() - Number(f.date) * 86400_000).toISOString() : '';
    const has = (list: Person[], who: Person) => list.some((x) => x.email.toLowerCase() === who.email.toLowerCase());
    return p.threads
      .filter(
        (th) =>
          (!f.unread || th.unread) &&
          (!f.starred || th.starred) &&
          (!f.files || th.messages.some((m) => m.attachments?.length)) &&
          (!f.assigned || th.assignee === p.meId) &&
          (!f.from || th.messages.some((m) => has([m.from], f.from!))) &&
          (!f.to || th.messages.some((m) => has([...m.to, ...(m.cc ?? [])], f.to!))) &&
          (!since || lastMessage(th).date >= since) &&
          (!words || words.split(/\s+/).every((w) => th.subject.toLowerCase().includes(w) || th.messages.some((m) => m.from.name.toLowerCase().includes(w) || m.from.email.toLowerCase().includes(w) || m.body.toLowerCase().includes(w)))),
      )
      .sort((a, b) => lastMessage(b).date.localeCompare(lastMessage(a).date))
      .slice(0, 100);
  }, [p.threads, words, f, filtering, p.meId]);
  const latest = useMemo(() => [...p.threads].sort((a, b) => lastMessage(b).date.localeCompare(lastMessage(a).date)).slice(0, 5), [p.threads]);
  const matches = words && !done ? people.from.filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(words)).slice(0, 3) : [];

  const commit = (text = q) => {
    const s = text.trim();
    if (s) setRecent(saveRecent(p.meId, s));
    setQ(text);
    setDone(true);
    input.current?.blur();
  };
  const row = (th: Thread, hl?: string) => (
    <li key={th.id} className="row-li">
      <MailRow
        t={th}
        me={p.me}
        meId={p.meId}
        client={p.clientOf(th)}
        labels={p.labels}
        personOf={p.personOf}
        team={false}
        shared={p.sharedMail(th)}
        snippets={p.showSnippets}
        phone
        current={false}
        picked={false}
        selecting={false}
        leaving={false}
        hl={hl}
        onOpen={() => p.onOpen(th.id)}
        onToggle={() => p.onOpen(th.id)}
        onHold={() => {}}
        onMenu={() => {}}
        onStar={() => p.onStar(th.id, !th.starred)}
        onDone={() => {}}
        onTrash={() => {}}
        onSnooze={() => {}}
      />
    </li>
  );
  const chip = (on: boolean, label: string, toggle: () => void, caret = false) => (
    <button type="button" className={`gm-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={toggle}>
      <span className="gm-chip-face">
        <Check size={16} className="gm-chip-check" aria-hidden="true" />
        {label}
        {caret && <ChevronDown size={16} className="gm-chip-caret" aria-hidden="true" />}
      </span>
    </button>
  );
  const pickList = pick === 'from' ? people.from : pick === 'to' ? people.to : [];
  const pq = pickQ.trim().toLowerCase();

  return (
    <PushScreen title={t('Search in mail')} onBack={p.onClose} iconBack className="mail-search">
      <div className="gm-search gm-search-field">
        <button type="button" className="gm-icon" onClick={p.onClose} aria-label={t('Back')}>
          <ArrowLeft size={22} />
        </button>
        <input
          ref={input}
          className="gm-input"
          value={q}
          enterKeyHint="search"
          onChange={(e) => (setQ(e.target.value), setDone(false))}
          onFocus={() => setDone(false)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          placeholder={t('Search in mail')}
          aria-label={t('Search in mail')}
        />
        {q && (
          <button type="button" className="gm-icon" onClick={() => (setQ(''), setDone(false), input.current?.focus())} aria-label={t('Clear')}>
            <X size={22} />
          </button>
        )}
      </div>
      <div className="gm-chips" role="group" aria-label={t('Show only')}>
        {chip(f.unread, t('Unread'), () => setF({ ...f, unread: !f.unread }))}
        {chip(f.starred, t('Starred'), () => setF({ ...f, starred: !f.starred }))}
        {chip(f.files, t('Has attachment'), () => setF({ ...f, files: !f.files }))}
        {chip(!!f.from, f.from ? t('From: {name}', { name: f.from.name || f.from.email }) : t('From'), () => (f.from ? setF({ ...f, from: null }) : (setPickQ(''), setPick('from'))), !f.from)}
        {chip(!!f.to, f.to ? t('To: {name}', { name: f.to.name || f.to.email }) : t('To'), () => (f.to ? setF({ ...f, to: null }) : (setPickQ(''), setPick('to'))), !f.to)}
        {p.assignChip && chip(f.assigned, t('Assigned to me'), () => setF({ ...f, assigned: !f.assigned }))}
        {chip(!!f.date, f.date ? dateWords(f.date) : t('Date'), () => (f.date ? setF({ ...f, date: null }) : setPick('date')), !f.date)}
        {p.onAllApps && (
          <button type="button" className="gm-chip" onClick={() => (p.onClose(), p.onAllApps!())}>
            <span className="gm-chip-face">
              <LayoutGrid size={16} aria-hidden="true" />
              {t('All apps')}
            </span>
          </button>
        )}
      </div>

      <div className="gm-results">
        {!words && !filtering ? (
          <>
            {recent.length > 0 && (
              <>
                <div className="gm-label">{t('Recent')}</div>
                <ul className="gm-list">
                  {recent.map((r) => (
                    <li key={r}>
                      <button type="button" className="gm-suggest" onClick={() => commit(r)}>
                        <Clock size={20} />
                        <span>{r}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {latest.length > 0 && (
              <>
                <div className="gm-label">{t('Latest in mail')}</div>
                <ul className="rows gm-rows">{latest.map((th) => row(th))}</ul>
              </>
            )}
          </>
        ) : (
          <>
            {matches.length > 0 && (
              <ul className="gm-list">
                {matches.map((x) => (
                  <li key={x.email}>
                    <button type="button" className="gm-suggest person" onClick={() => (setF({ ...f, from: x }), setQ(''), setDone(true), input.current?.blur())}>
                      <Avatar person={x} size={32} />
                      <span className="gm-suggest-text">
                        <span>{x.name || x.email}</span>
                        <small>{x.email}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {words && !done && (
              <button type="button" className="gm-suggest" onClick={() => commit()}>
                <Search size={20} />
                <span>{t('Search for “{q}” in mail', { q: q.trim() })}</span>
              </button>
            )}
            {results.length > 0 ? (
              <>
                <div className="gm-label">{t('Results in mail')}</div>
                <ul className="rows gm-rows">{results.map((th) => row(th, q))}</ul>
              </>
            ) : (
              <div className="gm-none">
                <p className="empty-title">{t('No matches')}</p>
                <p className="empty-sub">{words ? t('Nothing found for “{query}”. Try a name, an email address or a few words from the subject.', { query: q.trim() }) : t('No emails match these filters.')}</p>
              </div>
            )}
          </>
        )}
      </div>

      {pick === 'date' && (
        <Sheet title={t('Date')} onClose={() => setPick(null)}>
          <div className="as-list">
            {(['7', '30', '180', '365'] as DateRange[]).map((d) => (
              <button key={d} type="button" className="as-item" onClick={() => (setF({ ...f, date: d }), setPick(null))}>
                <span className="as-label">{dateWords(d)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {(pick === 'from' || pick === 'to') && (
        <Sheet title={pick === 'from' ? t('From') : t('To')} onClose={() => setPick(null)} size="tall">
          <label className="sheet-search">
            <Search size={16} />
            <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder={t('Find…')} aria-label={t('Find a person')} />
          </label>
          <div className="as-list">
            {pickList
              .filter((x) => !pq || `${x.name} ${x.email}`.toLowerCase().includes(pq))
              .slice(0, 40)
              .map((x) => (
                <button key={x.email} type="button" className="as-item" onClick={() => (setF({ ...f, [pick]: x }), setPick(null))}>
                  <Avatar person={x} size={28} />
                  <span className="as-label">
                    {x.name || x.email}
                    <small>{x.email}</small>
                  </span>
                </button>
              ))}
            {pickList.length === 0 && <p className="sheet-empty">{t('Nobody yet')}</p>}
          </div>
        </Sheet>
      )}
    </PushScreen>
  );
}
