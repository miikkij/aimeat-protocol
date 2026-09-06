/**
 * @file public/views/profile/agents/agent-card-badges.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small state badges an agent card wears: how work reaches it, the platform it
 *   runs on, the model it reports and how far its onboarding got. Pure extraction from
 *   ../agent-card.js (max-file-lines); the bodies are unchanged and their history stays below.
 * @structure deliveryLabel(delivery) · renderDeliveryIndicator(agent) ·
 *   renderPlatformBadge(onboarding) · renderModelBadge(agent) · renderReadinessBadge(state, onboarding)
 * @usage import { renderDeliveryIndicator, renderReadinessBadge } from './agent-card-badges.js';
 * @version-history
 *   v1.0.0 — 2026-09-06 — Extracted from agent-card.js, which reached 801 lines when the GAII
 *     control landed on the row. Carried over from that file's history: the delivery word reads the
 *     server's channel (2026-09-06), the model badge (2026-07), and the 2026-08-09 round that
 *     removed the readiness comparisons reading fields no record has.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);

/**
 * The word for how work reaches this agent, from the server's own channel verdict
 * (services/agent-health.ts). `socket` is a daemon holding this agent's connection open, which is
 * how an agent that starts a runtime per job is reached; saying "polling" about it named something
 * that never happens.
 */
export function deliveryLabel(delivery) {
  if (delivery.webhook_configured) return t('profile.agents.detail.deliveryWh');
  if (delivery.channel === 'socket') return t('profile.agents.detail.deliverySocket');
  return t('profile.agents.detail.deliveryPolling');
}

/**
 * How this agent is reached, from the server's verdict.
 *
 * Was computed here from `agent.webhookUrl` (not in the response), `agent.mcpEnabled` (not a field
 * on any record) and a fail threshold of 5 that disagreed with the server's 10. So the warning icon
 * could never appear, and the MCP labels could never be chosen. The MCP branch is gone rather than
 * rewired: there is nothing to rewire it to.
 */
export function renderDeliveryIndicator(agent) {
  const delivery = agent?.health?.delivery;
  if (!delivery) return null;
  const label = deliveryLabel(delivery);
  const icon = delivery.webhook_configured ? (delivery.channel === 'webhook-failing' ? '⚠' : '✓') : '';

  return html`<span class="pf-agd-delivery-indicator">${label}${icon ? ` ${icon}` : ''} · </span>`;
}

export function renderPlatformBadge(onboarding) {
  const platform = onboarding?.platformName || onboarding?.detectedPlatform;
  if (!platform) return null;
  const version = onboarding?.platformVersion;
  return html`<span class="pf-agd-badge pf-agd-badge--platform">${platform}${version ? ` v${version}` : ''}</span>`;
}

// Self-reported primary LLM (indicative — coding platforms delegate to subagents on other
// models mid-session). Comes from the owner agent list projection (agent.model).
export function renderModelBadge(agent) {
  if (!agent?.model) return null;
  return html`<span class="pf-agd-badge pf-agd-badge--model" title=${t('profile.agents.modelBadgeTitle')}>${agent.model}</span>`;
}

export function renderReadinessBadge(state, onboarding) {
  if (state === 'system') {
    // Internal (auto-provisioned) agent — no device-auth onboarding / readiness.
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">${t('profile.agents.detail.state.internal')}</span>`;
  }
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
    // No "degraded ↓" marker: it was driven by onboarding.previousReadinessLevel, which is not a
    // field on the record, has no column in either backend and is written nowhere — so the arrow
    // could never appear. Reintroducing it needs a stored previous level first, not a rank table.
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level}">${label} (${score})</span>`;
  }
  // idle and production both show level + score
  const level = onboarding?.readinessLevel || 'none';
  const score = onboarding?.readinessScore;
  if (!score && score !== 0) return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  const label = t(`agentOnboarding.readiness.${level}`);
  return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level}"
    title=${t('profile.agents.detail.readinessTooltip') || 'Readiness score 0–100 from onboarding checks. Levels: none → basic → standard → advanced → full.'}>${label} (${score})</span>`;
}
