/**
 * @file odps.js
 * @description The ODPS surface of the App Detail view: the app-level EXCHANGE status + ODPS defaults,
 *   and the per-tool ODPS descriptor block inside the Monetize editor. A listed tool is projected into an
 *   Open Data Product Specification v4.1 document (GET /v1/exchange/offerings/{id}/odps.yaml) — the
 *   interoperable descriptor outside catalogues and negotiating agents read. Most of that document the
 *   node derives (price, plans, access, licence rights, observed use); what it CANNOT derive is authored
 *   here and stored in the app's own tool manifest (`apps.{appId}.tools`), so the app owns its ODPS data.
 *
 *   App level = what is the same for every capability the app sells (legal data holder, logo, brand,
 *   governance profile, jurisdiction, the provenance of the app's material). Tool level = what belongs to
 *   one capability (value proposition, categories, use cases, sample, SLA + quality commitments). A tool
 *   inherits the app defaults and overrides them field by field.
 *
 *   AI drafts the DESCRIPTIVE fields only. Provenance, legal basis, consent status, retention, the legal
 *   entity and SLA objectives are promises with legal weight (EU AI Act Art. 10 makes provenance the
 *   buyer's compliance duty) — the model is told to leave them alone and the owner states them.
 * @structure odpsStatusInner (app-level status + defaults form) · odpsBlockedReason · odpsToolFieldsHtml ·
 *   readOdpsToolFields · readOdpsAppDefaults · odpsSuggestForTool · odpsToggleDefaults · odpsToggleTool
 * @usage import { odpsStatusInner, odpsToolFieldsHtml, readOdpsToolFields } from './odps.js'
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial ODPS authoring surface (app-level defaults + per-tool block + AI draft).
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';

/** Mirrors ODPS_PRODUCT_TYPES / ODPS_SLA_* / ODPS_QUALITY_* in src/models/odps-schemas.ts. */
var PRODUCT_TYPES = ['', 'raw data', 'derived data', 'dataset', 'reports', 'analytic view', 'algorithm',
  'decision support', 'automated decision-making', 'data-enhanced product', 'data-driven service',
  'data-enabled performance', 'bi-directional'];
var GOVERNANCE = ['', 'structured', 'enforced', 'automated', 'audit_ready'];
var PRIORITIES = ['', 'critical', 'high', 'medium', 'low'];
var SLA_DIMENSIONS = ['latency', 'uptime', 'responseTime', 'errorRate', 'endOfSupport', 'endOfLife',
  'updateFrequency', 'timeToDetect', 'timeToNotify', 'timeToRepair', 'emailResponseTime'];
var SLA_UNITS = ['percent', 'milliseconds', 'seconds', 'minutes', 'days', 'weeks', 'months', 'years', 'never', 'date'];
var QUALITY_DIMENSIONS = ['accuracy', 'completeness', 'conformity', 'consistency', 'coverage', 'timeliness', 'validity', 'uniqueness'];
var QUALITY_UNITS = ['percentage', 'number'];

var odDefaultsOpen = false;   // app-level ODPS defaults form expanded?
var odToolOpen = false;       // per-tool ODPS block expanded inside the editor?
var odBusy = false;           // an AI draft is in flight

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function val(id) {
  var el = document.getElementById(id);
  return el ? (el.value || '').trim() : '';
}

function setVal(id, v) {
  var el = document.getElementById(id);
  if (el && v !== undefined && v !== null) el.value = String(v);
}

/** Comma-separated input ⇄ array of trimmed non-empty strings. */
function listOf(id) {
  return val(id).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function input(id, label, value, placeholder, type) {
  return '<label class="dtl-stat-label" for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<input id="' + id + '" class="modal-input od-input" ' + (type ? 'type="' + type + '" ' : '') +
    'value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" />';
}

function textarea(id, label, value, placeholder, rows) {
  return '<label class="dtl-stat-label" for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<textarea id="' + id + '" class="modal-input od-input" rows="' + (rows || 2) + '" placeholder="' +
    escapeHtml(placeholder || '') + '">' + escapeHtml(value || '') + '</textarea>';
}

function select(id, label, options, selected) {
  var html = '<label class="dtl-stat-label" for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<select id="' + id + '" class="modal-input od-input">';
  for (var i = 0; i < options.length; i++) {
    var o = options[i];
    html += '<option value="' + escapeHtml(o) + '"' + (selected === o ? ' selected' : '') + '>' +
      escapeHtml(o || '—') + '</option>';
  }
  return html + '</select>';
}

// ── Commitment lines: "uptime 99.5 percent — Monthly availability" ─────────────
/** Render SLA/quality dimensions as one editable line each (compact, and an AI can write it). */
function dimsToText(dims) {
  return (dims || []).map(function (d) {
    return d.dimension + ' ' + d.objective + ' ' + d.unit + (d.description ? ' — ' + d.description : '');
  }).join('\n');
}

/** Parse those lines back. Unknown dimensions/units are dropped rather than saved as garbage. */
function textToDims(text, dimensions, units) {
  var out = [];
  var lines = (text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var parts = line.split('—');
    var head = parts[0].trim().split(/\s+/);
    var desc = parts.length > 1 ? parts.slice(1).join('—').trim() : '';
    if (head.length < 3) continue;
    var dim = head[0], objective = parseFloat(String(head[1]).replace(',', '.')), unit = head[2];
    if (dimensions.indexOf(dim) === -1 || units.indexOf(unit) === -1 || !Number.isFinite(objective)) continue;
    var entry = { dimension: dim, objective: objective, unit: unit };
    if (desc) entry.description = desc;
    out.push(entry);
  }
  return out;
}

// ── App-level: EXCHANGE status + ODPS defaults ────────────────────────────────

/**
 * Why a tool flagged for EXCHANGE does not reach the market. The node's reconcile skips it silently
 * (SCHEMA_REQUIRED / TOOL_UNBOUND / NOT_PRICED); before this, the catalogue never said so and the owner
 * was left ticking a box that did nothing.
 */
export function odpsBlockedReason(tool) {
  if (!tool || !tool.exchange) return '';
  var hasIn = tool.inputSchema && Object.keys(tool.inputSchema).length;
  var hasOut = tool.outputSchema && Object.keys(tool.outputSchema).length;
  if (!hasIn || !hasOut) return t('odps.blockedSchema');
  if (!tool.action_id) return t('odps.blockedBinding');
  var priced = (tool.price && tool.price.morsels > 0) || (tool.priceMoney && tool.priceMoney.amount > 0);
  if (!priced) return t('odps.blockedPrice');
  return '';
}

/** The app-level EXCHANGE line: how many of this app's tools are actually on the market, and what blocks the rest. */
function statusLine(doc) {
  var tools = (doc && doc.tools) || [];
  var flagged = tools.filter(function (x) { return x.exchange; });
  var blocked = flagged.filter(function (x) { return !!odpsBlockedReason(x); });
  var live = flagged.length - blocked.length;
  if (!tools.length) {
    return '<div class="od-status od-status-none">' + escapeHtml(t('odps.noTools')) + '</div>';
  }
  var cls = live > 0 ? 'od-status-on' : 'od-status-none';
  var label = live > 0
    ? t('odps.statusOn').replace('{live}', String(live)).replace('{total}', String(tools.length))
    : t('odps.statusOff').replace('{total}', String(tools.length));
  var html = '<div class="od-status ' + cls + '">' + escapeHtml(label) + '</div>';
  if (blocked.length) {
    html += '<div class="dtl-sync none od-note">' +
      escapeHtml(t('odps.statusBlocked').replace('{n}', String(blocked.length))) + '</div>';
  }
  return html;
}

/** The app-level ODPS defaults form (company + brand + governance + provenance), collapsed by default. */
function defaultsForm(doc) {
  var o = (doc && doc.odps) || {};
  var h = (o.dataHolder) || {};
  var lic = (o.license) || {};
  var p = (doc && doc.provenance) || {};
  return '<div class="od-form">' +
    '<div class="dtl-sync none od-note">' + escapeHtml(t('odps.defaultsHint')) + '</div>' +
    '<div class="od-grid">' +
      '<div class="od-col">' + input('od-legalname', t('odps.legalName'), h.legalName, 'Overscale Solutions Oy') + '</div>' +
      '<div class="od-col">' + input('od-businessid', t('odps.businessId'), h.businessID, '3312345-6') + '</div>' +
    '</div>' +
    '<div class="od-grid">' +
      '<div class="od-col">' + input('od-holderemail', t('odps.holderEmail'), h.email, 'sales@example.org', 'email') + '</div>' +
      '<div class="od-col">' + input('od-holderurl', t('odps.holderUrl'), h.URL, 'https://example.org', 'url') + '</div>' +
      '<div class="od-col od-col-narrow">' + input('od-country', t('odps.country'), h.addressCountry, 'FI') + '</div>' +
    '</div>' +
    '<div class="od-grid">' +
      '<div class="od-col">' + input('od-logo', t('odps.logoUrl'), o.logoURL, 'https://example.org/logo.png', 'url') + '</div>' +
      '<div class="od-col">' + input('od-slogan', t('odps.brandSlogan'), o.brandSlogan, '') + '</div>' +
    '</div>' +
    '<div class="od-grid">' +
      '<div class="od-col">' + select('od-governance', t('odps.governance'), GOVERNANCE, o.governanceProfile || '') + '</div>' +
      '<div class="od-col">' + select('od-priority', t('odps.priority'), PRIORITIES, o.portfolioPriority || '') + '</div>' +
      '<div class="od-col od-col-narrow">' + input('od-language', t('odps.language'), o.language || 'en', 'en') + '</div>' +
    '</div>' +
    '<div class="od-grid">' +
      '<div class="od-col">' + input('od-geo', t('odps.geoArea'), (lic.geographicalArea || []).join(', '), 'EU, EEA') + '</div>' +
      '<div class="od-col">' + input('od-laws', t('odps.applicableLaws'), lic.applicableLaws, 'Finnish law') + '</div>' +
    '</div>' +
    '<div class="od-attest">' +
      '<div class="dtl-stat-label od-attest-head">' + escapeHtml(t('odps.attestation')) + '</div>' +
      '<div class="dtl-sync none od-note">' + escapeHtml(t('odps.attestationHint')) + '</div>' +
      '<div class="od-grid">' +
        '<div class="od-col">' + input('od-source', t('odps.source'), p.source, 'PRH open company register (YTJ v3)') + '</div>' +
        '<div class="od-col">' + input('od-legalbasis', t('odps.legalBasis'), p.legalBasis, 'Public register') + '</div>' +
      '</div>' +
      '<div class="od-grid">' +
        '<div class="od-col">' + input('od-consent', t('odps.consentStatus'), p.consentStatus, 'not applicable') + '</div>' +
        '<div class="od-col">' + input('od-retention', t('odps.retention'), p.retention, '30 days') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="dtl-btn-row od-actions">' +
      dtlBtn(t('odps.saveDefaults'), 'window._launcher.odpsSaveDefaults()', { variant: 'primary' }) +
      dtlBtn(t('odps.close'), 'window._launcher.odpsToggleDefaults()') +
    '</div>' +
    '<div class="dtl-ai-status" id="od-status"></div>' +
  '</div>';
}

/** Section body: the app-level EXCHANGE status plus the (collapsible) ODPS defaults. */
export function odpsStatusInner(doc, state) {
  if (state === 'off') return '';
  var html = '<h3>' + escapeHtml(t('odps.title')) + '</h3>' +
    '<p class="dtl-desc">' + escapeHtml(t('odps.hint')) + '</p>';
  if (state === 'loading') return html + '<span class="od-muted">…</span>';
  html += statusLine(doc);
  html += '<div class="dtl-btn-row od-actions">' +
    dtlBtn(odDefaultsOpen ? t('odps.close') : t('odps.editDefaults'), 'window._launcher.odpsToggleDefaults()') +
  '</div>';
  if (odDefaultsOpen) html += defaultsForm(doc);
  return html;
}

/** Read the app-level defaults form into { odps, provenance } (empty objects become undefined). */
export function readOdpsAppDefaults() {
  var holder = {};
  if (val('od-legalname')) holder.legalName = val('od-legalname');
  if (val('od-businessid')) holder.businessID = val('od-businessid');
  if (val('od-holderemail')) holder.email = val('od-holderemail');
  if (val('od-holderurl')) holder.URL = val('od-holderurl');
  if (val('od-country')) holder.addressCountry = val('od-country');
  var license = {};
  if (listOf('od-geo').length) license.geographicalArea = listOf('od-geo');
  if (val('od-laws')) license.applicableLaws = val('od-laws');
  var odps = {};
  if (holder.legalName) odps.dataHolder = holder;       // legalName is ODPS-required inside dataHolder
  if (Object.keys(license).length) odps.license = license;
  if (val('od-logo')) odps.logoURL = val('od-logo');
  if (val('od-slogan')) odps.brandSlogan = val('od-slogan');
  if (val('od-governance')) odps.governanceProfile = val('od-governance');
  if (val('od-priority')) odps.portfolioPriority = val('od-priority');
  if (/^[a-z]{2}$/.test(val('od-language'))) odps.language = val('od-language');
  var prov = {};
  if (val('od-source')) prov.source = val('od-source');
  if (val('od-legalbasis')) prov.legalBasis = val('od-legalbasis');
  if (val('od-consent')) prov.consentStatus = val('od-consent');
  if (val('od-retention')) prov.retention = val('od-retention');
  return {
    odps: Object.keys(odps).length ? odps : undefined,
    provenance: Object.keys(prov).length ? prov : undefined,
  };
}

// ── Tool level: the ODPS descriptor of one capability ─────────────────────────

/** The per-tool ODPS block rendered inside the Monetize tool editor. */
export function odpsToolFieldsHtml(tool, offeringId) {
  var o = (tool && tool.odps) || {};
  var p = (tool && tool.provenance) || {};
  var head = '<div class="od-tool-head">' +
    dtlBtn((odToolOpen ? '▾ ' : '▸ ') + t('odps.toolTitle'), 'window._launcher.odpsToggleTool()') +
    (offeringId
      ? '<a class="od-link" href="' + apiBase() + '/v1/exchange/offerings/' + encodeURIComponent(offeringId) +
        '/odps.yaml" target="_blank" rel="noopener">' + escapeHtml(t('odps.viewYaml')) + '</a>'
      : '') +
  '</div>';
  if (!odToolOpen) return head;
  return head + '<div class="od-form">' +
    '<div class="dtl-sync none od-note">' + escapeHtml(t('odps.toolHint')) + '</div>' +
    '<div class="dtl-btn-row od-actions">' +
      dtlBtn(t('odps.suggest'), 'window._launcher.odpsSuggest()', { variant: 'primary', disabled: odBusy }) +
    '</div>' +
    '<div class="dtl-ai-status" id="od-tool-status"></div>' +
    select('odt-type', t('odps.productType'), PRODUCT_TYPES, o.productType || '') +
    textarea('odt-value', t('odps.valueProposition'), o.valueProposition, t('odps.valuePlaceholder'), 2) +
    '<div class="od-grid">' +
      '<div class="od-col">' + input('odt-categories', t('odps.categories'), (o.categories || []).join(', '), 'company data, finland') + '</div>' +
      '<div class="od-col">' + input('odt-standards', t('odps.standards'), (o.standards || []).join(', '), 'ISO 8000') + '</div>' +
    '</div>' +
    textarea('odt-usecases', t('odps.useCases'), (o.useCases || []).map(function (u) {
      return u.title + (u.description ? ' | ' + u.description : '') + (u.url ? ' | ' + u.url : '');
    }).join('\n'), t('odps.useCasesPlaceholder'), 2) +
    input('odt-sample', t('odps.contentSample'), o.contentSample, 'https://example.org/sample.json', 'url') +
    textarea('odt-sla', t('odps.sla'), dimsToText(o.sla), t('odps.slaPlaceholder'), 2) +
    textarea('odt-quality', t('odps.quality'), dimsToText(o.dataQuality), t('odps.qualityPlaceholder'), 2) +
    '<div class="od-attest">' +
      '<div class="dtl-stat-label od-attest-head">' + escapeHtml(t('odps.toolAttestation')) + '</div>' +
      '<div class="dtl-sync none od-note">' + escapeHtml(t('odps.toolAttestationHint')) + '</div>' +
      input('odt-source', t('odps.source'), p.source, t('odps.inherited')) +
      textarea('odt-transformations', t('odps.transformations'), p.transformations, t('odps.transformationsPlaceholder'), 2) +
    '</div>' +
  '</div>';
}

/** Read the tool ODPS block, MERGED over the tool being edited so unsurfaced fields survive a save. */
export function readOdpsToolFields(base) {
  if (!odToolOpen) {
    // Block never opened in this edit → keep whatever the tool already had, untouched.
    return { odps: base && base.odps, provenance: base && base.provenance };
  }
  var odps = Object.assign({}, (base && base.odps) || {});
  var prov = Object.assign({}, (base && base.provenance) || {});
  var set = function (obj, key, v) { if (v) obj[key] = v; else delete obj[key]; };
  set(odps, 'productType', val('odt-type'));
  set(odps, 'valueProposition', val('odt-value'));
  var cats = listOf('odt-categories'); if (cats.length) odps.categories = cats; else delete odps.categories;
  var stds = listOf('odt-standards'); if (stds.length) odps.standards = stds; else delete odps.standards;
  var uc = val('odt-usecases').split('\n').map(function (line) {
    var parts = line.split('|').map(function (x) { return x.trim(); });
    if (!parts[0]) return null;
    var entry = { title: parts[0] };
    if (parts[1]) entry.description = parts[1];
    if (parts[2]) entry.url = parts[2];
    return entry;
  }).filter(Boolean);
  if (uc.length) odps.useCases = uc; else delete odps.useCases;
  set(odps, 'contentSample', val('odt-sample'));
  var sla = textToDims(val('odt-sla'), SLA_DIMENSIONS, SLA_UNITS);
  if (sla.length) odps.sla = sla; else delete odps.sla;
  var dq = textToDims(val('odt-quality'), QUALITY_DIMENSIONS, QUALITY_UNITS);
  if (dq.length) odps.dataQuality = dq; else delete odps.dataQuality;
  set(prov, 'source', val('odt-source'));
  set(prov, 'transformations', val('odt-transformations'));
  return {
    odps: Object.keys(odps).length ? odps : undefined,
    provenance: Object.keys(prov).length ? prov : undefined,
  };
}

export function odpsToggleDefaults(rerender) { odDefaultsOpen = !odDefaultsOpen; if (rerender) rerender(); }
export function odpsToggleTool(rerender) { odToolOpen = !odToolOpen; if (rerender) rerender(); }
export function odpsDefaultsOpen() { return odDefaultsOpen; }

/**
 * Draft the DESCRIPTIVE fields with the owner's own AI key. The prompt hands the model everything the node
 * already knows about the capability (app, tool, I/O schema, price) and forbids the attestation fields:
 * provenance, legal basis, consent, retention, SLA objectives and the legal entity are promises the owner
 * makes, not text a model may invent.
 */
export function odpsSuggestForTool(ctx, rerender) {
  var statusEl = document.getElementById('od-tool-status');
  var token = getCortexOwnerToken();
  if (!token) { if (statusEl) statusEl.textContent = t('odps.needLogin'); return; }
  var base = apiBase();
  if (!base) { if (statusEl) statusEl.textContent = t('odps.aiUnavailable'); return; }
  odBusy = true;
  if (statusEl) { statusEl.className = 'dtl-ai-status'; statusEl.textContent = t('odps.suggesting'); }
  var system = 'You write the descriptive half of an Open Data Product Specification (ODPS v4.1) entry for '
    + 'a capability sold on a marketplace. Return ONLY a JSON object with these keys: '
    + '"productType" (one of: raw data, derived data, dataset, reports, analytic view, algorithm, decision support, '
    + 'automated decision-making, data-enhanced product, data-driven service, data-enabled performance, bi-directional), '
    + '"valueProposition" (one sentence, max 400 characters, what a buyer gets), '
    + '"categories" (2-4 short strings), "standards" (0-3 recognised standards that genuinely apply, else []), '
    + '"useCases" (1-3 objects with "title" and "description"). '
    + 'Base every word on the material given. Do NOT state where the data comes from, its legal basis, consent, '
    + 'retention, service levels, uptime, accuracy or the selling company — those are the owner\'s own attestations '
    + 'and inventing them would be a false claim. No markdown, no commentary, JSON only.';
  var prompt = 'App: ' + (ctx.appName || ctx.appId) + '\n'
    + (ctx.appDescription ? 'App description: ' + ctx.appDescription + '\n' : '')
    + 'Capability (tool) name: ' + (ctx.toolName || '') + '\n'
    + (ctx.toolDescription ? 'Capability description: ' + ctx.toolDescription + '\n' : '')
    + (ctx.inputSchema ? 'Input schema: ' + JSON.stringify(ctx.inputSchema).slice(0, 1500) + '\n' : '')
    + (ctx.outputSchema ? 'Output schema: ' + JSON.stringify(ctx.outputSchema).slice(0, 1500) + '\n' : '')
    + (ctx.price ? 'Price: ' + ctx.price + '\n' : '')
    + 'Write the ODPS descriptive fields for this capability.';
  fetch(base + '/v1/ai/complete', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt, systemPrompt: system, app_id: 'app-catalog' }),
  })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      odBusy = false;
      var st = document.getElementById('od-tool-status');
      if (!json || !json.ok) {
        var msg = (json && json.error && json.error.message) || t('odps.suggestFailed');
        if (st) { st.className = 'dtl-ai-status od-err'; st.textContent = '✘ ' + msg; }
        return;
      }
      var raw = (json.data && json.data.content) || '';
      var m = raw.match(/\{[\s\S]*\}/);
      var parsed = null;
      try { parsed = m ? JSON.parse(m[0]) : null; } catch (e) { parsed = null; }
      if (!parsed) { if (st) { st.className = 'dtl-ai-status od-err'; st.textContent = '✘ ' + t('odps.suggestUnparseable'); } return; }
      if (PRODUCT_TYPES.indexOf(parsed.productType) !== -1) setVal('odt-type', parsed.productType);
      if (parsed.valueProposition) setVal('odt-value', String(parsed.valueProposition).slice(0, 512));
      if (Array.isArray(parsed.categories)) setVal('odt-categories', parsed.categories.join(', '));
      if (Array.isArray(parsed.standards)) setVal('odt-standards', parsed.standards.join(', '));
      if (Array.isArray(parsed.useCases)) {
        setVal('odt-usecases', parsed.useCases.map(function (u) {
          return (u.title || '') + (u.description ? ' | ' + u.description : '');
        }).filter(Boolean).join('\n'));
      }
      if (st) { st.className = 'dtl-ai-status od-ok'; st.textContent = '✔ ' + t('odps.suggestDone'); }
      showNotice(t('odps.suggestDone'), 'success');
      if (rerender) { /* fields are filled in place — no re-render, it would wipe them */ }
    })
    .catch(function (e) {
      odBusy = false;
      var st = document.getElementById('od-tool-status');
      if (st) { st.className = 'dtl-ai-status od-err'; st.textContent = '✘ ' + (e.message || t('odps.suggestFailed')); }
    });
}
