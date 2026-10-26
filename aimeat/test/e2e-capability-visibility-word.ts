/**
 * @file test/e2e-capability-visibility-word.ts
 * @description E2E for the visibility word a capability write may store (secaudit2026oct22; developer
 *   decision 2026-10-26).
 *
 *   WHAT THIS PROVES. POST and PUT /v1/capabilities stored any visibility word they were given. A
 *   word the node does not know (private, owner and public are the ones it knows) is now 400
 *   INVALID_INPUT with a sentence that lists the known words, and nothing is stored.
 *
 *   AND WHAT STAYS. A known word is stored on POST and PUT, and a PUT that sends the stored word back
 *   unchanged goes through.
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capability-visibility-word
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const suffix = Math.random().toString(36).slice(2, 8);
const ownerName = `capword-${suffix}`;
const capId = `capword-cap-${suffix}`;
const wordId = `capword-unknown-${suffix}`;
let token = '';

const body = (id: string, visibility: unknown) => ({
    id, name: `Word ${id}`, summary: 'visibility word fixture', visibility, callable: false, usage: 'not callable',
});

console.log('\n=== Capability visibility word ===\n');

await test('Setup: an owner and a capability with a known word', async () => {
    token = (await registerOwner(BASE, ownerName)).token;
    const made = await json('/v1/capabilities', { method: 'POST', headers: auth(token), body: JSON.stringify(body(capId, 'owner')) });
    assert(made.status === 201 && made.body.data?.visibility === 'owner', `known word on POST: ${made.status} ${JSON.stringify(made.body.error)}`);
});

await test('POST with a visibility word the node does not know is 400 INVALID_INPUT that lists the words, and nothing is stored', async () => {
    const r = await json('/v1/capabilities', { method: 'POST', headers: auth(token), body: JSON.stringify(body(wordId, 'friends')) });
    if (r.status === 201) await json(`/v1/capabilities/${wordId}`, { method: 'DELETE', headers: auth(token) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `an unknown word was stored: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data?.visibility)}`);
    const msg = String(r.body.error?.message ?? '');
    assert(/private/.test(msg) && /owner/.test(msg) && /public/.test(msg), `the sentence lists the words: ${msg}`);
    const back = await json(`/v1/capabilities/${wordId}`, { headers: auth(token) });
    assert(back.status === 404, `nothing is stored: ${back.status}`);
});

await test('PUT with a visibility word the node does not know is 400, and the stored word stays', async () => {
    const r = await json(`/v1/capabilities/${capId}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ visibility: 'friends' }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `an unknown word was stored: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data?.visibility)}`);
    const back = await json(`/v1/capabilities/${capId}`, { headers: auth(token) });
    assert(back.body.data?.visibility === 'owner', `stored word: ${back.body.data?.visibility}`);
});

await test('PUT with a known word, and a PUT that sends the stored word back, go through', async () => {
    const priv = await json(`/v1/capabilities/${capId}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ visibility: 'private' }) });
    assert(priv.status === 200 && priv.body.data?.visibility === 'private', `known word: ${priv.status}`);
    const same = await json(`/v1/capabilities/${capId}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ visibility: 'private', summary: 'renamed' }) });
    assert(same.status === 200 && same.body.data?.summary === 'renamed', `unchanged word: ${same.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/capabilities/${capId}`, { method: 'DELETE', headers: auth(token) });
    await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
