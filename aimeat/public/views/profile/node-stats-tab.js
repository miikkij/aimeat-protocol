/**
 * @file node-stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing real-time node statistics including uptime,
 *   request counts, tunnel metrics, mailbox stats, and security counters.
 * @version-history
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-16 — Initial node stats tab
 *   v1.1.0 — 2026-03-17 — Replace all inline styles with CSS classes
 *   v1.2.0 — 2026-07-17 — StatCard drops the inline style=color (+ hardcoded #8b5cf6/#3b82f6)
 *     for a canonical `tone` prop → .stat-card-value tone modifiers (accent/success/danger/
 *     warn/purple/blue, tokenized so they flip in dark mode); status-code row label likewise.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { getNodeStats } from '/js/services/stats.js';
import { num, dateTime as fmtDateTime, duration } from '/js/format.js';

/** How long the node has been up, in the reader's own words rather than in English letters. */
function fmtUptime(s) {
  return duration(Number(s) * 1000);
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// tone ∈ accent | success | danger | warn | purple | blue (canonical
// .stat-card-value modifiers) — no inline colour, so it flips in dark mode.
function StatCard({ label, value, tone }) {
  return html`<div class="stat-card">
    <div class="stat-card-value ${tone || ''}">${value}</div>
    <div class="stat-card-label">${label}</div>
  </div>`;
}

export default function NodeStatsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadData() {
    try {
      const stats = await getNodeStats();
      if (stats) { setData(stats); setError(false); }
      else setError(true);
    } catch { setError(true); }
  }

  if (error) return html`<div class="poster-page-title">${t('profile.nodeStats.title')}</div>
    <p class="text-meta">${t('profile.nodeStats.error')}</p>`;
  if (!data) return html`<${Spinner} text=${t('profile.nodeStats.loading')} />`;
  const s = data;
  return html`
    <div class="poster-page-title">${t('profile.nodeStats.title')}</div>
    <div class="section-desc">${t('profile.nodeStats.desc')}</div>

    <div class="stat-grid">
      <${StatCard} label=${t('profile.nodeStats.uptime')} value=${fmtUptime(s.uptime_seconds)} tone="accent" />
      <${StatCard} label=${t('profile.nodeStats.requests')} value=${num(s.requests_total || 0)} tone="accent" />
      <${StatCard} label=${t('profile.nodeStats.owners')} value=${s.active_owners || 0} tone="success" />
      <${StatCard} label=${t('profile.nodeStats.agents')} value=${s.active_agents || 0} tone="success" />
      <${StatCard} label=${t('profile.nodeStats.memoryWrites')} value=${num(s.memory_writes || 0)} tone="purple" />
      <${StatCard} label=${t('profile.nodeStats.memoryReads')} value=${num(s.memory_reads || 0)} tone="purple" />
    </div>

    <div class="stat-two-col">
      <div class="card p-1 poster-row--thing">
        <h4 class="stat-panel-h4">${t('profile.nodeStats.requestsByMethod')}</h4>
        ${s.requests_by_method ? Object.entries(s.requests_by_method).map(([m, c]) => html`
          <div class="stat-row">
            <span class="stat-row-label">${m}</span>
            <span class="stat-row-value">${num(c)}</span>
          </div>`) : null}
      </div>
      <div class="card p-1 poster-row--thing">
        <h4 class="stat-panel-h4">${t('profile.nodeStats.requestsByStatus')}</h4>
        ${s.requests_by_status ? Object.entries(s.requests_by_status).map(([code, c]) => {
          const tone = code.startsWith('2') ? 'success' : code.startsWith('4') ? 'warn' : code.startsWith('5') ? 'danger' : '';
          return html`<div class="stat-row">
            <span class="stat-row-label ${tone}">${code}</span>
            <span class="stat-row-value">${num(c)}</span>
          </div>`;
        }) : null}
      </div>
    </div>

    ${s.tunnel ? html`
      <h3 class="stat-section-h3">${t('profile.nodeStats.tunnelTitle')}</h3>
      <div class="stat-grid-sm">
        <${StatCard} label=${t('profile.nodeStats.tunnelActive')} value=${s.tunnel.connections_active} tone="success" />
        <${StatCard} label=${t('profile.nodeStats.tunnelTotal')} value=${s.tunnel.connections_total} tone="accent" />
        <${StatCard} label=${t('profile.nodeStats.msgSent')} value=${num(s.tunnel.messages_sent_total || 0)} tone="blue" />
        <${StatCard} label=${t('profile.nodeStats.msgReceived')} value=${num(s.tunnel.messages_received_total || 0)} tone="blue" />
        <${StatCard} label=${t('profile.nodeStats.deliveryFails')} value=${s.tunnel.delivery_failures_total} tone=${s.tunnel.delivery_failures_total > 0 ? 'danger' : 'success'} />
        <${StatCard} label=${t('profile.nodeStats.latencyAvg')} value=${(s.tunnel.delivery_latency_avg_ms || 0).toFixed(0) + ' ms'} tone="accent" />
        <${StatCard} label=${t('profile.nodeStats.latencyP95')} value=${(s.tunnel.delivery_latency_p95_ms || 0).toFixed(0) + ' ms'} tone=${(s.tunnel.delivery_latency_p95_ms || 0) > 200 ? 'warn' : 'accent'} />
      </div>` : null}

    ${s.mailbox ? html`
      <h3 class="stat-section-h3">${t('profile.nodeStats.mailboxTitle')}</h3>
      <div class="stat-grid-sm">
        <${StatCard} label=${t('profile.nodeStats.mailboxItems')} value=${s.mailbox.items_total} tone="accent" />
        <${StatCard} label=${t('profile.nodeStats.mailboxBytes')} value=${fmtBytes(s.mailbox.bytes_total)} tone="accent" />
        <${StatCard} label=${t('profile.nodeStats.mailboxDelivered')} value=${num(s.mailbox.delivered_total || 0)} tone="success" />
        <${StatCard} label=${t('profile.nodeStats.mailboxExpired')} value=${s.mailbox.expired_total} tone=${s.mailbox.expired_total > 0 ? 'warn' : 'success'} />
      </div>` : null}

    <h3 class="stat-section-h3">${t('profile.nodeStats.securityTitle')}</h3>
    <div class="stat-grid-sm">
      <${StatCard} label=${t('profile.nodeStats.authFailures')} value=${s.auth_failures_total || 0} tone=${(s.auth_failures_total || 0) > 0 ? 'danger' : 'success'} />
      <${StatCard} label=${t('profile.nodeStats.rateLimitHits')} value=${s.rate_limit_hits_total || 0} tone=${(s.rate_limit_hits_total || 0) > 0 ? 'warn' : 'success'} />
      <${StatCard} label=${t('profile.nodeStats.scopeDenials')} value=${s.scope_denials_total || 0} tone=${(s.scope_denials_total || 0) > 0 ? 'warn' : 'success'} />
    </div>

    <p class="stat-footer">${t('profile.nodeStats.startedAt')}: ${fmtDateTime(s.started_at)}</p>
  `;
}
