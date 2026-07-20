/**
 * @file monetize.js
 * @description The Monetize section of the App Detail view (TARGET-034 phase B): the app owner's
 *   tool editor for the `apps.{appId}.tools` manifest — declare agent-callable tools with a morsel
 *   and/or micro-unit money price, an optional capability binding (action_id → synchronous 'call'
 *   fulfillment) or an agent name (TASK fulfillment), and publish the manifest as a PUBLIC memory
 *   record under the owner's GHII (POST /v1/memory). Purchases then flow through the commerce
 *   checkout core; priced tools list in /v1/commerce/feed. Rendering follows the detail-view
 *   pattern: detail.js renders the section shell for OWN published apps and calls monetizeOnOpen;
 *   this module re-renders #detail-monetize in place after loads/saves.
 * @usage import { monetizeSectionInner, monetizeOnOpen, monetizeAddTool, ... } from './monetize.js'
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial Monetize tool editor (TARGET-034 phase B)
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';

// Tool names become sku segments (app-tool:<owner>/<appId>:<name>) — same rule the node schema
// (src/models/app-tool-schemas.ts) enforces at resolve time.
var NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
var MONEY_UNIT = 1000000; // 6-decimal micro-units, the node-wide money convention

var mzOwner = '';        // app owner (bare name) — the signed-in user for own apps
var mzAppId = '';        // published filename = the appId of the manifest key
var mzDoc = null;        // { version?, updatedAt?, tools: [] } or null while loading / on error
var mzState = 'off';     // 'off' | 'loading' | 'ready' | 'error'
var mzEditing = -1;      // -1 closed · -2 new tool · >=0 editing tools[i]
var mzBusy = false;      // guards Save/Delete while a write is in flight

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function toolsKey() { return 'apps.' + mzAppId + '.tools'; }

function rerender() {
  var el = document.getElementById('detail-monetize');
  if (el) el.innerHTML = monetizeSectionInner();
}

/** Reset + async-load the manifest when a detail view opens. No-op for non-own apps. */
export function monetizeOnOpen(owner, appId, isOwn) {
  mzEditing = -1; mzBusy = false; mzDoc = null;
  if (!isOwn || !owner || !appId) { mzState = 'off'; mzOwner = ''; mzAppId = ''; return; }
  mzOwner = owner; mzAppId = appId; mzState = 'loading';
  var token = getCortexOwnerToken();
  fetch(apiBase() + '/v1/memory/' + encodeURIComponent(toolsKey()), {
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var value = res && res.ok && res.data && (res.data.value || (res.data.record && res.data.record.value));
      mzDoc = (value && Array.isArray(value.tools)) ? value : { tools: [] };
      mzState = 'ready';
      rerender();
    })
    .catch(function () {
      // A missing record is a normal "no tools yet" state; only a hard fetch error lands here.
      mzDoc = { tools: [] };
      mzState = 'ready';
      rerender();
    });
}

function priceLabel(tool) {
  var parts = [];
  if (tool.price && tool.price.morsels > 0) parts.push(tool.price.morsels + ' morsels');
  if (tool.priceMoney && tool.priceMoney.amount > 0) {
    parts.push((tool.priceMoney.amount / MONEY_UNIT) + ' ' + tool.priceMoney.currency);
  }
  return parts.length ? parts.join(' · ') : t('monetize.notForSale');
}

function toolRow(tool, i) {
  var mode = tool.action_id ? t('monetize.fulfillCall') : t('monetize.fulfillTask');
  var binding = tool.action_id
    ? escapeHtml(tool.action_id)
    : (tool.agent ? ('→ ' + escapeHtml(tool.agent)) : t('monetize.taskToOwner'));
  return '<div class="dtl-status-row" style="align-items:center;gap:10px;flex-wrap:wrap">' +
      '<div class="dtl-stat" style="flex:1;min-width:160px">' +
        '<span class="dtl-stat-val">' + escapeHtml(tool.name) + '</span>' +
        (tool.description ? '<span class="dtl-stat-label">' + escapeHtml(tool.description) + '</span>' : '') +
      '</div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + t('monetize.priceCol') + '</span><span class="dtl-stat-val">' + escapeHtml(priceLabel(tool)) + '</span></div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + mode + '</span><span class="dtl-stat-val" style="font-size:.8rem">' + binding + '</span></div>' +
      '<div class="dtl-btn-row" style="margin:0">' +
        dtlBtn(t('detail.editDetails'), 'window._launcher.monetizeEditTool(' + i + ')') +
        dtlBtn('✕', 'window._launcher.monetizeDeleteTool(' + i + ')', { variant: 'danger', title: t('monetize.deleteHint') }) +
      '</div>' +
    '</div>';
}

function editorHtml(tool) {
  var moneyMajor = (tool.priceMoney && tool.priceMoney.amount > 0) ? String(tool.priceMoney.amount / MONEY_UNIT) : '';
  var cur = (tool.priceMoney && tool.priceMoney.currency) || 'EUR';
  return '<div class="dtl-ac-editor" style="margin-top:10px">' +
      '<label class="dtl-stat-label" for="mz-name">' + t('monetize.name') + '</label>' +
      '<input id="mz-name" class="modal-input" maxlength="80" value="' + escapeHtml(tool.name || '') + '" placeholder="summarize" style="margin:4px 0 8px" />' +
      '<label class="dtl-stat-label" for="mz-desc">' + t('monetize.desc') + '</label>' +
      '<input id="mz-desc" class="modal-input" maxlength="500" value="' + escapeHtml(tool.description || '') + '" style="margin:4px 0 8px" />' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:130px">' +
          '<label class="dtl-stat-label" for="mz-morsels">' + t('monetize.priceMorsels') + '</label>' +
          '<input id="mz-morsels" class="modal-input" type="number" min="0" step="1" value="' + ((tool.price && tool.price.morsels) || '') + '" placeholder="0" style="margin:4px 0 8px" />' +
        '</div>' +
        '<div style="flex:1;min-width:130px">' +
          '<label class="dtl-stat-label" for="mz-money">' + t('monetize.priceMoney') + '</label>' +
          '<input id="mz-money" class="modal-input" inputmode="decimal" value="' + escapeHtml(moneyMajor) + '" placeholder="0.002" style="margin:4px 0 8px" />' +
        '</div>' +
        '<div style="min-width:90px">' +
          '<label class="dtl-stat-label" for="mz-currency">' + t('monetize.currency') + '</label>' +
          '<select id="mz-currency" class="modal-input" style="margin:4px 0 8px">' +
            '<option value="EUR"' + (cur === 'EUR' ? ' selected' : '') + '>EUR</option>' +
            '<option value="USD"' + (cur === 'USD' ? ' selected' : '') + '>USD</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<label class="dtl-stat-label" for="mz-action">' + t('monetize.actionId') + '</label>' +
      '<input id="mz-action" class="modal-input" maxlength="200" value="' + escapeHtml(tool.action_id || '') + '" placeholder="ext:my-extension:summarize" style="margin:4px 0 4px" />' +
      '<div class="dtl-sync none" style="margin:0 0 8px">' + t('monetize.actionIdHint') + '</div>' +
      '<label class="dtl-stat-label" for="mz-agent">' + t('monetize.agent') + '</label>' +
      '<input id="mz-agent" class="modal-input" maxlength="100" value="' + escapeHtml(tool.agent || '') + '" placeholder="assistant" style="margin:4px 0 4px" />' +
      '<div class="dtl-sync none" style="margin:0 0 10px">' + t('monetize.agentHint') + '</div>' +
      '<div class="dtl-btn-row">' +
        dtlBtn(t('detail.saveDetails'), 'window._launcher.monetizeSaveTool()', { variant: 'primary', disabled: mzBusy }) +
        dtlBtn(t('detail.cancelEdit'), 'window._launcher.monetizeCancelEdit()') +
      '</div>' +
      '<div class="dtl-ai-status" id="mz-status"></div>' +
    '</div>';
}

/** Inner HTML of the Monetize section — detail.js wraps it in <div class="dtl-section" id="detail-monetize">. */
export function monetizeSectionInner() {
  if (mzState === 'off') return '';
  var html = '<h3>' + t('monetize.title') + '</h3>' +
    '<p class="dtl-desc">' + t('monetize.hint') + '</p>';
  if (mzState === 'loading') {
    return html + '<span style="color:var(--text-muted);font-size:.85rem">…</span>';
  }
  var tools = (mzDoc && mzDoc.tools) || [];
  if (!tools.length && mzEditing === -1) {
    html += '<span class="dtl-sync none">' + t('monetize.empty') + '</span>';
  } else {
    for (var i = 0; i < tools.length; i++) {
      html += (mzEditing === i) ? editorHtml(tools[i]) : toolRow(tools[i], i);
    }
  }
  if (mzEditing === -2) {
    html += editorHtml({});
  } else if (mzEditing === -1) {
    html += '<div class="dtl-btn-row" style="margin-top:10px">' +
      dtlBtn(t('monetize.addTool'), 'window._launcher.monetizeAddTool()', { variant: 'primary' }) +
    '</div>';
  }
  return html;
}

export function monetizeAddTool() { mzEditing = -2; rerender(); }
export function monetizeEditTool(i) { mzEditing = i; rerender(); }
export function monetizeCancelEdit() { mzEditing = -1; rerender(); }

/** Read the editor fields into a manifest tool entry; null (+ notice) when invalid. */
function readEditor() {
  var name = (document.getElementById('mz-name').value || '').trim();
  if (!NAME_RE.test(name)) { showNotice(t('monetize.nameInvalid'), 'error'); return null; }
  var tool = { name: name };
  var desc = (document.getElementById('mz-desc').value || '').trim();
  if (desc) tool.description = desc;
  var morsels = parseInt(document.getElementById('mz-morsels').value, 10);
  if (Number.isFinite(morsels) && morsels > 0) tool.price = { morsels: morsels, unit: 'per-call' };
  var moneyRaw = (document.getElementById('mz-money').value || '').trim();
  if (moneyRaw) {
    var major = parseFloat(moneyRaw.replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) { showNotice(t('monetize.moneyInvalid'), 'error'); return null; }
    tool.priceMoney = { amount: Math.round(major * MONEY_UNIT), currency: document.getElementById('mz-currency').value };
  }
  var actionId = (document.getElementById('mz-action').value || '').trim();
  if (actionId) tool.action_id = actionId;
  var agent = (document.getElementById('mz-agent').value || '').trim();
  if (agent) tool.agent = agent;
  return tool;
}

/** Persist the whole manifest as the PUBLIC apps.{appId}.tools record under the owner GHII. */
function writeManifest(doc) {
  var token = getCortexOwnerToken();
  if (!token) return Promise.reject(new Error(t('monetize.needLogin')));
  doc.version = (doc.version || 0) + 1;
  doc.updatedAt = new Date().toISOString();
  return fetch(apiBase() + '/v1/memory', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: toolsKey(), value: doc, visibility: 'public' }),
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) throw new Error((res.error && res.error.message) || 'write failed');
    return res;
  });
}

export function monetizeSaveTool() {
  if (mzBusy || !mzDoc) return;
  var tool = readEditor();
  if (!tool) return;
  var tools = mzDoc.tools.slice();
  var dup = tools.findIndex(function (x, i) { return x.name === tool.name && i !== mzEditing; });
  if (dup !== -1) { showNotice(t('monetize.nameTaken'), 'error'); return; }
  if (mzEditing >= 0) tools[mzEditing] = tool; else tools.push(tool);
  mzBusy = true;
  var el = document.getElementById('mz-status');
  if (el) el.textContent = '…';
  var next = { version: mzDoc.version, updatedAt: mzDoc.updatedAt, tools: tools };
  writeManifest(next)
    .then(function () {
      mzDoc = next; mzEditing = -1; mzBusy = false;
      rerender();
      showNotice(t('monetize.saved'), 'success');
    })
    .catch(function (e) {
      mzBusy = false;
      var st = document.getElementById('mz-status');
      if (st) st.textContent = t('monetize.saveFailed') + ': ' + e.message;
      showNotice(t('monetize.saveFailed') + ': ' + e.message, 'error');
    });
}

export async function monetizeDeleteTool(i) {
  if (mzBusy || !mzDoc || !mzDoc.tools[i]) return;
  if (!(await showConfirm(t('monetize.confirmDelete').replace('{name}', mzDoc.tools[i].name)))) return;
  var tools = mzDoc.tools.slice();
  tools.splice(i, 1);
  mzBusy = true;
  var next = { version: mzDoc.version, updatedAt: mzDoc.updatedAt, tools: tools };
  writeManifest(next)
    .then(function () {
      mzDoc = next; mzEditing = -1; mzBusy = false;
      rerender();
      showNotice(t('monetize.saved'), 'success');
    })
    .catch(function (e) {
      mzBusy = false;
      showNotice(t('monetize.saveFailed') + ': ' + e.message, 'error');
    });
}
