/**
 * @file agent-card.js
 * @description Agent card component with collapsed/expanded states,
 *   Two-Zone Header (identity + state-dependent status), and 8-tab bar.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix C6: remove GAII from Zone 1, M1: add Next prefix, C1: production stats, C2: problem action buttons
 */

import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { detectAgentState, getDefaultTab, getStateColor } from './state-detector.js';
import { testWebhook, updateWebhook } from '/js/services/agent-integration.js';
import TabIntegration from './tab-integration.js';
import TabTasks from './tab-tasks.js';
import TabMessages from './tab-messages.js';
import TabDataAccess from './tab-data-access.js';
import TabDirectives from './tab-directives.js';
import TabAgentConfig from './tab-agent-config.js';
import TabActivity from './tab-activity.js';
import TabServices from './tab-services.js';

const html = htm.bind(h);

const TABS = [
  { id: 'integration', key: 'profile.agents.detail.tabs.integration' },
  { id: 'tasks', key: 'profile.agents.detail.tabs.tasks' },
  { id: 'messages', key: 'profile.agents.detail.tabs.messages' },
  { id: 'data-access', key: 'profile.agents.detail.tabs.dataAccess' },
  { id: 'directives', key: 'profile.agents.detail.tabs.directives' },
  { id: 'agent-config', key: 'profile.agents.detail.tabs.agentConfig' },
  { id: 'activity', key: 'profile.agents.detail.tabs.activity' },
  { id: 'services', key: 'profile.agents.detail.tabs.services' },
];

export default function AgentCard({ agent, onboarding, expanded, onToggle, session, showToast, allAgents, onScopesClick, onDeleteClick, onFederateToggle }) {
  const state = detectAgentState(agent, onboarding);
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => {
    if (expanded && activeTab === null) {
      setActiveTab(getDefaultTab(state));
    }
  }, [expanded]);

  const handleCollapse = useCallback(() => {
    onToggle(agent.name);
    if (expanded) setActiveTab(null);
  }, [expanded, agent.name, onToggle]);

  if (!expanded) {
    return html`
      <div class="pf-agd-card">
        <div class="pf-agd-collapsed ${state === 'problem' ? 'pf-agd-collapsed--problem' : ''}"
             onClick=${() => onToggle(agent.name)}>
          <span class="pf-agd-expand-icon">▶</span>
          <span class="pf-agd-collapsed-icon">🤖</span>
          <span class="pf-agd-collapsed-name">${agent.display_name || agent.name}</span>
          <div class="pf-agd-collapsed-badges">
            ${renderPlatformBadge(onboarding)}
            ${renderReadinessBadge(state, onboarding)}
            ${agent.federate && html`<span class="pf-agd-badge pf-agd-badge--federation">${t('profile.federated')}</span>`}
          </div>
          <span class="pf-agd-collapsed-stats">
            ${renderDeliveryIndicator(agent)}
            ${renderCollapsedStats(state, agent, onboarding)}
          </span>
        </div>
      </div>
    `;
  }

  return html`
    <div class="pf-agd-card">
      <div class="pf-agd-expanded">
        <!-- Zone 1: Identity -->
        <div class="pf-agd-zone1" onClick=${handleCollapse}>
          <span class="pf-agd-expand-icon pf-agd-expand-icon--open">▶</span>
          <div class="pf-agd-zone1-identity">
            <span class="pf-agd-zone1-name">${agent.display_name || agent.name}</span>
          </div>
          <div class="pf-agd-zone1-badges">
            ${renderPlatformBadge(onboarding)}
            ${renderReadinessBadge(state, onboarding)}
            ${agent.federate && html`<span class="pf-agd-badge pf-agd-badge--federation">${t('profile.federated')}</span>`}
          </div>
          <span class="pf-agd-zone1-right">
            ${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}
          </span>
        </div>

        <!-- Zone 2: Status -->
        ${renderZone2(state, agent, onboarding, setActiveTab, showToast)}

        <!-- Tab Bar -->
        <div class="pf-agd-tabs">
          ${TABS.map(tab => {
            const label = t(tab.key);
            return html`
              <button key=${tab.id}
                      class="pf-agd-tab ${activeTab === tab.id ? 'pf-agd-tab--active' : ''}"
                      onClick=${(e) => { e.stopPropagation(); setActiveTab(tab.id); }}>
                ${label !== tab.key ? label : tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}
              </button>
            `;
          })}
        </div>

        <!-- Tab Content -->
        <div class="pf-agd-tab-content" onClick=${(e) => e.stopPropagation()}>
          ${renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents)}
        </div>

        <!-- Card Footer: Scopes + Delete -->
        <div class="pf-agd-card-footer">
          <div class="pf-agd-card-actions">
            ${onScopesClick && html`
              <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); onScopesClick(agent); }}>
                ${t('profile.agents.scopeUi.manage')}
              </button>
            `}
            ${onFederateToggle && html`
              <button class="btn-ghost btn-sm" onClick=${(e) => { e.stopPropagation(); onFederateToggle(agent); }}>
                ${agent.federate ? t('profile.federated') : t('profile.notFederated')}
              </button>
            `}
          </div>
          ${onDeleteClick && html`
            <button class="btn-danger btn-sm" onClick=${(e) => { e.stopPropagation(); onDeleteClick(agent.name); }}>
              ${t('profile.agents.deleteAgent')}
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

function renderDeliveryIndicator(agent) {
  const hasWebhook = agent.webhookUrl || agent.webhook_url;
  if (hasWebhook) {
    const failCount = agent.webhookFailCount ?? 0;
    const icon = failCount >= 5 ? '⚠' : '✓';
    return html`<span class="pf-agd-delivery-indicator">${t('profile.agents.detail.deliveryWebhook')}: ${icon} </span>`;
  }
  return html`<span class="pf-agd-delivery-indicator">${t('profile.agents.detail.deliveryPolling')} </span>`;
}

function renderPlatformBadge(onboarding) {
  const platform = onboarding?.platformName || onboarding?.detectedPlatform;
  if (!platform) return null;
  const version = onboarding?.platformVersion;
  return html`<span class="pf-agd-badge pf-agd-badge--platform">${platform}${version ? ` v${version}` : ''}</span>`;
}

function renderReadinessBadge(state, onboarding) {
  if (state === 'new') {
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  }
  if (state === 'onboarding') {
    const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
    const total = onboarding?.steps?.length ?? 11;
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-onboarding">${t('profile.agents.detail.state.onboarding')}: ${passed}/${total}</span>`;
  }
  const level = onboarding?.readinessLevel || 'none';
  const score = onboarding?.readinessScore;
  if (!score && score !== 0) return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  const label = t(`agentOnboarding.readiness.${level}`);
  return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level}">${label} (${score})</span>`;
}

function renderCollapsedStats(state, agent, onboarding) {
  switch (state) {
    case 'new':
      return html`${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''} | ${t('profile.agents.detail.state.newSummary')}`;
    case 'onboarding': {
      const nextStep = onboarding?.steps?.find(s => s.status === 'pending');
      return html`${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''} ${nextStep ? `| ${t('profile.agents.detail.state.next')}: ${nextStep.name}` : ''}`;
    }
    case 'problem':
      return html`${t('profile.agents.detail.state.problemSummary')} | ${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}`;
    case 'production':
    default: {
      const parts = [];
      if (agent.last_seen) parts.push(`${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}`);
      if (agent.taskStats) {
        const { done, active: act } = agent.taskStats;
        if (done || act) parts.push(`${t('profile.agents.detail.today')}: ${done || 0} ${t('profile.agents.detail.done')}${act ? `, ${act} ${t('profile.agents.detail.active')}` : ''}`);
      }
      return html`${parts.join(' | ')}`;
    }
  }
}

function renderZone2(state, agent, onboarding, setActiveTab, showToast) {
  switch (state) {
    case 'new':
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--new">
          <div class="pf-agd-zone2-title">${t('profile.agents.detail.zone2.newTitle')}</div>
          <div class="pf-agd-zone2-desc">${t('profile.agents.detail.zone2.newDesc')}</div>
          <div class="pf-agd-zone2-actions">
            <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); setActiveTab('integration'); }}>
              ${t('profile.agents.detail.zone2.goToIntegration')}
            </button>
          </div>
        </div>
      `;
    case 'onboarding': {
      const steps = onboarding?.steps || [];
      const passed = steps.filter(s => s.status === 'passed').length;
      const total = steps.length || 11;
      const pct = Math.round((passed / total) * 100);
      const nextStep = steps.find(s => s.status === 'pending');
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--onboarding">
          <div class="pf-agd-zone2-title">
            ${t('profile.agents.detail.zone2.onboardingTitle')}: ${passed} / ${total}
            ${nextStep ? html`<span class="pf-agd-zone2-desc"> ${t('profile.agents.detail.state.next')}: ${nextStep.name}</span>` : ''}
          </div>
          <div class="pf-agd-progress-bar">
            <div class="pf-agd-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="pf-agd-step-pills">
            ${steps.map(s => html`
              <span key=${s.id} class="pf-agd-step-pill pf-agd-step-pill--${s.status}">
                ${s.status === 'passed' ? '✓' : '○'} ${s.name?.split(' ').slice(0, 2).join(' ') || s.id}
              </span>
            `)}
          </div>
        </div>
      `;
    }
    case 'problem':
      return html`<${ProblemZone2} agent=${agent} setActiveTab=${setActiveTab} showToast=${showToast} />`;

    case 'production':
    default: {
      const tags = agent.tags ?? [];
      const hasWebhook = agent.webhookUrl || agent.webhook_url;
      const deliveryLabel = hasWebhook ? t('profile.agents.detail.deliveryWebhook') : t('profile.agents.detail.deliveryPolling');
      const stats = agent.taskStats;
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--production">
          <div class="pf-agd-zone2-stats">
            <span>${deliveryLabel}</span>
            ${agent.last_seen ? html`<span>${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}</span>` : ''}
            ${stats && (stats.done || stats.active) ? html`<span>${t('profile.agents.detail.today')}: ${stats.done || 0} ${t('profile.agents.detail.done')}${stats.active ? `, ${stats.active} ${t('profile.agents.detail.active')}` : ''}</span>` : ''}
            ${tags.length > 0 ? html`<span>${t('profile.agents.detail.sharedTags')}: ${tags.map(tag => `[${tag}]`).join(' ')}</span>` : ''}
          </div>
        </div>
      `;
    }
  }
}

function ProblemZone2({ agent, setActiveTab, showToast }) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState(agent.webhook_url || agent.webhookUrl || '');
  const [testing, setTesting] = useState(false);

  async function handleTestWebhook(e) {
    e.stopPropagation();
    setTesting(true);
    try {
      const resp = await testWebhook(agent.name);
      if (resp?.ok !== false) {
        showToast(t('profile.agents.detail.zone2.testWebhookSuccess'));
      } else {
        showToast(t('profile.agents.detail.zone2.testWebhookFailed'), true);
      }
    } catch {
      showToast(t('profile.agents.detail.zone2.testWebhookFailed'), true);
    }
    setTesting(false);
  }

  async function handleSaveUrl(e) {
    e.stopPropagation();
    try {
      const resp = await updateWebhook(agent.name, { url: urlValue });
      if (resp?.ok !== false) {
        showToast(t('profile.agents.detail.zone2.urlUpdated'));
        setEditingUrl(false);
      } else {
        showToast(t('profile.agents.detail.zone2.urlUpdateFailed'), true);
      }
    } catch {
      showToast(t('profile.agents.detail.zone2.urlUpdateFailed'), true);
    }
  }

  function handleOverrideReadiness(e) {
    e.stopPropagation();
    setActiveTab('integration');
  }

  const failCount = agent.webhookFailCount ?? 0;

  return html`
    <div class="pf-agd-zone2 pf-agd-zone2--problem">
      <div class="pf-agd-zone2-title">${t('profile.agents.detail.zone2.problemTitle')}</div>
      <div class="pf-agd-zone2-desc">
        ${failCount >= 5 ? t('profile.agents.detail.zone2.webhookFailed', { count: failCount }) : ''}
        ${!agent.last_seen ? t('profile.agents.detail.zone2.noTelemetry') : ''}
      </div>
      <div class="pf-agd-zone2-actions">
        <button class="btn-outline btn-sm" onClick=${handleTestWebhook} disabled=${testing}>
          ${t('profile.agents.detail.zone2.testWebhook')}
        </button>
        <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingUrl(!editingUrl); }}>
          ${t('profile.agents.detail.zone2.updateUrl')}
        </button>
        <button class="btn-outline btn-sm" onClick=${handleOverrideReadiness}>
          ${t('profile.agents.detail.zone2.overrideReadiness')}
        </button>
      </div>
      ${editingUrl && html`
        <div class="pf-agd-zone2-url-form">
          <input type="text" value=${urlValue}
                 onInput=${(e) => setUrlValue(e.target.value)}
                 onClick=${(e) => e.stopPropagation()}
                 placeholder="https://..." />
          <button class="btn-primary btn-sm" onClick=${handleSaveUrl}>
            ${t('profile.agents.detail.zone2.save')}
          </button>
          <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingUrl(false); }}>
            ${t('profile.agents.detail.zone2.cancel')}
          </button>
        </div>
      `}
    </div>
  `;
}

function renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents) {
  const props = { agent, onboarding, session, showToast, agentName: agent.name, allAgents };
  switch (activeTab) {
    case 'integration': return html`<${TabIntegration} ...${props} />`;
    case 'tasks': return html`<${TabTasks} ...${props} />`;
    case 'messages': return html`<${TabMessages} ...${props} />`;
    case 'data-access': return html`<${TabDataAccess} ...${props} />`;
    case 'directives': return html`<${TabDirectives} ...${props} />`;
    case 'agent-config': return html`<${TabAgentConfig} ...${props} />`;
    case 'activity': return html`<${TabActivity} ...${props} />`;
    case 'services': return html`<${TabServices} ...${props} />`;
    default: return null;
  }
}
