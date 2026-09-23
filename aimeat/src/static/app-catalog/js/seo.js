/**
 * @file seo.js
 * @description The Search section of the App Detail view: whether this app can be found in a search
 *   engine, and what it says about itself when it is.
 *
 *   OFF until its owner asks. Publishing an app makes it public and shareable by link straight
 *   away; being findable is a separate decision, made here on purpose. That is why this section
 *   exists at all — before it, publishing was silently also a decision to be indexed, and the only
 *   alternative was parking the app out of existence.
 *
 *   The four wording fields are optional and normally left empty. The title, the summary, the
 *   keywords and the picture are taken from the name, description, tags and screenshot the owner
 *   already wrote; asking them to write a second copy produces two texts that disagree within a
 *   month. They exist for the case where the catalogue wording and the search wording genuinely
 *   differ.
 *
 *   Rendering follows the detail-view pattern: detail.js renders the section shell for OWN
 *   published apps and calls seoOnOpen; this module re-renders #detail-seo in place after a save.
 *   Unlike monetize.js it writes through PATCH /v1/apps/{filename} rather than a memory record,
 *   because the value lives on the app record and gates a decision the server makes.
 * @usage import { seoSectionInner, seoOnOpen, seoToggle, seoSave } from './seo.js'
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';

var seoOwner = '';     // app owner (bare name) — the signed-in user, for own apps only
var seoAppId = '';     // published filename, the app this section is about
var seoState = 'off';  // 'off' | 'loading' | 'ready' | 'error'
var seoData = null;    // { state, seo, screenshotUrl, name, description, tags }
var seoBusy = false;   // guards the switch and Save while a write is in flight
var seoOpenEditor = false;

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function rerender() {
  var el = document.getElementById('detail-seo');
  if (el) el.innerHTML = seoSectionInner();
}

/** Reset and load when a detail view opens. No-op for anything but the owner's own published app. */
export function seoOnOpen(owner, appId, isOwn) {
  seoBusy = false; seoData = null; seoOpenEditor = false;
  if (!isOwn || !owner || !appId) { seoState = 'off'; seoOwner = ''; seoAppId = ''; return; }
  seoOwner = owner; seoAppId = appId; seoState = 'loading';
  var token = getCortexOwnerToken();
  // The listing is where the state lives: it is computed server-side from the owner's switch, the
  // operator's block, the node's mode and the gates, and recomputing any of that here would be a
  // second implementation of a decision the server already made.
  fetch(apiBase() + '/v1/apps?limit=200', {
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var apps = (res && res.ok && res.data && res.data.apps) || [];
      var mine = null;
      for (var i = 0; i < apps.length; i++) {
        if (apps[i].filename === seoAppId && apps[i].owner === seoOwner) { mine = apps[i]; break; }
      }
      if (!mine) { seoState = 'error'; rerender(); return; }
      seoData = {
        state: mine.seo_state || 'off',
        seo: mine.seo || {},
        blockReason: mine.operator_seo_block_reason || '',
        screenshotUrl: mine.screenshot_url || '',
        name: (mine.manifest && mine.manifest.name) || seoAppId,
        description: (mine.manifest && mine.manifest.description) || '',
        tags: (mine.manifest && mine.manifest.tags) || [],
      };
      seoState = 'ready';
      rerender();
    })
    .catch(function () { seoState = 'error'; rerender(); });
}

/** Flip the owner's own switch. */
export function seoToggle() {
  if (seoBusy || !seoData) return;
  var next = !(seoData.seo && seoData.seo.index === true);
  patch({ index: next });
}

/** Save the wording. Empty fields go back to being derived from the app itself. */
export function seoSave() {
  if (seoBusy || !seoData) return;
  var val = function (id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };
  patch({
    title: val('seo-title'),
    description: val('seo-desc'),
    keywords: val('seo-keywords').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
  });
}

export function seoToggleEditor() {
  seoOpenEditor = !seoOpenEditor;
  rerender();
}

function patch(seo) {
  seoBusy = true; rerender();
  var token = getCortexOwnerToken();
  fetch(apiBase() + '/v1/apps/' + encodeURIComponent(seoAppId), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify({ seo: seo }),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      seoBusy = false;
      if (!res || !res.ok) {
        showNotice((res && res.error && res.error.message) || t('seo.saveFailed'));
        rerender();
        return;
      }
      // The answer carries the state AFTER the write, which is not always what was asked for: on a
      // node where the operator approves each request, switching the toggle on makes a request
      // rather than a decision, and the note says so.
      var d = res.data || {};
      seoData.state = (d.seo && d.seo.state) || seoData.state;
      seoData.seo = d.seo || seoData.seo;
      showNotice(d.note || t('seo.saved'));
      rerender();
    })
    .catch(function (err) {
      seoBusy = false;
      showNotice(String(err && err.message ? err.message : err));
      rerender();
    });
}

/** The one sentence that tells the owner where their app actually stands. */
function stateLine(state, blockReason) {
  if (state === 'on') return t('seo.stateOn');
  if (state === 'pending') return t('seo.statePending');
  if (state === 'blocked') return t('seo.stateBlocked') + (blockReason ? ' — ' + escapeHtml(blockReason) : '');
  if (state === 'hidden') return t('seo.stateHidden');
  if (state === 'gated') return t('seo.stateGated');
  return t('seo.stateOff');
}

/** What a search result would look like, from the values that would actually be served. */
function previewHtml(d) {
  var title = (d.seo && d.seo.title) || d.name;
  var desc = (d.seo && d.seo.description) || d.description;
  return '<div class="dtl-seo-preview">'
    + '<div class="dtl-seo-preview-title">' + escapeHtml(title) + '</div>'
    + '<div class="dtl-seo-preview-desc">' + escapeHtml(desc) + '</div>'
    + (d.screenshotUrl
      ? '<img class="dtl-seo-preview-img" src="' + escapeHtml(d.screenshotUrl) + '" alt="" loading="lazy">'
      : '<div class="dtl-seo-preview-noimg">' + escapeHtml(t('seo.noShot')) + '</div>')
    + '</div>';
}

export function seoSectionInner() {
  if (seoState === 'off') return '';
  var head = '<h3>' + escapeHtml(t('seo.title')) + '</h3>';
  if (seoState === 'loading') return head + '<p class="dtl-ai-status">' + escapeHtml(t('seo.loading')) + '</p>';
  if (seoState === 'error' || !seoData) {
    return head + '<p class="dtl-ai-status">' + escapeHtml(t('seo.loadFailed')) + '</p>';
  }

  var d = seoData;
  var on = !!(d.seo && d.seo.index === true);
  var gated = d.state === 'gated' || d.state === 'hidden';

  var html = head
    + '<p class="dtl-ai-status">' + escapeHtml(t('seo.intro')) + '</p>'
    + '<p class="dtl-seo-state dtl-seo-state-' + escapeHtml(d.state) + '">' + stateLine(d.state, d.blockReason) + '</p>';

  // A gated or hidden app cannot be findable whatever the switch says, so the switch is not offered:
  // a control that does nothing is worse than no control.
  if (gated) return html;

  html += '<div class="dtl-seo-switch">'
    + dtlBtn(t(on ? 'seo.turnOff' : 'seo.turnOn'), 'window._launcher.seoToggle()',
      { variant: on ? '' : 'primary', disabled: seoBusy })
    + '</div>';

  if (!on) return html;

  html += '<div class="dtl-seo-wording">'
    + dtlBtn(t(seoOpenEditor ? 'seo.hideWording' : 'seo.editWording'), 'window._launcher.seoToggleEditor()')
    + '</div>';

  if (seoOpenEditor) {
    var s = d.seo || {};
    html += '<label class="dtl-stat-label">' + escapeHtml(t('seo.fTitle')) + '</label>'
      + '<input id="seo-title" type="text" class="modal-input" maxlength="120" value="'
      + escapeHtml(s.title || '') + '" placeholder="' + escapeHtml(d.name) + '">'
      + '<label class="dtl-stat-label">' + escapeHtml(t('seo.fDesc')) + '</label>'
      + '<textarea id="seo-desc" class="modal-input" rows="2" maxlength="320" placeholder="'
      + escapeHtml(d.description) + '">' + escapeHtml(s.description || '') + '</textarea>'
      + '<label class="dtl-stat-label">' + escapeHtml(t('seo.fKeywords')) + '</label>'
      + '<input id="seo-keywords" type="text" class="modal-input" value="'
      + escapeHtml((s.keywords || []).join(', ')) + '" placeholder="' + escapeHtml((d.tags || []).join(', ')) + '">'
      + '<p class="dtl-ai-status">' + escapeHtml(t('seo.wordingHint')) + '</p>'
      + '<div class="dtl-seo-actions">'
      + dtlBtn(t('seo.save'), 'window._launcher.seoSave()', { variant: 'primary', disabled: seoBusy })
      + '</div>';
  }

  html += '<h4>' + escapeHtml(t('seo.previewTitle')) + '</h4>' + previewHtml(d);
  return html;
}
