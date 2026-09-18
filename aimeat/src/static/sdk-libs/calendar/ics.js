/**
 * @file calendar/ics.js
 * @description RFC 5545 VEVENT interchange: escaped/folded text, civil times, RRULE, RDATE, EXDATE and overrides.
 *   IANA zones use the runtime timezone database. Custom VTIMEZONE identifiers are refused.
 * @version-history v1.0.0 - 2026-09-18 - Initial calendar interchange.
 */
import { Temporal, local, zoned, fromInstant, wallMs, wallString } from './time.js';
import { normalize, ruleOptions } from './events.js';

const textEscape = value => String(value ?? '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const textRead = value => value.replace(/\\([nN,;\\])/g,(_,s)=>s.toLowerCase()==='n'?'\n':s);
const compact = value => value.replace(/[-:]/g,'');
function expanded(value) {
  const m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if(!m) throw new RangeError('Unsupported ICS date: '+value);
  return m[1]+'-'+m[2]+'-'+m[3]+(m[4]?'T'+m[4]+':'+m[5]+':'+m[6]:'');
}
function fold(line) {
  const lines=[]; let chunk='', bytes=0;
  for(const c of line) {
    const n=new TextEncoder().encode(c).length;
    if(bytes+n>75) {lines.push(chunk);chunk=' ';bytes=1;}
    chunk+=c;bytes+=n;
  }
  lines.push(chunk); return lines.join('\r\n');
}
function property(line) {
  // Separators inside quoted parameters are data, not delimiters.
  let quote=false, colon=-1;
  for(let i=0;i<line.length;i++) {if(line[i]==='"') quote=!quote; if(line[i]===':'&&!quote){colon=i;break;}}
  if(colon<0) throw new RangeError('Malformed ICS property');
  const head=line.slice(0,colon).match(/(?:[^;"]|"[^"]*")+/g) || [];
  const name=(head.shift() || '').toUpperCase(), params={};
  for(const item of head) {const i=item.indexOf('='); if(i<1) throw new RangeError('Malformed ICS parameter'); params[item.slice(0,i).toUpperCase()]=item.slice(i+1).replace(/^"|"$/g,'');}
  return {name,params,value:line.slice(colon+1)};
}

/** Parse VEVENTs. Floating times require a caller-selected defaultTimeZone (UTC by default). */
export function fromICS(input, options = {}) {
  if(typeof input!=='string' || input.length>5000000) throw new RangeError('ICS must be text below 5 MB');
  const lines=input.replace(/^\uFEFF/,'').replace(/\r?\n[ \t]/g,'').split(/\r?\n/).filter(Boolean);
  if(lines[0]!=='BEGIN:VCALENDAR' || lines.at(-1)!=='END:VCALENDAR') throw new RangeError('Expected a complete VCALENDAR');
  const raw=[], stack=[]; let event=null;
  for(const line of lines) {
    const p=property(line);
    if(p.name==='BEGIN') {
      stack.push(p.value);
      if(p.value==='VEVENT') {if(event) throw new RangeError('Nested VEVENT');event=[];}
    } else if(p.name==='END') {
      if(stack.pop()!==p.value) throw new RangeError('Unbalanced ICS components');
      if(p.value==='VEVENT') {raw.push(event);event=null;}
    } else if(event && stack.at(-1)==='VEVENT') event.push(p);
  }
  if(stack.length) throw new RangeError('Unclosed ICS component');
  if(raw.length>10000) throw new RangeError('ICS event limit exceeded');
  const records=[], exceptions=[];
  for(const properties of raw) {
    const get=name=>properties.find(p=>p.name===name);
    const uid=get('UID')?.value;
    if(!uid) throw new RangeError('VEVENT needs UID');
    const rid=get('RECURRENCE-ID');
    if(rid?.params.RANGE) throw new RangeError('RECURRENCE-ID RANGE is unsupported; use individual overrides');
    if(get('EXRULE')) throw new RangeError('EXRULE is unsupported; use EXDATE');
    if(properties.filter(p=>p.name==='RRULE').length>1) throw new RangeError('One RRULE per event is supported');
    const ds=get('DTSTART') || (get('STATUS')?.value==='CANCELLED' ? rid : null);
    if(!ds) throw new RangeError('VEVENT needs DTSTART');
    const timeZone=ds.value.endsWith('Z')?'UTC':(ds.params.TZID || options.defaultTimeZone || 'UTC');
    const start=expanded(ds.value), allDay=start.length===10;
    zoned(start,timeZone); // Refuses unknown TZID instead of interpreting it as UTC.
    const readDate=p=>{
      if(p.params.VALUE==='PERIOD') throw new RangeError('RDATE PERIOD is unsupported; use an override');
      const s=expanded(p.value);
      if(s.length===10) return local(s,true);
      const tz=p.value.endsWith('Z')?'UTC':p.params.TZID || timeZone;
      return tz===timeZone ? local(s) : fromInstant(zoned(s,tz).toInstant().toString(),timeZone);
    };
    let end=get('DTEND')?readDate(get('DTEND')):null;
    if(!end && get('DURATION')) {
      const duration=Temporal.Duration.from(get('DURATION').value);
      end=allDay?Temporal.PlainDate.from(start).add(duration).toString():Temporal.PlainDateTime.from(start).add(duration).toString({smallestUnit:'second'});
    }
    if(!end) end=allDay?Temporal.PlainDate.from(start).add({days:1}).toString():start;
    const e={id:textRead(uid),title:textRead(get('SUMMARY')?.value || ''),description:textRead(get('DESCRIPTION')?.value || ''),location:textRead(get('LOCATION')?.value || ''),start,end,timeZone,allDay,transparent:get('TRANSP')?.value==='TRANSPARENT',cancelled:get('STATUS')?.value==='CANCELLED'};
    if(rid) {exceptions.push({id:e.id,original:rid,event:e});continue;}
    const record={...e,rrule:get('RRULE')?.value,rdates:[],exdates:[],overrides:{}};
    if(record.rrule) ruleOptions(record.rrule);
    for(const p of properties) if(p.name==='RDATE'||p.name==='EXDATE') {
      for(const value of p.value.split(',')) record[p.name==='RDATE'?'rdates':'exdates'].push(readDate({...p,value}));
    }
    records.push(normalize(record));
  }
  const byId=new Map(records.map(e=>[e.id,e]));
  if(byId.size!==records.length) throw new RangeError('Duplicate master UID');
  for(const x of exceptions) {
    const master=byId.get(x.id);
    if(!master) throw new RangeError('Override has no master event: '+x.id);
    let key=expanded(x.original.value);
    const tz=x.original.value.endsWith('Z')?'UTC':x.original.params.TZID || master.timeZone;
    if(!master.allDay && tz!==master.timeZone) key=fromInstant(zoned(key,tz).toInstant().toString(),master.timeZone);
    if(master.overrides[key]) throw new RangeError('Duplicate RECURRENCE-ID');
    master.overrides[key]=x.event.cancelled?{cancelled:true}:x.event;
  }
  return records;
}

function dateProperty(name,value,event) {
  return name+(event.allDay?';VALUE=DATE':event.timeZone==='UTC'?'':';TZID='+event.timeZone)+':'+compact(value)+(event.allDay||event.timeZone!=='UTC'?'':'Z');
}
function zoneLines(zone, firstYear, lastYear) {
  const result=['BEGIN:VTIMEZONE','TZID:'+zone];
  let at=Temporal.ZonedDateTime.from({timeZone:zone,year:firstYear,month:1,day:1});
  const end=Temporal.ZonedDateTime.from({timeZone:zone,year:lastYear+1,month:1,day:1});
  const offset=z=>z.offset.replace(/:/g,'');
  result.push('BEGIN:STANDARD','DTSTART:'+compact(at.toPlainDateTime().toString({smallestUnit:'second'})),'TZOFFSETFROM:'+offset(at),'TZOFFSETTO:'+offset(at),'END:STANDARD');
  for(let i=0;i<100;i++) {
    const next=at.getTimeZoneTransition('next');
    if(!next || next.epochMilliseconds>=end.epochMilliseconds) break;
    const before=next.subtract({seconds:1});
    const kind=next.offsetNanoseconds>before.offsetNanoseconds?'DAYLIGHT':'STANDARD';
    const wallBefore=before.toPlainDateTime().add({seconds:1}).toString({smallestUnit:'second'});
    result.push('BEGIN:'+kind,'DTSTART:'+compact(wallBefore),'TZOFFSETFROM:'+offset(before),'TZOFFSETTO:'+offset(next),'END:'+kind);
    at=next;
  }
  return [...result,'END:VTIMEZONE'];
}

/** Export complete events, not only the visible range. Explicit timezone coverage defaults to ten years. */
export function toICS(events, options = {}) {
  if(!Array.isArray(events)||events.length>10000) throw new RangeError('At most 10000 events');
  const normalized=events.map(normalize);
  const years=normalized.flatMap(e=>[e.start,e.end,...(e.rdates || []),...Object.keys(e.overrides || {}),...Object.values(e.overrides || {}).flatMap(p=>[p.start,p.end]).filter(Boolean)].map(k=>Number(k.slice(0,4))));
  const firstYear=options.fromYear ?? (years.length?Math.min(...years)-1:new Date().getUTCFullYear()-1);
  const lastYear=options.toYear ?? (years.length?Math.max(...years)+10:firstYear+10);
  if(!Number.isInteger(firstYear)||!Number.isInteger(lastYear)||lastYear<firstYear||lastYear-firstYear>50) throw new RangeError('Timezone coverage must be 0 to 50 years');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AIMEAT//Calendar 1.0//EN','CALSCALE:GREGORIAN'];
  if(options.name) lines.push('X-WR-CALNAME:'+textEscape(options.name));
  const zones=new Set(normalized.flatMap(e=>[e.timeZone,...Object.values(e.overrides || {}).map(p=>p.timeZone).filter(Boolean)]));
  for(const zone of zones) if(zone!=='UTC') lines.push(...zoneLines(zone,firstYear,lastYear));
  const stamp=compact(new Date().toISOString().slice(0,19))+'Z';
  function write(e, master=null, original=null) {
    lines.push('BEGIN:VEVENT','UID:'+textEscape(e.id),'DTSTAMP:'+stamp,dateProperty('DTSTART',e.start,e),dateProperty('DTEND',e.end,e),'SUMMARY:'+textEscape(e.title));
    if(original) lines.push(dateProperty('RECURRENCE-ID',original,master));
    if(e.description) lines.push('DESCRIPTION:'+textEscape(e.description));
    if(e.location) lines.push('LOCATION:'+textEscape(e.location));
    if(e.transparent) lines.push('TRANSP:TRANSPARENT');
    if(e.cancelled) lines.push('STATUS:CANCELLED');
    if(!original) {
      if(e.rrule) {ruleOptions(e.rrule);lines.push('RRULE:'+e.rrule.replace(/^RRULE:/i,''));}
      for(const v of e.rdates || []) lines.push(dateProperty('RDATE',local(v,e.allDay),e));
      for(const v of e.exdates || []) lines.push(dateProperty('EXDATE',local(v,e.allDay),e));
    }
    lines.push('END:VEVENT');
  }
  for(const e of normalized) {
    write(e);
    const duration=wallMs(e.end)-wallMs(e.start);
    for(const [original,p] of Object.entries(e.overrides || {})) {
      const start=p.start || original, end=p.end || wallString(wallMs(start)+duration,e.allDay);
      write(normalize({...e,...p,start,end}),e,local(original,e.allDay));
    }
  }
  return [...lines,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
