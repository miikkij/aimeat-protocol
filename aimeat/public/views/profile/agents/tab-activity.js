/**
 * @file tab-activity.js
 * @description Enhanced Activity tab with governance filter and category badges.
 *   Wraps the existing activity subtab with additional filter pills.
 * @version-history
 *   v1.7.0 -- 2026-07-16 -- Mount folds 5 agent-domain reads into GET /v1/agents/:name/activity/overview
 *     (getActivityOverview); ledger stays separate. Individual six-request fan-out kept as fallback.
 *   v1.6.0 -- 2026-06-10 -- Event log strictly newest-first (pages interleaved lifecycle events);
 *     "Tokens used (30d)" shows "—/not reported" when telemetry isn't wired (0 claimed no usage);
 *     delivery health shows a neutral "Delivery: polling" line when neither MCP nor webhook is
 *     configured (polling is a working method, not two missing ones).
 *   v1.5.0 -- 2026-05-28 -- Fix governance card: telemetry response field is `events` (not `entries`), and per-event tokens live in e.data.tokens_used / e.data.tokens_in+out
 *   v1.4.0 -- 2026-05-24 -- Audit fix: two-line event layout with secondary detail row
 *   v1.3.0 -- 2026-05-24 -- Wire up MCP status in delivery health from agent data
 *   v1.2.0 -- 2026-05-24 -- Fix: F17 task breakdown, F18 violation red badge, M5 governance i18n namespace
 *   v1.1.0 -- 2026-05-24 -- Fix: HH:MM timestamps, token budget %, readiness/override categories, audit trail footer, fix locale prefix
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { getActivity, getActivityLog, getActivityOverview } from '/js/services/agent-activity.js';
import { getDirectives } from '/js/services/agent-directives.js';
import { getWebhookConfig, getTelemetry } from '/js/services/agent-integration.js';
import { getLedgerUsage } from '/js/services/ledger.js';

const html = htm.bind(h);

const FILTERS = [
  { id: 'all', key: 'profile.agents.detail.activity.filterAll' },
  { id: 'tasks', key: 'profile.agents.detail.activity.filterTasks' },
  { id: 'messages', key: 'profile.agents.detail.activity.filterMessages' },
  { id: 'governance', key: 'profile.agents.detail.activity.filterGovernance' },
  { id: 'system', key: 'profile.agents.detail.activity.filterSystem' },
];

function eventCategory(event) {
  // Task-lifecycle events come back from /activity/log with a non-empty
  // taskId set by the route. Use that as the primary signal -- the event
  // type itself is whatever the agent set ("progress") or the lifecycle
  // emitted ("completed", "failed"), none of which include "task" as a
  // substring. Fall back to type-substring checks for everything else.
  if (event.taskId) return 'tasks';
  const type = (event.type || event.event || '').toLowerCase();
  if (type.includes('todo')) return 'tasks';
  if (type.includes('message') || type.includes('msg')) return 'messages';
  if (type.includes('approve') || type.includes('scope') || type.includes('permission') || type.includes('governance') || type.includes('policy') || type.includes('readiness') || type.includes('override')) return 'governance';
  return 'system';
}

export default function TabActivity({ agent, agentName }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [governance, setGovernance] = useState(null);
  const [ledgerTotals, setLedgerTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [logPage, setLogPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function loadData({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      // Mount fold: ONE composite (activity_stats + event log + directives budget + webhook + telemetry)
      // plus the ledger, which stays separate (different auth model — owner-GHII scoped). On composite
      // failure, fall back to the individual five-request fan-out. Each composite sub-object mirrors the
      // matching endpoint's `.data`, so the downstream field access below is unchanged.
      // The usage ledger is the accurate token source (per-LLM-call). Keyed by the agent's full GAII,
      // not the bare name — filtering by the name matches nothing.
      const [overview, ledgerResp] = await Promise.all([
        getActivityOverview(agentName),
        getLedgerUsage(agent?.gaii || agentName, { groupBy: 'day' }).catch(() => null),
      ]);
      let actResp, logResp, dirResp, whResp, telResp;
      if (overview) {
        actResp = { data: overview.activity };
        logResp = { data: overview.log };
        dirResp = { data: overview.directives };
        whResp = { data: overview.webhook };
        telResp = { data: overview.telemetry };
      } else {
        [actResp, logResp, dirResp, whResp, telResp] = await Promise.all([
          getActivity(agentName, 30).catch(() => null),
          getActivityLog(agentName, 1, 50).catch(() => null),
          getDirectives(agentName).catch(() => null),
          getWebhookConfig(agentName).catch(() => null),
          getTelemetry(agentName, { days: 1 }).catch(() => null),
        ]);
      }
      setStats(actResp?.data?.activity_stats || null);
      setLedgerTotals(ledgerResp?.data?.totals || null);
      setEvents(logResp?.data?.events || []);
      setHasMore((logResp?.data?.events || []).length >= 50);
      setLogPage(1);

      const allEvents = logResp?.data?.events || [];
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEvents = allEvents.filter(ev => new Date(ev.timestamp) >= todayStart);
      const govEvents = todayEvents.filter(ev => eventCategory(ev) === 'governance');
      const taskEvents = todayEvents.filter(ev => eventCategory(ev) === 'tasks');
      const tasksCompleted = taskEvents.filter(e => { const tp = (e.type || '').toLowerCase(); return tp.includes('completed') || tp.includes('done'); }).length;
      const tasksActive = taskEvents.filter(e => { const tp = (e.type || '').toLowerCase(); return tp.includes('started') || tp.includes('active'); }).length;
      const tasksFailed = taskEvents.filter(e => { const tp = (e.type || '').toLowerCase(); return tp.includes('failed') || tp.includes('error'); }).length;
      const budget = dirResp?.data?.budget_limits;
      const wh = whResp?.data?.webhook;
      // GET /v1/agents/:name/telemetry returns { events, count, per_page }, and per-event
      // numbers live inside event.data ({ tokens_used } OR { tokens_in + tokens_out }).
      const telemetryEntries = telResp?.data?.events || telResp?.data?.entries || [];
      const eventTokens = (e) => {
        const d = e?.data || {};
        const used = Number(d.tokens_used) || 0;
        return used > 0 ? used : (Number(d.tokens_in) || 0) + (Number(d.tokens_out) || 0);
      };

      setGovernance({
        budget,
        tokensUsedToday: telemetryEntries.reduce((sum, e) => sum + eventTokens(e), 0),
        tasksToday: taskEvents.length,
        tasksCompleted,
        tasksActive,
        tasksFailed,
        policyIssues: govEvents.length,
        telemetryCount: telemetryEntries.length,
        webhookEnabled: wh?.enabled ?? false,
        webhookSuccessCount: wh?.success_count ?? 0,
        webhookTotalCount: (wh?.success_count ?? 0) + (wh?.fail_count ?? 0),
        mcpActive: agent?.mcpEnabled || agent?.mcp_enabled || false,
      });
    } catch {
      setStats(null);
      setEvents([]);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Load activity when the agent changes; loadData also closes over the agent object, but re-keying on it would double up with the live-update refetch below.
  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // Live-update refetch must NOT show the spinner -- it fires often and would
    // flash the whole tab blank. First mount still shows the spinner.
    return onLiveUpdate(['agent-tasks', 'agents'], () => loadRef.current({ showSpinner: false }));
  }, []);

  async function handleLoadMore() {
    const nextPage = logPage + 1;
    try {
      const resp = await getActivityLog(agentName, nextPage, 50);
      const newEvents = resp?.data?.events || [];
      setEvents(prev => [...prev, ...newEvents]);
      setLogPage(nextPage);
      setHasMore(newEvents.length >= 50);
    } catch { /* silent */ }
  }

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  // Strict newest-first ordering — the backend pages can interleave lifecycle events
  // (completed before progress, timestamps jumping 05:25 → 05:28 → 05:25 otherwise).
  const sorted = [...events].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const filtered = filter === 'all' ? sorted : sorted.filter(ev => eventCategory(ev) === filter);
  // The usage ledger (per-LLM-call) is the accurate token source now; prefer it and fall back to
  // the legacy telemetry counters only when the ledger has nothing for this agent. Telemetry not
  // wired ≠ zero consumption — don't let "0" claim there was none.
  const ledgerTokens = (ledgerTotals && (ledgerTotals.calls || 0) > 0) ? (ledgerTotals.total_tokens || 0) : null;
  const telemetryConnected = ledgerTokens != null || (governance?.telemetryCount || 0) > 0 || (stats?.tokensUsed30d || 0) > 0;

  return html`
    <div>
      <!-- Stats summary -->
      ${stats && html`
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card-value">${stats.tasksCompleted ?? 0}</div>
            <div class="stat-card-label">${t('profile.agents.activity.tasksCompleted')}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${ledgerTokens != null ? ledgerTokens.toLocaleString() : (telemetryConnected ? (stats.tokensUsed30d ?? 0) : '—')}</div>
            <div class="stat-card-label">${t('profile.agents.activity.tokensUsed')}${telemetryConnected ? '' : ` (${t('profile.agents.detail.activity.notReported') || 'not reported'})`}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${stats.successRate != null ? `${Math.round(stats.successRate)}%` : '-'}</div>
            <div class="stat-card-label">${t('profile.agents.activity.successRate')}</div>
          </div>
        </div>
      `}

      <!-- Governance summary -->
      ${governance && html`
        <div class="pf-agd-governance-section">
          <div class="pf-agd-section-title">${t('profile.agents.detail.activity.governance.title')}</div>
          <div class="pf-agd-governance-grid">
            ${governance.budget ? html`
              <div class="pf-agd-governance-item">
                <span class="pf-agd-governance-label">${t('profile.agents.detail.activity.governance.tokenBudget')}</span>
                <span class="pf-agd-governance-value">${(governance.tokensUsedToday || 0).toLocaleString()} / ${(governance.budget.max_tokens_per_day || '---').toLocaleString()}${governance.budget.max_tokens_per_day ? ` (${Math.round((governance.tokensUsedToday || 0) / governance.budget.max_tokens_per_day * 100)}%)` : ''}</span>
              </div>
            ` : ''}
            <div class="pf-agd-governance-item">
              <span class="pf-agd-governance-label">${t('profile.agents.detail.activity.governance.tasksToday')}</span>
              <span class="pf-agd-governance-value">${t('profile.agents.detail.activity.governance.completed')}: ${governance.tasksCompleted}, ${t('profile.agents.detail.activity.governance.activeTasks')}: ${governance.tasksActive}, ${t('profile.agents.detail.activity.governance.failed')}: ${governance.tasksFailed}</span>
            </div>
            <div class="pf-agd-governance-item">
              <span class="pf-agd-governance-label">${t('profile.agents.detail.activity.governance.policyIssues')}</span>
              <span class="pf-agd-governance-value ${governance.policyIssues > 0 ? 'pf-agd-warning-text' : ''}">${governance.policyIssues}</span>
            </div>
            <div class="pf-agd-governance-item">
              <span class="pf-agd-governance-label">${t('profile.agents.detail.activity.governance.telemetryEvents')}</span>
              <span class="pf-agd-governance-value">${governance.telemetryCount}</span>
            </div>
          </div>
          <div class="pf-agd-governance-delivery">
            <span class="pf-agd-governance-label">${t('profile.agents.detail.activity.governance.deliveryHealth')}</span>
            <span class="pf-agd-governance-value">
              ${(!governance.mcpActive && !governance.webhookEnabled)
                ? html`<span class="pf-agd-status-dot ${agent?.last_seen && (Date.now() - new Date(agent.last_seen).getTime() < 24 * 3600 * 1000) ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span> ${t('profile.agents.detail.activity.deliveryPollingLine') || 'Delivery: polling'}`
                : html`
                  ${governance.mcpActive
                    ? html`<span class="pf-agd-status-dot pf-agd-status-dot--active"></span> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.connected')}`
                    : html`<span class="pf-agd-status-dot pf-agd-status-dot--inactive"></span> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.notConfigured')}`
                  }
                  ${' | '}
                  ${governance.webhookEnabled
                    ? `${t('profile.agents.webhook.title')}: ${governance.webhookSuccessCount}/${governance.webhookTotalCount}`
                    : t('profile.agents.detail.integration.webhookNotConfigured')
                  }`}
            </span>
          </div>
        </div>
      `}

      <!-- Filter bar -->
      <div class="pf-agd-filter-bar">
        ${FILTERS.map(f => {
          const label = t(f.key);
          return html`
            <button key=${f.id}
                    class="pf-agd-filter-pill ${filter === f.id ? 'pf-agd-filter-pill--active' : ''}"
                    onClick=${() => setFilter(f.id)}>
              ${label !== f.key ? label : f.id.charAt(0).toUpperCase() + f.id.slice(1)}
            </button>
          `;
        })}
      </div>

      <!-- Event log -->
      <div class="pf-agd-event-log-scroll">
        ${filtered.length === 0 && html`
          <div class="pf-agd-empty">${t('profile.agents.detail.empty.activity')}</div>
        `}
        ${filtered.map((ev, i) => {
          const cat = eventCategory(ev);
          const evType = (ev.type || '').toLowerCase();
          const badgeClass = (evType.includes('policy') || evType.includes('violation'))
            ? 'pf-agd-event-badge--violation'
            : `pf-agd-event-badge--${cat}`;
          return html`
            <div key=${ev.id || i} class="pf-agd-log-entry pf-agd-log-entry--two-line">
              <div class="pf-agd-log-entry-primary">
                <span class="pf-agd-log-time">${ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                <span class="pf-agd-event-badge ${badgeClass}">${t(FILTERS.find(f => f.id === cat)?.key || '') || cat}</span>
                <span class="pf-agd-log-type">${ev.type || ev.event || '-'}</span>
              </div>
              ${ev.message && html`<div class="pf-agd-log-entry-detail">${ev.message}</div>`}
            </div>
          `;
        })}
      </div>

      ${hasMore && html`
        <button class="btn-ghost btn-sm" onClick=${handleLoadMore}>
          ${t('profile.agents.detail.showAll')}
        </button>
      `}

      <div class="pf-agd-help-text">${t('profile.agents.detail.activity.auditTrail')}</div>
    </div>
  `;
}
