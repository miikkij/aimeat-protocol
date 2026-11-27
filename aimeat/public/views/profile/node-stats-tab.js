/**
 * @file node-stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing real-time node statistics including uptime,
 *   request counts, tunnel metrics, message queue stats, and security counters. It is drawn in two
 *   places: as the Nodes page's second sub-tab (nodes-tab.js), under the Nodes page head, where it
 *   explains itself through what it draws (.claude/rules/page-guidance.md: the question mark
 *   concept.node_stats after its heading's words, and the page's start, PageStart id "nodeStats",
 *   under the heading); and as the page of its own that ?tab=nodeStats opens, where it draws the
 *   SettingsPage frame (crumb, title with its question mark, desc, strip, start, contents rail).
 * @version-history
 *   v1.13.0 -- 2026-11-27 -- The page of its own (?tab=nodeStats) drew no page title and no crumb,
 *     because the view was written as the Nodes page's sub-tab only; it now draws the SettingsPage
 *     frame, told apart from the sub-tab by the address. Four figures say where the server stands
 *     (uptime with the time it started as its line, requests, owners, agents); the rest are sections
 *     with ids: requests and memory (ns-requests), tunnel (ns-tunnel), message queue (ns-mailbox),
 *     security (ns-security). A section is drawn once it has something to count, a failed delivery
 *     and an expired message take the notice tone, server errors lead the status list, and a section
 *     with a figure that needs a look comes first. No figure was added or removed.
 *   v1.12.0 -- 2026-11-09 -- PageStart gets the page's title and concept, for "Explain this page to
 *     me".
 *   v1.11.0 -- 2026-11-08 -- Owners, Agents and P95 Latency open their explanation
 *     (nodeStats.owners, nodeStats.agents, nodeStats.latencyP95): what each figure counts.
 *   v1.10.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     the question mark concept.node_stats after the heading's words (HelpTip, as PageHead draws a
 *     page's), and PageStart "nodeStats" under the heading, with the prompt that has one's own AI
 *     read the figures.
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
import { HelpTip, HelpLabel } from '/components/HelpTip.js';
import { PageStart } from '/components/PageStart.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageSection } from '/components/PageSection.js';
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
// A figure whose word opens its own explanation (`explain.<term>.*`).
const helpFig = (label, value, term) => ({ key: label, n: value, label: html`<${HelpLabel} term=${term} label=${label}>${label}<//>` });

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

  // This view is drawn in two places: as the Nodes page's second sub-tab (nodes-tab.js, under the
  // Nodes page head) and as the page of its own that ?tab=nodeStats opens (views/profile.js TABS,
  // a deep link; the menu no longer lists it). Both pass the same props, so the address tells them
  // apart. The page of its own draws the Settings page frame: the crumb, the page title with its
  // question mark, the line under it, the figures and the start, so a person knows where they are.
  // Under the Nodes page head (Jouni's decision "Nodes page head") the sub-tab keeps its own name and
  // line as a level-2 sub-heading, the question mark after its words, and its start under it.
  const own = new URLSearchParams(window.location.search).get('tab') === 'nodeStats';
  const title = t('profile.nodeStats.title');
  const subHead = html`
    <${SubHeading} level=${2} desc=${error ? null : t('profile.nodeStats.desc')}>${title} <${HelpTip} term="concept.node_stats" label=${title} /><//>
    <${PageStart} id="nodeStats" title=${title} concept="concept.node_stats" />`;
  const s = data;

  // The figures under the head say where the server stands: whether it is up and since when, and how
  // much it is used. The time it started was a line at the foot of the page and is now the uptime's line.
  const strip = s ? html`<${FigureStrip} wrap items=${[
    { key: 'uptime', n: fmtUptime(s.uptime_seconds), label: t('profile.nodeStats.uptime'), sub: `${t('profile.nodeStats.startedAt')}: ${fmtDateTime(s.started_at)}` },
    fig(t('profile.nodeStats.requests'), num(s.requests_total || 0)),
    helpFig(t('profile.nodeStats.owners'), s.active_owners || 0, 'nodeStats.owners'),
    helpFig(t('profile.nodeStats.agents'), s.active_agents || 0, 'nodeStats.agents'),
  ]} />` : !error ? html`<${FigureStrip} loading=${4} />` : null;

  const frame = (sections, body, withStrip) => html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuInfra'), t('profile.tabs.nodeStats')]}
      title=${title}
      help="concept.node_stats"
      desc=${t('profile.nodeStats.desc')}
      strip=${withStrip ? strip : null}
      start=${html`<${PageStart} id="nodeStats" />`}
      railTitle=${sections.length > 1 ? t('profile.landing.railTitle') : undefined}
      sections=${sections.length > 1 ? sections : undefined}>
      ${body}
    <//>`;

  if (error) {
    const line = html`<${Note} kind="meta">${t('profile.nodeStats.error')}<//>`;
    return own ? frame([], line, false) : html`${subHead}${line}`;
  }
  if (!s) {
    const line = html`<${LoadingLine} text=${t('profile.nodeStats.loading')} />`;
    return own ? frame([], line, true) : line;
  }

  const n = (x) => Number(x) || 0;
  const look = (x) => (n(x) > 0 ? 'notice' : undefined);
  // A status code's rows: server errors first, then refusals, then the rest, each group by its code.
  const rank = (code) => (code.startsWith('5') ? 0 : code.startsWith('4') ? 1 : 2);
  const statusRows = Object.entries(s.requests_by_status || {})
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, c]) => ({ k: code, state: codeState(code), v: num(c) }));
  const serverErrors = Object.entries(s.requests_by_status || {}).some(([code, c]) => code.startsWith('5') && n(c) > 0);
  const tunnel = s.tunnel;
  const mailbox = s.mailbox;

  // Each part of the statistics is a section, drawn once it has something to count: a server with no
  // own server connected has no tunnel figures, and a band of zeros says nothing. A section whose
  // figure needs a look (a server error, a failed delivery, an expired message) comes first; the
  // others keep their order. The numbers and the rail follow what is drawn.
  const parts = [
    {
      id: 'ns-requests', label: t('profile.nodeStats.secRequests'), alert: serverErrors,
      body: html`
        <${FigureStrip} lead items=${[
          fig(t('profile.nodeStats.memoryWrites'), num(s.memory_writes || 0)),
          fig(t('profile.nodeStats.memoryReads'), num(s.memory_reads || 0)),
        ]} />
        <${CardGrid} cols="two">
          <${Card} tone="section" title=${t('profile.nodeStats.requestsByMethod')}>
            ${s.requests_by_method ? html`<${Facts} rows=${Object.entries(s.requests_by_method).map(([m, c]) => ({ k: m, v: num(c) }))} />` : null}
          <//>
          <${Card} tone="section" title=${t('profile.nodeStats.requestsByStatus')}>
            ${s.requests_by_status ? html`<${Facts} rows=${statusRows} />` : null}
          <//>
        <//>`,
    },
    tunnel && (n(tunnel.connections_total) + n(tunnel.messages_sent_total) + n(tunnel.messages_received_total) + n(tunnel.delivery_failures_total)) > 0 ? {
      id: 'ns-tunnel', label: t('profile.nodeStats.tunnelTitle'), alert: n(tunnel.delivery_failures_total) > 0,
      body: html`<${FigureStrip} lead items=${[
        { ...fig(t('profile.nodeStats.deliveryFails'), tunnel.delivery_failures_total), tone: look(tunnel.delivery_failures_total) },
        fig(t('profile.nodeStats.tunnelActive'), tunnel.connections_active),
        fig(t('profile.nodeStats.tunnelTotal'), tunnel.connections_total),
        fig(t('profile.nodeStats.msgSent'), num(tunnel.messages_sent_total || 0)),
        fig(t('profile.nodeStats.msgReceived'), num(tunnel.messages_received_total || 0)),
        fig(t('profile.nodeStats.latencyAvg'), (tunnel.delivery_latency_avg_ms || 0).toFixed(0) + ' ms'),
        helpFig(t('profile.nodeStats.latencyP95'), (tunnel.delivery_latency_p95_ms || 0).toFixed(0) + ' ms', 'nodeStats.latencyP95'),
      ]} />`,
    } : null,
    mailbox && (n(mailbox.items_total) + n(mailbox.delivered_total) + n(mailbox.expired_total)) > 0 ? {
      id: 'ns-mailbox', label: t('profile.nodeStats.mailboxTitle'), alert: n(mailbox.expired_total) > 0,
      body: html`<${FigureStrip} lead items=${[
        { ...fig(t('profile.nodeStats.mailboxExpired'), mailbox.expired_total), tone: look(mailbox.expired_total) },
        fig(t('profile.nodeStats.mailboxItems'), mailbox.items_total),
        fig(t('profile.nodeStats.mailboxBytes'), fmtBytes(mailbox.bytes_total)),
        fig(t('profile.nodeStats.mailboxDelivered'), num(mailbox.delivered_total || 0)),
      ]} />`,
    } : null,
    (n(s.auth_failures_total) + n(s.rate_limit_hits_total) + n(s.scope_denials_total)) > 0 ? {
      id: 'ns-security', label: t('profile.nodeStats.securityTitle'), alert: false,
      body: html`<${FigureStrip} lead items=${[
        fig(t('profile.nodeStats.authFailures'), s.auth_failures_total || 0),
        fig(t('profile.nodeStats.rateLimitHits'), s.rate_limit_hits_total || 0),
        fig(t('profile.nodeStats.scopeDenials'), s.scope_denials_total || 0),
      ]} />`,
    } : null,
  ].filter(Boolean);
  const shown = [...parts.filter((p) => p.alert), ...parts.filter((p) => !p.alert)]
    .map((p, i) => ({ ...p, num: String(i + 1).padStart(2, '0') }));
  const sections = shown.map((p, i) => html`
    <${PageSection} key=${p.id} id=${p.id} num=${p.num} first=${i === 0} title=${p.label}>${p.body}<//>`);

  if (own) return frame(shown.map(({ id, label, num: nr }) => ({ id, label, num: nr })), sections, true);
  return html`
    ${subHead}
    ${strip}
    <${Space} above="large">${sections}<//>
  `;
}
