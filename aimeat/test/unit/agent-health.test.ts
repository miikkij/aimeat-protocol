/**
 * @file test/unit/agent-health.test.ts
 * @description The account-level agent verdict, including every case the frontend's old copy got
 *   wrong — because those are the ones a reader will assume still work.
 *
 *   Three of its conditions could not fire at all: `webhookFailCount` was never in the response the
 *   frontend read, `previousReadinessLevel` is not a field on any record, and the readiness ladder
 *   named a level the node never produces while omitting the one it does. So "problem" silently
 *   meant only "not seen in 24 h", a broken push channel showed as healthy, and none of it was
 *   visible from the file doing it.
 * @usage pnpm test -- agent-health
 * @version-history
 *   v1.1.0 — 2026-09-06 — The held-connection cases: a spawn agent parked between jobs is available,
 *     and the same agent with nothing holding it open is still the problem it was.
 *   v1.0.0 — 2026-08-09 — Initial, with V1.
 */
import { describe, it, expect } from 'vitest';
import {
    computeAgentHealth, computeAgentHealthMany, isLiveState,
    AGENT_ONLINE_WINDOW_MS, AGENT_STALE_MS, AGENT_WEBHOOK_DOWN_THRESHOLD, BUCKET_RANK,
} from '../../src/services/agent-health.js';
import type { AgentOnboardingRecord } from '../../src/storage/types/agents-messaging.js';

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const done: AgentOnboardingRecord = {
    agentGaii: 'a#o@n', status: 'completed', startedAt: ago(30 * 24 * HOUR),
    steps: [], readinessLevel: 'full', readinessScore: 90,
};

const agent = (over: Record<string, unknown> = {}) =>
    ({ lastSeen: ago(MIN), tags: [], ...over }) as never;

describe('the states, in priority order', () => {
    it('an owner-tagged system agent is internal, whatever else is true', () => {
        for (const tags of [['system'], ['system:secretary'], ['role.task-runner', 'system:x']]) {
            const h = computeAgentHealth(agent({ tags, lastSeen: ago(40 * HOUR) }), null, NOW);
            expect(h.state, JSON.stringify(tags)).toBe('system');
            expect(h.bucket).toBe('internal');
        }
    });

    it('the BARE `system` tag counts too — prefix-only made this branch unreachable for it', () => {
        expect(computeAgentHealth(agent({ tags: ['system'] }), null, NOW).state).toBe('system');
    });

    it('no onboarding record at all is new, not broken', () => {
        expect(computeAgentHealth(agent(), null, NOW).state).toBe('new');
    });

    it('onboarding in progress outranks staleness', () => {
        const ob = { ...done, status: 'in_progress' as const };
        expect(computeAgentHealth(agent({ lastSeen: ago(40 * HOUR) }), ob, NOW).state).toBe('onboarding');
    });
});

/**
 * A workstation is an MCP connection a TOOL uses, given a GAII so its work can be traced. It is
 * online exactly while somebody is using it, so the working/broken axis does not apply: not seen
 * today means the person did not open the tool, and Hello Integration is not owed by something that
 * reaches the node over MCP anyway. Every one of these cases returned a colour that made a claim.
 */
describe('a workstation is not judged on the axis the other agents are', () => {
    const ws = (over: Record<string, unknown> = {}) => agent({ mode: 'workstation', ...over });

    it('a month unseen is NOT a problem — it is a tool nobody opened', () => {
        const h = computeAgentHealth(ws({ lastSeen: ago(30 * 24 * HOUR) }), done, NOW);
        expect(h.state).toBe('workstation');
        expect(h.bucket).toBe('connection');
        expect(h.reasons).toEqual([]);
    });

    it('never seen at all is not a problem either', () => {
        expect(computeAgentHealth(ws({ lastSeen: undefined }), done, NOW).state).toBe('workstation');
    });

    it('no onboarding record does not park it in the orange forever', () => {
        expect(computeAgentHealth(ws(), null, NOW).state).toBe('workstation');
        expect(computeAgentHealth(ws(), { ...done, status: 'in_progress' as const }, NOW).state).toBe('workstation');
        expect(computeAgentHealth(ws(), { ...done, status: 'failed' as const }, NOW).state).toBe('workstation');
    });

    it('being used right now does not make it a production agent either', () => {
        expect(computeAgentHealth(ws({ lastSeen: ago(MIN) }), done, NOW).state).toBe('workstation');
    });

    it('it still says when something last came from it, which is the whole point of the row', () => {
        const h = computeAgentHealth(ws({ lastSeen: ago(3 * HOUR) }), done, NOW);
        expect(h.last_seen).toBe(ago(3 * HOUR));
        expect(h.seconds_since_seen).toBe(3 * 60 * 60);
    });

    it('the owner calling it node machinery still wins: system is checked first', () => {
        expect(computeAgentHealth(ws({ tags: ['system'] }), done, NOW).state).toBe('system');
    });

    it('counts as live, so a person whose only connection is a chat tool has a working home', () => {
        expect(isLiveState('workstation')).toBe(true);
    });

    it('sorts below the agents that do something on their own', () => {
        expect(BUCKET_RANK.connection).toBeGreaterThan(BUCKET_RANK.online);
    });
});

describe('problem — the three conditions, one of which used to be the only one', () => {
    it('seen 25 hours ago with onboarding done is a problem (this one always worked)', () => {
        const h = computeAgentHealth(agent({ lastSeen: ago(25 * HOUR) }), done, NOW);
        expect(h.state).toBe('problem');
        expect(h.reasons).toEqual(['stale-24h']);
    });

    it('never seen at all is a problem, and says so distinctly', () => {
        const h = computeAgentHealth(agent({ lastSeen: undefined }), done, NOW);
        expect(h.state).toBe('problem');
        expect(h.reasons).toEqual(['never-seen']);
        expect(h.seconds_since_seen).toBeNull();
    });

    it('A FAILING WEBHOOK IS A PROBLEM — the condition that could never fire', () => {
        const h = computeAgentHealth(agent({
            webhookUrl: 'https://x.test/hook', webhookEnabled: true,
            webhookFailCount: AGENT_WEBHOOK_DOWN_THRESHOLD,
        }), done, NOW);
        expect(h.state).toBe('problem');
        expect(h.reasons).toContain('webhook-down');
        expect(h.delivery.channel).toBe('webhook-failing');
    });

    it('one failure below the threshold is not a problem', () => {
        const h = computeAgentHealth(agent({
            webhookUrl: 'https://x.test/hook', webhookEnabled: true,
            webhookFailCount: AGENT_WEBHOOK_DOWN_THRESHOLD - 1,
        }), done, NOW);
        expect(h.state).toBe('production');
        expect(h.delivery.channel).toBe('webhook');
    });

    it('FAILED ONBOARDING IS A PROBLEM — it used to fall through and show as fine', () => {
        const h = computeAgentHealth(agent(), { ...done, status: 'failed' }, NOW);
        expect(h.state).toBe('problem');
        expect(h.reasons).toContain('onboarding-failed');
    });

    it('several faults at once are all reported, not just the first', () => {
        const h = computeAgentHealth(agent({
            lastSeen: ago(40 * HOUR), webhookUrl: 'https://x.test/h', webhookEnabled: true,
            webhookFailCount: 99,
        }), { ...done, status: 'failed' }, NOW);
        expect(h.reasons).toEqual(['onboarding-failed', 'stale-24h', 'webhook-down']);
    });
});

describe('production and idle', () => {
    it('seen inside the online window is production', () => {
        expect(computeAgentHealth(agent({ lastSeen: ago(AGENT_ONLINE_WINDOW_MS - MIN) }), done, NOW).state)
            .toBe('production');
    });

    it('seen an hour ago is idle — alive, but not right now', () => {
        expect(computeAgentHealth(agent({ lastSeen: ago(HOUR) }), done, NOW).state).toBe('idle');
    });

    it('A HEALTHY WEBHOOK COUNTS AS PRODUCTION WITHOUT A HEARTBEAT', () => {
        // A push agent never polls, so it read as idle forever. Both server calculators already
        // treated a healthy webhook as reachable; the frontend never learned it.
        const h = computeAgentHealth(agent({
            lastSeen: ago(6 * HOUR), webhookUrl: 'https://x.test/h', webhookEnabled: true, webhookFailCount: 0,
        }), done, NOW);
        expect(h.state).toBe('production');
    });

    it('…but a webhook does NOT excuse being dead for a day', () => {
        // A configured webhook with no traffic keeps failCount at 0 forever, so it cannot prove
        // liveness. Staleness stays unconditional.
        const h = computeAgentHealth(agent({
            lastSeen: ago(40 * HOUR), webhookUrl: 'https://x.test/h', webhookEnabled: true, webhookFailCount: 0,
        }), done, NOW);
        expect(h.state).toBe('problem');
        expect(h.reasons).toEqual(['stale-24h']);
    });

    it('a configured but DISABLED webhook does not count as delivery', () => {
        const h = computeAgentHealth(agent({
            lastSeen: ago(6 * HOUR), webhookUrl: 'https://x.test/h', webhookEnabled: false,
        }), done, NOW);
        expect(h.state).toBe('idle');
        expect(h.delivery.channel).toBe('polling');
        expect(h.delivery.webhook_configured).toBe(true);
        expect(h.delivery.webhook_enabled).toBe(false);
    });
});

describe('the boundaries are exact', () => {
    it('exactly at the online window is still production; one ms past is idle', () => {
        expect(computeAgentHealth(agent({ lastSeen: ago(AGENT_ONLINE_WINDOW_MS) }), done, NOW).state).toBe('production');
        expect(computeAgentHealth(agent({ lastSeen: ago(AGENT_ONLINE_WINDOW_MS + 1) }), done, NOW).state).toBe('idle');
    });

    it('exactly at 24 h is still idle; one ms past is a problem', () => {
        expect(computeAgentHealth(agent({ lastSeen: ago(AGENT_STALE_MS) }), done, NOW).state).toBe('idle');
        expect(computeAgentHealth(agent({ lastSeen: ago(AGENT_STALE_MS + 1) }), done, NOW).state).toBe('problem');
    });
});

/**
 * A spawn agent has no runtime between jobs, so `lastSeen` dates its last WORK and goes stale while
 * it sits parked and wakeable. On aimeat.io 2026-09-06, 23 spawn agents each held a live socket and
 * 9 of them were stale at that moment, so nine working agents read as problems on three surfaces.
 */
describe('a held connection is liveness (the spawn agent between jobs)', () => {
    it('days stale with a socket is production, with nothing to fix', () => {
        const h = computeAgentHealth(agent({ lastSeen: ago(3 * 24 * HOUR) }), done, NOW, true);
        expect(h.state).toBe('production');
        expect(h.reasons).toEqual([]);
    });

    it('the same agent without the socket is the problem it has always been', () => {
        const h = computeAgentHealth(agent({ lastSeen: ago(3 * 24 * HOUR) }), done, NOW, false);
        expect(h.state).toBe('problem');
        expect(h.reasons).toContain('stale-24h');
    });

    it('never seen at all, but connected, is not never-seen', () => {
        const h = computeAgentHealth(agent({ lastSeen: undefined }), done, NOW, true);
        expect(h.state).toBe('production');
        expect(h.reasons).toEqual([]);
    });

    it('the delivery channel names the socket rather than a poll that never happens', () => {
        expect(computeAgentHealth(agent({ lastSeen: ago(3 * 24 * HOUR) }), done, NOW, true).delivery.channel).toBe('socket');
        expect(computeAgentHealth(agent({ lastSeen: ago(3 * 24 * HOUR) }), done, NOW, false).delivery.channel).toBe('polling');
    });

    it('a healthy webhook still wins the channel — it is the door the node actually pushes to', () => {
        const wh = agent({ webhookUrl: 'https://x', webhookEnabled: true, webhookFailCount: 0 });
        expect(computeAgentHealth(wh, done, NOW, true).delivery.channel).toBe('webhook');
    });

    it('a broken webhook is still a problem, socket or not — the owner is the only one who can fix it', () => {
        const wh = agent({ webhookUrl: 'https://x', webhookEnabled: true, webhookFailCount: AGENT_WEBHOOK_DOWN_THRESHOLD });
        const h = computeAgentHealth(wh, done, NOW, true);
        expect(h.state).toBe('problem');
        expect(h.reasons).toEqual(['webhook-down']);
    });

    it('the fleet reads the connected set per agent, not per fleet', () => {
        const stale = ago(3 * 24 * HOUR);
        const many = computeAgentHealthMany(
            [{ gaii: 'parked#o@n', lastSeen: stale, tags: [] }, { gaii: 'gone#o@n', lastSeen: stale, tags: [] }] as never,
            { 'parked#o@n': done, 'gone#o@n': done }, NOW, new Set(['parked#o@n']));
        expect(many['parked#o@n'].state).toBe('production');
        expect(many['gone#o@n'].state).toBe('problem');
    });

    it('no connected set at all leaves every verdict where it was', () => {
        const many = computeAgentHealthMany(
            [{ gaii: 'a#o@n', lastSeen: ago(3 * 24 * HOUR), tags: [] }] as never, { 'a#o@n': done }, NOW);
        expect(many['a#o@n'].state).toBe('problem');
    });
});

describe('the fleet view', () => {
    it('every state maps to a bucket, and issue sorts first', () => {
        expect(BUCKET_RANK.issue).toBe(0);
        const states = ['problem', 'new', 'production', 'idle', 'system'] as const;
        const ranks = states.map(s => {
            const h = s === 'problem' ? computeAgentHealth(agent({ lastSeen: undefined }), done, NOW)
                : s === 'new' ? computeAgentHealth(agent(), null, NOW)
                    : s === 'system' ? computeAgentHealth(agent({ tags: ['system'] }), null, NOW)
                        : s === 'idle' ? computeAgentHealth(agent({ lastSeen: ago(HOUR) }), done, NOW)
                            : computeAgentHealth(agent(), done, NOW);
            expect(h.state).toBe(s);
            return h.rank;
        });
        expect(ranks[0]).toBe(0);
        expect(Math.min(...ranks)).toBe(0);
    });

    it('one clock for the whole page — two agents cannot straddle a boundary', () => {
        const at = ago(AGENT_ONLINE_WINDOW_MS);
        const many = computeAgentHealthMany(
            [{ gaii: 'a#o@n', lastSeen: at, tags: [] }, { gaii: 'b#o@n', lastSeen: at, tags: [] }] as never,
            { 'a#o@n': done, 'b#o@n': done }, NOW);
        expect(many['a#o@n'].state).toBe(many['b#o@n'].state);
    });

    it('an agent with no onboarding entry in the map is new, not undefined', () => {
        const many = computeAgentHealthMany([{ gaii: 'x#o@n', lastSeen: ago(MIN), tags: [] }] as never, {}, NOW);
        expect(many['x#o@n'].state).toBe('new');
    });
});

describe('a home is not ready on the strength of a record (V3)', () => {
    it('a broken agent is not a live one', () => {
        expect(isLiveState('problem')).toBe(false);
    });

    it('every other state is', () => {
        for (const s of ['production', 'idle', 'onboarding', 'new'] as const) {
            expect(isLiveState(s), s).toBe(true);
        }
    });

    it('a system agent does not make a home ready either — it is node machinery, not the fleet', () => {
        expect(isLiveState('system')).toBe(false);
    });

    it('an account whose only agent is dead has no live agent', () => {
        const many = computeAgentHealthMany(
            [{ gaii: 'dead#o@n', lastSeen: ago(40 * HOUR), tags: [] }] as never, { 'dead#o@n': done }, NOW);
        expect(Object.values(many).some(h => isLiveState(h.state))).toBe(false);
    });
});
