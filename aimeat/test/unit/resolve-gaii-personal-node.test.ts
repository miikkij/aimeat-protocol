/**
 * @file test/unit/resolve-gaii-personal-node.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which identities resolveGaii (services/federation.ts) routes to a personal node
 *   anchored on this node. A personal node lists the agents that run on it, and work for a listed
 *   identity is queued for that node. A listed entry counts only when it names the anchoring owner
 *   and, when it names a node, that personal node. An anchor stored before POST /v1/personal/anchor
 *   checked the list can still hold another owner's identity, and that entry routes nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/resolve-gaii-personal-node.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22, personal-anchor-agent-gaiis-claim-foreign-gaii).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { resolveGaii, isPersonalNodeAgentOf } from '../../src/services/federation.js';

const NODE = 'aimeat-resolve-002';
const config = { nodeId: NODE, baseUrl: 'http://localhost:40998' } as unknown as AimeatConfig;
const PN = 'personal-claimant-node';

/** A storage with no local agents or people and one anchored personal node owned by `claimant`. */
function storageWith(agentGaiis: string[]): Storage {
    return {
        getAgent: async () => null,
        getGHII: async () => null,
        listPersonalNodes: async () => [{ nodeId: PN, ownerName: 'claimant', agentGaiis }],
    } as unknown as Storage;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('resolveGaii and the agents a personal node lists', () => {
    it('routes the owner\'s own agent on that personal node to it', async () => {
        const own = `homebot${Date.now()}#claimant@${PN}`;
        const r = await resolveGaii(own, config, storageWith([own]), new Map());
        expect(r, 'the designed case resolves to the personal node').toMatchObject({ nodeId: PN, local: false });
    });

    it('routes nothing for a listed identity of another owner or another node', async () => {
        vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
        const stamp = Date.now();
        const foreign = [`victimbot${stamp}#victim@aimeat-peer-009`, `bot${stamp}#claimant@aimeat-peer-009`];
        for (const gaii of foreign) {
            const r = await resolveGaii(gaii, config, storageWith(foreign), new Map());
            expect(r, `${gaii} was routed to the personal node that listed it`).toBeNull();
        }
    });
});

describe('isPersonalNodeAgentOf', () => {
    it('accepts the owner\'s agent with or without the personal node part', () => {
        expect(isPersonalNodeAgentOf('bot1#alice', 'alice', PN)).toBe(true);
        expect(isPersonalNodeAgentOf(`bot1#alice@${PN}`, 'alice', PN)).toBe(true);
    });

    it('refuses another owner, another node, a GEAI and a malformed entry', () => {
        expect(isPersonalNodeAgentOf(`bot1#bob@${PN}`, 'alice', PN)).toBe(false);
        expect(isPersonalNodeAgentOf('bot1#alice@aimeat-peer-009', 'alice', PN)).toBe(false);
        expect(isPersonalNodeAgentOf(`eco:app#alice@${PN}`, 'alice', PN)).toBe(false);
        expect(isPersonalNodeAgentOf('alice', 'alice', PN)).toBe(false);
        expect(isPersonalNodeAgentOf(`#alice@${PN}`, 'alice', PN)).toBe(false);
        expect(isPersonalNodeAgentOf(`a#b#alice@${PN}`, 'alice', PN)).toBe(false);
    });
});
