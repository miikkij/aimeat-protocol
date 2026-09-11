/**
 * @file e2e-admin-discovery-page.ts
 * @description E2E for the Discovery page's reads and the whole-site instant update behind it.
 *   The status door (GET /v1/admin/seo/status) carries the key-file check, the notice log and
 *   what a whole-site notice would send; the plan door (GET /v1/admin/seo/indexnow/plan) lists
 *   the addresses host by host; the send door (POST /v1/admin/seo/indexnow) is refused by name on
 *   a node with no key, which is what the runner's node is. A findable app appears in the plan
 *   and in the status the moment its owner asks for it, and a stranger and a non-operator are
 *   refused at every door.
 *
 *   The send itself is not exercised here: it would POST to api.indexnow.org with a made-up key.
 *   test/unit/indexnow.test.ts proves the grouping, the per-host key location, the log and the
 *   stamp against a recorded fetch.
 * @version-history
 *   v1.0.0 -- 2026-09-11 -- Initial: the three doors' gates, the status shape, the plan, the refusal.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-discovery-page

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
    return { status: res.status, body, headers: res.headers };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

async function status(token: string) {
    const r = await json('/v1/admin/seo/status', { headers: auth(token) });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

console.log('\n=== AIMEAT Admin Discovery Page E2E ===\n');

const opName = `discop${Date.now()}`;
const nonOpName = `discnon${Date.now()}`;
const filename = `disc-${Date.now()}.html`;
let opToken = '';
let nonOpToken = '';
let pageCount = 0;

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(opToken).includes('operator'), `the first owner is the operator, got ${JSON.stringify(roles(opToken))}`);
    assert(!roles(nonOpToken).includes('operator'), `the second owner is not, got ${JSON.stringify(roles(nonOpToken))}`);
});

await test('The three doors refuse a stranger (401) and a non-operator (403)', async () => {
    for (const [method, path] of [['GET', '/v1/admin/seo/status'], ['GET', '/v1/admin/seo/indexnow/plan'], ['POST', '/v1/admin/seo/indexnow']] as const) {
        const anon = await json(path, { method });
        assert(anon.status === 401, `${method} ${path} anonymous expected 401, got ${anon.status}`);
        const nonOp = await json(path, { method, headers: auth(nonOpToken) });
        assert(nonOp.status === 403, `${method} ${path} non-operator expected 403, got ${nonOp.status}`);
    }
});

await test('The status carries the key check, the notice log and what a whole-site notice would send', async () => {
    const d = await status(opToken);
    const ix = d.indexnow;
    // The runner's node has no key: the check cannot run and says so with null, never with false.
    assert(ix.key_configured === false, `no key on the runner's node, got ${JSON.stringify(ix.key_configured)}`);
    assert(ix.key_url === null && ix.key_served === null && ix.key_checked_at === null, `no key means nothing to check, got ${JSON.stringify(ix)}`);
    assert(typeof ix.auto === 'boolean', 'auto is a boolean');
    assert(Array.isArray(ix.runs) && ix.runs.length <= 5, `runs is a list of at most five, got ${JSON.stringify(ix.runs)}`);
    // The runner's node has never sent a notice: no key, nothing fires. So the log is empty here.
    assert(ix.last === null, `no notice has gone out on the runner's node, got ${JSON.stringify(ix.last)}`);
    assert(ix.last_submitted_at === (ix.last?.at ?? null), 'last_submitted_at still says what last says');
    assert(typeof ix.everything.url_count === 'number' && typeof ix.everything.host_count === 'number', 'everything carries the counts');
    assert(ix.everything.url_count >= d.sitemap.page_count, `a whole-site notice carries at least the pages: ${ix.everything.url_count} >= ${d.sitemap.page_count}`);
    assert(ix.everything.last_sent_at === null, `the whole site has never been sent from the runner's node, got ${ix.everything.last_sent_at}`);
    assert(typeof d.identity.twitter_site === 'string', 'the identity carries the X handle, empty or not');
    pageCount = d.sitemap.page_count;
});

await test('The plan for the pages is the page registry alone, on this host', async () => {
    const r = await json('/v1/admin/seo/indexnow/plan?scope=pages', { headers: auth(opToken) });
    assert(r.status === 200, `plan ${r.status}: ${JSON.stringify(r.body.error)}`);
    const p = r.body.data;
    assert(p.scope === 'pages', `scope echoes, got ${p.scope}`);
    assert(p.url_count === pageCount && p.urls.length === pageCount, `the pages: ${p.url_count} of ${pageCount}`);
    assert(p.urls.every((u: string) => u.startsWith(BASE + '/')), `every address is on this host, got ${JSON.stringify(p.urls.slice(0, 3))}`);
    assert(p.host_count === 1 && p.hosts[0].host === BASE && p.hosts[0].url_count === pageCount, `one host, this one, got ${JSON.stringify(p.hosts)}`);
    assert(Array.isArray(p.apps) && p.apps.length === 0, 'no applications in a pages-only plan');
    const bad = await json('/v1/admin/seo/indexnow/plan?scope=everything', { headers: auth(opToken) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `an unknown scope expected 400 INVALID_INPUT, got ${bad.status} ${bad.body.error?.code}`);
});

await test('An application its owner made findable joins the plan and the status', async () => {
    const before = await status(opToken);
    const content = Buffer.from('<!doctype html><html><head><title>Disc</title></head><body>hello</body></html>', 'utf8').toString('base64');
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ filename, name: 'Discovery E2E', description: 'A page that says hello, published to prove it joins the plan.', content }) });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const off = await json('/v1/admin/seo/indexnow/plan?scope=all', { headers: auth(opToken) });
    assert(!off.body.data.apps.some((a: any) => a.filename === filename), 'a freshly published app is not findable, so it is not in the plan');
    const ask = await json(`/v1/apps/${encodeURIComponent(filename)}`, { method: 'PATCH', headers: auth(opToken), body: JSON.stringify({ seo: { index: true } }) });
    assert(ask.status === 200, `owner asks ${ask.status}: ${JSON.stringify(ask.body.error)}`);
    const r = await json('/v1/admin/seo/indexnow/plan?scope=all', { headers: auth(opToken) });
    assert(r.status === 200, `plan ${r.status}: ${JSON.stringify(r.body.error)}`);
    const p = r.body.data;
    const row = p.apps.find((a: any) => a.filename === filename);
    assert(!!row && row.owner === opName, `the app is in the plan under its owner, got ${JSON.stringify(p.apps)}`);
    assert(p.urls.includes(`${BASE}/v1/apps/${opName}/${filename}`), `its apex path is an address in the plan`);
    assert(p.url_count > pageCount, `the plan grew past the pages: ${p.url_count} > ${pageCount}`);
    const after = await status(opToken);
    assert(after.apps.on === before.apps.on + 1, `the status counts it findable: ${after.apps.on} = ${before.apps.on} + 1`);
    assert(after.indexnow.everything.url_count === p.url_count, `the status and the plan agree on the count: ${after.indexnow.everything.url_count} = ${p.url_count}`);
});

await test('Sending is refused by name on a node with no key, and nothing is recorded', async () => {
    const r = await json('/v1/admin/seo/indexnow', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ scope: 'all' }) });
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'NO_INDEXNOW_KEY', `the refusal names the missing key, got ${r.body.error?.code}`);
    assert(typeof r.body.error?.details?.url_count === 'number' && r.body.error.details.url_count > 0, `the refusal still says what it would have sent, got ${JSON.stringify(r.body.error?.details)}`);
    const bad = await json('/v1/admin/seo/indexnow', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ scope: 'nope' }) });
    assert(bad.status === 400, `an unknown scope expected 400, got ${bad.status}`);
    const d = await status(opToken);
    assert(d.indexnow.runs.length === 0 && d.indexnow.last === null, `a refused send leaves no run behind, got ${JSON.stringify(d.indexnow.runs)}`);
});

await test('Cleanup: the app is deleted', async () => {
    const del = await json(`/v1/apps/${encodeURIComponent(filename)}`, { method: 'DELETE', headers: auth(opToken) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
    const r = await json('/v1/admin/seo/indexnow/plan?scope=all', { headers: auth(opToken) });
    assert(!r.body.data.apps.some((a: any) => a.filename === filename), 'the deleted app left the plan');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
