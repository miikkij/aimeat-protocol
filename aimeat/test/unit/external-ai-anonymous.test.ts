/**
 * @file test/unit/external-ai-anonymous.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description externalAiFor (src/services/classification/external-ai.ts): an agent that reported a
 *   model on its own machine (`runtimeSource.llm: 'local'`) reads content whose label refuses outside
 *   models, and the node's shared anonymous agent never does, whatever its record says
 *   (secaudit2026oct26, runtime-source:shared-anonymous-agent-self-report).
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { externalAiFor } from '../../src/services/classification/external-ai.js';

const REFUSED = { externalAi: 'refused' } as never;
const storageWith = (owner: string, llm: string) => ({
    getAgent: async (gaii: string) => ({ gaii, owner, runtimeSource: { kind: 'python', llm } }),
}) as never;

describe('externalAiFor and a local-model report', () => {
    it('an agent of an account that reported a local model reads the refused label', async () => {
        const check = externalAiFor({ storage: storageWith('alice', 'local') }, { kind: 'ai', principal: 'crew#alice@node-a' });
        expect(await check.refuses(REFUSED)).toBe(false);
    });

    it('the shared anonymous agent stays outside even with a local report on its record', async () => {
        const check = externalAiFor({ storage: storageWith('anonymous', 'local') }, { kind: 'ai', principal: 'shared#anonymous@node-a' });
        expect(await check.refuses(REFUSED)).toBe(true);
    });
});
