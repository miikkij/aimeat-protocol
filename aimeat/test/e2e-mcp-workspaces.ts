/**
 * @file e2e-mcp-workspaces.ts
 * @description E2E tests for the MCP workspace tools (aimeat_workspace_list / read / write_draft /
 *   publish / add_document). Sets up an organism + a workspace (registry + manifest + a records
 *   schema) via REST, then drives the tools as the owner's agent over MCP, and checks the
 *   membership gate with a second owner's organism.
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial creation (5 workspace tools).
 *   v1.1.0 — 2026-06-09 — Add test 15b: a member who didn't create a workspace can DISCOVER it via the
 *     MCP list (cross-member registry aggregation regression).
 *   v1.2.0 — 2026-06-09 — Test 15 now joins via MCP aimeat_organism_join (was REST), so 15–18 also cover
 *     the membership-identity fix (join must store the bare owner name the workspace gate checks).
 *   v1.3.0 — 2026-07-11 — Tests 9a–9d: embedded-image URL normalization on write/publish (raw
 *     /v1/storage → owner-addressed /v1/pub + file scoped to the workspace; upload embed_url; missing
 *     file left unchanged).
 *   v1.4.0 — 2026-07-11 — Tests 26–34 (TARGET-028): aimeat_workspace_member_grant/_revoke/_members over
 *     MCP — grant/revoke, upgrade/downgrade, GHII+GAII grantee, multi-workspace grant, non-manager
 *     authorization, decide's explicit `role` + contributor default, and the metadata `source` stamp.
 *   v1.5.0 — 2026-08-11 — Tests 42–43 (August 2026 audit step 8): a publish over MCP appends the same
 *     organism decision-log entry the web publish appends, and workspace_create refuses a blank name
 *     the way POST /v1/organisms/:id/workspaces always has.
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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
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
    return { ownerName, ownerToken, client, agentToken: tk.body.access_token as string, agentGaii };
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
    for (const n of ['aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_object_delete', 'aimeat_organism_overview', 'aimeat_workspace_overview', 'aimeat_workspace_member_grant', 'aimeat_workspace_member_revoke', 'aimeat_workspace_members'])
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
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'n1', value: { title: 'Hello', body: 'first note' } }, 103);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).written.endsWith('shared.notes.n1.draft'), 'wrote draft key');
});

await test('3b. write_draft accepts a JSON-STRINGIFIED value (client coercion)', async () => {
    // Regression: an untyped value made some clients stringify object params → records failed
    // schema ("must be object") and documents stored the raw string. The tool must coerce it.
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'n2', value: JSON.stringify({ title: 'From string', body: 'coerced' }) }, 1031);
    assert(b.result.isError !== true, `stringified value should be coerced, not rejected: ${b.result.content?.[0]?.text}`);
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: ['n2'] }, 1032);
    const item = (JSON.parse(rd.result.content[0].text).items || []).find((d: any) => d.id === 'n2');
    assert(item && item.value.title === 'From string', 'stored as an object with the right fields (not a raw string)');
});

await test('4. write_draft rejects a schema-invalid record', async () => {
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'bad', value: { body: 'no title' } }, 104);
    assert(b.result.isError === true, 'rejected (missing required title)');
});

await test('5. workspace_read index flags the draft', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 105);
    const data = JSON.parse(b.result.content[0].text);
    assert(data.mode === 'index', 'default read is index mode');
    const entry = (data.index?.note || []).find((e: any) => e.id === 'n1');
    assert(entry && entry.has_draft === true, 'draft n1 flagged in index');
    assert(entry && entry.title === 'Hello', 'index carries the title without the body');
});

await test('6. publish snapshots the draft → latest + version 1', async () => {
    const b = await A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'n1' }, 106);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).version === 1, 'version 1');
});

await test('7. after publish: object present, draft gone', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 107);
    const data = JSON.parse(b.result.content[0].text);
    const entry = (data.index?.note || []).find((e: any) => e.id === 'n1');
    assert(entry && entry.published === true, 'object n1 published');
    assert(entry && entry.has_draft === false, 'draft consumed');
    // Batch-open returns the full published value for the id.
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: ['n1'] }, 1071);
    const item = (JSON.parse(rd.result.content[0].text).items || []).find((d: any) => d.id === 'n1');
    assert(item && item.published === true && item.value.title === 'Hello', 'batch-open returns the full published value');
});

await test('7c. index carries bytes, and batch-open reports unknown ids as missing', async () => {
    const b = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 1072);
    const data = JSON.parse(b.result.content[0].text);
    const entry = (data.index?.note || []).find((e: any) => e.id === 'n1');
    assert(entry && typeof entry.bytes === 'number' && entry.bytes > 0, 'index entry reports a byte size');
    assert(entry && entry.body === undefined && entry.value === undefined, 'index carries NO body/value');
    assert(typeof data.counts?.note === 'number', 'index reports per-space counts');
    // Failure mode: a batch-open for an id that does not exist comes back in `missing`, not as a hard error.
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: ['n1', 'does-not-exist'] }, 1073);
    const res = JSON.parse(rd.result.content[0].text);
    assert(rd.result.isError !== true, 'batch-open with a bad id is not a hard error');
    assert((res.items || []).some((i: any) => i.id === 'n1'), 'the valid id still resolves');
    assert((res.missing || []).includes('does-not-exist'), 'the unknown id is reported as missing');
});

await test('7b. agent write/publish → .latest owned by the GHII; read-dedup + collapse of a forked key', async () => {
    const base = `${root()}.shared.notes.dedup1`;
    const latestKey = encodeURIComponent(`${base}.latest`);
    const ownerH = { Authorization: `Bearer ${A.ownerToken}` };
    const agentH = { Authorization: `Bearer ${A.agentToken}` };
    const wr = (title: string) => A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'dedup1', value: { title, body: 'x' } }, 1070);
    const pub = () => A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'dedup1' }, 1071);

    // Agent authors + publishes twice → .latest at version 2.
    await wr('DDP-v1'); await pub(); await wr('DDP-v2'); await pub();

    // .latest is owned by the member's GHII, not the agent's GAII: the owner (GHII) reads it, the agent does not.
    const asOwner = await json(`/v1/memory/${latestKey}`, { headers: ownerH });
    const asAgent = await json(`/v1/memory/${latestKey}`, { headers: agentH });
    assert(asOwner.status === 200 && asOwner.body.data.value.title === 'DDP-v2', `.latest readable by owner (GHII), got ${asOwner.status}`);
    assert(asAgent.status === 404, `.latest must NOT be owned by the agent GAII, got ${asAgent.status}`);
    assert(asOwner.body.data.version === 2, `.latest at version 2, got ${asOwner.body.data.version}`);

    // Seed a STALE forked copy of .latest under the agent GAII (raw same-owner memory write → version 1).
    const seed = await json('/v1/memory', { method: 'POST', headers: agentH, body: JSON.stringify({ key: `${base}.latest`, value: { id: 'dedup1', title: 'DDP-STALE', body: 'x' }, visibility: 'private' }) });
    assert(seed.status === 201, `seed fork ${seed.status}: ${JSON.stringify(seed.body.error)}`);
    assert((await json(`/v1/memory/${latestKey}`, { headers: agentH })).status === 200, 'agent-owned fork seeded');

    // Read-dedup: the workspace read surfaces the FRESHEST (v2), never the stale lower-version fork.
    const wsRead = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: ownerH });
    const ddp = (wsRead.body.data.objects.note as any[]).find((n: any) => n.id === 'dedup1');
    assert(ddp?.title === 'DDP-v2', `read-dedup must return the freshest DDP-v2, got ${ddp?.title}`);

    // Re-publish → collapse removes the agent-owned fork; one owner (the GHII) remains.
    await wr('DDP-v3'); await pub();
    assert((await json(`/v1/memory/${latestKey}`, { headers: agentH })).status === 404, 'agent-owned fork collapsed after publish');
    const after = await json(`/v1/memory/${latestKey}`, { headers: ownerH });
    assert(after.status === 200 && after.body.data.value.title === 'DDP-v3', `GHII .latest advanced to DDP-v3, got ${after.body.data.value.title}`);
});

await test('8. workspace_write creates a markdown document draft (document space, auto id)', async () => {
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'page', value: { title: 'Status', markdown: '# Status\nAll good.' } }, 108);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const out = JSON.parse(b.result.content[0].text);
    assert(typeof out.id === 'string' && out.id.startsWith('doc-') && out.mode === 'document', `returns doc id + mode: ${JSON.stringify(out)}`);
});

await test('8e. workspace_overview returns an OKF-style Markdown map (frontmatter + spaces)', async () => {
    const b = await A.client.call('aimeat_workspace_overview', { organism_id: orgId, ws: WS }, 1087);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const md = b.result.content[0].text as string;
    assert(md.includes('okf_type: workspace-structure-overview'), `OKF frontmatter:\n${md}`);
    assert(md.includes(`workspace_id: ${WS}`), 'frontmatter ws id');
    assert(md.includes('## note (records)'), `note space header:\n${md}`);
    assert(md.includes('`n1`'), 'published note id n1 listed');
});

await test('8f. organism_overview lists the workspace with a breakdown', async () => {
    const b = await A.client.call('aimeat_organism_overview', { organism_id: orgId }, 1088);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const md = b.result.content[0].text as string;
    assert(md.includes('okf_type: organism-structure-overview'), `OKF frontmatter:\n${md}`);
    assert(md.includes(`\`${WS}\``), 'workspace id listed');
    assert(md.includes('note ('), `note breakdown:\n${md}`);
});

await test('8g. overview membership gate: A cannot overview owner 2 organism', async () => {
    const b = await A.client.call('aimeat_organism_overview', { organism_id: otherOrgId }, 1089);
    assert(b.result.isError === true, 'denied (not a member)');
});

// ── Embedded-image URL normalization ──
// MCP-authored docs used to store raw ![](/v1/storage/<key>) URLs that loaded for nobody but the file
// owner (the GET is owner-scoped + token-gated). On write + publish the backend now rewrites embedded
// images to the owner-addressed /v1/pub form AND scopes the file to THIS workspace (members-only —
// never the public internet). The upload response also hands back a ready embed_url.
const IMG_KEY = `img/pyramid-${Date.now()}.png`;
const PNG_1x1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const embedUrlFor = (gaii: string, key: string) => `/v1/pub/${encodeURIComponent(gaii)}/${key.split('/').map(encodeURIComponent).join('/')}`;
let imgAgentGaii = '', imgAgentToken = '', imgDocId = '';

await test('9a. storage upload response carries owner_gaii + embed_url/embed_markdown', async () => {
    // A storage-capable agent of owner 1 uploads the image (default agent scopes exclude storage).
    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ name: `imgagent${Date.now()}`, owner: A.ownerName, capabilities: ['storage'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `img agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    imgAgentGaii = ag.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: imgAgentGaii, timestamp: ts, signature: await signMsg(ag.body.data.private_key, imgAgentGaii + ts) }) });
    imgAgentToken = tok.body.data.token;
    const up = await json('/v1/storage', { method: 'POST', headers: { Authorization: `Bearer ${imgAgentToken}` }, body: JSON.stringify({ key: IMG_KEY, data: PNG_1x1_B64, mime_type: 'image/png', visibility: 'private' }) });
    assert(up.status === 201, `upload ${up.status}: ${JSON.stringify(up.body.error || up.body)}`);
    assert(up.body.data.owner_gaii === imgAgentGaii, `owner_gaii in response: ${up.body.data.owner_gaii}`);
    assert(up.body.data.embed_url === embedUrlFor(imgAgentGaii, IMG_KEY), `embed_url: ${up.body.data.embed_url}`);
    assert(typeof up.body.data.embed_markdown === 'string' && up.body.data.embed_markdown.includes(up.body.data.embed_url), 'embed_markdown wraps embed_url');
});

await test('9b. write doc embedding /v1/storage/<key> → stored markdown rewritten to /v1/pub + file scoped to the workspace', async () => {
    const md = `# Pyramid\n\n![pyramid](/v1/storage/${IMG_KEY})\n`;
    const w = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'page', value: { title: 'Pyramid', markdown: md } }, 190);
    assert(w.result.isError !== true, `write error: ${w.result.content?.[0]?.text}`);
    imgDocId = JSON.parse(w.result.content[0].text).id;
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: [imgDocId] }, 191);
    const item = (JSON.parse(rd.result.content[0].text).items || []).find((d: any) => d.id === imgDocId);
    assert(item, 'doc readable');
    const stored = item.value.markdown as string;
    assert(!stored.includes(`/v1/storage/${IMG_KEY}`), `raw /v1/storage URL must be gone: ${stored}`);
    assert(stored.includes(embedUrlFor(imgAgentGaii, IMG_KEY)), `rewritten to owner-addressed /v1/pub: ${stored}`);
    // The file is now workspace-scoped (members-only), NOT public.
    const head = await fetch(`${BASE}/v1/storage/${IMG_KEY}`, { method: 'HEAD', headers: { Authorization: `Bearer ${imgAgentToken}` } });
    assert(head.status === 200, `HEAD own file ${head.status}`);
    assert(head.headers.get('x-aimeat-visibility') === 'workspace', `file scoped to workspace, got ${head.headers.get('x-aimeat-visibility')}`);
});

await test('9c. publish → .latest markdown also carries the /v1/pub URL', async () => {
    const p = await A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.pages', id: imgDocId }, 192);
    assert(p.result.isError !== true, `publish error: ${p.result.content?.[0]?.text}`);
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: [imgDocId] }, 193);
    const item = (JSON.parse(rd.result.content[0].text).items || []).find((d: any) => d.id === imgDocId);
    assert(item && item.published === true, 'doc published');
    assert((item.value.markdown as string).includes(embedUrlFor(imgAgentGaii, IMG_KEY)), 'published markdown carries /v1/pub URL');
});

await test('9d. an embed pointing at a NON-existent file is left unchanged (never rewritten to a wrong target)', async () => {
    const missing = `/v1/storage/img/does-not-exist-${Date.now()}.png`;
    const w = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'page', value: { title: 'Missing', markdown: `![x](${missing})` } }, 194);
    assert(w.result.isError !== true, `write error: ${w.result.content?.[0]?.text}`);
    const id = JSON.parse(w.result.content[0].text).id;
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: [id] }, 195);
    const item = (JSON.parse(rd.result.content[0].text).items || []).find((d: any) => d.id === id);
    assert(item && (item.value.markdown as string).includes(missing), `unresolved embed left as-is: ${item?.value?.markdown}`);
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

await test('8d. delete also removes a BARE record key (no .latest) — regression', async () => {
    // A record stored as a bare, un-suffixed key — workspace_read surfaces it as the current value.
    // Earlier the delete only matched `${base}.{latest,draft,version.N}`, so the bare key survived
    // (delete said "deleted"/"nothing to delete" while the object kept showing). It must be removed.
    const key = `${root()}.shared.notes.bare1`;
    const w = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` }, body: JSON.stringify({ key, value: { id: 'bare1', title: 'Bare note' }, visibility: 'private' }) });
    assert(w.status === 201 || w.status === 200, `bare write ${w.status}: ${JSON.stringify(w.body.error)}`);
    const rd1 = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 1084);
    assert((JSON.parse(rd1.result.content[0].text).index?.note || []).some((o: any) => o.id === 'bare1'), 'bare record visible before delete');
    const del = await A.client.call('aimeat_workspace_object_delete', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'bare1' }, 1085);
    assert(del.result.isError !== true, `delete error: ${del.result.content?.[0]?.text}`);
    assert(JSON.parse(del.result.content[0].text).keys >= 1, 'deleted the bare key');
    const rd2 = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS }, 1086);
    assert(!(JSON.parse(rd2.result.content[0].text).index?.note || []).some((o: any) => o.id === 'bare1'), 'bare record gone after delete');
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

await test('12b. workspace_create with an objectTypes-ONLY manifest backfills the envelope (first-call success)', async () => {
    // Regression: the tool's own documented manifest example never showed `manifestVersion` (a
    // meta-schema required field), and _create backfilled only id+status — so a manifest built from
    // the docs was rejected on the first call and agents had to iterate. The envelope
    // (manifestVersion/id/name/kind/status) is now backfilled: an objectTypes-only manifest succeeds.
    const manifest = {
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
        ],
    };
    const b = await A.client.call('aimeat_workspace_create', { organism_id: bootOrgId, name: 'Envelope Backfill', manifest }, 1120);
    assert(b.result.isError !== true, `objectTypes-only manifest must be accepted first try: ${b.result.content?.[0]?.text}`);
    const wsId = JSON.parse(b.result.content[0].text).ws;
    assert(typeof wsId === 'string' && wsId.startsWith('ws-'), 'returns ws id');
    // Read it back: the envelope was filled — manifestVersion default, kind default, name from the param.
    const r = await A.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: wsId }, 1121);
    const man = JSON.parse(r.result.content[0].text).manifest;
    assert(man.manifestVersion === '1.0', `manifestVersion backfilled to 1.0, got ${man.manifestVersion}`);
    assert(man.kind === 'project', `kind backfilled to project, got ${man.kind}`);
    assert(man.name === 'Envelope Backfill', `name backfilled from the tool's name param, got ${man.name}`);
    assert(man.status === 'active', `status backfilled to active, got ${man.status}`);
    assert(man.id === bootOrgId, `id forced to the organism id, got ${man.id}`);
});

await test('13. created workspace is listed + readable', async () => {
    const l = await A.client.call('aimeat_workspace_list', { organism_id: bootOrgId }, 113);
    assert(JSON.parse(l.result.content[0].text).workspaces.some((w: any) => w.id === bootWs.id), 'in registry');
    const r = await A.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 1131);
    assert((JSON.parse(r.result.content[0].text).manifest.objectTypes || []).some((o: any) => o.name === 'item'), 'manifest has item type');
});

await test('14. the locked schema validates new drafts (valid passes, invalid rejected)', async () => {
    const okDraft = await A.client.call('aimeat_workspace_write', { organism_id: bootOrgId, ws: bootWs.id, space: 'item', id: 'i1', value: { title: 'Hello' } }, 114);
    assert(okDraft.result.isError !== true, `valid draft should pass: ${okDraft.result.content?.[0]?.text}`);
    const badDraft = await A.client.call('aimeat_workspace_write', { organism_id: bootOrgId, ws: bootWs.id, space: 'item', id: 'bad', value: { nope: 1 } }, 1141);
    assert(badDraft.result.isError === true, 'invalid draft rejected by the locked schema');
});

// ── Cross-member access over MCP: B discovers → requests → A approves → B reads ──
await test('15. owner 2 joins owner 1\'s bootstrapped org (via MCP aimeat_organism_join)', async () => {
    // Use the MCP join tool (not REST) so this also covers the membership-identity fix: join must store
    // the BARE owner name (like organism_create), or the workspace membership gate — which checks the
    // bare name — would reject B in an org it just joined. With the old full-GHII join, 15b/16/17/18 fail.
    const j = await B.client.call('aimeat_organism_join', { organism_id: bootOrgId }, 115);
    assert(j.result.isError !== true, `join: ${j.result.content?.[0]?.text}`);
    assert(JSON.parse(j.result.content[0].text).status === 'joined', 'joined (open policy)');
});

await test('15b. B can DISCOVER A\'s workspace via MCP list (cross-member registry aggregation)', async () => {
    // Regression: workspace_list used to read only the caller's own registry record, so a member who
    // did NOT create the workspace saw an empty list even though the workspace exists (and read would
    // find it). It must aggregate every member's registry — like workspace_read / the REST list.
    const l = await B.client.call('aimeat_workspace_list', { organism_id: bootOrgId }, 1151);
    const data = JSON.parse(l.result.content[0].text);
    assert(Array.isArray(data.workspaces) && data.workspaces.some((w: any) => w.id === bootWs.id),
        `B (member, not creator) must see A's workspace in the list: ${JSON.stringify(data.workspaces)}`);
});

await test('15c. B (member, NOT yet approved) is DENIED write over MCP-serve too (gate parity with REST)', async () => {
    // The MCP-serve write path used to write ungated — looser than the REST path, so a non-approved
    // member could write before approval. Now MCP-serve enforces canWriteWs, so content stays
    // creator-gated regardless of path. (Approved-member write + name/namespace resolution → test 18b.)
    const byName = await B.client.call('aimeat_workspace_write',
        { organism_id: bootOrgId, ws: bootWs.id, space: 'item', id: 'b-item-1', value: { title: 'B by name' } }, 1152);
    assert(byName.result.isError === true, 'a non-approved member must be denied write');
});

await test('16. B cannot read the workspace before approval', async () => {
    const b = await B.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 116);
    assert(b.result.isError === true, 'denied before access is granted');
});

await test('17. B requests access; A sees it and approves (all over MCP)', async () => {
    const rq = await B.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'request', message: 'let me help' }, 117);
    assert(rq.result.isError !== true, `request: ${rq.result.content?.[0]?.text}`);
    const ls = await A.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'list' }, 1171);
    assert((JSON.parse(ls.result.content[0].text).requests || []).some((r: any) => r.requester === B.ownerName && r.status === 'pending'), 'A sees B pending');
    const ap = await A.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'decide', requester: B.ownerName, decision: 'approve' }, 1172);
    assert(JSON.parse(ap.result.content[0].text).status === 'approved', 'approved');
});

await test('18. B can now read the shared workspace over MCP', async () => {
    const b = await B.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 118);
    assert(b.result.isError !== true, `read after approval: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).manifest?.name === 'Bootstrapped', 'manifest readable after approval');
});

await test('18b. approved B writes a record — by space NAME and by NAMESPACE (manifest resolution)', async () => {
    // An approved member can write (gate passes), and write resolves the space by either the objectType
    // NAME ('item') or its namespace ('shared.items') — small models often pass the namespace.
    const byName = await B.client.call('aimeat_workspace_write',
        { organism_id: bootOrgId, ws: bootWs.id, space: 'item', id: 'b-item-1', value: { title: 'B by name' } }, 1181);
    assert(byName.result.isError !== true, `approved member write by name: ${byName.result.content?.[0]?.text}`);
    const byNs = await B.client.call('aimeat_workspace_write',
        { organism_id: bootOrgId, ws: bootWs.id, space: 'shared.items', id: 'b-item-2', value: { title: 'B by namespace' } }, 1182);
    assert(byNs.result.isError !== true, `approved member write by namespace: ${byNs.result.content?.[0]?.text}`);
});

await test("19. A's OWN agent (same owner) reads + writes A's workspace via the REST route (sub-agent access)", async () => {
    // Bug: the REST workspace route resolved the caller to its GAII and gated content as `private`, so a
    // SAME-OWNER sub-agent saw list:[] / manifest:null / NO_SPACE for its own owner's workspace, and the
    // owner could not see the sub-agent's writes. Fix: same-owner records pass the read guard both ways.
    const ah = { Authorization: `Bearer ${A.agentToken}` };
    // list — the membership-gated discovery route shows the workspace (a raw memory prefix read was empty)
    const list = await json(`/v1/organisms/${bootOrgId}/workspaces`, { headers: ah });
    assert(list.status === 200 && (list.body.data.workspaces || []).some((w: any) => w.id === bootWs.id), `sub-agent list: ${JSON.stringify(list.body)}`);
    // read — the manifest is visible to the same-owner sub-agent (was null)
    const read = await json(`/v1/organisms/${bootOrgId}/workspace?ws=${bootWs.id}`, { headers: ah });
    assert(read.status === 200 && read.body.data.manifest?.name === 'Bootstrapped', `sub-agent manifest: ${JSON.stringify(read.body.data?.manifest)}`);
    // write a record UNDER THE AGENT'S OWN GAII (attribution), then read it back as the agent
    const wkey = `organism.${bootOrgId}.w.${bootWs.id}.shared.items.agent-rec-1.draft`;
    const wr = await json('/v1/memory', { method: 'POST', headers: ah, body: JSON.stringify({ key: wkey, value: { id: 'agent-rec-1', title: 'from A agent' }, visibility: 'private' }) });
    assert(wr.status === 200 || wr.status === 201, `sub-agent write ${wr.status}: ${JSON.stringify(wr.body)}`);
    const read2 = await json(`/v1/organisms/${bootOrgId}/workspace?ws=${bootWs.id}`, { headers: ah });
    assert((read2.body.data.drafts?.item || []).some((o: any) => o.id === 'agent-rec-1'), `agent sees its own draft: ${JSON.stringify(read2.body.data.drafts)}`);
    // the OWNER session sees the sub-agent's write (same-owner aggregation, the other direction)
    const ownerRead = await json(`/v1/organisms/${bootOrgId}/workspace?ws=${bootWs.id}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
    assert((ownerRead.body.data.drafts?.item || []).some((o: any) => o.id === 'agent-rec-1'), `owner sees agent draft: ${JSON.stringify(ownerRead.body.data.drafts)}`);
});

await test('20. B (cross-owner, APPROVED) can read + write A\'s workspace via the REST/connector path', async () => {
    // The collaboration case: a DIFFERENT owner, a member of the org, APPROVED into the workspace (17/18),
    // must be able to read + write through the connector/REST path (agent token), not just over MCP-serve.
    const bh = { Authorization: `Bearer ${B.agentToken}` };
    const read = await json(`/v1/organisms/${bootOrgId}/workspace?ws=${bootWs.id}`, { headers: bh });
    assert(read.status === 200 && read.body.data.manifest?.name === 'Bootstrapped', `approved cross-owner read: ${JSON.stringify(read.body.data?.manifest ?? read.body)}`);
    const wkey = `organism.${bootOrgId}.w.${bootWs.id}.shared.items.b-rest-1.draft`;
    const wr = await json('/v1/memory', { method: 'POST', headers: bh, body: JSON.stringify({ key: wkey, value: { id: 'b-rest-1', title: 'B via REST' }, visibility: 'private' }) });
    assert(wr.status === 200 || wr.status === 201, `approved cross-owner write ${wr.status}: ${JSON.stringify(wr.body)}`);
});

await test("21. an agent's MCP-serve write is attributed to its GAII (not collapsed onto the owner)", async () => {
    // i1 / b-item-* were written by AGENTS over MCP-serve. The activity must attribute them to the
    // agent — the MCP-serve path used to write content under ownerGhii, so every agent action showed
    // as the owner. Now content is authored under writerGaii (the agent's own GAII).
    const agentName = A.agentGaii.split('#')[0];
    const a = await json(`/v1/organisms/${bootOrgId}/workspace/activity?ws=${bootWs.id}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
    assert(a.status === 200, `activity ${a.status}: ${JSON.stringify(a.body)}`);
    const events = a.body.data.events ?? [];
    assert(events.some((e: any) => e.agent === agentName), `expected an event attributed to agent "${agentName}", got agents: ${JSON.stringify([...new Set(events.map((e: any) => e.agent))])}`);
});

// ── Creator-managed workspace roles: viewer (read) vs contributor (read+write), grant/revoke ──
const aOwner = () => ({ Authorization: `Bearer ${A.ownerToken}` });
const bAgent = () => ({ Authorization: `Bearer ${B.agentToken}` });
const bWrite = (id: string) => json('/v1/memory', { method: 'POST', headers: bAgent(), body: JSON.stringify({ key: `organism.${bootOrgId}.w.${bootWs.id}.shared.items.${id}.draft`, value: { id, title: 'x' }, visibility: 'private' }) });
const bReadManifest = async () => (await json(`/v1/organisms/${bootOrgId}/workspace?ws=${bootWs.id}`, { headers: bAgent() })).body.data.manifest;

await test('22. creator REVOKES B → B can no longer read or write (revoke is effective)', async () => {
    const rv = await json(`/v1/organisms/${bootOrgId}/workspace-access/revoke`, { method: 'POST', headers: aOwner(), body: JSON.stringify({ ws: bootWs.id, grantee: B.ownerName }) });
    assert(rv.status === 200, `revoke ${rv.status}: ${JSON.stringify(rv.body)}`);
    assert((await bReadManifest()) === null, 'B read is empty after revoke');
    const wr = await bWrite('b-after-revoke');
    assert(wr.status === 403, `B write must be denied after revoke, got ${wr.status}: ${JSON.stringify(wr.body)}`);
});

await test('23. creator grants B the VIEWER role → B reads but cannot write', async () => {
    const g = await json(`/v1/organisms/${bootOrgId}/workspace-access/grant`, { method: 'POST', headers: aOwner(), body: JSON.stringify({ ws: bootWs.id, grantee: B.ownerName, role: 'viewer' }) });
    assert(g.status === 200 && g.body.data.role === 'viewer', `grant viewer ${g.status}: ${JSON.stringify(g.body)}`);
    assert((await bReadManifest())?.name === 'Bootstrapped', 'viewer B can read the manifest');
    const wr = await bWrite('b-viewer');
    assert(wr.status === 403, `viewer B write must be denied, got ${wr.status}: ${JSON.stringify(wr.body)}`);
});

await test('24. creator upgrades B to CONTRIBUTOR → B reads and writes; members list shows the role', async () => {
    const g = await json(`/v1/organisms/${bootOrgId}/workspace-access/grant`, { method: 'POST', headers: aOwner(), body: JSON.stringify({ ws: bootWs.id, grantee: B.ownerName, role: 'contributor' }) });
    assert(g.status === 200 && g.body.data.role === 'contributor', `grant contributor ${g.status}: ${JSON.stringify(g.body)}`);
    assert((await bReadManifest())?.name === 'Bootstrapped', 'contributor B can read');
    const wr = await bWrite('b-contrib');
    assert(wr.status === 200 || wr.status === 201, `contributor B write ${wr.status}: ${JSON.stringify(wr.body)}`);
    const list = await json(`/v1/organisms/${bootOrgId}/workspace-access?ws=${bootWs.id}`, { headers: aOwner() });
    assert((list.body.data.members || []).some((m: any) => m.owner === B.ownerName && m.role === 'contributor'), `members list shows B as contributor: ${JSON.stringify(list.body.data?.members)}`);
});

await test("25. workspace is SHARED — the creator sees a contributor's write (cross-owner content visible)", async () => {
    // B (contributor) wrote 'b-contrib' under B's own identity in test 24. The workspace read is at the
    // workspace level: anyone who can read the workspace sees ALL content, whoever wrote it — so the
    // creator (and any viewer/contributor) sees a contributor's records, not just their own.
    const r = await A.client.call('aimeat_workspace_read', { organism_id: bootOrgId, ws: bootWs.id }, 125);
    assert(r.result.isError !== true, `creator read: ${r.result.content?.[0]?.text}`);
    const data = JSON.parse(r.result.content[0].text);
    const itemIndex = (data.index?.item || []);
    assert(itemIndex.some((o: any) => o.id === 'b-contrib' && o.has_draft), `creator must see contributor B's draft in the index: ${JSON.stringify(itemIndex.map((o: any) => o.id))}`);
});

// ── TARGET-028: proactive member grant/revoke + members listing over MCP (aimeat_workspace_member_*) ──
// Entering here (after test 24/25) B is a CONTRIBUTOR on bootWs, granted via the REST /grant path.
const membersMcp = async (caller: typeof A, ws: string, id: number) =>
    JSON.parse((await caller.client.call('aimeat_workspace_members', { organism_id: bootOrgId, ws }, id)).result.content[0].text);

await test('26. aimeat_workspace_members (MCP) lists B as contributor with grant source', async () => {
    const m = await A.client.call('aimeat_workspace_members', { organism_id: bootOrgId, ws: bootWs.id }, 126);
    assert(m.result.isError !== true, `members: ${m.result.content?.[0]?.text}`);
    const bRow = (JSON.parse(m.result.content[0].text).members || []).find((x: any) => x.owner === B.ownerName);
    assert(bRow && bRow.role === 'contributor', `B is contributor: ${JSON.stringify(bRow)}`);
    assert(bRow.source === 'grant', `grant source stamped (test 24 used REST /grant), got ${bRow.source}`);
});

await test('27. aimeat_workspace_member_revoke (MCP) removes B → B loses access; members drops B', async () => {
    const rv = await A.client.call('aimeat_workspace_member_revoke', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.ownerName }, 127);
    assert(rv.result.isError !== true, `revoke: ${rv.result.content?.[0]?.text}`);
    const rvd = JSON.parse(rv.result.content[0].text);
    assert(rvd.revoked === 1 && rvd.results[0].status === 'revoked', `revoked 1: ${JSON.stringify(rvd)}`);
    assert((await bReadManifest()) === null, 'B read empty after MCP revoke');
    assert(!(await membersMcp(A, bootWs.id, 1271)).members.some((x: any) => x.owner === B.ownerName), 'B removed from members list');
});

await test('28. aimeat_workspace_member_grant (MCP) adds B as VIEWER → reads, cannot write; source=grant, granted_by=A', async () => {
    const g = await A.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.ownerName, role: 'viewer' }, 128);
    assert(g.result.isError !== true, `grant: ${g.result.content?.[0]?.text}`);
    const gd = JSON.parse(g.result.content[0].text);
    assert(gd.granted === 1 && gd.results[0].status === 'granted', `granted 1: ${JSON.stringify(gd)}`);
    assert((await bReadManifest())?.name === 'Bootstrapped', 'viewer B can read');
    assert((await bWrite('b-viewer-mcp')).status === 403, 'viewer B write denied');
    const bRow = (await membersMcp(A, bootWs.id, 1281)).members.find((x: any) => x.owner === B.ownerName);
    assert(bRow?.role === 'viewer' && bRow?.source === 'grant', `B viewer via grant: ${JSON.stringify(bRow)}`);
    assert(bRow?.granted_by === A.ownerName, `granted_by is A: ${JSON.stringify(bRow)}`);
});

await test('29. member_grant UPGRADES B viewer → contributor (B writes; exactly one role row, no dup)', async () => {
    const g = await A.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.ownerName, role: 'contributor' }, 129);
    assert(g.result.isError !== true, `upgrade: ${g.result.content?.[0]?.text}`);
    const wr = await bWrite('b-contrib-mcp');
    assert(wr.status === 200 || wr.status === 201, `contributor B writes, got ${wr.status}`);
    const rows = (await membersMcp(A, bootWs.id, 1291)).members.filter((x: any) => x.owner === B.ownerName);
    assert(rows.length === 1 && rows[0].role === 'contributor', `single contributor row (re-grant replaced prior): ${JSON.stringify(rows)}`);
});

await test('30. member_grant DOWNGRADES B contributor → viewer (write denied again)', async () => {
    const g = await A.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.ownerName, role: 'viewer' }, 130);
    assert(g.result.isError !== true, `downgrade: ${g.result.content?.[0]?.text}`);
    assert((await bReadManifest())?.name === 'Bootstrapped', 'downgraded B still reads');
    assert((await bWrite('b-downgraded')).status === 403, 'downgraded B write denied');
});

await test('31. member_grant accepts a GAII grantee → the grant applies to the OWNER (agents inherit)', async () => {
    const g = await A.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.agentGaii, role: 'contributor' }, 131);
    assert(g.result.isError !== true, `GAII grant: ${g.result.content?.[0]?.text}`);
    assert(JSON.parse(g.result.content[0].text).grantee === B.ownerName, 'GAII resolved to owner');
    assert((await membersMcp(A, bootWs.id, 1311)).members.some((x: any) => x.owner === B.ownerName && x.role === 'contributor'), 'owner-keyed member from GAII grant');
});

await test('32. a non-manager (B) cannot grant or list members (authorization)', async () => {
    const g = await B.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, ws: bootWs.id, grantee: A.ownerName, role: 'viewer' }, 132);
    const gd = JSON.parse(g.result.content[0].text);
    assert(gd.granted === 0 && gd.results.every((r: any) => r.status === 'forbidden_or_not_found'), `B (member, not manager) grant refused per-ws: ${JSON.stringify(gd)}`);
    const m = await B.client.call('aimeat_workspace_members', { organism_id: bootOrgId, ws: bootWs.id }, 1321);
    assert(m.result.isError === true, 'B cannot list members (not creator/admin)');
});

await test('33. member_grant adds B to MANY workspaces in ONE call (workspaces:[...])', async () => {
    const c = await A.client.call('aimeat_workspace_create', { organism_id: bootOrgId, name: 'Second',
        manifest: { manifestVersion: '1.0', name: 'Second', kind: 'project', status: 'active', objectTypes: [{ name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] } }, 133);
    assert(c.result.isError !== true, `create ws2: ${c.result.content?.[0]?.text}`);
    const ws2 = JSON.parse(c.result.content[0].text).ws;
    const g = await A.client.call('aimeat_workspace_member_grant', { organism_id: bootOrgId, workspaces: [bootWs.id, ws2], grantee: B.ownerName, role: 'contributor' }, 1331);
    const gd = JSON.parse(g.result.content[0].text);
    assert(gd.granted === 2 && gd.total === 2, `granted to both workspaces: ${JSON.stringify(gd)}`);
    assert((await membersMcp(A, ws2, 1332)).members.some((x: any) => x.owner === B.ownerName && x.role === 'contributor'), 'B is contributor on the second workspace');
});

await test('34. workspace_access decide honors an explicit role, defaults to contributor (back-compat)', async () => {
    await A.client.call('aimeat_workspace_member_revoke', { organism_id: bootOrgId, ws: bootWs.id, grantee: B.ownerName }, 134);
    await B.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'request' }, 1341);
    const ap = await A.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'decide', requester: B.ownerName, decision: 'approve', role: 'viewer' }, 1342);
    assert(JSON.parse(ap.result.content[0].text).role === 'viewer', 'decide granted the explicit viewer role');
    assert((await bWrite('b-decide-viewer')).status === 403, 'decide-viewer B cannot write');
    const bRow = (await membersMcp(A, bootWs.id, 1343)).members.find((x: any) => x.owner === B.ownerName);
    assert(bRow?.role === 'viewer' && bRow?.source === 'request', `decide grant source=request: ${JSON.stringify(bRow)}`);
    const ap2 = await A.client.call('aimeat_workspace_access', { organism_id: bootOrgId, ws: bootWs.id, action: 'decide', requester: B.ownerName, decision: 'approve' }, 1344);
    assert(JSON.parse(ap2.result.content[0].text).role === 'contributor', 'decide default (no role) stays contributor');
});

// ── Batch writes: one tool CALL for a whole migration ──
// An MCP client asks the human to approve every call, so N documents used to mean N approval
// prompts — and one unanswered prompt left the migration half-done ("No approval received").
const readIds = async (ids: string[], id: number) => {
    const rd = await A.client.call('aimeat_workspace_read', { organism_id: orgId, ws: WS, ids }, id);
    return (JSON.parse(rd.result.content[0].text).items || []) as any[];
};

await test('35. items[] writes several records in ONE call', async () => {
    const b = await A.client.call('aimeat_workspace_write', {
        organism_id: orgId, ws: WS, space: 'note',
        items: [
            { id: 'batch-1', value: { title: 'One', body: 'first' } },
            { id: 'batch-2', value: { title: 'Two', body: 'second' } },
            { id: 'batch-3', value: { title: 'Three', body: 'third' } },
        ],
    }, 135);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const data = JSON.parse(b.result.content[0].text);
    assert(data.count === 3, `count 3, got ${data.count}`);
    assert(data.items.length === 3 && data.items.every((i: any) => i.written.endsWith('.draft')), 'every item reports its key');
    const found = await readIds(['batch-1', 'batch-2', 'batch-3'], 1351);
    assert(found.length === 3, `all three readable, got ${found.length}`);
    assert(found.find((d: any) => d.id === 'batch-2')?.value.title === 'Two', 'content landed intact');
});

await test('36. items inherit the top-level space', async () => {
    const b = await A.client.call('aimeat_workspace_write', {
        organism_id: orgId, ws: WS, space: 'note',
        items: [{ id: 'inherit-1', value: { title: 'Inherited' } }],
    }, 136);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    assert(JSON.parse(b.result.content[0].text).items[0].written.includes('shared.notes.inherit-1'), 'used the top-level space');
});

await test('37. ONE bad item writes NOTHING (all-or-nothing) and names its index', async () => {
    const b = await A.client.call('aimeat_workspace_write', {
        organism_id: orgId, ws: WS, space: 'note',
        items: [
            { id: 'aon-1', value: { title: 'Good one' } },
            { id: 'aon-2', value: { body: 'no title — schema-invalid' } },
            { id: 'aon-3', value: { title: 'Good three' } },
        ],
    }, 137);
    assert(b.result.isError === true, 'the batch was rejected');
    const msg = b.result.content[0].text;
    assert(msg.includes('items[1]'), `error names the failing item: ${msg}`);
    const found = await readIds(['aon-1', 'aon-3'], 1371);
    assert(found.length === 0, `nothing was written, found ${found.length}: ${found.map((f: any) => f.id).join(',')}`);
});

await test('38. An unknown space in one item stops the batch too', async () => {
    const b = await A.client.call('aimeat_workspace_write', {
        organism_id: orgId, ws: WS, space: 'note',
        items: [
            { id: 'space-1', value: { title: 'Fine' } },
            { space: 'no-such-space', id: 'space-2', value: { title: 'Nowhere' } },
        ],
    }, 138);
    assert(b.result.isError === true, 'rejected');
    assert(b.result.content[0].text.includes('items[1]'), 'names the item');
    assert((await readIds(['space-1'], 1381)).length === 0, 'the good item was not written either');
});

await test('39. Documents in a batch get distinct auto-generated ids', async () => {
    const b = await A.client.call('aimeat_workspace_write', {
        organism_id: orgId, ws: WS, space: 'page',
        items: [
            { value: { title: 'Page A', markdown: '# A' } },
            { value: { title: 'Page B', markdown: '# B' } },
        ],
    }, 139);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const data = JSON.parse(b.result.content[0].text);
    const ids = data.items.map((i: any) => i.id);
    assert(new Set(ids).size === 2, `two distinct ids, got ${JSON.stringify(ids)}`);
    assert(data.items.every((i: any) => i.mode === 'document'), 'both written as documents');
});

await test('40. Over the batch cap is refused with the cap in the message', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ id: `cap-${i}`, value: { title: `T${i}` } }));
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', items }, 140);
    assert(b.result.isError === true, 'rejected');
    assert(b.result.content[0].text.includes('50'), `mentions the cap: ${b.result.content[0].text}`);
});

await test('41. A single write still works unchanged', async () => {
    const b = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'single-1', value: { title: 'Alone' } }, 141);
    assert(b.result.isError !== true, `error: ${b.result.content?.[0]?.text}`);
    const data = JSON.parse(b.result.content[0].text);
    assert(data.written.endsWith('shared.notes.single-1.draft') && data.count === undefined, 'single-write shape unchanged (no count wrapper)');
});

await test('42. A publish over MCP appends the organism decision-log entry the web publish appends', async () => {
    // The audit/Prove trail used to record web publishes and not agent publishes, so it read as if
    // nothing shipped on the days an agent did the work. Both doors now go through the same
    // publishDraft + writeDecision.
    const w = await A.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', id: 'audit-1', value: { title: 'Audited', body: 'x' } }, 142);
    assert(w.result.isError !== true, `write error: ${w.result.content?.[0]?.text}`);
    const p = await A.client.call('aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'audit-1' }, 1421);
    assert(p.result.isError !== true, `publish error: ${p.result.content?.[0]?.text}`);
    // An owner session sees its agents' records, and the decision row is owned by the publishing agent.
    const list = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.meta.decisions.`)}&limit=200`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
    assert(list.status === 200, `decision list ${list.status}`);
    const entries = (list.body.data.items || []).map((i: any) => i.value?.summary).filter(Boolean);
    assert(entries.some((s: string) => s.includes('shared.notes.audit-1')), `a decision entry names the publish, got ${JSON.stringify(entries)}`);
});

await test('43. workspace_create refuses a blank name, as the REST door always has', async () => {
    // A nameless workspace was created over MCP and listed as 'Workspace' with a blank manifest name.
    const b = await A.client.call('aimeat_workspace_create', { organism_id: orgId, name: '   ',
        manifest: { objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records' }] } }, 143);
    assert(b.result.isError === true, 'rejected');
    assert(b.result.content[0].text.toLowerCase().includes('name'), `says which field: ${b.result.content[0].text}`);
});

await test('Cleanup owner 1', async () => { const r = await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner 2', async () => { const r = await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
