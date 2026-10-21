/**
 * @file test/unit/ai-job-result-precheck.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an AI job's start refuses about its result key before the model is paid for
 *   (services/ai-jobs/result-precheck.ts). The answer is written through the shared memory write,
 *   which refuses an archived record, a schema lock the answer does not fit, a new key past the key
 *   ceiling and an account over its byte quota; each that the start can know is refused there, with
 *   the code the write would answer, and each control lands.
 *
 *   E2E covers the schema lock and the organism key on both backends (test/e2e-ai-jobs.ts 20a, 24a);
 *   this covers the archive, the key ceiling and the quota, which a shared E2E node cannot reach.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-job-result-precheck.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, capability-loss review).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { resultWriteRefusal } from '../../src/services/ai-jobs/result-precheck.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;

const config = {
    nodeId: NODE, memoryQuotaMb: 1, memoryMaxKeysPerAgent: 3, memoryMaxValueSizeKb: 1024, memoryOverageMorselsPerMbMonth: 5,
} as unknown as AimeatConfig;

function stub(opts: { rows?: Record<string, Partial<MemoryRecord>>; count?: number; bytes?: number; schemaType?: unknown } = {}): Storage {
    return {
        getMemory: async (_o: string, key: string) => (opts.rows?.[key] ? { key, version: 1, ...opts.rows[key] } : null),
        findApplicableSchema: async () => (opts.schemaType === undefined ? null : { keyPattern: 'locked.*', schemaJson: { type: opts.schemaType } }),
        countMemory: async () => opts.count ?? 0,
        sumMemoryBytes: async () => opts.bytes ?? 0,
        getGHIIByOwner: async () => ({ morselBalance: 0 }),
        getOrganism: async () => null,
    } as unknown as Storage;
}

const ask = (storage: Storage, key = 'out.answer', op: 'text' | 'image' | 'transcribe' = 'text', json = false) =>
    resultWriteRefusal({ storage, config }, { ownerGhii: OWNER, key, op, json });

describe('the start refuses what the answer\'s write would refuse', () => {
    it('lets an ordinary key through', async () => {
        expect(await ask(stub())).toBeNull();
    });

    it('an archived record is 409 ARCHIVED', async () => {
        expect(await ask(stub({ rows: { 'out.answer': { archived: true } } }))).toMatchObject({ status: 409, code: 'ARCHIVED' });
    });

    it('a schema lock that cannot take the op\'s answer is 422; one that can, or a json text job, passes', async () => {
        expect(await ask(stub({ schemaType: 'object' }))).toMatchObject({ status: 422, code: 'SCHEMA_VALIDATION_FAILED' });
        expect(await ask(stub({ schemaType: 'string' }), 'out.answer', 'image')).toMatchObject({ status: 422 });
        expect(await ask(stub({ schemaType: 'string' }))).toBeNull();
        expect(await ask(stub({ schemaType: ['object', 'string'] }))).toBeNull();
        expect(await ask(stub({ schemaType: 'object' }), 'out.answer', 'text', true)).toBeNull();
        expect(await ask(stub({ schemaType: 'object' }), 'out.answer', 'transcribe', true)).toBeNull();
    });

    it('a new key past the key ceiling is 413, and an existing key there is not', async () => {
        expect(await ask(stub({ count: 3 }))).toMatchObject({ status: 413, code: 'QUOTA_EXCEEDED' });
        expect(await ask(stub({ count: 3, rows: { 'out.answer': {} } }))).toBeNull();
    });

    it('an account over its byte quota with no balance for the overage is 413', async () => {
        expect(await ask(stub({ bytes: 3 * 1024 * 1024 }))).toMatchObject({ status: 413, code: 'QUOTA_EXCEEDED' });
        expect(await ask(stub({ bytes: 512 * 1024 }))).toBeNull();
    });
});
