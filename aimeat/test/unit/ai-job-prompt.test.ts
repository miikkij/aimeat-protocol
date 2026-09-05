/**
 * @file test/unit/ai-job-prompt.test.ts
 * @description The prompt assembler, asked the one question that has already cost this project a
 *   whole invented product: is a record it could not find STATED, or silently skipped?
 *
 *   The model an AI job calls has no tools. The prompt string is everything it will ever see, so a
 *   record named in `input_keys` and quietly left out is not a smaller prompt — it is a prompt that
 *   asks about something the model then makes up, plausibly, field by field. That is exactly what
 *   the first version of the workflow `ai` step did (engine-ai-step.ts v1.1.0), and this is the same
 *   fix in the other place that needed it.
 *
 *   Also here: the byte cap, which is the number that multiplies with concurrency.
 * @usage pnpm test -- ai-job-prompt
 * @version-history
 *   v1.0.0 — 2026-08-31 — Written with the feature.
 */
import { describe, it, expect } from 'vitest';
import { assembleJobPrompt } from '../../src/services/ai-jobs/prompt.js';
import { AiJobError } from '../../src/services/ai-jobs/types.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE_ID = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE_ID}`;

/** Just enough storage for the assembler: a keyed map per namespace, and no agents. */
function fakeStorage(records: Record<string, unknown>): Storage {
    return {
        getMemory: async (gaii: string, key: string) =>
            gaii === OWNER && key in records
                ? { key, ownerGaii: gaii, value: records[key], visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' }
                : null,
        listMemory: async () => [],
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
    } as unknown as Storage;
}

const cfg = (maxBytes = 1_000_000): AimeatConfig =>
    ({ nodeId: NODE_ID, aiJobMaxPromptBytes: maxBytes } as unknown as AimeatConfig);

describe('assembleJobPrompt', () => {
    it('states a missing input record instead of leaving a silence the model would fill in', async () => {
        const storage = fakeStorage({ 'notes.present': 'The harbour vote was 7-2.' });
        const prompt = await assembleJobPrompt({ storage, config: cfg() }, OWNER, {
            prompt: 'Summarise.',
            input_keys: ['notes.present', 'notes.absent'],
        });

        expect(prompt).toContain('### notes.present');
        expect(prompt).toContain('The harbour vote was 7-2.');
        // The whole point: the absent key is NAMED and its absence is spelled out.
        expect(prompt).toContain('### notes.absent');
        expect(prompt).toContain('(no such record — do not invent its contents)');
    });

    it('tells the model that what it was given is all there is', async () => {
        const storage = fakeStorage({ 'a.key': 'value' });
        const prompt = await assembleJobPrompt({ storage, config: cfg() }, OWNER, {
            prompt: 'Do the thing.', input_keys: ['a.key'],
        });
        expect(prompt).toContain('anything not\nstated here is unknown, and unknown is reported, never filled in');
    });

    it('serialises a non-string record rather than dropping it', async () => {
        const storage = fakeStorage({ 'a.obj': { votes: { for: 7, against: 2 } } });
        const prompt = await assembleJobPrompt({ storage, config: cfg() }, OWNER, {
            prompt: 'Count.', input_keys: ['a.obj'],
        });
        expect(prompt).toContain('"against": 2');
    });

    it('takes the prompt from prompt_key, as a string or as a record carrying one', async () => {
        const storage = fakeStorage({ 'p.plain': 'stored prompt', 'p.wrapped': { title: 'x', prompt: 'wrapped prompt' } });
        expect(await assembleJobPrompt({ storage, config: cfg() }, OWNER, { prompt_key: 'p.plain' }))
            .toContain('stored prompt');
        expect(await assembleJobPrompt({ storage, config: cfg() }, OWNER, { prompt_key: 'p.wrapped' }))
            .toContain('wrapped prompt');
    });

    it('refuses a prompt_key that holds no prompt, rather than sending an empty one', async () => {
        const storage = fakeStorage({ 'p.empty': { title: 'no prompt here' } });
        await expect(assembleJobPrompt({ storage, config: cfg() }, OWNER, { prompt_key: 'p.empty' }))
            .rejects.toMatchObject({ code: 'INVALID_BODY' });
    });

    it('refuses a job with neither prompt nor prompt_key', async () => {
        await expect(assembleJobPrompt({ storage: fakeStorage({}), config: cfg() }, OWNER, {}))
            .rejects.toMatchObject({ code: 'INVALID_BODY' });
    });

    it('counts what input_keys ADD against the byte cap, and names both numbers', async () => {
        const storage = fakeStorage({ 'big.one': 'x'.repeat(5000) });
        let thrown: AiJobError | null = null;
        try {
            await assembleJobPrompt({ storage, config: cfg(4096) }, OWNER, {
                prompt: 'short', input_keys: ['big.one'],
            });
        } catch (err) { thrown = err as AiJobError; }

        expect(thrown).toBeInstanceOf(AiJobError);
        expect(thrown!.code).toBe('AI_JOB_PROMPT_TOO_LARGE');
        expect(thrown!.status).toBe(413);
        // A refusal that does not say how big and how big is allowed leaves the caller guessing.
        expect(thrown!.message).toMatch(/MB.*MB/s);
    });

    it('lets a prompt exactly at the cap through', async () => {
        const storage = fakeStorage({});
        const prompt = 'z'.repeat(4096);
        await expect(assembleJobPrompt({ storage, config: cfg(4096) }, OWNER, { prompt }))
            .resolves.toBe(prompt);
    });
});
