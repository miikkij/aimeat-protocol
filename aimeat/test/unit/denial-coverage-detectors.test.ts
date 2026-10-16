/**
 * @file test/unit/denial-coverage-detectors.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text detectors behind check:denial-coverage and check:mcp-test-calls. Each one
 *   decides whether a gate goes red, so each reading is pinned here: a negated status is a positive
 *   control, an anonymous 401 is not a refusal of a second principal, a route is tied to the block
 *   that refuses it, and a tool name in a membership test is not a call.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit P3-08, W27, W29).
 */
import { describe, expect, it } from 'vitest';
import { denialKinds } from '../../scripts/check-denial-coverage.js';
import { namedTools } from '../../scripts/check-mcp-test-calls.js';
import { isNegatedStatus, namedRoutes, refusalIn, refusedRoutes, routeMatchers, testBlocks } from '../../scripts/lib/route-refusals.js';

describe('denialKinds (suite level)', () => {
    it('a 403 comparison is a refusal of a second principal', () => {
        expect(denialKinds("assert(r.status === 403, 'refused');")).toEqual({ second: true, anonymous: false });
    });
    it('a negated 403 is the positive control and counts as nothing (P3-08)', () => {
        expect(denialKinds("assert(r.status !== 403, `PUT 403 — this owner is not the operator`);")).toEqual({ second: false, anonymous: false });
        expect(denialKinds("assert(403 != r.status, 'x');")).toEqual({ second: false, anonymous: false });
        expect(denialKinds("assert(![401, 403].includes(r.status), 'x');")).toEqual({ second: false, anonymous: false });
    });
    it('an anonymous 401 is its own kind', () => {
        expect(denialKinds("assert(r.status === 401, 'anonymous');")).toEqual({ second: false, anonymous: true });
    });
    it('a status list holding both counts as both', () => {
        expect(denialKinds("assert([401, 403].includes(r.status), 'x');")).toEqual({ second: true, anonymous: true });
    });
    it('an MCP refusal counts, its negation does not', () => {
        expect(denialKinds("assert(r.isError, 'refused');").second).toBe(true);
        expect(denialKinds("assert(!r.isError, r.text);").second).toBe(false);
    });
    it('a status named only in the message does not count', () => {
        expect(denialKinds("assert(ok, 'expected 403 eventually');")).toEqual({ second: false, anonymous: false });
    });
});

describe('isNegatedStatus', () => {
    const at = (s: string): number => s.indexOf('403');
    it('reads both sides of the comparison', () => {
        expect(isNegatedStatus('r.status !== 403', at('r.status !== 403'))).toBe(true);
        expect(isNegatedStatus('403 !== r.status', 0)).toBe(true);
        expect(isNegatedStatus('r.status === 403', at('r.status === 403'))).toBe(false);
    });
});

describe('route refusals', () => {
    const matchers = routeMatchers(['PUT /v1/flags/{id}', 'GET /v1/flags', 'POST /v1/admin/maintenance', 'GET /v1/flags/{id}']);

    it('ties a refusal to the route its block names, with the method of the same statement', () => {
        const block = "await test('x', async () => { const r = await json(`/v1/flags/${id}`, { method: 'PUT', headers: h(t) }); assert(r.status === 403, 'refused'); });";
        expect(refusalIn(block)).toEqual({ s401: false, s403: true });
        expect([...namedRoutes(block, matchers)]).toEqual(['PUT /v1/flags/{id}']);
    });
    it('a path with no method word nearby is a GET', () => {
        const block = "const r = await json('/v1/flags'); assert(r.status === 401, 'anon');";
        expect([...namedRoutes(block, matchers)]).toEqual(['GET /v1/flags']);
    });
    it('a method given before the path, as a helper argument, is read', () => {
        expect([...namedRoutes("await api('POST', '/v1/admin/maintenance', {});", matchers)]).toEqual(['POST /v1/admin/maintenance']);
    });
    it('a negated status refuses nothing', () => {
        expect(refusalIn("assert(r.status !== 403, 'should pass');")).toEqual({ s401: false, s403: false });
    });
    it('a block that calls the suite\'s own helper names the helper\'s route', () => {
        const source = [
            "const review = (id: string, status: unknown, token?: string) =>",
            "    json(`/v1/flags/${encodeURIComponent(id)}`, { method: 'PUT', token, body: JSON.stringify({ status }) });",
            "await test('a plain owner is refused', async () => {",
            "    const r = await review(flagId, 'dismissed', plain.token);",
            "    assert(r.status === 403, 'refused');",
            "});",
        ].join('\n');
        expect([...refusedRoutes([source], matchers)]).toEqual(['PUT /v1/flags/{id}']);
    });
    it('cuts a suite at its test( calls', () => {
        expect(testBlocks("setup; await test('a', f); await test('b', g);")).toHaveLength(2);
        expect(testBlocks('no tests here')).toEqual(['no tests here']);
    });
});

describe('namedTools (MCP tool calls)', () => {
    it('a quoted tool name is a call, a membership test is not', () => {
        const texts = [
            "await callTool(s, 'aimeat_alpha', {});",
            "assert(names.includes('aimeat_beta'), 'offered');",
        ];
        expect([...namedTools(['aimeat_alpha', 'aimeat_beta', 'aimeat_gamma'], texts)]).toEqual(['aimeat_alpha']);
    });
    it('a longer name does not satisfy a shorter one', () => {
        expect(namedTools(['aimeat_task_get'], ["call('aimeat_task_get_all')"]).size).toBe(0);
    });
});
