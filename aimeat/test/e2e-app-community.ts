/**
 * @file e2e-app-community.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E tests for an app's three listings (listed, community, unlisted). A community app
 *   is listed to people signed in to this node and to their agents, and to nobody else: the
 *   anonymous catalogue leaves it out, as it leaves out an unlisted one. Covers PATCH `listing`, the
 *   older `parked` boolean mapping onto it, a body where the two disagree, an unknown value, a
 *   re-publish keeping the listing, and another owner or a signed-out caller unable to change it.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-community
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-appcat-sovelluksen-n-kyvyys-listed-community-unlisted).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const ownerA = `commowner${stamp}`;
const ownerB = `commmember${stamp}`;
const FILE = 'community-demo.html';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register an owner and sign it in; returns its token. */
async function ownerToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

const as = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');

/** The row for the test app in a listing, or undefined. */
async function rowIn(token?: string) {
    const { body } = await json('/v1/apps?limit=200', token ? as(token) : {});
    return (body.data?.apps ?? []).find((a: any) => a.filename === FILE && a.owner === ownerA);
}

let tokenA = '';
let tokenB = '';
let agentTokenB = '';

console.log('\n=== App listings: listed, community, unlisted ===\n');

await test('Setup: two owners, an agent of the second, and one listed app', async () => {
    tokenA = await ownerToken(ownerA);
    tokenB = await ownerToken(ownerB);
    const agent = await json('/v1/agents', as(tokenB, {
        method: 'POST',
        body: JSON.stringify({ name: 'commagent', owner: ownerB, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(agent.status === 201, `agent: ${agent.status} ${JSON.stringify(agent.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agent.body.data.private_key, agent.body.data.agent.gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agent.body.data.agent.gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentTokenB = tok.body.data.token;
    const pub = await json('/v1/apps', as(tokenA, {
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64('<h1>community</h1>'), name: 'Community Demo', description: 'for members', category: 'utility', tags: [] }),
    }));
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const row = await rowIn();
    assert(row?.listing === 'listed', `a new app reads listing "listed", got ${row?.listing}`);
});

await test('PATCH { listing: "community" } answers listing community and parked true', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing: 'community' }) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.listing === 'community', `listing community, got ${body.data?.listing}`);
    assert(body.data?.parked === true, `parked true (off every public surface), got ${body.data?.parked}`);
});

await test('A community app is NOT in the anonymous catalogue', async () => {
    assert(!(await rowIn()), 'the anonymous listing must not carry a community app');
});

await test('A community app IS in the listing of another signed-in member', async () => {
    const row = await rowIn(tokenB);
    assert(!!row, 'owner B, signed in, sees owner A\'s community app');
    assert(row.listing === 'community', `B reads listing community, got ${row.listing}`);
});

await test("A community app IS in the listing of a member's agent", async () => {
    assert(!!(await rowIn(agentTokenB)), 'owner B\'s agent sees owner A\'s community app');
});

await test('A community app is in its owner\'s own listing', async () => {
    const row = await rowIn(tokenA);
    assert(row?.listing === 'community', `owner reads listing community, got ${row?.listing}`);
});

await test('Re-publishing a community app keeps it community', async () => {
    const pub = await json('/v1/apps', as(tokenA, {
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64('<h1>community v2</h1>'), name: 'Community Demo', category: 'utility', tags: [] }),
    }));
    assert(pub.status === 201, `re-publish: ${pub.status}`);
    assert(!(await rowIn()), 'still out of the anonymous listing');
    assert((await rowIn(tokenB))?.listing === 'community', 'B still sees it as community');
});

await test('The link still opens a community app for anyone', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerA}/${FILE}`);
    assert(res.status === 200, `direct download, got ${res.status}`);
    assert((await res.text()) === '<h1>community v2</h1>', 'serves the latest version');
});

await test('PATCH { listing: "unlisted" } takes it out of the member listing', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing: 'unlisted' }) }));
    assert(status === 200 && body.data?.listing === 'unlisted', `status ${status}, listing ${body.data?.listing}`);
    assert(!(await rowIn(tokenB)), 'B no longer sees an unlisted app');
    assert((await rowIn(tokenA))?.listing === 'unlisted', 'the owner still does');
});

await test('The older { parked: false } lists the app everywhere again', async () => {
    await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing: 'community' }) }));
    const { status, body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ parked: false }) }));
    assert(status === 200 && body.data?.listing === 'listed', `status ${status}, listing ${body.data?.listing}`);
    assert((await rowIn())?.listing === 'listed', 'back in the anonymous listing');
});

await test('The older { parked: true } means unlisted, not community', async () => {
    const { body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ parked: true }) }));
    assert(body.data?.listing === 'unlisted', `listing unlisted, got ${body.data?.listing}`);
    assert(!(await rowIn(tokenB)), 'B does not see it');
});

await test('An unknown listing is refused 400 and changes nothing', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing: 'members' }) }));
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INVALID_INPUT', `code INVALID_INPUT, got ${body.error?.code}`);
    assert((await rowIn(tokenA))?.listing === 'unlisted', 'still unlisted');
});

await test('listing and parked that disagree are refused 400 and change nothing', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing: 'community', parked: false }) }));
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert((await rowIn(tokenA))?.listing === 'unlisted', 'still unlisted');
});

await test("Another owner cannot change A's listing (PATCH → 404)", async () => {
    const { status } = await json(`/v1/apps/${FILE}`, as(tokenB, { method: 'PATCH', body: JSON.stringify({ listing: 'listed' }) }));
    assert(status === 404, `cross-owner PATCH must 404, got ${status}`);
    assert((await rowIn(tokenA))?.listing === 'unlisted', 'still unlisted');
});

await test('Signed out, a listing change is refused (401 or 403) and changes nothing', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, { method: 'PATCH', body: JSON.stringify({ listing: 'listed' }) });
    assert(status === 401 || status === 403, `a signed-out PATCH must be refused, got ${status}`);
    assert((await rowIn(tokenA))?.listing === 'unlisted', 'still unlisted');
});

await test('Cleanup: delete the test app', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, as(tokenA, { method: 'DELETE' }));
    assert(status === 200 || status === 204, `delete: ${status}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
