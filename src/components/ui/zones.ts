// Time zones as choices for our own Select (searchable): Settings, General and the operator's "New company" form.
import type { Option } from './Select';
import { COMPANY_TZ, deviceTz } from '../../jobTimes';
import { getLang, mark, t, type Lang } from '../../i18n';

/** The regions' names (the first part of a zone's id), as group headings in the person's language. Cities stay as they are. */
const REGIONS: Record<string, string> = {
  Africa: mark('Africa'),
  America: mark('America'),
  Antarctica: mark('Antarctica'),
  Arctic: mark('Arctic'),
  Asia: mark('Asia'),
  Atlantic: mark('Atlantic'),
  Australia: mark('Australia'),
  Europe: mark('Europe'),
  Indian: mark('Indian'),
  Pacific: mark('Pacific'),
};
const regionName = (r: string) => (REGIONS[r] ? t(REGIONS[r]) : r);

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
  return { value: tz, label: offset ? `${city}, ${offset}` : city, hint: parts.slice(1, -1).join(', ').replace(/_/g, ' ') || undefined, group: parts.length > 1 ? regionName(parts[0]) : t('Other'), keywords: tz.replace(/[/_]/g, ' ') };
}
/** Every time zone the browser knows, by region (made again when the language changes). The current one and this device's come first. */
let ZONES: { lang: Lang; list: Option[] } | null = null;
export function zoneOptions(current: string): Option[] {
  if (ZONES?.lang !== getLang()) ZONES = { lang: getLang(), list: (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [COMPANY_TZ]).map((tz) => zoneOption(tz)) };
  const zones = ZONES.list;
  const top = [...new Set([current, deviceTz()])].map((tz) => ({ ...(zones.find((z) => z.value === tz) ?? zoneOption(tz)), group: t('Suggested') }));
  return [...top, ...zones.filter((z) => !top.some((x) => x.value === z.value))];
}
