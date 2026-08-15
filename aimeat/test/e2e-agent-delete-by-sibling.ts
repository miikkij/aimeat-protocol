/**
 * @file test/e2e-agent-delete-by-sibling.ts
 * @description An agent ending an agent it created, and every way that must be refused.
 *
 *   The case is a fleet concierge: a hatchery instance registers agents on its owner's behalf
 *   through same-owner auto-approval, and when its container is deprovisioned it has to clear those
 *   agents away. Until now it could not — DELETE /v1/agents/:name was owner-only — so the credential
 *   that could create an agent could never end one, and a deprovisioned instance left its whole
 *   fleet behind.
 *
 *   Three conditions, and the suite exists to prove each one is load-bearing on its own: same owner,
 *   `agent:delete`, and `registeredBy` naming the caller. Same-owner alone would let every agent an
 *   owner has kill every sibling it never made; the scope alone would hand one approved agent the
 *   whole fleet. The pair is the narrow thing.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-delete-by-sibling
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, with the route.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
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
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `adel${label}${Date.now()}`;
    const body = JSON.stringify({ username: owner, display_name: 'T', password: 'DeleteMe1234567' });
    let r = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

/** An agent the OWNER registers directly, with the scopes given. */
async function ownerRegisters(owner: string, ownerToken: string, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${name}: ${ag.status} ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

/** An agent registered BY another agent, through same-owner auto-approval. */
async function siblingRegisters(creatorToken: string, owner: string, name: string, scopes?: string[]) {
    const start = await json('/v1/agents/device-authorize', {
        method: 'POST', headers: { Authorization: `Bearer ${creatorToken}` },
        body: JSON.stringify({ owner, agent_name: name, ...(scopes ? { scopes } : {}) }),
    });
    assert(start.status === 200, `device-authorize ${name}: ${start.status} ${JSON.stringify(start.body?.error)}`);
    assert(start.body.data.auto_approved === true, `${name} should be auto-approved by its sibling`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200, `device-token ${name}: ${poll.status}`);
    return { name, gaii: poll.body.gaii as string, token: poll.body.access_token as string };
}

const del = (name: string, token: string) =>
    json(`/v1/agents/${name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });

console.log('\n=== An agent deletes what it created ===\n');

async function run() {
    const o = await setupOwner('a');
    const auth = { Authorization: `Bearer ${o.ownerToken}` };

    // The concierge holds agent:delete. `plain` holds everything else a wildcard carries, which is
    // how the suite shows the scope is doing work rather than the wildcard.
    const concierge = await ownerRegisters(o.owner, o.ownerToken, 'concierge', ['*']);
    const plain = await ownerRegisters(o.owner, o.ownerToken, 'plain', ['memory:read', 'memory:write', 'agent:write']);

    const built = await siblingRegisters(concierge.token, o.owner, 'newsbot');
    const alsoBuilt = await siblingRegisters(concierge.token, o.owner, 'trendbot');

    await test('the node records who asked for the agent', async () => {
        const { body } = await json('/v1/agents', { headers: auth });
        const rec = (body.data.agents ?? []).find((a: any) => a.name === 'newsbot');
        assert(!!rec, 'newsbot is listed');
        assert(rec.registered_by === concierge.gaii,
            `expected registered_by=${concierge.gaii}, got ${rec.registered_by}`);
        const own = (body.data.agents ?? []).find((a: any) => a.name === 'concierge');
        assert(own.registered_by === o.owner, `an owner-registered agent names the owner, got ${own.registered_by}`);
    });

    await test('an agent without the permission cannot delete what IT created', async () => {
        // Explicit scopes, and narrow ones: an agent approver may only pass on what it already
        // holds, and `plain` does not hold the node defaults in full. That guard is not what this
        // test is about, so it is stepped around rather than tripped.
        const mine = await siblingRegisters(plain.token, o.owner, 'plainschild', ['memory:read']);
        const r = await del(mine.name, plain.token);
        assert(r.status === 403, `expected 403, got ${r.status}`);
        // requireRoleOrScope refuses with ACCESS_DENIED, and names the word it wanted — which is
        // what makes the refusal actionable: the owner has a box to tick.
        assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);
        assert(String(r.body.error?.message).includes('agent:delete'),
            `the refusal must name the missing permission: ${r.body.error?.message}`);
        // Cleanup through the owner, so the rest of the suite starts clean.
        await del(mine.name, o.ownerToken);
    });

    await test('the concierge cannot delete an agent it did not create', async () => {
        const r = await del(plain.name, concierge.token);
        assert(r.status === 403, `expected 403, got ${r.status}`);
        assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);
        const list = await json('/v1/agents', { headers: auth });
        assert((list.body.data.agents ?? []).some((a: any) => a.name === 'plain'), 'plain still exists');
    });

    await test('nor one a SIBLING created — which is the case the header is about', async () => {
        // The test above points the concierge at `plain`, whom the OWNER registered, so
        // registered_by is the bare owner name. Change the guard in routes/agents/management.ts from
        // `agent.registeredBy !== req.auth!.sub` to `agent.registeredBy === ownerName` — protect only
        // what the human registered directly — and every case in this file still passes: plain is
        // owner-registered, the self-delete is still refused, the concierge still deletes its own,
        // the cross-owner case is still 404. Nine green, while any agent holding agent:delete
        // destroys every agent any sibling ever created under that owner, live sessions included.
        //
        // So: an agent registered by a DIFFERENT agent, offered to the concierge.
        const theirs = await siblingRegisters(plain.token, o.owner, 'plainsward', ['memory:read']);
        const listed = await json('/v1/agents', { headers: auth });
        const rec = (listed.body.data.agents ?? []).find((a: any) => a.name === 'plainsward');
        assert(rec?.registered_by === plain.gaii,
            `the fixture has to be sibling-registered, got ${rec?.registered_by}`);

        const r = await del(theirs.name, concierge.token);
        assert(r.status === 403, `the concierge deleted a sibling's agent: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);

        const after = await json('/v1/agents', { headers: auth });
        assert((after.body.data.agents ?? []).some((a: any) => a.name === 'plainsward'),
            'the refused delete removed it anyway');

        // Cleanup through the owner, so the rest of the suite starts clean. `plain` is not offered
        // the delete here: it lacks agent:delete, which the test two above already proves, and a
        // refusal for the wrong reason would say nothing about ownership.
        await del(theirs.name, o.ownerToken);
    });

    await test('the concierge cannot delete itself', async () => {
        const r = await del(concierge.name, concierge.token);
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('the concierge DELETES the agent it created, and the sessions go with it', async () => {
        const r = await del(built.name, concierge.token);
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.sessions_revoked >= 1, `expected at least one session ended, got ${r.body.data.sessions_revoked}`);

        const still = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${built.token}` } });
        assert(still.status === 401, `the deleted agent's own token must be dead, got ${still.status}`);

        const list = await json('/v1/agents', { headers: auth });
        const names = (list.body.data.agents ?? []).map((a: any) => a.name);
        assert(!names.includes('newsbot'), 'newsbot is gone');
        assert(names.includes('trendbot'), 'its sibling is untouched');
    });

    await test('a different owner\'s agent cannot reach it at all', async () => {
        const o2 = await setupOwner('b');
        const stranger = await ownerRegisters(o2.owner, o2.ownerToken, 'stranger', ['*']);
        const r = await del(alsoBuilt.name, stranger.token);
        assert(r.status === 404, `a foreign name resolves under the caller's own owner, so 404; got ${r.status}`);
        const list = await json('/v1/agents', { headers: auth });
        assert((list.body.data.agents ?? []).some((a: any) => a.name === 'trendbot'), 'trendbot survives');
        await json(`/v1/owners/${encodeURIComponent(o2.owner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${o2.ownerToken}` } });
    });

    await test('the owner can still delete anything of theirs', async () => {
        const r = await del(alsoBuilt.name, o.ownerToken);
        assert(r.status === 200, `owner delete ${r.status}`);
    });

    await test('a device authorization now waits two hours', async () => {
        const start = await json('/v1/agents/device-authorize', {
            method: 'POST',
            body: JSON.stringify({ owner: o.owner, agent_name: 'patientbot' }),
        });
        assert(start.status === 200, `device-authorize ${start.status}`);
        assert(start.body.data.expires_in === 7200, `expected 7200, got ${start.body.data.expires_in}`);
        assert(start.body.data.status === 'pending', 'an unauthenticated call still needs the human');
    });

    console.log('\nCleanup');
    await test('cascade-delete the owner', async () => {
        const { status } = await json(`/v1/owners/${encodeURIComponent(o.owner)}`, { method: 'DELETE', headers: auth });
        assert(status === 200, `delete owner ${status}`);
    });
}

await run();

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent delete by sibling E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
