import { useEffect, useState } from 'react';
import { CalendarDays, CalendarRange, Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { repeatWords, type Scope } from '../../repeat';
import { ActionSheet } from '../ui/ActionSheet';
import { Sheet } from '../ui/Sheet';
import { isPhone } from '../../mobile/media';
import { t } from '../../i18n';
import { fmtWeekday } from '../../i18n/format';

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
  const [picked, setPicked] = useState<Scope | null>(null);
  useEffect(() => setPicked(null), [ask]);
  const e = ask?.event;
  const day = e ? fmtWeekday(e.start) : '';
  const all = e ? repeatWords({ rrule: e.rrule, start: e.occurrence ?? e.start, timeZone: e.timeZone }) : null;
  const label: Record<Scope, { label: string; hint: string; icon: typeof Repeat }> = {
    one: { label: t('This event'), hint: day, icon: CalendarDays },
    following: { label: t('This and following events'), hint: t('From {day} on', { day }), icon: CalendarRange },
    all: { label: t('All events'), hint: all ?? '', icon: Repeat },
  };
  // Phones (Google's look): plain rows with the date under each and a radio at the right; a tap fills the radio and
  // the change happens a moment later, so the tap is seen. Every change here can be undone from its toast.
  if (isPhone())
    return ask ? (
      <Sheet
        title={ask.title}
        onClose={() => ask.done(null)}
        className="scope-sheet"
        head={
          <button type="button" className="link-btn scope-cancel" onClick={() => ask.done(null)}>
            {t('Cancel')}
          </button>
        }
      >
        <div className="scope-list" role="radiogroup" aria-label={ask.title}>
          {ask.options.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={picked === s}
              className={`scope-opt${picked === s ? ' on' : ''}`}
              onClick={() => {
                if (picked) return;
                setPicked(s);
                setTimeout(() => ask.done(s), 150);
              }}
            >
              <span className="scope-text">
                {label[s].label}
                {label[s].hint && <small>{label[s].hint}</small>}
              </span>
              <span className="rp-radio" aria-hidden />
            </button>
          ))}
        </div>
      </Sheet>
    ) : null;
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
