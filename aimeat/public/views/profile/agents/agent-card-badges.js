/**
 * @file public/views/profile/agents/agent-card-badges.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small state badges an agent card wears: how work reaches it, the platform it
 *   runs on, the model it reports and how far its onboarding got. Pure extraction from
 *   ../agent-card.js (max-file-lines); the bodies are unchanged and their history stays below.
 * @structure deliveryLabel(delivery) · renderPlatformBadge(onboarding) · renderModelBadge(agent) ·
 *   stepTone(status) · renderReadinessBadge(state, onboarding)
 * @usage import { deliveryLabel, renderReadinessBadge } from './agent-card-badges.js';
 * @version-history
 *   v1.4.0 — 2026-09-26 — The badges are the Mark component (components/Mark.js: a tag, or a status
 *     with its tone); stepStatusClass becomes stepTone, the tone rather than a class (page group G1a).
 *   v1.3.0 — 2026-09-26 — renderDeliveryIndicator goes: nothing called it (Jouni: "saat poistaa jos ne on oikeasti käyttämättömiä").
 *   v1.2.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.1.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.0.0 — 2026-09-06 — Extracted from agent-card.js, which reached 801 lines when the GAII
 *     control landed on the row. Carried over from that file's history: the delivery word reads the
 *     server's channel (2026-09-06), the model badge (2026-07), and the 2026-08-09 round that
 *     removed the readiness comparisons reading fields no record has.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Mark } from '/components/Mark.js';

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

export function renderPlatformBadge(onboarding) {
  const platform = onboarding?.platformName || onboarding?.detectedPlatform;
  if (!platform) return null;
  const version = onboarding?.platformVersion;
  return html`<${Mark}>${platform}${version ? ` v${version}` : ''}<//>`;
}

// Self-reported primary LLM (indicative — coding platforms delegate to subagents on other
// models mid-session). Comes from the owner agent list projection (agent.model).
export function renderModelBadge(agent) {
  if (!agent?.model) return null;
  return html`<${Mark} title=${t('profile.agents.modelBadgeTitle')}>${agent.model}<//>`;
}

/** The Status tone an onboarding step wears: passed is fine, failed is danger, a warning needs a look,
 *  a step not reached yet is off. */
export function stepTone(status) {
  if (status === 'passed') return 'fine';
  if (status === 'failed') return 'danger';
  if (status === 'warn') return 'attention';
  return 'off';
}

/** The Status tone a readiness level wears: a ready agent is fine, a basic one needs a look, none is off. */
const readinessTone = (level) => (['expert', 'full', 'advanced', 'standard'].includes(level) ? 'fine' : level === 'basic' ? 'attention' : 'off');

const status = (tone, words, title) => html`<${Mark} kind="status" tone=${tone} title=${title}>${words}<//>`;

export function renderReadinessBadge(state, onboarding) {
  if (state === 'system') {
    // Internal (auto-provisioned) agent — no device-auth onboarding / readiness.
    return status('off', t('profile.agents.detail.state.internal'));
  }
  if (state === 'new') {
    return status('off', '--');
  }
  if (state === 'onboarding') {
    const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
    const total = onboarding?.steps?.length ?? 11;
    return status('attention', `${t('profile.agents.detail.state.onboarding')}: ${passed}/${total}`);
  }
  if (state === 'problem') {
    const level = onboarding?.readinessLevel || 'none';
    const score = onboarding?.readinessScore;
    if (!score && score !== 0) return status('off', '--');
    const label = t(`agentOnboarding.readiness.${level}`);
    // No "degraded ↓" marker: it was driven by onboarding.previousReadinessLevel, which is not a
    // field on the record, has no column in either backend and is written nowhere — so the arrow
    // could never appear. Reintroducing it needs a stored previous level first, not a rank table.
    return status(readinessTone(level), `${label} (${score})`);
  }
  // idle and production both show level + score
  const level = onboarding?.readinessLevel || 'none';
  const score = onboarding?.readinessScore;
  if (!score && score !== 0) return status('off', '--');
  const label = t(`agentOnboarding.readiness.${level}`);
  return status(readinessTone(level), `${label} (${score})`,
    t('profile.agents.detail.readinessTooltip') || 'Readiness score 0–100 from onboarding checks. Levels: none → basic → standard → advanced → full.');
}
