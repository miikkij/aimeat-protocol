/**
 * @file collaboration.js
 * @description Shared app discovery, roadmap editing and a publication change note.
 * @version-history
 *   v1.11.0 — 2026-09-26 — "Show the shared ones" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.10.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — The shared apps are the Listing (listing, listing-row and its name and doors cells), a unification: the look most tabs use.
 *   v1.7.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.1 — 2026-09-13 — The publish dialog's submit sits in the dialog's footer and names its form.
 *   v1.0.0 - 2026-09-08 - Make collaboration usable from the Apps page.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { PageSection } from '/components/PageSection.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { listApps } from '/js/services/apps.js';
import { swallowed } from '/js/swallowed.js';
import { a, nameOf, appRef, day } from './frame.js';
import { Hint } from '/components/Hint.js';
const html = htm.bind(h);
const pathOf = app => `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}`;

export function PublishDialog({ app, busy, onPublish, onClose }) {
  const [line, setLine] = useState('');
  // The submit sits in the footer, outside the form, and names the form it submits.
  return html`<${Modal} open=${true} title=${a('publishDraft')} onClose=${onClose} className="ap-publish-modal"
    footer=${html`<button type="submit" form="ap-publish-form" class="poster-slab poster-slab--control" disabled=${busy || (!!line.trim() && line.trim().length < 3)}>${a('publishDraft')}</button>`}>
    <form id="ap-publish-form" class="ap-form" onSubmit=${e => { e.preventDefault(); onPublish(app, line); }}>
      <${Hint}>${a('publishConfirm', { name: nameOf(app) })}<//>
      <label class="ap-field ap-field--wide"><span class="poster-label">${a('roadPublishLabel')}</span>
        <textarea class="og-textarea" rows="3" maxLength="600" value=${line} onInput=${e => setLine(e.target.value)} />
      </label>
      <${Hint}>${a('roadPublishHint')}<//>
    </form>
  <//>`;
}

export function CollaborationSection({ ctx }) {
  const [showShared, setShowShared] = useState(false);
  const [shared, setShared] = useState(null);
  const [sharedError, setSharedError] = useState(false);
  const [selected, setSelected] = useState('');
  const [road, setRoad] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [inside, setInside] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [what, setWhat] = useState('');
  const [state, setState] = useState('wanted');
  const apps = [...(ctx.apps || []), ...(showShared ? shared || [] : [])];
  const app = apps.find(x => appRef(x) === selected);
  const owner = app?.owner === ctx.session.owner;
  const selectedPath = app ? pathOf(app) : null;

  useEffect(() => {
    if (!showShared) return;
    let active = true;
    setSharedError(false);
    listApps({ building: true }).then(rows => { if (active) setShared(rows); })
      .catch(err => { swallowed('apps: shared list', err); if (active) setSharedError(true); });
    return () => { active = false; };
  }, [showShared, ctx.apps]);

  useEffect(() => {
    setLoaded(false); setFailed(false); setRoad(null); setWhat(''); setState('wanted');
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    let active = true;
    apiGet(`${selectedPath}/roadmap`).then(res => {
      if (active) { setRoad(res.data.roadmap); setInside(res.data.inside_the_build); setLoaded(true); }
    }).catch(err => { swallowed('apps: roadmap', err); if (active) setFailed(true); });
    return () => { active = false; };
  }, [selectedPath, ctx.apps]);

  async function change(fn) {
    setBusy(true);
    try {
      await fn();
      const res = await apiGet(`${pathOf(app)}/roadmap`);
      setRoad(res.data.roadmap); setWhat('');
    } catch (err) { ctx.showToast?.(err?.message || a('roadFailed'), true); }
    finally { setBusy(false); }
  }

  return html`<${PageSection} id="ap-collaboration" num="07" title=${a('roadTitle')}>
    <label class="ap-hint check-line"><input type="checkbox" checked=${showShared} onChange=${e => setShowShared(e.target.checked)} /> ${a('sharedShow')}</label>
    ${showShared && sharedError ? html`<p role="alert" class="poster-quiet ap-empty">${a('sharedFailed')}</p>` : null}
    ${showShared && !sharedError && shared === null ? html`<p class="poster-quiet ap-empty loading-mark">${a('bldLoading')}</p>` : null}
    ${showShared && shared?.length === 0 ? html`<p class="poster-quiet ap-empty">${a('sharedNone')}</p>` : null}
    ${showShared && shared?.length ? html`<div class="listing listing--cols listing--name-doors">${shared.map(x => html`<div key=${appRef(x)} class="listing-row">
      <div class="listing-name">${nameOf(x)}<small>${x.owner} · ${a('bldRung_' + x.dev_level_name)}</small></div>
      <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" onClick=${() => setSelected(appRef(x))}>${a('roadOpen')}</button>
        ${x.has_draft && x.dev_level <= 10 ? html`<button class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.publishDraft(x)}>${a('publishDraft')}</button>` : null}
      </div>
    </div>`)}</div>` : null}
    <label class="ap-field"><span class="poster-label">${a('roadApp')}</span><select class="select-field" value=${selected} onChange=${e => setSelected(e.target.value)}>
      <option value="">${a('roadChoose')}</option>
      ${apps.map(x => html`<option key=${appRef(x)} value=${appRef(x)}>${nameOf(x)} · ${x.owner}</option>`)}
    </select></label>
    ${app && failed ? html`<p class="poster-quiet ap-empty" role="alert">${a('roadFailed')}</p>` : null}
    ${app && !loaded && !failed ? html`<p class="poster-quiet ap-empty loading-mark">${a('bldLoading')}</p>` : null}
    ${app && loaded ? html`
      <${Hint}>${a(road?.wantedVisibility === 'everyone' ? 'roadPublicHint' : 'roadPrivateHint')}<//>
      ${owner ? html`<label class="ap-field"><span class="poster-label">${a('roadVisibility')}</span><select class="select-field" disabled=${busy}
        value=${road?.wantedVisibility || 'developers'} onChange=${e => change(() => apiPatch(`${pathOf(app)}/roadmap`, { wanted_visibility: e.target.value }))}>
        <option value="developers">${a('roadDevelopers')}</option><option value="everyone">${a('roadEveryone')}</option>
      </select></label>` : null}
      ${['done', 'wanted'].map(half => html`<div key=${half}>
        <h3>${a(half === 'done' ? 'roadDone' : 'roadWanted')}</h3>
        ${(road?.entries || []).filter(e => e.state === half).length ? html`<div class="ap-rows">
          ${road.entries.filter(e => e.state === half).map(e => html`<div key=${e.id} class="ap-row">
            <div class="ap-row-main"><p class="ap-road-text">${e.what}</p><small>${e.by} · ${day(e.at)}${e.version ? ` · v${e.version}` : ''}</small></div>
            ${owner || (e.state === 'wanted' && e.by === ctx.session.owner) ? html`<button class="poster-action poster-action--small" disabled=${busy}
              onClick=${() => change(() => apiDelete(`${pathOf(app)}/roadmap/${encodeURIComponent(e.id)}`))}>${a('roadRemove')}</button>` : null}
          </div>`)}</div>` : html`<p class="poster-quiet ap-empty">${a('roadEmpty')}</p>`}
      </div>`)}
      <form class="ap-form" onSubmit=${e => { e.preventDefault(); change(() => apiPost(`${pathOf(app)}/roadmap`, { state, what })); }}>
        <label class="ap-field"><span class="poster-label">${a('roadState')}</span><select class="select-field" value=${state} onChange=${e => setState(e.target.value)}>
          <option value="wanted">${a('roadWanted')}</option>${inside ? html`<option value="done">${a('roadDone')}</option>` : null}
        </select></label>
        <label class="ap-field ap-field--wide"><span class="poster-label">${a('roadWhat')}</span><textarea class="og-textarea" rows="3" maxLength="600" required value=${what} onInput=${e => setWhat(e.target.value)} /></label>
        <button class="poster-slab poster-slab--control" type="submit" disabled=${busy || what.trim().length < 3}>${a('roadAdd')}</button>
      </form>
    ` : null}
  <//>`;
}
