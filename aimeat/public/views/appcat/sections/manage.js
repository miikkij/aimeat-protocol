/**
 * @file public/views/appcat/sections/manage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Manage on server" (features F321–F322, F126, routes F192–F194): the
 *   switches on the person's own published app. Unlist / List publicly (its tooltip says it does not
 *   publish a new version), Allow forking / Forking: on, the access code (🔒 while one is set) with its
 *   editor inline under the row, Protection (🛡✓ while a flag is on), Versions, App access (the grants
 *   the person gave this app) and, for an operator, Subdomain. The four last open appcat's dialogs by
 *   name (`protect`, `versions`, `consents`, `subdomain`) with { app, owner, filename, name,
 *   manifest, protection, onDone }. A park or fork change redraws only this section, so the page keeps its
 *   scroll, and then reads the listing again. Delete stays under Actions, the one door out, as on the
 *   old page. The shell draws the chapter line and the headline from `meta`; this is the body.
 * @structure meta · ManageSection({ d }) · AccessCode({ d, onSaved, onCancel })
 * @usage const mod = await import('./sections/manage.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity pass (sections-b): the doors as the chapter's row (.dtl-btn-row), not
 *     dimmed while a switch is on its way; the access code editor as the old .dtl-ac-editor (the
 *     chapter's plain form, its grey line, its doors, the status line in the old colours), opened
 *     afresh, empty and in focus, on every press.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's serverMgmtInner, the access-code editor
 *     (js/detail.js) and toggleParkApp / toggleForkApp (js/server-io.js) on components (appcat
 *     detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { getSession } from '/js/services/auth.js';
import { x } from '/views/appcat/i18n.js';
import { patchApp, errorText, isOperator, noticeKind } from '/views/appcat/sections/app-write.js';

const html = htm.bind(h);

export const meta = { id: 'manage', title: 'detail.serverMgmt', show: (d) => !!(d && d.isOwnPublished) };

/** The inline access-code editor: never pre-filled; empty on Save removes the code. */
function AccessCode({ d, onSaved, onCancel }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (!getSession()?.jwt) { const t = x('common.loginRequired'); d.notice(t, noticeKind(t)); return; }
    const value = code.trim();
    if (value && (value.length < 4 || value.length > 64)) { setStatus({ text: '✘ ' + x('detail.accessCodeLen'), tone: 'refused' }); return; }
    setBusy(true);
    setStatus({ text: x('detail.savingAccess'), tone: 'busy' });
    try {
      await patchApp(d.filename, { access_code: value || null });
      setBusy(false);
      onSaved(!!value);
      // The kind the old page read from the words: "…removed…" a success, "…set…" a plain notice.
      const done = x(value ? 'detail.accessCodeSet' : 'detail.accessCodeCleared');
      d.notice(done, noticeKind(done));
    } catch (err) {
      setBusy(false);
      setStatus({ text: '✘ ' + errorText(err, x('manage.failedWord')), tone: 'refused' });
    }
  };
  // As the old .dtl-ac-editor: the label and the hidden field, its grey line, the two doors (neither
  // waits while it saves), and the status line that keeps its room.
  return html`
    <${Fields} plain chapter>
      <${TextField} secret autoFocus label=${x('detail.accessCodeLabel')} value=${code} onInput=${setCode} onEnter=${save}
        maxLength=${64} placeholder=${x('detail.accessCodePh')} showLabel=${x('secret.show')} hideLabel=${x('secret.hide')} />
    <//>
    <${Note} kind="quiet" chapter>${x('detail.accessCodeRemoveHint')}<//>
    <${Actions} chapter>
      <${Loud} control onClick=${save}>${x('detail.saveDetails')}<//>
      <${Action} small onClick=${onCancel}>${x('detail.cancelEdit')}<//>
    <//>
    <${Note} kind="report" chapter keep tone=${status ? status.tone : undefined}>${status ? status.text : ''}<//>`;
}

export default function ManageSection({ d }) {
  const app = d.app || {};
  // The row's state, flipped at once after a write so the switches answer before the listing does.
  const [local, setLocal] = useState({});
  // The editor's round: 0 closed; each press of "Access code" opens it afresh, empty and in focus, as
  // the old page redrew it.
  const [editing, setEditing] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLocal({}); setEditing(0); }, [d.ref]);
  // A fresh listing row is the truth again once it has come.
  useEffect(() => { setLocal({}); }, [app.parked, app.forkable, app.protected]);

  const parked = 'parked' in local ? local.parked : !!app.parked;
  const forkable = 'forkable' in local ? local.forkable : !!app.forkable;
  const hasCode = 'protected' in local ? local.protected : !!app.protected;
  const prot = (app.manifest && app.manifest.protection) || {};
  const anyProt = !!(prot.obfuscate || prot.domainLock || prot.watermark || prot.noRawDownload);

  /** Flip one switch on the record (parked or forkable). */
  const flip = async (key, value) => {
    if (busy) return;
    if (!getSession()?.jwt) { const t = x('common.loginRequired'); d.notice(t, noticeKind(t)); return; }
    setBusy(true);
    try {
      await patchApp(d.filename, { [key]: value });
      setLocal((s) => ({ ...s, [key]: value }));
      d.reload?.();
    } catch (err) {
      d.notice(x('manage.failed', { message: errorText(err, x('manage.unknownError')) }), 'error');
    }
    setBusy(false);
  };
  const props = { app: d.app, owner: d.owner, filename: d.filename, name: (app.manifest && app.manifest.name) || d.filename,
    manifest: app.manifest, protection: prot, onDone: d.reload };

  // The switches do not dim while a change is on its way, as on the old page; a second press waits.
  return html`
    <${Actions} chapter>
      ${parked
        ? html`<${Action} small title=${x('card.unparkHint')} onClick=${() => flip('parked', false)}>${x('card.unpark')}<//>`
        : html`<${Action} small title=${x('card.parkHint')} onClick=${() => flip('parked', true)}>${x('card.park')}<//>`}
      <${Action} small title=${x(forkable ? 'card.forkableOnHint' : 'card.forkableOffHint')}
        onClick=${() => flip('forkable', !forkable)}>${x(forkable ? 'card.forkableOn' : 'card.forkableOff')}<//>
      <${Action} small title=${x('detail.accessCodeHint')} expanded=${editing > 0} onClick=${() => setEditing((n) => n + 1)}>${hasCode ? '🔒 ' : ''}${x('detail.editAccess')}<//>
      <${Action} small title=${x('card.protectHint')} onClick=${() => d.openDialog('protect', props)}>${anyProt ? '🛡✓ ' : ''}${x('card.protect')}<//>
      <${Action} small onClick=${() => d.openDialog('versions', props)}>${x('card.versions')}<//>
      <${Action} small title=${x('card.consentsHint')} onClick=${() => d.openDialog('consents', props)}>${x('card.consents')}<//>
      ${isOperator() ? html`<${Action} small title=${x('card.subdomainHint')} onClick=${() => d.openDialog('subdomain', props)}>${x('card.subdomain')}<//>` : null}
    <//>
    ${editing ? html`<${AccessCode} key=${editing} d=${d} onCancel=${() => setEditing(0)}
      onSaved=${(on) => { setLocal((s) => ({ ...s, protected: on })); setEditing(0); d.reload?.(); }} />` : null}`;
}
