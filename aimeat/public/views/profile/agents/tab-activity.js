/**
 * @file tab-activity.js
 * @description Enhanced Activity tab with governance filter and category badges.
 *   Wraps the existing activity subtab with additional filter pills.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { getActivity, getActivityLog } from '/js/services/agent-activity.js';

const html = htm.bind(h);

const FILTERS = [
  { id: 'all', key: 'agents.detail.activity.filterAll' },
  { id: 'tasks', key: 'agents.detail.activity.filterTasks' },
  { id: 'messages', key: 'agents.detail.activity.filterMessages' },
  { id: 'governance', key: 'agents.detail.activity.filterGovernance' },
  { id: 'system', key: 'agents.detail.activity.filterSystem' },
];

function eventCategory(event) {
  const type = (event.type || event.event || '').toLowerCase();
  if (type.includes('task') || type.includes('todo')) return 'tasks';
  if (type.includes('message') || type.includes('msg')) return 'messages';
  if (type.includes('approve') || type.includes('scope') || type.includes('permission') || type.includes('governance') || type.includes('policy')) return 'governance';
  return 'system';
}

export default function TabActivity({ agentName, session, showToast }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [logPage, setLogPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [actResp, logResp] = await Promise.all([
        getActivity(agentName, 30).catch(() => null),
        getActivityLog(agentName, 1, 50).catch(() => null),
      ]);
      setStats(actResp?.data?.activity_stats || null);
      setEvents(logResp?.data?.events || []);
      setHasMore((logResp?.data?.events || []).length >= 50);
      setLogPage(1);
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
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  if (events.length === 0 && !stats) {
    return html`<div class="agd-empty">${t('agents.detail.empty.activity')}</div>`;
  }

  const filtered = filter === 'all' ? events : events.filter(ev => eventCategory(ev) === filter);

  return html`
    <div>
      <!-- Stats summary -->
      ${stats && html`
        <div class="agd-stats-grid">
          <div class="agd-stat-card">
            <div class="agd-stat-value">${stats.tasksCompleted ?? 0}</div>
            <div class="agd-stat-label">${t('profile.agents.activity.tasksCompleted')}</div>
          </div>
          <div class="agd-stat-card">
            <div class="agd-stat-value">${stats.tokensUsed30d ?? 0}</div>
            <div class="agd-stat-label">${t('profile.agents.activity.tokensUsed')}</div>
          </div>
          <div class="agd-stat-card">
            <div class="agd-stat-value">${stats.successRate != null ? `${Math.round(stats.successRate)}%` : '-'}</div>
            <div class="agd-stat-label">${t('profile.agents.activity.successRate')}</div>
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
      <div class="agd-event-log-scroll">
        ${filtered.length === 0 && html`
          <div class="agd-empty">${t('agents.detail.empty.activity')}</div>
        `}
        ${filtered.map((ev, i) => {
          const cat = eventCategory(ev);
          return html`
            <div key=${ev.id || i} class="agd-log-entry">
              <span class="agd-log-time">${ev.timestamp ? timeAgo(ev.timestamp) : '-'}</span>
              <span class="pf-agd-event-badge pf-agd-event-badge--${cat}">${cat}</span>
              <span class="agd-log-type">${ev.type || ev.event || '-'}</span>
              <span class="agd-log-msg">${ev.message || ''}</span>
            </div>
          `;
        })}
      </div>

      ${hasMore && html`
        <button class="btn-ghost btn-sm" onClick=${handleLoadMore}>
          ${t('agents.detail.showAll')}
        </button>
      `}
    </div>
  `;
}
