/**
 * @file test/unit/visitor-peer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A visitor's session lives only as long as the peer that vouched for it (auth/visitor-peer.ts),
 *   and the shared anonymous principal is known by its identity (auth/anonymous-principal.ts).
 *
 *   WHY. A visitor token carries no session id, and the peer's status, the node's federated sign-in
 *   policy, the peer's tier and its scope list were read only at the mint, so an operator who removed
 *   or restricted a peer left its visitors working for up to an hour (secaudit 2026-10,
 *   federated-visitor-not-bound-to-live-peer). The minted anonymous token carries no anonymous claim,
 *   so a guard reading only the flag took it for an ordinary agent (secaudit 2026-10,
 *   anonymous-claim-not-signed). Each case below names the state the E2E suites cannot cheaply reach:
 *   a suspended peer, a specific_peers policy, a contact-tier peer, a node with no registry.
 * @usage cd aimeat && pnpm exec vitest run test/unit/visitor-peer.test.ts
 * @version-history
 *   v1.0.1 — 2026-10-21 — A peer the heartbeat marks degraded, offline or unreachable keeps its visitors.
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));
vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initNodeKeys, issueJWT, verifyJWT, type VerifiedToken } from '../../src/auth/jwt.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { credentialRevoked, initSessionAuth, enableAnonymousAuth } from '../../src/auth/middleware.js';
import { registerVisitorPeers, visitorPeerRefuses, visitorPeerScopes, type VisitorPeerView } from '../../src/auth/visitor-peer.js';
import { withCurrentScopes } from '../../src/auth/effective-scopes.js';
import { isAnonymousPrincipal } from '../../src/auth/anonymous-principal.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-visitor-test-001';
const HOME = 'aimeat-visitor-home-001';

const peers = new Map<string, VisitorPeerView>();
const config = {
    nodeId: NODE,
    federationAuthPolicy: 'all_peers',
    federationDefaultScopes: ['memory:read', 'catalogue:read'],
} as unknown as AimeatConfig;
const storage = { getOwner: async () => null, isSessionRevoked: async () => false } as unknown as Storage;

function livePeer(over: Partial<VisitorPeerView> = {}): VisitorPeerView {
    return { nodeId: HOME, status: 'active', tier: 'member', allowFederatedAuth: true, federationAuthScopes: [], ...over };
}

async function visitor(scopes: string[] = ['memory:read', 'catalogue:read']): Promise<{ token: string; v: VerifiedToken }> {
    const token = await issueJWT({
        sub: `alice@${HOME}`, owner: `alice@${HOME}`, node: NODE, roles: ['federated'], scopes,
        federated: true, homeNode: HOME, homeUrl: 'https://home.example',
    }, 3600);
    return { token, v: (await verifyJWT(token))! };
}

beforeAll(async () => {
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    initSessionAuth(storage, config);
    registerVisitorPeers(peers, NODE);
});
afterAll(() => { initSessionAuth(null as unknown as Storage); setThisNodeId(null); });
beforeEach(() => {
    peers.clear();
    peers.set(HOME, livePeer());
    (config as { federationAuthPolicy: string }).federationAuthPolicy = 'all_peers';
});

describe('a visitor session follows its home peer', () => {
    it('counts while the home peer is active and may sign people in', async () => {
        const { token, v } = await visitor();
        expect(visitorPeerRefuses(v)).toBe(false);
        expect(await credentialRevoked(token, v)).toBe(false);
    });

    it('ends when the peer is removed, suspended or in its de-peering grace', async () => {
        const { token, v } = await visitor();
        peers.delete(HOME);
        expect(await credentialRevoked(token, v)).toBe(true);
        for (const status of ['suspended', 'depeering', 'pending']) {
            peers.set(HOME, livePeer({ status }));
            expect(await credentialRevoked(token, v)).toBe(true);
        }
    });

    it('keeps working while the peer is only unreachable for a while (the heartbeat statuses)', async () => {
        const { token, v } = await visitor();
        for (const status of ['degraded', 'offline', 'unreachable']) {
            peers.set(HOME, livePeer({ status }));
            expect(await credentialRevoked(token, v)).toBe(false);
        }
    });

    it('ends when federated sign-in is switched off for the node', async () => {
        const { token, v } = await visitor();
        (config as { federationAuthPolicy: string }).federationAuthPolicy = 'disabled';
        expect(await credentialRevoked(token, v)).toBe(true);
    });

    it('ends under specific_peers when the peer is not allowed, and not when it is', async () => {
        const { token, v } = await visitor();
        (config as { federationAuthPolicy: string }).federationAuthPolicy = 'specific_peers';
        peers.set(HOME, livePeer({ allowFederatedAuth: false }));
        expect(await credentialRevoked(token, v)).toBe(true);
        peers.set(HOME, livePeer({ allowFederatedAuth: true }));
        expect(await credentialRevoked(token, v)).toBe(false);
    });

    it('ends when the peer is moved to a tier that cannot carry a sign-in', async () => {
        const { token, v } = await visitor();
        for (const tier of ['contact', 'visiting']) {
            peers.set(HOME, livePeer({ tier }));
            expect(await credentialRevoked(token, v)).toBe(true);
        }
    });

    it('asks nothing of a principal that is not a visitor', async () => {
        const token = await issueJWT({ sub: 'bob', owner: 'bob', node: NODE, roles: ['owner'], scopes: [] }, 3600);
        const v = (await verifyJWT(token))!;
        peers.clear();
        expect(visitorPeerRefuses(v)).toBe(false);
        expect(visitorPeerScopes(v)).toBeNull();
    });
});

describe('a visitor\'s scopes follow its home peer', () => {
    it('narrow at once to the peer\'s current list', async () => {
        const { v } = await visitor(['memory:read', 'memory:write', 'catalogue:read']);
        peers.set(HOME, livePeer({ federationAuthScopes: ['catalogue:read'] }));
        expect((await withCurrentScopes(storage, v)).scopes).toEqual(['catalogue:read']);
    });

    it('fall back to the node default when the peer names none', async () => {
        const { v } = await visitor(['memory:read', 'memory:write', 'catalogue:read']);
        expect((await withCurrentScopes(storage, v)).scopes).toEqual(['memory:read', 'catalogue:read']);
    });

    it('never widen beyond what the token was minted with', async () => {
        const { v } = await visitor(['catalogue:read']);
        peers.set(HOME, livePeer({ federationAuthScopes: ['memory:read', 'memory:write', 'catalogue:read'] }));
        expect((await withCurrentScopes(storage, v)).scopes).toEqual(['catalogue:read']);
    });
});

describe('the shared anonymous principal is known by its identity', () => {
    beforeAll(() => enableAnonymousAuth(`shared#anonymous@${NODE}`, 'anonymous', NODE));

    it('answers for the minted token, which carries no anonymous claim', async () => {
        const token = await issueJWT({
            sub: `shared#anonymous@${NODE}`, owner: 'anonymous', node: NODE, roles: ['agent'], scopes: ['catalogue:read'], anonymous: true,
        }, 3600);
        const v = (await verifyJWT(token))!;
        expect(v.anonymous).toBeUndefined();
        expect(isAnonymousPrincipal(v)).toBe(true);
        expect(isAnonymousPrincipal({ sub: `shared#anonymous@${NODE}` })).toBe(true);
    });

    it('answers for the injected identity, and for nobody else', () => {
        expect(isAnonymousPrincipal({ sub: 'x', anonymous: true })).toBe(true);
        expect(isAnonymousPrincipal({ sub: `bot#alice@${NODE}`, owner: 'alice' })).toBe(false);
        expect(isAnonymousPrincipal({ sub: `anonymous@${HOME}`, owner: `anonymous@${HOME}`, federated: true })).toBe(false);
        expect(isAnonymousPrincipal(null)).toBe(false);
    });
});
