import type { CalEvent, CalendarDef, Person } from '../types';
import { addDays, startOfDay, startOfWeek } from '../calendarUtils';

// Sample calendar. This gets replaced by Stalwart's calendar (CalDAV / JMAP Calendars) later.

export const CALENDARS: CalendarDef[] = [
  { id: 'work', name: 'Work', color: '#5b5bf6' },
  { id: 'clients', name: 'Clients', color: '#10b981' },
  { id: 'personal', name: 'Personal', color: '#f59e0b' },
  { id: 'reminders', name: 'Reminders', color: '#0ea5e9' },
];

const week = startOfWeek(new Date());

/** Date in the current week (day 0 = Monday; 7+ = next week) at hh:mm. */
const at = (day: number, h: number, m = 0) => {
  const d = addDays(week, day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** Next occurrence of a weekday (1 = Monday … 7 = Sunday), never today. */
export function nextWeekday(weekday: number, h: number, m = 0) {
  const today = startOfDay(new Date());
  const diff = ((weekday % 7) - today.getDay() + 7) % 7 || 7;
  const d = addDays(today, diff);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const sarah: Person = { name: 'Sarah Lim', email: 'sarah@luminaskin.sg' };
const faisal: Person = { name: 'Faisal Tirtonady', email: 'faisal@pixelandprofits.com' };
const aditya: Person = { name: 'Aditya Aisar', email: 'aditya@pixelandprofits.com' };
const rizky: Person = { name: 'Rizky Pratama', email: 'rizky@pixelandprofits.com' };

let n = 0;
const ev = (e: Omit<CalEvent, 'id'>): CalEvent => ({ id: `e${++n}`, ...e });

const standups = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((d) =>
  ev({
    title: 'Daily standup',
    calendarId: 'work',
    start: at(d, 9, 30),
    end: at(d, 9, 45),
    location: 'Google Meet',
    guests: [faisal, aditya, rizky],
  }),
);

export const EVENTS: CalEvent[] = [
  ...standups,
  ev({ title: 'Brand workshop', calendarId: 'work', start: at(2, 14), end: at(2, 15, 30), location: 'Office, Room 2', guests: [faisal, aditya], notes: 'Decide on palette and retire the gradient.' }),
  ev({ title: 'Focus: sprint2go UI', calendarId: 'work', start: at(3, 13), end: at(3, 16) }),
  ev({ title: 'Gym', calendarId: 'personal', start: at(5, 8), end: at(5, 9) }),
  ev({ title: 'Family dinner', calendarId: 'personal', start: at(5, 19), end: at(5, 21) }),
  ev({ title: 'Lumina Skin: 11.11 & 12.12 budget', calendarId: 'clients', start: at(7, 10, 30), end: at(7, 11, 15), location: 'Zoom', guests: [sarah], threadId: 't5' }),
  ev({ title: 'Interviews: performance marketer', calendarId: 'work', start: at(8, 10), end: at(8, 12), guests: [faisal, aditya], threadId: 't3' }),
  ev({ title: 'Invoice review', calendarId: 'work', start: at(8, 11), end: at(8, 11, 45) }),
  ev({ title: 'P&P staging review', calendarId: 'work', start: at(9, 15), end: at(9, 16), guests: [rizky] }),
  ev({ title: 'Lunch at the bakmi place 🍜', calendarId: 'personal', start: at(11, 12, 30), end: at(11, 13, 30), location: 'Bakmi place near the office', guests: [rizky], threadId: 't7' }),
  ev({ title: 'Figma plan renews', calendarId: 'reminders', start: at(11, 0), end: at(12, 0), allDay: true }),
  ev({ title: 'Contabo invoice due', calendarId: 'reminders', start: at(12, 0), end: at(13, 0), allDay: true }),
];

/* ---------- Outside calendars (Google, Outlook, iCloud, links, holidays) ---------- */

export const EXTERNAL_CALENDARS: CalendarDef[] = [
  { id: 'g-aqeel', name: 'Personal', color: '#4285f4', source: 'google', account: 'aqeel.jundiy@gmail.com', ownerId: 'u-aqeel', share: 'busy', syncedAt: new Date(Date.now() - 4 * 60_000).toISOString() },
  { id: 'hol-id-aqeel', name: 'Indonesian holidays', color: '#dc2626', source: 'holidays', ownerId: 'u-aqeel', readOnly: true, share: 'details' },
  { id: 'ms-faisal', name: 'Calendar', color: '#0078d4', source: 'microsoft', account: 'faisal@tirtonady.co', ownerId: 'u-faisal', share: 'busy', syncedAt: new Date(Date.now() - 9 * 60_000).toISOString() },
];

let x = 0;
const ext = (e: Omit<CalEvent, 'id'>): CalEvent => ({ id: `x${++x}`, ...e });

/** Sample events on outside calendars. These come from Google / Microsoft / links once the backend syncs them. */
export function externalEvents(cal: CalendarDef): CalEvent[] {
  const who = cal.ownerId;
  switch (cal.source) {
    case 'google':
      return [
        ext({ title: 'Dentist', calendarId: cal.id, start: at(1, 16), end: at(1, 17), userId: who, location: 'Klinik Gigi Senopati' }),
        ext({ title: 'Pick up kids', calendarId: cal.id, start: at(2, 15), end: at(2, 15, 45), userId: who }),
        ext({ title: 'Badminton', calendarId: cal.id, start: at(3, 18, 30), end: at(3, 20), userId: who }),
        ext({ title: 'Mum’s birthday dinner', calendarId: cal.id, start: at(9, 19), end: at(9, 21), userId: who }),
      ];
    case 'microsoft':
      return [
        ext({ title: 'Board meeting (Teams)', calendarId: cal.id, start: at(1, 10), end: at(1, 12), userId: who }),
        ext({ title: 'Investor call', calendarId: cal.id, start: at(2, 13), end: at(2, 14), userId: who }),
        ext({ title: 'Bank appointment', calendarId: cal.id, start: at(3, 9), end: at(3, 10), userId: who }),
        ext({ title: 'Client dinner', calendarId: cal.id, start: at(4, 18), end: at(4, 20), userId: who }),
      ];
    case 'icloud':
      return [
        ext({ title: 'Yoga', calendarId: cal.id, start: at(2, 7), end: at(2, 8), userId: who }),
        ext({ title: 'Car service', calendarId: cal.id, start: at(8, 9), end: at(8, 10, 30), userId: who }),
      ];
    case 'ics':
      return [
        ext({ title: 'Booked: Glowkind discovery call', calendarId: cal.id, start: at(2, 11), end: at(2, 11, 30), userId: who }),
        ext({ title: 'Booked: intro with Arunika GM', calendarId: cal.id, start: at(8, 14), end: at(8, 14, 30), userId: who }),
      ];
    case 'holidays': {
      const day = (iso: string) => ({ start: new Date(iso + 'T00:00').toISOString(), end: new Date(new Date(iso + 'T00:00').getTime() + 86_400_000).toISOString(), allDay: true });
      return [ext({ title: 'Christmas Day', calendarId: cal.id, userId: who, ...day('2026-12-25') }), ext({ title: 'New Year’s Day', calendarId: cal.id, userId: who, ...day('2027-01-01') })];
    }
    default:
      return [];
  }
}

export const EXTERNAL_EVENTS: CalEvent[] = EXTERNAL_CALENDARS.flatMap(externalEvents);
