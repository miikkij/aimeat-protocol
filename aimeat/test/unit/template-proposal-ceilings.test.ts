/**
 * @file test/unit/template-proposal-ceilings.test.ts
 * @description A template proposal is a memory record, so it answers to the memory ceilings every
 *   other memory write answers to (services/memory-ceilings.ts): an owner at the key ceiling is
 *   refused with 413 QUOTA_EXCEEDED and nothing is written. proposeTemplate wrote with
 *   storage.setMemory directly, past the key count and the byte budget, on POST /v1/appdev/templates
 *   and on the node MCP tool alike (secaudit 2026-10 last items, F3).
 * @usage pnpm test -- template-proposal-ceilings
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, F3).
 */
import { describe, it, expect } from 'vitest';
import { proposeTemplate, type ProposeTemplateInput } from '../../src/services/app-template-proposals.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const config = { nodeId: 'node-1', memoryMaxKeysPerAgent: 5, memoryMaxValueSizeKb: 1024, memoryQuotaMb: 10 } as unknown as AimeatConfig;

function stubStorage(keysHeld: number): { storage: Storage; writes: string[] } {
    const writes: string[] = [];
    const storage = {
        getApp: async () => ({ versionNumber: 3 }),
        getMemory: async () => null,
        countMemory: async () => keysHeld,
        sumMemoryBytes: async () => 0,
        setMemory: async (rec: { key: string }) => { writes.push(rec.key); return rec; },
    } as unknown as Storage;
    return { storage, writes };
}

const input: ProposeTemplateInput = {
    id: 'quiz-shell', title: 'Quiz shell', description: 'A quiz with a score board.',
    derived_from: { owner: 'alice', filename: 'quiz.html' },
    tier: 'starter', reuse_notes: 'Swap the questions.', model: 'claude-opus-5-5',
} as unknown as ProposeTemplateInput;

describe('a template proposal and the memory ceilings', () => {
    it('an owner at the key ceiling is refused, and nothing is written', async () => {
        const { storage, writes } = stubStorage(5);
        const r = await proposeTemplate(storage, config, 'alice@node-1', input);
        expect('error' in r).toBe(true);
        expect(r).toMatchObject({ status: 413, code: 'QUOTA_EXCEEDED' });
        expect(writes).toEqual([]);
    });

    it('an owner below the ceiling proposes', async () => {
        const { storage, writes } = stubStorage(4);
        const r = await proposeTemplate(storage, config, 'alice@node-1', input);
        expect('manifest' in r).toBe(true);
        expect(writes).toEqual(['template.catalog.quiz-shell.manifest']);
    });
});
