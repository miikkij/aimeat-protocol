/**
 * @file openapi-body-guard-session.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On an enforced route the request-body guard (middleware/openapi-body-guard.ts) refuses
 *   a body only from a caller with a session. A caller without one is passed on, so the route's own
 *   sign-in check answers it as it did before the route was enforced (401), whatever the body is.
 *
 *   "Without a session" is what requireAuth() refuses: no identity on the request, or the shared
 *   anonymous identity that optionalAuth() sets in anonymous mode. The guard is handed the same
 *   predicate requireAuth() uses (auth/middleware.ts hasSession), and this file mounts the real
 *   optionalAuth() and requireAuth() around it, with anonymous mode off and on.
 *
 *   Cases, in both modes: no credential and a wrong body, no credential and no body at all, no
 *   credential and a matching body (401 each, and the mismatch is observed as refused by the route);
 *   a session and a wrong body (400 VALIDATION_ERROR naming the field); a session and a matching body
 *   (the route's own answer). And the predicate itself, against requireAuth() on the same request.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-guard-session.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial. Seen red on 920665c33, where the guard answered a caller without a
 *     session 400 before the route's sign-in check could answer 401.
 */
import { describe, it, beforeAll, afterAll, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));

import { generateKeyPair } from '../../src/auth/keypair.js';
import { buildBodyContract, type BodyContract } from '../../src/services/openapi-body-contract.js';
import { openapiBodyGuard, type OpenApiBodyGuard } from '../../src/middleware/openapi-body-guard.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-unit-body-guard-session';

const storage = {
    isTokenRevoked: async () => false,
    revokeToken: async () => undefined,
    cleanExpiredRevocations: async () => 0,
    getOwner: async (name: string) => ({ name, roles: ['owner'], createdAt: '2020-01-01T00:00:00.000Z', disabledAt: null }),
    isSessionRevoked: async () => false,
    getAppGrant: async () => null,
    getEcosystemApp: async () => null,
    getPatByHash: async () => null,
    getPat: async () => null,
    touchPat: async () => undefined,
    getAgent: async () => null,
    // requireAuth() notes when it last saw an agent, and the anonymous identity has the agent role.
    updateAgent: async () => null,
} as unknown as Storage;

const DOC = {
    paths: {
        '/v1/things/{id}': {
            put: {
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 10 } } } } },
                },
            },
        },
    },
};
const contract = (): BodyContract => buildBodyContract(DOC as never);

type Mw = typeof import('../../src/auth/middleware.js');
type Jwt = typeof import('../../src/auth/jwt.js');
type NodeAuth = typeof import('../../src/auth/node-auth.js');
let mw: Mw;
let jwt: Jwt;
let nodeAuth: NodeAuth;

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keys = await generateKeyPair();
    jwt = await import('../../src/auth/jwt.js');
    await jwt.initNodeKeys(keys.publicKey, keys.privateKey);
    jwt.initRevocationStorage(storage);
    mw = await import('../../src/auth/middleware.js');
    mw.initSessionAuth(storage, { nodeId: NODE } as AimeatConfig);
    nodeAuth = await import('../../src/auth/node-auth.js');
});
afterAll(() => { vi.useRealTimers(); });

let servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; });

/** The order server.ts mounts them in: the JSON parser, optionalAuth(), the guard, then the route. */
async function app(): Promise<{ base: string; guard: OpenApiBodyGuard; handled: () => number }> {
    const a = express();
    a.use(express.json());
    a.use(mw.optionalAuth());
    const guard = openapiBodyGuard(NODE, { load: contract, loadNow: true, enforced: ['PUT /v1/things/{id}'], hasSession: mw.hasSession });
    a.use(guard);
    let handled = 0;
    a.put('/v1/things/:id', mw.requireAuth(), (req, res) => { handled++; res.status(201).json({ got: req.body ?? null }); });
    const server = a.listen(0);
    servers.push(server);
    await new Promise(r => server.once('listening', r));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, guard, handled: () => handled };
}

interface Answer { status: number; code?: string; details?: Array<{ path: string; code: string }> }

async function put(base: string, body: unknown, token?: string): Promise<Answer> {
    const res = await fetch(`${base}/v1/things/abc`, {
        method: 'PUT',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({})) as { error?: { code?: string; details?: Answer['details'] } };
    return { status: res.status, code: json.error?.code, details: json.error?.details };
}

const ownerToken = () => jwt.issueJWT({ sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'] }, 600);
/** A mismatch is recorded when the server closes the response, which can follow the client's read. */
const settle = () => new Promise(r => setTimeout(r, 20));

describe.each([false, true])('an enforced route, anonymous mode %s', (anonymousOn) => {
    beforeAll(() => {
        if (anonymousOn) nodeAuth.enableAnonymousAuth(`shared#anonymous@${NODE}`, 'anonymous');
        assert.equal(nodeAuth.isAnonymousMode(), anonymousOn);
    });

    it('a caller without a session and with a wrong body gets the route\'s 401, not the guard\'s 400', async () => {
        const { base, guard, handled } = await app();
        const r = await put(base, { name: 12 });
        assert.equal(r.status, 401, `expected the route's own 401, got ${r.status} ${r.code}`);
        assert.notEqual(r.code, 'VALIDATION_ERROR');
        assert.equal(handled(), 0);
        await settle();
        assert.deepEqual(guard.observations().map(o => [o.route, o.field, o.reason, o.accepted, o.refused]),
            [['PUT /v1/things/{id}', 'name', 'invalid_type', 0, 1]], 'the mismatch is observed, as refused by the route');
    });

    it('a caller without a session and with no body at all gets 401', async () => {
        const { base } = await app();
        const r = await put(base, undefined);
        assert.equal(r.status, 401, `expected 401, got ${r.status} ${r.code}`);
    });

    it('a caller without a session and with a matching body gets 401', async () => {
        const { base, guard } = await app();
        assert.equal((await put(base, { name: 'ok' })).status, 401);
        await settle();
        assert.deepEqual(guard.observations(), []);
    });

    it('a caller with a session and a wrong body gets 400 VALIDATION_ERROR naming the field', async () => {
        const { base, handled } = await app();
        const r = await put(base, { name: 12 }, await ownerToken());
        assert.equal(r.status, 400);
        assert.equal(r.code, 'VALIDATION_ERROR');
        assert.deepEqual(r.details?.map(d => [d.path, d.code]), [['name', 'invalid_type']]);
        assert.equal(handled(), 0, 'refused before the route ran');
    });

    it('a caller with a session and no body at all gets 400: the contract requires one', async () => {
        const { base } = await app();
        const r = await put(base, undefined, await ownerToken());
        assert.equal(r.status, 400);
        assert.deepEqual(r.details?.map(d => [d.path, d.code]), [['', 'required']]);
    });

    it('a caller with a session and a matching body gets the route\'s answer', async () => {
        const { base, handled } = await app();
        assert.equal((await put(base, { name: 'ok' }, await ownerToken())).status, 201);
        assert.equal(handled(), 1);
    });

    it('hasSession says what requireAuth() does with the same request', async () => {
        const seen: Array<{ session: boolean; admitted: boolean }> = [];
        const a = express();
        a.use(mw.optionalAuth());
        a.get('/probe', (req, res, next) => { res.locals.session = mw.hasSession(req); next(); },
            (req, res, next) => { res.on('finish', () => seen.push({ session: res.locals.session as boolean, admitted: res.statusCode === 200 })); next(); },
            mw.requireAuth(), (_req, res) => { res.json({ ok: true }); });
        const server = a.listen(0);
        servers.push(server);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        await fetch(`${base}/probe`);
        await fetch(`${base}/probe`, { headers: { Authorization: `Bearer ${await ownerToken()}` } });
        await settle();
        assert.deepEqual(seen, [{ session: false, admitted: false }, { session: true, admitted: true }]);
    });
});
