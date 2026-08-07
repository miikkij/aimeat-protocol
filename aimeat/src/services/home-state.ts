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
    agent: { name: string; gaii: string; connectedAt: string | null } | null;
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
    const ghii = `${owner}@${config.nodeId}`;
    const [ghiiRecord, agents, markers] = await Promise.all([
        storage.getGHIIByOwner(owner),
        storage.getAgentsByOwner(owner),
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

    const agent = agents.length
        ? {
            name: agents[0].name,
            gaii: agents[0].gaii,
            connectedAt: str(firstAgent, 'at') ?? agents[0].createdAt ?? null,
        }
        : null;

    const initialized = matHtmlExists && !!agent && helloMcp;

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
