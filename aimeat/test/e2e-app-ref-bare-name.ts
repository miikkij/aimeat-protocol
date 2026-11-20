/**
 * @file test/e2e-app-ref-bare-name.ts
 * @description An app named without `.html` is the same app on every kind of input: a REST path, a
 *   REST body, the MCP tools that read and call an app's tools, and the owner-only PATCH and DELETE.
 *
 *   WHY THIS SUITE EXISTS. An app is stored by its filename (`lifecycle-central.html`) and every
 *   person and AI names it without the extension. aimeat_app_tools_get and aimeat_app_tool_invoke
 *   answered APP_TOOLS_NOT_FOUND to `lifecycle-central`, and their hint, cut at twelve names in
 *   alphabetical order, never named the right one. services/app/app-ref.ts is now the one rule
 *   (exact filename first, then `.html`), and middleware/app-ref-path.ts applies it to every
 *   `/v1/apps/<owner>/<name>` path. Seen red on the code before the change: tests 2 to 7 failed.
 *
 *   WHAT IT REFUSES. A name prefixed with ANOTHER owner never resolves into this owner's app, and
 *   another owner's PATCH or DELETE by the bare name reaches nothing of the app's owner.
 * @structure
 *   - Phase 1: fixtures (two owners, an agent of each, an app with a tool manifest)
 *   - Phase 2: the designed use (REST path, MCP read and call, publish by the bare name, PATCH, DELETE)
 *   - Phase 3: the refusals (another owner's prefix, another owner's PATCH and DELETE)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-ref-bare-name
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */

import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { callTool, makeAgent, openSession } from './helpers/mcp-session.js';

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

function publishBody(filename: string, title: string): string {
    return JSON.stringify({
        filename, content: Buffer.from(`<!doctype html><title>${title}</title><h1>${title}</h1>`).toString('base64'),
        mime_type: 'text/html', name: title, description: 'An app for the bare-name suite', version: '1.0.0', category: 'tools', tags: [],
    });
}

console.log('═══ E2E: an app named without .html is the same app everywhere ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const APP = `bnapp${STAMP}`;
const FILE = `${APP}.html`;
const NEW = `bnnew${STAMP}`;
const TOOL = { name: 'ping', description: 'A tool with no backing action', inputSchema: { type: 'object', properties: {} } };

const alice = await registerOwner(BASE, `bnalice${STAMP}`);
const bob = await registerOwner(BASE, `bnbob${STAMP}`);
const aliceAgent = await makeAgent(BASE, alice, ['app:read', 'app:write', 'commerce:sell', 'exchange:read', 'exchange:write', 'memory:read', 'memory:write', 'ext:invoke']);
const session = await openSession(BASE, aliceAgent.token, 'e2e-app-ref-bare-name');
const bobAgent = await makeAgent(BASE, bob, ['app:read', 'exchange:read', 'exchange:write', 'memory:read']);
const bobSession = await openSession(BASE, bobAgent.token, 'e2e-app-ref-bare-name-bob');

console.log('\nPhase 1 — fixtures');

await test('1. Alice publishes the app as a .html file and a public tool manifest for it', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(FILE, 'Bare one') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const tools = await callTool(session, 'aimeat_app_tools_publish', { app_id: FILE, tools: [TOOL] });
    assert(!tools.isError, `tools publish refused: ${tools.text.slice(0, 300)}`);
});

console.log('\nPhase 2 — the bare name reaches the app on every input');

await test('2. GET /v1/apps/<owner>/<name> answers as GET /v1/apps/<owner>/<name>.html does', async () => {
    const full = await json(`/v1/apps/${alice.name}/${FILE}`, { redirect: 'manual' });
    const bare = await json(`/v1/apps/${alice.name}/${APP}`, { redirect: 'manual' });
    assert(full.status === 200 || (full.status >= 300 && full.status < 400), `the .html path answers: ${full.status}`);
    assert(bare.status === full.status, `the bare path answers the same status: ${bare.status} vs ${full.status}`);
    assert(bare.headers.get('location') === full.headers.get('location'), `the same redirect target: ${bare.headers.get('location')} vs ${full.headers.get('location')}`);
});

await test('3. A JSON route under the app takes the bare name too (GET .../news)', async () => {
    const full = await json(`/v1/apps/${alice.name}/${FILE}/news`, { headers: authed(alice.token) });
    const bare = await json(`/v1/apps/${alice.name}/${APP}/news`, { headers: authed(alice.token) });
    assert(full.status === 200, `the .html route answers: ${full.status} ${JSON.stringify(full.body?.error)}`);
    assert(bare.status === 200, `the bare route answers: ${bare.status} ${JSON.stringify(bare.body?.error)}`);
});

await test('4. aimeat_app_tools_get reads the manifest by the bare name, and by owner/name with no owner argument', async () => {
    const bare = await callTool(session, 'aimeat_app_tools_get', { app_id: APP });
    assert(!bare.isError, `read by the bare name refused: ${bare.text.slice(0, 300)}`);
    assert(bare.data.manifest?.tools?.[0]?.name === 'ping', `the manifest comes back: ${bare.text.slice(0, 300)}`);
    const prefixed = await callTool(bobSession, 'aimeat_app_tools_get', { app_id: `${alice.name}/${APP}` });
    assert(!prefixed.isError, `another owner's public read by owner/name refused: ${prefixed.text.slice(0, 300)}`);
    assert(prefixed.data.manifest?.tools?.[0]?.name === 'ping', `the public manifest comes back: ${prefixed.text.slice(0, 300)}`);
});

await test('5. POST /v1/apps under the bare name updates the .html app instead of starting a second one', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(APP, 'Bare two') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const data = pub.body.data ?? {};
    assert(data.filename === FILE, `the publish lands on ${FILE}: ${JSON.stringify(data).slice(0, 300)}`);
    assert(Number(data.version_number ?? data.versionNumber) === 2, `it is the app's second version: ${JSON.stringify(data).slice(0, 300)}`);
});

await test('6. A new HTML app published under a name with no extension is stored as name.html', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(NEW, 'Brand new') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    assert(pub.body.data?.filename === `${NEW}.html`, `stored as ${NEW}.html: ${JSON.stringify(pub.body.data).slice(0, 300)}`);
});

await test('7. PATCH /v1/apps/<name> (the owner is the caller) changes the .html app', async () => {
    const p = await json(`/v1/apps/${APP}`, { method: 'PATCH', headers: authed(alice.token), body: JSON.stringify({ description: 'Patched by the bare name' }) });
    assert(p.status === 200, `patch ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const list = await json(`/v1/apps?owner=${alice.name}&q=${APP}`, { headers: authed(alice.token) });
    const row = (list.body.data?.apps ?? []).find((a: any) => a.filename === FILE);
    assert(row, `the app is listed: ${JSON.stringify(list.body.data).slice(0, 300)}`);
    const desc = row.description ?? row.manifest?.description;
    assert(desc === 'Patched by the bare name', `the description changed: ${desc}`);
});

console.log('\nPhase 3 — the refusals');

await test('8. A name prefixed with another owner never resolves into this owner\'s app', async () => {
    const out = await callTool(session, 'aimeat_app_tool_invoke', { owner: alice.name, app: `${bob.name}/${APP}`, tool: 'ping', input: {} });
    assert(out.isError && out.text.startsWith('APP_TOOLS_NOT_FOUND'), `expected APP_TOOLS_NOT_FOUND: ${out.text.slice(0, 300)}`);
    const path = await json(`/v1/apps/${bob.name}/${APP}/news`, { headers: authed(bob.token) });
    expectRefusal(path, 404, 'NOT_FOUND');
});

await test('9. Another owner\'s PATCH and DELETE by the bare name reach nothing of alice\'s', async () => {
    const p = await json(`/v1/apps/${APP}`, { method: 'PATCH', headers: authed(bob.token), body: JSON.stringify({ description: 'hijack' }) });
    expectRefusal(p, 404, 'NOT_FOUND');
    const d = await json(`/v1/apps/${APP}`, { method: 'DELETE', headers: authed(bob.token) });
    expectRefusal(d, 404, 'NOT_FOUND');
    const still = await json(`/v1/apps/${alice.name}/${FILE}/news`, { headers: authed(alice.token) });
    assert(still.status === 200, `alice's app is still there: ${still.status}`);
});

await test('10. DELETE /v1/apps/<name> by the owner removes the .html app', async () => {
    const before = await json(`/v1/apps/${alice.name}/${NEW}.html/news`, { headers: authed(alice.token) });
    assert(before.status === 200, `the .html app is there before the delete: ${before.status}`);
    const d = await json(`/v1/apps/${NEW}`, { method: 'DELETE', headers: authed(alice.token) });
    assert(d.status === 200, `delete ${d.status}: ${JSON.stringify(d.body?.error)}`);
    const gone = await json(`/v1/apps/${alice.name}/${NEW}.html/news`, { headers: authed(alice.token) });
    expectRefusal(gone, 404, 'NOT_FOUND');
});

finish();
