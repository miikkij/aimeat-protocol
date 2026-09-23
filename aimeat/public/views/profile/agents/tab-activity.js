/**
 * @file tab-activity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Enhanced Activity tab with governance filter and category badges.
 *   Wraps the existing activity subtab with additional filter pills.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: a small numeral band, a governance section
 *     of key-value rows, tab filters and timeline rows whose marker carries the old badge colour.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.8.0 -- 2026-09-06 -- The delivery line's dot counts a held connection, not just a sighting in
 *     the last 24 h, so an agent whose runtime starts per job stops reading as inactive between jobs.
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
import { swallowed } from '/js/swallowed.js';
import { num, time as fmtTime } from '/js/format.js';
import { Stack, Section, ListRow, NumeralBand, KeyValue, Toolbar, Chip, Action, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

const FILTERS = [
  { id: 'all', key: 'profile.agents.detail.activity.filterAll' },
  { id: 'tasks', key: 'profile.agents.detail.activity.filterTasks' },
  { id: 'messages', key: 'profile.agents.detail.activity.filterMessages' },
  { id: 'governance', key: 'profile.agents.detail.activity.filterGovernance' },
  { id: 'system', key: 'profile.agents.detail.activity.filterSystem' },
];

/**
 * Is a daemon holding this agent's connection open right now? The server says so in the health
 * verdict's delivery channel. The dot beside this line used to be drawn from `last_seen` alone,
 * which for an agent that starts a runtime per job goes grey between jobs while the agent is a
 * second away from working.
 */
function socketHeld(agent) {
  return agent?.health?.delivery?.channel === 'socket';
}

/** The timeline marker's tone for an event: a policy violation is danger, otherwise its category. */
const CATEGORY_MARKER = { tasks: 'info', messages: 'sun', governance: 'coral', system: 'muted' };
function eventMarker(event, cat) {
  const type = (event.type || '').toLowerCase();
  if (type.includes('policy') || type.includes('violation')) return 'danger';
  return CATEGORY_MARKER[cat] || 'muted';
}

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
        getLedgerUsage(agent?.gaii || agentName, { groupBy: 'day' }).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
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
          getActivity(agentName, 30).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
          getActivityLog(agentName, 1, 50).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
          getDirectives(agentName).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
          getWebhookConfig(agentName).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
          getTelemetry(agentName, { days: 1 }).catch(err => { swallowed('tab-activity: loadData', err); return null; }),
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
    } catch (err) {
      swallowed('tab-activity: webhookTotalCount', err);
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
    } catch (err) { swallowed('tab-activity: handleLoadMore', err); }
  }

  if (loading) {
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
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
  const recentlySeen = socketHeld(agent) || (agent?.last_seen && (Date.now() - new Date(agent.last_seen).getTime() < 24 * 3600 * 1000));

  return html`
    <${Stack}>
      ${stats && html`
        <${NumeralBand} size="small" tone="plain" items=${[
          { id: 'completed', label: t('profile.agents.activity.tasksCompleted'), value: stats.tasksCompleted ?? 0 },
          { id: 'tokens', label: `${t('profile.agents.activity.tokensUsed')}${telemetryConnected ? '' : ` (${t('profile.agents.detail.activity.notReported') || 'not reported'})`}`,
            value: ledgerTokens != null ? num(ledgerTokens) : (telemetryConnected ? (stats.tokensUsed30d ?? 0) : '—') },
          { id: 'success', label: t('profile.agents.activity.successRate'), value: stats.successRate != null ? `${Math.round(stats.successRate)}%` : '-' },
        ]} />
      `}

      ${governance && html`
        <${Section} size="small" density="compact" title=${t('profile.agents.detail.activity.governance.title')}>
          ${governance.budget ? html`
            <${KeyValue} label=${t('profile.agents.detail.activity.governance.tokenBudget')}
              value=${`${num(governance.tokensUsedToday || 0)} / ${num(governance.budget.max_tokens_per_day || '---')}${governance.budget.max_tokens_per_day ? ` (${Math.round((governance.tokensUsedToday || 0) / governance.budget.max_tokens_per_day * 100)}%)` : ''}`} />
          ` : ''}
          <${KeyValue} label=${t('profile.agents.detail.activity.governance.tasksToday')}
            value=${`${t('profile.agents.detail.activity.governance.completed')}: ${governance.tasksCompleted}, ${t('profile.agents.detail.activity.governance.activeTasks')}: ${governance.tasksActive}, ${t('profile.agents.detail.activity.governance.failed')}: ${governance.tasksFailed}`} />
          <${KeyValue} label=${t('profile.agents.detail.activity.governance.policyIssues')}
            value=${html`<${Text} tone=${governance.policyIssues > 0 ? 'danger' : 'plain'}>${governance.policyIssues}<//>`} />
          <${KeyValue} label=${t('profile.agents.detail.activity.governance.telemetryEvents')} value=${governance.telemetryCount} />
          <${KeyValue} label=${t('profile.agents.detail.activity.governance.deliveryHealth')}
            value=${(!governance.mcpActive && !governance.webhookEnabled)
              ? html`<${Text} kind="mono" tone=${recentlySeen ? 'success' : 'muted'}>${socketHeld(agent) ? (t('profile.agents.detail.activity.deliverySocketLine') || 'Delivery: live link') : (t('profile.agents.detail.activity.deliveryPollingLine') || 'Delivery: polling')}<//>`
              : html`
                <${Text} kind="mono" tone=${governance.mcpActive ? 'success' : 'muted'}>${governance.mcpActive
                  ? `${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.connected')}`
                  : `${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.notConfigured')}`}<//>
                ${' | '}
                ${governance.webhookEnabled
                  ? `${t('profile.agents.webhook.title')}: ${governance.webhookSuccessCount}/${governance.webhookTotalCount}`
                  : t('profile.agents.detail.integration.webhookNotConfigured')
                }`} />
        <//>
      `}

      <${Toolbar} filters=${FILTERS.map(f => {
        const label = t(f.key);
        return { id: f.id, selected: filter === f.id, onClick: () => setFilter(f.id),
          label: label !== f.key ? label : f.id.charAt(0).toUpperCase() + f.id.slice(1) };
      })} />

      <${Stack} density="compact">
        ${filtered.length === 0 && html`
          <${Text} tone="muted">${t('profile.agents.detail.empty.activity')}<//>
        `}
        ${filtered.map((ev, i) => {
          const cat = eventCategory(ev);
          return html`
            <${ListRow} key=${ev.id || i} density="compact" detailKind="text"
              time=${ev.timestamp ? fmtTime(ev.timestamp, { hour: '2-digit', minute: '2-digit' }) : '-'}
              marker=${eventMarker(ev, cat)}
              name=${html`<${Chip} tone="muted">${t(FILTERS.find(f => f.id === cat)?.key || '') || cat}<//> ${ev.type || ev.event || '-'}`}
              detail=${ev.message} />
          `;
        })}
      <//>

      ${hasMore && html`
        <${Action} onClick=${handleLoadMore}>${t('profile.agents.detail.showAll')}<//>
      `}

      <${Text} kind="caption" tone="muted">${t('profile.agents.detail.activity.auditTrail')}<//>
    <//>
  `;
}
