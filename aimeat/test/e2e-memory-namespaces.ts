/**
 * @file e2e-memory-namespaces.ts
 * @description E2E for the same-owner memory namespace model — the rule that memory is keyed by
 *   the WRITER, and everything that follows from it. This behaviour had NO test coverage, and its
 *   absence cost real time: an agent read a key an app had saved, got a bare "not found", and the
 *   conclusion drawn was that the platform could not share owner data between an app and an agent
 *   at all. It can — through an app-grant credential — and the difference is which token you hold.
 *
 *   Locks in, on both surfaces:
 *     1. A plain AGENT token writes into the agent's own GAII namespace, never the owner's.
 *     2. An APP-GRANT token (sub = owner GHII, roles ['app']) writes into the OWNER's namespace.
 *     3. GET /v1/memory/:key?owner_scope=true reads across the union; without it, an agent sees
 *        only its own namespace.
 *     4. When a key exists under BOTH, owner-scope resolves GHII-first and the agent's copy is
 *        shadowed — reported as `also_under` on the survivor instead of vanishing silently.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-memory-namespaces
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial. Written after the namespace model was mis-diagnosed as a
 *     platform limitation; these assertions are what stop a refactor changing it silently.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
// Read from the node's own response envelope during setup rather than guessing: the owner
// signature is over `owner + nodeId + timestamp`, so a wrong id is an opaque 'Invalid signature'.
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

const owner = `nsowner${Date.now() % 1000000}`;
const FILENAME = 'ns-demo.html';
const REDIRECT = 'http://localhost:9911/callback';
const SHARED_KEY = 'nstest.shared.doc';
const AGENT_ONLY_KEY = 'nstest.agentonly.doc';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(subject: string, priv: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    // Agents sign `gaii + timestamp`; owners sign `owner + nodeId + timestamp`. Different messages.
    const signature = await signMsg(priv, isAgent ? subject + timestamp : subject + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(isAgent ? { gaii: subject, timestamp, signature } : { owner: subject, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

let ownerToken = '', ownerPriv = '';
let agentGaii = '', agentToken = '', agentPriv = '';
let appToken = '';
const ownerGhii = () => `${owner}@${NODE_ID}`;

async function main() {
    console.log('\n=== Memory namespaces (agent GAII vs owner GHII) E2E ===\n');
    console.log('Setup');

    await test('register owner + agent + publish an app', async () => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register owner: ${reg.status}`);
        if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
        ownerPriv = reg.body.data.private_key;
        ownerToken = await getToken(owner, ownerPriv, false);

        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            // Explicit scopes: an agent minted without them gets the '*' wildcard, which would
            // satisfy every gate and make the write-as-owner refusal untestable.
            body: JSON.stringify({ name: 'nsbot', owner, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
        });
        assert(ag.status === 201, `register agent: ${ag.status} ${JSON.stringify(ag.body)}`);
        agentGaii = ag.body.data.agent.gaii;
        agentPriv = ag.body.data.private_key;
        agentToken = await getToken(agentGaii, agentPriv, true);

        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>ns</body></html>'), name: 'NS Demo', description: 'namespace demo', category: 'utility' }),
        });
        assert(pub.status === 201, `publish app: ${pub.status}`);
    });

    await test('mint an app-grant token (sub = owner GHII, roles ["app"])', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', scope: 'memory:read memory:write memory:delete',
            redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ request_id: rid }),
        });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.body.ok === true, `token exchange: ${JSON.stringify(tok.body.error)}`);
        appToken = tok.body.data.access_token;
        const claims = JSON.parse(Buffer.from(appToken.split('.')[1], 'base64url').toString());
        assert(claims.sub === ownerGhii(), `app-grant sub must be the owner GHII, got ${claims.sub}`);
        assert(Array.isArray(claims.roles) && claims.roles.includes('app'), 'app-grant carries roles ["app"]');
    });

    // ── 1. An APP-GRANT credential writes the OWNER's namespace ──────────────
    console.log('\nPhase 1: an app-grant token writes the OWNER namespace');

    await test('app-grant write lands under the owner GHII, not under an agent', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${appToken}` },
            body: JSON.stringify({ key: SHARED_KEY, value: { by: 'app' }, visibility: 'private' }),
        });
        assert(w.status === 201, `app write: ${w.status} ${JSON.stringify(w.body)}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === SHARED_KEY);
        assert(!!row, 'the app-written key is listed');
        assert(row.owner_gaii === ownerGhii(), `expected owner GHII, got ${row.owner_gaii}`);
    });

    // ── 2. A plain AGENT token writes its OWN namespace ──────────────────────
    console.log('\nPhase 2: a plain agent token writes its OWN namespace');

    await test('agent write lands under the agent GAII', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AGENT_ONLY_KEY, value: { by: 'agent' }, visibility: 'owner' }),
        });
        assert(w.status === 201, `agent write: ${w.status} ${JSON.stringify(w.body)}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === AGENT_ONLY_KEY);
        assert(!!row, 'the agent-written key is visible owner-scope');
        assert(row.owner_gaii === agentGaii, `expected the agent GAII, got ${row.owner_gaii}`);
    });

    await test('the agent CANNOT reach the app-written key without owner_scope', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(r.status === 404, `expected 404 in the agent's own namespace, got ${r.status}`);
    });

    await test('the agent CAN read it with ?owner_scope=true', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(r.status === 200, `owner_scope read: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.value.by === 'app', 'reads the app-written value');
    });

    // ── 3. Shadowing is real, and now visible ────────────────────────────────
    console.log('\nPhase 3: a same-key collision is reported, not hidden');

    await test('an agent copy of an owner-held key is shadowed GHII-first', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: SHARED_KEY, value: { by: 'agent-newer' }, visibility: 'owner' }),
        });
        assert(w.status === 201, `agent shadow write: ${w.status}`);
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.body.data.value.by === 'app', `GHII copy must win, got ${JSON.stringify(r.body.data.value)}`);
    });

    await test('the shadowed copy is named in also_under instead of disappearing', async () => {
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const rows = l.body.data.items.filter((i: any) => i.key === SHARED_KEY);
        assert(rows.length === 1, `dedup keeps one row, got ${rows.length}`);
        assert(rows[0].owner_gaii === ownerGhii(), 'the surviving row is the GHII copy');
        assert(Array.isArray(rows[0].also_under) && rows[0].also_under.includes(agentGaii),
            `also_under must name the shadowed agent copy, got ${JSON.stringify(rows[0].also_under)}`);
    });

    await test('a key held by only ONE identity carries no also_under', async () => {
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === AGENT_ONLY_KEY);
        assert(row && row.also_under === undefined, 'no collision means no also_under');
    });

    // ── 4. The app-grant credential can UPDATE the owner's record ────────────
    console.log('\nPhase 4: the app-grant credential updates the owner record itself');

    await test('app-grant PUT updates the owner copy (the round trip an agent token cannot do)', async () => {
        const cur = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const u = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${appToken}` },
            body: JSON.stringify({ value: { by: 'app-updated' }, visibility: 'private', version: cur.body.data.version }),
        });
        assert(u.status === 200, `app-grant update: ${u.status} ${JSON.stringify(u.body)}`);
        const after = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(after.body.data.value.by === 'app-updated', 'the owner record itself changed');
        assert(after.body.data.owner_gaii === undefined || after.body.data.owner_gaii === ownerGhii(),
            'still the owner copy');
    });

    // ── 5. …and can DELETE one, which is where the model had a hole ──────────
    //
    // An app-grant token lists across the owner scope, so an app renders keys its owner's AGENTS
    // wrote. Deleting one was refused, because the cross-namespace lookup on DELETE was written for
    // `roles:['owner']` alone. The result was a delete control pointing at a record it could never
    // remove — and for an app whose whole premise is "your AI writes these for you", that is every
    // record, for every user, not an edge case.
    //
    // This is not a widening of what an app may reach: the same credential already deletes anything
    // in the owner's OWN namespace, so fencing off the agent-written subset protected nothing.
    console.log('\nPhase 5: the app-grant credential deletes an agent-written key');

    await test('without owner_scope, an app-grant delete of an agent-only key still 404s', async () => {
        const d = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` },
        });
        assert(d.status === 404, `unscoped delete must stay in the caller's namespace, got ${d.status}`);
        const still = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(still.status === 200, 'and the record is untouched');
    });

    await test('with ?owner_scope=true, the app-grant deletes the agent-written key', async () => {
        const d = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` },
        });
        assert(d.status === 200, `owner-scope delete: ${d.status} ${JSON.stringify(d.body)}`);
    });

    await test('the record is gone from the owner scope, not merely hidden from the app', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 404, `expected the key to be gone, got ${r.status}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const rows = (l.body.data.items ?? []).filter((i: any) => i.key === AGENT_ONLY_KEY);
        assert(rows.length === 0, `owner-scope listing still returns it: ${JSON.stringify(rows)}`);
    });


    // == 4. memory:write-as-owner -- an agent writing INTO the owner's namespace ==
    //
    // Two conditions, both required. Most of these tests are about the cases that must REFUSE,
    // because the failures that matter are a silent redirect and a bypassed reserved-key guard.
    console.log('\nPhase 4: memory:write-as-owner');

    const AS_OWNER_KEY = 'nstest.asowner.note';
    const AS_OWNER_PUBLIC_KEY = 'nstest.asowner.public';

    await test('WITHOUT the scope: owner_scope is refused, and nothing is written anywhere', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_KEY, value: { by: 'agent' }, owner_scope: true }),
        });
        assert(w.status === 403, `expected 403 without the scope, got ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.error?.code === 'SCOPE_DENIED', `code: ${w.body.error?.code}`);
        const r = await json(`/v1/memory/${encodeURIComponent(AS_OWNER_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 404, 'a refused write must not leave a record behind');
    });

    await test('WITHOUT the flag: an agent write still lands in the AGENT namespace', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.asowner.unmoved', value: { by: 'agent' } }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === agentGaii,
            `ordinary writes must not move, got ${w.body.data.owner_gaii}`);
    });

    await test('the owner grants memory:write-as-owner', async () => {
        const p = await json('/v1/agents/nsbot/scopes', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:write-as-owner'] }),
        });
        assert(p.status === 200, `grant: ${p.status} ${JSON.stringify(p.body)}`);
        agentToken = await getToken(agentGaii, agentPriv, true);   // a live token keeps its old scopes
    });

    await test('WITH the scope AND the flag: the write lands under the OWNER GHII', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_KEY, value: { by: 'agent-as-owner' }, owner_scope: true }),
        });
        assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data.owner_gaii === ownerGhii(),
            `expected the owner GHII, got ${w.body.data.owner_gaii}`);
    });

    await test('the OWNER reads it as their own record, no owner_scope needed', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(AS_OWNER_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 200, `owner read: ${r.status}`);
        assert(r.body.data.value.by === 'agent-as-owner', `value: ${JSON.stringify(r.body.data.value)}`);
    });

    await test('THE GUARD: a reserved server-trusted key is refused even with the scope', async () => {
        for (const key of ['openrouter.settings', 'ai-usage.today', 'profile.card']) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
                body: JSON.stringify({ key, value: { evil: true }, owner_scope: true }),
            });
            assert(w.status === 403, `${key} must be refused, got ${w.status}`);
            assert(w.body.error?.code === 'RESERVED_KEY', `${key} code: ${w.body.error?.code}`);
        }
    });

    await test('visibility is untouched: a public record written as the owner stays public', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_PUBLIC_KEY, value: { hello: 'world' }, visibility: 'public', owner_scope: true }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === ownerGhii(), 'lands under the owner');
        assert(w.body.data.visibility === 'public', `visibility must survive, got ${w.body.data.visibility}`);
        const pub = await json(`/v1/memory/${encodeURIComponent(ownerGhii())}/${encodeURIComponent(AS_OWNER_PUBLIC_KEY)}`);
        assert(pub.status === 200, `public read: ${pub.status} ${JSON.stringify(pub.body)}`);
    });



    await test('a WILDCARD agent still cannot write the reserved keys', async () => {
        // The one deliberate break from the '*'-bundles-everything convention. "Full access" is one
        // click; redirecting a decrypted AI key is not what someone is choosing when they click it.
        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'nswild', owner, capabilities: ['memory'], scopes: ['*'] }),
        });
        assert(ag.status === 201, `register wildcard agent: ${ag.status}`);
        const wildToken = await getToken(ag.body.data.agent.gaii, ag.body.data.private_key, true);
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${wildToken}` },
            body: JSON.stringify({ key: 'openrouter.settings', value: { baseUrl: 'https://evil.test' }, owner_scope: true }),
        });
        assert(w.status === 403, `'*' must not reach a reserved key, got ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.error?.code === 'RESERVED_KEY', `code: ${w.body.error?.code}`);
        // ...but '*' DOES carry write-as-owner, so an ordinary key still works for it.
        const ok = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${wildToken}` },
            body: JSON.stringify({ key: 'nstest.wild.ordinary', value: { by: 'wild' }, owner_scope: true }),
        });
        assert(ok.status === 201 && ok.body.data.owner_gaii === ownerGhii(),
            `'*' should still carry write-as-owner: ${ok.status} ${JSON.stringify(ok.body.data)}`);
    });

    await test('WITH memory:write-reserved the owner CAN hand over the AI keys', async () => {
        const p = await json('/v1/agents/nsbot/scopes', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:write-as-owner', 'memory:write-reserved'] }),
        });
        assert(p.status === 200, `grant: ${p.status} ${JSON.stringify(p.body)}`);
        agentToken = await getToken(agentGaii, agentPriv, true);

        for (const key of ['openrouter.settings', 'ai-usage.today', 'profile.card']) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
                body: JSON.stringify({ key, value: { managed: 'by agent' }, owner_scope: true }),
            });
            assert(w.status === 201 || w.status === 200, `${key}: ${w.status} ${JSON.stringify(w.body)}`);
            assert(w.body.data.owner_gaii === ownerGhii(), `${key} must land under the owner`);
        }
    });

    await test('the reserved grant does NOT imply the redirect: without the flag it still stays put', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.reserved.unmoved', value: { by: 'agent' } }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === agentGaii, `got ${w.body.data.owner_gaii}`);
    });


    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

await main();
