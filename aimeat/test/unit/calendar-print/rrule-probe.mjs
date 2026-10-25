/**
 * @file rrule-probe.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Child process for calendar.test.ts: expands one rule over one month and prints the
 *   result as JSON. A rule that holds the recurrence engine in an endless synchronous loop would hold
 *   the test runner too, so the test runs this file in a child with a wall-clock kill.
 * @usage node test/unit/calendar-print/rrule-probe.mjs "<RRULE>" [start] [from] [to]
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { calendar } from '../../../src/static/sdk-libs/calendar/core.js';

const [rrule, start = '2026-01-01T00:00:00', from = '2026-01-01T00:00:00Z', to = '2026-02-01T00:00:00Z'] = process.argv.slice(2);
const end = new Date(Date.parse(start + 'Z') + 60_000).toISOString().slice(0, 19);
const t0 = Date.now();
try {
  const rows = calendar.occurrences([{ id: 'e', start, end, timeZone: 'UTC', rrule }], { from, to });
  console.log(JSON.stringify({ ok: true, starts: rows.map(r => r.localStart), ms: Date.now() - t0 }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message), ms: Date.now() - t0 }));
}
