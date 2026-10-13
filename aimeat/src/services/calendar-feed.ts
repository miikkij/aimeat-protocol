/**
 * @file src/services/calendar-feed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace's calendar as an ICS feed a calendar program subscribes to: the records
 *   of one shared records space written as RFC 5545, and the feed key that opens that rendering.
 *
 *   WHY IT IS A RENDERING OF THE SHARE AND NOT A FEATURE OF ITS OWN. A workspace already has one
 *   way to let somebody without a membership read it: the share (meta.share), which its creator or
 *   an organism admin sets, space by space, with an access mode. A calendar is a records space
 *   whose records are events, so "my calendar in Google Calendar" is that same read in another
 *   format: GET …/workspace/public/records?ws=&space=&format=ics. Nothing new decides what is
 *   shared, and a second list of what is public does not exist to drift from the first.
 *
 *   WHY A FEED KEY. A calendar program fetches a URL on its own clock. It cannot sign in, and it
 *   cannot trade a password for a share token, so a share that asks for an account or a password
 *   would refuse every calendar. The feed key is a credential made for that one reader: 32 random
 *   bytes the node makes, shown once, kept as a SHA-256, sent in the URL (the form every calendar
 *   provider's "secret address" has). It opens the ICS rendering of the spaces the share already
 *   opens, and nothing else: not the JSON read, not another space, not another workspace. Making it
 *   again ends the old one; clearing it ends the feed.
 *
 *   WHAT GOES INTO THE FEED. An event is a record in the shape the served library aimeat-calendar
 *   defines (id, title, start, end, timeZone, allDay, rrule, rdates, exdates, overrides,
 *   description, location, transparent, cancelled). Only those fields are read from a record: a
 *   customer's address or an internal note that sits in the same record never enters the feed,
 *   whatever the writer of the feed does with unknown fields. A record that is not an event (no
 *   start, an end before its start, a broken rule) is left out, and the feed is still served.
 *
 *   THE WRITER IS THE LIBRARY'S OWN. The ICS text is written by the same module the browser
 *   library is built from (src/static/sdk-libs/calendar/core.js, which says of itself that server
 *   code may import it), loaded once from the static tree. One writer, so a file an app exports
 *   and the feed the node serves are the same format.
 * @structure
 *   - newIcsKey() · icsKeyMatches(hash, key)
 *   - recordsToIcs(records, name)
 *   - MAX_FEED_EVENTS
 * @usage import { recordsToIcs, newIcsKey, icsKeyMatches } from '../../services/calendar-feed.js';
 * @version-history
 *   v1.1.0 — 2026-10-13 — The library loader moved to services/calendar-lib.ts unchanged, because an
 *     extension's calendar host calls (services/extension-calendar.ts) are its second caller.
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P3, way 1).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { calendarLib, type CalendarLib } from './calendar-lib.js';

/** How many events one feed carries. A calendar program reads the whole file on every fetch. */
export const MAX_FEED_EVENTS = 5000;

/** The fields of a record that are an event's. Nothing else is read from a record. */
const EVENT_FIELDS = [
  'id', 'title', 'start', 'end', 'timeZone', 'allDay', 'rrule', 'rdates', 'exdates', 'overrides',
  'description', 'location', 'transparent', 'cancelled',
] as const;
/** The fields of one changed occurrence (`overrides[date]`). */
const OVERRIDE_FIELDS = ['title', 'start', 'end', 'timeZone', 'description', 'location', 'transparent', 'cancelled'] as const;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A new feed key and the hash the share keeps. The key is shown to its maker once. */
export function newIcsKey(): { key: string; hash: string } {
  const key = randomBytes(32).toString('base64url');
  return { key, hash: sha256(key) };
}

/** Does this key open the share's feed? Compared in constant time; no key or no hash is a no. */
export function icsKeyMatches(hash: string | null, key: unknown): boolean {
  if (!hash || typeof key !== 'string' || key.length < 20 || key.length > 200) return false;
  const given = Buffer.from(sha256(key), 'hex');
  const kept = Buffer.from(hash, 'hex');
  return given.length === kept.length && timingSafeEqual(given, kept);
}

const pick = (source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter(f => source[f] !== undefined && source[f] !== null).map(f => [f, source[f]]));

/** A record as an event: its event fields and nothing else, or null when the value is no object. */
function eventOf(record: { id: string; value: unknown }): Record<string, unknown> | null {
  const v = record.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const event = pick(v as Record<string, unknown>, EVENT_FIELDS);
  if (typeof event.id !== 'string' || !event.id) event.id = record.id;
  if (event.overrides && typeof event.overrides === 'object' && !Array.isArray(event.overrides)) {
    event.overrides = Object.fromEntries(Object.entries(event.overrides as Record<string, unknown>)
      .filter(([, patch]) => !!patch && typeof patch === 'object' && !Array.isArray(patch))
      .map(([date, patch]) => [date, pick(patch as Record<string, unknown>, OVERRIDE_FIELDS)]));
  } else {
    delete event.overrides;
  }
  return event;
}

export interface IcsFeed {
  ics: string;
  /** Events written. */
  events: number;
  /** Records left out because they are not an event the library accepts, or past MAX_FEED_EVENTS. */
  skipped: number;
}

/**
 * The records of one space as an ICS calendar. A record that is not an event is left out; a
 * second record with an id already written is left out too, because a calendar program keys an
 * event by its UID.
 */
export async function recordsToIcs(records: Array<{ id: string; value: unknown }>, name?: string): Promise<IcsFeed> {
  const calendar = await calendarLib();
  // The time-zone rules written into the file cover these years. The writer otherwise spans from
  // the earliest event to ten years past the latest and refuses a span over fifty years, so one
  // birthday series that began in 1970 would end the whole feed.
  const thisYear = new Date().getUTCFullYear();
  const options = { fromYear: thisYear - 2, toYear: thisYear + 10, ...(name ? { name } : {}) };
  const events: unknown[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  for (const record of records) {
    const event = eventOf(record);
    if (!event || ids.has(event.id as string) || events.length >= MAX_FEED_EVENTS || !accepted(calendar, event, options)) { skipped++; continue; }
    ids.add(event.id as string);
    events.push(event);
  }
  return { ics: calendar.toICS(events, options), events: events.length, skipped };
}

/**
 * Does the library take this record as an event? `normalize` judges the times. A recurrence rule
 * or a changed occurrence is judged by the writer, so an event that has one is written alone
 * first: what the writer refuses is that record's fault, and it must not end the feed for the rest.
 */
function accepted(calendar: CalendarLib, event: Record<string, unknown>, options: { fromYear: number; toYear: number }): boolean {
  try {
    calendar.normalize(event);
    if (event.rrule !== undefined || event.overrides !== undefined) calendar.toICS([event], options);
    return true;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the library's refusal IS the answer "this record is not an event": the caller counts it in `skipped`, which the route sends as X-Calendar-Skipped, and a log line per such record on every fetch of every feed would bury the log
    return false;
  }
}
