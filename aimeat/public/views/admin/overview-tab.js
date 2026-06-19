import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, fmtUp, Badge, StatsGrid, EconRow, HealthRow } from './shared.js';
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
        // Also fetch queued
        return apiGet('/v1/admin/agent-tasks?status=queued&per_page=1').then(r2 => {
          setActiveTaskCount(activeTotal + (r2.data?.total || 0));
        });
      })
      .catch(() => setActiveTaskCount(0));

    // Fetch sharing group count
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
  const hColor = h_.status === 'healthy' ? '#22c55e' : h_.status === 'watch' ? '#eab308' : '#ef4444';

  return html`
    <!-- Health card -->
    <div class="adm-card" style="border-left:4px solid ${hColor};margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2>${t('dashboard.nodeHealth')}</h2>
          <div class="adm-stat" style="color:${hColor}">${h_.status.toUpperCase()}</div>
          <div class="adm-stat-label">${t('dashboard.uptime')}: ${fmtUp(d.uptime_seconds)} \u00B7 ${t('dashboard.storage')}: ${escHtml(d.storage_type)}</div>
        </div>
        <${Badge} type=${h_.status} />
      </div>
      <div style="margin-top:14px">
        <${HealthRow} label=${t('dashboard.healthBurnMintRatio')} obj=${h_.burn_mint_ratio} />
        <${HealthRow} label=${t('dashboard.healthAgentChurn')} obj=${h_.agent_churn_rate_30d} />
        <${HealthRow} label=${t('dashboard.healthWorkExpiry')} obj=${h_.work_expiry_rate_30d} />
        <${HealthRow} label=${t('dashboard.healthDisputeRate')} obj=${h_.dispute_rate_30d} />
      </div>
    </div>

    <!-- Stats -->
    <${StatsGrid} items=${[
      { label: t('dashboard.registeredOwners'), value: c.owners, tone: 'blue' },
      { label: t('dashboard.registeredAgents'), value: c.agents, sub: '(' + c.active_agents_24h + ' ' + t('dashboard.active24h') + ')', tone: 'purple' },
      { label: t('dashboard.publishedActions'), value: c.actions, tone: 'cyan' },
      { label: t('dashboard.activeBoards'), value: c.boards, tone: 'green' },
      { label: t('dashboard.activeChatSessions'), value: c.chat_instances || 0, tone: 'cyan' },
      { label: t('dashboard.agentTasksActiveTasks'), value: activeTaskCount != null ? activeTaskCount : '--', tone: 'orange' },
      { label: t('dashboard.sharingGroupsTotalCount'), value: sharingGroupCount != null ? sharingGroupCount : '--', tone: 'purple' },
    ]} />

    <!-- Economy & Config -->
    <div class="adm-grid adm-grid-2">
      <div class="adm-card">
        <h2>${t('dashboard.economyToday')}</h2>
        <${EconRow} label=${t('dashboard.transactionsToday')} value=${num(e.transactions_today)} />
        <${EconRow} label=${t('dashboard.morselsMovedToday')} value=${num(e.morsels_transacted_today)} />
        <${EconRow} label=${t('dashboard.inCirculation')} value=${num(e.total_morsels_in_circulation)} />
        <${EconRow} label=${t('dashboard.burnedToday')} value=${num(e.burned_today)} />
      </div>
      <div class="adm-card">
        <h2>${t('dashboard.quickConfig')}</h2>
        <${EconRow} label=${t('dashboard.port')} value=${d.config.port} />
        <${EconRow} label=${t('dashboard.jwtTtl')} value=${d.config.jwt_ttl_seconds + 's'} />
        <${EconRow} label=${t('dashboard.keyedBrowse')} value=${d.config.keyed_browse_enabled ? t('dashboard.enabled') : t('dashboard.disabled')} />
        <${EconRow} label=${t('dashboard.welcomeBonus')} value=${num(e.welcome_bonus)} />
      </div>
    </div>

    <!-- Warnings -->
    ${w.length > 0 && html`
      <div class="adm-card" style="border-left:3px solid #eab308;margin-bottom:20px">
        <h2>${t('dashboard.warnings')} (${w.length})</h2>
        <table>
          <thead><tr><th>${t('dashboard.metric')}</th><th>${t('dashboard.value')}</th><th>${t('dashboard.zone')}</th><th>${t('dashboard.threshold')}</th></tr></thead>
          <tbody>
            ${w.map(x => {
              const metricKey = {
                burn_mint_ratio: 'healthBurnMintRatio',
                agent_churn_rate_30d: 'healthAgentChurn',
                work_expiry_rate_30d: 'healthWorkExpiry',
                dispute_rate_30d: 'healthDisputeRate',
              }[x.metric];
              return html`<tr>
              <td>${metricKey ? t('dashboard.' + metricKey) : x.metric}</td>
              <td>${x.value}</td>
              <td><${Badge} type=${x.zone} /></td>
              <td style="color:var(--text-dim)">${x.threshold}</td>
            </tr>`;
            })}
          </tbody>
        </table>
      </div>
    `}
  `;
}
