import { useEffect, useSyncExternalStore } from 'react';
import { deviceLang, getLang, isLang, onLang, rememberLang, setLang, type Lang } from './index';

/**
 * The active language, and a re-render when it changes. The whole app already re-renders on a switch (main.tsx), so
 * most components never need this. Use it where text is built inside useMemo or useCallback: put its value in the
 * deps, or the memo keeps the old language's words.
 */
export const useLang = () => useSyncExternalStore(onLang, getLang, getLang);

/**
 * Which language the app speaks for this person: the one they picked (Settings, Account), else their company's default
 * (Settings, General), else their device's (what they picked on the landing page or the sign-in page, else the
 * browser's). An explicit choice is remembered on this device, so the sign-in page after signing out speaks it too.
 */
export function useAppLanguage(own: Lang | undefined, company: Lang | undefined) {
  const picked = isLang(own) ? own : isLang(company) ? company : undefined;
  const want = picked ?? deviceLang();
  useEffect(() => {
    if (picked) rememberLang(picked);
    void setLang(want);
  }, [want, picked]);
  return want;
}
