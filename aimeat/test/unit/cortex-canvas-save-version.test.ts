/**
 * @file cortex-canvas-save-version.test.ts
 * @description AIMEAT.canvas.DrawingCanvas saves through routes that accept what it sends. The save
 *   sent PUT /v1/memory/{key} with no `version`, which MemoryUpdateSchema requires, and that route
 *   answers 404 for a key that does not exist, so every save showed "Save failed". A first save now
 *   creates the record (POST /v1/memory, expected_version 0) and later saves update with the version
 *   the node returned.
 *
 *   The fetch stub plays the two routes by their own rules (src/routes/memory/crud.ts and key.ts):
 *   PUT without a numeric version is a 400, PUT on a missing key a 404, a stale version a 409, and
 *   POST with expected_version 0 over an existing key a 409. The DOM is a stub with the members the
 *   pack touches; what is under test is the requests, not the painting.
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../../public/cortex-bundled/aimeat-canvas.js', import.meta.url)), 'utf8');
const NODE = 'http://node.test';
const KEY = 'drawing:alice-sketch';

type El = Record<string, any>;

function makeEl(tag: string, created: El[]): El {
    const noop = () => undefined;
    const ctx2d = new Proxy({}, { get: () => noop, set: () => true });
    const e: El = {
        tagName: tag.toUpperCase(), children: [] as El[], className: '', style: {}, attrs: {},
        textContent: '', innerHTML: '', disabled: false, value: '',
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild(c: El) { this.children.push(c); return c; },
        removeChild(c: El) { this.children = this.children.filter((x: El) => x !== c); return c; },
        setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
        getAttribute(k: string) { return this.attrs[k] ?? null; },
        addEventListener: noop, removeEventListener: noop, contains: () => false,
        getContext: () => ctx2d,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    created.push(e);
    return e;
}

type Rec = { version: number; value: unknown };
let store: Map<string, Rec>;
let calls: Array<{ method: string; url: string; body: any; status: number }>;
let created: El[];
let AIMEAT: any;

function reply(status: number, data: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => (status < 300 ? { data } : { error: data }) };
}

async function fakeFetch(url: string, init: { method?: string; body?: string } = {}) {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = url.slice(NODE.length);
    let res;
    if (method === 'POST' && path === '/v1/memory') {
        const existing = store.get(body.key);
        if (typeof body.expected_version === 'number' && body.expected_version !== (existing?.version ?? 0)) {
            res = reply(409, { code: 'VERSION_CONFLICT' });
        } else {
            const version = (existing?.version ?? 0) + 1;
            store.set(body.key, { version, value: body.value });
            res = reply(existing ? 200 : 201, { key: body.key, version });
        }
    } else if (path.startsWith('/v1/memory/')) {
        const key = decodeURIComponent(path.slice('/v1/memory/'.length).split('?')[0]);
        const existing = store.get(key);
        if (method === 'PUT') {
            if (typeof body?.version !== 'number') res = reply(400, { code: 'INVALID_INPUT' });
            else if (!existing) res = reply(404, { code: 'NOT_FOUND' });
            else if (existing.version !== body.version) res = reply(409, { code: 'VERSION_CONFLICT' });
            else {
                store.set(key, { version: existing.version + 1, value: body.value });
                res = reply(200, { key, version: existing.version + 1 });
            }
        } else if (!existing) {
            res = path.includes('soft=1') ? reply(200, { key, value: null, exists: false }) : reply(404, { code: 'NOT_FOUND' });
        } else {
            res = reply(200, { key, exists: true, value: existing.value, version: existing.version });
        }
    } else {
        res = reply(404, { code: 'NOT_FOUND' });
    }
    calls.push({ method, url: path, body, status: res.status });
    return res;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const status = () => created.find((e) => e.className === 'aimeat-canvas-status')?.textContent;
const writes = () => calls.filter((c) => c.method !== 'GET');

function mount() {
    const dc = AIMEAT.canvas.DrawingCanvas({ elementId: 'pad', storageKey: KEY, nodeUrl: NODE, token: 't', options: { autoSave: false } });
    expect(dc).toBeTruthy();
    return dc;
}

beforeEach(() => {
    store = new Map();
    calls = [];
    created = [];
    const pad = makeEl('div', created);
    const document = {
        head: makeEl('head', created), body: makeEl('body', created), activeElement: null,
        getElementById: (id: string) => (id === 'pad' ? pad : null),
        createElement: (t: string) => makeEl(t, created),
        createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
        addEventListener() {}, removeEventListener() {},
    };
    const window: any = { AIMEAT: {} };
    runInNewContext(SRC, { window, document, fetch: fakeFetch, setTimeout, clearTimeout, console: { error() {}, warn() {}, log() {} } });
    AIMEAT = window.AIMEAT;
});

describe('DrawingCanvas save', () => {
    it('creates the record on the first save of a new drawing, then updates it with the returned version', async () => {
        const dc = mount();
        await settle();
        expect(status()).toBe('New drawing');

        await dc.saveToStorage();
        expect(status()).toBe('Saved');
        expect(writes()[0]).toMatchObject({ method: 'POST', url: '/v1/memory', status: 201, body: { key: KEY, expected_version: 0 } });
        expect(store.get(KEY)?.version).toBe(1);

        await dc.saveToStorage();
        expect(writes()[1]).toMatchObject({ method: 'PUT', url: `/v1/memory/${encodeURIComponent(KEY)}`, status: 200, body: { version: 1 } });
        expect(store.get(KEY)?.version).toBe(2);
    });

    it('updates an existing drawing with the version it loaded', async () => {
        store.set(KEY, { version: 3, value: { strokes: [], canvasSize: { width: 800, height: 600 } } });
        const dc = mount();
        await settle();

        await dc.saveToStorage();
        expect(status()).toBe('Saved');
        expect(writes()).toEqual([expect.objectContaining({ method: 'PUT', status: 200, body: expect.objectContaining({ version: 3 }) })]);
        expect(store.get(KEY)?.version).toBe(4);
    });

    it('reads the current version and writes again when another window saved in between', async () => {
        store.set(KEY, { version: 3, value: { strokes: [], canvasSize: { width: 800, height: 600 } } });
        const dc = mount();
        await settle();
        store.set(KEY, { version: 5, value: { strokes: [], canvasSize: { width: 800, height: 600 } } });

        await dc.saveToStorage();
        expect(status()).toBe('Saved');
        expect(writes().map((c) => c.status)).toEqual([409, 200]);
        expect(store.get(KEY)?.version).toBe(6);
    });

    it('creates the record again when it was deleted after the load', async () => {
        store.set(KEY, { version: 2, value: { strokes: [], canvasSize: { width: 800, height: 600 } } });
        const dc = mount();
        await settle();
        store.delete(KEY);

        await dc.saveToStorage();
        expect(status()).toBe('Saved');
        expect(writes().map((c) => `${c.method} ${c.status}`)).toEqual(['PUT 404', 'POST 201']);
    });
});
