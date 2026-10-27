/**
 * @file test/e2e-admin-restore-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/admin/restore stays the operator's restore and becomes visible to the people
 *   it writes into (secaudit2026oct26, admin-restore.ts:restoreBackup:raw-cross-account-writes-without-guard-or-trail):
 *     - the operator in person restores an unmodified `aimeat backup` answer as before: the same
 *       counts, existing records replaced, an agent row restored with the clearance it carries;
 *     - each person whose records or agents a restore wrote reads one line in their account feed
 *       that names the operator and the counts, whoever of the operator restored it;
 *     - the operator's agent holding operator:admin restores as before, and an agent it creates in
 *       another person's account gets no looser a clearance than the restoring agent's own, as an
 *       agent an agent approves does (the backup export already reads through that clearance).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-restore-trail
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { generateKeyPair } from '../src/auth/keypair.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

console.log('\n=== POST /v1/admin/restore: the operator trail and the clearance bound (secaudit2026oct26) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
let bot!: McpAgent, opAgent!: McpAgent;
let nodeId = '';
const KEY = `rst.note.${stamp}`;

const restoreLines = async (token: string): Promise<Body[]> => {
    const r = await call('GET', '/v1/account/events?limit=200', token);
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.events as Body[]).filter(e => e.kind === 'operator_acted' && e.data?.area === 'backup' && e.data?.action === 'restore');
};
const clearanceOf = async (name: string): Promise<string | null | undefined> => {
    const r = await call('GET', '/v1/agents', alice.token);
    assert(r.status === 200, `agents list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.agents as Body[]).find(a => a.name === name)?.clearance;
};
/** An agent row as a backup file carries it, for an agent of alice's that this node does not have yet. */
async function agentRow(name: string): Promise<Body> {
    const pub = (await generateKeyPair()).publicKey;
    const now = new Date().toISOString();
    return {
        name, owner: alice.name, gaii: `${name}#${alice.name}@${nodeId}`, publicKey: pub, identityVersion: 2,
        defaultScopes: ['memory:read'], capabilities: [], trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
    };
}

await test('Setup: classification on; alice\'s agent keeps a record; the operator\'s agent has operator:admin and Internal clearance', async () => {
    op = await registerOwner(BASE, `rstop${stamp}`);
    alice = await registerOwner(BASE, `rstalice${stamp}`);
    nodeId = op.ghii.split('@')[1] ?? '';
    const on = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'all' }] });
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    bot = await makeAgent(BASE, alice, ['*'], `rstbot${stamp % 100000}`);
    const w = await call('POST', '/v1/memory', bot.token, { key: KEY, value: { note: 'before the restore' }, visibility: 'private' });
    assert(w.status === 201 || w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    opAgent = await makeAgent(BASE, op, ['*', 'operator:admin'], `rstop${stamp % 100000}`);
    const c = await call('PATCH', `/v1/agents/${opAgent.name}/clearance`, op.token, { clearance: 'sisainen' });
    assert(c.status === 200, `clearance: ${c.status} ${JSON.stringify(c.body?.error)}`);
});

await test('The operator in person restores an unmodified backup as before: the same counts, the record replaced', async () => {
    const b = await call('GET', '/v1/admin/backup', op.token);
    assert(b.status === 200, `backup: ${b.status}`);
    const data = b.body.data;
    const memories = (data.agent_data?.[bot.gaii]?.memories ?? []) as Body[];
    const mine = memories.find(m => m.key === KEY);
    assert(mine, 'the record is in the backup');
    mine.value = { note: 'restored value' };
    const r = await call('POST', '/v1/admin/restore', op.token, data);
    assert(r.status === 200 && r.body.data.restored === true, `restore: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(r.body.data.imported.memories >= 1 && r.body.data.skipped_duplicates.owners >= 2 && r.body.data.skipped_duplicates.agents >= 2,
        `counts: ${JSON.stringify(r.body.data)}`);
    const read = await call('GET', `/v1/memory/${encodeURIComponent(KEY)}`, bot.token);
    assert(read.status === 200 && read.body.data.value.note === 'restored value', `the record is replaced: ${JSON.stringify(read.body?.data?.value)}`);
});

await test('Alice reads one line in her feed that the operator restored her records', async () => {
    const lines = await restoreLines(alice.token);
    assert(lines.length === 1, `one restore line, got ${lines.length}: ${JSON.stringify(lines.map(l => l.data))}`);
    assert(Number(lines[0].data.records) >= 1, `it counts her records: ${JSON.stringify(lines[0].data)}`);
    assert(String(lines[0].data.operator ?? '') === op.ghii, `it names the operator: ${JSON.stringify(lines[0].data)}`);
});

await test('The operator in person restores an agent row with the clearance it carries (none)', async () => {
    const row = await agentRow(`rstin${stamp % 100000}`);
    const r = await call('POST', '/v1/admin/restore', op.token, { agents: [row] });
    assert(r.status === 200 && r.body.data.imported.agents === 1, `restore: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(await clearanceOf(row.name) === null, `clearance: ${await clearanceOf(row.name)}`);
});

await test('The operator\'s agent restores an agent row into alice\'s account with no looser a clearance than its own', async () => {
    const row = await agentRow(`rstdel${stamp % 100000}`);
    const r = await call('POST', '/v1/admin/restore', opAgent.token, { agents: [row] });
    assert(r.status === 200 && r.body.data.imported.agents === 1, `restore: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(await clearanceOf(row.name) === 'sisainen', `clearance: ${await clearanceOf(row.name)}`);
});

await test('Alice reads a line for each restore that wrote into her account, the agents counted', async () => {
    const lines = await restoreLines(alice.token);
    assert(lines.length === 3, `three restore lines, got ${lines.length}: ${JSON.stringify(lines.map(l => l.data))}`);
    assert(lines.filter(l => Number(l.data.agents) === 1).length === 2, `two of them count one agent: ${JSON.stringify(lines.map(l => l.data))}`);
});

await test('The operator\'s own account gets no restore line', async () => {
    assert((await restoreLines(op.token)).length === 0, 'the operator\'s feed has a restore line');
});

await test('FAILURE: alice, who is not the operator, cannot restore', async () => {
    const r = await call('POST', '/v1/admin/restore', alice.token, { agents: [] });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Teardown: classification off again', async () => {
    const off = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'off' }] });
    assert(off.status === 200, `switch off: ${off.status} ${JSON.stringify(off.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
