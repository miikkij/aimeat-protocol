/**
 * @file test/e2e-app-ui.ts
 * @description The Atelier mosaic pair end to end (TARGET-074): the catalogue is public and
 *   complete; the validator refuses with words and suggests the nearest real name; the layout is
 *   whole-value, versioned and restorable; reads are as public as the app; writes belong to the
 *   owner and refuse everyone else BY NAME. The refusal cases run first, because a gate that has
 *   never refused has never been tested.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-ui
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setupOwner(label: string) {
    const name = `ui${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ui', password: 'AppUiGate1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ui', password: 'AppUiGate1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

const APP = (filename: string) => [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-track" content="atelier">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '</head><body><script src="/v1/libs/aimeat-atelier.js"></' + 'script></body></html>',
].join('\n');

const GOOD_LAYOUT = {
    v: 1,
    look: 'vivid',
    nav: 'tabs',
    blocks: [
        { id: 'top', component: 'hero', props: { title: 'Errands', sub: 'Kept moving' } },
        { id: 'kpis', component: 'statRow', props: { source: 'errands.stats' } },
        { id: 'items', component: 'list', props: { source: 'errands.item.', emptyTitle: 'No errands yet' } },
    ],
};

(async () => {
    console.log('\n── App UI (mosaic): the catalogue, the validator, and the versioned layout ──');

    const o = await setupOwner('o');
    const other = await setupOwner('x');
    const filename = `mosaic${Date.now()}.html`;

    await test('setup: publish the app the layout will belong to', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({ filename, mime_type: 'text/html', content: b64(APP(filename)), name: 'Mosaic', description: 'Layout test app.' }),
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    // ── The vocabulary ────────────────────────────────────────────────────────────────────────

    await test('the catalogue is public and carries the whole vocabulary', async () => {
        const r = await json('/v1/apps/ui/catalogue');
        assert(r.status === 200, `catalogue ${r.status}`);
        const cat = r.body.data.catalogue;
        const ids = cat.components.map((c: any) => c.id);
        for (const expected of ['hero', 'statRow', 'figure', 'list', 'cardGrid', 'table', 'searchBar', 'tabs', 'section', 'emptyState', 'timeline', 'mediaCard']) {
            assert(ids.includes(expected), `catalogue should carry ${expected} (got: ${ids.join(', ')})`);
        }
        const hero = cat.components.find((c: any) => c.id === 'hero');
        assert(hero.max_per_layout === 1, 'one focal point per layout is part of the vocabulary');
        assert(hero.props.title.required === true, 'a hero without a title is not a hero');
        assert(cat.nav_modes.includes('canvas') && cat.nav_modes.includes('deck'),
            'every navigation mode ships from day one (decided 2026-08-27)');
        assert(cat.looks.includes('vivid') && cat.looks.includes('flat'), 'the looks are part of the vocabulary');
    });

    // ── The validator: refusals with words, and the nearest real name ─────────────────────────

    const validate = (layout: unknown) => json('/v1/apps/ui/validate', {
        method: 'POST', headers: auth(o.token), body: JSON.stringify({ layout }),
    });

    await test('the catalogue carries the layout presets, and EVERY preset validates as-is', async () => {
        const r = await json('/v1/apps/ui/catalogue');
        const presets = r.body.data.catalogue.layouts;
        assert(Array.isArray(presets), 'the catalogue must carry layouts');
        const ids = presets.map((p: any) => p.id);
        for (const expected of ['cover', 'dashboard', 'browse', 'work-queue', 'story-deck', 'guided-flow']) {
            assert(ids.includes(expected), `layouts should carry ${expected} (got: ${ids.join(', ')})`);
        }
        // A preset that stopped validating would be teaching a shape the node refuses — run each
        // through the same dry-run door a builder uses, placeholders unreplaced.
        for (const preset of presets) {
            const v = await validate(preset.layout);
            assert(v.status === 200 && v.body.data.ok === true,
                `preset "${preset.id}" must validate as-is: ${v.body.data.message ?? v.status}`);
        }
    });

    await test('a block span composes the grid — validated, with the nearest name on a typo', async () => {
        const bad = await validate({ v: 1, blocks: [{ id: 'a', component: 'list', props: { source: 'x' }, span: 'mian' }] });
        assert(bad.status === 200 && bad.body.data.ok === false, 'a bad span must refuse');
        assert(bad.body.data.message.includes('Did you mean "main"?'),
            `the refusal must suggest the nearest span: ${bad.body.data.message}`);
        const good = await validate({
            v: 1,
            nav: 'rail',
            blocks: [
                { id: 'a', component: 'list', props: { source: 'x' }, span: 'main' },
                { id: 'b', component: 'timeline', props: { source: 'y' }, span: 'side' },
            ],
        });
        assert(good.status === 200 && good.body.data.ok === true,
            `main+side on the rail must validate: ${JSON.stringify(good.body.data)}`);
    });

    await test('an unknown component is refused with the NEAREST real name suggested', async () => {
        const r = await validate({ v: 1, blocks: [{ id: 'g', component: 'cardgird' }] });
        assert(r.status === 200 && r.body.data.ok === false, `expected an ok:false result, got ${r.status}`);
        assert(r.body.data.message.includes('Did you mean "cardGrid"?'),
            `the refusal must suggest the nearest name: ${r.body.data.message}`);
    });

    await test('an unknown setting is refused naming the block, with the nearest setting suggested', async () => {
        const r = await validate({ v: 1, blocks: [{ id: 'top', component: 'hero', props: { titel: 'Hi' } }] });
        assert(r.body.data.ok === false, 'expected a refusal');
        assert(r.body.data.message.includes('"top"') && r.body.data.message.includes('Did you mean "title"?'),
            `the refusal must name the block and suggest the setting: ${r.body.data.message}`);
    });

    await test('a hero image data: URI is refused with the storage remedy in the answer', async () => {
        const r = await validate({ v: 1, blocks: [{ id: 'top', component: 'hero', props: { title: 'x', image: 'data:image/png;base64,AAAA' } }] });
        assert(r.body.data.ok === false && r.body.data.message.includes('storage'),
            `the refusal must say what to do instead: ${r.body.data.message}`);
    });

    await test('two heroes are refused — two focal points is shouting', async () => {
        const r = await validate({ v: 1, blocks: [
            { id: 'a', component: 'hero', props: { title: 'One' } },
            { id: 'b', component: 'hero', props: { title: 'Two' } },
        ] });
        assert(r.body.data.ok === false && r.body.data.message.includes('at most 1 hero'),
            `expected the hero cap: ${r.body.data.message}`);
    });

    await test('an unknown look is refused with the legal set', async () => {
        const r = await validate({ v: 1, look: 'vivvid', blocks: [] });
        assert(r.body.data.ok === false && r.body.data.message.includes('Did you mean "vivid"?'),
            `expected the nearest look: ${r.body.data.message}`);
    });

    await test('a required setting left out is refused with its description', async () => {
        const r = await validate({ v: 1, blocks: [{ id: 'l', component: 'list' }] });
        assert(r.body.data.ok === false && r.body.data.message.includes('needs "source"'),
            `expected the required-setting refusal: ${r.body.data.message}`);
    });

    // ── The layout: whole-value, versioned, restorable ────────────────────────────────────────

    await test('an app with no stored layout answers source:none, WITH the catalogue', async () => {
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`);
        assert(r.status === 200, `get ${r.status}`);
        assert(r.body.data.layout === null && r.body.data.source === 'none', 'no layout yet');
        assert(Array.isArray(r.body.data.catalogue?.components), 'the read must carry the vocabulary');
    });

    await test('an anonymous write is refused 401', async () => {
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`, { method: 'PUT', body: JSON.stringify({ layout: GOOD_LAYOUT }) });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('another owner is refused 403, and the answer names whose layout it is', async () => {
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`, {
            method: 'PUT', headers: auth(other.token), body: JSON.stringify({ layout: GOOD_LAYOUT }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        assert(r.body.error.message.includes(o.name), `the refusal must name the owner: ${r.body.error.message}`);
    });

    await test('the owner stores a layout, and reads back exactly what was stored', async () => {
        const w = await json(`/v1/apps/${o.name}/${filename}/ui`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify({ layout: GOOD_LAYOUT }),
        });
        assert(w.status === 200, `put ${w.status}: ${JSON.stringify(w.body?.error)}`);
        assert(w.body.data.version === 1 && w.body.data.replaced_version === null, `first write: ${JSON.stringify(w.body.data)}`);
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`);
        assert(r.body.data.source === 'stored' && r.body.data.layout.blocks.length === 3, 'the stored layout reads back');
        assert(r.body.data.layout.blocks[0].component === 'hero', 'order survives');
    });

    await test('an invalid write is refused 422 and leaves the stored layout untouched', async () => {
        const before = await json(`/v1/apps/${o.name}/${filename}/ui`);
        const w = await json(`/v1/apps/${o.name}/${filename}/ui`, {
            method: 'PUT', headers: auth(o.token),
            body: JSON.stringify({ layout: { v: 1, blocks: [{ id: 'z', component: 'nonsense' }] } }),
        });
        assert(w.status === 422, `expected 422, got ${w.status}`);
        const after = await json(`/v1/apps/${o.name}/${filename}/ui`);
        assert(JSON.stringify(after.body.data.layout) === JSON.stringify(before.body.data.layout),
            'a refused write must change nothing');
    });

    await test('a second write replaces whole and reports what it replaced', async () => {
        const changed = { ...GOOD_LAYOUT, nav: 'bottom-bar', blocks: GOOD_LAYOUT.blocks.slice().reverse() };
        const w = await json(`/v1/apps/${o.name}/${filename}/ui`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify({ layout: changed }),
        });
        assert(w.status === 200 && w.body.data.version === 2 && w.body.data.replaced_version === 1,
            `second write: ${JSON.stringify(w.body.data)}`);
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`);
        assert(r.body.data.layout.nav === 'bottom-bar' && r.body.data.layout.blocks[0].component === 'list',
            'the replacement is whole — order and nav both moved');
    });

    await test('the history lists the replaced version, and restore brings it back re-validated', async () => {
        const v = await json(`/v1/apps/${o.name}/${filename}/ui/versions`, { headers: auth(o.token) });
        assert(v.status === 200 && v.body.data.versions.some((x: any) => x.version === 1),
            `history must hold version 1: ${JSON.stringify(v.body.data)}`);
        const rest = await json(`/v1/apps/${o.name}/${filename}/ui/restore`, {
            method: 'POST', headers: auth(o.token), body: JSON.stringify({ version: 1 }),
        });
        assert(rest.status === 200 && rest.body.data.version === 3, `restore: ${JSON.stringify(rest.body.data)}`);
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`);
        assert(r.body.data.layout.blocks[0].component === 'hero', 'version 1 is back, as version 3');
    });

    await test('restoring a version that never existed answers 404 with words', async () => {
        const r = await json(`/v1/apps/${o.name}/${filename}/ui/restore`, {
            method: 'POST', headers: auth(o.token), body: JSON.stringify({ version: 99 }),
        });
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    await test('another owner may READ the layout — an arrangement is as public as the app', async () => {
        const r = await json(`/v1/apps/${o.name}/${filename}/ui`, { headers: auth(other.token) });
        assert(r.status === 200 && r.body.data.source === 'stored', 'public read holds');
    });

    await test("a layout for an app that does not exist answers 404 naming the remedy", async () => {
        const r = await json(`/v1/apps/${o.name}/nosuch.html/ui`);
        assert(r.status === 404 && r.body.error.message.includes('publish first'),
            `the 404 must say what to do: ${JSON.stringify(r.body.error)}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) { console.log('⚠️  Some tests failed!'); process.exit(1); }
    console.log('✅ All tests passed!');
})();
