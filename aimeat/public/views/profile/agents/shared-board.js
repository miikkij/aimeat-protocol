/**
 * @file shared-board.js
 * @description Shared Agent Board ("radiator") — fleet state at a glance. Mini-cards per agent
 *   (name + status color + ONE essential figure), a status legend that doubles as filter pills,
 *   and issue-first sorting so a problem never drowns among healthy agents. Clicking a card
 *   expands the same agent in the management list below. On hover/focus each mini-card flips to
 *   an "ID card" face (renderIdCard): full GAII with its expansion, issued date, last seen,
 *   task/message tallies, trust + morsels — teaching display-name-vs-GAII at a glance.
 * @version-history
 *   v3.2.0 -- 2026-08-09 -- Buckets and sort order come from the server verdict. The local
 *     BUCKET_OF map had no `system` key, so `|| 'quiet'` filed every internal agent under quiet
 *     on the one surface meant to be read at a glance; there is now an `internal` pill.
 *   v3.1.0 -- 2026-08-08 -- The GAII copy button uses the shared classes and default labels; .pf-agd-idcard-copy and
 *       the profile.agents.idcard.copyGaii/copied keys are gone.
 *   v3.0.0 -- 2026-07-12 -- ID-card treatment: each board mini-card reveals a full agent
 *     identity plate on hover/focus (labelled GAII + Global AI Instance Identifier, issued
 *     date, last seen, tasks done/active/failed, messages, trust, morsels, issuer node,
 *     copy-GAII). Default (non-hover) face unchanged: state-coloured name + one figure.
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
import { CopyButton } from '/components/CopyButton.js';
import { agentState, agentBucket, agentRank, getStateColor } from './state-detector.js';

const html = htm.bind(h);

// The buckets and their order come from the server (services/agent-health.ts) with the agent. The
// local BUCKET_OF map had no `system` key, so `BUCKET_OF[state] || 'quiet'` filed every internal
// agent under "quiet" — on the one surface that exists to be read at a glance.
const BUCKETS = [
  { id: 'online', color: 'var(--success)', key: 'profile.agents.board.online' },
  { id: 'quiet', color: 'var(--text-muted)', key: 'profile.agents.board.quiet' },
  { id: 'onboarding', color: 'var(--warning)', key: 'profile.agents.board.onboarding' },
  { id: 'issue', color: 'var(--danger)', key: 'profile.agents.board.issue' },
  { id: 'internal', color: 'var(--text-muted)', key: 'profile.agents.board.internal' },
];

export default function SharedBoard({ agents, onboardings, onAgentClick }) {
  const [bucketFilter, setBucketFilter] = useState(null);

  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const agentStates = useMemo(() => {
    const rows = (agents || []).map(agent => ({
      agent,
      state: agentState(agent),
      bucket: agentBucket(agent),
      onboarding: onboardings?.[agent.name],
    }));
    // Problems first, onboarding second, then the rest — an issue must not drown.
    rows.sort((a, b) => agentRank(a.agent) - agentRank(b.agent));
    return rows;
  }, [agents, onboardings]);

  const counts = useMemo(() => {
    const c = { online: 0, quiet: 0, onboarding: 0, issue: 0, internal: 0 };
    for (const r of agentStates) c[r.bucket] = (c[r.bucket] ?? 0) + 1;
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

  if (!agents || agents.length === 0) return null;

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
        ${shown.map(({ agent, state, onboarding }) => {
          const color = getStateColor(state);
          return html`
            <div
              key=${agent.name}
              class="pf-agd-board-card"
              style="border-left-color: ${color}; --agd-state: ${color}"
              tabindex="0"
              role="button"
              onClick=${() => onAgentClick?.(agent.name)}
              onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAgentClick?.(agent.name); } }}
            >
              <div class="pf-agd-board-card-face">
                <div class="pf-agd-board-card-name" style="color: ${color}">${agent.display_name || agent.name}</div>
                <div class="pf-agd-board-card-activity">
                  ${glanceFigure(state, agent, onboarding)}
                </div>
              </div>
              ${renderIdCard(agent)}
            </div>
          `;
        })}
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

// Absolute "issued" date for the ID card (browser locale, day-precision).
function formatIssued(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── ID-card face (revealed on hover/focus of a board mini-card) ──
// The radiator's mini-card answers "how is the fleet doing" at a glance; the ID
// card answers "who exactly is this agent" on demand. It surfaces the full GAII
// (with its expansion, so the owner learns display-name-vs-GAII) plus the
// tombstone facts an identity card carries: when it was issued, when it was last
// seen, and its work/trust footprint. All data comes from the fleet payload the
// board already holds (agent.stats via ?include=stats) — no extra requests.
function renderIdCard(agent) {
  const gaii = agent.gaii || `${agent.name}@${agent.owner || ''}`;
  const nodeId = gaii.includes('@') ? gaii.split('@').pop() : '';
  const st = agent.stats || {};
  const tasks = st.tasks || {};
  const messages = st.messages || {};
  const done = tasks.done || 0;
  const active = tasks.active || 0;
  const failed = tasks.failed || 0;
  const msgTotal = messages.total || 0;
  const trust = agent.trust_score ?? '—';
  const morsels = agent.morsel_balance ?? 0;
  const mode = agent.mode || 'interactive';

  const stat = (label, value, cls = '') => html`
    <div class="pf-agd-idcard-stat ${cls}">
      <span class="pf-agd-idcard-stat-label">${label}</span>
      <span class="pf-agd-idcard-stat-value">${value}</span>
    </div>`;

  return html`
    <div class="pf-agd-idcard" aria-hidden="true">
      <div class="pf-agd-idcard-top">
        <span class="pf-agd-idcard-eyebrow">
          <span class="pf-agd-idcard-dot"></span>${t('profile.agents.idcard.eyebrow')}
        </span>
        <span class="pf-agd-badge pf-agd-badge--mode pf-agd-badge--mode-${mode}">${t('profile.agents.mode.' + mode) || mode}</span>
      </div>

      <div class="pf-agd-idcard-head">
        <span class="pf-agd-idcard-avatar">🤖</span>
        <div class="pf-agd-idcard-names">
          <span class="pf-agd-idcard-name">${agent.display_name || agent.name}</span>
          <span class="pf-agd-idcard-hint">${t('profile.agents.idcard.displayNameHint')}</span>
        </div>
      </div>

      <div class="pf-agd-idcard-gaii">
        <div class="pf-agd-idcard-gaii-head">
          <span class="pf-agd-idcard-gaii-label">
            <strong>${t('profile.agents.idcard.gaiiLabel')}</strong> · ${t('profile.agents.idcard.gaiiFull')}
          </span>
          <span onClick=${(e) => e.stopPropagation()}>
            <${CopyButton} text=${gaii} className="btn-ghost btn-sm btn-copy-inline" />
          </span>
        </div>
        <code class="pf-agd-idcard-gaii-value">${gaii}</code>
      </div>

      <div class="pf-agd-idcard-stats">
        ${stat(t('profile.agents.idcard.issued'), formatIssued(agent.created_at))}
        ${stat(t('profile.agents.idcard.lastSeen'), agent.last_seen ? formatTimeAgo(agent.last_seen) : t('profile.agents.idcard.never'))}
        ${stat(t('profile.agents.idcard.done'), done)}
        ${stat(t('profile.agents.idcard.active'), active, active > 0 ? 'pf-agd-idcard-stat--active' : '')}
        ${stat(t('profile.agents.idcard.failed'), failed, failed > 0 ? 'pf-agd-idcard-stat--failed' : '')}
        ${stat(t('profile.agents.idcard.messages'), msgTotal)}
        ${stat(t('profile.agents.idcard.trust'), trust)}
        ${stat(t('profile.agents.idcard.morsels'), typeof morsels === 'number' ? morsels.toLocaleString() : morsels)}
      </div>

      <div class="pf-agd-idcard-foot">
        <span class="pf-agd-idcard-issuer">${t('profile.agents.idcard.issuer')}: ${nodeId || '—'}</span>
        <span class="pf-agd-idcard-manage">${t('profile.agents.idcard.manageHint')} →</span>
      </div>
    </div>
  `;
}
