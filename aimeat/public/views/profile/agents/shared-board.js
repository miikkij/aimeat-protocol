/**
 * @file shared-board.js
 * @description Shared Agent Board ("radiator") — fleet state at a glance. Mini-cards per agent
 *   (name + status color + ONE essential figure), a status legend that doubles as filter pills,
 *   and issue-first sorting so a problem never drowns among healthy agents. Clicking a card
 *   expands the same agent in the management list below.
 * @version-history
 *   v2.0.0 -- 2026-06-10 -- Glance optimization round: status legend = clickable filter pills
 *     (online/quiet/onboarding/issue) with counts; sort issues first, then onboarding, then the
 *     rest; cards slimmed to name + one figure (no "--" filler rows, tags line dropped — tags
 *     live in the list's filter bar and the shared-tags summary).
 *   v1.1.0 -- 2026-05-24 -- Fix: board card name colored by state, fix locale prefix
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { detectAgentState, getStateColor } from './state-detector.js';

const html = htm.bind(h);

// Detailed states collapse into four glanceable buckets for the legend/filter.
const BUCKET_OF = { production: 'online', idle: 'quiet', new: 'onboarding', onboarding: 'onboarding', problem: 'issue' };
const BUCKET_RANK = { issue: 0, onboarding: 1, online: 2, quiet: 3 };
const BUCKETS = [
  { id: 'online', color: 'var(--success)', key: 'profile.agents.board.online' },
  { id: 'quiet', color: 'var(--text-muted)', key: 'profile.agents.board.quiet' },
  { id: 'onboarding', color: 'var(--warning)', key: 'profile.agents.board.onboarding' },
  { id: 'issue', color: 'var(--danger)', key: 'profile.agents.board.issue' },
];

export default function SharedBoard({ agents, onboardings, onAgentClick }) {
  const [bucketFilter, setBucketFilter] = useState(null);
  if (!agents || agents.length === 0) return null;

  const agentStates = useMemo(() => {
    const rows = agents.map(agent => {
      const state = detectAgentState(agent, onboardings?.[agent.name]);
      return { agent, state, bucket: BUCKET_OF[state] || 'quiet', onboarding: onboardings?.[agent.name] };
    });
    // Problems first, onboarding second, then the rest — an issue must not drown.
    rows.sort((a, b) => (BUCKET_RANK[a.bucket] ?? 9) - (BUCKET_RANK[b.bucket] ?? 9));
    return rows;
  }, [agents, onboardings]);

  const counts = useMemo(() => {
    const c = { online: 0, quiet: 0, onboarding: 0, issue: 0 };
    for (const r of agentStates) c[r.bucket]++;
    return c;
  }, [agentStates]);

  const shown = bucketFilter ? agentStates.filter(r => r.bucket === bucketFilter) : agentStates;

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
      <div class="pf-agd-board-legend">
        ${BUCKETS.map(b => html`
          <button key=${b.id}
            class="pf-agd-legend-pill ${bucketFilter === b.id ? 'pf-agd-legend-pill--active' : ''}"
            disabled=${counts[b.id] === 0 && bucketFilter !== b.id}
            onClick=${() => setBucketFilter(f => (f === b.id ? null : b.id))}>
            <span class="pf-agd-legend-dot" style="background: ${b.color}"></span>
            ${t(b.key)} <span class="pf-agd-legend-count">${counts[b.id]}</span>
          </button>
        `)}
      </div>
      <div class="pf-agd-board-grid">
        ${shown.map(({ agent, state, onboarding }) => html`
          <div
            key=${agent.name}
            class="pf-agd-board-card"
            style="border-left-color: ${getStateColor(state)}"
            onClick=${() => onAgentClick?.(agent.name)}
          >
            <div class="pf-agd-board-card-name" style="color: ${getStateColor(state)}">${agent.display_name || agent.name}</div>
            <div class="pf-agd-board-card-activity">
              ${glanceFigure(state, agent, onboarding)}
            </div>
          </div>
        `)}
      </div>
      ${Object.keys(allTags).length > 0 && html`
        <div class="pf-agd-board-tags">
          ${t('profile.agents.detail.sharedTags')}: ${Object.entries(allTags).map(([tag, count]) =>
            html`<span class="pf-agd-tag-pill" key=${tag}>[${tag}] (${count})</span> `
          )}
        </div>
      `}
    </div>
  `;
}

// ONE essential figure per card — the radiator's job is fleet state at a glance,
// not prose. Onboarding → progress, problem → short word, otherwise last-seen age.
function glanceFigure(state, agent, onboarding) {
  switch (state) {
    case 'new':
      return t('profile.agents.board.newShort');
    case 'onboarding': {
      const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
      const total = onboarding?.steps?.length ?? 11;
      return `${passed}/${total}`;
    }
    case 'problem':
      return t('profile.agents.board.issueShort');
    case 'production':
    case 'idle':
    default:
      return agent.last_seen ? formatTimeAgo(agent.last_seen) : t('profile.agents.detail.state.idle');
  }
}

function formatTimeAgo(isoDate) {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
