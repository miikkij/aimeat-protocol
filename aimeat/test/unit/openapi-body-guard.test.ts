/**
 * @file openapi-body-guard.test.ts
 * @description The request-body check against openapi.yaml (services/openapi-body-contract.ts,
 *   middleware/openapi-body-guard.ts). Observe mode is proven to change nothing a caller sees: the
 *   same route answers the same status and body with the guard mounted as without it, for a body
 *   that matches the contract and for one that does not, and the log line names the route, the field
 *   and the reason but never the value. Enforce mode is proven on a route the test enforces (none is
 *   enforced in data/openapi-body-modes.ts). The real openapi.yaml is read, and the operations whose
 *   schema ajv cannot compile are listed, so a new one is seen.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-guard.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B5).
 */
import { describe, it, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { buildBodyContract, loadBodyContract, routeKey, type BodyContract } from '../../src/services/openapi-body-contract.js';
import { openapiBodyGuard, type OpenApiBodyGuardOptions } from '../../src/middleware/openapi-body-guard.js';
import { ENFORCED_BODY_ROUTES } from '../../src/data/openapi-body-modes.js';
import { logger } from '../../src/utils/logger.js';
import ts from 'typescript';
import { classify, applyEnforced, enforcedProblems } from '../../scripts/check-write-validation.js';

const SECRET = 'value-that-must-never-reach-a-log-line';

/** A small contract in the shape openapi.yaml has: a shared schema by $ref, prose, a parameter. */
const DOC = {
    paths: {
        '/v1/things/{id}': {
            put: {
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
                },
            },
        },
        '/v1/things/mine': {
            put: {
                requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['mine'], properties: { mine: { type: 'boolean' } } } } } },
            },
        },
        '/v1/files/{name}.json': {
            post: { requestBody: { $ref: '#/components/requestBodies/File' } },
        },
        '/v1/refuses': {
            post: { requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { size: { type: 'integer' } } } } } } },
        },
        '/v1/plain': {
            post: { requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } } },
        },
    },
    components: {
        schemas: {
            Thing: {
                type: 'object',
                description: 'A thing.',
                additionalProperties: false,
                required: ['name'],
                properties: {
                    name: { type: 'string', maxLength: 10, description: 'Its name.', example: 'x' },
                    // A FIELD called description: stripping prose must not drop it.
                    description: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
                },
            },
        },
        requestBodies: {
            File: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['size'], properties: { size: { type: 'integer', minimum: 0 } } } } } },
        },
    },
};

let servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; vi.restoreAllMocks(); });

/** An app with the same echo routes, with or without the guard in front of them. */
async function app(guardOpts?: OpenApiBodyGuardOptions): Promise<{ base: string; guard?: ReturnType<typeof openapiBodyGuard> }> {
    const a = express();
    a.use(express.json());
    a.use(express.text());
    const guard = guardOpts ? openapiBodyGuard('test-node', { loadNow: true, ...guardOpts }) : undefined;
    if (guard) a.use(guard);
    const echo = (req: express.Request, res: express.Response) => { res.status(201).json({ got: req.body ?? null, path: req.path }); };
    a.put('/v1/things/:id', echo);
    a.put('/v1/things/mine', echo);
    a.post('/v1/files/:name', echo);
    a.post('/v1/plain', echo);
    // A route that refuses the body itself, as a route with its own checks does.
    a.post('/v1/refuses', (_req, res) => { res.status(422).json({ refused: true }); });
    a.post('/v1/elsewhere', echo);
    const server = a.listen(0);
    servers.push(server);
    await new Promise(r => server.once('listening', r));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, guard };
}

const contract = (): BodyContract => buildBodyContract(DOC as never);

/** A mismatch is recorded when the server closes the response, which can follow the client's read. */
const settle = () => new Promise(r => setTimeout(r, 20));

async function send(base: string, method: string, path: string, body?: unknown, type = 'application/json') {
    const res = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { 'content-type': type },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as unknown };
}

describe('the contract', () => {
    it('finds a literal segment before a parameter, a parameter inside a segment, and a body by $ref', () => {
        const c = contract();
        assert.equal(c.match('PUT', '/v1/things/mine')?.route, 'PUT /v1/things/mine');
        assert.equal(c.match('PUT', '/v1/things/abc')?.route, 'PUT /v1/things/{id}');
        assert.equal(c.match('put', '/v1/things/abc/')?.route, 'PUT /v1/things/{id}');
        assert.equal(c.match('POST', '/v1/files/report.json')?.route, 'POST /v1/files/{name}.json');
        assert.equal(c.match('POST', '/v1/files/report.txt'), undefined);
        assert.equal(c.match('GET', '/v1/things/abc'), undefined);
        assert.equal(c.match('POST', '/v1/plain'), undefined, 'a body in another media type is not in the contract');
        assert.equal(c.match('POST', '/v1/files/a.json')?.bodyRequired, true);
        assert.equal(routeKey('patch', '/v1/agents/{name}/scopes'), routeKey('PATCH', '/v1/agents/:agentName/scopes'));
    });

    it('validates against the shared schema and keeps a field named description', () => {
        const v = contract().match('PUT', '/v1/things/x')!.validator()!;
        assert.equal(v({ name: 'a', description: 'kept as a field' }), true);
        assert.equal(v({ name: 'a', other: 1 }), false);
        assert.equal(v.errors?.[0].keyword, 'additionalProperties');
    });

    it('never changes the body: no defaults, no coercion, no removal', () => {
        const doc = { paths: { '/v1/x': { post: { requestBody: { content: { 'application/json': { schema: {
            type: 'object', additionalProperties: false, properties: { n: { type: 'integer', default: 5 } },
        } } } } } } } };
        const v = buildBodyContract(doc as never).match('POST', '/v1/x')!.validator()!;
        const body: Record<string, unknown> = { n: '7', extra: true };
        const before = JSON.stringify(body);
        v(body);
        assert.equal(JSON.stringify(body), before);
        const empty: Record<string, unknown> = {};
        v(empty);
        assert.deepEqual(empty, {});
    });
});

describe('observe mode answers exactly as without the guard', () => {
    const cases: Array<[string, string, unknown, string?]> = [
        ['PUT', '/v1/things/abc', { name: 'ok' }],
        ['PUT', '/v1/things/abc', { name: SECRET, extra: 1 }],
        ['PUT', '/v1/things/abc', { name: 12 }],
        ['PUT', '/v1/things/abc', { tags: ['a', 'b', 'c'] }],
        ['PUT', '/v1/things/abc', undefined],
        ['PUT', '/v1/things/mine', { mine: 'yes' }],
        ['POST', '/v1/files/a.json', { size: -1 }],
        ['POST', '/v1/plain', 'text body', 'text/plain'],
        ['POST', '/v1/elsewhere', { anything: true }],
    ];

    it('same status and same body for every case, matching or not', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const plain = await app();
        const guarded = await app({ load: contract });
        for (const [method, path, body, type] of cases) {
            const a = await send(plain.base, method, path, body, type);
            const b = await send(guarded.base, method, path, body, type);
            assert.deepEqual(b, a, `${method} ${path} ${JSON.stringify(body)}`);
        }
    });

    it('counts each mismatch by route, field and reason, and logs no value', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const { base, guard } = await app({ load: contract });
        await send(base, 'PUT', '/v1/things/abc', { name: SECRET, extra: 1 });
        await send(base, 'PUT', '/v1/things/abc', { name: SECRET, extra: 2 });
        await send(base, 'PUT', '/v1/things/abc', { name: 12 });
        await send(base, 'PUT', '/v1/things/abc', { name: 'x'.repeat(11) });
        await send(base, 'PUT', '/v1/things/abc', undefined);
        await send(base, 'POST', '/v1/files/a.json', { size: -1 });
        await send(base, 'PUT', '/v1/things/abc', { name: 'ok' });

        await send(base, 'POST', '/v1/refuses', { size: 1, extra: true });

        await settle();
        const seen = guard!.observations().map(o => `${o.route} | ${o.field} | ${o.reason} | ${o.count} | ${o.accepted} | ${o.refused}`).sort();
        assert.deepEqual(seen, [
            'POST /v1/files/{name}.json | size | too_short | 1 | 1 | 0',
            'POST /v1/refuses | extra | unknown_field | 1 | 0 | 1',
            'PUT /v1/things/{id} |  | required | 1 | 1 | 0',
            'PUT /v1/things/{id} | extra | unknown_field | 2 | 2 | 0',
            'PUT /v1/things/{id} | name | invalid_type | 1 | 1 | 0',
            'PUT /v1/things/{id} | name | too_long | 1 | 1 | 0',
        ]);
        const lines = warn.mock.calls.filter(c => c[0] === 'openapi body mismatch');
        assert.equal(lines.length, 7, 'one line per mismatching request');
        assert.deepEqual(lines[1][1], { mode: 'observe', route: 'PUT /v1/things/{id}', field: 'extra', reason: 'unknown_field', status: 201, count: 2, accepted: 2 });
        assert.deepEqual(lines[6][1], { mode: 'observe', route: 'POST /v1/refuses', field: 'extra', reason: 'unknown_field', status: 422, count: 1, accepted: 0 });
        assert.ok(!JSON.stringify(warn.mock.calls).includes(SECRET), 'the value never reaches the log');
    });

    it('past the lines a minute allows, mismatches are still counted and one line says how many were left out', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const { base, guard } = await app({ load: contract, logLinesPerMinute: 2 });
        for (let i = 0; i < 5; i++) await send(base, 'PUT', '/v1/things/abc', { name: 1 });
        await settle();
        assert.equal(guard!.observations()[0].count, 5);
        assert.equal(warn.mock.calls.filter(c => c[0] === 'openapi body mismatch').length, 2);
    });

    it('a contract that cannot be read passes every request on', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const { base, guard } = await app({ load: () => { throw new Error('broken yaml'); } });
        assert.deepEqual(await send(base, 'PUT', '/v1/things/abc', { name: 12 }), { status: 201, body: { got: { name: 12 }, path: '/v1/things/abc' } });
        assert.equal(guard!.ready(), true);
        assert.deepEqual(guard!.observations(), []);
    });

    it('reads the contract after the middleware is built when nothing is enforced', async () => {
        let reads = 0;
        const guard = openapiBodyGuard('test-node', { load: () => { reads++; return contract(); } });
        assert.equal(guard.ready(), false);
        assert.equal(reads, 0);
        await new Promise(r => setTimeout(r, 5));
        assert.equal(guard.ready(), true);
        assert.equal(reads, 1);
    });
});

describe('enforce mode', () => {
    it('answers 400 VALIDATION_ERROR naming the field on an enforced route, and leaves the others observed', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const { base, guard } = await app({ load: contract, enforced: ['PUT /v1/things/{id}'] });
        const r = await send(base, 'PUT', '/v1/things/abc', { name: 'x'.repeat(11) });
        assert.equal(r.status, 400);
        const err = (r.body as { error: { code: string; details: Array<{ path: string; code: string; max?: number }> } }).error;
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.deepEqual(err.details.map(d => [d.path, d.code, d.max]), [['name', 'too_long', 10]]);
        assert.equal((await send(base, 'PUT', '/v1/things/abc', { name: 'ok' })).status, 201);
        assert.equal((await send(base, 'POST', '/v1/files/a.json', { size: -1 })).status, 201, 'not enforced: observed');
        await settle();
        assert.deepEqual(guard!.observations().map(o => o.route), ['POST /v1/files/{name}.json']);
    });

    it('no route is enforced in the mode table', () => {
        assert.deepEqual(ENFORCED_BODY_ROUTES, []);
    });
});

describe('check:write-validation counts an enforced route as validated', () => {
    const src = (code: string) => ts.createSourceFile('r.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const ROUTES = `
        router.put('/v1/things/:thingId', (req, res) => { const n = req.body.name; res.json(n); });
        router.post('/v1/files/:name', handler);
        router.post('/v1/other', (req, res) => { res.json(req.body); });`;

    it('a by-hand or elsewhere route that is enforced is class contract; the rest keep their class', () => {
        const routes = classify('r.ts', src(ROUTES));
        assert.deepEqual(routes.map(r => r.cls), ['by hand', 'elsewhere', 'by hand']);
        applyEnforced(routes, ['PUT /v1/things/{id}', 'POST /v1/files/{name}']);
        assert.deepEqual(routes.map(r => [r.id, r.cls]), [
            ['PUT /v1/things/:thingId', 'contract'],
            ['POST /v1/files/:name', 'contract'],
            ['POST /v1/other', 'by hand'],
        ]);
    });

    it('refuses an enforced entry the contract has no JSON body for, or that no route declares', () => {
        const routes = classify('r.ts', src(ROUTES));
        assert.deepEqual(enforcedProblems(routes, ['PUT /v1/things/{id}'], contract), []);
        assert.deepEqual(enforcedProblems(routes, ['POST /v1/other', 'PUT /v1/nowhere/{x}'], contract), [
            'POST /v1/other: openapi.yaml declares no application/json request body for it',
            'PUT /v1/nowhere/{x}: openapi.yaml declares no application/json request body for it',
            'PUT /v1/nowhere/{x}: no route in src/routes/ declares it',
        ]);
    });
});

describe('the real openapi.yaml', () => {
    it('is read, and every JSON body schema compiles except the ones listed here', () => {
        const c = loadBodyContract();
        assert.ok(c, 'openapi.yaml is found');
        assert.ok(c.operations.size > 600, `operations with a JSON body: ${c.operations.size}`);
        const notCompiled = [...c.operations.values()].filter(op => op.validator() === null).map(op => op.route).sort();
        // Each of these uses a keyword the way OpenAPI 3.0 did, which a 3.1 document's JSON Schema
        // refuses (exclusiveMinimum as a boolean, nullable without a type). They are observed as not
        // checkable until the contract entry is corrected; then delete the line here.
        assert.deepEqual(notCompiled, [
            'PATCH /v1/boards/{boardId}/posts/{postId}',
            'PATCH /v1/boards/{boardId}/rules',
            'POST /v1/boards',
            'PUT /v1/federation/peers/{nodeId}',
            'PUT /v1/federation/peers/{nodeId}/settlement-ceiling',
        ]);
    }, 60_000);
});
