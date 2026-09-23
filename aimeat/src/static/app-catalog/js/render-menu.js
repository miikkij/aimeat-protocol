/**
 * @file render-menu.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-app context menu of a browser-local app (show, hide, act) and the three
 *   prompt outputs that reuse the source dialog: View / Edit Source, Share as Prompt and the
 *   portfolio (homepage) prompt. Moved out of render.js by pure extraction (the file had grown past
 *   the line ceiling); render.js re-exports every name, so the callers did not change.
 * @structure showContextMenu · hideContextMenu · handleContextAction · viewSource ·
 *   generateSharePrompt · generateHomepagePrompt
 * @usage import { viewSource, generateHomepagePrompt } from './render.js';
 * @version-history
 *   v1.0.0 — 2026-09-22 — Extracted from render.js unchanged (its v3.3.0 changes included).
 */
import { saveApp, deleteApp } from './db.js';
import { showConfirm, showNotice } from './ui.js';
import { t } from './i18n.js';
import { openPromptBuilder } from './cortex.js';
import { openDetailView } from './detail.js';
import { loadPublishedApps, showPublishModal, deleteServerApp } from './server-io.js';
import { openDlg } from './dialogs.js';
import { renderApps, getMainApps, buildLibraryEntries, ownServerApps, serverStateByFilename } from './render.js';

// ── Context Menu ────────────────────────────────

var contextAppId = null;

function showContextMenu(event, id) {
  if (event.preventDefault) event.preventDefault();
  if (event.stopPropagation) event.stopPropagation();
  contextAppId = id;

  var menu = document.getElementById('context-menu');
  // Reveal off-screen first so we can measure the REAL height — the menu has
  // a variable number of items (Edit, Favorite, Open mode, Source, Improve,
  // Share, Publish, Delete…), so a hardcoded estimate overflowed the viewport
  // and pushed the lower actions out of reach.
  menu.style.left = '-9999px';
  menu.style.top = '0px';
  menu.hidden = false;

  // offsetWidth/Height give the true layout size and ignore the cardIn entry
  // animation's transform: scale() (getBoundingClientRect would under-measure
  // mid-animation and let the menu spill off the bottom edge).
  var menuWidth = menu.offsetWidth || 200;
  var menuHeight = menu.offsetHeight || 160;
  var margin = 8;
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  var x = (event.clientX != null) ? event.clientX : 0;
  var y = (event.clientY != null) ? event.clientY : 0;

  // Clamp horizontally within the viewport.
  if (x + menuWidth + margin > vw) x = vw - menuWidth - margin;
  if (x < margin) x = margin;

  // Clamp vertically: pin to the bottom edge if it would overflow below,
  // and never let the top go above the viewport. (Combined with the
  // max-height in CSS, a menu taller than the screen scrolls instead.)
  if (y + menuHeight + margin > vh) y = vh - menuHeight - margin;
  if (y < margin) y = margin;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideContextMenu() {
  var menu = document.getElementById('context-menu');
  menu.hidden = true;
  contextAppId = null;
}

async function handleContextAction(action) {
  if (!contextAppId) return;
  var appId = contextAppId;
  hideContextMenu();

  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === appId) { app = getMainApps()[i]; break; }
  }
  if (!app) return;

  switch (action) {
    case 'details':
      openDetailView(appId);
      break;

    case 'edit':
      // Server-only: editing an app's name/description/icon/tags is done in the detail view
      // ("Edit details"); route there instead of the old local Add/Edit modal.
      openDetailView(appId);
      break;

    case 'favorite':
      app.favorite = !app.favorite;
      saveApp(app).then(function () {
        renderApps();
      });
      break;

    case 'view-source':
      viewSource(app);
      break;

    case 'delete':
      // Same rule as the detail view: our own published app is deleted ON THE NODE (deleteServerApp
      // asks its own confirmation and reports whether the node agreed); a record that was never
      // published is only dropped from the page-session set.
      if (app.published && app.publishedFilename && serverStateByFilename[app.publishedFilename]) {
        if (await deleteServerApp(app.publishedFilename, app.name || app.publishedFilename)) {
          await deleteApp(appId);
          renderApps();
        }
        break;
      }
      if (await showConfirm(t('confirm.deleteApp').replace('{name}', function () { return app.name || 'this app'; }))) {
        deleteApp(appId).then(function () {
          renderApps();
          loadPublishedApps();
        });
      }
      break;

    case 'publish':
      showPublishModal(appId);
      break;

    case 'improve-ai':
      openPromptBuilder(app);
      break;

    case 'share-prompt':
      generateSharePrompt(app);
      break;
  }
}

// ── View Source ──────────────────────────────────

function viewSource(app) {
  var overlay = document.getElementById('source-overlay');
  var textarea = document.getElementById('source-code');
  var title = document.getElementById('source-title');
  var saveBtn = document.getElementById('save-source-btn');

  title.textContent = 'View / Edit Source: ' + (app.name || 'App');

  var isEditable = !!app.blob; // Only blob-based apps can be edited
  if (app.blob) {
    textarea.value = decodeURIComponent(escape(atob(app.blob)));
  } else if (app.url) {
    textarea.value = '// This app is URL-based (' + app.url + ')\n// Source code is not stored locally.\n// Open the URL to view the app.';
  } else {
    textarea.value = '// No source available';
  }

  textarea.readOnly = !isEditable;
  saveBtn.disabled = true;
  saveBtn.hidden = !isEditable;
  // Real-origin staging (Test on real origin / Publish tested version) needs a PUBLISHED
  // app (server draft slot). Show those buttons only then; hide for local-only / URL apps.
  var canStage = isEditable && !!app.published;
  var testLiveBtn = document.getElementById('source-test-live-btn');
  var pubTestedBtn = document.getElementById('source-publish-tested-btn');
  if (testLiveBtn) testLiveBtn.hidden = !canStage;
  if (pubTestedBtn) pubTestedBtn.hidden = !canStage;
  var stageStatus = document.getElementById('source-draft-status');
  if (stageStatus) stageStatus.textContent = '';
  openDlg(overlay);
  // Store app metadata for save and prompt
  overlay.dataset.appName = app.name || 'App';
  overlay.dataset.appId = app.id || '';
  overlay.dataset.originalSource = textarea.value;
}

// ── Share as Prompt ────────────────────────────

function generateSharePrompt(app) {
  if (!app || !app.blob) {
    showNotice('Only local HTML apps can be shared as prompts.');
    return;
  }

  var source = decodeURIComponent(escape(atob(app.blob)));
  var prompt = 'Recreate this HTML app exactly as provided.\n\n';
  prompt += 'App name: ' + (app.name || 'Untitled') + '\n';
  if (app.tags && app.tags.length) {
    prompt += 'Tags: ' + app.tags.join(', ') + '\n';
  }
  prompt += '\nReturn the COMPLETE HTML file below without modifications.\n';
  prompt += 'If the user asks for changes, apply them to this source.\n\n';
  prompt += '--- Source Code ---\n' + source;

  navigator.clipboard.writeText(prompt).then(function() {
    showNotice('Share prompt copied! Paste it into any AI chat to recreate this app.');
  }).catch(function() {
    // Fallback: show in source overlay
    var overlay = document.getElementById('source-overlay');
    var textarea = document.getElementById('source-code');
    var title = document.getElementById('source-title');
    var saveBtn = document.getElementById('save-source-btn');
    title.textContent = 'Share Prompt: ' + (app.name || 'App');
    textarea.value = prompt;
    textarea.readOnly = true;
    saveBtn.hidden = true;
    openDlg(overlay);
    overlay.dataset.appId = '';
    overlay.dataset.originalSource = '';
  });
}

// ── Generate Homepage Prompt ──────────────────────

function generateHomepagePrompt() {
  // The catalog is server-only, so the apps are the owner's server apps; the old browser-local
  // list is always empty now and the button did nothing but say "add some apps first".
  var apps = buildLibraryEntries([], ownServerApps);
  if (apps.length === 0) {
    showNotice(t('homepage.needApps'));
    return;
  }

  var appList = apps.map(function(app) {
    var launchInfo = app.viewUrl ? ('URL: ' + app.viewUrl) : 'Local HTML app (user will open it from their launcher)';
    return '- ' + (app.icon || '') + ' ' + app.name +
      (app.description ? ' (' + app.description + ')' : '') +
      ' [' + launchInfo + ']' +
      ((app.tags || []).length ? ' Tags: ' + app.tags.join(', ') : '');
  }).join('\n');

  var prompt = 'Create a single HTML file that serves as my personal homepage/dashboard.\n\n' +
    'My apps:\n' + appList + '\n\n' +
    'Requirements:\n' +
    '- Show each app as a clickable card with its icon and name\n' +
    '- For URL-based apps, clicking opens the URL in a new tab\n' +
    '- For local apps, show a note that they can be opened from the App Launcher\n' +
    '- Modern, responsive design with light theme\n' +
    '- Group apps by their tags if they have tags\n' +
    '- Everything in one self-contained HTML file, no external dependencies\n' +
    '- Add a header with my name/title (I will customize this)\n' +
    '- Make it visually distinctive and professional';

  // Reuse the source overlay for displaying the prompt
  var overlay = document.getElementById('source-overlay');
  var textarea = document.getElementById('source-code');
  var title = document.getElementById('source-title');

  title.textContent = t('homepage.title');
  textarea.value = prompt;
  overlay.dataset.appName = 'Homepage';
  openDlg(overlay);
}

export {
  showContextMenu,
  hideContextMenu,
  handleContextAction,
  viewSource,
  generateSharePrompt,
  generateHomepagePrompt
};
