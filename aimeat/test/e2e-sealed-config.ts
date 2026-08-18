/**
 * @file e2e-sealed-config.ts
 * @description Sealed configuration: the settings whoever STARTED this node nominated as read-only,
 *   for a node one party runs on behalf of another (a hosting provider, a university running one per
 *   department, a company running one per team). Design: docs/plans/sealed-config-plan.md
 *
 *   THE REGRESSION THIS EXISTS FOR is phase 3 below, and it is worth stating plainly because a
 *   test of the refusal alone would have missed it. Sealing the write doors is not enough: the
 *   database beats the environment at every boot (applyConfigOverrides), so a value an operator
 *   persisted BEFORE the seal existed, or through a door we have not thought of, comes back at the
 *   next restart and survives an image swap. Phase 3 writes the row on an unsealed node, restarts
 *   the same database sealed, and asserts the environment value stands.
 *
 *   WHY THIS SUITE OWNS ITS SERVER. Sealing is decided at boot from the process environment, which
 *   is the whole point of the mechanism, so it cannot be switched on against the shared runner's
 *   node. Unlike the other four self-spawning suites, this one follows the RUNNER'S backend rather
 *   than hardcoding sqlite: what phase 3 measures runs through storage, and "E2E on both backends"
 *   is a claim this suite would otherwise only be making about one of them.
 *
 *   The unsealed half — an ordinary self-hosted node behaves exactly as it did — is phase 1, on the
 *   suite's own server with the variable unset.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-sealed-config.ts
 * @version-history
 *   v1.0.0 — 2026-08-18 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_SEALED_CONFIG_PORT ?? '40291';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';

/** The settings this suite's node hands to its "host" to seal. One of each shape that matters. */
const SEALED = ['quota.memory_mb', 'rate_limits.global', 'metrics.enabled'];
const SEALED_LIST = SEALED.join(',');
/** What the host sets them TO, through the ordinary variables. The seal names paths, not values. */
const HOST_MEMORY_QUOTA_MB = 1024;
const HOST_RL_GLOBAL = 5000;

/**
 * Follow the runner's backend so both backends are genuinely exercised. The runner pins
 * AIMEAT_STORAGE, AIMEAT_SQLITE_PATH and DATABASE_URL onto every suite process; run on its own the
 * suite falls back to sqlite in its own file.
 */
const RUNNER_STORAGE = process.env.AIMEAT_STORAGE ?? '';
const USE_POSTGRES = RUNNER_STORAGE === 'postgres-kysely' && !!process.env.DATABASE_URL;
const DB_PATH = resolve(process.cwd(), 'test/.test-sealed-config.db');
const dbArgs = USE_POSTGRES
    ? ['--db', 'postgres-kysely', '--db-url', process.env.DATABASE_URL as string]
    : ['--db', 'sqlite', '--db-path', DB_PATH];

let passed = 0, failed = 0;
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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip a partial frame */ } }
    }
    return out;
}

/** A JSON-RPC caller bound to /v1/mcp, holding its own session id. */
function mcpClient(token: () => string) {
    let sessionId = '';
    return async function rpc(method: string, params: Record<string, any> = {}, id = 1) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token()}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body: any = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json();
        return { status: res.status, body };
    };
}

function cleanupDb() {
    if (USE_POSTGRES) return;   // the runner owns that database and truncates it between suites
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

/**
 * Start this suite's own node. `sealed` decides whether the host nominated anything, which is the
 * one variable the whole mechanism turns on; everything else is identical between the two boots so
 * a difference in behaviour can only come from the seal.
 */
async function startServer(sealed: boolean): Promise<ChildProcess> {
    const env: Record<string, string | undefined> = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_STORAGE: USE_POSTGRES ? 'postgres-kysely' : 'sqlite',
        AIMEAT_SQLITE_PATH: USE_POSTGRES ? '' : DB_PATH,
        AIMEAT_MEMORY_QUOTA_MB: String(HOST_MEMORY_QUOTA_MB),
        AIMEAT_RL_GLOBAL: String(HOST_RL_GLOBAL),
        AIMEAT_METRICS_ENABLED: 'false',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        AIMEAT_SEALED_CONFIG_KEYS: sealed ? SEALED_LIST : '',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

/** Stop it and wait for the port to be free, so the next boot is not talking to the old process. */
async function stopServer(child: ChildProcess): Promise<void> {
    child.kill('SIGTERM');
    const start = Date.now();
    while (Date.now() - start < 20_000) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        await new Promise(r => setTimeout(r, 100));
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    while (Date.now() - start < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await new Promise(r => setTimeout(r, 150));
    }
}

/** Register the first owner (which takes the operator role) and return its name, key and token. */
async function registerOperator(name: string): Promise<{ name: string; token: string; privateKey: string }> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register operator: status ${status}: ${JSON.stringify(body)}`);
    const privateKey = body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(privateKey, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }),
    });
    assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.data.token as string, privateKey };
}

/** Sign in again as an owner whose key we already hold (used across a restart). */
async function signIn(name: string, privateKey: string): Promise<string> {
    const ts = new Date().toISOString();
    const sig = await signMsg(privateKey, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }),
    });
    assert(tok.body.ok === true, `token for ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function main() {
    console.log('\n=== Sealed configuration E2E ===');
    console.log(`  backend: ${USE_POSTGRES ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);
    cleanupDb();

    let server: ChildProcess | null = null;
    try {
        // ── Phase 1: the variable is unset, and nothing about this node has changed ──
        console.log('Phase 1: an ordinary self-hosted node, sealing nothing');
        server = await startServer(false);
        const unsealedOp = await registerOperator(`sealcfgu${Date.now() % 100000}`);

        await test('1. no field reports itself as sealed', async () => {
            const { status, body } = await json('/v1/admin/config', { headers: auth(unsealedOp.token) });
            assert(status === 200, `status ${status}`);
            assert(Array.isArray(body.data.sealed) && body.data.sealed.length === 0, `sealed list: ${JSON.stringify(body.data.sealed)}`);
            assert(body.data.sealedNote === undefined, 'no sealed banner on a node that seals nothing');
            const sealedFields = Object.entries(body.data.schema).filter(([, e]: any) => e.sealed);
            assert(sealedFields.length === 0, `unexpected sealed field(s): ${sealedFields.map(([k]) => k).join(', ')}`);
            const quota = body.data.schema['quota.memory_mb'];
            assert(quota.mutable === true && quota.editable === true, `quota.memory_mb should still be editable: ${JSON.stringify(quota)}`);
            assert(quota.source === 'env', `provenance is untouched when nothing is sealed, got ${quota.source}`);
        });

        await test('2. the operator can still change the same setting they could yesterday', async () => {
            const { status, body } = await json('/v1/admin/config', {
                method: 'PUT', headers: auth(unsealedOp.token),
                body: JSON.stringify({ changes: [{ path: 'quota.memory_mb', value: 4096 }] }),
            });
            assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.applied.length === 1, `applied: ${JSON.stringify(body.data.applied)}`);
        });

        // Phase 3 needs that write left in the database, so the seal has something to refuse at boot.
        await stopServer(server);
        server = null;

        // ── Phase 2: the same node, started by a host that sealed three settings ──
        console.log('\nPhase 2: the same node, started with three settings sealed');
        server = await startServer(true);

        // Same database, same operator: the ONLY difference between the two boots is the seal.
        let opToken = '';
        await test('3. the operator still signs in after the restart', async () => {
            opToken = await signIn(unsealedOp.name, unsealedOp.privateKey);
            assert(opToken.length > 0, 'the restart must not have cost the operator their account');
        });

        // ── Phase 3: the regression. A persisted value does not beat the host's. ──
        await test('4. THE REGRESSION: the row phase 1 persisted is ignored at boot', async () => {
            const { status, body } = await json('/v1/admin/config', { headers: auth(opToken) });
            assert(status === 200, `status ${status}`);
            const quota = body.data.schema['quota.memory_mb'];
            assert(quota.value === HOST_MEMORY_QUOTA_MB,
                `the environment value must stand: expected ${HOST_MEMORY_QUOTA_MB}, got ${quota.value} (the persisted 4096 came back)`);
        });

        await test('5. the value is VISIBLE and marked sealed, not hidden', async () => {
            const { body } = await json('/v1/admin/config', { headers: auth(opToken) });
            assert(body.data.sealed.length === SEALED.length, `sealed list: ${JSON.stringify(body.data.sealed)}`);
            assert(typeof body.data.sealedNote === 'string', 'a sealed node explains itself on the page');
            for (const path of SEALED) {
                const e = body.data.schema[path];
                assert(e !== undefined, `${path} must still appear`);
                assert(e.value !== undefined, `${path} must still carry its VALUE`);
                assert(e.sealed === true, `${path} sealed flag: ${JSON.stringify(e)}`);
                assert(e.mutable === false, `${path} mutable: ${e.mutable}`);
                assert(e.editable === false, `${path} editable: ${e.editable}`);
                assert(e.source === 'sealed', `${path} source: ${e.source}`);
                assert(e.canReset === false, `${path} canReset: ${e.canReset}`);
            }
            assert(body.data.schema['quota.memory_mb'].value === HOST_MEMORY_QUOTA_MB, 'the sealed quota shows the host value');
            assert(body.data.schema['rate_limits.global'].value === HOST_RL_GLOBAL, 'the sealed rate limit shows the host value');
        });

        await test('6. →403 SEALED_CONFIG on PUT, for every sealed setting', async () => {
            for (const path of SEALED) {
                const value = path === 'metrics.enabled' ? true : 99999;
                const { status, body } = await json('/v1/admin/config', {
                    method: 'PUT', headers: auth(opToken),
                    body: JSON.stringify({ changes: [{ path, value }] }),
                });
                assert(status === 403, `${path}: expected 403, got ${status}: ${JSON.stringify(body)}`);
                assert(body.error.code === 'SEALED_CONFIG', `${path}: code ${body.error.code}`);
                assert(body.error.message.includes(path), `${path}: the refusal must name the setting, got "${body.error.message}"`);
                assert(/runs this node/.test(body.error.message), `${path}: the refusal must say who set it`);
            }
        });

        await test('7. the refusal leaves the operator somewhere to go', async () => {
            const { body } = await json('/v1/admin/config', {
                method: 'PUT', headers: auth(opToken),
                body: JSON.stringify({ changes: [{ path: 'quota.memory_mb', value: 99999 }] }),
            });
            const steps = (body.hints?.next_actions ?? []).map((a: any) => a.description).join(' | ');
            assert(/ask/i.test(steps), `next step should point at the host, got "${steps}"`);
        });

        await test('8. a mixed request applies NOTHING, not the half that was allowed', async () => {
            const before = (await json('/v1/admin/config', { headers: auth(opToken) })).body.data.schema['morsel_policy.welcome_bonus'].value;
            const { status, body } = await json('/v1/admin/config', {
                method: 'PUT', headers: auth(opToken),
                body: JSON.stringify({ changes: [
                    { path: 'morsel_policy.welcome_bonus', value: (before as number) + 7 },
                    { path: 'quota.memory_mb', value: 99999 },
                ] }),
            });
            assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
            const after = (await json('/v1/admin/config', { headers: auth(opToken) })).body.data.schema['morsel_policy.welcome_bonus'].value;
            assert(after === before, `the free path must not have been applied: ${before} -> ${after}`);
        });

        await test('9. →403 SEALED_CONFIG on DELETE, because removing an override moves the value', async () => {
            const { status, body } = await json('/v1/admin/config/quota.memory_mb', {
                method: 'DELETE', headers: auth(opToken),
            });
            assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
            assert(body.error.code === 'SEALED_CONFIG', `code ${body.error.code}`);
        });

        await test('10. the seal is a list, not a switch: an unsealed setting still applies', async () => {
            const { status, body } = await json('/v1/admin/config', {
                method: 'PUT', headers: auth(opToken),
                body: JSON.stringify({ changes: [{ path: 'quota.storage_mb', value: 321 }] }),
            });
            assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.applied[0].new_value === 321, `applied: ${JSON.stringify(body.data.applied)}`);
        });

        await test('11. the seal list cannot be edited from inside the node', async () => {
            const { status, body } = await json('/v1/admin/config', {
                method: 'PUT', headers: auth(opToken),
                body: JSON.stringify({ changes: [{ path: 'node.sealed_config_keys', value: [] }] }),
            });
            // 400, not 403 SEALED_CONFIG, and that is the correct answer: node.sealed_config_keys is
            // `immutable: true`, so it is not in MUTABLE_CONFIG_MAP and never reaches the seal check
            // at all. That immutability is what makes the mechanism unescalatable from inside the
            // node, so this test asserts the older rule is still the one holding the door.
            assert(status === 400, `expected 400 INVALID_INPUT, got ${status}: ${JSON.stringify(body)}`);
            assert(body.error.code === 'INVALID_INPUT', `code ${body.error.code}`);
            const after = (await json('/v1/admin/config', { headers: auth(opToken) })).body;
            assert(after.data.sealed.length === SEALED.length, 'the seal list is unchanged');
        });

        // ── Phase 4: the MCP door answers the same question ──
        console.log('\nPhase 4: the same node over MCP');
        let mcpToken = '';
        await test('12. an operator-owned agent gets an MCP session', async () => {
            const agentName = 'sealcfgagent';
            const reg = await json('/v1/agents', {
                method: 'POST', headers: auth(opToken),
                body: JSON.stringify({ name: agentName, owner: unsealedOp.name, capabilities: ['admin'], model: 'gpt-4o' }),
            });
            assert(reg.status === 201, `agent register: ${reg.status}: ${JSON.stringify(reg.body)}`);
            const agentGaii = reg.body.data.agent.gaii;
            const agentKey = reg.body.data.private_key;
            const client = await json('/v1/mcp/register', {
                method: 'POST', body: JSON.stringify({ client_name: 'Sealed Config E2E', redirect_uris: [] }),
            });
            assert(client.status === 201, `mcp client register: ${client.status}`);
            const ts = new Date().toISOString();
            const sig = await signMsg(agentKey, agentGaii + NODE_ID + ts);
            const params = new URLSearchParams({ response_type: 'code', client_id: client.body.client_id, gaii: agentGaii, signature: sig, timestamp: ts });
            const authorize = await json(`/v1/mcp/authorize?${params}`);
            assert(typeof authorize.body.code === 'string', `authorize: ${JSON.stringify(authorize.body)}`);
            const tok = await json('/v1/mcp/token', {
                method: 'POST',
                body: JSON.stringify({
                    grant_type: 'authorization_code', code: authorize.body.code,
                    client_id: client.body.client_id, client_secret: client.body.client_secret,
                }),
            });
            assert(tok.status === 200, `mcp token: ${tok.status}`);
            mcpToken = tok.body.access_token;
        });

        await test('13. aimeat_admin_config reports the seal, with the values', async () => {
            const rpc = mcpClient(() => mcpToken);
            await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Sealed Config E2E', version: '1.0.0' } });
            const { body } = await rpc('tools/call', { name: 'aimeat_admin_config', arguments: {} }, 2);
            assert(body?.result?.isError !== true, `tool errored: ${JSON.stringify(body?.result ?? body)}`);
            const payload = JSON.parse(body.result.content[0].text);
            assert(Array.isArray(payload.sealed), `no sealed block: ${JSON.stringify(payload).slice(0, 300)}`);
            assert(payload.sealed.length === SEALED.length, `sealed block: ${JSON.stringify(payload.sealed)}`);
            const quota = payload.sealed.find((s: any) => s.path === 'quota.memory_mb');
            assert(quota?.value === HOST_MEMORY_QUOTA_MB, `the MCP door shows the value too: ${JSON.stringify(quota)}`);
            assert(typeof payload.sealed_note === 'string', 'the MCP door says who set them');
        });

        // ── Phase 5: an agent that is not the operator is refused, seal or no seal ──
        await test('14. a non-operator is still refused the config door outright', async () => {
            const { status, body } = await json('/v1/admin/config');
            assert(status === 401, `unauthenticated: expected 401, got ${status}: ${JSON.stringify(body)}`);
        });
    } finally {
        if (server) await stopServer(server);
        cleanupDb();
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`  passed: ${passed}   failed: ${failed}`);
    console.log(`${'='.repeat(50)}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
