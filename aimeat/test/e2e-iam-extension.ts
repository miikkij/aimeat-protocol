/**
 * @file e2e-iam-extension.ts
 * @description E2E for the EVOLVED aimeat-iam extension (P5 slice 2): installs the ACTUAL package
 *   extension (under a unique name) and verifies the level + command evolution is backward-compatible.
 *   Legacy check{permission} is unchanged; admin seeds BBS ordinal levels (admin:0/editor:10/viewer:20)
 *   + an empty command manifest; setCommands + check{command} resolves a command's required capability,
 *   mutation tier, level, and needsConfirmation; a viewer is denied an irreversible '*' command that the
 *   admin role may run. Proves the extension now runs on the shared level/capability model.
 * @version-history
 *   v1.0.0 — 2026-07-02 — Initial: level + command evolution + backward-compat, against the real package.
 *   v1.1.0 — 2026-07-29 — Add a second owner and point it at the admin surface: the in-script
 *            `isOwner` check is the ONLY gate there (the route is requireAuth() only), and batch 01
 *            mutation I2 deleted it with the suite still 7/7 green.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=iam-extension

import { aimeatIamPackage } from '../src/data/aimeat-iam-package.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `iamext${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'IAM Ext', password: 'IamExt1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'IAM Ext', password: 'IamExt1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

// The evolved extension, extracted from the real package under a unique name (avoids collisions + re-runnable).
const EXT = `iamx${Date.now()}`;
const extComponent = aimeatIamPackage().components.find(c => c.type === 'extension')!;
const extDef = JSON.parse(extComponent.content) as { manifest: string; scripts: Record<string, string> };
const manifest = extDef.manifest.replace('name: iam', `name: ${EXT}`);
const scripts = extDef.scripts;

console.log('\n=== AIMEAT aimeat-iam Extension Evolution E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let aGaii = '';
const admin = (op: string, extra: Record<string, unknown> = {}) =>
    json(`/v1/ext/${EXT}/admin`, { method: 'POST', headers: authH(A.token), body: JSON.stringify({ op, ...extra }) });
const check = (input: Record<string, unknown>) =>
    json(`/v1/ext/${EXT}/check`, { method: 'POST', headers: authH(A.token), body: JSON.stringify(input) });
const data = (r: { body: any }) => (r.body && r.body.data !== undefined ? r.body.data : r.body);

await test('Setup owner A', async () => { A = await setupOwner('a'); });

await test('Install + activate the evolved iam extension', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: authH(A.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body.error || inst.body)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: authH(A.token), body: '{}' });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error || act.body)}`);
});

await test('1. claim + getState seed BBS levels + an empty command manifest', async () => {
    aGaii = data(await admin('claim')).ownerGhii;
    assert(!!aGaii, 'claim returned an ownerGhii');
    const s = data(await admin('getState'));
    assert(JSON.stringify(s.levels) === JSON.stringify({ admin: 0, editor: 10, viewer: 20 }), `levels: ${JSON.stringify(s.levels)}`);
    assert(Array.isArray(s.commands) && s.commands.length === 0, `commands: ${JSON.stringify(s.commands)}`);
});

await test('2. legacy check{permission} is unchanged (backward-compatible)', async () => {
    await admin('assign', { ghii: aGaii, role: 'viewer' });
    const read = data(await check({ permission: 'read' }));
    assert(read.allowed === true && read.role === 'viewer', `read: ${JSON.stringify(read)}`);
    const del = data(await check({ permission: 'delete' }));
    assert(del.allowed === false, `delete: ${JSON.stringify(del)}`);
});

await test('3. setCommands + check{command} resolves capability + tier + level (viewer)', async () => {
    await admin('setCommands', { commands: [
        { id: 'list', description: 'List items', capability: 'read', tier: 'read' },
        { id: 'purge', description: 'Delete everything', capability: '*', tier: 'irreversible' },
    ] });
    const list = data(await check({ command: 'list' }));
    assert(list.allowed === true && list.tier === 'read' && list.needsConfirmation === false && list.level === 20, `list: ${JSON.stringify(list)}`);
    const purge = data(await check({ command: 'purge' }));
    assert(purge.allowed === false && purge.tier === 'irreversible', `purge(viewer): ${JSON.stringify(purge)}`);
});

await test('4. the admin role runs the irreversible command with needsConfirmation + level 0', async () => {
    await admin('assign', { ghii: aGaii, role: 'admin' });
    const purge = data(await check({ command: 'purge' }));
    assert(purge.allowed === true && purge.needsConfirmation === true && purge.level === 0, `purge(admin): ${JSON.stringify(purge)}`);
});

await test('5. an unknown command is denied with an error', async () => {
    const u = data(await check({ command: 'nope' }));
    assert(u.allowed === false && /unknown/.test(u.error || ''), `unknown: ${JSON.stringify(u)}`);
});

await test('6. a DIFFERENT authenticated owner CANNOT drive the admin surface', async () => {
    // /v1/ext/:name/:actionId is requireAuth() only, so the in-script `isOwner` check is the ONLY
    // gate on setConfig/setRoles/setLevels/setCommands/assign. Any authenticated caller who gets
    // past it owns the app's whole permission model.
    B = await setupOwner('b');
    const bGhii = `${B.name}@${NODE_ID}`;
    const asB = (op: string, extra: Record<string, unknown> = {}) =>
        json(`/v1/ext/${EXT}/admin`, { method: 'POST', headers: authH(B.token), body: JSON.stringify({ op, ...extra }) });

    const st = data(await asB('getState'));
    assert(st.isOwner === false, `B must not be the extension owner: ${JSON.stringify(st.isOwner)}`);
    assert(st.ownerGhii === aGaii, `the extension owner must still be A: ${JSON.stringify(st.ownerGhii)}`);

    const ops: [string, Record<string, unknown>][] = [
        ['setConfig', { config: { defaultRole: 'admin' } }],
        ['setRoles', { roles: { admin: ['*'], viewer: ['*'] } }],
        ['setLevels', { levels: { admin: 0, editor: 0, viewer: 0 } }],
        ['setCommands', { commands: [{ id: 'pwn', description: 'pwn', capability: 'read', tier: 'read' }] }],
        ['assign', { ghii: bGhii, role: 'admin' }],
        ['revoke', { ghii: aGaii }],
    ];
    for (const [op, extra] of ops) {
        const r = data(await asB(op, extra));
        assert(r.ok === false && /forbidden/.test(r.error || ''), `${op} by a non-owner must be refused, got ${JSON.stringify(r)}`);
    }

    // The refusals were real: none of what B tried to write landed.
    const after = data(await admin('getState'));
    assert(JSON.stringify(after.levels) === JSON.stringify({ admin: 0, editor: 10, viewer: 20 }), `levels must be untouched: ${JSON.stringify(after.levels)}`);
    assert(after.roles.viewer.length === 1 && after.roles.viewer[0] === 'read', `viewer role must be untouched: ${JSON.stringify(after.roles.viewer)}`);
    assert(after.commands.every((c: any) => c.id !== 'pwn'), `command manifest must be untouched: ${JSON.stringify(after.commands)}`);
    assert(after.assignments[bGhii] === undefined, `B must not have assigned itself a role: ${JSON.stringify(after.assignments)}`);
    assert(after.assignments[aGaii] === 'admin', `A's own assignment must survive B's revoke: ${JSON.stringify(after.assignments)}`);
});

console.log(`\naimeat-iam Extension Evolution E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
