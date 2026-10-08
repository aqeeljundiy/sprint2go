// Public holidays a company can show in everyone's calendar (Settings, General, or Add a calendar).
// The server reads Google's public holiday calendars (no key needed), keeps public holidays only (not observances
// like Valentine's Day), caches them per country and refreshes them once a day.

export interface HolidayCountry {
  code: string; // ISO 3166 code
  name: string;
  feed: string; // Google's public holiday calendar: en.<feed>#holiday@group.v.calendar.google.com
}

export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  { code: 'ID', name: 'Indonesia', feed: 'indonesian' },
  { code: 'SG', name: 'Singapore', feed: 'singapore' },
  { code: 'MY', name: 'Malaysia', feed: 'malaysia' },
  { code: 'PH', name: 'Philippines', feed: 'philippines' },
  { code: 'TH', name: 'Thailand', feed: 'th' },
  { code: 'VN', name: 'Vietnam', feed: 'vietnamese' },
  { code: 'AU', name: 'Australia', feed: 'australian' },
  { code: 'NZ', name: 'New Zealand', feed: 'new_zealand' },
  { code: 'JP', name: 'Japan', feed: 'japanese' },
  { code: 'IN', name: 'India', feed: 'indian' },
  { code: 'HK', name: 'Hong Kong', feed: 'hong_kong' },
  { code: 'NL', name: 'Netherlands', feed: 'dutch' },
  { code: 'DE', name: 'Germany', feed: 'german' },
  { code: 'FR', name: 'France', feed: 'french' },
  { code: 'GB', name: 'United Kingdom', feed: 'uk' },
  { code: 'US', name: 'United States', feed: 'usa' },
  { code: 'CA', name: 'Canada', feed: 'canadian' },
];

export const holidayCountry = (code: string | undefined) => HOLIDAY_COUNTRIES.find((c) => c.code === code);
export const holidayFeedUrl = (c: HolidayCountry) => `https://calendar.google.com/calendar/ical/en.${c.feed}%23holiday%40group.v.calendar.google.com/public/basic.ics`;
/** The calendar a company's holidays live in (one per company). */
export const holidayCalendarId = (workspaceId: string) => `hol-${workspaceId}`;
