/**
 * @file public/views/profile/discover/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Discover cover and its pages share: the words (a kind's name and what it
 *   is, a scope's name), the search desk (one field, the scope beside it with its counts), the row
 *   of one entry (when, title and a plain description with the query words marked, kind and place,
 *   a door), the crumb, the page frame with its rail, and opening an entry at its real home.
 * @structure c · kindName · kindSub · HUMAN_TYPES · desk · entryRows · crumb · renderPage · openEntry
 * @usage import { renderPage, desk, entryRows, openEntry } from './frame.js';
 * @version-history
 *   2026-09-14 -- Whole directory composes the shared set; routing and query data stay unchanged.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.3.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: use the shared ink rule on the search row.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Stack, Field, Toolbar, ListRow, Action, Text } from '/components/poster-parts.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('discover.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
export const num = (n) => fmtNum(Number(n || 0));
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? dayLabel(d) : formatRelativeTime(iso); };

/** The kinds a person reads; `memory` is the raw store and is shown on its own terms. */
export const HUMAN_TYPES = ['document', 'knowledge', 'decision', 'skill', 'app', 'offering', 'workflow', 'company', 'template', 'designbook', 'material', 'capability', 'research', 'organism'];
export const kindName = (type) => t('discover.type.' + type) || type;
export const kindSub = (type) => c('kindSub.' + type);
export const SCOPES = ['own', 'public', 'shared'];

/** Split a text at the query words and mark them; plain strings when there is no query. */
export function hl(text, words) {
  const s = String(text || '');
  if (!words.length || !s) return s;
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  const parts = s.split(re);
  return parts.map((p, i) => (i % 2 ? html`<mark key=${i}>${p}</mark>` : p));
}

export const placeOf = (e) => (e.place ? `${e.place.organism} › ${e.place.workspace}${e.segment && e.type === 'document' ? ` › ${e.segment}` : ''}` : (e.segment && e.type !== 'memory' ? e.segment : ''));

/** The search desk retains scope counts, Enter submission and literal server copy. */
export function desk(ctx) {
  const count = s => {
    const f = ctx.facets[s];
    if (!f) return s === ctx.scope ? '…' : '';
    return num(f.total) + (s === 'public' && f.types.some(x => x.count >= 50) ? '+' : '');
  };
  return html`<${Stack}>
    <${Field} type='search' label=${t('discover.title')} value=${ctx.q}
      placeholder=${ctx.scope === 'public' ? c('askPublic') : c('ask')}
      onInput=${e => ctx.setQ(e.target.value)} onKeyDown=${e => {if(e.key === 'Enter')ctx.submit();}} />
    <${Toolbar} filters=${SCOPES.map(s => ({id:s,label:`${t('discover.scope.'+s)} ${count(s)}`,selected:ctx.scope === s,onClick:() => ctx.setScope(s)}))}
      actions=${html`<${Action} onClick=${ctx.submit}>${t('common.search')}<//>`} />
    <${Text} kind='caption' tone='muted'>${!ctx.facets[ctx.scope] ? c('loading') : ctx.query ? c('hintResults') : c('hint')}<//>
  <//>`;
}

/** Entry identity, place and chronology are data in one shared roster row. */
export function entryRows(ctx, list, { words = [], time = true } = {}) {
  return html`<${Stack} density='compact'>${list.map((e,i) => html`
    <${ListRow} key=${e.id || i} name=${hl(e.title || e.id,words)} onOpen=${() => openEntry(ctx,e)}
      detail=${e.description ? hl(e.description,words) : undefined}
      value=${time ? html`<${Stack} density='compact'><${Text} kind='number' size='small'>${hhmm(new Date(e.updatedAt))}<//>
        <${Text} kind='caption'>${dayLabel(new Date(e.updatedAt))}<//><//>` : rel(e.updatedAt)}
      actions=${html`<${Action} onClick=${() => openEntry(ctx,e)}>${c('open')}<//>`}>
      <${Text} kind='mono' tone='muted'>${kindName(e.type)}${placeOf(e) ? ' · '+placeOf(e) : ''}<//>
    <//>`)}<//>`;
}

/** The trail to a directory page, as Masthead crumbs: Settings & Controls, Discover, then the parts. */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('discover.title'), onClick: parts.length ? () => ctx.pickView({kind:'cover'}) : undefined },
    ...parts.map(p => ({ label: p })),
  ];
}

/** A Page owns the frame; this helper only supplies the directory's copy and actions. */
export function renderPage(ctx, { crumbs = [], title, chips = null, doors = null, rail = null, children }) {
  return html`<${Page} width='wide' title=${title} crumbs=${crumb(ctx,crumbs)} identity=${chips} actions=${doors}
    rail=${html`<${Rail} kind='index' title=${t('discover.title')}><${Stack}>
      <${Action} onClick=${() => ctx.pickView({kind:'cover'})}>← ${c('backTo')}<//>
      ${rail}
    <//><//>`}>
    <${Stack}>${desk(ctx)}${children}<//>
  <//>`;
}

/**
 * Open a result at its real home. The backend `href` is the API fetch URL (for agents); a browser
 * tab there has no Bearer header, so clicks are routed by what the entry is.
 */
export function openEntry(ctx, entry) {
  const id = String(entry.id || '');
  const ws = id.match(/^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)\.([^.]+)/);
  if (ws) {
    const [, org, wsId, space, docId] = ws;
    if (ctx.scope === 'public') {
      window.open(`/v1/publicworkspaceviewer?org=${encodeURIComponent(org)}&ws=${encodeURIComponent(wsId)}&type=${encodeURIComponent(space)}&id=${encodeURIComponent(docId)}`, '_blank', 'noopener');
      return;
    }
    try {
      sessionStorage.setItem('aimeat.ws.openId', org);
      sessionStorage.setItem('aimeat.ws.openWs', wsId);
      sessionStorage.setItem(`aimeat.ws.${org}.${wsId}.openDoc`, JSON.stringify({ namespace: space, id: docId }));
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
    ctx.openTab('organisms');
    return;
  }
  const pkg = id.match(/^packages\/([^/]+)\//);
  if (pkg) { window.open(`/v1/publicknowledgeviewer?id=${encodeURIComponent(pkg[1])}`, '_blank', 'noopener'); return; }
  if (entry.type === 'app' && entry.href) { window.open(entry.href, '_blank', 'noopener'); return; }
  const HOME_TAB = { capability: 'capabilities', workflow: 'workflows', organism: 'organisms', knowledge: 'knowledge', skill: 'skills', offering: 'offers', material: 'offers', designbook: 'apps', template: 'apps', company: 'companies' };
  ctx.openTab(HOME_TAB[entry.type] || 'memory');
}
