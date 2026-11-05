/**
 * @file test/e2e-place-agent-default-at-approval.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a store place (site.purchase_plan set) an agent gets the place's default words when
 *   it is approved, and every agent that exists when the plan is set gets them then, in one write
 *   (services/place-agent-scopes.ts; codebase analysis 2026-11-03, decision 8b of 2026-11-05). A token
 *   mint copies the record and adds nothing, so a word the owner removed stays removed, and an agent
 *   used only through MCP OAuth has the words too. A node with no purchase plan changes nothing.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=place-agent-default-at-approval
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 8b of 2026-11-05).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { mcpPkce, authorizeParams, tokenParams } from './helpers/mcp-oauth-pkce.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (err) { failed++; console.log(`  ✗ ${name}\n      ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const claims = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString('utf8')) as { scopes?: string[] };
const sorted = (words: string[] | undefined) => JSON.stringify([...(words ?? [])].sort());

const OWNER = `placeappr${Date.now().toString(36)}`;
const PASSWORD = 'PlaceApprovalPass12345';

interface Agent { gaii: string; key: string; scopes: string[] }

/** An agent of the owner holding exactly `scopes` as it asks for them; the answer's own scope list kept. */
async function makeAgent(ownerToken: string, name: string, scopes: string[]): Promise<Agent> {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner: OWNER, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    return { gaii: ag.body.data.agent.gaii as string, key: ag.body.data.private_key as string, scopes: ag.body.data.agent.scopes as string[] };
}

/** The agent's signed challenge, POST /v1/auth/token. */
async function signIn(agent: Agent): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii: agent.gaii, timestamp: ts, signature: await sign(agent.key, agent.gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

/** POST /v1/auth/refresh with the agent's own session. */
async function refresh(tok: string): Promise<string> {
    const r = await json('/v1/auth/refresh', { method: 'POST', headers: auth(tok) });
    assert(r.status === 200 && typeof r.body?.data?.token === 'string', `refresh ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.token as string;
}

/** The MCP OAuth code exchange with the agent's own key, as a client that only ever uses MCP does. */
async function mcpOAuthToken(agent: Agent): Promise<string> {
    const nodeId = agent.gaii.slice(agent.gaii.lastIndexOf('@') + 1);
    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'place default e2e', redirect_uris: [] }) });
    assert(client.status === 201 || client.status === 200, `mcp register ${client.status}`);
    const ts = new Date().toISOString();
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agent.gaii,
        signature: await sign(agent.key, agent.gaii + nodeId + ts), timestamp: ts,
        ...authorizeParams(pkce),
    });
    const authz = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authz.body?.code === 'string', `mcp authorize ${authz.status}: ${JSON.stringify(authz.body).slice(0, 200)}`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret, ...tokenParams(pkce) }) });
    assert(tok.status === 200 && typeof tok.body?.access_token === 'string', `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return tok.body.access_token as string;
}

/** An MCP session on `token`; answers a tools/call function. */
async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-place-default', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string };
    };
}

(async () => {
    console.log('\n  e2e-place-agent-default-at-approval\n');
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Place approval', password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Place approval', password: PASSWORD }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const signedIn = await ownerSignIn(BASE, OWNER, PASSWORD);
    assert(signedIn.status === 200, `sign-in ${signedIn.status}`);
    const owner = signedIn.body.data.token as string;
    const setPlan = (value: string) => json('/v1/admin/config', {
        method: 'PUT', headers: auth(owner), body: JSON.stringify({ changes: [{ path: 'site.purchase_plan', value }] }),
    });
    const held = async (name: string) => {
        const list = await json(`/v1/agents?owner=${OWNER}`, { headers: auth(owner) });
        const rec = (list.body.data.agents as any[]).find(a => a.name === name);
        return (rec.default_scopes ?? rec.scopes ?? rec.defaultScopes) as string[];
    };
    const notify = (tok: string) => json('/v1/notifications', {
        method: 'POST', headers: auth(tok), body: JSON.stringify({ title: 'From a run', body: 'The result.' }),
    });

    // A node with no purchase plan (aimeat.io): the agent holds what it asked for at approval, at every
    // mint, and on its record, and nothing else moves.
    const plain = await makeAgent(owner, 'plain', ['memory:read']);
    await test('a node with no purchase plan changes nothing: approval, record and every mint hold what the agent asked for', async () => {
        assert(sorted(plain.scopes) === '["memory:read"]', `approval answer ${sorted(plain.scopes)}`);
        assert(sorted(await held('plain')) === '["memory:read"]', `record ${sorted(await held('plain'))}`);
        const tok = await signIn(plain);
        assert(sorted(claims(tok).scopes) === '["memory:read"]', `token ${sorted(claims(tok).scopes)}`);
        assert(sorted(claims(await refresh(tok)).scopes) === '["memory:read"]', 'the refresh added a word');
        assert(sorted(claims(await mcpOAuthToken(plain)).scopes) === '["memory:read"]', 'the MCP OAuth token added a word');
        const other = await json('/v1/admin/config', { method: 'PUT', headers: auth(owner), body: JSON.stringify({ changes: [{ path: 'site.purchase_package', value: 'Starter' }] }) });
        assert(other.status === 200, `another setting: ${other.status}`);
        await json('/v1/admin/config', { method: 'PUT', headers: auth(owner), body: JSON.stringify({ changes: [{ path: 'site.purchase_package', value: '' }] }) });
        assert(sorted(await held('plain')) === '["memory:read"]', `record after another setting ${sorted(await held('plain'))}`);
        assert((await notify(tok)).status === 403, 'notify is refused without the word');
    });

    // Made before the plan is set and never signed in: only the setting can give it the words.
    const early = await makeAgent(owner, 'early', ['memory:read']);
    const oauthOnly = await makeAgent(owner, 'oauthonly', ['memory:read']);

    const on = await setPlan('Solo');
    assert(on.status === 200, `setting site.purchase_plan: ${on.status} ${JSON.stringify(on.body?.error)}`);
    try {
        // FAILED FIRST: the record kept its one word until the agent's first token mint.
        await test('setting the plan gives every existing agent the default on its record at once, before any token', async () => {
            const words = await held('early');
            for (const w of ['memory:read', 'notifications:send', 'memory:write', 'exchange:invoke']) assert(words.includes(w), `${w} missing from ${sorted(words)}`);
            for (const kept of ['agent:write', 'commerce:buy', 'exchange:write', 'secrets:manage', 'consent:manage']) assert(!words.includes(kept), `${kept} reached the record`);
            assert(!words.includes('*'), 'a wildcard reached the record');
        });

        // FAILED FIRST: the MCP OAuth mint copied the record, which never got the words.
        await test('an agent used only through MCP OAuth has the default: its token carries it and its notify works', async () => {
            const tok = await mcpOAuthToken(oauthOnly);
            assert((claims(tok).scopes ?? []).includes('notifications:send'), `MCP OAuth token ${sorted(claims(tok).scopes)}`);
            const call = await mcpSession(tok);
            const m = await call('aimeat_notify', { title: 'From an MCP client', body: 'The result.' });
            assert(!m.isError, `aimeat_notify: ${m.text.slice(0, 200)}`);
        });

        // FAILED FIRST: POST /v1/agents answered and stored the asked words only.
        await test('an agent the owner approves on a store place has the default at approval: the answer and the record say so', async () => {
            const approved = await makeAgent(owner, 'approvedhere', ['memory:read']);
            assert(approved.scopes.includes('notifications:send') && approved.scopes.includes('memory:read'), `approval answer ${sorted(approved.scopes)}`);
            assert(sorted(await held('approvedhere')) === sorted(approved.scopes), 'the record and the answer agree');
            assert(sorted(claims(await signIn(approved)).scopes) === sorted(approved.scopes), 'the first mint copies the record');
        });

        // FAILED FIRST: the first sign-in after the owner's narrowing added the default.
        await test('a token mint adds nothing: a word the owner removes stays removed at every mint', async () => {
            const set = await json('/v1/agents/early/scopes', { method: 'PATCH', headers: auth(owner), body: JSON.stringify({ scopes: ['memory:read'] }) });
            assert(set.status === 200, `narrowing ${set.status}: ${JSON.stringify(set.body?.error)}`);
            const tok = await signIn(early);
            assert(sorted(claims(tok).scopes) === '["memory:read"]', `signed challenge ${sorted(claims(tok).scopes)}`);
            assert(sorted(claims(await refresh(tok)).scopes) === '["memory:read"]', 'the refresh added a word');
            assert(sorted(claims(await mcpOAuthToken(early)).scopes) === '["memory:read"]', 'the MCP OAuth token added a word');
            assert(sorted(await held('early')) === '["memory:read"]', `record ${sorted(await held('early'))}`);
        });

        await test('setting the plan again gives nothing more to an agent that had the default', async () => {
            assert((await setPlan('')).status === 200, 'clearing the plan');
            assert((await setPlan('Team')).status === 200, 'setting the plan again');
            assert(sorted(await held('early')) === '["memory:read"]', `record ${sorted(await held('early'))}`);
        });

        // FAILED FIRST: an agent made while no plan was set got the words only at its first mint.
        await test('an agent made while no plan is set gets the default when the plan is set later', async () => {
            assert((await setPlan('')).status === 200, 'clearing the plan');
            const between = await makeAgent(owner, 'between', ['memory:read']);
            assert(sorted(between.scopes) === '["memory:read"]', `without a plan the approval adds nothing: ${sorted(between.scopes)}`);
            assert((await setPlan('Solo')).status === 200, 'setting the plan');
            assert((await held('between')).includes('notifications:send'), `record ${sorted(await held('between'))}`);
            // The agent made and used before the first plan was set has it too, from that first write.
            assert((await held('plain')).includes('notifications:send'), `plain ${sorted(await held('plain'))}`);
        });
    } finally {
        await setPlan('');
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
