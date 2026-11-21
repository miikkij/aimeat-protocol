/**
 * @file test/e2e-extension-zip-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The presigned ZIP route of an extension does what every other install route does,
 *   and an installed extension can be read back as the manifest that installs it again.
 *
 *   WHY. PUT /v1/upload/:token carried its own copy of the extension write. An `activate: true` ZIP
 *   set the status and registered none of the manifest's schedules, and a ZIP update of an active
 *   extension left the OLD schedules running against the new code, saying so only in a `note`
 *   (appdev pitfalls ext/extension-update-does-not-register-schedules and
 *   ext/update-does-not-register-schedules). The route now runs writeExtensionRecord and
 *   activateExtension (services/extension/lifecycle.ts). GET /v1/extensions/:name?full=true had the
 *   scripts and not the manifest, and an install without a manifest is refused
 *   (ext/update-live-extension-without-its-source-manifest). An inactive extension's refusal now
 *   names aimeat_extension_activate (ext/extension-update-needs-new-version-and-activation).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-zip-lifecycle
 * @version-history
 *   v1.1.0 — 2026-11-21 — The shared harness (test/helpers/harness.ts).
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6).
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { BASE, test, assert, json, finish } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

/** Minimal deflated ZIP writer (as test/e2e-scheduled-ext-files.ts), so the suite needs no dependency. */
function makeZip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = []; const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.from(content, 'utf8');
        const comp = deflateRawSync(raw);
        const crc = crc32(raw) >>> 0;
        const lf = Buffer.alloc(30);
        lf.writeUInt32LE(0x04034b50, 0); lf.writeUInt16LE(20, 4); lf.writeUInt16LE(0, 6);
        lf.writeUInt16LE(8, 8); lf.writeUInt16LE(0, 10); lf.writeUInt16LE(0, 12);
        lf.writeUInt32LE(crc, 14); lf.writeUInt32LE(comp.length, 18); lf.writeUInt32LE(raw.length, 22);
        lf.writeUInt16LE(nameBuf.length, 26); lf.writeUInt16LE(0, 28);
        const local = Buffer.concat([lf, nameBuf, comp]);
        locals.push(local);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
        cd.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([cd, nameBuf]));
        offset += local.length;
    }
    const cdBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
    end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, cdBuf, end]);
}

const EXT = `zip-life-${Date.now().toString(36)}`;
const SCRIPT = 'export default async function(ctx, input) { return { seen: input && input.note ? input.note : "none" }; }';

/** The manifest at `version`, with one schedule named `scheduleId` (a yearly cron that never fires in a test). */
function manifest(version: string, scheduleId: string): string {
    return [
        'metadata:',
        `  name: ${EXT}`,
        `  version: ${version}`,
        '  description: "ZIP lifecycle probe: schedules and the manifest read back"',
        '  author: alice',
        'config:',
        '  greeting:',
        '    type: string',
        '    default: hello',
        'schedules:',
        `  - id: ${scheduleId}`,
        '    cron: "0 0 1 1 *"',
        '    action: echo',
        'limits:',
        '  memory_mb: 16',
        '  timeout_ms: 4000',
        '  max_api_calls: 20',
        'actions:',
        '  - id: echo',
        '    method: POST',
        '    path: /echo',
        '    script: echo.js',
    ].join('\n');
}
const zipOf = (version: string, scheduleId: string, script = SCRIPT) =>
    makeZip({ 'manifest.yaml': manifest(version, scheduleId), 'scripts/echo.js': script });

let alice: { name: string; token: string };
const auth = () => ({ Authorization: `Bearer ${alice.token}` });

/** Mint a presigned ZIP install with these flags and PUT the ZIP to it. */
async function zipPut(zip: Buffer, flags: { update?: boolean; activate?: boolean }): Promise<{ status: number; body: any }> {
    const m = await json('/v1/extensions', { method: 'POST', headers: auth(), body: JSON.stringify({ mode: 'presigned', ...flags }) });
    assert(m.status === 200 && typeof m.body.data?.upload_url === 'string', `mint ${m.status}: ${JSON.stringify(m.body?.error)}`);
    const res = await fetch(m.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(zip) });
    return { status: res.status, body: await res.json() };
}

/** The ids of the extension schedules the owner's schedule list shows. */
async function extensionJobIds(): Promise<string[]> {
    const { body } = await json('/v1/schedules', { headers: auth() });
    return ((body.data?.extensions ?? []) as any[]).map(j => j.id as string).filter(id => id.startsWith(`ext:${EXT}:`));
}

console.log('\nPhase 1: an owner');
await test('0. alice registers', async () => {
    alice = await registerOwner(BASE, `alice${Date.now().toString(36)}`);
    assert(typeof alice.token === 'string', 'no token');
});

console.log('\nPhase 2: the ZIP route registers the schedules');
await test('1. A ZIP install with activate:true is active and its manifest schedule is registered', async () => {
    const r = await zipPut(zipOf('1.0.0', 'yearly'), { activate: true });
    assert(r.status === 200 && r.body.status === 'active', `install ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.action === 'installed', `action: ${r.body.action}`);
    const ids = await extensionJobIds();
    assert(ids.includes(`ext:${EXT}:yearly`), `the schedule should be registered, got ${JSON.stringify(ids)}`);
});

await test('2. A ZIP update of the active extension replaces the old schedule with the new manifest\'s', async () => {
    const r = await zipPut(zipOf('1.0.1', 'newyear'), { update: true });
    assert(r.status === 200 && r.body.updated === true, `update ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.reinitialized === true, `reinitialized: ${JSON.stringify(r.body)}`);
    assert(r.body.note === undefined, `no note about schedules left unregistered: ${r.body.note}`);
    const ids = await extensionJobIds();
    assert(ids.includes(`ext:${EXT}:newyear`), `the new schedule should be registered, got ${JSON.stringify(ids)}`);
    assert(!ids.includes(`ext:${EXT}:yearly`), `the old schedule should be gone, got ${JSON.stringify(ids)}`);
});

await test('3. The same bytes again answer "unchanged" and leave the schedule as it is', async () => {
    const r = await zipPut(zipOf('1.0.1', 'newyear'), { update: true });
    assert(r.status === 200 && r.body.action === 'unchanged', `identical update ${r.status}: ${JSON.stringify(r.body)}`);
    assert((await extensionJobIds()).includes(`ext:${EXT}:newyear`), 'the schedule should still be registered');
});

await test('4. Other code under a kept version is refused, and the schedules stay as they were', async () => {
    const r = await zipPut(zipOf('1.0.1', 'other', 'export default async function() { return { changed: true }; }'), { update: true });
    assert(r.status === 409 && r.body.error === 'VERSION_EXISTS', `kept version ${r.status}: ${JSON.stringify(r.body)}`);
    const ids = await extensionJobIds();
    assert(ids.includes(`ext:${EXT}:newyear`) && !ids.includes(`ext:${EXT}:other`), `schedules moved: ${JSON.stringify(ids)}`);
});

await test('5. A ZIP over an installed name without update:true is refused by name', async () => {
    const r = await zipPut(zipOf('1.0.2', 'newyear'), {});
    assert(r.status === 409 && r.body.error === 'ALREADY_EXISTS', `no-update ${r.status}: ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 3: the manifest read back installs again');
await test('6. ?full=true answers a manifest and the scripts, and the two install again as they are', async () => {
    const r = await json(`/v1/extensions/${EXT}?full=true`, { headers: auth() });
    assert(r.status === 200, `get ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ext = r.body.data.extension;
    assert(typeof ext.manifest === 'string' && ext.scripts && typeof ext.scripts['echo.js'] === 'string', `manifest/scripts missing: ${JSON.stringify(Object.keys(ext))}`);
    const doc = parseYaml(ext.manifest);
    assert(doc.limits?.timeout_ms === 4000 && doc.limits?.max_api_calls === 20, `snake_case limits: ${JSON.stringify(doc.limits)}`);
    assert(doc.config?.greeting?.type === 'string' && doc.config.greeting.default === 'hello', `config types: ${JSON.stringify(doc.config)}`);
    assert(doc.schedules?.[0]?.id === 'newyear', `schedules: ${JSON.stringify(doc.schedules)}`);

    doc.metadata.version = '1.0.3';
    const put = await json(`/v1/extensions/${EXT}`, {
        method: 'PUT', headers: auth(),
        body: JSON.stringify({ manifest: JSON.stringify(doc), scripts: ext.scripts }),
    });
    assert(put.status === 200, `reinstall ${put.status}: ${JSON.stringify(put.body?.error)}`);
    const after = await json(`/v1/extensions/${EXT}?full=true`, { headers: auth() });
    assert(after.body.data.extension.version === '1.0.3', `version ${after.body.data.extension.version}`);
    const again = parseYaml(after.body.data.extension.manifest);
    again.metadata.version = doc.metadata.version;
    assert(JSON.stringify(again) === JSON.stringify(doc), 'the reinstalled extension reads back as the manifest it was installed from');
});

await test('7. Without a sign-in ?full=true is refused, and the plain read carries no manifest', async () => {
    const anon = await json(`/v1/extensions/${EXT}?full=true`);
    assert(anon.status === 403, `anonymous full read ${anon.status}`);
    const plain = await json(`/v1/extensions/${EXT}`);
    assert(plain.status === 200 && plain.body.data.extension.manifest === undefined, 'the public read must not carry the manifest');
});

console.log('\nPhase 4: an inactive extension says how to switch it on');
await test('8. A call to an inactive extension names aimeat_extension_activate', async () => {
    const off = await json(`/v1/extensions/${EXT}/deactivate`, { method: 'POST', headers: auth(), body: '{}' });
    assert(off.status === 200, `deactivate ${off.status}: ${JSON.stringify(off.body?.error)}`);
    assert((await extensionJobIds()).length === 0, 'deactivating removes the schedules');
    const call = await json(`/v1/ext/${EXT}/echo`, { method: 'POST', headers: auth(), body: JSON.stringify({ note: 'x' }) });
    assert(call.body?.error?.code === 'EXTENSION_INACTIVE', `code ${JSON.stringify(call.body?.error)}`);
    assert(String(call.body.error.message).includes('aimeat_extension_activate'), `the refusal should name the tool: ${call.body.error.message}`);
});

await test('9. A ZIP update with activate:true switches it on and registers its schedules', async () => {
    const r = await zipPut(zipOf('1.0.4', 'newyear'), { update: true, activate: true });
    assert(r.status === 200 && r.body.status === 'active', `update+activate ${r.status}: ${JSON.stringify(r.body)}`);
    assert((await extensionJobIds()).includes(`ext:${EXT}:newyear`), 'activate through the ZIP route registers the schedule');
    await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth() });
});

finish();
