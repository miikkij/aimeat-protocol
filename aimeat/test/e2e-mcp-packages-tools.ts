/**
 * @file test/e2e-mcp-packages-tools.ts
 * @description The six package tools and the three task tools on the node's own MCP door at /v1/mcp
 *   that no suite had ever called.
 *
 *   WHY THIS SUITE EXISTS. Two files, one absence. test/e2e-mcp-packages.ts drives
 *   aimeat_package_install and nothing else of src/mcp/packages.ts, and the other six —
 *   list, get, compose, pull, update, status_set — arrived on 2026-09-05 to close the hole where
 *   install was a step with no way in and no way out. Nothing then called them, so "an agent can now
 *   name the group id install requires, and make its own package installable" stayed a claim.
 *   test/e2e-mcp-agent-tasks.ts drives the task lifecycle and skips three of its tools —
 *   aimeat_task_list, _task_todo, _task_fail — plus two branches nobody reached: the deduplicated
 *   answer of _task_create, and the isOwnTask refusal of _task_complete.
 *
 *   HOW IT IS BUILT. Every fixture comes through a REST door another suite already keeps green: the
 *   app through POST /v1/apps, the second package version through POST /v1/packages/:groupId/versions,
 *   the installed copy through POST /v1/packages/:groupId/install, the task and its plan through
 *   POST /v1/agents/:name/tasks and /propose-todos. The MCP tool is then driven against that seed and
 *   the record read back through REST, so a tool that decided something its route would not shows up
 *   as a mismatch rather than as a green run.
 * @structure
 *   - Phase 1: fixtures (owner, three agents, one published app)
 *   - Phase 2: the scope fence on both tool families
 *   - Phase 3: the package tools (compose, list, get, status_set, update, pull)
 *   - Phase 4: the task tools (list, todo, fail) and the two unreached branches
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-packages-tools
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: the six uncalled tools of src/mcp/packages.ts and the three of
 *     src/mcp/agent-tasks.ts, plus the dedupe and isOwnTask branches.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
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
            body: JSON.stringify({ username: owner, display_name: owner, password: 'PackageToolTest1234' }),
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

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(
    ownerCtx: { token: string; owner: string },
    scopes: string[],
    extra: Record<string, unknown> = {},
): Promise<{ token: string; name: string; gaii: string }> {
    const name = `pt${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes, ...extra }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, name, gaii };
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
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
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-packages-tools', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the uncalled package and task tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const owner = await makeOwner('pkgtool');

const builder = await makeAgent(owner, ['packages:write', 'app:write', 'memory:read']);
const runner = await makeAgent(owner, ['*'], { mode: 'task-runner', capabilities: ['tasks'] });
const sibling = await makeAgent(owner, ['*'], { mode: 'interactive', capabilities: ['tasks'] });
const narrow = await makeAgent(owner, ['memory:read']);

const APP_FILE = `mcptools-${Date.now().toString(36).slice(-6)}.html`;
const PKG_NAME = `mcp-tools-pkg-${Date.now().toString(36).slice(-6)}`;
const htmlFor = (title: string): string =>
    `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

let groupId = '';
let encodedGroupId = '';
let firstVersion = '';
let instanceId = '';

console.log('\nPhase 1 — fixtures, seeded through the REST doors');

await test('1. The owner publishes an app for the package to be built out of', async () => {
    const r = await json('/v1/apps', {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({
            filename: APP_FILE, content: b64(htmlFor('MCP Tools Shop')),
            name: 'MCP Tools Shop', description: 'A fixture for the package tool suite',
            category: 'utility', tags: ['mcp', 'fixture'],
        }),
    });
    assert(r.status === 201, `publish app ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

console.log('\nPhase 2 — the scope fence decides which tools exist');

const PACKAGE_GATED = [
    'aimeat_package_compose', 'aimeat_package_pull', 'aimeat_package_update', 'aimeat_package_status_set',
];
const PACKAGE_UNGATED = ['aimeat_package_list', 'aimeat_package_get'];

const builderSession = await openSession(builder.token);
const runnerSession = await openSession(runner.token);
const siblingSession = await openSession(sibling.token);

await test('2. An agent holding packages:write and app:write is handed all six package tools', async () => {
    const names = await toolNames(builderSession);
    for (const t of [...PACKAGE_GATED, ...PACKAGE_UNGATED]) assert(names.includes(t), `${t} must be offered`);
});

await test('3. …an agent holding neither word keeps the two reads and loses the four writes', async () => {
    const names = await toolNames(await openSession(narrow.token));
    for (const t of PACKAGE_GATED) assert(!names.includes(t), `${t} writes and must be gone without its word`);
    for (const t of PACKAGE_UNGATED) {
        assert(names.includes(t), `${t} mirrors a public REST read, so gating it here would be stricter than REST`);
    }
    // The same session, the task family: creating work carries task:write and the reports do not.
    assert(!names.includes('aimeat_task_create'), 'aimeat_task_create carries task:write and must be gone');
    for (const t of ['aimeat_task_list', 'aimeat_task_todo', 'aimeat_task_fail']) {
        assert(names.includes(t), `${t} is authorized by isOwnTask in the handler, not by a scope word`);
    }
});

await test('4. The REST doors behind them refuse an unauthenticated write with 401', async () => {
    const compose = await fetch(`${BASE}/v1/packages/compose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no-token', apps: [APP_FILE] }),
    });
    assert(compose.status === 401, `expected 401 without a token on compose, got ${compose.status}`);
});

console.log('\nPhase 3 — the package tools');

await test('5. aimeat_package_compose builds a package out of the owner\'s own app', async () => {
    const out = await callTool(builderSession, 'aimeat_package_compose', {
        name: PKG_NAME, apps: [APP_FILE],
        description: 'One app and what the node knows it loads',
        category: 'utility', tags: ['mcp', 'e2e'],
    });
    assert(!out.isError, `compose refused: ${out.text.slice(0, 300)}`);
    groupId = out.data.group_id;
    encodedGroupId = encodeURIComponent(groupId);
    firstVersion = out.data.version;
    assert(groupId.includes(owner.owner), `the group id carries the owner: ${groupId}`);
    assert(out.data.status === 'published' && out.data.visibility === 'private',
        `composed private and published, so the author can install it at once: ${JSON.stringify(out.data)}`);
    assert(out.data.components.some((c: any) => c.id === APP_FILE && c.type === 'app'),
        `the app must be a component: ${JSON.stringify(out.data.components)}`);

    const rest = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(owner.token) });
    assert(rest.status === 200 && rest.body.data.packageGroupId === groupId,
        `the REST door must hold the package the tool built: ${rest.status}`);
});

await test('6. …and refuses an app that is not the caller\'s to package', async () => {
    const out = await callTool(builderSession, 'aimeat_package_compose', {
        name: `${PKG_NAME}-nope`, apps: ['ei-olemassa.html'],
    });
    assert(out.isError, `an unknown app must be refused: ${out.text.slice(0, 200)}`);
    const listed = await json(`/v1/packages/${encodeURIComponent(`${PKG_NAME}-nope::${owner.owner}`)}`, {
        headers: authed(owner.token),
    });
    assert(listed.status === 404, `the refused package must not exist, got ${listed.status}`);
});

await test('7. aimeat_package_list shows the author their own private package, and a stranger nothing', async () => {
    // A composed package is PRIVATE, and listPackagesFor filters to public unless the author filter
    // names the caller — which is what the tool's own `author` parameter says it is for. So this is
    // two assertions in one: the author sees it, and the same search without the author does not.
    const mine = await callTool(builderSession, 'aimeat_package_list', { search: PKG_NAME, author: owner.owner });
    assert(!mine.isError, `list refused: ${mine.text.slice(0, 200)}`);
    assert(mine.data.packages.some((p: any) => p.group_id === groupId),
        `the author's own list must find it: ${JSON.stringify(mine.data.packages.map((p: any) => p.group_id))}`);
    assert(mine.data.packages.every((p: any) => p.author === owner.owner),
        `an author filter must narrow to that author: ${JSON.stringify(mine.data.packages.map((p: any) => p.author))}`);

    const public_ = await callTool(builderSession, 'aimeat_package_list', { search: PKG_NAME });
    assert(!public_.isError && !public_.data.packages.some((p: any) => p.group_id === groupId),
        `a private package is not on the public shelf: ${JSON.stringify(public_.data.packages.map((p: any) => p.group_id))}`);

    const drafts = await callTool(builderSession, 'aimeat_package_list', {
        search: PKG_NAME, author: owner.owner, status: 'draft',
    });
    assert(!drafts.isError && !drafts.data.packages.some((p: any) => p.group_id === groupId),
        `a published package is not a draft: ${JSON.stringify(drafts.data)}`);
});

await test('8. aimeat_package_get answers about one package, and refuses an unknown group id', async () => {
    const out = await callTool(builderSession, 'aimeat_package_get', { group_id: groupId });
    assert(!out.isError, `get refused: ${out.text.slice(0, 200)}`);
    assert(out.data.group_id === groupId && out.data.author === owner.owner, `the summary: ${JSON.stringify(out.data)}`);
    assert(out.data.components.some((c: any) => c.id === APP_FILE), 'the components are named');

    const rest = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(owner.token) });
    assert(rest.body.data.version === out.data.version,
        `the two doors must agree on the version: ${rest.body.data.version} vs ${out.data.version}`);

    const unknown = await callTool(builderSession, 'aimeat_package_get', { group_id: 'ei-olemassa::kukaan' });
    assert(unknown.isError && unknown.text.includes('NOT_FOUND'), `unknown group: ${unknown.text.slice(0, 200)}`);
});

await test('9. aimeat_package_status_set archives a version and publishes it again', async () => {
    const archived = await callTool(builderSession, 'aimeat_package_status_set', {
        group_id: groupId, version: firstVersion, status: 'archived',
    });
    assert(!archived.isError, `status_set refused: ${archived.text.slice(0, 300)}`);
    assert(archived.data.status === 'archived', `the answer carries the new status: ${JSON.stringify(archived.data.status)}`);

    // The token is not decoration: a private package answers 404 to a caller who is not its author.
    const rest = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`, { headers: authed(owner.token) });
    assert(rest.status === 200 && rest.body.data.status === 'archived',
        `REST must read the same status: ${rest.status} ${JSON.stringify(rest.body.data?.status)}`);

    // Back to published, because the rest of this phase installs from it.
    const back = await callTool(builderSession, 'aimeat_package_status_set', {
        group_id: groupId, version: firstVersion, status: 'published',
    });
    assert(!back.isError && back.data.status === 'published', `re-publish: ${back.text.slice(0, 200)}`);
});

await test('10. …and refuses a status change on a package the caller does not author', async () => {
    const stranger = await makeOwner('pkgstranger');
    const strangerAgent = await makeAgent(stranger, ['packages:write', 'app:write']);
    const out = await callTool(await openSession(strangerAgent.token), 'aimeat_package_status_set', {
        group_id: groupId, status: 'archived',
    });
    assert(out.isError, `only the author may move a version: ${out.text.slice(0, 200)}`);

    const rest = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`, { headers: authed(owner.token) });
    assert(rest.body.data.status === 'published', `the refused change must have changed nothing: ${rest.body.data.status}`);
});

await test('11. The package is installed over REST, so update has an instance to work on', async () => {
    const r = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({ label: 'The copy this suite updates' }),
    });
    assert(r.status === 201, `install ${r.status}: ${JSON.stringify(r.body?.error)}`);
    instanceId = r.body.data.id;
    assert(r.body.data.packageGroupId === groupId,
        `the instance must point at the package it was installed from: ${JSON.stringify(r.body.data.packageGroupId)}`);
    assert(typeof instanceId === 'string' && instanceId.length > 0,
        `no instance id in ${JSON.stringify(r.body.data).slice(0, 200)}`);
});

await test('12. aimeat_package_update reports no update while the instance is on the latest version', async () => {
    const out = await callTool(builderSession, 'aimeat_package_update', { instance_id: instanceId, dry_run: true });
    assert(!out.isError, `update refused: ${out.text.slice(0, 300)}`);
    assert(out.data.updateAvailable === false, `nothing newer exists yet: ${JSON.stringify(out.data)}`);
    assert(out.data.currentVersion === firstVersion, `current version: ${out.data.currentVersion}`);
    assert(out.data.applied === null, 'a report with nothing to apply applies nothing');
});

await test('13. A second version is published over REST, and the dry run then reports it without applying it', async () => {
    const current = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(owner.token) });
    const components = (current.body.data.components ?? []).map((c: any) => (
        c.id === APP_FILE ? { ...c, content: htmlFor('MCP Tools Shop v2') } : c
    ));
    const v2 = await json(`/v1/packages/${encodedGroupId}/versions`, {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({ changelog: 'The shop got a new heading', components, status: 'published' }),
    });
    assert(v2.status === 201, `add version ${v2.status}: ${JSON.stringify(v2.body?.error)}`);

    const out = await callTool(builderSession, 'aimeat_package_update', { instance_id: instanceId, dry_run: true });
    assert(!out.isError, `dry run refused: ${out.text.slice(0, 300)}`);
    assert(out.data.updateAvailable === true, `the new version must be seen: ${JSON.stringify(out.data)}`);
    assert(out.data.latestVersion === v2.body.data.version, `latest: ${out.data.latestVersion}`);
    assert(out.data.dryRun === true && out.data.applied === null, 'a dry run reports and changes nothing');

    const still = await json(`/v1/instances/${instanceId}`, { headers: authed(owner.token) });
    assert(still.body.data.packageVersion === firstVersion,
        `the instance must still be on the old version, got ${still.body.data.packageVersion}`);
});

await test('14. …and the real run moves the instance, which REST then confirms', async () => {
    const out = await callTool(builderSession, 'aimeat_package_update', { instance_id: instanceId });
    assert(!out.isError, `update refused: ${out.text.slice(0, 300)}`);
    assert(out.data.applied !== null, `an update with something safe to apply applies it: ${JSON.stringify(out.data)}`);
    assert(out.data.willUpdate.includes(APP_FILE), `the changed component: ${JSON.stringify(out.data.willUpdate)}`);

    const moved = await json(`/v1/instances/${instanceId}`, { headers: authed(owner.token) });
    assert(moved.body.data.packageVersion === out.data.latestVersion,
        `the instance must be on the new version, got ${moved.body.data.packageVersion}`);
});

await test('15. …and refuses an instance that is not the caller\'s', async () => {
    const out = await callTool(builderSession, 'aimeat_package_update', { instance_id: 'ei-olemassa' });
    assert(out.isError, `an unknown instance must be refused: ${out.text.slice(0, 200)}`);
});

await test('16. aimeat_package_pull answers to the node\'s own federation switch', async () => {
    // The happy path needs a second node publishing a signed package, which is a suite of its own.
    // What IS reachable here is the switch in front of every branch, and it is the one an operator
    // turns off: a pulled extension runs code in the sandbox and a pulled app gets an address.
    const out = await callTool(builderSession, 'aimeat_package_pull', { group_id: 'signage::alice', node_id: 'jokin-solmu' });
    assert(out.isError && out.text.includes('PACKAGE_FEDERATION_DISABLED'),
        `a node that does not exchange packages must say so rather than reach out: ${out.text.slice(0, 250)}`);

    const noSource = await callTool(builderSession, 'aimeat_package_pull', { group_id: 'signage::alice' });
    assert(noSource.isError, `a pull with nowhere to pull from is refused: ${noSource.text.slice(0, 200)}`);
});

console.log('\nPhase 4 — the task tools');

let plannedTaskId = '';
let todoId = '';
let failTaskId = '';

await test('17. A task and its plan are seeded over REST for the task-runner agent', async () => {
    const created = await json(`/v1/agents/${runner.name}/tasks`, {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({
            title: 'Fetch the weekly figures',
            description: 'The commission this suite reads back through the MCP task tools',
            status: 'queued',
            scope: [{ name: 'kind', value: 'weekly-figures', type: 'text' }],
        }),
    });
    assert(created.status === 201, `create task ${created.status}: ${JSON.stringify(created.body?.error)}`);
    plannedTaskId = created.body.data.task.id;

    const planned = await json(`/v1/agents/${runner.name}/tasks/${plannedTaskId}/propose-todos`, {
        method: 'POST', headers: authed(runner.token),
        body: JSON.stringify({
            todos: [
                { title: 'Read the ledger', description: 'The first half' },
                { title: 'Write the summary', description: 'The second half' },
            ],
        }),
    });
    assert(planned.status === 200, `propose-todos ${planned.status}: ${JSON.stringify(planned.body?.error)}`);
    todoId = planned.body.data.task.todos[0].id;

    const second = await json(`/v1/agents/${runner.name}/tasks`, {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({ title: 'A task that will be failed', description: 'For the fail tool', status: 'queued' }),
    });
    assert(second.status === 201, `second task ${second.status}: ${JSON.stringify(second.body?.error)}`);
    failTaskId = second.body.data.task.id;
});

await test('18. aimeat_task_list gives the agent its own queue, with the field a fleet dispatches on', async () => {
    const out = await callTool(runnerSession, 'aimeat_task_list', {});
    assert(!out.isError, `task_list refused: ${out.text.slice(0, 300)}`);
    const t = out.data.tasks.find((x: any) => x.id === plannedTaskId);
    assert(t?.title === 'Fetch the weekly figures',
        `the seeded task must be listed: ${JSON.stringify(out.data.tasks.map((x: any) => x.id))}`);
    assert(t.todos_total === 2 && t.todos_done === 0, `the todo counts: ${JSON.stringify({ total: t.todos_total, done: t.todos_done })}`);
    // Trimmed out of this listing once, which turned one call into a hundred: without `scope` a
    // runner cannot tell what any of these tasks ARE, so it fetches every one of them.
    assert(t.scope?.some((s: any) => s.name === 'kind' && s.value === 'weekly-figures'),
        `the dispatch scope must ride the listing: ${JSON.stringify(t.scope)}`);
    assert(typeof out.data.total === 'number' && out.data.page === 1, `pagination: ${JSON.stringify(out.data)}`);
});

await test('19. …the status filter narrows it, and another agent sees none of these tasks', async () => {
    const done = await callTool(runnerSession, 'aimeat_task_list', { status: 'done' });
    assert(!done.isError && !done.data.tasks.some((x: any) => x.id === plannedTaskId),
        `a task that is not done must not answer a done filter: ${JSON.stringify(done.data.tasks.map((x: any) => x.id))}`);

    const theirs = await callTool(siblingSession, 'aimeat_task_list', {});
    assert(!theirs.isError && !theirs.data.tasks.some((x: any) => x.id === plannedTaskId),
        `a sibling agent's queue is its own: ${JSON.stringify(theirs.data.tasks.map((x: any) => x.id))}`);
});

await test('20. aimeat_task_todo ticks a todo off, and REST reads the same one done', async () => {
    const out = await callTool(runnerSession, 'aimeat_task_todo', {
        task_id: plannedTaskId, todo_id: todoId, status: 'done',
    });
    assert(!out.isError, `task_todo refused: ${out.text.slice(0, 300)}`);
    assert(out.data.updated === true && out.data.todo_title === 'Read the ledger',
        `the answer names the todo: ${JSON.stringify(out.data)}`);

    const rest = await json(`/v1/agents/${runner.name}/tasks/${plannedTaskId}`, { headers: authed(owner.token) });
    const todo = rest.body.data.task.todos.find((t: any) => t.id === todoId);
    assert(todo?.status === 'done', `REST must see the tick: ${JSON.stringify(todo?.status)}`);

    const relisted = await callTool(runnerSession, 'aimeat_task_list', {});
    assert(relisted.data.tasks.find((x: any) => x.id === plannedTaskId)?.todos_done === 1,
        'and the listing counts it');
});

await test('21. …and refuses a todo on a task that belongs to another agent', async () => {
    const out = await callTool(siblingSession, 'aimeat_task_todo', {
        task_id: plannedTaskId, todo_id: todoId, status: 'pending',
    });
    assert(out.isError && out.text.includes('Access denied'),
        `only the agent doing the work may report on it: ${out.text.slice(0, 200)}`);

    const rest = await json(`/v1/agents/${runner.name}/tasks/${plannedTaskId}`, { headers: authed(owner.token) });
    assert(rest.body.data.task.todos.find((t: any) => t.id === todoId)?.status === 'done',
        'the refused write must have changed nothing');
});

await test('22. aimeat_task_fail hands the failure in, with the reason, on both doors', async () => {
    const out = await callTool(runnerSession, 'aimeat_task_fail', {
        task_id: failTaskId, reason: 'The upstream ledger answered 500 four times',
    });
    assert(!out.isError, `task_fail refused: ${out.text.slice(0, 300)}`);
    assert(out.data.failed === true && out.data.status === 'failed', `the answer: ${JSON.stringify(out.data)}`);
    assert(out.data.reason.includes('answered 500'), `the reason travels: ${out.data.reason}`);
    assert(out.data.completed_at, 'a failed task is finished, so it carries a time');

    const rest = await json(`/v1/agents/${runner.name}/tasks/${failTaskId}`, { headers: authed(owner.token) });
    assert(rest.body.data.task.status === 'failed', `REST must read it failed: ${rest.body.data.task.status}`);
});

await test('23. …and refuses a failure reported on somebody else\'s task', async () => {
    const out = await callTool(siblingSession, 'aimeat_task_fail', { task_id: plannedTaskId, reason: 'not mine to fail' });
    assert(out.isError && out.text.includes('Access denied'),
        `a sibling must not be able to fail this agent's work: ${out.text.slice(0, 200)}`);

    const unknown = await callTool(runnerSession, 'aimeat_task_fail', { task_id: 'ei-olemassa', reason: 'x' });
    assert(unknown.isError && unknown.text.includes('Task not found'), `an unknown task: ${unknown.text.slice(0, 200)}`);
});

await test('24. aimeat_task_create answers a repeat commission with the live one, not a second', async () => {
    const args = {
        target_agent: runner.name,
        title: 'Reconcile the invoices',
        description: 'The commission that gets ordered twice',
    };
    const first = await callTool(runnerSession, 'aimeat_task_create', args);
    assert(!first.isError, `create refused: ${first.text.slice(0, 300)}`);
    assert(first.data.task_id && first.data.deduplicated === undefined,
        `the first order is a real one: ${JSON.stringify(first.data)}`);

    const second = await callTool(runnerSession, 'aimeat_task_create', args);
    assert(!second.isError, `the repeat must be an answer, not a refusal: ${second.text.slice(0, 300)}`);
    assert(second.data.deduplicated === true && second.data.task_id === first.data.task_id,
        `the existing commission is returned instead of a second: ${JSON.stringify(second.data)}`);
    assert(String(second.data.note ?? '').includes('already live'),
        `and it says why: ${second.data.note}`);

    const list = await json(`/v1/agents/${runner.name}/tasks?per_page=100`, { headers: authed(owner.token) });
    const matching = (list.body.data.tasks ?? []).filter((t: any) => t.title === args.title);
    assert(matching.length === 1, `one order, one task, however many times it was clicked: ${matching.length}`);
});

await test('25. aimeat_task_complete refuses a task the caller was not given', async () => {
    const out = await callTool(siblingSession, 'aimeat_task_complete', {
        task_id: plannedTaskId, message: 'declaring somebody else\'s work done',
    });
    assert(out.isError && out.text.includes('Access denied'),
        `the agent doing the work is the only one that may report it finished: ${out.text.slice(0, 200)}`);

    const rest = await json(`/v1/agents/${runner.name}/tasks/${plannedTaskId}`, { headers: authed(owner.token) });
    assert(rest.body.data.task.status !== 'done',
        `and the task must be exactly where it was: ${rest.body.data.task.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
