/**
 * @file test/unit/tracked-response-list-prefix.test.ts
 * @description The tracked-response reads ask storage for the contract keys only. Both used to read
 *   every memory record of the account and filter by type, which on an aimeat.io account took 3.3–3.8 s
 *   and held GET /v1/messages/overview, the Messages page mount, to the same time. The result is the
 *   same either way, so what this pins is the question put to storage.
 * @usage pnpm test -- tracked-response-list-prefix
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { DeliveryCtx } from '../../src/services/message-delivery.js';
import { listTrackedResponses, evaluateOwnerTrackedResponses } from '../../src/services/tracked-response.js';

const OWNER = 'alice@aimeat-test-001';

function recordingStorage() {
    const asked: Array<{ prefix?: string } | undefined> = [];
    const rows = [
        { ownerGaii: OWNER, key: 'tracked-response.c1.latest', value: { type: 'tracked-response', id: 'c1', state: 'replied', createdAt: '2026-10-25T00:00:00Z' } },
        { ownerGaii: OWNER, key: 'notes.big', value: { text: 'x'.repeat(1000) } },
        { ownerGaii: OWNER, key: 'workflows.run.a', value: { mode: 'full-live' } },
    ];
    const storage = {
        async listMemory(_owner: string, opts?: { prefix?: string }) {
            asked.push(opts);
            return rows.filter(r => !opts?.prefix || r.key.startsWith(opts.prefix));
        },
    } as unknown as Storage;
    return { storage, asked };
}

describe('tracked-response reads', () => {
    it('listTrackedResponses reads under the contract prefix and returns the contracts', async () => {
        const { storage, asked } = recordingStorage();
        const list = await listTrackedResponses(storage, OWNER);
        expect(asked).toEqual([{ prefix: 'tracked-response.' }]);
        expect(list.map(c => c.id)).toEqual(['c1']);
    });

    it('evaluateOwnerTrackedResponses reads under the contract prefix', async () => {
        const { storage, asked } = recordingStorage();
        const out = await evaluateOwnerTrackedResponses({ storage } as unknown as DeliveryCtx, OWNER);
        expect(asked).toEqual([{ prefix: 'tracked-response.' }]);
        expect(out.evaluated).toBe(0);   // the one contract is replied, so nothing is due
    });
});
