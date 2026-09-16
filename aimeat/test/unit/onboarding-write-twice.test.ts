/**
 * @file test/unit/onboarding-write-twice.test.ts
 * @description One onboarding per agent, and writing it twice is not an error.
 *
 *   THE FAILURE THIS PINS. Three paths create the row — agent registration, device authorization,
 *   and POST /v1/agents/:name/onboarding/start, which reads first and then either updates or
 *   creates. A row that appears between that read and that create used to end as INTERNAL_ERROR:
 *   the nightly sweep on Postgres failed there on 2026-09-16, one millisecond after the database
 *   logged "duplicate key value violates unique constraint AgentOnboarding_agentGaii_key".
 *
 *   WHY HERE AND NOT IN THE E2E. Reaching that window through HTTP needs two starts to interleave
 *   inside one read-then-write, and SQLite serialises writes well enough that firing two at once
 *   passes with or without the fix — measured, before this file existed. The contract that changed
 *   is the storage method's, so that is what this asserts, deterministically: the second write
 *   REPLACES the first and leaves one row. e2e-agent-onboarding 47b keeps the HTTP shape honest.
 *
 *   The Postgres provider takes the same clause and cannot be run on the developer's machine; the
 *   nightly sweep is its proof.
 * @usage cd aimeat && pnpm exec vitest run test/unit/onboarding-write-twice.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentOnboardingRecord } from '../../src/storage/interface.js';

const GAII = 'onboard-twice#alice@aimeat-local-001-dev';

function record(over: Partial<AgentOnboardingRecord> = {}): AgentOnboardingRecord {
    return {
        agentGaii: GAII,
        status: 'in_progress',
        startedAt: '2026-09-16T00:00:00.000Z',
        steps: [{ id: 'authenticate', status: 'pending' }] as AgentOnboardingRecord['steps'],
        ...over,
    };
}

describe('createOnboarding is the agent\'s onboarding, however many times it is written', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('a second write does not throw on the unique key', async () => {
        await storage.createOnboarding(record());
        await expect(storage.createOnboarding(record())).resolves.toBeTruthy();
    });

    it('the second write wins, and there is still one row', async () => {
        await storage.createOnboarding(record({ status: 'in_progress', detectedPlatform: 'claude-desktop' }));
        await storage.createOnboarding(record({
            status: 'completed',
            startedAt: '2026-09-16T01:00:00.000Z',
            steps: [{ id: 'authenticate', status: 'passed' }] as AgentOnboardingRecord['steps'],
            detectedPlatform: 'vs-code',
        }));

        const back = await storage.getOnboarding(GAII);
        expect(back?.status).toBe('completed');
        expect(back?.detectedPlatform).toBe('vs-code');
        expect(back?.startedAt).toBe('2026-09-16T01:00:00.000Z');
        expect(back?.steps[0]?.status).toBe('passed');

        // One row, not two: the read above returns the first match, so a duplicate would hide here.
        const inProgress = await storage.listOnboardingByStatus('in_progress');
        expect(inProgress.filter(o => o.agentGaii === GAII)).toHaveLength(0);
        const completed = await storage.listOnboardingByStatus('completed');
        expect(completed.filter(o => o.agentGaii === GAII)).toHaveLength(1);
    });
});
