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
 *   v1.1.0 — 2026-10-12 — Test 10 calls the person-only route with the agent's own REST token (POST
 *     /v1/auth/token). It sent the MCP OAuth token, which node 4.0.0 refuses on every REST route with
 *     401 INVALID_TOKEN, so the 403 for an agent session the test names was never reached there.
 *   v1.2.0 — 2026-11-23 — GET /v1/settings/proactive answers the owner's own agents and apps that
 *     hold memory:read, so an agent can learn that the operator turned the feature off. Tests 8a to
 *     8f and the agent's read in test 12 are new. Test 8a holds the route to the memory read of the
 *     setting's own key, caller by caller. Test 8f is the chat path: the route as a capability an
 *     agent looks up and runs with aimeat_invoke, over REST and over MCP. Test 10 asserted 403 for an agent's GET ("an agent cannot
 *     use the person-only route"); that is no longer the designed behaviour, so it now asserts that
 *     an agent's PUT is refused and changes nothing.
 */
import * as ed from '@noble/ed25519';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_PROACTIVE_PORT ?? '28404';
const OFF_PORT = process.env.E2E_PROACTIVE_OFF_PORT ?? '28409';
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
    return { status: res.status, body, headers: res.headers };
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
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs(dbPath)],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, base, { label: `the node on port ${port}` });
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
    const ownerTok = await ownerSignIn(base, ownerName, 'Proactive1234');
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
    const ts = new Date().toISOString();
    const pkce = mcpPkce(base);
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii,
        signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts,
        ...authorizeParams(pkce),
    });
    const authz = await jsonAt(base, `/v1/mcp/authorize?${params}`);
    assert(typeof authz.body.code === 'string', 'has auth code');
    const tok = await jsonAt(base, '/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: authz.body.code,
            client_id: reg.body.client_id, client_secret: reg.body.client_secret,
            ...tokenParams(pkce),
        }),
    });
    assert(tok.status === 200, `mcp token ${tok.status}`);

    // The agent's own REST token. Node 4.0.0 refuses the MCP OAuth token on a REST route (401
    // INVALID_TOKEN, MCP_TOKEN_ON_REST_REMOVED_IN), so a REST test of the agent uses this one.
    const restTs = new Date().toISOString();
    const restTok = await jsonAt(base, '/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: restTs, signature: await signMsg(agentPriv, agentGaii + restTs) }),
    });
    assert(restTok.status === 200, `agent token ${restTok.status}: ${JSON.stringify(restTok.body?.error)}`);

    return { ownerName, ownerToken, agentGaii, mcpToken: tok.body.access_token as string, agentToken: restTok.body.data.token as string };
}

/**
 * One more agent of an existing owner, holding exactly `scopes`, with its own REST token. The owner
 * sets the list as a person does on the agents page (PATCH /v1/agents/:name/scopes), and the token is
 * made after that so it is the agent's current one.
 */
async function agentWithScopes(base: string, owner: { ownerName: string; ownerToken: string }, name: string, scopes: string[]): Promise<string> {
    const agent = await jsonAt(base, '/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.ownerToken}` },
        body: JSON.stringify({ name, owner: owner.ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(agent.status === 201, `agent ${name} ${agent.status}: ${JSON.stringify(agent.body?.error)}`);
    const set = await jsonAt(base, `/v1/agents/${encodeURIComponent(name)}/scopes`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${owner.ownerToken}` }, body: JSON.stringify({ scopes }),
    });
    assert(set.status === 200, `scopes of ${name} ${set.status}: ${JSON.stringify(set.body?.error)}`);
    const gaii = agent.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await jsonAt(base, '/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(agent.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `token of ${name} ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

/**
 * What one caller gets for the setting's own memory key through the memory read with owner_scope:
 * the status, and whether the record came back. The route's read rule is held to this one.
 */
async function memoryReadOfSetting(base: string, token: string): Promise<{ status: number; seen: boolean; code: string | null }> {
    const r = await jsonAt(base, '/v1/memory/settings.proactive?owner_scope=true&soft=1', auth(token));
    return { status: r.status, seen: r.status === 200 && r.body?.data?.exists === true, code: r.body?.error?.code ?? null };
}

/** Where an app grant's code is sent in this suite. Nothing listens there: the code is read from the consent's answer. */
const APP_REDIRECT = 'http://localhost:9913/proactive-callback';

/**
 * Publish a one-page app as `owner` on `base` and sign it in through the app-grant flow a browser
 * uses (authorize, the owner's consent, the code exchange with PKCE). Answers the app's own token.
 * A local copy of the purpose suites' shared app-grant helper: that helper reads the runner's node
 * address, and this suite starts every node it talks to (test/run-e2e-plan.ts lists it as needing no
 * runner node), as e2e-ai-jobs.ts and e2e-ai-input-reach.ts do. `base` has no default on purpose.
 */
async function appGrantToken(base: string, owner: { ownerName: string; ownerToken: string }, filename: string, scope: string): Promise<string> {
    const html = '<!DOCTYPE html><html><body>proactive e2e</body></html>';
    const pub = await jsonAt(base, '/v1/apps', auth(owner.ownerToken, {
        method: 'POST',
        body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), name: `Proactive ${filename}`, description: 'proactive e2e', category: 'utility' }),
    }));
    assert(pub.status === 201, `publish ${filename} ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.ownerName}/${filename}`, response_type: 'code', scope,
        redirect_uri: APP_REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${base}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!m, `consent redirect expected for ${filename}, got ${res.status}`);
    const con = await jsonAt(base, '/v1/app-grants/authorize-consent', auth(owner.ownerToken, {
        method: 'POST', body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
    }));
    assert(con.status === 200, `consent ${filename}: ${con.status} ${JSON.stringify(con.body?.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await jsonAt(base, '/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: APP_REDIRECT }),
    });
    assert(tok.body?.ok === true, `app token ${filename}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.access_token as string;
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

        let me = { ownerName: '', ownerToken: '', agentGaii: '', mcpToken: '', agentToken: '' };
        let other = { ownerName: '', ownerToken: '', agentGaii: '', mcpToken: '', agentToken: '' };

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

        console.log('\nPhase 3b: who reads the setting');

        // The callers of the first owner, by what each holds. The setting is OFF and set by an AI at
        // this point (test 8), so an answer that is only the default cannot pass for the real one.
        const readers: Record<string, string> = {};
        /**
         * Who the memory read shows the setting's own key to, and so who the route answers. An agent
         * needs memory:read and nothing more: the key's visibility is `owner`, which a same-owner
         * reader sees without memory:read-as-owner, and that word alone is not enough.
         */
        const SERVED: Record<string, boolean> = {
            owner: true, wildcard: true, memoryRead: true, readAsOwner: true, appRead: true,
            asOwnerOnly: false, noMemory: false, appNoMemory: false,
        };

        await test('8a. the route answers exactly the callers the memory read shows the key to', async () => {
            readers.owner = me.ownerToken;
            readers.wildcard = me.agentToken;
            readers.memoryRead = await agentWithScopes(BASE, me, 'proactread', ['memory:read']);
            readers.readAsOwner = await agentWithScopes(BASE, me, 'proactasowner', ['memory:read', 'memory:read-as-owner']);
            readers.asOwnerOnly = await agentWithScopes(BASE, me, 'proactonlyas', ['memory:read-as-owner']);
            readers.noMemory = await agentWithScopes(BASE, me, 'proactnomem', ['messages:send']);
            readers.appRead = await appGrantToken(BASE, me, 'proactread.html', 'memory:read');
            readers.appNoMemory = await appGrantToken(BASE, me, 'proactnomem.html', 'ai:use');

            const wrong: string[] = [];
            for (const [who, token] of Object.entries(readers)) {
                const mem = await memoryReadOfSetting(BASE, token);
                const route = await json('/v1/settings/proactive', auth(token));
                // The control: the memory read is what this suite says it is. It holds on any route code.
                if (mem.seen !== SERVED[who]) wrong.push(`${who}: the memory read shows the key ${mem.seen} (status ${mem.status}), expected ${SERVED[who]}`);
                // The route follows it: 200 for a caller the memory read serves, 403 for one it does not.
                const want = SERVED[who] ? 200 : 403;
                if (route.status !== want) wrong.push(`${who}: the route answered ${route.status}, expected ${want}`);
            }
            assert(wrong.length === 0, `the route and the memory read disagree:\n      ${wrong.join('\n      ')}`);
        });

        await test('8b. the owner\'s agent gets the owner\'s own answer', async () => {
            const mine = await json('/v1/settings/proactive', auth(me.ownerToken));
            const agents = await json('/v1/settings/proactive', auth(readers.memoryRead!));
            assert(agents.status === 200, `status ${agents.status}: ${JSON.stringify(agents.body?.error)}`);
            for (const field of ['enabled', 'defaulted', 'owner_choice', 'available_here', 'set_by', 'set_at']) {
                assert(agents.body.data[field] === mine.body.data[field],
                    `${field}: the agent reads ${JSON.stringify(agents.body.data[field])}, the owner ${JSON.stringify(mine.body.data[field])}`);
            }
            assert(agents.body.data.enabled === false && agents.body.data.set_by === 'ai',
                `the agent reads the real setting, not the default: ${JSON.stringify(agents.body.data)}`);
        });

        await test('8c. a caller without memory:read is refused, and the refusal names the word', async () => {
            for (const who of ['noMemory', 'asOwnerOnly']) {
                const r = await json('/v1/settings/proactive', auth(readers[who]!));
                assert(r.status === 403, `${who}: expected 403, got ${r.status}`);
                assert(r.body?.error?.code === 'SCOPE_DENIED', `${who}: the code is ${r.body?.error?.code}`);
                const challenge = r.headers.get('www-authenticate') ?? '';
                assert(challenge.includes('insufficient_scope') && challenge.includes('memory:read'),
                    `${who}: the challenge names the missing word for a client: ${challenge}`);
            }
        });

        await test('8d. another owner\'s agent reads its own owner\'s setting, never this one', async () => {
            const theirs = await agentWithScopes(BASE, other, 'proactread', ['memory:read']);
            const r = await json('/v1/settings/proactive', auth(theirs));
            assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
            assert(r.body.data.defaulted === true && r.body.data.enabled === true,
                `the second owner never chose, and the first owner's off is not theirs: ${JSON.stringify(r.body.data)}`);
        });

        await test('8e. a request without a session is asked to sign in', async () => {
            const r = await json('/v1/settings/proactive');
            assert(r.status === 401, `expected 401, got ${r.status}`);
        });

        await test('8f. an agent in a chat reads it too: the route is a capability aimeat_invoke runs', async () => {
            const CAP = 'route:GET /v1/settings/proactive';
            const run = (token: string) => json('/v1/invoke', auth(token, { method: 'POST', body: JSON.stringify({ capability: CAP, input: {} }) }));

            // What an agent that looks the capability up is told: the route, and the word it asks.
            const listed = await json(`/v1/capabilities/node/${encodeURIComponent(CAP)}`);
            assert(listed.status === 200, `the capability is listed: ${listed.status} ${JSON.stringify(listed.body?.error)}`);
            const cap = listed.body.data.capability;
            assert(cap.kind === 'route' && cap.method === 'GET' && cap.path === '/v1/settings/proactive', `the route: ${JSON.stringify(cap).slice(0, 200)}`);
            assert(cap.permission?.word === 'memory:read', `it names the word an agent needs: ${JSON.stringify(cap).slice(0, 400)}`);

            // Run through invoke, the route answers as it does directly: the same data for the agent it
            // serves, the same refusal for the one it does not.
            const direct = await json('/v1/settings/proactive', auth(readers.memoryRead!));
            const via = await run(readers.memoryRead!);
            assert(via.status === 200, `invoke admits the agent: ${via.status} ${JSON.stringify(via.body?.error)}`);
            const got = via.body.data?.result;
            assert(got?.enabled === direct.body.data.enabled && got?.available_here === direct.body.data.available_here && got?.set_by === 'ai',
                `the same answer as the route: ${JSON.stringify(via.body.data).slice(0, 300)}`);
            const refusedDirect = await json('/v1/settings/proactive', auth(readers.noMemory!));
            const refusedVia = await run(readers.noMemory!);
            assert(refusedVia.status === refusedDirect.status && refusedVia.body?.error?.code === refusedDirect.body?.error?.code,
                `the same refusal as the route: invoke ${refusedVia.status} ${refusedVia.body?.error?.code}, route ${refusedDirect.status} ${refusedDirect.body?.error?.code}`);
            assert(String(refusedVia.body?.error?.message).includes('memory:read'),
                `the refusal through invoke is the route's own, naming its word: ${JSON.stringify(refusedVia.body?.error)}`);

            // And over MCP, where a chat's AI is.
            const rpc = mcpClient(BASE, '/v1/mcp', () => me.mcpToken);
            await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
            const { body } = await rpc('tools/call', { name: 'aimeat_invoke', arguments: { capability: CAP, input: {} } }, 13);
            assert(body.result?.isError !== true, `aimeat_invoke failed: ${toolText(body).slice(0, 300)}`);
            const out = JSON.parse(toolText(body));
            assert(out.capability === CAP && out.result?.enabled === false && typeof out.result?.available_here === 'boolean',
                `the chat's AI reads the mode: ${toolText(body).slice(0, 300)}`);
        });

        console.log('\nPhase 4: refusals');

        await test('9. another owner cannot read this setting', async () => {
            const r = await json('/v1/settings/proactive', auth(other.ownerToken));
            // A different account reads its OWN setting, never this one.
            assert(r.status === 200, `status ${r.status}`);
            assert(r.body.data.defaulted === true,
                'the second owner sees their own untouched default, not the first owner\'s off');
        });

        await test('10. an agent cannot change the setting through the route, whatever it holds', async () => {
            // The write is the account holder's own step: it records `by: 'person'` without asking. An
            // agent that holds every word still changes the setting only through the memory key, where
            // it says who acted (test 8).
            const r = await json('/v1/settings/proactive', auth(me.agentToken, {
                method: 'PUT', body: JSON.stringify({ enabled: true }),
            }));
            assert(r.status === 403, `an agent's write must be refused here, got ${r.status}`);
            const after = await json('/v1/settings/proactive', auth(me.ownerToken));
            assert(after.body.data.enabled === false && after.body.data.set_by === 'ai',
                `the refused write changed the setting: ${JSON.stringify(after.body.data)}`);
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

            // An agent acting for the owner learns it too. No memory key holds the operator's switch,
            // so without this read an agent that interrupts people cannot know it is off here.
            const offAgent = await agentWithScopes(OFF_BASE, them, 'proactoffread', ['memory:read']);
            const seen = await jsonAt(OFF_BASE, '/v1/settings/proactive', auth(offAgent));
            assert(seen.status === 200, `the owner's agent reads the mode on this node: ${seen.status} ${JSON.stringify(seen.body?.error)}`);
            assert(seen.body.data.available_here === false && seen.body.data.enabled === false,
                `the agent sees that the operator turned it off: ${JSON.stringify(seen.body.data)}`);
            assert(seen.body.data.owner_choice === true, 'and that the account itself did not');

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
