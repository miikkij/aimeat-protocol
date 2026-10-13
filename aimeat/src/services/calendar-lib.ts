/**
 * @file src/services/calendar-lib.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The served calendar library (aimeat-calendar), loaded by the node itself. The
 *   library's core (src/static/sdk-libs/calendar/core.js) is DOM-free and says a server may import
 *   it; this module does that once, from the static tree, so the node computes with the code the
 *   browser runs and no second calendar exists.
 *
 *   Two callers: the ICS feed of a shared record space (services/calendar-feed.ts) and the calendar
 *   host calls of an extension (services/extension-calendar.ts).
 *
 *   Moved out of calendar-feed.ts unchanged when the extension host calls became its second
 *   caller; the interface below names the functions the two use.
 * @structure CalendarLib · calendarLib()
 * @usage const calendar = await calendarLib(); calendar.toICS(events, { name });
 * @version-history
 *   v1.0.0 — 2026-10-13 — Extracted from services/calendar-feed.ts (the loader, unchanged), with the
 *     interface widened to the functions an extension is given.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveAssetDir } from '../server-bootstrap/asset-dirs.js';
import { logger } from '../utils/logger.js';

/** What the node uses of the calendar library. Shapes are the library's own (sdk-libs/calendar). */
export interface CalendarLib {
  normalize(event: unknown): unknown;
  occurrences(events: unknown[], options: { from: string; to: string; limit?: number; maxIterations?: number }): unknown[];
  freeSlots(busy: unknown[], options: { from: string; to: string; minMinutes?: number; windows?: unknown[] }): unknown[];
  toInstant(local: string, timeZone?: string): string;
  fromInstant(instant: string, timeZone?: string): string;
  fromICS(text: string, options?: Record<string, unknown>): unknown;
  toICS(events: unknown[], options?: { name?: string; fromYear?: number; toYear?: number }): string;
}

let lib: Promise<CalendarLib> | null = null;
/** The library's DOM-free core, loaded once from the static tree (src/static in a checkout, dist/static in a package). */
export function calendarLib(): Promise<CalendarLib> {
  lib ??= (async () => {
    const dir = resolveAssetDir('static', dirname(fileURLToPath(import.meta.url)), process.cwd());
    if (!dir) throw new Error('The static tree is not on this node, so the calendar library cannot be loaded.');
    const mod = await import(pathToFileURL(join(dir, 'sdk-libs', 'calendar', 'core.js')).href) as { calendar: CalendarLib };
    return mod.calendar;
  })();
  // A failed load is tried again on the next request: a cached rejection would end every caller
  // until a restart. The request that met the failure gets it through the returned promise.
  lib.catch((err) => { lib = null; logger.error('calendar-lib: the calendar library did not load', { error: String(err) }); });
  return lib;
}
