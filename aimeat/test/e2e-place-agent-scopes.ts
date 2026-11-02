/**
 * @file test/e2e-place-agent-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a store place an agent has the place's tools by default (services/place-agent-scopes.ts;
 *   Jouni 2.11 07.42, "anna sille täyspääsy"), so a run does not fail on a refused tool call: on crew64 a
 *   morning digest failed whole because notify was refused. An agent holding only memory:read signs in on
 *   a store place and sends a notification, reads and writes its way through its tools over REST and MCP,
 *   and its record shows what it got. The words the owner keeps stay out of the token, and a node that is
 *   not a store place changes nothing.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=place-agent-scopes
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

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

const OWNER = `place${Date.now().toString(36)}`;
const PASSWORD = 'PlaceScopesPass12345';

/** An agent of the owner holding exactly `scopes` in its record. */
async function makeAgent(ownerToken: string, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner: OWNER, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    return { gaii: ag.body.data.agent.gaii as string, key: ag.body.data.private_key as string };
}

/** The agent signs in, as a crew run does at its start. */
async function signIn(agent: { gaii: string; key: string }): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii: agent.gaii, timestamp: ts, signature: await sign(agent.key, agent.gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

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
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-place-scopes', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string };
    };
}

(async () => {
    console.log('\n  e2e-place-agent-scopes\n');
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Place', password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Place', password: PASSWORD }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const signedIn = await ownerSignIn(BASE, OWNER, PASSWORD);
    assert(signedIn.status === 200, `sign-in ${signedIn.status}`);
    const owner = signedIn.body.data.token as string;
    const setPlan = (value: string) => json('/v1/admin/config', {
        method: 'PUT', headers: auth(owner), body: JSON.stringify({ changes: [{ path: 'site.purchase_plan', value }] }),
    });
    const notify = (tok: string) => json('/v1/notifications', {
        method: 'POST', headers: auth(tok), body: JSON.stringify({ title: 'From a run', body: 'The result.' }),
    });

    const elsewhere = await makeAgent(owner, 'elsewhere', ['memory:read']);
    const narrow = await makeAgent(owner, 'narrow', ['memory:read']);

    await test('a node that is not a store place changes nothing: the agent keeps its one word and notify is refused', async () => {
        const tok = await signIn(elsewhere);
        assert(JSON.stringify(claims(tok).scopes) === '["memory:read"]', `token ${JSON.stringify(claims(tok).scopes)}`);
        const n = await notify(tok);
        assert(n.status === 403, `notify ${n.status}`);
    });

    const on = await setPlan('Solo');
    assert(on.status === 200, `setting site.purchase_plan: ${on.status} ${JSON.stringify(on.body?.error)}`);
    try {
        // FAILED FIRST: on crew64 the run's notify was refused, and the runtime failed the whole run.
        await test('on a store place, an agent holding one word signs in and its tools work: notify, memory write, MCP', async () => {
            const tok = await signIn(narrow);
            const n = await notify(tok);
            assert(n.body?.ok === true, `notify ${n.status}: ${JSON.stringify(n.body?.error)}`);
            const w = await json('/v1/memory', { method: 'POST', headers: auth(tok), body: JSON.stringify({ key: 'run.result', value: { text: 'done' }, visibility: 'private' }) });
            assert(w.status === 201, `memory write ${w.status}: ${JSON.stringify(w.body?.error)}`);
            const call = await mcpSession(tok);
            const m = await call('aimeat_notify', { title: 'From a run over MCP', body: 'The result.' });
            assert(!m.isError, `aimeat_notify: ${m.text.slice(0, 200)}`);
        });

        await test('the agent\'s record says what it got, so the Agents tab tells the truth', async () => {
            const list = await json(`/v1/agents?owner=${OWNER}`, { headers: auth(owner) });
            const rec = (list.body.data.agents as any[]).find(a => a.name === 'narrow');
            const held = (rec.default_scopes ?? rec.scopes ?? rec.defaultScopes) as string[];
            assert(held.includes('notifications:send') && held.includes('memory:read'), `record ${JSON.stringify(held)}`);
        });

        await test('DENIAL: the words the owner keeps stay out: approving agents, payments, sharing, secrets, security', async () => {
            const scopes = claims(await signIn(narrow)).scopes ?? [];
            for (const kept of ['agent:write', 'commerce:buy', 'commerce:sell', 'commerce:psp', 'exchange:write', 'exchange:beneficiary', 'consent:manage', 'share:manage',
                'secrets:manage', 'account:security', 'agent:permissions', 'mcp:manage', 'organism:invite', 'connections:read-as-owner']) {
                assert(!scopes.includes(kept), `${kept} reached the token`);
            }
            assert(!scopes.includes('*'), 'a wildcard reached the token');
            // The rest of the place's tools: an ordinary tool's word arrives.
            for (const word of ['memory:purge', 'organism:write', 'ext:invoke', 'task:write']) assert(scopes.includes(word), `${word} is missing`);
        });

        await test('a word the owner takes away stays away: the default applies once', async () => {
            const list = await json(`/v1/agents?owner=${OWNER}`, { headers: auth(owner) });
            const rec = (list.body.data.agents as any[]).find(a => a.name === 'narrow');
            const held = (rec.default_scopes ?? rec.scopes ?? rec.defaultScopes) as string[];
            const narrowed = held.filter(s => s !== 'notifications:send');
            const set = await json(`/v1/agents/narrow/scopes`, { method: 'PATCH', headers: auth(owner), body: JSON.stringify({ scopes: narrowed }) });
            assert(set.status === 200, `narrowing ${set.status}: ${JSON.stringify(set.body?.error)}`);
            const again = claims(await signIn(narrow)).scopes ?? [];
            assert(!again.includes('notifications:send'), 'the word the owner took away came back at the next sign-in');
            assert(again.includes('memory:write'), `the rest stays: ${again.length} words`);
            const n = await notify(await signIn(narrow));
            assert(n.status === 403, `notify after the owner took it away: ${n.status}`);
        });

        await test('DENIAL: a door the owner keeps refuses the agent: it cannot read the secrets list', async () => {
            const tok = await signIn(narrow);
            const r = await json('/v1/secrets', { headers: auth(tok) });
            assert(r.status === 403, `secrets ${r.status}`);
        });
    } finally {
        await setPlan('');
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
