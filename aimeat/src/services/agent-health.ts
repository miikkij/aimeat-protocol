/**
 * @file src/services/agent-health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE account-level answer to "is this agent OK". Every surface that shows a
 *   per-agent verdict — the Agents tab, the fleet board, the home — renders this and computes
 *   nothing of its own.
 *
 *   It exists because four places were answering the same question with four different thresholds
 *   and the home was not answering it at all: the home card read "Connected and at home" off
 *   `agents.length` while the Agents tab said "problem" about the same agent, and both were shown
 *   to the same person one click apart.
 *
 *   The frontend's copy of the rules had rotted in a way that could not be seen from the frontend.
 *   Two of its three problem conditions could never fire — `webhookFailCount` was not in the
 *   /v1/agents response at all, and `previousReadinessLevel` is not a field on any record — so
 *   "problem" only ever meant "not seen in 24 h", and a genuinely broken push channel showed as
 *   healthy. Moving the rules here is what makes them checkable.
 *
 *   Purpose-specific windows deliberately stay where they are: workflow reachability
 *   (services/workflow/engine-reachability.ts) asks "can I dispatch this step right now", presence
 *   asks "is there a live socket", trust decay is longitudinal. Those are different questions.
 *   This module answers the account-level one, once.
 * @structure AGENT_ONLINE_WINDOW_MS · AGENT_STALE_MS · AGENT_WEBHOOK_DOWN_THRESHOLD ·
 *   BUCKET_RANK · computeAgentHealth · computeAgentHealthMany
 * @usage
 *   import { computeAgentHealthMany } from '../services/agent-health.js';
 *   const health = computeAgentHealthMany(agents, onboardingByGaii);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (V1: one status vocabulary, both surfaces project it).
 */
import type { AgentRecord } from '../storage/types/identity.js';
import type { AgentOnboardingRecord } from '../storage/types/agents-messaging.js';

/**
 * `lastSeen` within this ⇒ reachable now.
 *
 * Adopted from services/workflow/engine-reachability.ts rather than invented: it is already the
 * window used by the workflow engine, the onboarding validator, offers and the public stats. It is
 * also the only safe choice — the lastSeen write is throttled to 5 minutes (auth/middleware.ts) and
 * the check-in buffer flushes every 60 s, so a 5-minute window equals the write throttle and a busy
 * agent oscillates across it. 10 minutes is twice the throttle plus the flush lag.
 */
export const AGENT_ONLINE_WINDOW_MS = 10 * 60_000;

/**
 * No `lastSeen` for this long ⇒ not alive. The same 24 h line the node's public "active agents"
 * count already draws, so the headline number and the per-agent verdict cannot disagree.
 */
export const AGENT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Consecutive delivery failures ⇒ the push channel is down. The server's existing threshold; the
 * frontend's dead copy said 5, which never fired and disagreed with this one anyway.
 */
export const AGENT_WEBHOOK_DOWN_THRESHOLD = 10;

export type AgentHealthState = 'system' | 'new' | 'onboarding' | 'problem' | 'idle' | 'production';
export type AgentHealthBucket = 'issue' | 'onboarding' | 'online' | 'quiet' | 'internal';
export type AgentHealthReason = 'onboarding-failed' | 'never-seen' | 'stale-24h' | 'webhook-down';
export type AgentDeliveryChannel = 'webhook' | 'webhook-failing' | 'polling' | 'none';

/** Sort order for a fleet view: an issue must never drown in a long list. */
export const BUCKET_RANK: Record<AgentHealthBucket, number> =
    { issue: 0, onboarding: 1, online: 2, quiet: 3, internal: 4 };

const BUCKET_OF: Record<AgentHealthState, AgentHealthBucket> = {
    problem: 'issue',
    new: 'onboarding',
    onboarding: 'onboarding',
    production: 'online',
    idle: 'quiet',
    system: 'internal',
};

export interface AgentHealth {
    state: AgentHealthState;
    bucket: AgentHealthBucket;
    rank: number;
    /** Empty unless state === 'problem'. Ordered most-actionable first; drives the red panel's text. */
    reasons: AgentHealthReason[];
    last_seen: string | null;
    /** Null when never seen. Lets a client say "3h ago" without re-deriving staleness. */
    seconds_since_seen: number | null;
    delivery: {
        channel: AgentDeliveryChannel;
        webhook_configured: boolean;
        webhook_enabled: boolean;
        fail_count: number;
        last_success_at: string | null;
        last_failure_at: string | null;
    };
    onboarding: {
        status: AgentOnboardingRecord['status'];
        readiness_level: AgentOnboardingRecord['readinessLevel'] | null;
    } | null;
}

type HealthAgent = Pick<AgentRecord,
    'lastSeen' | 'tags' | 'webhookUrl' | 'webhookEnabled' | 'webhookFailCount'
    | 'webhookLastSuccess' | 'webhookLastFailure'>;

/**
 * An agent the OWNER marked as node machinery (`system`, or `system:secretary` and the like).
 * Matches the bare tag as well as the prefixed form, because both exist in real data and the
 * prefix-only test the frontend used made this branch unreachable for the bare one.
 */
function isSystemAgent(tags: string[] | undefined): boolean {
    return (tags ?? []).some(t => typeof t === 'string' && (t === 'system' || t.startsWith('system:')));
}

function msSince(iso: string | undefined, nowMs: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? nowMs - t : null;
}

/**
 * The account-level verdict for one agent.
 *
 * Order matters: the first match wins, and the ordering is what makes the answer actionable rather
 * than merely true. An agent still onboarding is not "idle"; a broken one is not "quiet".
 */
export function computeAgentHealth(
    agent: HealthAgent,
    onboarding: AgentOnboardingRecord | null,
    nowMs: number = Date.now(),
): AgentHealth {
    const failCount = agent.webhookFailCount ?? 0;
    const webhookConfigured = !!agent.webhookUrl;
    const webhookEnabled = !!(agent.webhookEnabled && agent.webhookUrl);
    const webhookHealthy = webhookEnabled && failCount < AGENT_WEBHOOK_DOWN_THRESHOLD;

    const sinceMs = msSince(agent.lastSeen, nowMs);
    const neverSeen = sinceMs === null;
    const stale = neverSeen || sinceMs > AGENT_STALE_MS;
    const seenRecently = sinceMs !== null && sinceMs <= AGENT_ONLINE_WINDOW_MS;

    const channel: AgentDeliveryChannel = webhookEnabled
        ? (webhookHealthy ? 'webhook' : 'webhook-failing')
        : (agent.lastSeen ? 'polling' : 'none');

    const delivery = {
        channel,
        webhook_configured: webhookConfigured,
        webhook_enabled: webhookEnabled,
        fail_count: failCount,
        last_success_at: agent.webhookLastSuccess ?? null,
        last_failure_at: agent.webhookLastFailure ?? null,
    };
    const onboardingOut = onboarding
        ? { status: onboarding.status, readiness_level: onboarding.readinessLevel ?? null }
        : null;

    const base = {
        reasons: [] as AgentHealthReason[],
        last_seen: agent.lastSeen ?? null,
        seconds_since_seen: sinceMs === null ? null : Math.max(0, Math.round(sinceMs / 1000)),
        delivery,
        onboarding: onboardingOut,
    };
    const verdict = (state: AgentHealthState, reasons: AgentHealthReason[] = []): AgentHealth =>
        ({ ...base, state, bucket: BUCKET_OF[state], rank: BUCKET_RANK[BUCKET_OF[state]], reasons });

    if (isSystemAgent(agent.tags)) return verdict('system');
    if (!onboarding || onboarding.status === 'pending') return verdict('new');
    if (onboarding.status === 'in_progress') return verdict('onboarding');

    // Onboarding is behind it, so the agent is expected to be working. Everything below is about
    // whether it actually is.
    const reasons: AgentHealthReason[] = [];
    if (onboarding.status === 'failed') reasons.push('onboarding-failed');
    if (neverSeen) reasons.push('never-seen');
    else if (stale) reasons.push('stale-24h');
    // Reported even when it is not the deciding fault: a failing push channel is worth showing
    // next to an otherwise-alive agent, since the owner is the only one who can fix the endpoint.
    if (webhookEnabled && failCount >= AGENT_WEBHOOK_DOWN_THRESHOLD) reasons.push('webhook-down');
    if (reasons.length > 0) return verdict('problem', reasons);

    // A push agent that never polls is still working. The frontend never knew this, so an agent
    // delivered to by webhook read as idle forever. Staleness above is unconditional, though: a
    // configured webhook with no traffic keeps failCount at 0, so it cannot prove liveness.
    if (seenRecently || webhookHealthy) return verdict('production');
    return verdict('idle');
}

/**
 * Is an agent in this state one the account can actually count on?
 *
 * `problem` is not, and neither is a state that no longer exists. The home's "your home is ready"
 * used to be satisfied by an agent RECORD, so an account whose every agent was dead still read as
 * ready — a home is not ready on the strength of a row.
 */
export function isLiveState(state: AgentHealthState): boolean {
    return state === 'production' || state === 'idle' || state === 'onboarding' || state === 'new';
}

/**
 * The same verdict for a whole fleet, with ONE `nowMs` for the page — two cards in one response
 * must not straddle a threshold boundary and disagree about what time it is.
 */
export function computeAgentHealthMany(
    agents: Array<HealthAgent & { gaii: string }>,
    onboardingByGaii: Record<string, AgentOnboardingRecord | null>,
    nowMs: number = Date.now(),
): Record<string, AgentHealth> {
    const out: Record<string, AgentHealth> = {};
    for (const a of agents) out[a.gaii] = computeAgentHealth(a, onboardingByGaii[a.gaii] ?? null, nowMs);
    return out;
}
