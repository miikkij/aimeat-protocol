/**
 * @file sdk-data-version-and-public.test.ts
 * @description Three aimeat-data calls that did the unexpected (appdev pitfalls
 *   data/open-page-overwrites-ai-write and data/getpublic-needs-full-identity):
 *   - set(key, value, { expectedVersion }) sends the node's optimistic lock (`expected_version`), so
 *     an open page that saves its whole copy is refused when an AI wrote the record meanwhile. The
 *     camelCase name was sent as an unknown body field before, which the node ignored.
 *   - patch(key, patch, { ifVersion }) merges fields into a record (PATCH /v1/memory/:key), so a page
 *     changes one field without writing the whole value back.
 *   - getPublic('alice', key) reads alice@<this node>: a bare account name answered null, because the
 *     public route takes a full identity. An identity with '@' or an `ext:` namespace goes as given.
 *
 *   FIRST FAIL: against aimeat-data v1.8.2 the body carries `expectedVersion`, patch is not a
 *   function, and the public read asks for /v1/memory/alice/... .
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let calls: { path: string; method: string; body: any }[];
let publicUrls: string[];

beforeEach(() => {
    vi.resetModules();
    calls = [];
    publicUrls = [];
    const g = globalThis as any;
    const s = {
        owner: 'bob', ghii: 'bob@node-1', jwt: 'j',
        fetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
            calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
            return { ok: true, data: { key: 'k', version: 3 } };
        },
    };
    g.document = { querySelector: () => null, getElementById: () => null, addEventListener() {} };
    g.location = { origin: 'https://node.test', href: 'https://node.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    g.window = { AIMEAT: { auth: { getSession: () => s } }, __AIMEAT_SDK_CFG__: { nodeId: 'node-1', baseUrl: 'https://node.test' }, addEventListener() {}, dispatchEvent() {}, location: g.location };
    g.fetch = vi.fn(async (url: string) => {
        publicUrls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { value: { seeded: true } } }) };
    });
});

async function data() {
    await import('../../src/static/sdk-libs/data/index.js');
    return (globalThis as any).window.AIMEAT.data;
}

describe('AIMEAT.data.set with expectedVersion', () => {
    it('sends expected_version, the name the node reads', async () => {
        await (await data()).set('notes', { a: 1 }, { expectedVersion: 4 });
        expect(calls[0].body).toMatchObject({ key: 'notes', expected_version: 4, visibility: 'private' });
        expect(calls[0].body).not.toHaveProperty('expectedVersion');
    });

    it('leaves the body as before without the option', async () => {
        await (await data()).set('notes', { a: 1 }, { visibility: 'public' });
        expect(calls[0].body).toEqual({ key: 'notes', value: { a: 1 }, visibility: 'public' });
    });

    it('keeps an expected_version the caller already spelled the node\'s way', async () => {
        await (await data()).set('notes', { a: 1 }, { expected_version: 2 });
        expect(calls[0].body.expected_version).toBe(2);
    });
});

describe('AIMEAT.data.patch', () => {
    it('merges fields through PATCH /v1/memory/:key with the version guard', async () => {
        const out = await (await data()).patch('board.1', { title: 'New' }, { ifVersion: 3 });
        expect(calls[0]).toMatchObject({ path: '/v1/memory/board.1', method: 'PATCH', body: { patch: { title: 'New' }, if_version: 3 } });
        expect(out).toMatchObject({ version: 3 });
    });

    it('refuses a patch that is not an object, before any request', async () => {
        await expect((await data()).patch('board.1', ['x'])).rejects.toThrow(/object/);
        expect(calls).toHaveLength(0);
    });
});

describe('AIMEAT.data.getPublic with a bare account name', () => {
    it('reads the account on this node', async () => {
        await (await data()).getPublic('alice', 'scores');
        expect(publicUrls[0]).toContain('/v1/memory/' + encodeURIComponent('alice@node-1') + '/scores');
    });

    it('sends a full identity and an extension namespace as given', async () => {
        const d = await data();
        await d.getPublic('alice@node-2', 'scores');
        await d.getPublic('ext:quiz', 'board');
        expect(publicUrls[0]).toContain('/v1/memory/' + encodeURIComponent('alice@node-2') + '/');
        expect(publicUrls[1]).toContain('/v1/memory/' + encodeURIComponent('ext:quiz') + '/');
    });
});
