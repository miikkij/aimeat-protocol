/**
 * @file e2e-designbook.ts
 * @description E2E tests for the Design Book (TARGET-074 phase 5, slice 1): the earned path
 *   (propose → bench → operator publish), the node-wide id claim, cross-owner adoption through
 *   the app-ui write path, the lifecycle rules, and the →403s that keep authority where it
 *   belongs. The first registered owner IS the node operator (roles ['owner','operator']), which
 *   is exactly the curation model: on a personal node the owner curates their own Book.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=designbook
 * @version-history
 *   v1.0.0 — 2026-08-28 — initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setupOwner(label: string) {
    const name = `db${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Db', password: 'DesignBook1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Db', password: 'DesignBook1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string, roles: (tok.body.data.roles ?? []) as string[] };
}

const APP = (filename: string) => [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-track" content="atelier">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '</head><body><script src="/v1/libs/aimeat-atelier.js"></' + 'script></body></html>',
].join('\n');

const GOOD_BODY = {
    v: 1,
    look: 'editorial',
    blocks: [
        { id: 'top', component: 'hero', props: { title: '<App name>', sub: '<One line on what it is>' } },
        { id: 'items', component: 'list', props: { source: '<prefix>.items' }, span: 'main' },
        { id: 'kpis', component: 'statRow', props: { source: '<prefix>.stats' }, span: 'side' },
    ],
};

(async () => {
    console.log('\n── Design Book: the earned path, the node-wide address, and adoption ──');

    // The FIRST registered owner is the node operator — the curation model itself.
    const op = await setupOwner('op');
    const other = await setupOwner('b');
    const partId = `cover-list-${Date.now() % 100000}`;
    const opApp = `dbop${Date.now()}.html`;
    const otherApp = `dbb${Date.now()}.html`;

    await test('setup: the first owner is the operator, the second is not', async () => {
        assert(op.roles.includes('operator'), `first owner carries operator, got ${JSON.stringify(op.roles)}`);
        assert(!other.roles.includes('operator'), 'second owner must NOT be operator');
    });

    await test('setup: both owners publish an app to adopt into', async () => {
        for (const [o, f] of [[op, opApp], [other, otherApp]] as const) {
            const r = await json('/v1/apps', {
                method: 'POST', headers: auth(o.token),
                body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(APP(f)), name: 'Db', description: 'Design Book test app.' }),
            });
            assert(r.status === 201, `publish ${f}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
    });

    await test('an unauthenticated browse is refused', async () => {
        const { status } = await json('/v1/designbook');
        assert(status === 401, `unauthenticated list is 401, got ${status}`);
    });

    await test('the bench refuses a body the validator refuses, in its words', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: partId, kind: 'layout', title: 'T', summary: 'S', body: { v: 1, blocks: [{ id: 'x', component: 'herro', props: {} }] } } }),
        });
        assert(r.status === 422, `invalid body is 422, got ${r.status}`);
        assert(r.body.error?.code === 'BODY_INVALID', `code BODY_INVALID, got ${r.body.error?.code}`);
        assert(/hero/.test(String(r.body.error?.message)), 'the refusal suggests the nearest real name');
    });

    await test('an unknown kind is refused by name', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: partId, kind: 'component', title: 'T', summary: 'S', body: GOOD_BODY } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'UNKNOWN_KIND', `UNKNOWN_KIND, got ${r.status} ${r.body.error?.code}`);
    });

    await test('a valid proposal lands as proposed (201)', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: partId, kind: 'fill', title: 'Cover + list', summary: 'A cover masthead over a main list with side counts — the starting shape for a browsing app.', body: GOOD_BODY, tags: ['browse'] } }),
        });
        assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.status === 'proposed', `lands proposed, got ${r.body.data.status}`);
        assert(r.body.data.version === 1, `first version is 1, got ${r.body.data.version}`);
    });

    await test('re-proposing your own part updates it in place (200, version 2)', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: partId, kind: 'fill', title: 'Cover + list', summary: 'A cover masthead over a main list with side counts. Second wording.', body: GOOD_BODY, tags: ['browse'] } }),
        });
        assert(r.status === 200 && r.body.data.version === 2, `update is 200 v2, got ${r.status} v${r.body.data?.version}`);
        assert(r.body.data.status === 'proposed', 'status survives the update');
    });

    await test('the id is a node-wide address: another owner is refused with 409', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(other.token),
            body: JSON.stringify({ part: { id: partId, kind: 'fill', title: 'Mine now', summary: 'Trying to take the address.', body: GOOD_BODY } }),
        });
        assert(r.status === 409 && r.body.error?.code === 'ID_TAKEN', `ID_TAKEN 409, got ${r.status} ${r.body.error?.code}`);
    });

    await test('the browse lists it, and the filters narrow it', async () => {
        const all = await json('/v1/designbook', { headers: auth(other.token) });
        assert(all.status === 200 && all.body.data.parts.some((p: any) => p.id === partId), 'listed for everyone');
        const wrongKind = await json('/v1/designbook?kind=layout', { headers: auth(other.token) });
        assert(!wrongKind.body.data.parts.some((p: any) => p.id === partId), 'kind filter excludes a fill');
        const byWord = await json('/v1/designbook?q=masthead', { headers: auth(other.token) });
        assert(byWord.body.data.parts.some((p: any) => p.id === partId), 'a summary word finds it');
    });

    await test('the read answers the part whole, with zero usage', async () => {
        const r = await json(`/v1/designbook/${partId}`, { headers: auth(other.token) });
        assert(r.status === 200, `get ${r.status}`);
        assert(r.body.data.part.body.blocks.length === 3, 'the body rides whole');
        assert(r.body.data.usage === 0, `usage starts at 0, got ${r.body.data.usage}`);
    });

    await test('adopting an unpublished part you did not propose → 403', async () => {
        const r = await json(`/v1/designbook/${partId}/adopt`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(r.status === 403 && r.body.error?.code === 'NOT_PUBLISHED', `NOT_PUBLISHED 403, got ${r.status} ${r.body.error?.code}`);
    });

    await test('the proposer adopts their own proposal — the layout lands via the app-ui path', async () => {
        const r = await json(`/v1/designbook/${partId}/adopt`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ filename: opApp }),
        });
        assert(r.status === 200, `adopt ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const ui = await json(`/v1/apps/${op.name}/${opApp}/ui`);
        assert(ui.status === 200 && ui.body.data.layout?.blocks?.length === 3, 'the app now holds the adopted layout');
    });

    await test('a non-operator cannot publish — 403 with the rule in words', async () => {
        const r = await json(`/v1/designbook/${partId}/status`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ status: 'published' }),
        });
        assert(r.status === 403 && r.body.error?.code === 'NOT_ALLOWED', `NOT_ALLOWED 403, got ${r.status} ${r.body.error?.code}`);
    });

    await test('the operator publishes it', async () => {
        const r = await json(`/v1/designbook/${partId}/status`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }),
        });
        assert(r.status === 200 && r.body.data.status === 'published' && r.body.data.previous === 'proposed',
            `published, got ${r.status} ${JSON.stringify(r.body.data)}`);
    });

    await test('once published, ANOTHER owner adopts it — and the usage counter moves', async () => {
        const r = await json(`/v1/designbook/${partId}/adopt`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(r.status === 200, `cross-owner adopt ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const ui = await json(`/v1/apps/${other.name}/${otherApp}/ui`);
        assert(ui.body.data.layout?.blocks?.length === 3, 'the other owner\'s app holds the layout');
        const g = await json(`/v1/designbook/${partId}`, { headers: auth(other.token) });
        assert(g.body.data.usage === 2, `usage counted both adopts, got ${g.body.data.usage}`);
    });

    await test('adopting into an app you do not own → the app-ui 404 in the Book\'s answer', async () => {
        const r = await json(`/v1/designbook/${partId}/adopt`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: opApp }),
        });
        assert(r.status === 404, `another owner's filename does not resolve under yours, got ${r.status}`);
    });

    await test('a non-proposer cannot retire someone else\'s part', async () => {
        const r = await json(`/v1/designbook/${partId}/status`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ status: 'retired' }),
        });
        assert(r.status === 403, `403, got ${r.status}`);
    });

    await test('discovery surfaces the part as type designbook', async () => {
        const r = await json(`/v1/discover?type=designbook&scope=public&limit=50`, { headers: auth(other.token) });
        assert(r.status === 200, `discover ${r.status}`);
        const hit = (r.body.data.entries ?? r.body.data.results ?? []).find((e: any) => e.id === partId);
        assert(!!hit, `the part appears in /v1/discover, got ${JSON.stringify(r.body.data).slice(0, 200)}`);
    });

    await test('a fresh node\'s Book is never an empty shelf: the six leiskat are seeded published', async () => {
        // Seeding runs non-blocking at boot; by now (owner registration + the suite above) it has
        // had seconds, but poll briefly rather than depend on the race.
        let seeded: any[] = [];
        for (let i = 0; i < 10; i++) {
            const r = await json('/v1/designbook?status=published&q=leiska', { headers: auth(other.token) });
            seeded = (r.body.data?.parts ?? []).filter((p: any) => p.id.startsWith('leiska-'));
            if (seeded.length >= 6) break;
            await new Promise(res => setTimeout(res, 500));
        }
        assert(seeded.length === 6, `six seeded leiskat, got ${seeded.length}`);
        assert(seeded.every((p: any) => p.status === 'published'), 'all seeded parts are published');
    });

    await test('adoption is the heartbeat: adopting an aging part lifts it back to published', async () => {
        const fade = await json('/v1/designbook/leiska-cover/status', {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'aging' }),
        });
        assert(fade.status === 200 && fade.body.data.status === 'aging', `faded, got ${fade.status}`);
        const adopt = await json('/v1/designbook/leiska-cover/adopt', {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(adopt.status === 200, `an aging part is still adoptable, got ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const g = await json('/v1/designbook/leiska-cover', { headers: auth(other.token) });
        assert(g.body.data.part.status === 'published', `one adopt un-fades it, got ${g.body.data.part.status}`);
    });

    await test('the guarantee bench answers its contract: a run with measurements, or the worded unavailable', async () => {
        // On a machine with a browser the bench renders three viewports and stamps the record; on
        // a CI box with none it answers ran:false WITH THE REASON. Both are the contract; a
        // silent 500 or an unstamped "pass" is neither.
        const r = await json('/v1/designbook/leiska-cover/bench', {
            method: 'POST', headers: auth(op.token),
        });
        assert(r.status === 200, `bench ${r.status}: ${JSON.stringify(r.body?.error)}`);
        if (r.body.data.ran === true) {
            assert(Array.isArray(r.body.data.viewports) && r.body.data.viewports.length === 3,
                `three viewports measured, got ${JSON.stringify(r.body.data.viewports)}`);
            const g = await json('/v1/designbook/leiska-cover', { headers: auth(op.token) });
            assert(g.body.data.part.bench.browser?.ran === true, 'the result is stamped on the record');
        } else {
            assert(typeof r.body.data.reason === 'string' && r.body.data.reason.length > 0,
                'an unavailable bench says why');
        }
    });

    await test('the bench is the operator\'s or the proposer\'s — a bystander gets the rule in words', async () => {
        const r = await json('/v1/designbook/leiska-cover/bench', {
            method: 'POST', headers: auth(other.token),
        });
        assert(r.status === 403 && r.body.error?.code === 'NOT_ALLOWED', `403 NOT_ALLOWED, got ${r.status} ${r.body.error?.code}`);
    });

    await test('a look part: the token sheet benches (accent pair through the matrix) and adopt MERGES', async () => {
        // A failing pair refuses at propose with the measured numbers — the same bench a layout's
        // signature runs, so a look that enters the Book is proven readable everywhere.
        const bad = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: 'look-e2e-bad', kind: 'look', title: 'Bad pair', summary: 'The same deep value doubled fails dark derivations.', body: { tokens: { '--ak-accent': '#0e7c66/#0e7c66' } } } }),
        });
        assert(bad.status === 422 && /dark half/.test(String(bad.body.error?.message)),
            `a failing pair refuses with the numbers, got ${bad.status}: ${bad.body.error?.message}`);

        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: 'look-e2e-forest', kind: 'look', title: 'Forest ledger', summary: 'Editorial calm with a proven green/coral signature pair and sharp corners.', body: { look: 'editorial', tokens: { '--ak-accent': '#0e7c66/#e8564a', '--ak-radius': '3px' } }, tags: ['look'] } }),
        });
        assert(r.status === 201, `look propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const g = await json('/v1/designbook/look-e2e-forest', { headers: auth(op.token) });
        assert(g.body.data.part.bench.checks.includes('tokens-valid') && g.body.data.part.bench.checks.includes('contrast-matrix'),
            `the record names the benches that ran, got ${JSON.stringify(g.body.data.part.bench.checks)}`);

        await json('/v1/designbook/look-e2e-forest/status', {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }),
        });
        const adopt = await json('/v1/designbook/look-e2e-forest/adopt', {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(adopt.status === 200, `look adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const ui = await json(`/v1/apps/${other.name}/${otherApp}/ui`);
        assert(ui.body.data.layout?.look === 'editorial', `the look preset landed, got ${ui.body.data.layout?.look}`);
        assert(ui.body.data.layout?.tokens?.['--ak-accent'] === '#0e7c66/#e8564a', 'the pair landed in the tokens');
        assert(Array.isArray(ui.body.data.layout?.blocks) && ui.body.data.layout.blocks.length > 0,
            'the arrangement SURVIVED — a look merges, never replaces');
    });

    await test('a motion part: only motion tokens pass, and the recipe merges beside the look', async () => {
        const wrong = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: 'motion-e2e-bad', kind: 'motion', title: 'Not motion', summary: 'A radius is not motion.', body: { tokens: { '--ak-radius': '3px' } } } }),
        });
        assert(wrong.status === 422 && /motion token/.test(String(wrong.body.error?.message)),
            `a non-motion token refuses naming the vocabulary, got ${wrong.status}: ${wrong.body.error?.message}`);

        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: 'motion-e2e-calm', kind: 'motion', title: 'Calm hand', summary: 'No tilt, short travel, quick transitions — the still-hands recipe.', body: { tokens: { '--ak-motion': '120ms', '--ak-enter-distance': '0px', '--ak-tilt': '0deg' } }, tags: ['motion'] } }),
        });
        assert(r.status === 201, `motion propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        await json('/v1/designbook/motion-e2e-calm/status', {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }),
        });
        const adopt = await json('/v1/designbook/motion-e2e-calm/adopt', {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(adopt.status === 200, `motion adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const ui = await json(`/v1/apps/${other.name}/${otherApp}/ui`);
        assert(ui.body.data.layout?.tokens?.['--ak-motion'] === '120ms', 'the recipe landed');
        assert(ui.body.data.layout?.tokens?.['--ak-accent'] === '#0e7c66/#e8564a',
            'the earlier look\'s pair SURVIVED — recipes season the same sheet');
    });

    await test('an illustration part: art direction as data — adopt writes imagery, the browser bench answers with words', async () => {
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: 'illus-e2e-wash', kind: 'illustration', title: 'Watercolour wash', summary: 'Soft washes on grainy paper, no text in the image.', body: { style: 'soft watercolour wash, grainy paper, no text', palette_words: 'moss, cream, rust' }, tags: ['illustration'] } }),
        });
        assert(r.status === 201, `illustration propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const g = await json('/v1/designbook/illus-e2e-wash', { headers: auth(op.token) });
        assert(g.body.data.part.bench.checks.includes('style-valid'),
            `the record names the style bench, got ${JSON.stringify(g.body.data.part.bench.checks)}`);

        await json('/v1/designbook/illus-e2e-wash/status', {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }),
        });
        const adopt = await json('/v1/designbook/illus-e2e-wash/adopt', {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }),
        });
        assert(adopt.status === 200, `illustration adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const ui = await json(`/v1/apps/${other.name}/${otherApp}/ui`);
        assert(ui.body.data.layout?.imagery?.style === 'soft watercolour wash, grainy paper, no text',
            'the art direction landed on the layout');

        const bench = await json('/v1/designbook/illus-e2e-wash/bench', {
            method: 'POST', headers: auth(op.token),
        });
        assert(bench.status === 200 && bench.body.data.ran === false && /nothing of its own to render/.test(String(bench.body.data.reason)),
            `an illustration bench answers with words, got ${JSON.stringify(bench.body.data)}`);
    });

    await test('seasoning with no dish refuses: adopting a look into an app with no stored arrangement → 409', async () => {
        const bare = 'db-bare.html';
        const pub = await json('/v1/apps', {
            method: 'POST', headers: auth(other.token),
            body: JSON.stringify({ filename: bare, mime_type: 'text/html', content: b64(APP(bare)), name: 'Bare', description: 'No stored layout.' }),
        });
        assert(pub.status === 201, `publish bare app ${pub.status}`);
        const r = await json('/v1/designbook/look-e2e-forest/adopt', {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: bare }),
        });
        assert(r.status === 409 && r.body.error?.code === 'NO_LAYOUT', `NO_LAYOUT 409, got ${r.status} ${r.body.error?.code}`);
    });

    await test('a GENRE part: names a served template, benches as the page, and adopt refuses with the fork address', async () => {
        const good = await json('/v1/designbook', { method: 'POST', headers: auth(other.token), body: JSON.stringify({
            id: 'genre-test-departures', kind: 'genre', title: 'The departure board',
            summary: 'A split-flap hall board — fork it, swap the rows.',
            body: { template: 'genre-departures' }, tags: ['genre'] }) });
        assert(good.status === 201, `a genre part must propose: ${JSON.stringify(good.body)}`);

        const bad = await json('/v1/designbook', { method: 'POST', headers: auth(other.token), body: JSON.stringify({
            id: 'genre-test-bogus', kind: 'genre', title: 'X', summary: 'x',
            body: { template: 'genre-does-not-exist' }, tags: [] }) });
        assert(bad.status === 422 && /genre template/.test(bad.body.error.message),
            `an unknown template refuses by name: ${JSON.stringify(bad.body)}`);

        const adopt = await json('/v1/designbook/genre-test-departures/adopt', { method: 'POST', headers: auth(other.token),
            body: JSON.stringify({ filename: otherApp }) });
        assert(adopt.status === 409 && /forked, not adopted/.test(adopt.body.error.message)
            && /app-templates\/genre-departures/.test(adopt.body.error.message),
            `adopt refuses a genre with the fork address: ${JSON.stringify(adopt.body)}`);
    });

    await test('the operator retires it, and a retired address stays retired', async () => {
        const r = await json(`/v1/designbook/${partId}/status`, {
            method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'retired' }),
        });
        assert(r.status === 200 && r.body.data.status === 'retired', `retired, got ${r.status}`);
        const again = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: partId, kind: 'fill', title: 'Back?', summary: 'No.', body: GOOD_BODY } }),
        });
        assert(again.status === 409 && again.body.error?.code === 'PART_RETIRED', `PART_RETIRED 409, got ${again.status} ${again.body.error?.code}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
})();
