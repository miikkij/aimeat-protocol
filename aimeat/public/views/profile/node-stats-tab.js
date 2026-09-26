/**
 * @file node-stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing real-time node statistics including uptime,
 *   request counts, tunnel metrics, mailbox stats, and security counters.
 * @version-history
 *   v1.9.0 -- 2026-09-26 -- Every part is a kit component (FigureStrip lead, CardGrid of section Cards, Facts with the status code as the name's state, SubHeading, Note, Space): the page passes data and writes no class. Under the Nodes page head the sub-tab keeps its own name and line as a level-2 sub-heading (page group G8).
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
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Card, CardGrid } from '/components/Card.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';
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

// One figure of the figure strip: the number and its word. The tones main gave them
// (accent/success/purple/blue/warn/danger) were drawn in ink by the poster skin (.pf .stat-card-value
// overrode them), so the strip draws them as it draws every figure.
const fig = (label, value) => ({ n: value, label });

// A status code's name is its state (2xx fine, 4xx attention, 5xx danger), as main coloured it.
const codeState = (code) => (code.startsWith('2') ? 'fine' : code.startsWith('4') ? 'attention' : code.startsWith('5') ? 'danger' : undefined);

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

  // Under the Nodes page head (Jouni's decision "Nodes page head") this sub-tab keeps its own name
  // and line as a level-2 sub-heading: main showed them, and the Nodes head names the page, not it.
  const head = html`<${SubHeading} level=${2} desc=${error ? null : t('profile.nodeStats.desc')}>${t('profile.nodeStats.title')}<//>`;
  if (error) return html`${head}<${Note} kind="meta">${t('profile.nodeStats.error')}<//>`;
  if (!data) return html`<${LoadingLine} text=${t('profile.nodeStats.loading')} />`;
  const s = data;
  const section = (title, items) => html`
    <${Space} above="section"><${SubHeading} level=${3}>${title}<//><//>
    <${FigureStrip} lead items=${items} />`;
  return html`
    ${head}

    <${FigureStrip} lead items=${[
      fig(t('profile.nodeStats.uptime'), fmtUptime(s.uptime_seconds)),
      fig(t('profile.nodeStats.requests'), num(s.requests_total || 0)),
      fig(t('profile.nodeStats.owners'), s.active_owners || 0),
      fig(t('profile.nodeStats.agents'), s.active_agents || 0),
      fig(t('profile.nodeStats.memoryWrites'), num(s.memory_writes || 0)),
      fig(t('profile.nodeStats.memoryReads'), num(s.memory_reads || 0)),
    ]} />

    <${CardGrid} cols="two">
      <${Card} tone="section" title=${t('profile.nodeStats.requestsByMethod')}>
        ${s.requests_by_method ? html`<${Facts} rows=${Object.entries(s.requests_by_method).map(([m, c]) => ({ k: m, v: num(c) }))} />` : null}
      <//>
      <${Card} tone="section" title=${t('profile.nodeStats.requestsByStatus')}>
        ${s.requests_by_status ? html`<${Facts} rows=${Object.entries(s.requests_by_status).map(([code, c]) => ({ k: code, state: codeState(code), v: num(c) }))} />` : null}
      <//>
    <//>

    ${s.tunnel ? section(t('profile.nodeStats.tunnelTitle'), [
      fig(t('profile.nodeStats.tunnelActive'), s.tunnel.connections_active),
      fig(t('profile.nodeStats.tunnelTotal'), s.tunnel.connections_total),
      fig(t('profile.nodeStats.msgSent'), num(s.tunnel.messages_sent_total || 0)),
      fig(t('profile.nodeStats.msgReceived'), num(s.tunnel.messages_received_total || 0)),
      fig(t('profile.nodeStats.deliveryFails'), s.tunnel.delivery_failures_total),
      fig(t('profile.nodeStats.latencyAvg'), (s.tunnel.delivery_latency_avg_ms || 0).toFixed(0) + ' ms'),
      fig(t('profile.nodeStats.latencyP95'), (s.tunnel.delivery_latency_p95_ms || 0).toFixed(0) + ' ms'),
    ]) : null}

    ${s.mailbox ? section(t('profile.nodeStats.mailboxTitle'), [
      fig(t('profile.nodeStats.mailboxItems'), s.mailbox.items_total),
      fig(t('profile.nodeStats.mailboxBytes'), fmtBytes(s.mailbox.bytes_total)),
      fig(t('profile.nodeStats.mailboxDelivered'), num(s.mailbox.delivered_total || 0)),
      fig(t('profile.nodeStats.mailboxExpired'), s.mailbox.expired_total),
    ]) : null}

    ${section(t('profile.nodeStats.securityTitle'), [
      fig(t('profile.nodeStats.authFailures'), s.auth_failures_total || 0),
      fig(t('profile.nodeStats.rateLimitHits'), s.rate_limit_hits_total || 0),
      fig(t('profile.nodeStats.scopeDenials'), s.scope_denials_total || 0),
    ])}

    <${Space} above="large"><${Note}>${t('profile.nodeStats.startedAt')}: ${fmtDateTime(s.started_at)}<//><//>
  `;
}
