/**
 * @file e2e-admin-organisms-page.ts
 * @description E2E for the listing the Organism ownership page is built on, and the one act behind
 *   it. GET /v1/admin/organisms is new: the repair door takes an organism id, and until this existed
 *   nothing on the operator's surface could name one, so the page could only be used by somebody who
 *   already knew the answer.
 *
 *   What is asserted here is the SHAPE the page folds over — id, name, owners, created_by, members,
 *   created_at, archived_at on every row, plus `complete` — because "is any organism stuck" is
 *   counted in the browser from this one answer, and a trimmed or truncated response would answer
 *   "nothing is stuck" about an organism nobody can reach. Then the repair, which is what moves the
 *   owner list the fold reads.
 * @version-history
 *   v1.0.0 -- 2026-09-12 -- Initial (the Organism ownership page in the poster face).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-organisms-page

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

async function listing(token: string) {
    const r = await json('/v1/admin/organisms', { headers: auth(token) });
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

console.log('\n=== AIMEAT Admin Organisms Page E2E ===\n');

const stamp = Date.now();
const opName = `orgop${stamp}`;
const holderName = `orghold${stamp}`;
const helperName = `orghelp${stamp}`;
let opToken = '';
let holderToken = '';
let orgId = '';

await test('Setup: an operator, an owner who holds an organism, and somebody to hand it to', async () => {
    opToken = await registerAndToken(opName);
    holderToken = await registerAndToken(holderName);
    await registerAndToken(helperName);
    const o = await json('/v1/organisms', {
        method: 'POST', headers: auth(holderToken),
        body: JSON.stringify({ name: `Orphan ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `organism ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
});

await test('An owner who is not an operator cannot read the listing the page is built on', async () => {
    const r = await json('/v1/admin/organisms', { headers: auth(holderToken) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('A stranger is turned away before the role is looked at', async () => {
    const r = await json('/v1/admin/organisms');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Every row carries the field set the page counts its figures from', async () => {
    const data = await listing(opToken);
    assert(Array.isArray(data.organisms), 'organisms is not a list');
    assert(typeof data.count === 'number', 'count is missing');
    assert(data.complete === true, 'a node this small should not have hit the cap');
    const mine = data.organisms.find((o: any) => o.id === orgId);
    assert(!!mine, 'the organism just created is not in the listing');
    for (const field of ['id', 'name', 'type', 'visibility', 'owners', 'created_by', 'members', 'created_at', 'updated_at', 'archived_at']) {
        assert(field in mine, `a row has no ${field}: the page counts on it`);
    }
    assert(Array.isArray(mine.owners), 'owners is not a list: "stuck" is counted from it');
    assert(typeof mine.members === 'number', 'members must be a count, not a roster: the page prints it as a figure');
});

await test('The owner list on a row is who actually holds it', async () => {
    const mine = (await listing(opToken)).organisms.find((o: any) => o.id === orgId);
    assert(mine.owners.length === 1 && mine.owners[0] === holderName,
        `expected [${holderName}], got ${JSON.stringify(mine.owners)}`);
    assert(mine.created_by === holderName, `created_by should be the maker: ${mine.created_by}`);
    assert(mine.archived_at === null, 'a fresh organism should carry no archive stamp');
});

await test('The repair adds an owner beside the one already there, and the listing says so', async () => {
    const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
        method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: helperName }),
    });
    assert(r.status === 200, `repair ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.membership_created === true, 'the new owner was not seated as a member');
    const mine = (await listing(opToken)).organisms.find((o: any) => o.id === orgId);
    assert(mine.owners.length === 2, `expected two owners, got ${JSON.stringify(mine.owners)}`);
    assert(mine.owners.includes(holderName) && mine.owners.includes(helperName),
        `both should hold it: ${JSON.stringify(mine.owners)}`);
    assert(mine.created_by === holderName, 'the repair rewrote who made it');
});

await test('The same name a second time is refused, so the page can draw it quiet instead', async () => {
    const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
        method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: helperName }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'ALREADY_OWNER', `expected ALREADY_OWNER, got ${r.body.error?.code}`);
});

await test('A name with no account here is refused, which is the one case the picker cannot pre-empt', async () => {
    const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
        method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: `nobody${stamp}` }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('An owner who is not an operator cannot perform the repair either', async () => {
    const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
        method: 'POST', headers: auth(holderToken), body: JSON.stringify({ ghii: opName }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('The ownership read carries the roster the opened organism draws', async () => {
    const r = await json(`/v1/admin/organisms/${orgId}/ownership`, { headers: auth(opToken) });
    assert(r.status === 200, `ownership ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    for (const field of ['id', 'name', 'owners', 'created_by', 'admins', 'created_at', 'members']) {
        assert(field in d, `the ownership read has no ${field}`);
    }
    const m = d.members.find((x: any) => x.ghii === helperName);
    assert(!!m, 'the new owner is not in the roster');
    assert(m.status === 'active' && m.role === 'creator', `seated wrong: ${JSON.stringify(m)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
