/**
 * @file app-sw-offline.test.ts
 * @description The worker of an app that opens with no connection (src/static/app-sw-offline.js),
 *   run as the browser runs it: the file's own source in a worker scope whose caches, network and
 *   events are handed in. It proves the two things a node in production showed were wrong in
 *   v1.0.0: the worker answered a file of another origin, which its own content security policy
 *   then refused (the node's cookie notice, loaded from the node's own address, did not start),
 *   and an answer that arrived after the kept copy was deleted created the copy again.
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(fileURLToPath(new URL('../../src/static/app-sw-offline.js', import.meta.url)), 'utf8');
const APP = 'https://app.apps.node.example';
const NODE = 'https://node.example';
const SHELL = 'aimeat-app-shell-v1';
const ASKS = '<html><head><meta name="aimeat-offline" content="shell"></head><body></body></html>';
const ASKS_NO_MORE = '<html><head></head><body></body></html>';

type Answer = { status: number; type: string; body: string };
type Pending = { url: string; resolve: (a: Answer) => void; reject: (e: Error) => void };

/** An answer as the browser holds it: once its body went to the page, it cannot be cloned or read. */
function response(a: Answer) {
    const self = {
        status: a.status, type: a.type, used: false,
        /** What the answer holds, for the test to read whatever happened to the body. */
        holds: a.body,
        headers: { get: () => null },
        clone() { if (self.used) throw new TypeError('Response body is already used'); return response(a); },
        // Reading a body takes the network's time, never a microtask: the page has the answer by then.
        text: async () => {
            if (self.used) throw new TypeError('Response body is already used');
            await new Promise((resolve) => setTimeout(resolve, 0));
            return a.body;
        },
    };
    return self;
}

/** One request as a fetch event carries it. */
function request(url: string, destination: string, mode = 'no-cors', headers: Record<string, string> = {}) {
    return { url, method: 'GET', mode, destination, headers: { has: (name: string) => name in headers } };
}

/** A worker scope: Cache Storage in a map, a network the test answers by hand, and the listeners. */
function scope(opts: { kept?: boolean } = {}) {
    const stores = new Map<string, Map<string, unknown>>();
    if (opts.kept) stores.set(SHELL, new Map([[APP + '/', response({ status: 200, type: 'basic', body: ASKS })]]));
    const keyOf = (key: any) => String(key && key.url ? key.url : key);
    const cacheOf = (name: string) => {
        const entries = stores.get(name)!;
        return {
            match: async (key: any) => entries.get(keyOf(key)),
            put: async (key: any, value: unknown) => { entries.set(keyOf(key), value); },
            delete: async (key: any) => entries.delete(keyOf(key)),
            keys: async () => [...entries.keys()].map((url) => ({ url })),
        };
    };
    const caches = {
        has: async (name: string) => stores.has(name),
        open: async (name: string) => { if (!stores.has(name)) stores.set(name, new Map()); return cacheOf(name); },
        delete: async (name: string) => stores.delete(name),
    };
    const asked: string[] = [];
    const pending: Pending[] = [];
    const listeners: Record<string, (event: any) => void> = {};
    const self = { location: { origin: APP }, addEventListener: (type: string, fn: (event: any) => void) => { listeners[type] = fn; } };
    const context = vm.createContext({
        self, caches, console, URL, Promise, setTimeout, Number, String, Array, Object,
        importScripts: () => undefined,
        Request: class { url: string; constructor(url: string) { this.url = url; } },
        fetch: (req: any) => new Promise((resolve, reject) => {
            const url = keyOf(req);
            asked.push(url);
            pending.push({ url, resolve: (a) => resolve(response(a)), reject });
        }),
    });
    vm.runInContext(SOURCE, context);
    return {
        stores, asked, pending,
        /** Dispatch one fetch event; answers what the worker passed to respondWith, or null when it left the request alone. */
        fetch(req: ReturnType<typeof request>) {
            let answered: Promise<unknown> | null = null;
            // The browser takes the body as soon as the worker hands the answer over.
            listeners.fetch({ request: req, respondWith: (p: Promise<any>) => { answered = p.then((r) => { if (r) r.used = true; return r; }); } });
            return answered as Promise<unknown> | null;
        },
        /** Send one message and wait for the worker's answer on its port. */
        message(data: unknown) {
            return new Promise((resolve) => {
                listeners.message({ data, origin: APP, ports: [{ postMessage: resolve }], waitUntil: () => undefined });
            });
        },
        answer(url: string, a: Answer) {
            const i = pending.findIndex((p) => p.url === url);
            if (i < 0) throw new Error('nothing asked for ' + url);
            pending.splice(i, 1)[0].resolve(a);
        },
    };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

describe('the worker of an app that opens with no connection', () => {
    it('leaves a stylesheet and a script of another origin to the network', async () => {
        const w = scope({ kept: true });
        await settle();
        expect(w.fetch(request(NODE + '/cookieconsent.css', 'style'))).toBeNull();
        expect(w.fetch(request(NODE + '/cookieconsent.umd.js?v=1', 'script'))).toBeNull();
        expect(w.fetch(request('https://fonts.example/face.woff2', 'font', 'cors'))).toBeNull();
        expect(w.asked).toEqual([]);
    });

    it('answers and keeps a part of the app’s own origin', async () => {
        const w = scope({ kept: true });
        await settle();
        const answered = w.fetch(request(APP + '/lib/kit.css', 'style'));
        expect(answered).not.toBeNull();
        await settle();
        w.answer(APP + '/lib/kit.css', { status: 200, type: 'basic', body: 'a{}' });
        expect(((await answered) as any).status).toBe(200);
        await settle();
        expect(w.stores.get(SHELL)!.has(APP + '/lib/kit.css')).toBe(true);
    });

    it('the kept copy answers the app’s own part when the network gives none', async () => {
        const w = scope({ kept: true });
        await settle();
        w.stores.get(SHELL)!.set(APP + '/lib/kit.css', response({ status: 200, type: 'basic', body: 'kept' }));
        const answered = w.fetch(request(APP + '/lib/kit.css', 'style'));
        await settle();
        w.pending[0].reject(new Error('Failed to fetch'));
        expect(((await answered) as any).holds).toBe('kept');
    });

    it('a new version of the app’s document replaces the kept one', async () => {
        const w = scope({ kept: true });
        await settle();
        const answered = w.fetch(request(APP + '/', 'document', 'navigate'));
        await settle();
        w.answer(APP + '/', { status: 200, type: 'basic', body: ASKS + '<!-- version 2 -->' });
        expect(((await answered) as any).status).toBe(200);
        await settle();
        const kept = w.stores.get(SHELL)!.get(APP + '/') as ReturnType<typeof response>;
        expect(kept.holds).toContain('version 2');
    });

    it('an answer that arrives after the page stopped asking does not bring the kept copy back', async () => {
        const w = scope({ kept: true });
        await settle();
        w.fetch(request(APP + '/lib/kit.css', 'style'));
        w.fetch(request(APP + '/', 'document', 'navigate'));
        await settle();
        w.answer(APP + '/', { status: 200, type: 'basic', body: ASKS_NO_MORE });
        await settle();
        expect(w.stores.has(SHELL)).toBe(false);
        w.answer(APP + '/lib/kit.css', { status: 200, type: 'basic', body: 'a{}' });
        await settle();
        expect(w.stores.has(SHELL)).toBe(false);
    });

    it('keeps only addresses of the app’s own origin when the page names its parts', async () => {
        const w = scope();
        await settle();
        const done = w.message({ type: 'aimeat-shell-keep', urls: [APP + '/', NODE + '/cookieconsent.css', '/lib/kit.css'] });
        for (let i = 0; i < 3; i++) {
            await settle();
            if (w.pending.length) w.answer(w.pending[0].url, { status: 200, type: 'basic', body: ASKS });
        }
        expect(await done).toEqual({ ok: true, kept: 2 });
        expect(w.asked).toEqual([APP + '/', APP + '/lib/kit.css']);
        expect([...w.stores.get(SHELL)!.keys()].sort()).toEqual([APP + '/', APP + '/lib/kit.css']);
    });
});
