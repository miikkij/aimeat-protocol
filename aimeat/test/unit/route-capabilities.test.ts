/**
 * @file test/unit/route-capabilities.test.ts
 * @description The REST routes as capabilities (services/invoke/route-capabilities.ts) and the request a
 *   route capability's input describes (services/invoke/route-invoke.ts).
 *
 *   What is pinned: the catalogue is generated from the running contract and holds the routes a caller
 *   with a session can run, never a sign-in, token, setup or MCP route, `/v1/invoke`, a route only an
 *   outside credential reaches, or a non-JSON body; its ids cannot collide with a tool's; and an input
 *   can only fill the route's own path template, its declared query names and a body.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial, with route capabilities.
 */
import { describe, it, expect } from 'vitest';
import {
    listRouteCapabilities, findRouteCapability, buildRouteCapabilities, routeExclusion, routeCapabilityContract,
} from '../../src/services/invoke/route-capabilities.js';
import { routeRequestOf } from '../../src/services/invoke/route-invoke.js';
import { listNodeCapabilities, listAllCapabilities, findNodeCapability } from '../../src/services/node-capabilities.js';

describe('route capabilities from openapi.yaml', () => {
    const caps = listRouteCapabilities();

    it('are generated from the contract, hundreds of them', () => {
        expect(caps.length).toBeGreaterThan(500);
        for (const c of caps) {
            expect(c.id).toBe(`route:${c.method} ${c.path}`);
            expect(c.kind).toBe('route');
        }
    });

    it('never collide with a tool id', () => {
        const tools = new Set(listNodeCapabilities().map(c => c.id));
        expect(caps.filter(c => tools.has(c.id))).toEqual([]);
        expect(listAllCapabilities().length).toBe(tools.size + caps.length);
    });

    it('leave out what a caller with a session has no reason to run as itself', () => {
        const paths = caps.map(c => c.path);
        for (const p of paths) {
            expect(p.startsWith('/v1/')).toBe(true);
            expect(p === '/v1/invoke' || p.startsWith('/v1/mcp/') || p === '/v1/mcp').toBe(false);
            expect(p.startsWith('/v1/auth/') || p.startsWith('/v1/ghii/login') || p.startsWith('/v1/setup')).toBe(false);
        }
        expect(findRouteCapability('route:POST /v1/ghii/login')).toBeUndefined();
        expect(findRouteCapability('route:POST /v1/invoke')).toBeUndefined();
    });

    it('find a route by the contract spelling and by the Express spelling', () => {
        const a = findRouteCapability('route:GET /v1/agents/{name}/telemetry');
        const b = findRouteCapability('route:get /v1/agents/:name/telemetry');
        expect(a).toBeDefined();
        expect(b?.id).toBe(a?.id);
        expect(findNodeCapability('route:GET /v1/agents/{name}/telemetry')?.kind).toBe('route');
    });

    it('carry the permission word the contract names', () => {
        const withWord = caps.filter(c => c.permission);
        expect(withWord.length).toBeGreaterThan(10);
        expect(withWord.every(c => typeof c.permission!.word === 'string' && c.description.includes(c.permission!.word))).toBe(true);
    });

    it('give a body schema on a contract read', () => {
        const bulk = findRouteCapability('route:POST /v1/memory/bulk')!;
        expect(bulk.input.body).toBeDefined();
        const contract = routeCapabilityContract(bulk);
        expect(JSON.stringify(contract.body_schema)).toContain('entries');
    });

    it('exclude by the contract: outside credentials, public routes, non-JSON bodies, streams, binaries', () => {
        const doc = { paths: {} };
        expect(routeExclusion('/v1/x', 'get', { security: [{ DataspaceAuth: [] }] }, doc)).toMatch(/outside credential/);
        expect(routeExclusion('/v1/x', 'get', { security: [] }, doc)).toMatch(/public/);
        expect(routeExclusion('/v1/x', 'get', { security: [{}, { BearerAuth: [] }] }, doc)).toBeNull();
        expect(routeExclusion('/v1/x', 'post', { requestBody: { content: { 'multipart/form-data': {} } } }, doc)).toMatch(/not JSON/);
        expect(routeExclusion('/v1/x', 'get', { responses: { '200': { content: { 'text/event-stream': {} } } } }, doc)).toMatch(/stream/);
        expect(routeExclusion('/v1/x', 'get', { responses: { '200': { content: { 'application/zip': {} } } } }, doc)).toMatch(/binary/);
        expect(routeExclusion('/v1/x', 'get', { parameters: [{ in: 'header', name: 'X-Signature' }] }, doc)).toMatch(/peer/);
        expect(buildRouteCapabilities({ paths: { '/v1/x/{id}': { get: { summary: 'One x', parameters: [{ name: 'id', in: 'path' }] } } } }))
            .toMatchObject([{ id: 'route:GET /v1/x/{id}', required: ['path'], title: 'One x' }]);
    });
});

describe('the request a route capability input describes', () => {
    const telemetry = findRouteCapability('route:GET /v1/agents/{name}/telemetry')!;
    const runs = findRouteCapability('route:GET /v1/ledger/usage/runs')!;

    it('fills the path template one encoded segment per value', () => {
        expect(routeRequestOf(telemetry, { path: { name: 'a/b c' } })).toEqual({ url: '/v1/agents/a%2Fb%20c/telemetry' });
    });

    it('refuses a missing value, a dot segment and a name the route does not declare', () => {
        expect(routeRequestOf(telemetry, {})).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        expect(routeRequestOf(telemetry, { path: { name: '..' } })).toMatchObject({ ok: false });
        expect(routeRequestOf(telemetry, { path: { name: 'x', other: 'y' } })).toMatchObject({ ok: false });
        expect(routeRequestOf(runs, { query: { sneaky: 1 } })).toMatchObject({ ok: false });
        expect(routeRequestOf(runs, { headers: { 'x-admin-password': 'p' } })).toMatchObject({ ok: false });
    });

    it('sends declared query values and refuses a body on a route that takes none', () => {
        expect(routeRequestOf(runs, { query: { limit: 3, run_id: 'r1' } })).toEqual({ url: '/v1/ledger/usage/runs?limit=3&run_id=r1' });
        expect(routeRequestOf(runs, { body: { a: 1 } })).toMatchObject({ ok: false });
    });
});
