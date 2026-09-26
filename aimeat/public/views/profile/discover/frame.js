/**
 * @file public/views/profile/discover/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Discover cover and its pages share: the words (a kind's name and what it
 *   is, a scope's name), the search desk (one field, the scope beside it with its counts), the row
 *   of one entry (when, title and a plain description with the query words marked, kind and place,
 *   a door), the crumb, the page frame with its rail, and opening an entry at its real home.
 * @structure c · kindName · kindSub · HUMAN_TYPES · desk · entryCells · entryRows · crumb · renderPage · openEntry
 * @usage import { renderPage, desk, entryRows, openEntry } from './frame.js';
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- The rows of entries are the Listing (listing, listing-row and its head row, name, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-26 -- The line under an entry's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Hint } from '/components/Hint.js';

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

/** The search desk: the field, the scope beside it with a count per scope, one hint. */
export function desk(ctx) {
  const count = (s) => { const f = ctx.facets[s]; if (!f) return ''; return (s === 'public' && f.types.some(x => x.count >= 50)) ? `${num(f.total)}+` : num(f.total); };
  return html`
    <div class="dv-desk poster-row--thing">
      <input type="search" class="dv-field" value=${ctx.q} placeholder=${ctx.scope === 'public' ? c('askPublic') : c('ask')}
        onInput=${(e) => ctx.setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') ctx.submit(); }} />
      <div class="pf-tabs dv-scope">
        ${SCOPES.map(s => html`<button type="button" key=${s} class=${`poster-tab ${ctx.scope === s ? 'is-on' : ''}`} onClick=${() => ctx.setScope(s)}>${t('discover.scope.' + s)}<i>${count(s) || (s === ctx.scope ? '…' : '')}</i></button>`)}
      </div>
      <${Hint}>${!ctx.facets[ctx.scope] ? html`<span class="loading-mark">${c('loading')}</span>` : ctx.query ? c('hintResults') : c('hint')}<//>
    </div>`;
}

/** The rows of entries (Listing rows): when, what (with the words marked), kind and place, a door. */
export function entryCells(ctx, list, { words = [], time = true } = {}) {
  return list.map((e, i) => html`
    <div class="listing-row" key=${'e' + i}>
      ${time ? html`<div class="dv-at poster-stat-number poster-stat-number--small">${hhmm(new Date(e.updatedAt))}<small>${dayLabel(new Date(e.updatedAt))}</small></div>` : null}
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => openEntry(ctx, e)}>${hl(e.title || e.id, words)}</button>${e.description ? html`<small class="listing-meta">${hl(e.description, words)}</small>` : null}</div>
      <div class="listing-desc"><b>${kindName(e.type)}</b>${placeOf(e) ? ` · ${placeOf(e)}` : ''}${!time ? ` · ${rel(e.updatedAt)}` : ''}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => openEntry(ctx, e)}>${c('open')}</button></div>
    </div>`);
}
/** The Listing of entries; with `time: false` the hits' cut (no when column), with `head` its heading row. */
export function entryRows(ctx, list, opts = {}) {
  const hits = opts.time === false;
  return html`<div class=${`listing listing--cols dv-rows ${hits ? 'listing--name-where-doors dv-rows--hits' : 'listing--when-name-where-doors'}`}>${opts.head ? rowsHead() : null}${entryCells(ctx, list, opts)}</div>`;
}
const rowsHead = () => html`<div class="listing-row listing-row--head"><div class="poster-label">${c('colWhen')}</div><div class="poster-label">${c('colWhat')}</div><div class="poster-label">${c('colKindPlace')}</div><div class="poster-label"></div></div>`;

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'cover' })}>${t('discover.title')}</button>` : html`<span class="og-crumb-here">${t('discover.title')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span><span class="og-crumb-here">${p}</span>`)}
    </div>`;
}

export function renderPage(ctx, { crumbs, title, chips = null, doors = null, rail = null, children }) {
  return html`
    <div class="og og-dv og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title dv-title--page">${title}</h1>
          ${chips ? html`<div class="poster-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${desk(ctx)}
      <div class="og-grid">
        <div class="og-main poster-row--thing">${children}</div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${t('discover.title')}</span>
          <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>
          ${rail}
        </nav>
      </div>
    </div>`;
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
