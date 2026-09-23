/**
 * @file collaboration.js
 * @description Shared app discovery, roadmap editing and a publication change note.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Dialog for publishing, Field for the
 *     controls, ListRow for a shared app and a roadmap entry; no own CSS. The publish button calls
 *     the same handler directly instead of submitting a form by id, because the set's Action has
 *     no form attribute (reported).
 *   v1.0.1 — 2026-09-13 — The publish dialog's submit sits in the dialog's footer and names its form.
 *   v1.0.0 - 2026-09-08 - Make collaboration usable from the Apps page.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Section, Stack, ListRow, Field, Action, Text, Dialog } from '/components/poster-parts.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { listApps } from '/js/services/apps.js';
import { swallowed } from '/js/swallowed.js';
import { a, nameOf, appRef, day } from './frame.js';
const html = htm.bind(h);
const pathOf = app => `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}`;

export function PublishDialog({ app, busy, onPublish, onClose }) {
  const [line, setLine] = useState('');
  const blocked = busy || (!!line.trim() && line.trim().length < 3);
  return html`<${Dialog} open=${true} title=${a('publishDraft')} onClose=${onClose}
    actions=${html`<${Action} kind="primary" disabled=${blocked} onClick=${() => onPublish(app, line)}>${a('publishDraft')}<//>`}>
    <${Stack}>
      <${Text}>${a('publishConfirm', { name: nameOf(app) })}<//>
      <${Field} type="textarea" label=${a('roadPublishLabel')} rows=${3} maxLength=${600} value=${line} onInput=${e => setLine(e.target.value)} />
      <${Text} kind="caption" tone="muted">${a('roadPublishHint')}<//>
    <//>
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

  return html`<${Section} id="ap-collaboration" title=${a('roadTitle')}>
    <${Stack}>
      <${Field} type="checkbox" label=${a('sharedShow')} value=${showShared} onChange=${e => setShowShared(e.target.checked)} />
      ${showShared && sharedError ? html`<div role="alert"><${Text} tone="muted">${a('sharedFailed')}<//></div>` : null}
      ${showShared && !sharedError && shared === null ? html`<${Text} tone="muted">${a('bldLoading')}<//>` : null}
      ${showShared && shared?.length === 0 ? html`<${Text} tone="muted">${a('sharedNone')}<//>` : null}
      ${showShared && shared?.length ? html`<${Stack} density="compact">${shared.map(x => html`<${ListRow} key=${appRef(x)} density="compact"
        name=${nameOf(x)} detail=${`${x.owner} · ${a('bldRung_' + x.dev_level_name)}`}
        actions=${html`<${Action} onClick=${() => setSelected(appRef(x))}>${a('roadOpen')}<//>
          ${x.has_draft && x.dev_level <= 10 ? html`<${Action} onClick=${() => ctx.publishDraft(x)}>${a('publishDraft')}<//>` : null}`} />`)}<//>` : null}
      <${Field} type="select" label=${a('roadApp')} value=${selected} onChange=${e => setSelected(e.target.value)}
        options=${[{ value: '', label: a('roadChoose') }, ...apps.map(x => ({ value: appRef(x), label: `${nameOf(x)} · ${x.owner}` }))]} />
      ${app && failed ? html`<div role="alert"><${Text} tone="muted">${a('roadFailed')}<//></div>` : null}
      ${app && !loaded && !failed ? html`<${Text} tone="muted">${a('bldLoading')}<//>` : null}
      ${app && loaded ? html`
        <${Text} kind="caption" tone="muted">${a(road?.wantedVisibility === 'everyone' ? 'roadPublicHint' : 'roadPrivateHint')}<//>
        ${owner ? html`<${Field} type="select" label=${a('roadVisibility')} disabled=${busy}
          value=${road?.wantedVisibility || 'developers'} onChange=${e => change(() => apiPatch(`${pathOf(app)}/roadmap`, { wanted_visibility: e.target.value }))}
          options=${[{ value: 'developers', label: a('roadDevelopers') }, { value: 'everyone', label: a('roadEveryone') }]} />` : null}
        ${['done', 'wanted'].map(half => html`<${Stack} key=${half} density="compact">
          <${Text} kind="heading" size="small">${a(half === 'done' ? 'roadDone' : 'roadWanted')}<//>
          ${(road?.entries || []).filter(e => e.state === half).length ? html`<${Stack} density="compact">
            ${road.entries.filter(e => e.state === half).map(e => html`<${ListRow} key=${e.id} density="compact"
              name=${e.what} detail=${`${e.by} · ${day(e.at)}${e.version ? ` · v${e.version}` : ''}`}
              actions=${owner || (e.state === 'wanted' && e.by === ctx.session.owner) ? html`<${Action} kind="text" tone="danger" disabled=${busy}
                onClick=${() => change(() => apiDelete(`${pathOf(app)}/roadmap/${encodeURIComponent(e.id)}`))}>${a('roadRemove')}<//>` : null} />`)}<//>`
            : html`<${Text} tone="muted">${a('roadEmpty')}<//>`}
        <//>`)}
        <form onSubmit=${e => { e.preventDefault(); change(() => apiPost(`${pathOf(app)}/roadmap`, { state, what })); }}>
          <${Stack}>
            <${Field} type="select" label=${a('roadState')} value=${state} onChange=${e => setState(e.target.value)}
              options=${[{ value: 'wanted', label: a('roadWanted') }, ...(inside ? [{ value: 'done', label: a('roadDone') }] : [])]} />
            <${Field} type="textarea" label=${a('roadWhat')} rows=${3} maxLength=${600} required=${true} value=${what} onInput=${e => setWhat(e.target.value)} />
            <${Stack} direction="horizontal" align="start">
              <${Action} type="submit" disabled=${busy || what.trim().length < 3}>${a('roadAdd')}<//>
            <//>
          <//>
        </form>
      ` : null}
    <//>
  <//>`;
}
