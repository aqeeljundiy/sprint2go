// One calendar link, however it's written: the app and the server use this to spot the same link added twice.

/**
 * The same calendar address in one form: webcal://, webcals://, http:// and https:// alike, the host in lower case, no
 * default port, no trailing slash, no #part, and its query in a fixed order. Null when it isn't a web address at all.
 * The path keeps its case: private calendar addresses (Google's secret iCal links) are case-sensitive.
 */
export function calendarLinkKey(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const query = [...u.searchParams].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const q = new URLSearchParams(query).toString();
  return `${u.host.toLowerCase()}${path}${q ? `?${q}` : ''}`;
}
