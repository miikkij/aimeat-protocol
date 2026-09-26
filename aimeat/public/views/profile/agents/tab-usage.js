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
 *   v1.8.1 -- 2026-09-26 -- The two lists scroll after 300px again, as main's
 *     .pf-agd-event-log-scroll did (List scroll="medium"; fix pass).
 *   v1.8.0 -- 2026-09-26 -- Onto the components: the figures the FigureStrip (lead), each list a Group
 *     heading over a List that scrolls (the List's scroll cut: 17rem in a thin frame, where the page
 *     capped it at 300px), the lines the Note. The file writes no class any more.
 *   v1.7.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- A list of things, one per row, is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.5.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.2.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Who, Group } from '/components/List.js';
import { Note } from '/components/Note.js';

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
    return html`<${Note} kind="loading" />`;
  }

  const hasData = (totals?.calls || 0) > 0 || byModel.length > 0;
  if (!hasData) {
    return html`<${Note} kind="quiet">${t('profile.agents.detail.usage.empty')}<//>`;
  }

  return html`
    <div>
      <${FigureStrip} lead items=${[
        { key: 'cost', n: fmtUsd(totals?.cost_usd), label: t('profile.agents.detail.usage.cost') },
        { key: 'tokens', n: fmtNum(totals?.total_tokens), label: t('profile.agents.detail.usage.tokens') },
        { key: 'calls', n: fmtNum(totals?.calls), label: t('profile.agents.detail.usage.calls') },
      ]} />

      <${Group} title=${t('profile.agents.detail.usage.byModel')}>
        <${List} cols="name-state" keepCols scroll="medium">
          ${byModel.map(g => html`
            <${Row} key=${g.key}>
              <${Name} meta=${html`${(g.providers && g.providers.length) ? html`<strong>${g.providers.join(', ')}</strong> · ` : ''}${fmtNum(g.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} (${fmtNum(g.prompt_tokens)} + ${fmtNum(g.completion_tokens)}) · ${fmtNum(g.calls)} ${t('profile.agents.detail.usage.callsLc')}`}>${g.key || '(unknown)'}<//>
              <${Who}>${fmtUsd(g.cost_usd)}${(g.unpriced_calls || 0) > 0 ? ` · ${g.unpriced_calls} ${t('profile.agents.detail.usage.unpriced')}` : ''}<//>
            <//>
          `)}
        <//>
      <//>

      ${runs.length > 0 && html`
        <${Group} quiet title=${t('profile.agents.detail.usage.recentRuns')}>
          <${List} cols="name-state" keepCols scroll="medium">
            ${runs.map(r => html`
              <${Row} key=${r.run_id}>
                <${Name} meta=${`${fmtNum(r.total_tokens)} ${t('profile.agents.detail.usage.tokensLc')} · ${fmtNum(r.calls)} ${t('profile.agents.detail.usage.callsLc')}${(r.models && r.models.length) ? ` · ${r.models.join(', ')}` : ''}`}>${r.run_id}<//>
                <${Who}>${fmtUsd(r.cost_usd)}<//>
              <//>
            `)}
          <//>
        <//>
      `}

      <${Note}>${t('profile.agents.detail.usage.help')}<//>
    </div>
  `;
}
