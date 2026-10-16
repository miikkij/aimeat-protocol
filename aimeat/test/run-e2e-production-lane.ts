/**
 * @file test/run-e2e-production-lane.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The production-settings lane: the node a suite runs against starts with the settings
 *   a production node runs, not the ones the E2E runner relaxes for the full sweep.
 *
 *   WHY. Every node the E2E runner started had test mode and dev mode on, anonymous mode on for all
 *   but eight suites, the wildcard as the default agent scopes, the admin setup route open after the
 *   first operator, and every rate limit raised a hundredfold. So the production answer of a route
 *   that reads one of those settings was tested nowhere: registering a taken name answered by
 *   erasing the account, a refused credential fell back to the anonymous identity, and an agent
 *   approved with no named list passed every scope gate (QA audit P1-01, P1-08, P7-03, P7-05,
 *   F03a-02, S1-08, F7d). The guard tier runs on this lane (`--production-settings`, set by
 *   `pnpm test:e2e:guards:*`); the full sweep keeps the relaxed settings.
 *
 *   SIX SETTING GROUPS. Each is either on the production value or, for a suite listed in
 *   PRODUCTION_LANE_EXCEPTIONS, kept at the full sweep's value with the reason written beside it.
 *   A suite leaves the list by being fixed to run on production settings, the way a suite joins the
 *   guard tier: alone, on a freshly deleted database, three identical green runs on both backends.
 *   The list may only shrink; test/unit/production-lane.test.ts holds its size.
 *
 *   RATE LIMITS. The production values of the limits keyed by the caller's identity (global, auth,
 *   work, memory, boards, the AI and invite tiers) apply. The two limits keyed by the source address
 *   alone (registrations and sign-ins per minute) stay raised for every suite, because every request
 *   of a test run comes from one loopback address, which no production node sees for all of its
 *   users; at five registrations a minute the tier would measure the clock. The sign-in limiter's
 *   production answer is tested by e2e-auth-tarpit on a node of its own.
 * @structure PRODUCTION_SETTINGS · PRODUCTION_LANE_EXCEPTIONS · productionLaneOn() · productionOverlay(suite)
 * @usage
 *   node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --guards --production-settings
 * @version-history
 *   2026-10-16 — Initial (QA audit P1-01, P1-08, P7-03, P7-05, F03a-02, S1-08, F7d).
 */

/** The variable run-e2e-ci.ts sets for `--production-settings`, read by the runner's env pins. */
export const PRODUCTION_LANE_ENV = 'AIMEAT_E2E_PRODUCTION_SETTINGS';

/**
 * The default agent scopes a production node gives an agent approved with no named list:
 * SHIPPED_DEFAULT_AGENT_SCOPES in src/config.ts, written out because this file must not load the
 * node's config module. test/unit/production-lane.test.ts holds the two equal.
 */
export const SHIPPED_DEFAULT_AGENT_SCOPES_COPY = 'memory:read,memory:write,memory:delete,catalogue:read,organism:read,agent:read';

export type SettingGroup = 'testMode' | 'devMode' | 'anonymous' | 'agentScopes' | 'adminSetup' | 'rateLimits';

/** What each group sets on the production lane. Unset rate limits fall to the code default. */
export const PRODUCTION_SETTINGS: Record<SettingGroup, Record<string, string>> = {
    testMode: { AIMEAT_TEST_MODE: 'false' },
    devMode: { AIMEAT_DEV_MODE: 'false' },
    anonymous: { AIMEAT_ANONYMOUS: 'false' },
    agentScopes: { AIMEAT_DEFAULT_AGENT_SCOPES: SHIPPED_DEFAULT_AGENT_SCOPES_COPY },
    adminSetup: { AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR: 'false' },
    // The code defaults of src/config.ts loadConfig() for the identity-keyed tiers.
    rateLimits: {
        AIMEAT_RL_GLOBAL: '300', AIMEAT_RL_AUTH: '20', AIMEAT_RL_WORK: '60', AIMEAT_RL_MEMORY: '120',
        AIMEAT_RL_BOARDS: '60', AIMEAT_RL_REGISTRATION_INVITES: '5', AIMEAT_RL_AUTH_CHALLENGE: '300',
    },
};

/** The reason for a suite whose agents stand for agents granted every scope. */
function scopes(words: string): string {
    return `OPEN: its agents are registered with no scope list and stand for agents their owner granted every scope; on the shipped default they lack ${words}, which the suite exercises. Leaves when each agent is registered with the list it needs. The shipped default itself is asserted by e2e-mcp-scopes and e2e-production-posture.`;
}
const ADMIN_SETUP = 'OPEN: makes a second operator through POST /v1/admin/setup/register, which a shipped node closes after the first (410 SETUP_CLOSED). Leaves when it makes later operators by POST /v1/admin/roles/grant (QA audit F7d-05).';
const ANONYMOUS_SUBJECT = 'Its subject includes anonymous mode itself (the shared anonymous identity and its token), which a production node runs off.';

/**
 * The suites that keep a group at the full sweep's value on this lane, each with the reason.
 * A QUESTION entry (starts "OPEN:") says what has to change in the suite before it can leave.
 */
export const PRODUCTION_LANE_EXCEPTIONS: Record<string, { keep: SettingGroup[]; reason: string }> = {
    // Measured 2026-10-16: the first run of the whole guard tier on this lane. 114 of 140 suites were
    // green on production settings as they stood; these are the rest, each with what it hit.
    'e2e-security': { keep: ['agentScopes'], reason: scopes('work:publish, work:request') },
    'e2e-money-audit': { keep: ['agentScopes'], reason: scopes('ext:invoke') },
    'e2e-mcp-cross-owner': { keep: ['agentScopes'], reason: scopes('the extension and schedule tools') },
    'e2e-federation-settlements-sync': { keep: ['agentScopes'], reason: scopes('work:publish, work:request') },
    'e2e-app-roadmap': { keep: ['agentScopes'], reason: scopes('app:write (aimeat_app_publish)') },
    'e2e-cortex-upload-ownership': { keep: ['agentScopes'], reason: scopes('the cortex tools') },
    'e2e-federated-namesake': { keep: ['agentScopes'], reason: scopes('work:publish') },
    'e2e-board-access': { keep: ['agentScopes'], reason: scopes('social:write') },
    'e2e-storage-visibility': { keep: ['agentScopes'], reason: scopes('storage:write, storage:read') },
    'e2e-auth-lib': { keep: ['agentScopes'], reason: scopes('app:write') },
    'e2e-knowledge': { keep: ['agentScopes'], reason: scopes('organism:write, consent:manage') },
    'e2e-mcp-workspaces': { keep: ['agentScopes'], reason: scopes('organism:write (aimeat_workspace_publish)') },
    'e2e-mcp-organism-namespace': { keep: ['agentScopes'], reason: scopes('organism:write (aimeat_organism_create)') },
    'e2e-mcp-extensions': { keep: ['agentScopes'], reason: scopes('ext:invoke') },
    'e2e-agent-tasks': { keep: ['agentScopes'], reason: scopes('task:write') },
    'e2e-appeals': { keep: ['agentScopes'], reason: scopes('social:write') },
    'e2e-directory-index': { keep: ['agentScopes'], reason: scopes('consent:manage') },
    'e2e-owner-export': { keep: ['agentScopes'], reason: scopes('social:write, consent:manage') },
    'e2e-upsert': { keep: ['agentScopes'], reason: scopes('ext:invoke') },
    'e2e-workspace-member-changes': { keep: ['agentScopes'], reason: scopes('organism:write (aimeat_workspace_suggestions)') },
    'e2e-mcp-scopes': { keep: ['adminSetup'], reason: ADMIN_SETUP },
    'e2e-catalogue-identity': { keep: ['adminSetup'], reason: ADMIN_SETUP },
    'e2e-admin-doors-2': { keep: ['adminSetup'], reason: `${ADMIN_SETUP} It also asserts the setup route's own 400 answers, which a closed route answers with 410.` },
    'e2e-mcp-proxy': { keep: ['adminSetup'], reason: ADMIN_SETUP },
    'e2e-memory-doors': { keep: ['anonymous'], reason: ANONYMOUS_SUBJECT },
    'e2e-notifications': { keep: ['anonymous'], reason: `${ANONYMOUS_SUBJECT} OPEN: four assertions use the anonymous token as "an agent without the scope"; leaves when they use a narrow agent (QA audit F7d-03).` },
};

/** True when this run is the production-settings lane. */
export function productionLaneOn(): boolean {
    return process.env[PRODUCTION_LANE_ENV] === '1';
}

/** The groups a suite keeps at the full sweep's value on this lane. */
export function keptGroups(suite?: string): SettingGroup[] {
    return (suite && PRODUCTION_LANE_EXCEPTIONS[suite]?.keep) || [];
}

/**
 * The variables the production lane sets for a suite's node, after every other pin: every group's
 * production value except the groups the suite keeps. Empty when the lane is off.
 */
export function productionOverlay(suite?: string): Record<string, string> {
    if (!productionLaneOn()) return {};
    const kept = keptGroups(suite);
    const out: Record<string, string> = {};
    for (const [group, vars] of Object.entries(PRODUCTION_SETTINGS) as [SettingGroup, Record<string, string>][]) {
        if (!kept.includes(group)) Object.assign(out, vars);
    }
    return out;
}

/** The test-lane values a kept group goes back to, for the groups whose test value no other pin sets. */
export const TEST_LANE_VALUES: Partial<Record<SettingGroup, Record<string, string>>> = {
    testMode: { AIMEAT_TEST_MODE: 'true' },
    devMode: { AIMEAT_DEV_MODE: 'true' },
};

/** The test-lane values for a suite's kept groups on the production lane (empty when the lane is off). */
export function keptTestValues(suite?: string): Record<string, string> {
    if (!productionLaneOn()) return {};
    const out: Record<string, string> = {};
    for (const group of keptGroups(suite)) Object.assign(out, TEST_LANE_VALUES[group] ?? {});
    return out;
}
