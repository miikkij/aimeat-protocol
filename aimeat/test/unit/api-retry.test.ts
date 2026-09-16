/**
 * @file test/unit/api-retry.test.ts
 * @description Executes the SPA client against ambiguous failures: a write must not run twice.
 * @version-history v1.0.0 -- 2026-09-16 -- Regression tests for the shared retry policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { session } = vi.hoisted(() => ({ session: { jwt: 'old', refresh: vi.fn() } }));
vi.mock('/js/services/auth.js', () => ({ getSession: () => session }));
import { api } from '../../public/js/api.js';

const reply = (status: number) => new Response(JSON.stringify(status < 400
    ? { ok: true, data: 'saved' } : { ok: false, error: { code: 'FAILED', message: 'Original failure' } }),
{ status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    vi.useFakeTimers();
    session.jwt = 'old';
    session.refresh.mockReset().mockImplementation(async () => { session.jwt = 'new'; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function outcome(options: Record<string, unknown>) {
    const result = api('/v1/example', options).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    return result;
}

describe('ambiguous writes', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const failure of ['503', 'network', 'timeout']) {
            it(`${method} is sent once after ${failure}, even with a retry override`, async () => {
                const send = vi.fn().mockImplementation(async () => {
                    if (failure === 'network') throw new TypeError('Connection lost');
                    if (failure === 'timeout') throw new DOMException('Aborted', 'AbortError');
                    return reply(503);
                });
                vi.stubGlobal('fetch', send);
                const result = await outcome({ method, retries: 3 });
                expect(result).toBeInstanceOf(Error);
                expect(send).toHaveBeenCalledTimes(1); // Previously four executions.
                if (failure === '503') expect(result).toMatchObject({ code: 'FAILED', status: 503 });
            });
        }
    }
    it('gives each POST/PUT a UUID and preserves a supplied case-insensitive key', async () => {
        const send = vi.fn().mockImplementation(async () => reply(200));
        vi.stubGlobal('fetch', send);
        await api('/v1/example', { method: 'POST' });
        await api('/v1/example', { method: 'PUT' });
        const keys = send.mock.calls.map(([, opts]) => new Headers(opts.headers).get('Idempotency-Key'));
        expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
        expect(keys[1]).not.toBe(keys[0]);
        await api('/v1/example', { method: 'POST', headers: { 'idempotency-key': keys[0] } });
        expect(new Headers(send.mock.calls[2][1].headers).get('Idempotency-Key')).toBe(keys[0]);
    });
    it('still refreshes a refused credential once with retries:0 and the same request key', async () => {
        const send = vi.fn().mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200));
        vi.stubGlobal('fetch', send);
        expect(await outcome({ method: 'POST', retries: 0 })).toMatchObject({ ok: true });
        expect(session.refresh).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(2);
        const keys = send.mock.calls.map(([, opts]) => new Headers(opts.headers).get('Idempotency-Key'));
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);
    });
    it('reports 429 without losing the original error, including retries:0', async () => {
        const send = vi.fn().mockImplementation(async () => reply(429));
        vi.stubGlobal('fetch', send);
        expect(await outcome({ method: 'POST', retries: 0 })).toMatchObject({ code: 'FAILED', status: 429 });
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('a failed credential refresh does not resend the write', async () => {
        session.refresh.mockRejectedValueOnce(new Error('Refresh refused'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const send = vi.fn().mockImplementation(async () => reply(401));
        vi.stubGlobal('fetch', send);
        expect(await outcome({ method: 'POST' })).toMatchObject({ status: 401 });
        expect(send).toHaveBeenCalledTimes(1);
    });
});

it('retains bounded retries for reads and honours retries:0', async () => {
    const send = vi.fn().mockImplementation(async () => reply(503));
    vi.stubGlobal('fetch', send);
    expect(await outcome({})).toBeInstanceOf(Error);
    expect(send).toHaveBeenCalledTimes(4);
    send.mockClear();
    await outcome({ method: 'GET', retries: 0 });
    expect(send).toHaveBeenCalledTimes(1);
});
