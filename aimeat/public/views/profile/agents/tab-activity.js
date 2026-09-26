/**
 * @file tab-activity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Enhanced Activity tab with governance filter and category badges.
 *   Wraps the existing activity subtab with additional filter pills.
 * @version-history
 *   v1.21.0 -- 2026-09-26 -- Onto the components: the figures are the FigureStrip (lead), governance a
 *     section Card with the Facts (the warn tone for policy issues), the dots the StatusDot, the filter
 *     row the Tabs (filter tone), the log the TimelineList (scroll) with its kind as a Mark (coral for
 *     trouble), "show all" the More line, the lines the Note. The file writes no class any more.
 *   v1.20.0 -- 2026-09-26 -- The event log is the home's Timeline (components/Timeline.js): the time, a dot for the kind (trouble, access, the agent's work, the system), and one line with the kind tag kept before what happened; the grey second line joins the first (a unification: Jouni's decision "Activity log").
 *   v1.19.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.18.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.17.0 -- 2026-09-26 -- Policy issues above zero are the Facts value's warn tone (.facts-v--warn), a meaning kept as a tone of the library part.
 *   v1.16.0 -- 2026-09-25 -- A dot that says a state (active, inactive, running, something unseen) is the status dot (css/components/status-dot.css), a unification: the look most tabs use.
 *   v1.15.0 -- 2026-09-25 -- The governance figures are the Facts (css/components/facts.css); a policy-issue count above zero keeps its warn colour as a tone, a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.12.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.11.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.10.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.9.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Card } from '/components/Card.js';
import { Tabs } from '/components/Tabs.js';
import { More } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { StatusDot } from '/components/StatusDot.js';

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

/**
 * The Timeline's dot for an event (components/Timeline.js categories): a failure or a policy
 * violation is trouble, a governance event is access, a task or a message is the agent's work,
 * the rest is the system.
 */
function dotOf(cat, evType) {
  if (evType.includes('policy') || evType.includes('violation') || evType.includes('fail') || evType.includes('error')) return 'trouble';
  if (cat === 'governance') return 'access';
  if (cat === 'tasks' || cat === 'messages') return 'agent';
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
    return html`<${Note} kind="loading" />`;
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

  const g = governance;
  const recentlySeen = socketHeld(agent) || (agent?.last_seen && (Date.now() - new Date(agent.last_seen).getTime() < 24 * 3600 * 1000));
  const delivery = g && ((!g.mcpActive && !g.webhookEnabled)
    ? html`<${StatusDot} status=${recentlySeen ? 'active' : 'inactive'} /> ${socketHeld(agent) ? (t('profile.agents.detail.activity.deliverySocketLine') || 'Delivery: live link') : (t('profile.agents.detail.activity.deliveryPollingLine') || 'Delivery: polling')}`
    : html`
      ${g.mcpActive
        ? html`<${StatusDot} status="active" /> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.connected')}`
        : html`<${StatusDot} status="inactive" /> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.notConfigured')}`
      }
      ${' | '}
      ${g.webhookEnabled
        ? `${t('profile.agents.webhook.title')}: ${g.webhookSuccessCount}/${g.webhookTotalCount}`
        : t('profile.agents.detail.integration.webhookNotConfigured')
      }`);

  return html`
    <div>
      <!-- Stats summary -->
      ${stats && html`<${FigureStrip} lead items=${[
        { key: 'done', n: stats.tasksCompleted ?? 0, label: t('profile.agents.activity.tasksCompleted') },
        { key: 'tokens', n: ledgerTokens != null ? num(ledgerTokens) : (telemetryConnected ? (stats.tokensUsed30d ?? 0) : '—'),
          label: `${t('profile.agents.activity.tokensUsed')}${telemetryConnected ? '' : ` (${t('profile.agents.detail.activity.notReported') || 'not reported'})`}` },
        { key: 'rate', n: stats.successRate != null ? `${Math.round(stats.successRate)}%` : '-', label: t('profile.agents.activity.successRate') },
      ]} />`}

      <!-- Governance summary -->
      ${g && html`
        <${Card} tone="section" title=${t('profile.agents.detail.activity.governance.title')}>
          <${Facts} rows=${[
            g.budget && { k: t('profile.agents.detail.activity.governance.tokenBudget'),
              v: `${num(g.tokensUsedToday || 0)} / ${num(g.budget.max_tokens_per_day || '---')}${g.budget.max_tokens_per_day ? ` (${Math.round((g.tokensUsedToday || 0) / g.budget.max_tokens_per_day * 100)}%)` : ''}` },
            { k: t('profile.agents.detail.activity.governance.tasksToday'),
              v: `${t('profile.agents.detail.activity.governance.completed')}: ${g.tasksCompleted}, ${t('profile.agents.detail.activity.governance.activeTasks')}: ${g.tasksActive}, ${t('profile.agents.detail.activity.governance.failed')}: ${g.tasksFailed}` },
            { k: t('profile.agents.detail.activity.governance.policyIssues'), v: g.policyIssues, warn: g.policyIssues > 0 },
            { k: t('profile.agents.detail.activity.governance.telemetryEvents'), v: g.telemetryCount },
            { k: t('profile.agents.detail.activity.governance.deliveryHealth'), v: delivery },
          ]} />
        <//>
      `}

      <!-- Filter bar -->
      <${Tabs} tone="filter" value=${filter} onSelect=${setFilter} items=${FILTERS.map((f) => {
        const label = t(f.key);
        return { value: f.id, label: label !== f.key ? label : f.id.charAt(0).toUpperCase() + f.id.slice(1) };
      })} />

      <!-- Event log -->
      ${filtered.length === 0 && html`<${Note} kind="quiet">${t('profile.agents.detail.empty.activity')}<//>`}
      ${filtered.length > 0 && html`<${TimelineList} scroll>${filtered.map((ev, i) => {
        const cat = eventCategory(ev);
        const evType = (ev.type || '').toLowerCase();
        const trouble = evType.includes('policy') || evType.includes('violation');
        return html`
          <${TimelineRow} key=${ev.id || i} category=${dotOf(cat, evType)}
            when=${ev.timestamp ? fmtTime(ev.timestamp, { hour: '2-digit', minute: '2-digit' }) : '-'}
            text=${html`<${Mark} tone=${trouble ? 'coral' : undefined}>${t(FILTERS.find(f => f.id === cat)?.key || '') || cat}<//> ${ev.type || ev.event || '-'}${ev.message ? `: ${ev.message}` : ''}`} />
        `;
      })}<//>`}

      ${hasMore && html`<${More} label=${t('profile.agents.detail.showAll')} onMore=${handleLoadMore} />`}

      <${Note}>${t('profile.agents.detail.activity.auditTrail')}<//>
    </div>
  `;
}
