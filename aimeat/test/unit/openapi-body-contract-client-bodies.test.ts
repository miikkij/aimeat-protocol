/**
 * @file openapi-body-contract-client-bodies.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Request-body contracts corrected to the bodies the node's own clients send: the served
 *   app libraries (src/static/sdk-libs/) and the portal services (public/js/services/). Each case is a
 *   body a client sends and the route accepts today, which openapi.yaml refused (structure programme
 *   2026-11, batch 8). The body goes through the real request body guard (middleware/openapi-body-guard.ts)
 *   with the real openapi.yaml, in enforce mode, with a caller that has a session and with no route
 *   exempt, in front of a stub route that answers 201: a body the contract refuses gets the guard's
 *   400, a body it matches reaches the route. Where the route refuses a body itself, the contract is
 *   shown to refuse it as well, so no correction is looser than the route.
 * @usage cd aimeat && pnpm exec vitest run test/unit/openapi-body-contract-client-bodies.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial: POST /v1/account/events (structure programme 2026-11, batch 8).
 */
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { loadBodyContract, type BodyContract } from '../../src/services/openapi-body-contract.js';
import { openapiBodyGuard } from '../../src/middleware/openapi-body-guard.js';
import { logger } from '../../src/utils/logger.js';

let contract: BodyContract | null = null;
let base = '';
let close: () => void = () => {};

beforeAll(async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    contract = loadBodyContract();
    assert.ok(contract, 'openapi.yaml was not found');
    const app = express();
    app.use(express.json());
    app.use(openapiBodyGuard('test-node', { load: () => contract, mode: () => 'enforce', exempt: [], hasSession: () => true }));
    app.all('/{*rest}', (_req, res) => { res.status(201).json({ ok: true }); });
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
}, 60_000);

afterAll(() => { close(); vi.restoreAllMocks(); });

/** The status a body gets through the guard in enforce mode: 201 from the stub route, or the guard's 400 with the field. */
async function send(method: string, path: string, body: unknown): Promise<string> {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 201) return '201';
    const json = await res.json() as { error?: { details?: Array<{ path: string; code: string }> } };
    const d = json.error?.details?.[0];
    return `${res.status} ${d?.path ?? ''} ${d?.code ?? ''}`.trim();
}

/** Every body reaches the route. */
async function taken(method: string, path: string, bodies: unknown[]): Promise<void> {
    for (const b of bodies) assert.equal(await send(method, path, b), '201', `${method} ${path} ${JSON.stringify(b).slice(0, 120)}`);
}

/** Every body is refused by the contract, as the route refuses it. */
async function refused(method: string, path: string, bodies: unknown[]): Promise<void> {
    for (const b of bodies) assert.notEqual(await send(method, path, b), '201', `contract accepts ${method} ${path} ${JSON.stringify(b).slice(0, 120)}`);
}

describe('POST /v1/account/events (aimeat-events.js record)', () => {
    // events/index.js documents data as Record<string, string|number|boolean>; routes/account-events.ts
    // safeData keeps strings, numbers and booleans as text, skips null, and cuts the row to 12 values of
    // 200 characters rather than refusing it.
    it('takes numbers, booleans and null in data, and more than the 12 values and 200 characters a row keeps', async () => {
        await taken('POST', '/v1/account/events', [
            { kind: 'score_saved', data: { count: 3, ratio: 0.5, done: true, label: 'game' } },
            { kind: 'score_saved', data: { gone: null }, link: '/orders/9', subject: 'o9' },
            { kind: 'score_saved', data: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'x'.repeat(201)])) },
        ]);
    });

    it('refuses a body without a kind, or with a kind that is a sentence, as the route does', async () => {
        await refused('POST', '/v1/account/events', [{ data: { count: 3 } }, { kind: 'Order placed' }]);
    });
});
