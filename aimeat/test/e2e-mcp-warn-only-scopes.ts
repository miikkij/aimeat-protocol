/**
 * @file e2e-mcp-warn-only-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: a node run with AIMEAT_MCP_ENFORCE_SCOPES=false (the documented warn-only
 *   rollout) keeps the guard of every permission word no wildcard carries on the node MCP surface.
 *   Warn-only registered every tool and answered every call, and the handlers of the owner's vault
 *   (aimeat_secret_*), the access overview (aimeat_access_list) and the owner's mailbox
 *   (aimeat_dm_*_as_owner) relied on that gate alone, so an agent the owner gave a narrow grant
 *   changed the owner's secrets and read the owner's mail while the REST twins refused it
 *   (secaudit2026oct22, mcp/index.ts:warn-only-drops-sole-gate-on-outside-wildcard-tools).
 *
 *   The suite starts its own node with the flag set to false, on the run's backend.
 *
 *   REFUSED: an agent on memory:read alone gets SCOPE_DENIED from aimeat_secret_list,
 *   aimeat_secret_set, aimeat_access_list and aimeat_dm_inbox_as_owner, and the owner's secret is
 *   unchanged. KEPT: an agent the owner ticked secrets:manage and account:security for lists the vault
 *   and the access overview; warn-only still answers a tool whose word a wildcard carries, which is
 *   what the mode is for.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-warn-only-scopes
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, warn-only-drops-sole-gate-on-outside-wildcard-tools).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, type OwnNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const PORT = process.env.E2E_MCP_WARN_ONLY_PORT ?? '40991';
const BASE = `http://localhost:${PORT}`;
const TAG = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const db: OwnNodeDb = await ownNodeDb('mcp-warn-only-scopes');
async function startServer(): Promise<ChildProcess> {
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE,
        AIMEAT_MCP_ENFORCE_SCOPES: 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the warn-only node' });
}
async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
    const began = Date.now();
    while (Date.now() - began < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await sleep(150);
    }
}

console.log('\n=== MCP warn-only mode keeps the words no wildcard carries ===\n');

const server = await startServer();
try {
    const owner = await registerOwner(BASE, `warn${TAG}`);
    const SECRET = `WARN_ONLY_${TAG.toUpperCase()}`;
    const put = await json(`/v1/secrets/${SECRET}`, { method: 'PUT', headers: bearer(owner.token), body: JSON.stringify({ value: 'the-owners-value' }) });
    const narrow = await makeAgent(BASE, owner, ['memory:read']);
    const vault = await makeAgent(BASE, owner, ['memory:read', 'memory:write', 'secrets:manage', 'account:security']);

    await test('setup: the owner stores a secret, and the narrow agent is refused the vault on REST', async () => {
        assert(put.status === 200 || put.status === 201, `PUT secret: ${put.status} ${JSON.stringify(put.body?.error)}`);
        const rest = await json(`/v1/secrets/${SECRET}`, { method: 'PUT', headers: bearer(narrow.token), body: JSON.stringify({ value: 'replaced' }) });
        assert(rest.status === 403, `REST twin: ${rest.status}`);
    });

    await test('REFUSED: an agent on memory:read alone gets SCOPE_DENIED from the vault, access and owner-mailbox tools', async () => {
        const s = await openSession(BASE, narrow.token, 'warn-narrow');
        const calls: Array<[string, Record<string, unknown>]> = [
            ['aimeat_secret_list', {}],
            ['aimeat_secret_set', { name: SECRET, value: 'replaced-by-agent' }],
            ['aimeat_access_list', {}],
            ['aimeat_dm_inbox_as_owner', {}],
        ];
        for (const [tool, args] of calls) {
            const r = await callTool(s, tool, args);
            assert(r.isError && /SCOPE_DENIED/.test(r.text), `${tool} answered on a warn-only node: ${r.text.slice(0, 200)}`);
        }
        const v = await callTool(await openSession(BASE, vault.token, 'warn-vault-check'), 'aimeat_secret_list', {});
        assert(!v.isError && JSON.stringify(v.data).includes(SECRET), `the secret is still there: ${v.text.slice(0, 200)}`);
    });

    await test('KEPT: an agent holding the exact words uses the vault and the access overview', async () => {
        const s = await openSession(BASE, vault.token, 'warn-vault');
        const list = await callTool(s, 'aimeat_secret_list', {});
        assert(!list.isError && JSON.stringify(list.data).includes(SECRET), `secret_list: ${list.text.slice(0, 200)}`);
        const access = await callTool(s, 'aimeat_access_list', {});
        assert(!access.isError, `access_list: ${access.text.slice(0, 200)}`);
    });

    await test('KEPT: warn-only still answers a tool whose word a wildcard carries', async () => {
        // aimeat_workspace_members declares organism:invite, which the narrow agent lacks and '*'
        // carries; its handler asks no word, so on a warn-only node the call reaches it and is
        // answered by the workspace rule, not by SCOPE_DENIED.
        const s = await openSession(BASE, narrow.token, 'warn-narrow-members');
        const r = await callTool(s, 'aimeat_workspace_members', { organism_id: `org-${TAG}`, ws: 'ws-none' });
        assert(!/SCOPE_DENIED/.test(r.text), `warn-only refused a wildcard word: ${r.text.slice(0, 300)}`);
    });
} finally {
    await stopServer(server);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
