/**
 * @file test/unit/resolve-gaii-local-person.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where resolveGaii (services/federation.ts) finds a provider that is a PERSON of this
 *   node. An action a person publishes is stored under their GHII, so the work on it is addressed to
 *   `alice@this-node`. That identity is local, and no peer is asked about it: a peer that answered
 *   for it would have the work routed to it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/resolve-gaii-local-person.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09: N6, F-1).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { resolveGaii, type PeerInfo } from '../../src/services/federation.js';

const NODE = 'aimeat-resolve-001';
const config = { nodeId: NODE, baseUrl: 'http://localhost:40999' } as unknown as AimeatConfig;

/** A storage that knows one person and no agents. */
function storageWith(people: string[]): Storage {
    return {
        getAgent: async () => null,
        getGHII: async (ghii: string) => (people.includes(ghii) ? { ghii } : null),
        listPersonalNodes: async () => [],
    } as unknown as Storage;
}

/** One active peer, which answers 200 to anything it is asked. */
const peers = new Map<string, PeerInfo>([['peer-1', {
    nodeId: 'aimeat-peer-001', url: 'http://peer.example.test', status: 'active',
} as PeerInfo]]);

afterEach(() => { vi.unstubAllGlobals(); });

describe('resolveGaii for a person of this node', () => {
    it('answers local for a GHII this node holds, and asks no peer', async () => {
        const asked: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => { asked.push(String(url)); return new Response('{}', { status: 200 }); });
        const who = `alice${Date.now()}@${NODE}`;
        const r = await resolveGaii(who, config, storageWith([who]), peers);
        expect(r, 'a person of this node is resolved').toMatchObject({ nodeId: NODE, local: true });
        expect(asked, 'a peer was asked about a person of this node').toEqual([]);
    });

    it('does not answer local for a GHII this node does not hold', async () => {
        vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
        const r = await resolveGaii(`nobody${Date.now()}@${NODE}`, config, storageWith([]), peers);
        expect(r, 'an identity nobody holds here is not local').toBeNull();
    });
});
