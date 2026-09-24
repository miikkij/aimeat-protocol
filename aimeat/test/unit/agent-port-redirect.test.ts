/**
 * @file test/unit/agent-port-redirect.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the public agent profile forwards a visitor for a ported agent
 *   (services/agent-port-redirect.ts): only to an active federation peer, at an address built from
 *   the peer record rather than from the string the pointer holds.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { portRedirectFor } from '../../src/services/agent-port-redirect.js';

const GAII = 'scout#alice@aimeat-test-001-dev';

function storageWith(pointer: unknown, peers: Array<{ nodeId: string; url: string; status: string }>) {
    return {
        getMemory: async (gaii: string, key: string) => (gaii === GAII && key === '__redirect__' && pointer !== undefined
            ? { key, ownerGaii: gaii, value: pointer } : null),
        listFederationPeers: async () => peers,
    } as never;
}

const PEER = { nodeId: 'aimeat-peer-002-dev', url: 'https://peer.example/', status: 'active' };

describe('portRedirectFor', () => {
    it('forwards to an active peer, at the peer record\'s own address', async () => {
        const moved = await portRedirectFor(storageWith({ target_node_url: 'https://peer.example', ported_at: '2026-09-24T10:00:00Z' }, [PEER]), GAII);
        expect(moved).toEqual({
            location: `https://peer.example/v1/agents/${encodeURIComponent(GAII)}`,
            targetNodeUrl: 'https://peer.example',
            targetNodeId: 'aimeat-peer-002-dev',
            portedAt: '2026-09-24T10:00:00Z',
        });
    });

    it('carries nothing of the pointer\'s path or query into the Location', async () => {
        const moved = await portRedirectFor(storageWith({ target_node_url: 'https://peer.example/landing?next=' }, [PEER]), GAII);
        expect(moved?.location).toBe(`https://peer.example/v1/agents/${encodeURIComponent(GAII)}`);
    });

    it('forwards nobody to a host this node does not peer with', async () => {
        expect(await portRedirectFor(storageWith({ target_node_url: 'https://collector.example/landing?x=' }, [PEER]), GAII)).toBeNull();
        // Same host name, different port or scheme: a different origin.
        expect(await portRedirectFor(storageWith({ target_node_url: 'http://peer.example' }, [PEER]), GAII)).toBeNull();
        expect(await portRedirectFor(storageWith({ target_node_url: 'https://peer.example:8443' }, [PEER]), GAII)).toBeNull();
    });

    it('forwards nobody to a peer that is not active', async () => {
        const ended = { ...PEER, status: 'depeered' };
        expect(await portRedirectFor(storageWith({ target_node_url: 'https://peer.example' }, [ended]), GAII)).toBeNull();
    });

    it('answers null for a missing pointer or one that is not an http address', async () => {
        expect(await portRedirectFor(storageWith(undefined, [PEER]), GAII)).toBeNull();
        for (const target of ['javascript:alert(1)', '//peer.example', 'peer.example', 42, null]) {
            expect(await portRedirectFor(storageWith({ target_node_url: target }, [PEER]), GAII), String(target)).toBeNull();
        }
        expect(await portRedirectFor(storageWith('https://peer.example', [PEER]), GAII)).toBeNull();
    });
});
