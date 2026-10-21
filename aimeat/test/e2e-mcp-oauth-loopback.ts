/**
 * @file test/e2e-mcp-oauth-loopback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A command-line MCP client signs in with a loopback redirect on a port it chose at run
 *   time, as RFC 8252 §7.3 requires: it registers `http://localhost/callback` and
 *   `http://127.0.0.1/callback` (the two addresses Claude Code's Client ID Metadata Document lists)
 *   and sends `http://localhost:<ephemeral>/callback`.
 *
 *   WHY. Both MCP OAuth routes compared the redirect_uri as a string, so the port made it a
 *   different address, and every Claude Code sign-in to aimeat.io ended in
 *   `redirect_uri not registered` (reported 2026-10-21). The whole flow runs here: authorize
 *   (302 to the consent page), consent (the code goes to the ported address), token (the code is
 *   redeemed with that same address). The refusals beside it hold what stays exact: another host,
 *   another path, https, a non-loopback host on another port, and the token request on a different
 *   port from the one the code was issued for.
 * @structure
 *   - Phase 0: an operator, an owner, the owner's agent, a client registered with the two portless
 *     loopback addresses and one https address
 *   - Phase 1: GET /v1/mcp/authorize accepts any port on a registered loopback address
 *   - Phase 2: POST /v1/mcp/authorize-consent sends the code to the ported address; POST /v1/mcp/token
 *     redeems it with that address and refuses another port
 *   - Phase 3: the refusals: other host, other path, https loopback, non-loopback port
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-oauth-loopback
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial: Claude Code could not sign in to aimeat.io. Failed on the old code first.
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { authorizeParams, mcpPkce, tokenParams, type McpPkce } from './helpers/mcp-oauth-pkce.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
/** The two addresses Claude Code's metadata document lists, with no port. */
const LOOPBACK_NAME = 'http://localhost/callback';
const LOOPBACK_IP = 'http://127.0.0.1/callback';
const HTTPS_REDIRECT = 'https://client.example.test:8443/oauth/callback';

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
            ...opts, redirect: 'manual',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers ?? {}) },
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

let owner: RegisteredOwner;
let agent: McpAgent;
let clientId = '';
let clientSecret = '';

function authorize(redirectUri: string, pkce: McpPkce = mcpPkce(BASE)) {
    const q = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'loop', scope: 'aimeat:full',
        ...authorizeParams(pkce),
    });
    return json(`/v1/mcp/authorize?${q}`);
}

function consent(redirectUri: string, pkce: McpPkce) {
    return json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({
            client_id: clientId, gaii: agent.gaii, owner_token: owner.token, state: 'loop',
            redirect_uri: redirectUri, ...authorizeParams(pkce),
        }),
    });
}

function token(code: string, redirectUri: string, pkce: McpPkce) {
    return json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, ...tokenParams(pkce),
        }),
    });
}

function refusedAsUnregistered(r: { status: number; body: any }, label: string): void {
    assert(r.status === 400 && r.body.error === 'invalid_request', `${label}: ${r.status} ${short(r.body)}`);
    assert(!('code' in r.body) && !('redirect_url' in r.body), `${label}: a code leaked: ${short(r.body)}`);
}

// ─── Phase 0 ───
console.log('\nPhase 0 — an owner, an agent, a client with portless loopback redirects');

await test('setup: operator, owner, agent, registered client', async () => {
    await registerOwner(BASE, `loopop${stamp}`);         // the first owner is the operator
    owner = await registerOwner(BASE, `loop${stamp}`);
    agent = await makeAgent(BASE, owner, ['memory:read']);
    const reg = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `loopback-${stamp}`, redirect_uris: [LOOPBACK_NAME, LOOPBACK_IP, HTTPS_REDIRECT] }),
    });
    assert(reg.status === 201 && typeof reg.body.client_id === 'string', `register: ${reg.status} ${short(reg.body)}`);
    clientId = reg.body.client_id;
    clientSecret = reg.body.client_secret;
});

// ─── Phase 1 ───
console.log('\nPhase 1 — GET /v1/mcp/authorize: a loopback address on any port');

for (const uri of ['http://localhost:62067/callback', 'http://127.0.0.1:51123/callback', LOOPBACK_NAME]) {
    await test(`authorize with ${uri} goes on to the consent page (302)`, async () => {
        const r = await authorize(uri);
        assert(r.status === 302, `authorize: ${r.status} ${short(r.body)}`);
        const to = new URL(r.headers.get('location') ?? '', BASE);
        assert(to.pathname === '/v1/oauth/consent' && to.searchParams.get('redirect_uri') === uri,
            `went to ${r.headers.get('location')}`);
    });
}

// ─── Phase 2 ───
console.log('\nPhase 2 — consent and token on the port the client chose');

const PORTED = 'http://localhost:62067/callback';
const pkce = mcpPkce(BASE);
let code = '';

await test('consent sends the code to the ported address, port included', async () => {
    const r = await consent(PORTED, pkce);
    assert(r.status === 200 && typeof r.body.redirect_url === 'string', `consent: ${r.status} ${short(r.body)}`);
    const url = new URL(r.body.redirect_url);
    assert(url.origin === 'http://localhost:62067' && url.pathname === '/callback', `redirect: ${r.body.redirect_url}`);
    code = url.searchParams.get('code') ?? '';
    assert(code !== '' && url.searchParams.get('state') === 'loop', `code or state missing: ${r.body.redirect_url}`);
});

await test('token refuses the code on a different port from the one it was issued for', async () => {
    const r = await token(code, 'http://localhost:9999/callback', pkce);
    assert(r.status === 400 && r.body.error === 'invalid_grant', `other port at token: ${r.status} ${short(r.body)}`);
});

await test('the same flow again: token redeems a fresh code with the ported address it was issued for', async () => {
    const p = mcpPkce(BASE);
    const c = await consent(PORTED, p);
    assert(c.status === 200, `consent: ${c.status} ${short(c.body)}`);
    const fresh = new URL(c.body.redirect_url).searchParams.get('code') ?? '';
    const r = await token(fresh, PORTED, p);
    assert(r.status === 200 && typeof r.body.access_token === 'string', `token: ${r.status} ${short(r.body)}`);
});

// ─── Phase 3 ───
console.log('\nPhase 3 — what stays exact');

const refused: Array<[string, string]> = [
    ['another loopback path', 'http://localhost:62067/other'],
    ['a loopback host the client did not register', 'http://[::1]:62067/callback'],
    ['https on a loopback host', 'https://localhost:62067/callback'],
    ['a non-loopback host on another port', 'https://client.example.test:9443/oauth/callback'],
    ['a stranger host on the loopback path', 'http://attacker.example.test:62067/callback'],
    ['a loopback address with userinfo', 'http://evil@localhost:62067/callback'],
];

for (const [label, uri] of refused) {
    await test(`authorize refuses ${label} (${uri})`, async () => {
        refusedAsUnregistered(await authorize(uri), label);
    });
    await test(`consent refuses ${label}`, async () => {
        refusedAsUnregistered(await consent(uri, mcpPkce(BASE)), label);
    });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
