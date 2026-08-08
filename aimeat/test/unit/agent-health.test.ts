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
