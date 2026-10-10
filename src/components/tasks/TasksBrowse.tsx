import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';

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
 * Tasks on a phone, one level up (Todoist's Browse, iOS Mail's Mailboxes): the Browse part of the switch under the
 * top bar, or Tasks in the bar tapped again. Grouped cards: Today, Upcoming, My tasks; the team's queues and
 * reviews; the projects; saved views; then this app's settings. The Projects app's list on a phone is the same page.
 */
export function TasksBrowse({ groups, top }: { groups: BrowseGroup[]; top?: ReactNode }) {
  // The title is the top bar's (24/700); no large title row.
  return (
    <section className="tasks-pane tasks-browse view-enter">
      <div className="tracking-scroll tbr-scroll">
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
