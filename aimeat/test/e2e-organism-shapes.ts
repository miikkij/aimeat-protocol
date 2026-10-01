/**
 * @file e2e-organism-shapes.ts
 * @description E2E for the organism starting shapes (data/organism-shapes.ts): GET
 *   /v1/organisms/shapes, POST /v1/organisms with `shape` and `lang` on REST and over MCP (the same
 *   service, services/organism-lifecycle.ts), and the project template applied to an existing empty
 *   workspace through PUT /v1/organisms/:id/workspace, which is how the organism page applies it now.
 *
 *   Happy path: the shapes are listed in the asked language; a company made over REST in Finnish has
 *   its two workspaces with Finnish names, its type and a private, invite-only policy; a team made
 *   over MCP has its handbook with a decisions space; the project template lands on an empty workspace.
 *
 *   Failure modes covered:
 *     - an unknown shape is refused with 400 and leaves no organism behind;
 *     - another owner cannot read the shaped workspace (it is private to its members);
 *     - a given join policy wins over the shape's default.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-organism-shapes
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

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
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* a partial frame */ } }
    }
    return out;
}
function mcpClient(token: string) {
    let sessionId = '';
    return async function rpc(method: string, params: Record<string, any> = {}, id = 1) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json() as any;
    };
}

/** An owner, an agent of theirs with organism:write, and an MCP token for the agent. */
async function provision(tag: string) {
    const ownerName = `shape${tag}${stamp}`;
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Shape Test', password: 'Shape1234567' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    let ts = new Date().toISOString();
    const ownerTok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ghii.body.data.private_key, ownerName + NODE_ID + ts) }) });
    assert(ownerTok.body.ok === true, `owner token: ${JSON.stringify(ownerTok.body.error)}`);
    const ownerToken = ownerTok.body.data.token as string;
    const agent = await json('/v1/agents', auth(ownerToken, { method: 'POST', body: JSON.stringify({ name: 'shapeai', owner: ownerName, capabilities: ['memory'], model: 'claude-opus-5-5' }) }));
    assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body)}`);
    const agentGaii = agent.body.data.agent.gaii;
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Shape E2E', redirect_uris: [] }) });
    ts = new Date().toISOString();
    const params = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii, signature: await signMsg(agent.body.data.private_key, agentGaii + NODE_ID + ts), timestamp: ts });
    const authz = await json(`/v1/mcp/authorize?${params}`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }) });
    assert(tok.status === 200, `mcp token ${tok.status}`);
    return { ownerName, ownerToken, mcpToken: tok.body.access_token as string };
}

const workspacesOf = async (token: string, orgId: string) => {
    const r = await json(`/v1/organisms/${orgId}/workspaces`, auth(token));
    assert(r.status === 200, `workspaces ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.workspaces ?? []) as Array<{ id: string; name: string }>;
};
const myOrganismCount = async (token: string, owner: string) =>
    ((await json(`/v1/organisms?member=${owner}`, auth(token))).body.data.organisms ?? []).length;

console.log('\n=== Organism shapes E2E ===\n');
const me = await provision('a');
const other = await provision('b');

await test('1. the shapes are listed, in the asked language, without signing in', async () => {
    const r = await json('/v1/organisms/shapes?lang=fi');
    assert(r.status === 200, `shapes ${r.status}`);
    const ids = r.body.data.shapes.map((s: any) => s.id);
    assert(JSON.stringify(ids) === JSON.stringify(['own-work', 'team', 'company', 'family', 'club', 'project']), `ids ${ids}`);
    const company = r.body.data.shapes.find((s: any) => s.id === 'company');
    assert(company.label === 'Yritys' && company.workspaces[1].name === 'Asiakkaat', `fi names: ${JSON.stringify(company.workspaces.map((w: any) => w.name))}`);
});

let companyId = '';
await test('2. a company made over REST in Finnish gets its two workspaces, its type and a private policy', async () => {
    const r = await json('/v1/organisms', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ name: `Leipomo ${stamp}`, shape: 'company', lang: 'fi' }) }));
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    const org = r.body.data.organism;
    companyId = org.id;
    assert(org.type === 'company' && org.joinPolicy === 'invite_only' && org.visibility === 'private', `defaults: ${org.type} ${org.joinPolicy} ${org.visibility}`);
    assert(r.body.data.workspaces?.length === 2, `answer names the workspaces: ${JSON.stringify(r.body.data.workspaces)}`);
    const names = (await workspacesOf(me.ownerToken, org.id)).map(w => w.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['Asiakkaat', 'Yrityksen tieto']), `workspace names: ${names}`);
});

await test('3. the customers workspace has its records space, locked by its schema', async () => {
    const ws = (await workspacesOf(me.ownerToken, companyId)).find(w => w.name === 'Asiakkaat')!;
    const bad = await json('/v1/memory', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ key: `organism.${companyId}.w.${ws.id}.shared.customers.c1.draft`, value: { id: 'c1' }, visibility: 'private' }) }));
    assert(bad.status === 400 || bad.status === 422, `a customer without a name must be refused by the schema, got ${bad.status}`);
    const good = await json('/v1/memory', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ key: `organism.${companyId}.w.${ws.id}.shared.customers.c2.draft`, value: { id: 'c2', name: 'Kahvila Kulma' }, visibility: 'private' }) }));
    assert(good.status === 200 || good.status === 201, `a valid customer is stored, got ${good.status}: ${JSON.stringify(good.body.error)}`);
});

await test('4. a team made over MCP gets its handbook with a decisions space', async () => {
    const rpc = mcpClient(me.mcpToken);
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Shape E2E', version: '1' } });
    const body = await rpc('tools/call', { name: 'aimeat_organism_create', arguments: { name: `Tiimi ${stamp}`, shape: 'team', lang: 'en' } }, 2);
    const text = body?.result?.content?.[0]?.text ?? '';
    assert(body?.result?.isError !== true, `create refused: ${text}`);
    const parsed = JSON.parse(text);
    assert(parsed.workspaces?.[0]?.name === 'Team handbook', `workspace: ${JSON.stringify(parsed.workspaces)}`);
    const read = await json(`/v1/organisms/${parsed.organism.id}/workspace?ws=${parsed.workspaces[0].ws}`, auth(me.ownerToken));
    const spaces = (read.body.data.manifest?.objectTypes ?? []).map((o: any) => o.namespace);
    assert(spaces.includes('shared.pages') && spaces.includes('shared.decisions'), `spaces: ${spaces}`);
});

await test('5. FAILURE: an unknown shape is refused and leaves no organism behind', async () => {
    const before = await myOrganismCount(me.ownerToken, me.ownerName);
    const r = await json('/v1/organisms', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ name: `Linna ${stamp}`, shape: 'castle' }) }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/Unknown shape "castle"/.test(r.body.error?.message ?? ''), `the refusal names the shape: ${r.body.error?.message}`);
    assert(await myOrganismCount(me.ownerToken, me.ownerName) === before, 'nothing was created');
});

await test('6. FAILURE: another owner cannot read the shaped workspace', async () => {
    const ws = (await workspacesOf(me.ownerToken, companyId))[0];
    const r = await json(`/v1/organisms/${companyId}/workspace?ws=${ws.id}`, auth(other.ownerToken));
    const leaked = r.status === 200 && (r.body.data?.manifest || (r.body.data?.records ?? []).length);
    assert(!leaked, `another owner must not read it, got ${r.status} ${JSON.stringify(r.body.data ?? {}).slice(0, 200)}`);
});

await test('7. a given join policy wins over the shape default', async () => {
    const r = await json('/v1/organisms', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ name: `Kerho ${stamp}`, shape: 'club', join_policy: 'open' }) }));
    assert(r.status === 201, `create ${r.status}`);
    assert(r.body.data.organism.joinPolicy === 'open' && r.body.data.organism.visibility === 'listed', `policy ${r.body.data.organism.joinPolicy} vis ${r.body.data.organism.visibility}`);
});

await test('8. the project template lands on an existing empty workspace through the workspace route', async () => {
    const org = await json('/v1/organisms', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ name: `Projekti ${stamp}`, type: 'project' }) }));
    const orgId = org.body.data.organism.id;
    // An empty workspace the way the organism page makes one (organisms.js createWorkspace): a
    // registry entry with no manifest, which the one-click template then fills.
    const wsId = `ws-e2e${stamp}`;
    const reg = await json('/v1/memory', auth(me.ownerToken, { method: 'POST', body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: wsId, name: 'Plan', createdAt: new Date().toISOString(), createdBy: me.ownerName }] }, visibility: 'private' }) }));
    assert(reg.status === 200 || reg.status === 201, `registry ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const shapes = await json('/v1/organisms/shapes?lang=en');
    const project = shapes.body.data.shapes.find((s: any) => s.id === 'project').workspaces[0];
    const put = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, auth(me.ownerToken, { method: 'PUT', body: JSON.stringify({ manifest: { ...project.manifest, id: orgId, name: 'Plan' }, schemas: project.schemas, readme: '# Plan' }) }));
    assert(put.status === 200, `apply ${put.status}: ${JSON.stringify(put.body.error)}`);
    const read = await json(`/v1/organisms/${orgId}/workspace?ws=${wsId}`, auth(me.ownerToken));
    const spaces = (read.body.data.manifest?.objectTypes ?? []).map((o: any) => o.namespace);
    assert(spaces.length === 5 && spaces.includes('meta.goals'), `project spaces: ${spaces}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
