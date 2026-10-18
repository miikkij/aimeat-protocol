/**
 * @file public/views/appcat/sections/manage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Manage on server" (features F321–F322, F126, routes F192–F194): the
 *   switches on the person's own published app. Where it is listed (Listed, Community, Unlisted; a
 *   change publishes no new version), Allow forking / Forking: on, the access code (🔒 while one is set) with its
 *   editor inline under the row, Protection (🛡✓ while a flag is on), Versions, App access (the grants
 *   the person gave this app) and, for an operator, Subdomain. The four last open appcat's dialogs by
 *   name (`protect`, `versions`, `consents`, `subdomain`) with { app, owner, filename, name,
 *   manifest, protection, onDone }. A listing or fork change redraws only this section, so the page keeps its
 *   scroll, and then reads the listing again. Delete stays under Actions, the one door out, as on the
 *   old page. The shell draws the chapter line and the headline from `meta`; this is the body.
 * @structure meta · ManageSection({ d }) · AccessCode({ d, onSaved, onCancel }) · OpenTo({ d, raw, onSet, busy })
 * @usage const mod = await import('./sections/manage.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.4.0 — 2026-10-18 — The app's classification under who can open it, which the owner changes there
 *     while classification is on (ContainerLabel; plan doc-mvdipuyqraas, L4.4).
 *   v1.3.0 — 2026-10-18 — Who can open it, under the listing: anyone with the link, people signed in
 *     here, or the members of one shared place the owner belongs to (`open_to` on PATCH
 *     /v1/apps/:filename), and the sentence that says it (plan doc-mvcn6c7e4e5q, V2.5).
 *   v1.2.0 — 2026-10-12 — The Unlist / List publicly button becomes a three-way choice: Listed,
 *     Community (only people signed in to this node see it in the community list) and Unlisted, with
 *     a line under it that says who sees the app.
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
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { LISTINGS, OPEN_TO, stateOf, openToOf, openToPlace, openToSentenceKey } from '/views/appcat/model.js';
import { getSession } from '/js/services/auth.js';
import { apiGet } from '/js/api.js';
import { signedInOnly } from '/js/site.js';
import { x } from '/views/appcat/i18n.js';
import { patchApp, errorText, isOperator, noticeKind } from '/views/appcat/sections/app-write.js';
import { ContainerLabel } from '/views/profile/classification/container-label.js';
import { Space } from '/components/Layout.js';

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

/**
 * Who can open the app (PATCH /v1/apps/:filename `open_to`), beside its listing: anyone with the link,
 * people signed in here, or the members of one shared place the owner belongs to. Choosing a place
 * writes nothing until the place is picked. The sentence under it is the one the app's detail head
 * shows to everybody (appcat.openTo.*).
 */
function OpenTo({ d, raw, onSet, busy }) {
  const row = { open_to: raw };
  const value = openToOf(row) || 'anyone';
  const place = openToPlace(row);
  // The shared places the owner is a member of, read once when the section opens.
  const [places, setPlaces] = useState(null);
  // 'organism' chosen while no place is picked yet: the picker shows, nothing is written.
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const owner = getSession()?.owner;
    if (!owner) { setPlaces([]); return undefined; }
    let live = true;
    apiGet('/v1/organisms?member=' + encodeURIComponent(owner)).then((json) => {
      if (live) setPlaces((json.data && json.data.organisms) || []);
    }).catch((e) => { console.warn('[appcat] shared places not read; the place choice stays closed', e); if (live) setPlaces([]); });
    return () => { live = false; };
  }, [d.ref]);
  useEffect(() => { setPicking(false); }, [value, place]);

  const shown = picking ? 'organism' : value;
  const noPlaces = Array.isArray(places) && places.length === 0;
  const choose = (v) => {
    if (busy || v === shown) return;
    if (v === 'organism') { setPicking(true); return; }
    setPicking(false);
    onSet(v === 'signedIn' ? 'signed-in' : 'anyone');
  };
  const placeName = place && Array.isArray(places) ? (places.find((o) => o.id === place) || {}).name || '' : '';
  // While a place is being picked, nothing is said: the setting has not changed yet.
  let sentence = '';
  if (!picking) sentence = value === 'organism' && placeName
    ? x('openTo.organismNamed', { place: placeName })
    : x(openToSentenceKey(row.open_to ? row : { open_to: 'anyone' }, signedInOnly()));
  return html`
    <${Fields} plain chapter>
      <${Choice} label=${x('manage.openToLabel')} value=${shown} onChange=${choose}
        options=${OPEN_TO.map((v) => ({
          value: v, label: x('manage.openTo.' + v),
          disabled: v === 'organism' && noPlaces, title: v === 'organism' && noPlaces ? x('manage.openToNoPlaces') : undefined,
        }))} />
      ${shown === 'organism' && Array.isArray(places) && places.length ? html`
        <${Select} line fit label=${x('manage.openToPlace')} value=${picking ? '' : place}
          placeholder=${x('manage.openToPick')} placeholderDisabled disabled=${busy}
          options=${places.map((o) => [o.id, o.name || o.id])}
          onChange=${(id) => { if (id && id !== place) onSet('organism:' + id); }} />` : null}
    <//>
    ${sentence ? html`<${Note} kind="quiet" chapter>${sentence}<//>` : null}`;
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
  useEffect(() => { setLocal({}); }, [app.listing, app.parked, app.forkable, app.protected, app.open_to]);

  const listing = 'listing' in local ? local.listing : stateOf(app);
  const openTo = 'open_to' in local ? local.open_to : app.open_to;
  const forkable = 'forkable' in local ? local.forkable : !!app.forkable;
  const hasCode = 'protected' in local ? local.protected : !!app.protected;
  const prot = (app.manifest && app.manifest.protection) || {};
  const anyProt = !!(prot.obfuscate || prot.domainLock || prot.watermark || prot.noRawDownload);

  /** Set one switch on the record (listing, open_to or forkable). */
  const flip = async (key, value) => {
    if (busy || (key === 'listing' && value === listing)) return;
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
    <${Fields} plain chapter>
      <${Choice} label=${x('manage.listing')} value=${listing}
        onChange=${(v) => flip('listing', v)} options=${LISTINGS.map((v) => [v, x('state.' + v)])} />
    <//>
    <${Note} kind="quiet" chapter>${x('manage.listingHint.' + listing)}<//>
    <${OpenTo} d=${d} raw=${openTo} busy=${busy} onSet=${(v) => flip('open_to', v)} />
    <${Fields} plain chapter>
      <${Space} below="medium">
        <${ContainerLabel} kind="app" app=${d.filename} canSet chapter showToast=${(m, kind) => d.notice(m, kind === 'success' || kind === 'error' ? kind : noticeKind(m))} />
      <//>
    <//>
    <${Actions} chapter>
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
