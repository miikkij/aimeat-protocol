/**
 * @file test/e2e-production-posture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node started the way a production deployment starts it: a public base URL, the
 *   public security profile, test mode, dev mode and anonymous mode off, an encryption key, an AI
 *   provider allowlist, statistics for signed-in callers, extensions installed by the operator, the
 *   shipped rate limits and the shipped default agent scopes. Nothing else is raised or relaxed.
 *
 *   WHY. Each suite that covered one production setting changed that one and inherited the rest from
 *   the runner, so no E2E node ever ran the settings of a production node together, and a rule only a
 *   public node applies was held by unit tests of single functions at most (QA audit P7-05). This is
 *   the place where each new production-only rule gets one line. The production-settings lane
 *   (test/run-e2e-production-lane.ts) runs the guard tier with the modes off; this suite adds the
 *   public profile, which a loopback lane cannot have.
 *
 *   WHAT IT ASSERTS. The start-up self-check names nothing (the default agent scopes hold
 *   memory:delete, which may be a default since the developer's ruling of 2026-10-16); registering a taken name answers 409 NAME_TAKEN and the account keeps working (QA audit P1-01,
 *   S1-08); a request with no credential gets 401, not the anonymous identity, and the anonymous
 *   token route answers 403 (QA audit F7d-02); an agent registered with no scopes named gets the
 *   shipped default (QA audit P7-03); a plain-http peer address is refused (FED-13); the node
 *   statistics are not public.
 *
 *   It runs its own node, on the run's backend (test/helpers/own-node-db.ts), on port 40479.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-production-posture
 * @version-history
 *   2026-10-25 — With install role operator, an agent of another account installs nothing (REST,
 *     upload URL, MCP) and is told the setting and the operator; the operator and the operator's
 *     agent install as before (secaudit2026oct22 lead 128).
 *   2026-10-25 — With install role operator, the account holder in person removes, switches off and
 *     narrows an extension their agent installed; writing code stays with the install role (secaudit2026oct22).
 *   2026-10-16 — The first account is registered with the one-time setup code from the start log, and a
 *     first registration without it is refused (Jouni, 2026-10-16).
 *   2026-10-16 — The self-check names nothing: memory:delete in the shipped default agent scopes is no
 *     longer a risky setting (invariant 8 as ruled by the developer on 2026-10-16). The test asserted
 *     the open question being reported, which was the right behaviour until the ruling.
 *   2026-10-16 — Initial (QA audit P7-05, P1-01, S1-08, F7d-02, P7-03).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { SHIPPED_DEFAULT_AGENT_SCOPES } from '../src/config.js';

const PORT = 40479;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC_URL = 'https://posture.example';
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300);

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}

// ── The node, as the deployment checklist starts it ──
const db = await ownNodeDb(String(PORT));
let log = '';
let node: ChildProcess | null = null;

async function startNode(): Promise<void> {
    // Nothing from the runner's relaxed pins reaches this node: every AIMEAT_* variable is dropped
    // first, and only what a deployment sets is given back.
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(PORT),
        AIMEAT_BASE_URL: PUBLIC_URL,
        AIMEAT_SECURITY_PROFILE: 'public',
        AIMEAT_NODE_ID: `aimeat-test-001-posture${STAMP}`,
        AIMEAT_ADMIN_PASSWORD: `Posture-Admin-${STAMP}-Pw!`,
        AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        AIMEAT_KEY_PASSPHRASE: `posture-node-key-${STAMP}`,
        AIMEAT_CORS_ALLOWED_ORIGINS: PUBLIC_URL,
        AIMEAT_STATS_ACCESS: 'authenticated',
        AIMEAT_METRICS_ACCESS: 'operator',
        AIMEAT_EXT_INSTALL_ROLE: 'operator',
        AIMEAT_AI_PROVIDER_ALLOWLIST: 'openrouter.ai,api.openai.com',
        AIMEAT_SETUP_ALLOWED_IPS: '127.0.0.1,::1',
        AIMEAT_LOG_LEVEL: 'warn',
        AIMEAT_SMTP_HOST: '',
    });
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    node.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
    node.stderr?.on('data', (d: Buffer) => { log += d.toString(); });
    await waitForServer(node, BASE, { label: 'the production-posture node' });
}

async function stopNode(): Promise<void> {
    if (!node || node.exitCode !== null) return;
    node.kill('SIGTERM');
    await Promise.race([once(node, 'exit'), new Promise(r => setTimeout(r, 10_000))]);
}

console.log('\n=== A node started with production settings, on the public profile ===\n');

try {
    await startNode();

    await test('the start-up self-check names nothing on a node with production settings', async () => {
        // index-start.ts prints a SECURITY header with the count, then one line per setting. Until
        // the developer's ruling of 2026-10-16 the shipped default agent scopes were named here
        // (memory:delete); a delete into the bin may be a default, so the list is now empty.
        const security = log.split(/\r?\n/).filter(l => l.includes('SECURITY'));
        assert(security.length === 0, `unexpected SECURITY lines: ${short(security)}`);
        assert(!log.includes('AIMEAT_DEFAULT_AGENT_SCOPES holds'), 'the shipped default agent scopes are reported as risky');
        assert(!/AIMEAT_(TEST|DEV)_MODE=true|AIMEAT_ANONYMOUS=true/.test(log), 'a test switch is reported active');
    });

    // The first account of a public node needs the one-time setup code the start log printed
    // (services/setup-code.ts; Jouni, 2026-10-16).
    const setupCode = /Setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(log)?.[1] ?? '';

    await test('the first registration without the setup code is refused', async () => {
        assert(setupCode, 'the start log carries no "Setup code:" line');
        const r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `postnocode${STAMP}`, display_name: 'No Code', password: 'Another-Pass-2026' }) });
        assert(r.status === 403 && r.body.error?.code === 'SETUP_CODE_REQUIRED', `expected 403 SETUP_CODE_REQUIRED, got ${r.status} ${short(r.body)}`);
    });

    const operator = await registerOwner(BASE, `postop${STAMP}`, { body: { setupCode } });

    await test('the first account is the operator', async () => {
        assert(operator.roles.includes('operator'), `roles: ${short(operator.roles)}`);
    });

    await test('registering a taken name answers 409 NAME_TAKEN', async () => {
        const r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: operator.name, display_name: 'Someone Else', password: 'Another-Pass-2026' }) });
        assert(r.status === 409, `expected 409, got ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'NAME_TAKEN', `expected NAME_TAKEN, got ${r.body.error?.code}`);
    });

    await test('…and the account it named is untouched: its session still works and it is still the operator', async () => {
        const me = await json('/v1/memory', { headers: { Authorization: `Bearer ${operator.token}` } });
        assert(me.status === 200, `the existing session stopped working: ${me.status} ${short(me.body)}`);
        const peers = await json('/v1/federation/peers', { headers: { Authorization: `Bearer ${operator.token}` } });
        assert(peers.status === 200, `the operator lost an operator route: ${peers.status} ${short(peers.body)}`);
    });

    await test('a request with no credential gets 401, not the anonymous identity', async () => {
        const r = await json('/v1/memory');
        assert(r.status === 401, `expected 401, got ${r.status} ${short(r.body)}`);
    });

    await test('the anonymous token route answers 403 with anonymous mode off', async () => {
        const r = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
        assert(r.status === 403, `expected 403, got ${r.status} ${short(r.body)}`);
    });

    await test('an agent registered with no scopes named gets the shipped default', async () => {
        const r = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${operator.token}` },
            body: JSON.stringify({ name: 'postureagent', owner: operator.name, capabilities: ['memory'], model: 'gpt-4o' }),
        });
        assert(r.status === 201, `register agent: ${r.status} ${short(r.body)}`);
        const scopes = [...(r.body.data.agent.scopes ?? [])].sort().join(',');
        assert(scopes === SHIPPED_DEFAULT_AGENT_SCOPES.split(',').sort().join(','), `scopes: ${scopes}`);
    });

    await test('a plain-http peer address is refused on a public node', async () => {
        const r = await json('/v1/federation/peers', {
            method: 'POST', headers: { Authorization: `Bearer ${operator.token}` },
            body: JSON.stringify({ node_id: 'peer-http', url: 'http://peer-http.example', public_key: 'MCowBQYDK2VwAyEAo4y5GmJ8ehxJ6rD1u8eBuOqGQ0Vs1RO8kfxeDqhnYrM=' }),
        });
        assert(r.status === 400, `expected 400, got ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'PEER_HTTPS_REQUIRED', `expected PEER_HTTPS_REQUIRED, got ${r.body.error?.code}`);
    });

    await test('the node statistics are not public', async () => {
        const r = await json('/v1/stats');
        assert(r.status === 401 && r.body.error?.code === 'AUTH_REQUIRED', `nobody read the statistics: ${r.status} ${short(r.body)}`);
        const signed = await json('/v1/stats', { headers: { Authorization: `Bearer ${operator.token}` } });
        assert(signed.status === 200, `a signed-in caller was refused: ${signed.status} ${short(signed.body)}`);
    });

    // AIMEAT_EXT_INSTALL_ROLE=operator decides who writes extension code: only the operator's account,
    // in person or through its agents (Jouni, 2026-10-25, secaudit2026oct22 lead 128). The account
    // holder in person manages what is in their account (secaudit2026oct22,
    // permissions.ts:extInstallRole-owner-branch-only).
    const extManifest = (name: string) => JSON.stringify({
        metadata: { name, version: '1.0.0', description: 'posture e2e', author: 'e2e' },
        actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo' }],
        limits: { timeout_ms: 5000, max_api_calls: 1 },
    });
    const extScripts = { echo: 'export default async function(ctx, input){ return { ok: true }; }' };
    const setInstallRole = (value: string) => json('/v1/admin/config', {
        method: 'PUT', headers: { Authorization: `Bearer ${operator.token}` },
        body: JSON.stringify({ changes: [{ path: 'extensions.install_role', value }] }),
    });

    await test('with install role operator, an agent of another account installs nothing, and the refusal names the setting and the operator', async () => {
        const member = await registerOwner(BASE, `postmema${STAMP}`);
        const agent = await makeAgent(BASE, member, ['ext:write', 'ext:invoke']);
        const asAgent = { Authorization: `Bearer ${agent.token}` };
        const byAgent = await json('/v1/extensions', { method: 'POST', headers: asAgent, body: JSON.stringify({ manifest: extManifest(`postexta${STAMP}`), scripts: extScripts }) });
        assert(byAgent.status === 403, `the agent's install: ${byAgent.status} ${short(byAgent.body)}`);
        const said = String(byAgent.body.error?.message ?? '');
        assert(said.includes('AIMEAT_EXT_INSTALL_ROLE') && said.includes(operator.name), `the refusal names the setting and the operator: ${said}`);
        const presigned = await json('/v1/extensions', { method: 'POST', headers: asAgent, body: JSON.stringify({ mode: 'presigned' }) });
        assert(presigned.status === 403, `no upload URL either: ${presigned.status} ${short(presigned.body)}`);

        const session = await openSession(BASE, agent.token, 'posture-install-role');
        const viaMcp = await callTool(session, 'aimeat_extension_install', { manifest: extManifest(`postextb${STAMP}`), scripts: extScripts });
        assert(viaMcp.isError && viaMcp.text.includes('AIMEAT_EXT_INSTALL_ROLE'), `MCP install: ${viaMcp.text.slice(0, 300)}`);
        const mcpUpload = await callTool(session, 'aimeat_extension_install', {});
        assert(mcpUpload.isError && mcpUpload.text.includes('AIMEAT_EXT_INSTALL_ROLE'), `MCP upload URL: ${mcpUpload.text.slice(0, 300)}`);
    });

    await test('with install role operator, the operator and the operator\'s agent install as before', async () => {
        const own = await json('/v1/extensions', { method: 'POST', headers: { Authorization: `Bearer ${operator.token}` }, body: JSON.stringify({ manifest: extManifest(`postextc${STAMP}`), scripts: extScripts }) });
        assert(own.status === 201, `the operator in person: ${own.status} ${short(own.body)}`);
        const opAgent = await makeAgent(BASE, operator, ['ext:write', 'ext:invoke']);
        const byOpAgent = await json('/v1/extensions', { method: 'POST', headers: { Authorization: `Bearer ${opAgent.token}` }, body: JSON.stringify({ manifest: extManifest(`postextd${STAMP}`), scripts: extScripts }) });
        assert(byOpAgent.status === 201, `the operator's agent: ${byOpAgent.status} ${short(byOpAgent.body)}`);
    });

    await test('with install role operator, the account holder in person manages an extension their agent installed', async () => {
        const member = await registerOwner(BASE, `postmem${STAMP}`);
        const asMember = { Authorization: `Bearer ${member.token}` };
        const extName = `postext${STAMP}`;
        const manifest = extManifest(extName);
        const scripts = extScripts;
        const inPerson = await json('/v1/extensions', { method: 'POST', headers: asMember, body: JSON.stringify({ manifest, scripts }) });
        assert(inPerson.status === 403, `the member in person installs nothing under install role operator: ${inPerson.status} ${short(inPerson.body)}`);
        assert(String(inPerson.body.error?.message ?? '').includes('AIMEAT_EXT_INSTALL_ROLE'), `the member is told why: ${short(inPerson.body)}`);

        // The extension arrives the way one installed before the operator chose the setting does.
        const agent = await makeAgent(BASE, member, ['ext:write', 'ext:invoke']);
        const opened = await setInstallRole('owner');
        assert(opened.status === 200, `install role owner: ${opened.status} ${short(opened.body)}`);
        const byAgent = await json('/v1/extensions', { method: 'POST', headers: { Authorization: `Bearer ${agent.token}` }, body: JSON.stringify({ manifest, scripts }) });
        const closed = await setInstallRole('operator');
        assert(byAgent.status === 201, `the agent's install under install role owner: ${byAgent.status} ${short(byAgent.body)}`);
        assert(closed.status === 200, `install role operator again: ${closed.status} ${short(closed.body)}`);

        const script = await json(`/v1/extensions/${extName}/actions/ping`, {
            method: 'PATCH', headers: asMember, body: JSON.stringify({ scriptContent: 'export default async function(ctx, input){ return { ok: 2 }; }' }),
        });
        assert(script.status === 403, `writing code stays with the install role: ${script.status} ${short(script.body)}`);
        const agentScript = await json(`/v1/extensions/${extName}/actions/ping`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${agent.token}` }, body: JSON.stringify({ scriptContent: 'export default async function(ctx, input){ return { ok: 3 }; }' }),
        });
        assert(agentScript.status === 403 && String(agentScript.body.error?.message ?? '').includes('AIMEAT_EXT_INSTALL_ROLE'),
            `the agent changes no script either, and is told why: ${agentScript.status} ${short(agentScript.body)}`);

        const narrow = await json(`/v1/extensions/${extName}/unattended-reader`, { method: 'PATCH', headers: asMember, body: JSON.stringify({ authority: 'installer' }) });
        assert(narrow.status === 200, `the member narrows the unattended reader: ${narrow.status} ${short(narrow.body)}`);
        const off = await json(`/v1/extensions/${extName}/deactivate`, { method: 'POST', headers: asMember });
        assert(off.status === 200, `the member switches it off: ${off.status} ${short(off.body)}`);
        const gone = await json(`/v1/extensions/${extName}`, { method: 'DELETE', headers: asMember });
        assert(gone.status === 200, `the member removes it: ${gone.status} ${short(gone.body)}`);
    });
} finally {
    await stopNode();
}

console.log(`\nProduction posture E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) {
    if (failed > 0) console.log(log.split(/\r?\n/).slice(-30).join('\n'));
    process.exit(1);
}
