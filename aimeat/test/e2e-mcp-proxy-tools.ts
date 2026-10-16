/**
 * @file test/e2e-mcp-proxy-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The six remote-MCP tools of src/mcp/mcp-proxy.ts that an agent uses most, each called
 *   once to succeed and once to be refused, over a real session on /v1/mcp: aimeat_mcp_attach,
 *   aimeat_mcp_list, aimeat_mcp_tools, aimeat_mcp_call, aimeat_mcp_grant_list and
 *   aimeat_mcp_grant_revoke.
 *
 *   WHY THIS SUITE EXISTS. e2e-mcp-proxy drives the proxy mostly through its REST routes and calls
 *   only a few of the node MCP tools; these six were never called through /v1/mcp by any test (QA
 *   audit W27). Each handler derives the owner from the session's agent and asks the registry
 *   whether that owner may use the named server, so a wrong owner derivation or a missing check
 *   would let one owner's agent reach another owner's server with every suite green.
 *
 *   HOW IT IS BUILT. The far side is a real MCP server this suite starts on its own port, built with
 *   the SDK's server half (the shape e2e-mcp-proxy uses). Each success is read back through REST
 *   (GET /v1/mcp-servers, GET /v1/mcp-servers/grants), so a tool that answered differently from the
 *   route shows up as a mismatch. Each refusal is either the registration filter (a session without
 *   the scope word is not offered the tool) or the handler's own check (another owner's server, a
 *   call with no address, a narrowing that is not there).
 * @structure
 *   - Phase 0: the far side, two owners, four agents with the scopes each test needs
 *   - Phase 1: aimeat_mcp_attach
 *   - Phase 2: aimeat_mcp_list and aimeat_mcp_tools
 *   - Phase 3: aimeat_mcp_call
 *   - Phase 4: aimeat_mcp_grant_list and aimeat_mcp_grant_revoke
 *   - Phase 5: clean-up (detach through REST)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-proxy-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27: the MCP proxy tools called and refused).
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}

// ─── The far side ───
// Its own port, a fixed distance above the node's so neighbouring E2E lanes do not collide, and
// away from the +120 and +220 that e2e-mcp-proxy takes.
const UPSTREAM_PORT = Number(new URL(BASE).port || '40251') + 150;
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}/mcp`;
const upstreamTransports = new Map<string, StreamableHTTPServerTransport>();
const upstream = http.createServer(async (req, res) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    if (sid && !upstreamTransports.has(sid)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}');
        return;
    }
    let transport = sid ? upstreamTransports.get(sid) : undefined;
    if (!transport) {
        const srv = new McpServer({ name: 'e2e-proxy-tools-upstream', version: '1.0.0' });
        srv.tool('echo', 'Repeats its input.', { text: z.string() }, { readOnlyHint: true },
            async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
        const created = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => upstreamTransports.set(id, created),
        });
        transport = created;
        await srv.connect(created);
    }
    let body: unknown;
    if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    await transport.handleRequest(req, res, body);
});

const SERVER = `ptools${Date.now().toString(36).slice(-5)}`;

(async () => {
    console.log('\n── MCP proxy tools over /v1/mcp (QA audit W27) ──');
    await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

    // ── Phase 0 ──
    const stamp = Date.now().toString(36).slice(-6);
    const alice = await registerOwner(BASE, `ptalice${stamp}`);
    const bob = await registerOwner(BASE, `ptbob${stamp}`);
    // The manager may attach, use and narrow; the reader may only look; the stranger is another
    // owner's agent holding every word; the bare agent holds none of the mcp words.
    const manager = await makeAgent(BASE, alice, ['mcp:read', 'mcp:use', 'mcp:manage']);
    const reader = await makeAgent(BASE, alice, ['mcp:read']);
    const stranger = await makeAgent(BASE, bob, ['mcp:read', 'mcp:use', 'mcp:manage']);
    const bare = await makeAgent(BASE, alice, ['memory:read']);
    const sManager: McpSession = await openSession(BASE, manager.token, 'proxy-tools-manager');
    const sReader: McpSession = await openSession(BASE, reader.token, 'proxy-tools-reader');
    const sStranger: McpSession = await openSession(BASE, stranger.token, 'proxy-tools-stranger');
    const sBare: McpSession = await openSession(BASE, bare.token, 'proxy-tools-bare');

    // ── Phase 1: aimeat_mcp_attach ──
    console.log('\nPhase 1: aimeat_mcp_attach');
    await test('1a. an agent holding mcp:manage attaches a server, and REST lists it under its owner', async () => {
        const r = await callTool(sManager, 'aimeat_mcp_attach', { name: SERVER, url: UPSTREAM_URL, title: 'Proxy tools upstream' });
        assert(!r.isError, `attach refused: ${r.text}`);
        assert(r.data.server?.slug === SERVER, `slug: ${JSON.stringify(r.data.server)}`);
        // The attach answer names the tools; aimeat_mcp_tools gives the whole descriptors.
        const tools = (r.data.tools ?? []).map((t: any) => (typeof t === 'string' ? t : t.name));
        assert(tools.includes('echo'), `the probe listed the far side's tools: ${JSON.stringify(tools)}`);
        const rest = await json('/v1/mcp-servers', alice.token);
        assert(rest.status === 200, `GET /v1/mcp-servers ${rest.status}`);
        const servers = rest.body.data?.servers ?? rest.body.data ?? [];
        assert(servers.some((s: any) => s.slug === SERVER), `REST does not list ${SERVER}: ${JSON.stringify(servers).slice(0, 300)}`);
    });
    await test('1b. an agent without mcp:manage is not offered aimeat_mcp_attach', async () => {
        const names = await toolNames(sReader);
        assert(!names.includes('aimeat_mcp_attach'), 'the reader was offered aimeat_mcp_attach');
        const r = await callTool(sReader, 'aimeat_mcp_attach', { name: `${SERVER}x`, url: UPSTREAM_URL });
        assert(r.isError && r.offered === false, `the reader's attach was not refused at registration: ${r.text}`);
        const rest = await json('/v1/mcp-servers', alice.token);
        const servers = rest.body.data?.servers ?? rest.body.data ?? [];
        assert(!servers.some((s: any) => s.slug === `${SERVER}x`), 'a server was attached anyway');
    });
    await test('1c. the handler refuses an attach that names neither an address nor a peer', async () => {
        const r = await callTool(sManager, 'aimeat_mcp_attach', { name: `${SERVER}y` });
        assert(r.isError && r.offered, `expected the handler's refusal: ${r.text}`);
        assert(/address|peer/i.test(r.text), `the refusal says what is missing: ${r.text}`);
    });

    // ── Phase 2: aimeat_mcp_list and aimeat_mcp_tools ──
    console.log('\nPhase 2: aimeat_mcp_list and aimeat_mcp_tools');
    await test('2a. aimeat_mcp_list shows the owner\'s server to an agent holding mcp:read', async () => {
        const r = await callTool(sReader, 'aimeat_mcp_list', {});
        assert(!r.isError, `list refused: ${r.text}`);
        assert((r.data.servers ?? []).some((s: any) => s.slug === SERVER), `not listed: ${r.text.slice(0, 300)}`);
    });
    await test('2b. aimeat_mcp_list is not offered without mcp:read, and another owner\'s agent does not see the server', async () => {
        const r = await callTool(sBare, 'aimeat_mcp_list', {});
        assert(r.isError && r.offered === false, `the bare agent was answered: ${r.text}`);
        const other = await callTool(sStranger, 'aimeat_mcp_list', {});
        assert(!other.isError, `the stranger's own list was refused: ${other.text}`);
        assert(!(other.data.servers ?? []).some((s: any) => s.slug === SERVER), 'another owner\'s agent sees alice\'s server');
    });
    await test('2c. aimeat_mcp_tools answers the cached list, and the refreshed one from the far side', async () => {
        const cached = await callTool(sReader, 'aimeat_mcp_tools', { server: SERVER });
        assert(!cached.isError, `tools refused: ${cached.text}`);
        assert(cached.data.server === SERVER && (cached.data.tools ?? []).some((t: any) => t.name === 'echo'), `cached: ${cached.text.slice(0, 300)}`);
        const fresh = await callTool(sReader, 'aimeat_mcp_tools', { server: SERVER, refresh: true });
        assert(!fresh.isError && (fresh.data.tools ?? []).some((t: any) => t.name === 'echo'), `refreshed: ${fresh.text.slice(0, 300)}`);
    });
    await test('2d. aimeat_mcp_tools refuses another owner\'s server as if it did not exist', async () => {
        const r = await callTool(sStranger, 'aimeat_mcp_tools', { server: SERVER });
        assert(r.isError && r.offered, `the stranger read alice's tools: ${r.text}`);
        assert(r.text.includes(`no server called "${SERVER}"`), `the refusal: ${r.text}`);
        assert(!r.text.includes('echo'), 'the refusal leaked the tool list');
    });

    // ── Phase 3: aimeat_mcp_call ──
    console.log('\nPhase 3: aimeat_mcp_call');
    await test('3a. an agent holding mcp:use calls the far side\'s tool and gets its answer', async () => {
        const r = await callTool(sManager, 'aimeat_mcp_call', { server: SERVER, tool: 'echo', arguments: { text: 'hello-proxy' } });
        assert(!r.isError, `call refused: ${r.text}`);
        assert(r.text.includes('echo:hello-proxy'), `the far side's answer did not come back: ${r.text}`);
    });
    await test('3b. aimeat_mcp_call is not offered without mcp:use, and another owner\'s agent is refused the server', async () => {
        const r = await callTool(sReader, 'aimeat_mcp_call', { server: SERVER, tool: 'echo', arguments: { text: 'x' } });
        assert(r.isError && r.offered === false, `the reader called a tool: ${r.text}`);
        const other = await callTool(sStranger, 'aimeat_mcp_call', { server: SERVER, tool: 'echo', arguments: { text: 'stolen' } });
        assert(other.isError && other.offered, `the stranger called alice's server: ${other.text}`);
        assert(!other.text.includes('echo:stolen'), 'the far side answered the stranger');
    });

    // ── Phase 4: grants ──
    console.log('\nPhase 4: aimeat_mcp_grant_list and aimeat_mcp_grant_revoke');
    await test('4a. aimeat_mcp_grant_list shows a narrowing the owner wrote, as REST does', async () => {
        const put = await json(`/v1/mcp-servers/${SERVER}/grants`, alice.token, {
            method: 'PUT', body: JSON.stringify({ grantee: reader.gaii, tools: ['echo'] }),
        });
        assert(put.status === 200 || put.status === 201, `PUT grant ${put.status}: ${JSON.stringify(put.body?.error)}`);
        const r = await callTool(sReader, 'aimeat_mcp_grant_list', { server: SERVER });
        assert(!r.isError, `grant list refused: ${r.text}`);
        const g = (r.data.grants ?? []).find((x: any) => x.grantee === reader.gaii);
        assert(g && JSON.stringify(g.tools) === '["echo"]', `the grant: ${r.text.slice(0, 300)}`);
        const rest = await json(`/v1/mcp-servers/grants?server=${SERVER}`, alice.token);
        const restGrants = rest.body.data?.grants ?? [];
        assert(restGrants.some((x: any) => x.grantee === reader.gaii), `REST disagrees: ${JSON.stringify(rest.body).slice(0, 300)}`);
    });
    await test('4b. aimeat_mcp_grant_list is not offered without mcp:read, and another owner sees none of alice\'s grants', async () => {
        const r = await callTool(sBare, 'aimeat_mcp_grant_list', { server: SERVER });
        assert(r.isError && r.offered === false, `the bare agent read grants: ${r.text}`);
        const other = await callTool(sStranger, 'aimeat_mcp_grant_list', { server: SERVER });
        assert(!other.isError, `the stranger's own list was refused: ${other.text}`);
        assert((other.data.grants ?? []).length === 0, `alice's grant reached bob's agent: ${other.text}`);
    });
    await test('4c. the handler refuses another owner\'s agent a revoke of alice\'s narrowing, and the grant stays', async () => {
        const r = await callTool(sStranger, 'aimeat_mcp_grant_revoke', { server: SERVER, grantee: reader.gaii });
        assert(r.isError && r.offered, `the stranger revoked: ${r.text}`);
        assert(r.text.includes(`no server called "${SERVER}"`), `the refusal: ${r.text}`);
        const still = await callTool(sReader, 'aimeat_mcp_grant_list', { server: SERVER });
        assert((still.data.grants ?? []).some((x: any) => x.grantee === reader.gaii), 'the grant went anyway');
    });
    await test('4d. aimeat_mcp_grant_revoke is not offered without mcp:manage', async () => {
        const r = await callTool(sReader, 'aimeat_mcp_grant_revoke', { server: SERVER, grantee: reader.gaii });
        assert(r.isError && r.offered === false, `the reader revoked its own narrowing: ${r.text}`);
    });
    await test('4e. an agent holding mcp:manage revokes the narrowing, REST agrees, and a second revoke is refused', async () => {
        const r = await callTool(sManager, 'aimeat_mcp_grant_revoke', { server: SERVER, grantee: reader.gaii });
        assert(!r.isError, `revoke refused: ${r.text}`);
        assert(r.data.removed === reader.gaii, `removed: ${r.text}`);
        const rest = await json(`/v1/mcp-servers/grants?server=${SERVER}`, alice.token);
        assert(!(rest.body.data?.grants ?? []).some((x: any) => x.grantee === reader.gaii), 'REST still lists the grant');
        const again = await callTool(sManager, 'aimeat_mcp_grant_revoke', { server: SERVER, grantee: reader.gaii });
        assert(again.isError && /no narrowing/i.test(again.text), `a second revoke: ${again.text}`);
    });

    // ── Phase 5: clean-up ──
    await test('5. the server is detached through REST', async () => {
        const del = await json(`/v1/mcp-servers/${SERVER}`, alice.token, { method: 'DELETE' });
        assert(del.status === 200 || del.status === 204, `DELETE ${del.status}: ${JSON.stringify(del.body?.error)}`);
    });

    upstream.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
