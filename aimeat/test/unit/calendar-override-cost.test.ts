/**
 * @file test/unit/calendar-override-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing or expanding one event costs time in proportion to its size (secaudit2026oct26,
 *   calendar/ics.js:toICS:override-renormalizes-whole-master). toICS and occurrences checked each
 *   changed occurrence by normalising a copy of the whole master event, its additions, exclusions and
 *   every other changed occurrence included, so one stored event with many of each made the public
 *   ICS feed quadratic. The work runs in a child process with a time limit, so a slow writer fails this
 *   test instead of holding the runner. The written calendar of an ordinary event is unchanged.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { calendar } from '../../src/static/sdk-libs/calendar/core.js';

const CORE = pathToFileURL(resolve(__dirname, '../../src/static/sdk-libs/calendar/core.js')).href;

/** One weekly event with `k` changed occurrences and `k` exclusions. */
const BIG = (k: number) => `(() => {
  const pad = n => String(n).padStart(2, '0');
  const day = i => { const d = new Date(Date.UTC(2026, 0, 5) + i * 7 * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const overrides = {}, exdates = [];
  for (let i = 0; i < ${k}; i++) { overrides[day(2 * i) + 'T09:00:00'] = { title: 'moved ' + i }; exdates.push(day(2 * i + 1) + 'T09:00:00'); }
  return { id: 'big', title: 'Weekly', start: '2026-01-05T09:00:00', end: '2026-01-05T10:00:00', timeZone: 'Europe/Helsinki', rrule: 'FREQ=WEEKLY', overrides, exdates };
})()`;

/** Milliseconds the child took for `work`, or null when it did not finish within `ms`. */
function timed(work: string, ms: number): number | null {
  const code = `import { calendar } from ${JSON.stringify(CORE)};`
    + `const e = ${BIG(1500)}; const t = Date.now(); ${work}; process.stdout.write('\\nTOOK ' + (Date.now() - t));`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { timeout: ms, encoding: 'utf8', killSignal: 'SIGKILL' });
  const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('TOOK '));
  return r.status === 0 && line ? Number(line.slice(5)) : null;
}

describe('one event with many changed occurrences', () => {
  it('is written to ICS within a few seconds', () => {
    const took = timed('calendar.toICS([e], { fromYear: 2025, toYear: 2060 })', 60_000);
    expect(took, 'toICS did not finish in a minute').not.toBeNull();
    expect(took!).toBeLessThan(15_000);
  }, 90_000);

  it('is expanded over a month within a few seconds', () => {
    const took = timed("calendar.occurrences([e], { from: '2026-03-01T00:00:00Z', to: '2026-04-01T00:00:00Z' })", 60_000);
    expect(took, 'occurrences did not finish in a minute').not.toBeNull();
    expect(took!).toBeLessThan(15_000);
  }, 90_000);
});

describe('an ordinary event is written as before', () => {
  it('keeps a changed occurrence with its own title, start and recurrence id', () => {
    const ics = calendar.toICS([{
      id: 'w', title: 'Team', start: '2026-03-23T09:00:00', end: '2026-03-23T10:00:00', timeZone: 'Europe/Helsinki',
      rrule: 'FREQ=WEEKLY;COUNT=3', exdates: ['2026-03-30T09:00:00'],
      overrides: { '2026-04-06T09:00:00': { start: '2026-04-07T10:00:00', end: '2026-04-07T11:00:00', title: 'Moved' } },
    }], { fromYear: 2025, toYear: 2027 });
    expect(ics).toContain('SUMMARY:Moved');
    expect(ics).toMatch(/RECURRENCE-ID;TZID=Europe\/Helsinki:20260406T090000/);
    expect(ics).toMatch(/EXDATE;TZID=Europe\/Helsinki:20260330T090000/);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });

  it('still refuses a changed occurrence whose end comes before its start', () => {
    expect(() => calendar.toICS([{
      id: 'w', title: 'Team', start: '2026-03-23T09:00:00', end: '2026-03-23T10:00:00', timeZone: 'UTC',
      rrule: 'FREQ=WEEKLY;COUNT=3', overrides: { '2026-03-30T09:00:00': { start: '2026-03-30T11:00:00', end: '2026-03-30T10:00:00' } },
    }])).toThrow();
  });
});
