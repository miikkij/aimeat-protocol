/**
 * @file test/unit/ai-job-viewer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read and stop a job when the lookup key is the OWNER's namespace rather than
 *   the caller's own (the MCP tools, src/mcp/ai-jobs.ts). The rule: a viewer sees and cancels only
 *   the jobs it started, unless it reads as the owner (owner-scope-read.ts readsAsOwner).
 *
 *   BOTH HALVES ARE ASSERTED, and the second is the one that keeps the REST routes working: a call
 *   with NO viewer still returns everything in the namespace, because those routes resolve the
 *   principal and look that identity's own namespace up (routes/ai-jobs.ts), so there is nothing
 *   left to fence. The same call with a viewer that did not start the job returns null, which is
 *   the behaviour the 2026-10 security audit found missing
 *   (mcp/ai-jobs.ts:registerAiJobTools:jobs-keyed-by-owner-ghii).
 *
 *   The provider call is the only thing mocked, and it HANGS, so both jobs stay live: a live record
 *   is the one that carries `prompt` and `system_prompt`, which is what the finding was about.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-viewer.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, jobs-keyed-by-owner-ghii).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        // Never answers on its own: the job reaches `running` and stays there.
        completeForOwner: vi.fn(() => new Promise(() => { /* held open */ })),
    };
});

const { AiJobService } = await import('../../src/services/ai-jobs/service.js');

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT_A = `claude#alice@${NODE}`;
const AGENT_B = `codex#alice@${NODE}`;

const config = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1,
} as unknown as AimeatConfig;

/** One in-memory namespace per owner, which is all the job store asks of storage. */
function memoryStorage(): Storage {
    const rows = new Map<string, MemoryRecord>();
    return {
        getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}::${key}`),
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        listMemoryForOwners: async () => [],
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        getAgent: async () => null,
    } as unknown as Storage;
}

const settle = () => new Promise(r => setTimeout(r, 40));

let service: InstanceType<typeof AiJobService>;
let agentJobId = '';
let ownerJobId = '';

beforeAll(async () => {
    service = new AiJobService(config, memoryStorage());
    // Both land in the OWNER's namespace, which is what the MCP tools do, and differ only in
    // `created_by`. The first takes the single slot and runs; the second queues behind it.
    const byAgent = await service.startJob(
        { prompt: 'AGENT A SECRET PROMPT', system_prompt: 'agent system prompt', result_key: 'out.agent' },
        { ownerGhii: OWNER, createdBy: AGENT_A },
    );
    agentJobId = byAgent.job_id;
    const byOwner = await service.startJob(
        { prompt: 'OWNER SECRET PROMPT', result_key: 'out.owner' },
        { ownerGhii: OWNER, createdBy: OWNER },
    );
    ownerJobId = byOwner.job_id;
    await settle();
});

const idsOf = (jobs: Array<{ id: string }>) => jobs.map(j => j.id).sort();

describe('a viewer that did not start the job', () => {
    const other = { principal: AGENT_B, all: false };

    it('is shown no job at all by listJobs', async () => {
        expect(await service.listJobs(OWNER, { state: 'all', viewer: other })).toEqual([]);
    });

    it('gets null from getJob for the owner\'s job and for a sibling agent\'s', async () => {
        expect(await service.getJob(OWNER, agentJobId, other)).toBeNull();
        expect(await service.getJob(OWNER, ownerJobId, other)).toBeNull();
    });

    it('is refused by cancelJob, and the jobs keep the state they had', async () => {
        await expect(service.cancelJob(OWNER, agentJobId, other)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
        await expect(service.cancelJob(OWNER, ownerJobId, other)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
        expect(await service.getJob(OWNER, agentJobId)).toMatchObject({ state: 'running' });
        expect(await service.getJob(OWNER, ownerJobId)).toMatchObject({ state: 'queued' });
    });
});

describe('a viewer that did start the job', () => {
    const starter = { principal: AGENT_A, all: false };

    it('reads it, prompt and all', async () => {
        expect(await service.getJob(OWNER, agentJobId, starter)).toMatchObject({
            id: agentJobId, created_by: AGENT_A, prompt: 'AGENT A SECRET PROMPT',
        });
    });

    it('lists its own job and not the owner\'s', async () => {
        const jobs = await service.listJobs(OWNER, { state: 'all', viewer: starter });
        expect(idsOf(jobs)).toEqual([agentJobId]);
    });
});

describe('reading as the owner, and the callers that pass no viewer', () => {
    it('a viewer with all: true sees every job of the owner and of the owner\'s agents', async () => {
        const jobs = await service.listJobs(OWNER, { state: 'all', viewer: { principal: AGENT_B, all: true } });
        expect(idsOf(jobs)).toEqual([agentJobId, ownerJobId].sort());
        expect(await service.getJob(OWNER, agentJobId, { principal: AGENT_B, all: true })).toMatchObject({ id: agentJobId });
    });

    it('no viewer reads the whole namespace, which is what the REST routes rely on', async () => {
        const jobs = await service.listJobs(OWNER, { state: 'all' });
        expect(idsOf(jobs)).toEqual([agentJobId, ownerJobId].sort());
        expect(await service.getJob(OWNER, ownerJobId)).toMatchObject({ id: ownerJobId });
    });
});
