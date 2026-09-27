/**
 * @file public/views/appcat/dialogs/add.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's Add dialog (features F88–F95, F134, F274, F292): a finished app into the
 *   person's own catalogue, published on the node straight away and unlisted, so they can look at it
 *   before they list it. Nothing is kept in the browser.
 *   - Two tabs, Paste (the one it opens on) and File. Paste: the HTML typed or pasted in fills the
 *     empty Name, Icon and Tags from the file itself (F92), never over what was typed; the word
 *     "generated" in the label closes Add and opens Generate with AI. File: a file dropped on the area
 *     or picked with it (.html, .htm or .zip); an HTML file is read and fills the empty fields the same
 *     way, with its file name as the name to fall back on; a ZIP fills an empty Name with its file name.
 *   - Name, Icon (a field for one emoji, 24 ready ones to press, and the line on how to type any
 *     other), Tags (comma separated).
 *   - Save: Paste needs the pasted code, File needs a file; a ZIP bundle is unpacked and folded into
 *     one HTML file here in the browser (./app-file.js). Then Add closes and the Publish dialog opens
 *     for the app in the create flow, which publishes it and unlists it (F112). This is the path the
 *     node's build prompt names: "+ Add" → "Paste" → paste the HTML → name and description fill in →
 *     Publish (F292).
 *   - Cancel, the X, Escape and the page behind (until something is typed) close it; every field
 *     starts empty the next time, because every opening is a fresh dialog.
 *   openAdd() is the door the page's own buttons use (F80, F108, F291): sign in first when needed
 *   (the site's sign-in dialog, the same one the login pill opens), then Add on the Paste tab.
 * @structure AddDialog({ close }) · openAdd() · requireSignIn(next)
 * @usage import { openAdd } from '/views/appcat/dialogs/add.js'; openAdd();
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old dialog: the tabs share the row (Tabs fill), the body
 *     they govern has the sun edge (Box tabbed), "generated" is the dashed door word.
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Field, Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Tabs } from '/components/Tabs.js';
import { Box } from '/components/Box.js';
import { Action, Loud } from '/components/Action.js';
import { getSession, onAuthChange, showLoginModal } from '/js/services/auth.js';
import { notice } from '/views/appcat/store.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { parseAppMeta, readFileAsText, extractZip, bundleZip } from '/views/appcat/dialogs/app-file.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** The 24 ready icons, in the old page's order. */
const ICONS = ['📝', '📊', '📇', '📈', '🗂', '📋', '📖', '📮', '🗺', '🧭', '🎮', '🎨', '🎵', '📷', '🛒', '🏠', '💊', '🔧', '🧪', '🌍', '€', '⚖', '🏛', '🧱'];

/**
 * Run `next` once the person is signed in: at once when they are, else after the site's sign-in
 * dialog signs them in. When the sign-in library is not there at all, `next` runs anyway, as the old
 * page's did (the publish step then says to sign in).
 */
export function requireSignIn(next, tries = 0) {
  if (getSession()) { next(); return; }
  let done = false;
  const off = onAuthChange((s) => {
    if (!s || done) return;
    done = true;
    off();
    next();
  });
  if (showLoginModal({})) return;
  off();
  if (done) return;
  // The sign-in library has not loaded yet: wait for it (every 100 ms), so a deep link does not
  // open a dialog with no session; after the waiting runs out, go on as the old page did.
  if (tries > 0) setTimeout(() => requireSignIn(next, tries - 1), 100);
  else next();
}

/**
 * Open Add on the Paste tab, signing in first when needed. The sign-in library is waited for up to
 * 5 s (the old page's ?add=1 wait: every 100 ms, 50 times).
 */
export function openAdd() {
  requireSignIn(() => openDialog('add'), 50);
}

/** A ZIP's refusal in words. */
function zipWords(err) {
  if (err && err.code === 'noEocd') return x('addModal.zipNotZip');
  if (err && err.code === 'method') return x('addModal.zipMethod', { method: err.detail });
  if (err && err.code === 'noHtml') return x('addModal.zipNoHtml');
  return (err && err.message) || String(err);
}

export default function AddDialog({ close }) {
  const [tab, setTab] = useState('paste');
  const [paste, setPaste] = useState('');
  const [file, setFile] = useState(/** @type {File|null} */ (null));
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  // Fill what the person has not typed, and never touch what they have.
  const prefill = (text, fallbackName) => {
    const meta = parseAppMeta(text);
    const fill = (set, value) => { if (value) set((cur) => (cur.trim() ? cur : value)); };
    fill(setName, meta.name || fallbackName || '');
    fill(setIcon, meta.icon);
    fill(setTags, meta.tags);
  };

  const onPaste = (v) => { setPaste(v); prefill(v); };

  const onFiles = ([f]) => {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      setFile(f);
      const base = f.name.replace(/\.zip$/i, '');
      setName((cur) => (cur.trim() ? cur : base));
      return;
    }
    if (!/\.html?$/i.test(f.name)) { notice(x('addModal.fileType'), 'info'); return; }
    setFile(f);
    // The <title> inside is the name its author chose; the file name is only the fallback.
    const fallback = f.name.replace(/\.html?$/i, '');
    readFileAsText(f).then(
      (text) => prefill(text, fallback),
      () => setName((cur) => (cur.trim() ? cur : fallback)),
    );
  };

  /** Close Add and open the Publish dialog for the new app, in the create flow (unlisted). */
  const toPublish = (appName, text, description) => {
    const list = tags.trim() ? tags.split(',').map((s) => s.trim()).filter(Boolean) : [];
    openDialog('publish', {
      unlisted: true,
      record: { name: appName, description: description || '', tags: list, icon: icon.trim() || '📝', html: text, published: false },
    });
  };

  async function save() {
    let appName = name.trim();
    if (tab === 'paste') {
      const code = paste.trim();
      if (!code) { notice(x('addModal.pasteRequired'), 'info'); return; }
      const meta = parseAppMeta(code);
      if (!appName) appName = meta.name || x('addModal.pastedApp');
      toPublish(appName, code, meta.description);
      return;
    }
    if (!file) { notice(x('addModal.fileRequired'), 'info'); return; }
    setBusy(true);
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        if (!appName) appName = file.name.replace(/\.zip$/i, '');
        const text = await bundleZip(await extractZip(await file.arrayBuffer()));
        toPublish(appName, text, parseAppMeta(text).description);
      } else {
        if (!appName) appName = file.name.replace(/\.html?$/i, '');
        const text = await readFileAsText(file);
        toPublish(appName, text, parseAppMeta(text).description);
      }
    } catch (err) {
      notice(x('addModal.zipFailed', { message: zipWords(err) }), 'error');
      setBusy(false);
    }
  }

  const pasteLabel = html`${x('addModal.pasteBefore')}<${Action} tone="dashed"
    onClick=${(e) => { e.preventDefault(); openDialog('generate', {}); }}>${x('addModal.pasteWord')}<//>${x('addModal.pasteAfter')}`;

  const footer = html`
    <${Action} onClick=${close}>${x('common.cancel')}<//>
    <${Loud} control disabled=${busy} onClick=${save}>${x('common.save')}<//>`;

  return html`<${Dialog} title=${x('addModal.title')} size="md" onClose=${close} footer=${footer}>
    <${Tabs} tone="line" fill kind="view" value=${tab} onSelect=${setTab} label=${x('addModal.title')}
      items=${[{ value: 'paste', label: x('tab.paste') }, { value: 'file', label: x('tab.file') }]} />
    <${Box} tone="tabbed">
      <${Fields} plain>
        ${tab === 'paste'
          ? html`<${TextArea} code rows=${10} label=${pasteLabel} value=${paste} onInput=${onPaste}
              placeholder=${x('addModal.pastePh')} spellCheck=${false} />`
          : html`<${FileDrop} ink label=${x('addModal.htmlFile')} accept=".html,.htm,.zip" onFiles=${onFiles}
              mark="📄" dropLabel=${x('addModal.drop')} orLabel=${x('common.or')} browseLabel=${x('addModal.browse')}
              chosen=${file ? file.name : ''} />`}
      <//>
    <//>
    <${Fields} plain>
      <${TextField} label=${x('addModal.name')} value=${name} onInput=${setName} placeholder=${x('addModal.namePh')} autoComplete="off" />
      <${Field} label=${x('addModal.icon')} hint=${x('addModal.iconHint')} group>
        <${TextField} size="glyph" maxLength=${4} value=${icon} onInput=${setIcon} placeholder="📝"
          ariaLabel=${x('addModal.icon')} autoComplete="off"
          actions=${html`<${Tabs} tone="glyph" value=${icon} onSelect=${setIcon} label=${x('addModal.icon')}
            items=${ICONS.map((g) => ({ value: g, label: g }))} />`} />
      <//>
      <${Field} id="appcat-add-tags" label=${x('addModal.tags')} labelNote=${x('addModal.tagsHint')}>
        <${TextField} id="appcat-add-tags" value=${tags} onInput=${setTags} placeholder=${x('addModal.tagsPh')} autoComplete="off" />
      <//>
    <//>
  <//>`;
}
