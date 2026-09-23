/**
 * @file cost.js
 * @description The Cost & Contracts section of the App Detail view (EXCHANGE G3 / TARGET-045): a
 *   read-only per-app surface of the EXCHANGE contracts (metered entitlements) an app sources, with
 *   live spend against each budget and the platform rake. Data comes from GET /v1/apps/cost?app_id=,
 *   which returns only entitlements whose consumer is the signed-in owner (strictly cross-owner).
 *   Rendering mirrors monetize.js: detail.js renders the shell for OWN published apps and calls
 *   costOnOpen; this module async-loads and re-renders #detail-cost in place.
 * @structure costOnOpen · costSectionInner
 * @usage import { costSectionInner, costOnOpen } from './cost.js'
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial per-app cost & contracts surface (EXCHANGE G3).
 */
import { escapeHtml } from './util.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';

var cState = 'off';   // 'off' | 'loading' | 'ready' | 'error'
var cData = null;     // the /v1/apps/cost data payload, or null
var cAppId = '';      // full app id "owner/filename"

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function rerender() {
  var el = document.getElementById('detail-cost');
  if (el) el.innerHTML = costSectionInner();
}

/** Reset + async-load the cost surface when a detail view opens. No-op for non-own / unpublished apps. */
export function costOnOpen(owner, appId, isOwn) {
  cData = null;
  if (!isOwn || !owner || !appId) { cState = 'off'; cAppId = ''; return; }
  cAppId = owner + '/' + appId;
  cState = 'loading';
  var token = getCortexOwnerToken();
  if (!token) { cState = 'error'; cData = { _needLogin: true }; return; }
  fetch(apiBase() + '/v1/apps/cost?app_id=' + encodeURIComponent(cAppId), {
    headers: { 'Authorization': 'Bearer ' + token },
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res || !res.ok || !res.data) throw new Error('bad response');
      cData = res.data;
      cState = 'ready';
      rerender();
    })
    .catch(function () { cState = 'error'; cData = null; rerender(); });
}

function stateBadge(state) {
  // Reuse the sync-chip colours: ok (active), diff (paused), none (revoked/exhausted).
  var cls = state === 'active' ? 'ok' : (state === 'paused' ? 'diff' : 'none');
  return '<span class="dtl-sync ' + cls + '" style="margin:0">' + escapeHtml(state) + '</span>';
}

function contractRow(c) {
  var b = c.budget || {};
  var cap = (b.cap_units === null || b.cap_units === undefined) ? t('cost.uncapped') : (b.spent_units + ' / ' + b.cap_units);
  var remaining = (b.remaining_units === null || b.remaining_units === undefined) ? ''
    : ' <span class="dtl-stat-label">(' + t('cost.remaining').replace('{n}', b.remaining_units) + ')</span>';
  var providerShort = String(c.provider || '').split('@')[0];
  return '<div class="dtl-status-row" style="align-items:center;gap:10px;flex-wrap:wrap">' +
      '<div class="dtl-stat" style="flex:1;min-width:150px">' +
        '<span class="dtl-stat-val">' + escapeHtml(c.capability || '') + '</span>' +
        '<span class="dtl-stat-label">' + escapeHtml(t('cost.providerCol')) + ': ' + escapeHtml(providerShort) + '</span>' +
      '</div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + t('cost.priceCol') + '</span><span class="dtl-stat-val">' + escapeHtml(String(c.price_per_call)) + ' morsels</span></div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + t('cost.rakeCol') + '</span><span class="dtl-stat-val">' + escapeHtml(String(c.rake_per_call)) + ' morsels (' + escapeHtml(String(c.rake_percent)) + '%)</span></div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + t('cost.budgetCol') + '</span><span class="dtl-stat-val">' + escapeHtml(cap) + remaining + '</span></div>' +
      '<div class="dtl-stat">' + stateBadge(c.state) + '</div>' +
    '</div>';
}

/** Inner HTML of the section — detail.js wraps it in <div class="dtl-section" id="detail-cost">. */
export function costSectionInner() {
  if (cState === 'off') return '';
  var html = '<h3>' + t('cost.title') + '</h3>' +
    '<p class="dtl-desc">' + t('cost.hint') + '</p>';
  if (cState === 'loading') {
    return html + '<span style="color:var(--text-muted);font-size:.85rem">…</span>';
  }
  if (cState === 'error') {
    var msg = (cData && cData._needLogin) ? t('cost.needLogin') : t('cost.loadFailed');
    return html + '<span class="dtl-sync none">' + escapeHtml(msg) + '</span>';
  }
  var contracts = (cData && cData.contracts) || [];
  if (!contracts.length) {
    return html + '<span class="dtl-sync none">' + t('cost.empty') + '</span>';
  }
  var m = (cData.totals && cData.totals.morsels) || { spent_units: 0, calls: 0 };
  html += '<div class="dtl-sync ok" style="margin:0 0 10px">' +
    t('cost.summary').replace('{n}', cData.total_contracts).replace('{spent}', m.spent_units).replace('{calls}', m.calls) +
    '</div>';
  for (var i = 0; i < contracts.length; i++) html += contractRow(contracts[i]);
  return html;
}
