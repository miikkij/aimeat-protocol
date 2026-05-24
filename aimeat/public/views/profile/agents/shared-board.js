/**
 * @file shared-board.js
 * @description Shared Agent Board component. Shows fleet-wide overview grid
 *   above agent cards with mini-cards per agent and shared tag summary.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { detectAgentState, getStateColor } from './state-detector.js';

const html = htm.bind(h);

export default function SharedBoard({ agents, onboardings, onAgentClick }) {
  if (!agents || agents.length === 0) return null;

  const agentStates = useMemo(() => {
    return agents.map(agent => ({
      agent,
      state: detectAgentState(agent, onboardings?.[agent.name]),
      onboarding: onboardings?.[agent.name],
    }));
  }, [agents, onboardings]);

  const allTags = useMemo(() => {
    const tagCounts = {};
    for (const { agent } of agentStates) {
      for (const tag of agent.tags ?? []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    return tagCounts;
  }, [agentStates]);

  return html`
    <div class="pf-agd-board">
      <div class="pf-agd-board-grid">
        ${agentStates.map(({ agent, state, onboarding }) => html`
          <div
            key=${agent.name}
            class="pf-agd-board-card"
            style="border-left-color: ${getStateColor(state)}"
            onClick=${() => onAgentClick?.(agent.name)}
          >
            <div class="pf-agd-board-card-name">${agent.display_name || agent.name}</div>
            <div class="pf-agd-board-card-activity">
              ${renderActivitySummary(state, agent, onboarding)}
            </div>
            <div class="pf-agd-board-card-tags">
              ${(agent.tags ?? []).length > 0
                ? (agent.tags ?? []).join(', ')
                : '--'}
            </div>
          </div>
        `)}
      </div>
      ${Object.keys(allTags).length > 0 && html`
        <div class="pf-agd-board-tags">
          ${t('agents.detail.sharedTags')}: ${Object.entries(allTags).map(([tag, count]) =>
            html`<span class="pf-agd-tag-pill" key=${tag}>[${tag}] (${count})</span> `
          )}
        </div>
      `}
    </div>
  `;
}

function renderActivitySummary(state, agent, onboarding) {
  switch (state) {
    case 'new':
      return t('agents.detail.state.newSummary');
    case 'onboarding': {
      const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
      const total = onboarding?.steps?.length ?? 11;
      return `${t('agents.detail.state.onboarding')}: ${passed}/${total}`;
    }
    case 'problem':
      return t('agents.detail.state.problemSummary');
    case 'production':
    default:
      return agent.last_seen
        ? `${t('agents.detail.lastSeen')}: ${formatTimeAgo(agent.last_seen)}`
        : t('agents.detail.state.idle');
  }
}

function formatTimeAgo(isoDate) {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
