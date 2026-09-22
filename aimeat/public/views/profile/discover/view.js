/**
 * @file public/views/profile/discover/view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Discover page in the poster face (design canvas "AIMEAT Löydä-sivu", direction A):
 *   the field is the page. The COVER: one search field with the scope beside it, then what is here
 *   (each kind with its count and where it lives), what changed last among the kinds a person
 *   reads, the places (organisms and their workspaces), and the machine's bookkeeping as a fold.
 *   RESULTS for a query come grouped by kind, best first, the words marked, the bookkeeping counted
 *   but folded. A kind and a place each open as a page of rows. Pure render functions over the ctx
 *   bag discover-tab.js assembles.
 * @structure renderDiscoverView · renderCover · secKinds · secRecent · secPlaces · secBookkeeping · renderResults · renderKind · renderPlace
 * @usage import { renderDiscoverView } from './discover/view.js';
 * @version-history
 *   2026-09-14 -- Rebuild every directory state from the shared poster parts; no own CSS.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.1 — 2026-08-30 — Says it is counting, searching or loading rows instead of an ellipsis.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the scope buttons, the thirteen type chips and the
 *     newest-first dump of every record.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Columns, Stack, ListRow, KeyValue, Action, Text, Chip } from '/components/poster-parts.js';
import { c, num, kindName, kindSub, HUMAN_TYPES, desk, entryRows, crumb, renderPage, rel } from './frame.js';

const RECENT_ROWS = 8;
export function renderDiscoverView(ctx) {
  if (ctx.query) return renderResults(ctx);
  if (ctx.view.kind === 'kind') return renderKind(ctx,ctx.view.type);
  if (ctx.view.kind === 'place') return renderPlace(ctx,ctx.view.organismId,ctx.view.organism);
  return renderCover(ctx);
}
function kindsOf(f) {
  if (!f) return [];
  const book=f.segments.find(s => s.type === 'memory' && s.segment === 'bookkeeping')?.count || 0;
  return f.types.map(x => x.value === 'memory' ? {...x,count:x.count-book,book} : x).filter(x => x.count > 0);
}
function renderCover(ctx) {
  const f=ctx.facets[ctx.scope], kinds=kindsOf(f);
  const book=f?.segments.find(s => s.type === 'memory' && s.segment === 'bookkeeping')?.count || 0;
  const total=f ? f.total-book : 0, places=f?.places || [], orgs=new Set(places.map(p => p.organismId));
  return html`<${Page} width='wide' title=${t('discover.title')} crumbs=${crumb(ctx,[])}
    identity=${html`<${Stack} direction='wrap' density='compact'>
      <${Chip}>${c('chipItems',{n:num(total)})}<//><${Chip}>${c('chipKinds',{n:kinds.length})}<//>
      ${orgs.size > 0 && html`<${Chip}>${c('chipOrgs',{n:orgs.size})}<//>`}
      ${book > 0 && html`<${Chip} tone='muted'>${c('chipBook',{n:num(book)})}<//>`}
      ${ctx.facets.shared?.total > 0 && html`<${Chip}>${c('chipShared',{n:num(ctx.facets.shared.total)})}<//>`}
    <//>`}
    actions=${html`<${Action} onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}<//>
      <${Action} onClick=${() => ctx.openTab('knowledge')}>${t('knowledge.tabLabel')}<//>`}
    rail=${html`<${Rail} kind='index' title=${c('railTitle')} entries=${[
      {href:'#dv-kinds',label:c('secKinds'),count:kinds.length},{href:'#dv-recent',label:c('secRecent')},
      {href:'#dv-places',label:c('secPlaces'),count:orgs.size},{href:'#dv-book',label:c('secBook'),count:num(book)}
    ]}><${Stack}><${Text} kind='label'>${c('scopes')}<//>
      ${['own','public','shared'].map(s => html`<${Action} key=${s} kind='tab' selected=${ctx.scope === s} onClick=${() => ctx.setScope(s)}>
        ${t('discover.scope.'+s)} ${ctx.facets[s] ? num(ctx.facets[s].total) : '→'}<//>`)}
    <//><//>`}>
    <${Stack}><${Text} kind='lead'>${c('desc')}<//>${desk(ctx)}
      ${secKinds(ctx,kinds)}${secRecent(ctx)}${secPlaces(ctx,places)}${secBookkeeping(ctx,book)}
    <//>
  <//>`;
}
function whereOf(f,type) {
  return f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping').slice(0,3)
    .map(s => `${s.segment} ${num(s.count)}`).join(' · ');
}
function secKinds(ctx,kinds) {
  const f=ctx.facets[ctx.scope], capped=ctx.scope === 'public';
  return html`<${Section} id='dv-kinds' title=${c('secKinds')} description=${c('secKindsSub',{n:kinds.length})}>
    ${!f ? html`<${Text} tone='muted'>${c('loading')}<//>` : !kinds.length ? html`<${Text} tone='muted'>${t('discover.empty')}<//>`
      : kinds.map(k => html`<${ListRow} key=${k.value} detailKind='text' name=${kindName(k.value)} detail=${kindSub(k.value)}
        onOpen=${() => ctx.pickView({kind:'kind',type:k.value})}
        value=${html`<${Text} kind='number' size='small'>${num(k.count)}${capped && k.count >= 50 ? '+' : ''}<//>`}
        actions=${html`<${Action} onClick=${() => ctx.pickView({kind:'kind',type:k.value})}>${c('browse')}<//>`}>
        <${Text} kind='mono' tone='muted'>${whereOf(f,k.value)}<//>
      <//>`)}
  <//>`;
}
function secRecent(ctx) {
  const all=ctx.recent[ctx.scope] || null, filt=ctx.recentType;
  const list=all ? (filt ? all.filter(e => e.type === filt) : all) : [];
  const shown=ctx.recentOpen ? list : list.slice(0,RECENT_ROWS), present=all ? [...new Set(all.map(e => e.type))] : [];
  const doorFor=(type,label) => html`<${Action} key=${type || 'all'} kind='tab' selected=${filt === type} onClick=${() => ctx.setRecentType(type)}>${label}<//>`;
  return html`<${Section} id='dv-recent' title=${c('secRecent')} description=${c('secRecentSub')}
    actions=${html`${doorFor('',c('allKinds'))}${['document','knowledge','skill','decision'].filter(x => present.includes(x)).map(x => doorFor(x,kindName(x)))}`}>
    <${Stack}>${!all ? html`<${Text} tone='muted'>${c('loadingRecent')}<//>` : !list.length ? html`<${Text} tone='muted'>${c('noneRecent')}<//>` : entryRows(ctx,shown)}
      ${list.length > RECENT_ROWS && html`<${Action} onClick=${() => ctx.setRecentOpen(v => !v)}>${ctx.recentOpen ? c('showFewer') : c('showMore',{n:list.length-RECENT_ROWS})}<//>`}
      <${Text} kind='caption' tone='muted'>${c('recentHint')}<//>
    <//>
  <//>`;
}
function secPlaces(ctx,places) {
  const byOrg=new Map();
  for(const p of places){let o=byOrg.get(p.organismId);if(!o){o={id:p.organismId,name:p.organism,count:0,ws:[]};byOrg.set(p.organismId,o);}o.count+=p.count;o.ws.push(p);}
  const orgs=[...byOrg.values()].sort((a,b) => b.count-a.count);
  return html`<${Section} id='dv-places' title=${c('secPlaces')} description=${c('secPlacesSub',{o:orgs.length,w:places.length})}
    actions=${html`<${Action} onClick=${() => ctx.openTab('organisms')}>${t('profile.tabs.organisms')}<//>`}>
    <${Stack}>${!orgs.length ? html`<${Text} tone='muted'>${c('nonePlaces')}<//>` : html`<${Columns}>
      ${orgs.map(o => html`<${ListRow} key=${o.id} name=${o.name} detail=${c('placeSub',{w:o.ws.length,n:num(o.count)})}
        onOpen=${() => ctx.pickView({kind:'place',organismId:o.id,organism:o.name})}>
        ${o.ws.slice(0,3).map(w => html`<${KeyValue} key=${w.workspaceId} label=${w.workspace} value=${num(w.count)} />`)}
        ${o.ws.length > 3 && html`<${Text} kind='caption'>${c('moreN',{n:o.ws.length-3})}<//>`}
      <//>`)}
    <//>`}<${Text} kind='caption' tone='muted'>${c('placesHint')}<//><//>
  <//>`;
}
function secBookkeeping(ctx,book) {
  return html`<${Section} id='dv-book' title=${c('secBook')} description=${c('secBookSub',{n:num(book)})}
    actions=${html`<${Action} expanded=${ctx.bookOpen} onClick=${() => ctx.setBookOpen(v => !v)}>${ctx.bookOpen ? c('showFewer') : c('browseBook')}<//>`}>
    ${ctx.bookOpen && html`<${Stack}><${Text} kind='caption' tone='muted'>${c('bookHint')}<//><${Stack} direction='wrap'>
      <${Action} onClick=${() => ctx.openTab('memory')}>${t('profile.memory.title')}<//>
      <${Action} onClick=${() => ctx.pickView({kind:'kind',type:'memory',bookkeeping:true})}>${c('browseBook')}<//>
    <//><//>`}
  <//>`;
}
function renderResults(ctx) {
  const r=ctx.results, words=ctx.query.split(/\s+/).filter(Boolean), entries=r?.entries || [];
  const human=entries.filter(e => !(e.type === 'memory' && e.segment === 'bookkeeping')), book=entries.length-human.length;
  const groups=new Map();for(const e of human){if(!groups.has(e.type))groups.set(e.type,[]);groups.get(e.type).push(e);}
  const order=[...groups.keys()].sort((a,b) => HUMAN_TYPES.indexOf(a)-HUMAN_TYPES.indexOf(b));
  const otherScopes=['own','public','shared'].filter(s => s !== ctx.scope);
  return renderPage(ctx,{crumbs:[ctx.query],title:t('discover.title'),
    chips:html`<${Stack} direction='wrap'><${Text} kind='label'>${r ? c('hitsN',{n:num(human.length)}) : '…'}<//>
      ${order.map(k => html`<${Text} key=${k} kind='label'>${kindName(k)} ${groups.get(k).length}<//>`)}
      ${book > 0 && html`<${Text} kind='label'>${c('bookHidden',{n:book})}<//>`}<//>`,
    doors:html`<${Action} onClick=${ctx.clear}>${c('clear')}<//>`,
    rail:html`<${Text} kind='label'>${c('scopes')}<//>${['own','public','shared'].map(s => html`<${Action} key=${s} kind='tab' selected=${ctx.scope === s} onClick=${() => ctx.setScope(s)}>
      ${t('discover.scope.'+s)} ${ctx.scope === s ? num(human.length) : ctx.otherCounts[s] ?? '…'}<//>`)}`,
    children:html`<${Stack}>${!r ? html`<${Text} tone='muted'>${c('searching')}<//>` : !human.length ? html`<${Text} tone='muted'>${t('discover.empty')}<//>`
      : order.map(k => {const list=groups.get(k),open=ctx.moreOpen.has(k),shown=open ? list : list.slice(0,5);return html`
        <${Section} key=${k} title=${kindName(k)} description=${String(list.length)}><${Stack}>${entryRows(ctx,shown,{words,time:false})}
          ${list.length > 5 && html`<${Action} expanded=${open} onClick=${() => ctx.toggleMore(k)}>${open ? c('showFewer') : c('showRestOf',{n:list.length-5,k:kindName(k).toLowerCase()})}<//>`}
        <//><//>`;})}
      ${book > 0 && html`<${Section} id='dv-bookhits' title=${c('secBook')} description=${c('bookHitsSub',{n:book})}
        actions=${html`<${Action} expanded=${ctx.bookOpen} onClick=${() => ctx.setBookOpen(v => !v)}>${ctx.bookOpen ? c('showFewer') : c('browseBook')}<//>`}>
        ${ctx.bookOpen && entryRows(ctx,entries.filter(e => e.type === 'memory' && e.segment === 'bookkeeping'),{words,time:false})}<//>`}
      ${otherScopes.some(s => ctx.otherCounts[s]) && html`<${Text} kind='caption' tone='muted'>${c('alsoIn',{list:otherScopes.filter(s => ctx.otherCounts[s]).map(s => `${t('discover.scope.'+s)} ${ctx.otherCounts[s]}`).join(' · ')})}<//>`}
    <//>`,
  });
}
function browseBody(ctx) {
  const b=ctx.browse;
  return html`<${Stack}>${!b || b.loading && !b.entries.length ? html`<${Text} tone='muted'>${c('loadingRows')}<//>`
    : !b.entries.length ? html`<${Text} tone='muted'>${t('discover.empty')}<//>` : entryRows(ctx,b.entries)}
    ${b && b.entries.length < b.total && html`<${Action} disabled=${b.loading} onClick=${ctx.browseMore}>${c('showMore',{n:num(b.total-b.entries.length)})}<//>`}
  <//>`;
}
function renderKind(ctx,type) {
  const f=ctx.facets[ctx.scope], n=f?.types.find(x => x.value === type)?.count || 0;
  const segs=f ? f.segments.filter(s => s.type === type && s.segment !== 'bookkeeping') : [];
  return renderPage(ctx,{crumbs:[kindName(type)],title:kindName(type),
    chips:html`<${Stack} direction='wrap'><${Text} kind='label'>${c('chipItems',{n:num(n)})}<//>
      ${segs.slice(0,6).map(s => html`<${Action} key=${s.segment} kind='tab' selected=${ctx.segment === s.segment}
        onClick=${() => ctx.setSegment(ctx.segment === s.segment ? '' : s.segment)}>${s.segment} ${num(s.count)}<//>`)}<//>`,
    rail:html`<${Text} kind='label'>${c('secKinds')}<//>${kindsOf(f).map(k => html`<${Action} key=${k.value} kind='tab' selected=${k.value === type}
      onClick=${() => ctx.pickView({kind:'kind',type:k.value})}>${kindName(k.value)} ${num(k.count)}<//>`)}`,
    children:html`<${Text} kind='lead'>${kindSub(type)}<//>${browseBody(ctx)}`,
  });
}
function renderPlace(ctx,organismId,organism) {
  const ws=(ctx.facets[ctx.scope]?.places || []).filter(p => p.organismId === organismId);
  return renderPage(ctx,{crumbs:[organism],title:organism,
    chips:html`<${Text} kind='label'>${c('placeSub',{w:ws.length,n:num(ws.reduce((s,w) => s+w.count,0))})}<//>`,
    doors:html`<${Action} onClick=${() => ctx.openTab('organisms')}>${c('openOrganism')}<//>`,
    rail:html`<${Text} kind='label'>${c('workspaces')}<//>${ws.map(w => html`<${KeyValue} key=${w.workspaceId} label=${w.workspace} value=${num(w.count)} />`)}`,
    children:html`<${Text} kind='lead'>${c('placeDesc',{t:rel(ctx.browse?.entries?.[0]?.updatedAt) || ''})}<//>${browseBody(ctx)}`,
  });
}
