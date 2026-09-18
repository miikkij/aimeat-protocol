/**
 * @file calendar/core.js
 * @description DOM-free public calendar API, importable by server code and browser agents alike.
 * @version-history v1.0.0 - 2026-09-18 - Initial API.
 */
import { normalize, occurrences, overlaps, freeSlots } from './events.js';
import { toInstant, fromInstant, week } from './time.js';
import { fromICS, toICS } from './ics.js';
export const calendar = {version:'1.0.0',normalize,occurrences,overlaps,freeSlots,toInstant,fromInstant,week,fromICS,toICS};
