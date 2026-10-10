// Run: node --import ./server/register.mjs --test server/repeat.test.ts
// sprint2go's own repeating events (src/repeat.ts): drawing the dates with left-out and changed ones, splitting a
// series, answers to repeating invites, the picker's rules and words, and the clock across daylight saving in London.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalEvent } from '../src/types.ts';
import {
  alignStart,
  answerSeries,
  changeSeries,
  changesRule,
  clockOf,
  expandEvents,
  expandSeries,
  findEvent,
  occId,
  parseOccId,
  presetOf,
  rebaseRule,
  removeFromSeries,
  repeatWords,
  ruleToSpec,
  specToRule,
  specWords,
} from '../src/repeat.ts';
import { occurrences } from '../src/recurrence.ts';

const LONDON = 'Europe/London';
// Monday 5 October 2026, 09:00 in London (BST, UTC+1). Clocks go back on Sunday 25 October.
const weekly = (extra: Partial<CalEvent> = {}): CalEvent => ({
  id: 'ev1',
  title: 'Team sync',
  calendarId: 'work',
  start: '2026-10-05T08:00:00.000Z',
  end: '2026-10-05T08:30:00.000Z',
  timeZone: LONDON,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  userId: 'u1',
  ...extra,
});
const range = (a: string, b: string) => [Date.parse(a), Date.parse(b)] as const;
const starts = (list: CalEvent[]) => list.map((e) => e.start);
let n = 0;
const newId = () => `new${++n}`;

test('a weekly repeat keeps 09:00 London time across the change back to winter time', () => {
  const list = expandSeries(weekly(), ...range('2026-10-01T00:00:00Z', '2026-11-10T00:00:00Z'));
  assert.deepEqual(starts(list), ['2026-10-05T08:00:00.000Z', '2026-10-12T08:00:00.000Z', '2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z', '2026-11-02T09:00:00.000Z', '2026-11-09T09:00:00.000Z']);
  assert.equal(list[3].end, '2026-10-26T09:30:00.000Z');
  assert.equal(list[0].id, 'ev1~20261005T080000Z');
  assert.equal(list[0].seriesId, 'ev1');
  assert.equal(list[3].occurrence, '2026-10-26T09:00:00.000Z');
  assert.equal(list[0].rrule, 'FREQ=WEEKLY;BYDAY=MO'); // the repeat mark
  assert.equal(list[0].overrides, undefined);
  // And into summer time again in March: still 09:00 on the clock.
  const spring = expandSeries(weekly(), ...range('2027-03-22T00:00:00Z', '2027-04-06T00:00:00Z'));
  assert.deepEqual(starts(spring), ['2027-03-22T09:00:00.000Z', '2027-03-29T08:00:00.000Z', '2027-04-05T08:00:00.000Z']);
});

test('left-out dates, changed dates and a date moved in from far away', () => {
  const e = weekly({
    exdates: ['2026-10-12T08:00:00.000Z'],
    overrides: [
      { occurrence: '2026-10-19T08:00:00.000Z', start: '2026-10-20T13:00:00.000Z', end: '2026-10-20T14:00:00.000Z', title: 'Sync (moved)', location: null },
      { occurrence: '2026-11-02T09:00:00.000Z', start: '2026-09-28T09:00:00.000Z', end: '2026-09-28T09:30:00.000Z' },
      { occurrence: '2026-10-26T09:00:00.000Z', notes: 'Bring the plan' },
    ],
    location: 'Room 4',
  });
  const list = expandSeries(e, ...range('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'));
  assert.deepEqual(starts(list), ['2026-10-05T08:00:00.000Z', '2026-10-20T13:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  assert.equal(list[1].title, 'Sync (moved)');
  assert.equal(list[1].location, undefined);
  assert.equal(list[1].id, 'ev1~20261019T080000Z'); // the id keeps the date it was, so it stays the same when moved
  assert.equal(list[2].notes, 'Bring the plan');
  assert.equal(list[2].location, 'Room 4');
  // A date moved a month earlier, into a range the rule alone wouldn't look at.
  const early = expandSeries(e, ...range('2026-09-27T00:00:00Z', '2026-09-30T00:00:00Z'));
  assert.deepEqual(starts(early), ['2026-09-28T09:00:00.000Z']);
  assert.equal(early[0].occurrence, '2026-11-02T09:00:00.000Z');
  // Found again from its id, and a left-out date isn't there.
  assert.equal(findEvent([e], 'ev1~20261019T080000Z')?.title, 'Sync (moved)');
  assert.equal(findEvent([e], 'ev1~20261012T080000Z'), null);
  assert.equal(findEvent([e], 'ev1~20261013T080000Z'), null); // a Tuesday: not a date of it
  assert.deepEqual(parseOccId('ev1~20261019T080000Z'), { seriesId: 'ev1', occurrence: '2026-10-19T08:00:00.000Z' });
  // Everything else passes through as it is.
  const single: CalEvent = { id: 'x', title: 'Once', calendarId: 'work', start: '2026-10-07T10:00:00.000Z', end: '2026-10-07T11:00:00.000Z' };
  assert.equal(expandEvents([single], 0, 1)[0], single);
  assert.equal(expandEvents([single, e], ...range('2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z')).length, 2);
});

test('"This event": a change of its own, and back to the series again', () => {
  const e = weekly();
  const occ = '2026-10-12T08:00:00.000Z';
  const a = changeSeries(e, occ, { title: 'Sync with Intan', start: '2026-10-12T10:00:00.000Z', end: '2026-10-12T11:00:00.000Z' }, 'one', newId);
  assert.deepEqual(a.upserts[0].overrides, [{ occurrence: occ, start: '2026-10-12T10:00:00.000Z', end: '2026-10-12T11:00:00.000Z', title: 'Sync with Intan' }]);
  assert.equal(a.upserts[0].start, e.start);
  // The editor sends every field; only what changed for this date is kept.
  const cur = findEvent(a.upserts, occId('ev1', occ))!;
  const b = changeSeries(a.upserts[0], occ, { title: 'Team sync', start: occ, end: '2026-10-12T08:30:00.000Z', location: undefined, notes: undefined }, 'one', newId);
  assert.equal(cur.title, 'Sync with Intan');
  assert.equal(b.upserts[0].overrides, undefined);
  // Deleting one date leaves it out.
  const c = removeFromSeries(e, occ, 'one');
  assert.deepEqual(c.upserts[0].exdates, [occ]);
  assert.equal(expandSeries(c.upserts[0], ...range('2026-10-10T00:00:00Z', '2026-10-14T00:00:00Z')).length, 0);
});

test('"This and following": the series splits, with what belongs to later dates', () => {
  const e = weekly({ exdates: ['2026-11-02T09:00:00.000Z', '2026-10-12T08:00:00.000Z'], overrides: [{ occurrence: '2026-11-09T09:00:00.000Z', title: 'Planning' }] });
  const occ = '2026-10-19T08:00:00.000Z';
  const r = changeSeries(e, occ, { start: '2026-10-19T09:00:00.000Z', end: '2026-10-19T09:45:00.000Z' }, 'following', newId);
  assert.equal(r.upserts.length, 2);
  const [head, tail] = r.upserts;
  assert.equal(head.id, 'ev1');
  assert.equal(head.rrule, 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019T075959Z');
  assert.deepEqual(head.exdates, ['2026-10-12T08:00:00.000Z']);
  assert.equal(head.overrides, undefined);
  assert.notEqual(tail.id, 'ev1');
  assert.equal(tail.start, '2026-10-19T09:00:00.000Z'); // 10:00 in London
  assert.equal(tail.end, '2026-10-19T09:45:00.000Z');
  assert.equal(tail.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  // The later left-out date and changed date moved along with the new time (10:00, so 10:00 GMT after the change back).
  assert.deepEqual(tail.exdates, ['2026-11-02T10:00:00.000Z']);
  assert.equal(tail.overrides![0].occurrence, '2026-11-09T10:00:00.000Z');
  const all = expandEvents(r.upserts, ...range('2026-10-01T00:00:00Z', '2026-11-12T00:00:00Z'));
  assert.deepEqual(starts(all).sort(), ['2026-10-05T08:00:00.000Z', '2026-10-19T09:00:00.000Z', '2026-10-26T10:00:00.000Z', '2026-11-09T10:00:00.000Z']);
  assert.equal(all.find((x) => x.start === '2026-11-09T10:00:00.000Z')?.title, 'Planning');
  // "This and following" from the first date is the whole series.
  const whole = changeSeries(e, e.start, { title: 'Weekly sync' }, 'following', newId);
  assert.equal(whole.upserts.length, 1);
  assert.equal(whole.upserts[0].title, 'Weekly sync');
  // Deleting from a date on cuts the series there.
  const cut = removeFromSeries(e, occ, 'following');
  assert.equal(cut.upserts[0].rrule, 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019T075959Z');
  assert.deepEqual(removeFromSeries(e, e.start, 'following'), { upserts: [], deletes: ['ev1'] });
});

test('a series with a number of times splits into two that add up', () => {
  const e = weekly({ rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10', exdates: ['2026-10-12T08:00:00.000Z'] });
  const r = changeSeries(e, '2026-10-26T09:00:00.000Z', { title: 'Later sync' }, 'following', newId);
  const [head, tail] = r.upserts;
  assert.equal(head.rrule, 'FREQ=WEEKLY;BYDAY=MO;COUNT=3'); // the left-out date still counts, as COUNT does
  assert.equal(tail.rrule, 'FREQ=WEEKLY;BYDAY=MO;COUNT=7');
  assert.equal(tail.title, 'Later sync');
  const before = expandSeries(e, ...range('2026-01-01T00:00:00Z', '2027-06-01T00:00:00Z')).map((x) => x.occurrence);
  const after = expandEvents(r.upserts, ...range('2026-01-01T00:00:00Z', '2027-06-01T00:00:00Z')).map((x) => x.occurrence);
  assert.deepEqual(after.sort(), before.sort());
  assert.equal(after.length, 9);
});

test('"All events": a date dragged to Tuesday moves the whole series, rule and all', () => {
  const e = weekly({ exdates: ['2026-10-19T08:00:00.000Z'], overrides: [{ occurrence: '2026-10-26T09:00:00.000Z', title: 'Retro' }] });
  // The second date, dragged from Monday 09:00 to Tuesday 09:30.
  const r = changeSeries(e, '2026-10-12T08:00:00.000Z', { start: '2026-10-13T08:30:00.000Z', end: '2026-10-13T09:00:00.000Z' }, 'all', newId);
  const s = r.upserts[0];
  assert.equal(s.start, '2026-10-06T08:30:00.000Z');
  assert.equal(s.rrule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.deepEqual(s.exdates, ['2026-10-20T08:30:00.000Z']);
  assert.equal(s.overrides![0].occurrence, '2026-10-27T09:30:00.000Z'); // 09:30 GMT: the clocks went back
  const list = expandSeries(s, ...range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'));
  assert.deepEqual(starts(list), ['2026-10-06T08:30:00.000Z', '2026-10-13T08:30:00.000Z', '2026-10-27T09:30:00.000Z']);
  assert.equal(list[2].title, 'Retro');
  // A field changed for all dates reaches the dates that had their own.
  const t = changeSeries(e, '2026-10-12T08:00:00.000Z', { title: 'Weekly' }, 'all', newId).upserts[0];
  assert.equal(t.title, 'Weekly');
  assert.equal(t.overrides, undefined);
  assert.equal(removeFromSeries(e, '2026-10-12T08:00:00.000Z', 'all').deletes[0], 'ev1');
});

test('a new rule from a later date starts on its first date, keeping that date’s rhythm', () => {
  const e = weekly();
  const clock = clockOf(e);
  // On the 26 Oct date, "every 2 weeks on Wednesday": from the 7th, on the weeks of the 28th.
  const rule = specToRule({ freq: 'WEEKLY', interval: 2, days: [3] }, clock.wall('2026-10-28T09:00:00.000Z'), clock);
  assert.equal(rule, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE');
  assert.equal(changesRule(e, '2026-10-26T09:00:00.000Z', { rrule: rule }), true);
  assert.equal(changesRule(e, '2026-10-26T09:00:00.000Z', { rrule: 'FREQ=WEEKLY;BYDAY=MO;WKST=MO' }), false);
  assert.equal(changesRule(e, '2026-10-26T09:00:00.000Z', { title: 'x' }), false);
  assert.equal(changesRule(e, '2026-10-26T09:00:00.000Z', { rrule: null as unknown as string }), true);
  const r = changeSeries(e, '2026-10-26T09:00:00.000Z', { rrule: rule, start: '2026-10-28T09:00:00.000Z', end: '2026-10-28T09:30:00.000Z' }, 'all', newId).upserts[0];
  assert.equal(r.start, '2026-10-14T08:00:00.000Z');
  assert.deepEqual(starts(expandSeries(r, ...range('2026-10-01T00:00:00Z', '2026-11-12T00:00:00Z'))), ['2026-10-14T08:00:00.000Z', '2026-10-28T09:00:00.000Z', '2026-11-11T09:00:00.000Z']);
  assert.equal(alignStart('FREQ=MONTHLY;BYMONTHDAY=-1', Date.UTC(2026, 11, 31, 9), Date.UTC(2026, 9, 5, 9)), Date.UTC(2026, 9, 31, 9));
  // No repeat any more: one event, on the date being changed.
  const one = changeSeries(e, '2026-10-26T09:00:00.000Z', { rrule: null as unknown as string }, 'all', newId).upserts[0];
  assert.equal(one.rrule, undefined);
  assert.equal(one.start, '2026-10-26T09:00:00.000Z');
});

test('answers to a repeating invite: one date, from a date on, all of them', () => {
  const inv = weekly({ inviteUid: 'abc@google.com', rsvp: 'accepted' });
  const a = answerSeries(inv, '2026-10-12T08:00:00.000Z', 'tentative', 'one');
  const b = answerSeries(a, '2026-10-26T09:00:00.000Z', 'declined', 'following');
  const list = expandSeries(b, ...range('2026-10-01T00:00:00Z', '2026-11-10T00:00:00Z'));
  // Dates I said no to are off the calendar, as a declined invite is.
  assert.deepEqual(list.map((x) => [x.start.slice(0, 10), x.rsvp]), [
    ['2026-10-05', 'accepted'],
    ['2026-10-12', 'tentative'],
    ['2026-10-19', 'accepted'],
  ]);
  const c = answerSeries(b, '2026-10-19T08:00:00.000Z', 'accepted', 'all');
  assert.equal(c.rsvpFrom, undefined);
  assert.equal(c.overrides, undefined);
  assert.equal(expandSeries(c, ...range('2026-10-01T00:00:00Z', '2026-11-10T00:00:00Z')).length, 6);
});

test('the picker’s rules: presets, words, the 2nd Tuesday, the last day, until and times', () => {
  const clock = { floating: false, tz: LONDON };
  const tue = Date.UTC(2026, 9, 13, 9); // Tuesday 13 October, the 2nd Tuesday
  assert.equal(specToRule({ freq: 'MONTHLY', interval: 1, monthly: 'nth' }, tue, clock), 'FREQ=MONTHLY;BYDAY=2TU');
  assert.equal(specToRule({ freq: 'MONTHLY', interval: 1, monthly: 'date' }, tue, clock), 'FREQ=MONTHLY;BYMONTHDAY=13');
  assert.equal(specToRule({ freq: 'MONTHLY', interval: 1, monthly: 'last' }, Date.UTC(2026, 9, 31, 9), clock), 'FREQ=MONTHLY;BYMONTHDAY=-1');
  assert.equal(specToRule({ freq: 'YEARLY', interval: 1 }, tue, clock), 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=13');
  // Until the end of 31 December in London (GMT then), in UTC as RFC 5545 asks; or after 10 times.
  assert.equal(specToRule({ freq: 'DAILY', interval: 1, until: '2026-12-31' }, tue, clock), 'FREQ=DAILY;UNTIL=20261231T235959Z');
  assert.equal(specToRule({ freq: 'DAILY', interval: 1, until: '2026-07-31' }, tue, clock), 'FREQ=DAILY;UNTIL=20260731T225959Z');
  assert.equal(specToRule({ freq: 'WEEKLY', interval: 1, days: [5, 1, 3], count: 10 }, tue, clock), 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10');
  assert.deepEqual(ruleToSpec('FREQ=MONTHLY;BYDAY=2TU', tue, clock), { freq: 'MONTHLY', interval: 1, monthly: 'nth' });
  assert.deepEqual(ruleToSpec('FREQ=DAILY;UNTIL=20261231T235959Z', tue, clock), { freq: 'DAILY', interval: 1, until: '2026-12-31' });
  assert.equal(ruleToSpec('FREQ=MONTHLY;BYDAY=1MO,3MO', tue, clock), null); // kept as written, shown in words
  assert.equal(presetOf(ruleToSpec('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tue, clock)), 'weekdays');
  assert.equal(presetOf(ruleToSpec('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', tue, clock)), 'biweekly');
  assert.equal(presetOf(ruleToSpec('FREQ=WEEKLY;BYDAY=TU;COUNT=4', tue, clock)), 'custom');
  assert.equal(specWords({ freq: 'MONTHLY', interval: 1, monthly: 'nth' }, tue), 'Every month on the 2nd Tuesday');
  assert.equal(specWords({ freq: 'WEEKLY', interval: 2, days: [1, 3] }, tue), 'Every 2 weeks on Monday and Wednesday');
  assert.equal(specWords({ freq: 'WEEKLY', interval: 1, days: [1, 2, 3, 4, 5], until: '2026-12-31' }, tue), 'Every weekday, until 31 Dec 2026');
  assert.equal(specWords({ freq: 'YEARLY', interval: 1, count: 3 }, tue), 'Every year on 13 October, 3 times');
  assert.equal(repeatWords(weekly()), 'Every week on Monday');
  assert.equal(repeatWords(weekly({ rrule: 'FREQ=MONTHLY;BYDAY=1MO,3MO' })), 'Repeats monthly');
  // The rule follows a date that moves: weekly days shift, a monthly date follows.
  assert.equal(rebaseRule('FREQ=WEEKLY;BYDAY=MO,WE', Date.UTC(2026, 9, 12, 9), Date.UTC(2026, 9, 13, 9), clock), 'FREQ=WEEKLY;BYDAY=TU,TH');
  assert.equal(rebaseRule('FREQ=MONTHLY;BYDAY=2TU;COUNT=5', tue, Date.UTC(2026, 9, 14, 9), clock), 'FREQ=MONTHLY;BYDAY=2WE;COUNT=5');
  assert.equal(rebaseRule('FREQ=MONTHLY;BYMONTHDAY=-1', Date.UTC(2026, 9, 31, 9), Date.UTC(2026, 9, 30, 9), clock), 'FREQ=MONTHLY;BYMONTHDAY=30');
});

test('the 2nd Tuesday and the last day of each month, through the clock change', () => {
  const e: CalEvent = { id: 'm', title: 'Board', calendarId: 'work', start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T14:00:00.000Z', timeZone: LONDON, rrule: 'FREQ=MONTHLY;BYDAY=2TU' };
  assert.deepEqual(starts(expandSeries(e, ...range('2026-09-01T00:00:00Z', '2026-12-31T00:00:00Z'))), ['2026-09-08T13:00:00.000Z', '2026-10-13T13:00:00.000Z', '2026-11-10T14:00:00.000Z', '2026-12-08T14:00:00.000Z']);
  const last: CalEvent = { ...e, start: '2026-09-30T16:00:00.000Z', end: '2026-09-30T16:30:00.000Z', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4' };
  assert.deepEqual(starts(expandSeries(last, ...range('2026-09-01T00:00:00Z', '2027-03-31T00:00:00Z'))), ['2026-09-30T16:00:00.000Z', '2026-10-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z']);
});

test('an all-day repeat stays on its days, floating ones (from invites) too', () => {
  // Our own: midnight to midnight in London, every day for three days, across the clock change.
  const own: CalEvent = { id: 'a', title: 'Offsite', calendarId: 'work', start: '2026-10-24T23:00:00.000Z', end: '2026-10-26T00:00:00.000Z', allDay: true, timeZone: LONDON, rrule: 'FREQ=DAILY;COUNT=3' };
  const days = expandSeries(own, ...range('2026-10-20T00:00:00Z', '2026-10-31T00:00:00Z'));
  assert.deepEqual(starts(days), ['2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z', '2026-10-27T00:00:00.000Z']);
  assert.equal(days[0].end, '2026-10-26T00:00:00.000Z'); // the day of the change is 25 hours long
  // From an invite: floating dates, read the same everywhere.
  const inv: CalEvent = { id: 'b', title: 'Holiday', calendarId: 'work', start: '2026-10-20T00:00:00', end: '2026-10-21T00:00:00', allDay: true, rrule: 'FREQ=DAILY;COUNT=3', exdates: ['2026-10-21'] };
  const fl = expandSeries(inv, ...range('2026-10-19T00:00:00Z', '2026-10-25T00:00:00Z'));
  assert.deepEqual(starts(fl), ['2026-10-20T00:00:00', '2026-10-22T00:00:00']);
  assert.equal(fl[1].id, 'b~20261022T000000');
  assert.equal(findEvent([inv], 'b~20261022T000000')?.start, '2026-10-22T00:00:00');
  // Splitting it uses a date for UNTIL.
  assert.equal(removeFromSeries(inv, '2026-10-22T00:00:00', 'following').upserts[0].rrule, 'FREQ=DAILY;COUNT=2');
  assert.equal(removeFromSeries({ ...inv, rrule: 'FREQ=DAILY' }, '2026-10-22T00:00:00', 'following').upserts[0].rrule, 'FREQ=DAILY;UNTIL=20261021');
});

test('the shared rules still read invites the same way (occurrences)', () => {
  const list = occurrences({ start: '2026-10-05T08:00:00.000Z', end: '2026-10-05T08:30:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', tz: LONDON, overrides: [{ recurrenceId: '2026-10-12T08:00:00.000Z', start: '2026-11-30T08:00:00.000Z', end: '2026-11-30T08:30:00.000Z' }] }, Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-28T00:00:00Z'))!;
  // A date moved past the end doesn't hide the dates after it.
  assert.deepEqual(list.map((x) => x.start), ['2026-10-05T08:00:00.000Z', '2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z']);
});

test('an invite we send carries the series, and reads back as the same dates (RRULE, EXDATE, a moved date, London time)', async () => {
  const { buildInvite, buildReply, parseInvite, vtimezone } = await import('./ics.ts');
  const { inviteCalendarTimes, inviteSeries } = await import('../src/inviteTimes.ts');
  const e = weekly({ exdates: ['2026-10-19T08:00:00.000Z'], overrides: [{ occurrence: '2026-11-02T09:00:00.000Z', start: '2026-11-03T14:00:00.000Z', end: '2026-11-03T15:00:00.000Z', title: 'Sync (Tuesday)' }] });
  const ics = buildInvite(
    { method: 'REQUEST', uid: 'ev1@sprint2go.test', sequence: 2, organizer: { name: 'Raka', email: 'raka@pnp.test' }, attendees: [{ name: 'Laras', email: 'laras@kopinara.test' }], title: e.title, start: e.start, end: e.end, tz: LONDON, rrule: e.rrule, exdates: e.exdates, overrides: e.overrides, url: 'https://meet.google.com/abc-defg-hij' },
    Date.parse('2026-10-01T00:00:00Z'),
  );
  // What Google, Outlook and Apple read: London wall-clock times with the zone's rules, the rule, the left-out date and
  // the moved date as its own VEVENT.
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /DTSTART;TZID=Europe\/London:20261005T090000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO\r\n/);
  assert.match(ics, /EXDATE;TZID=Europe\/London:20261019T090000/);
  assert.match(ics, /RECURRENCE-ID;TZID=Europe\/London:20261102T090000\r\nDTSTART;TZID=Europe\/London:20261103T140000/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/London\r\nBEGIN:DAYLIGHT\r\nDTSTART:20260329T010000\r\nTZOFFSETFROM:\+0000\r\nTZOFFSETTO:\+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
  assert.match(ics, /BEGIN:STANDARD\r\nDTSTART:20261025T020000\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/);
  assert.match(ics.replace(/\r\n /g, ''), /ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Laras":mailto:laras@kopinara.test/); // (long lines fold)
  // Read back by our own parser (the way a guest using sprint2go gets it), it's the same series.
  const inv = parseInvite(ics)!;
  assert.equal(inv.uid, 'ev1@sprint2go.test');
  assert.equal(inv.sequence, 2);
  assert.equal(inv.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.equal(inv.tz, LONDON);
  assert.equal(inv.url, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(inv.exdates, ['2026-10-19T08:00:00.000Z']);
  assert.deepEqual(inv.overrides, [{ recurrenceId: '2026-11-02T09:00:00.000Z', start: '2026-11-03T14:00:00.000Z', end: '2026-11-03T15:00:00.000Z' }]);
  const [from, to] = range('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z');
  const ours = expandSeries(e, from, to).map((x) => x.start).sort();
  const theirs = occurrences(inv, from, to, 100)!.map((x) => x.start).sort();
  assert.deepEqual(theirs, ours);
  // And as a guest's repeating event: one series, the same dates (incoming repeating invites aren't copies per date).
  const asEvent: CalEvent = { id: 'got', title: inv.title, calendarId: 'work', ...inviteCalendarTimes(inv), ...inviteSeries(inv) };
  assert.deepEqual(expandSeries(asEvent, from, to).map((x) => x.start).sort(), ours);
  // A whole series off: CANCEL. Zones without daylight saving get one part.
  assert.match(buildInvite({ method: 'CANCEL', uid: 'ev1@sprint2go.test', sequence: 3, organizer: { name: 'A', email: 'a@pnp.test' }, attendees: [], title: 'x', start: e.start, end: e.end, tz: LONDON, rrule: e.rrule }), /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
  assert.deepEqual(vtimezone('Asia/Jakarta', 2026), ['BEGIN:VTIMEZONE', 'TZID:Asia/Jakarta', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700', 'END:STANDARD', 'END:VTIMEZONE']);
  assert.match(vtimezone('America/New_York', 2026).join('\n'), /BYMONTH=3;BYDAY=2SU[\s\S]*BYMONTH=11;BYDAY=1SU/);
  assert.match(vtimezone('Australia/Sydney', 2026).join('\n'), /BEGIN:STANDARD\nDTSTART:20260405T030000[\s\S]*BYMONTH=4;BYDAY=1SU[\s\S]*BEGIN:DAYLIGHT\nDTSTART:20261004T020000[\s\S]*BYMONTH=10;BYDAY=1SU/);
  // A guest's answer to one date, and to a date and the ones after it, reads back as such.
  const one = parseInvite(buildReply(inv, { name: 'Laras', email: 'laras@kopinara.test' }, 'declined', 0, { recurrenceId: '2026-10-26T09:00:00.000Z' }))!;
  assert.equal(one.method, 'REPLY');
  assert.equal(one.recurrenceId, '2026-10-26T09:00:00.000Z');
  assert.equal(one.thisAndFuture, undefined);
  assert.equal(one.attendees[0].status, 'declined');
  const following = parseInvite(buildReply(inv, { name: 'Laras', email: 'laras@kopinara.test' }, 'accepted', 0, { recurrenceId: '2026-10-26T09:00:00.000Z', following: true }))!;
  assert.equal(following.recurrenceId, '2026-10-26T09:00:00.000Z');
  assert.equal(following.thisAndFuture, true);
});

test('an all-day repeating invite goes as dates, and comes back as the same days', async () => {
  const { buildInvite, parseInvite } = await import('./ics.ts');
  const { inviteCalendarTimes, inviteSeries } = await import('../src/inviteTimes.ts');
  // Our own: midnight to midnight in London, every month on the 2nd Tuesday, the November one left out.
  const e: CalEvent = { id: 'ad', title: 'Board day', calendarId: 'work', start: '2026-10-12T23:00:00.000Z', end: '2026-10-13T23:00:00.000Z', allDay: true, timeZone: LONDON, rrule: 'FREQ=MONTHLY;BYDAY=2TU', exdates: ['2026-11-10T00:00:00.000Z'] };
  const ics = buildInvite({ method: 'REQUEST', uid: 'ad@sprint2go.test', sequence: 0, organizer: { name: 'A', email: 'a@pnp.test' }, attendees: [], title: e.title, start: e.start, end: e.end, allDay: true, tz: LONDON, rrule: e.rrule, exdates: e.exdates });
  assert.match(ics, /DTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014/);
  assert.match(ics, /EXDATE;VALUE=DATE:20261110/);
  assert.doesNotMatch(ics, /VTIMEZONE/);
  const inv = parseInvite(ics)!;
  const got: CalEvent = { id: 'g', title: inv.title, calendarId: 'work', ...inviteCalendarTimes(inv, inv.allDay), allDay: true, ...inviteSeries(inv) };
  assert.equal(got.start, '2026-10-13T00:00:00');
  assert.deepEqual(expandSeries(got, ...range('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z')).map((x) => x.start.slice(0, 10)), ['2026-10-13', '2026-12-08']);
});

test('reminders come for each date of a repeating event, once per date', async () => {
  const { eventReminders } = await import('./eventReminders.ts');
  // Every weekday at 09:00 London, a reminder 10 minutes before; one date has its own reminder (30 minutes).
  const e = weekly({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', remind: 10, overrides: [{ occurrence: '2026-10-28T09:00:00.000Z', remind: 30 }] });
  const at = (iso: string) => Date.parse(iso);
  // Tuesday 27 October, 08:51 GMT (after the clocks went back): the 09:00 date is due.
  const one = eventReminders([e], at('2026-10-27T08:51:00Z'));
  assert.equal(one.length, 1);
  assert.equal(one[0].start, '2026-10-27T09:00:00.000Z');
  assert.equal(one[0].seriesId, 'ev1');
  assert.equal(one[0].id, 'ev1~20261027T090000Z');
  // Marked on the series: not again for that date, but the next day's comes.
  const marked = { ...e, remindedFor: one[0].start };
  assert.equal(eventReminders([marked], at('2026-10-27T08:55:00Z')).length, 0);
  assert.equal(eventReminders([marked], at('2026-10-28T08:20:00Z')).length, 0, 'not yet');
  assert.equal(eventReminders([marked], at('2026-10-28T08:31:00Z'))[0]?.start, '2026-10-28T09:00:00.000Z', 'that date’s own 30 minutes');
  // Nothing on Saturday; a left-out date doesn't remind.
  assert.equal(eventReminders([e], at('2026-10-31T08:51:00Z')).length, 0);
  assert.equal(eventReminders([{ ...e, exdates: ['2026-10-27T09:00:00.000Z'] }], at('2026-10-27T08:51:00Z')).length, 0);
});
