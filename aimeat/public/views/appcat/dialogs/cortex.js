/**
 * @file public/views/appcat/dialogs/cortex.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension popup (features F96–F98): what one active extension offers an app. The
 *   title is the extension's name; the body says "Loading…", then the description, "What your apps can
 *   use", per library file the script tag an app loads (with Copy) and, when the library has one, what
 *   it offers (API, with Copy API), per schema the key it checks, per prompt its first 150 characters
 *   (with Copy prompt). Copy says "Copied" for 1.5 s. The one who installed the extension gets "Edit
 *   extension" at the footer's start, which opens the editor in this dialog's place. Read with an
 *   anonymous token (F244, F246), as the old page read it.
 * @structure default CortexDialog({ name, token }) · Part · CopyWord
 * @usage openDialog('cortex', { name: ext.name })  — props: name (the extension's full name, as the
 *   bar's chip carries it); token (optional: an anonymous token the caller already holds; without it
 *   the dialog mints one).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the description in the old light grey at the running size, the
 *     "What your apps can use" label over the ink rule (Label ruled), each part under a hairline with
 *     its code framed (Box part), the loading and prompt lines in the grey typewriter face.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old cortex.js showCortexPopup.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Label, Code } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { copyToClipboard } from '/js/utils.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { useFlash } from '/views/appcat/dialogs/parts.js';
import { anonymousToken, apiWithToken, me, sameOwner } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

/** A copy word: copies `text`, then says "Copied" for 1.5 s (the old cortexCopy). */
function CopyWord({ text, label }) {
  const [on, flash] = useFlash(1500);
  return html`<${Action} small onClick=${async () => { await copyToClipboard(text); flash(); }}>${on ? x('cortex.copied') : label}<//>`;
}

/** One part of what the extension offers, under a hairline (the old .cx-part). */
function Part({ children }) {
  return html`<${Box} tone="part">${children}<//>`;
}

export default function CortexDialog({ name, token, close }) {
  const [ext, setExt] = useState(null);
  const [err, setErr] = useState(null);
  const [noToken, setNoToken] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const tok = token || (await anonymousToken());
      if (!live) return;
      if (!tok) { setNoToken(true); return; }
      try {
        const json = await apiWithToken('/v1/cortex/' + encodeURIComponent(name), tok);
        if (live) setExt(json.data || {});
      } catch (e) {
        if (live) setErr(e.message || String(e));
      }
    })();
    return () => { live = false; };
  }, [name, token]);

  const node = location.origin;
  const comps = (ext && ext.components) || [];
  const libs = comps.filter((c) => c.type === 'lib');
  const schemas = comps.filter((c) => c.type === 'schema');
  const prompts = comps.filter((c) => c.type === 'prompt');
  // Only the one who installed it sees the edit door; the node refuses everyone else anyway.
  const isOwner = !!ext && sameOwner(ext.installed_by, me());

  let body;
  if (noToken) body = html`<${Note} kind="caption" mono tone="faint">${x('cortex.noToken')}<//>`;
  else if (err) body = html`<${Note} kind="report" tone="refused">${x('cortex.loadFailed', { msg: err })}<//>`;
  else if (!ext) body = html`<${Note} kind="caption" mono tone="faint">${x('cortex.loading')}<//>`;
  else {
    body = html`<div>
      ${ext.description ? html`<${Note} kind="caption" size="body" tone="faint">${ext.description}<//>` : null}
      <${Label} ruled>${x('cortex.forApps')}<//>
      ${libs.map((lib) => {
        const tag = `<script src="${node}/v1/cortex/${encodeURIComponent(name)}/libs/${encodeURIComponent(lib.filename)}"></script>`;
        return html`<${Part} key=${'l' + lib.filename}>
          <strong>${x('cortex.lib')} <${Code}>${lib.filename}<//></strong>
          <${Code} block>${tag}<//>
          <div><${CopyWord} text=${tag} label=${x('cortex.copy')} /></div>
          ${lib.api_surface ? html`
            <strong>${x('cortex.apiSurface')}</strong>
            <${Code} block scroll="medium">${lib.api_surface}<//>
            <div><${CopyWord} text=${lib.api_surface} label=${x('cortex.copyApi')} /></div>` : null}
        <//>`;
      })}
      ${schemas.map((s) => html`<${Part} key=${'s' + s.key_pattern}>
        <span>${x('cortex.schema')} <${Code}>${s.key_pattern}<//>: ${x('cortex.schemaNote')}</span>
      <//>`)}
      ${prompts.map((p) => html`<${Part} key=${'p' + p.name}>
        <strong>${x('cortex.prompt')} ${p.name}</strong>
        <${Note} kind="caption" mono tone="faint">“${String(p.content || '').substring(0, 150)}…”<//>
        <div><${CopyWord} text=${p.content || ''} label=${x('cortex.copyPrompt')} /></div>
      <//>`)}
    </div>`;
  }

  const footerStart = isOwner
    ? html`<${Action} onClick=${() => openDialog('cortex-editor', { name: ext.name || name })}>${x('cortex.edit')}<//>`
    : null;
  return html`<${Dialog} title=${(ext && ext.name) || name} size="md" footerStart=${footerStart}
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    ${body}
  <//>`;
}
