/**
 * @file e2e-account-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account doors nothing drove before: the GHII registration and password-login
 *   validators (src/routes/ghii/register-login.ts), the whole agent lifecycle surface
 *   (src/routes/agents/management.ts — export, import, rekey, port, scopes, federate, delete, CORS)
 *   and the agent registration doors (src/routes/agents/registration.ts — the owner-authed create,
 *   the connectivity-key connect, the User-Agent platform arm and the consent page). Every refusal
 *   is asserted by its status AND its error code, because two of these doors answer 400 for four
 *   different reasons.
 * @structure
 *   Phase 0  setup: an operator, four owners, one agent
 *   Phase 1  POST /v1/ghii validators
 *   Phase 2  POST /v1/ghii/login validators
 *   Phase 3  export + import
 *   Phase 4  rekey (the old key stops minting, the new one starts)
 *   Phase 5  port (the 200 arm, then the 402 when the balance runs out)
 *   Phase 6  scopes + federate
 *   Phase 7  delete
 *   Phase 8  per-agent CORS
 *   Phase 9  POST /v1/agents refusals, platform detection, GET /v1/agents/verify
 *   Phase 10 POST /v1/agents/connect (connectivity key)
 *   Phase 11 401 and 403 on every door
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-account-doors
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Written from the routes rather than from the docs, so it records
 *     four branches that cannot be reached from outside (see the FINDING comments): the two
 *     INVALID_INPUT guards behind a required-field zod schema, and the cross-owner 403s that sit
 *     after an owner-scoped storage read and so answer 404 instead.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Owner { name: string; token: string; privateKey: string }

/** An owner through POST /v1/owners: no rate limit on that door, unlike POST /v1/ghii. */
async function setupOwner(label: string): Promise<Owner> {
    const name = `acctdoor${label}${Date.now().toString(36)}`;
    const reg = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `owner ${label} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const privateKey = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(privateKey, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner ${label} token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string, privateKey };
}

/** An agent of `owner`, through the owner-authed door. Returns its GAII, private key and token. */
async function setupAgent(owner: Owner, name: string, scopes: string[]) {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privateKey = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(privateKey, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent ${name} token: ${JSON.stringify(tok.body?.error)}`);
    return { name, gaii, privateKey, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Account Doors E2E ===\n');

// ─── Phase 0 — setup ───
console.log('Phase 0 — setup');

let OP: Owner;                                     // operator (the node's first owner may already exist)
let A: Owner, B: Owner, P: Owner, D: Owner;        // primary, cross-owner, porting, and one to erase
let agentA: Awaited<ReturnType<typeof setupAgent>>;

await test('Setup: an operator through the admin setup door', async () => {
    const name = `acctdoorop${Date.now().toString(36)}`;
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `setup/register ${reg.status}: ${JSON.stringify(reg.body)}`);
    assert(reg.body.owner?.roles?.includes('operator'), `operator role: ${JSON.stringify(reg.body.owner?.roles)}`);
    const privateKey = reg.body.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(privateKey, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body?.error)}`);
    OP = { name, token: tok.body.data.token as string, privateKey };
});

await test('Setup: four owners and one agent', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    P = await setupOwner('p');
    D = await setupOwner('d');
    agentA = await setupAgent(A, 'lifecycle', ['memory:read', 'memory:write', 'agent:delete']);
    assert(agentA.gaii === `lifecycle#${A.name}@${NODE_ID}`, `the agent's GAII: ${agentA.gaii}`);
});

// ─── Phase 1 — POST /v1/ghii validators ───
//
// POST /v1/ghii is rate-limited per IP (config.registrationRateLimitMax; the test runner pins it
// to 1000 a minute). Until 2026-09-09 the limiter keyed on `req.auth?.sub ?? ip`, so a call
// carrying any bearer token got that principal's own bucket on the public sign-up door; test 0
// below asserts the shared bucket, and the calls after it carry no credential, the way a
// registration does.
console.log('Phase 1 — POST /v1/ghii validators');

const registerGhii = (body: Record<string, unknown>) =>
    json('/v1/ghii', { method: 'POST', body: JSON.stringify(body) });

await test('0. The registration limiter counts by IP: a bearer token does not buy a private bucket', async () => {
    // Two calls from the same address with two different tokens land in ONE bucket, so the second
    // call's Remaining is one less than the first's. With per-token buckets each would start fresh.
    const remaining = async (token: string): Promise<number> => {
        const res = await fetch(`${BASE}/v1/ghii`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) },
            body: JSON.stringify({ display_name: 'bucket probe' }),
        });
        await res.text();
        assert(res.status === 400, `a bodyless registration is refused either way: ${res.status}`);
        const h = res.headers.get('x-ratelimit-remaining');
        assert(h !== null, 'the limiter stamps X-RateLimit-Remaining');
        return Number(h);
    };
    const first = await remaining(A.token);
    const second = await remaining(B.token);
    assert(second === first - 1, `one shared bucket: ${first} then ${second}`);
    const anon = await fetch(`${BASE}/v1/ghii`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'bucket probe' }) });
    await anon.text();
    assert(Number(anon.headers.get('x-ratelimit-remaining')) === second - 1, `and the anonymous call shares it too: ${anon.headers.get('x-ratelimit-remaining')}`);
});

await test('1. Register with no username is refused', async () => {
    const r = await registerGhii({ display_name: 'No Name' });
    // GhiiRegistrationSchema makes username a required z.string().min(1) and validateBody answers
    // first, so the code on the wire is VALIDATION_ERROR. The handler's own `username is required`
    // guard behind it could not fire and was removed on 2026-09-09.
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.body.error?.code}`);
});

await test('2. Register with a REMOTE identity is refused (FEDERATION_REGISTER_UNSUPPORTED)', async () => {
    const r = await registerGhii({ username: `acctghii${Date.now().toString(36)}@some-other-node`, display_name: 'Remote' });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.error?.code === 'FEDERATION_REGISTER_UNSUPPORTED',
        `expected FEDERATION_REGISTER_UNSUPPORTED, got ${r.body.error?.code}`);
});

await test('3. Register with THIS node\'s id in the username strips it and registers locally', async () => {
    const bare = `acctghii${Date.now().toString(36)}`;
    const r = await registerGhii({ username: `${bare}@${NODE_ID}`, display_name: 'Local Full GHII', password: 'AcctDoor1234' });
    assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.ghii.username === bare, `username stripped to the bare handle: ${r.body.data.ghii.username}`);
    assert(r.body.data.ghii.ghii === `${bare}@${NODE_ID}`, `ghii is local: ${r.body.data.ghii.ghii}`);
});

await test('4. Register with a name the grammar refuses, and with a reserved one', async () => {
    const short = await registerGhii({ username: 'ab', display_name: 'Too Short' });
    assert(short.status === 400 && short.body.error?.code === 'INVALID_INPUT',
        `short name: ${short.status} ${short.body.error?.code}`);
    const reserved = await registerGhii({ username: 'registry', display_name: 'Reserved' });
    assert(reserved.status === 400 && reserved.body.error?.code === 'INVALID_INPUT',
        `reserved name: ${reserved.status} ${reserved.body.error?.code}`);
    assert(/reserved/i.test(reserved.body.error?.message ?? ''), `reserved message: ${reserved.body.error?.message}`);
});

await test('5. Register with no display_name is refused (INVALID_INPUT)', async () => {
    const r = await registerGhii({ username: `acctghii${Date.now().toString(36)}` });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body.error?.code}`);
    assert(/display_name/.test(r.body.error?.message ?? ''), `message names display_name: ${r.body.error?.message}`);
});

await test('6. A display_name carrying an @ keeps only the part before it', async () => {
    const bare = `acctghii${Date.now().toString(36)}`;
    const r = await registerGhii({ username: bare, display_name: `Bob@${NODE_ID}`, password: 'AcctDoor1234' });
    assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.ghii.display_name === 'Bob', `display_name stripped at the @: ${r.body.data.ghii.display_name}`);
});

await test('7. A non-string password is refused, and a weak one answers WEAK_PASSWORD', async () => {
    const notAString = await registerGhii({ username: `acctghii${Date.now().toString(36)}`, display_name: 'X', password: 12345678 });
    // The schema types password as z.string().max(256).optional(), so a number never reaches the
    // handler; the `Password must be a string` guard behind it was removed on 2026-09-09.
    assert(notAString.status === 400 && notAString.body.error?.code === 'VALIDATION_ERROR',
        `non-string password: ${notAString.status} ${notAString.body.error?.code}`);
    // The strength gate on the other side of the schema IS reachable, and is the reason the schema
    // deliberately carries no min(8): a short password must come back as WEAK_PASSWORD.
    const weak = await registerGhii({ username: `acctghii${Date.now().toString(36)}`, display_name: 'X', password: 'short' });
    assert(weak.status === 400 && weak.body.error?.code === 'WEAK_PASSWORD',
        `weak password: ${weak.status} ${weak.body.error?.code}`);
});

// ─── Phase 2 — POST /v1/ghii/login validators ───
// The password-lockout path (five wrong guesses, then a refusal while the lock holds) belongs to
// test/e2e-auth-lib.ts and is not repeated here.
console.log('Phase 2 — POST /v1/ghii/login validators');

const loginAccount = `acctlogin${Date.now().toString(36)}`;

await test('8. A password account can be created and signed in', async () => {
    const reg = await registerGhii({ username: loginAccount, display_name: 'Login Account', password: 'AcctDoor1234' });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', {
        method: 'POST', body: JSON.stringify({ username: loginAccount, password: 'AcctDoor1234' }),
    });
    assert(login.status === 200, `login ${login.status}: ${JSON.stringify(login.body.error)}`);
    assert(typeof login.body.data?.token === 'string', 'login mints a token');
});

await test('9. Login with no username, and with no password, is refused', async () => {
    // GhiiLoginSchema requires both as z.string().min(1), so validateBody refuses first and the
    // wire code is VALIDATION_ERROR; the two handler guards behind it were removed on 2026-09-09.
    const noUser = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ password: 'AcctDoor1234' }) });
    assert(noUser.status === 400 && noUser.body.error?.code === 'VALIDATION_ERROR',
        `no username: ${noUser.status} ${noUser.body.error?.code}`);
    const noPass = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: loginAccount }) });
    assert(noPass.status === 400 && noPass.body.error?.code === 'VALIDATION_ERROR',
        `no password: ${noPass.status} ${noPass.body.error?.code}`);
});

await test('10. An account with no password set cannot use the password door (NO_PASSWORD)', async () => {
    // A owns no password: it was created through POST /v1/owners, which stores a key and no hash.
    const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: A.name, password: 'AcctDoor1234' }) });
    assert(r.status === 400 && r.body.error?.code === 'NO_PASSWORD', `expected NO_PASSWORD, got ${r.status} ${r.body.error?.code}`);
});

// ─── Phase 3 — export and import ───
console.log('Phase 3 — export and import');

let exported: any = null;
const importedName = `imported${Date.now().toString(36)}`.slice(0, 30);

await test('11. Export an agent that does not exist → 404 AGENT_NOT_FOUND', async () => {
    const gaii = `nosuch#${A.name}@${NODE_ID}`;
    const r = await json(`/v1/agents/${encodeURIComponent(gaii)}/export`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 404 && r.body.error?.code === 'AGENT_NOT_FOUND', `expected 404 AGENT_NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

await test('12. Another owner cannot export A\'s agent → 403 ACCESS_DENIED', async () => {
    const r = await json(`/v1/agents/${encodeURIComponent(agentA.gaii)}/export`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `expected 403 ACCESS_DENIED, got ${r.status} ${r.body.error?.code}`);
});

await test('13. The agent writes one memory record, so the export carries something', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: auth(agentA.token),
        body: JSON.stringify({ key: 'portability.probe', value: { kept: true }, visibility: 'private' }),
    });
    // 201 and not 200: the write route answers `existing ? 200 : 201`, and this key is new.
    assert(w.status === 201, `memory write ${w.status}: ${JSON.stringify(w.body.error)}`);
});

await test('14. Export returns the whole portability body', async () => {
    const r = await json(`/v1/agents/${encodeURIComponent(agentA.gaii)}/export`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 200, `export ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    exported = d;
    assert(d.portability_version === '1.0', `portability_version: ${d.portability_version}`);
    assert(d.source_node === NODE_ID, `source_node: ${d.source_node}`);
    assert(typeof d.exported_at === 'string', 'exported_at is a timestamp');
    assert(d.agent?.gaii === agentA.gaii, `agent.gaii: ${d.agent?.gaii}`);
    assert(d.agent?.owner === A.name, `agent.owner: ${d.agent?.owner}`);
    assert(typeof d.agent?.public_key === 'string', 'agent.public_key present');
    assert(typeof d.agent?.trust_score === 'number', 'agent.trust_score present');
    assert(Array.isArray(d.agent?.tags), 'agent.tags is an array');
    assert(Array.isArray(d.memory) && d.memory.some((m: any) => m.key === 'portability.probe'),
        `memory carries the written record: ${JSON.stringify(d.memory?.map((m: any) => m.key))}`);
    assert(Array.isArray(d.actions), 'actions is an array');
    assert(typeof d.trust_history?.total_deliveries === 'number', 'trust_history present');
    assert(typeof d.transaction_count === 'number', 'transaction_count present');
});

await test('15. Import with no agent.name/agent.owner → 400 INVALID_INPUT', async () => {
    const r = await json('/v1/agents/import', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ agent: {} }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
});

await test('16. Import naming ANOTHER owner → 403 ACCESS_DENIED', async () => {
    const body = { ...exported, agent: { ...exported.agent, name: importedName, owner: B.name } };
    const r = await json('/v1/agents/import', { method: 'POST', headers: auth(A.token), body: JSON.stringify(body) });
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `expected 403 ACCESS_DENIED, got ${r.status} ${r.body.error?.code}`);
});

await test('17. Import the export back under a fresh name → 201, fresh keys, trust capped at 65', async () => {
    const body = { ...exported, agent: { ...exported.agent, name: importedName, trust_score: 99 } };
    const r = await json('/v1/agents/import', { method: 'POST', headers: auth(A.token), body: JSON.stringify(body) });
    assert(r.status === 201, `import ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    assert(d.agent.gaii === `${importedName}#${A.name}@${NODE_ID}`, `imported gaii: ${d.agent.gaii}`);
    assert(d.agent.trust_score === 65, `an imported trust score is capped at 65, got ${d.agent.trust_score}`);
    assert(d.agent.morsel_balance === 0, `an agent carries no balance of its own, got ${d.agent.morsel_balance}`);
    assert(d.imported.memories >= 1, `memories imported: ${d.imported.memories}`);
    assert(typeof d.imported.actions === 'number', 'actions counted');
    assert(typeof d.private_key === 'string' && d.private_key !== exported.agent.public_key, 'a NEW private key is issued');
    assert(r.headers.get('cache-control') === 'no-store', `the private key must not be cached: ${r.headers.get('cache-control')}`);
});

await test('18. Importing the same name again → 409 NAME_TAKEN', async () => {
    const body = { ...exported, agent: { ...exported.agent, name: importedName } };
    const r = await json('/v1/agents/import', { method: 'POST', headers: auth(A.token), body: JSON.stringify(body) });
    assert(r.status === 409 && r.body.error?.code === 'NAME_TAKEN', `expected 409 NAME_TAKEN, got ${r.status} ${r.body.error?.code}`);
});

// ─── Phase 4 — rekey ───
console.log('Phase 4 — rekey');

await test('19. Rekey refusals: 404 for an unknown agent, 403 for another owner\'s', async () => {
    const missing = `nosuch#${A.name}@${NODE_ID}`;
    const r404 = await json(`/v1/agents/${encodeURIComponent(missing)}/rekey`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r404.status === 404 && r404.body.error?.code === 'AGENT_NOT_FOUND', `expected 404, got ${r404.status} ${r404.body.error?.code}`);
    const r403 = await json(`/v1/agents/${encodeURIComponent(agentA.gaii)}/rekey`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(r403.status === 403 && r403.body.error?.code === 'ACCESS_DENIED', `expected 403, got ${r403.status} ${r403.body.error?.code}`);
});

await test('20. Rekey rotates the key: the OLD private key stops minting a token and the new one mints', async () => {
    const rekeyMe = await setupAgent(A, 'rotateme', ['memory:read']);
    const oldKey = rekeyMe.privateKey;

    const r = await json(`/v1/agents/${encodeURIComponent(rekeyMe.gaii)}/rekey`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 200 && r.body.data.rekeyed === true, `rekey ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.headers.get('cache-control') === 'no-store', `the private key must not be cached: ${r.headers.get('cache-control')}`);
    const newKey = r.body.data.private_key as string;
    assert(typeof newKey === 'string' && newKey !== oldKey, 'the rekey returns a different private key');

    const tsOld = new Date().toISOString();
    const oldMint = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: rekeyMe.gaii, timestamp: tsOld, signature: await signMsg(oldKey, rekeyMe.gaii + tsOld) }),
    });
    assert(oldMint.status === 401, `the old key must no longer mint, got ${oldMint.status}: ${JSON.stringify(oldMint.body)}`);

    const tsNew = new Date().toISOString();
    const newMint = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: rekeyMe.gaii, timestamp: tsNew, signature: await signMsg(newKey, rekeyMe.gaii + tsNew) }),
    });
    assert(newMint.status === 200 && typeof newMint.body.data?.token === 'string',
        `the new key must mint, got ${newMint.status}: ${JSON.stringify(newMint.body.error)}`);
});

// ─── Phase 5 — port ───
//
// The porting fee is debited with storage.debitBalance(gaii), which resolves ANY principal to its
// owner's GHII (a morsel is the human's pace, not the agent's), so the fee comes out of the owner's
// welcome bonus and the 200 arm needs no operator mint at all. Porting until the bonus runs out is
// what reaches the 402 on the other side of it.
console.log('Phase 5 — port');

await test('21. Port refusals: 404, 403, and 400 with no target_node_url', async () => {
    const missing = `nosuch#${P.name}@${NODE_ID}`;
    const r404 = await json(`/v1/agents/${encodeURIComponent(missing)}/port`, { method: 'POST', headers: auth(P.token), body: JSON.stringify({ target_node_url: 'https://other.example' }) });
    assert(r404.status === 404 && r404.body.error?.code === 'AGENT_NOT_FOUND', `expected 404, got ${r404.status} ${r404.body.error?.code}`);
    const r403 = await json(`/v1/agents/${encodeURIComponent(agentA.gaii)}/port`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ target_node_url: 'https://other.example' }) });
    assert(r403.status === 403 && r403.body.error?.code === 'ACCESS_DENIED', `expected 403, got ${r403.status} ${r403.body.error?.code}`);
    const porter = await setupAgent(P, 'porter', ['memory:read']);
    const r400 = await json(`/v1/agents/${encodeURIComponent(porter.gaii)}/port`, { method: 'POST', headers: auth(P.token), body: '{}' });
    assert(r400.status === 400 && r400.body.error?.code === 'INVALID_INPUT', `expected 400, got ${r400.status} ${r400.body.error?.code}`);
});

await test('22. Porting succeeds while the balance holds, then answers 402 INSUFFICIENT_MORSELS', async () => {
    const porter = await setupAgent(P, 'porter2', ['memory:read']);
    const url = `/v1/agents/${encodeURIComponent(porter.gaii)}/port`;
    const call = () => json(url, { method: 'POST', headers: auth(P.token), body: JSON.stringify({ target_node_url: 'https://other.example', target_node_id: 'other-node-001' }) });

    const first = await call();
    assert(first.status === 200, `the first port must succeed, got ${first.status}: ${JSON.stringify(first.body.error)}`);
    assert(first.body.data.ported === true && first.body.data.target_node_url === 'https://other.example', `port body: ${JSON.stringify(first.body.data)}`);
    const fee = first.body.data.porting_fee as number;
    assert(typeof fee === 'number' && fee > 0, `porting_fee is a positive number: ${fee}`);

    // Drain what the welcome bonus left. Bounded so a fee of 0 could never spin here.
    let last = first;
    let calls = 1;
    while (last.status === 200 && calls < 20) { last = await call(); calls++; }
    assert(last.status === 402, `after the balance runs out the port must answer 402, got ${last.status} after ${calls} calls`);
    assert(last.body.error?.code === 'INSUFFICIENT_MORSELS', `expected INSUFFICIENT_MORSELS, got ${last.body.error?.code}`);
});

// ─── Phase 6 — scopes and federate ───
console.log('Phase 6 — scopes and federate');

await test('23. PATCH scopes refuses a non-array, an empty array and a non-string member', async () => {
    const url = `/v1/agents/${agentA.name}/scopes`;
    const notArray = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: 'memory:read' }) });
    assert(notArray.status === 400 && notArray.body.error?.code === 'INVALID_INPUT', `not an array: ${notArray.status} ${notArray.body.error?.code}`);
    const empty = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: [] }) });
    assert(empty.status === 400 && empty.body.error?.code === 'INVALID_INPUT', `empty array: ${empty.status} ${empty.body.error?.code}`);
    const notStrings = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read', 7] }) });
    assert(notStrings.status === 400 && notStrings.body.error?.code === 'INVALID_INPUT', `non-string member: ${notStrings.status} ${notStrings.body.error?.code}`);
    assert(/must be a string/i.test(notStrings.body.error?.message ?? ''), `message names the string rule: ${notStrings.body.error?.message}`);
});

await test('24. PATCH scopes: an unknown name is 404, and ANOTHER owner\'s agent is 404 too', async () => {
    const unknown = await json(`/v1/agents/nosuchagent/scopes`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read'] }) });
    assert(unknown.status === 404 && unknown.body.error?.code === 'NOT_FOUND', `unknown name: ${unknown.status} ${unknown.body.error?.code}`);
    // The lookup is getAgentsByOwner(caller), so another owner's agent is simply absent and the
    // 404 is the refusal. The 403 that used to sit behind it could not fire and was removed on
    // 2026-09-09, on this door and on federate, delete and cors alike.
    const crossOwner = await json(`/v1/agents/${agentA.name}/scopes`, { method: 'PATCH', headers: auth(B.token), body: JSON.stringify({ scopes: ['memory:read'] }) });
    assert(crossOwner.status === 404, `another owner's agent is refused (as a 404), got ${crossOwner.status}`);
});

await test('25. PATCH scopes stores the new list and points at a re-mint', async () => {
    const r = await json(`/v1/agents/${agentA.name}/scopes`, {
        method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read', 'catalogue:read'] }),
    });
    assert(r.status === 200, `patch ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(JSON.stringify(r.body.data.scopes) === JSON.stringify(['memory:read', 'catalogue:read']), `scopes stored: ${JSON.stringify(r.body.data.scopes)}`);
    const list = await json('/v1/agents', { headers: auth(A.token) });
    const row = (list.body.data.agents || []).find((a: any) => a.gaii === agentA.gaii);
    assert(JSON.stringify(row?.default_scopes) === JSON.stringify(['memory:read', 'catalogue:read']), `the listing agrees: ${JSON.stringify(row?.default_scopes)}`);
});

await test('26. PATCH federate: non-boolean 400, unknown name 404, another owner\'s 404, and the write', async () => {
    const url = `/v1/agents/${agentA.name}/federate`;
    const notBool = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ federate: 'yes' }) });
    assert(notBool.status === 400 && notBool.body.error?.code === 'INVALID_INPUT', `non-boolean: ${notBool.status} ${notBool.body.error?.code}`);
    assert(/boolean/i.test(notBool.body.error?.message ?? ''), `message names the boolean rule: ${notBool.body.error?.message}`);
    const unknown = await json('/v1/agents/nosuchagent/federate', { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ federate: true }) });
    assert(unknown.status === 404 && unknown.body.error?.code === 'NOT_FOUND', `unknown name: ${unknown.status} ${unknown.body.error?.code}`);
    // Same owner-scoped lookup as test 24: the 404 is the refusal.
    const crossOwner = await json(url, { method: 'PATCH', headers: auth(B.token), body: JSON.stringify({ federate: true }) });
    assert(crossOwner.status === 404, `another owner's agent is refused (as a 404), got ${crossOwner.status}`);
    const ok = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ federate: true }) });
    assert(ok.status === 200 && ok.body.data.federate === true, `federate on: ${ok.status} ${JSON.stringify(ok.body.data)}`);
    const off = await json(url, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ federate: false }) });
    assert(off.status === 200 && off.body.data.federate === false, `federate off: ${off.status} ${JSON.stringify(off.body.data)}`);
});

// ─── Phase 7 — delete ───
console.log('Phase 7 — delete');

await test('27. DELETE: another owner\'s agent is refused, and an unknown name is 404', async () => {
    // FINDING (pinned, not a hole): management.ts:449-452 answers 403 for an agent whose owner is
    // not the caller's, and cannot fire for the same reason as tests 24 and 26 — getAgentsByOwner
    // has already fenced the lookup, so the cross-owner call falls out as a 404.
    const cross = await json(`/v1/agents/${agentA.name}`, { method: 'DELETE', headers: auth(B.token) });
    assert(cross.status === 404, `another owner's agent is refused (as a 404), got ${cross.status}`);
    const unknown = await json('/v1/agents/nosuchagent', { method: 'DELETE', headers: auth(A.token) });
    assert(unknown.status === 404 && unknown.body.error?.code === 'NOT_FOUND', `unknown name: ${unknown.status} ${unknown.body.error?.code}`);
});

// An agent of its own for this phase. agentA's scopes were rewritten in test 25 and no longer carry
// `agent:delete`, so driving the delete door with it would be refused by requireRoleOrScope at the
// door and never reach the rules being measured here — which is a green test proving nothing.
let deleter: Awaited<ReturnType<typeof setupAgent>>;

await test('28. An agent holding agent:delete may not delete ITSELF (403)', async () => {
    deleter = await setupAgent(A, 'deleter', ['memory:read', 'agent:delete']);
    // The scope gets it through requireRoleOrScope; what refuses it is inside the handler, and the
    // message is how this test knows which of the two refused.
    //
    // `registeredBy` is written once, at creation, and holds the owner's name or the approving
    // sibling's GAII, never the agent's own, so the registeredBy rule is what refuses a self-delete.
    // The dedicated `An agent cannot delete itself` guard behind it could not fire and was removed
    // on 2026-09-09. What this asserts is the refusal and that it came from inside the handler.
    const r = await json(`/v1/agents/${deleter.name}`, { method: 'DELETE', headers: auth(deleter.token) });
    assert(r.status === 403, `an agent deleting itself must be refused, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);
    assert(/registered/i.test(r.body.error?.message ?? ''),
        `the refusal must come from the handler, not the door: ${r.body.error?.message}`);
    const still = await json(`/v1/agents/${encodeURIComponent(deleter.gaii)}`);
    assert(still.status === 200, `the agent must survive its own delete attempt, got ${still.status}`);
});

await test('29. An agent may not delete a SIBLING it did not register (403)', async () => {
    const sibling = await setupAgent(A, 'sibling', ['memory:read']);
    const r = await json(`/v1/agents/${sibling.name}`, { method: 'DELETE', headers: auth(deleter.token) });
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `expected 403 ACCESS_DENIED, got ${r.status} ${r.body.error?.code}`);
    assert(/registered/i.test(r.body.error?.message ?? ''), `message names registration: ${r.body.error?.message}`);
    const still = await json(`/v1/agents/${encodeURIComponent(sibling.gaii)}`);
    assert(still.status === 200, `the sibling must survive, got ${still.status}`);

    // …and an agent without the scope at all never gets past the door, which is the other half of
    // "neither condition is sufficient by itself".
    const scopeless = await setupAgent(A, 'scopeless', ['memory:read']);
    const atDoor = await json(`/v1/agents/${sibling.name}`, { method: 'DELETE', headers: auth(scopeless.token) });
    assert(atDoor.status === 403, `no agent:delete must be 403, got ${atDoor.status}`);
    assert(/agent:delete/.test(atDoor.body.error?.message ?? ''), `the door names the scope it wanted: ${atDoor.body.error?.message}`);
});

await test('30. The OWNER deletes an agent: the record goes and its sessions are ended', async () => {
    const doomed = await setupAgent(A, 'doomed', ['memory:read']);
    const r = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.deleted === true, `delete ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.gaii === doomed.gaii, `deleted gaii: ${r.body.data.gaii}`);
    assert(typeof r.body.data.sessions_revoked === 'number' && r.body.data.sessions_revoked >= 1,
        `the response says how many credentials it ended: ${r.body.data.sessions_revoked}`);
    const gone = await json(`/v1/agents/${encodeURIComponent(doomed.gaii)}`);
    assert(gone.status === 404, `the record is gone, got ${gone.status}`);
    const withOldToken = await json('/v1/memory', { headers: auth(doomed.token) });
    assert(withOldToken.status === 401, `the deleted agent's token must be refused, got ${withOldToken.status}`);
});

// ─── Phase 8 — per-agent CORS ───
console.log('Phase 8 — per-agent CORS');

await test('31. GET cors: unknown name 404, another owner\'s 404', async () => {
    const unknown = await json('/v1/agents/nosuchagent/cors', { headers: auth(A.token) });
    assert(unknown.status === 404 && unknown.body.error?.code === 'NOT_FOUND', `unknown name: ${unknown.status} ${unknown.body.error?.code}`);
    const cross = await json(`/v1/agents/${agentA.name}/cors`, { headers: auth(B.token) });
    assert(cross.status === 404, `another owner's agent is refused (as a 404), got ${cross.status}`);
});

await test('32. GET cors with nothing set inherits the NODE default', async () => {
    const r = await json(`/v1/agents/${agentA.name}/cors`, { headers: auth(A.token) });
    assert(r.status === 200, `cors ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.allowed_origins === null, `no per-agent list yet: ${JSON.stringify(r.body.data.allowed_origins)}`);
    assert(r.body.data.inherited_from === 'node', `inherited_from: ${r.body.data.inherited_from}`);
    assert(Array.isArray(r.body.data.effective), 'effective is an array');
});

await test('33. With the GHII carrying origins, the agent inherits from the GHII', async () => {
    const set = await json('/v1/ghii/cors', {
        method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: ['https://ghii.example'] }),
    });
    assert(set.status === 200, `ghii cors ${set.status}: ${JSON.stringify(set.body.error)}`);
    const r = await json(`/v1/agents/${agentA.name}/cors`, { headers: auth(A.token) });
    assert(r.status === 200, `cors ${r.status}`);
    assert(r.body.data.inherited_from === 'ghii', `inherited_from: ${r.body.data.inherited_from}`);
    assert(JSON.stringify(r.body.data.effective) === JSON.stringify(['https://ghii.example']), `effective: ${JSON.stringify(r.body.data.effective)}`);
});

await test('34. PUT cors refuses a non-array and a non-URL origin', async () => {
    const url = `/v1/agents/${agentA.name}/cors`;
    const notArray = await json(url, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: 'https://x.example' }) });
    assert(notArray.status === 400 && notArray.body.error?.code === 'INVALID_INPUT', `non-array: ${notArray.status} ${notArray.body.error?.code}`);
    const badOrigin = await json(url, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: ['ftp://x.example'] }) });
    assert(badOrigin.status === 400 && badOrigin.body.error?.code === 'INVALID_INPUT', `bad origin: ${badOrigin.status} ${badOrigin.body.error?.code}`);
    assert(/Invalid origin/.test(badOrigin.body.error?.message ?? ''), `message names the origin: ${badOrigin.body.error?.message}`);
    const notString = await json(url, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: [42] }) });
    assert(notString.status === 400 && notString.body.error?.code === 'INVALID_INPUT', `non-string origin: ${notString.status} ${notString.body.error?.code}`);
    // Nothing partial landed: the agent still inherits.
    const after = await json(url, { headers: auth(A.token) });
    assert(after.body.data.allowed_origins === null, `a refused PUT must not have written: ${JSON.stringify(after.body.data.allowed_origins)}`);
});

await test('35. PUT cors writes an explicit list, and null puts the agent back to inheriting', async () => {
    const url = `/v1/agents/${agentA.name}/cors`;
    const set = await json(url, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: ['https://agent.example', '*'] }) });
    assert(set.status === 200, `put ${set.status}: ${JSON.stringify(set.body.error)}`);
    const read = await json(url, { headers: auth(A.token) });
    assert(JSON.stringify(read.body.data.allowed_origins) === JSON.stringify(['https://agent.example', '*']), `stored: ${JSON.stringify(read.body.data.allowed_origins)}`);
    assert(read.body.data.inherited_from === 'none', `inherited_from: ${read.body.data.inherited_from}`);
    const clear = await json(url, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: null }) });
    assert(clear.status === 200 && clear.body.data.allowed_origins === null, `clear ${clear.status}: ${JSON.stringify(clear.body.data)}`);
    const back = await json(url, { headers: auth(A.token) });
    assert(back.body.data.inherited_from === 'ghii', `back to inheriting: ${back.body.data.inherited_from}`);
});

await test('36. PUT cors: unknown name 404, another owner\'s 404', async () => {
    const unknown = await json('/v1/agents/nosuchagent/cors', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ allowed_origins: null }) });
    assert(unknown.status === 404 && unknown.body.error?.code === 'NOT_FOUND', `unknown name: ${unknown.status} ${unknown.body.error?.code}`);
    // Same owner-scoped lookup as test 24: the 404 is the refusal.
    const cross = await json(`/v1/agents/${agentA.name}/cors`, { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ allowed_origins: null }) });
    assert(cross.status === 404, `another owner's agent is refused (as a 404), got ${cross.status}`);
});

// ─── Phase 9 — POST /v1/agents refusals, platform detection, the consent page ───
console.log('Phase 9 — the owner-authed registration door');

await test('37. Register an agent with an unknown mode → 400', async () => {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'modeprobe', owner: A.name, mode: 'sideways' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    // AgentRegistrationSchema types mode as a z.enum of the five modes, so validateBody answers
    // VALIDATION_ERROR and names the field; the handler's own refusal behind it could not fire
    // and was removed on 2026-09-09.
    assert(r.body.error?.code === 'VALIDATION_ERROR', `mode refusal code: ${r.body.error?.code}`);
    assert(JSON.stringify(r.body.error?.details ?? []).includes('mode'), `the refusal names the field: ${JSON.stringify(r.body.error?.details)}`);
});

await test('38. Register an agent under ANOTHER owner → 403 ACCESS_DENIED', async () => {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'notmine', owner: B.name }),
    });
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `expected 403 ACCESS_DENIED, got ${r.status} ${r.body.error?.code}`);
});

await test('39. Register an agent under a RESERVED name → 400 INVALID_INPUT', async () => {
    // 'registry' passes the schema's grammar and is refused by validateAgentName, which is the only
    // way to reach the handler's own name check.
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'registry', owner: A.name }),
    });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
    assert(/reserved/i.test(r.body.error?.message ?? ''), `message names the reservation: ${r.body.error?.message}`);
});

await test('40. Registering the same agent name twice → 409 NAME_TAKEN', async () => {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: agentA.name, owner: A.name }),
    });
    assert(r.status === 409 && r.body.error?.code === 'NAME_TAKEN', `expected 409 NAME_TAKEN, got ${r.status} ${r.body.error?.code}`);
});

await test('41. A recognisable User-Agent is recorded as the agent\'s platform', async () => {
    const r = await json('/v1/agents', {
        method: 'POST',
        headers: { ...auth(A.token), 'User-Agent': 'claude-code/1.2.3 (test)' },
        body: JSON.stringify({ name: 'uaprobe', owner: A.name }),
    });
    assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body.error)}`);
    const gaii = r.body.data.agent.gaii as string;
    const list = await json('/v1/agents', { headers: auth(A.token) });
    const row = (list.body.data.agents || []).find((a: any) => a.gaii === gaii);
    assert(row?.platform === 'claude-code', `platform detected: ${row?.platform}`);
    assert(row?.platform_version === '1.2.3', `platform version detected: ${row?.platform_version}`);
});

await test('42. An unrecognised User-Agent leaves the platform unset', async () => {
    const r = await json('/v1/agents', {
        method: 'POST',
        headers: { ...auth(A.token), 'User-Agent': 'curl/8.4.0' },
        body: JSON.stringify({ name: 'uaprobe2', owner: A.name }),
    });
    assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body.error)}`);
    const gaii = r.body.data.agent.gaii as string;
    const list = await json('/v1/agents', { headers: auth(A.token) });
    const row = (list.body.data.agents || []).find((a: any) => a.gaii === gaii);
    assert(row?.platform === null, `platform must stay unset, got ${row?.platform}`);
});

await test('43. GET /v1/agents/verify serves the consent page as HTML', async () => {
    const res = await fetch(`${BASE}/v1/agents/verify`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `expected text/html, got "${ct}"`);
    const html = await res.text();
    assert(/<html/i.test(html), 'the body is an HTML document');
    assert(html.length > 200, `the page has content, got ${html.length} bytes`);
});

// ─── Phase 10 — POST /v1/agents/connect (connectivity key) ───
console.log('Phase 10 — the connectivity-key door');

/** Mint a connectivity key as `owner`. `agentName` may be null so the body must supply one. */
async function mintKey(owner: Owner, agentName: string | null): Promise<string> {
    const r = await json('/v1/auth/connectivity-key', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify(agentName ? { agent_name: agentName, description: 'connect probe' } : {}),
    });
    assert(r.status === 201, `connectivity-key ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.connectivity_key as string;
}

await test('44. Connect with no connectivity_key → 400 INVALID_INPUT', async () => {
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ agent_name: 'x' }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
});

await test('45. Connect with a key that was never minted → 404 INVALID_KEY', async () => {
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: 'otk-no-such-key-at-all', agent_name: 'x' }) });
    assert(r.status === 404 && r.body.error?.code === 'INVALID_KEY', `expected 404 INVALID_KEY, got ${r.status} ${r.body.error?.code}`);
});

await test('46. Connect with a key that names no agent, and a body that names none either → 400', async () => {
    const key = await mintKey(A, null);
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: key }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
    assert(/agent_name/.test(r.body.error?.message ?? ''), `message names agent_name: ${r.body.error?.message}`);
});

await test('47. Connect with a name the grammar refuses → 400 INVALID_INPUT', async () => {
    const key = await mintKey(A, null);
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: key, agent_name: 'registry' }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
    assert(/reserved/i.test(r.body.error?.message ?? ''), `message names the reservation: ${r.body.error?.message}`);
});

await test('48. Connect naming an agent that already exists → 409 NAME_TAKEN', async () => {
    const key = await mintKey(A, null);
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: key, agent_name: agentA.name }) });
    assert(r.status === 409 && r.body.error?.code === 'NAME_TAKEN', `expected 409 NAME_TAKEN, got ${r.status} ${r.body.error?.code}`);
});

await test('49. Connect on a key whose owner has since been erased → 404 NOT_FOUND', async () => {
    const key = await mintKey(D, 'orphaned');
    const erase = await json(`/v1/owners/${D.name}`, { method: 'DELETE', headers: auth(D.token) });
    assert(erase.status === 200 && erase.body.data.deleted === true, `erase owner ${erase.status}: ${JSON.stringify(erase.body.error)}`);
    // The key survives the erasure (no OTK step in services/owner-erasure.ts), so the door reaches
    // its owner lookup and refuses there.
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: key }) });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'NOT_FOUND', `expected NOT_FOUND, got ${r.body.error?.code}`);
    assert(/not found/i.test(r.body.error?.message ?? ''), `message names the missing owner: ${r.body.error?.message}`);
});

await test('50. Connect with a valid key and a recognisable User-Agent → 201, keys, scopes, platform', async () => {
    const key = await mintKey(A, 'connected');
    const r = await json('/v1/agents/connect', {
        method: 'POST',
        headers: { 'User-Agent': 'codex/9.9.9' },
        body: JSON.stringify({ connectivity_key: key, display_name: 'Connected Agent' }),
    });
    assert(r.status === 201, `connect ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    assert(d.agent.gaii === `connected#${A.name}@${NODE_ID}`, `gaii: ${d.agent.gaii}`);
    assert(d.agent.display_name === 'Connected Agent', `display_name: ${d.agent.display_name}`);
    assert(d.agent.description === 'connect probe', `the key's description is carried onto the agent: ${d.agent.description}`);
    assert(Array.isArray(d.agent.scopes) && d.agent.scopes.length > 0, `default scopes granted: ${JSON.stringify(d.agent.scopes)}`);
    assert(typeof d.private_key === 'string' && typeof d.public_key === 'string', 'a keypair is issued');
    assert(r.headers.get('cache-control') === 'no-store', `the private key must not be cached: ${r.headers.get('cache-control')}`);

    const list = await json('/v1/agents', { headers: auth(A.token) });
    const row = (list.body.data.agents || []).find((a: any) => a.gaii === d.agent.gaii);
    assert(row?.platform === 'codex', `platform detected on the connect path too: ${row?.platform}`);
    assert(row?.platform_version === '9.9.9', `platform version: ${row?.platform_version}`);
});

await test('51. The minted key mints an agent token that works', async () => {
    const key = await mintKey(A, 'connected2');
    const r = await json('/v1/agents/connect', { method: 'POST', body: JSON.stringify({ connectivity_key: key }) });
    assert(r.status === 201, `connect ${r.status}: ${JSON.stringify(r.body.error)}`);
    const gaii = r.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(r.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200 && typeof tok.body.data?.token === 'string', `token ${tok.status}: ${JSON.stringify(tok.body.error)}`);
});

// ─── Phase 11 — the doors with no credential, and with the wrong one ───
console.log('Phase 11 — 401 and 403');

await test('52. Every management door refuses an unauthenticated caller with 401', async () => {
    const g = encodeURIComponent(agentA.gaii);
    const calls: Array<[string, RequestInit]> = [
        [`/v1/agents/${g}/export`, { method: 'POST', body: '{}' }],
        ['/v1/agents/import', { method: 'POST', body: '{}' }],
        [`/v1/agents/${g}/rekey`, { method: 'POST', body: '{}' }],
        [`/v1/agents/${g}/port`, { method: 'POST', body: JSON.stringify({ target_node_url: 'https://x.example' }) }],
        [`/v1/agents/${agentA.name}/scopes`, { method: 'PATCH', body: JSON.stringify({ scopes: ['memory:read'] }) }],
        [`/v1/agents/${agentA.name}/federate`, { method: 'PATCH', body: JSON.stringify({ federate: true }) }],
        [`/v1/agents/${agentA.name}`, { method: 'DELETE' }],
        [`/v1/agents/${agentA.name}/cors`, {}],
        [`/v1/agents/${agentA.name}/cors`, { method: 'PUT', body: JSON.stringify({ allowed_origins: null }) }],
        ['/v1/agents', { method: 'POST', body: JSON.stringify({ name: 'anon', owner: A.name }) }],
        ['/v1/agents/device-authorize/pending', {}],
        ['/v1/auth/connectivity-key', { method: 'POST', body: '{}' }],
    ];
    for (const [path, opts] of calls) {
        const r = await json(path, opts);
        assert(r.status === 401, `${opts.method ?? 'GET'} ${path} must be 401, got ${r.status}`);
    }
});

await test('53. An AGENT token is refused on the owner-only doors with 403', async () => {
    const g = encodeURIComponent(agentA.gaii);
    const h = auth(agentA.token);
    const calls: Array<[string, RequestInit]> = [
        [`/v1/agents/${g}/export`, { method: 'POST', headers: h, body: '{}' }],
        ['/v1/agents/import', { method: 'POST', headers: h, body: '{}' }],
        [`/v1/agents/${g}/rekey`, { method: 'POST', headers: h, body: '{}' }],
        [`/v1/agents/${g}/port`, { method: 'POST', headers: h, body: JSON.stringify({ target_node_url: 'https://x.example' }) }],
        [`/v1/agents/${agentA.name}/scopes`, { method: 'PATCH', headers: h, body: JSON.stringify({ scopes: ['memory:read'] }) }],
        [`/v1/agents/${agentA.name}/federate`, { method: 'PATCH', headers: h, body: JSON.stringify({ federate: true }) }],
        [`/v1/agents/${agentA.name}/cors`, { headers: h }],
        [`/v1/agents/${agentA.name}/cors`, { method: 'PUT', headers: h, body: JSON.stringify({ allowed_origins: null }) }],
        ['/v1/agents', { method: 'POST', headers: h, body: JSON.stringify({ name: 'byagent', owner: A.name }) }],
        ['/v1/agents/device-authorize/pending', { headers: h }],
        ['/v1/auth/connectivity-key', { method: 'POST', headers: h, body: '{}' }],
    ];
    for (const [path, opts] of calls) {
        const r = await json(path, opts);
        assert(r.status === 403, `${opts.method ?? 'GET'} ${path} must be 403 for an agent, got ${r.status}`);
    }
});

await test('54. The operator sees nothing of A\'s agents through another owner\'s name', async () => {
    // requireRole('owner') admits an operator, and the doors then read getAgentsByOwner(caller):
    // the operator role is not a way into somebody else's fleet through these names.
    const r = await json(`/v1/agents/${agentA.name}/cors`, { headers: auth(OP.token) });
    assert(r.status === 404, `the operator's own fleet has no such agent, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
