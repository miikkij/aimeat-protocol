/**
 * @file test/unit/live-updates-open.test.ts
 * @description When the live-update stream reconciles every domain (public/lib/live-updates.js).
 *   A signed-in page first holds the build watch's visitor stream and then reopens it signed; that
 *   reopen is the stream's first open for the views with the session, which loaded on mount, so it
 *   must reconcile nothing. Until 2026-11-09 it reconciled every domain, and every part of every page
 *   read its data a second time about a second after load (6.4 MB again on the Memory page of an
 *   account with 20 000 keys). A reopen after a real gap (an error, then the backoff) still
 *   reconciles every domain, and an ordinary event still reaches only the subscribers of its domain.
 *   Runs the module's one-tab path: no BroadcastChannel, a fake EventSource and fetch.
 * @usage cd aimeat && pnpm vitest run test/unit/live-updates-open.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class FakeEventSource {
    static made: FakeEventSource[] = [];
    url: string;
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) { this.url = url; FakeEventSource.made.push(this); }
    addEventListener(): void { /* hello and alive are not under test */ }
    close(): void { this.closed = true; }
}

type LiveModule = {
    watchBuild: (g: () => string | undefined) => void;
    connect: (g: () => string | undefined) => Promise<void>;
    subscribe: (domains: string[] | null, fn: (d: Set<string> | null) => void) => () => void;
    disconnect: () => void;
};

let live: LiveModule;
let jwt: string | undefined;
const seen: Array<Set<string> | null> = [];

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeEventSource.made = [];
    seen.length = 0;
    jwt = undefined;
    const win = { __SITE: {}, __BUILD_ID: undefined } as Record<string, unknown>;
    win.self = win; win.top = win;
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {} });
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ data: { ticket: 't' } }) }));
    live = await import('../../public/lib/live-updates.js') as unknown as LiveModule;
    live.subscribe(null, d => seen.push(d));
});

afterEach(() => {
    live.disconnect(); live.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** The signed-out build watch opens the visitor stream; a view with a session reopens it signed. */
async function signIn(): Promise<FakeEventSource> {
    live.watchBuild(() => jwt);
    await vi.advanceTimersByTimeAsync(0);
    const visitor = FakeEventSource.made[0];
    visitor.onopen?.();
    jwt = 'a.b.c';
    await live.connect(() => jwt);
    await vi.advanceTimersByTimeAsync(0);
    expect(visitor.closed).toBe(true);
    const signed = FakeEventSource.made[1];
    expect(signed).toBeDefined();
    signed.onopen?.();
    return signed;
}

describe('live-update stream: which open reconciles every domain', () => {
    it('the signed stream that replaces the visitor stream reconciles nothing', async () => {
        await signIn();
        await vi.advanceTimersByTimeAsync(1500);
        expect(seen).toEqual([]);
    });

    it('a reopen after a real gap still reconciles every domain', async () => {
        const signed = await signIn();
        await vi.advanceTimersByTimeAsync(1500);
        signed.onerror?.();
        await vi.advanceTimersByTimeAsync(2000);     // INITIAL_RECONNECT_DELAY
        const again = FakeEventSource.made[2];
        expect(again).toBeDefined();
        again.onopen?.();
        await vi.advanceTimersByTimeAsync(1500);
        expect(seen).toEqual([null]);
    });

    it('an ordinary event reaches the subscribers of its domain', async () => {
        const signed = await signIn();
        signed.onmessage?.({ data: JSON.stringify({ domains: ['memory'] }) });
        await vi.advanceTimersByTimeAsync(1500);
        expect(seen.length).toBe(1);
        expect([...(seen[0] ?? [])]).toEqual(['memory']);
    });
});
