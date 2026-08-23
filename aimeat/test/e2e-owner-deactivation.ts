/**
 * @file test/e2e-owner-deactivation.ts
 * @description Deactivating an account ends everything acting in its name, NOW (BR-04 criterion 3).
 *
 *   Until this change an owner had exactly one off switch: erasure. An organisation's identity
 *   provider needs the other one — a person leaves, and their browser sessions, their agents'
 *   90-day JWTs, their PATs, their app grants and their MCP sessions all stop, while the account
 *   and its knowledge remain for the day they come back.
 *
 *   Every assertion here is a refusal or an isolation boundary: each credential family answers 401
 *   after the operator presses disable, new logins answer 403 ACCOUNT_DISABLED, the federation
 *   attestation refuses so deactivation holds on other nodes too, and reactivation lets the person
 *   back in WITHOUT resurrecting the credentials that were ended. The MCP door gets its own
 *   assertions because it was the pre-existing hole: it asked only exact-token revocation, so a
 *   revoked session or app grant (and now a deactivated owner) stayed alive there while dead on
 *   every REST route — including the session-resume branch, which asked nothing at all.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-deactivation
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the deactivation feature itself (BR-04 phase 0).
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
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Can this bearer still act? memory list works for every principal family here. */
async function stillWorks(token: string): Promise<{ ok: boolean; status: number }> {
    const { status } = await json('/v1/memory?limit=1', { headers: bearer(token) });
    return { ok: status === 200, status };
}

const PASSWORD = 'Deactivate123456';

/** Register an owner with a password (so password login is testable) + an owner JWT. */
async function setupOwner(label: string) {
    const owner = `odact${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: PASSWORD }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: PASSWORD }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const privateKey = r.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(privateKey, owner + NODE_ID + ts) }),
    });
    assert(tok.status === 200, `auth/token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return { owner, privateKey, ownerToken: tok.body.data.token as string };
}

/** Connect an agent through device authorization (auto-approved by its own owner). */
async function connectAgent(owner: string, ownerToken: string, agentName: string) {
    const start = await json('/v1/agents/device-authorize', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ owner, agent_name: agentName }),
    });
    assert(start.status === 200, `device-authorize ${start.status}: ${JSON.stringify(start.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200, `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    return { name: agentName, gaii: poll.body.gaii as string, token: poll.body.access_token as string };
}

/** POST /v1/mcp — returns { status, sessionId } for an initialize, plain status otherwise. */
async function mcpInitialize(token: string): Promise<{ status: number; sessionId: string | null }> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...bearer(token) },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'deactivation probe', version: '1.0.0' } },
        }),
    });
    res.body?.cancel().catch(() => { /* stream body is irrelevant here */ });
    return { status: res.status, sessionId: res.headers.get('mcp-session-id') };
}

async function mcpResume(token: string, sessionId: string): Promise<number> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            'mcp-session-id': sessionId, ...bearer(token),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    res.body?.cancel().catch(() => { /* stream body is irrelevant here */ });
    return res.status;
}

console.log('\n=== Owner deactivation ends every credential family (BR-04) ===\n');

async function run() {
    // The FIRST owner of a clean suite database becomes operator (self-heal).
    const op = await setupOwner('op');
    const victim = await setupOwner('v');
    const bystander = await setupOwner('b');

    const agent = await connectAgent(victim.owner, victim.ownerToken, 'doomed-agent');
    const bystanderAgent = await connectAgent(bystander.owner, bystander.ownerToken, 'safe-agent');

    // PAT in the victim's name.
    let pat = '';
    await test('setup: the victim mints a PAT', async () => {
        const r = await json('/v1/access/tokens', {
            method: 'POST', headers: bearer(victim.ownerToken),
            body: JSON.stringify({ label: 'doomed-pat', grant_owner: true }),
        });
        assert(r.status === 201 || r.status === 200, `pat mint ${r.status}: ${JSON.stringify(r.body?.error)}`);
        pat = r.body.data.token;
        assert(typeof pat === 'string' && pat.startsWith('aimeat_pat_'), 'raw PAT returned once');
    });

    // App grant in the victim's name (published app + PKCE consent flow).
    let appToken = '';
    const FILENAME = 'doomed-app.html';
    const REDIRECT = `${BASE}/v1/apps/${FILENAME}`;
    await test('setup: the victim grants an app', async () => {
        const pub = await json('/v1/apps', {
            method: 'POST', headers: bearer(victim.ownerToken),
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>x</body></html>'), name: 'Doomed', description: 'deactivation probe', category: 'utility' }),
        });
        assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const q = new URLSearchParams({
            app: `${victim.owner}/${FILENAME}`, response_type: 'code', scope: 'memory:read',
            redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        assert(auth.status === 302, `authorize ${auth.status}`);
        const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: bearer(victim.ownerToken), body: JSON.stringify({ request_id: rid }),
        });
        assert(con.status === 200, `consent ${con.status}: ${JSON.stringify(con.body?.error)}`);
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.status === 200, `grant token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
        appToken = tok.body.data.access_token;
    });

    // An OPEN MCP session, so the resume branch is asserted too (the pre-existing hole).
    let mcpSession = '';
    await test('setup: every credential family works, MCP session open', async () => {
        for (const [label, t] of [['owner', victim.ownerToken], ['agent', agent.token], ['pat', pat], ['app', appToken]] as const) {
            const r = await stillWorks(t);
            assert(r.ok, `${label} credential should work before deactivation, got ${r.status}`);
        }
        const mcp = await mcpInitialize(agent.token);
        assert(mcp.status === 200, `mcp initialize ${mcp.status}`);
        assert(!!mcp.sessionId, 'mcp session id issued');
        mcpSession = mcp.sessionId!;
    });

    // ── Failure paths on the door itself ──
    await test('a non-operator cannot deactivate anyone: 403', async () => {
        const r = await json(`/v1/admin/owners/${victim.owner}/disable`, { method: 'POST', headers: bearer(bystander.ownerToken) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });
    await test('anonymous cannot deactivate anyone: 401', async () => {
        const r = await json(`/v1/admin/owners/${victim.owner}/disable`, { method: 'POST' });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('an operator cannot deactivate THEMSELVES: 400', async () => {
        const r = await json(`/v1/admin/owners/${op.owner}/disable`, { method: 'POST', headers: bearer(op.ownerToken) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    // ── The act ──
    await test('the operator deactivates the account and is told what ended', async () => {
        const r = await json(`/v1/admin/owners/${victim.owner}/disable`, { method: 'POST', headers: bearer(op.ownerToken) });
        assert(r.status === 200, `disable ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.disabled === true, 'reported disabled');
        assert(r.body.data.sessions_revoked >= 2, `owner + agent sessions ended, got ${r.body.data.sessions_revoked}`);
        assert(r.body.data.pats_revoked >= 1, `PAT ended, got ${r.body.data.pats_revoked}`);
        assert(r.body.data.grants_revoked >= 1, `app grant ended, got ${r.body.data.grants_revoked}`);
    });

    // ── Every credential family is dead, immediately ──
    await test('the owner session token answers 401', async () => {
        const r = await stillWorks(victim.ownerToken);
        assert(!r.ok && r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('the agent token answers 401', async () => {
        const r = await stillWorks(agent.token);
        assert(!r.ok && r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('the PAT answers 401', async () => {
        const r = await stillWorks(pat);
        assert(!r.ok && r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('the app-grant token answers 401', async () => {
        const r = await stillWorks(appToken);
        assert(!r.ok && r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('the MCP door refuses a new session: 401 (the pre-existing hole, closed)', async () => {
        const r = await mcpInitialize(agent.token);
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });
    await test('the MCP door refuses the OPEN session too: 401 (the resume branch asked nothing)', async () => {
        const status = await mcpResume(agent.token, mcpSession);
        assert(status === 401, `expected 401, got ${status}`);
    });

    // ── No new way in ──
    await test('password login answers 403 ACCOUNT_DISABLED', async () => {
        const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: victim.owner, password: PASSWORD }) });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error?.code === 'ACCOUNT_DISABLED', `expected ACCOUNT_DISABLED, got ${r.body.error?.code}`);
    });
    await test('the signed /v1/auth/token door answers 403 ACCOUNT_DISABLED', async () => {
        const ts = new Date().toISOString();
        const r = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: victim.owner, timestamp: ts, signature: await sign(victim.privateKey, victim.owner + NODE_ID + ts) }),
        });
        assert(r.status === 403 && r.body.error?.code === 'ACCOUNT_DISABLED', `expected 403 ACCOUNT_DISABLED, got ${r.status} ${r.body.error?.code}`);
    });
    await test('the federation attestation refuses: deactivation holds on other nodes', async () => {
        const r = await json('/v1/federation/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ username: victim.owner, password: PASSWORD, requesting_node: 'other-node', timestamp: new Date().toISOString() }),
        });
        assert(r.status === 403 && r.body.error?.code === 'ACCOUNT_DISABLED', `expected 403 ACCOUNT_DISABLED, got ${r.status} ${r.body.error?.code}`);
    });

    // ── Isolation: the bystander is untouched ──
    await test('another owner and their agent are untouched', async () => {
        const a = await stillWorks(bystander.ownerToken);
        const b = await stillWorks(bystanderAgent.token);
        assert(a.ok, `bystander owner token, got ${a.status}`);
        assert(b.ok, `bystander agent token, got ${b.status}`);
    });

    // ── Reactivation: the person returns, their old credentials do not ──
    await test('reactivation lets the person log in fresh', async () => {
        const en = await json(`/v1/admin/owners/${victim.owner}/enable`, { method: 'POST', headers: bearer(op.ownerToken) });
        assert(en.status === 200 && en.body.data.disabled === false, `enable ${en.status}`);
        const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: victim.owner, password: PASSWORD }) });
        assert(login.status === 200, `login after enable ${login.status}: ${JSON.stringify(login.body?.error)}`);
    });
    await test('…but the credentials ended by deactivation stay dead', async () => {
        for (const [label, t] of [['owner', victim.ownerToken], ['agent', agent.token], ['pat', pat], ['app', appToken]] as const) {
            const r = await stillWorks(t);
            assert(!r.ok && r.status === 401, `${label} credential must stay dead after reactivation, got ${r.status}`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Suite crashed:', err); process.exit(1); });
