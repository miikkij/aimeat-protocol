/**
 * @file test/unit/agent-port-redirect.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the public agent profile forwards a visitor for a ported agent
 *   (services/agent-port-redirect.ts): only to an active federation peer, at an address built from
 *   the peer record rather than from the string the pointer holds.
 * @version-history
 *   2026-10-15 — The fake storage holds the pointer where the porting route writes it now (NS_AGENT_PORT);
 *     on a real SQLite store the pointer is served after the agent is deleted, the old location went
 *     with the agent, and a pointer past its 30 days is not served (feature-list audit #35).
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { portRedirectFor, putPortRedirect, NS_AGENT_PORT } from '../../src/services/agent-port-redirect.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

const GAII = 'scout#alice@aimeat-test-001-dev';

/** A pointer where the porting route writes it since 2026-10-15: the system namespace, keyed by the GAII. */
function storageWith(pointer: unknown, peers: Array<{ nodeId: string; url: string; status: string }>) {
    return {
        getMemory: async (owner: string, key: string) => (owner === NS_AGENT_PORT && key === GAII && pointer !== undefined
            ? { key, ownerGaii: owner, value: pointer } : null),
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

describe('the pointer outlives the agent (feature-list audit #35)', () => {
    async function nodeWithAgent() {
        const storage = new SqliteStorage(':memory:');
        const now = new Date().toISOString();
        await storage.createAgent({
            name: 'scout', owner: 'alice', gaii: GAII, publicKey: 'pk', trustScore: 50,
            morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now,
        } as never);
        // The peer list is the federation registry's; this test is about where the pointer lives.
        const withPeer = Object.assign(Object.create(storage), { listFederationPeers: async () => [PEER] }) as SqliteStorage;
        return { storage, withPeer };
    }

    it('is still served after the agent and its memory are deleted', async () => {
        const { storage, withPeer } = await nodeWithAgent();
        await putPortRedirect(storage, GAII, { targetNodeUrl: 'https://peer.example', targetNodeId: PEER.nodeId });
        expect(await storage.deleteAgent(GAII)).toBe(true);
        const moved = await portRedirectFor(withPeer, GAII);
        expect(moved?.location).toBe(`https://peer.example/v1/agents/${encodeURIComponent(GAII)}`);
    });

    it('where the pointer used to live, the agent\'s deletion took it along (the defect)', async () => {
        const { storage, withPeer } = await nodeWithAgent();
        const now = new Date().toISOString();
        await storage.setMemory({
            key: '__redirect__', ownerGaii: GAII, value: { target_node_url: 'https://peer.example' }, visibility: 'public',
            tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        expect(await portRedirectFor(withPeer, GAII)).not.toBeNull();   // read while the agent exists
        await storage.deleteAgent(GAII);
        expect(await portRedirectFor(withPeer, GAII)).toBeNull();
    });

    it('is not served once its 30 days have run out', async () => {
        const { storage, withPeer } = await nodeWithAgent();
        const longAgo = new Date(Date.now() - 31 * 24 * 3_600_000).toISOString();
        await storage.setMemory({
            key: GAII, ownerGaii: NS_AGENT_PORT, value: { target_node_url: 'https://peer.example' }, visibility: 'private',
            tags: [], ttlHours: 30 * 24, version: 1, createdAt: longAgo, updatedAt: longAgo,
        });
        expect(await portRedirectFor(withPeer, GAII)).toBeNull();
    });
});
