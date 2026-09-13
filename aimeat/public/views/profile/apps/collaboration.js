/**
 * @file collaboration.js
 * @description Shared app discovery, roadmap editing and a publication change note.
 * @version-history
 *   v1.0.1 — 2026-09-13 — The publish dialog's submit sits in the dialog's footer and names its form.
 *   v1.0.0 - 2026-09-08 - Make collaboration usable from the Apps page.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { Section } from '/views/profile/organisms/poster-parts.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { listApps } from '/js/services/apps.js';
import { swallowed } from '/js/swallowed.js';
import { a, nameOf, appRef, day } from './frame.js';
const html = htm.bind(h);
const pathOf = app => `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}`;

export function PublishDialog({ app, busy, onPublish, onClose }) {
  const [line, setLine] = useState('');
  // The submit sits in the footer, outside the form, and names the form it submits.
  return html`<${Modal} open=${true} title=${a('publishDraft')} onClose=${onClose} className="ap-publish-modal"
    footer=${html`<button type="submit" form="ap-publish-form" class="btn-primary" disabled=${busy || (!!line.trim() && line.trim().length < 3)}>${a('publishDraft')}</button>`}>
    <form id="ap-publish-form" class="ap-form" onSubmit=${e => { e.preventDefault(); onPublish(app, line); }}>
      <p class="ap-hint">${a('publishConfirm', { name: nameOf(app) })}</p>
      <label class="ap-field ap-field--wide"><span class="og-label">${a('roadPublishLabel')}</span>
        <textarea class="og-input" rows="3" maxLength="600" value=${line} onInput=${e => setLine(e.target.value)} />
      </label>
      <p class="ap-hint">${a('roadPublishHint')}</p>
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

  return html`<${Section} id="ap-collaboration" num="07" title=${a('roadTitle')}>
    <label class="ap-hint"><input type="checkbox" checked=${showShared} onChange=${e => setShowShared(e.target.checked)} /> ${a('sharedShow')}</label>
    ${showShared && sharedError ? html`<p role="alert" class="ap-empty">${a('sharedFailed')}</p>` : null}
    ${showShared && !sharedError && shared === null ? html`<p class="ap-empty">${a('bldLoading')}</p>` : null}
    ${showShared && shared?.length === 0 ? html`<p class="ap-empty">${a('sharedNone')}</p>` : null}
    ${showShared && shared?.length ? html`<div class="ap-rows">${shared.map(x => html`<div key=${appRef(x)} class="ap-row">
      <div class="ap-row-main"><b>${nameOf(x)}</b><small>${x.owner} · ${a('bldRung_' + x.dev_level_name)}</small></div>
      <div class="ap-row-ctl"><button class="og-door" onClick=${() => setSelected(appRef(x))}>${a('roadOpen')}</button>
        ${x.has_draft && x.dev_level <= 10 ? html`<button class="og-door" onClick=${() => ctx.publishDraft(x)}>${a('publishDraft')}</button>` : null}
      </div>
    </div>`)}</div>` : null}
    <label class="ap-field"><span class="og-label">${a('roadApp')}</span><select class="og-input" value=${selected} onChange=${e => setSelected(e.target.value)}>
      <option value="">${a('roadChoose')}</option>
      ${apps.map(x => html`<option key=${appRef(x)} value=${appRef(x)}>${nameOf(x)} · ${x.owner}</option>`)}
    </select></label>
    ${app && failed ? html`<p class="ap-empty" role="alert">${a('roadFailed')}</p>` : null}
    ${app && !loaded && !failed ? html`<p class="ap-empty">${a('bldLoading')}</p>` : null}
    ${app && loaded ? html`
      <p class="ap-hint">${a(road?.wantedVisibility === 'everyone' ? 'roadPublicHint' : 'roadPrivateHint')}</p>
      ${owner ? html`<label class="ap-field"><span class="og-label">${a('roadVisibility')}</span><select class="og-input" disabled=${busy}
        value=${road?.wantedVisibility || 'developers'} onChange=${e => change(() => apiPatch(`${pathOf(app)}/roadmap`, { wanted_visibility: e.target.value }))}>
        <option value="developers">${a('roadDevelopers')}</option><option value="everyone">${a('roadEveryone')}</option>
      </select></label>` : null}
      ${['done', 'wanted'].map(half => html`<div key=${half}>
        <h3>${a(half === 'done' ? 'roadDone' : 'roadWanted')}</h3>
        ${(road?.entries || []).filter(e => e.state === half).length ? html`<div class="ap-rows">
          ${road.entries.filter(e => e.state === half).map(e => html`<div key=${e.id} class="ap-row">
            <div class="ap-row-main"><p class="ap-road-text">${e.what}</p><small>${e.by} · ${day(e.at)}${e.version ? ` · v${e.version}` : ''}</small></div>
            ${owner || (e.state === 'wanted' && e.by === ctx.session.owner) ? html`<button class="og-door" disabled=${busy}
              onClick=${() => change(() => apiDelete(`${pathOf(app)}/roadmap/${encodeURIComponent(e.id)}`))}>${a('roadRemove')}</button>` : null}
          </div>`)}</div>` : html`<p class="ap-empty">${a('roadEmpty')}</p>`}
      </div>`)}
      <form class="ap-form" onSubmit=${e => { e.preventDefault(); change(() => apiPost(`${pathOf(app)}/roadmap`, { state, what })); }}>
        <label class="ap-field"><span class="og-label">${a('roadState')}</span><select class="og-input" value=${state} onChange=${e => setState(e.target.value)}>
          <option value="wanted">${a('roadWanted')}</option>${inside ? html`<option value="done">${a('roadDone')}</option>` : null}
        </select></label>
        <label class="ap-field ap-field--wide"><span class="og-label">${a('roadWhat')}</span><textarea class="og-input" rows="3" maxLength="600" required value=${what} onInput=${e => setWhat(e.target.value)} /></label>
        <button class="btn-primary" type="submit" disabled=${busy || what.trim().length < 3}>${a('roadAdd')}</button>
      </form>
    ` : null}
  <//>`;
}
