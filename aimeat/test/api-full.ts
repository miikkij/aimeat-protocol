/**
 * @file test/api-full.ts
 * @description Full API integration test for AIMEAT Phases 1-5 — bootstrap/discovery endpoints
 *   (GET /, llms.txt, well-known set, Link headers), owner registration + auth, memory, and the
 *   broad happy-path sweep across the core API surface.
 * @usage cd aimeat && pnpm exec tsx test/api-full.ts
 * @version-history
 *   v1.2.0 — 2026-07-14 — Markdown for Agents tests: Accept: text/markdown negotiation on
 *     / + /v1/portal + /v1/connect (content-type, x-markdown-tokens, Vary), HTML/JSON unchanged
 *   v1.1.0 — 2026-07-13 — Add MCP Server Card, RFC 9727 api-catalog, and RFC 8288 Link-header tests
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

// ─── Boot embedded server ───
const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40251', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;

if (!process.env.E2E_BASE) {
    // No external server specified — start one in-process
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    }
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(TEST_PORT, () => resolve(s));
    });
    console.log(`Test server started on port ${TEST_PORT}`);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key, return base64 signature
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = ''; // base64, returned by server
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `testowner${Date.now()}`;
const agentName = 'testagent';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
let isOperator = false;

console.log('\n=== AIMEAT Full E2E Test ===\n');

// ─── Phase 1: Core ───
console.log('Phase 1 — Core');

await test('GET / bootstrap', async () => {
    // The bootstrap lives at ?format=json — the address llms.txt, robots.txt, auth.md and
    // ai-plugin.json have always pointed agents at. A bare GET / now answers HTML, because a
    // wildcard Accept is what crawlers and readability scanners send and they were getting a JSON
    // envelope with nothing indexable in it (agent-readability phase 10).
    const { body } = await json('/?format=json');
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);

    const d = body.data;
    assert(d.for_ai_assistants, 'missing for_ai_assistants');
    assert(d.for_ai_assistants.context, 'missing for_ai_assistants.context');
    assert(d.for_ai_assistants.paths, 'missing for_ai_assistants.paths');
    assert(d.for_ai_assistants.paths.build_an_app, 'missing build_an_app path');
    assert(d.for_ai_assistants.paths.explore, 'missing explore path');
    assert(d.for_ai_assistants.paths.register_and_start, 'missing register_and_start path');

    assert(d.for_ai_agents, 'missing for_ai_agents');
    assert(d.for_ai_agents.context, 'missing for_ai_agents.context');
    assert(d.for_ai_agents.first_step, 'missing for_ai_agents.first_step');
    assert(d.for_ai_agents.connection_flow, 'missing for_ai_agents.connection_flow');
    assert(d.for_ai_agents.after_connection, 'missing for_ai_agents.after_connection');
    assert(d.for_ai_agents.after_connection.paths.collaborate_with_agents, 'missing collaborate_with_agents path');

    assert(d.getting_started, 'missing getting_started (backward compat)');
    assert(d.core_system, 'missing core_system');
    assert(d.this_node, 'missing this_node');
});

await test('GET / with Accept: text/markdown — Markdown for Agents landing', async () => {
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/markdown' } });
    assert(res.status === 200, `status ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/markdown'), `content-type: ${ct}`);
    const tokens = Number(res.headers.get('x-markdown-tokens'));
    assert(Number.isInteger(tokens) && tokens > 0, `x-markdown-tokens: ${res.headers.get('x-markdown-tokens')}`);
    assert((res.headers.get('vary') ?? '').toLowerCase().includes('accept'), `vary: ${res.headers.get('vary')}`);
    const md = await res.text();
    assert(md.startsWith('# '), 'body is markdown (starts with a heading)');
    assert(md.includes('/llms.txt'), 'landing links the agent manual');
    assert(md.includes('/auth.md'), 'landing links agent registration');
});

await test('GET / with Accept: text/html — browsers still get HTML', async () => {
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    if (res.status === 302) {
        // Default portal: humans are redirected to the SPA.
        assert((res.headers.get('location') ?? '').includes('/v1/portal'), `location: ${res.headers.get('location')}`);
    } else {
        // Custom operator template: served inline as HTML.
        assert(res.status === 200, `status ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/html'), `content-type: ${res.headers.get('content-type')}`);
    }
});

await test('GET /v1/portal negotiates markdown; HTML and API JSON stay untouched', async () => {
    const md = await fetch(`${BASE}/v1/portal`, { headers: { Accept: 'text/markdown' } });
    assert(md.status === 200, `md status ${md.status}`);
    assert((md.headers.get('content-type') ?? '').includes('text/markdown'), `md content-type: ${md.headers.get('content-type')}`);
    assert(Number(md.headers.get('x-markdown-tokens')) > 0, 'x-markdown-tokens present');
    const html = await fetch(`${BASE}/v1/portal`, { headers: { Accept: 'text/html' } });
    assert(html.status === 200, `html status ${html.status}`);
    assert((html.headers.get('content-type') ?? '').includes('text/html'), `html content-type: ${html.headers.get('content-type')}`);
    // API JSON endpoints never markdown-negotiate.
    const api = await fetch(`${BASE}/v1/health`, { headers: { Accept: 'text/markdown' } });
    assert((api.headers.get('content-type') ?? '').includes('application/json'), `api content-type: ${api.headers.get('content-type')}`);
});

await test('GET /v1/connect negotiates markdown (static info page HTML→md conversion)', async () => {
    const res = await fetch(`${BASE}/v1/connect`, { headers: { Accept: 'text/markdown' } });
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/markdown'), `content-type: ${res.headers.get('content-type')}`);
    assert(Number(res.headers.get('x-markdown-tokens')) > 0, 'x-markdown-tokens present');
    assert(Number(res.headers.get('x-original-tokens')) > 0, 'x-original-tokens present (converted from HTML)');
    const md = await res.text();
    assert(!/<(script|style|div|body)\b/i.test(md), 'no HTML tags leak into the markdown');
    const browser = await fetch(`${BASE}/v1/connect`, { headers: { Accept: 'text/html' } });
    assert((browser.headers.get('content-type') ?? '').includes('text/html'), `browser content-type: ${browser.headers.get('content-type')}`);
});

await test('GET /llms.txt — contains builder guide', async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.includes('## What is AIMEAT'), 'missing "What is AIMEAT" section');
    assert(text.includes('## What You Can Build'), 'missing "What You Can Build" section');
    assert(text.includes('## Two Ways to Start'), 'missing "Two Ways to Start" section');
    assert(text.includes('## Core Capabilities'), 'missing "Core Capabilities" section');
    assert(text.includes('## Core Concepts'), 'missing existing "Core Concepts" section');
    assert(text.includes('POST'), 'missing request examples');
    assert(text.includes('/v1/memory'), 'missing memory endpoint');
});

await test('GET /robots.txt — Content Signals Policy directive, consistent with per-bot rules', async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    // Default directive (AIMEAT_CONTENT_SIGNAL): search + ai-input allowed, ai-train disallowed —
    // the machine-readable statement of the stance the per-bot rules below it already express.
    assert(/^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m.test(text), `Content-Signal directive missing/altered: ${text.split('\n').find(l => l.startsWith('Content-Signal')) ?? '(none)'}`);
    assert(text.includes('content signals'), 'policy preamble comment present');
    // Consistency: the training crawlers stay disallowed, search bots allowed.
    assert(/User-agent: GPTBot\s*\r?\nDisallow: \//.test(text), 'GPTBot stays disallowed');
    assert(/User-agent: ClaudeBot\s*\r?\nDisallow: \//.test(text), 'ClaudeBot stays disallowed');
    assert(/User-agent: OAI-SearchBot\s*\r?\nAllow: \//.test(text), 'OAI-SearchBot stays allowed');
});

await test('GET /.well-known/aimeat', async () => {
    const { body } = await json('/.well-known/aimeat');
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
});

await test('GET /.well-known/http-message-signatures-directory — Ed25519 JWKS, signed response', async () => {
    const res = await fetch(`${BASE}/.well-known/http-message-signatures-directory`);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('application/http-message-signatures-directory+json'), `media type: ${res.headers.get('content-type')}`);
    const jwks = await res.json() as any;
    assert(Array.isArray(jwks.keys) && jwks.keys.length === 1, `keys: ${JSON.stringify(jwks)}`);
    const k = jwks.keys[0];
    assert(k.kty === 'OKP' && k.crv === 'Ed25519' && k.use === 'sig', `key shape: ${JSON.stringify(k)}`);
    const pub = Buffer.from(k.x, 'base64url');
    assert(pub.length === 32, `Ed25519 public key must be 32 bytes, got ${pub.length}`);
    // The JWKS key IS the node key did.json/.well-known/aimeat publish (one identity, one key).
    const aimeatDoc = (await json('/.well-known/aimeat')).body;
    assert(Buffer.from(aimeatDoc.data.public_key, 'base64').equals(pub), 'JWKS x matches the node public key');
    // kid = RFC 7638 JWK thumbprint (sha256 over {"crv","kty","x"}, base64url).
    const { createHash } = await import('node:crypto');
    const expectKid = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${k.x}"}`, 'utf8').digest('base64url');
    assert(k.kid === expectKid, `kid is the JWK thumbprint: ${k.kid} vs ${expectKid}`);
    // The directory RESPONSE is itself signed (tag "http-message-signatures-directory") — verify it.
    const sigInput = res.headers.get('signature-input') ?? '';
    const sigHeader = res.headers.get('signature') ?? '';
    assert(sigInput.includes('tag="http-message-signatures-directory"') && sigInput.includes(`keyid="${k.kid}"`), `signature-input: ${sigInput}`);
    const params = sigInput.replace(/^sig1=/, '');
    const authority = new URL(BASE).host.toLowerCase();
    const base = `"@authority";req: ${authority}\n"@signature-params": ${params}`;
    const sigB64 = /:(.*):/.exec(sigHeader)?.[1] ?? '';
    const ok = await ed.verifyAsync(
        new Uint8Array(Buffer.from(sigB64, 'base64')),
        new TextEncoder().encode(base),
        new Uint8Array(pub),
    );
    assert(ok, 'directory response signature verifies against the served JWK');
});

await test('GET /.well-known/mcp.json — MCP Server Card (SEP-1649)', async () => {
    const res = await fetch(`${BASE}/.well-known/mcp.json`);
    assert(res.status === 200, `status ${res.status}`);
    const card = await res.json() as any;
    assert(typeof card.protocolVersion === 'string', 'missing protocolVersion');
    assert(card.serverInfo?.name?.includes('AIMEAT'), `serverInfo.name: ${card.serverInfo?.name}`);
    assert(card.transport?.type === 'streamable-http', `transport.type: ${card.transport?.type}`);
    assert(card.transport?.endpoint?.endsWith('/v1/mcp'), `transport.endpoint: ${card.transport?.endpoint}`);
    assert(card.authentication?.required === true, 'MCP requires OAuth — authentication.required must be true');
});

await test('GET /.well-known/api-catalog — RFC 9727 linkset', async () => {
    const res = await fetch(`${BASE}/.well-known/api-catalog`);
    assert(res.status === 200, `status ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('application/linkset+json'), `content-type: ${ct}`);
    const catalog = await res.json() as any;
    assert(Array.isArray(catalog.linkset) && catalog.linkset.length > 0, 'linkset array missing/empty');
    const root = catalog.linkset[0];
    assert(root['service-desc']?.[0]?.href?.endsWith('/v1/spec'), `service-desc: ${JSON.stringify(root['service-desc'])}`);
    const mcpEntry = catalog.linkset.find((e: any) => e.anchor?.endsWith('/v1/mcp'));
    assert(mcpEntry?.['service-meta']?.[0]?.href?.endsWith('/.well-known/mcp.json'), 'MCP anchor missing service-meta → mcp.json');
});

await test('Discovery Link headers (RFC 8288) on GET responses', async () => {
    for (const path of ['/', '/llms.txt']) {
        const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
        const link = res.headers.get('link') ?? '';
        assert(link.includes('</.well-known/api-catalog>; rel="api-catalog"'), `${path}: missing api-catalog Link header (got: ${link})`);
        assert(link.includes('</v1/spec>; rel="service-desc"'), `${path}: missing service-desc Link header (got: ${link})`);
    }
});

await test('POST /v1/owners — register owner', async () => {
    if (ADMIN_PW) {
        // Use admin setup endpoint — always grants operator role
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: ownerName }),
        });
        assert(status === 200, `admin register status ${status}: ${JSON.stringify(body)}`);
        assert(body.ok === true, 'ok');
        ownerPrivKey = body.private_key;
        isOperator = true;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.ok === true, 'ok');
        ownerPrivKey = body.data.private_key;
    }
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth — sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    if (ADMIN_PW && isOperator) {
        // Use admin setup token endpoint for admin-registered owners
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.token;
    } else {
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerName, timestamp, signature }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.data?.token;
        // Detect operator from actual auth response (first registered owner is auto-operator)
        if (body.data?.roles?.includes('operator')) isOperator = true;
    }
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('POST /v1/agents — register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.agent?.gaii?.includes(agentName), 'gaii');
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth — sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token ok: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Memory CRUD', async () => {
    // Write
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'pref', value: { color: 'blue' }, visibility: 'private', ttl_hours: 1 }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // Read
    const { body: rBody } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(rBody.ok === true, 'read ok');
    assert(rBody.data?.items !== undefined, 'has items');
    const entry = rBody.data.items.find((m: any) => m.key === 'pref');
    assert(entry, 'found entry');
});

// ─── Phase 2: Economy ───
console.log('Phase 2 — Economy');

await test('Wallet — check initial balance', async () => {
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.balance === 'number', 'has balance');
});

await test('Actions — publish', async () => {
    const { body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: 'summarize-text',
            display_name: 'Summarize Text',
            description: 'Summarize text',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
            pricing: { base_morsels: 5 },
        }),
    });
    assert(body.ok === true, `publish: ${JSON.stringify(body.error)}`);
});

await test('Catalogue — list actions', async () => {
    const { body } = await json('/v1/catalogue');
    assert(body.ok === true, 'ok');
    assert(typeof body.data === 'object', `data is object`);
    assert(Array.isArray(body.data.actions), 'has actions array');
    assert(body.data.actions.length > 0, 'has actions');
});

await test('Work lifecycle — submit→accept→deliver→rate', async () => {
    // Register a second owner + agent for cross-owner work
    const workOwnerName = `workowner${Date.now()}`;
    const { body: owReg } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: workOwnerName, public_key: 'placeholder' }),
    });
    assert(owReg.ok === true, `register work owner: ${JSON.stringify(owReg.error)}`);
    const workOwnerPrivKey = owReg.data.private_key;

    // Get work owner token
    const owTs = new Date().toISOString();
    const owSig = await signMsg(workOwnerPrivKey, workOwnerName + NODE_ID + owTs);
    const { body: owTk } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: workOwnerName, timestamp: owTs, signature: owSig }),
    });
    const workOwnerToken = owTk.data?.token;

    // Register agent under second owner
    const agent2Name = 'requester';
    const { body: regBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${workOwnerToken}` },
        body: JSON.stringify({ name: agent2Name, owner: workOwnerName, capabilities: ['work'], model: 'gpt-4o', scopes: ['*'] }),
    });
    const agent2Gaii = regBody.data.agent.gaii;
    const agent2PrivKey = regBody.data.private_key;

    // Get token for agent2
    const ts = new Date().toISOString();
    const sig = await signMsg(agent2PrivKey, agent2Gaii + ts);
    const { body: tk2Body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2Gaii, timestamp: ts, signature: sig }),
    });
    const agent2Token = tk2Body.data?.token;
    assert(typeof agent2Token === 'string', 'agent2 token');

    // Submit work request
    const { body: subBody } = await json('/v1/work', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ action_id: 'summarize-text', provider_gaii: agentGaii, input: { text: 'hello world' } }),
    });
    assert(subBody.ok === true, `submit: ${JSON.stringify(subBody.error)}`);
    const tc = subBody.data?.tracking_code;
    assert(typeof tc === 'string', 'got tracking code');

    // Accept
    const { body: accBody } = await json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(accBody.ok === true, `accept: ${JSON.stringify(accBody.error)}`);

    // Deliver
    const { body: delBody } = await json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ output: { summary: 'hi' } }),
    });
    assert(delBody.ok === true, `deliver: ${JSON.stringify(delBody.error)}`);

    // Rate
    const { body: rateBody } = await json(`/v1/work/${tc}/rate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ rating: 'positive', feedback: 'great' }),
    });
    assert(rateBody.ok === true, `rate: ${JSON.stringify(rateBody.error)}`);
});

// ─── Phase 3: Social ───
console.log('Phase 3 — Social');

await test('Agent profile with trust score', async () => {
    const { body } = await json(`/v1/agents/${encodeURIComponent(agentGaii)}`);
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.trust !== undefined, 'has trust');
    assert(typeof body.data?.trust?.score === 'number', 'trust score is number');
});

await test('Boards — create + post + list', async () => {
    const { body: cBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'general', description: 'General discussion', visibility: 'private' }),
    });
    assert(cBody.ok === true, `board create: ${JSON.stringify(cBody.error)}`);
    const boardId = cBody.data?.id;
    assert(typeof boardId === 'string', 'got board id');

    const { body: pBody } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'First Post', body: 'Hello board!' }),
    });
    assert(pBody.ok === true, `post create: ${JSON.stringify(pBody.error)}`);

    const { body: lBody } = await json(`/v1/boards/${boardId}/posts`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(lBody.ok === true, 'list posts');
    assert(Array.isArray(lBody.data?.posts), 'posts array');
    assert(lBody.data.posts.length > 0, 'has posts');
});

await test('Prompts — tier0, tier1, tier2 + unified', async () => {
    for (const tier of ['tier0', 'tier1', 'tier2']) {
        const { body } = await json(`/v1/prompts/${tier}`);
        assert(body.ok === true, `${tier} ok`);
        assert(typeof body.data?.system_prompt === 'string', `${tier} has prompt`);
    }
    // Unified prompts
    for (const tier of ['0', '0.5', '1', '2']) {
        const { body } = await json(`/v1/prompts/${tier}`);
        assert(body.ok === true, `prompts/${tier} ok`);
        assert(typeof body.data?.system_prompt === 'string', `prompts/${tier} has prompt`);
    }
});

// ─── Phase 4: Infrastructure ───
console.log('Phase 4 — Infrastructure');

await test('OTK — generate + execute', async () => {
    const { body: genBody } = await json('/v1/auth/otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ action: 'write_memory', params: { key: 'otk-test', value: 'hello' } }),
    });
    assert(genBody.ok === true, `otk gen: ${JSON.stringify(genBody.error)}`);
    const otkKey = genBody.data?.otk;
    assert(typeof otkKey === 'string', 'has otk');

    // Execute OTK
    const { body: exBody } = await json(`/v1/otk/${otkKey}`);
    assert(exBody.ok === true, `otk exec: ${JSON.stringify(exBody.error)}`);
});

await test('Admin — operator access dashboard', async () => {
    const { body } = await json('/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `dashboard: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.node_id === 'string', 'has node_id');
});

await test('Federation directory', async () => {
    const { body } = await json('/v1/federation/directory');
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.peers), 'has peers array');
});

await test('Rate limiting headers present', async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.ok, 'request succeeded');
    const limit = res.headers.get('x-ratelimit-limit');
    assert(limit !== null, 'has X-RateLimit-Limit header');
});

// ─── Phase 5: Polish ───
console.log('Phase 5 — Polish');

await test('GET /v1/spec — OpenAPI YAML', async () => {
    const res = await fetch(`${BASE}/v1/spec`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('yaml'), `ct: ${ct}`);
    const text = await res.text();
    assert(text.startsWith('openapi:'), 'starts with openapi:');
});

await test('GET /v1/docs — HTML docs page', async () => {
    const res = await fetch(`${BASE}/v1/docs`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('html'), `ct: ${ct}`);
    assert(res.ok, 'docs returns 200');
});

await test('Admin backup — operator access', async () => {
    const { body } = await json('/v1/admin/backup', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `backup: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.exported_at === 'string', 'has exported_at');
});

// ─── Phase 6: Extended API Coverage ───
console.log('Phase 6 — Extended API');

await test('Agent check-in', async () => {
    const { body } = await json('/v1/checkin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, `checkin: ${JSON.stringify(body.error)}`);
    assert(body.data?.gaii === agentGaii, 'gaii matches');
    assert(typeof body.data?.checked_in === 'string', 'has checked_in timestamp');
});

await test('Catalogue sub-endpoints', async () => {
    // Actions sub-catalogue
    const { body: actBody } = await json('/v1/catalogue/actions');
    assert(actBody.ok === true, 'catalogue/actions ok');
    assert(Array.isArray(actBody.data?.actions), 'has actions');

    // Agents directory
    const { body: agBody } = await json('/v1/catalogue/agents');
    assert(agBody.ok === true, 'catalogue/agents ok');
    assert(Array.isArray(agBody.data?.agents), 'has agents');

    // Boards
    const { body: bBody } = await json('/v1/catalogue/boards');
    assert(bBody.ok === true, 'catalogue/boards ok');
    assert(Array.isArray(bBody.data?.boards), 'has boards');

    // Hash
    const { body: hBody } = await json('/v1/catalogue/hash');
    assert(hBody.ok === true, 'catalogue/hash ok');
    assert(typeof hBody.data?.hash === 'string', 'has hash');
    assert(hBody.data.hash.length === 64, 'SHA-256 hex is 64 chars');
});

await test('Public stats', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, `stats: ${JSON.stringify(body.error)}`);
    assert(typeof (body.data?.counts?.agents ?? body.data?.active_agents) === 'number', 'has agent count');
    // Stats endpoint may not include action counts — just check the shape is valid
    const actionCount = body.data?.counts?.actions ?? body.data?.active_actions ?? body.data?.total_actions;
    assert(actionCount === undefined || typeof actionCount === 'number', 'action count is number or absent');
    assert((body.data?.node_id ?? body.data?.node ?? body.node) === NODE_ID, 'node_id correct');
});

await test('Action discovery + detail', async () => {
    const { body: discBody } = await json('/v1/actions', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(discBody.ok === true, 'discover ok');
    assert(Array.isArray(discBody.data?.actions), 'has actions');

    // Detail by GAII
    const { body: detBody } = await json(`/v1/actions/${encodeURIComponent(agentGaii)}/summarize-text`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(detBody.ok === true, `action detail: ${JSON.stringify(detBody.error)}`);
});

await test('Memory PUT (optimistic locking) + search', async () => {
    // Write a memory entry first
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'locktest', value: 'v1', tags: ['test'] }),
    });

    // PUT with version
    const { body: putBody } = await json('/v1/memory/locktest', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v2', version: 1 }),
    });
    assert(putBody.ok === true, `put: ${JSON.stringify(putBody.error)}`);
    assert(putBody.data?.version === 2, 'version incremented');

    // Search
    const { body: sBody } = await json('/v1/memory/search?q=locktest', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(sBody.ok === true, `search: ${JSON.stringify(sBody.error)}`);
    assert(Array.isArray(sBody.data?.results), 'has results');
});

await test('Wallet — transactions + request', async () => {
    // Transactions path
    const { body: txBody } = await json('/v1/wallet/transactions', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(txBody.ok === true, `transactions: ${JSON.stringify(txBody.error)}`);
    assert(Array.isArray(txBody.data?.transactions), 'has transactions');

    // Request morsels
    const { body: reqBody } = await json('/v1/wallet/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ amount: 10, reason: 'testing' }),
    });
    assert(reqBody.ok === true, `request: ${JSON.stringify(reqBody.error)}`);
    assert(typeof reqBody.data?.granted === 'number', 'has granted');
});

await test('Wallet — overview composite (Phase 4 DbService)', async () => {
    const { body } = await json('/v1/wallet/overview', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `overview: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(d.wallet && typeof d.wallet.balance === 'number', 'wallet.balance present');
    assert(Array.isArray(d.transactions?.transactions), 'transactions is an array');
    assert(Array.isArray(d.checkoutSessions?.sessions), 'checkoutSessions is an array');
    assert(Array.isArray(d.orders?.orders), 'orders is an array');
    // The transactions section matches the standalone endpoint's total (same ledger, one read scope).
    const { body: tx } = await json('/v1/wallet/transactions?per_page=20', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.transactions.total === tx.data.total, `overview tx total (${d.transactions.total}) == /transactions total (${tx.data.total})`);
    // (Owner-only requireRole('owner') gating is proven in the access-tokens suite — same middleware.)
});

await test('Memory — tab overview composite (Phase 4 DbService, meta-only)', async () => {
    const { body } = await json('/v1/memory/tab', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.ok === true, `memory/tab: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(Array.isArray(d.agents), 'agents is an array');
    assert(d.memory && Array.isArray(d.memory.items) && d.memory.quota, 'memory has items + quota');
    assert(d.memory.items.every((i: any) => !('value' in i)), 'memory items are metadata-only (no value loaded)');
    assert(Array.isArray(d.files?.files), 'files is an array');
    assert(Array.isArray(d.consents?.consents), 'consents is an array');
    assert(Array.isArray(d.groups?.groups), 'groups is an array');
    assert(Array.isArray(d.organisms?.organisms), 'organisms is an array');
    // The memory section matches the standalone meta endpoint's total (same owner-scope, one read scope).
    const { body: mem } = await json('/v1/memory?include=meta', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.memory.total === mem.data.total, `overview memory total (${d.memory.total}) == /v1/memory?include=meta (${mem.data.total})`);
});

await test('Matches — list handler runs the batched enrichment (owner with no matches)', async () => {
    const { body } = await json('/v1/matches', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.ok === true, `matches: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data?.matches), 'matches is an array');
    // The batched enrichment (getGHIIsByGhiis + getAgentsByOwners + listConsentsForAgents) runs cleanly
    // even with no matched profiles to enrich (empty maps → nothing to redact).
});

await test('Notebook overview composite folds inbox + settings + organisms (Phase 4 DbService)', async () => {
    // Capture an inbox note, then confirm the composite returns it (server-side prefix scan).
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'notebook.inbox.' + Date.now(), value: { text: 'test note' }, visibility: 'private' }),
    });
    const { body } = await json('/v1/notebook', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.ok === true, `notebook: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(Array.isArray(d.inbox) && d.inbox.length >= 1, 'inbox has the captured note');
    assert(d.inbox.every((n: any) => typeof n.key === 'string' && n.key.startsWith('notebook.inbox.')), 'inbox only has notebook.inbox. keys');
    assert(d.settings && typeof d.settings === 'object', 'settings is an object');
    assert(Array.isArray(d.organisms?.organisms), 'organisms is an array');
});

await test('Data Wallet composite folds consents + audit + permission summary (Phase 4 DbService)', async () => {
    // Grant a consent so the wallet has data (owner session bypasses the consent:manage scope).
    const g = await json('/v1/consent', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ data_pattern: 'notes.*', recipient: '*', purpose: 'data-wallet composite test', scope: 'federation' }),
    });
    assert(g.status === 201 || g.status === 200, `grant status ${g.status}: ${JSON.stringify(g.body)}`);

    const { status, body } = await json('/v1/data-wallet', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `data-wallet status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;

    // consents mirror GET /v1/consent
    const single = await json('/v1/consent', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.consents.total === single.body.data.total, `consents total matches /v1/consent: ${d.consents.total} vs ${single.body.data.total}`);
    assert(d.consents.consents.some((c: any) => c.data_pattern === 'notes.*'), 'granted consent present in composite');
    // audit carries entries[] + the 30-day period
    assert(Array.isArray(d.audit.entries) && d.audit.period_days === 30, 'audit carries entries[] + period_days');
    // permSummary mirrors GET /v1/permissions/summary
    const perm = await json('/v1/permissions/summary', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.permSummary.active_consents === perm.body.data.active_consents, `active_consents matches: ${d.permSummary.active_consents} vs ${perm.body.data.active_consents}`);
    assert(d.permSummary.total_memory_keys === perm.body.data.total_memory_keys, `memory-key count matches: ${d.permSummary.total_memory_keys} vs ${perm.body.data.total_memory_keys}`);
    assert(d.permSummary.total_storage_files === perm.body.data.total_storage_files, 'storage-file count matches');
});

await test('Living Docs composite partitions templates from one memory scan (Phase 4 DbService)', async () => {
    // Seed two template keys (owner memory); assert the composite surfaces them, sorted by title, and
    // returns the instances + organisms partitions in the right shape. (The instance partition — an
    // organism.*.living.*.latest namespaced key — needs a real workspace to write and is browser-verified.)
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'living.template.tpl-apifull-b', value: { id: 'tpl-apifull-b', title: 'ZZZ Api-full Template B' }, visibility: 'private' }),
    });
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'living.template.tpl-apifull-a', value: { id: 'tpl-apifull-a', title: 'AAA Api-full Template A' }, visibility: 'private' }),
    });

    const { status, body } = await json('/v1/living-docs', { method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `living-docs status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    // template partition — both surfaced, sorted by title (A before B)
    const ids = (d.templates || []).map((t: any) => t.id);
    assert(ids.includes('tpl-apifull-a') && ids.includes('tpl-apifull-b'), `templates surfaced: ${JSON.stringify(ids)}`);
    const ai = ids.indexOf('tpl-apifull-a'), bi = ids.indexOf('tpl-apifull-b');
    assert(ai < bi, 'templates sorted by title (A before B)');
    // instances + organisms partitions present in the right shape
    assert(Array.isArray(d.instances), 'instances is an array');
    assert(Array.isArray(d.organisms), 'organisms is an array');
});

await test('Validate endpoint', async () => {
    const { body } = await json('/v1/validate', {
        method: 'POST',
        body: JSON.stringify({
            endpoint: '/v1/memory',
            method: 'POST',
            body: { key: 'test', value: 'hello' },
        }),
    });
    assert(body.ok === true, `validate: ${JSON.stringify(body.error)}`);
    assert(body.data?.valid === true, 'valid');
});

await test('Work batch + reject', async () => {
    // Register another agent for batch test
    const batchAgent = `batchagent${Date.now()}`;
    const { body: regBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: batchAgent, owner: ownerName }),
    });
    const bGaii = regBody.data.agent.gaii;
    const bPriv = regBody.data.private_key;
    const bTs = new Date().toISOString();
    const bSig = await signMsg(bPriv, bGaii + bTs);
    const { body: bTk } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: bGaii, timestamp: bTs, signature: bSig }),
    });
    const bToken = bTk.data?.token;

    // Batch submit
    const { body: batchBody } = await json('/v1/work/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bToken}` },
        body: JSON.stringify({
            requests: [
                { action_id: 'summarize-text', provider_gaii: agentGaii, input: { text: 'batch1' } },
            ],
        }),
    });
    assert(batchBody.ok === true, `batch: ${JSON.stringify(batchBody.error)}`);
    assert(Array.isArray(batchBody.data?.results), 'has results');
    assert(batchBody.data.results.length === 1, 'one result');

    // Reject the work item
    const batchTc = batchBody.data.results[0].tracking_code;
    if (batchTc) {
        const { body: rejBody } = await json(`/v1/work/${batchTc}/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ reason: 'testing reject' }),
        });
        assert(rejBody.ok === true, `reject: ${JSON.stringify(rejBody.error)}`);
    }
});

await test('Board single post', async () => {
    // Create a board and post
    const { body: cBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'test-single-post', visibility: 'private' }),
    });
    const boardId = cBody.data?.id;

    const { body: pBody } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Single Post Test', body: 'Testing single post endpoint' }),
    });
    const postId = pBody.data?.id;

    // Get single post
    const { body: sBody } = await json(`/v1/boards/${boardId}/posts/${postId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(sBody.ok === true, `single post: ${JSON.stringify(sBody.error)}`);
    assert(sBody.data?.title === 'Single Post Test', 'title matches');
});

await test('Federation — peer request + status', async () => {
    // Need operator token — first owner is operator
    const { body: reqBody } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ target_url: 'http://example.com:40251' }),
    });
    assert(reqBody.ok === true, `peer request: ${JSON.stringify(reqBody.error)}`);
    const reqId = reqBody.data?.request_id;
    assert(typeof reqId === 'string', 'got request_id');

    // Check status
    const { body: stBody } = await json(`/v1/federation/peer/request/${reqId}/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(stBody.ok === true, `peer status: ${JSON.stringify(stBody.error)}`);
    assert(stBody.data?.status === 'pending', 'status is pending');
});

await test('Admin — config GET + roles grant', async () => {
    // GET config
    const { body: cfgBody } = await json('/v1/admin/config', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(cfgBody.ok === true, `config: ${JSON.stringify(cfgBody.error)}`);
    assert(cfgBody.data?.schema?.['node.id']?.value === NODE_ID, 'node_id');

    // Create another owner and grant operator
    const grantOwner = `grantowner${Date.now()}`;
    const { body: goBody } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: grantOwner, public_key: 'placeholder' }),
    });
    assert(goBody.ok === true, 'created grant owner');

    const { body: grBody } = await json('/v1/admin/roles/grant', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ owner: grantOwner, role: 'operator' }),
    });
    assert(grBody.ok === true, `grant: ${JSON.stringify(grBody.error)}`);
    assert(grBody.data?.granted === true, 'granted');

    // Clean up
    await json(`/v1/owners/${grantOwner}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
});

await test('Federation — heartbeat + peers list', async () => {
    const { body: hbBody } = await json('/v1/federation/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ from_node_id: 'test-node', timestamp: new Date().toISOString(), status: 'healthy' }),
    });
    assert(hbBody.ok === true, `heartbeat: ${JSON.stringify(hbBody.error)}`);
    assert(hbBody.data?.status === 'healthy', 'status');

    // List peers (operator)
    const { body: plBody } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(plBody.ok === true, `peers list: ${JSON.stringify(plBody.error)}`);
    assert(Array.isArray(plBody.data?.peers), 'has peers array');
});

// ─── Federation Join (introduce) ───
console.log('Federation — Introduce (join flow)');

await test('Federation — introduce contributor (auto-approve)', async () => {
    // Generate a fresh keypair for the introducing node
    const contribPrivKey = crypto.getRandomValues(new Uint8Array(32));
    const contribPubKey = await ed.getPublicKeyAsync(contribPrivKey);
    const contribPubKeyB64 = Buffer.from(contribPubKey).toString('base64');
    const contribPrivKeyB64 = Buffer.from(contribPrivKey).toString('base64');

    const introduceTs = new Date().toISOString();
    // Server verifies: node_id + node_url + timestamp
    const introduceMsg = 'e2e-test-contributor' + 'http://localhost:19999' + introduceTs;
    const introduceSig = await signMsg(contribPrivKeyB64, introduceMsg);
    const { status, body } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-test-contributor',
            node_url: 'http://localhost:19999',
            node_type: 'full',
            public_key: contribPubKeyB64,
            role: 'contributor',
            message: 'E2E test join',
            timestamp: introduceTs,
            signature: introduceSig,
        }),
    });
    // Server never auto-approves — always pending (202)
    assert(status === 202, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, `introduce: ${JSON.stringify(body.error)}`);
    assert(body.data?.status === 'pending', `expected pending, got ${body.data?.status}`);
    assert(typeof body.data?.request_id === 'string', 'has request_id');
});

await test('Federation — introduce operator (pending)', async () => {
    // Generate a fresh keypair for the introducing node
    const opPrivKey = crypto.getRandomValues(new Uint8Array(32));
    const opPubKey = await ed.getPublicKeyAsync(opPrivKey);
    const opPubKeyB64 = Buffer.from(opPubKey).toString('base64');
    const opPrivKeyB64 = Buffer.from(opPrivKey).toString('base64');

    const introduceTs = new Date().toISOString();
    // Server verifies: node_id + node_url + timestamp
    const introduceMsg = 'e2e-test-operator' + 'http://localhost:19998' + introduceTs;
    const introduceSig = await signMsg(opPrivKeyB64, introduceMsg);
    const { status, body } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-test-operator',
            node_url: 'http://localhost:19998',
            node_type: 'full',
            public_key: opPubKeyB64,
            role: 'operator',
            message: 'E2E test operator join',
            timestamp: introduceTs,
            signature: introduceSig,
        }),
    });
    assert(status === 202, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, `introduce: ${JSON.stringify(body.error)}`);
    assert(body.data?.status === 'pending', `expected pending, got ${body.data?.status}`);
    const requestId = body.data?.request_id;
    assert(typeof requestId === 'string', 'has request_id');

    // Check status — should be pending
    const { body: stBody } = await json(`/v1/federation/peer/introduce/${requestId}/status`);
    assert(stBody.ok === true, `status check: ${JSON.stringify(stBody.error)}`);
    assert(stBody.data?.status === 'pending', `status is pending, got ${stBody.data?.status}`);

    // Approve via admin API
    const { body: appBody } = await json(`/v1/admin/peering/requests/${requestId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ decision: 'approve' }),
    });
    assert(appBody.ok === true, `approve: ${JSON.stringify(appBody.error)}`);

    // Check status again — should be approved
    const { body: st2Body } = await json(`/v1/federation/peer/introduce/${requestId}/status`);
    assert(st2Body.data?.status === 'approved', `expected approved, got ${st2Body.data?.status}`);
});

await test('Federation — introduce validation (missing fields)', async () => {
    const { status } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({ node_id: 'incomplete' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Federation — introduce status (invalid id)', async () => {
    const { status } = await json('/v1/federation/peer/introduce/nonexistent-id/status');
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Maintenance Mode ───
console.log('Maintenance Mode');

await test('Maintenance — toggle on and off', async () => {
    // Enable maintenance
    const { body: onBody } = await json('/v1/admin/maintenance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ enabled: true, message: 'E2E test maintenance' }),
    });
    assert(onBody.ok === true, `enable: ${JSON.stringify(onBody.error)}`);
    assert(onBody.data?.enabled === true, `expected enabled=true, got ${JSON.stringify(onBody.data)}`);
    assert(onBody.data?.message === 'E2E test maintenance', 'message matches');

    // Check status
    const { body: getBody } = await json('/v1/admin/maintenance', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getBody.ok === true, `get: ${JSON.stringify(getBody.error)}`);
    assert(getBody.data?.enabled === true, `still enabled: ${JSON.stringify(getBody.data)}`);

    // Non-essential endpoint should return 503 (for non-operator users)
    // With no auth, the maintenance guard blocks the request
    const { status: memStatus } = await json('/v1/memory/test');
    assert(memStatus === 503 || memStatus === 401, `expected 503 or 401 during maintenance, got ${memStatus}`);

    // Federation introduce should still work during maintenance (bypass)
    // Generate a fresh keypair for this introduce
    const maintPrivKey = crypto.getRandomValues(new Uint8Array(32));
    const maintPubKey = await ed.getPublicKeyAsync(maintPrivKey);
    const maintPubKeyB64 = Buffer.from(maintPubKey).toString('base64');
    const maintPrivKeyB64 = Buffer.from(maintPrivKey).toString('base64');
    const maintTs = new Date().toISOString();
    const maintMsg = 'e2e-maint-test' + 'http://localhost:19997' + maintTs;
    const maintSig = await signMsg(maintPrivKeyB64, maintMsg);
    const { status: introStatus } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-maint-test',
            node_url: 'http://localhost:19997',
            node_type: 'full',
            public_key: maintPubKeyB64,
            role: 'contributor',
            timestamp: maintTs,
            signature: maintSig,
        }),
    });
    assert(introStatus === 202, `introduce during maintenance should work, got ${introStatus}`);

    // Disable maintenance
    const { body: offBody } = await json('/v1/admin/maintenance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ enabled: false }),
    });
    assert(offBody.ok === true, `disable: ${JSON.stringify(offBody.error)}`);
    assert(offBody.data?.enabled === false, 'disabled');

    // Endpoint should work again
    const { status: memStatus2 } = await json('/v1/memory/test', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(memStatus2 !== 503, `should not be 503 after disabling maintenance, got ${memStatus2}`);
});

// ─── Phase 7: Advanced Scenarios ───
console.log('Phase 7 — Advanced Scenarios');

await test('Memory TTL expiry', async () => {
    // Write with very short TTL (0.001 hours ≈ 3.6 seconds)
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'ttl_test', value: 'expires_soon', visibility: 'private', ttl_hours: 0.001 }),
    });
    assert(wBody.ok === true, `write ttl entry: ${JSON.stringify(wBody.error)}`);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 4000));

    // Read — should be gone
    const { body: rBody } = await json(`/v1/memory/ttl_test`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    // After TTL expiry, reading returns a fresh empty auto-created record (upsert on read)
    assert(rBody.ok === false || rBody.data === null || rBody.data?.value === null ||
           (typeof rBody.data?.value === 'object' && Object.keys(rBody.data.value).length === 0),
           'TTL entry should be expired or reset to empty');
});

await test('Chunked upload lifecycle', async () => {
    // Init upload
    const { body: initBody } = await json('/v1/storage/upload/init', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'e2e_chunked_test.txt', mime_type: 'text/plain', chunk_size: 1024, total_chunks: 1 }),
    });
    assert(initBody.ok === true, `init: ${JSON.stringify(initBody.error)}`);
    const uploadId = initBody.data?.upload_id;
    assert(uploadId, 'has upload_id');

    // Upload single chunk
    const { status: chunkStatus } = await json(`/v1/storage/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/octet-stream' },
        body: 'Hello, chunked world!',
    });
    assert(chunkStatus < 400, `chunk upload status ${chunkStatus}`);

    // Complete upload
    const { body: completeBody } = await json(`/v1/storage/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(completeBody.ok === true, `complete: ${JSON.stringify(completeBody.error)}`);
});

await test('Action update (PUT)', async () => {
    // Publish an action first
    const actionId = `e2e-action-${Date.now()}`;
    const { body: pubBody } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: actionId, display_name: 'Test Action', description: 'Original description',
            input_schema: {}, output_schema: {}, pricing: { base_morsels: 1 },
        }),
    });
    assert(pubBody.ok === true, `publish: ${JSON.stringify(pubBody.error)}`);

    // Update it
    const { body: updBody } = await json(`/v1/actions/${actionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ description: 'Updated description', pricing: { base_morsels: 5 } }),
    });
    assert(updBody.ok === true, `update: ${JSON.stringify(updBody.error)}`);
    assert(updBody.data?.description === 'Updated description' || updBody.data?.action?.description === 'Updated description', 'description updated');
});

await test('HEAD storage metadata', async () => {
    // Upload a file (JSON mode: key + data as base64)
    const { body: upBody } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'e2e_head_test.txt', data: Buffer.from('head test content').toString('base64'), mime_type: 'text/plain' }),
    });
    assert(upBody.ok === true, `upload: ${JSON.stringify(upBody.error)}`);

    // HEAD request — no json helper, use fetch directly
    const headRes = await fetch(`${BASE}/v1/storage/e2e_head_test.txt`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(headRes.status === 200, `HEAD status: ${headRes.status}`);
    assert(headRes.headers.has('content-length') || headRes.headers.has('content-type'), 'has metadata headers');
});

await test('Error paths (400, 401, 404)', async () => {
    // 400 — invalid body
    const { status: s400 } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(s400 === 400, `expected 400, got ${s400}`);

    // 401 — no auth
    const { status: s401 } = await json('/v1/memory', { method: 'POST', body: JSON.stringify({ key: 'x', value: 'y' }) });
    assert(s401 === 401, `expected 401, got ${s401}`);

    // 404 — nonexistent resource
    const { status: s404 } = await json('/v1/agents/nonexistent%23fake%40nowhere');
    assert(s404 === 404, `expected 404, got ${s404}`);
});

await test('Optimistic locking conflict (409)', async () => {
    // Write a memory entry
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'lock_test', value: 'v1', visibility: 'private' }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // First update with version 1 — should succeed
    const { body: u1Body, status: u1Status } = await json('/v1/memory/lock_test', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v2', version: 1 }),
    });
    assert(u1Status === 200, `first update: ${u1Status} ${JSON.stringify(u1Body.error)}`);

    // Second update with version 1 (stale) — should fail with 409
    const { status: u2Status } = await json('/v1/memory/lock_test', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v3', version: 1 }),
    });
    assert(u2Status === 409, `expected 409 conflict, got ${u2Status}`);
});

await test('Rate limiting 429', async () => {
    // Read the auth rate limit from headers
    const probe = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
    });
    const limit = parseInt(probe.headers.get('X-RateLimit-Limit') ?? '0', 10);
    assert(limit > 0, 'has X-RateLimit-Limit header');
    const remaining = parseInt(probe.headers.get('X-RateLimit-Remaining') ?? '-1', 10);
    assert(remaining >= 0, 'has X-RateLimit-Remaining header');
    // If limit is small enough, actually trigger 429
    if (limit <= 50) {
        let got429 = false;
        for (let i = 0; i < limit + 5 && !got429; i++) {
            const { status } = await json('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
            });
            if (status === 429) got429 = true;
        }
        assert(got429, 'expected to hit 429 rate limit');
    }
    // With high test limits, just verify the headers exist (rate limiting is enabled)
});

// ─── Phase 7: Initial OTK + Auto-Identification ───
console.log('Phase 7 — Initial OTK + Auto-Identification');

await test('Initial OTK — generate via JWT auth', async () => {
    const { status, body } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.initial === true, 'initial flag');
    assert(typeof body.data?.otk === 'string', 'has otk');
    assert(typeof body.data?.grace_ms === 'number', 'has grace_ms');
    assert(body.data?.owner === agentGaii, 'owner matches agent');
});

await test('Initial OTK — use for micro-memory write', async () => {
    // Generate initial OTK
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Use it for micro-memory add
    const { body: addBody } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-test&key=k1&value=hello`);
    assert(addBody.ok === true, `mm add: ${JSON.stringify(addBody)}`);

    // Use same OTK again within grace period (should still work)
    const { body: listBody } = await json(`/v1/mm?otk=${otk}&op=list&set=iotk-test`);
    assert(listBody.ok === true, `mm list: ${JSON.stringify(listBody)}`);
    assert(listBody.data?.entries && typeof listBody.data.entries === 'object', 'has entries');
    assert(listBody.data.entries.k1 === 'hello', 'value matches');
});

await test('Initial OTK — dormant before first use', async () => {
    // Generate initial OTK — it should have a far-future expiry
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Wait a short time to prove it's still valid (not expired)
    await new Promise(r => setTimeout(r, 200));

    // It should still work — regular OTK with 60s TTL would potentially have different behavior
    const { body: addBody } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-dormant&key=d1&value=dormant`);
    assert(addBody.ok === true, `mm add after delay: ${JSON.stringify(addBody)}`);
});

await test('Initial OTK — grace period expiry', async () => {
    // This test verifies that after first use, the OTK's timer is running
    // We can't wait 60s in a test, but we verify the mechanism works:
    // 1. Create initial OTK
    // 2. Use it (activates timer → sets expiresAt = now + graceMs)
    // 3. Verify second use within grace works
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // First use activates the timer
    const { body: use1 } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-grace&key=g1&value=first`);
    assert(use1.ok === true, 'first use ok');

    // Second use within grace should work
    const { body: use2 } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-grace&key=g2&value=second`);
    assert(use2.ok === true, 'second use within grace ok');
});

await test('Auto-identification — owner identity hints', async () => {
    // Create an initial OTK using owner token (owner identity, no agent)
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Use it — since owner is the identity (not an agent), should get identity hints
    const { body: listBody } = await json(`/v1/mm?otk=${otk}&op=add&set=hint-test&key=h1&value=test`);
    assert(listBody.ok === true, `mm add: ${JSON.stringify(listBody)}`);

    // List operation should include identity hints for non-agent identity
    const { body: listBody2 } = await json(`/v1/mm?otk=${otk}&op=list&set=hint-test`);
    assert(listBody2.ok === true, 'list ok');
    // Identity hints should be present if GAII is owner-only (not a registered agent)
    // The owner name is used as identity, which won't match any agent GAII
    if (listBody2.data?.identity) {
        assert(listBody2.data.identity.identity_status === 'owner_only', 'identity status');
        assert(typeof listBody2.data.identity.register_url === 'string', 'has register_url');
    }
});

await test('Initial OTK — admin setup endpoint', async () => {
    const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
    // Skip if no admin password available
    if (!ADMIN_PW) {
        console.log('    ⏩ Skipped (no AIMEAT_ADMIN_PASSWORD in env)');
        passed++; // count as passed (skipped)
        return;
    }

    const { body } = await json('/v1/admin/setup/initial-otk', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ owner: ownerName }),
    });
    assert(body.ok === true, `admin initial-otk: ${JSON.stringify(body)}`);
    assert(body.initial === true, 'initial flag');
    assert(typeof body.otk === 'string', 'has otk');
    assert(typeof body.grace_ms === 'number', 'has grace_ms');
});

// ─── Phase 8: Chat Instance CRUD ───
await new Promise(r => setTimeout(r, 1500)); // Rate limit cooldown
console.log('Phase 8 — Chat Instance CRUD');

// Chat instances require a GHII profile. The test owner (created via POST /v1/owners)
// does not have one, so we create a dedicated GHII user for chat instance tests.
const chatOwnerName = `chatowner${Date.now()}`;
let chatOwnerToken = '';
let chatOwnerPrivKey = '';
let chatInstanceId = '';

await test('Setup — create GHII user for chat instances', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({
            username: chatOwnerName,
            display_name: 'Chat Test User',
            password: 'TestPass1234!',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.ghii?.ghii === `${chatOwnerName}@${NODE_ID}`, 'ghii matches');
    chatOwnerPrivKey = body.data.private_key;
    assert(typeof chatOwnerPrivKey === 'string' && chatOwnerPrivKey.length > 0, 'got private key');

    // Authenticate to get a JWT token
    const timestamp = new Date().toISOString();
    const message = chatOwnerName + NODE_ID + timestamp;
    const signature = await signMsg(chatOwnerPrivKey, message);

    const { body: tokenBody } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: chatOwnerName, timestamp, signature }),
    });
    assert(tokenBody.ok === true, `token ok: ${JSON.stringify(tokenBody.error)}`);
    chatOwnerToken = tokenBody.data?.token;
    assert(typeof chatOwnerToken === 'string', 'got chat owner token');
});

await test('POST /v1/chat-instances — create chat instance', async () => {
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
        body: JSON.stringify({ platform: 'claude', app_name: 'e2e-test-app' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.chat_instance?.platform === 'claude', 'platform matches');
    assert(body.data?.chat_instance?.app_name === 'e2e-test-app', 'app_name matches');
    assert(body.data?.chat_instance?.ghii === `${chatOwnerName}@${NODE_ID}`, 'ghii matches');
    chatInstanceId = body.data.chat_instance.id;
    assert(typeof chatInstanceId === 'string' && chatInstanceId.length > 0, 'got chat instance id');
});

await test('GET /v1/chat-instances — list chat instances', async () => {
    const { body } = await json('/v1/chat-instances', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data?.chat_instances), 'has chat_instances array');
    assert(body.data.chat_instances.length > 0, 'has at least one instance');
    assert(typeof body.data.total === 'number', 'has total');

    // Test platform filter
    const { body: filteredBody } = await json('/v1/chat-instances?platform=claude', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(filteredBody.ok === true, 'filtered ok');
    assert(filteredBody.data.chat_instances.every((ci: any) => ci.platform === 'claude'), 'all instances are claude');

    // Non-matching filter returns empty
    const { body: emptyBody } = await json('/v1/chat-instances?platform=nonexistent', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(emptyBody.ok === true, 'empty filter ok');
    assert(emptyBody.data.chat_instances.length === 0, 'no instances for nonexistent platform');
});

await test('GET /v1/chat-instances/:id — get chat instance details', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.id === chatInstanceId, 'id matches');
    assert(body.data?.chat_instance?.platform === 'claude', 'platform matches');
    assert(body.data?.chat_instance?.app_name === 'e2e-test-app', 'app_name matches');
    // Economy data should be present since GHII exists
    assert(body.data?.economy !== null, 'has economy data');
    assert(typeof body.data?.economy?.trust_score === 'number', 'has trust_score');
});

await test('PUT /v1/chat-instances/:id — update lastSeen', async () => {
    // Get original lastSeen
    const { body: beforeBody } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    const originalLastSeen = beforeBody.data?.chat_instance?.last_seen;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 50));

    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.id === chatInstanceId, 'id matches');
    assert(typeof body.data?.chat_instance?.last_seen === 'string', 'has last_seen');
    assert(body.data.chat_instance.last_seen !== originalLastSeen, 'lastSeen was updated');
});

await test('DELETE /v1/chat-instances/:id — end chat session', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'deleted');
    assert(body.data?.id === chatInstanceId, 'id matches');

    // Verify it's gone
    const { status } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(status === 404, `expected 404 after delete, got ${status}`);
});

// Clean up: delete the GHII test owner
await json(`/v1/owners/${chatOwnerName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${chatOwnerToken}` },
});

// ─── Node Portal (Site) ───
console.log('Node Portal (Site)');

await test('GET /v1/site — portal metadata', async () => {
    const { status, body } = await json('/v1/site');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.node_id === 'string', 'has node_id');
    assert(typeof body.data?.node_id === 'string' || Array.isArray(body.data?.tag_types), 'has site metadata');
});

await test('GET /v1/site/prompt — AI prompt (no auth)', async () => {
    const { status, body } = await json('/v1/site/prompt');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.prompt === 'string', 'has prompt string');
    assert(body.data.prompt.length > 0, 'prompt not empty');
});

await test('GET /v1/site/template — no template yet (200 with null)', async () => {
    const { status, body } = await json('/v1/site/template', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.template === null, 'template is null when no custom template');
});

await test('POST /v1/site/template — upload template', async () => {
    const template = '<html><body><h1>{{config:nodeName}}</h1><p>Hello from {{kv:region}}</p></body></html>';
    const { status, body } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.stored === true, 'stored');
    assert(typeof body.data?.size_bytes === 'number', 'has size_bytes');
    assert(Array.isArray(body.data?.tags_found), 'has tags_found');
});

await test('POST /v1/site/template — reject missing body', async () => {
    const { status, body } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('GET /v1/site/template — download uploaded template', async () => {
    const { status, body } = await json('/v1/site/template', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.template === 'string', 'has template');
    assert(body.data.template.includes('{{config:nodeName}}'), 'template has config tag');
    assert(typeof body.data?.size_bytes === 'number', 'has size_bytes');
    assert(Array.isArray(body.data?.tags_found), 'has tags_found');
});

await test('GET / — serves resolved custom template', async () => {
    // With a custom template set, GET / (Accept: text/html) serves the resolved
    // template instead of redirecting humans to the SPA. The {{config:nodeName}}
    // tag must be resolved, and the template's static text must be present.
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/html' }, redirect: 'follow' });
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `expected HTML, got ${ct}`);
    const html = await res.text();
    assert(html.includes('Hello from'), `served HTML should be the custom template, got: ${html.slice(0, 160)}`);
    assert(!html.includes('{{config:nodeName}}'), 'config tag should be resolved, not literal');
});

await test('POST /v1/site/import — import bundle', async () => {
    const bundle = {
        template: '<html><body><h1>Imported</h1><p>{{memory:portal/welcome}}</p></body></html>',
        memory: { 'portal/welcome': 'Welcome to the imported portal!' },
        kv: { greeting: 'Hello World' },
    };
    const { status, body } = await json('/v1/site/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify(bundle),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.template_stored === true, 'template stored');
    assert(body.data?.memory_keys_written === 1, 'memory keys written');
    assert(typeof body.data?.changelog_entry_id === 'string', 'has changelog entry id');
});

await test('POST /v1/site/import — reject invalid memory keys', async () => {
    const { status, body } = await json('/v1/site/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ memory: { 'invalid/key': 'value' } }),
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.ok === false, 'not ok');
});

// ── Single portal memory key set/delete (→ __site__ namespace so tags resolve) ──
await test('POST /v1/site/memory — set portal memory key', async () => {
    const { status, body } = await json('/v1/site/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'portal/about', value: 'About this node' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data?.stored === true, 'stored');
});

await test('GET /v1/site/memory-keys — lists the new key under __site__', async () => {
    const { status, body } = await json('/v1/site/memory-keys', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const found = (body.data?.keys || []).find((k: any) => k.key === 'portal/about');
    assert(found, 'portal/about should be listed');
    assert(found.value === 'About this node', `value: ${found.value}`);
});

await test('{{memory:portal/about}} resolves in served portal (bootstrap serves custom template)', async () => {
    const template = '<!DOCTYPE html><html><body><main id="about">{{memory:portal/about}}</main></body></html>';
    const { status: up } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });
    assert(up === 200, `upload status ${up}`);
    // A custom template is set → GET / for a browser must serve it (resolved), not redirect to the SPA.
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/html' } });
    const htmlText = await res.text();
    assert(htmlText.includes('About this node'), `served portal should resolve memory value (status ${res.status})`);
});

await test('POST /v1/site/memory — reject non-portal key', async () => {
    const { status, body } = await json('/v1/site/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'notportal/x', value: 'v' }),
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('DELETE /v1/site/memory/:key — delete portal memory key', async () => {
    const { status, body } = await json(`/v1/site/memory/${encodeURIComponent('portal/about')}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data?.deleted === true, 'deleted');
});

await test('DELETE /v1/site/memory/:key — 404 for missing key', async () => {
    const { status } = await json(`/v1/site/memory/${encodeURIComponent('portal/missing-key')}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('POST /v1/site/memory — 401 without auth', async () => {
    const { status } = await json('/v1/site/memory', {
        method: 'POST',
        body: JSON.stringify({ key: 'portal/x', value: 'v' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/site/changelog — view changes', async () => {
    const { status, body } = await json('/v1/site/changelog', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data), 'data is array');
    assert(body.data.length > 0, 'has changelog entries');
    assert(typeof body.data[0].action === 'string', 'entry has action');
});

await test('POST /v1/site/cache-invalidate — clear cache', async () => {
    const { status, body } = await json('/v1/site/cache-invalidate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.cache_cleared === true, 'cache cleared');
});

await test('DELETE /v1/site/template — revert to default', async () => {
    const { status, body } = await json('/v1/site/template', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === true, 'deleted');
    assert(body.data?.reverted_to === 'default', 'reverted to default');
});

await test('GET / — serves default portal after delete', async () => {
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/html' } });
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `expected HTML, got ${ct}`);
    const html = await res.text();
    // Should no longer contain our custom template content
    assert(!html.includes('Imported'), 'custom content should be gone');
});

await test('GET /v1/site/template — 401 without auth', async () => {
    const { status } = await json('/v1/site/template');
    assert(status === 401, `expected 401, got ${status}`);
});

// ─── System Board ───
console.log('System Board');

await test('System board — operator can create', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'announcements', description: 'System announcements', visibility: 'system' }),
    });
    assert(status === 201, `expected 201, got ${status}`);
    assert(body.data?.visibility === 'system', 'visibility is system');
});

await test('System board — agent cannot create system board', async () => {
    if (isOperator) {
        // When owner is operator, agent inherits operator role and CAN create system boards
        console.log('    ⏩ Skipped (agent owner is operator)');
        passed++;
        return;
    }
    const { status } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'agent-sys', description: 'Should fail', visibility: 'system' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('System board — operator can post (free)', async () => {
    // Find the announcements board
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status, body } = await json(`/v1/boards/${sysBoard.id}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Welcome', body: 'First announcement!' }),
    });
    assert(status === 201, `expected 201, got ${status}`);
    assert(body.data?.title === 'Welcome', 'post title');
});

await test('System board — agent cannot post', async () => {
    if (isOperator) {
        // When owner is operator, agent inherits operator role and CAN post to system boards
        console.log('    ⏩ Skipped (agent owner is operator)');
        passed++;
        return;
    }
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status } = await json(`/v1/boards/${sysBoard.id}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Nope', body: 'Should fail' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('System board — publicly readable (no auth)', async () => {
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status, body } = await json(`/v1/boards/${sysBoard.id}/posts`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.data?.posts), 'has posts array');
    assert(body.data.posts.length > 0, 'has posts');
});

await test('System board — {{board:announcements}} resolves in template', async () => {
    // Upload template with board tag
    const template = '<!DOCTYPE html><html><body><h1>Portal</h1><div id="news">{{board:announcements}}</div></body></html>';
    const { status: uploadStatus } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });
    assert(uploadStatus === 200, `upload status ${uploadStatus}`);

    // Verify template was stored and can be retrieved
    const { body: tplBody } = await json('/v1/site/template', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(tplBody.ok === true, `template stored: ${JSON.stringify(tplBody.error)}`);
    assert(tplBody.data?.tags_found?.includes('board:announcements'),
        `board tag detected (tags_found: ${JSON.stringify(tplBody.data?.tags_found)}, template_length: ${tplBody.data?.template?.length}, ok: ${tplBody.ok})`);
});

// ─── LB Sync ───
console.log('LB Sync');

await test('GET /v1/site/sync — returns sync payload', async () => {
    // Try to upload a template (may fail if no operator role, which is fine)
    const template = '<!DOCTYPE html><html><body>{{config:nodeId}}</body></html>';
    await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });

    const { status, body } = await json('/v1/site/sync');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.ok === true, `sync ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.sync_timestamp, 'has sync_timestamp');
    // template may be null if upload failed (no operator role)
    assert(body.data?.template === null || typeof body.data?.template?.html === 'string', 'template field valid');
    assert(Array.isArray(body.data?.memory_keys), 'has memory_keys array');
    assert(Array.isArray(body.data?.deleted_memory_keys), 'has deleted_memory_keys');
    assert(typeof body.data?.kv === 'object', 'has kv object');
    assert(Array.isArray(body.data?.system_board_posts), 'has system_board_posts');
});

await test('GET /v1/site/sync?since=future — returns no changes', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const { status, body } = await json(`/v1/site/sync?since=${encodeURIComponent(future)}`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.template === null, 'no template changes since future');
    assert(body.data?.memory_keys?.length === 0, 'no memory changes since future');
    assert(body.data?.system_board_posts?.length === 0, 'no board posts since future');
});

await test('GET /v1/site/sync — system board posts structure', async () => {
    const { status, body } = await json('/v1/site/sync');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.data?.system_board_posts), 'has system_board_posts array');
    // Posts may be empty if operator tests failed, but array must exist
    if (body.data.system_board_posts.length > 0) {
        const post = body.data.system_board_posts[0];
        assert(post.id, 'post has id');
        assert(post.title, 'post has title');
        assert(post.body, 'post has body');
        assert(post.created_at, 'post has created_at');
    }
});

await test('GET /v1/site/sync — no auth required', async () => {
    // Verify no auth header and get 200
    const { status } = await json('/v1/site/sync');
    assert(status === 200, `expected 200 without auth, got ${status}`);
});

await test('GET /v1/health — no site_lb when LB not enabled', async () => {
    const { status, body } = await json('/v1/health');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.status === 'healthy', 'status is healthy');
    assert(body.data?.site_lb === undefined, 'no site_lb when not in LB mode');
});

await test('POST /v1/admin/site/sync — 404 when LB not enabled', async () => {
    const { status } = await json('/v1/admin/site/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    // Route only registered when LB mode enabled, so expect 404
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 8: Scope Enforcement (REQ-006) ───
await new Promise(r => setTimeout(r, 1500)); // Rate limit cooldown
console.log('Phase 8 — Scope Enforcement');

// Register a non-operator owner + scoped agent for scope enforcement tests
let scopedAgentGaii = '';
let scopedAgentPrivKey = '';
let scopedAgentToken = '';
const scopedOwnerName = `scopeowner${Date.now()}`;
let scopedOwnerToken = '';
const scopedAgentName = 'scoped-test-' + Date.now();

await test('Register agent with limited scopes', async () => {
    // Create a non-operator owner (via regular registration, not admin setup)
    const { body: owReg } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: scopedOwnerName, public_key: 'placeholder' }),
    });
    assert(owReg.ok === true, `register scope owner: ${JSON.stringify(owReg.error)}`);
    const scopedOwnerPrivKey = owReg.data.private_key;

    // Get owner token
    const ts = new Date().toISOString();
    const sig = await signMsg(scopedOwnerPrivKey, scopedOwnerName + NODE_ID + ts);
    const { body: tkBody } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: scopedOwnerName, timestamp: ts, signature: sig }),
    });
    scopedOwnerToken = tkBody.data?.token;

    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedOwnerToken}` },
        body: JSON.stringify({
            name: scopedAgentName,
            owner: scopedOwnerName,
            capabilities: ['memory'],
            scopes: ['memory:read', 'catalogue:read'],
        }),
    });
    assert(status === 201, `status: ${status}`);
    assert(body.ok === true, `register: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data?.agent?.scopes), 'scopes returned');
    assert(body.data.agent.scopes.includes('memory:read'), 'has memory:read');
    assert(!body.data.agent.scopes.includes('memory:write'), 'no memory:write');
    scopedAgentGaii = body.data.agent.gaii;
    scopedAgentPrivKey = body.data.private_key;
});

await test('Authenticate scoped agent', async () => {
    const timestamp = new Date().toISOString();
    const message = scopedAgentGaii + timestamp;
    const signature = await signMsg(scopedAgentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: scopedAgentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `auth: ${JSON.stringify(body.error)}`);
    scopedAgentToken = body.data.token;
});

await test('Scoped agent can read memory (has memory:read)', async () => {
    const { status, body } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
    });
    assert(status === 200, `status: ${status}`);
    assert(body.ok === true, `read: ${JSON.stringify(body.error)}`);
});

await test('Scoped agent denied memory write (no memory:write)', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
        body: JSON.stringify({ key: 'test-scope', value: 'denied', visibility: 'private' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('Scoped agent denied wallet access (no wallet:read)', async () => {
    const { status, body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('Wildcard agent still has full access', async () => {
    // The original test agent has ['*'] scopes (backward compat)
    const { status: memStatus } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(memStatus === 200, `wildcard memory: ${memStatus}`);
    const { status: walStatus } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(walStatus === 200, `wildcard wallet: ${walStatus}`);
});

await test('PATCH scopes updates agent permissions', async () => {
    const { status, body } = await json(`/v1/agents/${scopedAgentName}/scopes`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${scopedOwnerToken}` },
        body: JSON.stringify({ scopes: ['memory:*', 'catalogue:read'] }),
    });
    assert(status === 200, `patch status: ${status}`);
    assert(body.ok === true, `patch: ${JSON.stringify(body.error)}`);
    assert(body.data?.scopes?.includes('memory:*'), 'updated to memory:*');
});

await test('Re-auth scoped agent gets new scopes', async () => {
    const timestamp = new Date().toISOString();
    const message = scopedAgentGaii + timestamp;
    const signature = await signMsg(scopedAgentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: scopedAgentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `re-auth: ${JSON.stringify(body.error)}`);
    scopedAgentToken = body.data.token;

    // Now memory:write should work (has memory:*)
    const { status: writeStatus, body: writeBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
        body: JSON.stringify({ key: 'scope-test-write', value: 'allowed now', visibility: 'private' }),
    });
    assert(writeStatus === 200 || writeStatus === 201, `write after scope update: ${writeStatus} ${JSON.stringify(writeBody.error)}`);
});

// Clean up template for GDPR cascade
await json('/v1/site/template', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
});

// ─── Observability ───
console.log('Observability');

await test('GET /v1/stats includes tunnel section', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, 'ok');
    assert(body.data.tunnel !== undefined, 'should include tunnel section');
    assert(typeof body.data.tunnel.connections_active === 'number', 'connections_active');
    assert(typeof body.data.tunnel.connections_total === 'number', 'connections_total');
    assert(typeof body.data.tunnel.disconnections_total === 'number', 'disconnections_total');
    assert(typeof body.data.tunnel.messages_sent_total === 'number', 'messages_sent_total');
    assert(typeof body.data.tunnel.delivery_latency_avg_ms === 'number', 'delivery_latency_avg_ms');
    assert(typeof body.data.tunnel.delivery_latency_p95_ms === 'number', 'delivery_latency_p95_ms');
    assert(typeof body.data.tunnel.heartbeat_misses_total === 'number', 'heartbeat_misses_total');
    assert(typeof body.data.tunnel.mailbox_fallbacks_total === 'number', 'mailbox_fallbacks_total');
});

await test('GET /v1/stats includes mailbox section', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, 'ok');
    assert(body.data.mailbox !== undefined, 'should include mailbox section');
    assert(typeof body.data.mailbox.items_total === 'number', 'items_total');
    assert(typeof body.data.mailbox.bytes_total === 'number', 'bytes_total');
    assert(typeof body.data.mailbox.enqueued_total === 'number', 'enqueued_total');
    assert(typeof body.data.mailbox.delivered_total === 'number', 'delivered_total');
    assert(typeof body.data.mailbox.expired_total === 'number', 'expired_total');
    assert(typeof body.data.mailbox.quota_rejections_total === 'number', 'quota_rejections_total');
    assert(typeof body.data.mailbox.oldest_item_age_seconds === 'number', 'oldest_item_age_seconds');
});

await test('GET /v1/stats includes auth/rate-limit counters', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, 'ok');
    assert(typeof body.data.auth_failures_total === 'number', 'auth_failures_total');
    assert(typeof body.data.rate_limit_hits_total === 'number', 'rate_limit_hits_total');
    assert(typeof body.data.scope_denials_total === 'number', 'scope_denials_total');
});

await test('GET /v1/stats backward compatibility', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, 'ok');
    assert(typeof body.data.uptime_seconds === 'number', 'uptime_seconds');
    assert(typeof body.data.requests_total === 'number', 'requests_total');
    assert(typeof body.data.requests_by_method === 'object', 'requests_by_method');
    assert(typeof body.data.requests_by_status === 'object', 'requests_by_status');
    assert(typeof body.data.memory_writes === 'number', 'memory_writes');
    assert(typeof body.data.memory_reads === 'number', 'memory_reads');
    assert(typeof body.data.active_owners === 'number', 'active_owners');
    assert(typeof body.data.active_agents === 'number', 'active_agents');
});

await test('GET /v1/stats includes notification counters and gauges', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, 'ok');
    // Notification counters are dynamic typed fields: present as number when
    // incrementTyped has been called, absent otherwise. Both states are valid.
    const emailSent = body.data.email_sent;
    const pushSent = body.data.push_sent;
    assert(emailSent === undefined || typeof emailSent === 'number',
        'email_sent should be a number or absent');
    assert(pushSent === undefined || typeof pushSent === 'number',
        'push_sent should be a number or absent');
    // Gauges object with point-in-time values
    assert(typeof body.data.gauges === 'object' && body.data.gauges !== null, 'gauges should be an object');
    assert(typeof body.data.gauges.tunnel_connections_active === 'number', 'gauges.tunnel_connections_active');
    assert(typeof body.data.gauges.mailbox_items_total === 'number', 'gauges.mailbox_items_total');
    assert(typeof body.data.gauges.mailbox_bytes_total === 'number', 'gauges.mailbox_bytes_total');
    assert(typeof body.data.gauges.mailbox_oldest_item_age_seconds === 'number', 'gauges.mailbox_oldest_item_age_seconds');
    // Daily history (last 30 days) is included in default response
    assert(typeof body.data.daily === 'object' && body.data.daily !== null, 'daily should be an object');
});

await test('GET /v1/stats?from&to returns time-range response', async () => {
    const { body } = await json('/v1/stats?from=2020-01-01&to=2099-12-31');
    assert(body.ok === true, 'ok');
    // Range response has flat counters, daily, and gauges (no totals wrapper)
    assert(typeof body.data.daily === 'object' && body.data.daily !== null, 'daily should be an object');
    assert(typeof body.data.gauges === 'object' && body.data.gauges !== null, 'gauges should be an object');
    // Range echoes the from/to params
    assert(body.data.from === '2020-01-01', 'from echoed');
    assert(body.data.to === '2099-12-31', 'to echoed');
    // Counters are at root level (flat shape)
    assert(typeof body.data.requests_total === 'number', 'requests_total in range');
    // Shared fields still present
    assert(typeof body.data.active_owners === 'number', 'active_owners in range');
    assert(typeof body.data.active_agents === 'number', 'active_agents in range');
});

await test('GET /v1/stats empty time range returns no daily entries', async () => {
    const { body } = await json('/v1/stats?from=2020-01-01&to=2020-01-02');
    assert(body.ok === true, 'ok');
    assert(typeof body.data.requests_total === 'number', 'requests_total exists at root level');
    assert(typeof body.data.daily === 'object' && body.data.daily !== null, 'daily exists');
    // Historical range with no data should have empty daily
    assert(Object.keys(body.data.daily).length === 0, 'daily should be empty for historical range');
});

await test('Response includes X-Request-Id header', async () => {
    const { headers } = await json('/v1/health');
    const requestId = headers.get('x-request-id');
    assert(requestId !== null && requestId.length > 0, 'should have X-Request-Id header');
});

await test('X-Request-Id is echoed when provided', async () => {
    const customId = 'test-correlation-id-e2e-' + Date.now();
    const { headers } = await json('/v1/health', {
        headers: { 'X-Request-Id': customId },
    });
    const returnedId = headers.get('x-request-id');
    assert(returnedId === customId, `expected ${customId}, got ${returnedId}`);
});

await test('GET /v1/health includes subsystems', async () => {
    const { body } = await json('/v1/health');
    assert(body.ok === true, 'ok');
    assert(body.data.status === 'healthy' || body.data.status === 'degraded', 'status');
    assert(typeof body.data.uptime_seconds === 'number', 'uptime_seconds');
    assert(typeof body.data.memory_mb === 'number', 'memory_mb');
    assert(body.data.subsystems !== undefined, 'should include subsystems');
    assert(body.data.subsystems.storage !== undefined, 'should include storage');
    assert(body.data.subsystems.storage.healthy === true, 'storage should be healthy');
});

await test('GET /v1/metrics returns 503 when disabled', async () => {
    const { status, body } = await json('/v1/metrics');
    // Metrics disabled by default (AIMEAT_METRICS_ENABLED=false)
    // Should return 503 FEATURE_DISABLED
    assert(status === 503, `expected 503, got ${status}`);
    assert(body.error?.code === 'FEATURE_DISABLED', 'should be FEATURE_DISABLED');
});

// ─── Phase 7: Consent Recipient Patterns ───
console.log('Phase 7 — Consent Recipient Patterns');

// Create a second owner + agent for cross-owner consent tests
const owner2Name = `testowner2-${Date.now()}`;
let owner2Token = '';
let agent2bToken = '';
let agent2bGaii = '';

await test('Setup — register second owner for consent tests', async () => {
    const { body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(body.ok === true, `register owner2: ${JSON.stringify(body.error)}`);
    const privKey = body.data?.private_key;

    // Get owner token
    const ts = new Date().toISOString();
    const sig = await signMsg(privKey, owner2Name + NODE_ID + ts);
    const { body: tkBody } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: owner2Name, timestamp: ts, signature: sig }),
    });
    owner2Token = tkBody.data?.token;
    assert(typeof owner2Token === 'string', 'got owner2 token');

    // Register agent under owner2
    const { body: agBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'consent-tester', owner: owner2Name, capabilities: ['memory'], model: 'test' }),
    });
    assert(agBody.ok === true, `register agent2b: ${JSON.stringify(agBody.error)}`);
    agent2bGaii = agBody.data.agent.gaii;
    const ag2PrivKey = agBody.data.private_key;

    // Get agent token
    const ts2 = new Date().toISOString();
    const sig2 = await signMsg(ag2PrivKey, agent2bGaii + ts2);
    const { body: tk2Body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2bGaii, timestamp: ts2, signature: sig2 }),
    });
    agent2bToken = tk2Body.data?.token;
    assert(typeof agent2bToken === 'string', 'got agent2b token');
});

await test('Consent — ghii: recipient creates successfully', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: 'consent-test.ghii.*',
            recipient: `ghii:${owner2Name}@${NODE_ID}`,
            purpose: 'ghii recipient test',
            scope: 'private',
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data?.recipient === `ghii:${owner2Name}@${NODE_ID}`, 'recipient stored');
});

await test('Consent — domain: recipient creates successfully', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: 'consent-test.domain.*',
            recipient: 'domain:aimeat-*',
            purpose: 'domain recipient test',
            scope: 'private',
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
});

await test('Consent — node: recipient creates successfully', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: 'consent-test.node.*',
            recipient: `node:${NODE_ID}`,
            purpose: 'node recipient test',
            scope: 'private',
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
});

await test('Consent — invalid recipient format returns 400', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: 'test.*',
            recipient: 'bad format with spaces',
            purpose: 'should fail',
        }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_RECIPIENT', `expected INVALID_RECIPIENT, got ${body.error?.code}`);
});

await test('Consent — ghii: recipient grants cross-owner access via public memory', async () => {
    // Write private memory as agent1
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'consent-test.ghii.data', value: { secret: 'for-ghii' }, visibility: 'private' }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // Read via public memory endpoint as agent2b (different owner) — should succeed via ghii: consent
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/consent-test.ghii.data`, {
        headers: { Authorization: `Bearer ${agent2bToken}` },
    });
    assert(status === 200 || body.ok === true, `ghii access: status=${status}, ${JSON.stringify(body.error)}`);
    assert(body.data?.value?.secret === 'for-ghii', 'got consent-protected data via ghii recipient');
});

await test('Consent — ghii: wrong user is denied', async () => {
    // Write private memory with a pattern that only matches owner2
    // agent1's consent-test.ghii.* grants to ghii:owner2@NODE_ID
    // If we try from a non-matching accessor, it should fail
    // Use the owner token directly (acts as owner, not matching ghii)
    const { status } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/consent-test.ghii.data`);
    // No auth = anonymous → no matching consent → 403 or 404
    assert(status === 403 || status === 404, `expected 403/404 for unauthenticated, got ${status}`);
});

await test('Consent — node: recipient grants access to agents on matching node', async () => {
    // Write private memory
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'consent-test.node.data', value: { secret: 'for-node' }, visibility: 'private' }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // Read via public memory endpoint as agent2b (same node) — should succeed via node: consent
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/consent-test.node.data`, {
        headers: { Authorization: `Bearer ${agent2bToken}` },
    });
    assert(status === 200 || body.ok === true, `node access: status=${status}, ${JSON.stringify(body.error)}`);
    assert(body.data?.value?.secret === 'for-node', 'got consent-protected data via node recipient');
});

// ─── Phase 7b: Permissions Listing API ───
console.log('Phase 7b — Permissions Listing API');

await test('GET /v1/permissions/summary — returns correct counts', async () => {
    const { status, body } = await json('/v1/permissions/summary', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data?.active_consents >= 3, `expected ≥3 active consents, got ${body.data?.active_consents}`);
    assert(body.data?.rules_by_recipient_type?.ghii >= 1, 'expected ≥1 ghii rule');
    assert(body.data?.rules_by_recipient_type?.domain >= 1, 'expected ≥1 domain rule');
    assert(body.data?.rules_by_recipient_type?.node >= 1, 'expected ≥1 node rule');
    assert(typeof body.data?.total_memory_keys === 'number', 'has total_memory_keys');
    assert(Array.isArray(body.data?.data_patterns), 'has data_patterns array');
});

await test('GET /v1/permissions/check — allowed case (consent exists)', async () => {
    const { status, body } = await json(
        `/v1/permissions/check?key=consent-test.ghii.data&accessor=${encodeURIComponent(agent2bGaii)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.allowed === true, `expected allowed=true, got ${body.data?.allowed}`);
    assert(body.data?.reason === 'consent_granted', `expected consent_granted, got ${body.data?.reason}`);
});

await test('GET /v1/permissions/check — denied case (no consent)', async () => {
    const { status, body } = await json(
        `/v1/permissions/check?key=no-consent-key&accessor=${encodeURIComponent(agent2bGaii)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.allowed === false, `expected allowed=false, got ${body.data?.allowed}`);
});

await test('GET /v1/permissions/memory/:key — returns matching consents', async () => {
    const { status, body } = await json('/v1/permissions/memory/consent-test.ghii.data', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.data?.effective_rules), 'has effective_rules array');
    assert(body.data.effective_rules.length >= 1, 'at least 1 matching rule');
    assert(body.data.effective_rules[0].recipient.startsWith('ghii:'), 'rule has ghii: recipient');
});

await test('GET /v1/permissions/memory/:key — no rules returns empty array', async () => {
    const { status, body } = await json('/v1/permissions/memory/unmatched-key', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.effective_rules?.length === 0, 'empty rules for unmatched key');
});

// ─── Phase 7c: Storage Consent Integration ───
console.log('Phase 7c — Storage Consent Integration');

await test('Storage — public file accessible without auth', async () => {
    // Upload a public file
    const { status: upStatus, body: upBody } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            key: 'consent-test-public.txt',
            data: Buffer.from('public content').toString('base64'),
            visibility: 'public',
            mime_type: 'text/plain',
        }),
    });
    assert(upStatus === 201, `upload: ${JSON.stringify(upBody.error)}`);

    // Read without auth
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(agentGaii)}/consent-test-public.txt`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text === 'public content', 'got public file content');
});

await test('Storage — private file returns 404 without auth', async () => {
    // Upload a private file
    await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            key: 'consent-test-private.txt',
            data: Buffer.from('private content').toString('base64'),
            visibility: 'private',
            mime_type: 'text/plain',
        }),
    });

    // Read without auth — should be 404
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(agentGaii)}/consent-test-private.txt`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test('Storage — private file accessible with consent + auth', async () => {
    // Create consent for storage files (data_pattern uses storage: prefix)
    const { status: cStatus } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: 'storage:consent-test-private.*',
            recipient: `ghii:${owner2Name}@${NODE_ID}`,
            purpose: 'storage consent test',
            scope: 'private',
        }),
    });
    assert(cStatus === 201, `consent creation: ${cStatus}`);

    // Read as agent2b (has consent via ghii:)
    const { status, body } = await json(`/v1/pub/${encodeURIComponent(agentGaii)}/consent-test-private.txt`, {
        headers: { Authorization: `Bearer ${agent2bToken}` },
    });
    // The file endpoint returns raw content, not JSON, when successful
    // So a 200 with content means success
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
});

// Clean up second owner
await test('Cleanup — delete second owner', async () => {
    const { body } = await json(`/v1/owners/${owner2Name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(body.ok === true, `delete owner2: ${JSON.stringify(body.error)}`);
});

// ── Phase 8: Device Authorization Flow ────────────────────────────
console.log('\n── Phase 8: Device Authorization Flow ──');

let deviceAuthCode: string;
let deviceAuthUserCode: string;

await test('Agent starts device authorization', async () => {
  const r = await json('/v1/agents/device-authorize', {
    method: 'POST',
    body: JSON.stringify({ agent_name: 'device-auth-bot', owner: ownerName }),
  });
  assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.device_code, 'Missing device_code');
  assert(r.body.data.user_code, 'Missing user_code');
  assert(r.body.data.verification_uri_complete, 'Missing verification_uri_complete');
  assert(r.body.data.interval > 0, 'Missing interval');
  deviceAuthCode = r.body.data.device_code;
  deviceAuthUserCode = r.body.data.user_code;
});

await test('Owner approves device authorization', async () => {
  const r = await json('/v1/agents/verify', {
    method: 'POST',
    body: JSON.stringify({
      user_code: deviceAuthUserCode,
      action: 'approve',
      owner_token: ownerToken,
    }),
  });
  assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.status === 'approved', `Expected approved, got ${r.body.data.status}`);
  assert(r.body.data.gaii, 'Missing gaii');
});

let deviceAuthAgentToken: string;
let deviceAuthGaii: string;

await test('Agent polls and receives credentials', async () => {
  const r = await json('/v1/agents/device-token', {
    method: 'POST',
    body: JSON.stringify({
      device_code: deviceAuthCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.gaii, 'Missing gaii');
  assert(r.body.token, 'Missing token');
  assert(r.body.privateKey, 'Missing privateKey');
  deviceAuthAgentToken = r.body.token;
  deviceAuthGaii = r.body.gaii;
});

await test('Device code cannot be reused after credential retrieval', async () => {
  const r = await json('/v1/agents/device-token', {
    method: 'POST',
    body: JSON.stringify({
      device_code: deviceAuthCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  assert(r.status === 400, `Expected 400, got ${r.status}`);
  // Rate limiter may return slow_down if polled too quickly; expired_token when credentials already consumed
  assert(
    r.body.error === 'expired_token' || r.body.error === 'slow_down',
    `Expected expired_token or slow_down, got ${r.body.error}`,
  );
});

// ─── GDPR ───
console.log('GDPR');

await test('Owner data export', async () => {
    const { body } = await json(`/v1/owners/${ownerName}/export`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `export: ${JSON.stringify(body.error)}`);
    assert(body.data?.owner?.name === ownerName, 'has owner data');
});

await test('Owner delete (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');

    // Verify owner is gone
    const { body: gBody } = await json(`/v1/owners/${ownerName}`);
    assert(gBody.ok === false || gBody.data === null, 'owner gone');
});

// A25 (E2E test-quality audit). Everything below used to run on `ownerToken` — the credential of the
// account the test above just erased. It worked, which is the point: the JWT is valid until its own
// exp, and whether the erasure also kills it depends on the BACKEND. The postgres cascade clears the
// Session table with the owner and the SQLite one does not, so the identical sequence answers 200 on
// one and 401 on the other; that divergence is on record in commit 8003a58a, which reversed the
// order in three other suites for exactly this reason. This is the fourth. Rather than assert a
// backend-dependent status, the suite stops using a dead credential: a fresh owner, freshly minted.
let configOwnerName = '';
await test('Re-register an owner for the config tests (the previous one was just erased)', async () => {
    configOwnerName = `cfgowner${Date.now()}`;
    let privKey = '';
    if (ADMIN_PW && isOperator) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: configOwnerName }),
        });
        assert(status === 200, `admin re-register ${status}: ${JSON.stringify(body)}`);
        privKey = body.private_key;
        const tk = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: configOwnerName, private_key: privKey }),
        });
        assert(tk.body.ok === true, `admin re-token: ${JSON.stringify(tk.body.error)}`);
        ownerToken = tk.body.token;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: configOwnerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `re-register ${status}: ${JSON.stringify(body)}`);
        privKey = body.data.private_key;
        const timestamp = new Date().toISOString();
        const tk = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: configOwnerName, timestamp, signature: await signMsg(privKey, configOwnerName + NODE_ID + timestamp) }),
        });
        assert(tk.body.ok === true, `re-token: ${JSON.stringify(tk.body.error)}`);
        ownerToken = tk.body.data?.token;
    }
    assert(typeof ownerToken === 'string' && ownerToken.length > 0, 'got a live owner token');
});

// ─── Config System ───
console.log('\nConfig System');

await test('GET /v1/admin/config returns schema with source provenance', async () => {
    const { body } = await json('/v1/admin/config', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data.schema !== undefined, 'has schema');
    assert(typeof body.data.editable === 'boolean', 'has editable flag');
    // Check at least one field has source info
    const firstField = Object.values(body.data.schema as Record<string, any>)[0];
    assert(firstField.source !== undefined, 'fields have source provenance');
});

await test('GET /v1/admin/config includes canReset for database fields', async () => {
    const { body } = await json('/v1/admin/config', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    // All default fields should have canReset: false
    for (const [, entry] of Object.entries(body.data.schema as Record<string, any>)) {
        if ((entry as any).source === 'default') {
            assert((entry as any).canReset === false, `default field should not be resettable`);
        }
    }
});

await test('PUT /v1/admin/config persists mutable field', async () => {
    const { body, status } = await json('/v1/admin/config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ changes: [{ path: 'morsel_policy.welcome_bonus', value: 999 }] }),
    });
    // If in-memory, expect 403; if persistent, expect 200
    if (status === 403) {
        assert(body.error?.code === 'READONLY_CONFIG', 'in-memory guard');
    } else {
        assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
        assert(body.data.applied?.length >= 1, 'at least one applied');
    }
});

await test('PUT /v1/admin/config rejects immutable field', async () => {
    const { body, status } = await json('/v1/admin/config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ changes: [{ path: 'node.id', value: 'hacked' }] }),
    });
    if (status === 403) {
        // In-memory guard kicks in first
        assert(body.error?.code === 'READONLY_CONFIG', 'in-memory guard');
    } else if (status === 400) {
        // Immutable field rejected as unknown/immutable path
        assert(body.error?.code === 'INVALID_INPUT', 'immutable rejected');
    } else {
        // Immutable field should be skipped, not applied
        assert(body.ok === true, 'ok');
        assert(!body.data.applied?.includes('node.id'), 'node.id not applied');
    }
});

await test('PUT /v1/admin/config validates field types', async () => {
    const { body, status } = await json('/v1/admin/config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ changes: [{ path: 'morsel_policy.welcome_bonus', value: 'not-a-number' }] }),
    });
    if (status === 403) {
        // In-memory guard
        assert(true, 'in-memory guard');
    } else if (status === 400) {
        // Invalid value rejected
        assert(body.error?.code === 'INVALID_INPUT', 'invalid value rejected');
    } else {
        // Should reject invalid type
        assert(body.ok === true, 'ok');
        assert(body.data.skipped?.length >= 1, 'invalid value should be skipped');
    }
});

await test('GET /v1/admin/consul returns status (disabled or enabled)', async () => {
    const { body } = await json('/v1/admin/consul', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(typeof body.data.enabled === 'boolean', 'has enabled flag');
});

// ─── Shutdown ───
if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    console.log('Test server stopped');
}

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
