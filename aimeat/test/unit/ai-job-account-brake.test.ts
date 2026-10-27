/**
 * @file test/unit/ai-job-account-brake.test.ts
 * @description The per-owner AI job queue brake (ai.job_max_queued_per_owner) and the slot pool's
 *   round-robin lane count the ACCOUNT, whichever of its principals started the job
 *   (secaudit2026oct26, services/ai-jobs/service.ts:countQueued:per-owner-queue-brake-keyed-on-principal).
 *   On POST /v1/ai/jobs a job's `owner` is the calling principal (an agent's GAII, a scoped access
 *   token's GAII), so an account with N such principals had N brakes and N lanes, and could fill the
 *   node-wide wait line that every other account shares. The job's namespace, its `created_by` and
 *   who may read or cancel it are unchanged: only the count and the lane are keyed on the account.
 * @usage pnpm exec vitest run test/unit/ai-job-account-brake.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        // Never answers: the first job holds the one slot, and every later one stays queued.
        completeForOwner: vi.fn(() => new Promise(() => { /* held open */ })),
    };
});

const { AiJobService } = await import('../../src/services/ai-jobs/service.js');

const NODE = 'aimeat-local-001-dev';
const ALICE = `alice@${NODE}`;
const AGENT_A = `claude#alice@${NODE}`;
const AGENT_B = `codex#alice@${NODE}`;
const BOB = `bob@${NODE}`;

const config = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 4, aiJobMaxQueuedPerOwner: 2,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1,
    memoryQuotaMb: 100, memoryMaxKeysPerAgent: 1000, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 0,
} as unknown as AimeatConfig;

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
        findApplicableSchema: async () => null,
        countMemory: async () => rows.size,
        sumMemoryBytes: async () => 0,
    } as unknown as Storage;
}

const settle = () => new Promise(r => setTimeout(r, 40));
let n = 0;
/** A start the way POST /v1/ai/jobs makes it: owner and created_by are the calling principal. */
const startAs = (service: InstanceType<typeof AiJobService>, principal: string) =>
    service.startJob({ prompt: `job ${++n}`, result_key: `out.${n}` }, { ownerGhii: principal, createdBy: principal });

let service: InstanceType<typeof AiJobService>;
beforeEach(async () => {
    service = new AiJobService(config, memoryStorage());
    // The first job takes the only slot and runs; everything after it queues.
    await startAs(service, ALICE);
    await settle();
});

describe('two agents of one account on the REST surface', () => {
    it('share one brake: the third queued job of the account is refused 429, and another account still starts', async () => {
        await startAs(service, AGENT_A);
        await startAs(service, AGENT_A);
        await expect(startAs(service, AGENT_B)).rejects.toMatchObject({ code: 'AI_JOB_LIMIT_REACHED', status: 429 });
        // Bob's start finds room in the node-wide wait line.
        await expect(startAs(service, BOB)).resolves.toMatchObject({ state: 'queued' });
    });

    it('wait in one lane of the slot pool, the account\'s', async () => {
        const acquire = vi.spyOn((service as unknown as { pool: { acquire: (k: string) => Promise<void> } }).pool, 'acquire');
        await startAs(service, AGENT_A);
        await startAs(service, BOB);
        await settle();
        expect(acquire.mock.calls.map(c => c[0])).toEqual([ALICE, BOB]);
    });
});

describe('what stays as it was', () => {
    it('one principal still has the whole brake: two queued, the third refused 429', async () => {
        await startAs(service, ALICE);
        await startAs(service, ALICE);
        await expect(startAs(service, ALICE)).rejects.toMatchObject({ code: 'AI_JOB_LIMIT_REACHED', status: 429 });
    });

    it('an agent\'s job stays in the agent\'s namespace with the agent as created_by, and the agent reads it', async () => {
        const started = await startAs(service, AGENT_A);
        const job = await service.getJob(AGENT_A, started.job_id, { principal: AGENT_A, all: false });
        expect(job).toMatchObject({ owner: AGENT_A, created_by: AGENT_A, state: 'queued' });
        await expect(service.cancelJob(AGENT_A, started.job_id, { principal: AGENT_A, all: false }))
            .resolves.toMatchObject({ state: 'cancelled' });
    });
});
