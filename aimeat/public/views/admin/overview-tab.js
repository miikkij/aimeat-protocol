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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the metric rows, the
 *     numeral band and the key-value rows are the set's parts, so the page follows the theme and has
 *     no classes of its own. The status word takes the chip tones (danger red, watch coral).
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
import { num, fmtUp, Badge, EconRow, Row, Empty } from './shared.js';
import { Section, Columns, Stack, Text, NumeralBand, Action } from '/components/poster-parts.js';
import { apiGet } from '/js/api.js';

/** The tone of the big status word: the same reading the zone chips use. */
const STATUS_TONE = { danger: 'danger', critical: 'danger', watch: 'coral' };

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
  if (!d) return html`<${Empty} text=${t('dashboard.loading')} />`;

  const h_ = d.health;
  const c = d.counts;
  const e = d.economy;
  const w = d.warnings || [];

  // One row per health metric: what it is called, a sentence about what it measures and what
  // follows, its zone, and the value with the crossed threshold when it is over the line.
  const thresholdOf = (metric) => w.find(x => x.metric === metric)?.threshold || null;
  const metricRow = (metric, labelKey, whyKey, obj) => html`
    <${Row} key=${metric} title=${t('dashboard.' + labelKey)} why=${t('dashboard.' + whyKey)}
      chip=${html`<${Badge} type=${obj.zone} />`}
      value=${html`<${Text} kind="mono">${obj.value}${thresholdOf(metric) ? ' · ' + thresholdOf(metric) : ''}<//>`} />`;

  const alertLine = w.length === 0 ? t('dashboard.ovAlertsNone')
    : w.length === 1 ? t('dashboard.ovAlertsOne')
      : t('dashboard.ovAlertsMany', { n: w.length });

  const cell = (page, value, label, sub) => ({ id: page, value, label, note: sub || undefined, onClick: () => switchPage(page) });
  const door = (page, key) => html`<${Action} onClick=${() => switchPage(page)}>${t(key)}<//>`;

  return html`<${Stack}>
    <${Section} title=${t('dashboard.nodeHealth')} count="01" actions=${door('economy', 'dashboard.ovToEconomy')}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large" tone=${STATUS_TONE[h_.status] || 'plain'}>${h_.status}<//>
          <${Text}>${alertLine}<//>
          <${Text} kind="mono" tone="muted">${t('dashboard.uptime')}: ${fmtUp(d.uptime_seconds)} · ${t('dashboard.storage')}: ${d.storage_type}<//>
        <//>
        <div>
          ${metricRow('burn_mint_ratio', 'healthBurnMintRatio', 'ovWhyBurnMint', h_.burn_mint_ratio)}
          ${metricRow('agent_churn_rate_30d', 'healthAgentChurn', 'ovWhyChurn', h_.agent_churn_rate_30d)}
          ${metricRow('work_expiry_rate_30d', 'healthWorkExpiry', 'ovWhyExpiry', h_.work_expiry_rate_30d)}
          ${metricRow('dispute_rate_30d', 'healthDisputeRate', 'ovWhyDispute', h_.dispute_rate_30d)}
        </div>
      <//>
    <//>

    <${NumeralBand} tone="plain" items=${[
      cell('owners', num(c.owners), t('dashboard.registeredOwners')),
      cell('agents', num(c.agents), t('dashboard.registeredAgents'), c.active_agents_24h + ' ' + t('dashboard.active24h')),
      cell('boards', num(c.boards), t('dashboard.activeBoards'), t('dashboard.publishedActions') + ': ' + num(c.actions)),
      cell('chatInstances', num(c.chat_instances || 0), t('dashboard.activeChatSessions')),
      cell('agent-tasks', activeTaskCount != null ? num(activeTaskCount) : '–', t('dashboard.agentTasksActiveTasks')),
      cell('sharing-groups', sharingGroupCount != null ? num(sharingGroupCount) : '–', t('dashboard.sharingGroupsTotalCount')),
    ]} />

    <${Columns} layout="equal" collapse=${900}>
      <${Stack}><${Section} title=${t('dashboard.economyToday')} count="02" actions=${door('economy', 'dashboard.ovToEconomy')}>
        <${EconRow} label=${t('dashboard.transactionsToday')} value=${num(e.transactions_today)} />
        <${EconRow} label=${t('dashboard.morselsMovedToday')} value=${num(e.morsels_transacted_today)} />
        <${EconRow} label=${t('dashboard.inCirculation')} value=${num(e.total_morsels_in_circulation)} />
        <${EconRow} label=${t('dashboard.burnedToday')} value=${num(e.burned_today)} />
      <//><//>
      <${Stack}><${Section} title=${t('dashboard.quickConfig')} count="03" actions=${door('config', 'dashboard.ovToConfig')}>
        <${EconRow} label=${t('dashboard.port')} value=${d.config.port} />
        <${EconRow} label=${t('dashboard.jwtTtl')} value=${d.config.jwt_ttl_seconds + 's'} />
        <${EconRow} label=${t('dashboard.keyedBrowse')} value=${d.config.keyed_browse_enabled ? t('dashboard.enabled') : t('dashboard.disabled')} />
        <${EconRow} label=${t('dashboard.welcomeBonus')} value=${num(e.welcome_bonus)} />
      <//><//>
    <//>
  <//>`;
}
