/**
 * @file public/views/profile/agents/agent-card-badges.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small state badges an agent card wears: how work reaches it, the platform it
 *   runs on, the model it reports and how far its onboarding got. Pure extraction from
 *   ../agent-card.js (max-file-lines); the bodies are unchanged and their history stays below.
 * @structure deliveryLabel(delivery) · renderPlatformBadge(onboarding) · renderModelBadge(agent) ·
 *   renderOperatorBadge(agent) · OPERATOR_CONTACT · operatorServiceAbout(by) · stepTone(status) ·
 *   renderReadinessBadge(state, onboarding)
 * @usage import { deliveryLabel, renderReadinessBadge } from './agent-card-badges.js';
 * @version-history
 *   v1.7.0 — 2026-11-26 — A required service's tag reads "Required by the operator" with its own explanation
 *     (agent.required_by_operator); the dialog states the private read and the operator's reason.
 *   v1.6.0 — 2026-11-26 — The operator tag's dialog names this service: its name, the operator's own
 *     description, where its permissions are listed and whom to ask (operatorServiceAbout).
 *   v1.5.1 — 2026-11-26 — The operator tag explains itself through the guidance tooltip and dialog
 *     (HelpLabel, explain.agent.set_by_operator) in place of a title, and stays on one line.
 *   v1.5.0 — 2026-11-26 — renderOperatorBadge: "Set by the operator" on an agent an operator service set
 *     up for the person (agents.operator_services), the dim tag the mode badge wears.
 *   v1.4.0 — 2026-09-26 — The badges are the Mark component (components/Mark.js: a tag, or a status
 *     with its tone); stepStatusClass becomes stepTone, the tone rather than a class (page group G1a).
 *   v1.3.0 — 2026-09-26 — renderDeliveryIndicator goes: nothing called it (Jouni: code that nothing uses may be removed).
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
import { HelpLabel } from '/components/HelpTip.js';

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

/**
 * The tag an agent wears when an operator service set it up for the person (GET /v1/agents
 * `set_by_operator`, services/operator-services/marks.ts): who set it, and in its title how to turn
 * it off. Nothing for any other agent.
 */
export function renderOperatorBadge(agent) {
  const by = agent?.set_by_operator;
  if (!by) return null;
  // The guidance tooltip and dialog (HelpLabel, explain.agent.set_by_operator), which a touch also opens;
  // a press on it opens the explanation and not the row. One line at every width: the words are joined
  // with no-break spaces, so no CSS changes for the other chips.
  // A required service reads differently, with an explanation of its own: only the operator turns it off.
  const words = t(by.required ? 'profile.agents.operatorService.markRequired' : 'profile.agents.operatorService.mark');
  const term = by.required ? 'agent.required_by_operator' : 'agent.set_by_operator';
  // This service in the dialog: its name, the operator's own description, the private read and its
  // reason when it has one, where its permissions are listed and whom to ask (OPERATOR_CONTACT).
  const mine = operatorServiceAbout(by);
  // The span keeps a press on the question mark from also opening the agent row it stands in.
  return html`<span onClick=${(e) => e.stopPropagation()}><${Mark} tone="dim"><${HelpLabel} term=${term} label=${words} mine=${mine}>${words.replace(/ /g, ' ')}<//><//></span>`;
}

/** The address that reaches this server's operators, the one the chat notice gives (components/ChatAi.js). */
export const OPERATOR_CONTACT = 'support@operators';

/**
 * One operator service in a person's words: its name, the operator's own description with the notice's
 * lead-in, where its permissions are listed, and whom to ask. The tag's dialog shows it.
 */
export function operatorServiceAbout(by) {
  const sentence = (raw) => { const s = (raw || '').trim(); return s && !/[.!?]$/.test(s) ? `${s}.` : s; };
  const description = sentence(by.description);
  const about = description ? ` ${t('notiftext.operator_service_on.about', { description })}` : '';
  const reason = sentence(by.private_read_reason);
  const reads = by.private_read && reason ? ` ${t('notiftext.operator_service_on.private_read', { reason })}` : '';
  return `${by.display_name}.${about}${reads} ${t('profile.agents.operatorService.dialogMine', { contact: OPERATOR_CONTACT })}`;
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
