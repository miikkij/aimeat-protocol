/**
 * @file public/views/profile/knowledge/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Knowledge cover, the package page and the public library share: the words a
 *   package is described in (kind, maturity, synthesis, visibility, a relation), what a manifest
 *   adds up to (entries, public entries, references and how many are verified), which group a
 *   package belongs to (drafts, published, datasets), the rows of a packages table, the crumb and
 *   the page frame with its rail.
 * @structure c · words · pkgId · statsOf · groupOf · packageRows · crumb · renderPage · entryText
 * @usage import { renderPage, packageRows, statsOf } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('knowledge.cover.' + key, vars);
export const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const num = (n) => Number(n || 0).toLocaleString(loc());
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(loc()) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

export const ctWord = (ct) => (ct ? (t('knowledge.contentTypes.' + ct) || ct) : '');
export const maturityWord = (m) => t('knowledge.maturity.' + (m || 'draft')) || m;
export const synthWord = (s) => t('knowledge.synthesis.' + (s || 'original')) || s;
export const visWord = (v) => t('knowledge.visibility.' + (v === 'shared' ? 'owner' : (v || 'private'))) || v;
export const relWord = (r) => c('relation.' + r) || r;
/** "happydude500001" out of "happydude500001@aimeat-finland-001-genesis". */
export const authorName = (a) => String(a || '').split('@')[0] || '';

export const pkgId = (pkg) => pkg?.value?.id || String(pkg?.key || '').split('/')[1] || pkg?.key;
export const manifestOf = (pkg) => pkg?.value || pkg?.manifest || pkg || {};

/** What a manifest adds up to. */
export function statsOf(m) {
  const entries = m?.entries || [];
  let refs = 0, verified = 0;
  for (const e of entries) for (const r of e.references || []) { refs++; if (r.verified) verified++; }
  for (const r of m?.references || []) { refs++; if (r.verified) verified++; }
  return { entries: entries.length, publicN: entries.filter(e => e.visibility === 'public').length, refs, verified };
}

/** Drafts and reviews, datasets that update themselves, and the published rest. */
export function groupOf(m) {
  if (m?.content_type === 'dataset' || (m?.tags || []).includes('data-package')) return 'dataset';
  if (!m?.maturity || m.maturity === 'draft' || m.maturity === 'review') return 'draft';
  return 'published';
}
export const GROUP_ORDER = ['draft', 'published', 'dataset'];

/** The sharing state in words: listed, clonable, federated. */
export function sharingWords(m, federated) {
  const out = [];
  out.push(m?.sharing?.catalog_listed ? c('listed') : c('notListed'));
  if (m?.sharing?.allow_clone) out.push(c('clonable'));
  if (federated) out.push(t('knowledge.federated'));
  return out;
}

/** One line under a package name: kind · maturity · synthesis · language. */
export const subOf = (m) => [ctWord(m?.content_type || 'document'), maturityWord(m?.maturity), synthWord(m?.synthesis?.level), m?.language ? String(m.language).toLowerCase() : ''].filter(Boolean).join(' · ');

/** An entry's value as readable text: summary and body first, then the named lists, else the JSON. */
export function entryText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const parts = [];
  if (data.summary) parts.push(data.summary);
  if (data.body) parts.push(data.body);
  if (data.description) parts.push(data.description);
  if (data.findings?.length) parts.push(data.findings.map(f => '· ' + f).join('\n'));
  if (data.steps?.length) parts.push(data.steps.map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`).join('\n'));
  if (data.items?.length) parts.push(data.items.map(it => '· ' + (it.title || JSON.stringify(it))).join('\n'));
  if (data.open_questions?.length) parts.push(data.open_questions.map(q => '? ' + q).join('\n'));
  if (parts.length) return parts.join('\n\n');
  return JSON.stringify(data, null, 2);
}

/** Rows of a packages table: name and its line, entries, sharing, changed, a door. */
export function packageRows(ctx, list) {
  return html`<div class="kp-rows">
    ${list.map(pkg => { const m = manifestOf(pkg); const s = statsOf(m); const id = pkgId(pkg); return html`
      <div class="kp-nm" key=${'n' + id}><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'package', id })}>${m.name || c('untitled')}</button><small>${subOf(m)}</small></div>
      <div class="kp-m" key=${'e' + id}><b>${s.entries}</b> ${c('entriesWord', { n: s.entries })}${s.refs ? html`<br />${c('refsVerified', { v: s.verified, n: s.refs })}` : null}</div>
      <div class="kp-w" key=${'s' + id}>${sharingWords(m, !!ctx.fedConsents?.[id]).join(' · ')}</div>
      <div class="kp-m" key=${'u' + id}>${rel(m.updated || pkg.updated_at || pkg.updatedAt)}</div>
      <div class="og-tbl-door" key=${'d' + id}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'package', id })}>${c('open')}</button></div>`; })}
  </div>`;
}
export const rowsHead = () => html`<div class="kp-rows kp-rows--head"><div>${c('colPackage')}</div><div>${c('colEntries')}</div><div>${c('colSharing')}</div><div>${c('colChanged')}</div><div></div></div>`;

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'cover' })}>${t('knowledge.tabLabel')}</button>` : html`<span class="og-crumb-here">${t('knowledge.tabLabel')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span><span class="og-crumb-here">${p}</span>`)}
    </div>`;
}

export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}><i>→</i>${c('library')}<em>↗</em></button>
    <button type="button" class="og-rail-link" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'discover' } }))}><i>→</i>${t('discover.title')}<em>→</em></button>`;
}

export function renderPage(ctx, { crumbs, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`
    <div class="og og-kp og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          <h1 class="og-title kp-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">${children}</div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${t('knowledge.tabLabel')}</span>
          <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>
          ${rail}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}
