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

    const operator = await registerOwner(BASE, `postop${STAMP}`);

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
} finally {
    await stopNode();
}

console.log(`\nProduction posture E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) {
    if (failed > 0) console.log(log.split(/\r?\n/).slice(-30).join('\n'));
    process.exit(1);
}
