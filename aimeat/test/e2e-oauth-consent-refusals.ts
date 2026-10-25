/**
 * @file test/e2e-oauth-consent-refusals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refusals of the three routes where an account holder approves a machine with a
 *   credential sent in the request BODY, where no auth middleware runs and the handler's own check is
 *   the whole authorization:
 *     1. POST /v1/mcp/authorize-consent refuses one owner approving an OAuth connection for ANOTHER
 *        owner's agent (403, no authorization code), and refuses a redirect_uri the client did not
 *        register, including on a client that registered none.
 *     2. POST /v1/agents/verify refuses a device authorization approved with an agent token or an
 *        app-grant token of the same owner (401), and the request stays pending for the owner.
 *     3. The app half of OAuth (GET /v1/app-grants/authorize, POST /v1/app-grants/token) refuses an
 *        authorize without a PKCE challenge, a token request with a wrong or a missing verifier, and
 *        a token request with another redirect_uri. A refused code is spent.
 *
 *   WHY. Each refusal is one line in its handler, and until this suite no test sent the request it
 *   refuses: every consent and every device approval in test/ carried a token of the right owner,
 *   and every app-grant code exchange carried the matching verifier. Removing any of those lines left
 *   every suite green. Each phase also runs the allowed request with the same fixtures, so a refusal
 *   cannot pass because the fixture was broken.
 *
 *   It replaces test/unit/mcp-oauth.test.ts (deleted on 2026-10-16), whose cases compared object
 *   literals and imported nothing from src/: its owner-mismatch case is phase 1 here, and its two
 *   redirect_uri cases are the two redirect refusals of phase 1.
 * @structure
 *   - Phase 0: an operator, owners A and B, A's agent, A's published app, A's app-grant token
 *   - Phase 1: MCP consent: the cross-owner refusal, the control, the redirect_uri refusals
 *   - Phase 2: device verify: agent token and app-grant token refused, the owner still approves
 *   - Phase 3: app-grant PKCE and redirect_uri refusals at authorize and token
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-oauth-consent-refusals
 * @version-history
 *   v1.1.0 — 2026-10-25 — The token names the client by its registered name, not a posted client_name (secaudit2026oct22).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F01a-01, F21a-01, F21a-02).
 */
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const MCP_REDIRECT = 'https://client.example.test/oauth/callback';
const APP_REDIRECT = 'http://localhost:9911/callback';
const APP_FILE = 'consent-refusals.html';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body, headers: res.headers };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

let alice: RegisteredOwner;
let bob: RegisteredOwner;
let aliceAgent: McpAgent;
let appToken = '';

// ─── App-grant helpers ───

interface Pkce { verifier: string; challenge: string }
function pkce(): Pkce {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeQuery(p: Pkce | null, extra: Record<string, string> = {}): string {
    return new URLSearchParams({
        app: `${alice.name}/${APP_FILE}`, response_type: 'code', scope: 'memory:read', redirect_uri: APP_REDIRECT,
        ...(p ? { code_challenge: p.challenge, code_challenge_method: 'S256' } : {}),
        ...extra,
    }).toString();
}

/** authorize → the owner's consent → an authorization code bound to `p`. */
async function appCode(p: Pkce): Promise<string> {
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${authorizeQuery(p)}`, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const m = /req=([^&]+)/.exec(loc);
    if (res.status !== 302 || !m) throw new Error(`authorize: ${res.status} ${loc} ${short(await res.text())}`);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ request_id: decodeURIComponent(m[1]) }),
    });
    if (con.status !== 200) throw new Error(`consent: ${con.status} ${short(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code');
    if (!code) throw new Error(`no code in ${con.body.data.redirect_url}`);
    return code;
}

function exchange(code: string, fields: Record<string, unknown>) {
    return json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, ...fields }),
    });
}

console.log('\n=== OAUTH CONSENT REFUSALS E2E (MCP consent, device verify, app-grant PKCE) ===\n');
console.log('Phase 0 — fixtures');

await test('An operator, owners A and B, and an agent of A', async () => {
    await registerOwner(BASE, `ocrop${stamp}`);         // first owner: the operator, so A and B are plain owners
    alice = await registerOwner(BASE, `ocra${stamp}`);
    bob = await registerOwner(BASE, `ocrb${stamp}`);
    aliceAgent = await makeAgent(BASE, alice, ['memory:read', 'agent:write']);
    assert(aliceAgent.gaii.includes(`#${alice.name}@`), `agent gaii: ${aliceAgent.gaii}`);
});

await test('A publishes an app and holds an app-grant token for it (the allowed PKCE exchange)', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({
            filename: APP_FILE, name: 'Consent refusals', description: 'app for the consent refusal suite', category: 'utility',
            content: Buffer.from('<!DOCTYPE html><html><body>consent</body></html>', 'utf8').toString('base64'),
        }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${short(pub.body)}`);
    const p = pkce();
    const tok = await exchange(await appCode(p), { code_verifier: p.verifier });
    assert(tok.status === 200 && typeof tok.body.data?.access_token === 'string', `control exchange: ${tok.status} ${short(tok.body)}`);
    appToken = tok.body.data.access_token;
});

// ─── Phase 1 ───
console.log('\nPhase 1 — POST /v1/mcp/authorize-consent: which owner, and which redirect');

async function mcpClient(redirectUris?: string[]): Promise<string> {
    const reg = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `consent-${stamp}`, ...(redirectUris ? { redirect_uris: redirectUris } : {}) }),
    });
    assert(reg.status === 201 && typeof reg.body.client_id === 'string', `register: ${reg.status} ${short(reg.body)}`);
    return reg.body.client_id as string;
}

function consent(clientId: string, gaii: string, ownerToken: string, redirectUri?: string) {
    return json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({
            client_id: clientId, gaii, owner_token: ownerToken, state: 'ocr',
            ...(redirectUri ? { redirect_uri: redirectUri } : {}), ...authorizeParams(mcpPkce(BASE)),
        }),
    });
}

let registeredClient = '';

await test('Owner B cannot approve an OAuth connection for owner A\'s agent: 403, and no code', async () => {
    registeredClient = await mcpClient([MCP_REDIRECT]);
    const r = await consent(registeredClient, aliceAgent.gaii, bob.token, MCP_REDIRECT);
    assert(r.status === 403, `a stranger approved a consent for another owner's agent: ${r.status} ${short(r.body)}`);
    assert(r.body.error === 'access_denied' && /does not belong to you/i.test(r.body.error_description ?? ''),
        `refused for the wrong reason: ${short(r.body)}`);
    assert(!('code' in r.body) && !('redirect_url' in r.body), `an authorization code leaked: ${short(r.body)}`);
});

await test('Owner A approves the same client for the same agent: the refusal above was the owner, not the fixture', async () => {
    const r = await consent(registeredClient, aliceAgent.gaii, alice.token, MCP_REDIRECT);
    assert(r.status === 200 && typeof r.body.redirect_url === 'string', `the owner must approve: ${r.status} ${short(r.body)}`);
    const url = new URL(r.body.redirect_url);
    assert(url.origin + url.pathname === MCP_REDIRECT && !!url.searchParams.get('code'), `redirect: ${r.body.redirect_url}`);
});

await test('A redirect_uri the client did not register is refused (400), and no code is issued', async () => {
    const r = await consent(registeredClient, aliceAgent.gaii, alice.token, 'https://attacker.example.test/steal');
    assert(r.status === 400 && r.body.error === 'invalid_request', `unregistered redirect: ${r.status} ${short(r.body)}`);
    assert(/not registered/i.test(r.body.error_description ?? ''), `reason: ${short(r.body)}`);
    assert(!('code' in r.body) && !('redirect_url' in r.body), `code leaked: ${short(r.body)}`);
});

await test('A client that registered no redirect_uris may use none: any redirect_uri is refused (400)', async () => {
    const bare = await mcpClient();
    const r = await consent(bare, aliceAgent.gaii, alice.token, 'https://anywhere.example.test/cb');
    assert(r.status === 400 && r.body.error === 'invalid_request', `redirect on a client with none registered: ${r.status} ${short(r.body)}`);
    assert(!('code' in r.body) && !('redirect_url' in r.body), `code leaked: ${short(r.body)}`);
});

// secaudit2026oct22, mcp-oauth:consent-identity-from-request-not-verified-client. The consent page
// reads client_name from its own query, which a link can set, and POST /v1/mcp/authorize-consent
// preferred the posted name over the registered one; the token step stamped it as mcp_client.
await test('The token names the client by its registered name, not by a client_name the consent request posted', async () => {
    const reg = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `registered-${stamp}`, redirect_uris: [MCP_REDIRECT] }),
    });
    assert(reg.status === 201, `register: ${reg.status} ${short(reg.body)}`);
    const p = mcpPkce(BASE);
    const con = await json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({
            client_id: reg.body.client_id, client_name: 'A Name The Link Chose', gaii: aliceAgent.gaii, owner_token: alice.token,
            state: 'ocr', redirect_uri: MCP_REDIRECT, ...authorizeParams(p),
        }),
    });
    assert(con.status === 200, `consent: ${con.status} ${short(con.body)}`);
    const code = new URL(con.body.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code, client_id: reg.body.client_id, client_secret: reg.body.client_secret,
            redirect_uri: MCP_REDIRECT, ...tokenParams(p),
        }),
    });
    assert(tok.status === 200 && typeof tok.body.access_token === 'string', `token: ${tok.status} ${short(tok.body)}`);
    const claims = JSON.parse(Buffer.from(tok.body.access_token.split('.')[1], 'base64url').toString('utf8'));
    assert(claims.mcp_client === `registered-${stamp}`, `the token names the client ${JSON.stringify(claims.mcp_client)}`);
});

// ─── Phase 2 ───
console.log('\nPhase 2 — POST /v1/agents/verify: only the account holder in person approves');

let userCode = '';
let deviceCode = '';

await test('A device authorization for owner A is pending', async () => {
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: `dev${stamp}`, owner: alice.name }),
    });
    assert(r.status === 200 && r.body.data?.status === 'pending', `device-authorize: ${r.status} ${short(r.body)}`);
    userCode = r.body.data.user_code;
    deviceCode = r.body.data.device_code;
});

await test('An agent token of the same owner cannot approve it, even asking for *: 401', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['*'], owner_token: aliceAgent.token }),
    });
    assert(r.status === 401 && r.body.error?.code === 'AUTH_REQUIRED', `an agent approved a sibling: ${r.status} ${short(r.body)}`);
});

await test('An app-grant token of the same owner cannot approve it: 401', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read'], owner_token: appToken }),
    });
    assert(r.status === 401 && r.body.error?.code === 'AUTH_REQUIRED', `an app grant approved an agent: ${r.status} ${short(r.body)}`);
});

await test('An agent token cannot DENY it either: 401, the request is the owner\'s to settle', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode, action: 'deny', owner_token: aliceAgent.token }),
    });
    assert(r.status === 401, `an agent denied the owner's request: ${r.status} ${short(r.body)}`);
});

await test('The request is still pending: owner A approves it with memory:read, and the credential carries exactly that', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read'], owner_token: alice.token }),
    });
    assert(r.status === 200 && r.body.data?.status === 'approved', `owner approval: ${r.status} ${short(r.body)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200, `poll: ${poll.status} ${short(poll.body)}`);
    const token = poll.body.access_token ?? poll.body.data?.access_token ?? poll.body.data?.token;
    assert(typeof token === 'string', `no token in the poll: ${short(poll.body)}`);
    const scopes = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).scopes as string[];
    assert(JSON.stringify(scopes) === JSON.stringify(['memory:read']), `the credential carries ${JSON.stringify(scopes)}, not what the owner chose`);
});

// ─── Phase 3 ───
console.log('\nPhase 3 — the app half of OAuth: PKCE and redirect_uri');

await test('authorize without a code_challenge: 400 PKCE_REQUIRED', async () => {
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${authorizeQuery(null)}`, { redirect: 'manual', headers: { Accept: 'application/json' } });
    const body = await res.json() as any;
    assert(res.status === 400 && body.error?.code === 'PKCE_REQUIRED', `no challenge: ${res.status} ${short(body)}`);
});

await test('authorize with a challenge and no method: 400 PKCE_REQUIRED', async () => {
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${authorizeQuery(null, { code_challenge: pkce().challenge })}`, { redirect: 'manual', headers: { Accept: 'application/json' } });
    const body = await res.json() as any;
    assert(res.status === 400 && body.error?.code === 'PKCE_REQUIRED', `no method: ${res.status} ${short(body)}`);
});

await test('token with another verifier: 400 INVALID_GRANT, and the code is spent for the right verifier too', async () => {
    const p = pkce();
    const code = await appCode(p);
    const wrong = await exchange(code, { code_verifier: pkce().verifier });
    assert(wrong.status === 400 && wrong.body.error?.code === 'INVALID_GRANT', `wrong verifier: ${wrong.status} ${short(wrong.body)}`);
    assert(/PKCE/i.test(wrong.body.error?.message ?? ''), `refused for another reason: ${short(wrong.body)}`);
    assert(!wrong.body.data?.access_token, `a token was issued: ${short(wrong.body)}`);
    const after = await exchange(code, { code_verifier: p.verifier });
    assert(after.status === 400 && !after.body.data?.access_token, `a refused code was redeemed afterwards: ${after.status} ${short(after.body)}`);
});

await test('token with no verifier: 400 INVALID_GRANT, no token', async () => {
    const code = await appCode(pkce());
    const r = await exchange(code, {});
    assert(r.status === 400 && r.body.error?.code === 'INVALID_GRANT' && /PKCE/i.test(r.body.error?.message ?? ''), `no verifier: ${r.status} ${short(r.body)}`);
    assert(!r.body.data?.access_token, `a token was issued: ${short(r.body)}`);
});

await test('token with the right verifier but another redirect_uri: 400 INVALID_GRANT, no token', async () => {
    const p = pkce();
    const code = await appCode(p);
    const r = await exchange(code, { code_verifier: p.verifier, redirect_uri: 'http://localhost:9911/other' });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_GRANT' && /redirect_uri/i.test(r.body.error?.message ?? ''), `redirect mismatch: ${r.status} ${short(r.body)}`);
    assert(!r.body.data?.access_token, `a token was issued: ${short(r.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
