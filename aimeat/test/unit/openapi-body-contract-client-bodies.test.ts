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

describe('POST /v1/work/request, /v1/work and /v1/work/batch (aimeat-work.js request, batch)', () => {
    // work/index.js passes input and opts through as given; WorkRequestSchema (models/schemas.ts) reads
    // input as z.unknown() (any value, the key required) and ttl_hours as a positive number up to 720.
    const req = (input: unknown, extra: Record<string, unknown> = {}) => ({ action_id: 'translate-text', provider_gaii: 'bot#alice@node-a', input, ...extra });

    it('takes an input of any JSON type, and a ttl_hours that is not a whole number', async () => {
        const bodies = [req('translate this'), req(3), req(['a', 'b']), req(null), req({ text: 'x' }, { ttl_hours: 1.5, priority: 'high' })];
        await taken('POST', '/v1/work/request', bodies);
        await taken('POST', '/v1/work', bodies);
        await taken('POST', '/v1/work/batch', [{ requests: bodies }]);
    });

    it('refuses a request without input, or with a ttl_hours of 0 or over 720, as the route does', async () => {
        const { input: _drop, ...noInput } = req('x');
        await refused('POST', '/v1/work/request', [noInput, req('x', { ttl_hours: 0 }), req('x', { ttl_hours: 721 })]);
        await refused('POST', '/v1/work/batch', [{ requests: [noInput] }]);
    });
});

describe('POST /v1/work/{tc}/deliver and /redeliver (aimeat-work.js deliver)', () => {
    // work/index.js sends { output, metadata? } as given; WorkDeliverySchema reads output as z.unknown()
    // (any value, the key required) and metadata as z.unknown().optional(). The re-delivery after a
    // dispute (routes/disputes.ts) shares the schema and refuses only a missing output.
    const path = '/v1/work/tc-a1b2c3d4-e5f6-7890-abcd-ef1234567890/deliver';

    it('takes an output and metadata of any JSON type', async () => {
        const bodies = [{ output: 'the translation' }, { output: 42 }, { output: null }, { output: { text: 'x' }, metadata: 'model x' }, { output: [1, 2], metadata: { ms: 3 } }];
        await taken('POST', path, bodies);
        await taken('POST', path.replace(/deliver$/, 'redeliver'), bodies);
    });

    it('refuses a delivery without output, as the route does', async () => {
        await refused('POST', path, [{}, { result: 'x' }]);
    });
});

describe('POST /v1/ai/decisions/{id}/review (aimeat-decide.js review, aimeat-refinery.js teach)', () => {
    // decide/index.js documents override as any; refinery/index.js teach() sends the class name the
    // person chose, a string. services/decide/service.ts reviewDecision stores override as given and
    // checks only outcome and note.
    const path = '/v1/ai/decisions/dec-1/review';

    it('takes an override of any JSON type', async () => {
        await taken('POST', path, [
            { outcome: 'overridden', override: 'invoice' },
            { outcome: 'overridden', override: 3 },
            { outcome: 'overridden', override: { class: 'invoice' }, note: 'it was an invoice' },
            { outcome: 'confirmed' },
        ]);
    });

    it('refuses a body without an outcome the route knows, or with a note over 2000 characters, as the route does', async () => {
        await refused('POST', path, [{ override: 'x' }, { outcome: 'maybe' }, { outcome: 'confirmed', note: 'x'.repeat(2001) }]);
    });
});

describe('PUT /v1/classification/label, POST /v1/classification/label/review and /exceptions (aimeat-labels.js set, review, except)', () => {
    // labels/index.js targetParams sends `owner: o.owner`, and an item from list() carries owner null for
    // the person's own content. services/classification/labels.ts holderOf reads undefined, null and ''
    // as the caller's own.
    const target = { kind: 'memory', key: 'notes.plan', owner: null };

    it('takes owner null for the caller\'s own content', async () => {
        await taken('PUT', '/v1/classification/label', [{ ...target, label: 'internal' }]);
        await taken('POST', '/v1/classification/label/review', [{ ...target, decision: 'accept' }]);
        await taken('POST', '/v1/classification/exceptions', [{ ...target, action: 'ai-send', reason: 'the board asked for it' }]);
    });

    it('still refuses an owner that is not text or null', async () => {
        await refused('PUT', '/v1/classification/label', [{ ...target, owner: 5, label: 'internal' }]);
    });
});

describe('POST /v1/ai/stream and /v1/ai/speak (aimeat-voice.js node adapters)', () => {
    // voice/adapters.js sends app_id: config.appId, which is '' unless the app sets it (voice/config.js).
    // For an app grant, routes/ai-voice.ts voiceAppId reads an empty app_id as absent and uses the
    // signed app. An owner or agent caller sending '' is refused by the route itself (min 1).
    it('takes the voice library\'s default body with an empty app_id', async () => {
        await taken('POST', '/v1/ai/stream', [{ messages: [{ role: 'user', content: 'hello' }], app_id: '', temperature: 0.7, top_p: 1, reasoning: null }]);
        await taken('POST', '/v1/ai/speak', [{ input: 'hello', app_id: '', model: 'gpt-4o-mini-tts', voice: 'alloy', response_format: 'pcm', speed: 1, instructions: '' }]);
    });

    it('still refuses an app_id over 200 characters', async () => {
        await refused('POST', '/v1/ai/stream', [{ messages: [{ role: 'user', content: 'hello' }], app_id: 'x'.repeat(201) }]);
    });
});

describe('DELETE /v1/ghii/totp (portal security.js totpDisable)', () => {
    // security.js sends { backup_code } when the person turns two-step sign-in off with a backup code;
    // routes/totp.ts hands { code, backup_code } to checkTotpManagementCode, which takes either one.
    it('takes a backup code in place of the code', async () => {
        await taken('DELETE', '/v1/ghii/totp', [{ backup_code: 'a1b2c3d4' }, { code: '123456' }]);
    });

    it('still refuses a body with neither', async () => {
        await refused('DELETE', '/v1/ghii/totp', [{}, { backupCode: 'a1b2c3d4' }]);
    });
});

describe('PUT /v1/datapackages/{owner}/{name}/exchange (portal dataproducts.js sellPackage)', () => {
    // views/profile/offers/sell-dialog.js termsBody sends toll_morsels: null when the pacing field is
    // empty, the usual money-only sale. DatapackageExchangeSchema reads toll_morsels, odps and provenance
    // as nullable, and services/exchange-datapackage.ts treats null as not sent.
    const path = '/v1/datapackages/alice/weather/exchange';
    const terms = { exchange: true, model: 'per_month', prices_money: [{ amount: 4_900_000, currency: 'EUR' }], usage_terms: { derivatives: false, resale: false, attribution: true } };

    it('takes toll_morsels, odps and provenance as null', async () => {
        await taken('PUT', path, [{ ...terms, toll_morsels: null }, { ...terms, toll_morsels: 3, odps: null, provenance: null }]);
    });

    it('still refuses a toll_morsels over 100', async () => {
        await refused('PUT', path, [{ ...terms, toll_morsels: 101 }]);
    });
});

describe('PUT /v1/admin/internet-openers/{owner} (portal internet-opening.js setInternetOpener)', () => {
    // The admin tab's end date is a type="date" input, so until arrives as YYYY-MM-DD.
    // services/internet-opening/opening-service.ts takes any date the clock can read that lies in the
    // future, and null or '' for no end.
    const path = '/v1/admin/internet-openers/bob';

    it('takes until as a calendar date, a timestamp, null or empty', async () => {
        await taken('PUT', path, [
            { reason: 'runs the workshop', until: '2099-12-31' },
            { reason: 'runs the workshop', until: '2099-12-31T12:00:00.000Z' },
            { reason: 'runs the workshop', until: null },
            { reason: 'runs the workshop', until: '' },
            { reason: 'runs the workshop' },
        ]);
    });

    it('still refuses a body without a reason', async () => {
        await refused('PUT', path, [{ until: '2099-12-31' }]);
    });
});
