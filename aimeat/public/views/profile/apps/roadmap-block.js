/**
 * @file public/views/profile/apps/roadmap-block.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app's roadmap: what has been done, what is wished for, who sees the wishes, and
 *   the form that adds a line. It reads the roadmap itself, so it stands wherever an app is already
 *   chosen: under the picker in Settings > Apps, and as a section of the app's page in the App
 *   Catalog, where the app is the page and nothing has to be chosen again.
 *
 *   Made of the component kit: the block passes data and never a class.
 * @structure RoadmapBlock({ ctx, path, owner, me, heading, refresh })
 * @usage html`<${RoadmapBlock} key=${path} ctx=${ctx} path=${path} owner=${isOwner} me=${account} />`
 * @version-history
 *   v1.0.0 — 2026-10-04 — Moved out of collaboration.js v2.1.0 unchanged, so the App Catalog's app
 *     page shows the same roadmap (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { List, Row, Desc, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Select } from '/components/Select.js';
import { TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Space } from '/components/Layout.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { a, day } from './frame.js';

const html = htm.bind(h);

/**
 * `path` is the app's /v1/apps/{owner}/{filename}; `owner` is true when the signed-in person owns
 * the app; `me` is their account name, which may remove a wish of their own; a new `refresh` value
 * (Settings > Apps passes its app list, which a live update replaces) reads the roadmap again.
 */
export function RoadmapBlock({ ctx, path, owner, me, heading = true, refresh }) {
  const [road, setRoad] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [inside, setInside] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [what, setWhat] = useState('');
  const [state, setState] = useState('wanted');

  useEffect(() => {
    let active = true;
    setLoaded(false); setFailed(false); setRoad(null); setWhat(''); setState('wanted');
    apiGet(`${path}/roadmap`).then(res => {
      if (active) { setRoad(res.data.roadmap); setInside(res.data.inside_the_build); setLoaded(true); }
    }).catch(err => { swallowed('apps: roadmap', err); if (active) setFailed(true); });
    return () => { active = false; };
  }, [path, refresh]);

  async function change(fn) {
    setBusy(true);
    try {
      await fn();
      const res = await apiGet(`${path}/roadmap`);
      setRoad(res.data.roadmap); setWhat('');
    } catch (err) { ctx.showToast?.(err?.message || a('roadFailed'), true); }
    finally { setBusy(false); }
  }

  if (failed) return html`<${Note} kind="quiet" role="alert">${a('roadFailed')}<//>`;
  if (!loaded) return html`<${Note} kind="loading">${a('bldLoading')}<//>`;
  return html`
    ${heading ? html`<${Space} above="large"><${SubHeading} level=${3}>${a('roadHeading')}<//><//>` : null}
    <${Note}>${a(road?.wantedVisibility === 'everyone' ? 'roadPublicHint' : 'roadPrivateHint')}<//>
    ${owner ? html`<${Space} above="medium"><${Select} label=${a('roadVisibility')} disabled=${busy}
      value=${road?.wantedVisibility || 'developers'} onChange=${v => change(() => apiPatch(`${path}/roadmap`, { wanted_visibility: v }))}
      options=${[['developers', a('roadDevelopers')], ['everyone', a('roadEveryone')]]} /><//>` : null}
    ${['done', 'wanted'].map(half => html`<${Space} key=${half} above="large">
      <${SubHeading} level=${3}>${a(half === 'done' ? 'roadDone' : 'roadWanted')}<//>
      <${List} cols="name-doors" empty=${a('roadEmpty')}
        rows=${(road?.entries || []).filter(e => e.state === half)} render=${e => html`<${Row} key=${e.id}>
          <${Desc} pre sub=${`${e.by} · ${day(e.at)}${e.version ? ` · v${e.version}` : ''}`}>${e.what}<//>
          <${Doors}>${owner || (e.state === 'wanted' && e.by === me) ? html`<${Action} small disabled=${busy}
            onClick=${() => change(() => apiDelete(`${path}/roadmap/${encodeURIComponent(e.id)}`))}>${a('roadRemove')}<//>` : null}<//>
        <//>`} />
    <//>`)}
    ${me ? html`<${Space} above="large">
      <form onSubmit=${e => { e.preventDefault(); change(() => apiPost(`${path}/roadmap`, { state, what })); }}>
        <${Fields} cols=${2}>
          <${Select} label=${a('roadState')} value=${state} onChange=${setState}
            options=${[['wanted', a('roadWanted')], ...(inside ? [['done', a('roadDone')]] : [])]} />
          <${TextArea} wide label=${a('roadWhat')} rows=${3} maxLength="600" required value=${what} onInput=${setWhat} />
        <//>
        <${Space} above="large">
          <${FormActions}><${Loud} control type="submit" disabled=${busy || what.trim().length < 3}>${a('roadAdd')}<//><//>
        <//>
      </form>
    <//>` : null}
  `;
}
