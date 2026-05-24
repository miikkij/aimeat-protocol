/**
 * @file agent-integration-tab.js
 * @description Admin dashboard Agent Integration tab. Four sections:
 *   Platform Registry, Onboarding Overview (with readiness distribution),
 *   Skill Bundle Management, Bundle Templates.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 *   v1.1.0 -- 2026-05-24 -- Fix M8 M9 F19 F20 F21 audit findings
 *   v1.2.0 -- 2026-05-24 -- Move readiness into onboarding, add bundle templates, add notify button
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

  return html`
    <div>
      ${renderPlatformRegistry(platforms, totalAgents, session, loadData)}
      ${renderOnboardingOverview(onboarding, readiness, session, loadData)}
      ${renderSkillBundles(bundles, handleRegenerate, regenerating, session)}
      ${renderBundleTemplates()}
    </div>
  `;
}

/* ── M8: Merged Platform column (name + ID as secondary text) ── */
function renderPlatformRegistry(platforms, totalAgents, session, loadData) {
  const [showForm, setShowForm] = useState(false);

  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.platformRegistry')}</div>
      ${platforms.length === 0
        ? html`<${Empty} text=${t('admin.agentIntegration.noPlatforms')} />`
        : html`
          <table class="adm-agi-table">
            <thead><tr>
              <th>${t('admin.agentIntegration.platform')}</th>
              <th>${t('admin.agentIntegration.agentCount')}</th>
              <th>${t('admin.agentIntegration.adapter')}</th>
              <th>${t('admin.agentIntegration.detectPattern')}</th>
            </tr></thead>
            <tbody>
              ${platforms.map(p => html`
                <tr>
                  <td>
                    <div>${p.display_name}</div>
                    <div class="adm-agi-platform-id">${p.id}</div>
                  </td>
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
      ${showForm
        ? html`<${AddPlatformForm} session=${session} onDone=${() => { setShowForm(false); loadData(); }} onCancel=${() => setShowForm(false)} />`
        : html`<button class="btn-outline adm-agi-add-btn" onClick=${() => setShowForm(true)}>
            ${t('admin.agentIntegration.addPlatform')}
          </button>`
      }
    </div>
  `;
}

/* ── F19: Inline Add Platform form ── */
function AddPlatformForm({ session, onDone, onCancel }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [adapter, setAdapter] = useState('');
  const [pattern, setPattern] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !id.trim()) return;
    setSubmitting(true);
    try {
      await api.registerPlatform(session, {
        id: id.trim(),
        display_name: name.trim(),
        bundle_name: adapter.trim() || undefined,
        detect_pattern: pattern.trim() || undefined,
      });
      onDone();
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  return html`
    <div class="adm-agi-add-form">
      <div class="adm-agi-add-form-row">
        <label class="adm-agi-add-form-label">${t('admin.agentIntegration.platformName')}</label>
        <input class="adm-agi-add-form-input" value=${name} onInput=${e => setName(e.target.value)} placeholder="Hermes" />
      </div>
      <div class="adm-agi-add-form-row">
        <label class="adm-agi-add-form-label">${t('admin.agentIntegration.platformId')}</label>
        <input class="adm-agi-add-form-input" value=${id} onInput=${e => setId(e.target.value)} placeholder="hermes-openclaw" />
      </div>
      <div class="adm-agi-add-form-row">
        <label class="adm-agi-add-form-label">${t('admin.agentIntegration.adapterPattern')}</label>
        <input class="adm-agi-add-form-input" value=${adapter} onInput=${e => setAdapter(e.target.value)} placeholder="aimeat-hermes" />
      </div>
      <div class="adm-agi-add-form-row">
        <label class="adm-agi-add-form-label">${t('admin.agentIntegration.autoDetectRegex')}</label>
        <input class="adm-agi-add-form-input" value=${pattern} onInput=${e => setPattern(e.target.value)} placeholder="hermes|openclaw" />
      </div>
      <div class="adm-agi-add-form-actions">
        <button class="btn-primary" onClick=${handleSubmit} disabled=${submitting || !name.trim() || !id.trim()}>
          ${submitting ? t('common.loading') : t('common.add')}
        </button>
        <button class="btn-ghost" onClick=${onCancel}>${t('common.cancel')}</button>
      </div>
    </div>
  `;
}

/* ── M9: Not Started stat card + F20: Stuck section with suggestions + actions ── */
function renderOnboardingOverview(onboarding, readiness, session, loadData) {
  if (!onboarding) return html`<div class="adm-agi-section"><${Empty} text=${t('common.noData')} /></div>`;

  const stuck = onboarding.stuck || [];
  const notStarted = onboarding.not_started || 0;
  const readinessTotal = (onboarding.completed || 0) + (onboarding.in_progress || 0) + notStarted;

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
          <div class="adm-agi-stat-value">${num(notStarted)}</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.notStarted')}</div>
        </div>
      </div>
      ${stuck.length > 0 ? html`
        <div class="adm-agi-stuck-title">${t('admin.agentIntegration.stuckAgents')}</div>
        <div class="adm-agi-stuck">
          ${stuck.map(s => html`
            <${StuckAgentRow} agent=${s} session=${session} onAction=${loadData} />
          `)}
        </div>
      ` : ''}
      ${renderReadinessDistribution(readiness, readinessTotal)}
    </div>
  `;
}

/* ── F20: Single stuck agent row with suggestion + actions ── */
function StuckAgentRow({ agent, session, onAction }) {
  const [acting, setActing] = useState(false);
  const suggestion = getSuggestion(agent.current_step);

  const handleRemind = async () => {
    setActing(true);
    try {
      await api.sendReminder(session, agent.agent_gaii);
      onAction();
    } catch { /* ignore */ }
    setActing(false);
  };

  const handleSkip = async () => {
    setActing(true);
    try {
      await api.skipOnboardingStep(session, agent.agent_gaii, agent.current_step);
      onAction();
    } catch { /* ignore */ }
    setActing(false);
  };

  return html`
    <div class="adm-agi-stuck-agent">
      <div class="adm-agi-stuck-info">
        <div>
          <span class="adm-agi-stuck-name">${agent.agent_gaii}</span>
          <div class="adm-agi-stuck-detail">${agent.current_step}</div>
        </div>
        <div class="adm-agi-stuck-detail">
          ${t('admin.agentIntegration.stuckSince')}: ${dt(agent.stuck_since)}
        </div>
        <div class="adm-agi-stuck-suggestion">${suggestion}</div>
      </div>
      <div class="adm-agi-stuck-actions">
        <button class="btn-outline adm-agi-stuck-btn" onClick=${handleRemind} disabled=${acting}>
          ${t('admin.agentIntegration.sendReminder')}
        </button>
        <button class="btn-ghost adm-agi-stuck-btn" onClick=${handleSkip} disabled=${acting}>
          ${t('admin.agentIntegration.skipStep')}
        </button>
      </div>
    </div>
  `;
}

function getSuggestion(stepId) {
  if (stepId?.includes('webhook') || stepId?.includes('delivery'))
    return t('admin.agentIntegration.suggestion.webhook');
  if (stepId?.includes('platform') || stepId?.includes('detect'))
    return t('admin.agentIntegration.suggestion.platform');
  if (stepId?.includes('skill') || stepId?.includes('bundle'))
    return t('admin.agentIntegration.suggestion.skillBundle');
  return t('admin.agentIntegration.suggestion.default');
}

function renderReadinessDistribution(readiness, total) {
  if (!readiness) return '';
  const dist = readiness.distribution || {};
  const levels = ['expert', 'full', 'standard', 'basic'];

  return html`
    <div class="adm-agi-subsection">
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

/* ── F21: Added "Current version" column to skill bundle table ── */
function renderSkillBundles(bundles, onRegenerate, regenerating, session) {
  if (!bundles) return '';
  const entries = Object.entries(bundles);

  const handleNotify = async (platform) => {
    try {
      await api.notifyOutdatedAgents(session, platform);
      window.dispatchEvent(new CustomEvent('aimeat-toast', { detail: { message: t('admin.agentIntegration.notifySuccess') } }));
    } catch { /* ignore */ }
  };

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
              <th>${t('admin.agentIntegration.currentVersion')}</th>
              <th>${t('admin.agentIntegration.outdated')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${entries.map(([platform, info]) => html`
                <tr>
                  <td>${platform}</td>
                  <td>${num(info.agents)}</td>
                  <td class="adm-agi-mono-sm">${info.version || info.currentVersion || '--'}</td>
                  <td>${info.outdated > 0
                    ? html`<span class="adm-agi-outdated">${num(info.outdated)}</span>`
                    : html`<span class="adm-agi-zero">0</span>`
                  }</td>
                  <td>${info.outdated > 0 ? html`
                    <button class="btn-outline adm-agi-notify-btn" onClick=${() => handleNotify(platform)}>
                      ${t('admin.agentIntegration.notifyOutdated')}
                    </button>
                  ` : ''}</td>
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

/* ── Bundle Templates (Phase C stub) ── */
function renderBundleTemplates() {
  const handleComingSoon = () => {
    window.dispatchEvent(new CustomEvent('aimeat-toast', { detail: { message: t('admin.agentIntegration.comingSoon') } }));
  };

  return html`
    <div class="adm-agi-section">
      <div class="adm-agi-section-title">${t('admin.agentIntegration.bundleTemplates')}</div>
      <div class="adm-agi-stats">
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value">0</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.customReferences')}</div>
        </div>
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value">0</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.customScripts')}</div>
        </div>
        <div class="adm-agi-stat-card">
          <div class="adm-agi-stat-value adm-agi-mono-sm">--</div>
          <div class="adm-agi-stat-label">${t('admin.agentIntegration.lastGenerated')}</div>
        </div>
      </div>
      <div class="adm-agi-btn-row">
        <button class="btn-outline" onClick=${handleComingSoon}>
          ${t('admin.agentIntegration.customizeBundle')}
        </button>
        <button class="btn-outline" onClick=${handleComingSoon}>
          ${t('admin.agentIntegration.previewBundle')}
        </button>
      </div>
    </div>
  `;
}
