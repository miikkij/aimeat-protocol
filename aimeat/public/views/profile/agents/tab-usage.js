/**
 * @file tab-usage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent detail "Usage" tab — the first UI over the LLM usage ledger
 *   (LEDGER / TARGET-016). Shows this agent's priced per-call usage: totals (cost /
 *   tokens / calls), a by-model breakdown, and a recent-runs drill-down. Reads
 *   /v1/ledger/usage + /v1/ledger/usage/runs (owner-scoped) and live-refetches on the
 *   `agent-usage` SSE domain the node emits when a new usage event lands.
 * @structure
 *   TabUsage({ agentName }) -- fetch (by-model + runs) -> stat cards + two lists.
 * @usage rendered by agent-card.js renderTabContent for activeTab === 'usage'.
 * @version-history
 *   2026-09-22 -- The by-model and run lists scroll inside their sections (Surface height="scroll"),
 *     so fifty runs do not stretch the tab.
 *   2026-09-22 -- Composed from the shared component set: the totals are a small numeral band, the
 *     by-model and run lists are sections of list rows; the tab's own classes are gone.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.0.0 -- 2026-07-11 -- Initial: first consumer of the ledger, closes the "recorded
 *     but nowhere to see it" gap for agent LLM usage.
 *   v1.1.0 -- 2026-07-16 -- Mount folds the two ledger reads into GET /v1/ledger/usage/overview
 *     (getLedgerUsageOverview); individual usage + runs reads kept as fallback.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { getLedgerUsage, getLedgerRuns, getLedgerUsageOverview } from '/js/services/ledger.js';
import { swallowed } from '/js/swallowed.js';
import { num } from '/js/format.js';
import { Stack, Section, ListRow, NumeralBand, Surface, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

function fmtUsd(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;
}
function fmtNum(v) {
  return num(Number(v || 0));
}

export default function TabUsage({ agent, agentName }) {
  const [totals, setTotals] = useState(null);
  const [byModel, setByModel] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  // The ledger keys usage by the agent's FULL GAII (agent#owner@node), not the bare name — the
  // node stores agentGaii, so filtering by the name matches nothing. Query with the GAII.
  const gaii = agent?.gaii || agentName;

  async function loadData({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      // Mount fold: ONE composite (model-grouped aggregates + totals + per-run rollups). On failure, fall
      // back to the individual two-request fan-out.
      const ov = await getLedgerUsageOverview(gaii, { runsLimit: 50 });
      if (ov) {
        setTotals(ov.totals || null);
        setByModel(ov.groups || []);
        setRuns(ov.runs || []);
      } else {
        const [modelResp, runsResp] = await Promise.all([
          getLedgerUsage(gaii, { groupBy: 'model' }).catch(err => { swallowed('tab-usage: loadData', err); return null; }),
          getLedgerRuns(gaii, { limit: 50 }).catch(err => { swallowed('tab-usage: loadData', err); return null; }),
        ]);
        setTotals(modelResp?.data?.totals || null);
        setByModel(modelResp?.data?.groups || []);
        setRuns(runsResp?.data?.runs || []);
      }
    } catch (err) {
      swallowed('tab-usage: loadData', err);
      setTotals(null);
      setByModel([]);
      setRuns([]);
    }
    setLoading(false);
  }

  // Reload when the agent changes. loadData closes over gaii (agent?.gaii||agentName)
  // and stable setters; the loadRef mirror below handles live refetches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // A new usage event fires an `agent-usage` domain change (owner-scoped); refetch
    // without the spinner so the tab updates live but never flashes blank.
    return onLiveUpdate(['agent-usage', 'agents'], () => loadRef.current({ showSpinner: false }));
  }, []);

  if (loading) {
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  const hasData = (totals?.calls || 0) > 0 || byModel.length > 0;
  if (!hasData) {
    return html`<${Text} tone="muted">${t('profile.agents.detail.usage.empty')}<//>`;
  }

  return html`
    <${Stack}>
      <${NumeralBand} size="small" tone="plain" items=${[
        { id: 'cost', label: t('profile.agents.detail.usage.cost'), value: fmtUsd(totals?.cost_usd) },
        { id: 'tokens', label: t('profile.agents.detail.usage.tokens'), value: fmtNum(totals?.total_tokens) },
        { id: 'calls', label: t('profile.agents.detail.usage.calls'), value: fmtNum(totals?.calls) },
      ]} />

      <${Section} size="small" density="compact" title=${t('profile.agents.detail.usage.byModel')}>
        <${Surface} kind="plain" density="flush" height="scroll">
        ${byModel.map(g => html`
          <${ListRow} key=${g.key} density="compact" name=${g.key || '(unknown)'}
            value=${html`<${Text} kind="mono">${fmtUsd(g.cost_usd)}${(g.unpriced_calls || 0) > 0 ? ` · ${g.unpriced_calls} ${t('profile.agents.detail.usage.unpriced')}` : ''}<//>`}
            detail=${html`${(g.providers && g.providers.length) ? html`<strong>${g.providers.join(', ')}</strong> · ` : ''}${fmtNum(g.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} (${fmtNum(g.prompt_tokens)} + ${fmtNum(g.completion_tokens)}) · ${fmtNum(g.calls)} ${t('profile.agents.detail.usage.callsLc')}`} />
        `)}
        <//>
      <//>

      ${runs.length > 0 && html`
        <${Section} size="small" density="compact" title=${t('profile.agents.detail.usage.recentRuns')}>
          <${Surface} kind="plain" density="flush" height="scroll">
          ${runs.map(r => html`
            <${ListRow} key=${r.run_id} density="compact" name=${r.run_id}
              value=${html`<${Text} kind="mono">${fmtUsd(r.cost_usd)}<//>`}
              detail=${`${fmtNum(r.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} · ${fmtNum(r.calls)} ${t('profile.agents.detail.usage.callsLc')}${(r.models && r.models.length) ? ` · ${r.models.join(', ')}` : ''}`} />
          `)}
          <//>
        <//>
      `}

      <${Text} kind="caption" tone="muted">${t('profile.agents.detail.usage.help')}<//>
    <//>
  `;
}
