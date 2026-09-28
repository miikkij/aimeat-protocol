/**
 * @file test/unit/ai-job-op.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `op` of a background AI job and of a workflow `ai` step (System 2 plan, V5):
 *   which fields go with which op, that a start refuses every other combination BEFORE it writes
 *   anything, and that an image and a transcription land the result each op promises.
 *
 *   The three service functions (completeForOwner, generateForOwner, transcribeForOwner) are the only
 *   things mocked: what reached them and what storage was asked to write are the evidence.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-op.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-28 — `role`: the rule refuses one that is not a string of 1 to 300 characters,
 *     and a job's role reaches the service call of every op.
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord, StorageFileRecord } from '../../src/storage/interface.js';
import type { WorkflowRun, WorkflowStep } from '../../src/models/workflow-schemas.js';

/** Every call a service function received, by which one. */
const calls = vi.hoisted(() => ({ complete: [] as unknown[], image: [] as unknown[], transcribe: [] as unknown[] }));

vi.mock('../../src/services/ai-completion.js', () => {
    class AiCompletionError extends Error { code = 'AI_COMPLETION_FAILED'; }
    return {
        AiCompletionError,
        completeForOwner: vi.fn(async (_s: unknown, _c: unknown, _o: unknown, input: unknown) => {
            calls.complete.push(input);
            return { content: 'the answer', usage: { costUsd: 0.001, totalTokens: 5 } };
        }),
    };
});
vi.mock('../../src/services/ai-image.js', () => ({
    generateForOwner: vi.fn(async (_s: unknown, _c: unknown, gaii: string, input: unknown) => {
        calls.image.push({ gaii, input });
        return {
            storageKey: 'ai-images/1-abc.png', fetchUrl: '/v1/storage/ai-images/1-abc.png', mime: 'image/png',
            sizeBytes: 16, model: 'stub/image', visibility: 'private', usage: { costUsd: 0.04, costExact: true },
            provenance: { id: 'prov-image-1' },
        };
    }),
}));
vi.mock('../../src/services/ai-transcription.js', () => ({
    transcribeForOwner: vi.fn(async (_s: unknown, _c: unknown, gaii: string, input: unknown) => {
        calls.transcribe.push({ gaii, input });
        return {
            text: 'The harbour vote was 7-2.', model: 'stub/stt', language: 'en', seconds: 12.5,
            usage: { totalTokens: 39, costUsd: 0.0009, costExact: true }, provenance: { id: 'prov-stt-1' },
        };
    }),
}));

const { aiOpRefusal } = await import('../../src/services/ai-jobs/op.js');
const { AiJobService } = await import('../../src/services/ai-jobs/service.js');
const { WorkflowDefInputSchema } = await import('../../src/models/workflow-schemas.js');
const { dispatchAiStep } = await import('../../src/services/workflow/engine-ai-step.js');

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AUDIO_KEY = 'voice/note.webm';

const config = {
    nodeId: NODE, aiJobSlots: 1, aiJobMaxChain: 3, aiJobMaxQueued: 10, aiJobMaxQueuedPerOwner: 10,
    aiJobMaxPromptBytes: 1_000_000, aiJobLogRetentionDays: 7, sttMaxMb: 1,
} as unknown as AimeatConfig;

interface Watched { storage: Storage; writes: Array<{ key: string; value: unknown }>; fileReads: string[] }

/** One owner namespace with one audio file, and a note of every write and every file read. */
function watchedStorage(files: Record<string, { size: number; mime?: string }> = { [AUDIO_KEY]: { size: 1024 } }): Watched {
    const rows = new Map<string, MemoryRecord>();
    const w: Watched = { writes: [], fileReads: [], storage: undefined as unknown as Storage };
    const file = (owner: string, key: string, withData: boolean): StorageFileRecord | null => {
        w.fileReads.push(`${owner}::${key}`);
        const f = owner === OWNER ? files[key] : undefined;
        if (!f) return null;
        return {
            key, ownerGaii: owner, visibility: 'private', mimeType: f.mime ?? 'audio/webm', size: f.size,
            data: withData ? Buffer.alloc(f.size, 1) : Buffer.alloc(0), createdAt: new Date().toISOString(),
        } as StorageFileRecord;
    };
    w.storage = {
        getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
        setMemory: async (r: MemoryRecord) => { w.writes.push({ key: r.key, value: r.value }); rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
        deleteMemory: async (owner: string, key: string) => rows.delete(`${owner}::${key}`),
        listMemory: async (owner: string, opts: { prefix?: string } = {}) => [...rows.values()]
            .filter(r => r.ownerGaii === owner && r.key.startsWith(opts.prefix ?? '')),
        listMemoryForOwners: async () => [],
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        getAgent: async () => null,
        getStorageFileMeta: async (owner: string, key: string) => file(owner, key, false),
        getStorageFile: async (owner: string, key: string) => file(owner, key, true),
    } as unknown as Storage;
    return w;
}

const settle = () => new Promise(r => setTimeout(r, 30));
const start = (w: Watched, input: Record<string, unknown>) =>
    new AiJobService(config, w.storage).startJob({ result_key: 'out.result', ...input } as never, { ownerGhii: OWNER, createdBy: OWNER });

beforeEach(() => { calls.complete.length = 0; calls.image.length = 0; calls.transcribe.length = 0; });

describe('which fields go with which op', () => {
    it('accepts each op with its own fields', () => {
        expect(aiOpRefusal({ prompt: 'x' })).toBeNull();
        expect(aiOpRefusal({ op: 'text', prompt: 'x', json: true, system_prompt: 's' })).toBeNull();
        expect(aiOpRefusal({ op: 'image', prompt_key: 'p', input_keys: ['a'], size: '1024x1024' })).toBeNull();
        expect(aiOpRefusal({ op: 'transcribe', audio_key: AUDIO_KEY, language: 'fi', json: true })).toBeNull();
    });

    it.each([
        ['an unknown op', { op: 'video', prompt: 'x' }, /op must be one of/],
        ['an op that is not a string', { op: 3, prompt: 'x' }, /op must be one of/],
        ['an image with no prompt', { op: 'image' }, /needs prompt or prompt_key/],
        ['json on an image', { op: 'image', prompt: 'x', json: true }, /json does not apply to an image/],
        ['system_prompt on an image', { op: 'image', prompt: 'x', system_prompt: 's' }, /system_prompt does not apply/],
        ['a transcription with no audio_key', { op: 'transcribe' }, /needs audio_key/],
        ['a transcription with a prompt', { op: 'transcribe', audio_key: AUDIO_KEY, prompt: 'x' }, /no prompt/],
        ['a transcription with input_keys', { op: 'transcribe', audio_key: AUDIO_KEY, input_keys: ['a'] }, /no prompt/],
        ['audio_key on a text call', { prompt: 'x', audio_key: AUDIO_KEY }, /only to op "transcribe"/],
        ['language on an image', { op: 'image', prompt: 'x', language: 'fi' }, /only to op "transcribe"/],
        ['size on a text call', { prompt: 'x', size: '512x512' }, /only to op "image"/],
        ['an empty role', { prompt: 'x', role: '' }, /role must be a string of 1 to 300/],
        ['a role over 300 characters', { prompt: 'x', role: 'r'.repeat(301) }, /role must be a string of 1 to 300/],
        ['a role that is not a string', { op: 'image', prompt: 'x', role: 7 }, /role must be a string of 1 to 300/],
    ])('refuses %s', (_label, spec, why) => {
        expect(aiOpRefusal(spec)).toMatch(why);
    });

    it('accepts a role on every op', () => {
        expect(aiOpRefusal({ prompt: 'x', role: 'summarizer' })).toBeNull();
        expect(aiOpRefusal({ op: 'image', prompt: 'x', role: 'r'.repeat(300) })).toBeNull();
        expect(aiOpRefusal({ op: 'transcribe', audio_key: AUDIO_KEY, role: 'listener' })).toBeNull();
    });
});

describe('a start refuses before it writes', () => {
    it.each([
        ['an unknown op', { op: 'video', prompt: 'x' }],
        ['an image with no prompt', { op: 'image' }],
        ['json on an image', { op: 'image', prompt: 'x', json: true }],
        ['a transcription with no audio_key', { op: 'transcribe' }],
        ['size on a text call', { prompt: 'x', size: '512x512' }],
    ])('%s is INVALID_BODY 400, and nothing is written or read', async (_label, input) => {
        const w = watchedStorage();
        await expect(start(w, input)).rejects.toMatchObject({ code: 'INVALID_BODY', status: 400 });
        await settle();
        expect(w.writes).toEqual([]);
        expect(w.fileReads).toEqual([]);
        expect([...calls.complete, ...calls.image, ...calls.transcribe]).toEqual([]);
    });

    it('an audio_key that is not in the owner\'s storage is NOT_FOUND 404, and nothing is written', async () => {
        const w = watchedStorage({});
        await expect(start(w, { op: 'transcribe', audio_key: 'voice/missing.webm' }))
            .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
        await settle();
        expect(w.writes).toEqual([]);
        expect(calls.transcribe).toEqual([]);
    });

    it('an audio file over the node\'s transcription limit is AUDIO_TOO_LARGE 400, and nothing is written', async () => {
        const w = watchedStorage({ [AUDIO_KEY]: { size: 2 * 1024 * 1024 } });
        await expect(start(w, { op: 'transcribe', audio_key: AUDIO_KEY }))
            .rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE', status: 400 });
        await settle();
        expect(w.writes).toEqual([]);
    });
});

describe('what each op lands at result_key', () => {
    it('an image job writes { storage_key, url, mime_type, model } and carries cost and provenance', async () => {
        const w = watchedStorage();
        const started = await start(w, { op: 'image', prompt: 'a red bicycle', size: '1024x1024', provider: 'stub-images' });
        await settle();
        expect(calls.image).toHaveLength(1);
        const sent = calls.image[0] as { gaii: string; input: Record<string, unknown> };
        expect(sent.gaii).toBe(OWNER);
        expect(sent.input).toMatchObject({ prompt: 'a red bicycle', size: '1024x1024', provider: 'stub-images', publicVisibility: false });
        expect(w.writes.find(x => x.key === 'out.result')?.value).toEqual({
            storage_key: 'ai-images/1-abc.png', url: '/v1/storage/ai-images/1-abc.png', mime_type: 'image/png', model: 'stub/image',
        });
        const job = await new AiJobService(config, w.storage).getJob(OWNER, started.job_id);
        expect(job).toMatchObject({ state: 'done', op: 'image', cost_usd: 0.04, provenance_id: 'prov-image-1' });
    });

    it('a public result makes the picture public too, so the URL loads for its readers', async () => {
        const w = watchedStorage();
        await start(w, { op: 'image', prompt: 'a red bicycle', result_visibility: 'public' });
        await settle();
        expect((calls.image[0] as { input: Record<string, unknown> }).input.publicVisibility).toBe(true);
    });

    it('a transcribe job reads the audio from the owner\'s storage and writes the text', async () => {
        const w = watchedStorage();
        await start(w, { op: 'transcribe', audio_key: AUDIO_KEY, language: 'en', provider: 'stub-stt' });
        await settle();
        const sent = calls.transcribe[0] as { gaii: string; input: { audio: { data: Buffer; mime: string }; language?: string; provider?: string } };
        expect(sent.input.audio.data.length).toBe(1024);
        expect(sent.input.audio.mime).toBe('audio/webm');
        expect(sent.input).toMatchObject({ language: 'en', provider: 'stub-stt' });
        expect(w.writes.find(x => x.key === 'out.result')?.value).toBe('The harbour vote was 7-2.');
        expect(calls.complete).toEqual([]);
    });

    it('a transcribe job with json writes { text, language, seconds, model }', async () => {
        const w = watchedStorage();
        await start(w, { op: 'transcribe', audio_key: AUDIO_KEY, json: true });
        await settle();
        expect(w.writes.find(x => x.key === 'out.result')?.value).toEqual({
            text: 'The harbour vote was 7-2.', language: 'en', seconds: 12.5, model: 'stub/stt',
        });
    });

    it('a text job passes provider on, and is otherwise unchanged', async () => {
        const w = watchedStorage();
        await start(w, { prompt: 'Summarise.', provider: 'openrouter' });
        await settle();
        expect(calls.complete[0]).toMatchObject({ prompt: 'Summarise.', provider: 'openrouter' });
        expect(w.writes.find(x => x.key === 'out.result')?.value).toBe('the answer');
    });

    it('a job\'s role reaches the service call of every op, and is kept on the record', async () => {
        const w = watchedStorage();
        const started = await start(w, { prompt: 'Summarise.', role: 'summarizer' });
        await start(w, { op: 'image', prompt: 'a red bicycle', role: 'illustrator' });
        await start(w, { op: 'transcribe', audio_key: AUDIO_KEY, role: 'listener' });
        await settle();
        expect(calls.complete[0]).toMatchObject({ role: 'summarizer' });
        expect((calls.image[0] as { input: Record<string, unknown> }).input).toMatchObject({ role: 'illustrator' });
        expect((calls.transcribe[0] as { input: Record<string, unknown> }).input).toMatchObject({ role: 'listener' });
        expect(await new AiJobService(config, w.storage).getJob(OWNER, started.job_id)).toMatchObject({ role: 'summarizer' });
    });
});

describe('the workflow ai step', () => {
    const def = (action: Record<string, unknown>) => ({
        title: 't', description: 'd', trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 's1', description: 'd', action: { kind: 'ai', result_to_key: 'out.x', ...action } }],
    });

    it('the save refuses a field that does not go with the op, by the job\'s own rule', () => {
        expect(WorkflowDefInputSchema.safeParse(def({ op: 'image', prompt: 'x' })).success).toBe(true);
        const bad = WorkflowDefInputSchema.safeParse(def({ op: 'image', prompt: 'x', json: true }));
        expect(bad.success).toBe(false);
        expect(JSON.stringify(bad.error?.issues)).toMatch(/json does not apply to an image/);
        expect(WorkflowDefInputSchema.safeParse(def({ op: 'transcribe' })).success).toBe(false);
        expect(WorkflowDefInputSchema.safeParse(def({ op: 'sing', prompt: 'x' })).success).toBe(false);
    });

    const run = { runId: 'r1', workflowId: 'wf', vars: { day: 'mon' }, keyPrefix: '', mode: 'full-live', status: 'running', steps: {}, startedAt: '' } as unknown as WorkflowRun;
    const step = { id: 's1', description: 'd' } as unknown as WorkflowStep;

    async function fire(w: Watched, action: Record<string, unknown>): Promise<{ ok: boolean; cost?: number }> {
        return new Promise(resolve => {
            dispatchAiStep({ storage: w.storage, config } as never, OWNER, run, step, { kind: 'ai', result_to_key: 'out.x', ...action } as never,
                async (_o, _w, _r, _s, ok, cost, _call, write) => { await write?.(); resolve({ ok, cost }); });
        });
    }

    it('op image writes the picture\'s record and counts its cost', async () => {
        const w = watchedStorage();
        const out = await fire(w, { op: 'image', prompt: 'a {day} bicycle', size: '512x512' });
        expect(out).toEqual({ ok: true, cost: 0.04 });
        expect((calls.image[0] as { input: Record<string, unknown> }).input).toMatchObject({ prompt: 'a mon bicycle', size: '512x512', appId: 'workflow:wf' });
        expect(w.writes).toEqual([{ key: 'out.x', value: { storage_key: 'ai-images/1-abc.png', url: '/v1/storage/ai-images/1-abc.png', mime_type: 'image/png', model: 'stub/image' } }]);
    });

    it('op transcribe writes the transcript of the templated audio_key', async () => {
        const w = watchedStorage({ 'voice/mon.webm': { size: 8 } });
        const out = await fire(w, { op: 'transcribe', audio_key: 'voice/{day}.webm' });
        expect(out.ok).toBe(true);
        expect(w.fileReads).toContain(`${OWNER}::voice/mon.webm`);
        expect(w.writes).toEqual([{ key: 'out.x', value: 'The harbour vote was 7-2.' }]);
    });

    it('a missing audio file fails the step and writes nothing', async () => {
        const w = watchedStorage({});
        const out = await fire(w, { op: 'transcribe', audio_key: 'voice/none.webm' });
        expect(out.ok).toBe(false);
        expect(w.writes).toEqual([]);
        expect(calls.transcribe).toEqual([]);
    });
});
