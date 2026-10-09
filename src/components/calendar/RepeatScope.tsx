import { useEffect, useState } from 'react';
import { CalendarDays, CalendarRange, Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { repeatWords, type Scope } from '../../repeat';
import { ActionSheet } from '../ui/ActionSheet';
import { isPhone } from '../../mobile/media';

type Ask = { title: string; at: { x: number; y: number } | null; options: Scope[]; event: CalEvent; done: (s: Scope | null) => void };
let show: ((a: Ask | null) => void) | null = null;

/** Where the question shows: next to a button, or where the pointer let go. */
export type ScopeAt = { x: number; y: number } | Element | null | undefined;

/**
 * Asks which dates a change to one date of a repeating event is for: This event, This and following events, or All
 * events. A small sheet on phones, a menu by the button (or where a drag ended) on desktop. Resolves null when it's
 * closed without a choice: nothing changes then.
 */
export function askScope(event: CalEvent, title: string, at?: ScopeAt, options: Scope[] = ['one', 'following', 'all']): Promise<Scope | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    const point = at instanceof Element ? (({ left, bottom }) => ({ x: left, y: bottom + 4 }))(at.getBoundingClientRect()) : (at ?? null);
    let settled = false;
    show({
      title,
      at: point,
      options,
      event,
      done: (s) => {
        if (settled) return;
        settled = true;
        show?.(null);
        resolve(s);
      },
    });
  });
}

/** The one place the question is drawn (App puts it at page level). */
export function ScopeHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    show = setAsk;
    return () => {
      show = null;
    };
  }, []);
  const e = ask?.event;
  const day = e ? new Date(e.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const all = e ? repeatWords({ rrule: e.rrule, start: e.occurrence ?? e.start, timeZone: e.timeZone }) : null;
  const label: Record<Scope, { label: string; hint: string; icon: typeof Repeat }> = {
    one: { label: 'This event', hint: day, icon: CalendarDays },
    following: { label: 'This and following events', hint: `From ${day} on`, icon: CalendarRange },
    all: { label: 'All events', hint: all ?? '', icon: Repeat },
  };
  return (
    <ActionSheet
      open={!!ask}
      // A choice closes it first and then runs: the close waits a moment so the choice wins.
      onClose={() => setTimeout(() => ask?.done(null))}
      title={ask?.title}
      // The sheet on phones has its own title; the menu on desktop gets a quiet one.
      header={ask && !isPhone() ? <div className="scope-head">{ask.title}</div> : undefined}
      at={ask?.at}
      width={260}
      className="scope-sheet"
      actions={(ask?.options ?? []).map((s) => ({ id: s, ...label[s], hint: label[s].hint || undefined, run: () => ask?.done(s) }))}
    />
  );
}
