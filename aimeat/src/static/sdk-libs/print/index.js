/**
 * @file print/index.js
 * @description AIMEAT.print: measured pages, safe content, reusable templates and a native-dialog preview.
 *   No server calls. Physical printing and Save as PDF use the browser's own print dialog.
 * @version-history v1.0.0 - 2026-09-18 - Initial served print library.
 */
import { attach } from '../_core/namespace.js';
import { element, content } from './content.js';
import { paginate } from './paginate.js';
import pageCss from './print.css';
import previewCss from './preview.css';

const templates=new Map([
  ['document',{}],['table',{orientation:'landscape',fontSize:10}],['cards',{columns:2}],['calendar',{orientation:'landscape'}],
]);
const words={
  en:{preview:'Print preview',print:'Print / Save as PDF',close:'Close',loading:'Preparing pages…'},
  fi:{preview:'Tulostuksen esikatselu',print:'Tulosta / tallenna PDF',close:'Sulje',loading:'Muodostetaan sivuja…'},
  es:{preview:'Vista previa',print:'Imprimir / Guardar PDF',close:'Cerrar',loading:'Preparando páginas…'},
};
function hostStyles() {
  if(document.querySelector('style[data-aimeat-print]'))return;
  const style=element(document,'style',previewCss);style.dataset.aimeatPrint='';document.head.appendChild(style);
}
function number(value,fallback,min,max,name) {
  const n=value ?? fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new RangeError('Invalid print '+name);return n;
}
export function options(input) {
  const preset=templates.get(input.template || 'document');if(!preset)throw new Error('Unknown print template');
  const s={...preset,...input};
  const sizes={A4:[210,297],A3:[297,420],A5:[148,210],Letter:[215.9,279.4],Legal:[215.9,355.6]};
  const size=sizes[s.paper || 'A4'];if(!size)throw new RangeError('Unknown paper size');
  if(s.orientation && !['portrait','landscape'].includes(s.orientation))throw new RangeError('Invalid orientation');
  const [width,height]=s.orientation==='landscape'?[size[1],size[0]]:size;
  const margin=number(s.margin,15,4,50,'margin'), headerHeight=number(s.headerHeight,12,5,50,'header height'),footerHeight=number(s.footerHeight,10,5,50,'footer height');
  const columns=number(s.columns,1,1,3,'columns');if(!Number.isInteger(columns))throw new RangeError('Columns must be an integer');
  if(height-2*margin-headerHeight-footerHeight-8<30)throw new RangeError('Margins leave no printable content area');
  const maxPages=number(s.maxPages,500,1,1000,'page limit');if(!Number.isInteger(maxPages))throw new RangeError('Page limit must be an integer');
  return {...s,width,height,margin,headerHeight,footerHeight,columns,fontSize:number(s.fontSize,11,7,30,'font size'),maxPages};
}

async function loadImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(async img=>{
    if(!img.getAttribute('src'))return;
    let timer;
    try {await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Print image timed out')),15000);})]);}
    catch {throw new Error('A print image could not load: '+(img.alt || img.getAttribute('src')));}
    finally {clearTimeout(timer);}
  }));
}

/** Build offscreen, or inside a target. Caller must destroy the returned document when finished. */
export async function prepare(input, config = {}) {
  hostStyles();const spec=options(input),frame=element(document,'iframe');
  frame.title=spec.title || 'Print document';frame.setAttribute('sandbox','allow-same-origin allow-modals');
  const host=typeof config.target==='string'?document.querySelector(config.target):config.target;
  if(config.target&&!host)throw new Error('Print target was not found');
  if(!host)frame.className='ap-build-frame';
  let loadTimer;
  const loaded=new Promise((resolve,reject)=>{
    loadTimer=setTimeout(()=>reject(new Error('Print frame could not load')),15000);
    frame.addEventListener('load',()=>{clearTimeout(loadTimer);resolve();},{once:true});
  });
  // An untouched about:blank document is BackCompat. Measuring there and exporting a standards
  // document changes table metrics and can overlap footers, so both paths start with a doctype.
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  (host || document.body).appendChild(frame);
  try {
    await loaded;
    const doc=frame.contentDocument;
    doc.documentElement.lang=spec.locale || document.documentElement.lang || 'en';
    const style=element(doc,'style',pageCss+'\n@page { size: '+spec.width+'mm '+spec.height+'mm; margin: 0; }\n@media print {body {zoom:1!important}}');
    doc.head.appendChild(style);doc.title=spec.title || 'Print document';
    const vars={'width':spec.width+'mm','height':spec.height+'mm','margin':spec.margin+'mm','header-height':spec.headerHeight+'mm','footer-height':spec.footerHeight+'mm','columns':spec.columns,'font-size':spec.fontSize+'pt','image-height':(spec.height-2*spec.margin-spec.headerHeight-spec.footerHeight-12)+'mm'};
    for(const [key,value] of Object.entries(vars))doc.documentElement.style.setProperty('--ap-'+key,String(value));
    // Brand overrides are values, never a stylesheet or executable markup.
    for(const key of ['ink','paper','line','heading','tint','muted'])if(spec.brand?.[key]) {
      if(!CSS.supports('color',spec.brand[key]))throw new RangeError('Invalid brand color');doc.documentElement.style.setProperty('--ap-'+key,spec.brand[key]);
    }
    if(spec.font) {if(!/^[\w ,'-]+$/.test(spec.font))throw new RangeError('Use a font-family name');doc.documentElement.style.setProperty('--ap-font',spec.font);}
    const source=content(spec,doc);doc.body.appendChild(source);
    await loadImages(source);await doc.fonts.ready;
    source.remove();
    const pages=paginate(source,doc,spec);
    await loadImages(doc.body);
    // A loaded logo may alter line layout; reserve its height in the header contract.
    for(const el of doc.querySelectorAll('.ap-header,.ap-footer'))if(el.scrollHeight>el.clientHeight+1)throw new RangeError('Header or footer is too tall');
    const resize=()=>{if(host)doc.body.style.setProperty('zoom',String(Math.min(1,frame.clientWidth/(spec.width*96/25.4+32))));};
    const observer=new ResizeObserver(resize);if(host)observer.observe(frame);resize();
    let destroyed=false;
    const assertLive=()=>{if(destroyed)throw new Error('Print document has been destroyed');};
    return {
      iframe:frame,document:doc,pages:pages.length,
      print(){assertLive();frame.contentWindow.focus();frame.contentWindow.print();},
      toHTML(){assertLive();const clone=doc.documentElement.cloneNode(true);clone.querySelector('body').style.removeProperty('zoom');return '<!doctype html>\n'+clone.outerHTML;},
      destroy(){if(destroyed)return;destroyed=true;observer.disconnect();frame.remove();},
    };
  } catch(error) {clearTimeout(loadTimer);frame.remove();throw error;}
}

/** Native dialog supplies focus trapping, Escape and return focus. Chrome print opens only on a click. */
export async function preview(spec) {
  hostStyles();const lang=(spec.locale || document.documentElement.lang || 'en').slice(0,2),t=words[lang] || words.en;
  const dialog=element(document,'dialog',null,'ap-preview'),bar=element(document,'div',null,'ap-toolbar');
  const title=element(document,'strong',spec.title || t.preview),printButton=element(document,'button',t.print),close=element(document,'button',t.close);
  dialog.setAttribute('aria-label',t.preview);printButton.disabled=true;
  bar.append(title,printButton,close);dialog.appendChild(bar);
  const host=element(document,'div',null,'ap-preview-host'),status=element(document,'p',t.loading,'ap-status');host.appendChild(status);dialog.appendChild(host);document.body.appendChild(dialog);
  const previous=document.activeElement;dialog.showModal();close.focus();
  let built,closed=false;
  const destroy=()=>{if(closed)return;closed=true;built?.destroy();dialog.close();dialog.remove();if(previous instanceof HTMLElement)previous.focus();};
  close.addEventListener('click',destroy);dialog.addEventListener('cancel',event=>{event.preventDefault();destroy();});
  try {
    built=await prepare(spec,{target:host});
    if(closed){built.destroy();throw new Error('Print preview was closed');}
    status.remove();printButton.disabled=false;printButton.addEventListener('click',()=>built.print());
    return {...built,dialog,destroy};
  } catch(error) {destroy();throw error;}
}

function registerTemplate(name,defaults) {
  if(typeof name!=='string'||!name.trim()||name.length>80)throw new RangeError('Template needs a name');
  templates.set(name,structuredClone(defaults));
}
attach('print',{version:'1.0.0',prepare,preview,registerTemplate,templates:()=>[...templates.keys()]});
