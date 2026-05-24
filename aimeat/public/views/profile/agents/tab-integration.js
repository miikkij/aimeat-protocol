/**
 * @file tab-integration.js
 * @description Integration tab for agent detail view. Shows onboarding checklist
 *   during onboarding or production status (connection, platform, readiness,
 *   identity, delivery log) after completion.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo, copyToClipboard } from '/js/utils.js';
import { detectAgentState } from './state-detector.js';
import {
  getOnboarding, startOnboarding,
  getWebhookConfig, testWebhook,
  getSkillBundleVersion, getSkillBundleUrl,
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
      showToast(t('agents.detail.integration.rerunStarted'));
      loadData();
    } catch (err) {
      showToast(err.message || t('agents.detail.integration.startError'), true);
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

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  const isOnboarding = state === 'new' || state === 'onboarding';

  if (isOnboarding) {
    return renderOnboardingView(onboarding, agentName, handleRerun, rerunning, handleCopyInstall, copiedCmd);
  }

  return renderProductionView(agent, onboarding, webhook, bundleVersion, deliveries, handleTestWebhook, testing, handleRerun, rerunning, handleCopyInstall, copiedCmd);
}

function renderOnboardingView(onboarding, agentName, handleRerun, rerunning, handleCopyInstall, copiedCmd) {
  const steps = onboarding?.steps || [];
  const passed = steps.filter(s => s.status === 'passed').length;
  const total = steps.length || 11;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  return html`
    <div>
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('agents.detail.integration.checklistTitle')}</div>
        <div class="pf-agd-progress-bar">
          <div class="pf-agd-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="agd-section-header pf-agd-progress-header">
          <span>${t('agents.detail.integration.progress')}: ${passed}/${total}</span>
          <span>${pct}%</span>
        </div>
      </div>

      <div class="pf-agd-checklist">
        ${steps.map((step, i) => html`
          <div key=${step.id || i} class="pf-agd-step pf-agd-step--${step.status}">
            <span class="pf-agd-step-icon">
              ${step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '⬜'}
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
        <div class="agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${handleCopyInstall}>
            ${copiedCmd ? '✓ ' + t('profile.agents.copied') : t('profile.agents.skillBundle.copyCurl')}
          </button>
          <a class="btn-outline btn-sm" href=${getSkillBundleUrl(agentName)} download>
            ${t('profile.agents.skillBundle.downloadZip')}
          </a>
        </div>
      </div>

      <div class="agd-form-actions">
        <button class="btn-primary btn-sm" onClick=${handleRerun} disabled=${rerunning}>
          ${rerunning ? '...' : (passed > 0 ? t('agents.detail.integration.rerun') : t('agents.detail.integration.startOnboarding'))}
        </button>
      </div>
    </div>
  `;
}

function renderProductionView(agent, onboarding, webhook, bundleVersion, deliveries, handleTestWebhook, testing, handleRerun, rerunning, handleCopyInstall, copiedCmd) {
  const steps = onboarding?.steps || [];
  const agentName = agent.name;

  return html`
    <div>
      <!-- CONNECTION -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('agents.detail.connection')}</div>
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
          <div class="agd-form-actions">
            <button class="btn-outline btn-sm" onClick=${handleTestWebhook} disabled=${testing}>
              ${testing ? '...' : t('profile.agents.webhook.test')}
            </button>
          </div>
        ` : html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-value">${t('agents.detail.deliveryPolling')}</span>
          </div>
        `}
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('agents.detail.lastSeen')}</span>
          <span class="pf-agd-info-value">${agent.last_seen ? timeAgo(agent.last_seen) : '--'}</span>
        </div>
      </div>

      <!-- PLATFORM & SKILL -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('agents.detail.platform')} & ${t('agents.detail.skillBundle')}</div>
        <div class="pf-agd-info-row">
          <span class="pf-agd-info-label">${t('agents.detail.platform')}</span>
          <span class="pf-agd-info-value">${onboarding?.platformName || onboarding?.detectedPlatform || '--'}</span>
        </div>
        ${bundleVersion ? html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('profile.agents.skillBundle.versionLabel')}</span>
            <span class="pf-agd-info-value">${bundleVersion.version || '--'}</span>
          </div>
        ` : ''}
        <div class="agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${handleCopyInstall}>
            ${copiedCmd ? '✓ ' + t('profile.agents.copied') : t('profile.agents.skillBundle.reinstall')}
          </button>
        </div>
      </div>

      <!-- READINESS -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('agents.detail.readiness')}</div>
        <div class="pf-agd-step-pills">
          ${steps.map(s => html`
            <span key=${s.id} class="pf-agd-step-pill pf-agd-step-pill--${s.status}">
              ${s.status === 'passed' ? '✓' : '○'} ${s.name?.split(' ').slice(0, 2).join(' ') || s.id}
            </span>
          `)}
        </div>
        ${onboarding?.readinessScore != null && html`
          <div class="pf-agd-info-row">
            <span class="pf-agd-info-label">${t('agents.detail.readiness')}</span>
            <span class="pf-agd-info-value">${onboarding.readinessLevel} (${onboarding.readinessScore})</span>
          </div>
        `}
        <div class="agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${handleRerun} disabled=${rerunning}>
            ${rerunning ? '...' : t('agents.detail.integration.rerun')}
          </button>
        </div>
      </div>

      <!-- IDENTITY -->
      <div class="pf-agd-section">
        <div class="pf-agd-section-label">${t('agents.detail.identity')}</div>
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
      </div>

      <!-- DELIVERY LOG -->
      ${deliveries.length > 0 && html`
        <div class="pf-agd-section">
          <div class="pf-agd-section-label">${t('agents.detail.deliveryLog')}</div>
          <table class="pf-agd-delivery-log">
            <thead>
              <tr>
                <th>${t('agents.detail.integration.time')}</th>
                <th>${t('agents.detail.integration.event')}</th>
                <th>${t('agents.detail.integration.channel')}</th>
                <th>${t('agents.detail.integration.result')}</th>
              </tr>
            </thead>
            <tbody>
              ${deliveries.map((d, i) => html`
                <tr key=${d.id || i}>
                  <td>${d.timestamp ? timeAgo(d.timestamp) : '--'}</td>
                  <td>${d.eventType || d.event || '--'}</td>
                  <td>${d.channel || '--'}</td>
                  <td>${d.success ? '✓' : '✗'} ${d.latencyMs ? `${d.latencyMs}ms` : ''}</td>
                </tr>
              `)}
            </tbody>
          </table>
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
