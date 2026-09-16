/**
 * @file test/unit/idempotency.test.ts
 * @description Exercises reservation lifetime, concurrent writes and lost responses.
 * @version-history v1.0.0 -- 2026-09-16 -- Proves the gaps in the response-only cache.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

function response() {
    const res = Object.assign(new EventEmitter(), {
        statusCode: 200, body: undefined as unknown,
        status(n: number) { this.statusCode = n; return this; },
        json(body: unknown) { this.body = body; return this; },
    });
    return res as typeof res & Response;
}
function request(key = randomUUID(), sub = 'owner-a', method = 'POST', path = '/v1/memory') {
    return { method, path: path.split('?')[0], originalUrl: path, auth: { sub }, headers: { 'idempotency-key': key } } as Request;
}
beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('reserves before starting work, then replays the original 502 response', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const req = request(), first = response(), second = response(), next = vi.fn();
    middleware(req, first, next);
    middleware(req, second, next);
    expect(next).toHaveBeenCalledTimes(1); // Previously both requests started the write.
    expect(second.statusCode).toBe(409);
    expect(second.body).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    first.status(502).json({ ok: false, error: { code: 'SAVED_BUT_UNREACHABLE' } });
    const replay = response();
    middleware(req, replay, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(replay.statusCode).toBe(502);
    expect(replay.body).toEqual(first.body);
});

it('a disconnected client cannot release work that may still finish', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const req = request(), first = response(), next = vi.fn();
    middleware(req, first, next);
    first.emit('close');
    const duplicate = response();
    middleware(req, duplicate, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(duplicate.statusCode).toBe(409);
    first.json({ ok: true, data: 'finished after disconnect' });
    const replay = response();
    middleware(req, replay, next);
    expect(replay.body).toEqual(first.body);
});

it('a non-JSON response retains a refusal instead of executing again', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const req = request(), first = response(), next = vi.fn();
    middleware(req, first, next);
    first.emit('finish');
    const duplicate = response();
    middleware(req, duplicate, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(duplicate.body).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_RESULT_UNAVAILABLE' } });
});

it('isolates principal, method and URL, including query parameters', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const key = randomUUID(), next = vi.fn();
    for (const req of [request(key), request(key, 'owner-b'), request(key, 'owner-a', 'PUT'),
        request(key, 'owner-a', 'POST', '/v1/other'), request(key, 'owner-a', 'POST', '/v1/memory?mode=other')]) {
        middleware(req, response(), next);
    }
    expect(next).toHaveBeenCalledTimes(5);
});

it('expired responses are not replayed before the next sweep', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const req = request(), first = response(), next = vi.fn();
    middleware(req, first, next);
    first.json({ ok: true });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    middleware(req, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
});

it('a 401 refusal can be retried after credential refresh', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const req = request(), first = response(), next = vi.fn();
    middleware(req, first, next);
    first.status(401).json({ ok: false });
    middleware(req, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
});

it('never evicts a pending request when all 10,000 slots are occupied', async () => {
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const firstKey = randomUUID(), next = vi.fn();
    middleware(request(firstKey), response(), next);
    for (let n = 1; n < 10_000; n++) middleware(request(), response(), next);
    const overflow = response();
    middleware(request(), overflow, next);
    expect(overflow.statusCode).toBe(503);
    const duplicate = response();
    middleware(request(firstKey), duplicate, next);
    expect(duplicate.statusCode).toBe(409);
    expect(next).toHaveBeenCalledTimes(10_000);
});

it('a real HTTP disconnect and concurrent duplicate still execute a slow write only once', async () => {
    vi.useRealTimers();
    const middleware = (await import('../../src/middleware/idempotency.js')).idempotency();
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    let writes = 0;
    const app = express();
    app.use(middleware);
    app.post('/slow', async (_req, res) => {
        writes++;
        started.resolve();
        await release.promise;
        res.status(502).json({ ok: false, error: { code: 'WRITE_ALREADY_HAPPENED' } });
        finished.resolve();
    });
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as import('node:net').AddressInfo;
    const url = `http://127.0.0.1:${address.port}/slow`;
    const headers = { 'Idempotency-Key': randomUUID() };
    const controller = new AbortController();
    try {
        const first = fetch(url, { method: 'POST', headers, signal: controller.signal }).catch(() => null);
        await started.promise;
        const duplicate = await fetch(url, { method: 'POST', headers });
        expect(duplicate.status).toBe(409);
        expect(await duplicate.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
        controller.abort();
        await first;
        release.resolve();
        await finished.promise;
        const replay = await fetch(url, { method: 'POST', headers });
        expect(replay.status).toBe(502);
        expect(await replay.json()).toMatchObject({ error: { code: 'WRITE_ALREADY_HAPPENED' } });
        expect(writes).toBe(1);
    } finally {
        controller.abort();
        release.resolve();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
