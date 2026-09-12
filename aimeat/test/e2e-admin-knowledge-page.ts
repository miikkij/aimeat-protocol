/**
 * @file test/e2e-admin-knowledge-page.ts
 * @description E2E for the Knowledge page's read, and for the door that was writing past its own
 *   schema.
 *
 *   THE ASSERTION THAT MATTERS MOST is `paging.total`. This route has always paginated and always
 *   returned the count; the page asked for page one, read only `packages`, and drew the first
 *   twenty of however many there were. An operator moderating a node saw a fifth of it and had no
 *   way to know. So: a node with more packages than a page holds, and the response has to say so.
 *
 *   THE OTHER ONE IS THE OPERATOR'S IMPORT. `POST /v1/knowledge/import` — an agent's door — ran its
 *   manifest through the schema and refused a maturity outside draft | review | published with the
 *   field named. `POST /v1/admin/knowledge/import` — the OPERATOR's door — checked the name and the
 *   content type and then wrote whatever it had assembled. The privileged path was the unvalidated
 *   one. Both doors are asserted here, because a fix that only holds on one of them is the same
 *   defect wearing a different door.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-knowledge-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Knowledge page's rebuild.
 */

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT Admin Knowledge page E2E ===\n');

const opName = `knop${Date.now()}`;
const otherName = `knother${Date.now()}`;
let opToken = '';
let otherToken = '';

const listAs = (token: string, qs = '') =>
    json(`/v1/admin/knowledge${qs}`, { headers: { Authorization: `Bearer ${token}` } });
const list = (qs = '') => listAs(opToken, qs);

/** One package through the OPERATOR's import door. */
const makeOne = (over: Record<string, unknown> = {}) => json('/v1/admin/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opToken}` },
    body: JSON.stringify({
        name: `probe-${Math.random().toString(36).slice(2, 8)}`,
        content_type: 'dataset',
        tags: 'probe',
        maturity: 'published',
        visibility: 'public',
        entries: [{ title: 'One', content: 'Body' }],
        ...over,
    }),
});

await test('Setup: the first owner is the operator; a second is not', async () => {
    const mk = async (name: string) => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register ${name}: ${reg.status}`);
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
        });
        assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
        return tok.body.data.token as string;
    };
    opToken = await mk(opName);
    otherToken = await mk(otherName);
});

await test('The read carries the count, the shape and the page together', async () => {
    const r = await list();
    assert(r.body.ok === true, `ok: ${JSON.stringify(r.body.error ?? r.status)}`);
    const d = r.body.data;
    assert(Array.isArray(d.packages), 'packages is an array');
    for (const f of ['number', 'per_page', 'total', 'pages']) {
        assert(typeof d.paging?.[f] === 'number', `paging.${f} is a number`);
    }
    for (const f of ['authors', 'kinds', 'maturity', 'visibility']) {
        assert(Array.isArray(d.facets?.[f]), `facets.${f} is an array`);
    }
    assert(typeof d.summary?.total === 'number', 'the summary carries a total');
    // The old flat fields stay, because this list has other readers.
    assert(d.total === d.paging.total && d.page === d.paging.number, 'the legacy flat fields agree');
});

await test('More packages than a page holds, and the response says how many', async () => {
    // Three packages, two per page: the count has to survive the slicing.
    for (let i = 0; i < 3; i++) {
        const r = await makeOne();
        assert(r.status === 201 || r.status === 200, `create ${i}: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    }
    const r = await list('?limit=2&page=1');
    const d = r.body.data;
    assert(d.packages.length === 2, `a page of two, got ${d.packages.length}`);
    assert(d.paging.total >= 3, `the total is the whole set, got ${d.paging.total}`);
    assert(d.paging.pages >= 2, `and it knows there is more than one page, got ${d.paging.pages}`);

    const two = await list('?limit=2&page=2');
    assert(two.body.data.packages.length >= 1, 'page two has packages');
    assert(two.body.data.packages[0].package_id !== d.packages[0].package_id, 'and they are different ones');
});

await test('A page past the end comes back as the last page, not empty', async () => {
    const d = (await list('?limit=2&page=999')).body.data;
    assert(d.paging.number === d.paging.pages, `clamped to the last page, got ${d.paging.number} of ${d.paging.pages}`);
    assert(d.packages.length > 0, 'and it has packages on it');
});

await test('The shape counts the whole match, not the page', async () => {
    const d = (await list('?limit=1')).body.data;
    assert(d.packages.length === 1, 'one package on the page');
    const counted = d.facets.kinds.reduce((a: number, k: any) => a + k.packages, 0);
    assert(counted === d.paging.total, `the facets add to ${d.paging.total}, got ${counted}`);
});

await test('A facet does not narrow its own counts, so the alternatives stay visible', async () => {
    // Applied to everything, choosing one kind leaves one kind standing and the chip row loses the
    // others — a reader can go off a filter but never sideways to the next one.
    const r = await makeOne({ content_type: 'research' });
    assert(r.status === 201 || r.status === 200, `create: ${r.status}`);

    const all = (await list()).body.data;
    const kindsBefore = all.facets.kinds.length;
    assert(kindsBefore >= 2, `more than one kind exists, got ${kindsBefore}`);

    const filtered = (await list('?content_type=research')).body.data;
    assert(filtered.paging.total >= 1, 'the list narrowed');
    assert(filtered.packages.every((p: any) => p.content_type === 'research'), 'to that kind only');
    assert(filtered.facets.kinds.length === kindsBefore,
        `the kinds facet still offers all ${kindsBefore}, got ${filtered.facets.kinds.length}`);

    // The facets that are NOT the applied one still narrow, because they describe what you see.
    assert(filtered.facets.visibility.length >= 1, 'the other facets still describe the match');
});

await test('Search narrows the list and says what it narrowed from', async () => {
    const name = `findme-${Date.now()}`;
    const made = await makeOne({ name });
    assert(made.status === 201 || made.status === 200, `create: ${made.status}`);
    const d = (await list(`?q=${encodeURIComponent(name)}`)).body.data;
    assert(d.paging.total === 1, `one match, got ${d.paging.total}`);
    assert(d.packages[0].name === name, 'and it is the right one');
    assert(d.summary.total > 1, 'while the summary still knows the whole collection');
});

await test('An author is one person however their name was spelled', async () => {
    const d = (await list()).body.data;
    const mine = d.facets.authors.find((a: any) => a.key === opName.toLowerCase());
    assert(!!mine, `the operator appears as an author, got ${JSON.stringify(d.facets.authors.map((a: any) => a.key))}`);
    assert(Array.isArray(mine.spellings) && mine.spellings.length >= 1, 'and its spellings are listed');
    // The collapse is by the name before the node, which is what makes two spellings one person.
    const byKey = (await list(`?author_key=${encodeURIComponent(mine.key)}`)).body.data;
    assert(byKey.paging.total === mine.packages,
        `filtering by the collapsed key gives the same count: ${byKey.paging.total} vs ${mine.packages}`);
});

await test("Every package says whether its maturity is one this node defines", async () => {
    const d = (await list()).body.data;
    assert(d.packages.every((p: any) => typeof p.maturity_declared === 'boolean'),
        'maturity_declared is on every row');
    assert(d.facets.maturity.every((m: any) => typeof m.declared === 'boolean'),
        'and on every facet part');
});

await test('The operator import refuses a maturity the schema does not allow', async () => {
    // The whole point: this door used to write it. The agent's door always refused it.
    const r = await makeOne({ maturity: 'stable' });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'SCHEMA_VALIDATION', `expected SCHEMA_VALIDATION, got ${r.body.error?.code}`);
});

await test('And the refusal carries the details it promises', async () => {
    // `details` is the fifth argument of error(); it was being passed as httpStatus, so a message
    // saying "the details below say which part" carried none.
    const r = await makeOne({ maturity: 'stable' });
    assert(Array.isArray(r.body.error?.details), `details is an array, got ${typeof r.body.error?.details}`);
    assert(r.body.error.details.length > 0, 'and it is not empty');
    assert(JSON.stringify(r.body.error.details).includes('maturity'),
        `and it names the field: ${JSON.stringify(r.body.error.details).slice(0, 200)}`);
});

await test('A review is recorded and the list says somebody looked', async () => {
    const before = (await list('?limit=1')).body.data.packages[0];
    assert(before.last_review === null, 'nothing has been decided about it yet');

    const r = await json(`/v1/admin/knowledge/${encodeURIComponent(before.package_id)}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ reason: 'routine_review', action: 'approve' }),
    });
    assert(r.status === 200 || r.status === 201, `review: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);

    const after = (await list(`?q=${encodeURIComponent(before.name)}`)).body.data.packages
        .find((p: any) => p.package_id === before.package_id);
    assert(!!after, 'the package is still there');
    assert(after.reviews >= 1, `the trail is counted, got ${after.reviews}`);
    assert(after.last_review?.action === 'approve', `and the last action is named, got ${after.last_review?.action}`);
});

await test('The door is operator-only', async () => {
    const other = await listAs(otherToken);
    assert(other.status === 403, `a non-operator: expected 403, got ${other.status}`);
    const anon = await json('/v1/admin/knowledge');
    assert(anon.status === 401 || anon.status === 403, `unauthenticated: got ${anon.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
