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

const html = htm.bind(h);

const fmtDay = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };
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

  if (loading) return html`<div class="pf-agd-empty">${t('profile.loading') || 'Loading…'}</div>`;

  const active = engagements.filter(e => e.state === 'active');
  const retired = engagements.filter(e => e.state === 'retired');
  const label = (e) => e.contract || (t('organisms.bareContract') || 'contract');

  return html`
    <div class="pf-agd-contracts pf-agd-card-grid">
      <div class="pf-agd-card">
      <div class="pf-agd-section-title">${t('profile.agents.detail.contracts.offersTitle') || 'Contracts this agent offers'}</div>
      <div class="section-desc">${t('profile.agents.detail.contracts.offersDesc') || 'The workspace contracts this agent advertises. Owners see these when choosing an agent for a workspace.'}</div>
      <div class="agc-caps">
        ${advertises || capabilities.length
          ? (capabilities.length ? capabilities : ['']).map(c => html`<span class="badge badge-info pj-mini" key=${c}>${'📜 '}${c || (t('organisms.bareContract') || 'contract')}</span>`)
          : html`<span class="pf-agd-empty">${t('profile.agents.detail.contracts.noOffers') || 'This agent advertises no workspace contract (add a workspace-contract + contract.<id> tag in Data Access).'}</span>`}
      </div>
      </div>

      <div class="pf-agd-card">
      <div class="pf-agd-section-title">${t('profile.agents.detail.contracts.activeTitle') || 'Active in these workspaces'}</div>
      ${active.length ? html`
        <div class="agc-list">
          ${active.map(e => html`
            <div class="agc-row" key=${engKey(e)}>
              <span class="agc-where">
                <span class="badge badge-success pj-mini">${'✓ '}${label(e)}</span>
                <strong>${e.wsName || e.ws}</strong>
                <span class="agc-org">${e.organismName || e.organism_id}</span>
                <span class="agc-since">${(t('profile.agents.detail.contracts.since') || 'since {d}').replace('{d}', fmtDay(e.adoptedAt))}</span>
              </span>
              <button class="btn-outline btn-sm" disabled=${busy === engKey(e)}
                title=${t('organisms.retireHint') || 'Stop this agent from working in this workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                onClick=${() => retire(e)}>${busy === engKey(e) ? '…' : (t('organisms.retire') || 'Retire')}</button>
            </div>`)}
        </div>`
        : html`<div class="pf-agd-empty">${t('profile.agents.detail.contracts.noneActive') || 'Not active in any workspace yet. Owners adopt this agent from a workspace’s People panel.'}</div>`}
      </div>

      ${retired.length ? html`
        <div class="pf-agd-card pf-agd-card--full">
        <div class="pf-agd-section-title">${t('profile.agents.detail.contracts.retiredTitle') || 'Retired (history)'}</div>
        <div class="agc-list">
          ${retired.map(e => html`
            <div class="agc-row agc-row--retired" key=${engKey(e)}>
              <span class="agc-where">
                <span class="badge badge-muted pj-mini">${label(e)}</span>
                <strong>${e.wsName || e.ws}</strong>
                <span class="agc-org">${e.organismName || e.organism_id}</span>
                <span class="agc-since">${(t('profile.agents.detail.contracts.until') || 'used here until {d}').replace('{d}', fmtDay(e.retiredAt))}</span>
              </span>
              <button class="btn-ghost btn-sm" disabled=${busy === engKey(e)}
                onClick=${() => readopt(e)}>${busy === engKey(e) ? '…' : (t('organisms.reAdopt') || 'Re-adopt')}</button>
            </div>`)}
        </div>
        </div>` : null}
    </div>`;
}
