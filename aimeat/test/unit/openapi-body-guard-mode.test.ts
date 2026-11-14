/**
 * @file openapi-body-guard-mode.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node setting security.request_body_check (config/security.ts,
 *   data/openapi-body-modes.ts) as the request-body guard (middleware/openapi-body-guard.ts) reads it.
 *   observe passes a body that does not match the contract on to its route; enforce refuses it for a
 *   caller with a session and passes a caller without one on to the route's own answer; an exempt
 *   route is observed in enforce mode; and a change of the setting applies to the next request of
 *   the same middleware, without a restart, also when it is switched to enforce before the deferred
 *   read of the contract ran. The setting's row, its default and the exempt list's reasons are held too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-guard-mode.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 1).
 */
import { describe, it, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { buildBodyContract, type BodyContract } from '../../src/services/openapi-body-contract.js';
import { openapiBodyGuard, type OpenApiBodyGuardOptions } from '../../src/middleware/openapi-body-guard.js';
import {
    BODY_CHECK_MODES, DEFAULT_BODY_CHECK_MODE, EXEMPT_BODY_ROUTES, bodyCheckModeFrom, type BodyCheckMode,
} from '../../src/data/openapi-body-modes.js';
import { CONFIG_FIELDS } from '../../src/services/config/schema.js';
import { logger } from '../../src/utils/logger.js';

const thing = { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 10 } } };
const DOC = {
    paths: {
        '/v1/things/{id}': { put: { requestBody: { required: true, content: { 'application/json': { schema: thing } } } } },
        '/v1/loose/{id}': { put: { requestBody: { content: { 'application/json': { schema: thing } } } } },
    },
};
const contract = (): BodyContract => buildBodyContract(DOC as never);

let servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; vi.restoreAllMocks(); });

/** A caller has a session when it sends the header the stub reads, as hasSession reads a token. */
const hasSession = (req: express.Request): boolean => req.headers['x-session'] === 'yes';

async function app(opts: OpenApiBodyGuardOptions): Promise<string> {
    const a = express();
    a.use(express.json());
    a.use(openapiBodyGuard('test-node', { load: contract, hasSession, ...opts }));
    const echo = (req: express.Request, res: express.Response) => { res.status(201).json({ got: req.body ?? null }); };
    a.put('/v1/things/:id', echo);
    a.put('/v1/loose/:id', echo);
    const server = a.listen(0);
    servers.push(server);
    await new Promise(r => server.once('listening', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function put(base: string, path: string, body: unknown, session: boolean): Promise<{ status: number; code?: string; field?: string }> {
    const res = await fetch(base + path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(session ? { 'x-session': 'yes' } : {}) },
        body: JSON.stringify(body),
    });
    const json = await res.json() as { error?: { code?: string; details?: Array<{ path: string }> } };
    return { status: res.status, code: json.error?.code, field: json.error?.details?.[0]?.path };
}

describe('security.request_body_check', () => {
    it('observe passes a body that does not match on to the route', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const base = await app({ mode: () => 'observe' });
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 201);
    });

    it('enforce refuses it for a caller with a session, naming the field, and passes a caller without one', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const base = await app({ mode: () => 'enforce' });
        assert.deepEqual(await put(base, '/v1/things/a', { name: 12 }, true), { status: 400, code: 'VALIDATION_ERROR', field: 'name' });
        assert.equal((await put(base, '/v1/loose/a', { name: 'x'.repeat(11) }, true)).status, 400, 'every route with a body schema is enforced');
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, false)).status, 201, 'no session: the route answers');
        assert.equal((await put(base, '/v1/things/a', { name: 'ok' }, true)).status, 201, 'a matching body is answered by the route');
    });

    it('a refusal is logged with the route, the field and the reason, and never the value', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const base = await app({ mode: () => 'enforce' });
        await put(base, '/v1/loose/a', { name: 'secret-value-never-logged' }, true);
        const lines = warn.mock.calls.filter(c => c[0] === 'openapi body mismatch refused');
        assert.deepEqual(lines.map(c => c[1]), [{ mode: 'enforce', route: 'PUT /v1/loose/{id}', field: 'name', reason: 'too_long', status: 400 }]);
        assert.ok(!JSON.stringify(warn.mock.calls).includes('secret-value-never-logged'));
    });

    it('an exempt route is observed in enforce mode', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const base = await app({ mode: () => 'enforce', exempt: ['PUT /v1/loose/{id}'] });
        assert.equal((await put(base, '/v1/loose/a', { name: 12 }, true)).status, 201);
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 400);
    });

    it('a change of the setting applies to the next request, without a restart', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        let mode: BodyCheckMode = 'enforce';
        const base = await app({ mode: () => mode });
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 400);
        mode = 'observe';
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 201);
        mode = 'enforce';
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 400);
    });

    it('switched to enforce before the deferred read of the contract, the next request is checked', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        let mode: BodyCheckMode = 'observe';
        let reads = 0;
        const guard = openapiBodyGuard('test-node', { load: () => { reads++; return contract(); }, hasSession, mode: () => mode });
        assert.equal(guard.ready(), false, 'observe reads the contract after the middleware is built');
        mode = 'enforce';
        const a = express();
        a.use(express.json());
        a.use(guard);
        a.put('/v1/things/:id', (_req, res) => { res.status(201).json({}); });
        const server = a.listen(0);
        servers.push(server);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        assert.equal((await put(base, '/v1/things/a', { name: 12 }, true)).status, 400);
        assert.equal(reads, 1);
    });

    it('enforce reads the contract while the middleware is built', () => {
        const guard = openapiBodyGuard('test-node', { load: contract, mode: () => 'enforce' });
        assert.equal(guard.ready(), true);
    });

    it('is a Config row of observe and enforce, enforce by default, changeable without a restart', () => {
        const row = CONFIG_FIELDS.find(f => f.dotPath === 'security.request_body_check');
        assert.ok(row, 'the Config tab has the row');
        assert.equal(row.key, 'requestBodyCheck');
        assert.equal(row.envVar, 'AIMEAT_REQUEST_BODY_CHECK');
        assert.deepEqual([...(row.choices ?? [])], [...BODY_CHECK_MODES]);
        assert.equal(row.immutable, false);
        assert.equal(row.applies, undefined, 'applies at once');
        assert.equal(row.validate('loose'), false);
        assert.equal(DEFAULT_BODY_CHECK_MODE, 'enforce');
        assert.equal(bodyCheckModeFrom(undefined), 'enforce');
        assert.equal(bodyCheckModeFrom(' Observe '), 'observe');
        assert.equal(bodyCheckModeFrom('off'), 'enforce');
    });

    it('every exempt route says why', () => {
        for (const e of EXEMPT_BODY_ROUTES) {
            assert.match(e.route, /^(POST|PUT|PATCH|DELETE) \/\S+$/, e.route);
            assert.ok(e.reason.trim().length > 10, `${e.route} has a reason`);
        }
    });
});
