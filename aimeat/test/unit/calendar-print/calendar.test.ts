/**
 * @file calendar.test.ts
 * @description Calendar contract: civil-time recurrence, exceptions, interchange and free time.
 * @version-history v1.0.0 - 2026-09-18 - New feature assertions, red before implementation.
 */
import { describe, expect, it } from 'vitest';
import { calendar } from '../../../src/static/sdk-libs/calendar/core.js';

const meeting = { id: 'weekly', title: 'Team meeting', start: '2026-03-23T09:00:00', end: '2026-03-23T10:00:00', timeZone: 'Europe/Helsinki', rrule: 'FREQ=WEEKLY;COUNT=3' };
const range = { from: '2026-03-01T00:00:00Z', to: '2026-05-01T00:00:00Z' };
describe('calendar', () => {
  it('keeps the local hour across daylight saving', () => {
    const rows = calendar.occurrences([meeting], range);
    expect(rows.map(r => r.start)).toEqual(['2026-03-23T07:00:00Z', '2026-03-30T06:00:00Z', '2026-04-06T06:00:00Z']);
    expect(rows.every(r => r.endMs - r.startMs === 3600000)).toBe(true);
  });
  it('moves and cancels individual occurrences, including a move into the requested range', () => {
    const event = { ...meeting, overrides: {
      '2026-03-30T09:00:00': { cancelled: true },
      '2026-04-06T09:00:00': { start: '2026-04-09T11:00:00', end: '2026-04-09T12:00:00', title: 'Moved' },
    } };
    const rows = calendar.occurrences([event], { from: '2026-04-09T00:00:00Z', to: '2026-04-10T00:00:00Z' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Moved');
    expect(rows[0].recurrenceId).toBe('2026-04-06T09:00:00');
    expect(calendar.occurrences([event], range)).toHaveLength(2);
  });
  it('supports monthly ordinal weekdays and skips absent month days', () => {
    const monthly = { ...meeting, start: '2026-01-31T09:00:00', end: '2026-01-31T10:00:00', rrule: 'FREQ=MONTHLY;COUNT=3' };
    expect(calendar.occurrences([monthly], { from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z' }).map(r => r.localStart.slice(0,10))).toEqual(['2026-01-31','2026-03-31','2026-05-31']);
    const ordinal = { ...meeting, start: '2026-03-30T09:00:00', end: '2026-03-30T10:00:00', rrule: 'FREQ=MONTHLY;BYDAY=-1MO;COUNT=2' };
    expect(calendar.occurrences([ordinal], range).map(r => r.localStart.slice(0,10))).toEqual(['2026-03-30','2026-04-27']);
  });
  it('uses exclusive all-day ends across DST', () => {
    const rows = calendar.occurrences([{ id:'holiday', start:'2026-03-29', end:'2026-03-30', allDay:true, timeZone:'Europe/Helsinki' }], range);
    expect(rows[0].endMs - rows[0].startMs).toBe(23*3600000);
  });
  it('rejects nonexistent authored local times and selects the first repeated hour', () => {
    expect(() => calendar.toInstant('2026-03-29T03:30:00','Europe/Helsinki')).toThrow();
    expect(calendar.toInstant('2026-10-25T03:30:00','Europe/Helsinki')).toBe('2026-10-25T00:30:00Z');
  });
  it('rejects invalid input and refuses unbounded queries', () => {
    expect(() => calendar.occurrences([meeting], { from:'no',to:'no' })).toThrow();
    expect(() => calendar.occurrences([{...meeting,end:'2026-03-23T08:00:00'}],range)).toThrow();
    expect(() => calendar.occurrences([meeting], {...range,limit:1})).toThrow(/limit/i);
  });
  it('merges busy overlaps but allows touching boundaries', () => {
    const free = calendar.freeSlots([{start:'2026-03-23T09:00:00Z',end:'2026-03-23T10:00:00Z'},{start:'2026-03-23T09:30:00Z',end:'2026-03-23T11:00:00Z'}], {from:'2026-03-23T08:00:00Z',to:'2026-03-23T12:00:00Z',minMinutes:30});
    expect(free.map(r=>[r.start,r.end])).toEqual([['2026-03-23T08:00:00Z','2026-03-23T09:00:00Z'],['2026-03-23T11:00:00Z','2026-03-23T12:00:00Z']]);
    expect(calendar.overlaps({start:'2026-03-23T08:00:00Z',end:'2026-03-23T09:00:00Z'},{start:'2026-03-23T09:00:00Z',end:'2026-03-23T10:00:00Z'})).toBe(false);
    expect(calendar.week('2021-01-01')).toEqual({year:2020,week:53});
  });
  it('round trips Unicode, recurrence, additions, exclusions and moved instances through ICS', () => {
    const event = {...meeting,title:'Ääni, työ; kokous',description:'Line one\nLine two',exdates:['2026-03-30T09:00:00'],rdates:['2026-04-10T09:00:00'],overrides:{'2026-04-06T09:00:00':{start:'2026-04-07T10:00:00',end:'2026-04-07T11:00:00'}}};
    const ics = calendar.toICS([event]);
    expect(ics).toContain('BEGIN:VTIMEZONE');
    const imported = calendar.fromICS(ics);
    expect(imported[0].title).toBe(event.title);
    expect(calendar.occurrences(imported,range).map(r=>[r.start,r.end])).toEqual(calendar.occurrences([event],range).map(r=>[r.start,r.end]));
  });
  it('does not silently discard unsupported recurrence ranges or malformed calendars', () => {
    expect(()=>calendar.fromICS('hello')).toThrow();
    expect(()=>calendar.fromICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20260323T090000Z\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260323T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR')).toThrow(/RANGE/);
  });
  it('imports point events and cancelled overrides with no DTEND', () => {
    const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20260323T090000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:x\r\nRECURRENCE-ID:20260324T090000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const rows=calendar.occurrences(calendar.fromICS(ics),range);
    expect(rows).toHaveLength(1);expect(rows[0].start).toBe(rows[0].end);
  });
  it('does not count generated DST gaps and keeps yearly leap-day rules', () => {
    const gap={...meeting,start:'2026-03-28T03:30:00',end:'2026-03-28T04:30:00',rrule:'FREQ=DAILY;COUNT=3'};
    expect(calendar.occurrences([gap],range).map(r=>r.localStart.slice(0,10))).toEqual(['2026-03-28','2026-03-30','2026-03-31']);
    const leap={id:'leap',start:'2024-02-29',end:'2024-03-01',allDay:true,rrule:'FREQ=YEARLY;COUNT=3'};
    expect(calendar.occurrences([leap],{from:'2024-01-01T00:00:00Z',to:'2033-01-01T00:00:00Z'}).map(r=>r.localStart)).toEqual(['2024-02-29','2028-02-29','2032-02-29']);
  });
  it('round trips folded Unicode lines and prevents property injection', () => {
    const event={...meeting,title:'Työ '.repeat(60)+'\nATTENDEE:evil'};
    const ics=calendar.toICS([event]);
    expect(ics.split('\r\n').every(line=>Buffer.byteLength(line,'utf8')<=75)).toBe(true);
    expect(calendar.fromICS(ics)[0].title).toBe(event.title);
    expect(ics).not.toContain('\r\nATTENDEE:');
  });
  it('bounds impossible rules and applies UTC UNTIL across a DST change', () => {
    const impossible={...meeting,rrule:'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'};
    expect(calendar.occurrences([impossible],range)).toEqual([]);
    const until={...meeting,rrule:'FREQ=WEEKLY;UNTIL=20260330T060000Z'};
    expect(calendar.occurrences([until],range).map(r=>r.start)).toEqual(['2026-03-23T07:00:00Z','2026-03-30T06:00:00Z']);
  });
  it('escapes a lone carriage return instead of writing a new ICS property', () => {
    const ics=calendar.toICS([{...meeting,title:'Meeting\rATTENDEE:unexpected'}]);
    expect(ics).not.toContain('Meeting\rATTENDEE:');
    expect(calendar.fromICS(ics)[0].title).toBe('Meeting\nATTENDEE:unexpected');
  });
});
