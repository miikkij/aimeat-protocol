/**
 * @file test/unit/decide-run-stop-owner.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stopping a decision run acts only on a run the caller's owner has
 *   (services/decide/runs.ts stopDecideRun, which POST /v1/ai/decide/runs/:id/stop and the
 *   aimeat_decide_run stop action both call).
 *
 *   The running runs sit in one map keyed by run id alone, and the stop set the flag on that map
 *   before it read the run under the owner, so the answer was 404 while the run had already been
 *   told to stop. Found by the 2026-10-20 re-read of the route-scope answers. The decision provider
 *   is the only thing mocked: which records it is asked about is the evidence that a run went on.
 * @usage cd aimeat && pnpm exec vitest run test/unit/decide-run-stop-owner.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial, with the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

/** Every subject the decision provider was asked about, and the gate the first answer waits on. */
const asked: string[] = [];
let openGate: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

vi.mock('../../src/services/decide/service.js', () => ({
    decideForOwner: vi.fn(async (_s: unknown, _c: unknown, _caller: unknown, input: { subject?: string }) => {
        asked.push(String(input.subject));
        await gate;
        return { decision_id: `d-${input.subject}`, cached: false, answers: {}, usage: { cost_usd: 0 } };
    }),
    ruleCallerKind: () => 'owner',
}));

const { startDecideRun, getDecideRun, stopDecideRun } = await import('../../src/services/decide/runs.js');

const ALICE = 'alice@aimeat-test-001-dev';
const BOB = 'bob@aimeat-test-001-dev';
const config = { decideEnabled: true, decideConcurrency: 1 } as unknown as AimeatConfig;
const QUESTIONS = { urgent: { type: 'yes_no', instructions: 'Is this urgent?' } } as never;

/** Memory kept per owner, so one owner's read finds nothing of another's. */
function memoryStorage(): Storage {
    const rows = new Map<string, MemoryRecord>();
    const now = new Date().toISOString();
    const put = (owner: string, key: string, value: unknown) => rows.set(`${owner}|${key}`, {
        key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
        createdAt: now, updatedAt: now,
    } as MemoryRecord);
    put(ALICE, 'deals.q3', { text: 'Close the Q3 deal this week.' });
    put(ALICE, 'deals.q4', { text: 'Nothing yet.' });
    return {
        getMemory: async (owner: string, key: string) => rows.get(`${owner}|${key}`) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}|${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}|${key}`),
        listMemoryMeta: async (owner: string, opts: { prefix?: string }) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? ''))
            .map(r => ({ key: r.key, updatedAt: r.updatedAt })),
    } as unknown as Storage;
}

async function until(test: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !test(); i++) await new Promise(r => setTimeout(r, 5));
    if (!test()) throw new Error('timed out');
}

async function finished(storage: Storage, id: string) {
    for (let i = 0; i < 200; i++) {
        const run = await getDecideRun(storage, ALICE, id);
        if (run && run.state !== 'running') return run;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`run ${id} did not finish`);
}

describe('stopping a decision run', () => {
    beforeEach(() => {
        asked.length = 0;
        gate = new Promise<void>(r => { openGate = r; });
    });

    it('another owner naming the run gets nothing, and the run goes on to its last item', async () => {
        const storage = memoryStorage();
        const caller = { gaii: ALICE, principal: ALICE, isOwner: true };
        const run = await startDecideRun(storage, config, caller, { questions: QUESTIONS, keys: ['deals.q3', 'deals.q4'] });
        await until(() => asked.length === 1);

        expect(await stopDecideRun(storage, BOB, run.id)).toBeNull();

        openGate();
        const done = await finished(storage, run.id);
        expect(done.state).toBe('done');
        expect(asked).toEqual(['deals.q3', 'deals.q4']);
    });

    it('the owner stops it: the open request finishes and the next item is never asked', async () => {
        const storage = memoryStorage();
        const caller = { gaii: ALICE, principal: ALICE, isOwner: true };
        const run = await startDecideRun(storage, config, caller, { questions: QUESTIONS, keys: ['deals.q3', 'deals.q4'] });
        await until(() => asked.length === 1);

        expect((await stopDecideRun(storage, ALICE, run.id))?.id).toBe(run.id);

        openGate();
        const done = await finished(storage, run.id);
        expect(done.state).toBe('stopped');
        expect(asked).toEqual(['deals.q3']);
    });
});
