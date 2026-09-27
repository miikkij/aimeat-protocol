/**
 * @file public/views/appcat/dialogs/source.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description View and edit an app's source (features F142, F143), and the dialog other long texts are
 *   shown in (the portfolio prompt F81, a share prompt the clipboard refused F148). The title, the
 *   source in a typewriter box (editable when the caller gives the text as editable), a status line and
 *   the hint "Save keeps it for you only. Try opens it on its real address without changing the live
 *   app. Publish is what other people see." Footer start: "Copy Source" ("Copied!" for 1.5 s) and "Copy
 *   with AI Prompt" (the prompt builder in improve mode for this app, or new mode when there is no
 *   app). Footer: Close, "Try it safely" and "Publish as a new version" (a published app only), and
 *   "Save working copy" (disabled until the text differs from what was opened). Closing with unsaved
 *   edits asks "You have unsaved changes. Close anyway?" first, whichever way out is taken (F176: the
 *   dialog asks itself, so Escape is not guarded).
 *
 *   Saving is the caller's: the detail view holds the working copy and its checkpoints (F303), so it
 *   passes `onSave(text)`; without it there is no Save. Try and Publish stage the text as the draft
 *   (PUT …/draft) and then open a preview (…/draft/preview-token) or publish it (…/publish-draft, after
 *   the question "Publish the tested draft as the new live version?").
 * @structure default SourceDialog(props)
 * @usage openDialog('source', { name, text, owner, filename, published, onSave, onPublished, app })
 *   props:
 *   - text: the text shown; readOnly: true to show it without editing (a prompt);
 *   - title: the dialog's title (default "View / Edit Source: {name}"); name: the app's name;
 *   - owner, filename, published: the app on the node, for Try and Publish (both show only when
 *     published is true and the text is editable);
 *   - onSave(text) → Promise<{ persisted: boolean }>: saves the working copy (persisted false: kept
 *     in the page only, "Kept in this tab only — …");
 *   - onPublished(data): after Publish, with the node's reply ({ version_number });
 *   - app: { name, filename, track, html } for "Copy with AI Prompt" (html: the app's saved bytes).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the source in the old editor's heavy frame (TextArea source), the
 *     status line the detail's (.82rem, 10px under, holding its room; a refusal in coral), the verbs'
 *     hint as running text in ink, as the old dialog drew them.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old render.js viewSource and
 *     main.js's source-dialog wiring.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextArea } from '/components/TextField.js';
import { copyToClipboard } from '/js/utils.js';
import { getSession } from '/js/services/auth.js';
import { reloadCatalog, notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { Status, useFlash } from '/views/appcat/dialogs/parts.js';
import { publishText, stagePreview } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

export default function SourceDialog(props) {
  const { title, name, text, readOnly, owner, filename, published, onSave, onPublished, app, close } = props;
  const shown = typeof text === 'string' ? text : x('source.none');
  const editable = typeof text === 'string' && !readOnly;
  const [original, setOriginal] = useState(shown);
  const [value, setValue] = useState(shown);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash(1500);
  const [copied, flashCopied] = useFlash(1500);

  const canSave = editable && typeof onSave === 'function';
  const canStage = editable && !!published && !!owner && !!filename;
  const dirty = canSave && value !== original;

  const leave = async () => {
    if (dirty && !saving && !(await confirmAsk(x('confirm.unsavedClose')))) return;
    close?.();
  };

  /** Try and Publish need a published app and a signed-in owner; the status line says which is missing. */
  const stageReady = () => {
    if (!canStage) { setStatus({ text: x('detail.draftNeedsPublished'), tone: 'refused' }); return false; }
    if (!getSession()) { setStatus({ text: x('detail.draftNeedsSignin'), tone: 'refused' }); return false; }
    return true;
  };

  const save = async () => {
    if (!canSave) return;
    const next = value;
    setSaving(true);
    setStatus({ text: x('wc.saving'), tone: 'busy' });
    try {
      const res = await onSave(next);
      setOriginal(next);
      flashSaved();
      setStatus(res && res.persisted === false
        ? { text: x('wc.keptLocalOnly'), tone: '' }
        : { text: '✔ ' + x('wc.saved'), tone: 'ok' });
    } catch (e) {
      setStatus({ text: '✘ ' + ((e && e.message) || x('wc.saveFailed')), tone: 'refused' });
      notice(x('wc.saveFailed') + ': ' + ((e && e.message) || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const tryIt = async () => {
    if (!stageReady()) return;
    setStatus({ text: x('detail.draftUploading'), tone: 'busy' });
    try {
      await stagePreview(owner, filename, value);
      setStatus({ text: '✔ ' + x('detail.draftOpened'), tone: 'ok' });
    } catch (e) {
      setStatus({ text: '✘ ' + (e.message || x('source.previewFailed')), tone: 'refused' });
    }
  };

  const publish = async () => {
    if (!stageReady()) return;
    if (!(await confirmAsk(x('detail.draftPublishConfirm')))) return;
    setStatus({ text: x('detail.draftUploading'), tone: 'busy' });
    try {
      const data = await publishText(owner, filename, value);
      setStatus({ text: x('detail.draftPublished', { v: data.version_number }), tone: 'ok' });
      onPublished?.(data);
      reloadCatalog();
    } catch (e) {
      setStatus({ text: '✘ ' + (e.message || x('source.publishFailed')), tone: 'refused' });
    }
  };

  const copyPrompt = async () => {
    if (dirty && !(await confirmAsk(x('confirm.unsavedClose')))) return;
    openDialog('generate', app ? { app } : {});
  };

  const footerStart = html`
    <${Action} onClick=${async () => { await copyToClipboard(value); flashCopied(); }}>${copied ? x('source.copied') : x('source.copy')}<//>
    <${Action} onClick=${copyPrompt}>${x('source.copyPrompt')}<//>`;
  const footer = html`
    <${Action} onClick=${leave}>${x('common.close')}<//>
    ${canStage ? html`<${Action} onClick=${tryIt}>${x('wc.try')}<//>` : null}
    ${canSave ? html`<${Loud} control disabled=${saving || saved || !dirty} onClick=${save}>${saving ? x('wc.saving') : saved ? x('wc.savedShort') : x('source.save')}<//>` : null}
    ${canStage ? html`<${Loud} control onClick=${publish}>${x('wc.publishNew')}<//>` : null}`;

  return html`<${Dialog} title=${title || x('source.titleFor', { name: name || 'App' })} size="lg"
    footer=${footer} footerStart=${footerStart} onClose=${leave}>
    <${TextArea} source ariaLabel=${title || x('source.title')} readOnly=${!editable}
      value=${value} onInput=${setValue} spellCheck=${false} />
    <${Status} keep chapter status=${status} />
    <${Note} kind="lead">${x('wc.verbsHint')}<//>
  <//>`;
}
