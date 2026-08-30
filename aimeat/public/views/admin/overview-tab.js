/**
 * @file overview-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard overview in the poster face (design canvas "AIMEAT Hallinnan
 *   kehys", direction A): the node's status as one big word with the four health metrics as
 *   rows beside it (each carrying its zone and threshold, so a separate warnings table has
 *   nothing left to say), the headline counters as the poster's numeral strip, and today's
 *   economy and the quick config as two sections side by side. Fetches live task and
 *   sharing-group counts on mount.
 * @structure OverviewTab({ data }) — status section · numeral strip · economy + config
 * @version-history
 *   v2.0.0 — 2026-08-31 — The poster face: status word + metric rows (absorbing the warnings
 *     table), og-strip numerals, sections under ink rules.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, Badge, EconRow } from './shared.js';
import { apiGet } from '/js/api.js';

export default function OverviewTab({ data }) {
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
  if (!d) return html`<div class="empty">${t('dashboard.loading')}</div>`;

  const h_ = d.health;
  const c = d.counts;
  const e = d.economy;
  const w = d.warnings || [];

  // One row per health metric, carrying its zone and — when the metric is warning — the
  // threshold it crossed. The old separate warnings table said nothing these rows do not.
  const thresholdOf = (metric) => w.find(x => x.metric === metric)?.threshold || null;
  const metricRow = (metric, labelKey, obj) => html`
    <div class="adm-mrow" key=${metric}>
      <span>${t('dashboard.' + labelKey)}</span>
      <span><${Badge} type=${obj.zone} /></span>
      <span class="adm-mval">${obj.value}${thresholdOf(metric) ? ' · ' + thresholdOf(metric) : ''}</span>
    </div>`;

  return html`
    <div class="og">
      <section class="og-sec">
        <div class="og-sec-h"><h2>${t('dashboard.nodeHealth')}<small>01</small></h2></div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status ${h_.status}">${h_.status}</div>
            <div class="adm-ov-up">${t('dashboard.uptime')}: ${fmtUp(d.uptime_seconds)} · ${t('dashboard.storage')}: ${d.storage_type}</div>
          </div>
          <div>
            ${metricRow('burn_mint_ratio', 'healthBurnMintRatio', h_.burn_mint_ratio)}
            ${metricRow('agent_churn_rate_30d', 'healthAgentChurn', h_.agent_churn_rate_30d)}
            ${metricRow('work_expiry_rate_30d', 'healthWorkExpiry', h_.work_expiry_rate_30d)}
            ${metricRow('dispute_rate_30d', 'healthDisputeRate', h_.dispute_rate_30d)}
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(c.owners)}</b><span>${t('dashboard.registeredOwners')}</span></div>
        <div><b>${num(c.agents)}</b><span>${t('dashboard.registeredAgents')}</span><small>${c.active_agents_24h} ${t('dashboard.active24h')}</small></div>
        <div><b>${num(c.boards)}</b><span>${t('dashboard.activeBoards')}</span><small>${t('dashboard.publishedActions')}: ${num(c.actions)}</small></div>
        <div><b>${num(c.chat_instances || 0)}</b><span>${t('dashboard.activeChatSessions')}</span></div>
        <div><b>${activeTaskCount != null ? num(activeTaskCount) : '–'}</b><span>${t('dashboard.agentTasksActiveTasks')}</span></div>
        <div><b>${sharingGroupCount != null ? num(sharingGroupCount) : '–'}</b><span>${t('dashboard.sharingGroupsTotalCount')}</span></div>
      </div>

      <div class="adm-two">
        <section class="og-sec">
          <div class="og-sec-h"><h2>${t('dashboard.economyToday')}<small>02</small></h2></div>
          <${EconRow} label=${t('dashboard.transactionsToday')} value=${num(e.transactions_today)} />
          <${EconRow} label=${t('dashboard.morselsMovedToday')} value=${num(e.morsels_transacted_today)} />
          <${EconRow} label=${t('dashboard.inCirculation')} value=${num(e.total_morsels_in_circulation)} />
          <${EconRow} label=${t('dashboard.burnedToday')} value=${num(e.burned_today)} />
        <//>
        <section class="og-sec">
          <div class="og-sec-h"><h2>${t('dashboard.quickConfig')}<small>03</small></h2></div>
          <${EconRow} label=${t('dashboard.port')} value=${d.config.port} />
          <${EconRow} label=${t('dashboard.jwtTtl')} value=${d.config.jwt_ttl_seconds + 's'} />
          <${EconRow} label=${t('dashboard.keyedBrowse')} value=${d.config.keyed_browse_enabled ? t('dashboard.enabled') : t('dashboard.disabled')} />
          <${EconRow} label=${t('dashboard.welcomeBonus')} value=${num(e.welcome_bonus)} />
        <//>
      </div>
    </div>
  `;
}
