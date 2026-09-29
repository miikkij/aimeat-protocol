/**
 * @file e2e-held-account-names.ts
 * @description The move to the full identity at start (Postgres 0086, and its SQLite half) and the
 *   start steps for what deleted accounts installed and were issued, on a node whose data they cannot
 *   place, proven across three real boots of one database.
 *
 *   WHY IT OWNS ITS SERVER. The move and the start steps run when the node starts and record that they
 *   ran, so the only honest test is a node that is stopped, given the data, and started again. It
 *   follows the runner's backend: Postgres when the env file names it, a temporary SQLite file
 *   otherwise.
 *
 *   THE THREE BOOTS.
 *   1. A node with an operator, an agent of the operator's holding operator:admin, a second person,
 *      and three accounts, carol, dora and erin, each with an ecosystem app connected whose token
 *      reads. While it is stopped, rows older than carol's and dora's accounts are written under their
 *      bare names (an action, work, a line of their own), their apps are made older than their
 *      accounts, and each of the three gets an app grant older than her account, dora and erin a
 *      personal access token too; erin's account and full identity are removed from the database
 *      directly, and her app, her grant, her token and her session rows are kept; a fourth bare name
 *      that no account holds gets an action, one gate is bound to the three actions by account name,
 *      and the records that the move and the start steps ran are removed (with 0085's on Postgres), so
 *      the next start meets the database as a deploy does.
 *   2. The start that carries the move and the start steps. The node starts. Erin's app is gone and
 *      its token is refused. The Security page holds ONE incident that names carol and dora with their
 *      counts (their ecosystem app and app grant among them) and their bindings, and the binding to
 *      the fourth name's action as one that names nothing, on a gate that now lets everything pass.
 *      The operator decides carol over REST (it is carol's: her app keeps acting, her grant stays) and
 *      dora over MCP (it was a previous holder's: her app, grant and token go), and the incident
 *      closes with the second.
 *   3. The next start: the rows are where the decisions put them, erin's grant, token and session
 *      rows are gone, the gate is bound to carol's action under her full identity, and there is still
 *      one incident.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-held-account-names
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-held-account-names
 * @version-history
 *   v1.2.0 — 2026-09-26 — The start step for credentials: a deleted account's app grant, access token
 *     and session rows are gone after the start, a held grant is listed with its name, and "previous"
 *     deletes it.
 *   v1.1.0 — 2026-09-26 — The start step for the cortexes and ecosystem apps of deleted accounts: a
 *     deleted account's app token is refused after the start, a held app is listed with its name, and
 *     each decision keeps or removes the app.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { createStorage } from '../src/storage/storage-factory.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_HELD_ACCOUNT_NAMES_PORT ?? '40452';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const HELD_RECORD = 'migration:0086:held';
const INSTALLS_RECORD = 'migration:installs:held';
const CREDENTIALS_RECORD = 'migration:credentials:held';

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

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-held-'));
const DB_PATH = join(dbDir, 'held.db');
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
    return waitForServer(child, BASE, { label: 'the held-account-names node' });
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
        await new Promise(r => setTimeout(r, 150));
    }
}

type AnyStorage = Awaited<ReturnType<typeof createStorage>>;

/** The node's own data while it is stopped. */
async function withStorage<T>(fn: (s: AnyStorage) => Promise<T>): Promise<T> {
    const storage = PG_URL
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL })
        : await createStorage({ provider: 'sqlite', sqlitePath: DB_PATH });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

/** The session rows stored under an account name, revoked ones included. */
async function sessionRows(s: AnyStorage, owner: string): Promise<number> {
    const [row] = await sql(s, 'SELECT COUNT(*) AS n FROM sessions WHERE owner = ?', 'SELECT COUNT(*) AS n FROM "Session" WHERE "owner" = $1', [owner]);
    return Number(row?.n ?? 0);
}

/** One statement against the stopped node's database, in the dialect of its backend. */
async function sql(s: AnyStorage, sqlite: string, postgres: string, params: unknown[]): Promise<any[]> {
    if (PG_URL) return (await (s as unknown as { pool: { query(q: string, p: unknown[]): Promise<{ rows: any[] }> } }).pool.query(postgres, params)).rows;
    const stmt = (s as unknown as { db: { prepare(q: string): { all(...p: unknown[]): any[]; run(...p: unknown[]): unknown; reader: boolean } } }).db.prepare(sqlite);
    if (stmt.reader) return stmt.all(...params);
    stmt.run(...params);
    return [];
}

// ── people ──

interface Owner { name: string; key: string; token: string }

async function ownerToken(name: string, key: string): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function register(name: string): Promise<Owner> {
    const r = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(r.status === 201, `register ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
    const o = { name, key: r.body.data.private_key as string, token: '' };
    o.token = await ownerToken(name, o.key);
    return o;
}

interface App { geai: string; token: string }

/** An ecosystem app connected to an account: hello, the owner's approval, the app's token. */
async function connectApp(o: Owner, app: string): Promise<App> {
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({ owner: o.name, app, display_name: 'Held names test app', public_key: Buffer.from(`key-of-${o.name}`).toString('base64'), scopes: ['memory:read', 'memory:write'] }),
    });
    assert(hello.status === 200, `hello ${o.name}: ${hello.status} ${JSON.stringify(hello.body?.error)}`);
    const ok = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
        method: 'POST', headers: auth(o.token), body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
    });
    assert(ok.status === 200 && ok.body.data?.status === 'approved', `approve ${o.name}: ${ok.status} ${JSON.stringify(ok.body)}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(tok.status === 200 && typeof tok.body.access_token === 'string', `app token ${o.name}: ${tok.status} ${JSON.stringify(tok.body)}`);
    return { geai: ok.body.data.geai as string, token: tok.body.access_token as string };
}

/** What an app's token gets when it reads its own records: 200 while it is a credential, 401 when not. */
const appReads = async (a: App): Promise<number> => (await json('/v1/memory', { headers: auth(a.token) })).status;

// ── the chat path: an MCP session of the operator's agent ──

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* a partial frame */ } }
    }
    return out;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    let sessionId = '';
    const rpc = async (method: string, params: Record<string, unknown>, id?: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (id === undefined) return {};
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'held-names-e2e', version: '1.0.0' } }, 1);
    await rpc('notifications/initialized', {});
    const body = await rpc('tools/call', { name, arguments: args }, 2) as any;
    const text = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? body);
    return { ok: body.error === undefined && body.result?.isError !== true, text };
}

/** The incidents of this kind that name `name`, as the operator reads them. */
async function heldIncidents(token: string, name: string): Promise<any[]> {
    const r = await json('/v1/admin/security/incidents', { headers: auth(token) });
    assert(r.status === 200, `incidents ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.incidents as any[]).filter(i => Array.isArray(i.names) && i.names.some((n: any) => n.name === name));
}

(async () => {
    console.log('\n=== The move to the full identity, on data it cannot place ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);

    let server = await startServer();
    const stamp = Date.now() % 1_000_000;
    const carolName = `hnc${stamp}`, doraName = `hnd${stamp}`, erinName = `hne${stamp}`, ghost = `hng${stamp}`;
    const C_ACT = `hn-c-${stamp}`, D_ACT = `hn-d-${stamp}`, G_ACT = `hn-g-${stamp}`;
    const TC_C = `tc-hn-c-${stamp}`, TC_D = `tc-hn-d-${stamp}`;
    let op!: Owner, other!: Owner;
    let agentToken = '';
    let agentKey = '', agentGaii = '';
    const apps: Record<string, App> = {};

    console.log('Phase 1: the node, and the people on it');

    await test('1a. an operator, their agent with operator:admin, a second person, and carol, dora and erin', async () => {
        const reg = await json('/v1/admin/setup/register', {
            method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: `hnop${stamp}` }),
        });
        assert(reg.status === 200 && reg.body.owner?.roles?.includes('operator'), `operator ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
        op = { name: `hnop${stamp}`, key: reg.body.private_key, token: '' };
        op.token = await ownerToken(op.name, op.key);
        other = await register(`hnx${stamp}`);
        const agent = await json('/v1/agents', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ name: 'hnagent', owner: op.name, display_name: 'hnagent', capabilities: [], scopes: ['memory:read', 'operator:admin'] }),
        });
        assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body.error)}`);
        agentGaii = agent.body.data.agent.gaii;
        agentKey = agent.body.data.private_key;
    });

    await test('1b. carol, dora and erin each connect an ecosystem app, and each app\'s token reads', async () => {
        for (const who of [carolName, doraName, erinName]) {
            apps[who] = await connectApp(await register(who), 'hnhelper');
            const status = await appReads(apps[who]);
            assert(status === 200, `${who}'s app reads: ${status}`);
        }
    });

    await stopServer(server);

    // Rows from before 2026-09-26 sit under the bare account name. These are older than carol's and
    // dora's accounts, so they may be theirs or a previous holder's of the name.
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const opGhii = `${op.name}@${NODE_ID}`;
    await withStorage(async (s) => {
        for (const [id, provider] of [[C_ACT, carolName], [D_ACT, doraName], [G_ACT, ghost]]) {
            await s.createAction({
                id, providerGaii: provider, displayName: id, description: 'held-names e2e', inputSchema: {}, outputSchema: {},
                pricing: { baseMorsels: 0 }, tags: [], createdAt: old, updatedAt: old,
            });
        }
        const work = (trackingCode: string, actionId: string, providerGaii: string, status: string) => s.createWork({
            trackingCode, status, actionId, providerGaii, requesterGaii: opGhii, input: { text: 'held-names' },
            cost: { basePrice: 0, networkFee: 0, total: 0, inEscrow: 0 }, ttlExpiresAt: future, createdAt: old, updatedAt: old,
        });
        await work(TC_C, C_ACT, carolName, 'pending');
        await work(TC_D, D_ACT, doraName, 'delivered');
        for (const who of [carolName, doraName]) {
            await sql(s,
                'INSERT INTO wallet_transactions (id, gaii, type, amount, timestamp) VALUES (?, ?, ?, ?, ?)',
                'INSERT INTO "Transaction" ("txId", "gaii", "type", "amount", "timestamp") VALUES ($1, $2, $3, $4, $5)',
                [`tx-hn-${who}`, who, 'earned', 2, PG_URL ? new Date(old) : old]);
        }
        await s.setConfigValue('hooks.pre_work_request', JSON.stringify([`${C_ACT}#${carolName}`, `${D_ACT}#${doraName}`, `${G_ACT}#${ghost}`]));
        // Carol's and dora's apps are older than their accounts, as a previous holder's app would be.
        for (const who of [carolName, doraName]) {
            await sql(s, 'UPDATE ecosystem_apps SET createdAt = ? WHERE geai = ?',
                'UPDATE "EcosystemApp" SET "createdAt" = $1 WHERE "geai" = $2', [PG_URL ? new Date(old) : old, apps[who].geai]);
        }
        // An app grant older than her account for each of the three, and a personal access token for
        // dora and erin.
        for (const who of [carolName, doraName, erinName]) {
            await s.createAppGrant({
                grantId: `appgrant-hn-${who}`, app: `${who}/held.html`, appName: 'held', appOrigin: BASE, owner: who, gaii: `${who}@${NODE_ID}`,
                scopes: ['memory:read'], refreshTokenHash: `rt-hn-${who}`, createdAt: old, lastUsedAt: old, revoked: false,
            });
        }
        for (const who of [doraName, erinName]) {
            await s.createPat({
                id: randomUUID(), tokenHash: `pat-hn-${who}`, label: 'held-names e2e', owner: who, scopes: [], grantOwner: true,
                grantOperator: false, readOwnerData: false, gaii: `${who}@${NODE_ID}`, createdAt: old, expiresAt: null, lastUsedAt: null, revoked: false,
            });
        }
        // Erin's account and full identity are removed from the database directly; her ecosystem app,
        // her grant and token and her session rows are kept, for the start steps to find.
        await sql(s, 'DELETE FROM ghiis WHERE ownerName = ?', 'DELETE FROM "Ghii" WHERE "ownerName" = $1', [erinName]);
        await sql(s, 'DELETE FROM owners WHERE name = ?', 'DELETE FROM "Owner" WHERE "name" = $1', [erinName]);
        assert(await sessionRows(s, erinName) > 0, 'erin has no session rows for the start step to find');
        // The database as a deploy meets it: neither the move nor the start steps have run on it.
        await sql(s, 'DELETE FROM system_settings WHERE key IN (?, ?, ?, ?, ?)',
            'DELETE FROM "SystemSetting" WHERE "key" = ANY($1)',
            PG_URL
                ? [[HELD_RECORD, INSTALLS_RECORD, CREDENTIALS_RECORD]]
                : ['migration:0086_full_identity_on_evidence.sql', 'migration:0085_actions_work_full_identity.sql', HELD_RECORD, INSTALLS_RECORD, CREDENTIALS_RECORD]);
        if (PG_URL) {
            await sql(s, '', 'DELETE FROM "_kysely_migrations" WHERE name = ANY($1)',
                [['0085_actions_work_full_identity.sql', '0086_full_identity_on_evidence.sql']]);
        }
        await s.deleteMemory(`system@${NODE_ID}`, 'migrations.hook-bindings-full-identity');
    });

    console.log('\nPhase 2: the start that carries the move and the start step');
    server = await startServer();
    op.token = await ownerToken(op.name, op.key);
    other.token = await ownerToken(other.name, other.key);
    let incidentId = '';

    await test('2a. the node starts, and erin\'s app, a deleted account\'s, is gone: its token is refused', async () => {
        const status = await appReads(apps[erinName]);
        assert(status === 401, `the deleted account's app token after the start: expected 401, got ${status}`);
    });

    await test('2b. the Security page holds one incident naming carol and dora, each with her ecosystem app and app grant', async () => {
        const found = await heldIncidents(op.token, carolName);
        assert(found.length === 1, `expected one incident naming ${carolName}, got ${found.length}`);
        const i = found[0];
        incidentId = i.id;
        assert(i.status === 'open', `the incident is ${i.status}`);
        const c = i.names.find((n: any) => n.name === carolName), d = i.names.find((n: any) => n.name === doraName);
        assert(!!c && !!d, `names: ${JSON.stringify(i.names.map((n: any) => n.name))}`);
        for (const n of [c, d]) {
            assert(n.status === 'open' && n.actions === 1 && n.work === 1 && n.own_lines === 1 && n.ecosystem_apps === 1 && n.cortexes === 0
                && n.app_grants === 1, `${n.name}: ${JSON.stringify(n)}`);
        }
        assert(c.access_tokens === 0 && d.access_tokens === 1, `the access tokens: carol ${c.access_tokens}, dora ${d.access_tokens}`);
        assert(!i.names.some((n: any) => n.name === erinName), 'a name no account holds is listed as a name to decide');
        assert(await appReads(apps[carolName]) === 200 && await appReads(apps[doraName]) === 200, 'a held app stopped before the operator decided');
        assert(c.holder_ghii === `${carolName}@${NODE_ID}`, `carol's holder: ${c.holder_ghii}`);
        // Postgres keeps a stored record's keys in its own order, so a binding is compared field by field.
        const bindings = (c.bindings as any[]).map(b => `${b.hook}|${b.ref}|${b.gate}`);
        assert(JSON.stringify(bindings) === JSON.stringify([`pre_work_request|${C_ACT}#${carolName}|true`]),
            `carol's bindings: ${JSON.stringify(c.bindings)}`);
        const left = (i.bindings_left ?? []) as any[];
        assert(left.some(b => b.hook === 'pre_work_request' && b.ref === `${G_ACT}#${ghost}` && b.gate === true),
            `the binding to the deleted account's action is not listed as a gate that lets everything pass: ${JSON.stringify(left)}`);
        assert(!i.names.some((n: any) => n.name === ghost), 'a name no account holds is listed as a name to decide');
    });

    await test('2c. the overview counts it open, and a non-operator is refused at its endpoint', async () => {
        const ov = await json('/v1/admin/security/overview', { headers: auth(op.token) });
        assert(ov.status === 200 && ov.body.data.incidents.open >= 1, `open count: ${JSON.stringify(ov.body.data?.incidents?.open)}`);
        const r = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ name: carolName, resolution: 'holder' }),
        });
        assert(r.status === 403, `a non-operator deciding a name: expected 403, got ${r.status}`);
        const anon = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', body: JSON.stringify({ name: carolName, resolution: 'holder' }),
        });
        assert(anon.status === 401, `nobody deciding a name: expected 401, got ${anon.status}`);
    });

    await test('2d. the incident cannot be closed or deleted while a name is undecided, and a bad decision is refused', async () => {
        const plain = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, { method: 'POST', headers: auth(op.token) });
        assert(plain.status === 409 && plain.body.error?.code === 'CONFLICT', `closing it: ${plain.status} ${JSON.stringify(plain.body.error)}`);
        const del = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}`, { method: 'DELETE', headers: auth(op.token) });
        assert(del.status === 409, `deleting it: expected 409, got ${del.status}`);
        const bad = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ name: carolName, resolution: 'both' }),
        });
        assert(bad.status === 400, `an unknown decision: expected 400, got ${bad.status}`);
        const unknown = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ name: `nosuch${stamp}`, resolution: 'holder' }),
        });
        assert(unknown.status === 404, `a name the incident does not list: expected 404, got ${unknown.status}`);
    });

    await test('2e. over REST: carol\'s rows are hers, the gate follows her action, and her app keeps acting', async () => {
        const r = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ name: carolName, resolution: 'holder' }),
        });
        assert(r.status === 200, `deciding carol: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.resolution === 'holder' && r.body.data.incident_status === 'open', `answer: ${JSON.stringify(r.body.data)}`);
        assert(r.body.data.done?.actions_moved === 1 && r.body.data.done?.work_moved === 1 && r.body.data.done?.own_lines_moved === 1
            && r.body.data.done?.ecosystem_apps_deleted === 0 && r.body.data.done?.app_grants_deleted === 0,
            `what it did: ${JSON.stringify(r.body.data.done)}`);
        const status = await appReads(apps[carolName]);
        assert(status === 200, `carol's app after "holder": expected 200, got ${status}`);
        const hooks = await json('/v1/admin/hooks', { headers: auth(op.token) });
        assert(hooks.status === 200, `hooks ${hooks.status}`);
        assert(JSON.stringify(hooks.body.data).includes(`${C_ACT}#${carolName}@${NODE_ID}`), 'the gate is not bound to carol\'s action under her full identity');
        const again = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ name: carolName, resolution: 'previous' }),
        });
        assert(again.status === 409, `deciding carol again the other way: expected 409, got ${again.status}`);
    });

    await test('2f. over MCP: dora\'s rows were a previous holder\'s, her app goes, and the incident closes with her', async () => {
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await signMsg(agentKey, agentGaii + ts) }),
        });
        assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
        agentToken = tok.body.data.token;
        const refused = await mcpCall(agentToken, 'aimeat_admin_incident_resolve', { id: incidentId, name: doraName, resolution: 'nobody' });
        assert(!refused.ok && refused.text.includes('INVALID_INPUT'), `an unknown decision over MCP: ${refused.text.slice(0, 200)}`);
        const r = await mcpCall(agentToken, 'aimeat_admin_incident_resolve', { id: incidentId, name: doraName, resolution: 'previous' });
        assert(r.ok, `deciding dora over MCP: ${r.text.slice(0, 300)}`);
        const answer = JSON.parse(r.text);
        assert(answer.resolution === 'previous' && answer.incident_status === 'resolved', `answer: ${r.text.slice(0, 300)}`);
        assert(answer.done?.actions_deleted === 1 && answer.done?.own_lines_deleted === 1 && answer.done?.ecosystem_apps_deleted === 1
            && answer.done?.app_grants_deleted === 1 && answer.done?.access_tokens_deleted === 1,
            `what it did: ${JSON.stringify(answer.done)}`);
        const status = await appReads(apps[doraName]);
        assert(status === 401, `dora's app after "previous": expected 401, got ${status}`);
        const [i] = await heldIncidents(op.token, carolName);
        assert(i.status === 'resolved' && typeof i.resolvedAt === 'string', `the incident: ${i.status}`);
        assert(JSON.stringify(i.names.map((n: any) => n.status)) === JSON.stringify(['holder', 'previous']), `statuses: ${JSON.stringify(i.names.map((n: any) => n.status))}`);
    });

    await stopServer(server);

    console.log('\nPhase 3: the rows as the decisions left them, and the next start');
    await test('3a. carol\'s rows are under her full identity, dora\'s are settled, nothing is left under either bare name, and only carol\'s app is left', async () => {
        await withStorage(async (s) => {
            const cGhii = `${carolName}@${NODE_ID}`;
            assert((await s.getAction(C_ACT, cGhii))?.id === C_ACT, 'carol\'s action is not under her full identity');
            assert((await s.getWork(TC_C))?.providerGaii === cGhii, 'carol\'s work is not under her full identity');
            assert((await s.listActionsByProvider(doraName)).length === 0, 'dora\'s action survived');
            const d = await s.getWork(TC_D);
            assert(d?.status === 'delivered' && /^erased:[0-9a-f]{24}$/.test(d.providerGaii), `dora's finished work: ${d?.status} ${d?.providerGaii}`);
            const own = await sql(s, 'SELECT gaii FROM wallet_transactions WHERE id IN (?, ?)',
                'SELECT "gaii" FROM "Transaction" WHERE "txId" = ANY($1)', PG_URL ? [[`tx-hn-${carolName}`, `tx-hn-${doraName}`]] : [`tx-hn-${carolName}`, `tx-hn-${doraName}`]);
            assert(JSON.stringify(own.map((r: any) => r.gaii)) === JSON.stringify([cGhii]), `the own lines: ${JSON.stringify(own)}`);
            assert(!!(await s.getEcosystemApp(apps[carolName].geai)), 'carol\'s app is gone');
            assert(!(await s.getEcosystemApp(apps[doraName].geai)), 'dora\'s app survived "previous"');
            assert(!(await s.getEcosystemApp(apps[erinName].geai)), 'the deleted account\'s app survived the start');
        });
    });

    await test('3b. the deleted account\'s grant, token and session rows are gone, carol\'s grant stays, dora\'s grant and token are gone', async () => {
        await withStorage(async (s) => {
            const erin = {
                grant: !!(await s.getAppGrant(`appgrant-hn-${erinName}`)), token: !!(await s.getPatByHash(`pat-hn-${erinName}`)),
                sessions: await sessionRows(s, erinName),
            };
            assert(JSON.stringify(erin) === JSON.stringify({ grant: false, token: false, sessions: 0 }), `what the deleted account was issued, after the start: ${JSON.stringify(erin)}`);
            assert(!!(await s.getAppGrant(`appgrant-hn-${carolName}`)), 'carol\'s grant is gone after "holder"');
            const dora = { grant: !!(await s.getAppGrant(`appgrant-hn-${doraName}`)), token: !!(await s.getPatByHash(`pat-hn-${doraName}`)) };
            assert(!dora.grant && !dora.token, `dora's grant and token after "previous": ${JSON.stringify(dora)}`);
        });
    });

    server = await startServer();
    op.token = await ownerToken(op.name, op.key);
    await test('3c. the next start opens no second incident', async () => {
        const found = await heldIncidents(op.token, carolName);
        assert(found.length === 1 && found[0].status === 'resolved', `incidents naming carol: ${found.length}`);
    });
    await stopServer(server);
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(async (err) => {
    console.error('held-account-names: the suite stopped:', err);
    process.exit(1);
});
