/**
 * @file e2e-appdev-overview.ts
 * @description E2E for the appdev research overview (AppDev KB Phase 5): REST
 *   GET /v1/appdev/overview (auth required, sections + model params, owner isolation of the
 *   apps section) and the MCP aimeat_appdev_overview tool (same service, builder skill first,
 *   curated pitfalls index, learned-pitfall model facets).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=appdev-overview).
 * @version-history
 *   v1.2.0 — 2026-09-13 — +the overview's learned section under ?model=: every active entry the
 *     caller can read (own and other owners' shared), critical first, the named model's entries
 *     first inside a severity, a private entry of another owner never; the drill-down names a door
 *     that can open an entry. +POST /learned reports and upserts with a verification stamp, PATCH
 *     verified re-checks without changing `updated`, cross-owner 404; every active curated entry
 *     carries verifiedAt/verifiedVersion.
 *   v1.1.0 — 2026-09-03 — +the learned list as a page: paging, status default, severity/model/
 *     category/shared/q filters, scope vs filtered facets, severity sort, the community count and
 *     cross-owner isolation on the paged door (AppDev page, poster face).
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
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
    // The built-in skills are seeded at boot WITHOUT being awaited (server-bootstrap/service-init.ts
    // fires seedBuiltinSkills and moves on), so a fast suite can read the overview before the node
    // has finished writing them. It showed up as a one-in-three failure on postgres, where boot is
    // slower because the migrations run first, and never on sqlite. Wait for the record rather than
    // asserting into a race: a flaky test is worse than a missing one, because it teaches everyone
    // to re-run until it is green and that is how a real regression gets waved through.
    let d: any;
    for (let attempt = 0; attempt < 40; attempt++) {
        const r = await json('/v1/appdev/overview', { headers: { Authorization: `Bearer ${tokenA}` } });
        assert(r.status === 200, `status ${r.status}`);
        d = r.body.data;
        if (d?.skills?.node?.items?.some((s: any) => s.ref === 'node:aimeat-app-builder')) break;
        await new Promise(r2 => setTimeout(r2, 250));
    }
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

// ── Learned-KB + template REST management (the profile UI surface) ──

await test('learned KB REST: seed via memory → list → PATCH share → cross-owner shared view → DELETE', async () => {
    const seed = {
        title: 'UI test pitfall', symptom: 'something visibly broke in a build',
        resolution: 'do the visibly better thing instead', model: 'claude-haiku-4.5',
        category: 'auth', slug: 'ui-test-entry', applies_to: ['auth'],
        severity: 'warn', status: 'active', reported_by: 'ui-e2e',
        created: new Date().toISOString(), updated: new Date().toISOString(),
    };
    const { status: ws } = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
            key: 'packages/appdev-pitfalls/auth/ui-test-entry',
            value: seed, visibility: 'owner', tags: ['knowledge-entry', 'pitfall', 'model:claude-haiku-4.5'],
        }),
    });
    assert(ws === 200 || ws === 201, `seed write ${ws}`);

    const { status: ls, body: list } = await json('/v1/appdev/pitfalls/learned', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ls === 200, `learned list ${ls}`);
    const entry = list.data.pitfalls.find((p: any) => p.slug === 'ui-test-entry');
    assert(entry && entry.source === 'own' && entry.shared === false, `entry missing/wrong: ${JSON.stringify(entry)}`);
    assert(entry.symptom && entry.resolution, 'full bodies missing from learned list');

    const { status: ps, body: patched } = await json('/v1/appdev/pitfalls/learned/auth/ui-test-entry', {
        method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ share: true, status: 'outdated' }),
    });
    assert(ps === 200, `patch ${ps}: ${JSON.stringify(patched).slice(0, 150)}`);
    assert(patched.data.pitfall.shared === true && patched.data.pitfall.status === 'outdated', 'flags not applied');

    // Owner B sees it only via include_shared, as source 'shared'
    const { body: bPlain } = await json('/v1/appdev/pitfalls/learned', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert(!bPlain.data.pitfalls.some((p: any) => p.slug === 'ui-test-entry'), 'leak into B own list');
    const { body: bShared } = await json('/v1/appdev/pitfalls/learned?include_shared=1', { headers: { Authorization: `Bearer ${tokenB}` } });
    const sharedEntry = bShared.data.pitfalls.find((p: any) => p.slug === 'ui-test-entry');
    assert(sharedEntry && sharedEntry.source === 'shared', 'shared entry not visible to B');

    // B cannot delete A's entry; A can
    const { status: bd } = await json('/v1/appdev/pitfalls/learned/auth/ui-test-entry', { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } });
    assert(bd === 404, `B delete expected 404, got ${bd}`);
    const { status: ad } = await json('/v1/appdev/pitfalls/learned/auth/ui-test-entry', { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ad === 200, `A delete ${ad}`);
    const { body: after } = await json('/v1/appdev/pitfalls/learned', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(!after.data.pitfalls.some((p: any) => p.slug === 'ui-test-entry'), 'entry survived delete');
});

// ── The learned list as a page: filters, search, facets and the community count (AppDev page, poster face) ──

await test('learned KB REST: pages, filters, searches, counts facets and says how many others shared', async () => {
    const seedOne = async (token: string, slug: string, extra: Record<string, unknown>) => {
        const now = new Date().toISOString();
        const value = {
            title: `Paged ${slug}`, symptom: `symptom of ${slug}`, resolution: `resolution of ${slug}`,
            model: 'claude-haiku-4.5', category: 'data', slug, applies_to: ['app'],
            severity: 'warn', status: 'active', reported_by: 'ui-e2e', created: now, updated: now, ...extra,
        };
        const { status } = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                key: `packages/appdev-pitfalls/data/${slug}`, value,
                visibility: extra.visibility ?? 'owner', tags: ['knowledge-entry', 'pitfall', 'model:claude-haiku-4.5'],
            }),
        });
        assert(status === 200 || status === 201, `seed ${slug}: ${status}`);
    };
    const a = { Authorization: `Bearer ${tokenA}` };
    // Owner A: three active warnings, one critical from another model, one outdated. Owner B: one shared.
    await seedOne(tokenA, 'page-a1', {});
    await seedOne(tokenA, 'page-a2', { updated: '2026-01-02T00:00:00.000Z' });
    await seedOne(tokenA, 'page-a3', { title: 'Paged needle-title', app_ref: `${ownerA}/needle.html` });
    await seedOne(tokenA, 'page-crit', { severity: 'critical', model: 'goose' });
    await seedOne(tokenA, 'page-old', { status: 'outdated' });
    await seedOne(tokenB, 'page-b-shared', { visibility: 'public' });

    // Paging: two pages that do not overlap, the default sort newest first, full bodies on a page.
    const { body: p1 } = await json('/v1/appdev/pitfalls/learned?status=active&limit=2&offset=0', { headers: a });
    const { body: p2 } = await json('/v1/appdev/pitfalls/learned?status=active&limit=2&offset=2', { headers: a });
    assert(p1.data.total === 4 && p2.data.total === 4, `active total expected 4, got ${p1.data.total}/${p2.data.total}`);
    assert(p1.data.pitfalls.length === 2 && p1.data.limit === 2 && p2.data.offset === 2, 'page shape wrong');
    const keys1 = new Set(p1.data.pitfalls.map((p: any) => p.key));
    assert(p2.data.pitfalls.every((p: any) => !keys1.has(p.key)), 'pages overlap');
    assert(p1.data.pitfalls[0].symptom && p1.data.pitfalls[0].resolution, 'page rows lack full bodies');
    const all = [...p1.data.pitfalls, ...p2.data.pitfalls];
    assert(all[all.length - 1].slug === 'page-a2', `oldest entry should be last, got ${all.map((p: any) => p.slug).join(',')}`);
    assert(!all.some((p: any) => p.slug === 'page-old'), 'status=active leaked an outdated entry');

    // The default on this door is every status, as before the page existed.
    const { body: dflt } = await json('/v1/appdev/pitfalls/learned', { headers: a });
    assert(dflt.data.pitfalls.some((p: any) => p.slug === 'page-old'), 'default status hid the outdated entry');
    assert(dflt.data.limit === 25 && dflt.data.offset === 0, 'default paging wrong');

    // Facets count the whole scope while a filter is on; filtered_facets count what is left.
    const { body: crit } = await json('/v1/appdev/pitfalls/learned?severity=critical&limit=1', { headers: a });
    assert(crit.data.total === 1 && crit.data.pitfalls[0].slug === 'page-crit', 'severity filter wrong');
    assert(crit.data.facets.severity.warn === 4 && crit.data.facets.severity.critical === 1, `scope facets wrong: ${JSON.stringify(crit.data.facets.severity)}`);
    assert(crit.data.filtered_facets.model.goose === 1 && !crit.data.filtered_facets.model['claude-haiku-4.5'], 'filtered facets wrong');
    assert(crit.data.facets.status.outdated === 1 && crit.data.facets.shared.private === 5, `status/shared facets wrong: ${JSON.stringify(crit.data.facets)}`);

    // Model, category, shared and text filters.
    const { body: byModel } = await json('/v1/appdev/pitfalls/learned?model=goose', { headers: a });
    assert(byModel.data.total === 1, `model filter expected 1, got ${byModel.data.total}`);
    const { body: byCat } = await json('/v1/appdev/pitfalls/learned?category=data&status=all', { headers: a });
    assert(byCat.data.total === 5, `category filter expected 5, got ${byCat.data.total}`);
    const { body: byShared } = await json('/v1/appdev/pitfalls/learned?shared=1', { headers: a });
    assert(byShared.data.total === 0, `shared=1 expected 0 own shared, got ${byShared.data.total}`);
    const { body: byQ } = await json('/v1/appdev/pitfalls/learned?q=NEEDLE', { headers: a });
    assert(byQ.data.total === 1 && byQ.data.pitfalls[0].slug === 'page-a3', 'q did not match title/app_ref case-insensitively');
    const { body: byQBody } = await json('/v1/appdev/pitfalls/learned?q=resolution+of+page-a1', { headers: a });
    assert(byQBody.data.total === 1 && byQBody.data.pitfalls[0].slug === 'page-a1', 'q did not search the resolution');

    // Severity sort ranks the critical first.
    const { body: bySev } = await json('/v1/appdev/pitfalls/learned?sort=severity&limit=1', { headers: a });
    assert(bySev.data.pitfalls[0].slug === 'page-crit', 'sort=severity did not rank the critical first');

    // The community count is there whether or not B's entry is included; B's private data never is.
    assert(p1.data.community === 1, `community expected 1, got ${p1.data.community}`);
    assert(!dflt.data.pitfalls.some((p: any) => p.slug === 'page-b-shared'), 'B entry included without include_shared');
    const { body: withB } = await json('/v1/appdev/pitfalls/learned?include_shared=1&status=all', { headers: a });
    const bRow = withB.data.pitfalls.find((p: any) => p.slug === 'page-b-shared');
    assert(bRow && bRow.source === 'shared' && withB.data.facets.source.shared === 1, 'shared entry missing from include_shared page');
    assert(withB.data.total === 6, `include_shared total expected 6, got ${withB.data.total}`);

    // Clean up every seeded entry, both owners.
    for (const slug of ['page-a1', 'page-a2', 'page-a3', 'page-crit', 'page-old']) {
        const { status } = await json(`/v1/appdev/pitfalls/learned/data/${slug}`, { method: 'DELETE', headers: a });
        assert(status === 200, `cleanup ${slug}: ${status}`);
    }
    const { status: bDel } = await json('/v1/appdev/pitfalls/learned/data/page-b-shared', { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } });
    assert(bDel === 200, `cleanup B: ${bDel}`);
    const { body: after } = await json('/v1/appdev/pitfalls/learned?status=all&include_shared=1', { headers: a });
    assert(!after.data.pitfalls.some((p: any) => String(p.slug).startsWith('page-')), 'seeded entries survived cleanup');
});

// ── The research call hands every builder the whole learned list, whatever model it names ──

await test('overview learned pitfalls: ?model= orders and never hides; shared entries included; critical first', async () => {
    // Until 2026-09-13 the overview kept only entries whose AUTHOR was the model the caller named,
    // and only the caller's own owner scope. On aimeat.io that answered a Gemini builder with 0 of
    // 123 entries, and gave no other owner any of the 118 that had been shared platform-wide.
    const seed = async (token: string, slug: string, extra: Record<string, unknown>) => {
        const now = new Date().toISOString();
        const { visibility, ...rest } = extra;
        const value = {
            title: `Overview ${slug}`, symptom: `symptom of ${slug}`, resolution: `resolution of ${slug}`,
            model: 'goose', category: 'data', slug, applies_to: ['app'], severity: 'warn', status: 'active',
            reported_by: 'overview-e2e', created: now, updated: now, ...rest,
        };
        const { status } = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                key: `packages/appdev-pitfalls/data/${slug}`, value,
                visibility: visibility ?? 'owner', tags: ['knowledge-entry', 'pitfall', `model:${value.model}`],
            }),
        });
        assert(status === 200 || status === 201, `seed ${slug}: ${status}`);
    };
    await seed(tokenA, 'ov-a-warn-goose', { model: 'goose' });
    await seed(tokenA, 'ov-a-warn-haiku', { model: 'claude-haiku-4.5', updated: '2026-01-02T00:00:00.000Z' });
    await seed(tokenA, 'ov-a-crit-kimi', { model: 'kimi-k2.7-code', severity: 'critical' });
    await seed(tokenA, 'ov-a-outdated', { model: 'claude-haiku-4.5', status: 'outdated' });
    await seed(tokenB, 'ov-b-shared', { model: 'gemini-2.5-pro', visibility: 'public' });
    await seed(tokenB, 'ov-b-private', { model: 'gemini-2.5-pro' });

    const { status, body } = await json('/v1/appdev/overview?model=claude-haiku-4.5&sections=pitfalls_learned', {
        headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(status === 200, `overview ${status}`);
    const section = body.data.pitfalls_learned;
    const mine = section.items.filter((p: any) => String(p.key).includes('/ov-'));
    const slugs = mine.map((p: any) => String(p.key).split('/').pop());

    for (const s of ['ov-a-warn-goose', 'ov-a-warn-haiku', 'ov-a-crit-kimi', 'ov-b-shared']) {
        assert(slugs.includes(s), `${s} missing from the overview under ?model=claude-haiku-4.5: ${slugs.join(',')}`);
    }
    assert(!slugs.includes('ov-a-outdated'), 'an outdated entry was listed');
    assert(!slugs.includes('ov-b-private'), 'another owner\'s PRIVATE entry leaked into the overview');

    assert(slugs[0] === 'ov-a-crit-kimi', `critical entry should lead, got ${slugs.join(',')}`);
    assert(slugs.indexOf('ov-a-warn-haiku') < slugs.indexOf('ov-a-warn-goose'),
        `inside one severity the caller's own model comes first, even when older: ${slugs.join(',')}`);

    const haiku = mine.find((p: any) => String(p.key).endsWith('/ov-a-warn-haiku'));
    const goose = mine.find((p: any) => String(p.key).endsWith('/ov-a-warn-goose'));
    assert(haiku.same_model === true && goose.same_model === false, 'same_model mark wrong');
    const shared = mine.find((p: any) => String(p.key).endsWith('/ov-b-shared'));
    assert(shared.source === 'shared' && typeof shared.owner === 'string' && shared.owner.includes(ownerB),
        `shared entry must say whose it is, so its body can be read: ${JSON.stringify(shared)}`);
    assert(section.total >= 4 && section.sources && section.sources.shared >= 1, `section counts wrong: ${JSON.stringify({ total: section.total, sources: section.sources })}`);
    assert(!/knowledge_get/.test(section.drill_down), 'drill_down still points at aimeat_knowledge_get, which cannot open this package');

    // Without ?model= nothing changes but the mark.
    const { body: plain } = await json('/v1/appdev/overview?sections=pitfalls_learned', { headers: { Authorization: `Bearer ${tokenA}` } });
    const plainSlugs = plain.data.pitfalls_learned.items.map((p: any) => String(p.key).split('/').pop());
    assert(['ov-a-warn-goose', 'ov-a-warn-haiku', 'ov-a-crit-kimi', 'ov-b-shared'].every(s => plainSlugs.includes(s)), 'entries missing without ?model=');
    assert(plain.data.pitfalls_learned.items.every((p: any) => p.same_model === undefined), 'same_model marked without a model');

    for (const slug of ['ov-a-warn-goose', 'ov-a-warn-haiku', 'ov-a-crit-kimi', 'ov-a-outdated']) {
        const { status: d } = await json(`/v1/appdev/pitfalls/learned/data/${slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
        assert(d === 200, `cleanup ${slug}: ${d}`);
    }
    for (const slug of ['ov-b-shared', 'ov-b-private']) {
        const { status: d } = await json(`/v1/appdev/pitfalls/learned/data/${slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } });
        assert(d === 200, `cleanup ${slug}: ${d}`);
    }
});

// ── Reporting over REST, and the verification stamp every report and re-check writes ──

await test('learned KB REST: POST reports and stamps verification; PATCH verified re-checks without touching the words', async () => {
    const a = { Authorization: `Bearer ${tokenA}` };
    const body = {
        model: 'Kimi-K2.7-Code', category: 'data', slug: 'rest-report', title: 'Reported over REST',
        symptom: 'a thing a builder observed', resolution: 'the better way to do it', applies_to: ['app'],
    };
    const first = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: a, body: JSON.stringify(body) });
    assert(first.status === 201, `first report ${first.status}: ${JSON.stringify(first.body)}`);
    assert(first.body.data.key === 'packages/appdev-pitfalls/data/rest-report' && first.body.data.visibility === 'owner', `report shape: ${JSON.stringify(first.body.data)}`);
    assert(typeof first.body.data.verified_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(first.body.data.verified_at), 'no verified_at on a report');
    assert(typeof first.body.data.verified_version === 'string' && /^\d+\.\d+\.\d+/.test(first.body.data.verified_version), `verified_version: ${first.body.data.verified_version}`);

    const again = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: a, body: JSON.stringify({ ...body, title: 'Reported over REST, reworded' }) });
    assert(again.status === 200 && again.body.data.updated === true && again.body.data.version === 2, `upsert: ${again.status} ${JSON.stringify(again.body.data)}`);

    const { body: listed } = await json('/v1/appdev/pitfalls/learned?q=rest-report&status=all', { headers: a });
    const rows = listed.data.pitfalls.filter((p: any) => p.slug === 'rest-report');
    assert(rows.length === 1, `one entry expected after two reports, got ${rows.length}`);
    assert(rows[0].title === 'Reported over REST, reworded' && rows[0].model === 'kimi-k2.7-code', `row: ${JSON.stringify(rows[0])}`);
    const wordsUpdated = rows[0].updated;

    await new Promise(r => setTimeout(r, 20));
    const recheck = await json('/v1/appdev/pitfalls/learned/data/rest-report', { method: 'PATCH', headers: a, body: JSON.stringify({ verified: true }) });
    assert(recheck.status === 200, `PATCH verified ${recheck.status}: ${JSON.stringify(recheck.body)}`);
    const p = recheck.body.data.pitfall;
    assert(p.verified_at > again.body.data.verified_at, `re-check did not move verified_at: ${p.verified_at} vs ${again.body.data.verified_at}`);
    assert(p.updated === wordsUpdated, 'a re-check changed the entry\'s updated date, which is about its words');

    const missing = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: a, body: JSON.stringify({ category: 'data', title: 'no model' }) });
    assert(missing.status === 400, `a report without model/symptom/resolution: ${missing.status}`);
    const anon = await json('/v1/appdev/pitfalls/learned', { method: 'POST', body: JSON.stringify(body) });
    assert(anon.status === 401, `anonymous report: ${anon.status}`);

    // B cannot re-check A's entry.
    const bCheck = await json('/v1/appdev/pitfalls/learned/data/rest-report', { method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}` }, body: JSON.stringify({ verified: true }) });
    assert(bCheck.status === 404, `B re-checked A's entry: ${bCheck.status}`);

    const del = await json('/v1/appdev/pitfalls/learned/data/rest-report', { method: 'DELETE', headers: a });
    assert(del.status === 200, `cleanup ${del.status}`);
});

await test('curated registry: every active entry says when it was last checked and on which version', async () => {
    const { status, body } = await json('/v1/appdev/pitfalls?limit=100');
    assert(status === 200, `curated ${status}`);
    const unchecked = body.data.pitfalls.filter((p: any) => !p.verifiedAt || !p.verifiedVersion).map((p: any) => p.id);
    assert(unchecked.length === 0, `curated entries with no verification: ${unchecked.join(', ')}`);
});

await test('templates REST: seed manifest → list/get with source app → cross-owner 404 → DELETE', async () => {
    const manifest = {
        id: 'ui-test-template', title: 'UI test template', description: 'rest surface test',
        derivedFrom: { owner: ownerA, filename: 'overview-demo.html', version: 1, node: 'test' },
        tier: 'T1', tags: ['demo'], reuseNotes: 'the header layout generalizes',
        startMode: 'either', model: 'claude-haiku-4.5', proposedBy: 'ui-e2e',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const { status: ws } = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
            key: 'template.catalog.ui-test-template.manifest',
            value: manifest, visibility: 'private', tags: ['template', 'template-proposal'],
        }),
    });
    assert(ws === 200 || ws === 201, `seed write ${ws}`);

    const { status: ls, body: list } = await json('/v1/appdev/templates', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ls === 200 && list.data.templates.some((t: any) => t.id === 'ui-test-template'), 'template missing from list');

    const { status: gs, body: got } = await json('/v1/appdev/templates/ui-test-template', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(gs === 200, `get ${gs}`);
    assert(got.data.template.tier === 'T1' && got.data.source_app.exists === true, `detail wrong: ${JSON.stringify(got.data.source_app)}`);

    const { status: bg } = await json('/v1/appdev/templates/ui-test-template', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert(bg === 404, `B get expected 404, got ${bg}`);

    // The templates the node ships answer on the same two routes (2026-09-18): this is what the
    // connector's aimeat_app_template_get calls, and the shell every build starts from was not
    // reachable through it. A's proposal stays invisible to B above; a shipped shell is for anyone.
    assert(list.data.node_templates.some((t: any) => t.id === 'shell-pure-client'), 'the list names the shipped shell');
    const { status: ss, body: shell } = await json('/v1/appdev/templates/shell-pure-client', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert(ss === 200 && shell.data.template.source === 'node' && String(shell.data.template.content).includes('<html'), `shipped shell: ${ss}`);
    const { status: ns, body: none } = await json('/v1/appdev/templates/no-such-template', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ns === 404 && String(none.error?.message).includes('shell-pure-client'), `unknown id names the shells: ${ns}`);

    const { status: ds } = await json('/v1/appdev/templates/ui-test-template', { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ds === 200, `delete ${ds}`);
    const { body: after } = await json('/v1/appdev/templates', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(!after.data.templates.some((t: any) => t.id === 'ui-test-template'), 'template survived delete');
});

console.log('\n' + '─'.repeat(40));
console.log(`AppDev overview E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All appdev-overview tests passed!\n');
