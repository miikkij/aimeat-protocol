/**
 * @file src/services/visibility/behaviour-script.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The on-page behaviour script the place adds to an owner's apps (AI visibility,
 *   layer D). It counts, for one page view, where clicks land on a coarse grid, how far the page was
 *   scrolled, which clicks on something that looks clickable changed nothing (dead clicks) and which
 *   were repeated three times in one spot within a moment (rage clicks), and the viewport class.
 *   When the page is hidden it sends that once to `POST /v1/signals/behaviour` with `sendBeacon`.
 *
 *   WHAT IT DOES NOT TOUCH. No cookie, no storage, no identifier, no keystroke, no input value, no
 *   page text, no recording. An element is named by its tag, id and first class only. A browser
 *   that sends Global Privacy Control or Do Not Track reports the view and nothing else.
 *
 *   A DEAD CLICK is a click on a button, a link to this page, an element with an `onclick` or a
 *   button role, or anything with a pointer cursor, after which the page did not change within one
 *   second: no element added, removed or changed, no navigation. A link that leaves the page, a
 *   form field and a link that opens a new tab are never dead.
 *
 *   The script is plain ES5 so it runs in every browser an app runs in, and it is written once per
 *   served page with the owner and the app as JSON string literals.
 * @structure BEHAVIOUR_MARK · behaviourSnippet
 * @usage html += behaviourSnippet(config.baseUrl, ownerGhii, filename);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */

/** The attribute the script element carries; services/app-serve-marks-strip.ts takes it back out of a served copy. */
export const BEHAVIOUR_MARK = 'data-aimeat-behaviour';

/** A value made safe to sit inside a script element as a JSON string literal. */
const literal = (v: string): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, '');

/** The script element for one served app page. */
export function behaviourSnippet(baseUrl: string, ownerGhii: string, filename: string): string {
  const beacon = `${baseUrl.replace(/\/+$/, '')}/v1/signals/behaviour`;
  return `<script ${BEHAVIOUR_MARK}>(function(){try{
if(window.__aimeatBehaviour)return;window.__aimeatBehaviour=1;
var B=${literal(beacon)},O=${literal(ownerGhii)},A=${literal(filename)};
var nav=navigator,out=nav.globalPrivacyControl===true||nav.doNotTrack==='1'||window.doNotTrack==='1';
var heat={},hn=0,dead={},rage={},nd=0,maxS=0,sent=false,changed=0,recent=[];
function W(){return window.innerWidth||document.documentElement.clientWidth||1}
function H(){return window.innerHeight||document.documentElement.clientHeight||1}
function vc(){var w=W();return w<600?'phone':(w<1024?'tablet':'desktop')}
function bump(o,k){o[k]=(o[k]||0)+1}
function name(el){if(!el||!el.tagName)return 'unknown';var n=el.tagName.toLowerCase();
if(el.id)n+='#'+String(el.id).slice(0,30);
var c=typeof el.className==='string'?el.className.replace(/^\\s+|\\s+$/g,'').split(/\\s+/)[0]:'';
if(c)n+='.'+c.slice(0,30);return n.slice(0,80)}
function scroll(){var d=document.documentElement,b=document.body,h=Math.max(d.scrollHeight,b?b.scrollHeight:0,1);
var p=((window.scrollY||d.scrollTop||0)+H())/h*100;if(p>maxS)maxS=p}
function clickable(t){var el=t,i=0;
while(el&&el.nodeType===1&&i<6){var tag=el.tagName.toLowerCase();
if(tag==='input'||tag==='select'||tag==='textarea'||tag==='label'||tag==='option')return null;
if(tag==='a'){var h=el.getAttribute('href');
if(el.getAttribute('target')==='_blank'||el.hasAttribute('download'))return null;
if(h&&h.charAt(0)!=='#'&&h.indexOf('javascript:')!==0)return null;return el}
if(tag==='button'||tag==='summary'||el.hasAttribute('onclick')||el.getAttribute('role')==='button')return el;
try{if(window.getComputedStyle(el).cursor==='pointer')return el}catch(_){}
el=el.parentElement;i++}return null}
if(window.MutationObserver){new MutationObserver(function(){changed=Date.now()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true})}
window.addEventListener('hashchange',function(){changed=Date.now()});
window.addEventListener('popstate',function(){changed=Date.now()});
window.addEventListener('scroll',scroll,{passive:true});
document.addEventListener('click',function(e){try{if(out)return;
var v=vc(),now=Date.now(),x=Math.floor(e.clientX/W()*12),y=Math.floor((e.clientY+(window.scrollY||0))/H()*4);
x=Math.max(0,Math.min(11,x));y=Math.max(0,Math.min(39,y));
if(hn<200){hn++;bump(heat[v]||(heat[v]={}),x+','+y)}
var kept=[];for(var i=0;i<recent.length;i++){if(now-recent[i].t<800)kept.push(recent[i])}
kept.push({t:now,x:e.clientX,y:e.clientY});recent=kept;
var near=0;for(var j=0;j<recent.length;j++){if(Math.abs(recent[j].x-e.clientX)<32&&Math.abs(recent[j].y-e.clientY)<32)near++}
if(near===3&&nd<40){nd++;bump(rage,v+'|'+name(e.target))}
var c=clickable(e.target);if(c){var at=now;setTimeout(function(){if(!sent&&changed<at&&nd<40){nd++;bump(dead,v+'|'+name(c))}},1000)}
}catch(_){}},true);
function send(){if(sent)return;sent=true;try{scroll();
var s=maxS>=95?'100':(maxS>=75?'75':(maxS>=50?'50':'25'));
var body=out?{o:O,a:A,x:1}:{o:O,a:A,vc:vc(),s:s,h:heat,d:dead,r:rage};
if(nav.sendBeacon)nav.sendBeacon(B,JSON.stringify(body))}catch(_){}}
window.addEventListener('pagehide',send);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scroll);else scroll();
}catch(_){}})();</script>`;
}
