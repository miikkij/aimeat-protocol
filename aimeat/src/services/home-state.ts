/**
 * @file src/services/home-state.ts
 * @description Where an account stands on the new path (aimeat_remake/06-koti-feed-suostumus.md).
 *   One computed answer, read by every remake surface — the home view, the welcome-mat endpoint,
 *   the feed and the funnel — so none of them can disagree about whether a home exists.
 *
 *   "Initialized" is DERIVED, never a flag someone sets. Three things must be true at once: the
 *   welcome mat exists, a first agent is connected, and the Hello MCP proof key has been written
 *   through that connection. A stored boolean would let a home be initialized by a bug, and the
 *   whole point of the gate is that it cannot be talked past — an account either has these three
 *   or it does not.
 *
 *   The `onboarding.home_initialized` marker is written the first time the derived state comes out
 *   true. It is a funnel timestamp, not the source of truth: deleting it would change the numbers
 *   and not the person's home.
 * @structure
 *   - readHomeState(storage, config, owner) → HomeState
 *   - HOME_STEPS: the three named steps, in order
 * @usage
 *   import { readHomeState } from '../services/home-state.js';
 *   const state = await readHomeState(storage, config, req.auth!.owner);
 * @version-history
 *   v1.1.0 — 2026-08-09 — The agent card carries the SAME health verdict the Agents tab shows
 *     (services/agent-health.ts), plus how many agents there are and how many are in trouble.
 *     It carried none: the card was derived from agents.length, so the home said "connected and
 *     at home" about an agent the Agents tab was calling a problem. It also showed agents[0] of
 *     an unordered list; the shown agent is now the WORST one, and the list is ordered by both
 *     providers. `initialized` requires a LIVE agent — an account whose every agent was dead
 *     still read "your home is ready".
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 2–3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { HELLO_MCP_KEY } from './hello-mcp.js';
import {
    ONBOARDING_KEYS, recordOnboardingEvent, type OnboardingTrack, type OnboardingBranch,
    type OnboardingRoom,
} from './onboarding-funnel.js';
import { resolveAiClient, decideBranch } from './ai-tool-setup.js';
import { portfolioReadGaiis, PORTFOLIO_HTML_KEY, portfolioStandaloneUrl } from '../routes/portfolio.js';
import { logger } from '../utils/logger.js';
import { computeAgentHealthMany, isLiveState, type AgentHealth } from './agent-health.js';
import type { AgentOnboardingRecord } from '../storage/types/agents-messaging.js';
import { loadOwnerAgents } from './db/owner-identity.js';
import { runInReadScope } from '../storage/read-scope/read-scope.js';

/**
 * The steps, in the order a person meets them. `better-app` exists only on branch B and is what
 * pushes the agent connection to step 3 there; on branch A there are two steps, not three. Named
 * here so no surface invents a fourth.
 */
export const HOME_STEPS = ['welcome-mat', 'better-app', 'first-agent'] as const;
export type HomeStep = typeof HOME_STEPS[number];

export interface HomeState {
    owner: string;
    ghii: string;
    displayName: string | null;
    track: OnboardingTrack;
    switched: number;
    /** The step the person is ON. `null` once the home is initialized. */
    step: HomeStep | null;
    mat: {
        done: boolean;
        /** How many pastes it took. Grades the prompt, never the person. */
        attempts: number;
        result: 'ok' | 'failed' | null;
        /** Where the mat can be looked at, once there is one. */
        url: string | null;
        standaloneUrl: string | null;
    };
    /** What the mat said about the AI that wrote it, or what the person answered. */
    ai: {
        model: string | null;
        vendor: string | null;
        client: string | null;
        /** The /v1/ai-tools id the claim resolved to, or null when nothing matched. */
        resolvedClient: string | null;
        mcp: 'yes' | 'no' | 'unknown' | null;
        source: 'meta' | 'asked' | null;
    } | null;
    /** How the account ARRIVED — the funnel's value, write-once, historical. */
    branch: OnboardingBranch | null;
    /**
     * Whether the person is STILL waiting on an app that can connect. Recomputed from what is
     * currently known about their AI, never stored: `branch` is write-once and stays 'B' forever
     * once they arrive that way, so reading it as "are they stuck?" would trap someone on the
     * branch-B screen for good the moment they fixed the very thing it asked for.
     */
    needsBetterApp: boolean;
    /**
     * The agent the card shows, plus how many there are and how many are in trouble.
     *
     * `health` is the SAME verdict the Agents tab renders (services/agent-health.ts). The card used
     * to carry no status at all — it was derived from `agents.length`, so the home said "connected
     * and at home" about an agent the Agents tab was calling a problem, one click away.
     */
    agent: {
        name: string;
        gaii: string;
        connectedAt: string | null;
        health: AgentHealth;
        /** How many agents the owner has, so one card cannot imply there is only one. */
        total: number;
        /** How many are in the `issue` bucket. A number the card can say out loud. */
        problems: number;
    } | null;
    /** Whether an agent has written the proof key through its own MCP connection. */
    helloMcp: boolean;
    /** mat ∧ agent ∧ helloMcp. Derived every time; never trusted from storage. */
    initialized: boolean;
    /** The FIRST room entered, once one has been. */
    room: OnboardingRoom | null;
}

const val = (rec: { value?: unknown } | null): Record<string, unknown> =>
    (rec && rec.value && typeof rec.value === 'object' ? rec.value as Record<string, unknown> : {});
const str = (o: Record<string, unknown>, k: string): string | null =>
    (typeof o[k] === 'string' && o[k] ? o[k] as string : null);

/**
 * Read the whole state in one pass.
 *
 * Deliberately reads rather than caches: this runs on a page load and a paste, not in a loop, and
 * a cached onboarding state that lags behind the agent the person just approved is the exact
 * "nothing happened" moment the remake exists to remove.
 */
export async function readHomeState(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<HomeState> {
    return runInReadScope(() => readHomeStateInScope(storage, config, owner));
}

/** The body. Split out so the read scope above wraps the WHOLE composite: the agent list is read
 *  once here and reused by anything else composed into the same request. */
async function readHomeStateInScope(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<HomeState> {
    const ghii = `${owner}@${config.nodeId}`;
    const [ghiiRecord, agents, markers] = await Promise.all([
        storage.getGHIIByOwner(owner),
        loadOwnerAgents(storage, owner),
        storage.listMemoryForOwners([ghii], { prefix: 'onboarding.' }),
    ]);

    const byKey = new Map<string, Record<string, unknown>>();
    for (const m of markers) {
        byKey.set(m.key, (m.value && typeof m.value === 'object' ? m.value : {}) as Record<string, unknown>);
    }
    const get = (key: string) => byKey.get(key) ?? {};

    const track = get(ONBOARDING_KEYS.track);
    const matMark = get(ONBOARDING_KEYS.welcomeMatPasted);
    const aiMark = get(ONBOARDING_KEYS.aiModelDetected);
    const firstAgent = get(ONBOARDING_KEYS.firstAgentConnected);

    // The mat is a FILE, not a marker: the marker says a paste happened, the file says a page
    // exists. Reading the file is what keeps a deleted portfolio from leaving a home standing.
    let matHtmlExists = false;
    for (const gaii of await portfolioReadGaiis(storage, owner, config.nodeId)) {
        if (await storage.getStorageFile(gaii, PORTFOLIO_HTML_KEY)) { matHtmlExists = true; break; }
    }

    // The proof key is written by the AGENT under its own GAII, so this must read owner-scope.
    const helloMcp = !!(await getOwnerScopeMemory(storage, config.nodeId, owner, HELLO_MCP_KEY));

    // Which agent the card shows. The list is ordered by both providers now (createdAt, gaii), so
    // agents[0] is the FIRST agent rather than whatever the storage engine happened to return —
    // on Postgres that used to change after every heartbeat.
    //
    // The one shown is the worst one, not the first: a card that reports the oldest agent as
    // healthy while another is broken is the same lie in a different place. `problems` carries the
    // count so the card never implies the fleet is one agent.
    const nowMs = Date.now();
    const onboardings = await Promise.all(agents.map(a =>
        storage.getOnboarding(a.gaii).catch(err => {
            // A missing onboarding record and a failed read both mean "cannot judge onboarding",
            // and the verdict degrades to 'new' either way — but a read that FAILED is worth
            // knowing about, so it is logged rather than swallowed.
            logger.warn('home-state: continuing after a suppressed onboarding read', {
                gaii: a.gaii, error: String(err),
            });
            return null;
        })));
    const onboardingByGaii: Record<string, AgentOnboardingRecord | null> = {};
    agents.forEach((a, i) => { onboardingByGaii[a.gaii] = onboardings[i] ?? null; });
    const healthByGaii = computeAgentHealthMany(agents, onboardingByGaii, nowMs);

    const worst = agents.length
        ? agents.reduce((best, a) =>
            healthByGaii[a.gaii].rank < healthByGaii[best.gaii].rank ? a : best, agents[0])
        : null;

    const agent = worst
        ? {
            name: worst.name,
            gaii: worst.gaii,
            connectedAt: str(firstAgent, 'at') ?? worst.createdAt ?? null,
            health: healthByGaii[worst.gaii],
            total: agents.length,
            problems: agents.filter(a => healthByGaii[a.gaii].bucket === 'issue').length,
        }
        : null;

    // An agent EXISTING was enough before, so an account whose every agent was dead still read
    // "your home is ready". A home is not ready on the strength of a record.
    const hasLiveAgent = agents.some(a => isLiveState(healthByGaii[a.gaii].state));
    const initialized = matHtmlExists && hasLiveAgent && helloMcp;

    const branch = (typeof get(ONBOARDING_KEYS.branchTaken).branch === 'string'
        ? get(ONBOARDING_KEYS.branchTaken).branch as OnboardingBranch : null);

    // Are they STILL waiting on an app that can connect? Re-decided from what is currently known
    // about their AI, using the same function the paste used — so re-pasting with a capable app
    // moves them on by itself, with no separate "I upgraded" claim to make and nothing to reset.
    // Reading `branch === 'B'` instead would strand them: that marker is write-once.
    const paidAnswer = typeof aiMark.has_paid_plan === 'boolean' ? aiMark.has_paid_plan as boolean : undefined;
    const needsBetterApp = matHtmlExists
        && decideBranch(resolveAiClient(str(aiMark, 'client')), { hasPaidPlan: paidAnswer }).branch === 'B';

    const state: HomeState = {
        owner,
        ghii,
        displayName: ghiiRecord?.displayName ?? null,
        track: track.track === 'remake' ? 'remake' : 'legacy',
        switched: typeof track.switched === 'number' ? track.switched : 0,
        step: initialized ? null
            : !matHtmlExists ? 'welcome-mat'
                : needsBetterApp ? 'better-app'
                    : 'first-agent',
        mat: {
            done: matHtmlExists,
            attempts: typeof matMark.attempts === 'number' ? matMark.attempts : 0,
            result: matMark.result === 'ok' ? 'ok' : matMark.result === 'failed' ? 'failed' : null,
            url: matHtmlExists ? `/v1/portfolio/${encodeURIComponent(owner)}` : null,
            standaloneUrl: matHtmlExists ? portfolioStandaloneUrl(config, owner) : null,
        },
        ai: Object.keys(aiMark).length
            ? {
                model: str(aiMark, 'model'),
                vendor: str(aiMark, 'vendor'),
                client: str(aiMark, 'client'),
                mcp: aiMark.mcp === 'yes' || aiMark.mcp === 'no' || aiMark.mcp === 'unknown' ? aiMark.mcp : null,
                // Which of the eight their claim resolved to, so a surface can point at THEIR app
                // rather than re-deriving it from a label and getting a near-miss.
                resolvedClient: str(aiMark, 'resolved_client'),
                source: (aiMark.source === 'asked' ? 'asked' : aiMark.source === 'meta' ? 'meta' : null),
            }
            : null,
        branch,
        needsBetterApp,
        agent,
        helloMcp,
        initialized,
        room: (typeof get(ONBOARDING_KEYS.roomEntered).room === 'string'
            ? get(ONBOARDING_KEYS.roomEntered).room as OnboardingRoom : null),
    };

    // First time the three conditions line up, stamp the funnel. Fire-and-forget and write-once:
    // this is a timestamp for the numbers, not the thing that makes the home real.
    if (initialized && !byKey.has(ONBOARDING_KEYS.homeInitialized)) {
        void recordOnboardingEvent(storage, config, owner, ONBOARDING_KEYS.homeInitialized, {
            via: branch ?? 'A',
        }).catch(err => logger.warn('home-state: home_initialized marker failed', { owner, error: String(err) }));
        // An account the agent door started reaching a finished home is the door's own result.
        // Derived here rather than by a job: the outcome is a function of the same three conditions,
        // and a scheduler that had to guess when a chain "ended" would report abandonment for
        // people who simply took two days.
        if (byKey.has(ONBOARDING_KEYS.agentDoorStarted)) {
            void recordOnboardingEvent(storage, config, owner, ONBOARDING_KEYS.agentDoorResult, {
                result: 'home_initialized',
            }).catch(err => logger.warn('home-state: agent_door_result marker failed', { owner, error: String(err) }));
        }
    }

    return state;
}

/** `val`/`str` are exported for the sibling home routes that read the same markers. */
export { val as markerValue, str as markerString };
