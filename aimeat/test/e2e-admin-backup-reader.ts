/**
 * @file test/e2e-admin-backup-reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/admin/backup applies the classification reader to an operator's agent and
 *   writes the operator trail (secaudit2026oct22,
 *   get-admin-backup:memory-values-without-reader-or-trail). With classification on for everyone:
 *     - the operator's agent holding operator:admin, with its clearance at Internal, gets a backup
 *       without another person's Confidential record, and the answer lists that record under
 *       `withheld`; the per-record admin route refuses the same agent the same record;
 *     - the operator in person still gets the whole backup, the Confidential record included;
 *     - the person whose entries the file carries reads an export line in their account feed.
 *   The operator (the suite's first account) turns classification on and off again at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-backup-reader
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
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
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

console.log('\n=== GET /v1/admin/backup: the classification reader and the operator trail (secaudit2026oct22) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
let bot!: McpAgent, opAgent!: McpAgent;
const SECRET = `bkr.secret.${stamp}`;
const PLAIN = `bkr.plain.${stamp}`;

const backupKeys = (body: Body, gaii: string): string[] =>
    ((body.data?.agent_data?.[gaii]?.memories ?? []) as Body[]).map(m => m.key as string);
const exportLines = async (token: string): Promise<Body[]> => {
    const r = await call('GET', '/v1/account/events?limit=200', token);
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.events as Body[]).filter(e => e.kind === 'memory_accessed_by_operator' && e.data?.action === 'export');
};

await test('Setup: classification on for everyone; alice\'s agent keeps a Confidential and a plain record; the operator\'s agent has operator:admin and Internal clearance', async () => {
    op = await registerOwner(BASE, `bkrop${stamp}`);
    alice = await registerOwner(BASE, `bkralice${stamp}`);
    const on = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'all' }] });
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    bot = await makeAgent(BASE, alice, ['*'], `bkrbot${stamp % 100000}`);
    for (const key of [SECRET, PLAIN]) {
        const w = await call('POST', '/v1/memory', bot.token, { key, value: { note: `backup reader ${key}` }, visibility: 'private' });
        assert(w.status === 201 || w.status === 200, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }
    const l = await call('PUT', '/v1/classification/label', alice.token, { kind: 'memory', key: SECRET, owner: bot.gaii, label: 'luottamuksellinen' });
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    opAgent = await makeAgent(BASE, op, ['*', 'operator:admin'], `bkrop${stamp % 100000}`);
    const c = await call('PATCH', `/v1/agents/${opAgent.name}/clearance`, op.token, { clearance: 'sisainen' });
    assert(c.status === 200, `clearance: ${c.status} ${JSON.stringify(c.body?.error)}`);
});

await test('The per-record admin route refuses the operator\'s agent the Confidential record', async () => {
    const r = await call('GET', `/v1/admin/memory/${encodeURIComponent(bot.gaii)}/${encodeURIComponent(SECRET)}`, opAgent.token);
    assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
});

await test('FAILURE: the operator\'s agent gets a backup without the Confidential record, and the answer lists it under withheld', async () => {
    const r = await call('GET', '/v1/admin/backup', opAgent.token);
    assert(r.status === 200, `backup: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const keys = backupKeys(r.body, bot.gaii);
    assert(keys.includes(PLAIN), `the plain record is in the backup: ${JSON.stringify(keys)}`);
    assert(!keys.includes(SECRET), 'the Confidential record is in the agent\'s backup');
    assert(!JSON.stringify(r.body).includes(`backup reader ${SECRET}`), 'the Confidential value is in the agent\'s backup');
    const withheld = (r.body.data.withheld ?? []) as Body[];
    assert(withheld.some(w => w.owner === bot.gaii && w.key === SECRET), `withheld names the record: ${JSON.stringify(withheld)}`);
});

await test('The operator in person still gets the whole backup, the Confidential record included', async () => {
    const r = await call('GET', '/v1/admin/backup', op.token);
    assert(r.status === 200, `backup: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const keys = backupKeys(r.body, bot.gaii);
    assert(keys.includes(PLAIN) && keys.includes(SECRET), `both records in the backup: ${JSON.stringify(keys)}`);
    assert((r.body.data.withheld ?? []).length === 0, `nothing withheld from the operator: ${JSON.stringify(r.body.data.withheld)}`);
});

await test('Alice reads in her account feed that the operator exported her entries, once per backup', async () => {
    const lines = await exportLines(alice.token);
    assert(lines.length === 2, `two export lines, got ${lines.length}: ${JSON.stringify(lines.map(l => l.data))}`);
    assert(lines.every(l => Number(l.data.count) >= 1), `each line counts the entries: ${JSON.stringify(lines.map(l => l.data))}`);
});

await test('The operator\'s own entries write no export line in the operator\'s feed', async () => {
    assert((await exportLines(op.token)).length === 0, 'the operator\'s own feed has an export line');
});

await test('FAILURE: alice, who is not the operator, cannot take a backup', async () => {
    const r = await call('GET', '/v1/admin/backup', alice.token);
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Teardown: classification off again', async () => {
    const off = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'off' }] });
    assert(off.status === 200, `switch off: ${off.status} ${JSON.stringify(off.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
