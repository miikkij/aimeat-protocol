/**
 * @file e2e-app-design-spec.ts
 * @description The design spec beside an app: who reads and writes it, the stamp on the manifest,
 *   the publish hint when the app moves past it, the revision guard between two writers, and the
 *   owner's removal; over REST and through aimeat_app_manage on the node's MCP server.
 *
 *   The access rule is the one the draft endpoints make: the owner, the owner's agents and
 *   everybody holding a development right are inside the build and read and write the spec; a
 *   stranger gets 403; only the owner removes it. The hint is asserted from both sides, because
 *   the decision is that a shared app without a spec is told and an app built alone is not, and
 *   that a stale spec is told on every app and never refused.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-design-spec
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `ds${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'DS', password: 'DsTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'DS', password: 'DsTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'DsTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** One of the owner's agents, holding the named permission words, as a bearer token. */
async function makeAgent(owner: { token: string; name: string }, scopes: string[]): Promise<string> {
    const name = `ds${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name, owner: owner.name, scopes }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return tok.body.data.token as string;
}

// ── The node's own MCP server ─────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }
function parseSSE(text: string): any[] {
    return text.split('\n').filter(l => l.startsWith('data: '))
        .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
}
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find(m => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}
async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-app-design-spec', version: '1.0.0' } });
    return session;
}
async function callTool(session: McpSession, name: string, args: Record<string, unknown>) {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text: string = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

const html = (s: string) => Buffer.from(`<!doctype html><meta name="viewport" content="width=device-width"><h1>${s}</h1>`).toString('base64');
async function publish(token: string, filename: string, body: string, extra: Record<string, unknown> = {}) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, name: 'Design spec demo', description: 'design spec e2e', content: html(body), ...extra }),
    });
}

console.log('\n=== AIMEAT app design spec E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let builder: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'design-spec-demo.html';
const ALONE = 'design-spec-alone.html';
const spec = () => `/v1/apps/${owner.name}/${APP}/design-spec`;
const SPEC_V1 = '# Design spec\n\n## Purpose\nA board for the project manager.\n\n## Data\nRecords under pm.* keys.\n';
const SPEC_V2 = SPEC_V1 + '\n## Open questions\nWho archives a finished project?\n';

await test('setup: an owner with an app, a builder and a stranger', async () => {
    owner = await setupOwner('own');
    builder = await setupOwner('bld');
    stranger = await setupOwner('str');
    const pub = await publish(owner.token, APP, 'v1');
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

// ── Who sees it ───────────────────────────────────────────────────────────────────────────────────

await test('a stranger cannot read the spec of somebody else\'s app', async () => {
    const r = await json(spec(), { headers: auth(stranger.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('nor can somebody who has not been invited to build it yet', async () => {
    const r = await json(spec(), { headers: auth(builder.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('the owner reads an empty spec and gets the outline to start from', async () => {
    const r = await json(spec(), { headers: auth(owner.token) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.design_spec === null, 'no spec yet');
    assert(r.body.data.stale === false, 'nothing can be stale');
    assert(r.body.data.app_version === 1, `the app is at version 1 (got ${r.body.data.app_version})`);
    assert(String(r.body.data.template).includes('## Purpose'), 'the outline is there');
    assert(String(r.body.data.meaning).includes('Nobody has written one'), 'and the meaning says so');
});

await test('an unknown app is not found rather than given an outline', async () => {
    const r = await json(`/v1/apps/${owner.name}/no-such-app.html/design-spec`, { headers: auth(owner.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

// ── The hint on a shared app with no spec ─────────────────────────────────────────────────────────

await test('the owner lets the builder draft', async () => {
    const r = await json(`/v1/apps/${owner.name}/${APP}/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'drafter' }),
    });
    assert(r.status === 200, `grant ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('publishing a shared app with no spec says so, and names the action to write it with', async () => {
    const pub = await publish(owner.token, APP, 'v2', { roadmap: 'Second version, for the hint.' });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const hint = String(pub.body.data.design_spec_hint ?? '');
    assert(hint.includes('no design spec'), `the answer says the spec is missing (got "${hint}")`);
    assert(hint.includes('spec_set'), 'and names the action');
});

// ── Writing it ────────────────────────────────────────────────────────────────────────────────────

await test('a builder at the lowest rung writes the first spec', async () => {
    const r = await json(spec(), { method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ markdown: SPEC_V1 }) });
    assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const d = r.body.data;
    assert(d.design_spec.revision === 1, `first revision (got ${d.design_spec.revision})`);
    assert(d.design_spec.version === 2, `written against the live version 2 (got ${d.design_spec.version})`);
    assert(d.design_spec.updatedBy === builder.name, 'the builder is named as the writer');
    assert(String(d.design_spec.updatedByPrincipal).includes(builder.name), 'and the principal names them too');
    assert(d.stale === false && d.replaced_revision === null, 'nothing was replaced');
});

await test('the owner reads what the builder wrote', async () => {
    const r = await json(spec(), { headers: auth(owner.token) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body.data.design_spec.markdown === SPEC_V1, 'the same document');
    assert(r.body.data.template === undefined, 'and no outline, because there is a document');
});

await test('a document that is not one is refused', async () => {
    const bad = await json(spec(), { method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ markdown: '' }) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${bad.status}`);
    const big = await json(spec(), { method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ markdown: 'x'.repeat(70000) }) });
    assert(big.status === 400 && String(big.body.error?.message).includes('65536'), `a document over the ceiling is refused and the ceiling named (got ${big.status})`);
});

await test('the same text again confirms the spec without a new revision', async () => {
    const r = await json(spec(), { method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ markdown: SPEC_V1 }) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body.data.unchanged === true, 'the answer says the text was the one there');
    assert(r.body.data.design_spec.revision === 1, 'the revision stays');
});

// ── The publish that moves past it ────────────────────────────────────────────────────────────────

await test('a publish past the spec says it has fallen behind, and does not refuse', async () => {
    const pub = await publish(owner.token, APP, 'v3', { roadmap: 'Third version, past the spec.' });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const hint = String(pub.body.data.design_spec_hint ?? '');
    assert(hint.includes('version 2') && hint.includes('version 3'), `names both versions (got "${hint}")`);
    assert(pub.body.data.manifest?.designSpec?.revision === 1, 'the new version\'s manifest carries the stamp');
    const r = await json(spec(), { headers: auth(owner.token) });
    assert(r.body.data.stale === true, 'and the read says the spec is stale');
});

await test('a write naming the wrong revision is refused with the document that is there', async () => {
    const r = await json(spec(), { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ markdown: SPEC_V2, expected_revision: 7 }) });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(r.body.error?.code === 'REVISION_MISMATCH', `the code names the refusal (got ${r.body.error?.code})`);
    assert(JSON.stringify(r.body).includes('"revision":1'), 'and the current document travels with it');
});

await test('a write naming the revision it read replaces it and makes the spec current', async () => {
    const r = await json(spec(), { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ markdown: SPEC_V2, expected_revision: 1 }) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.design_spec.revision === 2 && r.body.data.replaced_revision === 1, 'revision 2 replaced revision 1');
    assert(r.body.data.design_spec.version === 3, 'written against version 3');
    const again = await json(spec(), { headers: auth(builder.token) });
    assert(again.body.data.stale === false, 'no longer stale');
});

// ── Through aimeat_app_manage ─────────────────────────────────────────────────────────────────────

let builderAgent: McpSession;
let narrowAgent: McpSession;
let ownerAgent: McpSession;

await test('the builder\'s agent reads the spec with action "spec", naming the owner', async () => {
    builderAgent = await openSession(await makeAgent(builder, ['app:write', 'memory:read']));
    const r = await callTool(builderAgent, 'aimeat_app_manage', { action: 'spec', owner: owner.name, filename: APP });
    assert(!r.isError, `spec refused: ${r.text}`);
    assert(r.data.design_spec?.revision === 2, `revision 2 (got ${JSON.stringify(r.data).slice(0, 200)})`);
    assert(typeof r.data.meaning === 'string', 'with the meaning line');
});

await test('and confirms it with action "spec_set" and the same text', async () => {
    const r = await callTool(builderAgent, 'aimeat_app_manage', { action: 'spec_set', owner: owner.name, filename: APP, markdown: SPEC_V2, expected_revision: 2 });
    assert(!r.isError, `spec_set refused: ${r.text}`);
    assert(r.data.unchanged === true, 'the text was the one there');
});

await test('an agent without app:write can neither read nor write it', async () => {
    // The app domain has no read word: app:write is what the dev-grants list asks too, so an
    // app-grant token with some other single scope cannot read a builder's document.
    narrowAgent = await openSession(await makeAgent(builder, ['memory:read']));
    const read = await callTool(narrowAgent, 'aimeat_app_manage', { action: 'spec', owner: owner.name, filename: APP });
    assert(read.isError, 'the read is refused');
    const write = await callTool(narrowAgent, 'aimeat_app_manage', { action: 'spec_set', owner: owner.name, filename: APP, markdown: SPEC_V1 });
    assert(write.isError, 'the write is refused');
    const check = await json(spec(), { headers: auth(owner.token) });
    assert(check.body.data.design_spec.markdown === SPEC_V2, 'and nothing was written by the attempt');
});

await test('the owner\'s agent sees the stamp on the manifest through aimeat_app_get', async () => {
    ownerAgent = await openSession(await makeAgent(owner, ['app:write', 'memory:read']));
    const r = await callTool(ownerAgent, 'aimeat_app_get', { owner: owner.name, filename: APP });
    assert(!r.isError, `app_get refused: ${r.text}`);
    const stamp = r.data.manifest?.designSpec;
    assert(stamp?.revision === 2 && stamp?.version === 3, `the stamp says revision 2 against version 3 (got ${JSON.stringify(stamp)})`);
    assert(stamp?.by === builder.name, 'and who wrote it last');
});

await test('a stranger\'s agent is refused by the same action', async () => {
    const s = await openSession(await makeAgent(stranger, ['app:write']));
    const r = await callTool(s, 'aimeat_app_manage', { action: 'spec', owner: owner.name, filename: APP });
    assert(r.isError, 'refused');
});

// ── Removing it ───────────────────────────────────────────────────────────────────────────────────

await test('a builder cannot remove the spec', async () => {
    const r = await json(spec(), { method: 'DELETE', headers: auth(builder.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    const mcp = await callTool(builderAgent, 'aimeat_app_manage', { action: 'spec_clear', owner: owner.name, filename: APP });
    assert(mcp.isError, 'and not through the tool either');
});

await test('the owner removes it, and the stamp goes with it', async () => {
    const r = await json(spec(), { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.removed === true, `removed (got ${r.status})`);
    const read = await json(spec(), { headers: auth(owner.token) });
    assert(read.body.data.design_spec === null && typeof read.body.data.template === 'string', 'empty again, with the outline');
    const app = await callTool(ownerAgent, 'aimeat_app_get', { owner: owner.name, filename: APP });
    assert(app.data.manifest?.designSpec === undefined, 'the manifest no longer carries a stamp');
    const again = await json(spec(), { method: 'DELETE', headers: auth(owner.token) });
    assert(again.status === 200 && again.body.data.removed === false, 'removing twice says there was nothing');
});

// ── An app built alone ────────────────────────────────────────────────────────────────────────────

await test('an app one person builds alone is not nagged for a spec', async () => {
    const first = await publish(owner.token, ALONE, 'v1');
    assert(first.status === 201, `publish ${first.status}`);
    const second = await publish(owner.token, ALONE, 'v2');
    assert(second.status === 201, `publish ${second.status}`);
    assert(second.body.data.design_spec_hint === undefined, 'no hint without a spec on an unshared app');
});

await test('but once it has a spec, a publish past it is told like any other', async () => {
    const w = await json(`/v1/apps/${owner.name}/${ALONE}/design-spec`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ markdown: SPEC_V1 }) });
    assert(w.status === 201, `write ${w.status}`);
    const pub = await publish(owner.token, ALONE, 'v3');
    assert(String(pub.body.data.design_spec_hint ?? '').includes('version 3'), 'the hint names the version published');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
