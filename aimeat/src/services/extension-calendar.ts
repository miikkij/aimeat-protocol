/**
 * @file src/services/extension-calendar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.calendar`: the calendar library's computation as host calls of an extension.
 *
 *   WHY HOST CALLS. An extension runs in a sandbox that has no `Intl` and no time-zone data, and
 *   the served library is a browser bundle larger than a script may be. So an extension could not
 *   expand a recurrence, find free time or turn "09:00 in Helsinki" into an instant across a
 *   daylight-saving change, and a tool that answers "what is in the calendar this week" had to
 *   read an index some open page had written, stale whenever nobody had the page open (measured
 *   by the aimeat-apps session building the calendar app, 2026-10-13). These calls run the same
 *   library code the browser runs (services/calendar-lib.ts), on the node.
 *
 *   PURE COMPUTATION. Nothing here reads or writes storage or the network, so the calls need no
 *   capability in the manifest and exist on every code path that runs an extension. Each is one
 *   host call and counts against the run's call budget.
 *
 *   BOUNDED ON THE HOST. The work runs outside the sandbox's own limits, so each call takes at
 *   most CALENDAR_HOST_LIMITS of input and of expansion, tighter than the library's own ceilings.
 *
 *   A REFUSAL IS THROWN INTO THE SCRIPT as `CALENDAR: <the library's own message>`: a local time
 *   that does not exist in the zone, an end before a start, a malformed rule, a range too large.
 * @structure CALENDAR_HOST_LIMITS · buildExtensionCalendar()
 * @usage ctx.calendar = buildExtensionCalendar();
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, brief 11).
 */
import type { ExtensionCtx } from './extension-runtime.js';
import { calendarLib, type CalendarLib } from './calendar-lib.js';

/** The most one host call takes: event series, occurrences or busy intervals, and characters of ICS text. */
export const CALENDAR_HOST_LIMITS = { events: 2000, occurrences: 5000, icsChars: 1_000_000 } as const;

const PREFIX = 'CALENDAR: ';
function refuse(message: string): never { throw new Error(PREFIX + message); }

function list(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) refuse(`${what} must be an array`);
  const items = value as unknown[];
  if (items.length > max) refuse(`at most ${max} ${what} in one call, got ${items.length}`);
  return items;
}
function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) refuse(`${what} must be a string`);
  return value as string;
}
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** The calendar host calls. See the file header. */
export function buildExtensionCalendar(): NonNullable<ExtensionCtx['calendar']> {
  // The library throws RangeError and TypeError with a sentence a person can act on; the script
  // gets that sentence under one prefix it can test for. A refusal made here already carries it.
  const run = async <T>(fn: (lib: CalendarLib) => T): Promise<T> => {
    const lib = await calendarLib();
    try { return fn(lib); } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message.startsWith(PREFIX) ? message : PREFIX + message, { cause: err });
    }
  };
  return {
    occurrences: (events, options) => run((lib) => {
      const o = object(options);
      const asked = typeof o.limit === 'number' && Number.isFinite(o.limit) && o.limit >= 1 ? Math.floor(o.limit) : CALENDAR_HOST_LIMITS.occurrences;
      return lib.occurrences(list(events, 'event series', CALENDAR_HOST_LIMITS.events), {
        from: text(o.from, 'from'), to: text(o.to, 'to'), limit: Math.min(asked, CALENDAR_HOST_LIMITS.occurrences),
      });
    }),
    freeSlots: (busy, options) => run((lib) => {
      const o = object(options);
      return lib.freeSlots(list(busy, 'busy intervals', CALENDAR_HOST_LIMITS.occurrences), {
        from: text(o.from, 'from'), to: text(o.to, 'to'),
        ...(typeof o.minMinutes === 'number' ? { minMinutes: o.minMinutes } : {}),
        ...(o.windows !== undefined ? { windows: list(o.windows, 'windows', CALENDAR_HOST_LIMITS.events) } : {}),
      });
    }),
    toInstant: (local, timeZone) => run((lib) => lib.toInstant(text(local, 'the local time'), text(timeZone, 'timeZone'))),
    fromInstant: (instant, timeZone) => run((lib) => lib.fromInstant(text(instant, 'the instant'), text(timeZone, 'timeZone'))),
    normalize: (event) => run((lib) => lib.normalize(event)),
    fromICS: (ics, options) => run((lib) => {
      const input = text(ics, 'the ICS text');
      if (input.length > CALENDAR_HOST_LIMITS.icsChars) refuse(`an ICS text of at most ${CALENDAR_HOST_LIMITS.icsChars} characters in one call, got ${input.length}`);
      return lib.fromICS(input, object(options));
    }),
    toICS: (events, options) => run((lib) => {
      const o = object(options);
      return lib.toICS(list(events, 'events', CALENDAR_HOST_LIMITS.events), {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.fromYear === 'number' ? { fromYear: o.fromYear } : {}),
        ...(typeof o.toYear === 'number' ? { toYear: o.toYear } : {}),
      });
    }),
  };
}
