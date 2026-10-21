/**
 * @file test/e2e-publish-request-bin-takeover.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A memory publish request publishes only the content the owner was asked about, also
 *   when the agent bins its record and writes the key again.
 *
 *   WHY THIS SUITE EXISTS. The memory applier bound an approval to (namespace, key, version) only,
 *   and the version is not unique over a key's lifetime: both backends' create-if-absent write takes a
 *   binned row over at version 1. So an agent without publish:public wrote K public (held private at
 *   version 1, request filed), binned K, wrote K again with other content through `expected_version: 0`
 *   or PATCH, and the owner's approval of the old request published the new content (secaudit 2026-10,
 *   apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover). The gate asks the owner only
 *   on a node with AIMEAT_PUBLISH_GATE=agents, so this suite starts one.
 *
 *   WHAT IS PROVEN. Two fixes, each on its own. The bin (DELETE /v1/memory/:key, the single delete
 *   every surface shares) settles the waiting request `outdated` at once, so the approval answers 409
 *   and nothing goes out. The bulk delete does not pass through the bin service, so on that path the
 *   request is still waiting when the owner approves, and the content digest the request was filed
 *   with refuses it: 409 OUTDATED, for both the `expected_version: 0` write and PATCH. Each time an
 *   anonymous read of the key stays refused. The positive control: an unchanged request still applies.
 *   Phase 5 does the same for a knowledge package request and the entry it names: the bin settles it
 *   (DELETE), the entry digest refuses it (bulk delete), and an unchanged one still applies.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-request-bin-takeover
 * @version-history
 *   2026-10-21 — Phase 4 asserts the agent gets 403 when it approves its own request.
 *   2026-10-20 — Phase 5: the knowledge-entry variant (settled on the bin, refused by the entry digest).
 *   2026-10-20 — Initial (secaudit 2026-10, apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_BIN_TAKEOVER_PORT ?? '40482';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-publish-request-bin-takeover.db');
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 300);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

function cleanupDb(): void {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb('publish-bin-takeover', { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PUBLISH_GATE: 'agents',
        // ON, because the proof is an anonymous read of the key: with it off every unauthenticated
        // read is 401 whatever the record's level, which proves nothing here.
        AIMEAT_ANONYMOUS_MODE: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the publish bin-takeover node' });
}

console.log('\n=== A publish request publishes only what the owner was asked about ===\n');
console.log('Phase 1: the node, the owner and an agent without publish:public');

const server = await startServer();

const ownerName = `pbt${STAMP}`;
let ownerToken = '';
let agentGaii = '';
let agentToken = '';

await test('the owner and an agent holding memory:write and memory:delete but not publish:public', async () => {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'Bin Takeover', password: 'PbTake1234' }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${short(reg.body)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'PbTake1234');
    assert(tok.status === 200 && tok.body.data?.token, `owner token ${tok.status}: ${short(tok.body)}`);
    ownerToken = tok.body.data.token as string;

    const agent = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            name: 'pbtagent', owner: ownerName, model: 'gpt-4o',
            scopes: ['memory:read', 'memory:write', 'memory:delete'],
        }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${short(agent.body)}`);
    agentGaii = agent.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(agent.body.data.private_key, agentGaii + ts) }),
    });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    agentToken = at.body.data.token as string;
});

/** The agent writes `key` public: the gate keeps it private and files a request. Returns the request id. */
async function askPublic(key: string, value: unknown): Promise<string> {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key, value, visibility: 'public' }),
    });
    assert(w.status === 202, `a held public write answers 202: ${w.status}: ${short(w.body)}`);
    assert(w.body.data?.publish_request?.status === 'awaiting_owner', `no waiting request: ${short(w.body.data)}`);
    assert(w.body.data?.visibility === 'private' && w.body.data?.version === 1, `stored as ${w.body.data?.visibility} v${w.body.data?.version}`);
    return w.body.data.publish_request.request_id as string;
}

const anonRead = (key: string) => json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(key)}`);
const approve = (id: string) => json(`/v1/publish-requests/${id}/decision`, {
    method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ decision: 'approve' }),
});
async function requestState(id: string): Promise<string | undefined> {
    const r = await json(`/v1/publish-requests/${id}`, { headers: bearer(ownerToken) });
    return r.body?.data?.request?.state;
}

console.log('\nPhase 2: the positive control: an unchanged request still applies');

await test('POSITIVE CONTROL: the owner approves an unchanged request, and anyone reads the record', async () => {
    const key = 'pbt.control';
    const id = await askPublic(key, { t: 'approved-content' });
    const before = await anonRead(key);
    assert(before.status !== 200, `readable before the approval: ${before.status}`);
    const d = await approve(id);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve ${d.status}: ${short(d.body)}`);
    const after = await anonRead(key);
    assert(after.status === 200 && after.body.data?.value?.t === 'approved-content', `anonymous read ${after.status}: ${short(after.body)}`);
});

console.log('\nPhase 3: the bin settles the request (DELETE /v1/memory/:key)');

await test('SECURITY: bin, then write again with expected_version 0: the request is outdated and the approval publishes nothing', async () => {
    const key = 'pbt.binned';
    const id = await askPublic(key, { t: 'A-approved-content' });
    const del = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: bearer(agentToken) });
    assert(del.status === 200, `delete ${del.status}: ${short(del.body)}`);
    assert(await requestState(id) === 'outdated', `the bin settles the waiting request: ${await requestState(id)}`);
    const re = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key, value: { t: 'B-swapped-content' }, visibility: 'private', expected_version: 0 }),
    });
    assert(re.status === 201 && re.body.data?.version === 1, `re-create at version 1: ${re.status} ${short(re.body.data)}`);
    const d = await approve(id);
    assert(d.status === 409, `the approval of the old request: ${d.status} ${short(d.body)}`);
    const anon = await anonRead(key);
    assert(anon.status !== 200, `the swapped content went public: ${anon.status} ${short(anon.body)}`);
});

console.log('\nPhase 4: a delete outside the bin service: the content digest refuses it');

async function bulkDelete(key: string): Promise<void> {
    const del = await json('/v1/memory/bulk-delete', { method: 'POST', headers: bearer(agentToken), body: JSON.stringify({ keys: [key] }) });
    assert(del.status === 200 && del.body.data?.deleted === 1, `bulk delete ${del.status}: ${short(del.body)}`);
}

await test('SECURITY: bulk delete, then write again with expected_version 0: the approval answers 409 OUTDATED', async () => {
    const key = 'pbt.bulk';
    const id = await askPublic(key, { t: 'A-approved-content' });
    await bulkDelete(key);
    const re = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key, value: { t: 'B-swapped-content' }, visibility: 'private', expected_version: 0 }),
    });
    assert(re.status === 201 && re.body.data?.version === 1, `re-create at version 1: ${re.status} ${short(re.body.data)}`);
    assert(await requestState(id) === 'awaiting_owner', `this path leaves the request waiting: ${await requestState(id)}`);
    // The agent that swapped the content cannot approve its own request: only the owner decides.
    const self = await json(`/v1/publish-requests/${id}/decision`, {
        method: 'POST', headers: bearer(agentToken), body: JSON.stringify({ decision: 'approve' }),
    });
    assert(self.status === 403, `the agent approves its own request: ${self.status} ${short(self.body)}`);
    const d = await approve(id);
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `the approval: ${d.status} ${short(d.body)}`);
    const anon = await anonRead(key);
    assert(anon.status !== 200, `the swapped content went public: ${anon.status} ${short(anon.body)}`);
});

await test('SECURITY: bulk delete, then PATCH the key back into existence: the approval answers 409 OUTDATED', async () => {
    const key = 'pbt.patch';
    const id = await askPublic(key, { t: 'A-approved-content' });
    await bulkDelete(key);
    const re = await json(`/v1/memory/${encodeURIComponent(key)}`, {
        method: 'PATCH', headers: bearer(agentToken), body: JSON.stringify({ patch: { t: 'B-swapped-content' } }),
    });
    // 201: the binned key is absent to every read, so the PATCH creates it (routes/memory/patch.ts).
    assert(re.status === 201 && re.body.data?.version === 1, `PATCH re-create at version 1: ${re.status} ${short(re.body)}`);
    const d = await approve(id);
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `the approval: ${d.status} ${short(d.body)}`);
    const anon = await anonRead(key);
    assert(anon.status !== 200, `the swapped content went public: ${anon.status} ${short(anon.body)}`);
});

console.log('\nPhase 5: a knowledge package request binds each entry it names the same way');

/** The agent imports a knowledge package, unlisted, with one entry `open` it asks to make public. */
async function askKnowledge(name: string): Promise<{ packageId: string; requestId: string; entryKey: string }> {
    const r = await json('/v1/knowledge/import', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({
            package: {
                type: 'knowledge-package', name, version: '1.0.0', content_type: 'idea', tags: [`pbt${STAMP}`], language: 'en', maturity: 'draft',
                synthesis: { level: 'original', description: 'test' }, references: [], links: [],
                entries: [{ key: 'open', visibility: 'public', title: 'open' }],
                sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0, audience: 'owner' },
            },
            entry_data: { open: { title: 'open', description: 'A-approved-content' } },
        }),
    });
    assert(r.status === 202 && r.body.data?.publish_request?.kind === 'knowledge', `import asks: ${r.status} ${short(r.body.data ?? r.body.error)}`);
    const packageId = r.body.data.package_id as string;
    return { packageId, requestId: r.body.data.publish_request.request_id as string, entryKey: `packages/${packageId}/open` };
}

/** The agent writes the binned entry key again, with other content, as a new record at version 1. */
async function recreateEntry(entryKey: string): Promise<void> {
    const re = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key: entryKey, value: { title: 'open', description: 'B-swapped-content' }, visibility: 'private', expected_version: 0 }),
    });
    assert(re.status === 201 && re.body.data?.version === 1, `entry re-create at version 1: ${re.status} ${short(re.body.data ?? re.body.error)}`);
}

await test('POSITIVE CONTROL: the owner approves an unchanged knowledge request, and anyone reads the entry', async () => {
    const k = await askKnowledge('pbt-kn-ok');
    assert((await anonRead(k.entryKey)).status !== 200, 'the entry is readable before the approval');
    const d = await approve(k.requestId);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve ${d.status}: ${short(d.body)}`);
    const after = await anonRead(k.entryKey);
    assert(after.status === 200 && after.body.data?.value?.description === 'A-approved-content', `anonymous read ${after.status}: ${short(after.body)}`);
});

await test('SECURITY: an entry binned through DELETE and written again: the knowledge request is outdated and the approval publishes nothing', async () => {
    const k = await askKnowledge('pbt-kn-bin');
    const del = await json(`/v1/memory/${encodeURIComponent(k.entryKey)}`, { method: 'DELETE', headers: bearer(agentToken) });
    assert(del.status === 200, `delete ${del.status}: ${short(del.body)}`);
    assert(await requestState(k.requestId) === 'outdated', `the bin settles the waiting knowledge request: ${await requestState(k.requestId)}`);
    await recreateEntry(k.entryKey);
    const d = await approve(k.requestId);
    assert(d.status === 409, `the approval of the old request: ${d.status} ${short(d.body)}`);
    const anon = await anonRead(k.entryKey);
    assert(anon.status !== 200, `the swapped entry went public: ${anon.status} ${short(anon.body)}`);
});

await test('SECURITY: an entry removed through bulk delete and written again: the approval answers 409 OUTDATED', async () => {
    const k = await askKnowledge('pbt-kn-bulk');
    await bulkDelete(k.entryKey);
    await recreateEntry(k.entryKey);
    assert(await requestState(k.requestId) === 'awaiting_owner', `this path leaves the request waiting: ${await requestState(k.requestId)}`);
    const d = await approve(k.requestId);
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `the approval: ${d.status} ${short(d.body)}`);
    const anon = await anonRead(k.entryKey);
    assert(anon.status !== 200, `the swapped entry went public: ${anon.status} ${short(anon.body)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
server.kill();
await new Promise<void>(r => setTimeout(r, 300));
cleanupDb();
process.exit(failed > 0 ? 1 : 0);
