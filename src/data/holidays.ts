// Public holidays a company can show in everyone's calendar (Settings, General, or Add a calendar).
// The server reads Google's public holiday calendars (no key needed), keeps public holidays only (not observances
// like Valentine's Day), caches them per country and refreshes them once a day.

import { mark } from '../i18n/index'; // the full path: the server loads this file. Show the names with t(name).

export interface HolidayCountry {
  code: string; // ISO 3166 code
  name: string;
  feed: string; // Google's public holiday calendar: en.<feed>#holiday@group.v.calendar.google.com
}

export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  { code: 'ID', name: mark('Indonesia'), feed: 'indonesian' },
  { code: 'SG', name: mark('Singapore'), feed: 'singapore' },
  { code: 'MY', name: mark('Malaysia'), feed: 'malaysia' },
  { code: 'PH', name: mark('Philippines'), feed: 'philippines' },
  { code: 'TH', name: mark('Thailand'), feed: 'th' },
  { code: 'VN', name: mark('Vietnam'), feed: 'vietnamese' },
  { code: 'AU', name: mark('Australia'), feed: 'australian' },
  { code: 'NZ', name: mark('New Zealand'), feed: 'new_zealand' },
  { code: 'JP', name: mark('Japan'), feed: 'japanese' },
  { code: 'IN', name: mark('India'), feed: 'indian' },
  { code: 'HK', name: mark('Hong Kong'), feed: 'hong_kong' },
  { code: 'NL', name: mark('Netherlands'), feed: 'dutch' },
  { code: 'DE', name: mark('Germany'), feed: 'german' },
  { code: 'FR', name: mark('France'), feed: 'french' },
  { code: 'GB', name: mark('United Kingdom'), feed: 'uk' },
  { code: 'US', name: mark('United States'), feed: 'usa' },
  { code: 'CA', name: mark('Canada'), feed: 'canadian' },
];

export const holidayCountry = (code: string | undefined) => HOLIDAY_COUNTRIES.find((c) => c.code === code);
export const holidayFeedUrl = (c: HolidayCountry) => `https://calendar.google.com/calendar/ical/en.${c.feed}%23holiday%40group.v.calendar.google.com/public/basic.ics`;
/** The calendar a company's holidays live in (one per company). */
export const holidayCalendarId = (workspaceId: string) => `hol-${workspaceId}`;
