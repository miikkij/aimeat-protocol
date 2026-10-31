/**
 * @file test/unit/scheduler-ai-output-precheck.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A scheduled `ai` job whose stored answer the memory write would refuse is refused before
 *   the model is called (services/scheduler-ai-job.ts; secaudit 2026-10-31 inv-28).
 *
 *   A schedule stored before the create and edit doors checked output_visibility (2026-10-20) can name
 *   an organism its maker is not a member of, or an organism.* output key the maker may not write. The
 *   fire wrote through services/memory-write.ts, which refused it, but only after completeForOwner had
 *   spent the owner's key on the answer. With the real SQLite store and the provider mocked:
 *   - refused before the call: an organism the maker is not a member of, an organism.* output key of
 *     an organism that does not exist; no completion is asked and the run fails with the reason;
 *   - kept, unchanged: a private, owner-visible and public answer, and no visibility named.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-ai-output-precheck.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-28).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

/** Every prompt a completion was asked for: what the owner's key paid for. */
const calls: string[] = [];
vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async (_s: unknown, _c: unknown, _o: unknown, input: { prompt: string }) => {
            calls.push(input.prompt);
            return { content: 'the answer', usage: { costUsd: 0.01, totalTokens: 5 } };
        }),
    };
});

const { createStorage } = await import('../../src/storage/storage-factory.js');
const { setThisNodeId } = await import('../../src/utils/gaii.js');
const { runAiJob } = await import('../../src/services/scheduler-ai-job.js');
import type { Storage, ScheduledJobRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.aioutput-${process.pid}.db`;
const NODE = 'aimeat-ai-output';
const OWNER = 'outputter';
const GHII = `${OWNER}@${NODE}`;
let storage: Storage;
const config = {
    nodeId: NODE, baseUrl: 'http://localhost',
    memoryQuotaMb: 100, memoryMaxKeysPerAgent: 1000, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 0,
} as unknown as AimeatConfig;

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: '2026-01-01T00:00:00.000Z' } as never);
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

beforeEach(() => { calls.length = 0; });

let n = 0;
/** A schedule the owner made in person, stored as an older node stored it. */
function stored(input: Record<string, unknown>): ScheduledJobRecord {
    n++;
    return {
        id: `sched-${n}`, name: `s${n}`, type: 'ai', cron: '0 4 1 1 *', enabled: true, ownerScope: GHII,
        createdBy: GHII, createdAt: '2026-06-01T00:00:00.000Z', input: { prompt: 'Write the day\'s note.', ...input },
    } as unknown as ScheduledJobRecord;
}

describe('a scheduled ai job whose answer the memory write refuses', () => {
    it('an organism the maker is not a member of is refused before the model is called', async () => {
        const job = stored({ outputKey: `out.org.${n}`, outputVisibility: 'organism:org-nobody-is-in' });
        await expect(runAiJob(storage, config, job)).rejects.toThrow(/not an active member of organism org-nobody-is-in/);
        expect(calls).toHaveLength(0);
    });

    it('an organism.* output key the maker may not write is refused before the model is called', async () => {
        const job = stored({ outputKey: 'organism.org-that-does-not-exist.shared.note' });
        await expect(runAiJob(storage, config, job)).rejects.toThrow(/Organism not found/);
        expect(calls).toHaveLength(0);
    });

    for (const outputVisibility of [undefined, 'private', 'owner', 'public']) {
        it(`usage: output_visibility ${String(outputVisibility)} runs, calls the model once and stores the answer`, async () => {
            const key = `out.kept.${n + 1}`;
            const job = stored({ outputKey: key, ...(outputVisibility ? { outputVisibility } : {}) });
            const ran = await runAiJob(storage, config, job);
            expect(ran.writes).toEqual([key]);
            expect(calls).toHaveLength(1);
            const rec = await storage.getMemory(GHII, key);
            expect(rec?.value).toBe('the answer');
            expect(rec?.visibility).toBe(outputVisibility ?? 'private');
        });
    }
});
