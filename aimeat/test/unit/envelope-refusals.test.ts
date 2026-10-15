/**
 * @file test/unit/envelope-refusals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit rows 186, 187 and 194, through real Express apps:
 *   - #194: the JSON 404 for an unknown address and the global error handler answer with the shared
 *     envelope (a request id and the support next step), with the method and path in `details`;
 *   - #186: the extended-features guard answers 503 FEATURE_DISABLED in the same envelope;
 *   - #187: POST /v1/validate finds the rule of a concrete address such as /v1/memory/my-key by its
 *     route pattern, and answers an address with no rule `valid: null, checked: false`, not `valid: true`.
 * @usage cd aimeat && pnpm exec vitest run test/unit/envelope-refusals.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #186, #187, #194).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/fallback-handlers.js';
import { requireExtendedFeatures } from '../../src/middleware/extended-features-gate.js';
import { validateRouter, findValidationRule } from '../../src/routes/validate.js';

const NODE = 'envelope-test-node';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.use('/v1/ext-only', requireExtendedFeatures({ nodeId: NODE, extendedFeaturesEnabled: false }));
  app.use(validateRouter({ nodeId: NODE } as AimeatConfig));
  app.get('/v1/throws', () => { throw new Error('a variable named secretThing was undefined'); });
  app.use(notFoundHandler(NODE));
  app.use(errorHandler(NODE));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
});

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, body: await res.json() };
}

/** The shared envelope (middleware/envelope.ts error()): the node, a request id and the support next step. */
function expectEnvelope(body: any, code: string): void {
  expect(body.ok).toBe(false);
  expect(body.protocol).toBe('aimeat');
  expect(body.node).toBe(NODE);
  expect(body.request_id).toMatch(/^req-/);
  expect(body.error.code).toBe(code);
  expect(body.hints.next_actions.some((a: any) => a.example_body?.to === 'support@operators')).toBe(true);
}

describe('#194 the 404 and the global error handler use the shared envelope', () => {
  it('an unknown address is 404 NOT_FOUND with the method and path in details', async () => {
    const r = await call('/v1/no-such-thing');
    expect(r.status).toBe(404);
    expectEnvelope(r.body, 'NOT_FOUND');
    expect(r.body.error.details).toEqual({ method: 'GET', path: '/v1/no-such-thing' });
    expect(r.body.error.message).not.toContain('/v1/no-such-thing');
  });

  it('a thrown error is 500 INTERNAL_ERROR and does not carry the exception text', async () => {
    const r = await call('/v1/throws');
    expect(r.status).toBe(500);
    expectEnvelope(r.body, 'INTERNAL_ERROR');
    expect(JSON.stringify(r.body)).not.toContain('secretThing');
  });

  it('a body over the limit is 413 QUOTA_EXCEEDED', async () => {
    const r = await call('/v1/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: '/v1/memory', method: 'POST', body: { value: 'x'.repeat(4096) } }),
    });
    expect(r.status).toBe(413);
    expectEnvelope(r.body, 'QUOTA_EXCEEDED');
  });

  it('a body that does not parse is 400 REQUEST_ERROR with the parser text in details', async () => {
    const r = await call('/v1/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken": ' });
    expect(r.status).toBe(400);
    expectEnvelope(r.body, 'REQUEST_ERROR');
    expect(typeof r.body.error.details.reason).toBe('string');
  });
});

describe('#186 the extended-features guard uses the shared envelope', () => {
  it('answers 503 FEATURE_DISABLED with the setting in details', async () => {
    const r = await call('/v1/ext-only/anything');
    expect(r.status).toBe(503);
    expectEnvelope(r.body, 'FEATURE_DISABLED');
    expect(r.body.error.details).toEqual({ setting: 'AIMEAT_EXTENDED_FEATURES' });
  });
});

describe('#187 POST /v1/validate looks a route up by its pattern', () => {
  const validate = (endpoint: string, method: string, body: unknown) => call('/v1/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, method, body }),
  });

  it('a concrete address finds the rule of its pattern and checks the body against it', async () => {
    const bad = await validate('/v1/memory/my-key', 'PUT', { visibility: 'everyone' });
    expect(bad.status).toBe(200);
    expect(bad.body.data.checked).toBe(true);
    expect(bad.body.data.valid).toBe(false);
    expect(bad.body.data.matched).toBe('/v1/memory/:key');

    const good = await validate('/v1/memory/my-key?x=1', 'PUT', { version: 2 });
    expect(good.body.data).toMatchObject({ valid: true, checked: true, matched: '/v1/memory/:key' });
  });

  it('an address with no rule is not called valid', async () => {
    const r = await validate('/v1/nothing-here', 'POST', { anything: true });
    expect(r.status).toBe(200);
    expect(r.body.data.valid).toBeNull();
    expect(r.body.data.checked).toBe(false);
  });

  it('a known address with a method it has no rule for is not called valid either', async () => {
    const r = await validate('/v1/memory/my-key', 'DELETE', {});
    expect(r.body.data.valid).toBeNull();
    expect(r.body.data.checked).toBe(false);
  });

  it('findValidationRule prefers the literal entry and matches one segment per parameter', () => {
    expect(findValidationRule('POST', '/v1/memory')?.pattern).toBe('/v1/memory');
    expect(findValidationRule('post', '/v1/work/tc-1/deliver')?.pattern).toBe('/v1/work/:tc/deliver');
    expect(findValidationRule('PUT', '/v1/memory/a/b')).toBeNull();
    expect(findValidationRule('PUT', '/v1/memory/')).toBeNull();
  });
});
