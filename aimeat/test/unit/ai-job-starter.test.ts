/**
 * @file test/unit/ai-job-starter.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An AI job remembers who started it and reads its inputs as that starter (TARGET-082
 *   V4, decided 2026-09-29). A job with no starter recorded reads as an AI, the strictest reader, and
 *   a scheduled job always does.
 *
 *   The one loader of what a model reads (services/ai-inputs.ts) is mocked and records the reader it
 *   was handed: that reader's kind is the evidence. The model call is mocked too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-starter.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord, ScheduledJobRecord } from '../../src/storage/interface.js';

/** Every reader the loader was handed, in order, with the capability it was asked for. */
const seen = vi.hoisted(() => ({ readers: [] as Array<{ kind: string; roles: string[] | undefined; capability: string }> }));

vi.mock('../../src/services/ai-inputs.js', () => {
    const note = (reader: { kind: string; auth: { roles?: string[] } | null }, capability: string) =>
        seen.readers.push({ kind: reader.kind, roles: reader.auth?.roles, capability });
    return {
        readAiRecords: vi.fn(async (_deps: unknown, reader: never, _owner: string, keys: Array<{ key: string }>, use: { capability: string }) => {
            note(reader, use.capability);
            return keys.map(k => ({ key: k.key, value: `value of ${k.key}` }));
        }),
        readAiFile: vi.fn(async (_s: unknown, reader: never, owner: string, key: string, use: { capability: string }) => {
            note(reader, use.capability);
            return { key, ownerGaii: owner, mimeType: 'audio/webm', size: 16, data: Buffer.alloc(16, 1) };
        }),
    };
});
vi.mock('../../src/services/ai/completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async () => ({ content: 'the answer', usage: { costUsd: 0.001, totalTokens: 5 } })),
    };
});
vi.mock('../../src/services/ai-transcription.js', () => ({
    transcribeForOwner: vi.fn(async () => ({
        text: 'heard', model: 'stub/stt', language: 'en', seconds: 1, usage: { totalTokens: 1, costUsd: 0.0001, costExact: true },
    })),
}));

const { AiJobService } = await import('../../src/services/ai-jobs/service.js');
const { startedByOf, jobReader, unattendedReader } = await import('../../src/services/ai-jobs/starter.js');
const { runAiJob } = await import('../../src/services/scheduler-remote-jobs.js');

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;

const config = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1, classificationMode: 'off',
} as unknown as AimeatConfig;

/** An owner namespace in a map, the audio file's metadata, and a note of every memory write. */
function memoryStorage(): { storage: Storage; rows: Map<string, MemoryRecord> } {
    const rows = new Map<string, MemoryRecord>();
    const storage = {
        getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
        setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}::${key}`),
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        getStorageFileMeta: async (owner: string, key: string) => owner === OWNER && key === 'voice/a.webm'
            ? { key, ownerGaii: owner, mimeType: 'audio/webm', size: 16 } : null,
    } as unknown as Storage;
    return { storage, rows };
}

const settle = () => new Promise(r => setTimeout(r, 30));
const person = () => startedByOf({ owner: 'alice', roles: ['owner'], scopes: [] }, OWNER);
const agent = () => startedByOf({ owner: 'alice', roles: ['agent'], scopes: ['ai:use', 'memory:read'] }, AGENT);

beforeEach(() => { seen.readers.length = 0; });

describe('a started job reads its inputs as its starter', () => {
    it.each([
        ['a person', person(), 'human'],
        ['an agent', agent(), 'ai'],
        ['an owner-level personal access token', startedByOf({ owner: 'alice', roles: ['owner'], scopes: [], via: 'pat' }, OWNER), 'ai'],
        ['nobody recorded', undefined, 'ai'],
    ])('%s', async (_label, startedBy, kind) => {
        const { storage } = memoryStorage();
        await new AiJobService(config, storage).startJob(
            { prompt: 'Summarise.', input_keys: ['notes.today'], result_key: 'out.summary' },
            { ownerGhii: OWNER, createdBy: startedBy?.principal ?? OWNER, ...(startedBy ? { startedBy } : {}) },
        );
        expect(seen.readers.map(r => r.kind)).toEqual([kind]);
    });

    it('stores the starter on the job record, and only the credential facts', async () => {
        const { storage, rows } = memoryStorage();
        const { job_id } = await new AiJobService(config, storage).startJob(
            { prompt: 'x', result_key: 'out.x' }, { ownerGhii: OWNER, createdBy: AGENT, startedBy: agent() },
        );
        const stored = rows.get(`${OWNER}::ai.jobs.${job_id}`)?.value as { started_by?: unknown } | undefined;
        expect(stored?.started_by).toEqual({ principal: AGENT, owner: 'alice', roles: ['agent'], scopes: ['ai:use', 'memory:read'] });
        await settle();
    });

    it('an unattended run holds role operator alone', () => {
        const r = unattendedReader({ storage: {} as Storage, config }, OWNER);
        expect(r.kind).toBe('ai');
        expect(r.auth?.roles).toEqual(['operator']);
        expect(r.identity).toBe(OWNER);
    });

    it('a transcription reads its audio as its starter, and as an AI with none', async () => {
        for (const [startedBy, kind] of [[person(), 'human'], [undefined, 'ai']] as const) {
            seen.readers.length = 0;
            const { storage } = memoryStorage();
            await new AiJobService(config, storage).startJob(
                { op: 'transcribe', audio_key: 'voice/a.webm', result_key: 'out.heard' },
                { ownerGhii: OWNER, createdBy: OWNER, ...(startedBy ? { startedBy } : {}) },
            );
            await settle();
            expect(seen.readers).toEqual([{ kind, roles: startedBy ? ['owner'] : ['operator'], capability: 'transcription' }]);
        }
    });
});

describe('a job brought back after a restart', () => {
    /** A queued job left in storage by a dead process, and the index entry that points at it. */
    async function leftQueued(storage: Storage, startedBy?: ReturnType<typeof person>): Promise<void> {
        const now = new Date().toISOString();
        const job = {
            id: 'job-1', state: 'queued', owner: OWNER, prompt: 'x', input_keys: ['notes.today'], op: 'text',
            result_key: 'out.x', result_visibility: 'private', chain_depth: 0, queued_at: now, created_by: OWNER,
            ...(startedBy ? { started_by: startedBy } : {}),
        };
        await storage.setMemory({ key: 'ai.jobs.job-1', ownerGaii: OWNER, value: job, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
        await storage.setMemory({ key: 'ai.jobs.active', ownerGaii: `system@${NODE}`, value: [{ jobId: 'job-1', ownerGhii: OWNER }], visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
    }

    it('reads as its recorded starter', async () => {
        const { storage } = memoryStorage();
        await leftQueued(storage, person());
        expect(await new AiJobService(config, storage).reconcileAfterRestart()).toMatchObject({ requeued: 1 });
        expect(seen.readers[0]?.kind).toBe('human');
        await settle();
    });

    it('reads as an AI when it was stored before starters were recorded', async () => {
        const { storage } = memoryStorage();
        await leftQueued(storage);
        expect(await new AiJobService(config, storage).reconcileAfterRestart()).toMatchObject({ requeued: 1 });
        expect(seen.readers[0]?.kind).toBe('ai');
        await settle();
    });
});

describe('a scheduled AI job', () => {
    it('always reads as an AI', async () => {
        const { storage } = memoryStorage();
        const job = { id: 'sched-1', kind: 'ai', ownerScope: OWNER, input: { prompt: 'Daily.', inputKeys: ['notes.today'] } } as unknown as ScheduledJobRecord;
        await runAiJob(storage, config, job);
        expect(seen.readers).toEqual([{ kind: 'ai', roles: ['operator'], capability: 'text' }]);
    });
});

describe('jobReader', () => {
    it('keeps the PAT mark of a recorded starter', () => {
        const deps = { storage: {} as Storage, config };
        const s = startedByOf({ owner: 'alice', roles: ['owner'], scopes: [], via: 'pat' }, OWNER);
        expect(s.via).toBe('pat');
        expect(jobReader(deps, { owner: OWNER, started_by: s }).kind).toBe('ai');
        expect(jobReader(deps, { owner: OWNER, started_by: person() }).kind).toBe('human');
    });
});
