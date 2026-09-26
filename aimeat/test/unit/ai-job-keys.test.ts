/**
 * @file test/unit/ai-job-keys.test.ts
 * @description An AI job and a scheduled AI job read no record the node keeps for itself into a
 *   prompt, and write no answer over one (services/ai-job-keys.ts).
 *
 *   Both kinds of job send every record they read to the model provider, and write the answer at a
 *   key the caller names. Before this rule the AI job refused only a reserved RESULT key, and the
 *   scheduled AI job refused nothing: an input key naming a credential record or a key the node acts
 *   on was read and sent, and an output key naming one was written. What reached the provider and
 *   what storage was asked to read and write are the evidence here; the provider is the only thing
 *   mocked.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-keys.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09: A6-1, 573704db10ed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord, ScheduledJobRecord } from '../../src/storage/interface.js';

/** Every prompt a completion was asked for: what would have left the node. */
const sentToProvider: string[] = [];

vi.mock('../../src/services/ai-completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async (_s: unknown, _c: unknown, _o: unknown, input: { prompt: string }) => {
            sentToProvider.push(input.prompt);
            return { content: 'the answer', usage: { costUsd: 0, totalTokens: 1 } };
        }),
    };
});

const { AiJobService } = await import('../../src/services/ai-jobs/service.js');
const { assembleJobPrompt } = await import('../../src/services/ai-jobs/prompt.js');
const { createScheduleRecord, updateScheduleRecord } = await import('../../src/services/schedule-write.js');
const { runAiJob } = await import('../../src/services/scheduler-remote-jobs.js');

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const SECRET = 'sk-or-v1-the-owners-own-key';

const config = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7,
} as unknown as AimeatConfig;

/** One of each kind the rule covers: a prefix the node acts on, a credential record, a key only the node writes. */
const KEPT_BY_THE_NODE = [
    'openrouter.apikey', 'openrouter.settings', 'decide.apikey', 'decide.apikey.agent.bot',
    'commerce.psp', 'ai-usage.daily', 'notif.1234', '__redirect__',
];

interface Watched {
    storage: Storage;
    /** `owner::key` of every getMemory the code under test made. */
    reads: string[];
    /** `owner::key` of every setMemory. */
    writes: string[];
    createdSchedules: ScheduledJobRecord[];
    updatedSchedules: string[];
}

/** An owner namespace holding the node's records beside the owner's own, and a note of every touch. */
function watchedStorage(seed: Record<string, unknown> = {}, schedules: ScheduledJobRecord[] = []): Watched {
    const rows = new Map<string, MemoryRecord>();
    const now = new Date().toISOString();
    const put = (owner: string, key: string, value: unknown) => rows.set(`${owner}::${key}`, {
        key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
        createdAt: now, updatedAt: now,
    } as MemoryRecord);
    for (const key of KEPT_BY_THE_NODE) put(OWNER, key, { ciphertext: SECRET });
    put(OWNER, 'notes.today', 'The harbour vote was 7-2.');
    for (const [k, v] of Object.entries(seed)) {
        const [owner, key] = k.includes('::') ? k.split('::') : [OWNER, k];
        put(owner, key, v);
    }
    const w: Watched = { reads: [], writes: [], createdSchedules: [], updatedSchedules: [], storage: undefined as unknown as Storage };
    w.storage = {
        getMemory: async (owner: string, key: string) => { w.reads.push(`${owner}::${key}`); return rows.get(`${owner}::${key}`) ?? null; },
        setMemory: async (r: MemoryRecord) => { w.writes.push(`${r.ownerGaii}::${r.key}`); rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}::${key}`),
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        listMemoryForOwners: async () => [],
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        getAgent: async () => null,
        createScheduledJob: async (job: ScheduledJobRecord) => { w.createdSchedules.push(job); return job; },
        getScheduledJob: async (id: string) => schedules.find(s => s.id === id) ?? null,
        updateScheduledJob: async (id: string, patch: Partial<ScheduledJobRecord>) => {
            w.updatedSchedules.push(id);
            const s = schedules.find(x => x.id === id);
            return s ? { ...s, ...patch } : null;
        },
    } as unknown as Storage;
    return w;
}

/** Whatever of the node's own records a watched run touched. */
const touchedKept = (w: Watched) => [...w.reads, ...w.writes]
    .filter(t => KEPT_BY_THE_NODE.some(k => t === `${OWNER}::${k}`));

/** Let a job the old code accepted run to its end, so a failing case shows what it would have done. */
const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(() => { sentToProvider.length = 0; });

describe('an AI job and the records the node keeps', () => {
    it('refuses at the start an input_keys entry naming one, and reads, sends and writes nothing', async () => {
        for (const key of KEPT_BY_THE_NODE) {
            const w = watchedStorage();
            const service = new AiJobService(config, w.storage);
            await expect(service.startJob(
                { prompt: 'Summarise.', input_keys: ['notes.today', key], result_key: 'out.summary' },
                { ownerGhii: OWNER, createdBy: OWNER },
            ), key).rejects.toMatchObject({ code: 'RESERVED_KEY', status: 403 });
            await settle();
            expect(touchedKept(w), key).toEqual([]);
            expect(w.writes, key).toEqual([]);
        }
        expect(sentToProvider.join('\n')).not.toContain(SECRET);
        expect(sentToProvider).toEqual([]);
    });

    it('refuses a prompt_key naming one', async () => {
        for (const key of ['openrouter.apikey', 'decide.policy', 'notif.1234']) {
            const w = watchedStorage();
            const service = new AiJobService(config, w.storage);
            await expect(service.startJob({ prompt_key: key, result_key: 'out.summary' }, { ownerGhii: OWNER, createdBy: OWNER }), key)
                .rejects.toMatchObject({ code: 'RESERVED_KEY', status: 403 });
            await settle();
            expect(touchedKept(w), key).toEqual([]);
        }
        expect(sentToProvider).toEqual([]);
    });

    it('refuses a result_key naming one, with the code every memory door answers', async () => {
        for (const key of ['openrouter.apikey', 'commerce.psp', 'notif.1234', '__redirect__', 'ai-usage.daily']) {
            const w = watchedStorage();
            const service = new AiJobService(config, w.storage);
            await expect(service.startJob({ prompt: 'x', result_key: key }, { ownerGhii: OWNER, createdBy: OWNER }), key)
                .rejects.toMatchObject({ code: 'RESERVED_KEY', status: 403 });
            await settle();
            expect(w.writes, key).toEqual([]);
        }
        expect(sentToProvider).toEqual([]);
    });

    it('asks again where the prompt is assembled, so a job stored before the rule reads nothing kept', async () => {
        const w = watchedStorage();
        await expect(assembleJobPrompt({ storage: w.storage, config }, OWNER, { prompt: 'x', input_keys: ['notes.today', 'commerce.psp'] }))
            .rejects.toMatchObject({ code: 'RESERVED_KEY', status: 403 });
        expect(touchedKept(w)).toEqual([]);
    });

    it('a restart fails a queued job that names one, rather than running it', async () => {
        const stored = (id: string, over: Record<string, unknown>) => ({
            id, state: 'queued', owner: OWNER, prompt: 'x', result_key: 'out.summary',
            result_visibility: 'private', chain_depth: 0, queued_at: new Date().toISOString(), created_by: OWNER, ...over,
        });
        const w = watchedStorage({
            [`system@${NODE}::ai.jobs.active`]: [{ jobId: 'j-in', ownerGhii: OWNER }, { jobId: 'j-out', ownerGhii: OWNER }],
            'ai.jobs.j-in': stored('j-in', { input_keys: ['decide.apikey'] }),
            'ai.jobs.j-out': stored('j-out', { result_key: 'notif.1234' }),
        });
        const service = new AiJobService(config, w.storage);
        const out = await service.reconcileAfterRestart();
        await settle();
        expect(out).toEqual({ failed: 2, requeued: 0 });
        expect(touchedKept(w)).toEqual([]);
        expect(sentToProvider).toEqual([]);
    });

    it('still runs a job over the owner\'s own records', async () => {
        const w = watchedStorage();
        const service = new AiJobService(config, w.storage);
        const started = await service.startJob(
            { prompt: 'Summarise.', input_keys: ['notes.today'], result_key: 'out.summary' },
            { ownerGhii: OWNER, createdBy: OWNER },
        );
        expect(started.state).toBe('queued');
        await settle();
        expect(sentToProvider).toHaveLength(1);
        expect(sentToProvider[0]).toContain('The harbour vote was 7-2.');
        expect(w.writes).toContain(`${OWNER}::out.summary`);
    });
});

describe('a scheduled AI job and the records the node keeps', () => {
    const caller = { owner: 'alice', identity: OWNER, isOwnerSession: true, scopes: [] as string[] };
    const aiBody = (over: Record<string, unknown>) => ({ kind: 'ai', cron: '0 7 * * *', display_name: 'morning', prompt: 'Summarise.', ...over });

    it('refuses to create one whose input_keys name one, and stores nothing', async () => {
        for (const key of KEPT_BY_THE_NODE) {
            const w = watchedStorage();
            const out = await createScheduleRecord({ storage: w.storage, config, scheduler: null }, caller, aiBody({ input_keys: ['notes.today', key] }));
            expect(out, key).toMatchObject({ ok: false, status: 403, code: 'RESERVED_KEY' });
            expect(w.createdSchedules, key).toEqual([]);
        }
    });

    it('refuses to create one whose output_key names one', async () => {
        for (const key of KEPT_BY_THE_NODE) {
            const w = watchedStorage();
            const out = await createScheduleRecord({ storage: w.storage, config, scheduler: null }, caller, aiBody({ output_key: key }));
            expect(out, key).toMatchObject({ ok: false, status: 403, code: 'RESERVED_KEY' });
            expect(w.createdSchedules, key).toEqual([]);
        }
    });

    it('refuses an edit that puts one in, as input or as output', async () => {
        const job = {
            id: 'sch-1', name: 'schedule:sch-1', type: 'ai', cron: '0 7 * * *', enabled: true,
            createdBy: OWNER, ownerScope: OWNER, createdByAgent: false, createdAt: '', updatedAt: '', runCount: 0,
            input: { prompt: 'Summarise.', inputKeys: ['notes.today'] },
        } as unknown as ScheduledJobRecord;
        for (const input of [
            { prompt: 'x', inputKeys: ['commerce.psp'] },
            { prompt: 'x', input_keys: ['decide.apikey'] },
            { prompt: 'x', outputKey: 'ai-usage.daily' },
            { prompt: 'x', outputKey: 'notif.1234' },
        ]) {
            const w = watchedStorage({}, [job]);
            const out = await updateScheduleRecord({ storage: w.storage, config, scheduler: null }, caller, 'sch-1', { input });
            expect(out, JSON.stringify(input)).toMatchObject({ ok: false, status: 403, code: 'RESERVED_KEY' });
            expect(w.updatedSchedules, JSON.stringify(input)).toEqual([]);
        }
    });

    it('asks again when it fires, before anything is read, sent or written', async () => {
        const fire = (input: Record<string, unknown>) => ({
            id: 'sch-old', type: 'ai', ownerScope: OWNER, input: { prompt: 'Summarise.', ...input },
        } as unknown as ScheduledJobRecord);
        for (const input of [
            { inputKeys: ['notes.today', 'decide.apikey'], outputKey: 'out.summary' },
            { inputKeys: ['notes.today'], outputKey: 'openrouter.settings' },
            { inputKeys: ['notes.today'], outputKey: '__redirect__' },
        ]) {
            const w = watchedStorage();
            await expect(runAiJob(w.storage, config, fire(input)), JSON.stringify(input)).rejects.toThrow(/keeps for itself/);
            expect(touchedKept(w), JSON.stringify(input)).toEqual([]);
            expect(w.writes, JSON.stringify(input)).toEqual([]);
        }
        expect(sentToProvider).toEqual([]);
    });

    it('still creates and runs one over the owner\'s own records', async () => {
        const w = watchedStorage();
        const out = await createScheduleRecord({ storage: w.storage, config, scheduler: null }, caller,
            aiBody({ input_keys: ['notes.today'], output_key: 'out.summary' }));
        expect(out.ok).toBe(true);
        const ran = await runAiJob(w.storage, config, w.createdSchedules[0]);
        expect(ran.writes).toEqual(['out.summary']);
        expect(sentToProvider[0]).toContain('The harbour vote was 7-2.');
    });
});
