/**
 * @file sdk-events-envelope.test.ts
 * @description AIMEAT.events reads the envelope `session.fetch` RESOLVES TO, rather than calling
 *   .json() on it.
 *
 *   THIS LIBRARY HAD NEVER WORKED. `session.fetch` returns the parsed envelope, not a Response, and
 *   all three functions did `const res = await authFetch(...); const body = await res.json();`, so
 *   every call threw "res.json is not a function" from inside the lib, one frame away from the button
 *   the person pressed. Nothing caught it because nothing exercised it: the library-pack registry
 *   proves the lib is DESCRIBED, `check:sdk` proves the bundle matches its source, and neither runs a
 *   line of it.
 *
 *   It was found on 2026-09-15 while answering a peer operator who had lost an afternoon to exactly
 *   this trap in an app of their own, and who wrote to say the same trap was waiting for anybody
 *   copying the old pattern. It was, in our own shipped library.
 *
 *   The assertions are about the SHAPE of the reply rather than its content: the stub's envelope has
 *   no `.json` at all, which is the whole point, and a refusal is an `{ok:false}` envelope rather
 *   than a rejected promise.
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

type Call = { path: string; opts: any };
let calls: Call[] = [];
let reply: unknown = null;

beforeEach(() => {
    calls = [];
    // No `.json` on this object, deliberately: `session.fetch` hands back the parsed envelope, and a
    // stub that offered a `.json()` would let the defect pass.
    const session = {
        fetch: async (path: string, opts: any = {}) => {
            calls.push({ path, opts });
            return reply;
        },
    };
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '', innerHTML: '' });
    (globalThis as any).document = (globalThis as any).document ?? {
        documentElement: { lang: 'en', ...el() }, head: el(), body: el(),
        getElementById: () => null, querySelector: () => null, createElement: el,
        addEventListener() {}, dispatchEvent() {},
    };
    (globalThis as any).location = (globalThis as any).location ?? { origin: 'https://app.test', href: 'https://app.test/', hostname: 'app.test', search: '', hash: '' };
    (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
});

async function events() {
    await import('../../src/static/sdk-libs/events/index.js');
    return (globalThis as any).window.AIMEAT.events;
}

describe('AIMEAT.events reads the envelope it is given', () => {
    it('record() returns the data instead of throwing on a missing .json', async () => {
        reply = { ok: true, data: { recorded: true, kind: 'app:demo:order_placed' } };
        const lib = await events();
        const out = await lib.record('order_placed', { total: '24.90' }, { link: '/orders/9' });
        expect(out).toEqual({ recorded: true, kind: 'app:demo:order_placed' });

        const sent = calls.find(c => c.path === '/v1/account/events');
        expect(sent, 'no request to /v1/account/events').toBeTruthy();
        expect(JSON.parse(sent!.opts.body)).toEqual({
            kind: 'order_placed', data: { total: '24.90' }, link: '/orders/9',
        });
    });

    it('list() and archive() read theirs too', async () => {
        reply = { ok: true, data: { events: [{ kind: 'x' }], count: 1, window: 100 } };
        const lib = await events();
        expect((await lib.list({ limit: 20 })).count).toBe(1);
        expect(calls.some(c => c.path === '/v1/account/events?limit=20')).toBe(true);

        reply = { ok: true, data: { events: [], count: 0, total: 7 } };
        expect((await lib.archive({ limit: 5, offset: 10 })).total).toBe(7);
        expect(calls.some(c => c.path === '/v1/account/events/archive?limit=5&offset=10')).toBe(true);
    });

    it('a refusal is the node\'s own sentence, not a type error about .json', async () => {
        // The message a person is shown has to be the one the node wrote. With the old code every
        // refusal became "res.json is not a function", which says nothing to anybody.
        reply = { ok: false, error: { code: 'SCOPE_DENIED', message: 'This app was not granted memory:write.' } };
        const lib = await events();
        await expect(lib.record('order_placed')).rejects.toThrow('This app was not granted memory:write.');
    });
});
