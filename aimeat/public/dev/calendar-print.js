/**
 * @file calendar-print.js
 * @description Interactive library example: DST, exception editing, ICS and real catalogue printouts.
 * @version-history v1.0.0 - 2026-09-18 - Initial example.
 */
(() => {
  const c=window.AIMEAT.calendar,p=window.AIMEAT.print;
  const base={id:'team-weekly',title:'Weekly planning',start:'2026-03-16T09:00:00',end:'2026-03-16T10:00:00',timeZone:'Europe/Helsinki',rrule:'FREQ=WEEKLY;COUNT=6',location:'Helsinki'};
  let event={...base,overrides:{}},rows=[];
  const get=id=>document.getElementById(id);
  const value=id=>/** @type {HTMLSelectElement} */(get(id)).value;
  function render() {
    rows=c.occurrences([event],{from:'2026-03-01T00:00:00Z',to:'2026-05-01T00:00:00Z'});
    const body=get('events');body.replaceChildren();
    for(const row of rows) {
      const tr=document.createElement('tr'),local=c.fromInstant(row.start,value('zone'));
      for(const text of [local.slice(0,10),local.slice(11,16),row.start.slice(11,16),row.title]) {const td=document.createElement('td');td.textContent=text;tr.appendChild(td);}body.appendChild(tr);
    }
    get('calendar-summary').textContent=rows.length+' meetings · ISO week '+c.week('2026-03-23').week+' · Helsinki changes to daylight saving on 29 March.';
  }
  get('move').onclick=()=>{event.overrides['2026-03-30T09:00:00']={start:'2026-03-31T11:00:00',end:'2026-03-31T12:00:00',title:'Moved planning'};render();};
  get('cancel').onclick=()=>{event.overrides['2026-04-06T09:00:00']={cancelled:true};render();};
  get('reset').onclick=()=>{event={...base,overrides:{}};render();};get('zone').onchange=render;
  get('ics').onclick=()=>{const url=URL.createObjectURL(new Blob([c.toICS([event],{name:'Weekly planning'})],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='weekly-planning.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  p.registerTemplate('example',{header:{left:'AIMEAT · Library examples',right:'{date}'},footer:{left:'{title}',right:'{page} / {pages}'},brand:{heading:'#2456a6'}});
  const catalogue=async()=>{const response=await fetch('/v1/library-packs');if(!response.ok)throw new Error('Catalogue could not load');return (await response.json()).data.packs;};
  async function show(kind) {
    get('print-status').textContent='Preparing document…';
    try {
      const spec={template:'example',title:kind==='calendar'?'Weekly programme':'AIMEAT library catalogue',date:'18 September 2026',paper:value('paper'),orientation:value('orientation'),blocks:[]};
      if(kind==='calendar')spec.blocks=[{type:'calendar',events:rows}];
      else if(kind==='element')spec.element=get('print-status').closest('section');
      else {const packs=await catalogue();
        if(kind==='table')spec.blocks=[{type:'table',columns:[{key:'id',label:'Library'},{key:'description',label:'What it does'}],rows:packs}];
        if(kind==='cards'){spec.columns=2;spec.blocks=[{type:'cards',items:packs.map(x=>({title:x.title,text:x.description,meta:x.id}))}];}
        if(kind==='document')spec.markdown='# Available libraries\n\n'+packs.map(x=>'## '+x.title+'\n\n'+x.description).join('\n\n');
      }
      await p.preview(spec);get('print-status').textContent='Preview ready. Use Print / Save as PDF to continue.';
    } catch(error) {get('print-status').textContent=error.message;}
  }
  for(const kind of ['calendar','table','cards','document','element'])get('print-'+kind).onclick=()=>show(kind);
  render();
})();
