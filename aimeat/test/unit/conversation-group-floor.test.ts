/**
 * @file conversation-group-floor.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The membership floor for a group thread, which is different for a NAMED thread than
 *   for an ad-hoc one.
 *
 *   `support@operators` on a node with a single operator resolves to that one person, and the creator
 *   IS that person, so the membership collapses to one. The old floor of two refused it, which meant
 *   the only operator of a node was the only person who could not write to its support address. That
 *   is not an edge case: it is every managed instance sold to one person.
 *
 *   The floor moved for named threads only, so this file exists to prove the other half did not move
 *   with it. There is no HTTP door to assert it through: the only caller of createGroupConversation
 *   is the support alias, so an ad-hoc group of one is unreachable over REST and reachable here.
 * @structure One describe per floor: named (1) and unnamed (2).
 * @usage pnpm exec vitest run test/unit/conversation-group-floor.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, alongside the sole-operator support fix.
 */
import { describe, it, expect } from 'vitest';
import { createGroupConversation } from '../../src/services/conversation-group.js';
import type { DeliveryCtx } from '../../src/services/message-delivery.js';

const NODE_ID = 'aimeat-local-001-dev';

/** The narrowest context createGroupConversation touches: a node id and a conversation writer. */
function ctxFor(created: unknown[]): DeliveryCtx {
    return {
        config: { nodeId: NODE_ID } as DeliveryCtx['config'],
        storage: {
            createConversation: async (record: unknown) => { created.push(record); return record; },
        } as unknown as DeliveryCtx['storage'],
        peers: new Map(),
    };
}

describe('createGroupConversation membership floor', () => {
    it('opens a NAMED thread whose membership collapses to one person', async () => {
        const created: unknown[] = [];
        const result = await createGroupConversation(ctxFor(created), {
            createdBy: `op@${NODE_ID}`,
            participants: [`op@${NODE_ID}`],   // the sole operator IS the sender
            subject: 'Note to self',
            alias: 'support@operators',
        });

        expect(result.ok).toBe(true);
        expect(created).toHaveLength(1);
        if (result.ok) {
            expect(result.conversation.participants).toEqual([`op@${NODE_ID}`]);
            expect(result.conversation.alias).toBe('support@operators');
        }
    });

    it('REFUSES an UNNAMED group that collapses to one person', async () => {
        const created: unknown[] = [];
        const result = await createGroupConversation(ctxFor(created), {
            createdBy: `alice@${NODE_ID}`,
            participants: [`alice@${NODE_ID}`],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('TOO_FEW_PARTICIPANTS');
        expect(created).toHaveLength(0);   // refuse before you write
    });

    it('still refuses a NAMED thread with no participants at all', async () => {
        const created: unknown[] = [];
        const result = await createGroupConversation(ctxFor(created), {
            createdBy: '   ',               // trimmed away, so the membership is genuinely empty
            participants: [],
            alias: 'support@operators',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('TOO_FEW_PARTICIPANTS');
        expect(created).toHaveLength(0);
    });
});
