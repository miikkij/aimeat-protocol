/**
 * @file e2e-memory-hands-readers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: who sees the hands on a memory key (GET /v1/memory/:key/hands and MCP
 *   aimeat_memory_hands). The tally holds no visibility, and until 2026-10-22 it answered an agent
 *   without memory:read-as-owner and an ecosystem app with the writer, counts and times of a private
 *   record of the owner or of a sibling agent, while GET /v1/memory/:key?owner_scope=true answered
 *   the same record as absent (secaudit 2026-10, v88). Covered here:
 *
 *   REFUSED (each red on the unfixed code):
 *   - an agent without memory:read-as-owner gets no row for the owner's private record and none for a
 *     sibling agent's private record, over REST and over MCP, and its answer for such a key is the
 *     answer for a key nobody wrote;
 *   - an ecosystem app with the default scopes gets no row for either.
 *
 *   KEPT (green before and after):
 *   - the owner in person, an app grant holding memory:read and an agent holding
 *     memory:read-as-owner get the owner's and the sibling's rows;
 *   - the agent without the word still gets the hands on its own record and on an owner record whose
 *     visibility is `owner`, and its answer names the word that shows the rest;
 *   - an ecosystem app still gets the hands on its own record.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=memory-hands-readers
 * @version-history
 *   v1.0.1 — 2026-10-22 — 4b: an agent without memory:read is refused the hands with a 403
 *     (check:denial-coverage).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v88).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const TAG = Date.now().toString(36);
const REDIRECT = 'http://localhost:9922/callback';
const FILENAME = `hands${TAG}.html`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const write = (token: string, key: string, visibility: string) => json('/v1/memory', {
    method: 'POST', headers: bearer(token), body: JSON.stringify({ key, value: { at: Date.now() }, visibility }),
});
const restHands = async (token: string, key: string) => {
    const r = await json(`/v1/memory/${encodeURIComponent(key)}/hands`, { headers: bearer(token) });
    assert(r.status === 200, `hands ${key} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data as { hands: Array<{ writer: string; namespace: string; writes: number }>; note?: string };
};
const writers = (d: { hands: Array<{ writer: string }> }) => d.hands.map(h => h.writer);

// PKCE, reused: each authorize -> consent mints its own single-use code.
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

/** The app-grant flow for `scopes`, consented by the owner. Returns the app's access token. */
async function grantApp(appRef: string, ownerToken: string, scopes: string[]): Promise<string> {
    const q = new URLSearchParams({
        app: appRef, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `authorize: ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token;
}

/** An ecosystem app of the owner, approved with the default scopes and no data areas. */
async function ecosystemApp(owner: RegisteredOwner, app: string): Promise<{ token: string; geai: string }> {
    const priv = ed.utils.randomSecretKey();
    const pub = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64');
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner: owner.name, app, display_name: app, public_key: pub }) });
    assert(hello.status === 200, `hello ${hello.status}: ${JSON.stringify(hello.body)}`);
    const appr = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, { method: 'POST', headers: bearer(owner.token), body: JSON.stringify({ action: 'approve' }) });
    assert(appr.status === 200, `approve ${appr.status}: ${JSON.stringify(appr.body)}`);
    const tk = await json('/v1/ecosystem-apps/token', {
        method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(tk.status === 200 && tk.body.access_token, `eco token ${tk.status}: ${JSON.stringify(tk.body)}`);
    return { token: tk.body.access_token as string, geai: tk.body.geai as string };
}

console.log('\n=== The hands on a memory key, by reader (secaudit 2026-10, v88) ===\n');

let O!: RegisteredOwner;
let writerAgent!: McpAgent;   // the sibling that keeps a private record
let plain!: McpAgent;         // memory:read and memory:write, no memory:read-as-owner
let asOwner!: McpAgent;       // memory:read-as-owner
let plainS!: McpSession, asOwnerS!: McpSession;
let eco = { token: '', geai: '' };
let app = '';
const K_PRIV = `handsr${TAG}.ownerprivate`;
const K_SIB = `handsr${TAG}.siblingprivate`;
const K_OWNERVIS = `handsr${TAG}.ownervisible`;
const K_OWN = `handsr${TAG}.plainown`;
const K_ECO = `handsr${TAG}.ecoown`;
const K_NONE = `handsr${TAG}.nobody`;

await test('Setup: an owner, three agents, an ecosystem app, an app grant and five records', async () => {
    O = await registerOwner(BASE, `handsr${TAG}`);
    writerAgent = await makeAgent(BASE, O, ['memory:read', 'memory:write']);
    plain = await makeAgent(BASE, O, ['memory:read', 'memory:write']);
    asOwner = await makeAgent(BASE, O, ['memory:read', 'memory:read-as-owner']);
    plainS = await openSession(BASE, plain.token, 'hands-plain');
    asOwnerS = await openSession(BASE, asOwner.token, 'hands-as-owner');
    eco = await ecosystemApp(O, `handsr-eco-${TAG}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(O.token),
        body: JSON.stringify({ filename: FILENAME, content: Buffer.from('<!DOCTYPE html><html><body>hands</body></html>').toString('base64'), name: 'Hands', description: 'reads the hands on a key', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body)}`);
    app = await grantApp(`${O.name}/${FILENAME}`, O.token, ['memory:read']);

    for (const [tok, key, vis] of [
        [O.token, K_PRIV, 'private'], [writerAgent.token, K_SIB, 'private'], [O.token, K_OWNERVIS, 'owner'],
        [plain.token, K_OWN, 'private'], [eco.token, K_ECO, 'private'],
    ] as const) {
        const w = await write(tok, key, vis);
        assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }
    // The first sighting of a (key, writer) pair is written through as a floating promise, so wait
    // until the owner in person sees every hand before asserting anything.
    const expect: Array<[string, string]> = [[K_PRIV, O.ghii], [K_SIB, writerAgent.gaii], [K_OWNERVIS, O.ghii], [K_OWN, plain.gaii]];
    for (const [key, who] of expect) {
        let seen = false;
        for (let i = 0; i < 40 && !seen; i++) {
            seen = writers(await restHands(O.token, key)).includes(who);
            if (!seen) await new Promise(r => setTimeout(r, 250));
        }
        assert(seen === true, `the owner never saw ${who} on ${key}`);
    }
    let ecoSeen = false;
    for (let i = 0; i < 40 && !ecoSeen; i++) {
        ecoSeen = writers(await restHands(eco.token, K_ECO)).includes(eco.geai);
        if (!ecoSeen) await new Promise(r => setTimeout(r, 250));
    }
    assert(ecoSeen === true, 'the ecosystem app never saw its own hand on its own key');
});

// ── Refused ──────────────────────────────────────────────────────────────────────────────────

await test('1. An agent without memory:read-as-owner gets no row for the owner\'s private record or a sibling\'s, as the owner-scope read answers 404', async () => {
    for (const key of [K_PRIV, K_SIB]) {
        const read = await json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true`, { headers: bearer(plain.token) });
        assert(read.status === 404, `control: the owner-scope read of ${key} answered ${read.status}`);
        const d = await restHands(plain.token, key);
        assert(d.hands.length === 0, `REST hands on ${key} told the agent: ${JSON.stringify(d.hands)}`);
    }
});

await test('2. ...over MCP aimeat_memory_hands as well', async () => {
    for (const key of [K_PRIV, K_SIB]) {
        const r = await callTool(plainS, 'aimeat_memory_hands', { key });
        assert(!r.isError && Array.isArray(r.data.hands), `MCP hands ${key}: ${r.text}`);
        assert(r.data.hands.length === 0, `MCP hands on ${key} told the agent: ${r.text}`);
    }
});

await test('3. ...and the answer for a hidden key is the answer for a key nobody wrote', async () => {
    const none = await restHands(plain.token, K_NONE);
    for (const key of [K_PRIV, K_SIB]) {
        const d = await restHands(plain.token, key);
        assert(JSON.stringify({ h: d.hands, n: d.note }) === JSON.stringify({ h: none.hands, n: none.note }),
            `${key} answers differently from an unwritten key: ${JSON.stringify(d)} vs ${JSON.stringify(none)}`);
    }
});

await test('4. An ecosystem app with the default scopes gets no row for the owner\'s or a sibling\'s private record', async () => {
    for (const key of [K_PRIV, K_SIB]) {
        const read = await json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true`, { headers: bearer(eco.token) });
        assert(read.status === 404, `control: the ecosystem app's owner-scope read of ${key} answered ${read.status}`);
        const d = await restHands(eco.token, key);
        assert(d.hands.length === 0, `hands on ${key} told the ecosystem app: ${JSON.stringify(d.hands)}`);
    }
});

await test('4b. An agent without memory:read is refused the hands on the owner\'s key with a 403', async () => {
    const noRead = await makeAgent(BASE, O, ['ext:invoke']);
    const r = await json(`/v1/memory/${encodeURIComponent(K_PRIV)}/hands`, { headers: bearer(noRead.token) });
    assert(r.status === 403, `hands without memory:read: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    assert(!Array.isArray(r.body?.data?.hands), `the refusal carried hands: ${JSON.stringify(r.body?.data)}`);
});

// ── Kept ─────────────────────────────────────────────────────────────────────────────────────

await test('5. The owner in person gets the owner\'s and the sibling\'s rows, and no note', async () => {
    const priv = await restHands(O.token, K_PRIV);
    assert(writers(priv).includes(O.ghii), `owner row on the private key: ${JSON.stringify(priv)}`);
    const sib = await restHands(O.token, K_SIB);
    assert(writers(sib).includes(writerAgent.gaii) && sib.hands.some(h => h.namespace === writerAgent.gaii), `sibling row: ${JSON.stringify(sib)}`);
    assert(priv.note === undefined, `the owner was given a note: ${priv.note}`);
});

await test('6. An app grant holding memory:read gets the same rows', async () => {
    assert(writers(await restHands(app, K_PRIV)).includes(O.ghii), 'the app lost the owner row');
    assert(writers(await restHands(app, K_SIB)).includes(writerAgent.gaii), 'the app lost the sibling row');
});

await test('7. An agent holding memory:read-as-owner gets them over REST and MCP', async () => {
    assert(writers(await restHands(asOwner.token, K_PRIV)).includes(O.ghii), 'REST: lost the owner row');
    assert(writers(await restHands(asOwner.token, K_SIB)).includes(writerAgent.gaii), 'REST: lost the sibling row');
    const r = await callTool(asOwnerS, 'aimeat_memory_hands', { key: K_SIB });
    assert(!r.isError && r.data.hands.some((h: any) => h.writer === writerAgent.gaii), `MCP: lost the sibling row: ${r.text}`);
    assert(r.data.note === undefined, `an agent reading as the owner was given a note: ${r.text}`);
});

await test('8. The agent without the word keeps its own record\'s hands and an owner-visible record\'s, and is told which word shows the rest', async () => {
    const own = await restHands(plain.token, K_OWN);
    assert(writers(own).includes(plain.gaii), `its own key: ${JSON.stringify(own)}`);
    const vis = await restHands(plain.token, K_OWNERVIS);
    assert(writers(vis).includes(O.ghii), `the owner-visible key: ${JSON.stringify(vis)}`);
    assert(typeof own.note === 'string' && own.note.includes('memory:read-as-owner'), `the note names the word: ${own.note}`);
    const r = await callTool(plainS, 'aimeat_memory_hands', { key: K_OWNERVIS });
    assert(!r.isError && r.data.hands.some((h: any) => h.writer === O.ghii), `MCP owner-visible key: ${r.text}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('memory:read-as-owner'), `MCP note: ${r.text}`);
});

await test('9. An ecosystem app keeps the hands on its own record', async () => {
    const d = await restHands(eco.token, K_ECO);
    assert(writers(d).includes(eco.geai) && d.hands.every(h => h.namespace === eco.geai), `its own key: ${JSON.stringify(d)}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
