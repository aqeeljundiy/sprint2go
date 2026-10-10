import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { LargeTitle } from '../../mobile/TopBar';
import { t } from '../../i18n';

export interface BrowseRow {
  id: string;
  label: string;
  icon: ReactNode; // a 22 px line icon in the accent colour, or a project's coloured "#"
  hint?: string; // on the right: "3 late", "2 to review"
  tone?: 'danger' | 'accent'; // the hint's colour (grey when not set)
  muted?: boolean; // a grey row (Past projects)
  run: () => void;
  menu?: SheetAction[]; // long-press (right-click on a computer)
}
export interface BrowseGroup {
  id: string;
  title?: string; // none for the first card (Today, Upcoming, My tasks)
  add?: { label: string; run: () => void }; // a "+" on the group's header (New project)
  rows: BrowseRow[];
}

/**
 * Tasks on a phone, one level up (Todoist's Browse, iOS Mail's Mailboxes): the root of the Tasks stack, reached with
 * "‹ Tasks" or by tapping Tasks in the bar again. Grouped cards: Today, Upcoming, My tasks; the team's queues and
 * reviews; the projects; saved views; then this app's settings. The Projects app's list on a phone is the same page.
 */
export function TasksBrowse({ groups, app = 'tasks', title, top }: { groups: BrowseGroup[]; app?: 'tasks' | 'projects'; title?: string; top?: ReactNode }) {
  return (
    <section className="tasks-pane tasks-browse view-enter">
      <div className="tracking-scroll tbr-scroll">
        <LargeTitle app={app}>
          <h1 className="tv-title">{title ?? t('Tasks')}</h1>
        </LargeTitle>
        {top}
        {groups
          .filter((g) => g.rows.length || g.add)
          .map((g) => (
            <section key={g.id} className="tbr-group" aria-label={g.title}>
              {g.title && (
                <header className="tbr-head">
                  <h2>{g.title}</h2>
                  {g.add && (
                    <button type="button" className="icon-btn tbr-add" onClick={g.add.run} aria-label={g.add.label} title={g.add.label}>
                      <Plus size={20} />
                    </button>
                  )}
                </header>
              )}
              {g.rows.length > 0 && (
                <div className="tbr-card">
                  {g.rows.map((r) => (
                    <Row key={r.id} r={r} />
                  ))}
                </div>
              )}
            </section>
          ))}
      </div>
    </section>
  );
}

function Row({ r }: { r: BrowseRow }) {
  const m = useActionMenu(r.menu ?? [], { title: r.label, disabled: !r.menu?.length });
  return (
    <>
      <button type="button" className={`tbr-row lp${r.muted ? ' muted' : ''}`} onClick={r.run} {...(r.menu?.length ? m.bind : {})}>
        <span className="tbr-icon">{r.icon}</span>
        <span className="tbr-label">{r.label}</span>
        {r.hint && <span className={`tbr-hint${r.tone ? ` ${r.tone}` : ''}`}>{r.hint}</span>}
        <ChevronRight size={16} className="tbr-chev" />
      </button>
      {m.menu}
    </>
  );
}
