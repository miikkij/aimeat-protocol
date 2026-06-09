/**
 * @file e2e-mcp-workspaces.ts
 * @description E2E tests for the MCP workspace tools (aimeat_workspace_list / read / write_draft /
 *   publish / add_document). Sets up an organism + a workspace (registry + manifest + a records
 *   schema) via REST, then drives the tools as the owner's agent over MCP, and checks the
 *   membership gate with a second owner's organism.
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial creation (5 workspace tools).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-workspaces

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

/** Build an MCP JSON-RPC caller bound to one agent's token + session. */
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

/** Register owner + agent + MCP OAuth + initialised session. Returns { ownerName, ownerToken, client }. */
async function setupAgent(label: string) {
    const ownerName = `wsmcp${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS MCP', password: 'WsMcp1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts1 = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts1, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts1) }) });
    const ownerToken = tok.body.data.token;
    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: `wsagent${label}`, owner: ownerName, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const agentGaii = ag.body.data.agent.gaii, agentPriv = ag.body.data.private_key;
    const cl = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'WS MCP', redirect_uris: [] }) });
    const ts2 = new Date().toISOString();
    const params = new URLSearchParams({ response_type: 'code', client_id: cl.body.client_id, gaii: agentGaii, signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts2), timestamp: ts2 });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const tk = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: cl.body.client_id, client_secret: cl.body.client_secret }) });
    const client = mcpClient(); client.setToken(tk.body.access_token);
    await client.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'WS MCP', version: '1.0.0' } });
    return { ownerName, ownerToken, client };
}

console.log('\n=== AIMEAT MCP Workspaces E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupAgent>>;
let B!: Awaited<ReturnType<typeof setupAgent>>;
await test('Setup owner 1 (agent) + owner 2 (agent)', async () => { A = await setupAgent('a'); B = await setupAgent('b'); });

let orgId = '', otherOrgId = '';
const WS = 'ws1';
const root = () => `organism.${orgId}.w.${WS}`;

await test('Tools appear in tools/list', async () => {
    const { body } = await A.client.rpc('tools/list', {}, 100);
    const names = body.result.tools.map((t: any) => t.name);
    for (const n of ['aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_write_draft', 'aimeat_workspace_publish', 'aimeat_workspace_add_document'])
        assert(names.includes(n), `has ${n}`);
});

await test('Create organism (owner 1) + a second organism (owner 2)', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ name: 'WS Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    const o2 = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: JSON.stringify({ name: 'Other Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    otherOrgId = o2.body.data.organism.id;
});

await test('Seed workspace registry + manifest + records schema (REST, owner 1)', async () => {
    await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString() }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest write ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    const sr = await json(`/v1/memory/${encodeURIComponent(`${root()}.shared.notes`)}/schema`, { method: 'PUT', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ schema: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } }, apply_to: 'prefix', schema_mode: 'strict' }) });
    assert(sr.status === 200 || sr.status === 201, `schema ${sr.status}`);
});

await test('1. workspace_list returns the workspace', async () => {
    const b = await A.client.call('aimeat_workspace_list', { organism_id: orgId }, 101);
    const data = JSON.parse(b.result.content[0].text);
    assert(Array.isArray(data.workspaces) && data.workspaces.some((w: any) => w.id === WS), 'lists ws1');
});

await test('2. workspace_read returns the manifest + objectTypes', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 102);
    const data = JSON.parse(b.result.content[0].text);
    assert(data.manifest?.name === 'Main', 'manifest name');
    assert((data.manifest.objectTypes || []).some((o: any) => o.name === 'note'), 'has note type');
});

await test('3. write_draft creates a records draft (object value)', async () => {
    const b = await A.client.call('aimeat_workspace_write_draft', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'n1', value: { title: 'Hello', body: 'first note' } }, 103);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).written.endsWith('shared.notes.n1.draft'), 'wrote draft key');
});

await test('3b. write_draft accepts a JSON-STRINGIFIED value (client coercion)', async () => {
    // Regression: an untyped value made some clients stringify object params → records failed
    // schema ("must be object") and documents stored the raw string. The tool must coerce it.
    const b = await A.client.call('aimeat_workspace_write_draft', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'n2', value: JSON.stringify({ title: 'From string', body: 'coerced' }) }, 1031);
    assert(b.result.isError !== true, `stringified value should be coerced, not rejected: ${b.result.content?.[0]?.text}`);
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 1032);
    const note = (JSON.parse(rd.result.content[0].text).drafts?.note || []).find((d: any) => d.id === 'n2');
    assert(note && note.title === 'From string', 'stored as an object with the right fields (not a raw string)');
});

await test('4. write_draft rejects a schema-invalid record', async () => {
    const b = await A.client.call('aimeat_workspace_write_draft', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'bad', value: { body: 'no title' } }, 104);
    assert(b.result.isError === true, 'rejected (missing required title)');
});

await test('5. workspace_read shows the draft', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 105);
    const data = JSON.parse(b.result.content[0].text);
    assert((data.drafts?.note || []).some((d: any) => d.id === 'n1'), 'draft n1 present');
});

await test('6. publish snapshots the draft → latest + version 1', async () => {
    const b = await A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'n1' }, 106);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).version === 1, 'version 1');
});

await test('7. after publish: object present, draft gone', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 107);
    const data = JSON.parse(b.result.content[0].text);
    assert((data.objects?.note || []).some((o: any) => o.id === 'n1'), 'object n1 published');
    assert(!(data.drafts?.note || []).some((d: any) => d.id === 'n1'), 'draft consumed');
});

await test('8. add_document creates a markdown page draft', async () => {
    const b = await A.client.call('aimeat_workspace_add_document', { organism_id: orgId, ws: WS, type: 'page', title: 'Status', markdown: '# Status\nAll good.' }, 108);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(typeof JSON.parse(b.result.content[0].text).doc_id === 'string', 'returns doc_id');
});

await test('8b. delete removes a published object (draft + latest + versions)', async () => {
    const b = await A.client.call('aimeat_workspace_object_delete', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'n1' }, 1081);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).keys >= 2, 'deleted .latest + .version.1');
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 1082);
    const data = JSON.parse(rd.result.content[0].text);
    assert(!(data.objects?.note || []).some((o: any) => o.id === 'n1'), 'object n1 gone after delete');
});

await test('8c. delete of a missing object errors', async () => {
    const b = await A.client.call('aimeat_workspace_object_delete', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'never-existed' }, 1083);
    assert(b.result.isError === true, 'isError (nothing to delete)');
});

await test('9. membership gate: owner 1 agent cannot read owner 2 organism', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: otherOrgId, ws: WS }, 109);
    assert(b.result.isError === true, 'denied (not a member)');
});

await test('10. unknown organism → not found', async () => {
    const b = await A.client.call('aimeat_workspace_list', { organism_id: 'no-such-org' }, 110);
    assert(b.result.isError === true, 'isError');
});

// ── Bootstrap path: organism_create + workspace_create (custom manifest + schemas) ──
let bootOrgId = '';
const bootWs = { id: '' };

await test('11. organism_create makes a new organism', async () => {
    const b = await A.client.call('aimeat_organism_create', { name: 'Bootstrapped Org', description: 'made by an agent', type: 'project' }, 111);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    bootOrgId = JSON.parse(b.result.content[0].text).organism.id;
    assert(typeof bootOrgId === 'string' && bootOrgId.length > 0, 'returns organism id');
});

await test('12. workspace_create with a custom manifest + schema locks the schema', async () => {
    const manifest = {
        manifestVersion: '1.0', name: 'Bootstrapped', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'document' },
        ],
    };
    const schemas = { 'shared.items': { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } };
    const b = await A.client.call('aimeat_workspace_create', { organism_id: bootOrgId, name: 'Bootstrapped', manifest, schemas }, 112);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    bootWs.id = JSON.parse(b.result.content[0].text).ws;
    assert(typeof bootWs.id === 'string' && bootWs.id.startsWith('ws-'), 'returns ws id');
});

await test('13. created workspace is listed + readable', async () => {
    const l = await A.client.call('aimeat_workspace_list', { organism_id: bootOrgId }, 113);
    assert(JSON.parse(l.result.content[0].text).workspaces.some((w: any) => w.id === bootWs.id), 'in registry');
    const r = await A.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 1131);
    assert((JSON.parse(r.result.content[0].text).manifest.objectTypes || []).some((o: any) => o.name === 'item'), 'manifest has item type');
});

await test('14. the locked schema validates new drafts (valid passes, invalid rejected)', async () => {
    const okDraft = await A.client.call('aimeat_workspace_write_draft', { organism_id: bootOrgId, ws: bootWs.id, namespace: 'shared.items', id: 'i1', value: { title: 'Hello' } }, 114);
    assert(okDraft.result.isError !== true, `valid draft should pass: ${okDraft.result.content?.[0]?.text}`);
    const badDraft = await A.client.call('aimeat_workspace_write_draft', { organism_id: bootOrgId, ws: bootWs.id, namespace: 'shared.items', id: 'bad', value: { nope: 1 } }, 1141);
    assert(badDraft.result.isError === true, 'invalid draft rejected by the locked schema');
});

// ── Cross-member access over MCP: B discovers → requests → A approves → B reads ──
await test('15. owner 2 joins owner 1\'s bootstrapped org', async () => {
    const j = await json(`/v1/organisms/${bootOrgId}/join`, { method: 'POST', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
});

await test('16. B cannot read the workspace before approval', async () => {
    const b = await B.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 116);
    assert(b.result.isError === true, 'denied before access is granted');
});

await test('17. B requests access; A sees it and approves (all over MCP)', async () => {
    const rq = await B.client.call('aimeat_workspace_request_access', { organism_id: bootOrgId, ws: bootWs.id, message: 'let me help' }, 117);
    assert(rq.result.isError !== true, `request: ${rq.result.content?.[0]?.text}`);
    const ls = await A.client.call('aimeat_workspace_list_requests', { organism_id: bootOrgId, ws: bootWs.id }, 1171);
    assert((JSON.parse(ls.result.content[0].text).requests || []).some((r: any) => r.requester === B.ownerName && r.status === 'pending'), 'A sees B pending');
    const ap = await A.client.call('aimeat_workspace_approve_access', { organism_id: bootOrgId, ws: bootWs.id, requester: B.ownerName, decision: 'approve' }, 1172);
    assert(JSON.parse(ap.result.content[0].text).status === 'approved', 'approved');
});

await test('18. B can now read the shared workspace over MCP', async () => {
    const b = await B.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 118);
    assert(b.result.isError !== true, `read after approval: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).manifest?.name === 'Bootstrapped', 'manifest readable after approval');
});

await test('Cleanup owner 1', async () => { const r = await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner 2', async () => { const r = await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
