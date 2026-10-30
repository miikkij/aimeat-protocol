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
 *   v1.3.0 — 2026-10-31 — Phase 7: an agent connected from a pasted prompt follows the device-token
 *     answer's next_steps.keep_your_key, and its reconnect is a proven return (secaudit2026oct22).
 *   v1.2.0 — 2026-10-26 — Phase 6: a crew's reconnect through the real `aimeat connect add` is shown
 *     to the owner as a return, with no takeover warning and no takeover event (secaudit2026oct22,
 *     unbound-reapproval-of-existing-agent; aimeat-crewai enrols through the connector).
 *   v1.1.0 — 2026-10-25 — Phase 5: a return proved by the agent's key, and a new device taking the
 *     agent over (secaudit2026oct22, unbound-reapproval-of-existing-agent).
 *   v1.0.0 — 2026-08-08 — Initial, with the fix.
 */

import { registerOwner } from './helpers/owner-login.js';
import { sign, generateKeyPair } from '../src/auth/keypair.js';
import { returnProofMessage } from '../src/services/device-return-proof.js';
import { runCli } from './helpers/connect-cli.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
    ownerToken = (await registerOwner(BASE, owner)).token;
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

// ── Who may answer a pending request ──
//
// Every approval above is this owner approving their own agent, which proves the scope arithmetic
// and never asks the question the flow actually turns on. POST /v1/agents/verify takes a user_code
// and an owner_token, and the two arrive as SEPARATE fields in one body: the code names a pending
// request, the token names who is answering. Nothing here had ever sent a token belonging to
// somebody other than the owner whose request the code is for. If that combination were accepted,
// any account on the node could grant scopes to a stranger's agent by quoting a six-character code.
console.log('\nPhase 4: a stranger holding somebody else\'s user_code');

const stranger = `reapstranger${Date.now() % 1000000}`;
let strangerToken = '';
/** The pending request the stranger tries and the owner then completes — one request, two answers. */
let pendingUserCode = '';

await test('a second owner exists', async () => {
    strangerToken = (await registerOwner(BASE, stranger)).token;
});

await test('a stranger cannot approve this owner\'s pending request', async () => {
    pendingUserCode = await authorize();
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: pendingUserCode, action: 'approve', owner_token: strangerToken, scopes: ['*'] }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    // Whatever the status, the request must still be pending rather than approved for the stranger.
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: lastDeviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status !== 200, `the stranger's approval issued a token anyway: ${JSON.stringify(poll.body).slice(0, 200)}`);
});

await test('an unauthenticated caller cannot approve it either', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: 'AAAA-BBBB', action: 'approve' }),
    });
    // 400, not 401: owner_token is a BODY field on this route rather than a header, so a request
    // without one never reaches an authentication check — it fails validation first. That is the
    // honest shape for a device-flow endpoint, and pinning it says so rather than accepting either.
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('POSITIVE CONTROL: the real owner still approves the same pending request', async () => {
    // The refusals above would pass just as happily against a door that had stopped approving for
    // everyone, which would make the whole device flow dead rather than safe.
    const r = await approve(pendingUserCode, ['memory:read']);
    assert(r.status === 200 && r.body.ok === true, `owner approve ${r.status}: ${JSON.stringify(r.body.error)}`);
});

// ── A return proved by the agent's key, and a new device taking the agent over ──
//
// device-authorize needs no credential, so a request naming an existing agent may come from anyone.
// The agent coming back holds the key its last approval gave it and signs the request with it; a
// request without that proof is shown to the owner as a new device taking the agent over, the
// approval records an account event, and the owner may sign the agent's other sessions out
// (secaudit2026oct22, unbound-reapproval-of-existing-agent). Nothing is refused either way.
console.log('\nPhase 5: proven return and unproven takeover');

/** The credential the last approval staged, as the device-token poll hands it out. */
async function pollCredential(): Promise<{ token: string; privateKey: string }> {
    const r = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: lastDeviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(r.status === 200, `device-token ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    return { token: (r.body.access_token ?? r.body.token) as string, privateKey: r.body.privateKey as string };
}
async function authorizeWithProof(privateKey: string): Promise<{ code: string; proof: string }> {
    const signedAt = new Date().toISOString();
    const signature = await sign(privateKey, returnProofMessage(owner, AGENT, signedAt));
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: AGENT, owner, proof: { signed_at: signedAt, signature } }),
    });
    assert(r.status === 200, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    lastDeviceCode = r.body.data.device_code as string;
    return { code: r.body.data.user_code as string, proof: r.body.data.return_proof as string };
}
const pendingRow = async (code: string) =>
    ((await json('/v1/agents/device-authorize/pending', auth(ownerToken))).body.data.requests as any[]).find(r => r.user_code === code);
const works = async (token: string) => (await json('/v1/memory?limit=1', auth(token))).status;
let current = { token: '', privateKey: '' };

await test('setup: the agent holds a token and the key of its last approval', async () => {
    const r = await approve(await authorize());
    assert(r.status === 200, `approve ${r.status}`);
    current = await pollCredential();
    assert(!!current.privateKey && (await works(current.token)) === 200, 'the agent works with its token');
});

await test('a request without proof is a takeover: the card is told, and the approval records it and may sign the agent out elsewhere', async () => {
    const code = await authorize();
    const row = await pendingRow(code);
    assert(row?.existing_agent === true && row.return_proven === false, `pending row: ${JSON.stringify(row)}`);
    assert((await json(`/v1/agents/verify/info/${code}`)).body.data.return_proven === false, 'the consent page is told too');
    const r = await json('/v1/agents/verify', {
        method: 'POST', body: JSON.stringify({ user_code: code, action: 'approve', owner_token: ownerToken, end_other_sessions: true }),
    });
    assert(r.status === 200 && r.body.data.takeover === true && r.body.data.other_sessions_ended === true, `approve: ${JSON.stringify(r.body.data)}`);
    assert((await works(current.token)) === 401, 'the earlier token is signed out');
    const next = await pollCredential();
    assert((await works(next.token)) === 200, 'the new device works');
    const events = (await json('/v1/account/events?limit=20', auth(ownerToken))).body.data.events as any[];
    assert(events.some(e => e.kind === 'agent_device_takeover' && e.data?.name === AGENT), `the account event: ${JSON.stringify(events.map(e => e.kind))}`);
    current = next;
});

await test('designed use: a return proved by the agent\'s key keeps "keep its access", records nothing, and signs nothing out', async () => {
    const { code, proof } = await authorizeWithProof(current.privateKey);
    assert(proof === 'verified', `return_proof: ${proof}`);
    assert((await pendingRow(code))?.return_proven === true, 'the card sees a proven return');
    const before = (await json('/v1/account/events?limit=50', auth(ownerToken))).body.data.events.filter((e: any) => e.kind === 'agent_device_takeover').length;
    const r = await approve(code);
    assert(r.status === 200 && r.body.data.takeover === false && r.body.data.other_sessions_ended === false, `approve: ${JSON.stringify(r.body.data)}`);
    assert((await works(current.token)) === 200, 'the earlier token still works');
    const after = (await json('/v1/account/events?limit=50', auth(ownerToken))).body.data.events.filter((e: any) => e.kind === 'agent_device_takeover').length;
    assert(after === before, 'no takeover event for a proven return');
    current = await pollCredential();
});

await test('a proof signed by another key does not verify, and the request is a takeover', async () => {
    const other = await generateKeyPair();
    const { code, proof } = await authorizeWithProof(other.privateKey);
    assert(proof === 'not_verified', `return_proof: ${proof}`);
    assert((await pendingRow(code))?.return_proven === false, 'unproven');
    await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: code, action: 'deny', owner_token: ownerToken }) });
});

// ── A proof is used once, and a v2 proof names the node it is for (secaudit2026oct26) ──
//
// The v1 text names no node and the node kept no record of a proof it took, so a proof made for one
// node (or read from a process list) showed another party's request as the agent's return, again and
// again for five minutes. The v2 text names the node; every proof is taken once.
const NODE_ID_OF = async () => (await json('/.well-known/aimeat')).body.data.node_id as string;
async function authorizeWithProofObject(proofObj: Record<string, unknown>): Promise<{ code: string; proof: string }> {
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: AGENT, owner, proof: proofObj }),
    });
    assert(r.status === 200, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    return { code: r.body.data.user_code as string, proof: r.body.data.return_proof as string };
}
const denyCode = (code: string) => json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: code, action: 'deny', owner_token: ownerToken }) });

await test('one proof sent twice: the second request is not shown as the agent\'s return', async () => {
    const signedAt = new Date().toISOString();
    const proofObj = { signed_at: signedAt, signature: await sign(current.privateKey, returnProofMessage(owner, AGENT, signedAt)) };
    const first = await authorizeWithProofObject(proofObj);
    const second = await authorizeWithProofObject(proofObj);
    assert(first.proof === 'verified', `first: ${first.proof}`);
    assert(second.proof === 'not_verified' && (await pendingRow(second.code))?.return_proven === false, `second: ${second.proof}`);
    await denyCode(first.code);
    await denyCode(second.code);
});

await test('a v2 proof that names another node is not shown as the agent\'s return', async () => {
    const signedAt = new Date().toISOString();
    const signature = await sign(current.privateKey, `aimeat-device-return:v2\nanother-node-001\n${owner}\n${AGENT}\n${signedAt}`);
    const r = await authorizeWithProofObject({ signed_at: signedAt, signature });
    assert(r.proof === 'not_verified', `return_proof: ${r.proof}`);
    await denyCode(r.code);
});

await test('designed use: a v2 proof that names this node is the agent\'s return', async () => {
    const signedAt = new Date().toISOString();
    const signature = await sign(current.privateKey, `aimeat-device-return:v2\n${await NODE_ID_OF()}\n${owner}\n${AGENT}\n${signedAt}`);
    const r = await authorizeWithProofObject({ signed_at: signedAt, signature });
    assert(r.proof === 'verified' && (await pendingRow(r.code))?.return_proven === true, `return_proof: ${r.proof}`);
    await denyCode(r.code);
});

// ── A crew's reconnect through the real connector ──
//
// aimeat-crewai does no device authorization of its own: a crew enrols and reconnects with
// `aimeat connect add` run in its project directory (python/aimeat-crewai README, Setup step 2; the
// package's expired-token message names the same command). So the proof a crew's return carries is
// the one the connector signs with the key it kept from the last approval (cli/connect/auth.ts). This
// phase runs the real CLI twice into one connector home, the second time after the stored token has
// stopped working, and reads what the owner is shown.
console.log('\nPhase 6: a crew reconnects with aimeat connect add, and the owner sees a return');

const CREW = 'crew-return';
const crewHome = join(mkdtempSync(join(tmpdir(), 'aimeat-crew-')), '.aimeat');
const crewKeyFile = join(crewHome, 'tokens', `${CREW}@${owner}.key`);
const crewTokenFile = join(crewHome, 'tokens', `${CREW}@${owner}.token`);

/** The pending request the CLI raised for CREW, other than `skip`, once it appears. */
async function crewRequest(skip = ''): Promise<any> {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
        const rows = ((await json('/v1/agents/device-authorize/pending', auth(ownerToken))).body.data?.requests ?? []) as any[];
        const row = rows.find(r => r.agent_name === CREW && r.status === 'pending' && r.user_code !== skip);
        if (row) return row;
        await new Promise(res => setTimeout(res, 300));
    }
    throw new Error(`no pending request for ${CREW} within 40 s`);
}

let firstCrewCode = '';
await test('a crew connects for the first time: the connector keeps the key of the approval beside the token', async () => {
    const running = runCli(['connect', 'add', '--url', BASE, '--owner', owner, '--agent', CREW], { home: crewHome, timeoutMs: 90_000 });
    const row = await crewRequest();
    firstCrewCode = row.user_code;
    assert(row.existing_agent === false, `a new agent: ${JSON.stringify(row)}`);
    assert((await approve(row.user_code)).status === 200, 'approve');
    const r = await running;
    assert(r.code === 0, `connect add exited ${r.code}: ${r.out.slice(-400)}`);
    assert(existsSync(crewKeyFile) && readFileSync(crewKeyFile, 'utf-8').trim().length > 0, `no key at ${crewKeyFile}`);
    if (process.platform !== 'win32') assert((statSync(crewKeyFile).mode & 0o777) === 0o600, 'the key file is 0600');
});

await test('designed use: the crew reconnects after its token stopped working, and the owner sees its return, not a takeover', async () => {
    const keyBefore = readFileSync(crewKeyFile, 'utf-8').trim();
    // The stored token as it looks once it has expired: its exp is in the past, so the node refuses it.
    const [head, payload, sig] = readFileSync(crewTokenFile, 'utf-8').trim().split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expired = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url');
    writeFileSync(crewTokenFile, `${head}.${expired}.${sig}`, 'utf-8');
    const before = (await json('/v1/account/events?limit=50', auth(ownerToken))).body.data.events.filter((e: any) => e.kind === 'agent_device_takeover').length;
    const running = runCli(['connect', 'add', '--url', BASE, '--owner', owner, '--agent', CREW], { home: crewHome, timeoutMs: 90_000 });
    const row = await crewRequest(firstCrewCode).catch(async (e: Error) => { const c = await running; throw new Error(`${e.message}; the CLI (exit ${c.code}, timed out ${c.timedOut}) said: ${JSON.stringify(c.out)}`); });
    assert(row.existing_agent === true && row.return_proven === true, `the card is told it is a return: ${JSON.stringify(row)}`);
    assert((await json(`/v1/agents/verify/info/${row.user_code}`)).body.data.return_proven === true, 'the consent page is told too');
    const a = await approve(row.user_code);
    assert(a.status === 200 && a.body.data.takeover === false && a.body.data.other_sessions_ended === false, `approve: ${JSON.stringify(a.body.data)}`);
    const r = await running;
    assert(r.code === 0, `connect add exited ${r.code}: ${r.out.slice(-400)}`);
    const after = (await json('/v1/account/events?limit=50', auth(ownerToken))).body.data.events.filter((e: any) => e.kind === 'agent_device_takeover').length;
    assert(after === before, 'no takeover event for the crew\'s return');
    assert(readFileSync(crewKeyFile, 'utf-8').trim() !== keyBefore, 'the key of the new approval replaced the old one');
    assert((await works(readFileSync(crewTokenFile, 'utf-8').trim())) === 200, 'the crew works with its new token');
});

try { rmSync(dirname(crewHome), { recursive: true, force: true }); } catch { /* a handle may still be closing */ }

// ── An agent connected from a pasted prompt ──
//
// An AI connected with the Agents page's prompt does the device flow itself and got privateKey with
// no word of what it is for, so its reconnect showed the owner a takeover. The device-token answer
// now says it in next_steps.keep_your_key, with this node's id; an agent that does what it says
// proves its return (secaudit2026oct22, unbound-reapproval-of-existing-agent, the prompt-connect part).
console.log('\nPhase 7: an agent connected from a pasted prompt follows keep_your_key and the owner sees its return');

await test('designed use: the device-token answer says to keep the key and how to prove a return, and doing so is a proven return', async () => {
    const code = await authorize();
    assert((await approve(code)).status === 200, 'approve');
    const r = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: lastDeviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(r.status === 200, `device-token ${r.status}`);
    const keep = r.body.next_steps?.keep_your_key;
    assert(typeof keep?.action === 'string' && keep.action.includes('privateKey')
        && keep.action.includes('aimeat-device-return:v2\\n<node_id>\\n<owner>\\n<agent_name>\\n<signed_at>'), `keep_your_key: ${JSON.stringify(keep)}`);
    assert(keep.node_id === await NODE_ID_OF(), `node_id ${keep.node_id} is this node's`);
    assert(!!r.body.next_steps.step_1_skill_bundle && !!r.body.next_steps.step_3_onboarding, 'the earlier steps are still there');
    // What the instruction says, done literally with the values the answer gave.
    const signedAt = new Date().toISOString();
    const signature = await sign(r.body.privateKey, `aimeat-device-return:v2\n${keep.node_id}\n${owner}\n${AGENT}\n${signedAt}`);
    const back = await authorizeWithProofObject({ signed_at: signedAt, signature });
    assert(back.proof === 'verified' && (await pendingRow(back.code))?.return_proven === true, `return_proof: ${back.proof}`);
    await denyCode(back.code);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
