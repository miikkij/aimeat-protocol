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
 *   v1.1.0 — 2026-09-22 — Composed from the shared set (parts-html.js): this module draws the whole
 *     section, the switch and the wording door as underlined words, the three fields as the set's
 *     fields (now labelled for their inputs), the search preview as a record with one list row.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { escapeHtml } from './util.js';
import { showNotice } from './ui.js';
import { section, surface, listRow, text, action, stack, field } from './parts-html.js';
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

/**
 * What a search result would look like, from the values that would actually be served: the set's
 * record surface holding one list row, the screenshot as the row's mark (a search result's
 * thumbnail), the title as the name and the summary as the sentence under it.
 */
function previewHtml(d) {
  var title = (d.seo && d.seo.title) || d.name;
  var desc = (d.seo && d.seo.description) || d.description;
  return surface({ kind: 'record' },
    listRow({
      mark: d.screenshotUrl ? '<img src="' + escapeHtml(d.screenshotUrl) + '" alt="" loading="lazy">' : '',
      name: escapeHtml(title),
      detail: escapeHtml(desc),
      detailKind: 'text',
    })
    + (d.screenshotUrl ? '' : text({ kind: 'caption', tone: 'muted' }, escapeHtml(t('seo.noShot')))));
}

/** The whole section; detail.js holds its slot (#detail-seo) and this fills it. */
export function seoSectionInner() {
  if (seoState === 'off') return '';
  var wrap = function (description, body) {
    return section({ title: escapeHtml(t('seo.title')), description: description, body: stack({}, body) });
  };
  var quiet = function (key) { return text({ kind: 'caption', tone: 'muted' }, escapeHtml(t(key))); };
  if (seoState === 'loading') return wrap('', quiet('seo.loading'));
  if (seoState === 'error' || !seoData) return wrap('', quiet('seo.loadFailed'));

  var d = seoData;
  var on = !!(d.seo && d.seo.index === true);
  var gated = d.state === 'gated' || d.state === 'hidden';

  // The one sentence that says where the app stands, in a box so it reads as the answer.
  var html = surface({ kind: 'box', density: 'compact', tone: d.state === 'on' ? 'success' : 'plain' },
    text({ kind: 'body' }, stateLine(d.state, d.blockReason)));

  // A gated or hidden app cannot be findable whatever the switch says, so the switch is not offered:
  // a control that does nothing is worse than no control.
  if (gated) return wrap(escapeHtml(t('seo.intro')), html);

  var doors = action({ kind: 'secondary', semantics: 'switch', selected: on, disabled: seoBusy, onclick: 'window._launcher.seoToggle()' },
    escapeHtml(t(on ? 'seo.turnOff' : 'seo.turnOn')));
  if (on) {
    doors += action({ kind: 'secondary', expanded: seoOpenEditor, onclick: 'window._launcher.seoToggleEditor()' },
      escapeHtml(t(seoOpenEditor ? 'seo.hideWording' : 'seo.editWording')));
  }
  html += stack({ direction: 'wrap', align: 'center' }, doors);

  if (!on) return wrap(escapeHtml(t('seo.intro')), html);

  if (seoOpenEditor) {
    var s = d.seo || {};
    html += stack({},
      field({ id: 'seo-title', label: escapeHtml(t('seo.fTitle')), maxLength: 120, value: s.title || '', placeholder: d.name })
      + field({ id: 'seo-desc', type: 'textarea', rows: 2, label: escapeHtml(t('seo.fDesc')), maxLength: 320, value: s.description || '', placeholder: d.description })
      + field({ id: 'seo-keywords', label: escapeHtml(t('seo.fKeywords')), value: (s.keywords || []).join(', '), placeholder: (d.tags || []).join(', ') })
      + quiet('seo.wordingHint')
      + stack({ direction: 'horizontal', align: 'start' },
        action({ kind: 'primary', disabled: seoBusy, onclick: 'window._launcher.seoSave()' }, escapeHtml(t('seo.save')))));
  }

  html += stack({ density: 'compact' }, text({ kind: 'label' }, escapeHtml(t('seo.previewTitle'))) + previewHtml(d));
  return wrap(escapeHtml(t('seo.intro')), html);
}
