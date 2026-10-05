/**
 * @file test/e2e-package-managed.ts
 * @description Managed package installs: the package owns the code and layout, the owner keeps the
 *   settings, an update replaces everything, and a fork gives the owner the code and ends the updates.
 *
 *   WHAT IT PROVES. The lock is one check (services/packages/install/package-managed.ts) asked by every code path that
 *   changes an app, its draft, its bundled crews, its layout or a cortex. Each path is driven here
 *   against a managed copy and must answer 409 MANAGED_BY_PACKAGE, and the same act against an
 *   editable copy of the same package must go through, so a lock that refused everything would fail
 *   as surely as one that refused nothing. Settings (the app's name) stay open on the managed copy.
 *   The update and the fork are driven through REST and the node's own MCP tools.
 * @structure
 *   - Phase 1: fixtures (author, installer, stranger, the installer's agent, a cortex, an app, a package)
 *   - Phase 2: install in both modes, refusals of a bad mode, the dry run, the MCP instance list
 *   - Phase 3: the lock on every code path, and the settings that stay open
 *   - Phase 4: an update replaces the managed copy; a `custom` migration is refused
 *   - Phase 5: the fork, and what a forked install may and may not do
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-managed
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 1).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'ManagedPackage1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<{ token: string }> {
    const name = `pm${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return { token: tok.body.data.token as string };
}

// ── The node's own MCP endpoint ──────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = (await res.text()).split('\n').filter((l) => l.startsWith('data: '))
            .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
        return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-package-managed', version: '1.0.0' },
    });
    return session;
}

async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

// ── State ───────────────────────────────────────────────────────────────────────────────────

const tag = Date.now().toString(36).slice(-6);
const CORTEX = `managed-kit-${tag}`;
const APP = `managed-shop-${tag}.html`;
const PKG = `managed-pack-${tag}`;

const htmlFor = (title: string, marker = ''): string =>
    `<!DOCTYPE html><html><head><title>${title}</title>`
    + `<script src="/v1/cortex/${CORTEX}/libs/kit.js"></script>`
    + `</head><body><h1>${title}</h1>${marker ? `<p>${marker}</p>` : ''}</body></html>`;

let author = { token: '', owner: '' };
let installer = { token: '', owner: '' };
let stranger = { token: '', owner: '' };
let agentSession: McpSession;

let groupId = '';
let encodedGroupId = '';
let managedId = '';
let editableId = '';
let managedApp = '';
let managedCortex = '';
let editableApp = '';

console.log('\n═══ Managed package installs E2E ═══');
console.log('\nPhase 1 — Fixtures');

await test('Three owners and an agent of the installer', async () => {
    author = await makeOwner('pmauthor');
    installer = await makeOwner('pminstall');
    stranger = await makeOwner('pmstranger');
    const agent = await makeAgent(installer, ['packages:write', 'app:write', 'memory:read']);
    agentSession = await openSession(agent.token);
    assert(!!agentSession.sessionId, 'the agent has an MCP session');
});

await test('The author installs a cortex and publishes an app that loads it', async () => {
    const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX}
  namespace: ${author.owner}
  description: A kit the managed app loads
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: kit
      filename: kit.js
`;
    const cortex = await json('/v1/cortex', {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({ manifest, libs: { 'kit.js': 'export const KIT = "managed-v1";' } }),
    });
    assert(cortex.status === 201, `cortex: ${cortex.status} ${JSON.stringify(cortex.body)}`);
    const act = await json(`/v1/cortex/${encodeURIComponent(CORTEX)}/activate`, {
        method: 'POST', headers: authed(author.token), body: JSON.stringify({}),
    });
    assert(act.status === 200 || act.status === 201, `activate: ${act.status} ${JSON.stringify(act.body)}`);

    const app = await json('/v1/apps', {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({
            filename: APP, content: b64(htmlFor('Managed Shop')), name: 'Managed Shop',
            description: 'A fixture for the managed install suite', category: 'utility', tags: ['managed'],
        }),
    });
    assert(app.status === 201, `app: ${app.status} ${JSON.stringify(app.body)}`);
});

await test('The author composes a public package from the app', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({ name: PKG, apps: [APP], description: 'One app and its kit', category: 'utility' }),
    });
    assert(status === 201, `compose: ${status} ${JSON.stringify(body)}`);
    groupId = body.data.packageGroupId;
    encodedGroupId = encodeURIComponent(groupId);
    const pub = await json(`/v1/packages/${encodedGroupId}`, {
        method: 'PATCH', headers: authed(author.token), body: JSON.stringify({ visibility: 'public' }),
    });
    assert(pub.status === 200, `make public: ${pub.status} ${JSON.stringify(pub.body)}`);
});

console.log('\nPhase 2 — Install in both modes');

await test('An unknown mode is refused with 400 and nothing is installed', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Bad', mode: 'locked' }),
    });
    assert(status === 400, `expected 400, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INVALID_INPUT', `code ${body.error?.code}`);
    const list = await json('/v1/instances', { headers: authed(installer.token) });
    assert(list.body.data.total === 0, `no instance, got ${list.body.data.total}`);
});

await test('A dry run says the install would be managed', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token),
        body: JSON.stringify({ label: 'Preview', mode: 'managed', dry_run: true }),
    });
    assert(status === 200, `dry run: ${status} ${JSON.stringify(body)}`);
    assert(body.data.mode === 'managed', `preview mode ${body.data.mode}`);
});

await test('The installer installs a managed copy', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Managed copy', mode: 'managed' }),
    });
    assert(status === 201, `install: ${status} ${JSON.stringify(body)}`);
    assert(body.data.mode === 'managed', `mode ${body.data.mode}`);
    managedId = body.data.id;
    const comps = body.data.installedComponents as any[];
    managedApp = comps.find((c) => c.type === 'app')?.registeredAs ?? '';
    managedCortex = comps.find((c) => c.type === 'cortex')?.registeredAs ?? '';
    assert(!!managedApp && !!managedCortex, `an app and a cortex registered: ${JSON.stringify(comps)}`);
});

await test('The installer installs an editable copy beside it, the default mode', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Editable copy' }),
    });
    assert(status === 201, `install: ${status} ${JSON.stringify(body)}`);
    assert(body.data.mode === 'editable', `mode ${body.data.mode}`);
    editableId = body.data.id;
    editableApp = (body.data.installedComponents as any[]).find((c) => c.type === 'app')?.registeredAs ?? '';
    assert(!!editableApp, 'the editable copy has its own app');
});

await test('aimeat_package_instances lists both copies with their modes', async () => {
    const out = await callTool(agentSession, 'aimeat_package_instances', { group_id: groupId });
    assert(!out.isError, `tool error: ${out.text}`);
    const byId = new Map((out.data.instances as any[]).map((i) => [i.instance_id, i]));
    assert(byId.get(managedId)?.mode === 'managed', `managed copy: ${JSON.stringify(byId.get(managedId))}`);
    assert(byId.get(editableId)?.mode === 'editable', `editable copy: ${JSON.stringify(byId.get(editableId))}`);
});

console.log('\nPhase 3 — The lock');

const newVersionOf = (filename: string, token: string) => json('/v1/apps', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({
        filename, content: b64(htmlFor('My own shop', 'LOCAL EDIT')), name: 'My own shop',
        description: 'The installer changed the code', category: 'utility', tags: [],
    }),
});

await test('A new version of the managed app is refused with 409 MANAGED_BY_PACKAGE', async () => {
    const { status, body } = await newVersionOf(managedApp, installer.token);
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
    assert(body.error?.details?.instance_id === managedId, `names the install, got ${JSON.stringify(body.error?.details)}`);
    const served = await (await fetch(`${BASE}/v1/apps/${installer.owner}/${managedApp}`)).text();
    assert(!served.includes('LOCAL EDIT'), 'the package bytes are still what is served');
});

await test('The same act on the editable copy goes through', async () => {
    const { status, body } = await newVersionOf(editableApp, installer.token);
    assert(status === 201, `expected 201, got ${status} ${JSON.stringify(body)}`);
});

await test('A draft of the managed app is refused before the slot is written', async () => {
    const { status, body } = await json(`/v1/apps/${installer.owner}/${managedApp}/draft`, {
        method: 'PUT', headers: authed(installer.token),
        body: JSON.stringify({ content: b64(htmlFor('Draft', 'DRAFT EDIT')) }),
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
    const draft = await json(`/v1/apps/${installer.owner}/${managedApp}/draft`, { headers: authed(installer.token) });
    assert(draft.status === 404 || draft.body?.data === null || draft.body?.data?.draft == null,
        `no draft was stored, got ${draft.status} ${JSON.stringify(draft.body).slice(0, 200)}`);
});

await test('Changing the bundled crews of the managed app is refused', async () => {
    const { status, body } = await json(`/v1/apps/${managedApp}`, {
        method: 'PATCH', headers: authed(installer.token), body: JSON.stringify({ cortex: null }),
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
});

await test('Renaming the managed app is a setting and goes through', async () => {
    const { status, body } = await json(`/v1/apps/${managedApp}`, {
        method: 'PATCH', headers: authed(installer.token),
        body: JSON.stringify({ name: 'Our Shop', description: 'Our copy of the managed shop' }),
    });
    assert(status === 200, `expected 200, got ${status} ${JSON.stringify(body)}`);
    const list = await json('/v1/apps?limit=200&own=true', { headers: authed(installer.token) });
    const app = (list.body.data?.apps ?? []).find((a: any) => a.filename === managedApp);
    assert((app?.manifest?.name ?? app?.name) === 'Our Shop', `renamed, got ${JSON.stringify(app?.manifest?.name ?? app?.name)}`);
});

await test('The layout of the managed app is refused', async () => {
    const { status, body } = await json(`/v1/apps/${installer.owner}/${managedApp}/ui`, {
        method: 'PUT', headers: authed(installer.token), body: JSON.stringify({ layout: { blocks: [] } }),
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
});

await test('A redeploy of the managed cortex is refused', async () => {
    const got = await json(`/v1/cortex/${encodeURIComponent(managedCortex)}`, { headers: authed(installer.token) });
    assert(got.status === 200, `read cortex: ${got.status} ${JSON.stringify(got.body)}`);
    const namespace = got.body.data?.namespace ?? got.body.data?.cortex?.namespace ?? installer.owner;
    const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${managedCortex}
  namespace: ${namespace}
  description: A local edit
spec:
  version: "9.9.9"
  components:
    - type: lib
      name: kit
      filename: kit.js
`;
    const { status, body } = await json(`/v1/cortex/${encodeURIComponent(managedCortex)}`, {
        method: 'PUT', headers: authed(installer.token),
        body: JSON.stringify({ manifest, libs: { 'kit.js': 'export const KIT = "local-edit";' } }),
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
});

await test('aimeat_app_publish on the managed app is refused and names the fork', async () => {
    const out = await callTool(agentSession, 'aimeat_app_publish', {
        filename: managedApp, content_base64: b64(htmlFor('Agent edit', 'AGENT EDIT')),
        name: 'Agent edit', description: 'An agent tried to change the code',
    });
    // This tool renders a refusal as its message alone (the pre-2026-09-19 shape, rule tool-surfaces),
    // so the assertion reads the words the lock writes rather than the code.
    assert(out.isError, `expected a refusal, got ${out.text.slice(0, 300)}`);
    assert(out.text.includes('managed install') && out.text.includes('aimeat_package_fork'),
        `says why and what to do, got ${out.text.slice(0, 300)}`);
    const served = await (await fetch(`${BASE}/v1/apps/${installer.owner}/${managedApp}`)).text();
    assert(!served.includes('AGENT EDIT'), 'the package bytes are still what is served');
});

console.log('\nPhase 4 — Updates');

await test('The author publishes a new version', async () => {
    const cur = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(author.token) });
    const components = (cur.body.data.components as any[]).map((c) =>
        c.type === 'app' ? { ...c, content: c.content.replace('</body>', '<p>v2-mark</p></body>') } : c);
    await new Promise((r) => setTimeout(r, 1100));
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`, {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({ changelog: 'v2-mark', components, status: 'published' }),
    });
    assert(status === 201, `new version: ${status} ${JSON.stringify(body)}`);
});

await test('A custom migration of the managed copy is refused', async () => {
    const latest = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(installer.token) });
    const appComp = (latest.body.data.components as any[]).find((c) => c.type === 'app');
    const { status, body } = await json(`/v1/instances/${managedId}/apply-migration`, {
        method: 'POST', headers: authed(installer.token),
        body: JSON.stringify({
            targetVersion: latest.body.data.version,
            components: [{ componentId: appComp.id, action: 'custom', content: htmlFor('Merged', 'CUSTOM MERGE') }],
        }),
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'MANAGED_BY_PACKAGE', `code ${body.error?.code}`);
});

await test('The update replaces the managed copy with the new version', async () => {
    const { status, body } = await json(`/v1/instances/${managedId}/update`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({}),
    });
    assert(status === 200, `update: ${status} ${JSON.stringify(body)}`);
    assert((body.data.needsYou ?? []).length === 0, `nothing waits for a merge, got ${JSON.stringify(body.data.needsYou)}`);
    assert(body.data.applied !== null && (body.data.applied.failedComponents ?? []).length === 0,
        `applied cleanly, got ${JSON.stringify(body.data.applied)}`);
    const served = await (await fetch(`${BASE}/v1/apps/${installer.owner}/${managedApp}`)).text();
    assert(served.includes('v2-mark'), `the new version is served, got ${served.slice(0, 300)}`);
});

console.log('\nPhase 5 — The fork');

await test('A fork without a token answers 401', async () => {
    const { status } = await json(`/v1/instances/${managedId}/fork`, { method: 'POST', body: '{}' });
    assert(status === 401, `expected 401, got ${status}`);
});

await test("Another owner cannot fork someone else's install", async () => {
    const { status, body } = await json(`/v1/instances/${managedId}/fork`, {
        method: 'POST', headers: authed(stranger.token), body: '{}',
    });
    assert(status === 403, `expected 403, got ${status} ${JSON.stringify(body)}`);
});

await test('Forking an editable install answers 409 NOT_MANAGED', async () => {
    const { status, body } = await json(`/v1/instances/${editableId}/fork`, {
        method: 'POST', headers: authed(installer.token), body: '{}',
    });
    assert(status === 409, `expected 409, got ${status} ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_MANAGED', `code ${body.error?.code}`);
});

await test('aimeat_package_fork makes the managed copy editable in place', async () => {
    const out = await callTool(agentSession, 'aimeat_package_fork', { instance_id: managedId });
    assert(!out.isError, `tool error: ${out.text}`);
    assert(out.data.mode === 'editable', `mode ${out.data.mode}`);
    assert(typeof out.data.forked_at === 'string', `forked_at ${out.data.forked_at}`);
    const inst = await json(`/v1/instances/${managedId}`, { headers: authed(installer.token) });
    assert(inst.body.data.mode === 'editable' && !!inst.body.data.forkedAt, `REST agrees: ${JSON.stringify(inst.body.data)}`);
});

await test('The forked app takes a new version, at the same address', async () => {
    const { status, body } = await newVersionOf(managedApp, installer.token);
    assert(status === 201, `expected 201, got ${status} ${JSON.stringify(body)}`);
    const served = await (await fetch(`${BASE}/v1/apps/${installer.owner}/${managedApp}`)).text();
    assert(served.includes('LOCAL EDIT'), 'the owner\'s own code is served now');
});

await test('A forked install receives no updates: check-update and update answer 409 FORKED', async () => {
    const check = await json(`/v1/instances/${managedId}/check-update`, { headers: authed(installer.token) });
    assert(check.status === 409 && check.body.error?.code === 'FORKED', `check-update: ${check.status} ${JSON.stringify(check.body)}`);
    const upd = await json(`/v1/instances/${managedId}/update`, {
        method: 'POST', headers: authed(installer.token), body: '{}',
    });
    assert(upd.status === 409 && upd.body.error?.code === 'FORKED', `update: ${upd.status} ${JSON.stringify(upd.body)}`);
});

await test('Forking twice answers 409 NOT_MANAGED', async () => {
    const out = await callTool(agentSession, 'aimeat_package_fork', { instance_id: managedId });
    assert(out.isError && out.text.startsWith('NOT_MANAGED'), `expected NOT_MANAGED, got ${out.text.slice(0, 200)}`);
});

console.log('\nCleanup');
for (const id of [managedId, editableId]) {
    if (id) await json(`/v1/instances/${id}?removeComponents=true`, { method: 'DELETE', headers: authed(installer.token) });
}
if (encodedGroupId) await json(`/v1/packages/${encodedGroupId}`, { method: 'DELETE', headers: authed(author.token) });
await json(`/v1/apps/${APP}`, { method: 'DELETE', headers: authed(author.token) });
await json(`/v1/cortex/${encodeURIComponent(CORTEX)}`, { method: 'DELETE', headers: authed(author.token) });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
