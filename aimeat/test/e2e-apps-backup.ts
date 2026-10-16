/**
 * @file e2e-apps-backup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E tests for app-catalog backup export + selective import.
 *   Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-apps-backup
 * @version-history
 *   2026-10-16 — Hand-made backups: a new app keeps no operator's search approval, an appended version
 *     keeps the live app's access code, and a cortex extension is rebuilt from its manifest in a
 *     namespace the caller owns (QA audit F10b-01). Header added.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { registerOwner } from './helpers/owner-login.js';

function sha256(buf: Buffer | string): string {
    return createHash('sha256').update(buf).digest('hex');
}

/** Build a zip from name→content entries (for crafting hostile zips). */
function buildZip(entries: Array<{ name: string; content: Buffer | string }>): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
        archive.on('data', (c: Buffer) => chunks.push(c));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', reject);
    });
    for (const e of entries) archive.append(e.content, { name: e.name });
    archive.finalize();
    return done;
}

/** List entry names of a zip (verifies the export is a plain, openable zip). */
function listZipEntries(buf: Buffer): Promise<string[]> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zf) => {
            if (err || !zf) { reject(err ?? new Error('not a zip')); return; }
            const names: string[] = [];
            zf.on('entry', (e: yauzl.Entry) => { names.push(e.fileName); zf.readEntry(); });
            zf.on('end', () => resolve(names));
            zf.on('error', reject);
            zf.readEntry();
        });
    });
}

function readZipEntry(buf: Buffer, name: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zf) => {
            if (err || !zf) { reject(err ?? new Error('not a zip')); return; }
            zf.on('entry', (e: yauzl.Entry) => {
                if (e.fileName !== name) { zf.readEntry(); return; }
                zf.openReadStream(e, (e2, stream) => {
                    if (e2 || !stream) { reject(e2 ?? new Error('stream')); return; }
                    const chunks: Buffer[] = [];
                    stream.on('data', (c: Buffer) => chunks.push(c));
                    stream.on('end', () => { resolve(Buffer.concat(chunks)); try { zf.close(); } catch { /* noop */ } });
                });
            });
            zf.on('end', () => reject(new Error(`entry ${name} not found`)));
            zf.on('error', reject);
            zf.readEntry();
        });
    });
}

// ─── State ───
let token = '';
let privKey = '';
const owner = `bkowner${Date.now()}`;

let token2 = '';
let privKey2 = '';
const owner2 = `bkowner2${Date.now()}`;

function authed(opts: RequestInit = {}, t = token): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${t}` } };
}

const html = (label: string) => `<!doctype html><html><body><h1>${label}</h1></body></html>`;

async function publish(filename: string, content: string, name: string, t = token) {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename, content: Buffer.from(content).toString('base64'), name, description: `Backup/restore test app: ${name}.` }),
    }, t));
    assert(status === 201 || status === 200, `publish ${filename}: ${status} ${JSON.stringify(body.error)}`);
}

async function getVersions(ownerName: string, filename: string, t = token) {
    const { status, body } = await json(`/v1/apps/${ownerName}/${encodeURIComponent(filename)}/versions`, authed({}, t));
    if (status === 404) return [];
    return (body.data?.versions ?? []) as Array<{ version_number: number }>;
}

async function getVersionContent(ownerName: string, filename: string, version: number, t = token): Promise<string> {
    // Fetch the stored bytes byte-for-byte (any non-'inline' mode): these checks compare the restored
    // version content against the exact source HTML. `mode=inline` would append the viral AIMEAT badge
    // (injectAimeatBadge), so it must NOT be used here — that's a serving-time transform, not the data.
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${encodeURIComponent(filename)}?version=${version}&mode=raw`, authed({}, t));
    assert(res.status === 200, `fetch v${version} of ${filename}: ${res.status}`);
    return await res.text();
}

// ─── Setup ───
console.log('\n=== AIMEAT Apps Backup E2E Test ===\n');
console.log('Setup');

await test('Register owner + token', async () => {
    const reg = await registerOwner(BASE, owner);
    privKey = reg.privateKey;
    token = reg.token;
});

await test('Register second owner + token', async () => {
    const reg = await registerOwner(BASE, owner2);
    privKey2 = reg.privateKey;
    token2 = reg.token;
});

await test('Publish test apps (A: 3 versions, B: 1 version, C: 5 versions)', async () => {
    for (let v = 1; v <= 3; v++) await publish('bk-app-a.html', html(`A v${v}`), 'App A');
    await publish('bk-app-b.html', html('B v1'), 'App B');
    for (let v = 1; v <= 5; v++) await publish('bk-app-c.html', html(`C v${v}`), 'App C');
});

// ─── Export ───
console.log('\nExport');

let exportZip: Buffer = Buffer.alloc(0);

await test('GET /v1/apps/backup without auth → 401', async () => {
    const res = await fetch(`${BASE}/v1/apps/backup`);
    assert(res.status === 401, `expected 401, got ${res.status}`);
});

await test('Export returns a ZIP with attachment filename', async () => {
    const res = await fetch(`${BASE}/v1/apps/backup`, authed());
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('application/zip'), `ct ${res.headers.get('content-type')}`);
    const cd = res.headers.get('content-disposition') ?? '';
    assert(cd.includes(`aimeat-apps-${owner}-`), `content-disposition ${cd}`);
    exportZip = Buffer.from(await res.arrayBuffer());
    assert(exportZip.length > 0, 'non-empty zip');
});

await test('ZIP is plainly openable and contains every version + metadata', async () => {
    const names = await listZipEntries(exportZip);
    assert(names.includes('backup-manifest.json'), 'has backup-manifest.json');
    assert(names.includes('apps/bk-app-a.html/app.json'), 'has app.json for A');
    for (let v = 1; v <= 3; v++) assert(names.includes(`apps/bk-app-a.html/versions/v${v}.html`), `A v${v} present`);
    assert(names.includes('apps/bk-app-b.html/versions/v1.html'), 'B v1 present');
    for (let v = 1; v <= 5; v++) assert(names.includes(`apps/bk-app-c.html/versions/v${v}.html`), `C v${v} present`);

    const manifest = JSON.parse((await readZipEntry(exportZip, 'backup-manifest.json')).toString());
    assert(manifest.aimeatAppsBackup === '1.0', 'format version 1.0');
    assert(manifest.source?.owner === owner, 'manifest owner');
    assert(Array.isArray(manifest.apps) && manifest.apps.length === 3, `3 apps in manifest, got ${manifest.apps?.length}`);

    const v2 = (await readZipEntry(exportZip, 'apps/bk-app-a.html/versions/v2.html')).toString();
    assert(v2 === html('A v2'), 'version content matches exactly');
});

// ─── Round-trip ───
console.log('\nRound-trip');

const origHashes: Record<string, string> = {};

await test('Record original state, delete all apps, verify gone', async () => {
    for (const [f, count] of [['bk-app-a.html', 3], ['bk-app-b.html', 1], ['bk-app-c.html', 5]] as const) {
        for (let v = 1; v <= count; v++) origHashes[`${f}:${v}`] = sha256(await getVersionContent(owner, f, v));
    }
    for (const f of ['bk-app-a.html', 'bk-app-b.html', 'bk-app-c.html']) {
        const del = await json(`/v1/apps/${encodeURIComponent(f)}`, authed({ method: 'DELETE' }));
        assert(del.body.ok === true, `delete ${f}: ${JSON.stringify(del.body.error)}`);
    }
    assert((await getVersions(owner, 'bk-app-a.html')).length === 0, 'A gone');
});

let backupToken = '';

await test('Inspect reports contents without writing anything', async () => {
    const res = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(exportZip),
    }));
    const body = await res.json() as any;
    assert(res.status === 200, `status ${res.status}: ${JSON.stringify(body.error)}`);
    backupToken = body.data.backup_token;
    assert(typeof backupToken === 'string' && backupToken.length > 0, 'got backup_token');
    assert(body.data.totals.apps === 3 && body.data.totals.versions === 9, `totals: ${JSON.stringify(body.data.totals)}`);
    const a = body.data.apps.find((x: any) => x.filename === 'bk-app-a.html');
    assert(a && a.exists === false, 'A reported as new (not conflicting)');
    // Nothing was written
    assert((await getVersions(owner, 'bk-app-a.html')).length === 0, 'inspect wrote nothing');
});

await test('Restore all → identical state (version counts + content hashes)', async () => {
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({
            backup_token: backupToken,
            selections: [
                { filename: 'bk-app-a.html' },
                { filename: 'bk-app-b.html' },
                { filename: 'bk-app-c.html' },
            ],
        }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.apps_created.length === 3, `created 3, got ${JSON.stringify(body.data)}`);
    assert(body.data.versions_restored === 9, `9 versions, got ${body.data.versions_restored}`);

    for (const [f, count] of [['bk-app-a.html', 3], ['bk-app-b.html', 1], ['bk-app-c.html', 5]] as const) {
        const versions = await getVersions(owner, f);
        assert(versions.length === count, `${f}: ${versions.length} versions (expected ${count})`);
        for (let v = 1; v <= count; v++) {
            const hash = sha256(await getVersionContent(owner, f, v));
            assert(hash === origHashes[`${f}:${v}`], `${f} v${v} content hash matches`);
        }
    }
});

// ─── Selective restore ───
console.log('\nSelective restore');

await test('Restore only app C versions 2+5 → exactly those', async () => {
    const del = await json('/v1/apps/bk-app-c.html', authed({ method: 'DELETE' }));
    assert(del.body.ok === true, 'delete C');
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({
            backup_token: backupToken,
            selections: [{ filename: 'bk-app-c.html', versions: [2, 5] }],
        }),
    }));
    assert(status === 200 && body.data.versions_restored === 2, `restored: ${JSON.stringify(body.data)}`);
    const versions = (await getVersions(owner, 'bk-app-c.html')).map(v => v.version_number).sort((a, b) => a - b);
    assert(JSON.stringify(versions) === '[2,5]', `versions ${JSON.stringify(versions)} (expected [2,5])`);
    const v5 = await getVersionContent(owner, 'bk-app-c.html', 5);
    assert(v5 === html('C v5'), 'v5 content exact');
});

await test('Selecting a version not in the backup → error, nothing written', async () => {
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({
            backup_token: backupToken,
            selections: [{ filename: 'bk-app-b.html', versions: [99], conflict: 'append' }],
        }),
    }));
    assert(status === 200, `status ${status}`);
    assert(body.data.errors.length === 1, `error reported: ${JSON.stringify(body.data)}`);
    assert(body.data.versions_restored === 0, 'nothing restored');
});

// ─── Conflict modes ───
console.log('\nConflict modes');

await test('Conflict default (skip): existing app untouched', async () => {
    const before = (await getVersions(owner, 'bk-app-a.html')).length;
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({ backup_token: backupToken, selections: [{ filename: 'bk-app-a.html' }] }),
    }));
    assert(status === 200, `status ${status}`);
    assert(body.data.apps_skipped.includes('bk-app-a.html'), `skipped: ${JSON.stringify(body.data)}`);
    assert((await getVersions(owner, 'bk-app-a.html')).length === before, 'version count unchanged');
});

await test('Conflict append: backup versions stack on top', async () => {
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({ backup_token: backupToken, selections: [{ filename: 'bk-app-a.html', conflict: 'append' }] }),
    }));
    assert(status === 200 && body.data.apps_appended.includes('bk-app-a.html'), `appended: ${JSON.stringify(body.data)}`);
    const versions = (await getVersions(owner, 'bk-app-a.html')).map(v => v.version_number).sort((a, b) => a - b);
    assert(JSON.stringify(versions) === '[1,2,3,4,5,6]', `versions ${JSON.stringify(versions)}`);
    // v4 is backup v1 re-stacked
    const v4 = await getVersionContent(owner, 'bk-app-a.html', 4);
    assert(v4 === html('A v1'), 'appended v4 = backup v1 content');
});

await test('Conflict copy: new filename with -restored suffix', async () => {
    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({ backup_token: backupToken, selections: [{ filename: 'bk-app-b.html', conflict: 'copy' }] }),
    }));
    assert(status === 200, `status ${status}`);
    assert(body.data.apps_copied.length === 1 && body.data.apps_copied[0].to === 'bk-app-b-restored.html',
        `copied: ${JSON.stringify(body.data.apps_copied)}`);
    const versions = await getVersions(owner, 'bk-app-b-restored.html');
    assert(versions.length === 1, 'copy has 1 version');
    // Original untouched
    assert((await getVersions(owner, 'bk-app-b.html')).length === 1, 'original untouched');
});

// ─── ZIP hardening ───
console.log('\nZIP hardening');

await test('Out-of-format / traversal entry → 422 ZIP_REJECTED', async () => {
    const hostile = await buildZip([
        { name: 'backup-manifest.json', content: JSON.stringify({ aimeatAppsBackup: '1.0', apps: [], extensions: [] }) },
        { name: '../evil.txt', content: 'evil' },
    ]);
    const res = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(hostile),
    }));
    const body = await res.json() as any;
    assert(res.status === 422, `expected 422, got ${res.status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ZIP_REJECTED', `code ${body.error?.code}`);
});

await test('Oversized entry (zip bomb) → 422 rejected cleanly', async () => {
    // 40 MB of zeros: compresses to almost nothing, decompressed entry exceeds
    // the 30 MB per-file cap (and the compression-ratio guard).
    const bomb = await buildZip([
        { name: 'backup-manifest.json', content: JSON.stringify({ aimeatAppsBackup: '1.0', apps: [], extensions: [] }) },
        { name: 'apps/bomb.html/versions/v1.html', content: Buffer.alloc(40 * 1024 * 1024, 0) },
    ]);
    const res = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(bomb),
    }));
    const body = await res.json() as any;
    assert(res.status === 422 && body.error?.code === 'ZIP_REJECTED', `${res.status} ${body.error?.code}`);
});

await test('Not-a-zip body → 400 INVALID_BACKUP or 422', async () => {
    const res = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(Buffer.from('this is not a zip')),
    }));
    assert(res.status === 422 || res.status === 400, `expected 4xx, got ${res.status}`);
});

// ─── Cross-owner import ───
console.log('\nCross-owner import');

await test('Backup from owner1 restores into owner2\'s account', async () => {
    const insp = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(exportZip),
    }, token2));
    const inspBody = await insp.json() as any;
    assert(insp.status === 200, `inspect as owner2: ${insp.status}`);
    assert(inspBody.data.source.owner === owner, 'manifest owner differs from caller');

    const { status, body } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({ backup_token: inspBody.data.backup_token, selections: [{ filename: 'bk-app-b.html' }] }),
    }, token2));
    assert(status === 200 && body.data.apps_created.includes('bk-app-b.html'), `restore as owner2: ${JSON.stringify(body.data)}`);

    // Written into OWNER2's account, attributed to owner2
    const versions = await getVersions(owner2, 'bk-app-b.html', token2);
    assert(versions.length === 1, 'owner2 has the app');
    const list = await json('/v1/apps?q=App%20B');
    const row = (list.body.data?.apps ?? []).find((a: any) => a.owner === owner2 && a.filename === 'bk-app-b.html');
    assert(!!row, 'app listed under owner2');
});

await test('Restore with stale/foreign token → 400', async () => {
    // owner2's token must not be usable by owner1 (ownership-bound cache)
    const insp = await fetch(`${BASE}/v1/apps/backup/inspect`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: new Uint8Array(exportZip),
    }, token2));
    const inspBody = await insp.json() as any;
    const { status } = await json('/v1/apps/backup/restore', authed({
        method: 'POST',
        body: JSON.stringify({ backup_token: inspBody.data.backup_token, selections: [{ filename: 'bk-app-a.html' }] }),
    }));
    assert(status === 400, `expected 400 for foreign token, got ${status}`);
});

// ─── Hand-made backups (QA audit F10b-01) ───
// A restore wrote the ZIP's manifest and ext.json as they were: an operator's search approval, a new
// row without the live app's access code, and a cortex record in somebody else's namespace.
console.log('\nHand-made backups');

const forgedZip = async (opts: {
    apps?: Array<{ filename: string; manifest: Record<string, unknown> }>;
    exts?: Array<{ name: string; record: Record<string, unknown> }>;
}) => {
    const entries: Array<{ name: string; content: Buffer | string }> = [{
        name: 'backup-manifest.json',
        content: JSON.stringify({
            aimeatAppsBackup: '1.0', exportedAt: new Date().toISOString(), source: { nodeId: 'elsewhere', owner: owner2 },
            apps: (opts.apps ?? []).map(a => ({ filename: a.filename })), extensions: (opts.exts ?? []).map(x => ({ name: x.name })),
        }),
    }];
    for (const a of opts.apps ?? []) {
        const body = html(`forged ${a.filename}`);
        entries.push({ name: `apps/${a.filename}/app.json`, content: JSON.stringify({ filename: a.filename, name: a.filename, versions: [{ version: 1, file: 'versions/v1.html', mimeType: 'text/html', size: body.length, createdAt: new Date().toISOString(), manifest: a.manifest }] }) });
        entries.push({ name: `apps/${a.filename}/versions/v1.html`, content: body });
    }
    for (const x of opts.exts ?? []) entries.push({ name: `extensions/${x.name}/ext.json`, content: JSON.stringify(x.record) });
    return (await buildZip(entries)).toString('base64');
};
const restoreAs = (t: string, zip: string, body: Record<string, unknown>) =>
    json('/v1/apps/backup/restore', authed({ method: 'POST', body: JSON.stringify({ zip_base64: zip, ...body }) }, t));
const baseManifest = { description: 'forged', version: '1.0.0', category: 'tool', tags: [], authorDisplay: 'someone', usesCortex: [] };

await test('A restored new app keeps the owner\'s search switch but no operator\'s approval', async () => {
    const zip = await forgedZip({ apps: [{ filename: 'bk-forged.html', manifest: { ...baseManifest, name: 'Forged', seo: { index: true, approvedBy: 'someoperator', approvedAt: '2026-01-01T00:00:00.000Z' } } }] });
    const { status, body } = await restoreAs(token2, zip, { selections: [{ filename: 'bk-forged.html' }] });
    assert(status === 200 && body.data.apps_created.includes('bk-forged.html'), `restore: ${status} ${JSON.stringify(body.data ?? body.error)}`);
    const list = await json('/v1/apps?own=true&limit=200', authed({}, token2));
    const app = (list.body.data.apps as any[]).find(a => a.filename === 'bk-forged.html');
    assert(!!app, 'the restored app is listed for its owner');
    assert(app.seo?.index === true, `the owner's own switch is kept: ${JSON.stringify(app.seo)}`);
    assert(!app.seo?.approvedBy && !app.seo?.approved_by, `an operator's approval came in from the ZIP: ${JSON.stringify(app.seo)}`);
});

await test('A version appended onto an access-coded app keeps the code', async () => {
    const pub = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: 'bk-coded.html', content: Buffer.from(html('coded v1')).toString('base64'), name: 'Coded', description: 'Backup/restore test app: coded.', access_code: 'bk-code-5678' }),
    }, token2));
    assert(pub.status === 201, `publish coded: ${pub.status} ${JSON.stringify(pub.body.error)}`);
    const zip = await forgedZip({ apps: [{ filename: 'bk-coded.html', manifest: { ...baseManifest, name: 'Coded' } }] });
    const { status, body } = await restoreAs(token2, zip, { selections: [{ filename: 'bk-coded.html', conflict: 'append' }] });
    assert(status === 200 && body.data.apps_appended.includes('bk-coded.html'), `append: ${status} ${JSON.stringify(body.data ?? body.error)}`);
    // A visitor with no account: the first owner of this suite is the node's operator, who opens coded apps.
    const outsider = await fetch(`${BASE}/v1/apps/${owner2}/bk-coded.html`);
    assert(outsider.status === 403, `the appended version opened without the code: ${outsider.status}`);
    const withCode = await fetch(`${BASE}/v1/apps/${owner2}/bk-coded.html?code=bk-code-5678`);
    assert(withCode.status === 200, `the code opens it: ${withCode.status}`);
});

const cortexYaml = (name: string, namespace: string) => [
    'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${name}`, `  namespace: ${namespace}`,
    'spec:', '  version: "1.0.0"', '  description: "Restore fixture"', '  components:',
    '    - type: schema', '      name: shape', `      key_pattern: "${name}:*"`, '      apply_to: prefix',
    '      schema:', '        type: object',
].join('\n') + '\n';
const extRecord = (name: string, namespace: string) => ({
    name, namespace, shortName: name, apiVersion: 'cortex.aimeat.org/v1', version: '1.0.0', description: 'x', author: 'x',
    tags: [], labels: {}, status: 'active', visibility: 'private', installedAt: new Date().toISOString(), installedBy: owner,
    manifest: cortexYaml(name, namespace), components: [],
    activationArtifacts: { schemaKeys: [], promptKeys: [], actionIds: [], boardIds: [], seedDataKeys: [], ontologyKeys: [], libFiles: [] },
});

await test('A restored cortex extension in another owner\'s namespace is refused; one in the backup owner\'s own is filed under the caller', async () => {
    const foreign = `bkfx${Date.now() % 100000}`;
    const own = `bkox${Date.now() % 100000}`;
    const zip = await forgedZip({ exts: [{ name: foreign, record: extRecord(foreign, owner) }, { name: own, record: extRecord(own, owner2) }] });
    const { status, body } = await restoreAs(token2, zip, { selections: [], extensions: [{ name: foreign }, { name: own }] });
    assert(status === 200, `restore: ${status} ${JSON.stringify(body.error)}`);
    assert(!body.data.extensions_created.includes(foreign), `the foreign namespace was restored: ${JSON.stringify(body.data)}`);
    assert(body.data.errors.some((e: any) => e.item === foreign && String(e.message).startsWith('NAMESPACE_DENIED')), `no NAMESPACE_DENIED: ${JSON.stringify(body.data.errors)}`);
    assert(body.data.extensions_created.includes(own), `the caller's own extension: ${JSON.stringify(body.data)}`);
    const got = await json(`/v1/cortex/${encodeURIComponent(own)}`, authed({}, token2));
    const ext = got.body.data?.extension ?? got.body.data;
    assert(ext?.namespace === owner2, `namespace: ${JSON.stringify(ext?.namespace)}`);
    assert(Array.isArray(ext?.components) && ext.components.length === 1, `components come from the manifest, not from ext.json: ${JSON.stringify(ext?.components)}`);
    await json(`/v1/cortex/${encodeURIComponent(own)}`, authed({ method: 'DELETE' }, token2));
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete test owners (cascade)', async () => {
    const d1 = await json(`/v1/owners/${owner}`, authed({ method: 'DELETE' }));
    assert(d1.body.ok === true, `delete owner1: ${JSON.stringify(d1.body.error)}`);
    const d2 = await json(`/v1/owners/${owner2}`, authed({ method: 'DELETE' }, token2));
    assert(d2.body.ok === true, `delete owner2: ${JSON.stringify(d2.body.error)}`);
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
