/**
 * @file e2e-operator-admin-migration.ts
 * @description The one-time boot migration that hands operator:admin to the operator's full-access
 *   agents (services/operator-admin-migration.ts), proven across three real boots of one database.
 *
 *   WHY IT OWNS ITS SERVER. The migration runs at boot and records that it ran, so the only honest
 *   test is a node that is stopped and started again on the same data. It follows the runner's
 *   backend: Postgres when the env file names it, a temporary SQLite file otherwise.
 *
 *   THE THREE BOOTS.
 *   1. A node with the accounts this change meets on a real node: an operator with a full-access
 *      agent, a narrow one, one already ticked, and a claude.ai-style connector the owner gave "Full
 *      access" on the consent screen; and an ordinary owner with a full-access agent. Between this
 *      boot and the next, the record that the migration ran is removed, so the second boot meets the
 *      node as it stood before this build (on the old code there is no such record to remove).
 *   2. The boot that carries the migration: the operator's full-access agents are offered the admin
 *      tools, nobody else changes, and the operator's feed names the agents that got the word.
 *   3. The next boot changes nothing: the operator took the word away from one agent and made a new
 *      full-access agent in between, and neither is touched.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-operator-admin-migration
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-operator-admin-migration
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { TOOL_SCOPES } from '../src/mcp/catalog/scopes.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_OPERATOR_ADMIN_MIGRATION_PORT ?? '40447';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const WORD = 'operator:admin';
/** Where the node records that the migration ran: services/operator-admin-migration.ts. Phase 2
 *  asserts the record exists under this key, so a rename there fails here rather than passing hollow. */
const MARKER_KEY = 'migrations.operator-admin';
const SYSTEM = `system@${NODE_ID}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
/** Every tool that rides the word. Derived, so a new admin tool is covered the day it lands. */
const ADMIN_TOOLS = Object.entries(TOOL_SCOPES).filter(([, s]) => s === WORD).map(([t]) => t);

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

// ── the node, three times ──

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-opadmin-'));
const DB_PATH = join(dbDir, 'opadmin.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the operator-admin migration node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
    // The next boot must not talk to this process: wait until nothing answers on the port.
    const began = Date.now();
    while (Date.now() - began < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await new Promise(r => setTimeout(r, 150));
    }
}

/** The node's own data while it is stopped, for the record that the migration ran. */
async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const storage = PG_URL
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL })
        : await createStorage({ provider: 'sqlite', sqlitePath: DB_PATH });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

// ── the people and their agents ──

interface Agent { name: string; gaii: string; key: string }
interface Owner { name: string; key: string; token: string }

async function ownerToken(name: string, key: string): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function agentToken(a: Agent): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii: a.gaii, timestamp: ts, signature: await signMsg(a.key, a.gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${a.gaii}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function createAgent(owner: Owner, name: string, scopes: string[]): Promise<Agent> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name, owner: owner.name, display_name: name, capabilities: [], scopes }),
    });
    assert(r.status === 201, `create agent ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
    return { name, gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
}

/** What the node holds for an agent right now, read through the owner's own agent list. */
async function scopesOf(owner: Owner, agent: string): Promise<string[]> {
    const r = await json(`/v1/agents?owner=${encodeURIComponent(owner.name)}`, { headers: auth(owner.token) });
    assert(r.status === 200, `agent list ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = (r.body.data?.agents ?? r.body.data ?? []) as any[];
    const row = list.find(a => a.name === agent);
    assert(!!row, `agent ${agent} is not in ${owner.name}'s list`);
    return (row.default_scopes ?? row.scopes ?? row.defaultScopes ?? []) as string[];
}

/** The operator_admin_granted rows on an owner's feed. */
async function grantedEvents(owner: Owner): Promise<any[]> {
    const r = await json('/v1/account/events?limit=500', { headers: auth(owner.token) });
    assert(r.status === 200, `events ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.events as any[]).filter(e => e.kind === 'operator_admin_granted');
}

// ── the tool surface, as an agent sees it ──

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* a partial frame */ } }
    }
    return out;
}

async function mcpSession(token: string) {
    let sessionId = '';
    const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'opadmin-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
            'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return {
        async list(): Promise<string[]> {
            const body = await rpc('tools/list', {}, 2);
            return (body.result?.tools ?? []).map((t: any) => t.name as string);
        },
        async call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
            const body = await rpc('tools/call', { name, arguments: args }, 3);
            return { ok: body.error === undefined && body.result?.isError !== true, body };
        },
    };
}

/** The admin tools this token is offered. */
async function adminToolsOffered(token: string): Promise<string[]> {
    const tools = await (await mcpSession(token)).list();
    assert(tools.length > 0, 'the session offered no tools at all, so it proves nothing');
    return ADMIN_TOOLS.filter(t => tools.includes(t));
}

// ── a claude.ai connector, the way the consent page makes one ──

interface Connector { agent: Agent; access: string; refresh: string; clientId: string; clientSecret: string }

/**
 * The browser consent flow (public/oauth-consent.html): the owner creates the agent the connector
 * acts as, picks "Full access", approves, and the connector redeems the code. The agent is created
 * with no scope list of its own, so it starts on the node's default agent scopes, and "Full access"
 * is written through the same PATCH the page uses.
 */
async function connectClaudeAi(owner: Owner): Promise<Connector> {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
    assert(reg.status === 201, `client registration ${reg.status}`);
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: 'claude', owner: owner.name, display_name: 'Claude' }),
    });
    assert(made.status === 201, `the consent page's agent ${made.status}: ${JSON.stringify(made.body.error)}`);
    const agent: Agent = { name: 'claude', gaii: made.body.data.agent.gaii, key: made.body.data.private_key };
    const full = await json('/v1/agents/claude/scopes', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ scopes: ['*'] }) });
    assert(full.status === 200, `"Full access" ${full.status}: ${JSON.stringify(full.body.error)}`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const consent = await json('/v1/mcp/authorize-consent', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, client_name: 'Claude', redirect_uri: REDIRECT, state: 'e2e', gaii: agent.gaii, owner_token: owner.token, code_challenge: challenge }),
    });
    assert(typeof consent.body.redirect_url === 'string', `consent ${consent.status}: ${JSON.stringify(consent.body)}`);
    const code = new URL(consent.body.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, code_verifier: verifier }),
    });
    assert(typeof tok.body.access_token === 'string' && typeof tok.body.refresh_token === 'string', `token exchange: ${JSON.stringify(tok.body)}`);
    return { agent, access: tok.body.access_token, refresh: tok.body.refresh_token, clientId, clientSecret };
}

(async () => {
    console.log('\n=== The operator:admin boot migration ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);
    assert(ADMIN_TOOLS.length > 20, `the catalog names ${ADMIN_TOOLS.length} tools on ${WORD}; this proves nothing`);

    let server = await startServer();
    const stamp = Date.now() % 1_000_000;
    let op!: Owner;
    let plain!: Owner;
    let opWide!: Agent, opNarrow!: Agent, opTicked!: Agent, plainWide!: Agent;
    let claude!: Connector;

    console.log('Phase 1: the node as this build first meets it');

    await test('1a. an operator, an ordinary owner, and their agents', async () => {
        const reg = await json('/v1/admin/setup/register', {
            method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: `opmig${stamp}` }),
        });
        assert(reg.status === 200 && reg.body.owner?.roles?.includes('operator'), `operator ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
        op = { name: `opmig${stamp}`, key: reg.body.private_key, token: '' };
        op.token = await ownerToken(op.name, op.key);
        const p = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: `plainmig${stamp}`, public_key: 'placeholder' }) });
        assert(p.status === 201, `plain owner ${p.status}: ${JSON.stringify(p.body.error)}`);
        assert(!(p.body.data.owner?.roles ?? []).includes('operator'), 'the ordinary owner came out an operator, so nothing below proves anything');
        plain = { name: `plainmig${stamp}`, key: p.body.data.private_key, token: '' };
        plain.token = await ownerToken(plain.name, plain.key);

        opWide = await createAgent(op, 'opwide', ['*']);
        opNarrow = await createAgent(op, 'opnarrow', ['memory:read']);
        opTicked = await createAgent(op, 'opticked', ['memory:read', WORD]);
        plainWide = await createAgent(plain, 'plainwide', ['*']);
        claude = await connectClaudeAi(op);
    });

    await test('1b. the claude.ai connector the owner gave "Full access" holds it on its record', async () => {
        const held = await scopesOf(op, 'claude');
        assert(held.length === 1 && held[0] === '*', `the connector's record holds [${held.join(', ')}]`);
    });

    await test(`1c. before the migration, a full-access agent of the operator is offered none of the ${ADMIN_TOOLS.length} admin tools`, async () => {
        const offered = await adminToolsOffered(await agentToken(opWide));
        assert(offered.length === 0, `offered ${offered.length}: ${offered.join(', ')}`);
        const viaConnector = await adminToolsOffered(claude.access);
        assert(viaConnector.length === 0, `the connector was offered ${viaConnector.length}: ${viaConnector.join(', ')}`);
    });

    await test('1d. the agent the operator ticked by hand is offered them, which is what the others are compared with', async () => {
        const offered = await adminToolsOffered(await agentToken(opTicked));
        assert(offered.length >= 20, `a ticked agent was offered only ${offered.length}`);
    });

    await stopServer(server);
    // The node as it stood before this build: no record that the migration ever ran. On the old code
    // there is none to remove, which is what makes this suite fail there first.
    await withStorage(s => s.deleteMemory(SYSTEM, MARKER_KEY));

    console.log('\nPhase 2: the boot that carries the migration');
    server = await startServer();
    op.token = await ownerToken(op.name, op.key);
    plain.token = await ownerToken(plain.name, plain.key);
    const tickedOffered = await adminToolsOffered(await agentToken(opTicked));

    // Every boot also runs the scope-vocabulary migration (services/scope-vocabulary-migration.ts),
    // which writes its own words onto agents, so these read the one word this suite is about rather
    // than the whole list.
    await test('2a. the operator\'s full-access agent holds the word, and nothing it held is lost', async () => {
        const held = await scopesOf(op, 'opwide');
        assert(held.includes('*') && held.includes(WORD), `opwide holds [${held.join(', ')}]`);
    });

    await test('2b. a token minted now is offered every admin tool the ticked agent is, and one answers', async () => {
        const token = await agentToken(opWide);
        const offered = await adminToolsOffered(token);
        const missing = tickedOffered.filter(t => !offered.includes(t));
        assert(offered.length > 0 && missing.length === 0, `offered ${offered.length}, missing ${missing.join(', ')}`);
        const { ok, body } = await (await mcpSession(token)).call('aimeat_admin_stats', {});
        const stats = ok ? JSON.parse(body.result.content[0].text) : null;
        // This suite's five agents at least; a Postgres run may hold older rows.
        assert(stats?.node_id === NODE_ID && stats?.counts?.agents >= 5,
            `aimeat_admin_stats answered the migrated agent with ${JSON.stringify(body).slice(0, 200)}`);
        // The word opens the tools and nothing more: the HTTP admin doors stay the operator's in person.
        const door = await json('/v1/admin/security/overview', { headers: auth(token) });
        assert(door.status === 403, `the HTTP admin door answered the migrated agent's token with ${door.status}`);
    });

    await test('2c. the connector gets the word on its record, and the admin tools in its next session', async () => {
        const held = await scopesOf(op, 'claude');
        assert(held.includes(WORD), `the connector holds [${held.join(', ')}]`);
        // An MCP session reads the agent's record when it opens (mcp/index.ts), so the access token the
        // connector already holds is enough: its next session is offered the tools.
        const next = await adminToolsOffered(claude.access);
        const missingNext = tickedOffered.filter(t => !next.includes(t));
        assert(next.length > 0 && missingNext.length === 0, `next session: offered ${next.length}, missing ${missingNext.join(', ')}`);
        // And when the access token runs out, the refresh the connector makes works across the restart.
        const r = await json('/v1/mcp/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: claude.refresh, client_id: claude.clientId, client_secret: claude.clientSecret }),
        });
        assert(typeof r.body.access_token === 'string', `refresh: ${JSON.stringify(r.body)}`);
        const offered = await adminToolsOffered(r.body.access_token);
        const missing = tickedOffered.filter(t => !offered.includes(t));
        assert(offered.length > 0 && missing.length === 0, `after the refresh: offered ${offered.length}, missing ${missing.join(', ')}`);
    });

    await test('2d. an operator\'s narrow agent is not given the word and is still offered none', async () => {
        const held = await scopesOf(op, 'opnarrow');
        assert(held.includes('memory:read') && !held.includes(WORD), `opnarrow holds [${held.join(', ')}]`);
        const token = await agentToken(opNarrow);
        const offered = await adminToolsOffered(token);
        assert(offered.length === 0, `offered ${offered.length}: ${offered.join(', ')}`);
        // A tool the session was not offered is not registered, and the SDK answers "not found".
        const byName = await (await mcpSession(token)).call('aimeat_admin_stats', {});
        assert(byName.body.result?.isError === true && String(byName.body.result?.content?.[0]?.text).includes('not found'),
            `the narrow agent called aimeat_admin_stats by name and was answered: ${JSON.stringify(byName.body).slice(0, 200)}`);
    });

    await test('2e. an agent that already held the word is left as it was', async () => {
        const held = await scopesOf(op, 'opticked');
        assert(held.includes('memory:read') && held.filter(s => s === WORD).length === 1, `opticked holds [${held.join(', ')}]`);
    });

    await test('2f. an ordinary owner\'s full-access agent does not get the word', async () => {
        const held = await scopesOf(plain, 'plainwide');
        assert(held.includes('*') && !held.includes(WORD), `plainwide holds [${held.join(', ')}]`);
        const token = await agentToken(plainWide);
        const offered = await adminToolsOffered(token);
        assert(offered.length === 0, `offered ${offered.length}: ${offered.join(', ')}`);
        const byName = await (await mcpSession(token)).call('aimeat_admin_stats', {});
        assert(byName.body.result?.isError === true && String(byName.body.result?.content?.[0]?.text).includes('not found'),
            `the ordinary owner's agent called aimeat_admin_stats by name and was answered: ${JSON.stringify(byName.body).slice(0, 200)}`);
    });

    await test('2g. the operator\'s feed has one line, naming the agents that got the word and no other', async () => {
        const events = await grantedEvents(op);
        assert(events.length === 1, `expected one operator_admin_granted event, found ${events.length}`);
        const names = String(events[0].data?.names ?? '').split(', ').sort();
        assert(JSON.stringify(names) === JSON.stringify(['claude', 'opwide']), `the line names [${names.join(', ')}]`);
        assert(events[0].data?.count === '2', `count ${events[0].data?.count}`);
        const theirs = await grantedEvents(plain);
        assert(theirs.length === 0, `the ordinary owner's feed has ${theirs.length}`);
    });

    // The owner's own changes between the boots: the word taken back from one agent, and a new
    // full-access agent made after the migration ran.
    await test('2h. the operator takes the word back from one agent, and makes a new full-access agent', async () => {
        const back = await json('/v1/agents/opwide/scopes', { method: 'PATCH', headers: auth(op.token), body: JSON.stringify({ scopes: ['*'] }) });
        assert(back.status === 200, `untick ${back.status}: ${JSON.stringify(back.body.error)}`);
        await createAgent(op, 'opnew', ['*']);
    });

    await stopServer(server);

    await test('2i. the node recorded that the migration ran', async () => {
        const marker = await withStorage(s => s.getMemory(SYSTEM, MARKER_KEY));
        const v = marker?.value as { at?: unknown; agents?: unknown } | undefined;
        // At least this suite's two: opwide and the connector (a Postgres run may hold older rows).
        assert(typeof v?.at === 'string' && typeof v?.agents === 'number' && v.agents >= 2,
            `the record under ${SYSTEM} ${MARKER_KEY} reads ${JSON.stringify(marker?.value ?? null)}`);
    });

    console.log('\nPhase 3: the next boot changes nothing');
    server = await startServer();
    op.token = await ownerToken(op.name, op.key);

    await test('3a. the word the owner took back stays taken back', async () => {
        const held = await scopesOf(op, 'opwide');
        assert(held.includes('*') && !held.includes(WORD), `opwide holds [${held.join(', ')}]`);
    });

    await test('3b. a full-access agent made after the migration is not handed the word', async () => {
        const held = await scopesOf(op, 'opnew');
        assert(held.includes('*') && !held.includes(WORD), `opnew holds [${held.join(', ')}]`);
    });

    await test('3c. the feed still has the one line', async () => {
        const events = await grantedEvents(op);
        assert(events.length === 1, `found ${events.length} operator_admin_granted events`);
    });

    await stopServer(server);
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('SUITE CRASHED:', err);
    process.exit(1);
});
