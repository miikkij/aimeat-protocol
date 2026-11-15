/**
 * @file test/e2e-app-icon-upload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent sets its owner's app icon over MCP, and the app's owner learns who can install
 *   the app (wish-kirjautumista-vaativa-sovellus-asentuu-puhelimeen-ja-agentti).
 *
 *   The defect: an app's agent made a PNG icon, stored it with aimeat_storage_upload and expected it
 *   to become the icon. The upload lands in the AGENT's namespace, the icon is read from the app
 *   OWNER's, and no MCP tool set it, so the picture never showed and nothing said why.
 *     - Designed use: aimeat_app_manage action icon_upload takes the agent's stored file
 *       (storage_key) or the bytes (icon), and the app's icon route serves those bytes; POST .../icon
 *       takes storage_key too; action marks and PATCH { marks } answer the `install` block.
 *     - Refused: a key the caller has not stored (another person's file included), a file that is not
 *       a PNG, both sources at once, storage_key without storage:read, and an agent of another owner.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-icon-upload
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { BASE, assert, expectRefusal, finish, json as request, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

/** A request with a bearer token, as the harness's json() sends it. */
function json(path: string, opts: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = opts;
    return request(path, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string> | undefined) } });
}

/** The app's icon bytes as GET .../icon serves them, base64, or the status when there is none. */
async function iconOf(file: string): Promise<{ status: number; b64: string }> {
    const res = await fetch(`${BASE}/v1/apps/${owner.name}/${file}/icon`, { headers: { Accept: 'image/png' } });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, b64: res.status === 200 ? buf.toString('base64') : '' };
}

const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 260);
const stamp = Date.now().toString(36).slice(-5);
// Two different 1x1 PNGs, so a test can tell which one became the icon.
const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const FILE = `iconapp-${stamp}.html`;
const AGENT_KEY = `apps/${stamp}/icon-512.png`;

let owner: RegisteredOwner;
let other: RegisteredOwner;
let session: McpSession;

console.log('\n=== APP ICON UPLOAD AND INSTALL E2E ===\n');

await test('fixture: an app that opens for signed-in people, its owner\'s agent and another owner', async () => {
    owner = await registerOwner(BASE, `icono${stamp}`);
    other = await registerOwner(BASE, `iconx${stamp}`);
    const pub = await json('/v1/apps', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ filename: FILE, content: Buffer.from('<h1>icon app</h1>').toString('base64'), name: 'Icon app', description: 'An app that gets its own icon.', category: 'utility', tags: [] }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${short(pub.body?.error)}`);
    const s = await json(`/v1/apps/${FILE}`, { method: 'PATCH', token: owner.token, body: JSON.stringify({ open_to: 'signed-in', listing: 'unlisted' }) });
    assert(s.status === 200, `signed-in: ${s.status} ${short(s.body?.error)}`);
    const agent = await makeAgent(BASE, owner, ['app:read', 'app:write', 'storage:read', 'storage:write']);
    session = await openSession(BASE, agent.token, 'e2e-app-icon-upload');
});

console.log('\nThe defect: an upload alone never becomes the icon');

await test('the agent\'s own upload stays in its storage and the app still has no icon', async () => {
    const up = await callTool(session, 'aimeat_storage_upload', { key: AGENT_KEY, data_base64: PNG_RED, mime_type: 'image/png', visibility: 'private' });
    assert(!up.isError, `upload: ${up.text.slice(0, 240)}`);
    assert((await iconOf(FILE)).status === 404, 'an upload under any key must not become the icon by itself');
});

await test('action marks says the app has no icon of its own and only the people it opens for can install it', async () => {
    const r = await callTool(session, 'aimeat_app_manage', { action: 'marks', filename: FILE });
    assert(!r.isError, `marks: ${r.text.slice(0, 240)}`);
    assert(r.data?.install?.installable_by === 'people-it-opens-for', `installable_by: ${short(r.data?.install)}`);
    assert(r.data?.install?.own_icon === false && r.data?.install?.offered === true, `install block: ${short(r.data?.install)}`);
    assert(/icon_upload/.test(r.data?.install?.note ?? ''), `the note names how to set an icon: ${r.data?.install?.note}`);
});

console.log('\nDesigned use');

await test('icon_upload with storage_key copies the agent\'s stored PNG into the owner\'s icon', async () => {
    const r = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, storage_key: AGENT_KEY });
    assert(!r.isError, `icon_upload: ${r.text.slice(0, 240)}`);
    assert(r.data?.source === 'storage' && r.data?.owner === owner.name, `answer: ${short(r.data)}`);
    const icon = await iconOf(FILE);
    assert(icon.status === 200 && icon.b64 === PNG_RED, `the icon is the stored PNG: ${icon.status}`);
    const marks = await callTool(session, 'aimeat_app_manage', { action: 'marks', filename: FILE });
    assert(marks.data?.install?.own_icon === true, `marks after: ${short(marks.data?.install)}`);
});

await test('icon_upload with icon replaces it with the bytes given', async () => {
    const r = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, icon: PNG_BLUE });
    assert(!r.isError && r.data?.source === 'inline', `icon_upload inline: ${r.text.slice(0, 240)}`);
    assert((await iconOf(FILE)).b64 === PNG_BLUE, 'the icon is the new PNG');
});

await test('POST .../icon takes storage_key for the owner too', async () => {
    const st = await json('/v1/storage', { method: 'POST', token: owner.token, body: JSON.stringify({ key: `own-icon-${stamp}.png`, data: PNG_RED, mime_type: 'image/png', visibility: 'private' }) });
    assert(st.body.ok === true, `owner upload: ${st.status} ${short(st.body?.error)}`);
    const r = await json(`/v1/apps/${owner.name}/${FILE}/icon`, { method: 'POST', token: owner.token, body: JSON.stringify({ storage_key: `own-icon-${stamp}.png` }) });
    assert(r.status === 200 && r.body.data?.source === 'storage', `REST storage_key: ${r.status} ${short(r.body)}`);
    assert((await iconOf(FILE)).b64 === PNG_RED, 'the icon is the owner\'s stored PNG');
});

await test('PATCH { marks } answers the install block', async () => {
    const r = await json(`/v1/apps/${FILE}`, { method: 'PATCH', token: owner.token, body: JSON.stringify({ marks: { install: true } }) });
    assert(r.status === 200, `patch: ${r.status} ${short(r.body?.error)}`);
    assert(r.body.data?.install?.installable_by === 'people-it-opens-for' && r.body.data?.install?.own_icon === true, `install: ${short(r.body.data?.install)}`);
});

console.log('\nRefused');

await test('a key the agent never stored answers NOT_FOUND and keeps the icon', async () => {
    const r = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, storage_key: 'no/such/file.png' });
    assert(r.isError && /NOT_FOUND/.test(r.text), `missing key: ${r.text.slice(0, 200)}`);
    assert((await iconOf(FILE)).b64 === PNG_RED, 'the icon is unchanged');
});

await test('another person\'s stored file is not the caller\'s: NOT_FOUND', async () => {
    const st = await json('/v1/storage', { method: 'POST', token: other.token, body: JSON.stringify({ key: `theirs-${stamp}.png`, data: PNG_BLUE, mime_type: 'image/png', visibility: 'private' }) });
    assert(st.body.ok === true, `other upload: ${st.status} ${short(st.body?.error)}`);
    const r = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, storage_key: `theirs-${stamp}.png` });
    assert(r.isError && /NOT_FOUND/.test(r.text), `foreign key: ${r.text.slice(0, 200)}`);
});

await test('a stored file that is not a PNG is refused by its bytes', async () => {
    const svgKey = `apps/${stamp}/icon.svg`;
    const up = await callTool(session, 'aimeat_storage_upload', { key: svgKey, data_base64: SVG, mime_type: 'image/png', visibility: 'private' });
    assert(!up.isError, `svg upload: ${up.text.slice(0, 200)}`);
    const r = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, storage_key: svgKey });
    assert(r.isError && /INVALID_INPUT/.test(r.text) && /PNG/.test(r.text), `svg: ${r.text.slice(0, 200)}`);
});

await test('both sources, or neither, is refused before anything is written', async () => {
    const both = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, icon: PNG_BLUE, storage_key: AGENT_KEY });
    assert(both.isError && /INVALID_INPUT/.test(both.text), `both: ${both.text.slice(0, 200)}`);
    const none = await callTool(session, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE });
    assert(none.isError && /INVALID_INPUT/.test(none.text), `none: ${none.text.slice(0, 200)}`);
    assert((await iconOf(FILE)).b64 === PNG_RED, 'the icon is unchanged');
});

await test('storage_key without storage:read is SCOPE_DENIED, on MCP and on REST', async () => {
    const narrow = await makeAgent(BASE, owner, ['app:read', 'app:write']);
    const s = await openSession(BASE, narrow.token, 'e2e-app-icon-upload-narrow');
    const r = await callTool(s, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, storage_key: AGENT_KEY });
    assert(r.isError && /SCOPE_DENIED/.test(r.text), `MCP: ${r.text.slice(0, 200)}`);
    const rest = await json(`/v1/apps/${owner.name}/${FILE}/icon`, { method: 'POST', token: narrow.token, body: JSON.stringify({ storage_key: AGENT_KEY }) });
    expectRefusal(rest, 403, 'SCOPE_DENIED');
});

await test('an agent of another owner cannot set this app\'s icon', async () => {
    const theirs = await makeAgent(BASE, other, ['app:read', 'app:write', 'storage:read', 'storage:write']);
    const s = await openSession(BASE, theirs.token, 'e2e-app-icon-upload-other');
    const r = await callTool(s, 'aimeat_app_manage', { action: 'icon_upload', filename: FILE, owner: owner.name, icon: PNG_BLUE });
    // No development right on the owner's apps: the target resolver's FORBIDDEN, on both interfaces.
    assert(r.isError && /FORBIDDEN/.test(r.text), `another owner's agent: ${r.text.slice(0, 200)}`);
    const rest = await json(`/v1/apps/${owner.name}/${FILE}/icon`, { method: 'POST', token: other.token, body: JSON.stringify({ icon: PNG_BLUE }) });
    expectRefusal(rest, 403, 'FORBIDDEN');
    assert((await iconOf(FILE)).b64 === PNG_RED, 'the icon is unchanged');
});

finish();
