/**
 * @file stats-tab.js
 * @description Admin dashboard Statistics tab with time range selector, notification
 *   delivery sections (email, push, mailbox), and per-day Chart.js charts.
 *   Manages its own data fetching so the period can be changed without reloading
 *   the entire dashboard.
 * @structure
 *   - getDateRange(period)   -- converts preset key to { from, to } date strings
 *   - successRate / rateColor -- helpers for delivery percentage display
 *   - sumByPrefix            -- sums daily history keys matching a prefix
 *   - TimeRange              -- period preset buttons + custom date inputs
 *   - BreakdownTable         -- generic type-breakdown table (email / push)
 *   - StatsTab (default)     -- main tab component
 *   - renderAllCharts        -- loads Chart.js and draws all canvases
 * @version-history
 *   v1.0.0 -- 2026-05-01 -- Initial stats tab with basic cards and Chart.js charts
 *   v2.0.0 -- 2026-05-21 -- Major rewrite: time range selector, email / push /
 *     mailbox notification sections, per-day charts, self-managed data fetching
 *   v2.0.1 -- 2026-05-21 -- i18n chart labels, chart cleanup on unmount, live
 *     badges on gauge cards, section header CSS classes, breakdown table th fix
 *   v2.0.2 -- 2026-05-21 -- Replace inline styles with CSS classes, i18n weekday
 *     labels, use periodCustom/periodFrom/periodTo i18n keys on date inputs
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, fmtBytes, StatsGrid, StatCard, EconRow } from './shared.js';
import * as api from '/js/services/admin.js';

/* ── Helpers ── */

/** Compute { from, to } date strings from a period preset key. */
function getDateRange(period) {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const to = fmt(today);
  switch (period) {
    case 'today': return { from: to, to };
    case 'week': {
      const mon = new Date(today);
      mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      return { from: fmt(mon), to };
    }
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      return { from: fmt(d), to };
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      return { from: fmt(d), to };
    }
    default: return null; // 'all' = no params
  }
}

function successRate(sent, failed) {
  if (!sent && !failed) return null;
  return ((sent / (sent + failed)) * 100).toFixed(1);
}

function rateColor(rate) {
  if (rate === null) return 'var(--text-dim)';
  const n = parseFloat(rate);
  if (n >= 95) return '#22c55e';
  if (n >= 80) return '#eab308';
  return '#ef4444';
}

/** Sum all values in a day-object whose key starts with `prefix`. */
function sumByPrefix(dayData, prefix) {
  let total = 0;
  for (const [key, val] of Object.entries(dayData || {})) {
    if (key.startsWith(prefix)) total += val;
  }
  return total;
}

/* ── Sub-components ── */

function TimeRange({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  const presets = [
    { key: 'today', label: t('dashboard.periodToday') },
    { key: 'week',  label: t('dashboard.periodThisWeek') },
    { key: '7d',    label: t('dashboard.period7Days') },
    { key: '30d',   label: t('dashboard.period30Days') },
    { key: 'all',   label: t('dashboard.periodAll') },
  ];
  return html`
    <div class="adm-time-range">
      <span class="adm-time-range-label">${t('dashboard.periodLabel')}:</span>
      ${presets.map(p => html`
        <button class="adm-time-btn ${period === p.key ? 'active' : ''}"
          onClick=${() => setPeriod(p.key)}>${p.label}</button>
      `)}
      <div class="adm-time-custom">
        <span class="adm-text-dim adm-text-sm">${t('dashboard.periodCustom')}:</span>
        <input type="date" value=${customFrom} aria-label=${t('dashboard.periodFrom')}
          onInput=${e => setCustomFrom(e.target.value)} />
        <span class="adm-date-separator">-</span>
        <input type="date" value=${customTo} aria-label=${t('dashboard.periodTo')}
          onInput=${e => setCustomTo(e.target.value)} />
        <button class="adm-time-btn" onClick=${onApply}>${t('dashboard.periodApply')}</button>
      </div>
    </div>
  `;
}

function BreakdownTable({ byType, columns, typePrefix }) {
  if (!byType || Object.keys(byType).length === 0) return null;
  return html`
    <table class="adm-breakdown-table">
      <thead><tr>
        <th>${t('dashboard.breakdownType')}</th>
        ${columns.map(c => html`<th class="num">${t(c.label)}</th>`)}
      </tr></thead>
      <tbody>
        ${Object.keys(byType).map(type => html`
          <tr>
            <td>${t(typePrefix + type) || type}</td>
            ${columns.map(c => html`<td class="num">${num(c.getData(type))}</td>`)}
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

/* ── Main component ── */

export default function StatsTab({ data }) {
  const [period, setPeriod] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sd, setSd] = useState(data.stats);
  const [loading, setLoading] = useState(false);
  const chartRefs = useRef({});

  const fetchStats = useCallback(async (p, cf, ct, { showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const range = p === 'custom'
        ? (cf && ct ? { from: cf, to: ct } : null)
        : getDateRange(p);
      const resp = await api.getStats(range?.from, range?.to);
      if (resp.data) setSd(resp.data);
    } catch { /* keep existing data */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (period !== 'custom') fetchStats(period);
  }, [period]);

  // Listen for live updates
  useEffect(() => {
    const handler = () => { fetchStats(period, customFrom, customTo, { showSpinner: false }); }; // silent: no flash
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [period, customFrom, customTo]);

  // Re-render charts when data changes; destroy on unmount
  useEffect(() => {
    if (sd) renderAllCharts(sd, chartRefs);
    return () => {
      for (const key of Object.keys(chartRefs.current)) {
        if (chartRefs.current[key]) {
          chartRefs.current[key].destroy();
          delete chartRefs.current[key];
        }
      }
    };
  }, [sd]);

  if (!sd) return html`<div class="empty">${t('dashboard.statsNotAvailable')}</div>`;

  const ts = sd.tunnel || {};
  const ms = sd.mailbox || {};
  const cs = sd.consent_permissions || {};
  const gs = sd.gauges || {};

  // Email stats
  const emailSent    = sd.email_sent || 0;
  const emailFailed  = sd.email_failed || 0;
  const emailRetried = sd.email_retried || 0;
  const emailRate    = successRate(emailSent, emailFailed);

  // Push stats
  const pushSent    = sd.push_sent || 0;
  const pushFailed  = sd.push_failed || 0;
  const pushExpired = sd.push_expired_subs || 0;
  const pushRate    = successRate(pushSent, pushFailed);

  // Mailbox notification stats
  const mboxSent    = sd.mailbox_notif_sent || 0;
  const mboxFailed  = sd.mailbox_notif_failed || 0;
  const mboxBlocked = sd.mailbox_notif_blocked || 0;

  return html`
    <!-- Time Range Selector -->
    <${TimeRange} period=${period} setPeriod=${setPeriod}
      customFrom=${customFrom} setCustomFrom=${setCustomFrom}
      customTo=${customTo} setCustomTo=${setCustomTo}
      onApply=${() => fetchStats('custom', customFrom, customTo)} />

    ${loading ? html`<div class="adm-text-dim adm-text-sm">${t('dashboard.loading')}</div>` : ''}

    <p class="adm-text-dim adm-text-sm adm-mb-lg">${t('dashboard.statsExplain')}</p>

    <!-- Top-level stat cards -->
    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('dashboard.requestsTotal')} value=${sd.requests_total} />
      <${StatCard} label=${t('dashboard.memoryOps')} value=${(sd.memory_reads || 0) + (sd.memory_writes || 0)} sub=${t('dashboard.reads') + ': ' + num(sd.memory_reads) + ' / ' + t('dashboard.writes') + ': ' + num(sd.memory_writes)} />
      <${StatCard} label=${t('dashboard.consentOps')} value=${(sd.consent_grants || 0) + (sd.consent_revocations || 0)} sub=${t('dashboard.grants') + ': ' + num(sd.consent_grants) + ' / ' + t('dashboard.revocations') + ': ' + num(sd.consent_revocations)} />
      <${StatCard} label=${t('dashboard.schemaOps')} value=${sd.schema_validations} sub=${t('dashboard.failures') + ': ' + num(sd.schema_validation_failures)} />
    </div>

    <div class="adm-grid adm-grid-4 adm-mb-lg">
      <${StatCard} label=${t('dashboard.uptime')} value=${fmtUp(sd.uptime_seconds || 0)} />
      <${StatCard} label=${t('dashboard.registeredOwners')} value=${sd.active_owners} />
      <${StatCard} label=${t('dashboard.registeredAgents')} value=${sd.active_agents} />
    </div>

    <!-- Charts (daily, weekly, monthly) -->
    <div class="adm-grid adm-grid-2">
      <div class="adm-card"><h2>${t('dashboard.dailyActivity')}</h2><canvas id="chartDaily" height="200"></canvas></div>
      <div class="adm-card"><h2>${t('dashboard.weeklyComparison')}</h2><canvas id="chartWeekly" height="200"></canvas></div>
    </div>
    <div class="adm-card adm-mt-lg"><h2>${t('dashboard.monthlyTrend')}</h2><canvas id="chartMonthly" height="160"></canvas></div>

    <!-- Tunnel Stats -->
    <h3 class="adm-mt-lg adm-text-sm adm-text-accent">${t('dashboard.tunnelStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${html`${t('dashboard.tunnelActive')} <span class="adm-badge-live">${t('dashboard.live')}</span>`} value=${gs.tunnel_connections_active ?? ts.connections_active ?? 0} color="#22c55e" />
      <${StatCard} label=${t('dashboard.tunnelTotal')} value=${ts.connections_total || 0} />
      <${StatCard} label=${t('dashboard.tunnelDisconnections')} value=${ts.disconnections_total || 0} color="#eab308" />
      <${StatCard} label=${t('dashboard.tunnelReconnects')} value=${ts.reconnects_total || 0} color="#3b82f6" />
    </div>
    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('dashboard.tunnelMsgSent')} value=${ts.messages_sent_total || 0} />
      <${StatCard} label=${t('dashboard.tunnelMsgReceived')} value=${ts.messages_received_total || 0} />
      <${StatCard} label=${t('dashboard.tunnelDeliveryFails')} value=${ts.delivery_failures_total || 0} color=${ts.delivery_failures_total > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.tunnelHeartbeatMisses')} value=${ts.heartbeat_misses_total || 0} color=${ts.heartbeat_misses_total > 0 ? '#eab308' : '#22c55e'} />
    </div>
    <div class="adm-grid adm-grid-2">
      <div class="adm-card">
        <h2>${t('dashboard.latency')}</h2>
        <${EconRow} label=${t('dashboard.tunnelLatencyAvg')} value=${(ts.delivery_latency_avg_ms || 0).toFixed(1) + ' ms'} />
        <${EconRow} label=${t('dashboard.tunnelLatencyP95')} value=${(ts.delivery_latency_p95_ms || 0).toFixed(1) + ' ms'} />
        <${EconRow} label=${t('dashboard.tunnelMailboxFallbacks')} value=${num(ts.mailbox_fallbacks_total || 0)} />
      </div>
      <div class="adm-card"><h2>${t('dashboard.tunnelActivity')}</h2><canvas id="chartTunnel" height="180"></canvas></div>
    </div>

    <!-- Mailbox Stats -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-purple">${t('dashboard.mailboxStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${html`${t('dashboard.mailboxItems')} <span class="adm-badge-live">${t('dashboard.live')}</span>`} value=${gs.mailbox_items_total ?? ms.items_total ?? 0} />
      <${StatCard} label=${html`${t('dashboard.mailboxBytes')} <span class="adm-badge-live">${t('dashboard.live')}</span>`} value=${fmtBytes(gs.mailbox_bytes_total ?? ms.bytes_total ?? 0)} />
      <${StatCard} label=${t('dashboard.mailboxEnqueued')} value=${ms.enqueued_total || 0} color="#3b82f6" />
      <${StatCard} label=${t('dashboard.mailboxDelivered')} value=${ms.delivered_total || 0} color="#22c55e" />
    </div>
    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('dashboard.mailboxExpired')} value=${ms.expired_total || 0} color=${ms.expired_total > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.mailboxQuotaRejects')} value=${ms.quota_rejections_total || 0} color=${ms.quota_rejections_total > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${html`${t('dashboard.mailboxOldestAge')} <span class="adm-badge-live">${t('dashboard.live')}</span>`} value=${fmtUp(gs.mailbox_oldest_item_age_seconds ?? ms.oldest_item_age_seconds ?? 0)} color="var(--text-dim)" />
    </div>

    <!-- Email Delivery -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-cyan">${t('dashboard.emailDelivery')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.emailsSent')} value=${emailSent} />
      <${StatCard} label=${t('dashboard.emailsFailed')} value=${emailFailed} color=${emailFailed > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.emailsRetried')} value=${emailRetried} color=${emailRetried > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.successRate')} value=${emailRate !== null ? emailRate + '%' : '—'} color=${rateColor(emailRate)} />
    </div>
    ${sd.email_sent_by_type ? html`
      <div class="adm-card adm-mt-md">
        <${BreakdownTable} byType=${sd.email_sent_by_type}
          typePrefix="dashboard.emailType."
          columns=${[
            { label: 'dashboard.breakdownSent',    getData: type => (sd.email_sent_by_type || {})[type] || 0 },
            { label: 'dashboard.breakdownFailed',  getData: type => (sd.email_failed_by_type || {})[type] || 0 },
            { label: 'dashboard.breakdownRetried', getData: type => (sd.email_retried_by_type || {})[type] || 0 },
          ]} />
      </div>
    ` : ''}
    <div class="adm-card adm-mt-md"><canvas id="chartEmailDaily" height="180"></canvas></div>

    <!-- Push Notifications -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-violet">${t('dashboard.pushDelivery')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.pushSent')} value=${pushSent} />
      <${StatCard} label=${t('dashboard.pushFailed')} value=${pushFailed} color=${pushFailed > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.expiredSubs')} value=${pushExpired} color=${pushExpired > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.successRate')} value=${pushRate !== null ? pushRate + '%' : '—'} color=${rateColor(pushRate)} />
    </div>
    ${sd.push_sent_by_type ? html`
      <div class="adm-card adm-mt-md">
        <${BreakdownTable} byType=${sd.push_sent_by_type}
          typePrefix="dashboard.pushType."
          columns=${[
            { label: 'dashboard.breakdownSent',   getData: type => (sd.push_sent_by_type || {})[type] || 0 },
            { label: 'dashboard.breakdownFailed', getData: type => (sd.push_failed_by_type || {})[type] || 0 },
          ]} />
      </div>
    ` : ''}
    <div class="adm-card adm-mt-md"><canvas id="chartPushDaily" height="180"></canvas></div>

    <!-- Mailbox Notifications -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-amber">${t('dashboard.mailboxNotifications')}</h3>
    <div class="adm-grid adm-grid-3 adm-mt-md">
      <${StatCard} label=${t('dashboard.mailboxNotifSent')} value=${mboxSent} />
      <${StatCard} label=${t('dashboard.mailboxNotifFailed')} value=${mboxFailed} color=${mboxFailed > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.mailboxNotifBlocked')} value=${mboxBlocked} color=${mboxBlocked > 0 ? '#eab308' : '#22c55e'} />
    </div>
    ${(sd.mailbox_notif_blocked_by_type || sd.mailbox_notif_sent_by_type) ? html`
      <div class="adm-card adm-mt-md adm-text-sm adm-mailbox-inline">
        ${sd.mailbox_notif_blocked_by_type ? html`
          <div class="adm-blocked-reasons">
            <strong>${t('dashboard.blocked')}:</strong>
            ${' '} ${t('dashboard.blockedCooldown')}: ${num((sd.mailbox_notif_blocked_by_type || {}).cooldown || 0)}
            ${' | '} ${t('dashboard.blockedQuietHours')}: ${num((sd.mailbox_notif_blocked_by_type || {}).quiet_hours || 0)}
            ${' | '} ${t('dashboard.blockedDisabled')}: ${num((sd.mailbox_notif_blocked_by_type || {}).disabled || 0)}
          </div>
        ` : ''}
        ${sd.mailbox_notif_sent_by_type ? html`
          <div class="adm-channels-summary">
            <strong>${t('dashboard.channels')}:</strong>
            ${' '} ${t('dashboard.channelPush')}: ${num((sd.mailbox_notif_sent_by_type || {}).push || 0)} ${t('dashboard.breakdownSent').toLowerCase()}, ${num((sd.mailbox_notif_failed_by_type || {}).push || 0)} ${t('dashboard.breakdownFailed').toLowerCase()}
            ${' | '} ${t('dashboard.channelEmail')}: ${num((sd.mailbox_notif_sent_by_type || {}).email || 0)} ${t('dashboard.breakdownSent').toLowerCase()}, ${num((sd.mailbox_notif_failed_by_type || {}).email || 0)} ${t('dashboard.breakdownFailed').toLowerCase()}
          </div>
        ` : ''}
      </div>
    ` : ''}

    <!-- Consent Permission Stats -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-purple">${t('dashboard.consentPermStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.consentActiveRules')} value=${cs.active_rules || 0} color="#a855f7" />
      <${StatCard} label=${t('dashboard.consentByGaii')} value=${cs.by_gaii || 0} color="#3b82f6" />
      <${StatCard} label=${t('dashboard.consentByGhii')} value=${cs.by_ghii || 0} color="#a855f7" />
      <${StatCard} label=${t('dashboard.consentByOrganism')} value=${cs.by_organism || 0} color="#22c55e" />
    </div>
    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('dashboard.consentByDomain')} value=${cs.by_domain || 0} color="#eab308" />
      <${StatCard} label=${t('dashboard.consentByNode')} value=${cs.by_node || 0} color="var(--text-dim)" />
      <${StatCard} label=${t('dashboard.consentByWildcard')} value=${cs.by_wildcard || 0} color=${cs.by_wildcard > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.consentDataPatterns')} value=${cs.unique_patterns || 0} />
    </div>

    <!-- Security Stats -->
    <h3 class="adm-mt-lg adm-text-sm adm-section-red">${t('dashboard.securityStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.authFailures')} value=${sd.auth_failures_total || 0} color=${sd.auth_failures_total > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.rateLimitHits')} value=${sd.rate_limit_hits_total || 0} color=${sd.rate_limit_hits_total > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.scopeDenials')} value=${sd.scope_denials_total || 0} color=${sd.scope_denials_total > 0 ? '#eab308' : '#22c55e'} />
    </div>
  `;
}

/* ── Chart rendering ── */

/** Load Chart.js from CDN and render all charts. */
async function renderAllCharts(sd, chartRefs) {
  // Load Chart.js if not already available
  if (!window.Chart) {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  if (!window.Chart) return;

  // Destroy previous chart instances
  const refs = chartRefs.current;
  for (const key of Object.keys(refs)) {
    if (refs[key] && typeof refs[key].destroy === 'function') {
      refs[key].destroy();
    }
  }
  chartRefs.current = {};

  const daily = sd.daily || sd.daily_history || {};
  const days = Object.keys(daily).sort().slice(-30);

  const chartOpts = {
    responsive: true,
    plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#94a3b8', maxRotation: 45 }, grid: { color: '#334155' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
    },
  };

  // Daily Activity bar chart
  const dc = document.getElementById('chartDaily');
  if (dc) {
    refs.chartDaily = new Chart(dc, { type: 'bar', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [
        { label: t('dashboard.requestsTotal') || 'Requests', data: days.map(d => (daily[d] || {}).requests_total || 0), backgroundColor: '#3b82f688' },
        { label: t('dashboard.writes') || 'Writes',   data: days.map(d => (daily[d] || {}).memory_writes || 0),  backgroundColor: '#22c55e88' },
        { label: t('dashboard.reads') || 'Reads',    data: days.map(d => (daily[d] || {}).memory_reads || 0),   backgroundColor: '#06b6d488' },
      ],
    }, options: chartOpts });
  }

  // Weekly Comparison line chart
  const wc = document.getElementById('chartWeekly');
  if (wc && days.length > 0) {
    const weekLabels = [t('dashboard.weekMon'), t('dashboard.weekTue'), t('dashboard.weekWed'), t('dashboard.weekThu'), t('dashboard.weekFri'), t('dashboard.weekSat'), t('dashboard.weekSun')];
    const getWeekData = (weeksAgo) => {
      const data = new Array(7).fill(0);
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - d.getDay() + i + 1 - (weeksAgo * 7));
        const key = d.toISOString().slice(0, 10);
        if (daily[key]) data[i] = daily[key].requests_total || 0;
      }
      return data;
    };
    refs.chartWeekly = new Chart(wc, { type: 'line', data: {
      labels: weekLabels,
      datasets: [
        { label: t('dashboard.thisWeek') || 'This week', data: getWeekData(0), borderColor: '#3b82f6', backgroundColor: '#3b82f622', fill: true },
        { label: t('dashboard.lastWeek') || 'Last week', data: getWeekData(1), borderColor: '#22c55e', backgroundColor: '#22c55e22', fill: true },
      ],
    }, options: chartOpts });
  }

  // Monthly Trend line chart
  const mc = document.getElementById('chartMonthly');
  if (mc && days.length > 0) {
    refs.chartMonthly = new Chart(mc, { type: 'line', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [{ label: t('dashboard.requestsTotal') || 'Requests', data: days.map(d => (daily[d] || {}).requests_total || 0), borderColor: '#06b6d4', backgroundColor: '#06b6d422', fill: true }],
    }, options: chartOpts });
  }

  // Tunnel doughnut chart
  const tc = document.getElementById('chartTunnel');
  if (tc) {
    const tunnel = sd.tunnel || {};
    refs.chartTunnel = new Chart(tc, { type: 'doughnut', data: {
      labels: [t('dashboard.tunnelMsgSent') || 'Sent', t('dashboard.tunnelMsgReceived') || 'Received', t('dashboard.tunnelDeliveryFails') || 'Rejected', t('dashboard.tunnelMailboxFallbacks') || 'Fallbacks'],
      datasets: [{ data: [tunnel.messages_sent_total || 0, tunnel.messages_received_total || 0, tunnel.delivery_failures_total || 0, tunnel.mailbox_fallbacks_total || 0],
        backgroundColor: ['#3b82f6', '#22c55e', '#ef4444', '#eab308'] }],
    }, options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } } } });
  }

  // Email Daily bar chart
  const ec = document.getElementById('chartEmailDaily');
  if (ec && days.length > 0) {
    refs.chartEmailDaily = new Chart(ec, { type: 'bar', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [
        { label: t('dashboard.breakdownSent') || 'Sent',    data: days.map(d => sumByPrefix(daily[d], 'email_sent')),    backgroundColor: '#06b6d488' },
        { label: t('dashboard.breakdownFailed') || 'Failed',  data: days.map(d => sumByPrefix(daily[d], 'email_failed')),  backgroundColor: '#ef444488' },
        { label: t('dashboard.breakdownRetried') || 'Retried', data: days.map(d => sumByPrefix(daily[d], 'email_retried')), backgroundColor: '#eab30888' },
      ],
    }, options: chartOpts });
  }

  // Push Daily bar chart
  const pc = document.getElementById('chartPushDaily');
  if (pc && days.length > 0) {
    refs.chartPushDaily = new Chart(pc, { type: 'bar', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [
        { label: t('dashboard.breakdownSent') || 'Sent',   data: days.map(d => sumByPrefix(daily[d], 'push_sent')),   backgroundColor: '#8b5cf688' },
        { label: t('dashboard.breakdownFailed') || 'Failed', data: days.map(d => sumByPrefix(daily[d], 'push_failed')), backgroundColor: '#ef444488' },
      ],
    }, options: chartOpts });
  }
}
