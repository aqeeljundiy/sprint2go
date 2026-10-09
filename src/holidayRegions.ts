// Which countries' public holidays a person sees. Each person picks any of the countries we have (Calendar, Public
// holidays); until they do, it's the company's country. The company's own holiday calendar (the server keeps one per
// company) shows when its country is among theirs; any other country is read from /api/holidays/<code> and shows as a
// calendar of their own, on this device only, never saved as events.
import { useEffect, useMemo, useState } from 'react';
import type { CalEvent, CalendarDef } from './types';
import { HOLIDAY_COUNTRIES, holidayCountry } from './data/holidays';
import { getLang, mark, t } from './i18n/index'; // the full path: the unit tests load this file

/** The id of a person's own holiday calendar for a country (the company's is holidayCalendarId). */
export const personalHolidayId = (code: string) => `hol-x-${code}`;
export const isPersonalHoliday = (calendarId: string) => calendarId.startsWith('hol-x-');
const COLORS = ['#ea580c', '#0d9488', '#7c3aed', '#db2777', '#2563eb', '#65a30d'];

type HolidayList = { holidays: { date: string; end: string; name: string; regions?: string; half?: boolean; tentative?: boolean }[]; at?: string; error?: string };
/** Each country's list, read once per page load (holidays rarely move; the server checks daily). */
const cache = new Map<string, Promise<HolidayList>>();
const load = (code: string) => {
  let p = cache.get(code);
  if (!p) {
    p = fetch(`/api/holidays/${code}`)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as HolidayList & { error?: string };
        return r.ok ? d : { holidays: [], error: d.error ?? mark('The holidays couldn’t be read. They’re tried again next time.') };
      })
      .catch(() => ({ holidays: [], error: mark('Couldn’t reach the server. They’re tried again next time.') })); // English here, shown with t(error)
    p.then((d) => d.error && cache.delete(code)); // a failure is tried again on the next look
    cache.set(code, p);
  }
  return p;
};

/** The countries this person sees: their own choice, or (until they choose) the company's country. */
export function regionsOf(chosen: string[] | undefined, companyCountry: string | undefined) {
  return (chosen ?? (companyCountry ? [companyCountry] : [])).filter((c) => !!holidayCountry(c));
}
/** What to save: no choice of their own when it's just the company's country (so a new company country follows). */
export function regionsToSave(codes: string[], companyCountry: string | undefined): string[] | undefined {
  const order = HOLIDAY_COUNTRIES.map((c) => c.code);
  const list = order.filter((c) => codes.includes(c));
  return companyCountry && list.length === 1 && list[0] === companyCountry ? undefined : list;
}

export function useHolidayRegions({ chosen, companyCountry, live }: { chosen: string[] | undefined; companyCountry: string | undefined; live: boolean }) {
  const regions = useMemo(() => regionsOf(chosen, companyCountry), [chosen, companyCountry]);
  const extra = useMemo(() => regions.filter((c) => c !== companyCountry), [regions, companyCountry]);
  const [lists, setLists] = useState<Record<string, HolidayList>>({});
  const lang = getLang(); // the names and notes below are words (the app re-renders on a switch)
  const key = extra.join(',');
  useEffect(() => {
    if (!live) return;
    let on = true;
    for (const code of extra) void load(code).then((d) => on && setLists((l) => (l[code] === d ? l : { ...l, [code]: d })));
    return () => {
      on = false;
    };
  }, [key, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const calendars = useMemo<CalendarDef[]>(
    () =>
      extra.map((code, i) => ({
        id: personalHolidayId(code),
        name: t('Holidays in {country}', { country: t(holidayCountry(code)!.name) }),
        color: COLORS[i % COLORS.length],
        source: 'holidays',
        readOnly: true,
        share: 'details',
        country: code,
        ...(lists[code]?.at ? { syncedAt: lists[code].at } : {}),
        ...(lists[code]?.error ? { error: t(lists[code].error!) } : !live ? { error: t('Other countries’ holidays come from the server, so they don’t show in this preview.') } : {}),
      })),
    [key, lists, live, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const events = useMemo<CalEvent[]>(
    () =>
      extra.flatMap((code) => {
        const name = t(holidayCountry(code)!.name);
        return (lists[code]?.holidays ?? []).map((h, i) => ({
          id: `${personalHolidayId(code)}-${h.date}-${i}`,
          calendarId: personalHolidayId(code),
          feed: 'holidays' as const,
          title: h.name,
          start: `${h.date}T00:00:00`,
          end: `${h.end}T00:00:00`,
          allDay: true,
          notes: [h.regions ? t('Public holiday in {regions} only.', { regions: h.regions }) : t('Public holiday in {country}.', { country: name }), h.half ? t('A half day.') : '', h.tentative ? t('The date may still change.') : ''].filter(Boolean).join(' '),
        }));
      }),
    [key, lists, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { regions, showCompany: !!companyCountry && regions.includes(companyCountry), calendars, events };
}
