/**
 * @file tab-activity.js
 * @description Enhanced Activity tab with governance filter and category badges.
 *   Wraps the existing activity subtab with additional filter pills.
 * @version-history
 *   v1.4.0 -- 2026-05-24 -- Audit fix: two-line event layout with secondary detail row
 *   v1.3.0 -- 2026-05-24 -- Wire up MCP status in delivery health from agent data
 *   v1.2.0 -- 2026-05-24 -- Fix: F17 task breakdown, F18 violation red badge, M5 governance i18n namespace
 *   v1.1.0 -- 2026-05-24 -- Fix: HH:MM timestamps, token budget %, readiness/override categories, audit trail footer, fix locale prefix
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { getActivity, getActivityLog } from '/js/services/agent-activity.js';
import { getDirectives } from '/js/services/agent-directives.js';
import { getWebhookConfig, getTelemetry, getDeliveryLog } from '/js/services/agent-integration.js';

const html = htm.bind(h);

const FILTERS = [
  { id: 'all', key: 'profile.agents.detail.activity.filterAll' },
  { id: 'tasks', key: 'profile.agents.detail.activity.filterTasks' },
  { id: 'messages', key: 'profile.agents.detail.activity.filterMessages' },
  { id: 'governance', key: 'profile.agents.detail.activity.filterGovernance' },
  { id: 'system', key: 'profile.agents.detail.activity.filterSystem' },
];

function eventCategory(event) {
  const type = (event.type || event.event || '').toLowerCase();
  if (type.includes('task') || type.includes('todo')) return 'tasks';
  if (type.includes('message') || type.includes('msg')) return 'messages';
  if (type.includes('approve') || type.includes('scope') || type.includes('permission') || type.includes('governance') || type.includes('policy') || type.includes('readiness') || type.includes('override')) return 'governance';
  return 'system';
}

export default function TabActivity({ agent, agentName, session, showToast }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [governance, setGovernance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [logPage, setLogPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [actResp, logResp, dirResp, whResp, telResp] = await Promise.all([
        getActivity(agentName, 30).catch(() => null),
        getActivityLog(agentName, 1, 50).catch(() => null),
        getDirectives(agentName).catch(() => null),
        getWebhookConfig(agentName).catch(() => null),
        getTelemetry(agentName, { days: 1 }).catch(() => null),
      ]);
      setStats(actResp?.data?.activity_stats || null);
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
      const telemetryEntries = telResp?.data?.entries || [];

      setGovernance({
        budget,
        tokensUsedToday: telemetryEntries.reduce((sum, e) => sum + (e.tokens_used || 0), 0),
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

  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
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

  if (events.length === 0 && !stats) {
    return html`<div class="pf-agd-empty">${t('profile.agents.detail.empty.activity')}</div>`;
  }

  const filtered = filter === 'all' ? events : events.filter(ev => eventCategory(ev) === filter);

  return html`
    <div>
      <!-- Stats summary -->
      ${stats && html`
        <div class="pf-agd-stats-grid">
          <div class="pf-agd-stat-card">
            <div class="pf-agd-stat-value">${stats.tasksCompleted ?? 0}</div>
            <div class="pf-agd-stat-label">${t('profile.agents.activity.tasksCompleted')}</div>
          </div>
          <div class="pf-agd-stat-card">
            <div class="pf-agd-stat-value">${stats.tokensUsed30d ?? 0}</div>
            <div class="pf-agd-stat-label">${t('profile.agents.activity.tokensUsed')}</div>
          </div>
          <div class="pf-agd-stat-card">
            <div class="pf-agd-stat-value">${stats.successRate != null ? `${Math.round(stats.successRate)}%` : '-'}</div>
            <div class="pf-agd-stat-label">${t('profile.agents.activity.successRate')}</div>
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
              ${governance.mcpActive
                ? html`<span class="pf-agd-status-dot pf-agd-status-dot--active"></span> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.connected')}`
                : html`<span class="pf-agd-status-dot pf-agd-status-dot--inactive"></span> ${t('profile.agents.detail.activity.governance.mcpLabel')}: ${t('profile.agents.detail.activity.governance.notConfigured')}`
              }
              ${' | '}
              ${governance.webhookEnabled
                ? `${t('profile.agents.webhook.title')}: ${governance.webhookSuccessCount}/${governance.webhookTotalCount}`
                : t('profile.agents.detail.integration.webhookNotConfigured')
              }
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
