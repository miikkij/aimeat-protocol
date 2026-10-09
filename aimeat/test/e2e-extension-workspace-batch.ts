/**
 * @file e2e-extension-workspace-batch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.workspace.publishRecords` and `deleteRecords`: an extension brings a batch of
 *   records into its CALLER's organism workspace in ONE host call, and takes them back out in one.
 *   This is what an app tool such as CADENCE's import_records runs when a chat over MCP or an agent
 *   brings 500 contacts at once. The extension is installed with NO limits block, so it runs under
 *   the node's defaults (500 API calls, 5 seconds): `write` + `publish` per record would be 1000
 *   calls and could not finish.
 *     - a dry run decides all 500 and writes nothing
 *     - the real run publishes 500 in one action, under the caller (B's agent), and each record
 *       carries the node's provenance naming `ext.<name>.<action>`
 *     - a second run with createOnly finds every id already there (EXISTS) and writes nothing
 *     - one deleteRecords removes the same 500
 *     - an agent without `memory:purge` is refused deleteRecords (SCOPE_DENIED), as the batch delete
 *       route refuses it; an agent of a member without a contributor grant is refused the publish
 *       (CONSENT_REQUIRED), as a draft write refuses it
 *
 *   FIRST FAIL. Against the tree before this change, `ctx.workspace.publishRecords` is undefined, the
 *   script throws a TypeError and the route answers 500 EXTENSION_ERROR. Each assertion that asserts
 *   the new capability is marked `// HOLE:`.
 * @version-history
 *   v1.1.0 — 2026-10-09 — ctx.workspace.archiveRecords: the creator's agent with organism:write
 *     archives 10 in one call and they leave the workspace read until restored; a member in person is
 *     refused ACCESS_DENIED and the creator's agent without organism:write SCOPE_DENIED.
 *   v1.0.0 — 2026-10-06 — Initial (wish bulk-records-for-ai).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-workspace-batch

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `ewb${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext Batch', password: 'ExtBatch12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`. */
async function mintAgentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Extension ctx.workspace batch E2E ===\n');

const STAMP = Date.now();
const EXT = `wbat${STAMP}`;
const N = 500;
const NS = 'shared.contact';

// The records are built inside the script, so the request stays small and the host call carries
// all 500. `dryRun` and `createOnly` come from the caller.
const SCRIPTS = {
    import_records: `export default async function(ctx, input){
        var records = [];
        for (var i = 0; i < input.n; i++) records.push({ id: 'c' + i, value: { name: 'Contact ' + i, email: 'c' + i + '@example.com' } });
        return ctx.workspace.publishRecords(input.org, input.ws, '${NS}', records, { dryRun: !!input.dryRun, createOnly: !!input.createOnly });
    }`,
    undo_import: `export default async function(ctx, input){
        var ids = [];
        for (var i = 0; i < input.n; i++) ids.push('c' + i);
        return ctx.workspace.deleteRecords(input.org, input.ws, '${NS}', ids);
    }`,
    archive_some: `export default async function(ctx, input){
        var ids = [];
        for (var i = 0; i < input.k; i++) ids.push('c' + i);
        return ctx.workspace.archiveRecords(input.org, input.ws, '${NS}', ids);
    }`,
};

// NO limits block: the node's defaults apply (AIMEAT_EXT_MAX_API_CALLS 500, AIMEAT_EXT_TIMEOUT_MS 5000).
const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'ctx.workspace batch e2e', author: 'e2e' },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
    config: { public_access: { default: true } },
    workspace: { read: true, write: true },
});

let A!: Awaited<ReturnType<typeof setupOwner>>;   // installs the extension, creates the organism
let B!: Awaited<ReturnType<typeof setupOwner>>;   // a member with a contributor grant
let C!: Awaited<ReturnType<typeof setupOwner>>;   // a member WITHOUT a contributor grant
const B_AGENT = 'importer';
let bAgentToken = '';      // memory:write + memory:purge + organism:read
let bNoPurgeToken = '';    // memory:write + organism:read
let cAgentToken = '';      // memory:write + organism:read, but C holds no grant
let aArchiveToken = '';    // A (the creator): organism:read + organism:write
let aNoWriteToken = '';    // A: organism:read only
let orgId = '';
const WS = 'wscrm';
const root = () => `organism.${orgId}.w.${WS}`;

const invoke = (action: string, token: string, input: Record<string, unknown> = {}) =>
    json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ org: orgId, ws: WS, n: N, ...input }) });

/** How many published contacts B holds in the workspace. */
async function publishedCount(): Promise<number> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.${NS}.`)}&limit=2000`, { headers: auth(B.token) });
    assert(r.status === 200, `list ${r.status}`);
    return (r.body.data.items as Array<{ key: string }>).filter(i => i.key.endsWith('.latest')).length;
}

await test('Setup: three owners and their agents', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
    bAgentToken = await mintAgentToken(B, B_AGENT, ['memory:read', 'memory:write', 'memory:purge', 'organism:read']);
    bNoPurgeToken = await mintAgentToken(B, 'nopurge', ['memory:read', 'memory:write', 'organism:read']);
    cAgentToken = await mintAgentToken(C, 'outsider', ['memory:read', 'memory:write', 'organism:read']);
    aArchiveToken = await mintAgentToken(A, 'keeper', ['memory:read', 'organism:read', 'organism:write']);
    aNoWriteToken = await mintAgentToken(A, 'reader', ['memory:read', 'organism:read']);
});

await test('Setup: A\'s organism, a workspace with a locked contact schema, B contributor, C plain member', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'CRM batch e2e', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`); orgId = o.body.data.organism.id;
    const reg = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'CRM', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    assert(reg.status === 201 || reg.status === 200, `registry ${reg.status}`);
    const man = {
        manifestVersion: '1.0', id: orgId, name: 'CRM', kind: 'project', status: 'active',
        objectTypes: [{ name: 'contact', schemaRef: 'schema:contact@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true }],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: man, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    const lock = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}`)}/schema`, {
        method: 'PUT', headers: auth(A.token),
        body: JSON.stringify({ apply_to: 'prefix', schema_mode: 'strict', schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, email: { type: 'string' } } } }),
    });
    assert(lock.status === 200 || lock.status === 201, `schema lock ${lock.status}: ${JSON.stringify(lock.body?.error)}`);
    for (const who of [B, C]) {
        const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(who.token), body: '{}' });
        assert(j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);
    }
    const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, grantee: B.name, role: 'contributor' }) });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
});

await test('Install + activate the extension with no limits block (the node defaults apply)', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}`);
});

await test('Dry run: all 500 decided in one action, nothing written', async () => {
    const r = await invoke('import_records', bAgentToken, { dryRun: true });
    // HOLE: 500 EXTENSION_ERROR (publishRecords is not a function) before this change.
    assert(r.status === 200, `dry run ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.dry_run === true && r.body.data.published === N && r.body.data.failed === 0, `dry answer: ${JSON.stringify({ ...r.body.data, results: r.body.data.results?.length })}`);
    assert(r.body.data.results.length === N, `one result per record: ${r.body.data.results.length}`);
    assert(await publishedCount() === 0, 'a dry run wrote records');
});

await test('Import: 500 records in one action, under the default limits, owned by the caller', async () => {
    const t0 = Date.now();
    const r = await invoke('import_records', bAgentToken);
    const ms = Date.now() - t0;
    // HOLE: 500 EXTENSION_ERROR before this change.
    assert(r.status === 200, `import ${r.status} after ${ms} ms: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.published === N && r.body.data.failed === 0, `import answer: ${JSON.stringify({ ...r.body.data, results: r.body.data.results?.length })}`);
    console.log(`     (500 records in one action: ${ms} ms end to end)`);
    assert(await publishedCount() === N, 'B holds 500 published contacts');
    const theirs = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.${NS}.`)}&limit=10`, { headers: auth(A.token) });
    assert((theirs.body.data.items as unknown[]).length === 0, 'nothing landed under the installer');
});

await test('Provenance: a written record names the extension and the action', async () => {
    const rec = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.c7.latest`)}`, { headers: auth(B.token) });
    assert(rec.status === 200, `read ${rec.status}`);
    const pid = rec.body.data.ai_provenance_id;
    // HOLE: no record existed before this change.
    assert(typeof pid === 'string' && pid.length > 0, `ai_provenance_id: ${JSON.stringify(rec.body.data.ai_provenance_id)}`);
    const prov = await json(`/v1/provenance/${pid}`, { headers: { ...auth(B.token), Accept: 'application/json' } });
    assert(prov.status === 200, `provenance ${prov.status}`);
    const p = prov.body.data.provenance ?? prov.body.data;
    assert(p.generator?.pipeline === `ext.${EXT}.import_records`, `pipeline: ${JSON.stringify(p.generator)}`);
    assert(p.level === 'ai-generated', `level: ${p.level}`);
});

await test('createOnly: a second import finds all 500 already there and writes nothing', async () => {
    const r = await invoke('import_records', bAgentToken, { createOnly: true });
    assert(r.status === 200, `createOnly ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.published === 0 && r.body.data.failed === N, `answer: ${JSON.stringify({ ...r.body.data, results: r.body.data.results?.length })}`);
    assert((r.body.data.results as Array<{ code?: string }>).every(x => x.code === 'EXISTS'), 'every refusal is EXISTS');
});

await test('Refused: deleteRecords from an agent without memory:purge (SCOPE_DENIED), nothing removed', async () => {
    const r = await invoke('undo_import', bNoPurgeToken);
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `no purge ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await publishedCount() === N, 'records were removed');
});

await test('Refused: publishRecords from the agent of a member without a contributor grant (CONSENT_REQUIRED)', async () => {
    const r = await invoke('import_records', cAgentToken, { n: 3 });
    assert(r.status === 403 && r.body?.error?.code === 'CONSENT_REQUIRED', `no grant ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

/** How many contacts the creator's workspace read shows: archived records leave it. */
async function readCount(): Promise<number> {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    assert(r.status === 200, `workspace read ${r.status}`);
    return (r.body.data.objects.contact as unknown[]).length;
}

await test('Refused: archiveRecords from a member in person who is not creator or admin (ACCESS_DENIED)', async () => {
    // B in person: an owner session passes the scope test, so the refusal is the role's.
    const r = await invoke('archive_some', B.token, { k: 3 });
    // HOLE: 500 EXTENSION_ERROR (archiveRecords is not a function) before this change.
    assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED', `member archive ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await readCount() === N, 'a refused archive hid records');
});

await test('Refused: archiveRecords from the creator\'s agent without organism:write (SCOPE_DENIED)', async () => {
    const r = await invoke('archive_some', aNoWriteToken, { k: 3 });
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `no organism:write ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('archiveRecords: the creator\'s agent archives 10 in one call; they leave the read and come back on restore', async () => {
    const r = await invoke('archive_some', aArchiveToken, { k: 10 });
    // HOLE: 500 EXTENSION_ERROR before this change.
    assert(r.status === 200, `archive ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.archived.length === 10 && r.body.data.rows >= 10, `archive answer: ${JSON.stringify(r.body.data)}`);
    assert(await readCount() === N - 10, 'archived records still in the workspace read');
    for (let i = 0; i < 10; i++) {
        const u = await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.${NS}.c${i}` }) });
        assert(u.status === 200, `unarchive c${i} ${u.status}: ${JSON.stringify(u.body?.error)}`);
    }
    assert(await readCount() === N, 'restored records are back in the read');
});

await test('Undo: one deleteRecords removes the same 500', async () => {
    const r = await invoke('undo_import', bAgentToken);
    // HOLE: 500 EXTENSION_ERROR before this change.
    assert(r.status === 200, `undo ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.deleted.length === N && r.body.data.failed.length === 0, `undo answer: deleted ${r.body.data.deleted?.length}, failed ${JSON.stringify(r.body.data.failed?.slice(0, 3))}`);
    assert(await publishedCount() === 0, 'records remain after undo');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
