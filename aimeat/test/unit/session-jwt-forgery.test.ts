/**
 * @file test/unit/session-jwt-forgery.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description verifyJWT and requireAuth refuse a session token the node key did not sign, a signed
 *   one whose payload or header was changed, an expired one, an unsigned one (alg none) and one signed
 *   with another algorithm. A session token issueJWT minted is the control and passes.
 *
 *   WHY. Every session on the node rests on jwtVerify checking the EdDSA signature and the expiry.
 *   The tests that existed gave verifyJWT tokens the node key had signed, so replacing jwtVerify
 *   with a bare decode left them green. The expired case lives here because only a test holding the
 *   node key can mint an expired token the node signed; the E2E half is test/e2e-session-forgery.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/session-jwt-forgery.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F20-01).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Request, Response } from 'express';
import { SignJWT, generateKeyPair as joseKeyPair } from 'jose';
import { createHmac } from 'node:crypto';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));

import { generateKeyPair } from '../../src/auth/keypair.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-unit-001-test';
const OWNER = 'pia';
const OPERATOR = 'olli';

/** Two live owners, nothing revoked. */
const store = {
    isTokenRevoked: async () => false,
    revokeToken: async () => undefined,
    cleanExpiredRevocations: async () => 0,
    getOwner: async (name: string) => ([OWNER, OPERATOR].includes(name)
        ? { name, roles: name === OPERATOR ? ['owner', 'operator'] : ['owner'], createdAt: '2020-01-01T00:00:00.000Z', disabledAt: null }
        : null),
    isSessionRevoked: async () => false,
    getAppGrant: async () => null,
    getEcosystemApp: async () => null,
    getAgent: async () => null,
} as unknown as Storage;

type Jwt = typeof import('../../src/auth/jwt.js');
type Mw = typeof import('../../src/auth/middleware.js');
let jwt: Jwt;
let mw: Mw;
let real = '';

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const parts = (token: string) => {
    const [h, p, s] = token.split('.');
    return {
        header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
        payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
        sig: s,
    };
};
const sessionClaims = (owner: string) => ({ owner, node: NODE, roles: owner === OPERATOR ? ['owner', 'operator'] : ['owner'], scopes: [] as string[] });

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keys = await generateKeyPair();
    jwt = await import('../../src/auth/jwt.js');
    await jwt.initNodeKeys(keys.publicKey, keys.privateKey);
    jwt.initRevocationStorage(store, NODE);
    mw = await import('../../src/auth/middleware.js');
    mw.initSessionAuth(store, { nodeId: NODE } as AimeatConfig);
    real = await jwt.issueJWT({ sub: OWNER, ...sessionClaims(OWNER) }, 3600);
}, 120_000);
afterAll(() => { vi.useRealTimers(); });

/** What requireAuth answers for this bearer: 200 when it called next(), else the status it sent. */
async function requireAuthAnswer(token: string): Promise<number> {
    let code = 0;
    let passed = false;
    const req = {
        headers: { authorization: `Bearer ${token}` }, method: 'GET', path: '/v1/probe', protocol: 'http',
        get: (name: string) => (name.toLowerCase() === 'host' ? 'localhost' : undefined),
    } as unknown as Request;
    const res = {
        headersSent: false,
        status(c: number) { code = c; return res; },
        json() { return res; },
        setHeader() { return res; },
    } as unknown as Response;
    await mw.requireAuth()(req, res, () => { passed = true; });
    return passed ? 200 : code;
}

describe('a session token is accepted only as the node key signed it', () => {
    it('the control: a token issueJWT minted verifies and passes requireAuth', async () => {
        expect(await jwt.verifyJWT(real)).toMatchObject({ sub: OWNER, owner: OWNER, roles: ['owner'] });
        expect(await requireAuthAnswer(real)).toBe(200);
    });

    it('refuses a session-shaped token signed with another Ed25519 key', async () => {
        const foreign = await joseKeyPair('EdDSA', { crv: 'Ed25519' });
        const token = await new SignJWT(sessionClaims(OPERATOR))
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(OPERATOR).setIssuedAt().setExpirationTime('1h')
            .sign(foreign.privateKey);
        expect(await jwt.verifyJWT(token)).toBeNull();
        expect(await requireAuthAnswer(token)).toBe(401);
    });

    it('refuses a real token whose claims were changed, one claim at a time, with the signature kept', async () => {
        const { header, payload, sig } = parts(real);
        const variants: Array<[string, Record<string, unknown>]> = [
            ['sub', { ...payload, sub: OPERATOR }],
            ['owner', { ...payload, owner: OPERATOR }],
            ['roles', { ...payload, roles: ['owner', 'operator'] }],
            ['scopes', { ...payload, scopes: ['*'] }],
            ['exp', { ...payload, exp: payload.exp + 86400 }],
        ];
        for (const [claim, changed] of variants) {
            const token = `${b64url(header)}.${b64url(changed)}.${sig}`;
            expect(await jwt.verifyJWT(token), claim).toBeNull();
            expect(await requireAuthAnswer(token), claim).toBe(401);
        }
    });

    it('refuses a real token whose signature was replaced by another token\'s', async () => {
        const other = await jwt.issueJWT({ sub: OPERATOR, ...sessionClaims(OPERATOR) }, 3600);
        const forged = `${real.split('.').slice(0, 2).join('.')}.${other.split('.')[2]}`;
        expect(await jwt.verifyJWT(forged)).toBeNull();
    });

    it('refuses a token the node key signed that has expired', async () => {
        const { privateKey } = jwt.getNodeCryptoKeys();
        const now = Math.floor(Date.now() / 1000);
        const expired = await new SignJWT(sessionClaims(OWNER))
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(OWNER)
            .setIssuedAt(now - 7200).setExpirationTime(now - 60).sign(privateKey);
        expect(await jwt.verifyJWT(expired)).toBeNull();
        expect(await requireAuthAnswer(expired)).toBe(401);
        // The same claims a minute in the future verify: the expiry, not the key, refused it.
        const live = await new SignJWT(sessionClaims(OWNER))
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(OWNER)
            .setIssuedAt(now - 7200).setExpirationTime(now + 60).sign(privateKey);
        expect(await jwt.verifyJWT(live)).not.toBeNull();
    });

    it('refuses an unsigned token (alg none), with and without a signature segment', async () => {
        const claims = { ...sessionClaims(OPERATOR), sub: OPERATOR, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}`;
        for (const token of [`${unsigned}.`, unsigned, `${unsigned}.${parts(real).sig}`]) {
            expect(await jwt.verifyJWT(token)).toBeNull();
            expect(await requireAuthAnswer(token)).toBe(401);
        }
    });

    it('refuses a token signed with HS256, and a real signature under a header that says HS256', async () => {
        const claims = { ...sessionClaims(OPERATOR), sub: OPERATOR, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const input = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}`;
        const hs = `${input}.${createHmac('sha256', 'guessed-secret').update(input).digest('base64url')}`;
        expect(await jwt.verifyJWT(hs)).toBeNull();
        const { payload, sig } = parts(real);
        expect(await jwt.verifyJWT(`${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${sig}`)).toBeNull();
    });
});
