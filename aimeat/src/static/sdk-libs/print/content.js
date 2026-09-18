/**
 * @file print/content.js
 * @description Safe printable DOM from HTML, Markdown, elements and structured document/table/card/calendar blocks.
 * @version-history v1.0.0 - 2026-09-18 - Initial print content adapters.
 */
const ALLOWED=new Set('P DIV SECTION ARTICLE H1 H2 H3 H4 H5 H6 SPAN STRONG B EM I U S SMALL SUB SUP BR HR UL OL LI BLOCKQUOTE PRE CODE TABLE THEAD TBODY TFOOT TR TH TD CAPTION IMG A FIGURE FIGCAPTION DL DT DD'.split(' '));
const DROP=new Set('SCRIPT STYLE IFRAME OBJECT EMBED LINK META NOSCRIPT TEMPLATE SVG MATH VIDEO AUDIO'.split(' '));
export function element(doc,tag,text,className) {
  const e=doc.createElement(tag);if(text!=null)e.textContent=String(text);if(className)e.className=className;return e;
}
export function safeUrl(value) {
  if(!value) return null;
  try {const u=new URL(value,document.baseURI);return ['https:','http:','blob:'].includes(u.protocol)||/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)?u.href:null;}
  catch {return null;}
}
/** Copy allowed structure only: no event handlers, scripts, forms, styles, IDs or app chrome. */
export function copyContent(source,doc) {
  if(source.nodeType===3) return doc.createTextNode(source.textContent || '');
  if(source.nodeType!==1) return doc.createDocumentFragment();
  const tag=source.tagName;
  if(DROP.has(tag)||source.hasAttribute('data-print-ignore'))return doc.createDocumentFragment();
  if(tag==='CANVAS') {
    const img=element(doc,'img');
    try {img.src=source.toDataURL('image/png');}catch {throw new Error('A canvas could not be printed because its image is cross-origin');}
    return img;
  }
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)) {
    if(source.type==='password'||source.type==='hidden')return doc.createDocumentFragment();
    return element(doc,'span',source.type==='checkbox'?(source.checked?'✓':''):source.value);
  }
  if(tag==='BUTTON')return doc.createDocumentFragment();
  const e=ALLOWED.has(tag)?element(doc,tag.toLowerCase()):doc.createDocumentFragment();
  if(e.nodeType===1) {
    if(tag==='IMG') {const url=safeUrl(source.getAttribute('src'));if(url)e.setAttribute('src',url);e.setAttribute('alt',source.getAttribute('alt') || '');}
    if(tag==='A') {const url=safeUrl(source.getAttribute('href'));if(url)e.setAttribute('href',url);}
    for(const name of ['colspan','rowspan','start']) {
      const n=Number(source.getAttribute(name));if(Number.isInteger(n)&&n>0&&n<=100)e.setAttribute(name,String(n));
    }
    if(source.getAttribute('data-print-break')==='before')e.setAttribute('data-print-break','before');
    if(source.hasAttribute('data-print-keep'))e.setAttribute('data-print-keep','');
  }
  for(const child of source.childNodes)e.appendChild(copyContent(child,doc));
  return e;
}
function htmlContent(html,doc) {
  const parsed=new DOMParser().parseFromString(String(html),'text/html');
  const fragment=doc.createDocumentFragment();
  for(const node of parsed.body.childNodes)fragment.appendChild(copyContent(node,doc));
  return fragment;
}
function table(block,doc) {
  const t=element(doc,'table'), head=element(doc,'thead'), row=element(doc,'tr'), body=element(doc,'tbody');
  for(const c of block.columns || [])row.appendChild(element(doc,'th',typeof c==='string'?c:c.label));
  head.appendChild(row);t.appendChild(head);
  for(const data of block.rows || []) {
    const tr=element(doc,'tr');
    (block.columns || []).forEach((c,i)=>tr.appendChild(element(doc,'td',Array.isArray(data)?data[i]:data[typeof c==='string'?c:c.key])));
    body.appendChild(tr);
  }
  t.appendChild(body);return t;
}
function blockContent(block,doc) {
  if(block.type==='pageBreak') {const e=element(doc,'div');e.setAttribute('data-print-break','before');return e;}
  if(block.type==='heading')return element(doc,'h'+Math.max(1,Math.min(6,block.level || 2)),block.text);
  if(block.type==='text')return element(doc,'p',block.text);
  if(block.type==='html')return htmlContent(block.html,doc);
  if(block.type==='markdown') {
    if(!window.AIMEAT?.md?.renderToString)throw new Error('Load aimeat-markdown.js to print Markdown');
    return htmlContent(window.AIMEAT.md.renderToString(block.text),doc);
  }
  if(block.type==='image') {const image=element(doc,'img');const url=safeUrl(block.src);if(!url)throw new Error('Invalid print image URL');image.src=url;image.alt=block.alt || '';return image;}
  if(block.type==='table')return table(block,doc);
  if(block.type==='cards') {
    const list=element(doc,'section',null,'ap-cards');
    for(const item of block.items || []) {
      const card=element(doc,'article',null,'ap-card');card.setAttribute('data-print-keep','');
      card.appendChild(element(doc,'h3',item.title));card.appendChild(element(doc,'p',item.text));
      if(item.meta)card.appendChild(element(doc,'small',item.meta));list.appendChild(card);
    }
    return list;
  }
  if(block.type==='calendar') {
    const section=element(doc,'section',null,'ap-calendar');
    const groups=new Map();
    for(const event of block.events || []) {
      const day=event.localStart?.slice(0,10) || event.start?.slice(0,10);
      if(!day)throw new Error('Calendar printing needs occurrence start dates');
      if(!groups.has(day))groups.set(day,[]);groups.get(day).push(event);
    }
    for(const day of [...groups.keys()].sort()) {
      const group=element(doc,'section',null,'ap-calendar-day');
      // The print specification owns its locale; this is a civil date, not the viewer's timezone.
      // eslint-disable-next-line aimeat/no-raw-locale-format
      group.appendChild(element(doc,'h3',new Intl.DateTimeFormat(block.locale || 'en',{dateStyle:'full',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))));
      for(const event of groups.get(day)) {
        const time=event.allDay?(block.allDayLabel || 'All day'):(event.localStart || event.start).slice(11,16)+'–'+(event.localEnd || event.end).slice(11,16);
        group.appendChild(element(doc,'p',time+'  '+(event.title || '')+(event.location?' · '+event.location:'')));
      }
      section.appendChild(group);
    }
    return section;
  }
  throw new Error('Unknown print block type: '+block.type);
}
export function content(spec,doc) {
  const root=element(doc,'div');
  if(spec.title)root.appendChild(element(doc,'h1',spec.title));
  if(spec.subtitle)root.appendChild(element(doc,'p',spec.subtitle,'ap-subtitle'));
  if(spec.element) {
    const source=typeof spec.element==='string'?document.querySelector(spec.element):spec.element;
    if(!source)throw new Error('Print element was not found');root.appendChild(copyContent(source,doc));
  }
  if(spec.html!=null)root.appendChild(htmlContent(spec.html,doc));
  if(spec.markdown!=null)root.appendChild(blockContent({type:'markdown',text:spec.markdown},doc));
  for(const block of spec.blocks || [])root.appendChild(blockContent(block,doc));
  return root;
}
