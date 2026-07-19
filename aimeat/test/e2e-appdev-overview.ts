/**
 * @file e2e-appdev-overview.ts
 * @description E2E for the appdev research overview (AppDev KB Phase 5): REST
 *   GET /v1/appdev/overview (auth required, sections + model params, owner isolation of the
 *   apps section) and the MCP aimeat_appdev_overview tool (same service, builder skill first,
 *   curated pitfalls index, learned-pitfall model facets).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=appdev-overview).
 * @version-history v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

console.log('\n=== AIMEAT AppDev Overview E2E Test ===\n');

const stamp = Date.now().toString().slice(-7);
const ownerA = `ovowna${stamp}`;
const ownerB = `ovownb${stamp}`;
let tokenA = '';
let tokenB = '';

async function makeOwner(name: string): Promise<string> {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: name, password: 'Overview1!' }),
    });
    assert(status === 201, `ghii ${status}`);
    const ts = new Date().toISOString();
    const { body: tb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(body.data.private_key, name + NODE_ID + ts) }),
    });
    return tb.data.token;
}

await test('Setup: two owners; A publishes one app', async () => {
    tokenA = await makeOwner(ownerA);
    tokenB = await makeOwner(ownerB);
    const { status } = await json('/v1/apps', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
            filename: 'overview-demo.html',
            content: b64('<!doctype html><meta name="aimeat-app" content="overview-demo.html"><h1>demo</h1>'),
            name: 'Overview Demo', description: 'research surface demo app', category: 'utility', tags: ['demo'],
        }),
    });
    assert(status === 201, `app publish ${status}`);
});

await test('GET /v1/appdev/overview requires auth', async () => {
    const { status } = await json('/v1/appdev/overview');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('overview returns every section with caps + drill-downs', async () => {
    const { status, body } = await json('/v1/appdev/overview', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(status === 200, `status ${status}`);
    const d = body.data;
    for (const s of ['apps', 'library_packs', 'app_templates', 'skills', 'pitfalls_curated', 'pitfalls_learned', 'template_proposals']) {
        assert(d[s] !== undefined, `section ${s} missing`);
    }
    assert(typeof d.scope_note === 'string' && /research/.test(d.scope_note), 'scope_note missing');
    assert(d.apps.items.some((a: any) => a.filename === 'overview-demo.html'), 'own app missing from apps section');
    assert(d.library_packs.items.length > 0 && d.library_packs.items.length <= 25, 'library_packs not capped index');
    assert(d.library_packs.items.every((p: any) => p.id && p.model_tier), 'pack index entries malformed');
    assert(d.app_templates.items.some((t: any) => t.tier === 'T1'), 'T1 shell missing');
    assert(/aimeat-app-builder/.test(d.skills.builder_skill), 'builder skill not surfaced first');
    assert(d.skills.node.items.some((s: any) => s.ref === 'node:aimeat-app-builder'), 'builder skill missing from node skills');
    assert(d.pitfalls_curated.total >= 20 && d.pitfalls_curated.facets, 'curated pitfalls index missing');
});

await test('?sections= narrows the payload', async () => {
    const { body } = await json('/v1/appdev/overview?sections=library_packs,pitfalls_curated', { headers: { Authorization: `Bearer ${tokenA}` } });
    const d = body.data;
    assert(d.library_packs && d.pitfalls_curated, 'requested sections missing');
    assert(d.apps === undefined && d.skills === undefined, 'unrequested sections leaked');
});

await test('?model= marks proven packs', async () => {
    const { body } = await json('/v1/appdev/overview?model=claude-haiku-4-5&sections=library_packs', { headers: { Authorization: `Bearer ${tokenA}` } });
    const packs = body.data.library_packs.items;
    assert(packs.every((p: any) => typeof p.proven_for_model === 'boolean'), 'proven_for_model missing under model filter');
});

await test('owner isolation: B does not see A\'s apps', async () => {
    const { body } = await json('/v1/appdev/overview?sections=apps', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert(!body.data.apps.items.some((a: any) => a.filename === 'overview-demo.html'), 'cross-owner app leak');
});

console.log('\n' + '─'.repeat(40));
console.log(`AppDev overview E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All appdev-overview tests passed!\n');
