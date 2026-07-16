/**
 * @file tab-integration.js
 * @description Integration tab for agent detail view. Shows onboarding checklist
 *   during onboarding or production status (connection, platform, readiness,
 *   identity, delivery log) after completion.
 * @version-history
 *   v1.9.0 -- 2026-07-16 -- Mount folds webhook + delivery-log + onboarding-checklist into GET
 *     /v1/agents/:name/integration/overview (getIntegrationOverview); skill-bundle version stays a
 *     separate request; individual reads kept as fallback.
 *   v1.8.0 -- 2026-06-30 -- Onboarding checklist step labels use tOr() so a missing
 *     agentOnboarding.steps.* key falls back to the server-provided step.title (which carries
 *     the howTo-enriched onboarding payload) instead of rendering the raw i18n key.
 *   v1.7.0 -- 2026-06-10 -- Webhook fields (URL, fail count, Test/Edit) hidden while delivery
 *     is polling; a "+ Set up webhook" reveal opens the URL form for switching methods.
 *   v1.6.0 -- 2026-06-02 -- Component unification (#1): the 3 copy buttons (agent prompt,
 *     install command, curl) now use the canonical <CopyButton> with precomputed text
 *     payloads -- dropped 3 copied-state useState hooks, 3 hand-rolled handlers, the
 *     copied-flag params threaded through both render functions, and the local
 *     copyToClipboard import.
 *   v1.5.0 -- 2026-05-31 -- Live-update refresh no longer toggles the full-tab loading
 *     placeholder (added a showSpinner option). During Hello Integration the agent
 *     posts steps/telemetry rapidly, so the frequent SSE ticks were re-rendering the
 *     "Loading..." state on every tick -- the tab flashed like a full reload.
 *   v1.4.0 -- 2026-05-28 -- Treat webhook with empty url as polling: status dot, label, and
 *                            the webhook section all key off (webhook && webhook.url), not just
 *                            the webhook object existing. A record with url="" is still polling.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix 9 UI audit findings: pending icon, readiness score, webhook edit,
 *     strengths/gaps, last validated, roles badge, platform version, bundle update, copy install cmd
 *   v1.3.0 -- 2026-05-24 -- Audit fix: always show delivery log section, add warn icon for step pills
 *   v1.2.0 -- 2026-05-24 -- Add delivery status indicator dot, show polling fallback interval
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t, tOr } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { detectAgentState } from './state-detector.js';
import {
  getOnboarding, startOnboarding, getIntegrationOverview,
  getWebhookConfig, testWebhook, updateWebhook,
  getSkillBundleVersion, getSkillBundleUrl, updateSkillBundle,
  getDeliveryLog
} from '/js/services/agent-integration.js';

const html = htm.bind(h);

export default function TabIntegration({ agent, onboarding, showToast, agentName }) {
  const state = detectAgentState(agent, onboarding);
  const [webhook, setWebhook] = useState(null);
  const [bundleVersion, setBundleVersion] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [postChecklist, setPostChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [showAllDeliveries, setShowAllDeliveries] = useState(false);
  const [allDeliveries, setAllDeliveries] = useState(null);
  const [editingWebhook, setEditingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [updatingBundle, setUpdatingBundle] = useState(false);

  const loadData = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      // Mount fold: ONE composite (webhook + delivery log + onboarding checklist) plus the skill-bundle
      // version, which stays separate (bundle-generation pipeline, not a read). On composite failure, fall
      // back to the individual reads. Each composite sub-object mirrors the matching endpoint's `.data`.
      const [ov, sbResp] = await Promise.all([
        getIntegrationOverview(agentName),
        getSkillBundleVersion(agentName).catch(() => null),
      ]);
      setBundleVersion(sbResp?.data || null);
      if (ov) {
        setWebhook(ov.webhook || null);
        setDeliveries(ov.deliveries?.deliveries || []);
        setPostChecklist(ov.onboarding?.post_onboarding_checklist || null);
      } else {
        const [whResp, dlResp, obResp] = await Promise.all([
          getWebhookConfig(agentName).catch(() => null),
          getDeliveryLog(agentName, 10).catch(() => null),
          getOnboarding(agentName).catch(() => null),
        ]);
        setWebhook(whResp?.data || null);
        setDeliveries(dlResp?.data?.deliveries || []);
        setPostChecklist(obResp?.data?.post_onboarding_checklist || null);
      }
    } catch { /* silent */ }
    if (showSpinner) setLoading(false);
  }, [agentName]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // Background refresh on every live-update WITHOUT toggling the full-tab
    // "Loading..." placeholder. During Hello Integration the agent posts steps
    // + telemetry rapidly, so this fires often; showing the spinner each time
    // made the whole tab flash like a reload. Initial mount still shows it.
    return onLiveUpdate(['agents', 'agent-onboarding'], () => loadRef.current({ showSpinner: false }));
  }, []);

  async function handleTestWebhook(e) {
    e.stopPropagation();
    setTesting(true);
    try {
      const resp = await testWebhook(agentName);
      if (resp?.data?.success) {
        showToast(t('profile.agents.webhook.testSuccess'));
      } else {
        showToast(t('profile.agents.webhook.testFailed'), true);
      }
      loadData();
    } catch {
      showToast(t('profile.agents.webhook.testFailed'), true);
    }
    setTesting(false);
  }

  async function handleRerun(e) {
    e.stopPropagation();
    setRerunning(true);
    try {
      await startOnboarding(agentName);
      showToast(t('profile.agents.detail.integration.rerunStarted'));
      loadData();
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.integration.startError'), true);
    }
    setRerunning(false);
  }

  // Copy-button payloads (the canonical <CopyButton> owns the copy + copied-state).
  const skillBundleUrl = `${location.origin}${getSkillBundleUrl(agentName)}`;
  const curlText = `curl -o skill-bundle.zip ${skillBundleUrl}`;
  const installPlatform = onboarding?.platformName || onboarding?.detectedPlatform || '';
  const installCmdText = (installPlatform.toLowerCase().includes('hermes') || installPlatform.toLowerCase().includes('openclaw'))
    ? `hermes skills install ${skillBundleUrl}`
    : `curl -o skill-bundle.zip ${skillBundleUrl} && unzip skill-bundle.zip`;
  const agentPromptText = `Download and install your skill bundle from AIMEAT.

Your skill bundle URL: ${skillBundleUrl}

Steps:
1. Authenticate with your agent token: POST ${location.origin}/v1/auth/token
   Sign the challenge with your private key to get a JWT.

2. Download the skill bundle ZIP:
   GET ${skillBundleUrl}
   Header: Authorization: Bearer <your-jwt>
   Save the response as a ZIP file.

3. Extract the ZIP. It contains:
   - SKILL.md -- your operating instructions, directives, and API reference
   - Reference documents for task lifecycle, messaging, telemetry protocols
   - Platform-specific scripts (if applicable)

4. Read SKILL.md first -- it has your personalized directives, rules, and all the API endpoints you need.

If you already have a JWT token, you can do this in one step:
curl -H "Authorization: Bearer <jwt>" -o skill-bundle.zip "${skillBundleUrl}" && unzip skill-bundle.zip && cat */SKILL.md`;

  function handleEditWebhook(e) {
    e.stopPropagation();
    setWebhookDraft(webhook?.url || agent.webhook_url || '');
    setEditingWebhook(true);
  }

  async function handleSaveWebhook(e) {
    e.stopPropagation();
    setSavingWebhook(true);
    try {
      await updateWebhook(agentName, { url: webhookDraft });
      showToast(t('profile.agents.detail.integration.webhookUpdated'));
      setEditingWebhook(false);
      loadData();
    } catch {
      showToast(t('profile.agents.detail.integration.webhookUpdateError'), true);
    }
    setSavingWebhook(false);
  }

  function handleCancelWebhook(e) {
    e.stopPropagation();
    setEditingWebhook(false);
  }

  async function handleUpdateBundle(e) {
    e.stopPropagation();
    setUpdatingBundle(true);
    try {
      await updateSkillBundle(agentName);
      showToast(t('profile.agents.detail.integration.update'));
      loadData();
    } catch { /* silent */ }
    setUpdatingBundle(false);
  }

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  // System agents (Secretary / company Secretary / specialists) are auto-provisioned and never run the
  // device-auth "Hello Integration" onboarding — show a short note instead of the 0/11 checklist.
  if (state === 'system') {
    return html`<div class="pf-agd-empty">${t('profile.agents.detail.internalAgentNote')}</div>`;
  }

  const isOnboarding = state === 'new' || state === 'onboarding';

  if (isOnboarding) {
    return renderOnboardingView(onboarding, agentName, handleRerun, rerunning, curlText, installCmdText, agentPromptText);
  }

  async function handleShowAll() {
    if (showAllDeliveries) { setShowAllDeliveries(false); return; }
    try {
      const resp = await getDeliveryLog(agentName, 200);
      setAllDeliveries(resp?.data?.deliveries || []);
    } catch { /* silent */ }
    setShowAllDeliveries(true);
  }

  const displayDeliveries = showAllDeliveries && allDeliveries ? allDeliveries : deliveries;

  return renderProductionView(agent, onboarding, webhook, bundleVersion, displayDeliveries, handleTestWebhook, testing, handleRerun, rerunning, curlText, handleShowAll, showAllDeliveries, editingWebhook, webhookDraft, setWebhookDraft, handleEditWebhook, handleSaveWebhook, handleCancelWebhook, savingWebhook, handleUpdateBundle, updatingBundle, agentPromptText, postChecklist);
}

function renderOnboardingView(onboarding, agentName, handleRerun, rerunning, curlText, installCmdText, agentPromptText) {
  const steps = onboarding?.steps || [];
  const passed = steps.filter(s => s.status === 'passed').length;
  const total = steps.length || 11;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  return html`
    <div>
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">
          ${t('profile.agents.detail.integration.checklistTitle')}
          ${' -- '}${t('profile.agents.detail.integration.readinessScore')}: ${pct > 0 ? `${pct} / 100` : '--'}
        </div>
        <div class="pf-agd-progress-bar">
          <div class="pf-agd-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="pf-agd-section-header pf-agd-progress-header">
          <span>${t('profile.agents.detail.integration.progress')}: ${passed}/${total}</span>
          <span>${pct}%</span>
        </div>
      </div>

      <div class="pf-agd-checklist">
        ${steps.map((step, i) => html`
          <div key=${step.id || i} class="pf-agd-step pf-agd-step--${step.status}">
            <span class="pf-agd-step-icon">
              ${step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '○'}
            </span>
            <span class="pf-agd-step-name">${i + 1}. ${tOr('agentOnboarding.steps.' + step.id, step.title || step.id)}</span>
            <span class="pf-agd-step-detail">
              ${step.validatedAt ? timeAgo(step.validatedAt) : ''}
              ${step.validationDetail ? ` -- ${step.validationDetail}` : ''}
            </span>
          </div>
        `)}
      </div>

      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.skillBundle.title')}</div>
        <div class="pf-agd-form-actions">
          <${CopyButton} text=${agentPromptText} className="btn-primary btn-sm"
            label=${t('profile.agents.detail.integration.copyAgentPrompt')}
            copiedLabel=${'✓ ' + t('profile.agents.detail.integration.promptCopied')} />
          <${CopyButton} text=${installCmdText} className="btn-outline btn-sm"
            label=${t('profile.agents.detail.integration.copyInstallCommand')}
            copiedLabel=${'✓ ' + t('profile.agents.detail.integration.installCommandCopied')} />
          <${CopyButton} text=${curlText} className="btn-outline btn-sm"
            label=${t('profile.agents.skillBundle.copyCurl')}
            copiedLabel=${'✓ ' + t('profile.agents.copied')} />
          <a class="btn-outline btn-sm" href=${getSkillBundleUrl(agentName)} download>
            ${t('profile.agents.skillBundle.downloadZip')}
          </a>
        </div>
      </div>

      <div class="pf-agd-form-actions">
        <button class="btn-primary btn-sm" onClick=${handleRerun} disabled=${rerunning}>
          ${rerunning ? '...' : (passed > 0 ? t('profile.agents.detail.integration.rerun') : t('profile.agents.detail.integration.startOnboarding'))}
        </button>
      </div>
    </div>
  `;
}

function renderProductionView(agent, onboarding, webhook, bundleVersion, displayDeliveries, handleTestWebhook, testing, handleRerun, rerunning, curlText, handleShowAll, showAllDeliveries, editingWebhook, webhookDraft, setWebhookDraft, handleEditWebhook, handleSaveWebhook, handleCancelWebhook, savingWebhook, handleUpdateBundle, updatingBundle, agentPromptText, postChecklist) {
  const steps = onboarding?.steps || [];

  const passedSteps = steps.filter(s => s.status === 'passed');
  const gapSteps = steps.filter(s => s.status !== 'passed');
  const strengthNames = passedSteps.map(s => s.name || s.id).join(', ');
  const gapNames = gapSteps.map(s => s.name || s.id).join(', ');

  const lastValidatedTs = steps.reduce((latest, s) => {
    if (!s.validatedAt) return latest;
    const d = new Date(s.validatedAt).getTime();
    return d > latest ? d : latest;
  }, 0);

  const platformVersion = onboarding?.platform?.version || onboarding?.platformVersion || null;
  const detectionMethod = onboarding?.detectedPlatform
    ? t('profile.agents.detail.integration.autoDetected')
    : t('profile.agents.detail.integration.manual');

  return html`
    <div>
      <!-- CONNECTION -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.detail.connection')}</div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.detail.integration.deliveryMethod')}</span>
          <span class="pf-agd-info-value">
            <span class="pf-agd-status-dot ${(webhook && webhook.url && (webhook.failCount ?? 0) < 5) ? 'pf-agd-status-dot--active' : (webhook && webhook.url && (webhook.failCount ?? 0) >= 5) ? 'pf-agd-status-dot--error' : 'pf-agd-status-dot--inactive'}"></span>
            ${(webhook && webhook.url) ? t('profile.agents.detail.deliveryWebhook') : t('profile.agents.detail.deliveryPolling')}
          </span>
        </div>
        ${(webhook && webhook.url) ? html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.webhook.url')}</span>
            <span class="pf-agd-info-value">${webhook.url || '--'}</span>
          </div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.webhook.failCount')}</span>
            <span class="pf-agd-info-value">${webhook.failCount ?? 0}</span>
          </div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.webhook.lastSuccess')}</span>
            <span class="pf-agd-info-value">${webhook.lastSuccessAt ? timeAgo(webhook.lastSuccessAt) : '--'}</span>
          </div>
          ${editingWebhook ? html`
            <div class="pf-agd-webhook-form">
              <input
                type="url"
                value=${webhookDraft}
                onInput=${e => setWebhookDraft(e.target.value)}
                placeholder="https://..."
              />
              <button class="btn-primary btn-sm" onClick=${handleSaveWebhook} disabled=${savingWebhook}>
                ${savingWebhook ? '...' : t('common.save')}
              </button>
              <button class="btn-outline btn-sm" onClick=${handleCancelWebhook}>
                ${t('common.cancel')}
              </button>
            </div>
          ` : html`
            <div class="pf-agd-form-actions">
              <button class="btn-outline btn-sm" onClick=${handleTestWebhook} disabled=${testing}>
                ${testing ? '...' : t('profile.agents.webhook.test')}
              </button>
              <button class="btn-outline btn-sm" onClick=${handleEditWebhook}>
                ${t('profile.agents.detail.integration.editWebhook')}
              </button>
            </div>
          `}
        ` : html`
          <!-- Polling is the active method: webhook plumbing stays hidden until the owner
               chooses to switch (the "+ Set up webhook" reveal). -->
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.pollingInterval')}</span>
            <span class="pf-agd-info-value">${agent.pollingInterval || agent.polling_interval || '60s'}</span>
          </div>
          ${editingWebhook ? html`
            <div class="pf-agd-webhook-form">
              <input
                type="url"
                value=${webhookDraft}
                onInput=${e => setWebhookDraft(e.target.value)}
                placeholder="https://..."
              />
              <button class="btn-primary btn-sm" onClick=${handleSaveWebhook} disabled=${savingWebhook}>
                ${savingWebhook ? '...' : t('common.save')}
              </button>
              <button class="btn-outline btn-sm" onClick=${handleCancelWebhook}>
                ${t('common.cancel')}
              </button>
            </div>
          ` : html`
            <div class="pf-agd-form-actions">
              <button class="btn-ghost btn-sm" onClick=${handleEditWebhook}>
                + ${t('profile.agents.detail.integration.setupWebhook') || 'Set up webhook'}
              </button>
            </div>
          `}
        `}
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.detail.lastSeen')}</span>
          <span class="pf-agd-info-value">${agent.last_seen ? timeAgo(agent.last_seen) : '--'}</span>
        </div>
      </div>

      <!-- PLATFORM & SKILL -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.detail.platform')} & ${t('profile.agents.detail.skillBundle')}</div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.detail.platform')}</span>
          <span class="pf-agd-info-value">${onboarding?.platformName || onboarding?.detectedPlatform || '--'}</span>
        </div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.detail.integration.platformVersion')}</span>
          <span class="pf-agd-info-value">${platformVersion || '--'}</span>
        </div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.detail.integration.detectionMethod')}</span>
          <span class="pf-agd-info-value">${detectionMethod}</span>
        </div>
        ${bundleVersion ? html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.skillBundle.versionLabel')}</span>
            <span class="pf-agd-info-value">${bundleVersion.version || '--'}</span>
          </div>
        ` : ''}
        <div class="pf-agd-form-actions">
          <${CopyButton} text=${agentPromptText} className="btn-primary btn-sm"
            label=${t('profile.agents.detail.integration.copyAgentPrompt')}
            copiedLabel=${'✓ ' + t('profile.agents.detail.integration.promptCopied')} />
          <${CopyButton} text=${curlText} className="btn-outline btn-sm"
            label=${t('profile.agents.skillBundle.reinstall')}
            copiedLabel=${'✓ ' + t('profile.agents.copied')} />
          <button class="btn-outline btn-sm" onClick=${handleUpdateBundle} disabled=${updatingBundle}>
            ${updatingBundle ? '...' : t('profile.agents.detail.integration.update')}
          </button>
        </div>
      </div>

      <!-- READINESS -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.detail.readiness')}</div>
        <div class="pf-agd-step-pills">
          ${steps.map(s => html`
            <span key=${s.id} class="pf-agd-step-pill pf-agd-step-pill--${s.status}">
              ${s.status === 'passed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'warn' ? '⚠' : '○'} ${s.name?.split(' ').slice(0, 2).join(' ') || s.id}
            </span>
          `)}
        </div>
        ${onboarding?.readinessScore != null && html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.readiness')}</span>
            <span class="pf-agd-info-value">${onboarding.readinessLevel} (${onboarding.readinessScore})</span>
          </div>
        `}
        <div class="pf-agd-strengths-gaps">
          <div>
            <span class="pf-agd-strengths-gaps-label">${t('profile.agents.detail.integration.strengths')}: </span>
            <span class="pf-agd-strengths-gaps-value">${strengthNames || t('profile.agents.detail.integration.noStrengths')}</span>
          </div>
          <div>
            <span class="pf-agd-strengths-gaps-label">${t('profile.agents.detail.integration.gaps')}: </span>
            <span class="pf-agd-strengths-gaps-value">${gapNames || t('profile.agents.detail.integration.noGaps')}</span>
          </div>
        </div>
        ${lastValidatedTs > 0 && html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.lastValidated')}</span>
            <span class="pf-agd-info-value">${timeAgo(lastValidatedTs)}</span>
          </div>
        `}
        <div class="pf-agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${handleRerun} disabled=${rerunning}>
            ${rerunning ? '...' : t('profile.agents.detail.integration.rerun')}
          </button>
        </div>
      </div>

      <!-- POST-ONBOARDING SETUP -->
      ${postChecklist && html`
        <div class="pf-agd-section">
          <div class="pf-agd-section-label">${t('profile.agents.detail.integration.postOnboardingSetup')}</div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.commandsRegistered')}</span>
            <span class="pf-agd-info-value">
              <span class="pf-agd-status-dot ${postChecklist.commands_registered ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span>
              ${postChecklist.commands_registered ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.configPublished')}</span>
            <span class="pf-agd-info-value">
              <span class="pf-agd-status-dot ${postChecklist.config_published ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span>
              ${postChecklist.config_published ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.sharedTagsInUse')}</span>
            <span class="pf-agd-info-value">
              ${postChecklist.shared_tags_in_use === null
                ? html`<span class="pf-agd-status-dot pf-agd-status-dot--inactive"></span> ${t('profile.agents.detail.integration.notApplicable')}`
                : html`<span class="pf-agd-status-dot ${postChecklist.shared_tags_in_use ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span> ${postChecklist.shared_tags_in_use ? t('common.yes') : t('common.no')}`
              }
            </span>
          </div>
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.knowledgePackages')}</span>
            <span class="pf-agd-info-value">
              <span class="pf-agd-status-dot ${postChecklist.knowledge_packages_published ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span>
              ${postChecklist.knowledge_packages_published ? t('common.yes') : t('common.no')}
            </span>
          </div>
        </div>
      `}

      <!-- IDENTITY -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.detail.identity')}</div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">GAII</span>
          <span class="pf-agd-info-value">${agent.gaii || '--'}</span>
        </div>
        ${agent.public_key && html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.publicKey')}</span>
            <span class="pf-agd-info-value">${truncateKey(agent.public_key)}</span>
          </div>
        `}
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('profile.agents.created')}</span>
          <span class="pf-agd-info-value">${agent.created_at ? new Date(agent.created_at).toLocaleDateString() : '--'}</span>
        </div>
        ${agent.roles && agent.roles.length > 0 && html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.detail.integration.roles')}</span>
            <span class="pf-agd-info-value">
              ${agent.roles.map(r => html`<span key=${r} class="pf-agd-role-badge">${r}</span> `)}
            </span>
          </div>
        `}
      </div>

      <!-- DELIVERY LOG -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('profile.agents.detail.deliveryLog')}</div>
        ${displayDeliveries.length > 0 ? html`
          <table class="pf-agd-delivery-log">
            <thead>
              <tr>
                <th>${t('profile.agents.detail.integration.time')}</th>
                <th>${t('profile.agents.detail.integration.event')}</th>
                <th>${t('profile.agents.detail.integration.channel')}</th>
                <th>${t('profile.agents.detail.integration.result')}</th>
                <th>${t('profile.agents.detail.integration.latency')}</th>
              </tr>
            </thead>
            <tbody>
              ${displayDeliveries.map((d, i) => html`
                <tr key=${d.id || i}>
                  <td>${d.timestamp ? timeAgo(d.timestamp) : '--'}</td>
                  <td>${d.eventType || d.event || '--'}</td>
                  <td>${d.channel || '--'}</td>
                  <td>${d.success ? '✓' : '✗'}</td>
                  <td>${d.latencyMs ? `${(d.latencyMs / 1000).toFixed(1)}s` : '--'}</td>
                </tr>
              `)}
            </tbody>
          </table>
          <button class="btn-ghost btn-sm pf-agd-delivery-toggle" onClick=${handleShowAll}>
            ${showAllDeliveries ? t('profile.agents.detail.showLess') : t('profile.agents.detail.showAll')}
          </button>
        ` : html`
          <div class="pf-agd-empty-hint">${t('profile.agents.detail.integration.noDeliveries')}</div>
        `}
      </div>
    </div>
  `;
}

function truncateKey(key) {
  if (!key) return '--';
  if (key.length <= 20) return key;
  return key.slice(0, 10) + '...' + key.slice(-10);
}
