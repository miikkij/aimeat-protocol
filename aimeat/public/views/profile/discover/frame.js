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
 *   v1.1.0 — 2026-08-30 — A designbook hit opens the Design Book gallery at its part
 *     (/v1/design-book#id) instead of dead-ending on the apps tab.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('discover.cover.' + key, vars);
export const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const num = (n) => Number(n || 0).toLocaleString(loc());
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => d.toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'numeric' });
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
    <div class="dv-desk">
      <input type="search" class="dv-field" value=${ctx.q} placeholder=${ctx.scope === 'public' ? c('askPublic') : c('ask')}
        onInput=${(e) => ctx.setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') ctx.submit(); }} />
      <div class="og-choice dv-scope">
        ${SCOPES.map(s => html`<button type="button" key=${s} class=${`og-choice-btn ${ctx.scope === s ? 'on' : ''}`} onClick=${() => ctx.setScope(s)}>${t('discover.scope.' + s)}<i>${count(s) || (s === ctx.scope ? '…' : '')}</i></button>`)}
      </div>
      <p class="dv-hint">${!ctx.facets[ctx.scope] ? html`<span class="dv-loading">${c('loading')}</span>` : ctx.query ? c('hintResults') : c('hint')}</p>
    </div>`;
}

/** The cells of entries: when, what (with the words marked), kind and place, a door. */
export function entryCells(ctx, list, { words = [], time = true } = {}) {
  return list.map((e, i) => html`
      ${time ? html`<div class="dv-at" key=${'a' + i}>${hhmm(new Date(e.updatedAt))}<small>${dayLabel(new Date(e.updatedAt))}</small></div>` : null}
      <div class="dv-nm" key=${'n' + i}><button type="button" class="og-tbl-name" onClick=${() => openEntry(ctx, e)}>${hl(e.title || e.id, words)}</button>${e.description ? html`<small>${hl(e.description, words)}</small>` : null}</div>
      <div class="dv-where" key=${'w' + i}><b>${kindName(e.type)}</b>${placeOf(e) ? ` · ${placeOf(e)}` : ''}${!time ? ` · ${rel(e.updatedAt)}` : ''}</div>
      <div class="og-tbl-door" key=${'d' + i}><button type="button" class="og-door" onClick=${() => openEntry(ctx, e)}>${c('open')}</button></div>`);
}
/** Rows of entries in their own grid. */
export function entryRows(ctx, list, opts = {}) {
  return html`<div class=${`dv-rows ${opts.time === false ? 'dv-rows--hits' : ''}`}>${entryCells(ctx, list, opts)}</div>`;
}
export const rowsHead = () => html`<div class="dv-rows dv-rows--head"><div>${c('colWhen')}</div><div>${c('colWhat')}</div><div>${c('colKindPlace')}</div><div></div></div>`;

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
          <h1 class="og-title dv-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${desk(ctx)}
      <div class="og-grid">
        <div class="og-main">${children}</div>
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
  // A Design Book part has a page of its own since 2026-08-30: the gallery renders it, and the
  // hash opens that part. Before this, the hit dead-ended on the apps tab.
  if (entry.type === 'designbook') {
    const m = String(entry.href || '').match(/\/v1\/designbook\/([^/?#]+)/);
    window.open('/v1/design-book' + (m ? '#' + m[1] : ''), '_blank', 'noopener');
    return;
  }
  const HOME_TAB = { capability: 'capabilities', workflow: 'workflows', organism: 'organisms', knowledge: 'knowledge', skill: 'skills', offering: 'offers', material: 'offers', template: 'apps', company: 'companies' };
  ctx.openTab(HOME_TAB[entry.type] || 'memory');
}
