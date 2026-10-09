// Time zones as choices for our own Select (searchable): Settings, General and the operator's "New company" form.
import type { Option } from './Select';
import { COMPANY_TZ, deviceTz } from '../../jobTimes';

/** One time zone as a choice: "Jakarta, GMT+7", under its region, found by any part of its name. */
export function zoneOption(tz: string, at = new Date()): Option {
  let offset = '';
  try {
    offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at).find((x) => x.type === 'timeZoneName')?.value ?? '';
  } catch {
    /* an old browser: the name alone */
  }
  const parts = tz.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  return { value: tz, label: offset ? `${city}, ${offset}` : city, hint: parts.slice(1, -1).join(', ').replace(/_/g, ' ') || undefined, group: parts.length > 1 ? parts[0] : 'Other', keywords: tz.replace(/[/_]/g, ' ') };
}
/** Every time zone the browser knows, by region. The current one and this device's come first. */
let ZONES: Option[] | null = null;
export function zoneOptions(current: string): Option[] {
  ZONES ??= (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [COMPANY_TZ]).map((tz) => zoneOption(tz));
  const top = [...new Set([current, deviceTz()])].map((tz) => ({ ...(ZONES!.find((z) => z.value === tz) ?? zoneOption(tz)), group: 'Suggested' }));
  return [...top, ...ZONES.filter((z) => !top.some((t) => t.value === z.value))];
}
