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
});
