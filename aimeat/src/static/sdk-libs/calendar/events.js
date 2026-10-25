/**
 * @file calendar/events.js
 * @description Bounded RRULE expansion in civil time, with additions, exclusions and detached overrides.
 * @version-history v1.0.0 - 2026-09-18 - Calendar event model and recurrence.
 *   2026-10-13 - The recurrence class is read from the package's namespace or its default, so Node imports this file.
 *   2026-10-25 - The engine's own work is bounded: a sub-daily BY-time limit no step can reach yields no
 *     occurrence instead of an endless loop, an impossible day filter stops at the end of the range, and
 *     the periods one call walks are counted (secaudit2026oct22).
 */
import * as rruleModule from 'rrule';
// The package is an ES module to the bundler and CommonJS to Node, which finds no named export in
// it: the class is on the namespace in one and on its default in the other. Read from either, so
// the node itself can import this file (services/calendar-feed.ts) as core.js says it can.
const RRule = rruleModule.RRule ?? /** @type {any} */ (rruleModule).default.RRule;
import { local, zoned, fromInstant, iso, wallMs, wallString, rangeMs } from './time.js';

/** @typedef {{id:string,title?:string,start:string,end:string,timeZone?:string,allDay?:boolean,rrule?:string,rdates?:string[],exdates?:string[],overrides?:Record<string,any>,description?:string,location?:string,transparent?:boolean,cancelled?:boolean}} CalendarEvent */

/** @param {CalendarEvent} source */
export function normalize(source) {
  if (!source || !source.id || typeof source.id !== 'string') throw new TypeError('Event id is required');
  const e = {...source, timeZone:source.timeZone || 'UTC',allDay:!!source.allDay};
  e.start = local(e.start,e.allDay); e.end = local(e.end,e.allDay);
  if (wallMs(e.end) < wallMs(e.start) || (e.allDay && e.end===e.start)) throw new RangeError('Event end must follow start (all-day end is exclusive)');
  zoned(e.start,e.timeZone); zoned(e.end,e.timeZone);
  for (const v of [...(e.rdates || []),...(e.exdates || []),...Object.keys(e.overrides || {})]) local(v,e.allDay);
  return e;
}

export function ruleOptions(text) {
  if (typeof text !== 'string' || text.length > 4096 || /[\r\n]/.test(text)) throw new RangeError('Use one RRULE value');
  const clean = text.replace(/^RRULE:/i,'').toUpperCase();
  const options = RRule.parseString(clean);
  if (!/(^|;)FREQ=/.test(clean) || (options.interval != null && options.interval < 1) || (options.count != null && options.count < 1)) throw new RangeError('Invalid recurrence frequency, interval or count');
  if (options.count && options.until) throw new RangeError('Use COUNT or UNTIL, not both');
  // Validate all BY* ranges through the recurrence engine before expansion.
  new RRule(options);
  return options;
}

// ENGINE BOUNDS. rrule 2.8.1 runs synchronously and calls back only for the dates it yields, so a
// callback budget alone does not bound its work. Three cases need more:
// 1. A sub-daily BY-time limit the counter can never reach (an hour of the wrong parity for an even
//    INTERVAL, a BYMINUTE above 59) makes its add loop run without end inside one step (timeLimits).
// 2. A day filter that never matches (February 30) yields nothing, and the engine walks every period
//    to the year 9999: the walk is stopped once it is past the requested range (lastPeriod).
// 3. Everything the engine walks in one call is counted against maxIterations * ENGINE_FACTOR.
const TIME_LIMITS = { [RRule.HOURLY]: ['byhour'], [RRule.MINUTELY]: ['byhour','byminute'], [RRule.SECONDLY]: ['byhour','byminute','bysecond'] };
const TIME_SIZE = { byhour: 24, byminute: 60, bysecond: 60 };
const UTC_PART = { byhour: d => d.getUTCHours(), byminute: d => d.getUTCMinutes(), bysecond: d => d.getUTCSeconds() };
const DAY_FILTERS = ['bymonth','byweekno','byweekday','byeaster','bymonthday','byyearday'];
const ENGINE_FACTOR = 5;
const PAST_END = Symbol('past the range end');
const asList = v => v == null ? [] : [].concat(v);
const gcd = (a, b) => b ? gcd(b, a % b) : a;

/**
 * What a sub-daily rule's BY-time limits (RFC 5545: they limit HOURLY, MINUTELY and SECONDLY) mean
 * for rrule 2.8.1's add loops, which step until every limit holds and never stop otherwise.
 * `never`: no step can ever satisfy them, so the rule has no occurrence. `lift`: a MINUTELY or
 * SECONDLY rule limits a coarser field than the one it steps, and either its INTERVAL is 60 or more
 * or a day filter moves the counter to the end of a day; then the carry into that field is several
 * units at a time and termination is not provable, so the limits are taken off the engine and
 * applied to the dates it yields. Otherwise the engine runs the rule unchanged: the field the rule
 * steps advances by INTERVAL (an end-of-day move too), so it reaches exactly the values congruent to
 * its start modulo gcd(INTERVAL, field size), and a coarser limited field is stepped by one until it
 * holds.
 * @param {any} opts @param {number} startWall
 * @returns {{never: boolean, lift: Array<[string, Set<number>]>}}
 */
function timeLimits(opts, startWall) {
  const keys = (TIME_LIMITS[opts.freq] || []).filter(k => asList(opts[k]).length);
  if (!keys.length) return { never: false, lift: [] };
  const interval = opts.interval || 1, stepped = keys.includes(TIME_LIMITS[opts.freq].at(-1)) ? TIME_LIMITS[opts.freq].at(-1) : null;
  const coarser = keys.filter(k => k !== stepped);
  if (coarser.length && (interval >= 60 || DAY_FILTERS.some(k => asList(opts[k]).length))) {
    return { never: false, lift: keys.map(k => [k, new Set(asList(opts[k]))]) };
  }
  const start = new Date(startWall), at = { byhour: start.getUTCHours(), byminute: start.getUTCMinutes(), bysecond: start.getUTCSeconds() };
  const valid = k => asList(opts[k]).filter(v => Number.isInteger(v) && v >= 0 && v < TIME_SIZE[k]);
  const step = stepped && gcd(interval, TIME_SIZE[stepped]);
  const never = coarser.some(k => !valid(k).length)
    || (stepped !== null && !valid(stepped).some(v => ((v - at[stepped]) % step + step) % step === 0));
  return { never, lift: [] };
}

/** The index of the last engine period that can still hold a date at or before endWall, plus one. */
function lastPeriod(freq, interval, startWall, endWall) {
  const span = Math.max(0, endWall - startWall), a = new Date(startWall), b = new Date(endWall);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (freq === RRule.YEARLY) return Math.floor(Math.max(0, months) / 12 / interval) + 2;
  if (freq === RRule.MONTHLY) return Math.floor(Math.max(0, months) / interval) + 2;
  const unit = { [RRule.WEEKLY]: 7 * 864e5, [RRule.DAILY]: 864e5, [RRule.HOURLY]: 36e5, [RRule.MINUTELY]: 6e4, [RRule.SECONDLY]: 1e3 }[freq];
  return Math.floor((span + unit) / (interval * unit)) + 2;
}

/**
 * Count the engine's periods. rrule 2.8.1 reads options.interval once when it starts and twice per
 * period (the loop's interval check and DateTime.add); calendar.test.ts pins that count.
 */
function meterPeriods(rule, last, budget) {
  const interval = rule.options.interval;
  let reads = 0;
  Object.defineProperty(rule.options, 'interval', {
    configurable: true,
    get() {
      if (++budget.used > budget.max) throw new RangeError('Recurrence iteration limit exceeded; shorten the series');
      if (((++reads - 1) >> 1) > last) throw PAST_END;
      return interval;
    },
  });
}

/** @param {CalendarEvent[]} events @param {{from:string,to:string,limit?:number,maxIterations?:number}} options */
export function occurrences(events, options) {
  const bounds = rangeMs(options);
  const limit = options.limit ?? 10000, maxIterations = options.maxIterations ?? 100000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000000) throw new RangeError('Invalid expansion limits');
  if (!Array.isArray(events) || events.length > 10000) throw new RangeError('At most 10000 event series per query');
  const output = [], ids = new Set();
  let iterations = 0;
  const engine = { used: 0, max: maxIterations * ENGINE_FACTOR * 2 };
  for (const source of events) {
    const e = normalize(source);
    if (ids.has(e.id)) throw new RangeError('Duplicate event id: ' + e.id);
    ids.add(e.id);
    if (e.cancelled) continue;
    const duration = wallMs(e.end) - wallMs(e.start);
    const excluded = new Set((e.exdates || []).map(x=>local(x,e.allDay)));
    const overrides = new Map(Object.entries(e.overrides || {}).map(([k,v])=>[local(k,e.allDay),v]));
    const seen = new Set();
    function add(start, patch = null) {
      start = local(start,e.allDay);
      if (seen.has(start)) return;
      seen.add(start);
      if (!patch && (excluded.has(start) || overrides.has(start))) return;
      if (patch?.cancelled) return;
      const data = patch ? normalize({...e,...patch,rrule:undefined,start:patch.start || start,end:patch.end || wallString(wallMs(patch.start || start)+duration,e.allDay)}) : e;
      const localStart = patch ? data.start : start;
      const localEnd = patch ? data.end : wallString(wallMs(start)+duration,e.allDay);
      const startMs = zoned(localStart,data.timeZone).epochMilliseconds;
      const endMs = zoned(localEnd,data.timeZone).epochMilliseconds;
      if (endMs < startMs) throw new RangeError('Occurrence end must follow start');
      if (startMs >= bounds.to || (endMs===startMs ? startMs<bounds.from : endMs<=bounds.from)) return;
      if (output.length >= limit) throw new RangeError('Occurrence limit exceeded; request a smaller range');
      output.push({id:e.id + '/' + start,eventId:e.id,recurrenceId:start,title:data.title || '',description:data.description || '',location:data.location || '',allDay:data.allDay,timeZone:data.timeZone,transparent:!!data.transparent,localStart,localEnd,start:iso(startMs),end:iso(endMs),startMs,endMs});
    }
    // Detached instances can move INTO this range from any original date.
    for (const [original,patch] of overrides) add(original,patch);
    if (!e.rrule) add(e.start);
    else {
      const opts = ruleOptions(e.rrule), count = opts.count;
      const until = opts.until;
      const utcUntil = /UNTIL=\d{8}T\d{6}Z/i.test(e.rrule);
      delete opts.count; delete opts.until; delete opts.tzid;
      const endWall = wallMs(fromInstant(options.to,e.timeZone));
      const startWall = wallMs(e.start);
      let validCount = 0;
      // Bound the engine itself as well as yielded instances (ENGINE BOUNDS above).
      // A sub-daily rule whose BY-time limits no step can satisfy has no occurrence at all.
      const { never, lift: limits } = timeLimits(opts, startWall);
      if (!never) {
      for (const [k] of limits) delete opts[k];
      const rule = new RRule({...opts,dtstart:new Date(startWall),until:new Date(endWall)});
      meterPeriods(rule, lastPeriod(opts.freq, rule.options.interval, startWall, endWall), engine);
      try { rule.all(date => {
        // A step a lifted sub-daily limit excludes: the engine's own work, so it counts as a period.
        if (limits.some(([k, s]) => !s.has(UTC_PART[k](date)))) {
          if (++engine.used > engine.max) throw new RangeError('Recurrence iteration limit exceeded; shorten the series');
          return date.getTime() <= endWall;
        }
        if (++iterations > maxIterations) throw new RangeError('Recurrence iteration limit exceeded; shorten the series');
        if (date.getTime() > endWall || (count && validCount >= count)) return false;
        const start = wallString(date.getTime(),e.allDay);
        let ms;
        try { ms = zoned(start,e.timeZone).epochMilliseconds; }
        catch (error) {
          // RFC 5545: a generated nonexistent local time is ignored and does not consume COUNT.
          if (error instanceof RangeError && error.message.startsWith('Local time does not exist')) return true;
          throw error;
        }
        if (until && (utcUntil ? ms : date.getTime()) > until.getTime()) return false;
        validCount++;
        add(start);
        return true;
      }); } catch (error) { if (error !== PAST_END) throw error; }
      }
    }
    for (const start of e.rdates || []) add(start);
  }
  return output.sort((a,b)=>a.startMs-b.startMs || a.id.localeCompare(b.id));
}

export function overlaps(a,b) {
  const x=rangeMs({from:a.start,to:a.end}), y=rangeMs({from:b.start,to:b.end});
  return x.from < y.to && y.from < x.to;
}
/** Subtract busy intervals from a range or explicit working windows. No bookings are persisted. */
export function freeSlots(busy, options) {
  const bound=rangeMs(options), min=options.minMinutes ?? 0;
  if (!Number.isFinite(min) || min < 0) throw new RangeError('minMinutes must be nonnegative');
  const merge = intervals => {
    const out=[];
    for (const r of intervals.sort((a,b)=>a.from-b.from)) {
      const last=out[out.length-1];
      if(last && r.from<=last.to) last.to=Math.max(last.to,r.to); else out.push({...r});
    }
    return out;
  };
  const blocks=merge(busy.filter(x=>!x.transparent && !x.cancelled && x.start!==x.end).map(x=>rangeMs({from:x.start,to:x.end})));
  const windows=merge((options.windows || [{start:options.from,end:options.to}]).map(x=>rangeMs({from:x.start,to:x.end})));
  const result=[];
  for(const w of windows) {
    let cursor=Math.max(w.from,bound.from); const end=Math.min(w.to,bound.to);
    const add=(a,b)=>{if(b>a && b-a>=min*60000) result.push({start:iso(a),end:iso(b)});};
    for(const block of blocks) {
      if(block.to<=cursor || block.from>=end) continue;
      add(cursor,Math.min(block.from,end)); cursor=Math.max(cursor,block.to);
      if(cursor>=end) break;
    }
    add(cursor,end);
  }
  return result;
}
