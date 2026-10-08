// Run: node --import ./server/register.mjs --test server/ics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReply, durationMs, findMeetingLink, ianaOf, occurrences, parseIcs, parseInvite, zonedToUtc } from './ics.ts';

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
  const lastFri = occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270101T000000Z' }, 0, Infinity)!;
  assert.deepEqual(lastFri.map((o) => o.start.slice(0, 10)), ['2026-10-30', '2026-11-27', '2026-12-25']);
  const days = occurrences({ ...base, rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=3' }, 0, Infinity)!;
  assert.deepEqual(days.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-15', '2026-10-17']);
  const monthDay = occurrences({ ...base, rrule: 'FREQ=MONTHLY;COUNT=2' }, 0, Infinity)!;
  assert.deepEqual(monthDay.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-11-13']);
  const yearly = occurrences({ ...base, rrule: 'FREQ=YEARLY;COUNT=2' }, 0, Infinity)!;
  assert.deepEqual(yearly.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2027-10-13']);
  const biweekly = occurrences({ ...base, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=4' }, 0, Infinity)!;
  assert.deepEqual(biweekly.map((o) => o.start.slice(0, 10)), ['2026-10-13', '2026-10-15', '2026-10-27', '2026-10-29']);
  assert.equal(occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=TU' }, 0, Infinity), null);
  assert.equal(occurrences({ ...base, rrule: 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2' }, 0, Infinity), null);
  assert.equal(occurrences({ ...base, rrule: 'FREQ=HOURLY' }, 0, Infinity), null);
  assert.deepEqual(occurrences({ ...base }, 0, Infinity), [{ start: base.start, end: base.end }]);
});

test('junk is not an invite', () => {
  assert.equal(parseInvite('hello'), null);
  assert.equal(parseInvite('BEGIN:VCALENDAR\nMETHOD:REQUEST\nEND:VCALENDAR'), null);
  assert.equal(parseInvite('BEGIN:VCALENDAR\nMETHOD:COUNTER\nBEGIN:VEVENT\nUID:a\nDTSTART:20261020T010000Z\nEND:VEVENT\nEND:VCALENDAR'), null);
});
