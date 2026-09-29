/**
 * @file e2e-install-sets.ts
 * @description An install set applied to a customer node (install packages, phase 4). A repository
 *   node sells an install bundle: a package that lists another package, an organism with two
 *   workspaces and a crew agent. The customer node holds an entitlement to the bundle only, and its
 *   operator applies an install set: the owner user, two other users (one gets an account now, one an
 *   email invitation), the organism's name, the app's config and the update setting. Applying the
 *   set again creates nothing twice and deploys the agent once a runner is connected.
 * @structure
 *   - Setup: boot R (repository) and C (customer), each the other's active peer; R publishes the
 *     package and the bundle, and entitles C to the bundle only
 *   - Phase 1: refusals: not the operator, a malformed set, a missing config value (nothing created)
 *   - Phase 2: the plan (dry run) and the first apply
 *   - Phase 3: what the apply made: the install, the app config, the organism, the members
 *   - Phase 4: the second apply: nothing twice, the agent deployed through the runner
 *   - Phase 5: a set whose owner has no account creates the account
 *   - Phase 6: the operator's agent, holding operator:admin, plans and lists over MCP
 *   - Phase 7: a new node started with AIMEAT_INSTALL_SET links the repository, is refused until it
 *     is entitled, tries again and applies the set; the shop's agent grants the bundle and registers
 *     the node as a packages-only peer in one call; a key that differs is refused on both sides
 *   - Phase 8: selling node to node with no token: R's author names C a seller; C's operator asks C,
 *     which signs with its own key, for the questions, a grant, an end of updates and a revoke; a
 *     node that is not a seller, an agent without operator:admin and a replayed signature are refused
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-install-sets
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { sign, generateKeyPair } from '../src/auth/keypair.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface NodeState {
    server: Server; config: AimeatConfig; baseUrl: string; nodeId: string; adminPw: string;
    json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
}

function makeJson(baseUrl: string) {
    return async (path: string, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

async function bootNode(port: number, nodeId: string, repository: boolean, extra: Partial<AimeatConfig> = {}): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';

    const { config } = loadConfig({});
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://127.0.0.1:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    config.packagesEnabled = true;
    config.packageFederationEnabled = true;
    config.packageCreateRole = 'owner';
    config.packageRepository = repository;
    Object.assign(config, extra);

    const { app } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    return { server, config, baseUrl: `http://127.0.0.1:${port}`, nodeId, adminPw, json: makeJson(`http://127.0.0.1:${port}`) };
}

const ownerKeys = new Map<string, string>();

/** A token for an account this test registered. */
async function mintToken(node: NodeState, ownerName: string): Promise<string> {
    const tok = await node.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: ownerKeys.get(`${node.nodeId}/${ownerName}`) }),
    });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.token as string;
}

/** An account with a key, through the admin setup door, and a token for it. */
async function setupOwner(node: NodeState, ownerName: string): Promise<string> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    ownerKeys.set(`${node.nodeId}/${ownerName}`, reg.body.private_key);
    return mintToken(node, ownerName);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function peer(from: NodeState, fromToken: string, to: NodeState): Promise<void> {
    const card = await to.json('/.well-known/aimeat');
    const key = card.body.data?.public_key;
    assert(typeof key === 'string' && key.length > 0, `${to.nodeId} publishes a key`);
    const add = await from.json('/v1/federation/peers', {
        method: 'POST', headers: auth(fromToken), body: JSON.stringify({ node_id: to.nodeId, url: to.baseUrl, public_key: key }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);
    const act = await from.json(`/v1/federation/peers/${encodeURIComponent(to.nodeId)}`, {
        method: 'PUT', headers: auth(fromToken), body: JSON.stringify({ status: 'active', share_catalogue: true }),
    });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body)}`);
}

/** An agent of `owner`, registered with its own key, and its token. */
async function registerAgent(node: NodeState, ownerToken: string, owner: string, name: string, mode: string, scopes: string[]) {
    const reg = await node.json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], mode, scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const signature = await sign(reg.body.data.private_key, gaii + ts);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const CREW = {
    agent_name: 'shopkeeper',
    readme_md: '# Shopkeeper\n\nAsks what you sell and writes it down.',
    process: 'sequential',
    agents: [{ role: 'Interviewer', goal: 'Find out what this person sells.', backstory: 'You ask short questions.', allow_delegation: false }],
    tasks: [{ id: 'interview', description: 'Interview the owner: {{ctx.prompt}}', expected_output: 'What the person said.', agent: 'Interviewer' }],
};
const CONFIG_SCHEMA = { type: 'object', properties: { shop_name: { type: 'string', title: 'Shop name' } }, required: ['shop_name'] };
const APP_HTML = '<!DOCTYPE html><html><head><title>Shop</title>'
    + `<script type="application/json" id="aimeat-config">${JSON.stringify(CONFIG_SCHEMA)}</script>`
    + `<script type="application/json" id="aimeat-crews">${JSON.stringify([CREW])}</script>`
    + '</head><body><div>shop</div></body></html>';

/** A workspace with one records type: the least a workspace manifest may hold. */
const MANIFEST = (type: string, space: string) => ({
    objectTypes: [{ name: type, schemaRef: `schema:${type}@1`, namespace: space, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }],
});

console.log('\n=== AIMEAT Install Sets E2E ===\n');

let R: NodeState;
let C: NodeState;
let vendorToken = '';
let opsToken = '';
let acmeToken = '';
const ts = Date.now() % 1000000;
const SHOP = `shop${ts}`;
const SETUP = `setup${ts}`;
let shopOnR = '';
let setupOnR = '';
const ANN = `ann${ts}@example.org`;
const BOB = `bob${ts}@example.org`;
const NEWCO = `newco${ts}@example.org`;

const installSet = (extra: Record<string, unknown> = {}) => ({
    spec: 'aimeat.install-set/1',
    bundle: { group_id: setupOnR, node_id: R.nodeId },
    owner: { name: 'acme', email: `acme${ts}@example.org` },
    members: [
        { email: ANN, join: 'account', memberships: [{ organism: 'team', role: 'member', workspaces: ['orders'] }] },
        { email: BOB, join: 'invite', memberships: [{ organism: 'team', workspaces: [{ key: 'notes', role: 'viewer' }] }] },
    ],
    organism_names: { team: 'Acme team' },
    config: { [shopOnR]: { 'app-shop': { shop_name: 'Acme Shop' } } },
    auto_update: false,
    ...extra,
});

console.log('Setup');

await test('Boot R (repository) and C (customer), each the other\'s active peer', async () => {
    // 40733-40734: clear of every other suite's fixed ports (the runner lists them from the files).
    R = await bootNode(40733, `aimeat-test-001-isrepo${ts}`, true);
    C = await bootNode(40734, `aimeat-test-001-iscust${ts}`, false);
    vendorToken = await setupOwner(R, `vendor${ts}`);
    opsToken = await setupOwner(C, `ops${ts}`);
    // acme exists before the apply, with a key this test holds, so its runner agent can be registered
    // in Phase 4. Phase 5 applies a set whose owner does not exist yet.
    acmeToken = await setupOwner(C, 'acme');
    await peer(C, opsToken, R);
    await peer(R, vendorToken, C);
});

await test('R publishes a private app package and a private bundle that lists it, and entitles C to the bundle only', async () => {
    const shop = await R.json('/v1/packages', {
        method: 'POST', headers: auth(vendorToken),
        body: JSON.stringify({ name: SHOP, description: 'A shop app', category: 'utility', visibility: 'private',
            components: [{ id: 'app-shop', type: 'app', label: 'Shop', content: APP_HTML, dependencies: [] }] }),
    });
    assert(shop.status === 201, `shop: ${shop.status} ${JSON.stringify(shop.body)}`);
    shopOnR = shop.body.data.packageGroupId;
    const bundle = {
        spec: 'aimeat.install-bundle/1', name: 'Shop setup',
        packages: [{ group_id: shopOnR, mode: 'managed' }],
        organisms: [{ key: 'team', name: 'Team', workspaces: [
            { key: 'orders', name: 'Orders', manifest: MANIFEST('order', 'orders') },
            { key: 'notes', name: 'Notes', manifest: MANIFEST('note', 'notes') },
        ] }],
        agents: [{ group_id: shopOnR, app: 'app-shop', agent: 'shopkeeper', organism: 'team' }],
    };
    const setup = await R.json('/v1/packages', {
        method: 'POST', headers: auth(vendorToken),
        body: JSON.stringify({ name: SETUP, description: 'The shop setup', category: 'utility', visibility: 'private',
            components: [{ id: 'install-bundle', type: 'memory', label: 'Install bundle', content: JSON.stringify(bundle), dependencies: [] }] }),
    });
    assert(setup.status === 201, `bundle: ${setup.status} ${JSON.stringify(setup.body)}`);
    setupOnR = setup.body.data.packageGroupId;
    const g = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ note: 'order 1' }),
    });
    assert(g.status === 200, `grant: ${g.status} ${JSON.stringify(g.body)}`);
});

console.log('\nPhase 1 — Refusals');

await test('An agent of the operator without operator:admin is refused', async () => {
    const agentToken = await registerAgent(C, opsToken, `ops${ts}`, 'helper', 'interactive', ['*']);
    const r = await C.json('/v1/install-sets/apply', { method: 'POST', headers: auth(agentToken), body: JSON.stringify({ install_set: installSet(), dry_run: true }) });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('The shop learns before payment what the bundle needs asked: the app field, required, not secret', async () => {
    const r = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/config-needs`, { headers: auth(vendorToken) });
    assert(r.status === 200 && r.body.data.bundle === true && r.body.data.name === 'Shop setup' && r.body.data.problems.length === 0,
        `needs: ${r.status} ${JSON.stringify(r.body)}`);
    const q = (r.body.data.questions as any[]).find((x) => x.package === shopOnR && x.component === 'app-shop' && x.field === 'shop_name');
    assert(q?.kind === 'app' && q?.required === true && q?.secret === false && q?.schema?.title === 'Shop name', `the question: ${JSON.stringify(r.body.data.questions)}`);
});

await test('An agent of the author without packages:write cannot read the questions', async () => {
    const reader = await registerAgent(R, vendorToken, `vendor${ts}`, 'reader', 'interactive', ['memory:read']);
    const r = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/config-needs`, { headers: auth(reader) });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('A set with a user who has no email is refused, naming the field', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ members: [{ join: 'account', memberships: [] }] }) }),
    });
    assert(r.status === 400 && /members\[0\]\.email/.test(r.body.error?.message), `expected 400 on the email: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('Without the app\'s required config value the set is refused, and no account is created', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ owner: { name: 'newco', email: NEWCO }, members: [], config: {} }) }),
    });
    assert(r.status === 409 && r.body.error?.code === 'CANNOT_APPLY', `expected 409 CANNOT_APPLY: ${r.status} ${JSON.stringify(r.body)}`);
    assert(JSON.stringify(r.body.error).includes('shop_name'), `the refusal names the field: ${JSON.stringify(r.body.error)}`);
    const newco = await C.json('/v1/owners/newco');
    assert(newco.status === 404, `newco does not exist: ${newco.status}`);
});

console.log('\nPhase 2 — Plan and apply');

await test('The plan names the owner, the organism, the users and the agent, and creates nothing', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet(), dry_run: true }),
    });
    assert(r.status === 200 && r.body.data.dry_run === true, `plan: ${r.status} ${JSON.stringify(r.body)}`);
    const plan = r.body.data.plan;
    assert(plan.owner.exists === true && plan.organisms[0].name === 'Acme team' && plan.members.length === 2 && plan.agents.length === 1,
        `plan: ${JSON.stringify(plan)}`);
    assert(plan.problems.length === 0, `no problems: ${JSON.stringify(plan.problems)}`);
});

let record: any;
await test('Applying installs the package managed for the owner, makes the organism and brings the users in', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet() }),
    });
    assert(r.status === 201 && r.body.data.owner_created === false, `apply: ${r.status} ${JSON.stringify(r.body)}`);
    record = r.body.data.record;
    assert(record.packages[shopOnR]?.result === 'installed' && record.packages[shopOnR].mode === 'managed', `package: ${JSON.stringify(record.packages)}`);
    assert(typeof record.organisms.team?.id === 'string' && Object.keys(record.organisms.team.workspaces).length === 2, `organism: ${JSON.stringify(record.organisms)}`);
    assert(record.members[ANN].created === true && record.members[ANN].joined[0] === 'team', `ann: ${JSON.stringify(record.members[ANN])}`);
    assert(record.members[BOB].invited[0] === 'team' && record.members[BOB].account === null, `bob: ${JSON.stringify(record.members[BOB])}`);
    assert(record.agents[`${shopOnR}/app-shop/shopkeeper`].result === 'pending', `the agent waits for a runner: ${JSON.stringify(record.agents)}`);
});

console.log('\nPhase 3 — What the apply made');

let appFile = '';
await test('The install is managed, its updates do not apply by themselves, and the app reads its config', async () => {
    const list = await C.json(`/v1/install-sets`, { headers: auth(opsToken) });
    assert(list.status === 200 && list.body.data.install_sets.length === 1, `list: ${JSON.stringify(list.body)}`);
    const inst = await C.json(`/v1/instances/${record.packages[shopOnR].instance_id}`, { headers: auth(acmeToken) });
    assert(inst.body.data?.mode === 'managed' && inst.body.data?.autoUpdate === false, `instance: ${JSON.stringify(inst.body.data)}`);
    const apps = await C.json('/v1/apps?owner=acme', { headers: auth(acmeToken) });
    appFile = (apps.body.data?.apps ?? []).map((a: any) => a.filename).find((f: string) => f.endsWith('app-shop.html')) ?? '';
    assert(!!appFile, `the app is published for acme: ${JSON.stringify(apps.body).slice(0, 400)}`);
    const cfg = await C.json(`/v1/apps/acme/${encodeURIComponent(appFile)}/config`);
    assert(cfg.status === 200 && cfg.body.data.values?.shop_name === 'Acme Shop', `config: ${cfg.status} ${JSON.stringify(cfg.body)}`);
});

await test('The organism is private and invite-only, ann is an active member, and bob holds an email invitation', async () => {
    const org = await C.json(`/v1/organisms/${record.organisms.team.id}`, { headers: auth(acmeToken) });
    const o = org.body.data?.organism;
    assert(o?.name === 'Acme team' && o?.visibility === 'private' && o?.joinPolicy === 'invite_only' && org.body.data.your_membership?.role === 'creator',
        `organism: ${JSON.stringify(org.body.data)}`);
    const members = await C.json(`/v1/organisms/${record.organisms.team.id}/members`, { headers: auth(acmeToken) });
    const ann = (members.body.data.members as any[]).find((m) => m.ghii === record.members[ANN].account || m.ghii.startsWith(`${record.members[ANN].account}@`));
    assert(ann?.status === 'active' && ann?.role === 'member', `ann: ${JSON.stringify(members.body.data.members)}`);
    const invites = await C.json(`/v1/organisms/${record.organisms.team.id}/invitations/email`, { headers: auth(acmeToken) });
    const bob = (invites.body.data?.invitations as any[] ?? []).find((i) => i.email === BOB);
    assert(bob?.status === 'pending' && bob?.org_role === 'member', `bob's invitation: ${JSON.stringify(invites.body)}`);
});

console.log('\nPhase 4 — Applying again');

await test('With a runner connected, the second apply deploys the agent and creates nothing twice', async () => {
    await registerAgent(C, acmeToken, 'acme', 'crew-forge', 'task-runner', ['*']);
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet() }),
    });
    assert(r.status === 201 && r.body.data.owner_created === false, `apply 2: ${r.status} ${JSON.stringify(r.body)}`);
    const again = r.body.data.record;
    assert(again.runs === 2 && again.organisms.team.id === record.organisms.team.id, `same organism: ${JSON.stringify(again.organisms)}`);
    assert(again.packages[shopOnR].result === 'present' && again.packages[shopOnR].instance_id === record.packages[shopOnR].instance_id, `same install: ${JSON.stringify(again.packages)}`);
    assert(again.members[ANN].created === false && again.members[ANN].already[0] === 'team', `ann once: ${JSON.stringify(again.members[ANN])}`);
    assert(again.members[BOB].already[0] === 'team', `bob once: ${JSON.stringify(again.members[BOB])}`);
    assert(again.agents[`${shopOnR}/app-shop/shopkeeper`].result === 'deployed', `deployed: ${JSON.stringify(again.agents)}`);
});

console.log('\nPhase 5 — An owner who does not exist yet');

await test('A set whose owner has no account creates it, with the email verified', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ owner: { name: 'newco', email: NEWCO }, members: [], organism_names: { team: 'Newco' } }) }),
    });
    assert(r.status === 201 && r.body.data.owner_created === true && r.body.data.record.owner === 'newco', `apply: ${r.status} ${JSON.stringify(r.body)}`);
    const newco = await C.json('/v1/owners/newco');
    assert(newco.status === 200, `newco exists: ${newco.status} ${JSON.stringify(newco.body)}`);
    const list = await C.json(`/v1/install-sets`, { headers: auth(opsToken) });
    assert(list.body.data.install_sets.length === 2, `two records, one per owner: ${JSON.stringify(list.body.data.install_sets.map((s: any) => s.owner))}`);
});

console.log('\nPhase 6 — The operator\'s AI, over MCP');

await test('An agent of the operator holding operator:admin plans and lists the sets through aimeat_admin_install_set', async () => {
    const agent = await C.json('/v1/agents', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ name: 'setupai', owner: `ops${ts}`, capabilities: ['memory'], scopes: ['operator:admin'] }),
    });
    assert(agent.status === 201, `agent: ${agent.status} ${JSON.stringify(agent.body)}`);
    const gaii = agent.body.data.agent.gaii as string;
    const client = await C.json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Install Sets E2E', redirect_uris: [] }) });
    assert(client.status === 201, `mcp register: ${client.status}`);
    const at = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii, timestamp: at,
        signature: await sign(agent.body.data.private_key, gaii + C.nodeId + at),
    });
    const code = await C.json(`/v1/mcp/authorize?${params}`);
    assert(typeof code.body.code === 'string', `authorize: ${JSON.stringify(code.body)}`);
    const tok = await C.json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: code.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }),
    });
    assert(tok.status === 200, `mcp token: ${tok.status}`);
    let session = '';
    const rpc = async (method: string, rpcParams: Record<string, unknown>, id: number) => {
        const res = await fetch(`${C.baseUrl}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok.body.access_token}`,
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params: rpcParams }),
        });
        session = res.headers.get('mcp-session-id') ?? session;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream')) return await res.json() as any;
        const messages = (await res.text()).split('\n\n').map(evt => {
            const data = evt.trim().split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
            return data ? JSON.parse(data) : null;
        }).filter(Boolean);
        return messages.find((m: any) => m.id === id) ?? messages[0] ?? {};
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Install Sets E2E', version: '1.0.0' } }, 1);
    const plan = await rpc('tools/call', { name: 'aimeat_admin_install_set', arguments: { action: 'plan', install_set: installSet() } }, 2);
    assert(plan?.result?.isError !== true, `plan errored: ${JSON.stringify(plan?.result ?? plan).slice(0, 400)}`);
    const planned = JSON.parse(plan.result.content[0].text);
    assert(planned.dry_run === true && planned.plan.owner.exists === true && planned.plan.problems.length === 0, `plan: ${JSON.stringify(planned).slice(0, 400)}`);
    const list = await rpc('tools/call', { name: 'aimeat_admin_install_set', arguments: { action: 'list' } }, 3);
    const listed = JSON.parse(list.result.content[0].text);
    assert(listed.install_sets.length === 2, `list: ${JSON.stringify(listed).slice(0, 300)}`);
});

console.log('\nPhase 7 — A new node applies its set at start-up');

let D: NodeState | undefined;
const setFile = join(tmpdir(), `aimeat-install-set-${ts}.json`);
await test('A new node started with an install set links the repository, waits for its entitlement, and applies the set', async () => {
    const card = await R.json('/.well-known/aimeat');
    writeFileSync(setFile, JSON.stringify(installSet({
        owner: { name: 'dco', email: `dco${ts}@example.org` }, members: [],
        repository: { node_id: R.nodeId, url: R.baseUrl, public_key: card.body.data.public_key },
    })));
    // Package federation stays off, as on a node nobody configured beyond its install set: the
    // repository the set names is reached anyway (services/install-set-trust.ts).
    D = await bootNode(40735, `aimeat-test-001-isnew${ts}`, false, { installSetPath: setFile, packageFederationEnabled: false });
    // A node booted in this process takes over the token signing the earlier two used, so their
    // tokens are minted again.
    vendorToken = await mintToken(R, `vendor${ts}`);
    opsToken = await mintToken(C, `ops${ts}`);
    const dToken = await setupOwner(D, `dops${ts}`);
    // The repository learns the new node's key only now that the node exists. The shop's automation,
    // an agent of the bundle's author holding packages:write, grants the bundle and registers the
    // node in one call; until then the start-up apply is refused and tries again.
    const shopAgent = await registerAgent(R, vendorToken, `vendor${ts}`, 'shopsale', 'interactive', ['packages:write']);
    const dCard = await D.json('/.well-known/aimeat');
    const g = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements/${D.nodeId}`, {
        method: 'PUT', headers: auth(shopAgent),
        body: JSON.stringify({ note: 'order 2', node: { url: D.baseUrl, public_key: dCard.body.data.public_key } }),
    });
    assert(g.status === 200 && g.body.data.peer_registered === true, `grant D with its node: ${g.status} ${JSON.stringify(g.body)}`);
    const onR = await R.json('/v1/federation/peers', { headers: auth(vendorToken) });
    const dOnR = (onR.body.data?.peers as any[] ?? []).find((p) => p.node_id === D!.nodeId);
    assert(dOnR?.status === 'active' && dOnR?.tier === 'contact' && dOnR?.share_catalogue === false,
        `D is a packages-only peer on R: ${JSON.stringify(dOnR)}`);
    let sets: any[] = [];
    for (let i = 0; i < 40 && sets.length === 0; i++) {
        await new Promise(r => setTimeout(r, 500));
        sets = (await D.json('/v1/install-sets', { headers: auth(dToken) })).body.data?.install_sets ?? [];
    }
    assert(sets.length === 1 && sets[0].owner === 'dco' && sets[0].applied_by === 'startup', `applied at start-up: ${JSON.stringify(sets).slice(0, 400)}`);
    assert(sets[0].packages[shopOnR]?.result === 'installed' && typeof sets[0].organisms.team?.id === 'string', `what it made: ${JSON.stringify(sets[0]).slice(0, 400)}`);
    const peers = await D.json('/v1/federation/peers', { headers: auth(dToken) });
    const link = (peers.body.data?.peers as any[] ?? []).find((p) => p.node_id === R.nodeId);
    assert(link?.status === 'active', `D links R as an active peer: ${JSON.stringify(peers.body.data).slice(0, 300)}`);
    // Everything but the named repository stays refused with federation off.
    const other = await D.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(dToken), body: JSON.stringify({ group_id: 'x::y', source_url: C.baseUrl, trust: 'tofu' }),
    });
    assert(other.status === 403 && other.body.error?.code === 'PACKAGE_FEDERATION_DISABLED', `another source is refused: ${other.status} ${JSON.stringify(other.body)}`);
});

await test('A grant naming a known peer under another key is refused, and grants nothing', async () => {
    const r = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(vendorToken),
        body: JSON.stringify({ note: 'wrong key', node: { url: C.baseUrl, public_key: 'AAAAnotthekey' } }),
    });
    assert(r.status === 409 && r.body.error?.code === 'PEER_KEY_MISMATCH', `expected 409 PEER_KEY_MISMATCH: ${r.status} ${JSON.stringify(r.body)}`);
    const list = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements`, { headers: auth(vendorToken) });
    const cEnt = (list.body.data.entitlements as any[]).find((e) => e.nodeId === C.nodeId);
    assert(cEnt?.note === 'order 1', `C's grant is unchanged: ${JSON.stringify(cEnt)}`);
});

await test('A set naming the repository under another key than the linked peer is refused', async () => {
    const r = await C.json('/v1/install-sets/apply', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ repository: { node_id: R.nodeId, url: R.baseUrl, public_key: 'AAAAnotthekey' } }), dry_run: true }),
    });
    assert(r.status === 409 && r.body.error?.code === 'PEER_KEY_MISMATCH', `expected 409 PEER_KEY_MISMATCH: ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 8 — Selling node to node, with no token');

const newNode = `aimeat-test-001-sold${ts}`;
let newNodeKey = '';
await test('Before R\'s author names C a seller, C\'s signed sale is refused, and C\'s agent without operator:admin cannot even ask', async () => {
    newNodeKey = (await generateKeyPair()).publicKey;
    const r = await C.json('/v1/package-sales/entitlements', {
        method: 'PUT', headers: auth(opsToken),
        body: JSON.stringify({ repository: R.nodeId, group_id: setupOnR, node_id: newNode, node: { url: 'http://127.0.0.1:40799', public_key: newNodeKey } }),
    });
    assert(r.status === 403 && r.body.error?.code === 'NOT_A_SELLER', `expected 403 NOT_A_SELLER: ${r.status} ${JSON.stringify(r.body)}`);
    const helper = await registerAgent(C, opsToken, `ops${ts}`, 'shopbot', 'interactive', ['*']);
    const q = await C.json(`/v1/package-sales/config-needs?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(setupOnR)}`, { headers: auth(helper) });
    assert(q.status === 403, `an agent without operator:admin is refused: ${q.status} ${JSON.stringify(q.body)}`);
});

await test('R\'s author names C a seller; C then reads the bundle\'s questions and grants a new node, signed by C\'s own key', async () => {
    const s = await R.json(`/v1/package-sellers/${C.nodeId}`, { method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ note: 'the shop' }) });
    assert(s.status === 200 && s.body.data.seller.nodeId === C.nodeId, `seller: ${s.status} ${JSON.stringify(s.body)}`);
    const q = await C.json(`/v1/package-sales/config-needs?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(setupOnR)}`, { headers: auth(opsToken) });
    assert(q.status === 200 && (q.body.data.questions as any[]).some((x) => x.field === 'shop_name' && x.required), `questions: ${q.status} ${JSON.stringify(q.body)}`);
    // The link parameters of the questions call are read: the right address and key pass, a wrong key is refused.
    const rKey = (await R.json('/.well-known/aimeat')).body.data.public_key as string;
    const linked = await C.json(`/v1/package-sales/config-needs?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(setupOnR)}&repository_url=${encodeURIComponent(R.baseUrl)}&repository_public_key=${encodeURIComponent(rKey)}`, { headers: auth(opsToken) });
    assert(linked.status === 200, `questions with the link: ${linked.status} ${JSON.stringify(linked.body)}`);
    const wrongKey = await C.json(`/v1/package-sales/config-needs?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(setupOnR)}&repository_url=${encodeURIComponent(R.baseUrl)}&repository_public_key=AAAAnotthekey`, { headers: auth(opsToken) });
    assert(wrongKey.status === 409 && wrongKey.body.error?.code === 'PEER_KEY_MISMATCH', `a wrong repository key is refused: ${wrongKey.status} ${JSON.stringify(wrongKey.body)}`);
    const g = await C.json('/v1/package-sales/entitlements', {
        method: 'PUT', headers: auth(opsToken),
        body: JSON.stringify({ repository: R.nodeId, group_id: setupOnR, node_id: newNode, node: { url: 'http://127.0.0.1:40799', public_key: newNodeKey }, note: 'order 3' }),
    });
    assert(g.status === 200 && g.body.data.peer_registered === true, `grant: ${g.status} ${JSON.stringify(g.body)}`);
    const list = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements`, { headers: auth(vendorToken) });
    const e = (list.body.data.entitlements as any[]).find((x) => x.nodeId === newNode);
    assert(e?.updatesUntil === null && String(e?.note).startsWith(`sold by ${C.nodeId}`), `the grant on R: ${JSON.stringify(e)}`);
});

await test('C ends the new node\'s updates and then revokes it, both signed', async () => {
    const until = new Date().toISOString();
    const end = await C.json('/v1/package-sales/entitlements', {
        method: 'PUT', headers: auth(opsToken), body: JSON.stringify({ repository: R.nodeId, group_id: setupOnR, node_id: newNode, updates_until: until }),
    });
    assert(end.status === 200 && end.body.data.entitlement.updatesUntil === until, `end: ${end.status} ${JSON.stringify(end.body)}`);
    const del = await C.json(`/v1/package-sales/entitlements?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(setupOnR)}&node_id=${encodeURIComponent(newNode)}`, {
        method: 'DELETE', headers: auth(opsToken),
    });
    assert(del.status === 200 && del.body.data.revoked === true, `revoke: ${del.status} ${JSON.stringify(del.body)}`);
    const list = await R.json(`/v1/packages/${encodeURIComponent(setupOnR)}/entitlements`, { headers: auth(vendorToken) });
    assert(!(list.body.data.entitlements as any[]).some((x) => x.nodeId === newNode), 'the grant is gone');
});

await test('A seller\'s signature taken for reading the questions does not grant anything when replayed', async () => {
    // A seller node whose key this test holds, so its signatures can be made and replayed.
    const seller = await generateKeyPair();
    const sellerId = `aimeat-test-001-seller${ts}`;
    const add = await R.json(`/v1/package-sellers/${sellerId}`, {
        method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ node: { url: 'http://127.0.0.1:40798', public_key: seller.publicKey } }),
    });
    assert(add.status === 200 && add.body.data.peer_registered === true, `add seller: ${add.status} ${JSON.stringify(add.body)}`);
    const path = `/v1/federation/package-sales/${encodeURIComponent(setupOnR)}/config-needs`;
    const timestamp = new Date().toISOString();
    const digest = createHash('sha256').update('{}').digest('hex');
    const signature = await sign(seller.privateKey, JSON.stringify({ source_node: sellerId, timestamp, purpose: 'package-sale', method: 'GET', path, body_sha256: digest }));
    const headers = { 'x-source-node': sellerId, 'x-timestamp': timestamp, 'x-signature': signature };
    const read = await R.json(path, { headers });
    assert(read.status === 200, `the signed read works: ${read.status} ${JSON.stringify(read.body)}`);
    const replay = await R.json(`/v1/federation/package-sales/${encodeURIComponent(setupOnR)}/entitlements/${sellerId}`, {
        method: 'PUT', headers, body: JSON.stringify({ note: 'replayed' }),
    });
    assert(replay.status === 401, `the replay as a grant is refused: ${replay.status} ${JSON.stringify(replay.body)}`);
});

console.log('\nCleanup');
try { unlinkSync(setFile); } catch { /* already gone */ }
// Close and exit without awaiting: C fetched R over keep-alive (see e2e-federation-packages.ts).
try { R!.server.close(); C!.server.close(); D?.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
