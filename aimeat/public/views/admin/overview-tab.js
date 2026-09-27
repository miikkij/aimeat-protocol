/**
 * @file overview-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard overview in the poster face (design canvases "AIMEAT Hallinnan
 *   kehys" and "AIMEAT Hallinnan kolme sivua"): the node's status as one big word with a plain
 *   sentence about how many metrics are over their alarm line, the four health metrics as rows
 *   that each SAY what they measure and what follows, the headline counters as the poster's
 *   numeral strip whose cells open their own admin pages, and today's economy and the quick
 *   config side by side with the words that take you to their pages.
 * @structure OverviewTab({ data, switchPage }) — status section · numeral strip · economy + config
 * @version-history
 *   v3.0.0 -- 2026-09-27 -- Library components only: the status is the Verdict with the Readings
 *     beside it, the strip the FigureStrip whose figures are doors, the sections Section, the
 *     economy and config rows Readings (shared.js EconRow is gone), side by side in Columns. The
 *     page writes no class.
 *   v2.2.0 -- 2026-09-13 -- Compose the three section headings from the shared B1 shape.
 *   v2.1.0 — 2026-08-31 — The numbers explain themselves (canvas "AIMEAT Hallinnan kolme sivua"):
 *     a meaning sentence under every health metric, the alarm count said in words, the strip
 *     cells and the section words open the pages they summarise.
 *   v2.0.0 — 2026-08-31 — The poster face: status word + metric rows (absorbing the warnings
 *     table), og-strip numerals, sections under ink rules.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, Badge, Spinner } from './shared.js';
import { apiGet } from '/js/api.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action } from '/components/Action.js';
import { Columns } from '/components/Layout.js';

/** The status word's tone (the zones healthy, watch, danger): danger in coral, watch in the warning colour. */
const STATUS_TONE = { danger: 'danger', watch: 'watch' };

export default function OverviewTab(props) {
  const { data, switchPage } = props;
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [activeTaskCount, setActiveTaskCount] = useState(null);
  const [sharingGroupCount, setSharingGroupCount] = useState(null);

  useEffect(() => {
    // Fetch active/queued agent task count
    apiGet('/v1/admin/agent-tasks?status=active&per_page=1')
      .then(r => {
        const activeTotal = r.data?.total || 0;
        return apiGet('/v1/admin/agent-tasks?status=queued&per_page=1').then(r2 => {
          setActiveTaskCount(activeTotal + (r2.data?.total || 0));
        });
      })
      .catch(() => setActiveTaskCount(0));

    apiGet('/v1/admin/sharing-groups')
      .then(r => setSharingGroupCount(r.data?.total || 0))
      .catch(() => setSharingGroupCount(0));
  }, []);

  const d = data.dash;
  if (!d) return html`<${Spinner} text=${t('dashboard.loading')} />`;

  const h_ = d.health;
  const c = d.counts;
  const e = d.economy;
  const w = d.warnings || [];

  // One row per health metric: what it is called, a sentence about what it measures and what
  // follows, its zone, and the value with the crossed threshold when it is over the line.
  const thresholdOf = (metric) => w.find(x => x.metric === metric)?.threshold || null;
  const metricRow = (metric, labelKey, whyKey, obj) => ({
    key: metric,
    name: t('dashboard.' + labelKey),
    why: t('dashboard.' + whyKey),
    mark: html`<${Badge} type=${obj.zone} />`,
    value: `${obj.value}${thresholdOf(metric) ? ' · ' + thresholdOf(metric) : ''}`,
  });

  const alertLine = w.length === 0 ? t('dashboard.ovAlertsNone')
    : w.length === 1 ? t('dashboard.ovAlertsOne')
      : t('dashboard.ovAlertsMany', { n: w.length });

  // A figure of the strip is a door to the page it counts.
  const cell = (page, value, label, sub) => ({ key: page, n: value, label, sub: sub || undefined, onClick: () => switchPage(page) });
  const door = (page, words) => html`<${Action} small soft onClick=${() => switchPage(page)}>${words}<//>`;

  return html`
    <${Section} num="01" title=${t('dashboard.nodeHealth')} doors=${door('economy', t('dashboard.ovToEconomy'))}>
      <${Verdict} word=${h_.status} tone=${STATUS_TONE[h_.status]} line=${alertLine}
        stamp=${`${t('dashboard.uptime')}: ${fmtUp(d.uptime_seconds)} · ${t('dashboard.storage')}: ${d.storage_type}`}>
        <${Readings} rows=${[
          metricRow('burn_mint_ratio', 'healthBurnMintRatio', 'ovWhyBurnMint', h_.burn_mint_ratio),
          metricRow('agent_churn_rate_30d', 'healthAgentChurn', 'ovWhyChurn', h_.agent_churn_rate_30d),
          metricRow('work_expiry_rate_30d', 'healthWorkExpiry', 'ovWhyExpiry', h_.work_expiry_rate_30d),
          metricRow('dispute_rate_30d', 'healthDisputeRate', 'ovWhyDispute', h_.dispute_rate_30d),
        ]} />
      <//>
    <//>

    <${FigureStrip} items=${[
      cell('owners', num(c.owners), t('dashboard.registeredOwners')),
      cell('agents', num(c.agents), t('dashboard.registeredAgents'), c.active_agents_24h + ' ' + t('dashboard.active24h')),
      cell('boards', num(c.boards), t('dashboard.activeBoards'), t('dashboard.publishedActions') + ': ' + num(c.actions)),
      cell('chatInstances', num(c.chat_instances || 0), t('dashboard.activeChatSessions')),
      cell('agent-tasks', activeTaskCount != null ? num(activeTaskCount) : '–', t('dashboard.agentTasksActiveTasks')),
      cell('sharing-groups', sharingGroupCount != null ? num(sharingGroupCount) : '–', t('dashboard.sharingGroupsTotalCount')),
    ]} />

    <${Columns}>
      <${Section} num="02" title=${t('dashboard.economyToday')} doors=${door('economy', t('dashboard.ovToEconomy'))}>
        <${Readings} rows=${[
          { key: 'tx', name: t('dashboard.transactionsToday'), value: num(e.transactions_today) },
          { key: 'moved', name: t('dashboard.morselsMovedToday'), value: num(e.morsels_transacted_today) },
          { key: 'circ', name: t('dashboard.inCirculation'), value: num(e.total_morsels_in_circulation) },
          { key: 'burned', name: t('dashboard.burnedToday'), value: num(e.burned_today), last: true },
        ]} />
      <//>
      <${Section} num="03" title=${t('dashboard.quickConfig')} doors=${door('config', t('dashboard.ovToConfig'))}>
        <${Readings} rows=${[
          { key: 'port', name: t('dashboard.port'), value: d.config.port },
          { key: 'jwt', name: t('dashboard.jwtTtl'), value: d.config.jwt_ttl_seconds + 's' },
          { key: 'browse', name: t('dashboard.keyedBrowse'), value: d.config.keyed_browse_enabled ? t('dashboard.enabled') : t('dashboard.disabled') },
          { key: 'bonus', name: t('dashboard.welcomeBonus'), value: num(e.welcome_bonus), last: true },
        ]} />
      <//>
    <//>
  `;
}
