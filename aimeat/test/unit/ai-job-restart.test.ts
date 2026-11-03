/**
 * @file test/unit/ai-job-restart.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A job the node stops (a deploy or a restart) continues after the next start: the
 *   stopping process marks it, the next process queues it again once and runs it to done. A job the
 *   node stops twice fails, and a job left running by a process that died without stopping fails as
 *   before (test/e2e-ai-jobs.ts case 15 holds that one end to end). Two AiJobService instances on one
 *   storage stand for the process before and after the restart.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-restart.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item HA 1.4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

/** The model call: held until released while `hold` is on, answered at once otherwise. */
const model = vi.hoisted(() => ({ hold: false, calls: 0, release: [] as Array<() => void> }));

vi.mock('../../src/services/ai-inputs.js', () => ({
    readAiRecords: vi.fn(async (_d: unknown, _r: unknown, _o: string, keys: Array<{ key: string }>) => keys.map(k => ({ key: k.key, value: 'v' }))),
    readAiFile: vi.fn(async () => null),
}));
vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async () => {
            model.calls++;
            if (model.hold) await new Promise<void>(resolve => model.release.push(resolve));
            return { content: 'the answer', usage: { costUsd: 0.001, totalTokens: 5 } };
        }),
    };
});

const { AiJobService } = await import('../../src/services/ai-jobs/service.js');

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const config = {
    nodeId: NODE, aiJobSlots: 2, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1, classificationMode: 'off',
    memoryQuotaMb: 100, memoryMaxKeysPerAgent: 1000, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 0,
} as unknown as AimeatConfig;

function memoryStorage(): { storage: Storage; rows: Map<string, MemoryRecord> } {
    const rows = new Map<string, MemoryRecord>();
    const storage = {
        getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}::${key}`),
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        createMemoryIfAbsent: async (r: MemoryRecord) => {
            if (rows.has(`${r.ownerGaii}::${r.key}`)) return false;
            rows.set(`${r.ownerGaii}::${r.key}`, r); return true;
        },
        setMemoryIfVersion: async (r: MemoryRecord, expected: number) => {
            if (rows.get(`${r.ownerGaii}::${r.key}`)?.version !== expected) return false;
            rows.set(`${r.ownerGaii}::${r.key}`, r); return true;
        },
        findApplicableSchema: async () => null,
        countMemory: async () => rows.size,
        sumMemoryBytes: async () => 0,
        getGHIIByOwner: async () => null,
        transaction: async <T>(fn: () => Promise<T>) => fn(),
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        getOwner: async () => null,
    } as unknown as Storage;
    return { storage, rows };
}

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));
const jobOf = (rows: Map<string, MemoryRecord>, id: string) => rows.get(`${OWNER}::ai.jobs.${id}`)?.value as Record<string, unknown> | undefined;
const logged = (rows: Map<string, MemoryRecord>) => [...rows.values()]
    .filter(r => r.key.startsWith('ai.jobs.log.'))
    .flatMap(r => r.value as Array<Record<string, unknown>>);

/** A job started on `before` and held in its model call, so the stored record says running. */
async function runningJob(storage: Storage): Promise<{ before: InstanceType<typeof AiJobService>; id: string }> {
    model.hold = true;
    const before = new AiJobService(config, storage);
    const { job_id } = await before.startJob({ prompt: 'Summarise.', result_key: 'out.summary' }, { ownerGhii: OWNER, createdBy: OWNER });
    for (let i = 0; i < 50 && model.calls === 0; i++) await settle(10);
    expect(model.calls).toBe(1);
    return { before, id: job_id };
}

beforeEach(() => { model.hold = false; model.calls = 0; model.release.length = 0; });

describe('a job running when the node stops', () => {
    it('continues after the next start and ends done', async () => {
        const { storage, rows } = memoryStorage();
        const { before, id } = await runningJob(storage);
        expect(await before.markStoppingJobs()).toBe(1);
        expect(jobOf(rows, id)).toMatchObject({ state: 'running' });
        expect(jobOf(rows, id)?.stopped_at).toBeTypeOf('string');

        model.hold = false;
        const after = new AiJobService(config, storage);
        expect(await after.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 1 });
        await settle();
        const end = logged(rows).find(j => j.id === id);
        expect(end, JSON.stringify(end?.error)).toMatchObject({ state: 'done', requeued_after_stop: 1 });
        expect(end?.stopped_at).toBeUndefined();
        expect(rows.get(`${OWNER}::out.summary`)?.value).toBe('the answer');
    });

    it('fails when the node stops it a second time', async () => {
        const { storage, rows } = memoryStorage();
        const { before, id } = await runningJob(storage);
        await before.markStoppingJobs();

        const middle = new AiJobService(config, storage);
        expect(await middle.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 1 });
        for (let i = 0; i < 50 && model.calls < 2; i++) await settle(10);
        expect(model.calls).toBe(2);
        await middle.markStoppingJobs();

        const last = new AiJobService(config, storage);
        expect(await last.reconcileAfterRestart()).toEqual({ failed: 1, requeued: 0 });
        expect(logged(rows).find(j => j.id === id)).toMatchObject({ state: 'failed', error: { code: 'node_restarted' } });
    });

    it('starts no queued job once the node is stopping', async () => {
        const { storage, rows } = memoryStorage();
        const service = new AiJobService(config, storage);
        await service.markStoppingJobs();
        const { job_id } = await service.startJob({ prompt: 'x', result_key: 'out.x' }, { ownerGhii: OWNER, createdBy: OWNER });
        await settle();
        expect(model.calls).toBe(0);
        expect(jobOf(rows, job_id)).toMatchObject({ state: 'queued' });
    });
});

describe('a job left running by a process that died without stopping', () => {
    it('fails at the next start, as before', async () => {
        const { storage, rows } = memoryStorage();
        const { id } = await runningJob(storage);
        const after = new AiJobService(config, storage);
        expect(await after.reconcileAfterRestart()).toEqual({ failed: 1, requeued: 0 });
        expect(logged(rows).find(j => j.id === id)).toMatchObject({ state: 'failed', error: { code: 'node_restarted' } });
    });
});
