/**
 * @file sdk-calendar-print.ts
 * @description Calendar and print discovery contracts, examples, limitations and integration guidance.
 * @version-history v1.0.0 - 2026-09-18 - Initial general-purpose calendar and print libraries.
 */
import type { LibraryPack } from './types.js';
export const CALENDAR_PRINT_PACKS: LibraryPack[] = [
  {
    id:'aimeat-calendar',kind:'sdk',category:'core',title:'Calendar logic',
    description:'Recurring events in IANA timezones, moved and cancelled instances, all-day dates, ISO weeks, ICS import/export, overlapping intervals and available time.',
    url:'/v1/libs/aimeat-calendar.js',include:['<script src="{{BASE_URL}}/v1/libs/aimeat-calendar.js"></script>'],requires:[],license:'MIT',apiSurface:'AIMEAT.calendar',tierHint:'T1',status:'preview',modelTier:'needs-doc',
    interviewTriggers:['calendar','booking','schedule','recurrence','kalenteri','ajanvaraus','vuorot'],
    sizeEstimate:'~500KB including timezone and recurrence engines',
    promptGroup:'core',promptLine:'- aimeat-calendar.js: recurring events, IANA zones, ICS and free intervals; the app owns storage.',
    aiDoc:[
      'AIMEAT.calendar is pure computation. It performs no fetch, booking, permission check or persistence. The same core.js is importable by server code. Store event records through the existing data/workspace APIs; expose the same operations in your app tools for agents. A free slot is a calculation, not a reservation; the host must enforce concurrent booking rules.',
      'Event: {id,title,start:"2026-03-23T09:00:00",end:"2026-03-23T10:00:00",timeZone:"Europe/Helsinki",rrule:"FREQ=WEEKLY;COUNT=6",description?,location?,transparent?}. Timed start/end are local ISO strings WITHOUT offsets. allDay:true uses YYYY-MM-DD and an EXCLUSIVE end date. UTC is the default zone. IDs must be unique.',
      'occurrences(events,{from:"2026-03-01T00:00:00Z",to:"2026-05-01T00:00:00Z",limit:10000,maxIterations:100000}) returns sorted overlapping instances: {eventId,recurrenceId,id,title,start,end,startMs,endMs,localStart,localEnd,timeZone,allDay,transparent}. Query bounds are instants and end is exclusive. Limits throw instead of silently truncating. Max 10000 series; 100000 output limit and 1000000 iteration hard caps.',
      'RRULE uses RFC 5545 syntax (rrule engine). Local clock time survives daylight saving. A nonexistent authored time throws; an ambiguous repeated hour chooses its FIRST instant. Generated times in a DST gap are skipped without consuming COUNT. Durations are wall-clock durations; an all-day date across DST can last 23 or 25 elapsed hours.',
      'exdates:["2026-03-30T09:00:00"] excludes instances; rdates adds instances. overrides:{"2026-04-06T09:00:00":{cancelled:true},"2026-04-13T09:00:00":{start:"2026-04-14T11:00:00",end:"2026-04-14T12:00:00",title:"Moved"}} changes individual instances. Keys always name the ORIGINAL local start. Overrides are checked even when moved into the query from outside it.',
      'toInstant(local,zone) and fromInstant(instant,zone) convert times. week("2021-01-01") returns {year:2020,week:53}. overlaps({start,end},{start,end}) accepts instant strings and treats touching edges as non-overlapping. freeSlots(busy,{from,to,minMinutes:30,windows:[{start,end}]}) subtracts merged busy intervals from explicit working windows. windows defaults to the whole query; transparent/cancelled intervals do not block.',
      'toICS(events,{name?,fromYear?,toYear?}) exports a VCALENDAR with UTF-8 folding, escaped text, RRULE/RDATE/EXDATE, RECURRENCE-ID overrides and VTIMEZONE transitions. Transition coverage defaults from one year before the first event through ten years after the last start/end; specify coverage for longer calendars (50-year maximum). IANA-aware consumers can use their timezone database beyond that coverage.',
      'fromICS(text,{defaultTimeZone:"Europe/Helsinki"}) returns event records. Supports VEVENT date/date-time, DTSTART/DTEND/DURATION, UID/SUMMARY/DESCRIPTION/LOCATION/STATUS/TRANSP and the recurrence fields above. Floating times use the explicit default zone, UTC if omitted. Timed events without DTEND/DURATION are point events and do not block freeSlots. Unknown/custom TZIDs, RANGE=THISANDFUTURE, EXRULE, multiple RRULEs and RDATE periods throw. Alarms/attendees and non-VEVENT components are outside this scheduling model. It never fetches subscriptions or imports into storage automatically.',
      'Demo: {{BASE_URL}}/dev/calendar-print.html. To print calculated events, load aimeat-print.js and pass {type:"calendar",events:occurrences,locale:"fi"} as a print block.',
    ].join('\n'),
    changelog:[{version:'1.0.0',date:'2026-09-18',summary:'Civil-time recurrence, individual exceptions, ICS interchange and interval operations.'}],
  },
  {
    id:'aimeat-print',kind:'sdk',category:'ui',title:'Printing and paged documents',
    description:'Print HTML, Markdown, tables, cards and calendar occurrences as measured pages with repeated headers, footers and page numbers. Includes preview, branding and browser Save as PDF.',
    url:'/v1/libs/aimeat-print.js',include:['<script src="{{BASE_URL}}/v1/libs/aimeat-print.js"></script>'],requires:[],license:'MIT',apiSurface:'AIMEAT.print',tierHint:'T1',status:'preview',modelTier:'needs-doc',
    interviewTriggers:['print','report','pdf','tulosta','tulostus','raportti'],sizeEstimate:'~35KB',
    promptGroup:'core',promptLine:'- aimeat-print.js: paged print preview for HTML, Markdown, tables, cards and calendars; headers, footers and page numbers.',
    aiDoc:[
      'AIMEAT.print builds a separate printable document, with no server calls. await preview(spec) opens an accessible dialog; Print / Save as PDF uses the browser print dialog. This is not a server-side PDF generator. The library never prints automatically. EN/FI/ES preview controls follow spec.locale or the page language.',
      'const view=await AIMEAT.print.preview({title:"Weekly programme",date:"18.9.2026",locale:"fi",template:"document",blocks:[{type:"heading",text:"Overview"},{type:"text",text:"Report text"}]}); view.destroy() closes it. Escape and Close return keyboard focus. Fonts and images finish loading before page measurement. Errors reject; catch them in the host and show the reason.',
      'Inputs: element:DOMElement|selector (a safe structural copy, including form values and canvas PNGs), html:string, markdown:string (load aimeat-markdown.js first), blocks:array. Scripts, handlers, embedded frames, app styles and IDs are stripped. data-print-ignore skips a node; data-print-break="before" starts a page; data-print-keep keeps a block together. Cross-origin tainted canvases and failed images throw.',
      'Blocks: heading {text,level?}; text {text}; html {html}; markdown {text}; image {src,alt}; table {columns:[{key,label}],rows:[{key:value}]} (array rows also work); cards {items:[{title,text,meta?}]}; calendar {events:calendar.occurrences(...),locale?,allDayLabel?}; pageBreak. Calendar prints a dated agenda grouped by local date. It accepts calculated occurrences, not recurring master records.',
      'Templates: document, table (landscape), cards (two columns), calendar (landscape). registerTemplate("company-report",{header:{left:"Our company",right:"{date}"},footer:{left:"Internal",right:"{page} / {pages}"},brand:{heading:"#173b65"}}) adds a reusable named preset. Explicit spec fields override its defaults.',
      'Layout: paper:A4|A3|A5|Letter|Legal, orientation:portrait|landscape, margin:15 (mm), columns:1..3, fontSize:11 (pt), font:"Arial, sans-serif", headerHeight:12 and footerHeight:10 (mm), maxPages:500. header/footer are strings or {left,center,right}; tokens {title},{date},{page},{pages}. firstHeader/firstFooter override page one. logo is an image URL. brand accepts ink,paper,line,heading,tint,muted colors.',
      'Pages are explicitly measured at paper size. Table headers repeat, long prose flows, headings stay with following text, and columns fill in reading order. A kept block or one table row taller than a page is refused with an actionable error; row-spanned tables must fit a page. Use shorter rows, landscape, smaller type or a prose layout. Limits reject instead of dropping content.',
      'prepare(spec,{target?:element|selector}) returns {iframe,document,pages,print(),toHTML(),destroy()}. Without a target it builds offscreen. toHTML() returns the prepared standalone printable HTML for host-controlled download or a server/browser agent PDF renderer. Always destroy when finished. Set browser paper size to the document size and scale to 100%; turn off browser-added headers/footers, since the document already contains its own.',
      'Demo: {{BASE_URL}}/dev/calendar-print.html. Supply the same structured spec through your app tools so agents and people produce the same document.',
    ].join('\n'),
    changelog:[{version:'1.0.0',date:'2026-09-18',summary:'Safe content adapters, measured pagination, repeatable headers/footers, named presets and print preview.'}],
  },
];
