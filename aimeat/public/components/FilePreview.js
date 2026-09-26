/**
 * @file public/components/FilePreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored file shown in a dialog, so a person sees what it holds before they open or
 *   download it: a picture, a PDF in a frame, a video or a sound with its controls, or text in the
 *   typewriter face, on a grey ground in a thin frame; while the file loads, when it cannot be
 *   loaded, or when its kind has no preview, one grey line says so. A page fetches the file and
 *   passes what it got and the words; it never writes a class. The dialog is the site's one dialog
 *   (components/Modal.js); the look is css/components/file-preview.css.
 *
 *   - `kind`: 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other' (the file's kind, which decides
 *     how it is shown). `src`: the address of the file's bytes (an object URL) for the first four;
 *     `text`: the words of a text file.
 *   - `loading`, `error`: the file is on its way, or it could not be read; `loadingLabel`,
 *     `errorLabel` and `noneLabel` (a kind with no preview) are the lines that say so.
 *   - `title`: the dialog's title (the file's name, also the picture's words for a screen reader).
 *   - `doors`: the actions at the dialog's foot (open in a new tab, download). `onClose`.
 *   Escape and the page behind always close it: there is nothing typed in it to lose.
 * @structure FilePreview({ title, kind, src, text, loading, error, loadingLabel, errorLabel, noneLabel, doors, onClose })
 * @usage html`<${FilePreview} title=${name} kind=${cat} src=${objUrl} text=${text} loading=${loading} error=${err}
 *          loadingLabel=${t('profile.files.previewLoading')} errorLabel=${t('profile.files.previewError')}
 *          noneLabel=${t('profile.files.noPreview')} onClose=${close}
 *          doors=${html`<${Action} onClick=${download}>${t('profile.files.download')}<//>`} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the memory tab's file preview body (views/profile/memory-tab/
 *     components.js FilePreviewModal, .pf-file-preview-*) as a component, its dialog width with it
 *     (page group G3).
 */
import { h } from 'preact';
import htm from 'htm';
import { Modal } from '/components/Modal.js';

const html = htm.bind(h);

/** What the file holds, by its kind; null while there is nothing to show yet. */
function body({ kind, src, text, title }) {
  if (kind === 'text') return text !== null && text !== undefined ? html`<pre class="file-preview-text">${text}</pre>` : null;
  if (!src) return null;
  if (kind === 'image') return html`<img class="file-preview-img" src=${src} alt=${title} />`;
  if (kind === 'pdf') return html`<iframe class="file-preview-frame" src=${src} title=${title}></iframe>`;
  if (kind === 'video') return html`<video class="file-preview-media" src=${src} controls></video>`;
  if (kind === 'audio') return html`<audio class="file-preview-media" src=${src} controls></audio>`;
  return null;
}

export function FilePreview({ title, kind, src, text, loading, error, loadingLabel, errorLabel, noneLabel, doors, onClose }) {
  const status = (words) => html`<div class="file-preview-status" role="status">${words}</div>`;
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${title} className="file-preview-dialog" guard=${false} footer=${doors}>
      <div class="file-preview">
        ${loading ? status(loadingLabel) : null}
        ${error ? status(errorLabel) : null}
        ${!loading && !error && kind === 'other' ? status(noneLabel) : null}
        ${!loading && !error ? body({ kind, src, text, title }) : null}
      </div>
    <//>`;
}

export default FilePreview;
