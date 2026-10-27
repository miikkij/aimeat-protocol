/**
 * @file calendar.test.ts
 * @description Calendar contract: civil-time recurrence, exceptions, interchange and free time.
 * @version-history v1.0.0 - 2026-09-18 - New feature assertions, red before implementation.
 *   v1.1.0 - 2026-10-25 - Rules that held the recurrence engine without end, or walked it to the year
 *     9999, end with no occurrence or a refusal; reachable sub-daily rules expand as before
 *     (secaudit2026oct22).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  // secaudit2026oct22: rrule 2.8.1 loops without end inside one step when a sub-daily BY-time limit
  // can never be reached, and walks every period to the year 9999 when a day filter never matches.
  // The engine runs synchronously, so the hanging cases run in a child process with a kill.
  const probe = (rule: string, ...rest: string[]) => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./rrule-probe.mjs', import.meta.url)), rule, ...rest], { timeout: 10000, encoding: 'utf8' });
    if (r.error) return { killed: true } as const;
    return JSON.parse(r.stdout.trim()) as { ok: boolean; starts?: string[]; error?: string; ms: number };
  };
  it.each([
    'FREQ=HOURLY;BYHOUR=25', 'FREQ=HOURLY;INTERVAL=2;BYHOUR=1', 'FREQ=MINUTELY;BYMINUTE=61',
    'FREQ=SECONDLY;BYSECOND=60', 'FREQ=MINUTELY;INTERVAL=120;BYHOUR=1',
  ])('ends a sub-daily rule whose BY-time limit is never reached (%s) with no occurrence', (rule) => {
    expect(probe(rule)).toMatchObject({ ok: true, starts: [] });
  });
  it.each(['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=WEEKLY;BYMONTH=2;BYMONTHDAY=30'])(
    'stops an impossible day filter (%s) at the end of the range', (rule) => {
      const out = probe(rule);
      expect(out).toMatchObject({ ok: true, starts: [] });
      expect('ms' in out && out.ms).toBeLessThan(1500);
    });
  it('refuses an impossible rule that would walk from the year 1, instead of walking it', () => {
    expect(probe('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', '0001-01-01T00:00:00')).toMatchObject({ ok: false, error: 'Recurrence iteration limit exceeded; shorten the series' });
  });
  it.each([
    ['FREQ=HOURLY;INTERVAL=3;BYHOUR=9,12,15', '2026-01-01T00:00:00', '2026-01-03T00:00:00Z', ['2026-01-01T09:00:00','2026-01-01T12:00:00','2026-01-01T15:00:00','2026-01-02T09:00:00','2026-01-02T12:00:00','2026-01-02T15:00:00']],
    ['FREQ=MINUTELY;INTERVAL=15;BYHOUR=9,10;BYMINUTE=0,30', '2026-01-01T08:00:00', '2026-01-02T00:00:00Z', ['2026-01-01T09:00:00','2026-01-01T09:30:00','2026-01-01T10:00:00','2026-01-01T10:30:00']],
    ['FREQ=HOURLY;BYHOUR=9;COUNT=3', '2026-01-01T10:00:00', '2026-02-01T00:00:00Z', ['2026-01-02T09:00:00','2026-01-03T09:00:00','2026-01-04T09:00:00']],
    ['FREQ=SECONDLY;INTERVAL=20;BYHOUR=9;BYMINUTE=0;BYSECOND=0,40;COUNT=5', '2026-01-01T08:59:00', '2026-02-01T00:00:00Z', ['2026-01-01T09:00:00','2026-01-01T09:00:40','2026-01-02T09:00:00','2026-01-02T09:00:40','2026-01-03T09:00:00']],
    ['FREQ=HOURLY;INTERVAL=5;BYDAY=MO;BYHOUR=10,15', '2026-01-05T00:00:00', '2026-01-20T00:00:00Z', ['2026-01-05T10:00:00','2026-01-05T15:00:00']],
    ['FREQ=HOURLY;INTERVAL=2;BYHOUR=1,3;BYMINUTE=0,20;BYSETPOS=-1', '2026-01-01T01:00:00', '2026-01-02T00:00:00Z', ['2026-01-01T01:20:00','2026-01-01T03:20:00']],
    // The engine's own answer for this one was 03:30, 03:00, 06:30. With INTERVAL 90 and BYHOUR the
    // limit is applied to the yielded dates, which gives the RFC 5545 answer.
    ['FREQ=MINUTELY;INTERVAL=90;BYHOUR=3,6', '2026-01-01T00:00:00', '2026-01-03T00:00:00Z', ['2026-01-01T03:00:00','2026-01-01T06:00:00','2026-01-02T03:00:00','2026-01-02T06:00:00']],
  ])('expands the reachable sub-daily rule %s as before', (rule, start, to, starts) => {
    const end = new Date(Date.parse(start + 'Z') + 60_000).toISOString().slice(0, 19);
    const rows = calendar.occurrences([{ id: 'r', start, end, timeZone: 'UTC', rrule: rule }], { from: '2026-01-01T00:00:00Z', to });
    expect(rows.map(r => r.localStart)).toEqual(starts);
  });
  // secaudit2026oct26: rrule 2.8.1 builds the whole BYHOUR x BYMINUTE x BYSECOND product before the
  // first period, outside every budget. A product past 24 x 60 x 60, which no rule of distinct
  // in-range values reaches, is refused before the engine starts.
  it('refuses a rule whose BY-time lists multiply past one day of seconds, before the engine builds them', () => {
    const list = (v: number) => Array(300).fill(v).join(',');
    const out = probe(`FREQ=DAILY;BYHOUR=${list(9)};BYMINUTE=${list(0)};BYSECOND=${list(0)}`);
    expect(out).toMatchObject({ ok: false, error: 'Recurrence iteration limit exceeded; shorten the series' });
    expect('ms' in out && out.ms).toBeLessThan(1500);
  });
  it('expands a daily rule with several hours, minutes and seconds as before', () => {
    const rows = calendar.occurrences([{ id: 't', start: '2026-01-01T08:00:00', end: '2026-01-01T08:01:00', timeZone: 'UTC', rrule: 'FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0,30;BYSECOND=0' }],
      { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(rows.map(r => r.localStart)).toEqual(['2026-01-01T09:00:00', '2026-01-01T09:30:00', '2026-01-01T17:00:00', '2026-01-01T17:30:00']);
  });
  it('keeps every date of a long range and of a sparse rule that started long ago', () => {
    const daily = calendar.occurrences([{ id: 'd', start: '2026-01-01T09:00:00', end: '2026-01-01T10:00:00', timeZone: 'UTC', rrule: 'FREQ=DAILY' }], { from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' });
    expect(daily).toHaveLength(364);
    const leap = calendar.occurrences([{ id: 'l', start: '2000-01-01T09:00:00', end: '2000-01-01T10:00:00', timeZone: 'UTC', rrule: 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29' }], { from: '2028-02-01T00:00:00Z', to: '2028-03-01T00:00:00Z' });
    expect(leap.map(r => r.localStart)).toEqual(['2028-02-29T09:00:00']);
  });
  it('escapes a lone carriage return instead of writing a new ICS property', () => {
    const ics=calendar.toICS([{...meeting,title:'Meeting\rATTENDEE:unexpected'}]);
    expect(ics).not.toContain('Meeting\rATTENDEE:');
    expect(calendar.fromICS(ics)[0].title).toBe('Meeting\nATTENDEE:unexpected');
  });
});
