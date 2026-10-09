import { useContext, useEffect, useState } from 'react';
import { Archive, BarChart3, ChevronRight, FileText, Hash, KeyRound, LayoutDashboard, LayoutTemplate, ListChecks, Mail, NotebookPen, Receipt, Table2, UserPlus, Video, type LucideIcon } from 'lucide-react';
import { term } from '../terms';
import type { Client } from '../types';
import { usePersisted } from '../settings';
import { arrange, TabDefaultsCtx, type TabItem, type TabPrefs } from './ui/TabBar';
import { useFocusedScreen, useTitleMenu } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { t, tn } from '../i18n';

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

/** The parts of a project, as tabs: Overview first. `label` carries what needs a look ("Tasks · 1 late"); `note` is that part. */
export function projectTabs(o: { late: number; unreadMail: number; quotes: boolean; quoteWaiting: boolean; tables: boolean }): (TabItem & { note?: string })[] {
  const tab = (id: ProjectTab, name: string, note?: string) => ({ id, name, label: note ? `${name} · ${note}` : name, note });
  return [
    tab('overview', t('Overview')),
    tab('tasks', t('Tasks'), o.late ? tn(o.late, '{n} late', '{n} late') : undefined),
    tab('workload', t('Workload')),
    ...(o.quotes ? [tab('quotes', t('Quotes'), o.quoteWaiting ? t('waiting') : undefined)] : []),
    tab('chat', t('Chat')),
    tab('emails', t('Mail'), o.unreadMail ? tn(o.unreadMail, '{n} unread', '{n} unread') : undefined),
    tab('meetings', t('Meetings')),
    tab('files', t('Files')),
    tab('notes', t('Notes')),
    ...(o.tables ? [tab('tables', t('Tables'))] : []),
    tab('logins', t('Logins')),
    tab('portal', t('Guests')),
  ];
}

/** The tabs in the order this person (or the company) chose on desktop, with the ones they hid left out. */
function useArranged(items: TabItem[]) {
  const shared = useContext(TabDefaultsCtx);
  const [mine] = usePersisted<TabPrefs | null>('s2g-tabs:project-tabs', null);
  const prefs = mine ?? shared.defaults['project-tabs'] ?? null;
  const hidden = new Set((prefs?.hidden ?? []).filter((id) => id !== 'overview'));
  return { all: arrange(items, prefs), shown: arrange(items, prefs).filter((t) => !hidden.has(t.id)) };
}

/** What needs a look on a part ("1 late"): every note is a warning. */
const noteOf = (tab: TabItem & { note?: string }) => tab.note ?? '';

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
        ...all.map((tab) => {
          const Icon = ICONS[tab.id as ProjectTab] ?? FileText;
          return { value: `tab:${tab.id}`, label: tab.name ?? tab.id, hint: noteOf(tab) || undefined, group: t('In this {project}', { project: term.one }), icon: <Icon size={18} /> };
        }),
        { value: 'p:all', label: t('All {projects}', { projects: term.many }), group: term.Many },
        ...others.filter((c) => c.status !== 'ended').map((c) => ({ value: `p:${c.id}`, label: c.name, group: term.Many })),
        { value: 'p:past', label: t('Past {projects}', { projects: term.many }), group: term.Many },
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
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  useFocusedScreen(ready && phone && !!client && tab !== 'overview', () => onTab('overview'));
}

/** The project's home on phones: its parts as rows, with what needs a look on the right. Hidden on desktop (tabs). */
export function ProjectSections({ items, onTab, actions = [] }: { items: TabItem[]; onTab: (t: ProjectTab) => void; actions?: { id: string; label: string; danger?: boolean; run: () => void }[] }) {
  const phone = usePhone();
  const { shown } = useArranged(items);
  if (!phone) return null;
  return (
    <nav className="proj-sections" aria-label={t('This {project}', { project: term.one })}>
      {shown
        .filter((tab) => tab.id !== 'overview')
        .map((tab) => {
          const Icon = ICONS[tab.id as ProjectTab] ?? FileText;
          const note = noteOf(tab);
          return (
            <button key={tab.id} type="button" className="proj-sec-row" onClick={() => onTab(tab.id as ProjectTab)}>
              <span className="proj-sec-icon">
                <Icon size={17} />
              </span>
              <span className="proj-sec-name">{tab.name}</span>
              {note && <span className="proj-sec-note warn">{note}</span>}
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
