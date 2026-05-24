/**
 * @file tab-integration.js
 * @description Integration tab for agent detail view. Shows onboarding checklist
 *   during onboarding or production status (connection, platform, readiness,
 *   identity, delivery log) after completion.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix 9 UI audit findings: pending icon, readiness score, webhook edit,
 *     strengths/gaps, last validated, roles badge, platform version, bundle update, copy install cmd
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo, copyToClipboard } from '/js/utils.js';
import { detectAgentState } from './state-detector.js';
import {
  getOnboarding, startOnboarding,
  getWebhookConfig, testWebhook, updateWebhook,
  getSkillBundleVersion, getSkillBundleUrl, updateSkillBundle,
  getDeliveryLog
} from '/js/services/agent-integration.js';

const html = htm.bind(h);

export default function TabIntegration({ agent, onboarding, session, showToast, agentName }) {
  const state = detectAgentState(agent, onboarding);
  const [webhook, setWebhook] = useState(null);
  const [bundleVersion, setBundleVersion] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [showAllDeliveries, setShowAllDeliveries] = useState(false);
  const [allDeliveries, setAllDeliveries] = useState(null);
  const [editingWebhook, setEditingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [updatingBundle, setUpdatingBundle] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [whResp, sbResp, dlResp] = await Promise.all([
        getWebhookConfig(agentName).catch(() => null),
        getSkillBundleVersion(agentName).catch(() => null),
        getDeliveryLog(agentName, 10).catch(() => null),
      ]);
      setWebhook(whResp?.data || null);
      setBundleVersion(sbResp?.data || null);
      setDeliveries(dlResp?.data?.deliveries || []);
    } catch { /* silent */ }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
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

  function handleCopyInstall(e) {
    e.stopPropagation();
    const url = getSkillBundleUrl(agentName);
    copyToClipboard(`curl -o skill-bundle.zip ${location.origin}${url}`).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    });
  }

  function handleCopyInstallCommand(e) {
    e.stopPropagation();
    const platform = onboarding?.platformName || onboarding?.detectedPlatform || '';
    const url = `${location.origin}${getSkillBundleUrl(agentName)}`;
    let cmd;
    if (platform.toLowerCase().includes('hermes') || platform.toLowerCase().includes('openclaw')) {
      cmd = `hermes skills install ${url}`;
    } else {
      cmd = `curl -o skill-bundle.zip ${url} && unzip skill-bundle.zip`;
    }
    copyToClipboard(cmd).then(() => {
      setCopiedInstall(true);
      setTimeout(() => setCopiedInstall(false), 2000);
    });
  }

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

  const isOnboarding = state === 'new' || state === 'onboarding';

  if (isOnboarding) {
    return renderOnboardingView(onboarding, agentName, handleRerun, rerunning, handleCopyInstall, copiedCmd, handleCopyInstallCommand, copiedInstall);
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

  return renderProductionView(agent, onboarding, webhook, bundleVersion, displayDeliveries, handleTestWebhook, testing, handleRerun, rerunning, handleCopyInstall, copiedCmd, handleShowAll, showAllDeliveries, editingWebhook, webhookDraft, setWebhookDraft, handleEditWebhook, handleSaveWebhook, handleCancelWebhook, savingWebhook, handleUpdateBundle, updatingBundle, handleCopyInstallCommand, copiedInstall);
}

function renderOnboardingView(onboarding, agentName, handleRerun, rerunning, handleCopyInstall, copiedCmd, handleCopyInstallCommand, copiedInstall) {
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
              ${step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '○'}
            </span>
            <span class="pf-agd-step-name">${i + 1}. ${step.name || step.id}</span>
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
          <button class="btn-outline btn-sm" onClick=${handleCopyInstallCommand}>
            ${copiedInstall ? '✓ ' + t('profile.agents.detail.integration.installCommandCopied') : t('profile.agents.detail.integration.copyInstallCommand')}
          </button>
          <button class="btn-outline btn-sm" onClick=${handleCopyInstall}>
            ${copiedCmd ? '✓ ' + t('profile.agents.copied') : t('profile.agents.skillBundle.copyCurl')}
          </button>
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

function renderProductionView(agent, onboarding, webhook, bundleVersion, displayDeliveries, handleTestWebhook, testing, handleRerun, rerunning, handleCopyInstall, copiedCmd, handleShowAll, showAllDeliveries, editingWebhook, webhookDraft, setWebhookDraft, handleEditWebhook, handleSaveWebhook, handleCancelWebhook, savingWebhook, handleUpdateBundle, updatingBundle, handleCopyInstallCommand, copiedInstall) {
  const steps = onboarding?.steps || [];
  const agentName = agent.name;

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
        ${webhook ? html`
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
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-value">${t('profile.agents.detail.deliveryPolling')}</span>
          </div>
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
          <button class="btn-outline btn-sm" onClick=${handleCopyInstall}>
            ${copiedCmd ? '✓ ' + t('profile.agents.copied') : t('profile.agents.skillBundle.reinstall')}
          </button>
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
              ${s.status === 'passed' ? '✓' : '○'} ${s.name?.split(' ').slice(0, 2).join(' ') || s.id}
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
      ${displayDeliveries.length > 0 && html`
        <div class="pf-agd-section">
          <div class="pf-agd-section-label">${t('profile.agents.detail.deliveryLog')}</div>
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
        </div>
      `}
    </div>
  `;
}

function truncateKey(key) {
  if (!key) return '--';
  if (key.length <= 20) return key;
  return key.slice(0, 10) + '...' + key.slice(-10);
}
