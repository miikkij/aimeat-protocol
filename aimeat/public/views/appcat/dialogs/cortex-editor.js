/**
 * @file public/views/appcat/dialogs/cortex-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension editor (features F99–F103), for the one who installed the extension:
 *   "{name} · in use / not in use", a status line ("Loading the extension…", "Loaded, library files:
 *   {n}", "Saving…", "Saved.", "Could not save: …"), the YAML manifest, one block per library file
 *   (its file name, Remove, its source), "+ Add Lib File" (a block named new-lib.js), "Export Files"
 *   at the footer's start (the manifest as {name}.yaml and each library file, as downloads), Cancel,
 *   and "Save & Re-install" (PUT /v1/cortex/{name} {manifest, libs}: an atomic replace that keeps the
 *   extension's state). Signed out it does not open: the notice "Sign in as the owner to edit
 *   extensions." After a save the page's Active Extensions bar is read again.
 * @structure default CortexEditorDialog({ name }) · download(name, text, type)
 * @usage openDialog('cortex-editor', { name })  — props: name (the extension's full name).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the name and status lines in the old grey typewriter face (a refusal
 *     in coral), the manifest under its plain label in the extension file's frame (TextArea script),
 *     each library file in the same frame.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old cortex.js editor.
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Stack, Row } from '/components/Layout.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { apiGet, apiPut } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import * as store from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';

const html = htm.bind(h);

/** Save one text as a download; the object URL goes once the click has taken it. */
function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Tell the page its Active Extensions bar is stale (the shell reads it again). */
function reloadBar() {
  window.dispatchEvent(new CustomEvent('appcat-cortex-changed'));
}

export default function CortexEditorDialog({ name, close }) {
  const signedIn = !!getSession();
  const [extName, setExtName] = useState(name);
  const [active, setActive] = useState(null);
  const [manifest, setManifest] = useState('');
  const [libs, setLibs] = useState([]);
  const [status, setStatus] = useState({ text: x('cortex.loadingData'), err: false });
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    if (!signedIn) { store.notice(x('cortex.needOwner')); close?.(); return undefined; }
    let live = true;
    apiGet('/v1/cortex/' + encodeURIComponent(name) + '/export').then((json) => {
      if (!live) return;
      const ext = json.data || {};
      const files = Object.keys(ext.libs || {});
      setExtName(ext.name || name);
      setActive(ext.status === 'active');
      setManifest(ext.manifest || '');
      setLibs(files.map((f) => ({ id: ++counter.current, file: f, content: ext.libs[f] || '' })));
      setStatus({ text: x('cortex.loaded', { n: files.length }), err: false });
    }).catch((e) => {
      if (live) setStatus({ text: x('cortex.loadFailed', { msg: e.message || String(e) }), err: true });
    });
    return () => { live = false; };
  }, [name, signedIn, close]);

  if (!signedIn) return null;

  const setLib = (id, patch) => setLibs((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const collect = () => {
    const out = {};
    for (const l of libs) { const f = l.file.trim(); if (f) out[f] = l.content; }
    return out;
  };

  const save = async () => {
    if (!getSession()) { store.notice(x('cortex.needOwner')); return; }
    if (!manifest.trim()) { store.notice(x('cortex.manifestEmpty')); return; }
    setBusy(true);
    setStatus({ text: x('cortex.saving'), err: false });
    try {
      const json = await apiPut('/v1/cortex/' + encodeURIComponent(extName), { manifest, libs: collect() });
      if (json.data && json.data.name) setExtName(json.data.name);
      setStatus({ text: x('cortex.saved'), err: false });
      reloadBar();
    } catch (e) {
      const errs = e.response?.error?.details?.errors;
      const msg = (e.message || '') + (Array.isArray(errs) ? ': ' + errs.join('; ') : '');
      setStatus({ text: x('cortex.saveFailed', { msg }), err: true });
    } finally {
      setBusy(false);
    }
  };

  const exportFiles = () => {
    const base = (extName || 'extension').replace(/\//g, '-');
    download(base + '.yaml', manifest, 'text/yaml');
    const files = collect();
    for (const f of Object.keys(files)) download(f, files[f], 'application/javascript');
  };

  const footer = html`
    <${Action} onClick=${close}>${x('common.cancel')}<//>
    <${Loud} control disabled=${busy} onClick=${save}>${x('cortex.saveReinstall')}<//>`;
  return html`<${Dialog} title=${x('cortex.editorTitle')} size="lg" footer=${footer}
    footerStart=${html`<${Action} onClick=${exportFiles}>${x('cortex.exportFiles')}<//>`}>
    <${Stack} gap="medium">
      ${active !== null ? html`<${Note} kind="caption" mono tone="faint">${extName} · ${x(active ? 'cortex.stateActive' : 'cortex.stateInactive')}<//>` : null}
      ${status.err
        ? html`<${Note} kind="report" tone="refused">${status.text}<//>`
        : html`<${Note} kind="caption" mono tone="faint">${status.text}<//>`}
    <//>
    <${Fields} plain>
      <${TextArea} label=${x('cortex.manifest')} script="long" spellCheck=${false} value=${manifest} onInput=${setManifest} />
    <//>
    <${Stack} gap="medium">
      ${libs.map((l) => html`<${Box} key=${l.id}>
        <${Stack} gap="small">
          <${Row} gap="medium" wrap justify="between">
            <${Fields} plain><${TextField} label=${x('cortex.libName')} code value=${l.file} onInput=${(v) => setLib(l.id, { file: v })} /><//>
            <${Action} small tone="danger" onClick=${() => setLibs((all) => all.filter((o) => o.id !== l.id))}>${x('cortex.remove')}<//>
          <//>
          <${TextArea} script spellCheck=${false} ariaLabel=${l.file} value=${l.content} onInput=${(v) => setLib(l.id, { content: v })} />
        <//>
      <//>`)}
      <div><${Action} small onClick=${() => setLibs((all) => [...all, { id: ++counter.current, file: 'new-lib.js', content: '' }])}>${x('cortex.addLib')}<//></div>
    <//>
  <//>`;
}
