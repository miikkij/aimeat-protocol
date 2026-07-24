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
 *   v1.2.0 — 2026-07-25 — TARGET-050: the manifest is the SOURCE OF TRUTH for the EXCHANGE listing —
 *     a "List in EXCHANGE" toggle and a second money price (EUR *and* USD) live here, and the node
 *     projects the marketplace listing from this record on every write. No second listing step.
 *   v1.1.0 — 2026-07-25 — TARGET-050 slice 0: readEditor merges over the edited tool instead of rebuilding
 *     it, so inputSchema/outputSchema/plans survive a price edit (they were silently dropped on every save).
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
var CURRENCIES = ['EUR', 'USD']; // mirrors MONEY_CURRENCIES in src/commerce/money.ts

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
  var seen = {};
  if (tool.price && tool.price.morsels > 0) parts.push(tool.price.morsels + ' morsels');
  var money = [tool.priceMoney].concat(tool.pricesMoney || []);
  for (var i = 0; i < money.length; i++) {
    var m = money[i];
    if (!m || !(m.amount > 0) || seen[m.currency]) continue;
    seen[m.currency] = true;
    parts.push((m.amount / MONEY_UNIT) + ' ' + m.currency);
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
      '<div class="dtl-stat"><span class="dtl-stat-label">' + t('monetize.priceCol') + '</span><span class="dtl-stat-val">' + escapeHtml(priceLabel(tool)) +
        (tool.exchange ? ' <span class="dtl-sync ok" style="display:inline">' + t('monetize.exchangeOn') + '</span>' : '') + '</span></div>' +
      '<div class="dtl-stat"><span class="dtl-stat-label">' + mode + '</span><span class="dtl-stat-val" style="font-size:.8rem">' + binding + '</span></div>' +
      '<div class="dtl-btn-row" style="margin:0">' +
        dtlBtn(t('detail.editDetails'), 'window._launcher.monetizeEditTool(' + i + ')') +
        dtlBtn('✕', 'window._launcher.monetizeDeleteTool(' + i + ')', { variant: 'danger', title: t('monetize.deleteHint') }) +
      '</div>' +
    '</div>';
}

/** A currency picker over the node's supported money currencies. */
function currencySelect(id, selected) {
  var html = '<select id="' + id + '" class="modal-input" style="margin:4px 0 8px">';
  for (var i = 0; i < CURRENCIES.length; i++) {
    html += '<option value="' + CURRENCIES[i] + '"' + (selected === CURRENCIES[i] ? ' selected' : '') + '>' + CURRENCIES[i] + '</option>';
  }
  return html + '</select>';
}

function editorHtml(tool) {
  var moneyMajor = (tool.priceMoney && tool.priceMoney.amount > 0) ? String(tool.priceMoney.amount / MONEY_UNIT) : '';
  var cur = (tool.priceMoney && tool.priceMoney.currency) || 'EUR';
  // The second money price is any declared currency that is not the primary one.
  var second = (tool.pricesMoney || []).filter(function (p) { return p && p.currency !== cur && p.amount > 0; })[0];
  var money2Major = second ? String(second.amount / MONEY_UNIT) : '';
  var cur2 = (second && second.currency) || (cur === 'EUR' ? 'USD' : 'EUR');
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
          currencySelect('mz-currency', cur) +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:130px">' +
          '<label class="dtl-stat-label" for="mz-money2">' + t('monetize.money2') + '</label>' +
          '<input id="mz-money2" class="modal-input" inputmode="decimal" value="' + escapeHtml(money2Major) + '" placeholder="0.002" style="margin:4px 0 4px" />' +
        '</div>' +
        '<div style="min-width:90px">' +
          '<label class="dtl-stat-label" for="mz-currency2">' + t('monetize.currency2') + '</label>' +
          currencySelect('mz-currency2', cur2) +
        '</div>' +
      '</div>' +
      '<div class="dtl-sync none" style="margin:0 0 8px">' + t('monetize.money2Hint') + '</div>' +
      '<label class="dtl-stat-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input id="mz-exchange" type="checkbox"' + (tool.exchange ? ' checked' : '') + ' />' +
        t('monetize.exchange') +
      '</label>' +
      '<div class="dtl-sync none" style="margin:4px 0 8px">' + t('monetize.exchangeHint') + '</div>' +
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

/**
 * Read the editor fields into a manifest tool entry, MERGED OVER the tool being edited so that fields
 * this editor does not surface survive the save — `inputSchema`/`outputSchema` (mandatory for an EXCHANGE
 * listing), `plans`, `exchange`, and anything added later. Building the entry from scratch silently
 * destroyed those on every price edit (TARGET-050 slice 0). Clearing a field the editor DOES own removes
 * it, so "delete the money price" still works. Returns null (+ notice) when invalid.
 */
function readEditor(base) {
  var name = (document.getElementById('mz-name').value || '').trim();
  if (!NAME_RE.test(name)) { showNotice(t('monetize.nameInvalid'), 'error'); return null; }
  var tool = Object.assign({}, base || {});
  tool.name = name;
  var desc = (document.getElementById('mz-desc').value || '').trim();
  if (desc) tool.description = desc; else delete tool.description;
  var morsels = parseInt(document.getElementById('mz-morsels').value, 10);
  if (Number.isFinite(morsels) && morsels > 0) tool.price = { morsels: morsels, unit: 'per-call' };
  else delete tool.price;
  var moneyRaw = (document.getElementById('mz-money').value || '').trim();
  if (moneyRaw) {
    var major = parseFloat(moneyRaw.replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) { showNotice(t('monetize.moneyInvalid'), 'error'); return null; }
    tool.priceMoney = { amount: Math.round(major * MONEY_UNIT), currency: document.getElementById('mz-currency').value };
  } else delete tool.priceMoney;
  // Second money price (TARGET-050): the same call sold in another currency. `pricesMoney` carries the
  // full set the EXCHANGE projection lists from; `priceMoney` stays the primary for every other reader.
  var money2Raw = (document.getElementById('mz-money2').value || '').trim();
  var cur2 = document.getElementById('mz-currency2').value;
  var money2 = null;
  if (money2Raw) {
    var major2 = parseFloat(money2Raw.replace(',', '.'));
    if (!Number.isFinite(major2) || major2 <= 0) { showNotice(t('monetize.moneyInvalid'), 'error'); return null; }
    money2 = { amount: Math.round(major2 * MONEY_UNIT), currency: cur2 };
  }
  var moneySet = [];
  if (tool.priceMoney) moneySet.push(tool.priceMoney);
  if (money2 && (!tool.priceMoney || tool.priceMoney.currency !== money2.currency)) moneySet.push(money2);
  if (moneySet.length > 1) tool.pricesMoney = moneySet; else delete tool.pricesMoney;
  // The EXCHANGE listing exists because this flag says so; turning it off removes the listing (never a contract).
  var ex = document.getElementById('mz-exchange');
  if (ex && ex.checked) tool.exchange = true; else delete tool.exchange;
  var actionId = (document.getElementById('mz-action').value || '').trim();
  if (actionId) tool.action_id = actionId; else delete tool.action_id;
  var agent = (document.getElementById('mz-agent').value || '').trim();
  if (agent) tool.agent = agent; else delete tool.agent;
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
  var tool = readEditor(mzEditing >= 0 ? mzDoc.tools[mzEditing] : null);
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
