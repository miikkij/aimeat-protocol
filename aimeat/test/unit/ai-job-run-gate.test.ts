/**
 * @file test/unit/ai-job-run-gate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the AI job runner asks before it spends anything (services/ai-jobs/run-gate.ts),
 *   with AiJobService instances on one in-memory storage standing for processes of one node:
 *   - a deactivated account's job waits queued, says why, pays nothing, and runs after reactivation;
 *     the same after a restart that queues a stopped job again (reclaimJobs:restarts-deactivated-account-job);
 *   - a job whose agent starter is gone ends before the provider is called; a narrowed starter's job
 *     runs with the narrower permissions, and loses on_done when ext:invoke went (older item O4);
 *   - with several processes, a cancel another process takes and a takeover stop the runner before
 *     it writes the answer or pays, the job is folded once, and a cancel heard on the bus aborts the
 *     call (service.ts:run/no-fencing-on-active-index-claim);
 *   - and what stays as it was: the owner's own job, an unchanged agent's job, one process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-run-gate.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { claimActiveEntry, readActiveIndex } from '../../src/services/ai-jobs/store.js';
import { emitRemote } from '../../src/services/event-bus.js';

/** The model call: held until released while `hold` is on, answered at once otherwise. */
const model = vi.hoisted(() => ({ hold: false, calls: 0, release: [] as Array<() => void> }));

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
type Service = InstanceType<typeof AiJobService>;

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT = `helper#alice@${NODE}`;
const APP = 'alice/tool.html';
const ECO = `eco:tool#alice@${NODE}`;
const base = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1, classificationMode: 'off',
    memoryQuotaMb: 100, memoryMaxKeysPerAgent: 1000, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 0,
};
const single = { ...base, port: 40001 } as unknown as AimeatConfig;
const procA = { ...base, port: 40001, nodeProcesses: 'multiple' } as unknown as AimeatConfig;
const procB = { ...base, port: 40002, nodeProcesses: 'multiple' } as unknown as AimeatConfig;

interface World {
    storage: Storage; rows: Map<string, MemoryRecord>;
    owner: { disabledAt?: string | null; createdAt?: string };
    agent: { defaultScopes: string[] } | null;
    /** The account was erased: no owner record (round 15). */
    erased?: boolean;
    /** alice's grant for APP, and the ecosystem app ECO (round 15). */
    appGrant?: { revoked?: boolean; scopes: string[] } | null;
    eco?: { status: string; scopes: string[] } | null;
}

function world(): World {
    const rows = new Map<string, MemoryRecord>();
    const w: World = { storage: undefined as unknown as Storage, rows, owner: { disabledAt: null }, agent: null };
    w.storage = {
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
        getMemoryTotals: async () => ({ keys: rows.size, bytes: 0 }),
        getGHIIByOwner: async () => null,
        transaction: async <T>(fn: () => Promise<T>) => fn(),
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        getOwner: async (name: string) => (name === 'alice' && !w.erased ? { name, ...w.owner } : null),
        getAgent: async (gaii: string) => (gaii === AGENT && w.agent ? { gaii, name: 'helper', owner: 'alice', ...w.agent } : null),
        listPats: async () => [],
        getAppGrantByOwnerAndApp: async (owner: string, app: string) => (owner === 'alice' && app === APP && w.appGrant && !w.appGrant.revoked
            ? { grantId: 'grant-1', owner, app, appName: 'Tool', ...w.appGrant } : null),
        getAppGrant: async (id: string) => (id === 'grant-1' && w.appGrant ? { grantId: id, owner: 'alice', app: APP, appName: 'Tool', ...w.appGrant } : null),
        getEcosystemApp: async (geai: string) => (geai === ECO && w.eco ? { geai, app: 'tool', displayName: 'Tool', owner: 'alice', ...w.eco } : null),
        // An ecosystem app's answer is stamped with a provenance row (memory-write.ts).
        createAiProvenance: async (r: unknown) => r,
    } as unknown as Storage;
    return w;
}

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2_000): Promise<void> {
    const began = Date.now();
    while (!cond()) { if (Date.now() - began > ms) return; await settle(10); }
}
const jobOf = (w: World, id: string) => w.rows.get(`${OWNER}::ai.jobs.${id}`)?.value as Record<string, any> | undefined;
const logged = (w: World, id: string) => [...w.rows.values()]
    .filter(r => r.ownerGaii === OWNER && r.key.startsWith('ai.jobs.log.'))
    .flatMap(r => r.value as Array<Record<string, any>>)
    .filter(e => e.id === id);
const answerOf = (w: World, key: string) => w.rows.get(`${OWNER}::${key}`)?.value;
const shorten = (s: Service) => { (s as unknown as { accountRecheckMs: number }).accountRecheckMs = 20; };
const startedByAgent = (scopes: string[]) => ({ principal: AGENT, owner: 'alice', roles: ['agent'], scopes });

beforeEach(() => { model.hold = false; model.calls = 0; model.release.length = 0; });

describe('a deactivated account (reclaimJobs:restarts-deactivated-account-job)', () => {
    it('its queued job waits, says why, pays nothing, and runs after reactivation', async () => {
        const w = world();
        w.owner.disabledAt = '2026-11-08T10:00:00.000Z';
        const s = new AiJobService(single, w.storage);
        shorten(s);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.wait' }, { ownerGhii: OWNER, createdBy: OWNER });
        await settle(120);
        expect(model.calls).toBe(0);
        expect(answerOf(w, 'out.wait')).toBeUndefined();
        expect(jobOf(w, job_id)).toMatchObject({ state: 'queued' });
        expect(jobOf(w, job_id)?.waiting).toMatch(/deactivated on 2026-11-08.*reactivates/);

        w.owner.disabledAt = null;
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(1);
        expect(logged(w, job_id)).toHaveLength(1);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'done' });
        expect(logged(w, job_id)[0].waiting).toBeUndefined();
        expect(answerOf(w, 'out.wait')).toBe('the answer');
    });

    it('a job the node stopped is queued again after the restart, and waits there too', async () => {
        const w = world();
        model.hold = true;
        const before = new AiJobService(single, w.storage);
        const { job_id } = await before.startJob({ prompt: 'x', result_key: 'out.restart' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => model.calls === 1);
        await before.markStoppingJobs();
        w.owner.disabledAt = '2026-11-08T10:00:00.000Z';
        model.hold = false;

        const after = new AiJobService(single, w.storage);
        shorten(after);
        expect(await after.reconcileAfterRestart()).toEqual({ failed: 0, requeued: 1 });
        await settle(120);
        expect(model.calls).toBe(1);
        expect(jobOf(w, job_id)).toMatchObject({ state: 'queued' });
        expect(answerOf(w, 'out.restart')).toBeUndefined();

        w.owner.disabledAt = null;
        await until(() => logged(w, job_id).length > 0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'done' });
        expect(model.calls).toBe(2);
        await after.markStoppingJobs();
    });

    it('a waiting job can be cancelled, and ends cancelled with nothing spent', async () => {
        const w = world();
        w.owner.disabledAt = '2026-11-08T10:00:00.000Z';
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.cw' }, { ownerGhii: OWNER, createdBy: OWNER });
        await settle(60);
        await expect(s.cancelJob(OWNER, job_id)).resolves.toMatchObject({ state: 'cancelled' });
        expect(model.calls).toBe(0);
    });
});

describe('the starter as it is now (older item O4)', () => {
    it('a job of an agent that is gone ends before the provider is called', async () => {
        const w = world();
        w.agent = null;
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.gone' },
            { ownerGhii: OWNER, createdBy: AGENT, startedBy: startedByAgent(['ai:use', 'memory:write']) });
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'failed', error: { code: 'AI_JOB_STARTER_GONE' } });
        expect(logged(w, job_id)[0].error.message).toMatch(/helper.*no longer connected/);
    });

    it('a narrowed agent\'s job runs with the permissions it holds now', async () => {
        const w = world();
        w.agent = { defaultScopes: ['ai:use'] };
        model.hold = true;
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.narrow' },
            { ownerGhii: OWNER, createdBy: AGENT, startedBy: startedByAgent(['ai:use', 'memory:read-as-owner']) });
        await until(() => model.calls === 1);
        expect(jobOf(w, job_id)?.started_by?.scopes).toEqual(['ai:use']);
        model.release.forEach(r => r());
    });

    it('a narrowed agent that lost ext:invoke does not run its on_done; the job ends before it pays', async () => {
        const w = world();
        w.agent = { defaultScopes: ['ai:use'] };
        const s = new AiJobService(single, w.storage);
        // Bound while the agent held ext:invoke: written as the start would have stored it.
        const job = {
            id: 'job-on-done', state: 'queued', owner: OWNER, prompt: 'x', op: 'text', result_key: 'out.cb', result_visibility: 'private',
            chain_depth: 0, queued_at: new Date().toISOString(), created_by: AGENT,
            started_by: startedByAgent(['ai:use', 'ext:invoke']), on_done: { extension: 'mine', action: 'go' },
        };
        await w.storage.setMemory({ key: 'ai.jobs.job-on-done', ownerGaii: OWNER, value: job, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: job.queued_at, updatedAt: job.queued_at } as MemoryRecord);
        await w.storage.setMemory({ key: 'ai.jobs.active', ownerGaii: `system@${NODE}`, value: [{ jobId: 'job-on-done', ownerGhii: OWNER }], visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: job.queued_at, updatedAt: job.queued_at } as MemoryRecord);
        await s.reconcileAfterRestart();
        await until(() => logged(w, 'job-on-done').length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, 'job-on-done')[0]).toMatchObject({ state: 'failed', error: { code: 'SCOPE_DENIED' } });
        await s.markStoppingJobs();
    });

    it('what stays: an unchanged agent\'s job and the owner\'s own job run to done as before', async () => {
        const w = world();
        w.agent = { defaultScopes: ['ai:use', 'memory:write'] };
        const s = new AiJobService(single, w.storage);
        const own = await s.startJob({ prompt: 'x', result_key: 'out.own' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => logged(w, own.job_id).length > 0);
        expect(logged(w, own.job_id)[0]).toMatchObject({ state: 'done' });
        model.hold = true;
        const agentJob = await s.startJob({ prompt: 'x', result_key: 'out.agent' },
            { ownerGhii: OWNER, createdBy: AGENT, startedBy: startedByAgent(['ai:use', 'memory:write']) });
        await until(() => model.calls === 2);
        expect(jobOf(w, agentJob.job_id)?.started_by?.scopes).toEqual(['ai:use', 'memory:write']);
        model.release.forEach(r => r());
    });
});

describe('several processes (service.ts:run/no-fencing-on-active-index-claim)', () => {
    it('a cancel taken by another process: the runner writes no answer and the job is folded once', async () => {
        const w = world();
        model.hold = true;
        const a = new AiJobService(procA, w.storage);
        const b = new AiJobService(procB, w.storage);
        const { job_id } = await a.startJob({ prompt: 'x', result_key: 'out.fence' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => model.calls === 1);
        await expect(b.cancelJob(OWNER, job_id)).resolves.toMatchObject({ state: 'cancelled' });

        model.release.forEach(r => r());
        await settle(120);
        expect(answerOf(w, 'out.fence')).toBeUndefined();
        expect(logged(w, job_id).map(e => e.state)).toEqual(['cancelled']);
        expect(a.stats().live).toBe(0);
    });

    it('a job another process took over is not paid for here', async () => {
        const w = world();
        model.hold = true;
        const a = new AiJobService(procA, w.storage);
        const first = await a.startJob({ prompt: 'x', result_key: 'out.first' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => model.calls === 1);
        const second = await a.startJob({ prompt: 'x', result_key: 'out.second' }, { ownerGhii: OWNER, createdBy: OWNER });
        // Process B judged A gone and claimed A's queued job (reclaim.ts adopt pass).
        const ref = (await readActiveIndex(w.storage, NODE)).find(r => r.jobId === second.job_id)!;
        expect(await claimActiveEntry(w.storage, NODE, second.job_id, ref.by, { name: 'other-host:40002', boot: 'b' })).toBe(true);

        model.hold = false;
        model.release.forEach(r => r());
        await until(() => logged(w, first.job_id).length > 0);
        await settle(120);
        expect(model.calls).toBe(1);
        expect(answerOf(w, 'out.second')).toBeUndefined();
        expect(logged(w, second.job_id)).toHaveLength(0);
        expect(a.stats().live).toBe(0);
    });

    it('a cancel heard on the bus aborts the job this process runs', async () => {
        const w = world();
        model.hold = true;
        const a = new AiJobService(procA, w.storage);
        await a.reconcileAfterRestart();
        const { job_id } = await a.startJob({ prompt: 'x', result_key: 'out.bus' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => model.calls === 1);
        const live = (a as unknown as { live: Map<string, { controller: AbortController }> }).live.get(job_id)!;
        emitRemote('aiJobCancel', { nodeId: NODE, jobId: job_id, timestamp: Date.now() });
        expect(live.controller.signal.aborted).toBe(true);
        model.release.forEach(r => r());
        await a.markStoppingJobs();
    });

    it('what stays: with several processes, a job nobody else touched runs to done once', async () => {
        const w = world();
        const a = new AiJobService(procA, w.storage);
        const { job_id } = await a.startJob({ prompt: 'x', result_key: 'out.plain' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => logged(w, job_id).length > 0);
        expect(logged(w, job_id).map(e => e.state)).toEqual(['done']);
        expect(answerOf(w, 'out.plain')).toBe('the answer');
        expect(model.calls).toBe(1);
    });
});

// ── round 15 (secaudit2026nov08b) ─────────────────────────────────────────────

/** What eraseOwner does to the account's records: the owner record and every record under its GHII go. */
function erase(w: World): void {
    w.erased = true;
    for (const [k, r] of w.rows) if (r.ownerGaii === OWNER) w.rows.delete(k);
}
const underOwner = (w: World) => [...w.rows.values()].filter(r => r.ownerGaii === OWNER).map(r => r.key);
const indexed = async (w: World, id: string) => (await readActiveIndex(w.storage, NODE)).some(r => r.jobId === id);

describe('an erased account (runGate:erased-account-runs-as-active)', () => {
    it('a waiting job of a deactivated account that is then erased is dropped: nothing is paid and nothing is written under the erased identity', async () => {
        const w = world();
        w.owner.disabledAt = '2026-11-08T10:00:00.000Z';
        const s = new AiJobService(single, w.storage);
        shorten(s);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.erased' }, { ownerGhii: OWNER, createdBy: OWNER });
        await settle(60);
        expect(jobOf(w, job_id)?.waiting).toMatch(/deactivated/);

        erase(w);
        await settle(200);
        expect(model.calls).toBe(0);
        expect(underOwner(w)).toEqual([]);
        expect(await indexed(w, job_id)).toBe(false);
        expect(s.stats().live).toBe(0);
    });

    it('the name registered again before the next check: the earlier holder\'s job does not run in the new account', async () => {
        const w = world();
        w.owner.disabledAt = '2026-11-08T10:00:00.000Z';
        const s = new AiJobService(single, w.storage);
        shorten(s);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.reused' }, { ownerGhii: OWNER, createdBy: OWNER });
        await settle(60);
        erase(w);
        // A new account under the same name, made after the job was queued.
        w.erased = false;
        w.owner = { disabledAt: null, createdAt: new Date(Date.now() + 1_000).toISOString() };
        await settle(200);
        expect(model.calls).toBe(0);
        expect(underOwner(w)).toEqual([]);
        expect(await indexed(w, job_id)).toBe(false);
    });

    it('the erasure stops the account\'s running and queued jobs in this process: no answer, no day log, no index entry', async () => {
        const w = world();
        model.hold = true;
        const s = new AiJobService(single, w.storage);
        const running = await s.startJob({ prompt: 'x', result_key: 'out.running' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => model.calls === 1);
        const queued = await s.startJob({ prompt: 'x', result_key: 'out.queued' }, { ownerGhii: OWNER, createdBy: AGENT });
        erase(w);
        expect(await s.dropAccountJobs(OWNER)).toBe(2);
        model.hold = false;
        model.release.forEach(r => r());
        await settle(150);
        expect(model.calls).toBe(1);
        expect(underOwner(w)).toEqual([]);
        expect(await indexed(w, running.job_id)).toBe(false);
        expect(await indexed(w, queued.job_id)).toBe(false);
        expect(s.stats().live).toBe(0);
    });

    it('what stays: another account\'s job is not touched by the erasure, and runs to done', async () => {
        const w = world();
        const s = new AiJobService(single, w.storage);
        expect(await s.dropAccountJobs(`bob@${NODE}`)).toBe(0);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.kept' }, { ownerGhii: OWNER, createdBy: OWNER });
        await until(() => logged(w, job_id).length > 0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'done' });
        expect(answerOf(w, 'out.kept')).toBe('the answer');
    });
});

const startedByApp = (scopes: string[]) => ({ principal: OWNER, owner: 'alice', roles: ['app'], scopes, app: APP });
const startedByEco = (scopes: string[]) => ({ principal: ECO, owner: 'alice', roles: ['ecosystem'], scopes });

describe('the starter\'s permission to start, asked again (runGate:start-permission-not-reasked)', () => {
    it('an agent the owner took ai:use from: its queued job ends before the provider is called, with the address to give it back', async () => {
        const w = world();
        w.agent = { defaultScopes: ['memory:write'] };
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.noai' },
            { ownerGhii: OWNER, createdBy: AGENT, startedBy: startedByAgent(['ai:use', 'memory:write']) });
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'failed', error: { code: 'SCOPE_DENIED' } });
        // ai:use is a word the person ticks on the agent's own page (config/posture.ts POWERFUL_AGENT_SCOPES).
        expect(logged(w, job_id)[0].error.message).toMatch(/helper.*AI.*\/v1\/profile\?tab=agents&agent=helper.*yourself/);
        expect(answerOf(w, 'out.noai')).toBeUndefined();
    });

    it('an app whose grant the owner revoked: its queued job ends AI_JOB_STARTER_GONE before the provider is called', async () => {
        const w = world();
        w.appGrant = { revoked: true, scopes: ['ai:use'] };
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.appgone' },
            { ownerGhii: OWNER, createdBy: OWNER, startedBy: startedByApp(['ai:use']) });
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'failed', error: { code: 'AI_JOB_STARTER_GONE' } });
        expect(answerOf(w, 'out.appgone')).toBeUndefined();
    });

    it('an app whose grant the owner narrowed without ai:use: the job ends SCOPE_DENIED before the provider is called', async () => {
        const w = world();
        w.appGrant = { scopes: ['memory:read'] };
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.appnoai' },
            { ownerGhii: OWNER, createdBy: OWNER, startedBy: startedByApp(['ai:use', 'memory:read']) });
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'failed', error: { code: 'SCOPE_DENIED' } });
    });

    it('an ecosystem app the owner disconnected: its queued job ends AI_JOB_STARTER_GONE before the provider is called', async () => {
        const w = world();
        w.eco = { status: 'revoked', scopes: ['ai:use'] };
        const s = new AiJobService(single, w.storage);
        const { job_id } = await s.startJob({ prompt: 'x', result_key: 'out.ecogone' },
            { ownerGhii: OWNER, createdBy: ECO, startedBy: startedByEco(['ai:use']) });
        await until(() => logged(w, job_id).length > 0);
        expect(model.calls).toBe(0);
        expect(logged(w, job_id)[0]).toMatchObject({ state: 'failed', error: { code: 'AI_JOB_STARTER_GONE' } });
    });

    it('what stays: a live app\'s job and a live ecosystem app\'s job run to done with the permissions they stored', async () => {
        const w = world();
        w.appGrant = { scopes: ['ai:use'] };
        w.eco = { status: 'active', scopes: ['ai:use'] };
        const s = new AiJobService(single, w.storage);
        const app = await s.startJob({ prompt: 'x', result_key: 'out.applive' },
            { ownerGhii: OWNER, createdBy: OWNER, startedBy: startedByApp(['ai:use']) });
        await until(() => logged(w, app.job_id).length > 0);
        expect(logged(w, app.job_id)[0]).toMatchObject({ state: 'done', started_by: { scopes: ['ai:use'] } });
        const eco = await s.startJob({ prompt: 'x', result_key: 'out.ecolive' },
            { ownerGhii: OWNER, createdBy: ECO, startedBy: startedByEco(['ai:use']) });
        await until(() => logged(w, eco.job_id).length > 0);
        expect(logged(w, eco.job_id)[0]).toMatchObject({ state: 'done' });
        expect(model.calls).toBe(2);
    });
});
