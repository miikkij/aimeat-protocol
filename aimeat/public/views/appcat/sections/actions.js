/**
 * @file public/views/appcat/sections/actions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Actions section at the foot of the app detail view: View / Edit Source, Improve
 *   with AI, Share as Prompt, Publish (loud; "Publish as v{n+1}" on a published app), Set screenshot,
 *   New screenshot, and Delete (danger, only on the person's own published app). As the old
 *   catalogue's detail.js actionsHtml with detailEditSource, detailImproveExternal, detailSharePrompt,
 *   detailPublish, detailSetScreenshot, detailRefreshScreenshot, detailDelete and server-io.js
 *   deleteServerApp:
 *   - View / Edit Source, Improve with AI, Share as Prompt and Publish open their dialogs with the
 *     bytes the detail holds (the saved working copy over the published ones, detail-state.js); the
 *     source dialog's Save saves the working copy, a publish there or in the Publish dialog adopts
 *     the new version number.
 *   - Set screenshot picks an image (at most 2 MB) and sends POST /v1/apps/{owner}/{file}/screenshot
 *     { screenshot (base64), screenshot_mime_type }.
 *   - New screenshot asks, then DELETE /v1/apps/{owner}/{file}/screenshot; the node takes a fresh one
 *     on its next scheduled run, and its `note` is said.
 *   - Delete asks, then DELETE /v1/apps/{filename}; on success the detail view closes and the listing
 *     is read again, on a refusal it stays open with the server's words.
 * @structure meta · ActionsSection({ d })
 * @usage loaded by the detail view: import('./sections/actions.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the chapter's door row
 *     (Actions `chapter`: 24px apart, the words and the slab at .78rem); the screenshot's "too large"
 *     and "set" and the delete's "sign in" said as information, the kind the old notice gave them.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's detail.js,
 *     render.js and server-io.js.
 */
import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';
import { apiPost, apiDelete } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { FileDrop } from '/components/FileDrop.js';
import { x } from '/views/appcat/i18n.js';
import { openDialog } from '/views/appcat/dialogs/host.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { reloadCatalog, closeDetail } from '/views/appcat/store.js';
import { useDetailState, whenBytes, currentText, saveWork, setVersion, bumpVersions } from '/views/appcat/detail-state.js';
import { textToB64 } from '/views/appcat/workcopy.js';

const html = htm.bind(h);

export const meta = { id: 'actions', title: 'detail.actions', show: () => true };

const MAX_SHOT = 2 * 1024 * 1024;

/** The file's bytes as base64 (the data URL's tail). */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); resolve(s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s); };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** The app's text once the detail holds its bytes; undefined when they could not be read. */
async function sourceText() {
  const b64 = await whenBytes();
  return b64 ? currentText() : undefined;
}

export default function ActionsSection({ d }) {
  const st = useDetailState();
  const shotInput = useRef(null);
  const open = d.openDialog || openDialog;
  const app = d.app;
  const manifest = (app && app.manifest) || {};
  const published = !!app;
  const name = manifest.name || d.filename || '';
  const version = (st.ref === d.ref && st.version) || (app && app.version_number) || 0;
  const publishLabel = published && version ? x('detail.publishAs') + ' v' + (version + 1) : x('detail.publish');
  const shotPath = () => '/v1/apps/' + encodeURIComponent(d.owner) + '/' + encodeURIComponent(d.filename) + '/screenshot';
  const adopt = (data) => { if (data && data.version_number) setVersion(data.version_number); bumpVersions(); };

  const viewSource = async () => {
    const text = await sourceText();
    open('source', {
      name, text, owner: d.owner, filename: d.filename, published,
      onSave: (next) => saveWork(textToB64(next)),
      onPublished: adopt,
      app: { name, filename: d.filename, track: manifest.track, html: text },
    });
  };

  const improve = async () => {
    const text = await sourceText();
    open('generate', { app: { name, filename: d.filename, track: manifest.track, html: text } });
  };

  const share = async () => {
    const text = await sourceText();
    open('share-prompt', { name, tags: manifest.tags || [], html: text });
  };

  const publish = () => open('publish', {
    app, owner: d.owner, filename: d.filename, name, description: manifest.description || '',
    html: sourceText, onPublished: adopt,
  });

  const pickShot = () => {
    if (!d.owner || !d.filename) { d.notice(x('actions.shotNeedPublish'), 'info'); return; }
    if (!getSession()?.jwt) { d.notice(x('actions.shotNeedLogin'), 'info'); return; }
    shotInput.current?.click();
  };

  const sendShot = async (file) => {
    if (!file) return;
    // The kinds are the ones the old page's notice read from these words: plain information.
    if (file.size > MAX_SHOT) { d.notice(x('actions.shotTooLarge'), 'info'); return; }
    try {
      const screenshot = await readBase64(file);
      await apiPost(shotPath(), { screenshot, screenshot_mime_type: file.type || 'image/png' });
      d.notice(x('actions.shotSet'), 'info');
    } catch (e) {
      d.notice(x('actions.failed', { message: e.message || 'HTTP error' }), 'error');
    }
  };

  const clearShot = async () => {
    if (!d.owner || !d.filename) { d.notice(x('actions.shotRefreshNeedPublish'), 'info'); return; }
    if (!getSession()?.jwt) { d.notice(x('actions.shotRefreshNeedLogin'), 'info'); return; }
    if (!(await confirmAsk(x('confirm.clearScreenshot')))) return;
    try {
      const res = await apiDelete(shotPath());
      d.notice((res && res.data && res.data.note) || x('actions.shotCleared'), 'success');
    } catch (e) {
      d.notice(x('actions.failed', { message: e.message || 'HTTP error' }), 'error');
    }
  };

  const remove = async () => {
    if (!(await confirmAsk(x('confirm.deleteFromServer', { file: name || d.filename })))) return;
    if (!getSession()?.jwt) { d.notice(x('actions.deleteNeedLogin'), 'info'); return; }
    try {
      await apiDelete('/v1/apps/' + encodeURIComponent(d.filename));
    } catch (e) {
      // Refused or failed: the detail stays open with the server's words.
      d.notice(x('actions.deleteFailed', { message: e.message || 'Unknown error' }), 'error');
      return;
    }
    closeDetail();
    reloadCatalog();
  };

  return html`<${Actions} chapter>
    <${Action} small onClick=${viewSource}>${x('ctx.viewSource')}<//>
    <${Action} small onClick=${improve}>${x('ctx.improveAi')}<//>
    <${Action} small onClick=${share}>${x('ctx.sharePrompt')}<//>
    <${Loud} control onClick=${publish}>${publishLabel}<//>
    ${published ? html`<${Action} small title=${x('actions.shotSetHint')} onClick=${pickShot}>${x('detail.setScreenshot')}<//>` : null}
    ${published ? html`<${Action} small title=${x('actions.shotRefreshHint')} onClick=${clearShot}>${x('detail.refreshScreenshot')}<//>` : null}
    ${d.isOwnPublished ? html`<${Action} small tone="danger" title=${x('detail.deleteHint')} onClick=${remove}>${x('ctx.delete')}<//>` : null}
    <${FileDrop} hidden accept="image/*" inputRef=${shotInput} onFiles=${([f]) => sendShot(f)} />
  <//>`;
}
