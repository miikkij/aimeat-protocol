/**
 * @file scripts/measure-mcp-build.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What it costs the node to build its MCP server, measured against a running node.
 *
 *   WHY. On MCP 2025-era revisions the node builds one McpServer per session (createMcpServer in
 *   src/mcp/index.ts: the four owner-level reads, a few hundred tool registrations, the wrapper
 *   chain per tool) and amortises it over every call of the session. On 2026-07-28 there is no
 *   session, so the modern code path builds a server for every request (MCP migration plan
 *   doc-mvguy322f9se, step 1). An `initialize` is the closest thing the node does today to one
 *   modern request: it builds the whole server and answers. This script times N of them (each
 *   session closed again with DELETE) against N `tools/list` calls on one open session, which
 *   is what a request costs when the server already exists. The difference is the build.
 * @usage
 *   cd aimeat && pnpm sandbox            # a node of your own, with an agent token
 *   cd aimeat && pnpm exec tsx scripts/measure-mcp-build.ts [--n=40] [--path=/v1/mcp] [--base=URL --token=JWT]
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (MCP migration plan step 1).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const HERE = path.dirname(fileURLToPath(import.meta.url));

function sandbox(): { base: string; token: string } {
    const j = JSON.parse(readFileSync(path.join(HERE, '..', '.sandbox.json'), 'utf-8')) as { baseUrl: string; agent: { token: string } };
    return { base: j.baseUrl, token: j.agent.token };
}

const fallback = arg('base') && arg('token') ? null : sandbox();
const BASE = arg('base') ?? fallback!.base;
const TOKEN = arg('token') ?? fallback!.token;
const N = Number(arg('n') ?? 40);
const PATHS = (arg('path') ?? '/v1/mcp,/v2/mcp/chat').split(',');

const headers = (sid?: string): Record<string, string> => ({
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`,
    ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-11-25' } : {}),
});

async function rpc(url: string, method: string, params: unknown, sid?: string, id = 1): Promise<{ ms: number; sid: string | null; status: number; text: string }> {
    const t0 = performance.now();
    const res = await fetch(url, { method: 'POST', headers: headers(sid), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await res.text();
    return { ms: performance.now() - t0, sid: res.headers.get('mcp-session-id'), status: res.status, text };
}

function stats(xs: number[]): string {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return `p50 ${q(0.5).toFixed(1)} ms  p95 ${q(0.95).toFixed(1)} ms  max ${s[s.length - 1].toFixed(1)} ms`;
}

async function measure(p: string): Promise<void> {
    const url = `${BASE}${p}`;
    const init = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'measure-mcp-build', version: '1.0.0' } };
    const builds: number[] = [];
    for (let i = 0; i < N + 3; i++) {
        const r = await rpc(url, 'initialize', init);
        if (r.status !== 200 || !r.sid) throw new Error(`${p} initialize answered ${r.status}: ${r.text.slice(0, 200)}`);
        if (i >= 3) builds.push(r.ms);   // the first three warm the process
        await fetch(url, { method: 'DELETE', headers: headers(r.sid) });
    }
    const open = await rpc(url, 'initialize', init);
    await fetch(url, { method: 'POST', headers: headers(open.sid!), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const lists: number[] = [];
    let tools = 0;
    for (let i = 0; i < N + 3; i++) {
        const r = await rpc(url, 'tools/list', {}, open.sid!, i + 2);
        if (i === 0) {
            const line = r.text.split('\n').find(l => l.startsWith('data:'));
            tools = ((JSON.parse(line ? line.slice(5) : r.text).result?.tools ?? []) as unknown[]).length;
        }
        if (i >= 3) lists.push(r.ms);
    }
    await fetch(url, { method: 'DELETE', headers: headers(open.sid!) });
    console.log(`\n  ${p}  (${tools} tools listed, n=${N})`);
    console.log(`    initialize (builds the server)  ${stats(builds)}`);
    console.log(`    tools/list on an open session   ${stats(lists)}`);
}

console.log(`MCP server build cost against ${BASE}`);
for (const p of PATHS) await measure(p);
