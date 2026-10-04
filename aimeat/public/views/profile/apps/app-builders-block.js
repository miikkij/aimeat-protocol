/**
 * @file public/views/profile/apps/app-builders-block.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who, other than the owner, may build ONE app: the people with a right on this app,
 *   the people with a right on every app of the owner (they build this one too), the form that
 *   gives somebody a right on this app, and the press that takes one back. It stands on the app's
 *   own page in the App Catalog, where the app is already chosen; Settings > Apps keeps the list
 *   across every app (builders.js) and the "every app" right, which is not about one app.
 *
 *   Owner only, as the routes are: GET/PUT/DELETE /v1/apps/{owner}/{filename}/dev-grants.
 *   A failed read says so rather than drawing "nobody", because a screen that says nobody else has
 *   power over an app when it could not find out is telling the owner something untrue.
 *
 *   Made of the component kit: the block passes data and never a class.
 * @structure AppBuildersBlock({ ctx, path })
 * @usage html`<${AppBuildersBlock} key=${path} ctx=${{ showToast }} path=${path} />`
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { List, Row, Name, Cell, Doors, Panel } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { a } from './frame.js';

const html = htm.bind(h);

/** The three rungs, most power first, as builders.js offers them. */
const RUNGS = ['full', 'publisher', 'drafter'];
const DEFAULT_RUNG = 'drafter';

const rungName = (g) => a('bldRung_' + (g.levelName || 'full')) || g.levelName;

export function AppBuildersBlock({ ctx, path }) {
  const [read, setRead] = useState({ state: 'loading', grants: [], allApps: [] });
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState('');
  const [rung, setRung] = useState(DEFAULT_RUNG);
  const [revoking, setRevoking] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    apiGet(`${path}/dev-grants`).then((res) => {
      if (!active) return;
      const d = res?.data || {};
      setRead({ state: 'ready', grants: d.grants || [], allApps: d.allApps || [] });
    }).catch((err) => { swallowed('apps: app builders', err); if (active) setRead((r) => ({ ...r, state: 'failed' })); });
    return () => { active = false; };
  }, [path, tick]);

  async function act(fn, toast) {
    setBusy(true);
    try {
      await fn();
      ctx.showToast?.(toast);
      setTick((n) => n + 1);
    } catch (err) {
      swallowed('apps: app builders write', err);
      ctx.showToast?.(err?.error?.message || err?.message || a('bldFailed'), true);
    } finally { setBusy(false); }
  }

  function grant(e) {
    e.preventDefault();
    const name = who.trim();
    if (!name) return;
    act(() => apiPut(`${path}/dev-grants/${encodeURIComponent(name)}`, { level: rung }), a('bldGrantedToast', { who: name }));
    // Both fields back to their defaults, so a second invitation cannot carry the first one's power.
    setWho(''); setRung(DEFAULT_RUNG);
  }

  function revoke(account) {
    setRevoking('');
    act(() => apiDelete(`${path}/dev-grants/${encodeURIComponent(account)}`), a('bldRevokedToast', { who: account }));
  }

  if (read.state === 'loading') return html`<${Note} kind="loading">${a('bldLoading')}<//>`;
  if (read.state === 'failed') return html`<${Note} kind="quiet" role="alert">${a('bldFailed')}<//>`;
  const nobody = read.grants.length === 0 && read.allApps.length === 0;

  return html`
    <${Note} kind="lead">${a('secBuildersLead')}<//>
    ${nobody ? html`<${Note} kind="quiet">${a('bldNoneApp')}<//>` : null}
    ${read.grants.length ? html`
      <${Space} above="section"><${Label} block>${a('bldThisApp')}<//><//>
      <${List} cols="name-tag-doors" keepCols>
        ${read.grants.map((g) => html`<${Row} key=${g.account} open=${revoking === g.account}>
          <${Name}>${g.account}<//>
          <${Cell}><${Mark}>${rungName(g)}<//><//>
          <${Doors}><${Action} small row disabled=${busy} onClick=${() => setRevoking(g.account)}>${a('bldRevoke')}<//><//>
          ${revoking === g.account ? html`<${Panel}>
            <${Note} kind="quiet" role="alert">${a('bldRevokeConfirm', { who: g.account })}<//>
            <${Actions}>
              <${Loud} control danger disabled=${busy} onClick=${() => revoke(g.account)}>${a('bldRevoke')}<//>
              <${Action} small onClick=${() => setRevoking('')}>${a('specKeep')}<//>
            <//>
          <//>` : null}
        <//>`)}
      <//>` : null}
    ${read.allApps.length ? html`
      <${Space} above="section"><${Label} block>${a('bldAllTitle')}<//><//>
      <${List} cols="name-tag-doors" keepCols>
        ${read.allApps.map((g) => html`<${Row} key=${g.account}>
          <${Name} meta=${a('bldAllWhere')}>${g.account}<//>
          <${Cell}><${Mark}>${rungName(g)}<//><//>
          <${Doors} />
        <//>`)}
      <//>
      <${Note}>${a('bldAllElsewhere')}<//>` : null}
    <${Space} above="large">
      <form onSubmit=${grant}>
        <${Fields} cols=${2}>
          <${Field} label=${a('bldWho')}>
            <${ContactPicker} value=${who} onChange=${setWho} kinds=${['ghii']} placeholder=${a('bldWhoHint')} disabled=${busy} />
          <//>
          <${Select} label=${a('bldRung')} value=${rung} onChange=${setRung} options=${RUNGS.map((r) => [r, a('bldRung_' + r) || r])} />
        <//>
        <${Space} above="large">
          <${FormActions} end><${Loud} control type="submit" disabled=${busy || !who.trim()}>${a('bldGrant')}<//><//>
        <//>
      </form>
    <//>
    <${Note}>${a('bldNever')}<//>
  `;
}
