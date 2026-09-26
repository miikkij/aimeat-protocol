/**
 * @file node-stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing real-time node statistics including uptime,
 *   request counts, tunnel metrics, mailbox stats, and security counters.
 * @version-history
 *   v1.8.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.7.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- The request counts by method and by status are the Facts (css/components/facts.css); the stat-row rules go (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- An HTTP status in the node statistics and a model not in the list are the Status (.poster-status fine, attention or danger); the coloured words' rules go (Jouni's decision "Status", a unification).
 *   v1.3.0 -- 2026-09-25 -- A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
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
import { LoadingLine } from './shared.js';
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

// One figure of the figure strip (og-strip): the number and its word. The tones it once took were
// drawn in ink by the poster skin, so the strip draws them as it draws every figure.
function StatCard({ label, value }) {
  return html`<div>
    <b>${value}</b>
    <span>${label}</span>
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
  if (!data) return html`<${LoadingLine} text=${t('profile.nodeStats.loading')} />`;
  const s = data;
  return html`
    <div class="poster-page-title">${t('profile.nodeStats.title')}</div>
    <div class="section-desc">${t('profile.nodeStats.desc')}</div>

    <div class="og-strip pf-figures">
      <${StatCard} label=${t('profile.nodeStats.uptime')} value=${fmtUptime(s.uptime_seconds)} />
      <${StatCard} label=${t('profile.nodeStats.requests')} value=${num(s.requests_total || 0)} />
      <${StatCard} label=${t('profile.nodeStats.owners')} value=${s.active_owners || 0} />
      <${StatCard} label=${t('profile.nodeStats.agents')} value=${s.active_agents || 0} />
      <${StatCard} label=${t('profile.nodeStats.memoryWrites')} value=${num(s.memory_writes || 0)} />
      <${StatCard} label=${t('profile.nodeStats.memoryReads')} value=${num(s.memory_reads || 0)} />
    </div>

    <div class="stat-two-col">
      <div class="card p-1 poster-row--thing">
        <h4 class="stat-panel-h4 sub-heading">${t('profile.nodeStats.requestsByMethod')}</h4>
        ${s.requests_by_method ? html`<div class="facts">${Object.entries(s.requests_by_method).map(([m, c]) => html`
            <span class="facts-k poster-label">${m}</span>
            <span class="facts-v">${num(c)}</span>`)}</div>` : null}
      </div>
      <div class="card p-1 poster-row--thing">
        <h4 class="stat-panel-h4 sub-heading">${t('profile.nodeStats.requestsByStatus')}</h4>
        ${s.requests_by_status ? html`<div class="facts">${Object.entries(s.requests_by_status).map(([code, c]) => {
          const tone = code.startsWith('2') ? 'fine' : code.startsWith('4') ? 'attention' : code.startsWith('5') ? 'danger' : '';
          return html`
            ${tone ? html`<span class="facts-k"><span class=${`poster-status poster-status--${tone}`}>${code}</span></span>` : html`<span class="facts-k poster-label">${code}</span>`}
            <span class="facts-v">${num(c)}</span>`;
        })}</div>` : null}
      </div>
    </div>

    ${s.tunnel ? html`
      <h3 class="stat-section-h3 sub-heading">${t('profile.nodeStats.tunnelTitle')}</h3>
      <div class="og-strip pf-figures">
        <${StatCard} label=${t('profile.nodeStats.tunnelActive')} value=${s.tunnel.connections_active} />
        <${StatCard} label=${t('profile.nodeStats.tunnelTotal')} value=${s.tunnel.connections_total} />
        <${StatCard} label=${t('profile.nodeStats.msgSent')} value=${num(s.tunnel.messages_sent_total || 0)} />
        <${StatCard} label=${t('profile.nodeStats.msgReceived')} value=${num(s.tunnel.messages_received_total || 0)} />
        <${StatCard} label=${t('profile.nodeStats.deliveryFails')} value=${s.tunnel.delivery_failures_total} />
        <${StatCard} label=${t('profile.nodeStats.latencyAvg')} value=${(s.tunnel.delivery_latency_avg_ms || 0).toFixed(0) + ' ms'} />
        <${StatCard} label=${t('profile.nodeStats.latencyP95')} value=${(s.tunnel.delivery_latency_p95_ms || 0).toFixed(0) + ' ms'} />
      </div>` : null}

    ${s.mailbox ? html`
      <h3 class="stat-section-h3 sub-heading">${t('profile.nodeStats.mailboxTitle')}</h3>
      <div class="og-strip pf-figures">
        <${StatCard} label=${t('profile.nodeStats.mailboxItems')} value=${s.mailbox.items_total} />
        <${StatCard} label=${t('profile.nodeStats.mailboxBytes')} value=${fmtBytes(s.mailbox.bytes_total)} />
        <${StatCard} label=${t('profile.nodeStats.mailboxDelivered')} value=${num(s.mailbox.delivered_total || 0)} />
        <${StatCard} label=${t('profile.nodeStats.mailboxExpired')} value=${s.mailbox.expired_total} />
      </div>` : null}

    <h3 class="stat-section-h3 sub-heading">${t('profile.nodeStats.securityTitle')}</h3>
    <div class="og-strip pf-figures">
      <${StatCard} label=${t('profile.nodeStats.authFailures')} value=${s.auth_failures_total || 0} />
      <${StatCard} label=${t('profile.nodeStats.rateLimitHits')} value=${s.rate_limit_hits_total || 0} />
      <${StatCard} label=${t('profile.nodeStats.scopeDenials')} value=${s.scope_denials_total || 0} />
    </div>

    <p class="poster-hint stat-footer">${t('profile.nodeStats.startedAt')}: ${fmtDateTime(s.started_at)}</p>
  `;
}
