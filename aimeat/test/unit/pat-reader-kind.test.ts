/**
 * @file test/unit/pat-reader-kind.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A personal access token is an AI reader (TARGET-082 V4, decided 2026-09-29): a PAT is
 *   what a program or an AI client uses, and a person reads in their own session.
 *
 *   What this pins: readerKindOf reads `via: 'pat'` as an AI whatever the roles; the auth middleware
 *   marks an identity resolved from a raw PAT, so a PAT issued before the mark existed is covered;
 *   the `via` claim survives issueJWT and verifyJWT, and a claim with any other value is dropped; the
 *   mark changes neither the roles nor the scopes the PAT resolves to.
 * @usage cd aimeat && pnpm exec vitest run test/unit/pat-reader-kind.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V4).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Request, Response } from 'express';
import { SignJWT } from 'jose';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));

import { generateKeyPair } from '../../src/auth/keypair.js';
import { readerKindOf } from '../../src/services/classification/reader-kind.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

type Jwt = typeof import('../../src/auth/jwt.js');
type Middleware = typeof import('../../src/auth/middleware.js');

const NODE = 'aimeat-unit-001-test';
const ACCOUNT_MADE = new Date(Date.now() - 3_600_000).toISOString();
const PAT_MADE = new Date(Date.now() - 60_000).toISOString();

/** One account, and one PAT row per raw token: an owner-level one and an agent-level one. */
const patRows: Record<string, unknown> = {
    owner: { id: 'pat-owner', owner: 'ada', gaii: `ada@${NODE}`, label: 'owner', scopes: [], grantOwner: true, grantOperator: false,
        createdAt: PAT_MADE, expiresAt: null, lastUsedAt: null, revoked: false },
    agent: { id: 'pat-agent', owner: 'ada', gaii: `apptester-1#ada@${NODE}`, label: 'agent', scopes: ['memory:read'], grantOwner: false,
        grantOperator: false, createdAt: PAT_MADE, expiresAt: null, lastUsedAt: null, revoked: false },
};
const storage = {
    getOwner: async (name: string) => name === 'ada' ? { name: 'ada', roles: ['owner'], createdAt: ACCOUNT_MADE, disabledAt: null } : null,
    // hashToken is SHA-256 of the raw token; the stub keys on which raw token was hashed instead.
    getPatByHash: async (hash: string) => hash === hashes.owner ? patRows.owner : hash === hashes.agent ? patRows.agent : null,
    touchPat: async () => undefined,
    // requireAuth records an agent's lastSeen.
    updateAgent: async () => undefined,
    isTokenRevoked: async () => false,
    revokeToken: async () => undefined,
    cleanExpiredRevocations: async () => 0,
} as unknown as Storage;
const hashes = { owner: '', agent: '' };

let j: Jwt;
let mw: Middleware;

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { hashToken } = await import('../../src/services/owner-session.js');
    hashes.owner = hashToken('aimeat_pat_owner');
    hashes.agent = hashToken('aimeat_pat_agent');
    const keys = await generateKeyPair();
    j = await import('../../src/auth/jwt.js');
    await j.initNodeKeys(keys.publicKey, keys.privateKey);
    j.initRevocationStorage(storage);
    mw = await import('../../src/auth/middleware.js');
    mw.initSessionAuth(storage, { nodeId: NODE } as AimeatConfig);
});
afterAll(() => { vi.useRealTimers(); });

/** Run requireAuth over a Bearer header and return the identity it set, or null on a refusal. */
async function authOf(bearer: string): Promise<Request['auth'] | null> {
    const req = { headers: { authorization: `Bearer ${bearer}` }, path: '/v1/memory' } as unknown as Request;
    let status = 0;
    const res = {
        status(code: number) { status = code; return this; },
        json() { return this; },
        set() { return this; },
        setHeader() { return this; },
    } as unknown as Response;
    let passed = false;
    await mw.requireAuth()(req, res, () => { passed = true; });
    return passed && status === 0 ? req.auth ?? null : null;
}

describe('readerKindOf and the PAT mark', () => {
    it('reads an owner-level PAT as an AI, and the same roles without the mark as a person', () => {
        expect(readerKindOf({ roles: ['owner'], via: 'pat' })).toBe('ai');
        expect(readerKindOf({ roles: ['owner', 'operator'], via: 'pat' })).toBe('ai');
        expect(readerKindOf({ roles: ['agent'], via: 'pat' })).toBe('ai');
        expect(readerKindOf({ roles: ['owner'] })).toBe('human');
    });

    it('keeps anonymous ahead of the mark', () => {
        expect(readerKindOf({ roles: ['agent'], anonymous: true, via: 'pat' })).toBe('anonymous');
    });
});

describe('the auth middleware marks a raw PAT', () => {
    it('marks an owner-level PAT and leaves its roles and scopes as they were', async () => {
        const auth = await authOf('aimeat_pat_owner');
        expect(auth).toMatchObject({ sub: 'ada', owner: 'ada', roles: ['owner'], scopes: [], via: 'pat' });
        expect(readerKindOf(auth)).toBe('ai');
    });

    it('marks an agent-level PAT too, with its own scopes', async () => {
        const auth = await authOf('aimeat_pat_agent');
        expect(auth).toMatchObject({ roles: ['agent'], scopes: ['memory:read'], via: 'pat' });
    });

    it('does not mark an owner session JWT', async () => {
        const token = await j.issueJWT({ sub: 'ada', owner: 'ada', node: NODE, roles: ['owner'], scopes: [] }, 3600);
        const auth = await authOf(token);
        expect(auth).not.toBeNull();
        expect(auth!.via).toBeUndefined();
        expect(readerKindOf(auth)).toBe('human');
    });
});

describe('the via claim', () => {
    it('round-trips through issueJWT and verifyJWT', async () => {
        const token = await j.issueJWT({ sub: 'ada', owner: 'ada', node: NODE, roles: ['owner'], scopes: [], via: 'pat' }, 3600);
        const v = await j.verifyJWT(token);
        expect(v).toMatchObject({ roles: ['owner'], via: 'pat' });
        expect(readerKindOf(v)).toBe('ai');
    });

    it('is absent on a token minted without it', async () => {
        const v = await j.verifyJWT(await j.issueJWT({ sub: 'ada', owner: 'ada', node: NODE, roles: ['owner'], scopes: [] }, 3600));
        expect(v).not.toBeNull();
        expect('via' in v!).toBe(false);
    });

    it('drops a claim with any other value', async () => {
        const iat = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({ owner: 'ada', node: NODE, roles: ['owner'], scopes: [], via: 'person' })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject('ada')
            .setIssuedAt(iat)
            .setExpirationTime(iat + 3600)
            .sign(j.getNodeCryptoKeys().privateKey);
        const v = await j.verifyJWT(token);
        expect(v).not.toBeNull();
        expect(v!.via).toBeUndefined();
    });
});
