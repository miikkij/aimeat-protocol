/**
 * @file agent-card.js
 * @description Agent card component with collapsed/expanded states,
 *   Two-Zone Header (identity + state-dependent status), and 8-tab bar.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix C6: remove GAII from Zone 1, M1: add Next prefix, C1: production stats, C2: problem action buttons
 *   v1.3.0 -- 2026-05-24 -- Audit fix: use proper down arrow glyph for collapse icon
 *   v1.2.0 -- 2026-05-24 -- Add idle state handling, tokens today display, combined delivery label
 *   v1.4.0 -- 2026-05-29 -- Add agent mode badge + dedicated tag chip strip
 *   v1.5.0 -- 2026-05-31 -- Add README tab, rendered from the agents.<name>.readme
 *     owner-namespaced memory entry. Shown first + selected by default when a
 *     non-empty README exists; hidden otherwise.
 */

import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { timeAgo } from '/js/utils.js';
import { detectAgentState, getDefaultTab, getStateColor } from './state-detector.js';
import { testWebhook, updateWebhook } from '/js/services/agent-integration.js';
import TabReadme from './tab-readme.js';
import TabIntegration from './tab-integration.js';
import TabTasks from './tab-tasks.js';
import TabMessages from './tab-messages.js';
import TabDataAccess from './tab-data-access.js';
import TabDirectives from './tab-directives.js';
import TabAgentConfig from './tab-agent-config.js';
import TabActivity from './tab-activity.js';
import TabServices from './tab-services.js';

const html = htm.bind(h);

// README is opt-in and prepended only when the agent has published one, so it
// is NOT in this base list. See readmeTab below.
const TABS = [
  { id: 'integration', key: 'profile.agents.detail.tabs.integration' },
  { id: 'tasks', key: 'profile.agents.detail.tabs.tasks' },
  { id: 'messages', key: 'profile.agents.detail.tabs.messages' },
  { id: 'data-access', key: 'profile.agents.detail.tabs.data_access' },
  { id: 'directives', key: 'profile.agents.detail.tabs.directives' },
  { id: 'agent-config', key: 'profile.agents.detail.tabs.agent_config' },
  { id: 'activity', key: 'profile.agents.detail.tabs.activity' },
  { id: 'services', key: 'profile.agents.detail.tabs.services' },
];

const readmeTab = { id: 'readme', key: 'profile.agents.detail.tabs.readme' };

// Read the agent's owner-namespaced README markdown (agents.<name>.readme).
// Uses the owner-session list endpoint (?agent=<gaii>) — the same path
// tab-data-access uses — which returns owner-visibility values to the owner.
// (The public /v1/memory/:gaii/:key route only serves `public` entries unless
// consent is enabled, so it is not suitable for an `owner`-visibility README.)
// Returns the string, or '' if absent/blank.
async function fetchReadme(agent) {
  const gaii = agent?.gaii || agent?.name;
  const key = `agents.${agent.name}.readme`;
  try {
    const resp = await apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(key)}&per_page=5`);
    const items = resp?.data?.items || resp?.data || [];
    const found = Array.isArray(items) ? items.find(it => it.key === key) : null;
    const value = found?.value;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export default function AgentCard({ agent, onboarding, expanded, onToggle, session, showToast, allAgents, onScopesClick, onDeleteClick, onFederateToggle }) {
  const state = detectAgentState(agent, onboarding);
  const [activeTab, setActiveTab] = useState(null);
  // README markdown: undefined = not loaded, '' = none published, string = show tab.
  const [readme, setReadme] = useState(undefined);
  // True once the user clicks a tab, so the async README default never yanks
  // them off a tab they chose.
  const userPickedTab = useRef(false);

  // Load the README once the card is expanded (lazy — collapsed cards skip it).
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    fetchReadme(agent).then(md => { if (!cancelled) setReadme(md); });
    return () => { cancelled = true; };
  }, [expanded, agent.name]);

  const hasReadme = typeof readme === 'string' && readme.trim().length > 0;
  // When a README exists it is the first tab; otherwise the bar is unchanged.
  const tabs = hasReadme ? [readmeTab, ...TABS] : TABS;

  useEffect(() => {
    if (!expanded || userPickedTab.current) return;
    // README loads async after expand. Wait for it to resolve (readme !==
    // undefined) before locking in a default, so an existing README wins the
    // first-tab/default slot instead of being beaten by the state default.
    if (readme === undefined) return;
    setActiveTab(hasReadme ? 'readme' : getDefaultTab(state));
  }, [expanded, readme]);

  const handleCollapse = useCallback(() => {
    onToggle(agent.name);
    if (expanded) { setActiveTab(null); userPickedTab.current = false; }
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
            ${renderModeBadge(agent)}
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
          <span class="pf-agd-expand-icon pf-agd-expand-icon--open">▼</span>
          <div class="pf-agd-zone1-identity">
            <span class="pf-agd-zone1-name">${agent.display_name || agent.name}</span>
          </div>
          <div class="pf-agd-zone1-badges">
            ${renderModeBadge(agent)}
            ${renderPlatformBadge(onboarding)}
            ${renderReadinessBadge(state, onboarding)}
            ${agent.federate && html`<span class="pf-agd-badge pf-agd-badge--federation">${t('profile.federated')}</span>`}
          </div>
          <span class="pf-agd-zone1-right">
            ${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}
          </span>
        </div>

        <!-- Tags -->
        ${renderTagStrip(agent)}

        <!-- Capabilities -->
        ${(agent.technical_capabilities?.length > 0 || agent.domain_capabilities?.length > 0 || agent.languages?.length > 0) && html`
          <div class="pf-agd-capabilities">
            ${(agent.technical_capabilities || []).map(c => html`
              <span key=${c.name || c} class="pf-agd-cap-badge pf-agd-cap-badge--tech">${c.name || c}</span>
            `)}
            ${(agent.domain_capabilities || []).filter(c => !String(c).startsWith('Language: ')).map(c => html`
              <span key=${c} class="pf-agd-cap-badge pf-agd-cap-badge--domain">${c}</span>
            `)}
            ${(agent.languages || []).map(l => html`
              <span key=${'lang-' + l} class="pf-agd-cap-badge pf-agd-cap-badge--domain">${'Language: ' + l}</span>
            `)}
          </div>
        `}

        <!-- Zone 2: Status -->
        ${renderZone2(state, agent, onboarding, setActiveTab, showToast)}

        <!-- Tab Bar -->
        <div class="pf-agd-tabs">
          ${tabs.map(tab => {
            const label = t(tab.key);
            return html`
              <button key=${tab.id}
                      class="pf-agd-tab ${activeTab === tab.id ? 'pf-agd-tab--active' : ''}"
                      onClick=${(e) => { e.stopPropagation(); userPickedTab.current = true; setActiveTab(tab.id); }}>
                ${label !== tab.key ? label : tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}
              </button>
            `;
          })}
        </div>

        <!-- Tab Content -->
        <div class="pf-agd-tab-content" onClick=${(e) => e.stopPropagation()}>
          ${renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme)}
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
  const hasMcp = agent.mcpEnabled || agent.mcp_enabled;
  const failCount = agent.webhookFailCount ?? 0;
  const icon = hasWebhook ? (failCount >= 5 ? '⚠' : '✓') : '';

  let label;
  if (hasMcp && hasWebhook) {
    label = t('profile.agents.detail.deliveryMcpWh');
  } else if (hasWebhook) {
    label = t('profile.agents.detail.deliveryWh');
  } else if (hasMcp) {
    label = t('profile.agents.detail.deliveryMcp');
  } else {
    label = t('profile.agents.detail.deliveryPolling');
  }

  return html`<span class="pf-agd-delivery-indicator">${label}${icon ? ` ${icon}` : ''} </span>`;
}

function renderPlatformBadge(onboarding) {
  const platform = onboarding?.platformName || onboarding?.detectedPlatform;
  if (!platform) return null;
  const version = onboarding?.platformVersion;
  return html`<span class="pf-agd-badge pf-agd-badge--platform">${platform}${version ? ` v${version}` : ''}</span>`;
}

const READINESS_RANKS = { none: 0, basic: 1, standard: 2, advanced: 3, full: 4 };

function renderReadinessBadge(state, onboarding) {
  if (state === 'new') {
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  }
  if (state === 'onboarding') {
    const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
    const total = onboarding?.steps?.length ?? 11;
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-onboarding">${t('profile.agents.detail.state.onboarding')}: ${passed}/${total}</span>`;
  }
  if (state === 'problem') {
    const level = onboarding?.readinessLevel || 'none';
    const score = onboarding?.readinessScore;
    if (!score && score !== 0) return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
    const label = t(`agentOnboarding.readiness.${level}`);
    const degraded = onboarding?.previousReadinessLevel && (READINESS_RANKS[level] ?? 0) < (READINESS_RANKS[onboarding.previousReadinessLevel] ?? 0);
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level} ${degraded ? 'pf-agd-badge--degraded' : ''}">${degraded ? '↓ ' : ''}${label} (${score})</span>`;
  }
  // idle and production both show level + score
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
      return html`${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''} ${nextStep ? `| ${t('profile.agents.detail.state.next')}: ${t('agentOnboarding.steps.' + nextStep.id) || nextStep.title || nextStep.id}` : ''}`;
    }
    case 'problem':
      return html`${t('profile.agents.detail.state.problemSummary')} | ${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}`;
    case 'idle':
    case 'production':
    default: {
      const parts = [];
      if (agent.last_seen) parts.push(`${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}`);
      if (agent.taskStats) {
        const { done, active: act } = agent.taskStats;
        if (done || act) parts.push(`${t('profile.agents.detail.today')}: ${done || 0} ${t('profile.agents.detail.done')}${act ? `, ${act} ${t('profile.agents.detail.active')}` : ''}`);
      }
      if (agent.tokensUsedToday != null) parts.push(`${t('profile.agents.detail.tokensToday')}: ${agent.tokensUsedToday.toLocaleString()}`);
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
            ${nextStep ? html`<span class="pf-agd-zone2-desc"> ${t('profile.agents.detail.state.next')}: ${t('agentOnboarding.steps.' + nextStep.id) || nextStep.title || nextStep.id}</span>` : ''}
          </div>
          <div class="pf-agd-progress-bar">
            <div class="pf-agd-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="pf-agd-step-pills">
            ${steps.map(s => html`
              <span key=${s.id} class="pf-agd-step-pill pf-agd-step-pill--${s.status}">
                ${s.status === 'passed' ? '✓' : '○'} ${t('agentOnboarding.steps.' + s.id) || s.title || s.id}
              </span>
            `)}
          </div>
        </div>
      `;
    }
    case 'problem':
      return html`<${ProblemZone2} agent=${agent} setActiveTab=${setActiveTab} showToast=${showToast} />`;

    case 'idle':
    case 'production':
    default: {
      const hasWebhook = agent.webhookUrl || agent.webhook_url;
      const hasMcp = agent.mcpEnabled || agent.mcp_enabled;
      let deliveryLabel;
      if (hasMcp && hasWebhook) deliveryLabel = t('profile.agents.detail.deliveryMcpWh');
      else if (hasWebhook) deliveryLabel = t('profile.agents.detail.deliveryWh');
      else if (hasMcp) deliveryLabel = t('profile.agents.detail.deliveryMcp');
      else deliveryLabel = t('profile.agents.detail.deliveryPolling');
      const stats = agent.taskStats;
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--production">
          <div class="pf-agd-zone2-stats">
            <span>${deliveryLabel}</span>
            ${agent.last_seen ? html`<span>${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}</span>` : ''}
            ${stats && (stats.done || stats.active) ? html`<span>${t('profile.agents.detail.today')}: ${stats.done || 0} ${t('profile.agents.detail.done')}${stats.active ? `, ${stats.active} ${t('profile.agents.detail.active')}` : ''}</span>` : ''}
            ${agent.tokensUsedToday != null ? html`<span>${t('profile.agents.detail.tokensToday')}: ${agent.tokensUsedToday.toLocaleString()}</span>` : ''}
          </div>
        </div>
      `;
    }
  }
}

function renderModeBadge(agent) {
  const mode = agent.mode || 'interactive';
  const label = t(`profile.agents.mode.${mode}`) || mode;
  return html`<span class="pf-agd-badge pf-agd-badge--mode pf-agd-badge--mode-${mode}" title=${t('profile.agents.mode.tooltip') || ''}>${label}</span>`;
}

function renderTagStrip(agent) {
  const tags = agent.tags ?? [];
  if (tags.length === 0) return null;
  return html`
    <div class="pf-agd-tag-strip">
      ${tags.map(tag => html`<span key=${tag} class="pf-agd-tag-chip">${tag}</span>`)}
    </div>
  `;
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

function renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme) {
  const props = { agent, onboarding, session, showToast, agentName: agent.name, allAgents };
  switch (activeTab) {
    case 'readme': return html`<${TabReadme} readme=${readme} />`;
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
