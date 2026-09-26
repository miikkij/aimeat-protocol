/**
 * @file test/unit/federated-principal.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A session signed in on another node is a VISITOR carrying its home identity, and that
 *   is decided once, where every token is read (verifyJWT), not door by door.
 *
 *   WHY. The federated login minted roles:['owner'] with `owner` set to the local part of the
 *   visitor's home name, which can equal a LOCAL account's name. September 2026 closed that door by
 *   door, then at four gates (5e597ec44), and the audit's sweep still found doors that decided "is
 *   this the account holder" on the role or the name alone: the agent roster, the home feed, the A2A
 *   account road, the AI-spend gate, device authorization's same-owner shortcut, the node-wide schema
 *   door, the personal tunnel. Each read `roles.includes('owner')` or the owner name itself. The one
 *   thing all of them share is the token they read, so that is where a visitor stops looking like an
 *   owner: no owner role, and a name (its home GHII) that no local account can have.
 * @usage cd aimeat && pnpm exec vitest run test/unit/federated-principal.test.ts
 * @version-history
 *   v1.2.0 — 2026-09-26 — localAccountOf: an account of this node, or none (secaudit 2026-09, F-1 as a
 *     class).
 *   v1.1.0 — 2026-09-26 — localAccountName: this node's identities, another node's, and a visitor
 *     a route composed with this node's id (secaudit 2026-09, F-1 as a class).
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, root cause F-1).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));
vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initNodeKeys, issueJWT, verifyJWT, type VerifiedToken } from '../../src/auth/jwt.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { isOwnerPrincipal, requireRole, requireScope } from '../../src/auth/middleware.js';
import { homeIdentityOf, isForeignPrincipal, localAccountName, localAccountOf, resolveIdentity, setThisNodeId } from '../../src/utils/gaii.js';

const NODE = 'aimeat-local-001-dev';
const HOME = 'aimeat-peer-home-001';

beforeAll(async () => {
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
});

/** The token the federated login minted until 2026-09-24: an owner role and the bare local name. */
async function legacyVisitorToken(): Promise<string> {
    return issueJWT({
        sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'], scopes: ['memory:read', 'catalogue:read'],
        federated: true, homeNode: HOME, homeUrl: 'https://home.example',
    }, 3600);
}

function mockReq(auth: VerifiedToken): Request {
    return { headers: {}, method: 'GET', path: '/v1/x', auth } as unknown as Request;
}
function mockRes(): Response & { _status: number | null } {
    const r = {
        _status: null as number | null,
        status(code: number) { r._status = code; return r; },
        json() { return r; },
        setHeader() { return r; },
        headersSent: false,
    };
    return r as unknown as Response & { _status: number | null };
}
function passes(mw: (req: Request, res: Response, next: () => void) => void, auth: VerifiedToken): boolean {
    let passed = false;
    mw(mockReq(auth), mockRes(), () => { passed = true; });
    return passed;
}

describe('the token of a visitor from another node', () => {
    it('reads as a visitor: no owner role, whatever role the token names', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(v).not.toBeNull();
        expect(v!.federated).toBe(true);
        expect(v!.roles).toEqual(['federated']);
    });

    it('carries the visitor\'s HOME identity as its name, which no local account can have', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(v!.owner).toBe(`alice@${HOME}`);
        expect(v!.sub).toBe(`alice@${HOME}`);
        expect(v!.homeNode).toBe(HOME);
    });

    it('keeps the scopes this node granted the peer', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(v!.scopes).toEqual(['memory:read', 'catalogue:read']);
    });

    it('reads the same whichever shape it was minted in (the view is idempotent)', async () => {
        const once = await verifyJWT(await legacyVisitorToken());
        const again = await verifyJWT(await issueJWT({
            sub: once!.sub, owner: once!.owner, node: NODE, roles: once!.roles, scopes: once!.scopes,
            federated: true, homeNode: HOME, homeUrl: 'https://home.example',
        }, 3600));
        expect(again!.owner).toBe(once!.owner);
        expect(again!.sub).toBe(once!.sub);
        expect(again!.roles).toEqual(once!.roles);
    });

    it('leaves a local owner\'s token exactly as it was', async () => {
        const v = await verifyJWT(await issueJWT({ sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'], scopes: [] }, 3600));
        expect(v!.roles).toEqual(['owner']);
        expect(v!.owner).toBe('alice');
        expect(v!.federated).toBe(false);
    });
});

describe('what the gates make of the visitor', () => {
    it('isForeignPrincipal names it, and nothing else', async () => {
        const visitor = await verifyJWT(await legacyVisitorToken());
        const owner = await verifyJWT(await issueJWT({ sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'], scopes: [] }, 3600));
        expect(isForeignPrincipal(visitor)).toBe(true);
        expect(isForeignPrincipal(owner)).toBe(false);
        expect(isForeignPrincipal(undefined)).toBe(false);
    });

    it('its identity is its home GHII, once, never the local namesake\'s', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(resolveIdentity(v!, NODE)).toBe(`alice@${HOME}`);
    });

    it('is never the account holder and holds no local role', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(isOwnerPrincipal(v)).toBe(false);
        expect(passes(requireRole('owner'), v!)).toBe(false);
        expect(passes(requireRole('agent'), v!)).toBe(false);
    });

    it('reaches a scoped door on the scope it holds, and no further', async () => {
        const v = await verifyJWT(await legacyVisitorToken());
        expect(passes(requireScope('memory:read'), v!)).toBe(true);
        expect(passes(requireScope('memory:write'), v!)).toBe(false);
        expect(passes(requireScope('ai:use'), v!)).toBe(false);
    });
});

describe('homeIdentityOf', () => {
    it('composes the home GHII from a bare name', () => {
        expect(homeIdentityOf({ owner: 'alice', homeNode: HOME })).toBe(`alice@${HOME}`);
    });
    it('keeps a name that is already a home GHII', () => {
        expect(homeIdentityOf({ owner: `alice@${HOME}`, homeNode: HOME })).toBe(`alice@${HOME}`);
    });
    it('names nobody, rather than a local account, when the home node is missing', () => {
        expect(homeIdentityOf({ owner: 'alice' })).toBe('alice@unknown-home-node');
    });
});

describe('localAccountName', () => {
    beforeAll(() => setThisNodeId(NODE));
    afterAll(() => setThisNodeId(null));

    it('names the account of an identity on this node, whatever acts in it', () => {
        expect(localAccountName('alice')).toBe('alice');
        expect(localAccountName(`alice@${NODE}`)).toBe('alice');
        expect(localAccountName(`bot#alice@${NODE}`)).toBe('alice');
        expect(localAccountName(`eco:drum#alice@${NODE}`)).toBe('alice');
    });

    it('keeps an identity of another node whole, so it names nobody here', () => {
        expect(localAccountName(`alice@${HOME}`)).toBe(`alice@${HOME}`);
        expect(localAccountName(`bot#alice@${HOME}`)).toBe(`bot#alice@${HOME}`);
    });

    it('keeps a visitor whole when a route composed it with this node', () => {
        // Routes compose the caller as `${req.auth.owner}@${config.nodeId}`, and a visitor's owner is its
        // home GHII, so the composed name ends in this node. Cut at the first '@' it was the namesake.
        expect(localAccountName(`alice@${HOME}@${NODE}`)).toBe(`alice@${HOME}`);
        expect(localAccountName(`bot#alice@${HOME}@${NODE}`)).toBe(`alice@${HOME}`);
    });
});

describe('localAccountOf', () => {
    beforeAll(() => setThisNodeId(NODE));
    afterAll(() => setThisNodeId(null));

    it('names the account of an identity on this node', () => {
        expect(localAccountOf('alice')).toBe('alice');
        expect(localAccountOf(`alice@${NODE}`)).toBe('alice');
        expect(localAccountOf(`bot#alice@${NODE}`)).toBe('alice');
    });

    it('names none for an identity of another node, composed or not, and none for nothing', () => {
        expect(localAccountOf(`alice@${HOME}`)).toBeNull();
        expect(localAccountOf(`bot#alice@${HOME}`)).toBeNull();
        expect(localAccountOf(`alice@${HOME}@${NODE}`)).toBeNull();
        expect(localAccountOf('')).toBeNull();
    });
});
