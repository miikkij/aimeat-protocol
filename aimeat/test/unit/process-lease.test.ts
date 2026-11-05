/**
 * @file test/unit/process-lease.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run-once work with more than one node process on one database (services/process-lease.ts):
 *   which process is alive, who holds a lease, which process runs a sweep's round, and which AI jobs a
 *   process takes over (services/ai-jobs/reclaim.ts). "Another process" is a lease record written under
 *   another process name, which is what a second process leaves in the database; this process is the
 *   test's own. The rule that keeps one process unchanged is asserted beside each: this process's own
 *   name always runs its sweep, its previous start is never alive, and a job no live process holds is
 *   decided at the start exactly as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/process-lease.test.ts
 * @version-history
 *   v1.1.0 -- 2026-11-05 -- The several-process cases run with nodeProcesses 'multiple' (Jouni 2026-11-05,
 *     decision 6a); new cases for the one-process default (codebase analysis 2026-11-03, decision 6a).
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item HA 2.5-2.7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

const model = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/services/ai/inputs.js', () => ({
    readAiRecords: vi.fn(async (_d: unknown, _r: unknown, _o: string, keys: Array<{ key: string }>) => keys.map(k => ({ key: k.key, value: 'v' }))),
    readAiFile: vi.fn(async () => null),
}));
vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async () => { model.calls++; return { content: 'the answer', usage: { costUsd: 0.001, totalTokens: 5 } }; }),
    };
});

const lease = await import('../../src/services/process-lease.js');
const { reclaimJobs } = await import('../../src/services/ai-jobs/reclaim.js');
const { AiJobService } = await import('../../src/services/ai-jobs/service.js');

const NODE = 'aimeat-lease-unit';
const SYSTEM = `system@${NODE}`;
const OWNER = `alice@${NODE}`;
// The cases below describe several processes on one database, so the node allows them: nodeProcesses
// 'multiple' (Jouni 2026-11-05, decision 6a: one process is the default, and several are switched on
// with this setting). The one-process default has its own cases at the end, on `single`.
const config = {
    nodeId: NODE, port: 40999, nodeProcesses: 'multiple', aiJobSlots: 2, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1, classificationMode: 'off',
    memoryQuotaMb: 100, memoryMaxKeysPerAgent: 1000, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 0,
} as unknown as AimeatConfig;

function memoryStorage(): { storage: Storage; rows: Map<string, MemoryRecord> } {
    const rows = new Map<string, MemoryRecord>();
    const id = (owner: string, key: string) => `${owner}::${key}`;
    const storage = {
        getMemory: async (owner: string, key: string) => rows.get(id(owner, key)) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(id(r.ownerGaii, r.key), r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(id(owner, key)),
        bulkDeleteMemory: async (refs: Array<{ ownerGaii: string; key: string }>) => refs.filter(r => rows.delete(id(r.ownerGaii, r.key))).length,
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        createMemoryIfAbsent: async (r: MemoryRecord) => {
            if (rows.has(id(r.ownerGaii, r.key))) return null;
            rows.set(id(r.ownerGaii, r.key), r); return r;
        },
        setMemoryIfVersion: async (r: MemoryRecord, expected: number) => {
            if (rows.get(id(r.ownerGaii, r.key))?.version !== expected) return null;
            rows.set(id(r.ownerGaii, r.key), r); return r;
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

function put(rows: Map<string, MemoryRecord>, owner: string, key: string, value: unknown): void {
    const now = new Date().toISOString();
    rows.set(`${owner}::${key}`, { key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

const OTHER = { name: 'other-host:40998', boot: 'other-boot' };
/** What a live (or, with `ms` <= 0, a run-out) second process leaves: its process lease. */
function otherProcess(rows: Map<string, MemoryRecord>, ms = 30_000): void {
    put(rows, SYSTEM, `lease.process.${OTHER.name}`, { ...OTHER, until: new Date(Date.now() + ms).toISOString(), startedAt: new Date().toISOString() });
}

afterEach(async () => { await lease.releaseProcessLease(); });
beforeEach(() => { model.calls = 0; });

describe('which process is alive', () => {
    it('this process is; its previous start is not; another one while its lease stands', async () => {
        const { storage, rows } = memoryStorage();
        const me = lease.thisProcess(config);
        expect(me.name.endsWith(':40999')).toBe(true);
        expect(await lease.holderAlive(storage, config, me)).toBe(true);
        expect(await lease.holderAlive(storage, config, { name: me.name, boot: 'an-earlier-start' })).toBe(false);
        expect(await lease.holderAlive(storage, config, undefined)).toBe(false);
        expect(await lease.holderAlive(storage, config, OTHER)).toBe(false);
        otherProcess(rows);
        expect(await lease.holderAlive(storage, config, OTHER)).toBe(true);
        expect(await lease.holderAlive(storage, config, { ...OTHER, boot: 'its-earlier-start' })).toBe(false);
        expect(await lease.otherProcessAlive(storage, config)).toBe(true);
        otherProcess(rows, -1);
        expect(await lease.holderAlive(storage, config, OTHER)).toBe(false);
        expect(await lease.otherProcessAlive(storage, config)).toBe(false);
    });

    it('a process writes its lease at the start and runs it out at the stop', async () => {
        const { storage, rows } = memoryStorage();
        await lease.startProcessLease(storage, config);
        const key = `${SYSTEM}::lease.process.${lease.thisProcess(config).name}`;
        const until = Date.parse((rows.get(key)?.value as { until: string }).until);
        expect(until).toBeGreaterThan(Date.now() + lease.PROCESS_LEASE_MS - 5_000);
        await lease.releaseProcessLease();
        expect(Date.parse((rows.get(key)?.value as { until: string }).until)).toBeLessThanOrEqual(Date.now());
    });
});

describe('a held lease', () => {
    it('is taken when free, kept by its holder, refused while another live process holds it', async () => {
        const { storage, rows } = memoryStorage();
        expect(await lease.takeHeldLease(storage, config, 'scheduler.activate')).toBe(true);
        expect(await lease.takeHeldLease(storage, config, 'scheduler.activate')).toBe(true);

        put(rows, SYSTEM, 'lease.wf-run.r1', { ...OTHER, at: new Date().toISOString() });
        otherProcess(rows);
        expect(await lease.takeHeldLease(storage, config, 'wf-run.r1')).toBe(false);
        otherProcess(rows, -1);
        expect(await lease.takeHeldLease(storage, config, 'wf-run.r1')).toBe(true);
        await lease.releaseHeldLease(storage, config, 'wf-run.r1');
        expect(rows.has(`${SYSTEM}::lease.wf-run.r1`)).toBe(false);
    });

    it('held by this process in an earlier start is taken back at once (one process, a restart)', async () => {
        const { storage, rows } = memoryStorage();
        put(rows, SYSTEM, 'lease.scheduler.activate', { name: lease.thisProcess(config).name, boot: 'an-earlier-start', at: new Date().toISOString() });
        expect(await lease.takeHeldLease(storage, config, 'scheduler.activate')).toBe(true);
    });
});

describe('a sweep round', () => {
    it('this process name always runs it, as one process did', async () => {
        const { storage } = memoryStorage();
        for (let i = 0; i < 3; i++) expect(await lease.claimSweepTick(storage, config, 'memory-bin', 3_600_000)).toBe(true);
    });

    it('stays with another process that runs it; is taken over once that process stops running it', async () => {
        const { storage, rows } = memoryStorage();
        put(rows, SYSTEM, 'lease.sweep.memory-bin', { ...OTHER, at: new Date(Date.now() - 60_000).toISOString() });
        expect(await lease.claimSweepTick(storage, config, 'memory-bin', 3_600_000)).toBe(false);
        put(rows, SYSTEM, 'lease.sweep.memory-bin', { ...OTHER, at: new Date(Date.now() - 80 * 60_000).toISOString() });
        expect(await lease.claimSweepTick(storage, config, 'memory-bin', 3_600_000)).toBe(false);
        put(rows, SYSTEM, 'lease.sweep.memory-bin', { ...OTHER, at: new Date(Date.now() - 91 * 60_000).toISOString() });
        expect(await lease.claimSweepTick(storage, config, 'memory-bin', 3_600_000)).toBe(true);
        expect((rows.get(`${SYSTEM}::lease.sweep.memory-bin`)?.value as { name: string }).name).toBe(lease.thisProcess(config).name);
    });

    it('a storage that fails lets the sweep run', async () => {
        const { storage } = memoryStorage();
        (storage as unknown as { getMemory: () => Promise<never> }).getMemory = async () => { throw new Error('down'); };
        expect(await lease.claimSweepTick(storage, config, 'memory-bin', 3_600_000)).toBe(true);
    });
});

describe('AI jobs another process holds', () => {
    function queuedJob(rows: Map<string, MemoryRecord>, id: string, by?: { name: string; boot: string }): void {
        put(rows, OWNER, `ai.jobs.${id}`, { id, state: 'queued', owner: OWNER, op: 'text', prompt: 'p', result_key: `out.${id}`, result_visibility: 'private', chain_depth: 0, queued_at: new Date().toISOString(), created_by: OWNER });
        const index = (rows.get(`${SYSTEM}::ai.jobs.active`)?.value as unknown[] | undefined) ?? [];
        put(rows, SYSTEM, 'ai.jobs.active', [...index, { jobId: id, ownerGhii: OWNER, ...(by ? { by } : {}) }]);
    }
    const settle = () => new Promise(r => setTimeout(r, 40));

    it('are left to it while it lives, and taken over once its lease runs out', async () => {
        const { storage, rows } = memoryStorage();
        otherProcess(rows);
        queuedJob(rows, 'j-other', OTHER);
        const service = new AiJobService(config, storage);
        expect(await service.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 0 });
        await settle();
        expect(model.calls).toBe(0);

        otherProcess(rows, -1);
        const deps = { storage, config, isLive: () => false, enqueue: async () => { model.calls++; } };
        expect(await reclaimJobs(deps, 'adopt')).toEqual({ failed: 0, requeued: 1 });
        const entry = (rows.get(`${SYSTEM}::ai.jobs.active`)?.value as Array<{ jobId: string; by?: { name: string } }>)[0];
        expect(entry.by?.name).toBe(lease.thisProcess(config).name);
        // Taken once: a second pass finds it held by this process.
        expect(await reclaimJobs(deps, 'adopt')).toEqual({ failed: 0, requeued: 0 });
        await service.markStoppingJobs();
    });

    it('a job with no holder, or held by this process in an earlier start, is decided at the start as before', async () => {
        const { storage, rows } = memoryStorage();
        queuedJob(rows, 'j-old');
        queuedJob(rows, 'j-mine', { name: lease.thisProcess(config).name, boot: 'an-earlier-start' });
        const service = new AiJobService(config, storage);
        expect(await service.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 2 });
        await settle();
        expect(model.calls).toBe(2);
        await service.markStoppingJobs();
    });

    it('the adoption pass leaves a job of this process name and a job with no holder alone', async () => {
        const { storage, rows } = memoryStorage();
        queuedJob(rows, 'j-old');
        queuedJob(rows, 'j-mine', { name: lease.thisProcess(config).name, boot: 'an-earlier-start' });
        const deps = { storage, config, isLive: () => false, enqueue: async () => { model.calls++; } };
        expect(await reclaimJobs(deps, 'adopt')).toEqual({ failed: 0, requeued: 0 });
        expect(model.calls).toBe(0);
    });

    it('a start names this process on the job', async () => {
        const { storage, rows } = memoryStorage();
        const service = new AiJobService(config, storage);
        const { job_id } = await service.startJob({ prompt: 'Summarise.', result_key: 'out.s' }, { ownerGhii: OWNER, createdBy: OWNER });
        const index = rows.get(`${SYSTEM}::ai.jobs.active`)?.value as Array<{ jobId: string; by?: unknown }> | undefined;
        expect(index?.find(e => e.jobId === job_id)?.by).toEqual(lease.thisProcess(config));
        await settle();
        await service.markStoppingJobs();
    });
});

// One process per node, the default (node.processes = single; decision 6a of 2026-11-05). A lease
// record of another name is what a previous process left, for example a container recreated with a
// new hostname: no other live process can exist, so this process takes its work at once.
describe('one process per node (the default)', () => {
    const single = { ...config, nodeProcesses: 'single' } as unknown as AimeatConfig;
    const unset = { ...config, nodeProcesses: undefined } as unknown as AimeatConfig;

    it('is the default: only the word multiple allows several processes', () => {
        expect(lease.singleProcess(single)).toBe(true);
        expect(lease.singleProcess(unset)).toBe(true);
        expect(lease.singleProcess(config)).toBe(false);
    });

    it('counts no holder but this process in this start as alive, whatever lease another name keeps', async () => {
        const { storage, rows } = memoryStorage();
        otherProcess(rows, 10 * 60_000);
        const me = lease.thisProcess(single);
        expect(await lease.holderAlive(storage, single, me)).toBe(true);
        expect(await lease.holderAlive(storage, single, { name: me.name, boot: 'an-earlier-start' })).toBe(false);
        expect(await lease.holderAlive(storage, single, OTHER)).toBe(false);
        expect(await lease.otherProcessAlive(storage, single)).toBe(false);
        // The same records, with several processes allowed, keep the other process alive.
        expect(await lease.holderAlive(storage, config, OTHER)).toBe(true);
        expect(await lease.otherProcessAlive(storage, config)).toBe(true);
    });

    it('takes the start-up lease and a run lock at once while a previous name\'s lease stands', async () => {
        const { storage, rows } = memoryStorage();
        otherProcess(rows, 10 * 60_000);
        put(rows, SYSTEM, 'lease.scheduler.activate', { ...OTHER, at: new Date().toISOString() });
        put(rows, SYSTEM, 'lease.wf-run.r1', { ...OTHER, at: new Date().toISOString() });
        expect(await lease.takeHeldLease(storage, single, 'scheduler.activate')).toBe(true);
        expect((rows.get(`${SYSTEM}::lease.scheduler.activate`)?.value as { name: string }).name).toBe(lease.thisProcess(single).name);
        const began = Date.now();
        await lease.waitForHeldLease(storage, single, 'wf-run.r1', 60_000);
        expect(Date.now() - began).toBeLessThan(1_000);
        await lease.releaseHeldLease(storage, single, 'wf-run.r1');
        expect(rows.has(`${SYSTEM}::lease.wf-run.r1`)).toBe(false);
    });

    it('runs every sweep round, whichever name ran it last', async () => {
        const { storage, rows } = memoryStorage();
        put(rows, SYSTEM, 'lease.sweep.memory-bin', { ...OTHER, at: new Date(Date.now() - 60_000).toISOString() });
        expect(await lease.claimSweepTick(storage, single, 'memory-bin', 3_600_000)).toBe(true);
        expect((rows.get(`${SYSTEM}::lease.sweep.memory-bin`)?.value as { name: string }).name).toBe(lease.thisProcess(single).name);
        expect(await lease.claimSweepTick(storage, single, 'memory-bin', 3_600_000)).toBe(true);
    });

    it('takes a previous name\'s queued AI job at its start, while that name\'s lease stands', async () => {
        const { storage, rows } = memoryStorage();
        otherProcess(rows, 10 * 60_000);
        put(rows, OWNER, 'ai.jobs.j-prev', { id: 'j-prev', state: 'queued', owner: OWNER, op: 'text', prompt: 'p', result_key: 'out.j-prev', result_visibility: 'private', chain_depth: 0, queued_at: new Date().toISOString(), created_by: OWNER });
        put(rows, SYSTEM, 'ai.jobs.active', [{ jobId: 'j-prev', ownerGhii: OWNER, by: OTHER }]);
        const service = new AiJobService(single, storage);
        expect(await service.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 1 });
        await new Promise(r => setTimeout(r, 40));
        expect(model.calls).toBe(1);
        const entry = (rows.get(`${SYSTEM}::ai.jobs.active`)?.value as Array<{ jobId: string; by?: { name: string } }> | undefined)?.find(e => e.jobId === 'j-prev');
        expect(entry === undefined || entry.by?.name === lease.thisProcess(single).name).toBe(true);
        await service.markStoppingJobs();
    });

    it('runs no adoption pass: a job another name started after this start is left to it', async () => {
        const { storage, rows } = memoryStorage();
        otherProcess(rows, -1);
        put(rows, OWNER, 'ai.jobs.j-later', { id: 'j-later', state: 'running', owner: OWNER, op: 'text', prompt: 'p', result_key: 'out.j-later', result_visibility: 'private', chain_depth: 0, queued_at: new Date().toISOString(), created_by: OWNER });
        put(rows, SYSTEM, 'ai.jobs.active', [{ jobId: 'j-later', ownerGhii: OWNER, by: OTHER }]);
        const deps = { storage, config: single, isLive: () => false, enqueue: async () => { model.calls++; } };
        expect(await reclaimJobs(deps, 'adopt')).toEqual({ failed: 0, requeued: 0 });
        expect((rows.get(`${OWNER}::ai.jobs.j-later`)?.value as { state: string }).state).toBe('running');
        expect((rows.get(`${SYSTEM}::ai.jobs.active`)?.value as Array<{ by?: { name: string } }>)[0].by?.name).toBe(OTHER.name);
        expect(model.calls).toBe(0);
    });
});
