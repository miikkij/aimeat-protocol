/**
 * @file sdk-data-discover.test.ts
 * @description AIMEAT.data.discover(prefix) lists OTHER people's public entries under a prefix with
 *   their values, and the comp-shared-feed template reads through it. search() and list() only ever
 *   read the caller's own identity set, while the node's own shared-feed template called search() as
 *   "public entries across all users" and then sorted the envelope object it returns, so a feed built
 *   from the template threw on load and, fixed by hand, showed every visitor only their own posts
 *   (appdev pitfall search-does-not-read-across-users-use-discover, 2026-08-08). The cross-user door
 *   is GET /v1/memory/discover: metadata only, and the caller's own rows left out. The template
 *   functions are EXECUTED here against a fake node, because reading their text proves nothing about
 *   whether they run; the dated-archive template threw on search()'s object the same way.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { COMP_SHARED_FEED, COMP_PHASER_ARCADE, COMP_DATED_ARCHIVE } from '../../src/data/app-templates/components.js';

const ME = 'bob@node';
type Entry = { key: string; owner_gaii: string; value: unknown; visibility: 'public' | 'private' };

let store: Entry[];
let authCalls: string[];
let publicInFlight: number;
let publicPeak: number;
let signedIn: boolean;

/** What the node answers, from `store`, with the same exclusions the real routes make. */
function node() {
    return {
        fetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
            authCalls.push(path);
            const url = new URL('https://node.test' + path);
            if (url.pathname === '/v1/memory' && opts.method === 'POST') {
                const b = JSON.parse(opts.body!);
                store = store.filter(e => !(e.owner_gaii === ME && e.key === b.key));
                store.push({ key: b.key, owner_gaii: ME, value: b.value, visibility: b.visibility });
                return { ok: true, data: { key: b.key } };
            }
            if (url.pathname === '/v1/memory/discover') {
                const prefix = url.searchParams.get('prefix') ?? '';
                const limit = Number(url.searchParams.get('limit') ?? 50);
                const items = store
                    .filter(e => e.visibility === 'public' && e.key.startsWith(prefix) && e.owner_gaii !== ME)
                    .slice(0, limit)
                    .map(e => ({ key: e.key, owner_gaii: e.owner_gaii, visibility: e.visibility, tags: [], version: 1, created_at: 't', updated_at: 't' }));
                return { ok: true, data: { items, total: items.length, limit, offset: 0 } };
            }
            if (url.pathname === '/v1/memory') {
                const prefix = url.searchParams.get('prefix') ?? '';
                const vis = url.searchParams.get('visibility');
                const meta = url.searchParams.get('include') === 'meta';
                const items = store
                    .filter(e => e.owner_gaii === ME && e.key.startsWith(prefix) && (!vis || e.visibility === vis))
                    .map(e => ({ key: e.key, owner_gaii: e.owner_gaii, visibility: e.visibility, tags: [], version: 1, created_at: 't', updated_at: 't', ...(meta ? { bytes: 10 } : { value: e.value }) }));
                return { ok: true, data: { items, total: items.length } };
            }
            if (url.pathname === '/v1/memory/search') {
                const q = url.searchParams.get('q') ?? '';
                const results = store.filter(e => e.owner_gaii === ME && e.key.includes(q)).map(e => ({ key: e.key, value: e.value }));
                return { ok: true, data: { results, total: results.length, query: q } };
            }
            return { ok: false, error: { code: 'NOT_FOUND', message: path } };
        },
    };
}

beforeEach(() => {
    vi.resetModules();
    store = [];
    authCalls = [];
    publicInFlight = 0;
    publicPeak = 0;
    signedIn = true;
    const g = globalThis as any;
    const session = { ...node(), owner: 'bob', ghii: ME, jwt: 'j' };
    g.document = { querySelector: () => null, getElementById: () => null, addEventListener() {} };
    g.location = { origin: 'https://node.test', href: 'https://node.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    g.window = { AIMEAT: { auth: { getSession: () => (signedIn ? session : null) } }, addEventListener() {}, dispatchEvent() {}, location: g.location };
    g.fetch = vi.fn(async (url: string) => {
        // The unauthenticated public read: /v1/memory/<owner>/<key>?soft=1
        const m = /\/v1\/memory\/([^/]+)\/([^?]+)/.exec(url);
        publicInFlight++; publicPeak = Math.max(publicPeak, publicInFlight);
        await new Promise(r => setTimeout(r, 2));
        publicInFlight--;
        const owner = decodeURIComponent(m![1]); const key = decodeURIComponent(m![2]);
        const e = store.find(x => x.owner_gaii === owner && x.key === key && x.visibility === 'public');
        return { json: async () => e ? { ok: true, data: { key, value: e.value } } : { ok: false, error: { code: 'NOT_FOUND' } } };
    });
});

async function data() {
    await import('../../src/static/sdk-libs/data/index.js');
    return (globalThis as any).window.AIMEAT.data;
}

function put(owner: string, key: string, value: unknown, visibility: 'public' | 'private' = 'public') {
    store.push({ key, owner_gaii: owner, value, visibility });
}

describe('AIMEAT.data.discover', () => {
    it('returns other users\' public entries under the prefix, with their values', async () => {
        put('alice@node', 'feed.1', { text: 'from alice' });
        put('carol@node', 'feed.2', { text: 'from carol' });
        put('carol@node', 'other.1', { text: 'wrong prefix' });
        put('dave@node', 'feed.3', { text: 'private' }, 'private');
        const d = await data();
        expect(typeof d.discover).toBe('function');
        const rows = await d.discover('feed.');
        const theirs = rows.filter((r: any) => !r.mine);
        expect(theirs.map((r: any) => [r.owner_gaii, r.value.text]).sort()).toEqual([['alice@node', 'from alice'], ['carol@node', 'from carol']]);
        expect(authCalls.some(p => p.startsWith('/v1/memory/discover?'))).toBe(true);
    });

    it('puts the caller\'s own public entries back, marked mine, because discover leaves them out', async () => {
        put('alice@node', 'feed.1', { text: 'from alice' });
        put(ME, 'feed.9', { text: 'mine' });
        put(ME, 'feed.8', { text: 'my draft' }, 'private');
        const rows = await (await data()).discover('feed.');
        const mine = rows.filter((r: any) => r.mine);
        expect(mine.map((r: any) => r.value.text)).toEqual(['mine']);
        expect(rows).toHaveLength(2);
    });

    it('leaves the caller out on request', async () => {
        put(ME, 'feed.9', { text: 'mine' });
        const rows = await (await data()).discover('feed.', { includeMine: false });
        expect(rows).toEqual([]);
    });

    it('returns metadata only when asked, without one public read per row', async () => {
        put('alice@node', 'feed.1', { text: 'from alice' });
        const rows = await (await data()).discover('feed.', { withValues: false, includeMine: false });
        expect(rows).toHaveLength(1);
        expect('value' in rows[0]).toBe(false);
        expect((globalThis as any).fetch).not.toHaveBeenCalled();
    });

    it('caps the value reads it runs at once', async () => {
        for (let i = 0; i < 40; i++) put(`u${i}@node`, `feed.${i}`, { n: i });
        const rows = await (await data()).discover('feed.', { includeMine: false });
        expect(rows).toHaveLength(40);
        expect(publicPeak).toBeLessThanOrEqual(6);
    });

    it('throws when every value read fails, instead of answering with an empty feed', async () => {
        put('alice@node', 'feed.1', { text: 'from alice' });
        (globalThis as any).fetch = vi.fn(async () => { throw new Error('network down'); });
        await expect((await data()).discover('feed.', { includeMine: false })).rejects.toThrow('network down');
    });

    it('asks for at most 200 rows, the route\'s own ceiling', async () => {
        await (await data()).discover('feed.', { limit: 5000, includeMine: false });
        const call = authCalls.find(p => p.startsWith('/v1/memory/discover?'))!;
        expect(new URL('https://n' + call).searchParams.get('limit')).toBe('200');
    });
});

/** Run a template's functions against the fake node, as the app the template becomes would. */
function runTemplate(src: string, names: string[]) {
    const code = src.replace(/\{\{app\}\}/g, 'myapp') + '\nreturn {' + names.join(',') + '};';
    return new Function('AIMEAT', code)((globalThis as any).window.AIMEAT);
}

describe('comp-shared-feed template', () => {
    it('shows a signed-in visitor the posts of other users as well as their own', async () => {
        await data();
        put('alice@node', 'myapp.feed.1', { id: '1', text: 'from alice', at: '2026-09-01T10:00:00Z' });
        const feed = runTemplate(COMP_SHARED_FEED, ['post', 'loadFeed']);
        await feed.post('from bob');
        const rows = await feed.loadFeed();
        expect(Array.isArray(rows), 'loadFeed did not return a list').toBe(true);
        expect(rows.map((r: any) => r.text).sort()).toEqual(['from alice', 'from bob']);
        expect(rows[0].text, 'newest first').toBe('from bob');
    });
});

describe('comp-dated-archive template', () => {
    it('groups the app\'s own entries by the date in their key, newest day first', async () => {
        await data();
        put(ME, 'myapp.2026-09-01.a', { title: 'one' });
        put(ME, 'myapp.2026-09-03.b', { title: 'two' });
        put(ME, 'myapp.2026-09-03.c', { title: 'three' });
        const archive = runTemplate(COMP_DATED_ARCHIVE, ['loadArchive']);
        const days = await archive.loadArchive();
        expect(days.map((d: any) => [d.date, d.items.length])).toEqual([['2026-09-03', 2], ['2026-09-01', 1]]);
    });
});

describe('comp-phaser-arcade leaderboard', () => {
    it('ranks every player\'s public high score, not only the visitor\'s own', async () => {
        await data();
        put('alice@node', 'myapp.highscore', { score: 40, by: 'alice' });
        put('carol@node', 'myapp.highscore', { score: 90, by: 'carol' });
        put(ME, 'myapp.highscore', { score: 60, by: 'bob' });
        const game = runTemplate(COMP_PHASER_ARCADE, ['leaderboard']);
        const board = await game.leaderboard();
        expect(board.map((r: any) => r.by)).toEqual(['carol', 'bob', 'alice']);
    });
});
