/**
 * @file e2e-admin-cors-page.ts
 * @description E2E for the CORS page's one read (GET /v1/admin/cors/overview) and the writes behind
 *   it. Gives a real person and a real device-auth agent a list of their own through the two admin
 *   doors, gives a memory record one through the agent's own door, and asserts the operator sees all
 *   three in one read: the person and the agent under with_list with their origins, the record in
 *   the count. Then proves the list is honoured where it matters, at the door: a browser origin on
 *   the person's list gets the CORS answer and one that is not gets none. Clearing puts everyone
 *   back on the default, and a bad origin, an unknown name and a non-operator are refused.
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial: the overview's gate and shape, the three lists, the door.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-cors-page

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

/** A device-auth agent (RFC 8628): the way agents are registered, and the one that mints roles=['agent']. */
async function deviceAgent(agentName: string, owner: string, ownerToken: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}: ${JSON.stringify(da.body?.error)}`);
    const approve = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(approve.status === 200 && approve.body?.ok, `agent approve ${approve.status}: ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    return poll.body.token;
}

async function overview(token: string) {
    const r = await json('/v1/admin/cors/overview', { headers: auth(token) });
    assert(r.status === 200, `overview status ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

console.log('\n=== AIMEAT Admin CORS Page E2E ===\n');

const opName = `corsop${Date.now()}`;
const nonOpName = `corsnon${Date.now()}`;
const nonOpGhii = `${nonOpName}@${NODE_ID}`;
const agentName = `corsagent${Date.now()}`;
const agentGaii = `${agentName}#${opName}@${NODE_ID}`;
let opToken = '';
let nonOpToken = '';
let agentToken = '';
let recordsBefore = -1;

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(opToken).includes('operator'), `the first owner is the operator, got ${JSON.stringify(roles(opToken))}`);
    assert(!roles(nonOpToken).includes('operator'), `the second owner is not, got ${JSON.stringify(roles(nonOpToken))}`);
});

await test('The overview door refuses a stranger (401) and a non-operator (403)', async () => {
    const anon = await json('/v1/admin/cors/overview');
    assert(anon.status === 401, `anonymous expected 401, got ${anon.status}`);
    const nonOp = await json('/v1/admin/cors/overview', { headers: auth(nonOpToken) });
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
});

await test('The operator reads the page in one call, with every part present', async () => {
    const d = await overview(opToken);
    assert(Array.isArray(d.default.origins), 'default.origins is a list');
    assert(typeof d.default.wildcard === 'boolean', 'default.wildcard is a boolean');
    assert(d.default.wildcard === d.default.origins.includes('*'), 'wildcard says whether * is in the list');
    assert(d.default.env === 'AIMEAT_CORS_ALLOWED_ORIGINS' && d.default.config_key === 'cors.allowed_origins', 'the default names where it is set');
    assert(JSON.stringify(d.cookie_doors.paths) === JSON.stringify(['/v1/auth/app-grant-silent', '/v1/auth/refresh', '/v1/auth/revoke']), `the three cookie doors, got ${JSON.stringify(d.cookie_doors.paths)}`);
    assert(Array.isArray(d.cookie_doors.named) && !d.cookie_doors.named.includes('*'), 'what is named for them never carries the wildcard');
    assert(d.people.total >= 2, `people.total counts both accounts, got ${d.people.total}`);
    assert(Array.isArray(d.people.with_list) && !d.people.with_list.some((p: any) => p.ghii === nonOpGhii), 'a fresh account has no list of its own');
    assert(typeof d.agents.total === 'number' && Array.isArray(d.agents.with_list), 'agents carry a total and the rows');
    assert(typeof d.records.with_list === 'number', 'records.with_list is a count');
    assert(JSON.stringify(d.precedence) === JSON.stringify(['record', 'agent', 'person', 'default']), `the order the door asks in, got ${JSON.stringify(d.precedence)}`);
    assert(typeof d.anonymous_mode === 'boolean', 'anonymous_mode is a boolean');
    recordsBefore = d.records.with_list;
});

await test('A person is given a list through the admin door, and the page lists them', async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(nonOpGhii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: ['https://allowed.example', 'http://localhost:5173'] }) });
    assert(r.status === 200, `set ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.ghii === nonOpGhii && JSON.stringify(r.body.data.allowed_origins) === JSON.stringify(['https://allowed.example', 'http://localhost:5173']), `the answer echoes the list, got ${JSON.stringify(r.body.data)}`);
    const d = await overview(opToken);
    const row = d.people.with_list.find((p: any) => p.ghii === nonOpGhii);
    assert(!!row, 'the person is under with_list');
    assert(row.owner_name === nonOpName, `the row names the person, got ${row.owner_name}`);
    assert(JSON.stringify(row.allowed_origins) === JSON.stringify(['https://allowed.example', 'http://localhost:5173']), `the row carries the list, got ${JSON.stringify(row.allowed_origins)}`);
});

await test('The door honours the list: a listed origin is answered, an unlisted one is not', async () => {
    const yes = await json('/v1/ghii/cors', { headers: { ...auth(nonOpToken), Origin: 'https://allowed.example' } });
    assert(yes.status === 200, `listed origin request ${yes.status}`);
    assert(yes.headers.get('access-control-allow-origin') === 'https://allowed.example', `the listed origin gets the CORS answer, got ${yes.headers.get('access-control-allow-origin')}`);
    const no = await json('/v1/ghii/cors', { headers: { ...auth(nonOpToken), Origin: 'https://other.example' } });
    assert(no.headers.get('access-control-allow-origin') === null, `an unlisted origin gets no CORS answer, got ${no.headers.get('access-control-allow-origin')}`);
    const pre = await fetch(`${BASE}/v1/ghii/cors`, { method: 'OPTIONS', headers: { ...auth(nonOpToken), Origin: 'https://other.example', 'Access-Control-Request-Method': 'GET' } });
    assert(pre.status === 403, `an unlisted origin's preflight is refused, got ${pre.status}`);
});

await test('A bad origin, an unknown name and a non-operator are refused', async () => {
    const bad = await json(`/v1/admin/ghii/${encodeURIComponent(nonOpGhii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: ['ftp://nope.example'] }) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `a non-http origin expected 400 INVALID_INPUT, got ${bad.status} ${bad.body.error?.code}`);
    const notArray = await json(`/v1/admin/ghii/${encodeURIComponent(nonOpGhii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: 'https://allowed.example' }) });
    assert(notArray.status === 400, `a bare string expected 400, got ${notArray.status}`);
    const missing = await json('/v1/admin/ghii/nobody%40nowhere/cors', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: ['https://allowed.example'] }) });
    assert(missing.status === 404, `unknown person expected 404, got ${missing.status}`);
    const nonOp = await json(`/v1/admin/ghii/${encodeURIComponent(nonOpGhii)}/cors`, { method: 'PUT', headers: auth(nonOpToken), body: JSON.stringify({ allowed_origins: ['https://allowed.example'] }) });
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
    const d = await overview(opToken);
    const row = d.people.with_list.find((p: any) => p.ghii === nonOpGhii);
    assert(!!row && row.allowed_origins.length === 2, 'the refusals changed nothing');
});

await test('An agent is given a list through the admin door, and the page lists it', async () => {
    agentToken = await deviceAgent(agentName, opName, opToken, ['memory:read', 'memory:write']);
    const r = await json(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: ['https://tools.example'] }) });
    assert(r.status === 200, `set ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.gaii === agentGaii, `the answer names the agent, got ${JSON.stringify(r.body.data)}`);
    const d = await overview(opToken);
    const row = d.agents.with_list.find((a: any) => a.gaii === agentGaii);
    assert(!!row, 'the agent is under with_list');
    assert(row.owner === opName, `the row names the owner, got ${row.owner}`);
    assert(JSON.stringify(row.allowed_origins) === JSON.stringify(['https://tools.example']), `the row carries the list, got ${JSON.stringify(row.allowed_origins)}`);
    const missing = await json(`/v1/admin/agents/${encodeURIComponent('nobody#nowhere@' + NODE_ID)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: ['https://tools.example'] }) });
    assert(missing.status === 404, `unknown agent expected 404, got ${missing.status}`);
});

await test('A record given a list by its agent is counted', async () => {
    const key = `cors-page-${Date.now()}`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(agentToken), body: JSON.stringify({ key, value: { note: 'read me from one origin' } }) });
    assert(w.status === 201, `memory write ${w.status}: ${JSON.stringify(w.body.error)}`);
    const c = await json(`/v1/memory/cors/${encodeURIComponent(key)}`, { method: 'PUT', headers: auth(agentToken), body: JSON.stringify({ allowed_origins: ['https://reader.example'] }) });
    assert(c.status === 200, `record cors ${c.status}: ${JSON.stringify(c.body.error)}`);
    const d = await overview(opToken);
    assert(d.records.with_list === recordsBefore + 1, `the record is counted: expected ${recordsBefore + 1}, got ${d.records.with_list}`);
    const clear = await json(`/v1/memory/cors/${encodeURIComponent(key)}`, { method: 'PUT', headers: auth(agentToken), body: JSON.stringify({ allowed_origins: null }) });
    assert(clear.status === 200, `record cors clear ${clear.status}: ${JSON.stringify(clear.body.error)}`);
    const after = await overview(opToken);
    assert(after.records.with_list === recordsBefore, `clearing uncounts it: expected ${recordsBefore}, got ${after.records.with_list}`);
});

await test('Clearing puts the person and the agent back on the default', async () => {
    const p = await json(`/v1/admin/ghii/${encodeURIComponent(nonOpGhii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: null }) });
    assert(p.status === 200 && p.body.data.allowed_origins === null, `clear person ${p.status}: ${JSON.stringify(p.body)}`);
    const a = await json(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/cors`, { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ allowed_origins: null }) });
    assert(a.status === 200 && a.body.data.allowed_origins === null, `clear agent ${a.status}: ${JSON.stringify(a.body)}`);
    const d = await overview(opToken);
    assert(!d.people.with_list.some((x: any) => x.ghii === nonOpGhii), 'the person is off the list');
    assert(!d.agents.with_list.some((x: any) => x.gaii === agentGaii), 'the agent is off the list');
    // The runner's default list is the wildcard (nothing in .env.test.* narrows it), so the origin
    // the person's list refused a moment ago is answered again once the list is gone.
    assert(d.default.wildcard === true, `the runner's default is the wildcard, got ${JSON.stringify(d.default.origins)}`);
    const back = await json('/v1/ghii/cors', { headers: { ...auth(nonOpToken), Origin: 'https://other.example' } });
    assert(back.headers.get('access-control-allow-origin') === 'https://other.example', `on the wildcard default the unlisted origin is answered again, got ${back.headers.get('access-control-allow-origin')}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
