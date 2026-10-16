/**
 * @file test/e2e-scope-ceiling.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's scope ceiling refuses every grant above it with 400 INVALID_SCOPES,
 *   and lets a grant inside it through, on each route that enforces it.
 *     Phase A, on the runner's node (both backends): the operator lowers scopes.max_agent_scopes
 *       through PUT /v1/admin/config, the way the admin Config tab does it, and then:
 *       POST /v1/agents/device-authorize, POST /v1/agents/verify, POST /v1/agents,
 *       PATCH /v1/agents/:name/scopes and POST /v1/access/tokens (a scoped token) refuse `*` and a
 *       word outside the ceiling, and accept a word the ceiling holds by its domain wildcard or
 *       exactly. A refused request leaves nothing behind: no agent, and the device request is still
 *       pending. The ceiling goes back to `*` in a finally block.
 *     Phase B, on a node this suite starts with AIMEAT_MAX_AGENT_SCOPES and AIMEAT_MAX_ECO_SCOPES in
 *       its environment (the ecosystem ceiling has no admin setting): the agent ceiling read from
 *       the environment refuses at POST /v1/agents, and POST /v1/ecosystem-apps/:userCode/approve
 *       refuses an approval above the ecosystem ceiling, both when the owner names the scopes and
 *       when the approval falls back to what the app asked for at hello.
 *
 *   WHY. exceedsCeiling (utils/scope-coverage.ts) is the one function behind all of these, and no
 *   test at any level ran it with a ceiling other than `*`, where it answers on its first line. If
 *   the function or one of its call sites stopped refusing, an operator who capped agent permissions
 *   would get a node that grants everything, and every suite would stay green. The function itself
 *   and the agent-profile path (normaliseAgentProfile) are covered in test/unit/scope-ceiling.test.ts.
 *
 *   Phase B starts its node on SQLite whatever backend the runner uses: what it tests is the
 *   environment variable and the ecosystem route, not storage.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-scope-ceiling
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03a-01).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { suitePort } from './helpers/free-port.js';
import { generateKeyPair } from '../src/auth/keypair.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const CEILING = ['memory:*', 'catalogue:read'];

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function call(base: string, path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const isCeilingRefusal = (r: { status: number; body: any }) => r.status === 400 && r.body?.error?.code === 'INVALID_SCOPES';

console.log('\n=== SCOPE CEILING E2E (the operator caps what an agent, a token or an app can be granted) ===\n');

// ─── Phase A ───
console.log('Phase A — scopes.max_agent_scopes set at runtime on the runner\'s node');

const api = (path: string, opts: RequestInit & { token?: string } = {}) => call(BASE, path, opts);
let operator: RegisteredOwner;
let owner: RegisteredOwner;

await test('The operator and a plain owner', async () => {
    operator = await registerOwner(BASE, `scop${stamp}`);
    owner = await registerOwner(BASE, `scow${stamp}`);
    assert(owner.roles.includes('operator') === false, `the second owner is a plain owner: ${JSON.stringify(owner.roles)}`);
});

const setCeiling = (value: string[]) => api('/v1/admin/config', {
    method: 'PUT', token: operator.token, body: JSON.stringify({ changes: [{ path: 'scopes.max_agent_scopes', value }] }),
});

const capped = await setCeiling(CEILING);
try {
    await test(`The operator sets the ceiling to ${CEILING.join(', ')}`, async () => {
        assert(capped.status === 200, `PUT /v1/admin/config: ${capped.status} ${short(capped.body)}`);
    });

    await test('POST /v1/agents refuses * and a word outside the ceiling, and creates nothing', async () => {
        for (const scopes of [['*'], ['storage:write'], ['memory:read', 'agent:write']]) {
            const r = await api('/v1/agents', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `over${stamp}`, owner: owner.name, scopes }) });
            assert(isCeilingRefusal(r), `${JSON.stringify(scopes)}: ${r.status} ${short(r.body)}`);
        }
        const list = await api('/v1/agents', { token: owner.token });
        assert(!JSON.stringify(list.body).includes(`over${stamp}`), `a refused agent was created: ${short(list.body)}`);
    });

    await test('POST /v1/agents accepts words inside the ceiling (by domain wildcard and exactly)', async () => {
        const r = await api('/v1/agents', {
            method: 'POST', token: owner.token,
            body: JSON.stringify({ name: `inside${stamp}`, owner: owner.name, scopes: ['memory:read', 'memory:write', 'catalogue:read'] }),
        });
        assert(r.status === 201, `inside the ceiling: ${r.status} ${short(r.body)}`);
    });

    await test('PATCH /v1/agents/:name/scopes refuses a word outside the ceiling and accepts one inside', async () => {
        const over = await api(`/v1/agents/inside${stamp}/scopes`, { method: 'PATCH', token: owner.token, body: JSON.stringify({ scopes: ['memory:read', 'storage:read'] }) });
        assert(isCeilingRefusal(over), `outside: ${over.status} ${short(over.body)}`);
        const star = await api(`/v1/agents/inside${stamp}/scopes`, { method: 'PATCH', token: owner.token, body: JSON.stringify({ scopes: ['*'] }) });
        assert(isCeilingRefusal(star), `*: ${star.status} ${short(star.body)}`);
        const ok = await api(`/v1/agents/inside${stamp}/scopes`, { method: 'PATCH', token: owner.token, body: JSON.stringify({ scopes: ['memory:delete'] }) });
        assert(ok.status === 200, `inside: ${ok.status} ${short(ok.body)}`);
    });

    await test('POST /v1/access/tokens refuses a scoped token above the ceiling and issues one inside it', async () => {
        const over = await api('/v1/access/tokens', { method: 'POST', token: owner.token, body: JSON.stringify({ label: 'over', scopes: ['*'] }) });
        assert(isCeilingRefusal(over), `*: ${over.status} ${short(over.body)}`);
        const outside = await api('/v1/access/tokens', { method: 'POST', token: owner.token, body: JSON.stringify({ label: 'outside', scopes: ['work:request'] }) });
        assert(isCeilingRefusal(outside), `outside: ${outside.status} ${short(outside.body)}`);
        const ok = await api('/v1/access/tokens', { method: 'POST', token: owner.token, body: JSON.stringify({ label: 'inside', scopes: ['memory:read'] }) });
        assert(ok.status === 201 && JSON.stringify(ok.body.data?.scopes) === '["memory:read"]', `inside: ${ok.status} ${short(ok.body)}`);
    });

    await test('POST /v1/agents/device-authorize refuses an over-broad request before it is stored', async () => {
        const r = await api('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `dev${stamp}`, owner: owner.name, scopes: ['*'] }) });
        assert(isCeilingRefusal(r), `device-authorize *: ${r.status} ${short(r.body)}`);
        assert(!r.body.data?.user_code, `a request was stored: ${short(r.body)}`);
    });

    await test('POST /v1/agents/verify refuses an approval above the ceiling; the request stays pending and approves inside it', async () => {
        const auth = await api('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `dev${stamp}`, owner: owner.name, scopes: ['memory:read'] }) });
        assert(auth.status === 200 && auth.body.data?.status === 'pending', `device-authorize inside: ${auth.status} ${short(auth.body)}`);
        const userCode = auth.body.data.user_code as string;
        const over = await api('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read', 'storage:write'], owner_token: owner.token }) });
        assert(isCeilingRefusal(over), `verify above the ceiling: ${over.status} ${short(over.body)}`);
        const ok = await api('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read'], owner_token: owner.token }) });
        assert(ok.status === 200 && ok.body.data?.status === 'approved', `verify inside: ${ok.status} ${short(ok.body)}`);
    });
} finally {
    const back = await setCeiling(['*']);
    if (back.status !== 200) console.log(`  ⚠ could not restore the ceiling: ${back.status} ${short(back.body)}`);
}

await test('With the ceiling back at *, the same over-broad agent is created', async () => {
    const r = await api('/v1/agents', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `wide${stamp}`, owner: owner.name, scopes: ['storage:write'] }) });
    assert(r.status === 201, `after the restore: ${r.status} ${short(r.body)}`);
});

// ─── Phase B ───
console.log('\nPhase B — AIMEAT_MAX_AGENT_SCOPES and AIMEAT_MAX_ECO_SCOPES on a node of its own');

const PORT = String(suitePort(32400, BASE));
const NODE_BASE = `http://localhost:${PORT}`;
const DB_PATH = `test/.scope-ceiling-${PORT}-${Date.now()}.db`;
let node: ChildProcess | null = null;

async function startNode(): Promise<void> {
    node = spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', DB_PATH], {
        env: {
            ...process.env,
            AIMEAT_PORT: PORT, AIMEAT_BASE_URL: NODE_BASE,
            AIMEAT_MAX_AGENT_SCOPES: 'memory:*,catalogue:read', AIMEAT_MAX_ECO_SCOPES: 'memory:read',
            AIMEAT_ANONYMOUS: 'false', AIMEAT_EE_DISABLED: 'true', AIMEAT_APP_ORIGIN_ENABLED: 'false',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '5000',
            AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    node.stdout?.on('data', () => {}); node.stderr?.on('data', () => {});
    for (let i = 0; i < 150; i++) {
        try { const r = await fetch(`${NODE_BASE}/v1/spec`); if (r.ok) return; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`the node with a ceiling did not start on ${PORT}`);
}

try {
    const cap: { owner?: RegisteredOwner } = {};
    const capOwner = (): RegisteredOwner => {
        assert(cap.owner !== undefined, 'the node with a ceiling has no owner (its start failed above)');
        return cap.owner;
    };
    await test('A node starts with the two ceilings in its environment', async () => {
        await startNode();
        await registerOwner(NODE_BASE, `cbop${stamp}`);
        cap.owner = await registerOwner(NODE_BASE, `cbow${stamp}`);
        assert(cap.owner.roles.includes('operator') === false, `the second owner is a plain owner: ${JSON.stringify(cap.owner.roles)}`);
    });
    const nodeApi = (path: string, opts: RequestInit & { token?: string } = {}) => call(NODE_BASE, path, opts);

    await test('POST /v1/agents refuses * and storage:write under the environment ceiling, and accepts memory:read', async () => {
        const owner = capOwner();
        for (const scopes of [['*'], ['storage:write']]) {
            const r = await nodeApi('/v1/agents', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `envover${stamp}`, owner: owner.name, scopes }) });
            assert(isCeilingRefusal(r), `${JSON.stringify(scopes)}: ${r.status} ${short(r.body)}`);
        }
        const ok = await nodeApi('/v1/agents', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `envok${stamp}`, owner: owner.name, scopes: ['memory:read'] }) });
        assert(ok.status === 201, `inside: ${ok.status} ${short(ok.body)}`);
    });

    await test('Ecosystem approve refuses scopes above AIMEAT_MAX_ECO_SCOPES, named or asked for at hello, and approves inside it', async () => {
        const owner = capOwner();
        const keys = await generateKeyPair();
        const hello = await nodeApi('/v1/ecosystem-apps/hello', {
            method: 'POST',
            body: JSON.stringify({
                owner: owner.name, app: `capdesk${stamp}`, display_name: 'Capdesk', public_key: keys.publicKey,
                scopes: ['memory:read', 'memory:write'],
                data_areas: [{ area: 'memory', pattern: 'service.capdesk.*', rights: ['read'] }],
            }),
        });
        assert(hello.status === 200 && typeof hello.body.data?.user_code === 'string', `hello: ${hello.status} ${short(hello.body)}`);
        const userCode = hello.body.data.user_code as string;
        const approve = (scopes?: string[]) => nodeApi(`/v1/ecosystem-apps/${userCode}/approve`, {
            method: 'POST', token: owner.token, body: JSON.stringify({ action: 'approve', ...(scopes ? { scopes } : {}) }),
        });
        const asked = await approve();
        assert(isCeilingRefusal(asked), `approve what the app asked for (memory:write is above): ${asked.status} ${short(asked.body)}`);
        const star = await approve(['*']);
        assert(isCeilingRefusal(star), `approve *: ${star.status} ${short(star.body)}`);
        const ok = await approve(['memory:read']);
        assert(ok.status === 200 && ok.body.data?.status === 'approved', `approve inside: ${ok.status} ${short(ok.body)}`);
    });
} finally {
    node?.kill();
    await new Promise((r) => setTimeout(r, 1500));
    for (const suffix of ['', '-wal', '-shm']) {
        try { rmSync(DB_PATH + suffix, { force: true }); } catch { /* the file may not exist */ }
    }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
