import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, fmtBytes, StatsGrid, StatCard, EconRow } from './shared.js';

export default function StatsTab({ data }) {
  const sd = data.stats;
  const chartRef = useRef(false);

  useEffect(() => {
    if (sd && !chartRef.current) {
      chartRef.current = true;
      renderCharts(sd);
    }
  }, [sd]);

  if (!sd) return html`<div class="empty">${t('dashboard.statsNotAvailable')}</div>`;

  const ts = sd.tunnel || {};
  const ms = sd.mailbox || {};
  const cs = sd.consent_permissions || {};

  return html`
    <p class="adm-text-dim adm-text-sm adm-mb-lg">${t('dashboard.statsExplain')}</p>

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

    <div class="adm-grid adm-grid-2">
      <div class="adm-card"><h2>${t('dashboard.dailyActivity')}</h2><canvas id="chartDaily" height="200"></canvas></div>
      <div class="adm-card"><h2>${t('dashboard.weeklyComparison')}</h2><canvas id="chartWeekly" height="200"></canvas></div>
    </div>
    <div class="adm-card adm-mt-lg"><h2>${t('dashboard.monthlyTrend')}</h2><canvas id="chartMonthly" height="160"></canvas></div>

    <!-- Tunnel Stats -->
    <h3 class="adm-text-accent" style="margin-top:24px;font-size:.9rem">${t('dashboard.tunnelStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.tunnelActive')} value=${ts.connections_active || 0} color="#22c55e" />
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
    <h3 class="adm-mt-lg adm-text-sm" style="color:#a855f7">${t('dashboard.mailboxStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.mailboxItems')} value=${ms.items_total || 0} />
      <${StatCard} label=${t('dashboard.mailboxBytes')} value=${fmtBytes(ms.bytes_total || 0)} />
      <${StatCard} label=${t('dashboard.mailboxEnqueued')} value=${ms.enqueued_total || 0} color="#3b82f6" />
      <${StatCard} label=${t('dashboard.mailboxDelivered')} value=${ms.delivered_total || 0} color="#22c55e" />
    </div>
    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('dashboard.mailboxExpired')} value=${ms.expired_total || 0} color=${ms.expired_total > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.mailboxQuotaRejects')} value=${ms.quota_rejections_total || 0} color=${ms.quota_rejections_total > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.mailboxOldestAge')} value=${fmtUp(ms.oldest_item_age_seconds || 0)} color="var(--text-dim)" />
    </div>

    <!-- Consent Permission Stats -->
    <h3 class="adm-mt-lg adm-text-sm" style="color:#a855f7">${t('dashboard.consentPermStats')}</h3>
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
    <h3 class="adm-mt-lg adm-text-sm" style="color:#ef4444">${t('dashboard.securityStats')}</h3>
    <div class="adm-grid adm-grid-4 adm-mt-md">
      <${StatCard} label=${t('dashboard.authFailures')} value=${sd.auth_failures_total || 0} color=${sd.auth_failures_total > 0 ? '#ef4444' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.rateLimitHits')} value=${sd.rate_limit_hits_total || 0} color=${sd.rate_limit_hits_total > 0 ? '#eab308' : '#22c55e'} />
      <${StatCard} label=${t('dashboard.scopeDenials')} value=${sd.scope_denials_total || 0} color=${sd.scope_denials_total > 0 ? '#eab308' : '#22c55e'} />
    </div>
  `;
}

/** Load Chart.js and render charts */
async function renderCharts(sd) {
  // Load Chart.js from CDN
  if (!window.Chart) {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  if (!window.Chart) return;

  const daily = sd.daily_history || {};
  const days = Object.keys(daily).sort().slice(-30);
  const chartOpts = {
    responsive: true,
    plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#94a3b8', maxRotation: 45 }, grid: { color: '#334155' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
    },
  };

  const dc = document.getElementById('chartDaily');
  if (dc) {
    new Chart(dc, { type: 'bar', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [
        { label: 'Requests', data: days.map(d => (daily[d] || {}).requests_total || 0), backgroundColor: '#3b82f688' },
        { label: 'Writes', data: days.map(d => (daily[d] || {}).memory_writes || 0), backgroundColor: '#22c55e88' },
        { label: 'Reads', data: days.map(d => (daily[d] || {}).memory_reads || 0), backgroundColor: '#06b6d488' },
      ],
    }, options: chartOpts });
  }

  const wc = document.getElementById('chartWeekly');
  if (wc && days.length > 0) {
    const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
    new Chart(wc, { type: 'line', data: {
      labels: weekLabels,
      datasets: [
        { label: 'This week', data: getWeekData(0), borderColor: '#3b82f6', backgroundColor: '#3b82f622', fill: true },
        { label: 'Last week', data: getWeekData(1), borderColor: '#22c55e', backgroundColor: '#22c55e22', fill: true },
      ],
    }, options: chartOpts });
  }

  const mc = document.getElementById('chartMonthly');
  if (mc && days.length > 0) {
    new Chart(mc, { type: 'line', data: {
      labels: days.map(d => d.slice(5)),
      datasets: [{ label: 'Requests', data: days.map(d => (daily[d] || {}).requests_total || 0), borderColor: '#06b6d4', backgroundColor: '#06b6d422', fill: true }],
    }, options: chartOpts });
  }

  // Tunnel chart
  const tc = document.getElementById('chartTunnel');
  if (tc) {
    const tunnel = sd.tunnel || {};
    new Chart(tc, { type: 'doughnut', data: {
      labels: ['Sent', 'Received', 'Rejected', 'Fallbacks'],
      datasets: [{ data: [tunnel.messages_sent_total || 0, tunnel.messages_received_total || 0, tunnel.delivery_failures_total || 0, tunnel.mailbox_fallbacks_total || 0],
        backgroundColor: ['#3b82f6', '#22c55e', '#ef4444', '#eab308'] }],
    }, options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } } } });
  }
}
