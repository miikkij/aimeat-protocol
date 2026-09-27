/**
 * @file public/views/appcat/sections/cost.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Cost & contracts section of the app detail view ("Cost & contracts — what this
 *   app sources"), for an own published app: the EXCHANGE contracts (metered entitlements) the app
 *   calls, with the live spend against each budget and the platform rake, read only, from
 *   GET /v1/apps/cost?app_id={owner/filename} (only the entitlements whose consumer is the signed-in
 *   owner). A summary line "{n} contract(s) · {spent} morsels spent · {calls} call(s)", then one row
 *   per contract: the capability and its provider, the price per call, the rake, the budget (spent /
 *   cap, what is left, or uncapped) and its state. Empty, sign-in and failure lines as the old
 *   catalogue's js/cost.js.
 * @structure meta · CostSection({ d })
 * @usage loaded by the detail view: import('./sections/cost.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the chapter's lead and grey
 *     lines, the summary as a short typewriter state on its green ground, "(n left)" a coral label
 *     after the budget; the cut draws each contract as the old wrapping line of facts.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/cost.js.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Cell } from '/components/List.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

export const meta = { id: 'cost', title: 'cost.title', show: (d) => !!d.isOwnPublished };

/**
 * A contract's state as the old page's chip: active green, paused amber, on their tinted grounds in
 * the typewriter face; any other (revoked, exhausted) the chapter's small grey line.
 */
function StateMark({ state }) {
  if (state === 'active' || state === 'paused') {
    return html`<${Note} kind="state" size="small" mono tone=${state === 'active' ? 'fine' : 'attention'}>${state}<//>`;
  }
  return html`<${Note} kind="quiet" chapter inline>${state}<//>`;
}

function ContractRow({ c }) {
  const b = c.budget || {};
  const capped = !(b.cap_units === null || b.cap_units === undefined);
  const left = b.remaining_units === null || b.remaining_units === undefined ? null : b.remaining_units;
  const provider = String(c.provider || '').split('@')[0];
  return html`<${Row}>
    <${Name} meta=${x('cost.providerCol') + ': ' + provider}>${c.capability || ''}<//>
    <${Cell}><${Label} block>${x('cost.priceCol')}<//>${x('monetize.morselsN', { n: c.price_per_call })}<//>
    <${Cell}><${Label} block>${x('cost.rakeCol')}<//>${x('cost.rakeValue', { n: c.rake_per_call, p: c.rake_percent })}<//>
    <${Cell}>
      <${Label} block>${x('cost.budgetCol')}<//>
      ${capped ? b.spent_units + ' / ' + b.cap_units : x('cost.uncapped')}${left !== null ? html` <${Label}>${'(' + x('cost.remaining', { n: left }) + ')'}<//>` : null}
    <//>
    <${Cell}><${StateMark} state=${c.state} /><//>
  <//>`;
}

export default function CostSection({ d }) {
  const [st, setSt] = useState({ state: 'loading', data: null });
  useEffect(() => {
    let live = true;
    if (!getSession()?.jwt) { setSt({ state: 'error', data: { needLogin: true } }); return undefined; }
    setSt({ state: 'loading', data: null });
    apiGet('/v1/apps/cost?app_id=' + encodeURIComponent(d.owner + '/' + d.filename))
      .then((res) => { if (!live) return; if (!res || !res.data) throw new Error('bad response'); setSt({ state: 'ready', data: res.data }); })
      .catch((e) => { console.warn('appcat: cost & contracts could not be read', e); if (live) setSt({ state: 'error', data: null }); });
    return () => { live = false; };
  }, [d.ref, d.owner, d.filename]);

  const lede = html`<${Note} kind="lead" chapter>${x('cost.hint')}<//>`;
  let body;
  if (st.state === 'loading') body = html`<${Note} kind="quiet" size="small" inline>…<//>`;
  else if (st.state === 'error') body = html`<${Note} kind="quiet" chapter inline>${st.data && st.data.needLogin ? x('cost.needLogin') : x('cost.loadFailed')}<//>`;
  else {
    const contracts = (st.data && st.data.contracts) || [];
    if (!contracts.length) body = html`<${Note} kind="quiet" chapter inline>${x('cost.empty')}<//>`;
    else {
      const t = (st.data.totals && st.data.totals.morsels) || { spent_units: 0, calls: 0 };
      body = html`
        <${Note} kind="state" size="small" tone="fine" mono>${x('cost.summary', { n: st.data.total_contracts, spent: t.spent_units, calls: t.calls })}<//>
        <${List} cols="name-price-rake-budget-state">
          ${contracts.map((c, i) => html`<${ContractRow} key=${c.id || c.entitlement_id || i} c=${c} />`)}
        <//>`;
    }
  }
  return html`${lede}${body}`;
}
