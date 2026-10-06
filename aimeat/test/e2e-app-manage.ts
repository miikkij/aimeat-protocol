/**
 * @file test/e2e-app-manage.ts
 * @description aimeat_app_manage on the node MCP server, against a real node: one tool with an
 *   `action` for every setting and read of an app, each action checked against its own field list
 *   and its own permission word, each calling the same service as its REST endpoint.
 *
 *   WHAT IT PROVES. The actions an agent could not reach before 2026-09-27 now work from a chat
 *   (hide an app, allow forking, set an access code, rename, fork tree, own thumbnail, draft preview
 *   link, app permissions, backup to storage, operator subdomains, cost, bundled agents, restoring a
 *   layout, reading a cortex's source), and each one's refusal is the same one REST gives. The three
 *   routes opened to agents (backup export, app grants list, subdomains) are driven over REST too,
 *   with and without the permission word.
 * @structure
 *   - Phase 1: fixtures (owner A is the operator on the runner's emptied database; owner B; agents)
 *   - Phase 2: the field list and the permission words
 *   - Phase 3: settings, versions, lineage, thumbnail, preview link, layout restore
 *   - Phase 4: grants, backup, cost, bundled agents, subdomains, cortex source
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-manage
 * @version-history
 *   v1.1.1 — 2026-10-06 — The agents hold catalogue:read, which aimeat_cortex_list asks since the
 *     secaudit 2026-10 follow-up (A4); test 20 measures the source refusal on an agent offered the list.
 *   v1.1.0 — 2026-09-27 — Phase 5: the ten old tool names answer TOOL_MOVED with the new call, on the node MCP server and through aimeat_invoke.
 *   v1.0.0 — 2026-09-27 — Initial (wish-app-toiminnot-ilman-mcp-ty-kalua-ja-ty-kalujen-m-r-n-hallint).
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

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'AppManageTest1234' }),
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

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `tk${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
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
    return tok.body.data.token as string;
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
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-app-manage', version: '1.0.0' },
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

// ── The run ────────────────────────────────────────────────────────────────────────────────────

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: aimeat_app_manage ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const APP = `am${STAMP}.html`;
const FORK = `am${STAMP}-fork.html`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WORDS = ['app:write', 'app:manage', 'memory:read', 'memory:write', 'signals:read', 'signals:write',
    'exchange:read', 'task:write', 'consent:manage', 'cortex:write', 'catalogue:read'];

// The first owner on the runner's emptied database is the operator.
const A = await makeOwner('amop');
const B = await makeOwner('amother');
const agent = await makeAgent(A, WORDS);
const narrow = await makeAgent(A, ['memory:read']);
// aimeat_cortex_list asks catalogue:read, the word GET /v1/cortex asks, since 2026-10-06 (secaudit
// 2026-10 follow-up, A4): an agent without it is not offered the tool, so the source refusal is
// measured on one that is offered the list and lacks cortex:write.
const reader = await makeAgent(A, ['memory:read', 'catalogue:read']);
const opAgent = await makeAgent(A, [...WORDS, 'operator:admin']);
const otherAgent = await makeAgent(B, WORDS);
const s = await openSession(agent);
const sNarrow = await openSession(narrow);
const sReader = await openSession(reader);
const sOp = await openSession(opAgent);
const sOther = await openSession(otherAgent);
const manage = (session: McpSession, args: Record<string, unknown>) => callTool(session, 'aimeat_app_manage', args);

console.log('\nPhase 1 — fixtures');

await test('1. Owner A publishes an app with a description', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: authed(A.token), body: JSON.stringify({
            filename: APP, content: Buffer.from('<!doctype html><title>Manage</title><h1>v1</h1>').toString('base64'),
            mime_type: 'text/html', name: 'Manage me', description: 'An app to manage', version: '1.0.0', category: 'tools', tags: [],
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

console.log('\nPhase 2 — the field list and the permission words');

await test('2. An agent holding only memory:read is offered the tool, and reads versions with it', async () => {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(sNarrow, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    assert(names.includes('aimeat_app_manage'), 'the tool is offered');
    for (const gone of ['aimeat_app_seo_set', 'aimeat_app_versions', 'aimeat_app_ui_set']) assert(!names.includes(gone), `${gone} is gone`);
    const v = await manage(sNarrow, { action: 'versions', filename: APP });
    assert(!v.isError && v.data.total === 1, `versions: ${v.text.slice(0, 200)}`);
});

await test('3. …and is refused an action that needs a word it does not hold, naming the word', async () => {
    const r = await manage(sNarrow, { action: 'settings', filename: APP, parked: true });
    assert(r.isError && r.text.startsWith('SCOPE_DENIED') && r.text.includes('app:write'), `expected SCOPE_DENIED app:write: ${r.text}`);
});

await test('4. A wrong call names every missing and foreign field at once, and changes nothing', async () => {
    const r = await manage(s, { action: 'settings', parked: true, geo: 'city', layout: {} });
    assert(r.isError && r.text.startsWith('INVALID_INPUT'), `expected INVALID_INPUT: ${r.text}`);
    assert(r.text.includes('is missing: filename') && r.text.includes('does not take: geo, layout'), `every problem named: ${r.text}`);
    const app = await callTool(s, 'aimeat_app_get', { owner: A.owner, filename: APP });
    assert(app.data.parked !== true, 'nothing was parked');
});

console.log('\nPhase 3 — settings, versions, lineage, thumbnail, preview link, layout');

await test('5. settings hides the app, allows forking, sets an access code and renames it, without a new version', async () => {
    const r = await manage(s, { action: 'settings', filename: APP, parked: true, forkable: true, access_code: 'open-sesame', name: 'Managed' });
    assert(!r.isError, `settings refused: ${r.text}`);
    assert(r.data.parked === true && r.data.forkable === true && r.data.protected === true && r.data.name === 'Managed', `answer: ${r.text.slice(0, 300)}`);
    const app = await callTool(s, 'aimeat_app_get', { owner: A.owner, filename: APP });
    assert(app.data.parked === true && app.data.forkable === true, `aimeat_app_get agrees: ${app.text.slice(0, 300)}`);
    const v = await manage(s, { action: 'versions', filename: APP });
    assert(v.data.total === 1, 'no new version was made');
    const list = await json(`/v1/apps?limit=200`);
    assert(!(list.body?.data?.apps ?? []).some((x: { filename: string }) => x.filename === APP), 'the public catalogue no longer lists it');
});

await test('6. settings with an empty access code clears it, and parked: false lists the app again', async () => {
    const r = await manage(s, { action: 'settings', filename: APP, access_code: '', parked: false });
    assert(!r.isError && r.data.protected === false && r.data.parked === false, `answer: ${r.text.slice(0, 300)}`);
});

await test('7. Another owner\'s agent cannot change the app; the service refuses it', async () => {
    const r = await manage(sOther, { action: 'settings', filename: APP, owner: A.owner, parked: true });
    assert(r.isError, `another owner changed the app: ${r.text}`);
    const app = await callTool(s, 'aimeat_app_get', { owner: A.owner, filename: APP });
    assert(app.data.parked !== true, 'and it stays listed');
});

await test('8. lineage names a fork made of the app', async () => {
    const f = await callTool(s, 'aimeat_app_fork', { owner: A.owner, filename: APP, new_filename: FORK });
    assert(!f.isError, `fork: ${f.text}`);
    const l = await manage(s, { action: 'lineage', filename: APP });
    assert(!l.isError && JSON.stringify(l.data).includes(FORK), `the fork is in the tree: ${l.text.slice(0, 300)}`);
    const none = await manage(s, { action: 'lineage', filename: `none-${STAMP}.html` });
    assert(none.isError && none.text.startsWith('NOT_FOUND'), `unknown app: ${none.text}`);
});

await test('9. screenshot_upload sets the thumbnail, screenshot_clear removes it', async () => {
    const up = await manage(s, { action: 'screenshot_upload', filename: APP, screenshot: PNG, screenshot_mime_type: 'image/png' });
    assert(!up.isError, `upload: ${up.text}`);
    const shot = await fetch(`${BASE}/v1/apps/${A.owner}/${APP}/screenshot`);
    assert(shot.status === 200, `the thumbnail is served: ${shot.status}`);
    const bad = await manage(s, { action: 'screenshot_upload', filename: APP, screenshot: 'not base64 !!' });
    assert(bad.isError && bad.text.startsWith('INVALID_INPUT'), `a broken image is refused: ${bad.text}`);
    const clear = await manage(s, { action: 'screenshot_clear', filename: APP });
    assert(!clear.isError && clear.data.cleared === true, `clear: ${clear.text}`);
    const gone = await fetch(`${BASE}/v1/apps/${A.owner}/${APP}/screenshot`);
    assert(gone.status === 404, `the thumbnail is gone: ${gone.status}`);
});

await test('10. preview_link opens the unpublished draft, and refuses when there is none', async () => {
    const none = await manage(s, { action: 'preview_link', filename: APP });
    assert(none.isError && none.text.startsWith('NOT_FOUND'), `no draft yet: ${none.text}`);
    const d = await callTool(s, 'aimeat_app_draft_save', { filename: APP, content_base64: Buffer.from('<!doctype html><title>Manage</title><h1>draft two</h1>').toString('base64') });
    assert(!d.isError, `draft save: ${d.text.slice(0, 200)}`);
    const p = await manage(s, { action: 'preview_link', filename: APP });
    assert(!p.isError && typeof p.data.preview_url === 'string' && p.data.preview_url.includes('preview='), `preview: ${p.text}`);
});

await test('11. ui_set stores a layout, a second replaces it, and ui_restore puts the first back', async () => {
    const one = await manage(s, { action: 'ui_set', filename: APP, layout: { v: 1, blocks: [] }, note: 'first' });
    assert(!one.isError, `first layout: ${one.text}`);
    const two = await manage(s, { action: 'ui_set', filename: APP, layout: { v: 1, blocks: [] }, note: 'second' });
    assert(!two.isError && two.data.replaced_version === one.data.version, `second: ${two.text}`);
    const back = await manage(s, { action: 'ui_restore', filename: APP, version: one.data.version });
    assert(!back.isError, `restore: ${back.text}`);
    const read = await manage(s, { action: 'ui_get', filename: APP });
    assert(read.data.layout?.meta?.note === 'first', `the first layout is back: ${JSON.stringify(read.data.layout)}`);
});

console.log('\nPhase 4 — grants, backup, cost, bundled agents, subdomains, cortex source');

await test('12. grants lists the owner\'s app grants and says where revoking happens', async () => {
    const g = await manage(s, { action: 'grants' });
    assert(!g.isError && Array.isArray(g.data.grants) && typeof g.data.total === 'number' && typeof g.data.next === 'string', `grants: ${g.text}`);
});

await test('13. GET /v1/app-grants answers an agent with consent:manage, and refuses one without', async () => {
    const ok = await json('/v1/app-grants', { headers: authed(agent) });
    assert(ok.status === 200, `with the word: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const no = await json('/v1/app-grants', { headers: authed(narrow) });
    assert(no.status === 403, `without it: ${no.status}`);
});

await test('14. backup_export writes a ZIP to the owner\'s private storage and names it', async () => {
    const b = await manage(s, { action: 'backup_export' });
    assert(!b.isError && typeof b.data.storage_key === 'string' && b.data.apps >= 1, `backup: ${b.text}`);
    const file = await fetch(`${BASE}/v1/storage/${b.data.storage_key.split('/').map(encodeURIComponent).join('/')}`, { headers: authed(A.token) });
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert(file.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b, `the owner fetches a ZIP: ${file.status}`);
    const rest = await json('/v1/apps/backup?to=storage', { headers: authed(narrow) });
    assert(rest.status === 403, `REST refuses an agent without app:write: ${rest.status}`);
});

await test('15. cost answers the app\'s contracts, empty for an app that holds none', async () => {
    const c = await manage(s, { action: 'cost', filename: APP });
    assert(!c.isError && c.data.total_contracts === 0 && c.data.app_id === `${A.owner}/${APP}`, `cost: ${c.text}`);
});

await test('16. The bundled-agent actions refuse an agent the app does not declare', async () => {
    const st = await manage(s, { action: 'agent_status', filename: APP, bundled_agent: 'nobody' });
    assert(st.isError && st.text.startsWith('AGENT_NOT_DECLARED'), `status: ${st.text}`);
    const dep = await manage(s, { action: 'agent_deploy', filename: APP, bundled_agent: 'nobody' });
    assert(dep.isError && dep.text.startsWith('AGENT_NOT_DECLARED'), `deploy: ${dep.text}`);
});

await test('17. The operator\'s own agent with operator:admin sets, lists and removes a subdomain', async () => {
    const sub = `am${STAMP}`;
    const set = await manage(sOp, { action: 'subdomain_set', subdomain: sub, subdomain_kind: 'redirect', target: 'https://example.com/am' });
    assert(!set.isError && set.data.created === true, `set: ${set.text}`);
    const again = await manage(sOp, { action: 'subdomain_set', subdomain: sub, enabled: false });
    assert(!again.isError && again.data.created === false, `update: ${again.text}`);
    const list = await manage(sOp, { action: 'subdomain_list' });
    assert(!list.isError && JSON.stringify(list.data).includes(sub), `list: ${list.text.slice(0, 200)}`);
    const del = await manage(sOp, { action: 'subdomain_delete', subdomain: sub });
    assert(!del.isError, `delete: ${del.text}`);
});

await test('18. …and any other agent is refused the subdomains, on the tool and on REST', async () => {
    const r = await manage(s, { action: 'subdomain_list' });
    assert(r.isError && r.text.startsWith('SCOPE_DENIED'), `without operator:admin: ${r.text}`);
    const o = await manage(sOther, { action: 'subdomain_list' });
    assert(o.isError, `another owner's agent: ${o.text}`);
    const rest = await json('/v1/admin/subdomains', { headers: authed(agent) });
    assert(rest.status === 403, `REST: ${rest.status}`);
    const restOp = await json('/v1/admin/subdomains', { headers: authed(opAgent) });
    assert(restOp.status === 200, `REST, the operator agent: ${restOp.status} ${JSON.stringify(restOp.body?.error)}`);
});

const cxName = `amcx${Date.now()}`;
const cxManifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${cxName}
  namespace: community
  description: app manage cortex read E2E
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: greeter
      filename: greeter.js
      exports: [hello]
      api_surface: hello()
`;

await test('19. aimeat_cortex_list reads one cortex in full, and its source for the owner who installed it', async () => {
    const inst = await callTool(s, 'aimeat_cortex_install', { manifest: cxManifest, libs: { 'greeter.js': 'window.__am = 1;' } });
    assert(!inst.isError, `install: ${inst.text}`);
    const one = await callTool(s, 'aimeat_cortex_list', { name: cxName });
    assert(!one.isError && one.data.name === cxName && Array.isArray(one.data.components) && !one.data.source, `detail: ${one.text.slice(0, 200)}`);
    const src = await callTool(s, 'aimeat_cortex_list', { name: cxName, include_source: true });
    assert(!src.isError && src.data.source?.libs?.['greeter.js'] === 'window.__am = 1;', `source: ${src.text.slice(0, 300)}`);
});

await test('20. …and refuses the source without cortex:write, and to another owner\'s agent', async () => {
    const narrowSrc = await callTool(sReader, 'aimeat_cortex_list', { name: cxName, include_source: true });
    assert(narrowSrc.isError && narrowSrc.text.startsWith('SCOPE_DENIED'), `without the word: ${narrowSrc.text}`);
    // A cortex another owner may see (public) refuses its source as FORBIDDEN; one they may not see
    // is NOT_FOUND on both reads, so probing names confirms nothing. Which one it is here is read first.
    const seen = await callTool(sOther, 'aimeat_cortex_list', { name: cxName });
    const expected = seen.isError ? 'NOT_FOUND' : 'FORBIDDEN';
    const other = await callTool(sOther, 'aimeat_cortex_list', { name: cxName, include_source: true });
    assert(other.isError && other.text.startsWith(expected), `another owner, expected ${expected}: ${other.text}`);
    await callTool(s, 'aimeat_cortex_delete', { name: cxName });
});

console.log('\nPhase 5 — the ten tools that moved answer with the call that replaces them');

const MOVED: Array<[string, string]> = [
    ['aimeat_app_versions', 'versions'], ['aimeat_app_screenshot', 'screenshot'], ['aimeat_app_seo_set', 'seo'],
    ['aimeat_app_marks_set', 'marks'], ['aimeat_app_legal_set', 'legal'], ['aimeat_app_audit', 'audit'],
    ['aimeat_app_visitors', 'visitors'], ['aimeat_app_visitors_measure', 'visitors_measure'],
    ['aimeat_app_ui_get', 'ui_get'], ['aimeat_app_ui_set', 'ui_set'],
];

await test('21. Each of the ten old names answers TOOL_MOVED and names the exact new call, and none is listed', async () => {
    const listed: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(s, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) listed.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    for (const [old, action] of MOVED) {
        assert(!listed.includes(old), `${old} is not in tools/list`);
        const r = await callTool(s, old, { filename: APP });
        assert(r.isError && r.text.startsWith('TOOL_MOVED'), `${old}: expected TOOL_MOVED, got ${r.text.slice(0, 200)}`);
        assert(r.text.includes(`aimeat_app_manage with action "${action}"`), `${old} names its action: ${r.text.slice(0, 300)}`);
        assert(r.text.includes('filename'), `${old} says how the fields map: ${r.text.slice(0, 300)}`);
    }
});

await test('23. audit_archive moves the log into its year, audit reads it back with year, audit_keep keeps all but refuses a deleting limit', async () => {
    const before = await manage(s, { action: 'audit', filename: APP });
    assert(!before.isError && Array.isArray(before.data.archives) && before.data.keep?.keep === 0, `audit answers archives and keep: ${before.text.slice(0, 300)}`);
    const total = before.data.total as number;
    const moved = await manage(s, { action: 'audit_archive', filename: APP, before: new Date(Date.now() + 60_000).toISOString() });
    assert(!moved.isError && moved.data.moved === total, `archive: ${moved.text.slice(0, 300)}`);
    const year = new Date().toISOString().slice(0, 4);
    const read = await manage(s, { action: 'audit', filename: APP, year });
    assert(!read.isError && read.data.year === year && read.data.total === total, `the year reads back: ${read.text.slice(0, 300)}`);
    const keep = await manage(s, { action: 'audit_keep' });
    assert(!keep.isError && keep.data.keep === 0, `read the setting: ${keep.text.slice(0, 300)}`);
    const limit = await manage(s, { action: 'audit_keep', keep: '5' });
    assert(limit.isError && limit.text.includes('OWNER_ONLY'), `an agent set a deleting limit: ${limit.text.slice(0, 300)}`);
    const all = await manage(s, { action: 'audit_keep', keep: 'all' });
    assert(!all.isError && all.data.keep === 0 && all.data.deleted === 0, `keep all: ${all.text.slice(0, 300)}`);
});

await test('22. aimeat_invoke with an old name gives the same answer', async () => {
    const r = await callTool(s, 'aimeat_invoke', { capability: 'aimeat_app_seo_set', input: { filename: APP } });
    // aimeat_invoke answers a refusal as JSON: { code, message }.
    assert(r.isError && r.data.code === 'TOOL_MOVED' && String(r.data.message).includes('aimeat_app_manage with action "seo"'), `invoke: ${r.text.slice(0, 300)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
