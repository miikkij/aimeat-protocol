/**
 * @file test/e2e-classification-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the default audience caps of the classifications (plan doc-mvdipuyqraas, L5.1,
 *   L5.2; decisions 10.1 and 10.3): a new node takes them, a node that ran before is offered them on
 *   the Security page and takes each only when the operator approves it, and approving one changes no
 *   content's level.
 *
 *   WHY IT OWNS ITS NODE. The node decides at start, once, whether it is new: no stored node policy and
 *   no account. So the honest test is one database started three times:
 *   1. Fresh. The default labels carry their caps (Internal signed-in, Confidential and Highly
 *      confidential organism, Public none); with classification on, an unlabelled record (Internal by
 *      default) is refused public; no offer is opened.
 *   2. Upgraded. Between the starts the suite does to the database what a node that ran before this
 *      build has: a stored node policy whose labels carry no `maxAudience`, and no record of the start
 *      step (the step's record is deleted, the policy written as a stored policy of a pre-cap node is).
 *      The node keeps its labels as they are, alice can still make a record public, and the Security
 *      page holds one `classification_default_caps` incident offering three caps. A member who is not
 *      the operator is refused (403); closing the incident undecided is refused (409); the operator's
 *      agent keeps one cap over MCP, the operator applies two over REST, and the incident closes. The
 *      caps are in the policy, alice's public record is still public and readable by anyone, she got
 *      no notification of a lowering, and a new public write of an unlabelled record is refused.
 *   3. Restarted. No second incident; the decisions stand.
 *
 *   It runs its own node on the run's backend (test/helpers/own-node-db.ts), on port 40492.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-classification-defaults
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-classification-defaults
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L5.1, L5.2).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, ownerToken, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { DEFAULT_LABELS } from '../src/services/classification/defaults.js';

const PORT = 40492;
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = Date.now().toString(36).slice(-6);
const NODE_ID = `aimeat-test-001-caps${STAMP}`;
const SYSTEM = `system@${NODE_ID}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 400);

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
/** One request. `method` is always written out by the caller, so a refusal test names what it refuses. */
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

const db = await ownNodeDb(`caps-${PORT}`);
let log = '';
let node: ChildProcess | null = null;

function nodeEnv(): NodeJS.ProcessEnv {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(PORT),
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_ADMIN_PASSWORD: `Caps-Admin-${STAMP}-Pw!`,
        AIMEAT_LOG_LEVEL: 'info',
        AIMEAT_SMTP_HOST: '',
        AIMEAT_CLASSIFICATION: 'all',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    });
    return env as NodeJS.ProcessEnv;
}

async function startNode(): Promise<void> {
    log = '';
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: nodeEnv(), stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    node.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
    node.stderr?.on('data', (d: Buffer) => { log += d.toString(); });
    await waitForServer(node, BASE, { label: 'the default-caps node' });
}

async function stopNode(): Promise<void> {
    const running = (n: ChildProcess) => n.exitCode === null && n.signalCode === null;
    if (!node || !running(node)) return;
    const exited = once(node, 'exit');
    node.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
    if (running(node)) { node.kill('SIGKILL'); await exited; }
    // The port is free again before the next start.
    for (let i = 0; i < 100; i++) {
        try { await fetch(`${BASE}/v1/build`, { signal: AbortSignal.timeout(1000) }); } catch { return; }
        await new Promise(r => setTimeout(r, 150));
    }
}

/** The node's own data while it is stopped. */
async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const storage = db.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: db.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: db.sqlitePath });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

/** The effective cap of each default label in the node policy, as the operator reads it. */
async function capsOf(token: string): Promise<Record<string, string | null>> {
    const r = await call('GET', '/v1/classification/policy?level=node', token);
    assert(r.status === 200, `node policy: ${r.status} ${short(r.body?.error)}`);
    return Object.fromEntries((r.body.data.effective.labels as Body[]).map(l => [l.id, l.maxAudience ?? null]));
}

async function capsIncidents(token: string): Promise<Body[]> {
    const r = await call('GET', '/v1/admin/security/incidents', token);
    assert(r.status === 200, `incident list: ${r.status} ${short(r.body)}`);
    return (r.body.data.incidents as Body[]).filter(i => i.type === 'classification_default_caps');
}

const write = (token: string, key: string, visibility: string) => call('POST', '/v1/memory', token, { key, value: { text: key }, visibility });
const refusedByCap = (r: { status: number; body: Body }) => r.status === 409 && r.body?.error?.code === 'LABEL_CAPS_AUDIENCE';

console.log('\n=== The default audience caps: a new node takes them, a running node is offered them ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
const publicKey = `caps.before.${STAMP}`;

try {
    // ── 1. A fresh node ──
    await startNode();
    op = await registerOwner(BASE, `capsop${STAMP}`);
    alice = await registerOwner(BASE, `capsalice${STAMP}`);

    await test('NEW NODE: the default labels carry the caps of decision 10.1', async () => {
        const caps = await capsOf(op.token);
        assert(caps.julkinen === null && caps.sisainen === 'signed-in' && caps.luottamuksellinen === 'organism' && caps['erittain-luottamuksellinen'] === 'organism',
            `caps: ${short(caps)}`);
    });

    await test('NEW NODE: an unlabelled record (Internal by default) is refused public (409), and stays unstored', async () => {
        const key = `caps.new.${STAMP}`;
        const r = await write(alice.token, key, 'public');
        assert(refusedByCap(r), `public write: ${r.status} ${short(r.body?.error ?? r.body?.data)}`);
        const read = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(key)}`, alice.token);
        assert(read.status === 404, `the record was stored: ${read.status}`);
        const members = await write(alice.token, key, 'members');
        assert(members.status === 201, `POSITIVE CONTROL, signed-in is within the cap: ${members.status} ${short(members.body?.error)}`);
    });

    await test('NEW NODE: no offer is opened on the Security page', async () => {
        const list = await capsIncidents(op.token);
        assert(list.length === 0, `incidents: ${short(list)}`);
    });

    await stopNode();

    // ── 2. The same database as a node that ran before this build ──
    await withStorage(async (s) => {
        // What a node that stored its policy before audience caps has: labels with no maxAudience, and
        // no record of the start step (a pre-cap node never wrote one).
        await s.deleteMemory(SYSTEM, 'classification.default-caps');
        const at = new Date().toISOString();
        const labels = DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name } }));
        assert(labels.every(l => !('maxAudience' in l)), 'the pre-cap labels carry a maxAudience');
        await s.setMemory({
            key: 'classification.policy.node', ownerGaii: SYSTEM,
            value: { policy: { labels, defaultLabel: 'sisainen' }, history: [], proposal: null },
            visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
        });
    });
    await startNode();
    op = { ...op, token: await ownerToken(BASE, op.name) };
    alice = { ...alice, token: await ownerToken(BASE, alice.name) };

    let incidentId = '';
    await test('RUNNING NODE: the labels keep no cap, and alice can still make an unlabelled record public', async () => {
        const caps = await capsOf(op.token);
        assert(caps.sisainen === null && caps.luottamuksellinen === null && caps['erittain-luottamuksellinen'] === null, `caps: ${short(caps)}`);
        const w = await write(alice.token, publicKey, 'public');
        assert(w.status === 201 && w.body.data.visibility === 'public', `public write: ${w.status} ${short(w.body?.error ?? w.body?.data?.visibility)}`);
    });

    await test('RUNNING NODE: one Security page incident offers the three caps, each open', async () => {
        const list = await capsIncidents(op.token);
        assert(list.length === 1 && list[0].status === 'open' && list[0].code === 'DEFAULT_CAPS_OFFERED', `incidents: ${short(list)}`);
        incidentId = list[0].id as string;
        const caps = Object.fromEntries((list[0].caps as Body[]).map(c => [c.label, `${c.max_audience}/${c.status}`]));
        assert(caps.sisainen === 'signed-in/open' && caps.luottamuksellinen === 'organism/open' && caps['erittain-luottamuksellinen'] === 'organism/open' && !('julkinen' in caps),
            `offered: ${short(caps)}`);
        assert(String(list[0].detail).includes('Nothing changes until you decide'), `detail: ${list[0].detail}`);
    });

    await test('DENIED: a member who is not the operator cannot decide a cap (403) or read the incidents', async () => {
        const r = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, alice.token, { name: 'sisainen', resolution: 'apply' });
        assert(r.status === 403, `alice decided a cap: ${r.status} ${short(r.body)}`);
        const read = await call('GET', '/v1/admin/security/incidents', alice.token);
        assert(read.status === 403, `alice read the incidents: ${read.status}`);
        const anon = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, undefined, { name: 'sisainen', resolution: 'apply' });
        assert(anon.status === 401, `no credential decided a cap: ${anon.status}`);
        assert((await capsOf(op.token)).sisainen === null, 'the cap was applied by a refused call');
    });

    await test('CONFLICT: closing the incident before every cap is decided is refused (409), naming how to decide', async () => {
        const r = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, op.token);
        assert(r.status === 409 && String(r.body?.error?.message).includes('"apply" or "keep"'), `close: ${r.status} ${short(r.body?.error)}`);
        const bad = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, op.token, { name: 'sisainen', resolution: 'holder' });
        assert(bad.status === 400 && bad.body?.error?.code === 'INVALID_INPUT', `a held-name resolution on a cap: ${bad.status} ${short(bad.body?.error)}`);
    });

    await test('MCP: the operator\'s agent keeps Confidential without a cap (aimeat_admin_incident_resolve)', async () => {
        const agent = await makeAgent(BASE, op, ['operator:admin'], `capsbot${STAMP}`);
        const session = await openSession(BASE, agent.token, 'default caps');
        const r = await callTool(session, 'aimeat_admin_incident_resolve', { id: incidentId, name: 'luottamuksellinen', resolution: 'keep' });
        assert(!r.isError && r.data?.outcome === 'kept' && r.data?.incident_status === 'open', `MCP keep: ${r.text.slice(0, 300)}`);
    });

    await test('REST: the operator applies Internal and Highly confidential; the incident closes with the last', async () => {
        const one = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, op.token, { name: 'sisainen', resolution: 'apply' });
        assert(one.status === 200 && one.body.data.outcome === 'applied' && one.body.data.incident_status === 'open', `apply Internal: ${one.status} ${short(one.body?.error ?? one.body?.data)}`);
        const again = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, op.token, { name: 'sisainen', resolution: 'keep' });
        assert(again.status === 409, `deciding Internal the other way: ${again.status} ${short(again.body?.error)}`);
        const two = await call('POST', `/v1/admin/security/incidents/${incidentId}/resolve`, op.token, { name: 'erittain-luottamuksellinen', resolution: 'apply' });
        assert(two.status === 200 && two.body.data.outcome === 'applied' && two.body.data.incident_status === 'resolved', `apply Highly confidential: ${two.status} ${short(two.body?.error ?? two.body?.data)}`);
        const caps = await capsOf(op.token);
        assert(caps.sisainen === 'signed-in' && caps.luottamuksellinen === null && caps['erittain-luottamuksellinen'] === 'organism', `caps after: ${short(caps)}`);
        const policy = await call('GET', '/v1/classification/policy?level=node', op.token);
        const history = (policy.body?.data?.history as Body[] | undefined) ?? [];
        assert(history.some(h => String(h.humanSaid).includes('sisainen') && h.by), `the policy history: ${short(history)}`);
    });

    await test('NO CONTENT CHANGED (decision 10.3): alice\'s public record stays public and readable by anyone, with no lowering notice', async () => {
        const read = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(publicKey)}`, alice.token);
        assert(read.status === 200 && read.body.data.visibility === 'public', `the record: ${read.status} ${short(read.body?.data?.visibility ?? read.body?.error)}`);
        const anon = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(publicKey)}`);
        assert(anon.status === 200, `a stranger reads it: ${anon.status}`);
        const n = await call('GET', '/v1/notifications', alice.token);
        const lowered = ((n.body?.data?.notifications as Body[] | undefined) ?? []).filter(x => x.type === 'classification_audience_lowered');
        assert(lowered.length === 0, `alice was told of a lowering: ${short(lowered)}`);
    });

    await test('THE CAP HOLDS NOW: a new public write of an unlabelled record is refused (409)', async () => {
        const r = await write(alice.token, `caps.after.${STAMP}`, 'public');
        assert(refusedByCap(r), `public write: ${r.status} ${short(r.body?.error ?? r.body?.data)}`);
        const edit = await call('PATCH', `/v1/memory/${encodeURIComponent(publicKey)}`, alice.token, { patch: { more: 1 } });
        assert(edit.status === 200, `POSITIVE CONTROL, the public record is still edited at its level: ${edit.status} ${short(edit.body?.error)}`);
    });

    await stopNode();

    // ── 3. A restart ──
    await startNode();
    op = { ...op, token: await ownerToken(BASE, op.name) };

    await test('RESTART: no second offer, and the decisions stand', async () => {
        const list = await capsIncidents(op.token);
        assert(list.length === 1 && list[0].status === 'resolved', `incidents: ${short(list)}`);
        const caps = await capsOf(op.token);
        assert(caps.sisainen === 'signed-in' && caps.luottamuksellinen === null && caps['erittain-luottamuksellinen'] === 'organism', `caps: ${short(caps)}`);
    });
} finally {
    await stopNode();
}

console.log(`\nDefault caps E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) {
    if (failed > 0) console.log(log.split(/\r?\n/).slice(-30).join('\n'));
    process.exit(1);
}
