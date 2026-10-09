/**
 * @file test/unit/session-token-purpose.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A token the node signs for one purpose is never a session.
 *
 *   WHAT THIS PINS (secrets audit 2026-10-09, S-1). Every short-lived token the node mints is signed
 *   with the same node key as a session: a download token, a share token, an upload token, an
 *   app-access token, a draft preview and a frame grant, an operator confirmation, the pending-signup
 *   token of an external login, and a 365-day verifiable credential. verifyJWT checked the signature
 *   and the expiry only, so each of them verified as a session. They failed only because they carry no
 *   `roles`, and the ecosystem check in auth/middleware.ts then threw a TypeError, which the request
 *   answered with a 500. One default of `roles` to [] would have turned each into access as its `sub`.
 *
 *   The rule now: a session carries the session claims issueJWT writes (sub, owner, node, a roles list
 *   of strings) and none of the purpose markers (`typ`, `purpose`, `vc`), under the header type `JWT`.
 *   Anything else is not a session: verifyJWT answers null, requireAuth answers 401, and optionalAuth
 *   sets no identity.
 *
 *   Each kind is minted by its own service where the service exports a mint, so the test follows the
 *   real claims; the upload token and the credential are signed as their services sign them.
 * @usage cd aimeat && pnpm exec vitest run test/unit/session-token-purpose.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S-1).
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
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-unit-001-test';
const OWNER = 'pia';

/** Accounts, sessions and grants in miniature: one live owner, nothing revoked. */
const store = {
    isTokenRevoked: async () => false,
    revokeToken: async () => undefined,
    cleanExpiredRevocations: async () => 0,
    getOwner: async (name: string) => (name === OWNER ? { name, roles: ['owner'], createdAt: '2020-01-01T00:00:00.000Z', disabledAt: null } : null),
    isSessionRevoked: async () => false,
    getAppGrant: async () => null,
    getEcosystemApp: async () => null,
    getAgent: async () => null,
} as unknown as Storage;

type Jwt = typeof import('../../src/auth/jwt.js');
type Mw = typeof import('../../src/auth/middleware.js');
let jwt: Jwt;
let mw: Mw;
const kinds: Array<[string, string]> = [];

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keys = await generateKeyPair();
    jwt = await import('../../src/auth/jwt.js');
    await jwt.initNodeKeys(keys.publicKey, keys.privateKey);
    jwt.initRevocationStorage(store, NODE);
    mw = await import('../../src/auth/middleware.js');
    mw.initSessionAuth(store, { nodeId: NODE } as AimeatConfig);

    const { privateKey, publicKey } = jwt.getNodeCryptoKeys();
    const download = await import('../../src/services/download-token.js');
    const share = await import('../../src/services/share-token.js');
    const draft = await import('../../src/services/draft-token.js');
    const confirm = await import('../../src/services/operator-confirm.js');
    const appAccess = await import('../../src/services/app-access-token.js');
    const external = await import('../../src/services/external-login.js');
    download.initDownloadTokenKeys(privateKey, publicKey);
    share.initShareTokenKeys(privateKey, publicKey);
    draft.initDraftTokenKeys(privateKey, publicKey);
    confirm.initConfirmTokenKeys(privateKey, publicKey);

    const ghii = `${OWNER}@${NODE}`;
    kinds.push(['download', await download.generateDownloadToken({ sub: ghii, key: 'files/a.png', mimeType: 'image/png', size: 1 })]);
    kinds.push(['share', await share.generateShareToken({ org: 'org-1', ws: 'ws-1', pwv: 'v1' })]);
    kinds.push(['draft preview', await draft.generateDraftToken({ sub: OWNER, filename: 'a.html' })]);
    kinds.push(['frame grant', await draft.generateFrameToken({ sub: OWNER, filename: 'a.html', origin: 'https://x.example' })]);
    kinds.push(['operator confirm', await confirm.mintConfirmToken(OWNER, 'config.set', { a: 1 })]);
    kinds.push(['app access', await appAccess.generateAppAccessToken({ sub: OWNER, filename: 'a.html' })]);
    kinds.push(['pending signup', await external.signPendingToken({
        provider: 'google', providerSub: 'g-1', email: 'p@example.com', emailVerified: true,
        displayName: 'Pia', suggested: OWNER, redirect: '/', mode: 'signup',
    } as never)]);
    // As services/upload-token.ts signs one (its mint returns only a handle).
    kinds.push(['upload', await new SignJWT({ typ: 'upload', utype: 'storage', meta: {}, maxBytes: 1, contentType: 'text/plain' })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setJti('u-1').setSubject(ghii).setIssuedAt().setExpirationTime('1h').sign(privateKey)]);
    // As services/vc-issuer.ts signs one: a 365-day credential under the header type vc+ld+jwt.
    kinds.push(['verifiable credential', await new SignJWT({ vc: { type: ['VerifiableCredential'], credentialSubject: { id: ghii } } })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'vc+ld+jwt', kid: `did:aimeat:${NODE}#key-1` })
        .setIssuer(`did:aimeat:${NODE}`).setSubject(`did:aimeat:${ghii}`).setIssuedAt().setExpirationTime('365d').sign(privateKey)]);
    // The worst case: a purpose token that also carries every session claim. The marker decides.
    kinds.push(['purpose token with session claims', await new SignJWT({ typ: 'download', owner: OWNER, node: NODE, roles: ['owner'], scopes: [] })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(OWNER).setIssuedAt().setExpirationTime('1h').sign(privateKey)]);
// The service modules import much of the node; a cold first import takes longer than the default 10 s.
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

describe('a token minted for one purpose is not a session', () => {
    it('every kind is signed by the node key (the premise)', () => {
        expect(kinds.map(([k]) => k)).toHaveLength(10);
        for (const [, token] of kinds) expect(token.split('.')).toHaveLength(3);
    });

    it('verifyJWT answers null for each kind', async () => {
        for (const [kind, token] of kinds) {
            expect(await jwt.verifyJWT(token), kind).toBeNull();
        }
    });

    it('requireAuth answers 401 for each kind as a Bearer, never 500 and never access', async () => {
        for (const [kind, token] of kinds) {
            expect(await requireAuthAnswer(token), kind).toBe(401);
        }
    });

    it('a session token still verifies and passes', async () => {
        const token = await jwt.issueJWT({ sub: OWNER, owner: OWNER, node: NODE, roles: ['owner'], scopes: [] }, 3600);
        expect(await jwt.verifyJWT(token)).toMatchObject({ sub: OWNER, owner: OWNER, roles: ['owner'] });
        expect(await requireAuthAnswer(token)).toBe(200);
    });

    it('a token whose roles is not a list of strings is not a session', async () => {
        const { privateKey } = jwt.getNodeCryptoKeys();
        const bad = (claims: Record<string, unknown>) => new SignJWT({ owner: OWNER, node: NODE, scopes: [], ...claims })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(OWNER).setIssuedAt().setExpirationTime('1h').sign(privateKey);
        expect(await jwt.verifyJWT(await bad({}))).toBeNull();
        expect(await jwt.verifyJWT(await bad({ roles: 'owner' }))).toBeNull();
        expect(await jwt.verifyJWT(await bad({ roles: [1] }))).toBeNull();
        expect(await jwt.verifyJWT(await bad({ roles: ['owner'], owner: 7 }))).toBeNull();
    });
});
