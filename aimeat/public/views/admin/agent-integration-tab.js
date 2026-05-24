/**
 * @file agent-integration-tab.js
 * @description Admin dashboard Agent Integration tab. Three sections:
 *   Platform Registry, Onboarding Overview, Skill Bundle Management.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Empty } from './shared.js';
import * as api from '/js/services/admin-agent-integration.js';


export default function AgentIntegrationTab({ data, session }) {
  useViewCSS('/css/views/admin-agent-integration.css');
  const [platforms, setPlatforms] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [bundles, setBundles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const loadData = useCallback(async () => {
    if (!session) return;
    try {
      const [platRes, onbRes, readRes, bundRes] = await Promise.all([
        api.getPlatforms(session),
        api.getOnboardingOverview(session),
        api.getReadinessDistribution(session),
        api.getSkillBundles(session),
      ]);
      setPlatforms(platRes.data?.platforms || []);
      setOnboarding(onbRes.data || null);
      setReadiness(readRes.data || null);
      setBundles(bundRes.data?.bundles || null);
    } catch { /* API unavailable */ }
    setLoading(false);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

  if (loading) return html`<div class="adm-card">${t('common.loading')}</div>`;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await api.regenerateBundles(session);
      await loadData();
    } catch { /* ignore */ }
    setRegenerating(false);
  };

  const totalAgents = platforms.reduce((sum, p) => sum + (p.agent_count || 0), 0);
  const readinessTotal = readiness?.total || 0;

  return html`
    <div>
      ${renderPlatformRegistry(platforms, totalAgents)}
      ${renderOnboardingOverview(onboarding)}
      ${renderReadinessDistribution(readiness, readinessTotal)}
      ${renderSkillBundles(bundles, handleRegenerate, regenerating)}
    </div>
  `;
}

function renderPlatformRegistry(platforms, totalAgents) {
  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.platformRegistry')}</div>
      ${platforms.length === 0
        ? html`<${Empty} text=${t('admin.agentIntegration.noPlatforms')} />`
        : html`
          <table class="adm-agi-table">
            <thead><tr>
              <th>${t('common.id')}</th>
              <th>${t('common.name')}</th>
              <th>${t('admin.agentIntegration.agentCount')}</th>
              <th>${t('admin.agentIntegration.adapter')}</th>
              <th>${t('admin.agentIntegration.detectPattern')}</th>
            </tr></thead>
            <tbody>
              ${platforms.map(p => html`
                <tr>
                  <td class="adm-agi-mono-sm">${p.id}</td>
                  <td>${p.display_name}</td>
                  <td>${num(p.agent_count)}</td>
                  <td class="adm-agi-mono-sm">${p.bundle_name}</td>
                  <td class="adm-agi-mono-sm">${p.detect_pattern || '--'}</td>
                </tr>
              `)}
            </tbody>
          </table>
          <div class="adm-agi-footer">
            ${t('admin.agentIntegration.totalAgents')}: ${num(totalAgents)}
          </div>
        `
      }
    </div>
  `;
}

function renderOnboardingOverview(onboarding) {
  if (!onboarding) return html`<div class="adm-agi-section"><${Empty} text=${t('common.noData')} /></div>`;

  const stuck = onboarding.stuck || [];

  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.onboardingOverview')}</div>
      <div class="adm-agi-stats">
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value adm-agi-stat-value--success">${num(onboarding.completed)}</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.completed')}</div>
        </div>
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value adm-agi-stat-value--accent">${num(onboarding.in_progress)}</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.inProgress')}</div>
        </div>
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value adm-agi-stat-value--warning">${num(stuck.length)}</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.stuck')}</div>
        </div>
      </div>
      ${stuck.length > 0 ? html`
        <div class="adm-agi-stuck">
          ${stuck.map(s => html`
            <div class="adm-agi-stuck-agent">
              <div>
                <span class="adm-agi-stuck-name">${s.agent_gaii}</span>
                <div class="adm-agi-stuck-detail">${s.current_step}</div>
              </div>
              <div class="adm-agi-stuck-detail">
                ${t('admin.agentIntegration.stuckSince')}: ${dt(s.stuck_since)}
              </div>
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}

function renderReadinessDistribution(readiness, total) {
  if (!readiness) return '';
  const dist = readiness.distribution || {};
  const levels = ['expert', 'full', 'standard', 'basic'];

  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.readinessDistribution')}</div>
      ${total === 0
        ? html`<div class="adm-agi-empty-text">${t('common.noData')}</div>`
        : html`
          ${levels.map(level => {
            const count = dist[level] || 0;
            const pct = total > 0 ? (count / total * 100) : 0;
            return html`
              <div class="adm-agi-readiness-bar">
                <div class="adm-agi-readiness-level">${t(`agentOnboarding.readiness.${level}`)}</div>
                <div class="adm-agi-readiness-track">
                  <div class="adm-agi-readiness-fill" style="width:${pct}%" data-level="${level}"></div>
                </div>
                <div class="adm-agi-readiness-count">${count}</div>
              </div>
            `;
          })}
          <div class="adm-agi-footer">
            ${t('admin.agentIntegration.totalAgents')}: ${num(total)}
          </div>
        `
      }
    </div>
  `;
}

function renderSkillBundles(bundles, onRegenerate, regenerating) {
  if (!bundles) return '';
  const entries = Object.entries(bundles);

  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.skillBundles')}</div>
      ${entries.length === 0
        ? html`<div class="adm-agi-empty-text">${t('common.noData')}</div>`
        : html`
          <table class="adm-agi-table">
            <thead><tr>
              <th>${t('admin.agentIntegration.platform')}</th>
              <th>${t('admin.agentIntegration.agentCount')}</th>
              <th>${t('admin.agentIntegration.outdated')}</th>
            </tr></thead>
            <tbody>
              ${entries.map(([platform, info]) => html`
                <tr>
                  <td>${platform}</td>
                  <td>${num(info.agents)}</td>
                  <td>${info.outdated > 0
                    ? html`<span class="adm-agi-outdated">${num(info.outdated)}</span>`
                    : html`<span class="adm-agi-zero">0</span>`
                  }</td>
                </tr>
              `)}
            </tbody>
          </table>
        `
      }
      <button class="btn-outline adm-agi-regen-btn" onClick=${onRegenerate} disabled=${regenerating}>
        ${regenerating ? t('common.loading') : t('admin.agentIntegration.regenerateAll')}
      </button>
    </div>
  `;
}
