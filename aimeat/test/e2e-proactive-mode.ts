/**
 * @file e2e-proactive-mode.ts
 * @description E2E for proactive guidance: the setting, and whether the text an agent reads on
 *   connecting actually follows it.
 *
 *   THE MECHANISM IS TESTABLE EVEN THOUGH THE BEHAVIOUR IS NOT. Whether a chat picks a good moment
 *   to offer something is not assertable and this suite does not pretend otherwise. What IS
 *   assertable is everything the node owns: that the guidance is on for an account that never chose,
 *   that switching it off removes it from BOTH the handshake and the handbook, that an AI writing
 *   the setting itself is recorded as the one who did it, that another owner cannot read or write
 *   it, and that an operator who turned the feature off overrules every owner.
 *
 *   IT SPAWNS TWO SERVERS. The operator switch is a config flag, so the only honest way to prove it
 *   is a second node started with it off. That server exists for one assertion and is killed again.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=proactive-mode
 * @version-history
 *   v1.0.0 — 2026-08-22 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_PROACTIVE_PORT ?? '40272';
const OFF_PORT = process.env.E2E_PROACTIVE_OFF_PORT ?? '40273';
const BASE = `http://localhost:${PORT}`;
const OFF_BASE = `http://localhost:${OFF_PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-proactive.db');
const OFF_DB_PATH = resolve(process.cwd(), 'test/.test-proactive-off.db');

/**
 * The spawned servers follow the backend the runner was started with, rather than pinning sqlite.
 * The setting is a memory record, so a suite that always spawned sqlite would report a pass on the
 * postgres run without having touched postgres once. On postgres both servers share the runner's
 * database, which is harmless here: they start one after the other, and every owner this suite
 * makes carries its own stamp.
 */
const DB = process.env.AIMEAT_DB === 'postgres-kysely' ? 'postgres-kysely' : 'sqlite';
const dbArgs = (dbPath: string) =>
    DB === 'sqlite' ? ['--db', 'sqlite', '--db-path', dbPath] : ['--db', 'postgres-kysely'];

/** A phrase from the guidance that no other text on this node uses. */
const GUIDANCE_MARK = 'Offering what they did not know to ask for';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function jsonAt(base: string, path: string, opts: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const json = (path: string, opts: RequestInit = {}) => jsonAt(BASE, path, opts);

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

/** Parse an SSE body into the JSON-RPC messages it carried. */
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip a partial frame */ } }
    }
    return out;
}

/**
 * A JSON-RPC caller bound to one MCP endpoint. Each call to this factory is a FRESH session, which
 * is the point: the instructions are served once per connection, so proving that switching the
 * setting changed them means connecting again rather than re-reading the first handshake.
 */
function mcpClient(base: string, path: string, token: () => string) {
    let sessionId = '';
    return async function rpc(method: string, params: Record<string, any> = {}, id = 1) {
        const res = await fetch(`${base}${path}`, {
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
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json() as any;
        return { status: res.status, body };
    };
}

const toolText = (body: any): string => body?.result?.content?.[0]?.text ?? '';

function cleanupDb(path: string) {
    if (DB !== 'sqlite') return;    // on postgres the runner owns the database, not this suite
    for (const f of [path, path + '-wal', path + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(port: string, base: string, dbPath: string, extraEnv: Record<string, string> = {}): Promise<ChildProcess> {
    cleanupDb(dbPath);
    const env = {
        ...process.env,
        AIMEAT_PORT: port,
        AIMEAT_BASE_URL: base,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_CATALOGUE: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        ...extraEnv,
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', ...dbArgs(dbPath)],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${base}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`Server on ${port} failed to start`);
}

/** Register an owner, an agent and an MCP token for it. Returns everything the tests need. */
async function provision(base: string, stamp: number, tag: string) {
    const ownerName = `proact${tag}${stamp}`;
    const agentName = 'proactagent';

    const ghii = await jsonAt(base, '/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'Proactive Test', password: 'Proactive1234' }),
    });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    let ts = new Date().toISOString();
    const ownerTok = await jsonAt(base, '/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ghii.body.data.private_key, ownerName + NODE_ID + ts) }),
    });
    assert(ownerTok.body.ok === true, `owner token: ${JSON.stringify(ownerTok.body.error)}`);
    const ownerToken = ownerTok.body.data.token;

    const agent = await jsonAt(base, '/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body)}`);
    const agentGaii = agent.body.data.agent.gaii;
    const agentPriv = agent.body.data.private_key;

    const reg = await jsonAt(base, '/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: 'Proactive E2E', redirect_uris: [] }),
    });
    assert(reg.status === 201, `mcp register ${reg.status}`);
    ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii,
        signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts,
    });
    const authz = await jsonAt(base, `/v1/mcp/authorize?${params}`);
    assert(typeof authz.body.code === 'string', 'has auth code');
    const tok = await jsonAt(base, '/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: authz.body.code,
            client_id: reg.body.client_id, client_secret: reg.body.client_secret,
        }),
    });
    assert(tok.status === 200, `mcp token ${tok.status}`);

    return { ownerName, ownerToken, agentGaii, mcpToken: tok.body.access_token as string };
}

/** The instructions string a brand-new connection is served. */
async function freshInstructions(base: string, token: string, path = '/v1/mcp'): Promise<string> {
    const rpc = mcpClient(base, path, () => token);
    const { body } = await rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'Proactive E2E', version: '1.0.0' },
    });
    return body.result?.instructions ?? '';
}

async function main() {
    const server = await startServer(PORT, BASE, DB_PATH);
    let offServer: ChildProcess | null = null;
    try {
        const stamp = Date.now() % 100000;
        console.log('\n=== Proactive guidance E2E ===\n');
        console.log('Phase 0: setup');

        let me = { ownerName: '', ownerToken: '', agentGaii: '', mcpToken: '' };
        let other = { ownerName: '', ownerToken: '', agentGaii: '', mcpToken: '' };

        await test('register an owner with an agent, and a second owner', async () => {
            me = await provision(BASE, stamp, 'a');
            other = await provision(BASE, stamp, 'b');
        });

        console.log('\nPhase 1: on until somebody turns it off');

        await test('1. an account that never chose is ON, and says so', async () => {
            const r = await json('/v1/settings/proactive', auth(me.ownerToken));
            assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
            assert(r.body.data.enabled === true, 'on by default');
            assert(r.body.data.defaulted === true, 'and it says nothing was chosen');
            assert(r.body.data.set_by === null, `nobody set it, so set_by stays null: ${r.body.data.set_by}`);
        });

        await test('2. the guidance is in the handshake an agent reads', async () => {
            const text = await freshInstructions(BASE, me.mcpToken);
            assert(text.includes(GUIDANCE_MARK), 'the guidance section is there');
            assert(text.includes('aimeat_handbook_get'), 'and the base orientation is still there');
        });

        await test('3. the guidance is in the surface handbook too', async () => {
            const rpc = mcpClient(BASE, '/v2/mcp/agent', () => me.mcpToken);
            await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
            const { body } = await rpc('tools/call', { name: 'aimeat_handbook_get', arguments: { surface: 'agent' } }, 10);
            const text = toolText(body);
            assert(text.includes('What you can do here'), 'the handbook itself came back');
            assert(text.includes(GUIDANCE_MARK), 'with the guidance appended');
        });

        console.log('\nPhase 2: switching it off actually removes it');

        await test('4. the person switches it off', async () => {
            const r = await json('/v1/settings/proactive', auth(me.ownerToken, {
                method: 'PUT', body: JSON.stringify({ enabled: false }),
            }));
            assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
            assert(r.body.data.enabled === false, 'it is off');
            assert(r.body.data.defaulted === false, 'and no longer the default');
            assert(r.body.data.set_by === 'person', `a session is a person: ${r.body.data.set_by}`);
        });

        await test('5. a new connection carries NO trace of it', async () => {
            const text = await freshInstructions(BASE, me.mcpToken);
            assert(!text.includes(GUIDANCE_MARK), 'the guidance is gone');
            assert(!text.toLowerCase().includes('proactive'), 'and nothing hints that a switch exists');
            assert(text.includes('aimeat_handbook_get'), 'the base orientation is untouched');
        });

        await test('6. the handbook drops it as well', async () => {
            const rpc = mcpClient(BASE, '/v2/mcp/agent', () => me.mcpToken);
            await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
            const { body } = await rpc('tools/call', { name: 'aimeat_handbook_get', arguments: { surface: 'agent' } }, 11);
            const text = toolText(body);
            assert(text.includes('What you can do here'), 'the handbook still comes back');
            assert(!text.includes(GUIDANCE_MARK), 'without the guidance');
        });

        await test('7. switching it back on brings it back', async () => {
            const r = await json('/v1/settings/proactive', auth(me.ownerToken, {
                method: 'PUT', body: JSON.stringify({ enabled: true }),
            }));
            assert(r.status === 200, `status ${r.status}`);
            const text = await freshInstructions(BASE, me.mcpToken);
            assert(text.includes(GUIDANCE_MARK), 'the guidance is back');
        });

        console.log('\nPhase 3: an AI turning it off for its person');

        await test('8. the agent writes the setting itself, and is recorded as the one who did', async () => {
            // Through aimeat_memory_write, which is the path the guidance text actually names. If
            // that tool ever stopped being able to write this key, the instruction would be a lie.
            const rpc = mcpClient(BASE, '/v1/mcp', () => me.mcpToken);
            await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
            const { body } = await rpc('tools/call', {
                name: 'aimeat_memory_write',
                arguments: {
                    key: 'settings.proactive', owner_scope: true, visibility: 'owner', tags: ['settings'],
                    value: { enabled: false, by: 'ai', at: new Date().toISOString() },
                },
            }, 12);
            assert(body.result?.isError !== true, `agent write refused: ${toolText(body)}`);

            const r = await json('/v1/settings/proactive', auth(me.ownerToken));
            assert(r.body.data.enabled === false, 'the person asked their AI to stop, and it stopped');
            assert(r.body.data.set_by === 'ai', `the surface must show who acted: ${r.body.data.set_by}`);

            const text = await freshInstructions(BASE, me.mcpToken);
            assert(!text.includes(GUIDANCE_MARK), 'and the next connection is quiet');
        });

        console.log('\nPhase 4: refusals');

        await test('9. another owner cannot read this setting', async () => {
            const r = await json('/v1/settings/proactive', auth(other.ownerToken));
            // A different account reads its OWN setting, never this one.
            assert(r.status === 200, `status ${r.status}`);
            assert(r.body.data.defaulted === true,
                'the second owner sees their own untouched default, not the first owner\'s off');
        });

        await test('10. an agent cannot use the person-only route', async () => {
            const r = await json('/v1/settings/proactive', auth(me.mcpToken));
            assert(r.status === 403, `an agent session must be refused here, got ${r.status}`);
        });

        await test('11. a setting that is neither on nor off is refused', async () => {
            const r = await json('/v1/settings/proactive', auth(me.ownerToken, {
                method: 'PUT', body: JSON.stringify({ enabled: 'yes please' }),
            }));
            assert(r.status === 400, `expected a refusal, got ${r.status}`);
        });

        console.log('\nPhase 5: the operator overrules everybody');

        await test('12. a node with the feature off gives nobody the guidance', async () => {
            offServer = await startServer(OFF_PORT, OFF_BASE, OFF_DB_PATH, { AIMEAT_PROACTIVE_GUIDANCE: 'false' });
            const them = await provision(OFF_BASE, stamp, 'c');

            const r = await jsonAt(OFF_BASE, '/v1/settings/proactive', auth(them.ownerToken));
            assert(r.body.data.enabled === false, 'nothing is on here');
            assert(r.body.data.owner_choice === true, 'though the account itself never asked for that');
            assert(r.body.data.available_here === false, 'and the surface can say why');

            // Even an owner who explicitly turns it ON gets nothing: the operator's answer is final.
            const on = await jsonAt(OFF_BASE, '/v1/settings/proactive', auth(them.ownerToken, {
                method: 'PUT', body: JSON.stringify({ enabled: true }),
            }));
            assert(on.body.data.enabled === false, 'an owner cannot switch on what the operator turned off');

            const text = await freshInstructions(OFF_BASE, them.mcpToken);
            assert(!text.includes(GUIDANCE_MARK), 'and no agent here reads it');
        });

        console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    } finally {
        server.kill('SIGTERM');
        offServer?.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 300));
        cleanupDb(DB_PATH);
        cleanupDb(OFF_DB_PATH);
    }
    if (failed > 0) process.exit(1);
}

await main();
