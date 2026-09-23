/**
 * @file node-stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing real-time node statistics including uptime,
 *   request counts, tunnel metrics, mailbox stats, and security counters.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the counts are plain numeral bands (a
 *     count that should be zero and is not is coral), the request breakdowns key-value rows in two
 *     columns; no own classes. NodeStatsBody is exported so the Nodes page's second tab shows the
 *     statistics inside its own frame instead of a page inside a page.
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
import { Spinner } from './shared.js';
import { Page, Section, Stack, Columns, NumeralBand, KeyValue, Text } from '/components/poster-parts.js';
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

/** One number of a band. `alert` sets it coral: a count that should be zero and is not. */
const stat = (label, value, alert = false) => ({ label, value, tone: alert ? 'coral' : undefined });

/** A status code's tone: 2xx fine, 4xx a look, 5xx wrong. */
const codeTone = (code) => (code.startsWith('2') ? 'success' : code.startsWith('4') ? 'coral' : code.startsWith('5') ? 'danger' : 'plain');

/** The node's page when it is opened on its own route: the frame, and the statistics in it. */
export default function NodeStatsTab() {
  return html`<${Page} width="wide" title=${t('profile.nodeStats.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInfra') }, { label: t('profile.tabs.nodeStats') }]}>
    <${Stack}>
      <${Text} kind="lead">${t('profile.nodeStats.desc')}<//>
      <${NodeStatsBody} />
    <//>
  <//>`;
}

/** The statistics themselves, for this page and for the Nodes page's second tab. */
export function NodeStatsBody() {
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

  if (error) return html`<${Text} tone="muted">${t('profile.nodeStats.error')}<//>`;
  if (!data) return html`<${Spinner} text=${t('profile.nodeStats.loading')} />`;
  const s = data;
  return html`<${Stack}>
    <${NumeralBand} tone="plain" items=${[
      stat(t('profile.nodeStats.uptime'), fmtUptime(s.uptime_seconds)),
      stat(t('profile.nodeStats.requests'), num(s.requests_total || 0)),
      stat(t('profile.nodeStats.owners'), s.active_owners || 0),
      stat(t('profile.nodeStats.agents'), s.active_agents || 0),
      stat(t('profile.nodeStats.memoryWrites'), num(s.memory_writes || 0)),
      stat(t('profile.nodeStats.memoryReads'), num(s.memory_reads || 0)),
    ]} />

    <${Columns} layout="equal" collapse="640">
      <${Stack} density="compact">
        <${Text} kind="label">${t('profile.nodeStats.requestsByMethod')}<//>
        ${s.requests_by_method ? Object.entries(s.requests_by_method).map(([m, c]) => html`
          <${KeyValue} key=${m} label=${m} value=${num(c)} mono />`) : null}
      <//>
      <${Stack} density="compact">
        <${Text} kind="label">${t('profile.nodeStats.requestsByStatus')}<//>
        ${s.requests_by_status ? Object.entries(s.requests_by_status).map(([code, c]) => html`
          <${KeyValue} key=${code} label=${html`<${Text} kind="mono" tone=${codeTone(code)}>${code}<//>`} value=${num(c)} mono />`) : null}
      <//>
    <//>

    ${s.tunnel ? html`<${Section} size="small" title=${t('profile.nodeStats.tunnelTitle')}>
      <${NumeralBand} tone="plain" items=${[
        stat(t('profile.nodeStats.tunnelActive'), s.tunnel.connections_active),
        stat(t('profile.nodeStats.tunnelTotal'), s.tunnel.connections_total),
        stat(t('profile.nodeStats.msgSent'), num(s.tunnel.messages_sent_total || 0)),
        stat(t('profile.nodeStats.msgReceived'), num(s.tunnel.messages_received_total || 0)),
        stat(t('profile.nodeStats.deliveryFails'), s.tunnel.delivery_failures_total, s.tunnel.delivery_failures_total > 0),
        stat(t('profile.nodeStats.latencyAvg'), (s.tunnel.delivery_latency_avg_ms || 0).toFixed(0) + ' ms'),
        stat(t('profile.nodeStats.latencyP95'), (s.tunnel.delivery_latency_p95_ms || 0).toFixed(0) + ' ms', (s.tunnel.delivery_latency_p95_ms || 0) > 200),
      ]} />
    <//>` : null}

    ${s.mailbox ? html`<${Section} size="small" title=${t('profile.nodeStats.mailboxTitle')}>
      <${NumeralBand} tone="plain" items=${[
        stat(t('profile.nodeStats.mailboxItems'), s.mailbox.items_total),
        stat(t('profile.nodeStats.mailboxBytes'), fmtBytes(s.mailbox.bytes_total)),
        stat(t('profile.nodeStats.mailboxDelivered'), num(s.mailbox.delivered_total || 0)),
        stat(t('profile.nodeStats.mailboxExpired'), s.mailbox.expired_total, s.mailbox.expired_total > 0),
      ]} />
    <//>` : null}

    <${Section} size="small" title=${t('profile.nodeStats.securityTitle')}>
      <${NumeralBand} tone="plain" items=${[
        stat(t('profile.nodeStats.authFailures'), s.auth_failures_total || 0, (s.auth_failures_total || 0) > 0),
        stat(t('profile.nodeStats.rateLimitHits'), s.rate_limit_hits_total || 0, (s.rate_limit_hits_total || 0) > 0),
        stat(t('profile.nodeStats.scopeDenials'), s.scope_denials_total || 0, (s.scope_denials_total || 0) > 0),
      ]} />
    <//>

    <${Text} kind="caption" tone="muted">${t('profile.nodeStats.startedAt')}: ${fmtDateTime(s.started_at)}<//>
  <//>`;
}
