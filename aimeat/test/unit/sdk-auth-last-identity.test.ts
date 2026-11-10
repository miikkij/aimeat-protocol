/**
 * @file sdk-auth-last-identity.test.ts
 * @description The sign-in library's last identity (src/static/sdk-libs/auth/last-identity.js): a
 *   page load that restores no session signs the person out only when the node answered. With no
 *   answer the stored session stays, 'offline' names the person who signed in last, and the restore
 *   runs again when the network returns. Also the pill's AI state (ai-state.js): a live event of an
 *   app, whose domains arrive in a Set, is not an AI change, and a refused read is not asked again.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let identity: typeof import('../../src/static/sdk-libs/auth/last-identity.js');
let events: typeof import('../../src/static/sdk-libs/auth/events.js');
let aiState: typeof import('../../src/static/sdk-libs/auth/ai-state.js');

const store = new Map<string, string>();
const listeners: Record<string, Array<(ev?: any) => void>> = {};
const world = { online: true, reachable: true, asked: [] as string[], capabilities: 'ok' as 'ok' | 'refused' };
const heard: Array<[string, any]> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
    const g = globalThis as any;
    g.window = g;
    g.document = { querySelector: () => null, getElementById: () => null, addEventListener() {}, cookie: '' };
    g.location = { origin: 'https://app.apps.node.test', href: 'https://app.apps.node.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    g.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    Object.defineProperty(g, 'navigator', { configurable: true, value: { get onLine() { return world.online; } } });
    g.addEventListener = (name: string, fn: () => void) => { (listeners[name] = listeners[name] || []).push(fn); };
    g.removeEventListener = (name: string, fn: () => void) => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); };
    g.fetch = async (url: string) => {
        world.asked.push(String(url));
        if (!world.reachable) throw new TypeError('Failed to fetch');
        if (String(url).includes('/v1/ai/capabilities')) {
            return world.capabilities === 'ok'
                ? { ok: true, status: 200, json: async () => ({ ok: true, data: { main: null, power: {}, needs: [], capabilities: {} } }) }
                : { ok: false, status: 403, json: async () => ({ ok: false, error: { code: 'SCOPE_DENIED', message: 'This app does not have permission to do this.' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
    };
    identity = await import('../../src/static/sdk-libs/auth/last-identity.js');
    events = await import('../../src/static/sdk-libs/auth/events.js');
    aiState = await import('../../src/static/sdk-libs/auth/ai-state.js');
    for (const name of ['login', 'logout', 'offline']) events.on(name, (data: any) => { heard.push([name, data]); });
});

beforeEach(() => {
    store.clear(); heard.length = 0; world.online = true; world.reachable = true; world.asked.length = 0;
    identity.forgetLastIdentity();
    // The pill's AI state listens once per page for live events; only the network listeners are per test.
    listeners.online = [];
});

describe('the last identity', () => {
    it('a sign-in is kept as a name with no token', () => {
        events.emit('login', { owner: 'alice', ghii: 'alice@node-1', displayName: 'Alice', jwt: 'secret.token.value' }, { restored: false });
        const kept = identity.lastIdentity();
        expect(kept).toMatchObject({ owner: 'alice', ghii: 'alice@node-1', displayName: 'Alice' });
        expect(JSON.stringify([...store.values()])).not.toContain('secret.token.value');
        expect(identity.offlineIdentity()).toBe(null);
    });

    it('an agent session names no person and is not kept', () => {
        events.emit('login', { owner: 'alice', gaii: 'bot#alice@node-1', jwt: 't' });
        expect(identity.lastIdentity()).toBe(null);
    });

    it('no session and no answer from the node: the person is offline, not signed out', async () => {
        events.emit('login', { owner: 'alice', ghii: 'alice@node-1', jwt: 't' });
        store.set('aimeat_session', JSON.stringify({ owner: 'alice' }));
        heard.length = 0;
        world.online = false;
        let retried = 0;
        const down = await identity.settleNoSession(() => { retried += 1; });
        expect(down).toBe(true);
        expect(heard.map((h) => h[0])).toEqual(['offline']);
        expect(heard[0][1]).toMatchObject({ owner: 'alice' });
        expect(identity.offlineIdentity()).toMatchObject({ owner: 'alice' });
        expect(identity.lastIdentity()).not.toBe(null);
        // The network returns: the caller's restore runs once more, and the listener is gone.
        (listeners.online || []).slice().forEach((fn) => fn());
        expect(retried).toBe(1);
        expect((listeners.online || []).length).toBe(0);
    });

    it('a device with a network whose node gives no answer is offline too', async () => {
        events.emit('login', { owner: 'alice', jwt: 't' });
        heard.length = 0;
        world.reachable = false;
        expect(await identity.settleNoSession(() => undefined)).toBe(true);
        expect(world.asked.some((u) => u.endsWith('/v1/build'))).toBe(true);
        expect(heard.map((h) => h[0])).toEqual(['offline']);
    });

    it('no session while the node answers: nobody is signed in, and the kept identity leaves', async () => {
        events.emit('login', { owner: 'alice', jwt: 't' });
        heard.length = 0;
        // What the library stores as the session lives under its own prefix; one stored value stands for it here.
        const sessionKey = [...store.keys()].find((k) => /last_identity/.test(k))!.replace('last_identity', 'session');
        store.set(sessionKey, JSON.stringify({ owner: 'alice' }));
        expect(await identity.settleNoSession(() => undefined)).toBe(false);
        expect(heard.map((h) => h[0])).toEqual(['logout']);
        expect(identity.lastIdentity()).toBe(null);
        expect(store.has(sessionKey)).toBe(false);
    });

    it('offline with nobody kept says nothing and signs nobody out', async () => {
        world.online = false;
        expect(await identity.settleNoSession(() => undefined)).toBe(true);
        expect(heard).toEqual([]);
        expect(identity.offlineIdentity()).toBe(null);
    });

    it('a session that arrives ends the offline state', async () => {
        events.emit('login', { owner: 'alice', jwt: 't' });
        world.online = false;
        await identity.settleNoSession(() => undefined);
        expect(identity.offlineIdentity()).not.toBe(null);
        events.emit('login', { owner: 'alice', jwt: 't2' }, { restored: true });
        expect(identity.offlineIdentity()).toBe(null);
    });
});

describe('the pill AI state on an app page', () => {
    const live = (domains: unknown) => (listeners['aimeat-live-update'] || []).forEach((fn) => fn({ detail: { domains } }));
    const asks = () => world.asked.filter((u) => u.includes('/v1/ai/capabilities')).length;

    it('a live event that names no AI domain, in a Set or an array, asks nothing', async () => {
        world.capabilities = 'ok';
        aiState.forgetAiState();
        aiState.readAiState({ jwt: 'jwt-a', _app: 'alice/app.html' }, () => undefined);
        await settle(); await settle();
        expect(asks()).toBe(1);
        live(new Set(['workspace:org/ws', 'organisms']));
        live(['memory']);
        await settle();
        expect(asks()).toBe(1);
        live(new Set(['ai-usage']));
        await settle(); await settle();
        expect(asks()).toBe(2);
    });

    it('a refused read is kept for the session: a later AI event does not ask again', async () => {
        world.capabilities = 'refused';
        aiState.forgetAiState();
        aiState.readAiState({ jwt: 'jwt-b', _app: 'alice/app.html' }, () => undefined);
        await settle(); await settle();
        expect(asks()).toBe(1);
        live(new Set(['ai-usage']));
        live(null);
        await settle(); await settle();
        expect(asks()).toBe(1);
        // A new session (the person granted the word) reads again.
        aiState.readAiState({ jwt: 'jwt-c', _app: 'alice/app.html' }, () => undefined);
        await settle(); await settle();
        expect(asks()).toBe(2);
    });
});
