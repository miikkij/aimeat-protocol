/**
 * @file public/views/appcat/dialogs/subdomain.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Assign an app its own subdomain (features F138, F185–F187), for the node's operator:
 *   "Assign Subdomain", the target "{owner}/{filename}", the Subdomain field (prefilled with the one it
 *   has, lower-cased on save; only emptiness is checked here: "Enter a subdomain first"), Unassign at
 *   the footer's start when it has one, Cancel and Save. Saving the same value just closes. The new
 *   mapping is made first and the old one removed after it, so the app is never left without one on a
 *   failure. Status: "Saving...", "✔ Subdomain assigned — {sub}.{app host}", "✔ Subdomain unassigned",
 *   or the node's refusal. The dialog reads the node's current mappings itself when it opens.
 * @structure default SubdomainDialog({ owner, filename })
 * @usage openDialog('subdomain', { owner, filename })  — props: owner, filename; onDone (optional:
 *   called after an assign or unassign). The caller shows the
 *   door only to an operator (isOperator() in ./app-io.js); the node refuses everyone else.
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the target in the small grey line, the field in the old dialog
 *     form (Fields plain), the status line holding its room; a refusal in red.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old server-io.js subdomain modal.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { reloadCatalog } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { appHost, bareOwner, isOperator } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

export default function SubdomainDialog({ owner, filename, onDone, close }) {
  const target = bareOwner(owner) + '/' + filename;
  const [existing, setExisting] = useState(null);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOperator()) return undefined;
    let live = true;
    apiGet('/v1/admin/subdomains').then((json) => {
      if (!live) return;
      const site = ((json.data && json.data.sites) || []).find((s) => s.kind === 'app' && s.target === target);
      if (site) { setExisting(site.subdomain); setValue(site.subdomain); }
    }).catch((e) => console.warn('[appcat] subdomains not read; the field starts empty', e));
    return () => { live = false; };
  }, [target]);

  const save = async () => {
    const sub = value.trim().toLowerCase();
    if (!sub) { setStatus({ text: x('subModal.empty'), tone: 'err' }); return; }
    if (sub === existing) { close?.(); return; }
    setBusy(true);
    setStatus({ text: x('subModal.saving'), tone: 'busy' });
    try {
      await apiPost('/v1/admin/subdomains', { subdomain: sub, kind: 'app', target });
      if (existing) await apiDelete('/v1/admin/subdomains/' + encodeURIComponent(existing));
      setExisting(sub);
      setStatus({ text: '✔ ' + x('subModal.assigned') + ' — ' + sub + '.' + appHost(), tone: 'ok' });
      reloadCatalog();
      onDone?.();
    } catch (e) {
      setStatus({ text: e.message || String(e), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const unassign = async () => {
    if (!existing) return;
    setBusy(true);
    setStatus({ text: x('subModal.saving'), tone: 'busy' });
    try {
      await apiDelete('/v1/admin/subdomains/' + encodeURIComponent(existing));
      setExisting(null);
      setStatus({ text: '✔ ' + x('subModal.unassigned'), tone: 'ok' });
      reloadCatalog();
      onDone?.();
    } catch (e) {
      setStatus({ text: e.message || String(e), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const footer = html`
    <${Action} onClick=${close}>${x('common.cancel')}<//>
    <${Loud} control disabled=${busy} onClick=${save}>${x('common.save')}<//>`;
  return html`<${Dialog} title=${x('subModal.title')} size="md" footer=${footer}
    footerStart=${existing ? html`<${Action} disabled=${busy} onClick=${unassign}>${x('subModal.unassign')}<//>` : null}>
    <${Note} kind="caption">${target}<//>
    <${Fields} plain>
      <${TextField} label=${x('subModal.label')} placeholder=${x('subModal.ph')} hint=${x('subModal.hint')}
        autoComplete="off" value=${value} onInput=${setValue} onEnter=${save} />
    <//>
    <${Status} keep status=${status} />
  <//>`;
}
