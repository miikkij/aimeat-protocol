/**
 * @file test/e2e-agent-token-revocation.ts
 * @description Deleting an agent has to end its sessions.
 *
 *   Until this suite there was nothing asking. An agent JWT is signed, carries a 90-day expiry and
 *   is checked against the token-revocation table by exact token hash, so deleting the agent record
 *   left every credential it held valid: the record was gone, `storage.getAgent` returned null, and
 *   the bearer kept authenticating. The middleware documented the desync as a caching problem
 *   (`agentNotFoundResponse`) rather than as the security hole it also was, and the owner pressing
 *   Delete had no way to reach the token — you cannot revoke by hash a string you never see.
 *
 *   Both mint paths are covered, because they behaved differently: POST /v1/auth/token has always
 *   written a session row, device authorization never did, and only a token with a session row can
 *   be revoked without enumerating credentials.
 *
 *   The last test is the one that keeps the fix honest: revocation must reach exactly the deleted
 *   agent's sessions and not the sibling standing next to it.
 *
 *   Two more mint paths and one more replay (Core 2026-11): the agent token POST /v1/ghii/verify-email
 *   and GET /v1/ghii/magic-link/verify hand out dies with the agent (ID-10), and one signature renews
 *   an agent token once (AUTH-11).
 *
 *   The MCP OAuth mint is the fourth one, and it is the one that had no session row at all: the
 *   access token is issued without a session id, so revokeSessionsByGaii reached nothing of it and
 *   the deleted agent went on calling tools on its open MCP session for the rest of the token's TTL
 *   (secaudit 2026-10, mcp-oauth:access-token-without-session-survives-agent-delete).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-token-revocation
 * @version-history
 *   v1.3.0 — 2026-10-20 — The MCP OAuth credential: the open session, a fresh initialize and the
 *     refresh grant all die with the agent; a key rotation cuts the open session; a second agent's
 *     session is untouched by either.
 *   v1.2.0 — 2026-10-13 — The token GET /v1/ghii/magic-link/verify hands out dies with its agent too
 *     (ID-10, 4.0-testimuutokset.md §4 item 8).
 *   v1.1.0 — 2026-10-12 — A renewal signature works once (AUTH-11); the e-mail verification token dies
 *     with its agent (ID-10).
 *   v1.0.0 — 2026-08-13 — Initial, with the fix.
 */
import { seedEmailVerification } from './helpers/verified-email.js';
import { seedSignInLink } from './helpers/seed-password.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { mcpPkce, authorizeParams, tokenParams } from './helpers/mcp-oauth-pkce.js';
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

/** Can this bearer still act? memory:read is in every agent's default scopes. */
async function stillWorks(token: string): Promise<{ ok: boolean; status: number }> {
    const { status } = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${token}` } });
    return { ok: status === 200, status };
}

/** Register an owner and return an owner session token. */
async function setupOwner(label: string) {
    const owner = `arev${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'RevokeMe123456' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'RevokeMe123456' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const tok = await ownerSignIn(BASE, owner, 'RevokeMe123456');
    return { owner, ownerToken: tok.body.data.token as string };
}

/**
 * Connect an agent the way a real one connects: device authorization, auto-approved because the
 * caller is its own owner. Returns the credentials the poll hands back.
 */
async function connectAgent(owner: string, ownerToken: string, agentName: string) {
    const auth = { Authorization: `Bearer ${ownerToken}` };
    const start = await json('/v1/agents/device-authorize', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ owner, agent_name: agentName }),
    });
    assert(start.status === 200, `device-authorize ${start.status}: ${JSON.stringify(start.body?.error)}`);
    assert(start.body.data.auto_approved === true, 'same-owner registration should be auto-approved');

    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200, `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    return { name: agentName, gaii: poll.body.gaii as string, token: poll.body.access_token as string, privateKey: poll.body.privateKey as string };
}

/**
 * The MCP OAuth credential of one agent: register a client, have the OWNER approve the agent, and
 * exchange the code with PKCE. This is the mint whose access token carries no session id.
 */
async function mcpOauthCredential(ownerToken: string, gaii: string) {
    const reg = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `revocation-${Date.now()}`, redirect_uris: [] }),
    });
    assert(reg.status === 201, `mcp/register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const pkce = mcpPkce(BASE);
    const consent = await json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({ client_id: reg.body.client_id, gaii, owner_token: ownerToken, ...authorizeParams(pkce) }),
    });
    assert(consent.status === 200 && typeof consent.body.code === 'string',
        `authorize-consent ${consent.status}: ${JSON.stringify(consent.body)}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: consent.body.code,
            client_id: reg.body.client_id, client_secret: reg.body.client_secret, ...tokenParams(pkce),
        }),
    });
    assert(tok.status === 200, `mcp/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return {
        clientId: reg.body.client_id as string,
        clientSecret: reg.body.client_secret as string,
        accessToken: tok.body.access_token as string,
        refreshToken: tok.body.refresh_token as string,
    };
}

let mcpRpcId = 0;
/**
 * One JSON-RPC request on /v1/mcp. The HTTP status is the assertion here — a refused credential is
 * 401 before the session branch and a session that is gone is 404 — so this does not use
 * helpers/mcp-session.ts, which answers the JSON-RPC message alone.
 */
async function mcpCall(token: string, method: string, params: Record<string, unknown>, sessionId?: string) {
    const id = ++mcpRpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`,
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await res.text();
    const messages: any[] = (res.headers.get('content-type') ?? '').includes('text/event-stream')
        ? text.split('\n').filter(l => l.startsWith('data: '))
            .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean)
        : [(() => { try { return JSON.parse(text); } catch { return { _raw: text }; } })()];
    return {
        status: res.status,
        sessionId: res.headers.get('mcp-session-id') ?? sessionId,
        body: messages.find(m => m?.id === id) ?? messages[0] ?? {},
    };
}

/** Open an MCP session with this bearer and make one tool call that must succeed. */
async function openMcpSession(token: string, label: string) {
    const init = await mcpCall(token, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: label, version: '1.0.0' },
    });
    assert(init.status === 200, `initialize ${label}: ${init.status} ${JSON.stringify(init.body)}`);
    assert(typeof init.sessionId === 'string' && init.sessionId.length > 0, `initialize ${label} gave no session id`);
    const call = await mcpCall(token, 'tools/call', { name: 'aimeat_memory_list', arguments: {} }, init.sessionId);
    assert(call.status === 200, `the first tool call of ${label}: ${call.status} ${JSON.stringify(call.body)}`);
    assert(call.body?.result?.isError !== true, `the first tool call of ${label} was refused: ${JSON.stringify(call.body?.result)}`);
    return init.sessionId as string;
}

console.log('\n=== Deleting an agent ends its sessions ===\n');

async function run() {
    const o = await setupOwner('a');
    const auth = { Authorization: `Bearer ${o.ownerToken}` };

    const doomed = await connectAgent(o.owner, o.ownerToken, 'doomed');
    const bystander = await connectAgent(o.owner, o.ownerToken, 'bystander');

    // A second credential for the same agent, minted the OTHER way, so the test covers both.
    let signedToken = '';
    await test('both mint paths hand out a working credential', async () => {
        const ts = new Date().toISOString();
        const signed = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: doomed.gaii, timestamp: ts, signature: await sign(doomed.privateKey, doomed.gaii + ts) }),
        });
        assert(signed.status === 200, `auth/token ${signed.status}: ${JSON.stringify(signed.body?.error)}`);
        signedToken = signed.body.data.token;

        const a = await stillWorks(doomed.token);
        const b = await stillWorks(signedToken);
        assert(a.ok, `device-auth token should work before deletion, got ${a.status}`);
        assert(b.ok, `signed token should work before deletion, got ${b.status}`);
    });

    await test('the owner deletes the agent', async () => {
        const { status } = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: auth });
        assert(status === 200, `delete ${status}`);
    });

    await test('the DEVICE-AUTH token is dead — this is the hole', async () => {
        const r = await stillWorks(doomed.token);
        assert(!r.ok, 'a deleted agent\'s token must not authenticate');
        assert(r.status === 401, `expected 401 (not authenticated), got ${r.status}`);
    });

    await test('the SIGNED token is dead too', async () => {
        const r = await stillWorks(signedToken);
        assert(!r.ok, 'the second credential must die with the first');
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('the sibling agent is untouched', async () => {
        const r = await stillWorks(bystander.token);
        assert(r.ok, `deleting one agent must not sign out another, got ${r.status}`);
    });

    // ── The MCP OAuth credential (secaudit 2026-10) ──
    //
    // This mint is the one with no session row: mcp/oauth.ts calls issueJWT without a session id, so
    // the token carries no `jti` and storage.revokeSessionsByGaii, which the delete above relies on,
    // reached nothing of it. credentialRevoked asked five questions and none of them was "does this
    // agent still exist", so the deleted agent kept calling tools on its open MCP session, and could
    // open a new one, until the access token expired on its own.
    const mcpDoomed = await connectAgent(o.owner, o.ownerToken, 'mcpdoomed');
    const mcpKeeper = await connectAgent(o.owner, o.ownerToken, 'mcpkeeper');
    const mcpRotate = await connectAgent(o.owner, o.ownerToken, 'mcprotate');
    let doomedCred: Awaited<ReturnType<typeof mcpOauthCredential>>;
    let doomedSession = '';
    let keeperCred: Awaited<ReturnType<typeof mcpOauthCredential>>;
    let keeperSession = '';

    await test('an MCP OAuth session works before the agent is deleted', async () => {
        doomedCred = await mcpOauthCredential(o.ownerToken, mcpDoomed.gaii);
        keeperCred = await mcpOauthCredential(o.ownerToken, mcpKeeper.gaii);
        doomedSession = await openMcpSession(doomedCred.accessToken, 'mcpdoomed');
        keeperSession = await openMcpSession(keeperCred.accessToken, 'mcpkeeper');
        assert(doomedSession !== keeperSession, 'two agents get two MCP sessions');
    });

    await test('the owner deletes the agent that holds the MCP OAuth token', async () => {
        const { status, body } = await json(`/v1/agents/${mcpDoomed.name}`, { method: 'DELETE', headers: auth });
        assert(status === 200, `delete ${status}: ${JSON.stringify(body?.error)}`);
        // The access token has no session row, so this number is 0 and always was; what ends it is
        // the agent question credentialRevoked asks, and the open socket is counted separately.
        assert(typeof body.data.mcp_sessions_closed === 'number', 'the answer says how many MCP sessions it closed');
    });

    await test('the SAME MCP session with the SAME bearer is refused — this is the hole', async () => {
        const r = await mcpCall(doomedCred.accessToken, 'tools/call',
            { name: 'aimeat_memory_list', arguments: {} }, doomedSession);
        assert(r.status === 401, `a deleted agent's MCP call must be refused, got ${r.status}: ${JSON.stringify(r.body)}`);
    });

    await test('a fresh initialize with the same bearer is refused', async () => {
        const r = await mcpCall(doomedCred.accessToken, 'initialize', {
            protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcpdoomed-again', version: '1.0.0' },
        });
        assert(r.status === 401, `a deleted agent must not open a new MCP session, got ${r.status}: ${JSON.stringify(r.body)}`);
    });

    await test('the refresh grant mints nothing for the deleted agent', async () => {
        const r = await json('/v1/mcp/token', {
            method: 'POST',
            body: JSON.stringify({
                grant_type: 'refresh_token', refresh_token: doomedCred.refreshToken,
                client_id: doomedCred.clientId, client_secret: doomedCred.clientSecret,
            }),
        });
        assert(r.status === 400, `the refresh grant must fail, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body.error === 'invalid_grant', `expected invalid_grant, got ${JSON.stringify(r.body)}`);
    });

    // The positive control. Everything above must reach the deleted agent and nothing else: a second
    // agent's open MCP session goes on answering with the bearer it already holds.
    await test('another agent\'s MCP session keeps working across that delete', async () => {
        const r = await mcpCall(keeperCred.accessToken, 'tools/call',
            { name: 'aimeat_memory_list', arguments: {} }, keeperSession);
        assert(r.status === 200, `a live agent's MCP session must survive another agent's delete, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body?.result?.isError !== true, `the live agent's tool call was refused: ${JSON.stringify(r.body?.result)}`);
    });

    // Key rotation. The route's own answer says the old tokens are invalidated, and it revokes the
    // session rows for that — which again reaches nothing of an MCP OAuth token. The open transport
    // is now cut with the connect tunnel, so the client re-initializes instead of carrying on over a
    // socket whose bearer this node verified once, at the handshake.
    await test('rotating an agent\'s key cuts its open MCP session', async () => {
        const cred = await mcpOauthCredential(o.ownerToken, mcpRotate.gaii);
        const session = await openMcpSession(cred.accessToken, 'mcprotate');
        const rekey = await json(`/v1/agents/${encodeURIComponent(mcpRotate.gaii)}/rekey`, {
            method: 'POST', headers: auth, body: '{}',
        });
        assert(rekey.status === 200, `rekey ${rekey.status}: ${JSON.stringify(rekey.body?.error)}`);
        const r = await mcpCall(cred.accessToken, 'tools/call', { name: 'aimeat_memory_list', arguments: {} }, session);
        assert(r.status === 404, `the rotated agent's open MCP session must be gone, got ${r.status}: ${JSON.stringify(r.body)}`);
        // And the agent standing next to it still holds its own session.
        const keeper = await mcpCall(keeperCred.accessToken, 'tools/call',
            { name: 'aimeat_memory_list', arguments: {} }, keeperSession);
        assert(keeper.status === 200, `a rekey must not touch another agent's MCP session, got ${keeper.status}`);
    });

    // AUTH-11. The renewal checks the signature and its five-minute window; without spending it, the
    // same signed body minted a fresh token for whoever replayed it inside that window.
    await test('AUTH-11: a renewal signature mints one token — the second send of the same body is refused', async () => {
        const ts = new Date().toISOString();
        const body = JSON.stringify({ gaii: bystander.gaii, timestamp: ts, signature: await sign(bystander.privateKey, bystander.gaii + ts) });
        const first = await json('/v1/auth/token', { method: 'POST', body });
        assert(first.status === 200, `first renewal ${first.status}: ${JSON.stringify(first.body?.error)}`);
        const second = await json('/v1/auth/token', { method: 'POST', body });
        assert(second.status === 401, `the replayed signature must be refused, got ${second.status}: ${JSON.stringify(second.body?.data ?? second.body?.error)}`);
    });

    // ID-10. The e-mail verification door hands out a token for the account's "app" agent. It carried
    // no session id and wrote no session row, so deleting that agent left the token working.
    await test('ID-10: the token e-mail verification hands out dies when its agent is deleted', async () => {
        const code = '482915';
        const verificationId = await seedEmailVerification(o.owner, `${o.owner}@example.test`, code);
        const v = await json('/v1/ghii/verify-email', { method: 'POST', body: JSON.stringify({ verification_id: verificationId, code }) });
        assert(v.status === 200, `verify-email ${v.status}: ${JSON.stringify(v.body?.error)}`);
        const verifyToken = v.body.data.token as string;
        // GET /v1/ghii/me needs a credential and no permission word: the "app" agent this door creates
        // holds no scopes of its own, so a memory read would be refused for that reason instead.
        const probe = () => json('/v1/ghii/me', { headers: { Authorization: `Bearer ${verifyToken}` } });
        const before = await probe();
        assert(before.status === 200, `the verification token authenticates before the agent is deleted, got ${before.status} ${JSON.stringify(before.body?.error)}`);
        const name = String(v.body.data.agent.gaii).split('#')[0];
        const del = await json(`/v1/agents/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth });
        assert(del.status === 200, `delete ${name}: ${del.status}`);
        const after = await probe();
        assert(after.status === 401, `a deleted agent's verification token must not authenticate, got ${after.status}`);
    });

    // ID-10, the other mailbox proof. GET /v1/ghii/magic-link/verify mints through the same
    // mintVerifiedAgentToken as verify-email, and nothing tested that its token dies with the agent
    // (4.0-testimuutokset.md §4 item 8). The link is issued by the node's own issueLoginLink.
    await test('ID-10: the token a sign-in link hands out (magic-link/verify) dies when its agent is deleted', async () => {
        const link = await seedSignInLink(BASE, o.owner, `${o.owner}@example.test`);
        const linkToken = new URL(link).searchParams.get('token') ?? '';
        const v = await json(`/v1/ghii/magic-link/verify?token=${encodeURIComponent(linkToken)}`);
        assert(v.status === 200, `magic-link/verify ${v.status}: ${JSON.stringify(v.body?.error)}`);
        const linkAgentToken = v.body.data.token as string;
        const probe = () => json('/v1/ghii/me', { headers: { Authorization: `Bearer ${linkAgentToken}` } });
        const before = await probe();
        assert(before.status === 200, `the sign-in link token authenticates before the agent is deleted, got ${before.status} ${JSON.stringify(before.body?.error)}`);
        const name = String(v.body.data.agent.gaii).split('#')[0];
        const del = await json(`/v1/agents/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth });
        assert(del.status === 200, `delete ${name}: ${del.status}`);
        const after = await probe();
        assert(after.status === 401, `a deleted agent's sign-in link token must not authenticate, got ${after.status}`);
    });

    // A second owner for the two session-scope tests: the first one is about to sign itself out.
    const o2 = await setupOwner('b');
    const auth2 = { Authorization: `Bearer ${o2.ownerToken}` };
    const keeper = await connectAgent(o2.owner, o2.ownerToken, 'keeper');

    await test('the device list is the human\'s own sign-ins, not their agents\'', async () => {
        const { status, body } = await json('/v1/auth/sessions', { headers: auth2 });
        assert(status === 200, `sessions ${status}`);
        const gaiis = (body.data.sessions ?? []).map((s: any) => s.gaii);
        assert(gaiis.length > 0, 'the owner has at least their own session listed');
        assert(!gaiis.some((g: string) => g.includes('#')), `no agent rows in the device list: ${JSON.stringify(gaiis)}`);
    });

    await test('"sign out everywhere" leaves the fleet connected', async () => {
        assert((await stillWorks(keeper.token)).ok, 'the agent works to begin with');
        const { status } = await json('/v1/auth/sessions', { method: 'DELETE', headers: auth2 });
        assert(status === 200, `revoke-all ${status}`);
        const r = await stillWorks(keeper.token);
        assert(r.ok, `signing out of every device must not disconnect an agent, got ${r.status}`);
    });

    // Session revocation was checked in a branch the global optionalAuth() made unreachable, so
    // until now logging out revoked the row and the bearer carried on. Same fix, second symptom.
    await test('logging out actually ends the session it revoked', async () => {
        assert((await stillWorks(o.ownerToken)).ok, 'the owner token works before logout');
        const { status } = await json('/v1/auth/revoke', { method: 'POST', headers: auth });
        assert(status === 200, `revoke ${status}`);
        const after = await stillWorks(o.ownerToken);
        assert(!after.ok && after.status === 401, `a logged-out token must not authenticate, got ${after.status}`);
    });

    console.log('\nCleanup');
    await test('cascade-delete both owners', async () => {
        // Both signed themselves out above, so both log in again for the delete.
        for (const owner of [o.owner, o2.owner]) {
            const login = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: owner, password: 'RevokeMe123456' }),
            });
            assert(login.status === 200, `re-login ${owner}: ${login.status}`);
            const { status } = await json(`/v1/owners/${encodeURIComponent(owner)}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${login.body.data.token}` },
            });
            assert(status === 200, `delete owner ${owner}: ${status}`);
        }
    });
}

await run();

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent token revocation E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
