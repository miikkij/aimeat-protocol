/**
 * @file e2e-work-object.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A work item's `input` and a delivery's `output` are JSON objects on every REST door, as
 *   the MCP tools already took them (decision 2026-11-15). A string, an array, a number or null is
 *   refused with 400 on POST /v1/work/request, /v1/work and /v1/work/batch, on /deliver and on
 *   /redeliver, and on POST /v1/federation/cross-node/work before the peer is looked up or the routing
 *   fee is taken. A row stored before the rule, with a string input and output, still reads back
 *   unchanged on GET /v1/work/:tc, and accepting it gives the provider's task one field `input` that
 *   holds the old value (services/work/task-bridge.ts).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-work-object
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
import { assert, BASE, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const stamp = Date.now();
const ACTION = 'work-object-action';

let requesterOwnerToken = '';
let providerOwnerToken = '';
let providerOwnerName = '';
let requesterToken = '';
let providerToken = '';
let requesterGaii = '';
let providerGaii = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Register an agent of an owner and sign it in with its key. */
async function agentOf(ownerName: string, ownerTok: string, name: string, capabilities: string[]): Promise<{ gaii: string; token: string }> {
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner: ownerName, capabilities, model: 'gpt-4o' }),
    });
    assert(made.status === 201, `agent ${name}: ${made.status} ${JSON.stringify(made.body?.error)}`);
    const gaii = made.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(made.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body?.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { gaii, token: tok.body.data.token };
}

const request = (input: unknown) => JSON.stringify({ action_id: ACTION, provider_gaii: providerGaii, input });

/** A work item from the requester, accepted by the provider; returns its tracking code. */
async function acceptedWork(): Promise<string> {
    const made = await json('/v1/work/request', { method: 'POST', headers: auth(requesterToken), body: request({ text: 'hello' }) });
    assert(made.status === 201, `work request: ${made.status} ${JSON.stringify(made.body?.error)}`);
    const tc = made.body.data.tracking_code as string;
    const acc = await json(`/v1/work/${tc}/accept`, { method: 'POST', headers: auth(providerToken) });
    assert(acc.status === 200, `accept: ${acc.status} ${JSON.stringify(acc.body?.error)}`);
    return tc;
}

async function balance(token: string): Promise<number> {
    return Number((await json('/v1/wallet', { headers: auth(token) })).body?.data?.balance);
}

/** The storage the server under test writes, opened beside it. */
async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
    const dbUrl = serverDbUrl();
    const sqlitePath = pinnedSqlitePath();
    assert((provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl), `backend "${provider}" is not reachable from this process`);
    const storage = await createStorage({ provider, sqlitePath, dbUrl });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

console.log('\n=== Work input and output are JSON objects ===\n');

await test('setup: two owners, a requester agent and a provider agent with an action', async () => {
    const reqOwner = await registerOwner(BASE, `wobjreq${stamp}`);
    const provOwner = await registerOwner(BASE, `wobjprov${stamp}`);
    requesterOwnerToken = reqOwner.token;
    providerOwnerToken = provOwner.token;
    providerOwnerName = provOwner.name;
    ({ gaii: requesterGaii, token: requesterToken } = await agentOf(reqOwner.name, requesterOwnerToken, 'requester', ['work']));
    ({ gaii: providerGaii, token: providerToken } = await agentOf(provOwner.name, providerOwnerToken, 'provider', ['work', 'actions']));
    const action = await json('/v1/actions', {
        method: 'POST', headers: auth(providerToken),
        body: JSON.stringify({
            id: ACTION, display_name: 'Work Object Action', description: 'Action for the object rule',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { text: { type: 'string' } } },
            pricing: { toll_morsels: 1 },
        }),
    });
    assert(action.status === 201, `action: ${action.status} ${JSON.stringify(action.body?.error)}`);
});

await test('1. POST /v1/work/request refuses a string, an array, a number and null as input, and names the field', async () => {
    for (const input of ['translate this', ['a', 'b'], 42, null]) {
        const r = await json('/v1/work/request', { method: 'POST', headers: auth(requesterToken), body: request(input) });
        expectRefusal(r, 400);
        const said = JSON.stringify(r.body?.error ?? {});
        assert(said.includes('input'), `the refusal of ${JSON.stringify(input)} names input: ${said}`);
        assert(/object/i.test(said), `the refusal of ${JSON.stringify(input)} says an object is expected: ${said}`);
    }
});

await test('2. POST /v1/work and /v1/work/batch refuse a string input as well', async () => {
    expectRefusal(await json('/v1/work', { method: 'POST', headers: auth(requesterToken), body: request('translate this') }), 400);
    const batch = await json('/v1/work/batch', {
        method: 'POST', headers: auth(requesterToken),
        body: JSON.stringify({ requests: [{ action_id: ACTION, provider_gaii: providerGaii, input: 'translate this' }] }),
    });
    expectRefusal(batch, 400);
});

await test('3. KEPT: an object input is taken with 201, as before', async () => {
    const r = await json('/v1/work/request', { method: 'POST', headers: auth(requesterToken), body: request({ text: 'hello' }) });
    assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(typeof r.body.data.tracking_code === 'string', 'a tracking code');
});

await test('4. /deliver refuses a string output and the item stays accepted; an object output delivers', async () => {
    const tc = await acceptedWork();
    for (const output of ['the translation', [1, 2], 7]) {
        const r = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({ output }) });
        expectRefusal(r, 400);
        assert(JSON.stringify(r.body?.error ?? {}).includes('output'), `the refusal names output: ${JSON.stringify(r.body?.error)}`);
    }
    // KEPT: an object output from anyone but the provider is still refused.
    const notProvider = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(requesterToken), body: JSON.stringify({ output: { text: 'mine' } }) });
    expectRefusal(notProvider, 403, 'ACCESS_DENIED');
    const still = await json(`/v1/work/${tc}`, { headers: auth(requesterToken) });
    assert(still.body?.data?.status === 'accepted', `status after the refusals: ${still.body?.data?.status}`);
    const ok = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({ output: { text: 'done' } }) });
    assert(ok.status === 200, `object output: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    assert(ok.body.data.output?.text === 'done', `the output reads back: ${JSON.stringify(ok.body.data.output)}`);
});

await test('5. KEPT: /deliver without output answers as before (the contract asks for the field)', async () => {
    const tc = await acceptedWork();
    const r = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({}) });
    expectRefusal(r, 400, 'VALIDATION_ERROR');
});

await test('6. /redeliver refuses a string output; without output it answers as before; an object re-delivers', async () => {
    const tc = await acceptedWork();
    const del = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({ output: { text: 'first' } }) });
    assert(del.status === 200, `deliver: ${del.status}`);
    const dispute = await json(`/v1/work/${tc}/dispute`, { method: 'POST', headers: auth(requesterToken), body: JSON.stringify({ reason: 'Not what I asked for' }) });
    assert(dispute.status === 201, `dispute: ${dispute.status} ${JSON.stringify(dispute.body?.error)}`);
    const str = await json(`/v1/work/${tc}/redeliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({ output: 'better text' }) });
    expectRefusal(str, 400);
    const none = await json(`/v1/work/${tc}/redeliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({}) });
    expectRefusal(none, 400);
    const notProvider = await json(`/v1/work/${tc}/redeliver`, { method: 'POST', headers: auth(requesterToken), body: JSON.stringify({ output: { text: 'mine' } }) });
    expectRefusal(notProvider, 403, 'ACCESS_DENIED');
    const read = await json(`/v1/work/${tc}`, { headers: auth(requesterToken) });
    assert(read.body?.data?.output?.text === 'first', `the stored output is untouched: ${JSON.stringify(read.body?.data?.output)}`);
    const ok = await json(`/v1/work/${tc}/redeliver`, { method: 'POST', headers: auth(providerToken), body: JSON.stringify({ output: { text: 'better' } }) });
    assert(ok.status === 200 && ok.body.data.redelivered === true, `object re-delivery: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
});

await test('7. POST /v1/federation/cross-node/work refuses a string input before the peer lookup and the fee', async () => {
    const before = await balance(requesterOwnerToken);
    const r = await json('/v1/federation/cross-node/work', {
        method: 'POST', headers: auth(requesterToken),
        body: JSON.stringify({ target_node: 'no-such-node', action_id: ACTION, provider_gaii: providerGaii, input: 'translate this' }),
    });
    // 400 from the contract check (VALIDATION_ERROR) or from the route (INVALID_INPUT), never the 404
    // of the unknown peer: the refusal comes before the peer lookup.
    expectRefusal(r, 400);
    assert(JSON.stringify(r.body?.error ?? {}).includes('input'), `the refusal names input: ${JSON.stringify(r.body?.error)}`);
    const after = await balance(requesterOwnerToken);
    assert(after === before, `no routing fee: the balance was ${before} and is ${after}`);
});

await test('8. KEPT: a row stored before the rule, with a string input and output, reads back unchanged', async () => {
    const tc = `tc-${randomUUID()}`;
    const now = new Date().toISOString();
    await withStorage(s => s.createWork({
        trackingCode: tc, status: 'pending', actionId: ACTION, providerGaii, requesterGaii,
        input: 'an old text input' as unknown as Record<string, unknown>,
        cost: { toll: 0, networkFee: 0, total: 0, inEscrow: 0 },
        ttlExpiresAt: new Date(Date.now() + 3600_000).toISOString(), createdAt: now, updatedAt: now,
    }));
    const read = await json(`/v1/work/${tc}`, { headers: auth(requesterToken) });
    assert(read.status === 200, `GET: ${read.status} ${JSON.stringify(read.body?.error)}`);
    assert(read.body.data.input === 'an old text input', `input reads back: ${JSON.stringify(read.body.data.input)}`);

    // The provider's agent runs the task system, so accepting builds a task from the input.
    const directives = await json(`/v1/agents/provider/directives`, { method: 'PUT', headers: auth(providerOwnerToken), body: JSON.stringify({ purpose: 'Does translations' }) });
    assert(directives.status === 200, `directives: ${directives.status} ${JSON.stringify(directives.body?.error)}`);
    const acc = await json(`/v1/work/${tc}/accept`, { method: 'POST', headers: auth(providerToken) });
    assert(acc.status === 200, `accept: ${acc.status} ${JSON.stringify(acc.body?.error)}`);
    const { tasks } = await withStorage(s => s.listAgentTasks(providerGaii));
    const task = tasks.find(t => t.workTrackingCode === tc);
    assert(task, `a task for ${tc} (owner ${providerOwnerName})`);
    // Field by field: PostgreSQL's jsonb does not keep the key order.
    const only = task.scope.length === 1 ? task.scope[0] : undefined;
    assert(only?.name === 'input' && only.value === '"an old text input"' && only.type === 'text',
        `one field input holding the old value as JSON: ${JSON.stringify(task.scope)}`);

    await withStorage(s => s.updateWork(tc, { output: 'an old text output' as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() }));
    const again = await json(`/v1/work/${tc}`, { headers: auth(requesterToken) });
    assert(again.body?.data?.output === 'an old text output', `output reads back: ${JSON.stringify(again.body?.data?.output)}`);
});

finish();
