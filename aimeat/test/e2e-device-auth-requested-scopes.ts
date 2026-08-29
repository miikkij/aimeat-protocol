/**
 * @file e2e-device-auth-requested-scopes.ts
 * @description What the agent ASKED FOR must survive as far as the person approving it.
 *
 *   POST /v1/agents/device-authorize takes a `scopes` list. Until 2026-08-29 exactly one branch read
 *   it — same-owner auto-approval — and nothing wrote it down, so on the ordinary path (the owner
 *   approves in a browser) the request stopped existing the moment the handler returned. The
 *   consent card therefore had nothing to show, and an approval that named no scopes fell back to
 *   the node default: an agent that asked for task:read + task:write was connected holding
 *   catalogue:read + memory:read/write/delete. It could not take work at all, it looked perfectly
 *   connected, and no error was raised anywhere.
 *
 *   Four claims, and they are separate. The request is KEPT and shown on the owner's own listing.
 *   An approval naming nothing grants it. An approval naming its own set still wins, narrowing
 *   included. And the two boundaries that were already right stay right: the unauthenticated
 *   consent-info endpoint discloses no scopes, and re-approving an EXISTING agent with no scopes
 *   leaves its grant exactly as it was, however loudly the new request asks for something else.
 *
 *   Storage AND the credential, on every claim. Asserting the agent record alone is how a real bug
 *   shipped once: re-approval wrote the corrected scopes and minted a token from a different list.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=device-auth-requested-scopes
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial, with the fix.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `req${Date.now() % 100000}`;
const stranger = `str${Date.now() % 100000}`;

/**
 * What the node hands out when nobody names anything. Read from the environment rather than
 * hard-coded: run-e2e-server.ts pins AIMEAT_DEFAULT_AGENT_SCOPES to '*' so unrelated suites are not
 * measuring the scope fence, while config.ts ships four memory/catalogue scopes. The assertion is
 * "the fallback is the node default", whichever list that is here.
 */
const NODE_DEFAULT = (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? '*').split(',').map(s => s.trim());
/** What a task runner actually needs, and what the hatchery was asking for when this was found. */
const WANTED = ['task:read', 'task:write', 'memory:read', 'memory:write'];

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

const sorted = (xs: string[] | undefined | null) => [...(xs ?? [])].sort().join(' ');

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

/** Register an owner and return its token. */
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ name, owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

let ownerToken = '';
let strangerToken = '';

/**
 * One authorize round, UNAUTHENTICATED — the ordinary path, where the owner approves in a browser.
 * An authenticated call would take the same-owner auto-approval branch and prove nothing here.
 */
const deviceCodes = new Map<string, string>();
async function authorize(agentName: string, scopes?: string[]): Promise<string> {
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST',
        body: JSON.stringify({ agent_name: agentName, owner, mode: 'task-runner', ...(scopes ? { scopes } : {}) }),
    });
    assert(r.status === 200 && r.body.ok === true, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    deviceCodes.set(agentName, r.body.data.device_code as string);
    return r.body.data.user_code as string;
}

/** Approve exactly as a consent surface does. `scopes` omitted = "the owner chose nothing". */
async function approve(userCode: string, scopes?: string[]) {
    return json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({
            user_code: userCode, action: 'approve', owner_token: ownerToken,
            ...(scopes ? { scopes } : {}),
        }),
    });
}

/**
 * The scopes on the CREDENTIAL this approval issued, read out of the JWT the agent polls for.
 * Cached per device code: the poll enforces RFC 8628's `slow_down` interval, so asking twice for
 * the same credential measures the rate limiter instead of the grant.
 */
const polled = new Map<string, string[]>();
async function issuedScopes(agentName: string): Promise<string[]> {
    const deviceCode = deviceCodes.get(agentName)!;
    const cached = polled.get(deviceCode);
    if (cached) return cached;
    const r = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    assert(r.status === 200, `device-token ${r.status}: ${JSON.stringify(r.body)}`);
    const token = (r.body.access_token ?? r.body.token) as string;
    assert(typeof token === 'string' && token.split('.').length === 3, `no JWT in the poll response: ${JSON.stringify(r.body)}`);
    const scopes = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).scopes ?? []) as string[];
    polled.set(deviceCode, scopes);
    return scopes;
}

/** What the agent record says it may do — the owner's intent, a different claim from the token. */
async function storedScopes(agentName: string): Promise<string[]> {
    const r = await json('/v1/agents', auth(ownerToken));
    assert(r.status === 200, `list agents ${r.status}: ${JSON.stringify(r.body.error)}`);
    const a = (r.body.data.agents as any[]).find(x => x.name === agentName);
    assert(!!a, `agent ${agentName} not in the listing`);
    return (a.default_scopes ?? []) as string[];
}

async function pendingRow(userCode: string, token = ownerToken) {
    const r = await json('/v1/agents/device-authorize/pending', auth(token));
    assert(r.status === 200, `pending ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.requests as any[]).find(x => x.user_code === userCode) ?? null;
}

console.log('\n=== Device-auth requested scopes E2E Tests ===\n');

await test('Register the owner and an unrelated second owner', async () => {
    ownerToken = await registerOwner(owner);
    strangerToken = await registerOwner(stranger);
});

console.log('\nPhase 1: the request reaches the person who decides');

let code1 = '';
await test('The owner\'s pending listing carries what the agent asked for', async () => {
    code1 = await authorize('probe-runner', WANTED);
    const row = await pendingRow(code1);
    assert(!!row, 'the request is not in the owner\'s pending listing');
    assert(sorted(row.requested_scopes) === sorted(WANTED),
        `requested_scopes: ${JSON.stringify(row.requested_scopes)}`);
    assert(row.existing_agent === false, 'a first approval must not be reported as a return');
    assert(row.current_scopes === null, 'an agent that does not exist yet holds nothing');
});

await test('A DIFFERENT owner cannot see the request at all', async () => {
    const row = await pendingRow(code1, strangerToken);
    assert(row === null, 'another owner\'s pending listing carried this request');
});

await test('An unauthenticated caller cannot read the pending listing', async () => {
    const r = await json('/v1/agents/device-authorize/pending');
    assert(r.status === 401, `the listing carries requested scopes and needs a session: ${r.status}`);
});

await test('A DIFFERENT owner cannot approve the request', async () => {
    // The whole point of keeping the request is that an approval can grant it. So the door that
    // grants it has to refuse anyone but the owner it names, or the request becomes a way to ask a
    // stranger for scopes in someone else's account.
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: code1, action: 'approve', owner_token: strangerToken, scopes: ['*'] }),
    });
    assert(r.status === 403, `approving another owner's request: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('The unauthenticated consent-info endpoint still discloses no scopes', async () => {
    const info = await json(`/v1/agents/verify/info/${code1}`);
    assert(info.status === 200, `verify/info ${info.status}`);
    const keys = Object.keys(info.body.data);
    assert(!keys.some(k => k.includes('scope')),
        `this endpoint is unauthenticated — it must not disclose scopes: ${JSON.stringify(keys)}`);
});

console.log('\nPhase 2: an approval that names nothing');

await test('A NEW agent is granted what it asked for, not the node default', async () => {
    const r = await approve(code1);
    assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const stored = await storedScopes('probe-runner');
    const issued = await issuedScopes('probe-runner');
    assert(sorted(stored) === sorted(WANTED), `stored: ${JSON.stringify(stored)}`);
    assert(sorted(issued) === sorted(WANTED), `issued: ${JSON.stringify(issued)}`);
});

await test('It can therefore take work: task:read and task:write are on the credential', async () => {
    const granted = await issuedScopes('probe-runner');
    assert(granted.includes('task:read') && granted.includes('task:write'),
        `the whole point of the request, missing: ${JSON.stringify(granted)}`);
    assert(!granted.includes('memory:delete'),
        `granted a scope nobody asked for: ${JSON.stringify(granted)}`);
});

await test('An agent that asks for NOTHING still gets the node default', async () => {
    const code = await authorize('probe-silent');
    const row = await pendingRow(code);
    assert(row.requested_scopes === null, `asked for nothing, listed as: ${JSON.stringify(row.requested_scopes)}`);
    const r = await approve(code);
    assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const stored = await storedScopes('probe-silent');
    const issued = await issuedScopes('probe-silent');
    assert(sorted(stored) === sorted(NODE_DEFAULT), `stored: ${JSON.stringify(stored)}`);
    assert(sorted(issued) === sorted(NODE_DEFAULT), `issued: ${JSON.stringify(issued)}`);
});

console.log('\nPhase 3: the owner still decides');

await test('An explicit approval overrides the request, narrowing included', async () => {
    const code = await authorize('probe-narrowed', WANTED);
    const r = await approve(code, ['memory:read']);
    assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const stored = await storedScopes('probe-narrowed');
    const issued = await issuedScopes('probe-narrowed');
    assert(sorted(stored) === 'memory:read', `stored: ${JSON.stringify(stored)}`);
    assert(sorted(issued) === 'memory:read', `issued: ${JSON.stringify(issued)}`);
});

await test('A request does NOT rewrite the grant of an agent coming back', async () => {
    // probe-narrowed holds memory:read. It returns asking for everything it wanted the first time;
    // the owner approves without choosing. Silence is not a request to re-grant: the agent keeps
    // what the owner decided. This is the 2026-08-08 rule, and the fix must not have moved it.
    const code = await authorize('probe-narrowed', WANTED);
    const row = await pendingRow(code);
    assert(row.existing_agent === true, 'a return must be reported as a return');
    assert(sorted(row.requested_scopes) === sorted(WANTED), 'the return\'s request is listed too');
    assert(sorted(row.current_scopes) === 'memory:read', 'the card must be able to show what it holds');

    const r = await approve(code);
    assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const stored = await storedScopes('probe-narrowed');
    const issued = await issuedScopes('probe-narrowed');
    assert(sorted(stored) === 'memory:read', `stored: ${JSON.stringify(stored)}`);
    assert(sorted(issued) === 'memory:read', `issued: ${JSON.stringify(issued)}`);
});

await test('Junk in the requested list is dropped, not stored', async () => {
    const code = await authorize('probe-junk', ['task:read', 42 as unknown as string, null as unknown as string]);
    const row = await pendingRow(code);
    assert(sorted(row.requested_scopes) === 'task:read',
        `only real scope tokens are kept: ${JSON.stringify(row.requested_scopes)}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
