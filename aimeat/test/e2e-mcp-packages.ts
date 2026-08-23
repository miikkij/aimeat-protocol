/**
 * @file e2e-mcp-packages.ts
 * @description E2E for the package tools on the two doors an agent actually reaches: the node's own
 *   JSON-RPC surface at /v1/mcp, and the CLI dispatch a fleet daemon calls behind /local/call.
 *
 *   WHY THIS SUITE EXISTS. Two defects of the same family, both of which passed every static check.
 *
 *   The five aimeat_package_* tools were declared in the catalog and listed on the appdev surface,
 *   but src/mcp/index.ts registered none of them, so the node's own MCP served no package tool at
 *   all — the person's chat could read a package's description and had no way to install it. Only
 *   install is registered there now (authoring stays on the connector doors), and this suite calls
 *   it the way an AI chat does rather than asking whether it appears in a list.
 *
 *   aimeat_package_publish declared and sent {name, description, content}. POST /v1/packages
 *   requires a `components` array and reads no `content` field, so every call the tool described was
 *   answered 400 INVALID_INPUT: published, callable, and unable to succeed once. The publish test
 *   below invokes the CLI handler against the real route, which is the only place that shows.
 *
 *   The two prove each other: the package installed here is the one published here, so a publish
 *   that builds the wrong body cannot be hidden by an install that never needed it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-packages
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial: install on the node MCP, publish + install on the CLI dispatch,
 *     and the scope fence on both.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { CONNECT_CLI_TOOLS } from '../src/cli/connect/tool-call.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'PackageTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `pkg${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return tok.body.data.token as string;
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-packages', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

// ── The CLI dispatch door ──────────────────────────────────────────────────────────────────────

/**
 * A client shaped like the one a connect session hands its handlers, except it really talks to the
 * server under test. The recording client in the unit suite proves a parameter LEAVES the process;
 * only a real one proves the route accepts what left.
 */
function liveClient(token: string) {
    const call = async (method: string, path: string, body?: unknown): Promise<any> => {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...authed(token) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        try { return JSON.parse(text); } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 200) } }; }
    };
    return {
        get: (p: string) => call('GET', p),
        post: (p: string, b?: unknown) => call('POST', p, b),
        put: (p: string, b?: unknown) => call('PUT', p, b),
        patch: (p: string, b?: unknown) => call('PATCH', p, b),
        delete: (p: string) => call('DELETE', p),
    };
}

async function cliCall(token: string, name: string, input: Record<string, unknown>): Promise<any> {
    const tool = CONNECT_CLI_TOOLS.find((t) => t.name === name);
    assert(tool, `${name} is not in the CLI dispatch table`);
    return await tool!.handler(
        { client: liveClient(token) as never, config: {} as never, agentPath: 'e2e' },
        input,
    );
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: package tools on the MCP surfaces ═══');
console.log(`Base: ${BASE}`);

const owner = await makeOwner('pkgmcp');
const agentToken = await makeAgent(owner, ['packages:write', 'app:write', 'memory:read']);
const narrowToken = await makeAgent(owner, ['memory:read']);

const PKG_NAME = `e2e-mcp-pkg-${Date.now().toString(36).slice(-6)}`;
let groupId = '';
let version = '';

console.log('\nPhase 1 — publishing through the CLI dispatch');

await test('1. aimeat_package_publish sends the body the route reads', async () => {
    // The defect this asserts: the handler posted {name, description, content} and the route
    // requires `components`, so the answer was 400 INVALID_INPUT every time.
    const out = await cliCall(owner.token, 'aimeat_package_publish', {
        name: PKG_NAME,
        description: 'Published by the CLI dispatch in an E2E run',
        category: 'tool',
        components: [
            { id: 'brain-app.html', type: 'app', label: 'Brain', content: '<!doctype html><html><head><title>t</title></head><body><h1>E2E PACKAGE APP</h1></body></html>' },
        ],
    });
    assert(out?.ok === true, `publish refused: ${JSON.stringify(out?.error ?? out).slice(0, 300)}`);
    groupId = out.data.packageGroupId;
    version = out.data.version;
    assert(groupId && version, `no group id or version in ${JSON.stringify(out.data).slice(0, 200)}`);
    assert(Array.isArray(out.data.components) && out.data.components.length === 1,
        'the component the tool sent must be the component the package holds');
});

await test('2. a publish with no components is refused rather than half-built', async () => {
    const out = await cliCall(owner.token, 'aimeat_package_publish', { name: `${PKG_NAME}-empty`, components: [] });
    assert(out?.ok === false, 'an empty component list must be refused');
    const listed = await json(`/v1/packages/${encodeURIComponent(`${PKG_NAME}-empty::${owner.owner}`)}`, { headers: authed(owner.token) });
    assert(listed.status === 404, `the refused package must not exist, got ${listed.status}`);
});

await test('3. the version is published so it can be installed', async () => {
    const r = await json(`/v1/packages/${encodeURIComponent(groupId)}/versions/${version}`, {
        method: 'PATCH', headers: authed(owner.token), body: JSON.stringify({ status: 'published' }),
    });
    assert(r.status === 200 && r.body.data?.status === 'published', `publish failed: ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 2 — installing from the node MCP');

const session = await openSession(agentToken);

await test('4. aimeat_package_install is offered to an agent that holds packages:write', async () => {
    const names = await toolNames(session);
    assert(names.includes('aimeat_package_install'),
        `the node MCP must serve the install tool; it offered ${names.length} tools without it`);
});

await test('5. …and is not offered to an agent that does not', async () => {
    const names = await toolNames(await openSession(narrowToken));
    assert(!names.includes('aimeat_package_install'),
        'an agent without packages:write must not be handed the install tool');
});

await test('6. a dry run reports what would be registered and registers nothing', async () => {
    const out = toolJson(await mcpRpc(session, 'tools/call', {
        name: 'aimeat_package_install',
        arguments: { group_id: groupId, label: 'Dry run', dry_run: true },
    }));
    assert(Array.isArray(out.components), `expected a preview, got ${JSON.stringify(out).slice(0, 200)}`);
    const instances = await json('/v1/instances', { headers: authed(owner.token) });
    assert(!(instances.body.data?.instances ?? []).some((i: any) => i.label === 'Dry run'),
        'a dry run must not leave an instance behind');
});

let instanceId = '';

await test('7. installing gives the owner their own copy, with the addresses it registered', async () => {
    const out = toolJson(await mcpRpc(session, 'tools/call', {
        name: 'aimeat_package_install',
        arguments: { group_id: groupId, label: 'Company Brain for the E2E company' },
    }));
    assert(out.instance_id, `no instance in ${JSON.stringify(out).slice(0, 300)}`);
    instanceId = out.instance_id;
    assert(out.label === 'Company Brain for the E2E company', `label lost: ${out.label}`);
    assert(out.components?.length === 1, `expected one component, got ${JSON.stringify(out.components)}`);
    // The registered name is the address the front page will point at, so the tool has to report it.
    assert(String(out.components[0].registered_as).endsWith('.html'),
        `an app component must install under a filename an app origin recognises: ${out.components[0].registered_as}`);
});

await test('8. the instance the tool made is the owner\'s, and the route sees the same one', async () => {
    const r = await json(`/v1/instances/${instanceId}`, { headers: authed(owner.token) });
    assert(r.status === 200, `the instance must be readable by its owner, got ${r.status}`);
    assert(r.body.data?.packageGroupId === groupId, 'the instance points at another package');
});

await test('9. an unknown package is refused by name, not answered with an empty copy', async () => {
    const body = await mcpRpc(session, 'tools/call', {
        name: 'aimeat_package_install', arguments: { group_id: 'ei-olemassa::kukaan' },
    });
    assert(body?.result?.isError === true, `expected a refusal, got ${JSON.stringify(body).slice(0, 300)}`);
    const text = body.result.content?.[0]?.text ?? '';
    assert(text.includes('NOT_FOUND'), `the refusal must name the reason: ${text}`);
});

console.log('\nPhase 3 — installing through the CLI dispatch');

await test('10. the same install runs on the door a fleet daemon calls', async () => {
    const out = await cliCall(owner.token, 'aimeat_package_install', {
        group_id: groupId, label: 'Second copy, from the CLI door',
    });
    assert(out?.ok === true, `install refused: ${JSON.stringify(out?.error ?? out).slice(0, 300)}`);
    assert(out.data?.id && out.data.id !== instanceId,
        'a second install must be a separate copy, not the first one again');
    assert(out.data.label === 'Second copy, from the CLI door', `label lost: ${out.data.label}`);
});

await test('11. a dry run through that door registers nothing either', async () => {
    const out = await cliCall(owner.token, 'aimeat_package_install', {
        group_id: groupId, label: 'CLI dry run', dry_run: true,
    });
    assert(out?.ok === true, `dry run refused: ${JSON.stringify(out?.error ?? out).slice(0, 200)}`);
    const instances = await json('/v1/instances', { headers: authed(owner.token) });
    assert(!(instances.body.data?.instances ?? []).some((i: any) => i.label === 'CLI dry run'),
        'a dry run must not leave an instance behind');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
