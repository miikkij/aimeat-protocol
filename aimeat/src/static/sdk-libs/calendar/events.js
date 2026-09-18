/**
 * @file calendar/events.js
 * @description Bounded RRULE expansion in civil time, with additions, exclusions and detached overrides.
 * @version-history v1.0.0 - 2026-09-18 - Calendar event model and recurrence.
 */
import { RRule } from 'rrule';
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

/** @param {CalendarEvent[]} events @param {{from:string,to:string,limit?:number,maxIterations?:number}} options */
export function occurrences(events, options) {
  const bounds = rangeMs(options);
  const limit = options.limit ?? 10000, maxIterations = options.maxIterations ?? 100000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000000) throw new RangeError('Invalid expansion limits');
  if (!Array.isArray(events) || events.length > 10000) throw new RangeError('At most 10000 event series per query');
  const output = [], ids = new Set();
  let iterations = 0;
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
      let validCount = 0;
      // Bound the engine itself as well as yielded instances: an impossible rule (February 30)
      // produces no callbacks, so a callback-only budget cannot stop its internal search.
      const rule = new RRule({...opts,dtstart:new Date(wallMs(e.start)),until:new Date(endWall)});
      rule.all(date => {
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
      });
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
