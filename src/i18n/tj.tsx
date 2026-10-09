import { Fragment, type ReactNode } from 'react';
import { t } from './index';

/**
 * A translated sentence with React elements in it (a bold name, a link, a button), so the sentence stays whole and each
 * language puts the parts where its word order wants them:
 *
 *   tj('Ask them to invite {email}, then {signOut}.', { email: <b>{me.email}</b>, signOut: <button …>{t('sign out')}</button> })
 */
export function tj(text: string, parts: Record<string, ReactNode>): ReactNode {
  const s = t(text);
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of s.matchAll(/\{([A-Za-z_]\w*)\}/g)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    const name = m[1];
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    out.push(name in parts ? parts[name] : lower in parts ? parts[lower] : m[0]);
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return (
    <>
      {out.map((x, i) => (
        <Fragment key={i}>{x}</Fragment>
      ))}
    </>
  );
}
