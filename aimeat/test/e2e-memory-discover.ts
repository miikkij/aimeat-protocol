/**
 * @file e2e-memory-discover.ts
 * @description E2E for the cross-user public read that a shared feed, a public leaderboard or a
 *   community map is built on, with TWO accounts, because one account cannot tell "reads across users"
 *   from "reads my own namespace" (appdev pitfall search-does-not-read-across-users-use-discover).
 *   Covers what AIMEAT.data.discover() relies on: GET /v1/memory/discover lists another owner's PUBLIC
 *   entry under a prefix with its owner GAII and no value, never a private one, leaves the caller's
 *   own entries out (which is why the SDK method puts them back), clamps limit to 200, and refuses a
 *   caller with no session; the value then reads through the unauthenticated public door; and search
 *   still reads only the caller's own namespaces. Also that the node serves the fixed shared-feed
 *   template and an aimeat-data bundle that carries discover().
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=memory-discover
// The last test reads the BUILT bundle: run `pnpm build:sdk` after changing src/static/sdk-libs/data/.

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `mdisc${label}${Date.now()}`.toLowerCase();
    const body = JSON.stringify({ username: name, display_name: 'Mdisc', password: 'MemDiscover1234' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function putMem(token: string, key: string, value: unknown, visibility: 'public' | 'private') {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, value, visibility }) });
    // Every key this suite writes is new, and a new key answers 201.
    assert(r.status === 201, `write ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
}

(async () => {
    console.log('\n── Memory discover: the cross-user public read ──');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const prefix = `mdisc${Date.now()}.feed.`;
    const A_POST = `${prefix}a1`;
    const A_SECRET = `${prefix}asecret`;
    const B_POST = `${prefix}b1`;

    await putMem(a.token, A_POST, { text: 'from A', at: '2026-09-13T10:00:00Z' }, 'public');
    await putMem(a.token, A_SECRET, { text: 'A only' }, 'private');
    await putMem(b.token, B_POST, { text: 'from B', at: '2026-09-13T11:00:00Z' }, 'public');

    await test('B discovers A\'s public entry under the prefix, with A as its owner', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}&limit=200`, { headers: auth(b.token) });
        assert(r.status === 200, `discover ${r.status}: ${JSON.stringify(r.body.error)}`);
        const row = r.body.data.items.find((i: any) => i.key === A_POST);
        assert(!!row, `A's public post missing from B's discover: ${JSON.stringify(r.body.data.items)}`);
        assert(row.owner_gaii === a.ghii, `owner_gaii ${row.owner_gaii}, expected ${a.ghii}`);
    });

    await test('discover carries no value, so a reader needs the public read per row', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}`, { headers: auth(b.token) });
        const row = r.body.data.items.find((i: any) => i.key === A_POST);
        assert(!!row && !('value' in row), `row carries a value: ${JSON.stringify(row)}`);
    });

    await test('B never sees A\'s private entry (→ not listed)', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}&limit=200`, { headers: auth(b.token) });
        assert(!r.body.data.items.some((i: any) => i.key === A_SECRET), 'a private entry leaked into discover');
    });

    await test('discover leaves the caller\'s own entries out, which is why the SDK puts them back', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}&limit=200`, { headers: auth(b.token) });
        assert(!r.body.data.items.some((i: any) => i.key === B_POST), 'B\'s own post is in B\'s discover');
        const mine = await json(`/v1/memory?prefix=${encodeURIComponent(prefix)}&visibility=public`, { headers: auth(b.token) });
        assert(mine.status === 200, `own list ${mine.status}`);
        const own = mine.body.data.items.find((i: any) => i.key === B_POST);
        assert(!!own && own.owner_gaii === b.ghii && own.value?.text === 'from B', `own list row: ${JSON.stringify(own)}`);
    });

    await test('the value reads through the public door with no session', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(a.ghii)}/${encodeURIComponent(A_POST)}?soft=1`);
        assert(r.status === 200 && r.body.data?.value?.text === 'from A', `public read ${r.status}: ${JSON.stringify(r.body)}`);
        const hidden = await json(`/v1/memory/${encodeURIComponent(a.ghii)}/${encodeURIComponent(A_SECRET)}?soft=1`);
        assert(hidden.body.data?.value == null, 'the public door returned a private value');
    });

    await test('limit is clamped to 200', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}&limit=5000`, { headers: auth(b.token) });
        assert(r.status === 200 && r.body.data.limit === 200, `limit ${r.body.data?.limit}`);
    });

    // Same answer e2e-memory-doors asserts for this door on the test node. It is the reason
    // AIMEAT.data.discover() tells a builder to design the signed-out state.
    await test('discover with no session → 401', async () => {
        const r = await json(`/v1/memory/discover?prefix=${encodeURIComponent(prefix)}`);
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('search still reads only the caller\'s own namespaces (cross-owner → not found)', async () => {
        const r = await json(`/v1/memory/search?q=${encodeURIComponent('from A')}&prefix=${encodeURIComponent(prefix)}`, { headers: auth(b.token) });
        assert(r.status === 200, `search ${r.status}: ${JSON.stringify(r.body.error)}`);
        assert(!r.body.data.results.some((h: any) => h.key === A_POST), 'B\'s search returned A\'s entry');
    });

    await test('the shared-feed template reads through discover, not search', async () => {
        const r = await json('/v1/app-templates/comp-shared-feed');
        assert(r.status === 200, `template ${r.status}`);
        const content = String(r.body.data.template.content);
        assert(content.includes('AIMEAT.data.discover('), 'comp-shared-feed does not call AIMEAT.data.discover');
        assert(!content.includes('AIMEAT.data.search('), 'comp-shared-feed still calls AIMEAT.data.search');
    });

    await test('the served aimeat-data bundle carries discover()', async () => {
        const res = await fetch(`${BASE}/v1/libs/aimeat-data.js`);
        assert(res.status === 200, `aimeat-data.js ${res.status}`);
        const src = await res.text();
        assert(src.includes('/v1/memory/discover'), 'the bundle has no discover call: run pnpm build:sdk');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
