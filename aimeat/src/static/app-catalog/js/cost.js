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
 *   v1.1.0 — 2026-09-22 — Drawn from the shared set (parts-html.js): the section returns its own
 *     section() for the slot detail.js draws, each contract is a list row with its state as a chip
 *     and price, rake and budget as labelled columns, and the inline styles are gone.
 *   v1.0.0 — 2026-07-20 — Initial per-app cost & contracts surface (EXCHANGE G3).
 */
import { escapeHtml } from './util.js';
import { section, listRow, chip, columns, stack, text } from './parts-html.js';
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

function stateChip(state) {
  // Active reads as fine, paused as the one to see, revoked or exhausted as done.
  return chip(escapeHtml(state), state === 'active' ? 'success' : (state === 'paused' ? 'sun' : 'muted'));
}

function contractRow(c) {
  var b = c.budget || {};
  var cap = (b.cap_units === null || b.cap_units === undefined) ? t('cost.uncapped') : (b.spent_units + ' / ' + b.cap_units);
  var remaining = (b.remaining_units === null || b.remaining_units === undefined) ? ''
    : ' (' + t('cost.remaining').replace('{n}', b.remaining_units) + ')';
  var providerShort = String(c.provider || '').split('@')[0];
  return listRow({
    name: escapeHtml(c.capability || ''),
    detail: escapeHtml(t('cost.providerCol')) + ': ' + escapeHtml(providerShort),
    value: stateChip(c.state),
    body: columns({ layout: 'thirds', density: 'compact', collapse: 560 },
      stack({ density: 'compact' }, text({ kind: 'label' }, t('cost.priceCol')) + text({ kind: 'body' }, escapeHtml(String(c.price_per_call)) + ' morsels')) +
      stack({ density: 'compact' }, text({ kind: 'label' }, t('cost.rakeCol')) + text({ kind: 'body' }, escapeHtml(String(c.rake_per_call)) + ' morsels (' + escapeHtml(String(c.rake_percent)) + '%)')) +
      stack({ density: 'compact' }, text({ kind: 'label' }, t('cost.budgetCol')) + text({ kind: 'body' }, escapeHtml(cap) + escapeHtml(remaining)))),
  });
}

/**
 * The whole section — detail.js draws the slot (<div id="detail-cost" data-dtl-section>) and this
 * fills it, at the first render and again in place after the load.
 */
export function costSectionInner() {
  if (cState === 'off') return '';
  var body;
  if (cState === 'loading') {
    body = text({ kind: 'caption', tone: 'muted' }, '…');
  } else if (cState === 'error') {
    var msg = (cData && cData._needLogin) ? t('cost.needLogin') : t('cost.loadFailed');
    body = text({ kind: 'caption', tone: 'danger' }, escapeHtml(msg));
  } else {
    var contracts = (cData && cData.contracts) || [];
    if (!contracts.length) {
      body = text({ kind: 'caption', tone: 'muted' }, t('cost.empty'));
    } else {
      var m = (cData.totals && cData.totals.morsels) || { spent_units: 0, calls: 0 };
      body = text({ kind: 'body', tone: 'success' },
        t('cost.summary').replace('{n}', cData.total_contracts).replace('{spent}', m.spent_units).replace('{calls}', m.calls));
      for (var i = 0; i < contracts.length; i++) body += contractRow(contracts[i]);
    }
  }
  return section({ title: t('cost.title'), description: t('cost.hint'), body: body });
}
