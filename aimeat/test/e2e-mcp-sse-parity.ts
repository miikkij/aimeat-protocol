/**
 * @file test/e2e-mcp-sse-parity.ts
 * @description Does an open page hear about work an agent does?
 *
 *   Every live view in this node subscribes to one or more SSE change domains, and every REST route
 *   that writes emits the domain its view listens on. The MCP tools mostly did not: 21 of the 31
 *   tool files that write emitted nothing at all. The write landed, so nothing looked broken — and
 *   the person watching the screen saw yesterday's state until they reloaded, which reads as "the
 *   agent did nothing" rather than "the page is stale".
 *
 *   That is a hard thing to notice and an easy thing to measure, so this file measures it: open one
 *   real SSE stream as the owner, drive a tool over a real MCP session, and wait for the domain
 *   frame. Nothing here asserts an internal call; it asserts what a browser would have received.
 *
 *   The negative control matters as much as the rest. A stream that receives EVERY domain on every
 *   write would pass each of these for the wrong reason, so one test drives a tool whose domain is
 *   deliberately different and checks the unrelated domain does NOT arrive.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-sse-parity
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: the side-effect sweep).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import { NOT_IN_WILDCARD } from '../public/views/profile/agents/scope-model.js';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

function parseSSE(text: string, id: number): any {
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
    }
    return {};
}

// ── The owner's live stream ─────────────────────────────────────────────────────────────────────
interface Stream { domains(): string[]; waitFor(domain: string, ms: number): Promise<void>; close(): void }

async function openStream(ownerToken: string): Promise<Stream> {
    const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(t.status === 200 && !!t.body.data.ticket, `ticket: ${t.status} ${JSON.stringify(t.body)}`);
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream status ${res.status}`);

    let buf = '';
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) buf += dec.decode(value, { stream: true });
            }
        } catch { /* aborted on close() */ }
    })();

    const seen = () => {
        const out: string[] = [];
        for (const evt of buf.split('\n\n')) {
            for (const line of evt.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const p = JSON.parse(line.slice(6));
                    if (Array.isArray(p.domains)) out.push(...p.domains);
                } catch { /* heartbeat or partial frame */ }
            }
        }
        return out;
    };

    return {
        domains: seen,
        async waitFor(domain, ms) {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                if (seen().includes(domain)) return;
                await new Promise(r => setTimeout(r, 40));
            }
            throw new Error(`no '${domain}' frame within ${ms}ms; saw [${[...new Set(seen())].join(', ')}]`);
        },
        close() { ctrl.abort(); },
    };
}

// ── One MCP session ─────────────────────────────────────────────────────────────────────────────
interface Session { token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

async function callTool(s: Session, name: string, args: Record<string, unknown>) {
    const body = await rpc(s, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, text };
}

async function setup() {
    const owner = `sseparity${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'SSE', password: 'SseParity1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    const ownerToken = tok.body.data.token as string;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        // '*' PLUS the words no wildcard carries: creating a sharing group is one of them since
        // 2026-08-11, so a Full-access agent does not get it for free.
        body: JSON.stringify({ name: 'ssebot', owner, capabilities: ['memory'], model: 'gpt-4o', scopes: ['*', ...NOT_IN_WILDCARD] }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;

    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'sse parity', redirect_uris: [] }) });
    const ats = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const session: Session = { token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sse parity e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`, 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return { owner, ownerToken, agentGaii, session };
}

console.log('\n=== MCP writes reach an open page (August 2026 audit) ===\n');

async function run() {
    const A = await setup();

    /** Drive a tool, then wait for the domain a live view would be listening on. */
    async function proves(what: string, domain: string, tool: string, args: Record<string, unknown>) {
        await test(`${what} reaches an open page on the '${domain}' domain`, async () => {
            const stream = await openStream(A.ownerToken);
            try {
                const r = await callTool(A.session, tool, args);
                assert(!r.isError, `${tool} failed: ${r.text.slice(0, 250)}`);
                await stream.waitFor(domain, 6_000);
            } finally { stream.close(); }
        });
    }

    const stamp = Date.now();

    // Created outside proves() so its id is in hand for the post below; the same assertion runs.
    let boardId = '';
    await test("a board an agent creates reaches an open page on the 'boards' domain", async () => {
        const stream = await openStream(A.ownerToken);
        try {
            const r = await callTool(A.session, 'aimeat_board_create',
                { name: `sse-board-${stamp}`, description: 'sse parity', visibility: 'private' });
            assert(!r.isError, `board create failed: ${r.text.slice(0, 250)}`);
            const made = JSON.parse(r.text);
            boardId = made.board_id ?? made.id ?? made.board?.id ?? '';
            assert(!!boardId, `no board id in: ${r.text.slice(0, 250)}`);
            await stream.waitFor('boards', 6_000);
        } finally { stream.close(); }
    });
    assert(!!boardId, 'the board id is needed by the post test below');

    await proves('a post an agent writes', 'boards', 'aimeat_board_post',
        { board_id: boardId, title: 'From an agent', body: 'The page should not need a reload.' });

    await proves('a memory record an agent writes', 'memory', 'aimeat_memory_write',
        { key: `sse.probe.${stamp}`, value: { seen: true } });

    await proves('a task an agent delegates', 'agent-tasks', 'aimeat_task_create',
        { target_agent: 'ssebot', title: 'SSE probe', description: 'A task the board should show without a reload.' });

    await proves('a flag an agent raises', 'flags', 'aimeat_flag_report',
        { target_type: 'agent', target_id: A.agentGaii, reason: 'spam', description: 'sse parity probe' });

    await proves('a sharing group an agent creates', 'groups', 'aimeat_group_create',
        { name: `sse-group-${stamp}`, description: 'sse parity' });

    // ── The negative control ────────────────────────────────────────────────────────────────────
    // Every assertion above is satisfied by a bus that broadcasts every domain on every write. This
    // one drives a memory write and checks the BOARDS domain does not arrive with it.
    await test('a memory write does NOT announce itself as a board change', async () => {
        const stream = await openStream(A.ownerToken);
        try {
            const r = await callTool(A.session, 'aimeat_memory_write', { key: `sse.control.${stamp}`, value: { control: true } });
            assert(!r.isError, `memory write failed: ${r.text.slice(0, 250)}`);
            await stream.waitFor('memory', 6_000);
            assert(!stream.domains().includes('boards'),
                `the bus is broadcasting: a memory write delivered [${[...new Set(stream.domains())].join(', ')}]`);
        } finally { stream.close(); }
    });

    console.log('\nCleanup');
    await json(`/v1/owners/${A.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });

    console.log(`\nMCP SSE parity: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
