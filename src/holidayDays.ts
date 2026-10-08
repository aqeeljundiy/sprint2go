// The public holidays of the company on screen, by day, for anything that shows a date (the date picker, a task's
// due date). App.tsx keeps it up to date from the company's holiday calendar.
let days = new Map<string, string>();

export function setHolidayDays(m: Map<string, string>) {
  days = m;
}

/** The public holiday on this day ("YYYY-MM-DD"), if there is one. */
export const holidayOn = (day: string | null | undefined) => (day ? days.get(day.slice(0, 10)) : undefined);
