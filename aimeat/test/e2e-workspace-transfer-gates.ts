/**
 * @file test/e2e-workspace-transfer-gates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three write and read rules a workspace backup must not be a way round
 *   (secaudit 2026-10).
 *
 *   1. A RESTORE IS A WRITE. An archive names every key and every level in it, and
 *      services/workspace-import.ts wrote all of them raw, so an import stored a record and a file
 *      at `organism:<an organism the importer is not in>`, put a chosen-mime file at the app-owned
 *      key `apps/icons/…` that the app origin then served as a page, and made records public on a
 *      node whose publish gate asks the owner first. Here a hostile archive meets each of those and
 *      a clean one still round-trips.
 *   2. AN EXPORT IS A READ, BY THE CALLER. The organism bundle reads as the member's owner GHII, so
 *      the ecosystem data-area gate (workspace-access.ts Gate 3) never ran and an ecosystem app
 *      exported workspaces its owner-granted read areas did not cover.
 *   3. A CREDENTIAL DOES NOT LEAVE IN A BACKUP. The bundle carried the workspace share's scrypt
 *      password hash, where every other door shows `has_password`.
 *
 *   Its own node, because the publish-gate half can only be seen with AIMEAT_PUBLISH_GATE=agents.
 * @structure
 *   - Phase 1 the node, two owners, a scoped agent, the organisms and a workspace in each
 *   - Phase 2 the control: a clean export imports and reads back
 *   - Phase 3 a hostile archive: the foreign organism, the app-owned key and the public level
 *   - Phase 4 the ecosystem app exports the organism its data area covers and no other
 *   - Phase 5 the share leaves with has_password and no hash, and restores closed
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-workspace-transfer-gates
 * @version-history
 *   2026-10-20 — Initial (secaudit 2026-10: workspace-import:restore-skips-write-gates,
 *     organism-export:owner-identity-drops-geai-data-area-gate,
 *     collectWorkspace:share-password-hash-unmasked).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZipArchive } from 'archiver';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { unzipBuffer } from '../src/services/workspace-import.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_WS_TRANSFER_GATES_PORT ?? '28496';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-workspace-transfer-gates.db');
const STAMP = Date.now().toString(36).slice(-6);
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 400);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

/** Build a ZIP in memory, the way the export does, so a test can name every entry itself. */
async function zipOf(entries: Array<{ name: string; data: Buffer | string }>): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((res, rej) => {
        archive.on('data', (c: Buffer) => chunks.push(c));
        archive.on('end', () => res(Buffer.concat(chunks)));
        archive.on('error', rej);
    });
    for (const e of entries) archive.append(typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data, { name: e.name });
    archive.finalize();
    return done;
}

function cleanupDb(): void {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb('workspace-transfer-gates', { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        // The publish gate is the only way to see the "made public by a restore" half.
        AIMEAT_PUBLISH_GATE: 'agents',
        AIMEAT_ANONYMOUS_MODE: 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the workspace transfer-gates node' });
}

console.log('\n=== A workspace backup is not a way round the write and read rules ===\n');
console.log('Phase 1 — the node, the owners, the agent and the organisms');

const server = await startServer();

const ownerName = `wtg${STAMP}`;
const strangerName = `wts${STAMP}`;
const PW = 'WtGate1234';
let ownerToken = '';
let strangerToken = '';
let agentGaii = '';
let agentToken = '';
let orgA = '';
let orgB = '';
let orgX = '';
let wsA = '';
let wsB = '';
const ITEM_NS = 'shared.items';

const manifestFor = (orgId: string, name: string) => ({
    manifestVersion: '1.0', id: orgId, name, kind: 'project', status: 'active',
    objectTypes: [{
        name: 'item', schemaRef: 'schema:item@1', namespace: ITEM_NS, backing: 'memory',
        writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records',
    }],
});

async function makeWorkspace(token: string, orgId: string, wsId: string, name: string): Promise<void> {
    const ts = new Date().toISOString();
    const reg = await json('/v1/memory', {
        method: 'POST', headers: bearer(token),
        body: JSON.stringify({
            key: `organism.${orgId}.meta.workspaces`,
            value: { workspaces: [{ id: wsId, name, createdAt: ts, createdBy: ownerName }] }, visibility: 'private',
        }),
    });
    assert(reg.status === 201, `registry ${reg.status}: ${short(reg.body)}`);
    const man = await json('/v1/memory', {
        method: 'POST', headers: bearer(token),
        body: JSON.stringify({ key: `organism.${orgId}.w.${wsId}.meta.manifest`, value: manifestFor(orgId, name), visibility: 'private' }),
    });
    assert(man.status === 201, `manifest ${man.status}: ${short(man.body)}`);
    const rec = await json('/v1/memory', {
        method: 'POST', headers: bearer(token),
        body: JSON.stringify({ key: `organism.${orgId}.w.${wsId}.${ITEM_NS}.i1.latest`, value: { id: 'i1', title: `${name} item` }, visibility: 'private' }),
    });
    assert(rec.status === 201, `record ${rec.status}: ${short(rec.body)}`);
}

await test('two owners, an organism each and a workspace in each', async () => {
    for (const [who, label] of [[ownerName, 'WS Gate Owner'], [strangerName, 'WS Gate Stranger']] as const) {
        const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who, display_name: label, password: PW }) });
        assert(reg.status === 201, `register ${who}: ${reg.status} ${short(reg.body)}`);
    }
    ownerToken = (await ownerSignIn(BASE, ownerName, PW)).body.data.token as string;
    strangerToken = (await ownerSignIn(BASE, strangerName, PW)).body.data.token as string;

    for (const [name, set] of [['A', (v: string) => { orgA = v; }], ['B', (v: string) => { orgB = v; }]] as const) {
        const o = await json('/v1/organisms', {
            method: 'POST', headers: bearer(ownerToken),
            body: JSON.stringify({ name: `WtG ${name}`, type: 'project', join_policy: 'invite_only', visibility: 'private' }),
        });
        assert(o.status === 201, `organism ${name}: ${o.status} ${short(o.body)}`);
        set(o.body.data.organism.id as string);
    }
    const x = await json('/v1/organisms', {
        method: 'POST', headers: bearer(strangerToken),
        body: JSON.stringify({ name: 'WtG X', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(x.status === 201, `organism X: ${x.status} ${short(x.body)}`);
    orgX = x.body.data.organism.id as string;

    wsA = `ws-wtga${STAMP}`;
    wsB = `ws-wtgb${STAMP}`;
    await makeWorkspace(ownerToken, orgA, wsA, 'Alpha');
    await makeWorkspace(ownerToken, orgB, wsB, 'Beta');

    const up = await json('/v1/storage', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ key: `organism.${orgA}.w.${wsA}.img.pic1`, data: PNG_B64, content_type: 'image/png', visibility: 'private' }),
    });
    assert(up.status === 201, `image ${up.status}: ${short(up.body)}`);
});

// memory:read and storage:read are in the list only so the test can read back what the restore
// stored under the agent. Neither writes, and neither publishes, which is what this suite is about.
await test('an agent of the owner with organism:read + organism:write and nothing that writes', async () => {
    const agent = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            name: `wtgagent${STAMP}`, owner: ownerName, model: 'gpt-4o',
            scopes: ['organism:read', 'organism:write', 'memory:read', 'storage:read'],
        }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${short(agent.body)}`);
    agentGaii = agent.body.data.agent.gaii as string;
    const scopes: string[] = agent.body.data.agent.scopes ?? agent.body.data.agent.default_scopes ?? [];
    assert(!scopes.includes('publish:public'), `the agent must not hold publish:public: ${short(scopes)}`);
    assert(!scopes.includes('storage:write'), `the agent must not hold storage:write: ${short(scopes)}`);
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(agent.body.data.private_key, agentGaii + ts) }),
    });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    agentToken = at.body.data.token as string;
});

await test('the control: POST /v1/storage at the app-owned key is refused, for the agent and for the owner', async () => {
    const body = (who: string) => JSON.stringify({
        key: `apps/icons/${ownerName}-${who}.html`, data: Buffer.from('<h1>no</h1>').toString('base64'),
        content_type: 'text/html', visibility: 'private',
    });
    const agentTry = await json('/v1/storage', { method: 'POST', headers: bearer(agentToken), body: body('agent') });
    assert(agentTry.status >= 400, `the storage door let the agent write an app-owned key: ${agentTry.status} ${short(agentTry.body)}`);
    // The owner holds every word, so this one shows it is the KEY that is fenced, not the permission.
    const ownerTry = await json('/v1/storage', { method: 'POST', headers: bearer(ownerToken), body: body('owner') });
    assert(ownerTry.status === 403, `the storage door let the owner write an app-owned key: ${ownerTry.status} ${short(ownerTry.body)}`);
});

console.log('\nPhase 2 — the control: a clean export imports and reads back');

let cleanZip = Buffer.alloc(0);
let cleanWs = '';

await test('the owner exports workspace A and imports it again', async () => {
    const res = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/export?ws=${wsA}`, { headers: bearer(ownerToken) });
    assert(res.status === 200, `export ${res.status}`);
    cleanZip = Buffer.from(await res.arrayBuffer());
    assert(cleanZip[0] === 0x50 && cleanZip[1] === 0x4b, 'the export is a ZIP');

    const imp = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/import`, {
        method: 'POST', headers: { ...bearer(ownerToken), 'Content-Type': 'application/zip' }, body: cleanZip,
    });
    const body = await imp.json() as any;
    assert(imp.status === 201, `import ${imp.status}: ${short(body)}`);
    cleanWs = body.data.ws as string;
    assert(body.data.images === 1, `the image came back: ${short(body.data)}`);
    assert(!body.data.skipped, `a clean archive must skip nothing: ${short(body.data.skipped)}`);
});

await test('the restored workspace reads back with its manifest, record and image', async () => {
    const r = await json(`/v1/organisms/${orgA}/workspace?ws=${cleanWs}`, { headers: bearer(ownerToken) });
    assert(r.status === 200, `read ${r.status}: ${short(r.body)}`);
    assert(r.body.data.manifest?.name === 'Alpha', `manifest restored: ${short(r.body.data.manifest)}`);
    assert((r.body.data.objects?.item ?? []).some((o: any) => o.id === 'i1'), `record restored: ${short(r.body.data.objects)}`);
    const img = await fetch(`${BASE}/v1/storage/${encodeURIComponent(`organism.${orgA}.w.${cleanWs}.img.pic1`)}`, { headers: bearer(ownerToken) });
    assert(img.status === 200, `the restored image is readable: ${img.status}`);
});

console.log('\nPhase 3 — a hostile archive: the foreign organism, the app-owned key and the public level');

const srcOrg = 'wtg-source-org';
const srcWs = 'ws-source';
const EVIL_KEY = () => `apps/icons/${ownerName}-planted.html`;
const hostileJson = () => JSON.stringify({
    aimeatWorkspaceExport: '1.0',
    exportedAt: new Date().toISOString(),
    source: { organismId: srcOrg, ws: srcWs, nodeId: NODE_ID },
    name: 'Hostile',
    manifest: manifestFor(srcOrg, 'Hostile'),
    readme: null, config: null, schemas: {}, sections: {}, sources: null,
    objects: [
        { namespace: ITEM_NS, id: 'foreign', role: 'latest', value: { id: 'foreign', title: 'for an organism the importer is not in' }, visibility: `organism:${orgX}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        { namespace: ITEM_NS, id: 'openone', role: 'latest', value: { id: 'openone', title: 'asked public' }, visibility: 'public', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    ],
    images: [
        { key: EVIL_KEY(), file: 'images/planted.html', mimeType: 'text/html', visibility: 'public' },
        { key: `organism.${srcOrg}.w.${srcWs}.img.good`, file: 'images/good.png', mimeType: 'image/png', visibility: 'private' },
    ],
    leftOut: [],
});
const hostileZip = () => zipOf([
    { name: 'workspace.json', data: hostileJson() },
    { name: 'images/planted.html', data: Buffer.from('<h1>planted</h1>', 'utf8') },
    { name: 'images/good.png', data: Buffer.from(PNG_B64, 'base64') },
]);

let agentWs = '';

await test('the agent imports the hostile archive: the app-owned key is skipped and the levels are clamped', async () => {
    const zip = await hostileZip();
    const res = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/import`, {
        method: 'POST', headers: { ...bearer(agentToken), 'Content-Type': 'application/zip' }, body: zip,
    });
    const body = await res.json() as any;
    assert(res.status === 201, `import ${res.status}: ${short(body)}`);
    agentWs = body.data.ws as string;
    const skipped: Array<{ key: string }> = body.data.skipped ?? [];
    assert(skipped.some(s => s.key === EVIL_KEY()), `the app-owned key was not skipped: ${short(body.data)}`);
    const clamped: Array<{ asked: string; stored: string; reason: string }> = body.data.clamped ?? [];
    assert(clamped.some(c => c.asked === `organism:${orgX}` && c.reason === 'not_organism_member'),
        `the foreign-organism level was not clamped: ${short(clamped)}`);
    assert(clamped.some(c => c.asked === 'public' && c.reason === 'needs_the_owner'),
        `the public level was not held by the publish gate: ${short(clamped)}`);
    assert(body.data.images === 1, `only the workspace's own image was restored: ${short(body.data)}`);
});

await test('nothing is stored at the app-owned key, in either namespace', async () => {
    // The agent holds storage:read, so a 404 here means the row is absent and not that the read was
    // refused; the workspace's own image below proves the same token does read restored files.
    for (const [who, token] of [['the agent', agentToken], ['the owner', ownerToken]] as const) {
        const r = await fetch(`${BASE}/v1/storage/${encodeURIComponent(EVIL_KEY())}`, { headers: bearer(token) });
        assert(r.status !== 200, `${who} found the planted file at ${EVIL_KEY()}: ${r.status}`);
    }
    const good = await fetch(`${BASE}/v1/storage/${encodeURIComponent(`organism.${orgA}.w.${agentWs}.img.good`)}`, { headers: bearer(agentToken) });
    assert(good.status === 200, `the agent's token does read a file the restore DID store: ${good.status}`);
});

await test('the record the archive addressed to another organism is private, and its members cannot read it', async () => {
    const key = `organism.${orgA}.w.${agentWs}.${ITEM_NS}.foreign.latest`;
    const mine = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: bearer(agentToken) });
    assert(mine.status === 200, `the record was restored: ${mine.status} ${short(mine.body)}`);
    assert(mine.body.data.visibility === 'private', `stored at ${mine.body.data.visibility}, not private`);
    const theirs = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(key)}`, { headers: bearer(strangerToken) });
    assert(theirs.status !== 200, `a member of the named organism read it: ${theirs.status} ${short(theirs.body)}`);
});

await test('the record the archive asked to make public is private, because the gate asks the owner', async () => {
    const key = `organism.${orgA}.w.${agentWs}.${ITEM_NS}.openone.latest`;
    const mine = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: bearer(agentToken) });
    assert(mine.status === 200, `the record was restored: ${mine.status} ${short(mine.body)}`);
    assert(mine.body.data.visibility === 'private', `stored at ${mine.body.data.visibility}, not private`);
});

await test('the positive control: the owner in person restores the same archive and keeps the public record public', async () => {
    const zip = await hostileZip();
    const res = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/import`, {
        method: 'POST', headers: { ...bearer(ownerToken), 'Content-Type': 'application/zip' }, body: zip,
    });
    const body = await res.json() as any;
    assert(res.status === 201, `import ${res.status}: ${short(body)}`);
    const ws = body.data.ws as string;
    const open = await json(`/v1/memory/${encodeURIComponent(`organism.${orgA}.w.${ws}.${ITEM_NS}.openone.latest`)}`, { headers: bearer(ownerToken) });
    assert(open.status === 200 && open.body.data.visibility === 'public',
        `the owner may publish in person, and the restore kept it at ${open.body.data?.visibility}`);
    const clamped: Array<{ asked: string; reason: string }> = body.data.clamped ?? [];
    assert(clamped.some(c => c.asked === `organism:${orgX}`),
        `the owner is not a member of that organism either, so the level still clamps: ${short(clamped)}`);
});

console.log('\nPhase 4 — an ecosystem app exports only what its read data-area covers');

const ECO_APP = `wtgeco${STAMP}`;
let ecoToken = '';

await test('the owner approves an ecosystem app with a read data-area for organism A only', async () => {
    const priv = randomBytes(32);
    const pub = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64');
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({
            owner: ownerName, app: ECO_APP, display_name: 'WtG Eco', public_key: pub,
            scopes: ['memory:read', 'organism:read'],
            data_areas: [{ area: 'organisms', pattern: orgA, rights: ['read'] }],
        }),
    });
    assert(hello.status === 200 && hello.body.ok === true, `hello ${hello.status}: ${short(hello.body)}`);
    const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            action: 'approve', scopes: ['memory:read', 'organism:read'],
            data_areas: [{ area: 'organisms', pattern: orgA, rights: ['read'] }],
        }),
    });
    assert(approve.status === 200, `approve ${approve.status}: ${short(approve.body)}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: GRANT }),
    });
    // The token endpoint answers the OAuth shape, not the node envelope.
    assert(tok.status === 200 && typeof tok.body.access_token === 'string', `token ${tok.status}: ${short(tok.body)}`);
    ecoToken = tok.body.access_token as string;
});

await test('the ecosystem app exports organism A, and organism B comes back with no workspace', async () => {
    const a = await json(`/v1/organisms/${orgA}/export?format=base64`, { headers: bearer(ecoToken) });
    assert(a.status === 200, `export A ${a.status}: ${short(a.body)}`);
    const aZip = Buffer.from(a.body.data.zip_base64 as string, 'base64');
    const aFiles = await unzipBuffer(aZip);
    assert([...aFiles.keys()].some(n => n === `workspaces/${wsA}/workspace.json`),
        `the covered organism's workspace is missing: ${short([...aFiles.keys()])}`);

    const b = await json(`/v1/organisms/${orgB}/export?format=base64`, { headers: bearer(ecoToken) });
    assert(b.status === 200, `export B ${b.status}: ${short(b.body)}`);
    const bFiles = await unzipBuffer(Buffer.from(b.body.data.zip_base64 as string, 'base64'));
    assert(![...bFiles.keys()].some(n => n.startsWith('workspaces/')),
        `the app exported a workspace outside its read data-areas: ${short([...bFiles.keys()])}`);
    const bText = (bFiles.get('organism.json') ?? Buffer.alloc(0)).toString('utf8');
    assert(!bText.includes('Beta'), `the bundle still names the workspace: ${bText.slice(0, 300)}`);
});

await test('the control: live, the app reads workspace A and not workspace B', async () => {
    // The live read answers 200 with an empty workspace rather than 403: the read gate decides what
    // the workspace contains, and a member's organism membership still names the workspace.
    const b = await json(`/v1/organisms/${orgB}/workspace?ws=${wsB}`, { headers: bearer(ecoToken) });
    assert(b.status === 200, `live read of B ${b.status}: ${short(b.body)}`);
    assert(b.body.data?.manifest == null,
        `the app reads workspace B live, so the export is not a leak: ${short(b.body?.data)}`);
    const a = await json(`/v1/organisms/${orgA}/workspace?ws=${wsA}`, { headers: bearer(ecoToken) });
    assert(a.status === 200 && a.body.data?.manifest != null,
        `the app cannot read workspace A live either, so the export test proves nothing: ${a.status} ${short(a.body?.data)}`);
});

await test('the positive control: the owner still exports both organisms with their workspaces', async () => {
    for (const [orgId, ws, label] of [[orgA, wsA, 'A'], [orgB, wsB, 'B']] as const) {
        const r = await json(`/v1/organisms/${orgId}/export?format=base64`, { headers: bearer(ownerToken) });
        assert(r.status === 200, `owner export ${label} ${r.status}: ${short(r.body)}`);
        const files = await unzipBuffer(Buffer.from(r.body.data.zip_base64 as string, 'base64'));
        assert(files.has(`workspaces/${ws}/workspace.json`), `owner bundle ${label} misses its workspace: ${short([...files.keys()])}`);
    }
});

console.log('\nPhase 5 — the share leaves masked and restores closed');

await test('the owner puts a password and a calendar feed key on workspace A', async () => {
    const r = await json(`/v1/organisms/${orgA}/workspace/share?ws=${wsA}`, {
        method: 'PUT', headers: bearer(ownerToken),
        body: JSON.stringify({ access: 'password', password: 'wtg-share-secret', ics_key: true, public: true }),
    });
    assert(r.status === 200, `share ${r.status}: ${short(r.body)}`);
    assert(r.body.data.share?.has_password === true, `the share route shows has_password: ${short(r.body.data.share)}`);
    assert(r.body.data.share?.has_ics_key === true, `the share route shows has_ics_key: ${short(r.body.data.share)}`);
});

let sharedZip = Buffer.alloc(0);

await test('the exported workspace carries has_password and no hash', async () => {
    const res = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/export?ws=${wsA}`, { headers: bearer(ownerToken) });
    assert(res.status === 200, `export ${res.status}`);
    sharedZip = Buffer.from(await res.arrayBuffer());
    const files = await unzipBuffer(sharedZip);
    const text = (files.get('workspace.json') ?? Buffer.alloc(0)).toString('utf8');
    assert(text.includes('"has_password"'), `the share record is in the bundle, masked: ${text.slice(0, 400)}`);
    assert(!text.includes('passwordHash'), 'the bundle carries the scrypt password hash');
    assert(!text.includes('wtg-share-secret'), 'the bundle carries the password itself');
    assert(text.includes('"has_ics_key"'), `the feed key is masked too: ${text.slice(0, 400)}`);
    assert(!text.includes('icsKeyHash'), 'the bundle carries the calendar feed key hash');
});

await test('the control: the share route still answers has_password and has_ics_key, so nothing was lost on the node', async () => {
    const r = await json(`/v1/organisms/${orgA}/workspace/share?ws=${wsA}`, { headers: bearer(ownerToken) });
    assert(r.status === 200, `share read ${r.status}: ${short(r.body)}`);
    assert(r.body.data.share?.has_password === true && r.body.data.share?.has_ics_key === true,
        `the node still holds both secrets: ${short(r.body.data.share)}`);
});

await test('restoring that bundle gives a share no password opens, and says so', async () => {
    const imp = await fetch(`${BASE}/v1/organisms/${orgA}/workspace/import`, {
        method: 'POST', headers: { ...bearer(ownerToken), 'Content-Type': 'application/zip' }, body: sharedZip,
    });
    const body = await imp.json() as any;
    assert(imp.status === 201, `import ${imp.status}: ${short(body)}`);
    const ws = body.data.ws as string;
    const clamped: Array<{ reason: string }> = body.data.clamped ?? [];
    assert(clamped.some(c => c.reason === 'share_password_not_carried'),
        `the restore did not say the password is gone: ${short(body.data)}`);
    const r = await json(`/v1/organisms/${orgA}/workspace/share?ws=${ws}`, { headers: bearer(ownerToken) });
    assert(r.status === 200, `restored share read ${r.status}: ${short(r.body)}`);
    assert(r.body.data.share?.has_password === false, `the restored share claims a password: ${short(r.body.data.share)}`);
    assert(r.body.data.share?.access !== 'open', `the restored share opened to anyone: ${short(r.body.data.share)}`);
});

await test('Cleanup', async () => {
    for (const [who, token] of [[ownerName, ownerToken], [strangerName, strangerToken]] as const) {
        const r = await json(`/v1/owners/${who}`, { method: 'DELETE', headers: bearer(token) });
        assert(r.status === 200 && r.body.ok === true, `removing ${who}: ${r.status} ${short(r.body)}`);
    }
});

server.kill();
cleanupDb();
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
