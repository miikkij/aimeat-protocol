/**
 * @file tab-usage.js
 * @description Agent detail "Usage" tab — the first UI over the LLM usage ledger
 *   (LEDGER / TARGET-016). Shows this agent's priced per-call usage: totals (cost /
 *   tokens / calls), a by-model breakdown, and a recent-runs drill-down. Reads
 *   /v1/ledger/usage + /v1/ledger/usage/runs (owner-scoped) and live-refetches on the
 *   `agent-usage` SSE domain the node emits when a new usage event lands.
 * @structure
 *   TabUsage({ agentName }) -- fetch (by-model + runs) -> stat cards + two lists.
 * @usage rendered by agent-card.js renderTabContent for activeTab === 'usage'.
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial: first consumer of the ledger, closes the "recorded
 *     but nowhere to see it" gap for agent LLM usage.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { getLedgerUsage, getLedgerRuns } from '/js/services/ledger.js';

const html = htm.bind(h);

function fmtUsd(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;
}
function fmtNum(v) {
  return Number(v || 0).toLocaleString();
}

export default function TabUsage({ agentName }) {
  const [totals, setTotals] = useState(null);
  const [byModel, setByModel] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadData({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      const [modelResp, runsResp] = await Promise.all([
        getLedgerUsage(agentName, { groupBy: 'model' }).catch(() => null),
        getLedgerRuns(agentName, { limit: 50 }).catch(() => null),
      ]);
      setTotals(modelResp?.data?.totals || null);
      setByModel(modelResp?.data?.groups || []);
      setRuns(runsResp?.data?.runs || []);
    } catch {
      setTotals(null);
      setByModel([]);
      setRuns([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // A new usage event fires an `agent-usage` domain change (owner-scoped); refetch
    // without the spinner so the tab updates live but never flashes blank.
    return onLiveUpdate(['agent-usage', 'agents'], () => loadRef.current({ showSpinner: false }));
  }, []);

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  const hasData = (totals?.calls || 0) > 0 || byModel.length > 0;
  if (!hasData) {
    return html`<div class="pf-agd-empty">${t('profile.agents.detail.usage.empty')}</div>`;
  }

  return html`
    <div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card-value">${fmtUsd(totals?.cost_usd)}</div>
          <div class="stat-card-label">${t('profile.agents.detail.usage.cost')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${fmtNum(totals?.total_tokens)}</div>
          <div class="stat-card-label">${t('profile.agents.detail.usage.tokens')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${fmtNum(totals?.calls)}</div>
          <div class="stat-card-label">${t('profile.agents.detail.usage.calls')}</div>
        </div>
      </div>

      <div class="pf-agd-section-title">${t('profile.agents.detail.usage.byModel')}</div>
      <div class="pf-agd-event-log-scroll">
        ${byModel.map(g => html`
          <div key=${g.key} class="pf-agd-log-entry pf-agd-log-entry--two-line">
            <div class="pf-agd-log-entry-primary">
              <span class="pf-agd-log-type">${g.key || '(unknown)'}</span>
              <span class="pf-agd-log-time">
                ${fmtUsd(g.cost_usd)}${(g.unpriced_calls || 0) > 0 ? ` · ${g.unpriced_calls} ${t('profile.agents.detail.usage.unpriced')}` : ''}
              </span>
            </div>
            <div class="pf-agd-log-entry-detail">
              ${fmtNum(g.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} (${fmtNum(g.prompt_tokens)} + ${fmtNum(g.completion_tokens)}) · ${fmtNum(g.calls)} ${t('profile.agents.detail.usage.callsLc')}
            </div>
          </div>
        `)}
      </div>

      ${runs.length > 0 && html`
        <div class="pf-agd-section-title">${t('profile.agents.detail.usage.recentRuns')}</div>
        <div class="pf-agd-event-log-scroll">
          ${runs.map(r => html`
            <div key=${r.run_id} class="pf-agd-log-entry pf-agd-log-entry--two-line">
              <div class="pf-agd-log-entry-primary">
                <span class="pf-agd-log-type">${r.run_id}</span>
                <span class="pf-agd-log-time">${fmtUsd(r.cost_usd)}</span>
              </div>
              <div class="pf-agd-log-entry-detail">
                ${fmtNum(r.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} · ${fmtNum(r.calls)} ${t('profile.agents.detail.usage.callsLc')}${(r.models && r.models.length) ? ` · ${r.models.join(', ')}` : ''}
              </div>
            </div>
          `)}
        </div>
      `}

      <div class="pf-agd-help-text">${t('profile.agents.detail.usage.help')}</div>
    </div>
  `;
}
