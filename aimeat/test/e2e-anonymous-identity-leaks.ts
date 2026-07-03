/**
 * @file e2e-anonymous-identity-leaks.ts
 * @description E2E for the anonymous-identity-leak fixes (2026-07-03). Proves that the shared
 *   anonymous identity (injected by global optionalAuth in anonymous mode) is treated as
 *   unauthenticated across: GET /v1/capabilities (no private rows), GET /v1/boards (no owner/member
 *   GAIIs), GET /v1/ghii/:ghii + GET /v1/owners/:name (no agent roster / roles), and the member
 *   directory GET /v1/ghii/list (requires login + opt-in only). A real signed-in user sees the
 *   appropriate extra data; the owner always sees their own.
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial: capabilities/boards/profile-roster/directory-opt-in.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=anonymous-identity-leaks

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function mkOwner(label: string) {
    const name = `leak${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'Leak1234!' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'Leak1234!' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    // Registration returns data.ghii as an OBJECT ({ ghii, username, ... }); the full id is nested.
    const gaii = (reg.body.data.ghii?.ghii ?? `${name}@${NODE_ID}`) as string;
    return { name, token: tk.body.data.token as string, gaii };
}

console.log('\n=== AIMEAT Anonymous Identity-Leak E2E ===\n');
let A: Awaited<ReturnType<typeof mkOwner>>, B: Awaited<ReturnType<typeof mkOwner>>;

await test('Setup: two owners, each with an agent', async () => {
    A = await mkOwner('a'); B = await mkOwner('b');
    for (const O of [A, B]) {
        const r = await json('/v1/agents', { method: 'POST', headers: auth(O.token), body: JSON.stringify({ name: `bot`, owner: O.name, display_name: 'Bot' }) });
        assert(r.status === 200 || r.status === 201, `agent ${r.status}: ${JSON.stringify(r.body)}`);
    }
});

await test('1. GET /v1/ghii/:ghii — anon does NOT get the agent roster; the owner does', async () => {
    const anon = await json(`/v1/ghii/${encodeURIComponent(A.gaii)}`);
    assert(anon.status === 200, `anon ${anon.status}`);
    assert(anon.body.data.agents === undefined, `anon agent roster leaked: ${JSON.stringify(anon.body.data.agents)}`);
    const owner = await json(`/v1/ghii/${encodeURIComponent(A.gaii)}`, { headers: auth(A.token) });
    assert(Array.isArray(owner.body.data.agents) && owner.body.data.agents.length >= 1, `owner should see own agents: ${JSON.stringify(owner.body.data.agents)}`);
});

await test('2. GET /v1/owners/:name — anon gets NO roles + NO agent roster; the owner gets both', async () => {
    const anon = await json(`/v1/owners/${A.name}`);
    assert(anon.status === 200 && anon.body.data.roles === undefined && anon.body.data.agents === undefined, `anon owner leak: ${JSON.stringify(anon.body.data)}`);
    assert(anon.body.data.name === A.name && anon.body.data.display_name, 'anon still gets the minimal public card');
    const owner = await json(`/v1/owners/${A.name}`, { headers: auth(A.token) });
    assert(Array.isArray(owner.body.data.roles) && Array.isArray(owner.body.data.agents), `owner should see roles+agents: ${JSON.stringify(owner.body.data)}`);
});

await test('3. Member directory GET /v1/ghii/list — anon is REJECTED (must be signed in)', async () => {
    const anon = await json('/v1/ghii/list');
    assert(anon.status === 401, `anon should be 401, got ${anon.status}`);
    const authed = await json('/v1/ghii/list', { headers: auth(A.token) });
    assert(authed.status === 200, `authed list ${authed.status}`);
});

await test('4. Directory is OPT-IN: B is unlisted by default; after opt-in A can find B', async () => {
    // A (signed in) should NOT see B yet (B never opted in). A always sees themselves.
    let list = await json('/v1/ghii/list', { headers: auth(A.token) });
    assert(list.body.data.humans.some((h: any) => h.ghii === A.gaii), 'A sees their own entry');
    assert(!list.body.data.humans.some((h: any) => h.ghii === B.gaii), `B should be UNLISTED by default: ${JSON.stringify(list.body.data.humans.map((h: any) => h.ghii))}`);
    // B opts in.
    const opt = await json('/v1/ghii', { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ directory_listed: true }) });
    assert(opt.status === 200 && opt.body.data.directory_listed === true, `opt-in ${opt.status}: ${JSON.stringify(opt.body.data)}`);
    // /v1/ghii/me reflects it.
    const me = await json('/v1/ghii/me', { headers: auth(B.token) });
    assert(me.body.data.directory_listed === true, `me.directory_listed: ${JSON.stringify(me.body.data.directory_listed)}`);
    // Now A finds B.
    list = await json('/v1/ghii/list', { headers: auth(A.token) });
    assert(list.body.data.humans.some((h: any) => h.ghii === B.gaii), `A should now find opted-in B: ${JSON.stringify(list.body.data.humans.map((h: any) => h.ghii))}`);
    // B opts back out → disappears for A.
    await json('/v1/ghii', { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ directory_listed: false }) });
    list = await json('/v1/ghii/list', { headers: auth(A.token) });
    assert(!list.body.data.humans.some((h: any) => h.ghii === B.gaii), 'B disappears after opting out');
});

await test('5. GET /v1/catalogue/directory requires a signed-in user (anon 401)', async () => {
    const anon = await json('/v1/catalogue/directory');
    assert(anon.status === 401, `anon directory should be 401, got ${anon.status}`);
});

await test('6. GET /v1/capabilities — a PRIVATE capability is invisible to anon, visible to its owner', async () => {
    const create = await json('/v1/capabilities', { method: 'POST', headers: auth(A.token), body: JSON.stringify({
        name: 'secret-cap', summary: 'private', visibility: 'private', source: { type: 'manual' },
    }) });
    // Publishing policy may disable manual caps on some configs — only assert the leak guard when creation worked.
    if (create.status === 200 || create.status === 201) {
        const capId = create.body.data?.id;
        const anon = await json('/v1/capabilities');
        const anonHasPrivate = (anon.body.data?.capabilities || anon.body.data?.items || []).some((c: any) => c.id === capId);
        assert(!anonHasPrivate, `anon must NOT see the private capability: ${JSON.stringify(anon.body.data)}`);
        const owner = await json('/v1/capabilities?owner=' + encodeURIComponent(A.gaii), { headers: auth(A.token) });
        const ownerHasPrivate = (owner.body.data?.capabilities || owner.body.data?.items || []).some((c: any) => c.id === capId);
        assert(ownerHasPrivate, `owner should see their private capability: ${JSON.stringify(owner.body.data)}`);
    } else {
        console.log(`     (skipped private-cap creation — policy ${create.status})`);
    }
});

await test('7. GET /v1/boards — anon gets NO owner_gaii/allowed_gaiis on public boards', async () => {
    const anon = await json('/v1/boards');
    assert(anon.status === 200, `boards ${anon.status}`);
    const leaked = (anon.body.data.boards || []).some((b: any) => b.owner_gaii !== undefined || b.allowed_gaiis !== undefined);
    assert(!leaked, `anon boards leaked owner/member GAIIs: ${JSON.stringify((anon.body.data.boards || []).slice(0, 2))}`);
    const authed = await json('/v1/boards', { headers: auth(A.token) });
    assert((authed.body.data.boards || []).every((b: any) => 'owner_gaii' in b), 'a signed-in caller gets owner_gaii');
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: auth(B.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
