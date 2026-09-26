/**
 * @file tab-contracts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent detail › Contracts sub-tab. Makes the agent's workspace-contract engagements
 *   visible from the AGENT side (previously only the workspace knew, and only as a derived record
 *   trace). Shows what the agent OFFERS (its contract.* capability tags) and, first-class, WHERE each
 *   contract is currently active or was retired — with a Retire off-switch and a Re-adopt action.
 * @structure TabContracts — offered-contracts row + Active engagements + Retired (history)
 * @usage <${TabContracts} agent=${agent} agentName=${agent.name} showToast=${showToast} />
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- A list of things, one per row, is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 -- 2026-07-17 -- Card layout: offers and active-workspaces side by side in
 *     pf-agd-card-grid; retired history spans full width.
 *   v1.0.0 — 2026-07-03 — Initial agent Contracts sub-tab (engagement visibility + activate/deactivate).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { getAgentEngagements, contractNamesOf, offersWorkspaceContract, adoptContractTask } from '/js/services/agents.js';
import { retireEngagement, activateEngagement } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

const html = htm.bind(h);

const fmtDay = (iso) => (iso ? fmtDate(iso) : '');
const engKey = (e) => `${e.organism_id}:${e.ws}:${e.contract || ''}`;

export default function TabContracts({ agent, agentName, showToast }) {
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const capabilities = contractNamesOf(agent);
  const advertises = offersWorkspaceContract(agent);

  const load = useCallback(async () => {
    try { setEngagements(await getAgentEngagements(agentName)); }
    finally { setLoading(false); }
  }, [agentName]);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { load(); return onLiveUpdate(['organisms'], () => loadRef.current()); }, [load]);

  // Retire = the off-switch: the agent's loop skips this workspace once its engagement is retired.
  const retire = async (e) => {
    setBusy(engKey(e));
    try {
      const r = await retireEngagement(e.organism_id, e.ws, e.agent, e.contract);
      if (r?.ok === false) showToast?.(r?.error?.message || (t('organisms.retireFailed') || 'Could not retire the contract'), true);
      else showToast?.(t('profile.agents.detail.contracts.retiredToast') || 'Retired — the agent will skip this workspace');
      await load();
    } catch (err) { showToast?.(err?.message || 'Error', true); }
    finally { setBusy(''); }
  };
  // Re-adopt = flip back to active + re-queue the provisioning task, mirroring the workspace panel.
  const readopt = async (e) => {
    setBusy(engKey(e));
    try {
      await activateEngagement(e.organism_id, e.ws, e.agent, e.contract).catch(err => { swallowed('tab-contracts: readopt', err); });
      await adoptContractTask(agentName, { organismId: e.organism_id, ws: e.ws, contract: e.contract });
      showToast?.(t('profile.agents.detail.contracts.readoptedToast') || 'Re-adopted — the agent will pick this workspace back up');
      await load();
    } catch (err) { showToast?.(err?.message || 'Error', true); }
    finally { setBusy(''); }
  };

  if (loading) return html`<div class="poster-quiet pf-agd-empty loading-mark">${t('profile.loading') || 'Loading…'}</div>`;

  const active = engagements.filter(e => e.state === 'active');
  const retired = engagements.filter(e => e.state === 'retired');
  const label = (e) => e.contract || (t('organisms.bareContract') || 'contract');

  return html`
    <div class="pf-agd-contracts pf-agd-card-grid">
      <div class="pf-agd-card poster-row--thing">
      <div class="pf-agd-section-title sub-heading">${t('profile.agents.detail.contracts.offersTitle') || 'Contracts this agent offers'}</div>
      <div class="section-desc">${t('profile.agents.detail.contracts.offersDesc') || 'The workspace contracts this agent advertises. Owners see these when choosing an agent for a workspace.'}</div>
      <div class="agc-caps">
        ${advertises || capabilities.length
          ? (capabilities.length ? capabilities : ['']).map(c => html`<span class="poster-chip" key=${c}>${'📜 '}${c || (t('organisms.bareContract') || 'contract')}</span>`)
          : html`<span class="poster-quiet pf-agd-empty">${t('profile.agents.detail.contracts.noOffers') || 'This agent advertises no workspace contract (add a workspace-contract + contract.<id> tag in Data Access).'}</span>`}
      </div>
      </div>

      <div class="pf-agd-card poster-row--thing">
      <div class="pf-agd-section-title poster-day-title">${t('profile.agents.detail.contracts.activeTitle') || 'Active in these workspaces'}</div>
      ${active.length ? html`
        <div class="listing listing--name-who-when-doors agc-list">
          ${active.map(e => html`
            <div class="listing-row agc-row" key=${engKey(e)}>
              <div class="listing-name">
                <span class="poster-status poster-status--fine">${'✓ '}${label(e)}</span>
                ${' '}${e.wsName || e.ws}
              </div>
              <div class="listing-who">${e.organismName || e.organism_id}</div>
              <div class="poster-time">${(t('profile.agents.detail.contracts.since') || 'since {d}').replace('{d}', fmtDay(e.adoptedAt))}</div>
              <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" disabled=${busy === engKey(e)}
                title=${t('organisms.retireHint') || 'Stop this agent from working in this workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                onClick=${() => retire(e)}>${busy === engKey(e) ? '…' : (t('organisms.retire') || 'Retire')}</button></div>
            </div>`)}
        </div>`
        : html`<div class="poster-quiet pf-agd-empty">${t('profile.agents.detail.contracts.noneActive') || 'Not active in any workspace yet. Owners adopt this agent from a workspace’s People panel.'}</div>`}
      </div>

      ${retired.length ? html`
        <div class="pf-agd-card pf-agd-card--full poster-row--thing">
        <div class="pf-agd-section-title poster-day-title poster-day-title--quiet">${t('profile.agents.detail.contracts.retiredTitle') || 'Retired (history)'}</div>
        <div class="listing listing--name-who-when-doors agc-list">
          ${retired.map(e => html`
            <div class="listing-row agc-row agc-row--retired" key=${engKey(e)}>
              <div class="listing-name">
                <span class="poster-status poster-status--off">${label(e)}</span>
                ${' '}${e.wsName || e.ws}
              </div>
              <div class="listing-who">${e.organismName || e.organism_id}</div>
              <div class="poster-time">${(t('profile.agents.detail.contracts.until') || 'used here until {d}').replace('{d}', fmtDay(e.retiredAt))}</div>
              <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" disabled=${busy === engKey(e)}
                onClick=${() => readopt(e)}>${busy === engKey(e) ? '…' : (t('organisms.reAdopt') || 'Re-adopt')}</button></div>
            </div>`)}
        </div>
        </div>` : null}
    </div>`;
}
