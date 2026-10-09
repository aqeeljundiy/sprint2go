import { useEffect, useState } from 'react';

/**
 * The app's breakpoints, in one place. CSS uses the same numbers:
 *   phones        @media (max-width: 767px)
 *   narrow phones @media (max-width: 599px)
 *   tiny phones   @media (max-width: 359px)   (the create button floats instead of docking)
 *   tablets       768 px and up get the left rail; list and detail side by side from 1024 px.
 * Panes that change with their own width use container queries on an inner element instead.
 */
export const PHONE = '(max-width: 767px)';
export const NARROW = '(max-width: 599px)';
export const TINY = '(max-width: 359px)';
export const TABLET = '(min-width: 768px) and (max-width: 1099px)';

const can = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** True on a phone-width window right now (for one-off checks; components use usePhone). */
export const isPhone = () => can() && window.matchMedia(PHONE).matches;

/** Follows a media query. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => can() && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const usePhone = () => useMedia(PHONE);
