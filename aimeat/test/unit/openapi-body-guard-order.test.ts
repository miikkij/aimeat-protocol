/**
 * @file openapi-body-guard-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In enforce mode the request-body guard (middleware/openapi-body-guard.ts) refuses a body
 *   just before the route's handler, after the route's own middleware. A caller the route refuses for
 *   sign-in (401), role or scope (403) or a rate limit (429) gets that answer with a body that does not
 *   match the contract, and the limiter counts the call; a caller the route admits gets the guard's 400
 *   VALIDATION_ERROR and the handler does not run; a caller without a session on a route that admits
 *   one is passed on; the switch still applies at the next request. It holds for a router built before
 *   the guard, for the second of two routes on one path, and a request answered by a terminal handler
 *   mounted with use() is observed and marked unchecked.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-guard-order.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (structure programme 2026-11, unit 1). Seen red before the refusal
 *     moved to the handler: the 401, 403 and 429 cases were answered 400 and the limiter was skipped.
 */
import { describe, it, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { buildBodyContract, type BodyContract } from '../../src/services/openapi-body-contract.js';
import { openapiBodyGuard } from '../../src/middleware/openapi-body-guard.js';
import type { BodyCheckMode } from '../../src/data/openapi-body-modes.js';
import { logger } from '../../src/utils/logger.js';

const thing = { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 10 } } };
const body = { requestBody: { required: true, content: { 'application/json': { schema: thing } } } };
const DOC = {
    paths: {
        '/v1/things/{id}': { put: body },
        '/v1/owned/{id}': { put: body },
        '/v1/limited': { post: body },
        '/v1/open': { post: body },
        '/v1/early/{id}': { post: body },
        '/v1/twice': { post: body },
        '/v1/mounted': { post: body },
    },
};
const contract = (): BodyContract => buildBodyContract(DOC as never);

let servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; vi.restoreAllMocks(); });

/** A caller has a session when it sends x-session; its role is x-role. */
const hasSession = (req: express.Request): boolean => req.headers['x-session'] === 'yes';
const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!hasSession(req)) { res.status(401).json({ error: { code: 'AUTH_REQUIRED' } }); return; }
    next();
};
const requireRole = (role: string): express.RequestHandler => (req, res, next) => {
    if (req.headers['x-role'] !== role) { res.status(403).json({ error: { code: 'FORBIDDEN' } }); return; }
    next();
};

// Built before any guard exists, as a router module evaluated at import time is.
const early = express.Router();
let earlyHandled = 0;
early.post('/v1/early/:id', requireAuth, requireRole('owner'), (_req, res) => { earlyHandled++; res.status(201).json({ ok: true }); });

async function app(mode: () => BodyCheckMode) {
    const a = express();
    a.use(express.json());
    const guard = openapiBodyGuard('test-node', { load: contract, hasSession, mode });
    a.use(guard);
    let handled = 0;
    let limited = 0;
    const limiter: express.RequestHandler = (_req, res, next) => {
        limited++;
        if (limited > 2) { res.status(429).json({ error: { code: 'RATE_LIMITED' } }); return; }
        next();
    };
    const ok = (_req: express.Request, res: express.Response) => { handled++; res.status(201).json({ ok: true }); };
    a.put('/v1/things/:id', requireAuth, ok);
    a.put('/v1/owned/:id', requireAuth, requireRole('owner'), ok);
    a.post('/v1/limited', limiter, ok);
    a.post('/v1/open', ok);
    a.use(early);
    // The first route passes the request on; the second has its own middleware.
    a.post('/v1/twice', (_req, _res, next) => { next('route'); }, ok);
    a.post('/v1/twice', requireRole('owner'), ok);
    a.use('/v1/mounted', (_req, res) => { res.status(201).json({ ok: true }); });
    const server = a.listen(0);
    servers.push(server);
    await new Promise(r => server.once('listening', r));
    return {
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        handled: () => handled, limited: () => limited, guard,
    };
}

async function send(base: string, method: string, path: string, data: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
    const json = await res.json() as { error?: { code?: string; details?: Array<{ path: string }> } };
    return { status: res.status, code: json.error?.code, field: json.error?.details?.[0]?.path };
}

const owner = { 'x-session': 'yes', 'x-role': 'owner' };
const member = { 'x-session': 'yes', 'x-role': 'member' };
const bad = { name: 12 };
/** A mismatch is recorded when the server closes the response, which can follow the client's read. */
const settle = () => new Promise(r => setTimeout(r, 20));

describe('the body is refused after the route\'s own middleware', () => {
    it('a caller the route refuses gets the route\'s 401 or 403, and the mismatch is observed with it', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.equal((await send(s.base, 'PUT', '/v1/things/a', bad)).status, 401);
        assert.deepEqual(await send(s.base, 'PUT', '/v1/owned/a', bad, member), { status: 403, code: 'FORBIDDEN', field: undefined });
        assert.equal(s.handled(), 0);
        await settle();
        const observed = warn.mock.calls.filter(c => c[0] === 'openapi body mismatch').map(c => (c[1] as { status: number }).status);
        assert.deepEqual(observed, [401, 403]);
        assert.equal(warn.mock.calls.filter(c => c[0] === 'openapi body mismatch refused').length, 0);
    });

    it('a caller the route admits gets the guard\'s 400 naming the field, and the handler does not run', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.deepEqual(await send(s.base, 'PUT', '/v1/owned/a', bad, owner), { status: 400, code: 'VALIDATION_ERROR', field: 'name' });
        assert.equal(s.handled(), 0);
        assert.equal((await send(s.base, 'PUT', '/v1/owned/a', { name: 'ok' }, owner)).status, 201);
        assert.equal(s.handled(), 1);
        await settle();
        const refused = warn.mock.calls.filter(c => c[0] === 'openapi body mismatch refused');
        assert.equal(refused.length, 1);
        assert.deepEqual(refused[0][1], { mode: 'enforce', route: 'PUT /v1/owned/{id}', field: 'name', reason: 'invalid_type', status: 400 });
        assert.equal(warn.mock.calls.filter(c => c[0] === 'openapi body mismatch').length, 0, 'a refused body is not observed too');
    });

    it('a rate limit in the route counts the call and answers 429 before the body is refused', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.equal((await send(s.base, 'POST', '/v1/limited', bad, owner)).status, 400);
        assert.equal((await send(s.base, 'POST', '/v1/limited', bad, owner)).status, 400);
        assert.equal((await send(s.base, 'POST', '/v1/limited', bad, owner)).status, 429);
        assert.equal(s.limited(), 3);
    });

    it('a caller without a session on a route that admits one is passed on to the route', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.equal((await send(s.base, 'POST', '/v1/open', bad)).status, 201);
        assert.equal((await send(s.base, 'POST', '/v1/open', bad, owner)).status, 400);
    });

    it('the switch applies at the next request, at the handler too', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        let mode: BodyCheckMode = 'observe';
        const s = await app(() => mode);
        assert.equal((await send(s.base, 'PUT', '/v1/owned/a', bad, owner)).status, 201);
        mode = 'enforce';
        assert.equal((await send(s.base, 'PUT', '/v1/owned/a', bad, owner)).status, 400);
        mode = 'observe';
        assert.equal((await send(s.base, 'PUT', '/v1/owned/a', bad, owner)).status, 201);
    });

    it('holds for a router built before the guard and for the second of two routes on one path', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.equal((await send(s.base, 'POST', '/v1/early/a', bad, member)).status, 403);
        assert.equal((await send(s.base, 'POST', '/v1/early/a', bad, owner)).status, 400);
        assert.equal(earlyHandled, 0);
        assert.equal((await send(s.base, 'POST', '/v1/twice', bad, member)).status, 403, 'the second route\'s middleware answers');
        assert.equal((await send(s.base, 'POST', '/v1/twice', bad, owner)).status, 400);
        assert.equal((await send(s.base, 'POST', '/v1/twice', { name: 'ok' }, owner)).status, 201);
    });

    it('a request answered by a terminal handler mounted with use() is observed and marked unchecked', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const s = await app(() => 'enforce');
        assert.equal((await send(s.base, 'POST', '/v1/mounted', bad, owner)).status, 201);
        await settle();
        const line = warn.mock.calls.find(c => c[0] === 'openapi body mismatch');
        assert.equal((line?.[1] as { unchecked?: boolean }).unchecked, true);
    });
});
