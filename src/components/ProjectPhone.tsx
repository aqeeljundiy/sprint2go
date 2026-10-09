import { useContext, useEffect, useState } from 'react';
import { Archive, BarChart3, ChevronRight, FileText, Hash, KeyRound, LayoutDashboard, LayoutTemplate, ListChecks, Mail, NotebookPen, Receipt, Table2, UserPlus, Video, type LucideIcon } from 'lucide-react';
import { term } from '../terms';
import type { Client } from '../types';
import { usePersisted } from '../settings';
import { arrange, TabDefaultsCtx, type TabItem, type TabPrefs } from './ui/TabBar';
import { useFocusedScreen, useTitleMenu } from '../mobile/chrome';
import { usePhone } from '../mobile/media';

/**
 * A project's page on phones. Desktop shows its parts as a row of tabs; a phone has no room for 12 tabs, so:
 * - the project's home (Overview) lists the other parts, each a row you tap (ProjectSections);
 * - the screen title is a switcher to jump to any part, or to another project (useProjectPhone);
 * - inside a part, Back returns to the project's home before it returns to the list of projects.
 */

export type ProjectTab = 'overview' | 'tasks' | 'workload' | 'quotes' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal';

const ICONS: Record<ProjectTab, LucideIcon> = {
  overview: LayoutDashboard,
  tasks: ListChecks,
  workload: BarChart3,
  quotes: Receipt,
  chat: Hash,
  emails: Mail,
  meetings: Video,
  files: FileText,
  notes: NotebookPen,
  tables: Table2,
  logins: KeyRound,
  portal: UserPlus,
};

/** The parts of a project, as tabs: Overview first. `label` carries what needs a look ("Tasks · 1 late"). */
export function projectTabs(o: { late: number; unreadMail: number; quotes: boolean; quoteWaiting: boolean; tables: boolean }): TabItem[] {
  return (
    [
      ['overview', 'Overview', 'Overview'],
      ['tasks', o.late ? `Tasks · ${o.late} late` : 'Tasks', 'Tasks'],
      ['workload', 'Workload', 'Workload'],
      ...(o.quotes ? ([['quotes', o.quoteWaiting ? 'Quotes · waiting' : 'Quotes', 'Quotes']] as const) : []),
      ['chat', 'Chat', 'Chat'],
      ['emails', o.unreadMail ? `Mail · ${o.unreadMail} unread` : 'Mail', 'Mail'],
      ['meetings', 'Meetings', 'Meetings'],
      ['files', 'Files', 'Files'],
      ['notes', 'Notes', 'Notes'],
      ...(o.tables ? ([['tables', 'Tables', 'Tables']] as const) : []),
      ['logins', 'Logins', 'Logins'],
      ['portal', 'Guests', 'Guests'],
    ] as const
  ).map(([id, label, name]) => ({ id, label, name }));
}

/** The tabs in the order this person (or the company) chose on desktop, with the ones they hid left out. */
function useArranged(items: TabItem[]) {
  const shared = useContext(TabDefaultsCtx);
  const [mine] = usePersisted<TabPrefs | null>('s2g-tabs:project-tabs', null);
  const prefs = mine ?? shared.defaults['project-tabs'] ?? null;
  const hidden = new Set((prefs?.hidden ?? []).filter((id) => id !== 'overview'));
  return { all: arrange(items, prefs), shown: arrange(items, prefs).filter((t) => !hidden.has(t.id)) };
}

const noteOf = (t: TabItem) => (typeof t.label === 'string' && t.label.includes(' · ') ? t.label.split(' · ').slice(1).join(' · ') : '');

/**
 * The phone's title switcher and Back for a project's page. Call it before any early return. `others` are the projects
 * to jump to; `onProject(null)` goes back to the list of all of them, `'past'` to past projects.
 */
export function useProjectPhone({ client, items, tab, onTab, others, onProject }: { client: Client | undefined; items: TabItem[]; tab: string; onTab: (t: ProjectTab) => void; others: Client[]; onProject: (id: string | null | 'past') => void }) {
  const { all } = useArranged(items);
  const value = tab === 'overview' && client ? `p:${client.id}` : `tab:${tab}`;
  useTitleMenu(
    'projects',
    client && {
      label: client.name,
      value,
      options: [
        ...all.map((t) => {
          const Icon = ICONS[t.id as ProjectTab] ?? FileText;
          return { value: `tab:${t.id}`, label: t.name ?? t.id, hint: noteOf(t) || undefined, group: `In this ${term.one}`, icon: <Icon size={18} /> };
        }),
        { value: 'p:all', label: `All ${term.many}`, group: term.Many },
        ...others.filter((c) => c.status !== 'ended').map((c) => ({ value: `p:${c.id}`, label: c.name, group: term.Many })),
        { value: 'p:past', label: `Past ${term.many}`, group: term.Many },
      ],
      onChange: (v) => {
        if (v.startsWith('tab:')) return onTab(v.slice(4) as ProjectTab);
        const id = v.slice(2);
        if (id === client.id) return onTab('overview');
        onProject(id === 'all' ? null : id === 'past' ? 'past' : id);
      },
    },
  );
  // Inside a part, Back goes to the project's home. Registered a moment after the page opens, so it comes after (and
  // wins over) the project page's own Back to the list.
  const phone = usePhone();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);
  useFocusedScreen(ready && phone && !!client && tab !== 'overview', () => onTab('overview'));
}

/** The project's home on phones: its parts as rows, with what needs a look on the right. Hidden on desktop (tabs). */
export function ProjectSections({ items, onTab, actions = [] }: { items: TabItem[]; onTab: (t: ProjectTab) => void; actions?: { id: string; label: string; danger?: boolean; run: () => void }[] }) {
  const phone = usePhone();
  const { shown } = useArranged(items);
  if (!phone) return null;
  return (
    <nav className="proj-sections" aria-label={`This ${term.one}`}>
      {shown
        .filter((t) => t.id !== 'overview')
        .map((t) => {
          const Icon = ICONS[t.id as ProjectTab] ?? FileText;
          const note = noteOf(t);
          return (
            <button key={t.id} type="button" className="proj-sec-row" onClick={() => onTab(t.id as ProjectTab)}>
              <span className="proj-sec-icon">
                <Icon size={17} />
              </span>
              <span className="proj-sec-name">{t.name}</span>
              {note && <span className={`proj-sec-note${/late|unread|waiting/.test(note) ? ' warn' : ''}`}>{note}</span>}
              <ChevronRight size={18} className="proj-sec-chev" />
            </button>
          );
        })}
      {actions.length > 0 && (
        <div className="proj-sec-actions">
          {actions.map((a) => (
            <button key={a.id} type="button" className={`proj-sec-row${a.danger ? ' danger' : ''}`} onClick={a.run}>
              <span className="proj-sec-icon">{a.danger ? <Archive size={17} /> : <LayoutTemplate size={17} />}</span>
              <span className="proj-sec-name">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
