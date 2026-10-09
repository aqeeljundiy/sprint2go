// Run: node --import ./server/register.mjs --test server/ics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReply, durationMs, expand, findMeetingLink, ianaOf, occurrences, parseCalendar, parseIcs, parseInvite, zonedToUtc } from './ics.ts';

// What Google Calendar sends (shortened): UTC times, the Meet link in X-GOOGLE-CONFERENCE, folded attendee lines.
const GOOGLE = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261014T030000Z',
  'DTEND:20261014T040000Z',
  'DTSTAMP:20261009T081500Z',
  'ORGANIZER;CN=Nadia Putri:mailto:nadia@kopikita.co.id',
  'UID:4hq0s1v2k3m4n5o6p7q8r9s0t1@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE',
  ' ;CN=Nadia Putri;X-NUM-GUESTS=0:mailto:nadia@kopikita.co.id',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=',
  ' TRUE;CN=aqeel@pixelandprofits.com;X-NUM-GUESTS=0:mailto:aqeel@pixelandprofits.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=OPT-PARTICIPANT;PARTSTAT=TENTATIVE;RSVP=TRUE',
  ' ;CN="Putra, Bayu";X-NUM-GUESTS=0:mailto:bayu@kopikita.co.id',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'CREATED:20261009T081400Z',
  'DESCRIPTION:Agenda: concepts\\, timing\\; budget.\\nSecond line\\n\\nJoin with Google',
  '  Meet: https://meet.google.com/abc-defg-hij',
  'LAST-MODIFIED:20261009T081500Z',
  'LOCATION:',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:KopiKita Q4 concepts review',
  'TRANSP:OPAQUE',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H10M0S',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('reads a Google Calendar invite', () => {
  const ev = parseInvite(GOOGLE)!;
  assert.equal(ev.method, 'REQUEST');
  assert.equal(ev.uid, '4hq0s1v2k3m4n5o6p7q8r9s0t1@google.com');
  assert.equal(ev.sequence, 0);
  assert.equal(ev.title, 'KopiKita Q4 concepts review');
  assert.equal(ev.start, '2026-10-14T03:00:00.000Z');
  assert.equal(ev.end, '2026-10-14T04:00:00.000Z');
  assert.equal(ev.url, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(ev.organizer, { name: 'Nadia Putri', email: 'nadia@kopikita.co.id' });
  assert.equal(ev.attendees.length, 3);
  assert.equal(ev.attendees[1].email, 'aqeel@pixelandprofits.com');
  assert.equal(ev.attendees[1].status, 'needs-action');
  assert.equal(ev.attendees[1].rsvp, true);
  assert.equal(ev.attendees[2].name, 'Putra, Bayu');
  assert.equal(ev.attendees[2].status, 'tentative');
  assert.equal(ev.attendees[2].optional, true);
  assert.equal(ev.description, 'Agenda: concepts, timing; budget.\nSecond line\n\nJoin with Google Meet: https://meet.google.com/abc-defg-hij');
  assert.equal(ev.location, undefined);
  assert.equal(ev.allDay, undefined);
});

// Outlook: a Windows zone name with its VTIMEZONE, a Teams link, LF line endings.
const OUTLOOK = `BEGIN:VCALENDAR
METHOD:REQUEST
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
BEGIN:VTIMEZONE
TZID:SE Asia Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:+0700
TZOFFSETTO:+0700
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T000000
TZOFFSETFROM:+0700
TZOFFSETTO:+0700
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
ORGANIZER;CN=Sarah Lim:mailto:sarah@luminaskin.sg
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Aqeel:mailto:Aqeel@PixelAndProfits.com
DESCRIPTION;LANGUAGE=en-US:Microsoft Teams meeting\\nJoin: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d\\n
UID:040000008200E00074C5B7101A82E00800000000
SUMMARY;LANGUAGE=en-US:Lumina launch check-in
DTSTART;TZID=SE Asia Standard Time:20261015T140000
DTEND;TZID=SE Asia Standard Time:20261015T143000
LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting
SEQUENCE:2
X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d
END:VEVENT
END:VCALENDAR`;

test('reads an Outlook invite with a Windows zone and a Teams link', () => {
  const ev = parseInvite(OUTLOOK)!;
  assert.equal(ev.start, '2026-10-15T07:00:00.000Z'); // 14:00 in Jakarta
  assert.equal(ev.end, '2026-10-15T07:30:00.000Z');
  assert.equal(ev.tz, 'Asia/Jakarta');
  assert.equal(ev.sequence, 2);
  assert.match(ev.url!, /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
  assert.equal(ev.attendees[0].email, 'aqeel@pixelandprofits.com');
  assert.equal(ev.location, 'Microsoft Teams Meeting');
});

test('a zone known only from the file uses its daylight-saving rules', () => {
  const cal = (date: string) => `BEGIN:VCALENDAR
METHOD:REQUEST
BEGIN:VTIMEZONE
TZID:Custom Europe
BEGIN:STANDARD
DTSTART:16011028T030000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010325T020000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:x1
DTSTART;TZID=Custom Europe:${date}
DURATION:PT45M
SUMMARY:Sync
END:VEVENT
END:VCALENDAR`;
  assert.equal(parseInvite(cal('20260715T100000'))!.start, '2026-07-15T08:00:00.000Z'); // summer: +2
  assert.equal(parseInvite(cal('20260115T100000'))!.start, '2026-01-15T09:00:00.000Z'); // winter: +1
  assert.equal(parseInvite(cal('20260115T100000'))!.end, '2026-01-15T09:45:00.000Z');
  assert.equal(parseInvite(cal('20261101T100000'))!.start, '2026-11-01T09:00:00.000Z'); // after the last Sunday of October
});

test('IANA zones, prefixed zone names and floating times with X-WR-TIMEZONE', () => {
  assert.equal(ianaOf('/mozilla.org/20050126_1/America/New_York'), 'America/New_York');
  assert.equal(ianaOf('Pacific Standard Time'), 'America/Los_Angeles');
  assert.equal(ianaOf('Not A Zone'), undefined);
  const ny = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:a\nDTSTART;TZID=America/New_York:20261103T090000\nDTEND;TZID=America/New_York:20261103T100000\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(ny.start, '2026-11-03T14:00:00.000Z'); // EST, after the switch on 1 Nov
  assert.equal(ny.tz, 'America/New_York');
  const floating = parseInvite(`BEGIN:VCALENDAR\nX-WR-TIMEZONE:Asia/Jakarta\nBEGIN:VEVENT\nUID:b\nDTSTART:20261020T090000\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(floating.method, 'PUBLISH');
  assert.equal(floating.start, '2026-10-20T02:00:00.000Z');
  assert.equal(floating.end, '2026-10-20T03:00:00.000Z'); // no end: an hour
  assert.equal(zonedToUtc(2026, 2, 8, 2, 30, 0, 'America/New_York'), Date.parse('2026-03-08T07:30:00Z')); // in the spring gap
  assert.equal(zonedToUtc(2026, 10, 1, 1, 30, 0, 'America/New_York'), Date.parse('2026-11-01T05:30:00Z')); // happens twice: the first
  assert.equal(zonedToUtc(2026, 9, 14, 10, 0, 0, 'Asia/Jakarta'), Date.parse('2026-10-14T03:00:00Z'));
});

test('all-day events land on the same date everywhere', () => {
  const ev = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261022\nSUMMARY:Offsite\nORGANIZER:mailto:a@b.co\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(ev.allDay, true);
  assert.equal(ev.start, '2026-10-20T12:00:00.000Z');
  assert.equal(ev.end, '2026-10-21T12:01:00.000Z'); // last day is the 21st
  const reply = buildReply(ev, { name: 'Aqeel', email: 'aqeel@x.co' }, 'accepted', Date.parse('2026-10-09T10:00:00Z'));
  assert.match(reply, /DTSTART;VALUE=DATE:20261020\r\n/);
  assert.match(reply, /DTEND;VALUE=DATE:20261022\r\n/);
});

test('a fold in the middle of a multi-byte character still joins', () => {
  const title = 'Rapat évaluasi ☕ kopi';
  const bytes = Buffer.from(`SUMMARY:${title}`, 'utf8');
  const cut = bytes.indexOf(Buffer.from('☕')) + 1; // inside the 3-byte coffee cup
  const folded = Buffer.concat([Buffer.from('BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:u\r\nDTSTART:20261020T010000Z\r\n'), bytes.subarray(0, cut), Buffer.from('\r\n '), bytes.subarray(cut), Buffer.from('\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')]);
  assert.equal(parseInvite(folded)!.title, title);
});

test('cancel and reply', () => {
  const cancel = parseInvite(GOOGLE.replace('METHOD:REQUEST', 'METHOD:CANCEL').replace('SEQUENCE:0', 'SEQUENCE:1').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED'))!;
  assert.equal(cancel.method, 'CANCEL');
  assert.equal(cancel.sequence, 1);
  assert.equal(cancel.cancelled, true);
  const ev = parseInvite(GOOGLE)!;
  const reply = buildReply(ev, { name: 'Aqeel Jundiy', email: 'aqeel@pixelandprofits.com' }, 'tentative', Date.parse('2026-10-09T10:00:00Z'));
  assert.ok(reply.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines are folded at 75 octets');
  const back = parseInvite(reply)!;
  assert.equal(back.method, 'REPLY');
  assert.equal(back.uid, ev.uid);
  assert.equal(back.start, ev.start);
  assert.equal(back.end, ev.end);
  assert.equal(back.attendees.length, 1);
  assert.equal(back.attendees[0].status, 'tentative');
  assert.equal(back.attendees[0].email, 'aqeel@pixelandprofits.com');
  assert.equal(back.organizer?.email, 'nadia@kopikita.co.id');
  assert.ok(parseIcs(reply)?.children.some((c) => c.type === 'VEVENT'));
});

test('meeting links from the location or description', () => {
  assert.equal(findMeetingLink('Join Zoom Meeting https://us02web.zoom.us/j/81234567890?pwd=abcDEF123. Meeting ID: 812'), 'https://us02web.zoom.us/j/81234567890?pwd=abcDEF123');
  assert.equal(findMeetingLink('Room 4, or https://meet.google.com/xyz-abcd-efg'), 'https://meet.google.com/xyz-abcd-efg');
  assert.equal(findMeetingLink('https://example.com/meeting'), undefined);
  const ev = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:z\nDTSTART:20261020T010000Z\nDURATION:PT30M\nLOCATION:https://acme.zoom.us/j/123456789\nURL:https://calendar.example.com/event/1\nSUMMARY:Zoom call\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(ev.url, 'https://acme.zoom.us/j/123456789');
  assert.equal(ev.end, '2026-10-20T01:30:00.000Z');
  const page = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:z\nDTSTART:20261020T010000Z\nURL:https://calendar.example.com/event/1\nSUMMARY:No link\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(page.url, undefined, 'a calendar page is not a meeting link');
  const odd = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:z\nDTSTART:20261020T010000Z\nX-GOOGLE-CONFERENCE:https://evil.example/join\nSUMMARY:Odd\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(odd.url, undefined, 'only known meeting services become the Join button');
  assert.equal(durationMs('P1W'), 7 * 86_400_000);
  assert.equal(durationMs('-PT15M'), -15 * 60_000);
});

test('weekly repeats keep the wall-clock time across daylight saving', () => {
  const ev = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:w\nDTSTART;TZID=America/New_York:20261026T090000\nDTEND;TZID=America/New_York:20261026T093000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\nEXDATE;TZID=America/New_York:20261028T090000\nSUMMARY:Standup\nEND:VEVENT\nBEGIN:VEVENT\nUID:w\nRECURRENCE-ID;TZID=America/New_York:20261102T090000\nDTSTART;TZID=America/New_York:20261102T110000\nDTEND;TZID=America/New_York:20261102T113000\nSUMMARY:Standup (moved)\nEND:VEVENT\nEND:VCALENDAR`)!;
  assert.equal(ev.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5');
  assert.equal(ev.overrides?.length, 1);
  const all = occurrences(ev, 0, Date.parse('2027-01-01'))!;
  assert.deepEqual(
    all.map((o) => o.start),
    [
      '2026-10-26T13:00:00.000Z', // EDT
      // 28 Oct is skipped (EXDATE)
      '2026-11-02T16:00:00.000Z', // moved to 11:00 EST
      '2026-11-04T14:00:00.000Z', // EST: still 9:00 local
      '2026-11-09T14:00:00.000Z',
    ],
  );
  assert.equal(all[1].recurrenceId, '2026-11-02T14:00:00.000Z');
  assert.equal(all[0].end, '2026-10-26T13:30:00.000Z');
  // Only what's in the window, at most `max`
  assert.equal(occurrences(ev, Date.parse('2026-11-03'), Date.parse('2027-01-01'))!.length, 2);
  assert.equal(occurrences(ev, 0, Date.parse('2027-01-01'), 2)!.length, 2);
});

test('monthly, yearly, daily and what is not handled', () => {
  const base = { start: '2026-10-13T02:00:00.000Z', end: '2026-10-13T03:00:00.000Z', tz: 'Asia/Jakarta' };
  const secondTue = occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=3' }, 0, Infinity)!;
  assert.deepEqual(secondTue.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-11-10', '2026-12-08']);
  // DTSTART always counts as the first occurrence (RFC 5545, 3.3.10), even when it isn't a last Friday.
  const lastFri = occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270101T000000Z' }, 0, Infinity)!;
  assert.deepEqual(lastFri.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-30', '2026-11-27', '2026-12-25']);
  const days = occurrences({ ...base, rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=3' }, 0, Infinity)!;
  assert.deepEqual(days.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-15', '2026-10-17']);
  const monthDay = occurrences({ ...base, rrule: 'FREQ=MONTHLY;COUNT=2' }, 0, Infinity)!;
  assert.deepEqual(monthDay.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-11-13']);
  const yearly = occurrences({ ...base, rrule: 'FREQ=YEARLY;COUNT=2' }, 0, Infinity)!;
  assert.deepEqual(yearly.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2027-10-13']);
  const biweekly = occurrences({ ...base, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=4' }, 0, Infinity)!;
  assert.deepEqual(biweekly.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-15', '2026-10-27', '2026-10-29']);
  // One parser for invites and calendar links: every Tuesday of the month, and BYSETPOS, are read now.
  const everyTue = occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=TU' }, 0, Infinity, 4)!;
  assert.deepEqual(everyTue.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
  assert.equal(everyTue[0].start, '2026-10-13T02:00:00.000Z', '09:00 in Jakarta, every time');
  const setPos = occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2' }, 0, Infinity, 3)!;
  assert.deepEqual(setPos.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-11-10', '2026-12-08']);
  // Hourly and finer isn't how calendars repeat events: the caller keeps the first one.
  assert.equal(occurrences({ ...base, rrule: 'FREQ=HOURLY' }, 0, Infinity), null);
  assert.deepEqual(occurrences({ ...base }, 0, Infinity), [{ start: base.start, end: base.end }]);
});

test('junk is not an invite', () => {
  assert.equal(parseInvite('hello'), null);
  assert.equal(parseInvite('BEGIN:VCALENDAR\nMETHOD:REQUEST\nEND:VCALENDAR'), null);
  assert.equal(parseInvite('BEGIN:VCALENDAR\nMETHOD:COUNTER\nBEGIN:VEVENT\nUID:a\nDTSTART:20261020T010000Z\nEND:VEVENT\nEND:VCALENDAR'), null);
});

/* ---------- calendar links and public holidays (calendarFeeds.ts): the same parser, whole calendars ---------- */

const FEED = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Team',
  'X-WR-TIMEZONE:Asia/Jakarta',
  'BEGIN:VEVENT',
  'UID:standup',
  'DTSTART;TZID=America/New_York:20261026T090000',
  'DTEND;TZID=America/New_York:20261026T093000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5',
  'EXDATE;TZID=America/New_York:20261028T090000',
  'SUMMARY:Standup',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:standup',
  'RECURRENCE-ID;TZID=America/New_York:20261102T090000',
  'DTSTART;TZID=America/New_York:20261102T110000',
  'DTEND;TZID=America/New_York:20261102T113000',
  'SUMMARY:Standup (moved)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday',
  'DTSTART;VALUE=DATE:20261225',
  'DTEND;VALUE=DATE:20261226',
  'SUMMARY:Christmas Day',
  'TRANSP:TRANSPARENT',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating',
  'DTSTART:20261020T090000',
  'DURATION:PT45M',
  'SUMMARY:Local review',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gone',
  'DTSTART:20261021T090000Z',
  'STATUS:CANCELLED',
  'SUMMARY:Cancelled',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:outlook',
  'DTSTART;TZID=SE Asia Standard Time:20261015T140000',
  'DTEND;TZID=SE Asia Standard Time:20261015T150000',
  'RDATE;TZID=SE Asia Standard Time:20261016T140000',
  'SUMMARY:Lumina',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('calendar links: repeats, skipped and moved dates, all-day, floating, cancelled, Windows zones and RDATE', () => {
  const cal = parseCalendar(FEED);
  assert.equal(cal.name, 'Team');
  const all = expand(cal, Date.parse('2026-10-01'), Date.parse('2027-01-31'));
  const standup = all.filter((o) => o.uid === 'standup');
  assert.deepEqual(
    standup.map((o) => [o.start, o.title]),
    [
      ['2026-10-26T13:00:00.000Z', 'Standup'],
      ['2026-11-02T16:00:00.000Z', 'Standup (moved)'],
      ['2026-11-04T14:00:00.000Z', 'Standup'],
      ['2026-11-09T14:00:00.000Z', 'Standup'],
    ],
  );
  const xmas = all.find((o) => o.uid === 'holiday')!;
  assert.equal(xmas.allDay, true);
  assert.equal(xmas.start, '2026-12-25T00:00:00', 'all-day stays floating: the same date everywhere');
  assert.equal(xmas.transparent, true);
  // X-WR-TIMEZONE reads floating times: 09:00 in Jakarta.
  const local = all.find((o) => o.uid === 'floating')!;
  assert.equal(local.start, '2026-10-20T02:00:00.000Z');
  assert.equal(local.end, '2026-10-20T02:45:00.000Z');
  assert.equal(all.some((o) => o.uid === 'gone'), false, 'cancelled events stay off');
  assert.deepEqual(all.filter((o) => o.uid === 'outlook').map((o) => o.start), ['2026-10-15T07:00:00.000Z', '2026-10-16T07:00:00.000Z']);
});

test('calendar links: an endless rule is capped, and junk is not a calendar', () => {
  const cal = parseCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260101T000000Z\nRRULE:FREQ=DAILY\nSUMMARY:Forever\nEND:VEVENT\nEND:VCALENDAR');
  assert.equal(expand(cal, Date.parse('2026-01-01'), Date.parse('2036-01-01'), 100).length, 100);
  assert.throws(() => parseCalendar('hello, not a calendar'), /not-ics/);
  assert.equal(parseIcs('hello'), null);
});

/* ---------- rare repeat rules (RFC 5545's own examples where it has one), the same through invites and calendar links ---------- */

/**
 * A rule's dates as local days in its zone, read twice: as a calendar link (expand) and as an invite (occurrences).
 * Both must agree, since both use this one parser.
 */
function ruleDays(dtstart: string, rrule: string, opts: { tz?: string; extra?: string[]; to?: string } = {}) {
  const tz = opts.tz ?? 'America/New_York';
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:r', `DTSTART;TZID=${tz}:${dtstart}`, ...(rrule ? [`RRULE:${rrule}`] : []), ...(opts.extra ?? []), 'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const to = Date.parse(opts.to ?? '2031-01-01');
  const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const feed = expand(parseCalendar(ics), Date.parse('1990-01-01'), to, 1000);
  const inv = parseInvite(ics.replace('BEGIN:VCALENDAR', 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST'))!;
  const viaInvite = occurrences(inv, 0, to, 1000)!;
  assert.deepEqual(viaInvite.map((o) => o.start), feed.map((o) => o.start), 'an invite and a calendar link read the rule the same way');
  return { days: feed.map((o) => local(o.start)), starts: feed.map((o) => o.start) };
}

test('BYSETPOS: the n-th of a set, from the start or the end, with COUNT', () => {
  // RFC 5545: the third instance into the month of one of Tuesday, Wednesday or Thursday, for the next 3 months.
  assert.deepEqual(ruleDays('19970904T090000', 'FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3').days, ['1997-09-04', '1997-10-07', '1997-11-06']);
  // RFC 5545: the second-to-last weekday of the month.
  assert.deepEqual(ruleDays('19970929T090000', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2', { to: '1998-04-01' }).days, ['1997-09-29', '1997-10-30', '1997-11-27', '1997-12-30', '1998-01-29', '1998-02-26', '1998-03-30']);
  // The last working day of each month, and the first and last of the week.
  assert.deepEqual(ruleDays('20261030T170000', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=4', { tz: 'Asia/Jakarta' }).days, ['2026-10-30', '2026-11-30', '2026-12-31', '2027-01-29']);
  assert.deepEqual(ruleDays('20261026T090000', 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=1,-1;COUNT=4', { tz: 'Asia/Jakarta' }).days, ['2026-10-26', '2026-10-30', '2026-11-02', '2026-11-06']);
  // Yearly: the last weekday of the year.
  assert.deepEqual(ruleDays('20261231T090000', 'FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3', { tz: 'Asia/Jakarta' }).days, ['2026-12-31', '2027-12-31', '2028-12-29']);
});

test('negative BYMONTHDAY: days counted from the end of the month', () => {
  // RFC 5545: monthly on the third-to-the-last day of the month.
  assert.deepEqual(ruleDays('19970928T090000', 'FREQ=MONTHLY;BYMONTHDAY=-3', { to: '1998-03-01' }).days, ['1997-09-28', '1997-10-29', '1997-11-28', '1997-12-29', '1998-01-29', '1998-02-26']);
  // RFC 5545: the first and last day of the month for 10 occurrences.
  assert.deepEqual(ruleDays('19970930T090000', 'FREQ=MONTHLY;COUNT=10;BYMONTHDAY=1,-1').days, ['1997-09-30', '1997-10-01', '1997-10-31', '1997-11-01', '1997-11-30', '1997-12-01', '1997-12-31', '1998-01-01', '1998-01-31', '1998-02-01']);
  // The last day of February, leap years too; and the last day of every month, read by a daily rule.
  assert.deepEqual(ruleDays('20270228T090000', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1;COUNT=3').days, ['2027-02-28', '2028-02-29', '2029-02-28']);
  assert.deepEqual(ruleDays('20261031T090000', 'FREQ=DAILY;BYMONTHDAY=-1;COUNT=3').days, ['2026-10-31', '2026-11-30', '2026-12-31']);
  // RFC 5545: an invalid date (30 February) is skipped, not moved.
  assert.deepEqual(ruleDays('20070115T090000', 'FREQ=MONTHLY;BYMONTHDAY=15,30;COUNT=5').days, ['2007-01-15', '2007-01-30', '2007-02-15', '2007-03-15', '2007-03-30']);
  // Yearly with BYMONTHDAY and no BYMONTH: that day of every month.
  assert.deepEqual(ruleDays('20261001T090000', 'FREQ=YEARLY;BYMONTHDAY=1;COUNT=3').days, ['2026-10-01', '2026-11-01', '2026-12-01']);
});

test('negative BYDAY offsets: the last or second-to-last weekday of a month or a year', () => {
  // RFC 5545: monthly on the second-to-last Monday of the month for 6 months.
  assert.deepEqual(ruleDays('19970922T090000', 'FREQ=MONTHLY;COUNT=6;BYDAY=-2MO').days, ['1997-09-22', '1997-10-20', '1997-11-17', '1997-12-22', '1998-01-19', '1998-02-16']);
  // RFC 5545: every other month on the first and last Sunday of the month for 10 occurrences.
  assert.deepEqual(ruleDays('19970907T090000', 'FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU').days, ['1997-09-07', '1997-09-28', '1997-11-02', '1997-11-30', '1998-01-04', '1998-01-25', '1998-03-01', '1998-03-29', '1998-05-03', '1998-05-31']);
  // The last Sunday of October (the European clock change), and the last Monday of the year.
  assert.deepEqual(ruleDays('20261025T090000', 'FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;COUNT=3', { tz: 'Europe/Amsterdam' }).days, ['2026-10-25', '2027-10-31', '2028-10-29']);
  assert.deepEqual(ruleDays('20261228T090000', 'FREQ=YEARLY;BYDAY=-1MO;COUNT=3').days, ['2026-12-28', '2027-12-27', '2028-12-25']);
  // RFC 5545: every 20th Monday of the year.
  assert.deepEqual(ruleDays('19970519T090000', 'FREQ=YEARLY;BYDAY=20MO', { to: '2000-01-01' }).days, ['1997-05-19', '1998-05-18', '1999-05-17']);
  // RFC 5545: every Thursday in March (no ordinal: every one).
  assert.deepEqual(ruleDays('19970313T090000', 'FREQ=YEARLY;BYMONTH=3;BYDAY=TH', { to: '1999-01-01' }).days, ['1997-03-13', '1997-03-20', '1997-03-27', '1998-03-05', '1998-03-12', '1998-03-19', '1998-03-26']);
});

test('BYWEEKNO: weeks of the year, from the start or the end, as WKST says', () => {
  // RFC 5545: Monday of week number 20.
  assert.deepEqual(ruleDays('19970512T090000', 'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO', { to: '2000-01-01' }).days, ['1997-05-12', '1998-05-11', '1999-05-17']);
  // Week 1 has at least 4 days in its year: it starts on 4 January 2027, 3 January 2028 and 1 January 2029.
  assert.deepEqual(ruleDays('20270104T090000', 'FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO;COUNT=3').days, ['2027-01-04', '2028-01-03', '2029-01-01']);
  // The last week: 2026 has 53, 2027 and 2028 have 52.
  assert.deepEqual(ruleDays('20261231T090000', 'FREQ=YEARLY;BYWEEKNO=-1;BYDAY=TH;COUNT=3').days, ['2026-12-31', '2027-12-30', '2028-12-28']);
  // WKST changes which week is week 1.
  assert.deepEqual(ruleDays('20261231T090000', 'FREQ=YEARLY;BYWEEKNO=1;BYDAY=SU;WKST=SU;COUNT=2').days, ['2026-12-31', '2027-01-03']);
  assert.deepEqual(ruleDays('20261231T090000', 'FREQ=YEARLY;BYWEEKNO=1;BYDAY=SU;WKST=MO;COUNT=2').days, ['2026-12-31', '2027-01-10']);
  // Without BYDAY, every day of that week.
  assert.deepEqual(ruleDays('20270104T090000', 'FREQ=YEARLY;BYWEEKNO=1;COUNT=7').days, ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']);
});

test('BYYEARDAY: days of the year, from the start or the end', () => {
  // RFC 5545: every third year on the 1st, 100th and 200th day for 10 occurrences.
  assert.deepEqual(ruleDays('19970101T090000', 'FREQ=YEARLY;INTERVAL=3;COUNT=10;BYYEARDAY=1,100,200').days, ['1997-01-01', '1997-04-10', '1997-07-19', '2000-01-01', '2000-04-09', '2000-07-18', '2003-01-01', '2003-04-10', '2003-07-19', '2006-01-01']);
  // The last day of the year, and the 306th from the end (1 March, leap year or not).
  assert.deepEqual(ruleDays('20261231T090000', 'FREQ=YEARLY;BYYEARDAY=-1;COUNT=3').days, ['2026-12-31', '2027-12-31', '2028-12-31']);
  assert.deepEqual(ruleDays('20270301T090000', 'FREQ=YEARLY;BYYEARDAY=-306;COUNT=3').days, ['2027-03-01', '2028-03-01', '2029-03-01']);
});

test('EXDATE and RDATE in other time zones, as dates, and as periods', () => {
  const r = ruleDays('20261026T090000', 'FREQ=WEEKLY;BYDAY=MO;COUNT=4', {
    extra: [
      'EXDATE;TZID=Europe/London:20261102T140000', // 09:00 in New York on 2 November
      'EXDATE;VALUE=DATE:20261109', // the whole day
      'RDATE;TZID=Asia/Tokyo:20261105T230000', // 09:00 in New York on 5 November
      'RDATE;VALUE=PERIOD:20261120T140000Z/PT1H', // a period: its start counts
    ],
  });
  assert.deepEqual(r.days, ['2026-10-26', '2026-11-05', '2026-11-16', '2026-11-20']);
  assert.deepEqual(r.starts, ['2026-10-26T13:00:00.000Z', '2026-11-05T14:00:00.000Z', '2026-11-16T14:00:00.000Z', '2026-11-20T14:00:00.000Z'], '09:00 in New York each time, summer time or not');
  // RFC 5545: every Friday the 13th, leaving out DTSTART itself.
  assert.deepEqual(ruleDays('19970902T090000', 'FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', { extra: ['EXDATE;TZID=America/New_York:19970902T090000'], to: '2001-01-01' }).days, ['1998-02-13', '1998-03-13', '1998-11-13', '1999-08-13', '2000-10-13']);
  // RDATE alone (no RRULE): the first date and the extra ones.
  assert.deepEqual(ruleDays('20261015T140000', '', { tz: 'Asia/Jakarta', extra: ['RDATE;TZID=Asia/Jakarta:20261016T140000,20261020T140000'] }).days, ['2026-10-15', '2026-10-16', '2026-10-20']);
});

test('COUNT and UNTIL with the rare parts, and both at once', () => {
  // Both (RFC 5545 says not to, some calendars do): whichever ends it first.
  assert.deepEqual(ruleDays('19970902T090000', 'FREQ=DAILY;COUNT=10;UNTIL=19970905T000000Z').days, ['1997-09-02', '1997-09-03', '1997-09-04']);
  assert.deepEqual(ruleDays('19970902T090000', 'FREQ=DAILY;COUNT=2;UNTIL=19971224T000000Z').days, ['1997-09-02', '1997-09-03']);
  // UNTIL with BYWEEKNO and with BYYEARDAY; COUNT with BYSETPOS is above.
  assert.deepEqual(ruleDays('19970512T090000', 'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO;UNTIL=19990101T000000Z').days, ['1997-05-12', '1998-05-11']);
  assert.deepEqual(ruleDays('20260101T090000', 'FREQ=YEARLY;BYYEARDAY=1,-1;UNTIL=20280101T235959Z').days, ['2026-01-01', '2026-12-31', '2027-01-01', '2027-12-31', '2028-01-01']);
  // RFC 5545: U.S. Presidential Election day (BYMONTH, BYDAY and BYMONTHDAY together), every 4 years.
  assert.deepEqual(ruleDays('19961105T090000', 'FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8', { to: '2005-01-01' }).days, ['1996-11-05', '2000-11-07', '2004-11-02']);
});

test('WKST decides which week a day belongs to (RFC 5545 example)', () => {
  assert.deepEqual(ruleDays('19970805T090000', 'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO').days, ['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24']);
  assert.deepEqual(ruleDays('19970805T090000', 'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU').days, ['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31']);
});

/* ---------- all-day invites, wherever the person reading them is (beyond plus or minus 11 hours too) ---------- */

const FAR_ZONES = ['Pacific/Kiritimati', 'Pacific/Tongatapu', 'Pacific/Pago_Pago', 'Etc/GMT+12'];
/** The local days (in `tz`) an event on the calendar covers, read the way a browser in that zone reads it. */
function daysCovered(ev: { start: string; end: string }, tz: string) {
  const read = (s: string) => {
    if (/Z$|[+-]\d\d:\d\d$/.test(s)) return Date.parse(s); // a real instant
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)!; // floating: that wall clock, in the browser's zone
    return zonedToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], tz);
  };
  const s = read(ev.start);
  const e = read(ev.end);
  const out: string[] = [];
  for (let d = Date.UTC(2026, 9, 17); d < Date.UTC(2026, 9, 30); d += 86_400_000) {
    const day = new Date(d);
    const from = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, tz);
    if (s < from + 86_400_000 && e > from) out.push(day.toISOString().slice(0, 10)); // the calendar's eventsOn
  }
  return out;
}

test('an all-day invite stays on its dates at +14, +13, -11 and -12', async () => {
  const { inviteCalendarTimes } = await import('../src/inviteTimes.ts');
  const ev = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:far\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261022\nSUMMARY:Offsite\nEND:VEVENT\nEND:VCALENDAR`)!;
  const onCalendar = inviteCalendarTimes(ev, ev.allDay);
  assert.deepEqual(onCalendar, { start: '2026-10-20T00:00:00', end: '2026-10-22T00:00:00' });
  for (const tz of FAR_ZONES) {
    assert.deepEqual(daysCovered(onCalendar, tz), ['2026-10-20', '2026-10-21'], `on the 20th and 21st in ${tz}`);
    assert.equal(new Date(ev.start).toLocaleDateString('en-CA', { timeZone: 'UTC' }), '2026-10-20', 'the invite card reads its dates in UTC');
  }
  // What it used to put on the calendar (noon UTC): already the next day in Kiritimati and Tonga.
  assert.deepEqual(daysCovered({ start: ev.start, end: ev.end }, 'Pacific/Kiritimati'), ['2026-10-21', '2026-10-22']);
  // A one-day event, and a repeating one: each date stays itself.
  const one = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:one\nDTSTART;VALUE=DATE:20261023\nSUMMARY:Day off\nEND:VEVENT\nEND:VCALENDAR`)!;
  for (const tz of FAR_ZONES) assert.deepEqual(daysCovered(inviteCalendarTimes(one, true), tz), ['2026-10-23'], `one day in ${tz}`);
  const weekly = parseInvite(`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:wk\nDTSTART;VALUE=DATE:20261019\nDTEND;VALUE=DATE:20261020\nRRULE:FREQ=WEEKLY;COUNT=2\nEXDATE;VALUE=DATE:20261019\nRDATE;VALUE=DATE:20261021\nSUMMARY:Gym\nEND:VEVENT\nEND:VCALENDAR`)!;
  const dates = occurrences(weekly, 0, Date.parse('2027-01-01'))!;
  for (const tz of FAR_ZONES) assert.deepEqual(dates.map((o) => daysCovered(inviteCalendarTimes(o, true), tz)), [['2026-10-21'], ['2026-10-26']], `skipped, added and repeated dates in ${tz}`);
});

test('Outlook all-day events written as midnight in a far zone are the date they name', () => {
  const outlook = (tz: string) => `BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:ol\nDTSTART;TZID=${tz}:20261020T000000\nDTEND;TZID=${tz}:20261021T000000\nX-MICROSOFT-CDO-ALLDAYEVENT:TRUE\nSUMMARY:Holiday\nEND:VEVENT\nEND:VCALENDAR`;
  for (const tz of FAR_ZONES) {
    const ev = parseInvite(outlook(tz))!;
    assert.equal(ev.allDay, true, tz);
    assert.equal(ev.start, '2026-10-20T12:00:00.000Z', `the 20th, written in ${tz}`);
    assert.equal(ev.end, '2026-10-20T12:01:00.000Z');
    const feed = expand(parseCalendar(outlook(tz)), Date.parse('2026-10-01'), Date.parse('2026-11-01'));
    assert.deepEqual([feed[0].start, feed[0].end, feed[0].allDay], ['2026-10-20T00:00:00', '2026-10-21T00:00:00', true], `a calendar link reads it as the 20th too (${tz})`);
  }
  // Without the flag, midnight in Kiritimati is a real time: 10:00 UTC the day before.
  const timed = parseInvite(outlook('Pacific/Kiritimati').replace('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE\n', ''))!;
  assert.equal(timed.allDay, undefined);
  assert.equal(timed.start, '2026-10-19T10:00:00.000Z');
});
