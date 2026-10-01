/**
 * @file e2e-package-guards.ts
 * @description A package does not take over what belongs to somebody else (package sale design,
 *   phase 1, docs/specs/package-sale-design.md T3, T4, T8 and section 7):
 *   - a memory component does not overwrite a record the installer already has; another install of
 *     the same package may rewrite what the package wrote;
 *   - a cortex schema part does not replace another person's structure lock, and the uninstall
 *     leaves that lock alone;
 *   - a gallery listing is the author's own and waits for review unless an operator makes it, and a
 *     suspension keeps its reason;
 *   - a new package version asks packages:write, as a new package does;
 *   - compose names the extensions a packaged cortex calls.
 * @structure
 *   - Setup: owner A (the first, so the operator), owner B, an agent of B without packages:write
 *   - Phase 1: memory components
 *   - Phase 2: schema locks
 *   - Phase 3: the gallery
 *   - Phase 4: the version route's permission
 *   - Phase 5: compose and a cortex's extension calls
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-guards
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 1).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function newOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function newAgent(ownerToken: string, owner: string, name: string, scopes: string[]): Promise<string> {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], model: 'test-model', scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** Publish a private package of `components` for the caller; returns its group id. */
async function publish(token: string, name: string, components: unknown[], visibility = 'private'): Promise<string> {
    const r = await json('/v1/packages', {
        method: 'POST', headers: authed(token),
        body: JSON.stringify({ name, description: `${name}, a guards fixture`, category: 'utility', visibility, components }),
    });
    assert(r.status === 201, `publish ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.packageGroupId as string;
}

const install = (token: string, groupId: string, extra: Record<string, unknown> = {}) => json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
    method: 'POST', headers: authed(token), body: JSON.stringify({ label: 'guards', ...extra }),
});
const memoryComponent = (id: string, entries: Array<{ key: string; value: unknown }>) =>
    ({ id, type: 'memory', label: id, content: JSON.stringify({ entries }), dependencies: [] });
const cortexWithSchema = (name: string, keyPattern: string) => ({
    id: `cortex-${name}`, type: 'cortex', label: name, dependencies: [],
    content: JSON.stringify({
        manifest: `apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: ${name}\nspec:\n  version: "1.0.0"\n  components:\n    - type: schema\n      name: shape\n      key_pattern: ${keyPattern}\n      apply_to: prefix\n      schema:\n        type: object\n        properties:\n          title: { type: string }\n`,
        libs: {},
    }),
});

const stamp = Date.now() % 1000000;
const A = `guarda${stamp}`;
const B = `guardb${stamp}`;
let aToken = '';
let bToken = '';
let bAgentToken = '';

console.log('\n═══ Package guards E2E ═══');
console.log('\nSetup');

await test('Owner A (the first, so the operator), owner B, and an agent of B with app:write but not packages:write', async () => {
    aToken = await newOwner(A);
    bToken = await newOwner(B);
    bAgentToken = await newAgent(bToken, B, `guardbot${stamp}`, ['app:write', 'memory:read', 'memory:write']);
    const me = await json('/v1/me', { headers: authed(aToken) });
    assert(me.status !== 200 || JSON.stringify(me.body).includes('operator'), `A is the operator: ${JSON.stringify(me.body)}`);
});

console.log('\nPhase 1 — Memory components');

const MINE = `guard.notes.${stamp}`;
const FRESH = `guard.fresh.${stamp}`;
let freshGroup = '';

await test('A package that would overwrite a record the installer has is refused, on a dry run too, and the record is untouched', async () => {
    const own = await json('/v1/memory', { method: 'POST', headers: authed(bToken), body: JSON.stringify({ key: MINE, value: { mine: true } }) });
    assert(own.status === 200 || own.status === 201, `B writes its record: ${own.status} ${JSON.stringify(own.body)}`);
    const group = await publish(bToken, `guardmem${stamp}`, [memoryComponent('seed', [{ key: MINE, value: { theirs: true } }])]);
    const dry = await install(bToken, group, { dry_run: true });
    assert(dry.status === 409 && dry.body.error?.code === 'KEY_EXISTS', `dry run: ${dry.status} ${JSON.stringify(dry.body)}`);
    const real = await install(bToken, group);
    assert(real.status === 409 && real.body.error?.code === 'KEY_EXISTS' && String(real.body.error?.message).includes(MINE), `install: ${real.status} ${JSON.stringify(real.body)}`);
    const read = await json(`/v1/memory/${encodeURIComponent(MINE)}`, { headers: authed(bToken) });
    assert(read.status === 200 && read.body.data?.value?.mine === true && read.body.data?.value?.theirs === undefined, `the record is B's own still: ${JSON.stringify(read.body)}`);
    const inst = await json(`/v1/instances?packageGroupId=${encodeURIComponent(group)}`, { headers: authed(bToken) });
    assert(((inst.body.data?.instances ?? inst.body.data) as any[]).filter((i: any) => i.packageGroupId === group).length === 0, `nothing installed: ${JSON.stringify(inst.body)}`);
});

await test('A package writing a key nobody has installs, and a second install of the same package may rewrite it', async () => {
    freshGroup = await publish(bToken, `guardfresh${stamp}`, [memoryComponent('seed', [{ key: FRESH, value: { n: 1 } }])]);
    const first = await install(bToken, freshGroup);
    assert(first.status === 201, `first install: ${first.status} ${JSON.stringify(first.body)}`);
    const second = await install(bToken, freshGroup, { label: 'second copy' });
    assert(second.status === 201, `the same package again: ${second.status} ${JSON.stringify(second.body)}`);
});

await test('Another package that writes the first package\'s key is refused', async () => {
    const other = await publish(bToken, `guardother${stamp}`, [memoryComponent('seed', [{ key: FRESH, value: { n: 2 } }])]);
    const r = await install(bToken, other);
    assert(r.status === 409 && r.body.error?.code === 'KEY_EXISTS', `another package: ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 2 — Structure locks');

const LOCKED = `guardlock${stamp}.items`;
const OPEN = `guardopen${stamp}.items`;
// The lock a write under the prefix meets: a prefix lock applies to the keys below it.
const lockOf = async (key: string) => (await json(`/v1/memory/${encodeURIComponent(`${key}.probe`)}/schema`)).body;

await test('A package whose cortex would replace another person\'s structure lock is refused, and the lock is untouched', async () => {
    const lock = await json(`/v1/memory/${encodeURIComponent(LOCKED)}/schema`, {
        method: 'PUT', headers: authed(aToken),
        body: JSON.stringify({ schema: { type: 'object', properties: { owner_field: { type: 'string' } } }, apply_to: 'prefix', schema_mode: 'strict' }),
    });
    assert(lock.status === 200, `A locks ${LOCKED}: ${lock.status} ${JSON.stringify(lock.body)}`);
    const group = await publish(bToken, `guardlockpkg${stamp}`, [cortexWithSchema(`guardlockcx${stamp}`, LOCKED)]);
    const dry = await install(bToken, group, { dry_run: true });
    assert(dry.status === 409 && dry.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `dry run: ${dry.status} ${JSON.stringify(dry.body)}`);
    const real = await install(bToken, group);
    assert(real.status === 409 && real.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `install: ${real.status} ${JSON.stringify(real.body)}`);
    const after = JSON.stringify(await lockOf(LOCKED));
    assert(after.includes('owner_field') && !after.includes('"title"'), `A's lock stands: ${after}`);
});

await test('A package\'s lock on a free key is set, and the uninstall takes it away again', async () => {
    const group = await publish(bToken, `guardopenpkg${stamp}`, [cortexWithSchema(`guardopencx${stamp}`, OPEN)]);
    const r = await install(bToken, group);
    assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
    assert(JSON.stringify(await lockOf(OPEN)).includes('"title"'), 'the package set its lock');
    const del = await json(`/v1/instances/${r.body.data.id}`, { method: 'DELETE', headers: authed(bToken), body: JSON.stringify({ removeComponents: true }) });
    assert(del.status === 200, `uninstall: ${del.status} ${JSON.stringify(del.body)}`);
    assert(!JSON.stringify(await lockOf(OPEN)).includes('"title"'), 'the uninstall removed what the package set');
});

const SHARED = `guardshared${stamp}.items`;

await test('Two owners install the same package: the lock is the same structure, so it is shared, and one uninstall leaves it', async () => {
    const group = await publish(bToken, `guardsharedpkg${stamp}`, [cortexWithSchema(`guardsharedcx${stamp}`, SHARED)], 'public');
    const a = await install(aToken, group);
    assert(a.status === 201, `A installs first: ${a.status} ${JSON.stringify(a.body)}`);
    const b = await install(bToken, group);
    assert(b.status === 201, `B installs the same package: ${b.status} ${JSON.stringify(b.body)}`);
    const del = await json(`/v1/instances/${b.body.data.id}`, { method: 'DELETE', headers: authed(bToken), body: JSON.stringify({ removeComponents: true }) });
    assert(del.status === 200, `B uninstalls: ${del.status} ${JSON.stringify(del.body)}`);
    const lock = await lockOf(SHARED);
    assert(JSON.stringify(lock).includes('"title"') && String(lock.data?.locked_by).startsWith(A), `A's lock stays: ${JSON.stringify(lock)}`);
});

console.log('\nPhase 3 — The gallery');

let bGroup = '';
let listingId = '';

await test('B cannot list A\'s package in the gallery', async () => {
    const aGroup = await publish(aToken, `guardalisted${stamp}`, [memoryComponent('seed', [{ key: `guard.a.${stamp}`, value: 1 }])]);
    const r = await json('/v1/templates', {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ packageGroupId: aGroup, title: 'Not mine', description: 'Somebody else\'s package' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('B\'s listing of B\'s own package waits for review; it is not in the gallery yet', async () => {
    bGroup = await publish(bToken, `guardblisted${stamp}`, [memoryComponent('seed', [{ key: `guard.b.${stamp}`, value: 1 }])]);
    const r = await json('/v1/templates', {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ packageGroupId: bGroup, title: 'Mine', description: 'B\'s package' }),
    });
    assert(r.status === 201 && r.body.data.listing.status === 'pending_review', `listing: ${r.status} ${JSON.stringify(r.body)}`);
    listingId = r.body.data.listing.id;
    const gallery = await json('/v1/templates?limit=200');
    assert(!(gallery.body.data?.templates ?? gallery.body.data?.listings ?? []).some((l: any) => l.id === listingId), 'not listed before review');
});

await test('An agent without packages:write cannot make a listing', async () => {
    const r = await json('/v1/templates', {
        method: 'POST', headers: authed(bAgentToken), body: JSON.stringify({ packageGroupId: bGroup, title: 'Agent', description: 'by an agent' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('The operator approves it, suspends it with a reason, and the reason is kept', async () => {
    const ok = await json(`/v1/templates/${listingId}/approve`, { method: 'POST', headers: authed(aToken), body: JSON.stringify({}) });
    assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body)}`);
    const sus = await json(`/v1/templates/${listingId}/suspend`, { method: 'POST', headers: authed(aToken), body: JSON.stringify({ reason: 'guards: the reason travels' }) });
    assert(sus.status === 200, `suspend: ${sus.status} ${JSON.stringify(sus.body)}`);
    const one = await json(`/v1/templates/${listingId}`, { headers: authed(aToken) });
    const listing = one.body.data?.listing ?? one.body.data;
    assert(listing?.reviewComment === 'guards: the reason travels', `the reason is on the listing: ${JSON.stringify(one.body)}`);
});

console.log('\nPhase 4 — A new version asks packages:write');

await test('An agent with app:write but not packages:write cannot add a version; the owner can', async () => {
    const comps = [memoryComponent('seed', [{ key: `guard.b.${stamp}`, value: 2 }])];
    const agent = await json(`/v1/packages/${encodeURIComponent(bGroup)}/versions`, {
        method: 'POST', headers: authed(bAgentToken), body: JSON.stringify({ changelog: 'by the agent', components: comps }),
    });
    assert(agent.status === 403, `agent: ${agent.status} ${JSON.stringify(agent.body)}`);
    const owner = await json(`/v1/packages/${encodeURIComponent(bGroup)}/versions`, {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ changelog: 'by the owner', components: comps }),
    });
    assert(owner.status === 201, `owner: ${owner.status} ${JSON.stringify(owner.body)}`);
});

console.log('\nPhase 5 — Compose names what a cortex calls');

const CX = `guardkit${stamp}`;
const EXT = `guard-missing-ext-${stamp}`;
const APP = 'guard-kit-app.html';

await test('Compose refuses an app whose cortex calls an extension, naming it, and records it with allow_expectations', async () => {
    const manifest = `apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: ${CX}\n  namespace: ${B}\nspec:\n  version: "1.0.0"\n  components:\n    - type: lib\n      name: kit\n      filename: kit.js\n`;
    const cx = await json('/v1/cortex', {
        method: 'POST', headers: authed(bToken),
        body: JSON.stringify({ manifest, libs: { 'kit.js': `export const ping = () => fetch('/v1/ext/${EXT}/ping');` } }),
    });
    assert(cx.status === 201, `cortex: ${cx.status} ${JSON.stringify(cx.body)}`);
    const act = await json(`/v1/cortex/${encodeURIComponent(CX)}/activate`, { method: 'POST', headers: authed(bToken), body: '{}' });
    assert(act.status === 200 || act.status === 201, `activate: ${act.status} ${JSON.stringify(act.body)}`);
    const app = await json('/v1/apps', {
        method: 'POST', headers: authed(bToken),
        body: JSON.stringify({
            filename: APP, name: 'Guard kit app', description: 'Loads a kit that calls an extension',
            content: b64(`<!DOCTYPE html><html><head><title>Kit</title><script src="/v1/cortex/${CX}/libs/kit.js"></script></head><body><h1>Kit</h1></body></html>`),
        }),
    });
    assert(app.status === 201, `app: ${app.status} ${JSON.stringify(app.body)}`);
    const refused = await json('/v1/packages/compose', { method: 'POST', headers: authed(bToken), body: JSON.stringify({ name: `guardcompose${stamp}`, apps: [APP] }) });
    assert(refused.status === 400 && refused.body.error?.code === 'EXTENSION_NOT_PACKAGED' && String(refused.body.error?.message).includes(EXT),
        `refused naming the cortex's extension: ${refused.status} ${JSON.stringify(refused.body)}`);
    const allowed = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ name: `guardcompose${stamp}`, apps: [APP], allow_expectations: true }),
    });
    assert(allowed.status === 201 && (allowed.body.data.expects?.extensions ?? []).includes(EXT), `recorded: ${allowed.status} ${JSON.stringify(allowed.body.data?.expects)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
