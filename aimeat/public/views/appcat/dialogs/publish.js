/**
 * @file public/views/appcat/dialogs/publish.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's Publish dialog (features F109–F112, F133): Filename, Description and an
 *   optional Access code (typed hidden, with the eye), a status line, Cancel and Publish.
 *   - Opening: the filename is the published one on a republish (so the node adds v(n+1)), else the
 *     name made into a slug with .html added; the description is the record's; the access code starts
 *     empty and hidden. Signed out, the status says to sign in and Publish is off; a sign-in or a
 *     sign-out while the dialog is open turns Publish on or off at once (F110).
 *   - Publish: checks the filename (^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$; the .html ending the hint asks
 *     for is not enforced, as on the old page), the access code (4–64 when given) and the description
 *     (needed for an app not yet published), then POST /v1/apps { filename, content (base64),
 *     mime_type, name, description, tags, icon?, access_code? }. Category and uses_cortex are not sent,
 *     so the node keeps them on a republish. "Publishing..." → "✔ Published! {address}", the lists are
 *     read again and the dialog closes itself 1.4 s later; a refusal says "✘ {message}" and Publish
 *     can be pressed again.
 *   - The create flow (from Add, `unlisted`): right after the publish the app is unlisted
 *     (PATCH /v1/apps/{filename} { parked: true }), so a new app lands on the node unlisted, and the
 *     status says so.
 * @structure PublishDialog({ record, unlisted, onPublished, close })
 * @usage openDialog('publish', { record, unlisted: true })   (the Add dialog)
 *        openDialog('publish', { app, owner, filename, name, description, html })   (the detail's Actions:
 *        app is the listing row or null, html the text or a function that reads it)
 *   record: { name, description?, tags?: string[], icon?, html?: string | () => Promise<string> or content?:
 *   string (base64 of it), url?: string (a URL-linked app, which cannot be published), published?:
 *   boolean, filename?: string (the published filename) }. onPublished(data) hears the node's answer
 *   ({ filename, download_url, version_number, versions_url, …, description, parked }) after a publish
 *   (and the unlisting).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the status line is the old page's (.85rem, green while publishing
 *     and when done, coral when refused, 8px under the fields even while empty).
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { Action, Loud } from '/components/Action.js';
import { apiPost, apiPatch } from '/js/api.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import { reloadCatalog, notice } from '/views/appcat/store.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { textToBase64 } from '/views/appcat/dialogs/app-file.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);
const FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** The filename a new app gets from its name: a slug, lower case, with .html. */
export function filenameFromName(name) {
  let safe = String(name || 'app').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').toLowerCase();
  if (!/\.html?$/i.test(safe)) safe += '.html';
  return safe;
}

/**
 * The app to publish: the `record` the Add dialog passes, or one made from the detail's props
 * ({ app (the listing row), filename, name, description, html }).
 */
function recordOf({ record, app, filename, name, description, html: text }) {
  if (record) return record;
  const man = (app && app.manifest) || {};
  return {
    name: name || man.name || '',
    description: description ?? man.description ?? '',
    tags: Array.isArray(man.tags) ? man.tags : [],
    icon: man.icon || '',
    html: text,
    published: !!app,
    filename: filename || (app && app.filename) || '',
  };
}

export default function PublishDialog(props) {
  const { unlisted = false, onPublished, close } = props;
  const record = recordOf(props);
  const [filename, setFilename] = useState(record.published && record.filename ? record.filename : filenameFromName(record.name));
  const [description, setDescription] = useState(record.description || '');
  const [code, setCode] = useState('');
  const [signedIn, setSignedIn] = useState(!!getSession());
  const [busy, setBusy] = useState(false);
  /** @type {[{ text: string, error?: boolean } | null, any]} */
  const [status, setStatus] = useState(null);
  const timer = useRef(0);

  // A sign-in or sign-out while the dialog is open turns Publish on or off at once (F110).
  useEffect(() => onAuthChange((s) => setSignedIn(!!s)), []);
  // The close after a publish belongs to this dialog: if it was closed first, nothing else is closed.
  useEffect(() => () => clearTimeout(timer.current), []);

  const refuse = (text) => setStatus({ text, error: true });

  async function publish() {
    const file = filename.trim();
    const access = code.trim();
    if (!file || !FILENAME.test(file)) { refuse(x('publish.invalidFilename')); return; }
    if (access && (access.length < 4 || access.length > 64)) { refuse(x('publish.accessCodeLength')); return; }
    const desc = description.trim();
    if (!desc && !record.published) { refuse(x('publish.descriptionRequired')); return; }
    let content = record.content || '';
    if (!content && record.html) {
      // The detail passes its bytes as a function that reads them (d.html()); the Add dialog as text.
      let text = '';
      try {
        text = typeof record.html === 'function' ? String((await record.html()) || '') : String(record.html);
      } catch (err) {
        console.warn('[appcat] the app source could not be read for publishing', err);
      }
      if (text) content = textToBase64(text);
    }
    if (!content) { refuse(record.url ? x('publish.urlLinked') : x('publish.noContent')); return; }
    if (!getSession()) { refuse(x('publish.loginRequired')); return; }

    setStatus({ text: x('publish.publishing') });
    setBusy(true);
    const body = {
      filename: file,
      content,
      mime_type: 'text/html',
      name: record.name || file.replace(/\.html?$/i, ''),
      description: desc,
      tags: record.tags || [],
    };
    if (record.icon) body.icon = record.icon;
    if (access) body.access_code = access;
    let data;
    try {
      const res = await apiPost('/v1/apps', body);
      data = res.data || {};
    } catch (err) {
      setStatus({ text: '✘ ' + (err.message || x('publish.failed')), error: true });
      setBusy(false);
      return;
    }
    setStatus({ text: '✔ ' + x('publish.published', { url: data.download_url || '' }) });
    if (unlisted) {
      // The create flow: the new app lands unlisted. The unlisting is best effort, as it was.
      setStatus({ text: '✔ ' + x('publish.savedUnlisted') });
      try {
        await apiPatch('/v1/apps/' + encodeURIComponent(file), { parked: true });
      } catch (err) {
        notice(x('publish.unlistFailed', { message: err.message || '' }), 'error');
      }
    }
    reloadCatalog();
    onPublished?.({ ...data, filename: data.filename || file, description: desc, parked: !!unlisted });
    // Closes shortly after saying so, so the publish does not dead-end on a disabled button.
    timer.current = setTimeout(() => close(), 1400);
  }

  const footer = html`
    <${Action} onClick=${close}>${x('common.cancel')}<//>
    <${Loud} control disabled=${!signedIn || busy} onClick=${publish}>${x('publish.submit')}<//>`;

  // Signed out, the status says why Publish is off, until something else is said.
  const shown = status || (!signedIn ? { text: x('publish.loginRequired'), error: true } : null);

  return html`<${Dialog} title=${x('publish.title')} size="md" onClose=${close} footer=${footer}>
    <${Fields} plain>
      <${TextField} label=${x('publish.filename')} value=${filename} onInput=${setFilename}
        placeholder="my-app.html" autoComplete="off" hint=${x('publish.filenameHint')} />
      <${TextArea} label=${x('publish.description')} rows=${2} value=${description} onInput=${setDescription}
        placeholder=${x('publish.descriptionPh')} hint=${x('publish.descriptionHint')} />
      <${TextField} secret label=${x('publish.accessCode')} value=${code} onInput=${setCode}
        placeholder=${x('publish.accessCodePh')} hint=${x('publish.accessCodeHint')}
        showLabel=${x('secret.show')} hideLabel=${x('secret.hide')} />
    <//>
    <${Status} always status=${shown ? { text: shown.text, tone: shown.error ? 'refused' : 'ok' } : null} />
  <//>`;
}
