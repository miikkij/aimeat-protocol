/**
 * @file e2e-workspace-backing-gate.ts
 * @description Regression suite for the invisible-documents bug (2026-06-10): a workspace space
 *   created with backing:'knowledge' accepted writes + publishes while EVERY read surface (MCP
 *   workspace_read, the UI) silently skipped the space. The invariant under test: every backing
 *   value either works END TO END (declare → write → publish → visible in reads) or is REJECTED
 *   loudly at the gate — no "accepted but invisible" middle state. Also covers the second silent
 *   failure from the same incident: kind:'document' without mode must resolve to document mode,
 *   not fall through to records.
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial: backing gate (REST update + MCP create/write) + kind→mode inference.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-backing-gate

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return out;
}

/** MCP JSON-RPC caller bound to one agent's token + session (same harness as e2e-mcp-workspaces). */
function mcpClient() {
    let token = '', session = '';
    const rpc = async (method: string, params: Record<string, any> = {}, id = 1) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id'); if (sid) session = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json() as any;
        return { status: res.status, body };
    };
    return {
        setToken: (t: string) => { token = t; },
        rpc,
        call: async (name: string, args: Record<string, any>, id = 1) => (await rpc('tools/call', { name, arguments: args }, id)).body,
    };
}

async function setupAgent(label: string) {
    const ownerName = `wsbg${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Backing', password: 'WsBg12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts1 = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts1, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts1) }) });
    const ownerToken = tok.body.data.token as string;
    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: `wsbgagent${label}`, owner: ownerName, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const agentGaii = ag.body.data.agent.gaii, agentPriv = ag.body.data.private_key;
    const cl = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'WS Backing', redirect_uris: [] }) });
    const ts2 = new Date().toISOString();
    const params = new URLSearchParams({ response_type: 'code', client_id: cl.body.client_id, gaii: agentGaii, signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts2), timestamp: ts2 });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const tk = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: cl.body.client_id, client_secret: cl.body.client_secret }) });
    const client = mcpClient(); client.setToken(tk.body.access_token);
    await client.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'WS Backing', version: '1.0.0' } });
    return { ownerName, ownerToken, client };
}

console.log('\n=== AIMEAT Workspace Backing Gate E2E ===\n');

let A!: Awaited<ReturnType<typeof setupAgent>>;
let orgId = '';
const authH = () => ({ Authorization: `Bearer ${A.ownerToken}` });
const mcpText = (b: any) => b?.result?.content?.[0]?.text ?? '';
const mcpData = (b: any) => JSON.parse(mcpText(b));
const mcpErr = (b: any) => b?.result?.isError === true;

await test('Setup owner + agent + organism', async () => {
    A = await setupAgent('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: authH(), body: JSON.stringify({ name: 'Backing Gate Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`);
    orgId = o.body.data.organism.id;
});

// ── The gate: unsupported backings are rejected loudly on every create/update path ──

await test('1. direct manifest memory-write with backing:"knowledge" → rejected by the manifest schema', async () => {
    const manifest = {
        manifestVersion: '1', id: orgId, name: 'Bad', kind: 'workspace', status: 'active',
        objectTypes: [{ name: 'doc', schemaRef: 'doc', namespace: 'shared.docs', backing: 'knowledge', writeRole: 'member' }],
    };
    const r = await json('/v1/memory', { method: 'POST', headers: authH(), body: JSON.stringify({ key: `organism.${orgId}.w.ws-bad.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(r.status === 422, `expected 422 (schema enum), got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('2. MCP workspace_create with backing:"knowledge" → rejected with the instructive error', async () => {
    const b = await A.client.call('aimeat_workspace_create', {
        organism_id: orgId, name: 'Bad WS',
        manifest: { manifestVersion: '1', name: 'Bad WS', kind: 'workspace', objectTypes: [{ name: 'design-doc', kind: 'document', namespace: 'design.doc', schemaRef: 'design.doc', backing: 'knowledge', writeRole: 'member' }] },
    }, 201);
    assert(mcpErr(b), `create should fail, got: ${mcpText(b)}`);
    assert(/not supported/i.test(mcpText(b)) && /Sources/.test(mcpText(b)), `error should explain the fix: ${mcpText(b)}`);
});

let wsId = '';
await test('3. MCP workspace_create with kind:"document" (no mode) → created, mode inferred as document', async () => {
    const b = await A.client.call('aimeat_workspace_create', {
        organism_id: orgId, name: 'Design',
        manifest: {
            manifestVersion: '1', name: 'Design', kind: 'workspace',
            objectTypes: [
                // The exact old-client shape from the incident: kind:'document', no mode field.
                { name: 'design-doc', kind: 'document', namespace: 'design.doc', schemaRef: 'design.doc', backing: 'memory', writeRole: 'member' },
                // A declared pointer to the task system — valid, but not writable as workspace records.
                { name: 'work', namespace: 'shared.work', schemaRef: 'work', backing: 'tasks', writeRole: 'member', mode: 'records' },
            ],
        },
    }, 202);
    assert(!mcpErr(b), `create failed: ${mcpText(b)}`);
    wsId = mcpData(b).ws;
    const man = (await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${wsId}.meta.manifest`)}`, { headers: authH() })).body.data.value;
    const dd = man.objectTypes.find((o: any) => o.name === 'design-doc');
    assert(dd?.mode === 'document', `mode inferred from kind: ${JSON.stringify(dd)}`);
});

// ── End-to-end visibility: a memory document space must be visible EVERYWHERE after publish ──

await test('4. write WITHOUT id resolves as document mode (no records-mode fallthrough)', async () => {
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: wsId, space: 'design-doc', section: 'core', value: { title: 'Vision', markdown: '# Vision\n\nbody' } }, 203);
    assert(!mcpErr(b), `write failed: ${mcpText(b)}`);
    const d = mcpData(b);
    assert(d.mode === 'document', `resolved mode: ${JSON.stringify(d)}`);
    assert(typeof d.id === 'string' && d.id.length > 0, 'document id auto-generated');
});

await test('5. write + publish → the document is visible in MCP workspace_read AND REST workspace read', async () => {
    const w = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: wsId, space: 'design-doc', id: 'vision-and-pillars', value: { title: 'Vision and Pillars', markdown: '# V\n\nx' } }, 204);
    assert(!mcpErr(w), `write failed: ${mcpText(w)}`);
    const p = await A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: wsId, namespace: 'design.doc', id: 'vision-and-pillars' }, 205);
    assert(!mcpErr(p), `publish failed: ${mcpText(p)}`);
    // MCP read — the surface that returned objects:{} for a month in the incident.
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: wsId }, 206);
    const data = mcpData(rd);
    const docs = data.objects?.['design-doc'] || [];
    assert(docs.some((d: any) => d.id === 'vision-and-pillars'), `MCP read must list the published doc: ${JSON.stringify(Object.keys(data.objects || {}))}`);
    // REST read — what the UI consumes.
    const rest = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, { headers: authH() });
    const restDocs = rest.body.data.objects?.['design-doc'] || [];
    assert(restDocs.some((d: any) => d.id === 'vision-and-pillars'), `REST read must list the published doc: ${JSON.stringify(Object.keys(rest.body.data.objects || {}))}`);
});

// ── tasks backing: declarable, listed in the manifest, but not writable as workspace records ──

await test('6. tasks-backed space: read skips its objects map entry, write is refused with a pointer to the task tools', async () => {
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: wsId }, 207);
    const data = mcpData(rd);
    assert((data.manifest.objectTypes || []).some((o: any) => o.name === 'work'), 'tasks space stays declared in the manifest');
    assert(!('work' in (data.objects || {})), 'tasks space has no objects entry (its data is not workspace records)');
    const w = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: wsId, space: 'work', id: 't1', value: { id: 't1', title: 'x' } }, 208);
    assert(mcpErr(w) && /task/i.test(mcpText(w)), `tasks write must be refused with guidance: ${mcpText(w)}`);
});

// ── The update paths are gated the same way as create ──

await test('7. REST full-manifest update introducing backing:"storage" → 400 with the instructive error', async () => {
    const man = (await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${wsId}.meta.manifest`)}`, { headers: authH() })).body.data.value;
    const bad = { ...man, objectTypes: [...man.objectTypes, { name: 'files', namespace: 'shared.files', schemaRef: 'files', backing: 'storage', writeRole: 'member', mode: 'records' }] };
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ manifest: bad }) });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(/not supported/i.test(r.body.error?.message || ''), `error should explain: ${JSON.stringify(r.body.error)}`);
});

await test('8. REST add_spaces with backing:"knowledge" → 400; with kind:"document" (no mode) → mode inferred', async () => {
    const bad = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ add_spaces: [{ name: 'kb', namespace: 'shared.kb', backing: 'knowledge' }] }) });
    assert(bad.status === 400, `expected 400, got ${bad.status}: ${JSON.stringify(bad.body)}`);
    const good = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ add_spaces: [{ name: 'spec', namespace: 'shared.specs', kind: 'document' }] }) });
    assert(good.status === 200, `add_spaces ${good.status}: ${JSON.stringify(good.body)}`);
    const man = (await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${wsId}.meta.manifest`)}`, { headers: authH() })).body.data.value;
    const spec = man.objectTypes.find((o: any) => o.name === 'spec');
    assert(spec?.mode === 'document' && spec?.backing === 'memory', `inferred document space with memory backing: ${JSON.stringify(spec)}`);
});

// ── MCP memory_write must enforce schema locks (it used to call setMemory directly — a bypass
// around the manifest schema and every strict record schema; found verifying this fix on prod) ──

await test('8b. MCP aimeat_memory_write of a knowledge-backing manifest → rejected by the schema (no bypass)', async () => {
    const b = await A.client.call('aimeat_memory_write', {
        key: `organism.${orgId}.w.ws-bypass.meta.manifest`,
        value: { manifestVersion: '1', id: orgId, name: 'Bypass', kind: 'workspace', status: 'active', objectTypes: [{ name: 'd', schemaRef: 'd', namespace: 'd.d', backing: 'knowledge', writeRole: 'member' }] },
        visibility: 'private',
    }, 209);
    assert(mcpErr(b) && /SCHEMA_VALIDATION_FAILED/.test(mcpText(b)), `MCP write must hit the schema like REST does: ${mcpText(b)}`);
    // A valid write through the same tool still works (the guard rejects, it doesn't break the tool).
    const ok2 = await A.client.call('aimeat_memory_write', { key: 'bypass-check.note', value: { hello: 'world' }, visibility: 'private' }, 210);
    assert(!mcpErr(ok2), `plain write still works: ${mcpText(ok2)}`);
});

// ── Seed upgrade: existing nodes' stale system-seeded schema is replaced at startup (in-process,
// against a throwaway SQLite :memory: storage — no server restart needed to exercise the path) ──

await test('9. version-aware seed: a stale system-seeded schema is upgraded, an operator-customized one is not', async () => {
    const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');
    const { seedManifestSchema, seededVersionOf, MANIFEST_SCHEMA_KEY, MANIFEST_WS_SCHEMA_KEY, MANIFEST_SEED_VERSION } = await import('../src/services/manifest-schema.js');
    const storage = new SqliteStorage(':memory:');
    const system = 'system@test-node';
    const now = new Date().toISOString();
    // The pre-versioning (v1) schema exactly as old nodes have it: no $comment marker, wide enum.
    const oldSchema = {
        type: 'object', required: ['manifestVersion', 'id', 'name', 'kind', 'status', 'objectTypes'],
        properties: { objectTypes: { type: 'array', items: { type: 'object', properties: { backing: { enum: ['memory', 'tasks', 'storage', 'knowledge'] } } } } },
    };
    await storage.setSchema({ keyPattern: MANIFEST_SCHEMA_KEY, applyTo: 'prefix', schemaJson: oldSchema, schemaMode: 'open', lockedBy: system, setAt: now, updatedAt: now });
    // The ws-scoped pattern simulates an OPERATOR customization — must survive the upgrade untouched.
    await storage.setSchema({ keyPattern: MANIFEST_WS_SCHEMA_KEY, applyTo: 'prefix', schemaJson: oldSchema, schemaMode: 'open', lockedBy: 'operator@test-node', setAt: now, updatedAt: now });

    const written = await seedManifestSchema(storage, system);
    assert(written === 1, `exactly the stale system record is rewritten, got ${written}`);

    const upgraded = await storage.getSchema(MANIFEST_SCHEMA_KEY, 'prefix');
    assert(seededVersionOf(upgraded!.schemaJson) === MANIFEST_SEED_VERSION, `marker present after upgrade: ${JSON.stringify(upgraded!.schemaJson.$comment)}`);
    const backing = (upgraded!.schemaJson as any).properties.objectTypes.items.properties.backing.enum;
    assert(JSON.stringify(backing) === JSON.stringify(['memory', 'tasks']), `enum narrowed: ${JSON.stringify(backing)}`);

    const custom = await storage.getSchema(MANIFEST_WS_SCHEMA_KEY, 'prefix');
    assert(custom!.lockedBy === 'operator@test-node' && seededVersionOf(custom!.schemaJson) === 1, 'operator-customized record left alone');

    // Re-run is a no-op (idempotent at the current version).
    assert(await seedManifestSchema(storage, system) === 0, 'second run writes nothing');
    storage.close();
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: authH() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
