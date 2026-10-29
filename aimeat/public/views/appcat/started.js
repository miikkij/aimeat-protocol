/**
 * @file public/views/appcat/started.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The apps a person has started and not published yet, over their own list in the
 *   catalogue: a plan or a draft the catalogue's listing does not show, each with its step count and
 *   the way to its structure page (GET /v1/app-plans, services/app-structure.ts). Nothing shows when
 *   there is none, or for a person who is not signed in. Re-reads on the `app-plans` live event.
 *
 *   Writes no class; the parts are components.
 * @structure StartedList({ signedIn, navigate })
 * @usage html`<${StartedList} signedIn=${!!cat.me} navigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { PageSection } from '/components/PageSection.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

export function StartedList({ signedIn, navigate }) {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    if (!signedIn) { setPlans([]); return undefined; }
    let live = true;
    const load = () => apiGet('/v1/app-plans')
      .then((r) => { if (live) setPlans((r?.data?.plans || []).filter((p) => !p.published)); })
      .catch((err) => swallowed('appcat: started apps', err));
    load();
    const onLive = (e) => { const d = e.detail?.domains; if (d && !d.has('app-plans') && !d.has('apps')) return; load(); };
    window.addEventListener('aimeat-live-update', onLive);
    return () => { live = false; window.removeEventListener('aimeat-live-update', onLive); };
  }, [signedIn]);
  if (!plans.length) return null;
  const open = (p) => (e) => {
    const to = `/v1/appcat/structure?app=${encodeURIComponent(p.app)}`;
    if (typeof navigate === 'function') { e.preventDefault(); navigate(to); }
  };
  return html`<${PageSection} list spaced title=${x('started.title')} count=${'· ' + plans.length} foot=${x('started.foot')}>
    <${List} cols="name-doors">
      ${plans.map((p) => html`<${Row} key=${p.app}>
        <${Name} tag=${html`<${Mark} tone="sun">${x('structure.draft')}<//>`} desc=${x('started.line', { fine: p.fine, total: p.total })}>${p.name}<//>
        <${Doors}><${Action} small href=${`/v1/appcat/structure?app=${encodeURIComponent(p.app)}`} onClick=${open(p)}>${x('started.open')}<//><//>
      <//>`)}
    <//>
  <//>`;
}
