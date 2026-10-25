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
 *   - Phase 0: an operator, an owner, a second owner, the owner's agent, a client registered with
 *     the two portless loopback addresses and one https address
 *   - Phase 1: GET /v1/mcp/authorize accepts any port on a registered loopback address
 *   - Phase 2: POST /v1/mcp/authorize-consent refuses the second owner (403) and sends the owner's
 *     code to the ported address; POST /v1/mcp/token redeems it with that address and refuses
 *     another port
 *   - Phase 3: the refusals: other host, other path, https loopback, non-loopback port
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-oauth-loopback
 * @version-history
 *   v1.1.0 — 2026-10-25 — Phase 4: POST /v1/mcp/register refuses a client_name over 200 characters,
 *     more than 20 redirect_uris and a redirect URI over 2048 characters or not text, and accepts the
 *     shape Claude Code sends (secaudit2026oct22).
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
let stranger: RegisteredOwner;
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

function consent(redirectUri: string, pkce: McpPkce, ownerToken = owner.token) {
    return json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({
            client_id: clientId, gaii: agent.gaii, owner_token: ownerToken, state: 'loop',
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
    stranger = await registerOwner(BASE, `loopx${stamp}`);
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

await test('another owner cannot approve this owner\'s agent on the ported address: 403, and no code', async () => {
    const r = await consent(PORTED, mcpPkce(BASE), stranger.token);
    assert(r.status === 403 && r.body.error === 'access_denied', `a second owner approved: ${r.status} ${short(r.body)}`);
    assert(!('code' in r.body) && !('redirect_url' in r.body), `a code leaked: ${short(r.body)}`);
});

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

// ─── Phase 4 ───
// secaudit2026oct22 (dcr-unbounded-client-records): registration needs no credential and its rows
// stay, so each field has a ceiling no MCP client reaches.
console.log('\nPhase 4 — registration field limits');

const register = (body: unknown) => json('/v1/mcp/register', { method: 'POST', body: JSON.stringify(body) });

await test('a registration shaped like Claude Code\'s is accepted', async () => {
    const r = await register({ client_name: 'Claude Code (aimeat)', redirect_uris: [LOOPBACK_NAME, LOOPBACK_IP] });
    assert(r.status === 201 && typeof r.body.client_id === 'string', `register: ${r.status} ${short(r.body)}`);
    assert(r.body.redirect_uris?.length === 2, `uris echoed: ${short(r.body)}`);
});

await test('FAILURE: a client_name of 1 MB is refused 400, naming the field and its limit', async () => {
    const r = await register({ client_name: 'a'.repeat(1024 * 1024), redirect_uris: [LOOPBACK_NAME] });
    assert(r.status === 400 || r.status === 413, `expected 400 or 413, got ${r.status} ${short(r.body)}`);
    if (r.status === 400) assert(/client_name/.test(String(r.body.error_description)), `names the field: ${short(r.body)}`);
});

await test('FAILURE: a client_name of 201 characters is refused 400', async () => {
    const r = await register({ client_name: 'a'.repeat(201), redirect_uris: [LOOPBACK_NAME] });
    assert(r.status === 400 && /client_name/.test(String(r.body.error_description)), `expected 400 naming client_name, got ${r.status} ${short(r.body)}`);
});

await test('FAILURE: more than 20 redirect_uris are refused 400', async () => {
    const uris = Array.from({ length: 21 }, (_, i) => `http://localhost/cb${i}`);
    const r = await register({ client_name: 'many uris', redirect_uris: uris });
    assert(r.status === 400 && /redirect_uris/.test(String(r.body.error_description)), `expected 400 naming redirect_uris, got ${r.status} ${short(r.body)}`);
});

await test('FAILURE: a redirect URI longer than 2048 characters, or one that is not text, is refused 400', async () => {
    const long = await register({ client_name: 'long uri', redirect_uris: [`https://client.example.test/${'p'.repeat(2048)}`] });
    assert(long.status === 400, `long uri: expected 400, got ${long.status} ${short(long.body)}`);
    const notText = await register({ client_name: 'object uri', redirect_uris: [{ href: 'http://localhost/cb' }] });
    assert(notText.status === 400, `object uri: expected 400, got ${notText.status} ${short(notText.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
