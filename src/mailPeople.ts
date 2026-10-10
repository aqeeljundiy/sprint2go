// Who an email went to, and who a reply goes to, with To, Cc and Reply-To kept apart (Gmail's rules).
import type { Message, Person } from './types';

const key = (p: Person) => p.email.trim().toLowerCase();
/** The same people once each, in order. */
export const uniquePeople = (list: Person[]) => list.filter((p, i, l) => p?.email && l.findIndex((q) => key(q) === key(p)) === i);

/** Everyone a message was sent to that the reader may see: To, then Cc. */
export const recipientsOf = (m: Pick<Message, 'to' | 'cc'>): Person[] => [...(m.to ?? []), ...(m.cc ?? [])];

/** Everyone on a message: the sender, To and Cc. */
export const peopleOf = (m: Pick<Message, 'from' | 'to' | 'cc'>): Person[] => [m.from, ...recipientsOf(m)];

/**
 * Who a reply to `last` goes to. Reply: whoever it says to answer (Reply-To) or its sender; your own message: the people
 * you wrote to. Reply all: that, plus everyone else in To, and Cc stays Cc. Never you.
 */
export function replyPeople(last: Message, all: boolean, mine: (email: string) => boolean): { to: Person[]; cc: Person[] } {
  const own = mine(last.from.email);
  const back = own ? last.to : last.replyTo?.length ? last.replyTo : [last.from];
  if (!all) return { to: uniquePeople(back.filter((p) => !mine(p.email))).length ? uniquePeople(back.filter((p) => !mine(p.email))) : uniquePeople(back), cc: [] };
  const to = uniquePeople([...back, ...last.to].filter((p) => !mine(p.email)));
  const cc = uniquePeople((last.cc ?? []).filter((p) => !mine(p.email) && !to.some((q) => key(q) === key(p))));
  return { to: to.length ? to : uniquePeople(back), cc };
}

/** Whether Reply all would reach anyone more than Reply. */
export const canReplyAll = (last: Message, mine: (email: string) => boolean) => {
  const r = replyPeople(last, true, mine);
  return r.to.length + r.cc.length > 1;
};
