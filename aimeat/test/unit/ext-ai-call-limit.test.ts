/**
 * @file test/unit/ext-ai-call-limit.test.ts
 * @description An extension's `ctx.ai.start` draws on the installer's AI call limit, the same
 *   allowance POST /v1/ai/jobs and aimeat_ai_job_start draw on (services/account-limits.ts). Only a
 *   start that continues a chain is exempt: the chain's first start was counted, as a job's run is not
 *   counted again after its start (secaudit 2026-10 follow-up, A5). Before this, every extension start
 *   passed `limit: 'exempt'`, so an extension any visitor can call started AI work on the installer's
 *   key with no per-account limit.
 * @usage pnpm test -- ext-ai-call-limit
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, A5).
 */
import { describe, it, expect } from 'vitest';
import { buildExtensionAi } from '../../src/services/ai-jobs/ext-capability.js';
import type { AiJobStarter, StartAiJobContext } from '../../src/services/ai-jobs/types.js';

function recordingService(): { service: AiJobStarter; seen: StartAiJobContext[] } {
    const seen: StartAiJobContext[] = [];
    const service = {
        startJob: async (_input: unknown, ctx: StartAiJobContext) => {
            seen.push(ctx);
            return { job_id: `job-${seen.length}`, queue_position: 1 };
        },
    } as unknown as AiJobStarter;
    return { service, seen };
}

describe('ctx.ai.start and the account AI call limit', () => {
    it('a start from an action or a schedule is counted against the installer', async () => {
        const { service, seen } = recordingService();
        const ai = buildExtensionAi({ service, extName: 'summer', ownerGhii: 'alice@node', createdBy: 'visitor@node' });
        const r = await ai.start({ prompt: 'hi', result_key: 'out.summary' });
        expect(r.ok).toBe(true);
        expect(seen[0]!.limit).toBeUndefined();
    });

    it('a start that continues a chain is exempt: its first start was counted', async () => {
        const { service, seen } = recordingService();
        const ai = buildExtensionAi({
            service, extName: 'summer', ownerGhii: 'alice@node', createdBy: 'alice@node',
            chain: { parentJob: 'job-0', parentDepth: 1, onRefused: () => {} },
        });
        await ai.start({ prompt: 'next', result_key: 'out.next' });
        expect(seen[0]!.limit).toBe('exempt');
        expect(seen[0]!.chainDepth).toBe(2);
    });

    it('one callback continues the chain once: a second and third start in it are counted', async () => {
        // Before this, every start inside an on_done callback was exempt, so one counted start could
        // fan out to F + F^2 + ... jobs over the chain's depth (secaudit 2026-10 last items, F1).
        const { service, seen } = recordingService();
        const ai = buildExtensionAi({
            service, extName: 'summer', ownerGhii: 'alice@node', createdBy: 'alice@node',
            chain: { parentJob: 'job-0', parentDepth: 1, onRefused: () => {} },
        });
        await Promise.all([
            ai.start({ prompt: 'a', result_key: 'out.a' }),
            ai.start({ prompt: 'b', result_key: 'out.b' }),
            ai.start({ prompt: 'c', result_key: 'out.c' }),
        ]);
        expect(seen.map(c => c.limit)).toEqual(['exempt', undefined, undefined]);
        // Every one of them is still part of the chain, so the depth bound holds for all three.
        expect(seen.map(c => c.chainDepth)).toEqual([2, 2, 2]);
    });

    it('a continuation the node refused gives the exemption back', async () => {
        const seen: StartAiJobContext[] = [];
        let first = true;
        const service = {
            startJob: async (_input: unknown, ctx: StartAiJobContext) => {
                seen.push(ctx);
                if (first) { first = false; throw new Error('the model name is not known'); }
                return { job_id: 'job-2', queue_position: 1 };
            },
        } as unknown as AiJobStarter;
        const ai = buildExtensionAi({
            service, extName: 'summer', ownerGhii: 'alice@node', createdBy: 'alice@node',
            chain: { parentJob: 'job-0', parentDepth: 1, onRefused: () => {} },
        });
        expect((await ai.start({ prompt: 'a', result_key: 'out.a' })).ok).toBe(false);
        expect((await ai.start({ prompt: 'a', result_key: 'out.a' })).ok).toBe(true);
        expect(seen.map(c => c.limit)).toEqual(['exempt', 'exempt']);
    });
});
