/**
 * @file agents-activity-subtab.js
 * @description Activity sub-tab for agent detail view.
 *   Shows stats summary cards (tasks completed, tokens used, success rate),
 *   daily activity chart with time range selector, scheduled jobs list,
 *   and recent event log with pagination.
 * @structure
 *   - AgentActivitySubtab (default export) -- main component
 *   - StatsCards -- summary stat cards row
 *   - ActivityChart -- text-based daily activity display
 *   - ScheduledJobs -- cron job list with source badges
 *   - EventLog -- scrollable recent event entries
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { getActivity, getActivityLog } from '/js/services/agent-activity.js';

const RANGE_OPTIONS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function StatsCards({ stats }) {
  const cards = [
    { key: 'tasksCompleted', value: stats?.tasksCompleted ?? 0 },
    { key: 'tokensUsed', value: stats?.tokensUsed30d ?? 0 },
    { key: 'successRate', value: stats?.successRate != null ? `${Math.round(stats.successRate)}%` : '-' },
  ];

  return html`
    <div class="stat-grid">
      ${cards.map(c => html`
        <div class="stat-card" key=${c.key}>
          <div class="stat-card-value">${c.value}</div>
          <div class="stat-card-label">${t(`profile.agents.activity.${c.key}`)}</div>
        </div>
      `)}
    </div>
  `;
}

function ActivityChart({ history, selectedDays, onRangeChange }) {
  if (!history || history.length === 0) {
    return html`
      <div class="agd-chart-container">
        <div class="agd-range-bar">
          ${RANGE_OPTIONS.map(opt => html`
            <button key=${opt.days}
                    class="agd-range-btn ${selectedDays === opt.days ? 'active' : ''}"
                    onClick=${() => onRangeChange(opt.days)}>
              ${opt.label}
            </button>
          `)}
        </div>
        <div class="agd-empty">${t('profile.agents.activity.noActivity')}</div>
      </div>
    `;
  }

  // API returns { date, metric, value } rows -- aggregate tasks_completed per date
  const dailyTotals = {};
  for (const row of history) {
    if (row.metric === 'tasks_completed' || row.metric === 'tasks_started') {
      dailyTotals[row.date] = (dailyTotals[row.date] || 0) + (row.value || 0);
    }
  }
  const dates = Object.keys(dailyTotals).sort();
  const maxTasks = Math.max(...Object.values(dailyTotals), 1);

  return html`
    <div class="agd-chart-container">
      <div class="agd-range-bar">
        ${RANGE_OPTIONS.map(opt => html`
          <button key=${opt.days}
                  class="agd-range-btn ${selectedDays === opt.days ? 'active' : ''}"
                  onClick=${() => onRangeChange(opt.days)}>
            ${opt.label}
          </button>
        `)}
      </div>
      <div class="agd-chart-rows">
        ${dates.map(date => {
          const count = dailyTotals[date] || 0;
          const pct = Math.round((count / maxTasks) * 100);
          const dateStr = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return html`
            <div class="agd-chart-row" key=${date}>
              <span class="agd-chart-date">${dateStr}</span>
              <div class="agd-chart-bar-track">
                <div class="agd-chart-bar-fill" style="width:${pct}%"></div>
              </div>
              <span class="agd-chart-count">${count}</span>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function ScheduledJobs({ jobs }) {
  if (!jobs || jobs.length === 0) return null;

  return html`
    <div>
      <div class="agd-section-header">
        <span class="agd-section-title">${t('profile.agents.activity.scheduledJobs')}</span>
      </div>
      ${jobs.map((job, i) => html`
        <div class="agd-log-entry" key=${job.id || i}>
          <span class="${job.type === 'aimeat' ? 'agd-job-badge-aimeat' : 'agd-job-badge-agent'}">
            ${job.type === 'aimeat' ? t('profile.agents.activity.aimeatJob') : t('profile.agents.activity.agentJob')}
          </span>
          <span class="agd-log-type">${job.name || job.id || '-'}</span>
          <span class="agd-log-msg">${job.cron || ''}</span>
          <span class="agd-log-time">
            ${job.enabled === false ? 'disabled' : ''}
            ${job.lastRunAt ? timeAgo(job.lastRunAt) : ''}
          </span>
        </div>
      `)}
    </div>
  `;
}

function EventLog({ events, onViewMore }) {
  if (!events || events.length === 0) return null;

  return html`
    <div>
      <div class="agd-section-header">
        <span class="agd-section-title">${t('profile.agents.activity.recentLog')}</span>
      </div>
      <div class="agd-event-log-scroll">
        ${events.map((ev, i) => html`
          <div class="agd-log-entry" key=${ev.id || i}>
            <span class="agd-log-time">${ev.timestamp ? timeAgo(ev.timestamp) : '-'}</span>
            <span class="agd-log-type">${ev.type || ev.event || '-'}</span>
            <span class="agd-log-msg">${ev.message || ''}</span>
          </div>
        `)}
      </div>
      ${onViewMore && html`
        <button class="btn-ghost btn-sm" onClick=${onViewMore}>
          ${t('profile.agents.activity.viewFullLog')}
        </button>
      `}
    </div>
  `;
}

export default function AgentActivitySubtab({ agentName, session, showToast }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedDays, setSelectedDays] = useState(30);
  const [logPage, setLogPage] = useState(1);
  const [hasMoreLog, setHasMoreLog] = useState(false);

  async function loadData(days) {
    const daysToUse = days ?? selectedDays;
    try {
      const [actResp, logResp] = await Promise.all([
        getActivity(agentName, daysToUse),
        getActivityLog(agentName, 1, 20),
      ]);
      setStats(actResp?.data?.activity_stats || null);
      setHistory(actResp?.data?.history || []);
      setJobs(actResp?.data?.scheduled_jobs || []);
      setEvents(logResp?.data?.events || []);
      setHasMoreLog((logResp?.data?.events || []).length >= 20);
      setLogPage(1);
    } catch {
      setStats(null);
      setHistory([]);
      setJobs([]);
      setEvents([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [agentName]);

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['agent-tasks', 'agents'], () => loadRef.current()), []);

  function handleRangeChange(days) {
    setSelectedDays(days);
    setLoading(true);
    loadData(days);
  }

  async function handleViewMore() {
    const nextPage = logPage + 1;
    try {
      const resp = await getActivityLog(agentName, nextPage, 20);
      const newEvents = resp?.data?.events || [];
      setEvents(prev => [...prev, ...newEvents]);
      setLogPage(nextPage);
      setHasMoreLog(newEvents.length >= 20);
    } catch {
      // silent
    }
  }

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  const hasAnyData = stats || history.length > 0 || jobs.length > 0 || events.length > 0;

  if (!hasAnyData) {
    return html`<div class="agd-empty">${t('profile.agents.activity.noActivity')}</div>`;
  }

  return html`
    <div>
      <${StatsCards} stats=${stats} />
      <${ActivityChart} history=${history} selectedDays=${selectedDays} onRangeChange=${handleRangeChange} />
      <${ScheduledJobs} jobs=${jobs} />
      <${EventLog} events=${events} onViewMore=${hasMoreLog ? handleViewMore : null} />
    </div>
  `;
}
