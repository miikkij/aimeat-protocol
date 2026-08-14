/**
 * @file e2e-agent-reapproval.ts
 * @description Bringing an EXISTING agent back must not quietly take its permissions away.
 *
 *   Re-running device authorization is the ordinary way an agent returns: its token expires, or the
 *   machine is reinstalled. Because the expired token cannot authenticate, the request falls out of
 *   same-owner auto-approval and into the browser consent card — and that card preselected
 *   "Standard". So the click that meant "yes, this is my agent" turned a full-access agent into
 *   eight scopes, and it stuck, since every later JWT is minted from defaultScopes. The owner never
 *   chose Standard; it was simply what was already selected.
 *
 *   Two halves, both asserted here. The server reads a MISSING `scopes` field as "nothing was
 *   chosen" and leaves an existing agent alone; the consent surfaces learn from `existing_agent`
 *   that this is a return, offer "keep its current access", and send no scopes when it is picked.
 *   Deliberate narrowing still works — an explicit set applies exactly as given.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=agent-reapproval
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial, with the fix.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `rap${Date.now() % 100000}`;
const AGENT = 'returning-agent';

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
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

let ownerToken = '';

/** One authorize round. The user_code is what the owner sees; the device_code fetches the token. */
let lastDeviceCode = '';
async function authorize(): Promise<string> {
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST',
        body: JSON.stringify({ agent_name: AGENT, owner }),
    });
    assert(r.status === 200 && r.body.ok === true, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    lastDeviceCode = r.body.data.device_code as string;
    return r.body.data.user_code as string;
}

/**
 * The scopes on the CREDENTIAL this approval actually issued, read out of the JWT the agent polls
 * for. Everything below used to be asserted against storage alone, and that is how a real bug
 * shipped: re-approval wrote the corrected scopes to the agent record and minted the token from a
 * different list, so `/v1/agents` looked right while the running agent was refused. Storage is the
 * owner's intent; this is what the agent can actually do, and they are two different claims.
 */
async function issuedScopes(): Promise<string[]> {
    const r = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({
            device_code: lastDeviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    // Flat, OAuth-shaped, NOT the node's success() envelope: an RFC 8628 client expects
    // access_token at the top level and this route answers one. `token` is the same string under
    // the name the rest of this API uses.
    assert(r.status === 200, `device-token ${r.status}: ${JSON.stringify(r.body)}`);
    const token = (r.body.access_token ?? r.body.token ?? r.body.data?.access_token ?? r.body.data?.token) as string;
    assert(typeof token === 'string' && token.split('.').length === 3, `no JWT in the poll response: ${JSON.stringify(r.body)}`);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return (claims.scopes ?? []) as string[];
}

/** Approve exactly as the consent card does. `scopes` omitted entirely = "keep current access". */
async function approve(userCode: string, scopes?: string[]) {
    return json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({
            user_code: userCode, action: 'approve', owner_token: ownerToken,
            ...(scopes ? { scopes } : {}),
        }),
    });
}

async function storedScopes(): Promise<string[]> {
    const r = await json('/v1/agents', auth(ownerToken));
    assert(r.status === 200, `list agents ${r.status}: ${JSON.stringify(r.body.error)}`);
    const a = (r.body.data.agents as any[]).find(x => x.name === AGENT);
    assert(!!a, `agent ${AGENT} not in the listing`);
    return (a.default_scopes ?? []) as string[];
}

console.log('\n=== Agent Re-approval E2E Tests ===\n');
console.log('Phase 0: an agent that already exists, with full access');

await test('Register the owner', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(reg.body.data.private_key, owner + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;
});

await test('The agent connects and the owner grants full access', async () => {
    const r = await approve(await authorize(), ['*']);
    assert(r.status === 200 && r.body.ok === true, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert((await storedScopes()).includes('*'), 'agent should hold the wildcard');
});

await test('The owner also grants the reserved-key scope, deliberately', async () => {
    const p = await json(`/v1/agents/${AGENT}/scopes`, {
        method: 'PATCH', ...auth(ownerToken),
        body: JSON.stringify({ scopes: ['*', 'memory:write-reserved'] }),
    });
    assert(p.status === 200, `patch ${p.status}: ${JSON.stringify(p.body.error)}`);
    const s = await storedScopes();
    assert(s.includes('*') && s.includes('memory:write-reserved'), `expected both, got ${JSON.stringify(s)}`);
});

console.log('\nPhase 1: the consent surfaces know this is a RETURN');

await test('the pending list marks it existing and carries its current scopes', async () => {
    const code = await authorize();
    const list = await json('/v1/agents/device-authorize/pending', auth(ownerToken));
    assert(list.status === 200, `pending ${list.status}`);
    const row = list.body.data.requests.find((r: any) => r.user_code === code);
    assert(!!row, 'the request should be listed for its owner');
    assert(row.existing_agent === true, 'existing_agent must be true for an agent coming back');
    assert(Array.isArray(row.current_scopes) && row.current_scopes.includes('*'),
        `current_scopes should name what it holds, got ${JSON.stringify(row.current_scopes)}`);
    // Approve it as a no-op so the next phase starts from a clean slate.
    await approve(code);
});

await test('the unauthenticated consent page is told THAT it exists, never what it may do', async () => {
    const code = await authorize();
    const info = await json(`/v1/agents/verify/info/${code}`);
    assert(info.status === 200, `info ${info.status}`);
    assert(info.body.data.existing_agent === true, 'existing_agent must be exposed for the preselection');
    assert(!('current_scopes' in info.body.data) && !('scopes' in info.body.data),
        `this endpoint is unauthenticated — it must not disclose scopes: ${JSON.stringify(Object.keys(info.body.data))}`);
    await approve(code);
});

console.log('\nPhase 2: THE REGRESSION — approving without choosing must change nothing');

await test('re-approval with NO scopes leaves the grant exactly as it was', async () => {
    const before = await storedScopes();
    const r = await approve(await authorize());
    assert(r.status === 200 && r.body.ok === true, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const after = await storedScopes();
    assert(new Set(after).size === new Set(before).size && after.every(s => before.includes(s)),
        `scopes changed on a no-choice re-approval: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert(after.includes('*'), 'the wildcard must survive a reconnect');
    assert(after.includes('memory:write-reserved'), 'the reserved grant must survive a reconnect');
});

await test('an agent that requests nothing on device-authorize is not cut to the node defaults', async () => {
    // The CLI and the desktop runtime both reconnect without naming scopes.
    const before = await storedScopes();
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: AGENT, owner }),
    });
    assert(r.status === 200, `authorize ${r.status}`);
    await approve(r.body.data.user_code);
    const after = await storedScopes();
    // Set equality, not "does it still have '*'": AIMEAT_DEFAULT_AGENT_SCOPES can itself contain
    // the wildcard, and then "narrowed to the defaults" and "kept what it had" look identical.
    // The reserved grant is the discriminator no default set ever carries.
    assert(after.length === before.length && after.every(s => before.includes(s)),
        `a silent reconnect changed the grant: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert(after.includes('memory:write-reserved'),
        `a silent reconnect dropped the reserved grant: ${JSON.stringify(after)}`);
});

console.log('\nPhase 3: deliberate narrowing still works');

await test('an explicit scope set applies exactly as given', async () => {
    const r = await approve(await authorize(), ['memory:read', 'memory:write']);
    assert(r.status === 200 && r.body.ok === true, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const after = await storedScopes();
    assert(after.includes('memory:read') && after.includes('memory:write'), `narrowing failed: ${JSON.stringify(after)}`);
    assert(!after.includes('*'), `the wildcard should be gone after a deliberate narrowing: ${JSON.stringify(after)}`);
});

await test('…and the reserved grant survives it, because no template can express it', async () => {
    // Nothing in the consent flow can ASK for memory:write-reserved — it is not in any template and
    // an agent requesting it is refused as an escalation. So a re-approval is never where the owner
    // meant to drop it; they remove it in the editor, deliberately, as they added it.
    const after = await storedScopes();
    assert(after.includes('memory:write-reserved'),
        `the reserved grant was dropped by a template choice: ${JSON.stringify(after)}`);
});

// ── The credential, not the record ──────────────────────────────────────────────────────────────
//
// Everything above reads /v1/agents. That is the owner's intent, and until 2026-08-14 it was the
// only thing this suite looked at, which is exactly why the bug below shipped: approveDeviceAuth
// wrote the corrected scope list to the agent record and minted the JWT from a different variable.
// The listing said what the owner had granted and the token said something else, so the suite was
// green while a real agent on aimeat.io was refused a scope its owner had given it.
//
// Re-approval is the ONLY path that mints the long-lived token, so a scope that does not reach the
// credential here does not reach the agent at all: /v1/auth/refresh reads defaultScopes correctly
// but issues a one-hour token and the connector does not auto-refresh.

await test('the TOKEN carries the out-of-wildcard grant, not only the agent record', async () => {
    const issued = await issuedScopes();
    assert(issued.includes('memory:write-reserved'),
        `the record kept the reserved grant and the credential did not: ${JSON.stringify(issued)}`);
});

await test('re-approving with NO scopes issues the scopes the owner chose, not the node defaults', async () => {
    // `finalScopes` falls back to config.defaultAgentScopes when the approver sends no array. The
    // storage write has kept the owner's decision since v1.5.0; the token was still being minted
    // from that fallback, so silence quietly narrowed a running agent to the node's four defaults.
    const before = await storedScopes();
    const r = await approve(await authorize());
    assert(r.status === 200 && r.body.ok === true, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);

    const issued = await issuedScopes();
    for (const s of before) {
        assert(issued.includes(s), `the credential lost "${s}" that the owner had granted: ${JSON.stringify(issued)}`);
    }
    const stored = await storedScopes();
    assert(JSON.stringify([...stored].sort()) === JSON.stringify([...issued].sort()),
        `the record and the credential disagree: record ${JSON.stringify(stored)} vs token ${JSON.stringify(issued)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
