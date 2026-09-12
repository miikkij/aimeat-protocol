/**
 * @file e2e-admin-hooks-page.ts
 * @description E2E for the Hooks page's one read and the binding behind it. The read says which of
 *   the eleven moments decide rather than notify, what is bound to each and whether that action is
 *   still published and still carries an address, what could be bound, and every call made. The
 *   write binds a moment, names back a reference nothing is published under, and clears one. Every
 *   door refuses a stranger and a non-operator.
 *
 *   The binding is proven against a REAL published action, because the interesting failures are the
 *   ones where the binding looks right: an action with no address is bound and does nothing, and a
 *   reference to something that was never published is accepted and has to be named.
 * @version-history
 *   v1.0.0 -- 2026-09-12 -- Initial: the three doors' gates, the read's shape, bind, name, clear.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-hooks-page

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

/** A device-auth agent (RFC 8628): the way agents are registered, and what publishes an action. */
async function deviceAgent(agentName: string, owner: string, ownerToken: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}: ${JSON.stringify(da.body?.error)}`);
    const approve = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(approve.status === 200 && approve.body?.ok, `agent approve ${approve.status}: ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    return poll.body.token;
}

async function hooks(token: string) {
    const r = await json('/v1/admin/hooks', { headers: auth(token) });
    assert(r.status === 200, `hooks ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}
const rowOf = (d: any, name: string) => d.hooks.find((h: any) => h.name === name);

console.log('\n=== AIMEAT Admin Hooks Page E2E ===\n');

const opName = `hookop${Date.now()}`;
const nonOpName = `hooknon${Date.now()}`;
const agentName = `hookagent${Date.now()}`;
const withAddr = `hook-addr-${Date.now()}`;
const noAddr = `hook-noaddr-${Date.now()}`;
let opToken = '';
let nonOpToken = '';
let agentToken = '';
let withAddrRef = '';

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(opToken).includes('operator'), `the first owner is the operator, got ${JSON.stringify(roles(opToken))}`);
    assert(!roles(nonOpToken).includes('operator'), `the second owner is not, got ${JSON.stringify(roles(nonOpToken))}`);
});

await test('The three doors refuse a stranger (401) and a non-operator (403)', async () => {
    for (const [method, path] of [['GET', '/v1/admin/hooks'], ['PUT', '/v1/admin/hooks/pre_board_post'], ['DELETE', '/v1/admin/hooks/pre_board_post']] as const) {
        const body = method === 'PUT' ? JSON.stringify({ actions: [] }) : undefined;
        const anon = await json(path, { method, body });
        assert(anon.status === 401, `${method} ${path} anonymous expected 401, got ${anon.status}`);
        const nonOp = await json(path, { method, headers: auth(nonOpToken), body });
        assert(nonOp.status === 403, `${method} ${path} non-operator expected 403, got ${nonOp.status}`);
    }
});

await test('The read says which moments decide, and carries the whole page', async () => {
    const d = await hooks(opToken);
    assert(Array.isArray(d.hooks) && d.hooks.length === 11, `eleven moments, got ${d.hooks?.length}`);
    const gates = d.hooks.filter((h: any) => h.kind === 'gate').map((h: any) => h.name);
    assert(JSON.stringify(gates) === JSON.stringify([
        'pre_owner_registration', 'pre_agent_registration', 'pre_work_request', 'pre_board_post', 'pre_federation_peer',
    ]), `the five gates are the pre_ ones, got ${JSON.stringify(gates)}`);
    assert(d.hooks.every((h: any) => (h.kind === 'gate') === h.name.startsWith('pre_')), 'kind follows the name, every row');
    assert(d.hooks.every((h: any) => ['accounts', 'work', 'social'].includes(h.guards)), 'every moment belongs to a group');
    assert(d.summary.total === 11 && d.summary.gates === 5, `the summary counts them, got ${JSON.stringify(d.summary)}`);
    assert(d.summary.timeout_ms === 10000, `the page says how long an address gets, got ${d.summary.timeout_ms}`);
    assert(typeof d.extension_hooks === 'object' && 'pre_board_post' in d.extension_hooks, 'the old shape is still there');
    assert(Array.isArray(d.runs) && d.runs.length === 0, `nothing has run on a fresh node, got ${d.runs?.length}`);
    assert(Array.isArray(d.failing) && d.failing.length === 0, 'nothing is failing when nothing is bound');
    assert(Array.isArray(d.bindable_actions), 'the actions that could be bound are listed');
});

await test('An action published by an agent becomes bindable, and says whether it has an address', async () => {
    agentToken = await deviceAgent(agentName, opName, opToken, ['work:publish']);
    const publish = async (id: string, webhook?: string) => {
        const r = await json('/v1/actions', { method: 'POST', headers: auth(agentToken), body: JSON.stringify({
            id, display_name: `Test ${id}`, description: 'An action published to prove a hook can bind to it.',
            input_schema: { type: 'object' }, output_schema: { type: 'object' },
            pricing: { base_morsels: 0 }, tags: ['test'],
            ...(webhook ? { webhook_url: webhook } : {}),
        }) });
        assert(r.status === 201, `publish ${id}: ${r.status} ${JSON.stringify(r.body.error)}`);
        return r.body.data;
    };
    await publish(withAddr, 'https://hooks.invalid/check');
    await publish(noAddr);

    const d = await hooks(opToken);
    const a = d.bindable_actions.find((x: any) => x.id === withAddr);
    const b = d.bindable_actions.find((x: any) => x.id === noAddr);
    assert(!!a && !!b, `both actions are bindable, got ${JSON.stringify(d.bindable_actions.map((x: any) => x.id))}`);
    assert(a.has_address === true && a.host === 'hooks.invalid', `the one with an address names its host, got ${JSON.stringify(a)}`);
    assert(b.has_address === false && b.host === null, `the one without says so, got ${JSON.stringify(b)}`);
    assert(a.ref === `${withAddr}#${a.provider}`, `the reference is the id with its provider, got ${a.ref}`);
    assert(d.summary.actions_available >= 2 && d.summary.actions_with_address >= 1, `the summary counts them, got ${JSON.stringify(d.summary)}`);
    withAddrRef = a.ref;
});

await test('Binding a moment names what it means, and the read shows it', async () => {
    const r = await json('/v1/admin/hooks/pre_board_post', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ actions: [withAddrRef, noAddr] }) });
    assert(r.status === 200, `bind ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.hook === 'pre_board_post' && r.body.data.cleared === false, `the answer names the moment, got ${JSON.stringify(r.body.data)}`);
    assert(JSON.stringify(r.body.data.unknown) === '[]', `both references are published, got ${JSON.stringify(r.body.data.unknown)}`);
    assert(/refuses/.test(r.body.data.note), `a gate's note says it refuses, got "${r.body.data.note}"`);

    const d = await hooks(opToken);
    const row = rowOf(d, 'pre_board_post');
    assert(row.actions.length === 2, `two are bound, got ${row.actions.length}`);
    assert(row.actions[0].published && row.actions[0].has_address && row.actions[0].host === 'hooks.invalid', `the first carries an address, got ${JSON.stringify(row.actions[0])}`);
    assert(row.actions[1].published && row.actions[1].has_address === false, `the second is bound and does nothing, got ${JSON.stringify(row.actions[1])}`);
    assert(d.summary.bound === 1 && d.summary.bound_gates === 1, `the summary counts the binding, got ${JSON.stringify(d.summary)}`);
    assert(d.extension_hooks.pre_board_post.length === 2, 'the old shape carries it too');
});

await test('A reference nothing is published under is accepted and named back', async () => {
    const r = await json('/v1/admin/hooks/post_settlement', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ actions: ['nobody-published-this'] }) });
    assert(r.status === 200, `bind ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(JSON.stringify(r.body.data.unknown) === '["nobody-published-this"]', `the unknown reference is named, got ${JSON.stringify(r.body.data.unknown)}`);
    const row = rowOf(await hooks(opToken), 'post_settlement');
    assert(row.actions[0].published === false && row.actions[0].name === null, `the read says it is not published here, got ${JSON.stringify(row.actions[0])}`);
    assert(/told after|stopped/i.test(r.body.data.note) || !/refuses/.test(r.body.data.note), `a notify hook's note does not claim it refuses, got "${r.body.data.note}"`);
});

await test('An unknown moment and a bad list are refused', async () => {
    const badHook = await json('/v1/admin/hooks/pre_nothing', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ actions: [] }) });
    assert(badHook.status === 400 && badHook.body.error?.code === 'INVALID_INPUT', `an unknown moment expected 400 INVALID_INPUT, got ${badHook.status} ${badHook.body.error?.code}`);
    assert(/pre_owner_registration/.test(badHook.body.error.message), `the refusal names the eleven, got "${badHook.body.error?.message}"`);
    const badBody = await json('/v1/admin/hooks/pre_board_post', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ actions: 'check' }) });
    assert(badBody.status === 400, `a bare string expected 400, got ${badBody.status}`);
    const stillTwo = rowOf(await hooks(opToken), 'pre_board_post');
    assert(stillTwo.actions.length === 2, 'the refusals changed nothing');
});

await test('Clearing a moment stops it calling out, both ways', async () => {
    const empty = await json('/v1/admin/hooks/pre_board_post', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ actions: [] }) });
    assert(empty.status === 200 && empty.body.data.cleared === true, `an empty list clears it, got ${JSON.stringify(empty.body.data)}`);
    const del = await json('/v1/admin/hooks/post_settlement', { method: 'DELETE', headers: auth(opToken) });
    assert(del.status === 200 && del.body.data.cleared === true, `DELETE clears it, got ${JSON.stringify(del.body.data)}`);
    const d = await hooks(opToken);
    assert(d.summary.bound === 0, `nothing is bound now, got ${d.summary.bound}`);
    assert(rowOf(d, 'pre_board_post').actions.length === 0 && rowOf(d, 'post_settlement').actions.length === 0, 'both moments are empty');
    const missing = await json('/v1/admin/hooks/not_a_hook', { method: 'DELETE', headers: auth(opToken) });
    assert(missing.status === 404, `DELETE on an unknown moment expected 404, got ${missing.status}`);
});

await test('Cleanup: the two actions are deleted', async () => {
    for (const id of [withAddr, noAddr]) {
        const r = await json(`/v1/actions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(agentToken) });
        assert(r.status === 200 || r.status === 204, `delete ${id}: ${r.status} ${JSON.stringify(r.body.error)}`);
    }
    const d = await hooks(opToken);
    assert(!d.bindable_actions.some((a: any) => a.id === withAddr || a.id === noAddr), 'both are gone from what could be bound');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
