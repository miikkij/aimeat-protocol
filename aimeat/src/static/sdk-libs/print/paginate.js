/**
 * @file print/paginate.js
 * @description Measured page and column composition; repeats table headings and splits long prose without losing text.
 * @version-history v1.0.0 - 2026-09-18 - Initial paginator.
 */
import { element, safeUrl } from './content.js';

export function paginate(root,doc,spec) {
  const pages=[], columns=spec.columns || 1, maxPages=spec.maxPages || 500;
  let page, columnIndex=0;
  /** @type {HTMLElement} */
  let target;
  const replace=(s,n,total)=>String(s ?? '').replace(/\{(page|pages|title|date)\}/g,(_,key)=>({page:n,pages:total,title:spec.title || '',date:spec.date || ''})[key]);
  function chrome(tag,config,n) {
    const e=element(doc,tag,null,'ap-'+tag);
    const c=typeof config==='string'?{left:config}:config || {};
    for(const key of ['left','center','right']) {const part=element(doc,'div');part.dataset.template=String(c[key] || '');part.textContent=replace(part.dataset.template,n,'888');e.appendChild(part);}
    if(tag==='header'&&spec.logo) {const url=safeUrl(spec.logo);if(!url)throw new Error('Invalid logo URL');const img=element(doc,'img');img.src=url;img.alt='';e.firstElementChild.prepend(img);}
    return e;
  }
  function newPage() {
    if(pages.length>=maxPages)throw new RangeError('Print page limit exceeded');
    page=element(doc,'section',null,'ap-page');
    page.appendChild(chrome('header',pages.length===0 && spec.firstHeader!==undefined?spec.firstHeader:spec.header ?? {left:'{title}',right:'{date}'},pages.length+1));
    const body=element(doc,'main',null,'ap-body');
    for(let i=0;i<columns;i++)body.appendChild(element(doc,'div',null,'ap-column'));
    page.appendChild(body);page.appendChild(chrome('footer',pages.length===0 && spec.firstFooter!==undefined?spec.firstFooter:spec.footer ?? {right:'{page} / {pages}'},pages.length+1));
    doc.body.appendChild(page);pages.push(page);columnIndex=0;target=body.firstElementChild;
  }
  function next() {
    if(columnIndex+1<columns) {columnIndex++;target=page.querySelectorAll('.ap-column')[columnIndex];}else newPage();
  }
  const fits=()=>target.scrollHeight<=target.clientHeight+1;
  const occupied=()=>target.childNodes.length>0;
  function append(node) {target.appendChild(node);if(fits())return true;node.remove();return false;}
  function splitText(node) {
    const texts=[];const walker=doc.createTreeWalker(node,4);let text;
    while((text=walker.nextNode()))texts.push(text);
    const length=node.textContent.length;
    if(!length)throw new RangeError('Print block is taller than a page');
    function slice(end,tail=false) {
      const range=doc.createRange();range.selectNodeContents(node);let pos=end;
      for(const t of texts) {if(pos<=t.length){if(tail)range.setStart(t,pos);else range.setEnd(t,pos);break;}pos-=t.length;}
      const part=node.cloneNode(false);part.appendChild(range.cloneContents());return part;
    }
    let lo=0,hi=length;
    while(lo<hi) {
      const mid=Math.ceil((lo+hi)/2),candidate=slice(mid);target.appendChild(candidate);const ok=fits();candidate.remove();
      if(ok)lo=mid;else hi=mid-1;
    }
    if(lo===0) {if(occupied()){next();place(node);return;}throw new RangeError('Print text cannot fit; reduce font size or margins');}
    const breakAt=node.textContent.lastIndexOf(' ',lo);
    if(breakAt>lo*0.6)lo=breakAt+1;
    target.appendChild(slice(lo));
    if(lo<length){next();place(slice(lo,true));}
  }
  function splitTable(table) {
    if(table.querySelector('[rowspan]'))throw new RangeError('A table with row spans must fit one page; split it before printing');
    const rows=[...table.querySelectorAll(':scope > tbody > tr, :scope > tr')];
    if(!rows.length){splitText(table);return;}
    function shell() {const t=table.cloneNode(false);for(const head of table.querySelectorAll(':scope > caption, :scope > thead'))t.appendChild(head.cloneNode(true));const body=element(doc,'tbody');t.appendChild(body);return {t,body};}
    let chunk=shell();target.appendChild(chunk.t);
    for(const row of rows) {
      chunk.body.appendChild(row.cloneNode(true));
      if(fits())continue;
      chunk.body.lastElementChild.remove();
      if(!chunk.body.children.length)chunk.t.remove();
      next();chunk=shell();target.appendChild(chunk.t);chunk.body.appendChild(row.cloneNode(true));
      if(!fits())throw new RangeError('A table row is taller than one page; reduce font size, widen the page or shorten the row');
    }
    const foot=table.querySelector(':scope > tfoot');if(foot)place(foot.cloneNode(true));
  }
  function place(node) {
    if(node.nodeType===3) {if(!node.textContent.trim())return;const p=element(doc,'p',node.textContent);place(p);return;}
    if(node.nodeType!==1)return;
    if(node.getAttribute('data-print-break')==='before'&&occupied()){newPage();node.removeAttribute('data-print-break');}
    if(append(node))return;
    if(node.tagName==='TABLE'){splitTable(node);return;}
    if(node.hasAttribute('data-print-keep')||node.tagName==='IMG') {
      if(occupied())next();
      if(!append(node))throw new RangeError('A kept print block is taller than one page');
      return;
    }
    if(['DIV','SECTION','ARTICLE','UL','OL'].includes(node.tagName)&&node.children.length) {
      for(const child of [...node.childNodes])place(child);return;
    }
    splitText(node);
  }
  newPage();
  const nodes=[...root.childNodes];
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i];
    // Keep a heading beside the first lines of the following block.
    if(node.nodeType===1&&/^H[1-6]$/.test(node.nodeName)&&nodes[i+1]&&occupied()) {
      const probe=element(doc,'div');probe.appendChild(node.cloneNode(true));
      const nextBlock=nodes[i+1];probe.appendChild(element(doc,'p',(nextBlock.textContent || '').slice(0,180)));
      target.appendChild(probe);const ok=fits();probe.remove();if(!ok)next();
    }
    place(node);
  }
  pages.forEach((p,i)=>p.querySelectorAll('[data-template]').forEach(el=>{
    // Keep the optional logo, replacing only the text slot.
    const logo=el.querySelector('img');el.textContent=replace(el.dataset.template,i+1,pages.length);if(logo)el.prepend(logo);
  }));
  for(const p of pages) for(const c of p.querySelectorAll('.ap-header,.ap-footer')) if(c.scrollHeight>c.clientHeight+1)throw new RangeError('Print header or footer exceeds its reserved height');
  return pages;
}
