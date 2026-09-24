/**
 * @file test/unit/decide-runs-reserved.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A decision run never sends a record this node reads and trusts to the decision
 *   provider (services/decide/runs.ts).
 *
 *   A run reads its items from the owner's memory when it is given `keys` or a `prefix`, and each
 *   record it reads goes to the provider. The refusal of the `decide.` prefix looked at the prefix
 *   the caller typed, so `prefix: "de"` walked straight into `decide.apikey` and `decide.policy`,
 *   and an explicit `keys` list had no refusal at all. The provider is the only thing mocked here:
 *   what it is asked about is the evidence.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

/** Every subject the decision provider was asked about. */
const asked: string[] = [];

vi.mock('../../src/services/decide/service.js', () => ({
    decideForOwner: vi.fn(async (_s: unknown, _c: unknown, _caller: unknown, input: { subject?: string }) => {
        asked.push(String(input.subject));
        return { decision_id: `d-${input.subject}`, cached: false, answers: {}, usage: { cost_usd: 0 } };
    }),
    ruleCallerKind: () => 'owner',
}));

const { startDecideRun, getDecideRun } = await import('../../src/services/decide/runs.js');

const OWNER = 'alice@aimeat-test-001-dev';
const config = { decideEnabled: true, decideConcurrency: 2 } as unknown as AimeatConfig;
const caller = { gaii: OWNER, principal: OWNER, isOwner: true };

/** An owner namespace holding the node's own records beside the owner's. */
function memoryStorage(): Storage {
    const rows = new Map<string, MemoryRecord>();
    const now = new Date().toISOString();
    const put = (key: string, value: unknown) => rows.set(key, {
        key, ownerGaii: OWNER, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
        createdAt: now, updatedAt: now,
    } as MemoryRecord);
    put('decide.apikey', { ciphertext: 'sealed' });
    put('decide.policy', { allow: ['person'] });
    put('deals.q3', { text: 'Close the Q3 deal this week.' });
    put('deals.q4', { text: 'Nothing yet.' });
    put('commerce.psp', { payoutAddress: 'FI00 1234' });
    return {
        getMemory: async (_gaii: string, key: string) => rows.get(key) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(r.key, r); return r; },
        deleteMemory: async (_gaii: string, key: string) => rows.delete(key),
        listMemoryMeta: async (_gaii: string, opts: { prefix?: string }) => [...rows.values()]
            .filter(r => r.key.startsWith(opts.prefix ?? ''))
            .map(r => ({ key: r.key, updatedAt: r.updatedAt })),
    } as unknown as Storage;
}

async function finished(storage: Storage, id: string) {
    for (let i = 0; i < 100; i++) {
        const run = await getDecideRun(storage, OWNER, id);
        if (run && run.state !== 'running') return run;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`run ${id} did not finish`);
}

const QUESTIONS = { urgent: { type: 'yes_no', instructions: 'Is this urgent?' } } as never;

describe('a decision run and the records the node trusts', () => {
    beforeEach(() => { asked.length = 0; });

    it('leaves them out of a prefix that happens to cover them', async () => {
        const storage = memoryStorage();
        const run = await startDecideRun(storage, config, caller, { questions: QUESTIONS, prefix: 'de' });
        const done = await finished(storage, run.id);
        expect(done.items.map(i => i.subject).sort()).toEqual(['deals.q3', 'deals.q4']);
        expect(asked.sort()).toEqual(['deals.q3', 'deals.q4']);
    });

    it('refuses a keys list that names one, and asks the provider nothing', async () => {
        const storage = memoryStorage();
        await expect(startDecideRun(storage, config, caller, { questions: QUESTIONS, keys: ['deals.q3', 'decide.apikey'] }))
            .rejects.toMatchObject({ code: 'RESERVED_KEY' });
        await expect(startDecideRun(storage, config, caller, { questions: QUESTIONS, keys: ['commerce.psp'] }))
            .rejects.toMatchObject({ code: 'RESERVED_KEY' });
        await new Promise(r => setTimeout(r, 30));
        expect(asked).toEqual([]);
    });

    it('refuses a prefix that lies wholly inside them', async () => {
        const storage = memoryStorage();
        for (const prefix of ['decide.', 'commerce.', 'openrouter.']) {
            await expect(startDecideRun(storage, config, caller, { questions: QUESTIONS, prefix }))
                .rejects.toMatchObject({ status: 400 });
        }
        expect(asked).toEqual([]);
    });

    it('still runs over the owner\'s own records, named one by one', async () => {
        const storage = memoryStorage();
        const run = await startDecideRun(storage, config, caller, { questions: QUESTIONS, keys: ['deals.q3'] });
        await finished(storage, run.id);
        expect(asked).toEqual(['deals.q3']);
    });
});
