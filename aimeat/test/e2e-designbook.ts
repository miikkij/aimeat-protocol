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
 *   v1.3.0 — 2026-09-05 — The EFFECT kind (wish-atelier-post-process-effects): the worded
 *     refusals (an unknown effect with the nearest named, a target outside the three, a picture
 *     effect on the bare hero band, living motion on a figure, a block effect as a layer pass, a
 *     knob outside its bounds), a part landing with its bench named and its target defaulted from
 *     the registry, the operator's publish and another owner's adopt landing on the hero block
 *     and, as a pass, on the arrangement's ambient, the two no-target refusals, the preview with
 *     a Play control for a moment, and nine seeded effects; nine seeded ambients (plasma, lava,
 *     tunnel join the shelf).
 *   v1.2.1 — 2026-09-05 — The APP fixture names a register (genre-nightfloor): an Atelier app
 *     without one is refused at publish now, and this suite is about the Book, not the gate.
 *   v1.2.0 — 2026-09-05 — The AMBIENT kind (wish-atelier-ambient-visuals): the worded refusals
 *     (an unknown preset with the six named, a number outside the bounds, "none", a field too
 *     loud for a palette-page look), a proven combination landing with its benches named, the
 *     kind filter, the operator's publish, another owner's adopt MERGING the layer beside the
 *     look and the earlier tokens, a loud part refused at adopt on the destination look, the
 *     no-arrangement 409 with the way out, the preview with the layer riding the layout, the six
 *     seeded presets, discovery, and the browser bench carrying the layer counts.
 *   v1.1.1 — 2026-09-02 — The preview's img-src is asserted to be the app policy (it was the
 *     SPA's 'self', which blocked every apex illustration once the gallery framed it from an
 *     app origin). Failed on the old route first.
 *   v1.1.0 — 2026-08-30 — The preview route joins the contract: a published part renders as a
 *     page (kit + body), an illustration as its words, a genre as its template's own document,
 *     an unknown address as 404.
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
    '<meta name="aimeat-register" content="genre-nightfloor">',
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

    await test('the published shelf is public: an unauthenticated browse answers, published parts only', async () => {
        const r = await json('/v1/designbook');
        assert(r.status === 200, `unauthenticated list is 200, got ${r.status}`);
        const parts = r.body?.data?.parts ?? [];
        assert(parts.every((p: any) => p.status === 'published'),
            `an anonymous reader sees only published parts — found: ${[...new Set(parts.map((p: any) => p.status))].join(', ')}`);
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

    await test('a part still in proposal is invisible without a session: anonymous read answers 404', async () => {
        const anon = await json(`/v1/designbook/${partId}`);
        assert(anon.status === 404, `an anonymous read of a proposed part is 404, got ${anon.status}`);
        const signed = await json(`/v1/designbook/${partId}`, { headers: auth(op.token) });
        assert(signed.status === 200, `the signed-in read still answers, got ${signed.status}`);
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

    await test('the preview renders the part as a page: sessionless, text/html, the kit and the body in it', async () => {
        const res = await fetch(`${BASE}/v1/designbook/${partId}/preview`);
        assert(res.status === 200, `preview is 200, got ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/html'), 'preview answers text/html');
        // Framed from an app origin, 'self' is the subdomain: the pictures must follow the app policy.
        const csp = res.headers.get('content-security-policy') ?? '';
        assert(/img-src \* data: blob:/.test(csp), `preview img-src is the app policy, got: ${csp.match(/img-src [^;]*/)?.[0]}`);
        assert(/script-src 'self' 'nonce-/.test(csp), 'preview scripts keep the nonce rule');
        const page = await res.text();
        assert(page.includes('aimeat-atelier'), 'the page loads the kit');
        assert(page.includes('"component":"hero"'), 'the page carries the part\'s own blocks');
    });

    await test('a preview of nothing is a 404 with the Book\'s words', async () => {
        const r = await json('/v1/designbook/no-such-part-ever/preview');
        assert(r.status === 404, `unknown id is 404, got ${r.status}`);
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

    await test('an illustration previews as its words: the style sentence and the palette, set as a page', async () => {
        const res = await fetch(`${BASE}/v1/designbook/illus-e2e-wash/preview`);
        assert(res.status === 200, `illustration preview is 200, got ${res.status}`);
        const page = await res.text();
        assert(page.includes('soft watercolour wash, grainy paper, no text'), 'the style sentence is on the page');
        assert(page.includes('moss') && page.includes('rust'), 'the palette words are on the page');
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

        // A genre previews as the page it IS: the template's own document, not the demo frame.
        const prev = await fetch(`${BASE}/v1/designbook/genre-test-departures/preview`);
        assert(prev.status === 200, `genre preview is 200, got ${prev.status}`);
        const page = await prev.text();
        assert(/<!DOCTYPE html>/i.test(page) && !page.includes('demoFor('), 'a genre serves its template page, not the demo frame');
    });

    // ── The AMBIENT kind: the one layer allowed to move at idle, proven on a look ──────────────
    const ambientId = `ambient-e2e-${Date.now() % 100000}`;
    const proposeAmbient = (body: any, id = ambientId) => json('/v1/designbook', {
        method: 'POST', headers: auth(other.token),
        body: JSON.stringify({ part: { id, kind: 'ambient', title: 'The wave, tuned', summary: 'The PlayStation wave on the stage look, a little quieter and slower.', body, tags: ['ambient'] } }),
    });

    await test('an AMBIENT part refuses with words: an unknown preset (the six named), a number outside the bounds, "none", a field too loud for its look', async () => {
        const unknown = await proposeAmbient({ ambient: 'wavez' });
        assert(unknown.status === 422 && /Did you mean "waves"/.test(unknown.body.error.message) && /ink/.test(unknown.body.error.message),
            `an unknown preset names the six and suggests the nearest: ${JSON.stringify(unknown.body)}`);
        const alpha = await proposeAmbient({ ambient: 'waves', alpha: 1.5 });
        assert(alpha.status === 422 && /alpha/.test(alpha.body.error.message), `an alpha outside 0..1 refuses: ${JSON.stringify(alpha.body)}`);
        const speed = await proposeAmbient({ ambient: 'waves', speed: 0.1 });
        assert(speed.status === 422 && /speed/.test(speed.body.error.message), `a speed outside the bounds refuses: ${JSON.stringify(speed.body)}`);
        const none = await proposeAmbient({ ambient: 'none' });
        assert(none.status === 422 && /arrangement's choice/.test(none.body.error.message), `"none" is not a part: ${JSON.stringify(none.body)}`);
        const loud = await proposeAmbient({ ambient: 'waves', alpha: 0.9, look: 'editorial' });
        assert(loud.status === 422 && /contrast matrix/.test(loud.body.error.message) && /whisper/.test(loud.body.error.message),
            `a field louder than the whisper on a look that stands on the palette page refuses with the numbers: ${JSON.stringify(loud.body)}`);
        const noLook = await proposeAmbient({ ambient: 'dust', look: 'nightclub' });
        assert(noLook.status === 422 && /not a look this node ships/.test(noLook.body.error.message), `an unknown look refuses by name: ${JSON.stringify(noLook.body)}`);
    });

    await test('an AMBIENT part lands proven: the benches named, the body whole, invisible anonymous, found by ?kind', async () => {
        const r = await proposeAmbient({ ambient: 'waves', alpha: 0.2, speed: 0.75, look: 'stage', tokens: { '--ak-radius-sm': '2px' } });
        assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const g = await json(`/v1/designbook/${ambientId}`, { headers: auth(other.token) });
        assert(g.status === 200, `get ${g.status}`);
        const checks = g.body.data.part.bench.checks;
        assert(checks.includes('ambient-valid') && checks.includes('contrast-matrix') && checks.includes('tokens-valid'),
            `the record says which benches ran: ${checks.join(', ')}`);
        const body = g.body.data.part.body;
        assert(body.ambient === 'waves' && body.alpha === 0.2 && body.speed === 0.75 && body.look === 'stage' && body.tokens['--ak-radius-sm'] === '2px',
            `the body survives whole: ${JSON.stringify(body)}`);
        const anon = await json(`/v1/designbook/${ambientId}`);
        assert(anon.status === 404, `a proposal is invisible without a session, got ${anon.status}`);
        const byKind = await json('/v1/designbook?kind=ambient&limit=200', { headers: auth(other.token) });
        assert(byKind.body.data.parts.some((p: any) => p.id === ambientId), '?kind=ambient lists it');
        const byLook = await json('/v1/designbook?kind=look&limit=200', { headers: auth(other.token) });
        assert(!byLook.body.data.parts.some((p: any) => p.id === ambientId), '?kind=look does not');
    });

    await test('an AMBIENT part: the operator publishes, another owner adopts — the layer MERGES, the look and the earlier tokens survive', async () => {
        const pub = await json(`/v1/designbook/${ambientId}/status`, { method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }) });
        assert(pub.status === 200, `publish ${pub.status}`);
        const before = await json(`/v1/apps/${other.name}/${otherApp}/ui`);
        const adopt = await json(`/v1/designbook/${ambientId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }) });
        assert(adopt.status === 200 && adopt.body.data.kind === 'ambient', `adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const layout = (await json(`/v1/apps/${other.name}/${otherApp}/ui`)).body.data.layout;
        assert(JSON.stringify(layout.ambient) === JSON.stringify({ preset: 'waves', alpha: 0.2, speed: 0.75 }),
            `the layer lands as the arrangement's ambient: ${JSON.stringify(layout.ambient)}`);
        assert(Array.isArray(layout.blocks) && layout.blocks.length > 0, 'the arrangement SURVIVED — an ambient merges, never replaces');
        assert(layout.look === before.body.data.layout.look && layout.look === 'editorial', `the app's own look survives (${layout.look})`);
        assert(layout.tokens?.['--ak-accent'] === '#0e7c66/#e8564a', 'the earlier look\'s pair SURVIVED');
        assert(layout.tokens?.['--ak-radius-sm'] === '2px', 'the part\'s own token merged in');
        const anon = await json(`/v1/designbook/${ambientId}`);
        assert(anon.status === 200 && typeof anon.body.data.part.published_at === 'string', `published: anonymous read answers ${anon.status}`);
        const row = (await json('/v1/designbook?kind=ambient&limit=200')).body.data.parts.find((p: any) => p.id === ambientId);
        assert(row && typeof row.published_at === 'string', 'a published row says when');
    });

    await test('an AMBIENT part proven loud on a world is re-proven on the destination look at adopt, and refuses with the numbers', async () => {
        const loudId = `${ambientId}-loud`;
        const r = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: loudId, kind: 'ambient', title: 'The wave, loud', summary: 'The wave at eight tenths on lounge, which owns its night.', body: { ambient: 'waves', alpha: 0.8, look: 'lounge' }, tags: ['ambient'] } }),
        });
        assert(r.status === 201, `a loud wave on lounge is proven at propose: ${JSON.stringify(r.body?.error)}`);
        await json(`/v1/designbook/${loudId}/status`, { method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }) });
        const adopt = await json(`/v1/designbook/${loudId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }) });
        assert(adopt.status === 422 && /contrast matrix/.test(String(adopt.body.error?.message)),
            `on an editorial app the same part is a stain, and the adopt says so with the numbers: ${adopt.status} ${JSON.stringify(adopt.body?.error)}`);
        const layout = (await json(`/v1/apps/${other.name}/${otherApp}/ui`)).body.data.layout;
        assert(layout.ambient?.alpha === 0.2, 'the refused adopt wrote nothing');
    });

    await test('an AMBIENT part: adopting into an app with no stored arrangement → 409 NO_LAYOUT, with the app-code way out', async () => {
        const r = await json(`/v1/designbook/${ambientId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: 'db-bare.html' }) });
        assert(r.status === 409 && r.body.error?.code === 'NO_LAYOUT' && /app\(\{ ambient/.test(r.body.error.message),
            `NO_LAYOUT with the way out: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('an AMBIENT part previews as the demo arrangement with the layer riding the layout, on the part\'s look', async () => {
        const res = await fetch(`${BASE}/v1/designbook/${ambientId}/preview`);
        assert(res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/html'), `preview ${res.status}`);
        const page = await res.text();
        assert(page.includes('aimeat-atelier'), 'the kit is on the page');
        assert(/"ambient":\{"preset":"waves"/.test(page), 'the layer rides the layout the mosaic mounts');
        assert(/"component":"hero"/.test(page) && /"look":"stage"/.test(page), 'the demo arrangement, on the part\'s own look');
    });

    await test('a fresh node\'s AMBIENT shelf is never empty: the nine presets are seeded published, each on the look it fits', async () => {
        let seeded: any[] = [];
        for (let i = 0; i < 10; i++) {
            const r = await json('/v1/designbook?status=published&kind=ambient&limit=200', { headers: auth(other.token) });
            seeded = (r.body.data?.parts ?? []).filter((p: any) => p.id.startsWith('ambient-') && p.tags.includes('seed'));
            if (seeded.length >= 9) break;
            await new Promise(res => setTimeout(res, 500));
        }
        assert(seeded.length === 9, `nine seeded ambients, got ${seeded.length}: ${seeded.map((p: any) => p.id).join(', ')}`);
        for (const g of ['plasma', 'lava', 'tunnel']) assert(seeded.some((p: any) => p.id === `ambient-${g}`), `the ${g} generator is on the shelf`);
        assert(seeded.every((p: any) => typeof p.published_at === 'string'), 'every seeded row says when it was published');
        const w = await json('/v1/designbook/ambient-waves');
        assert(w.status === 200 && w.body.data.part.body.ambient === 'waves' && w.body.data.part.body.look === 'lounge' && w.body.data.part.body.alpha === 0.8,
            `ambient-waves is the wave on lounge at eight tenths: ${JSON.stringify(w.body.data?.part?.body)}`);
    });

    // ── The EFFECT kind: a post-process filter, proven where it lands ──────────────────────────
    const effectId = `effect-e2e-${Date.now() % 100000}`;
    const proposeEffect = (body: any, id = effectId, token = other.token) => json('/v1/designbook', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ part: { id, kind: 'effect', title: 'The glitch, hard', summary: 'A hard tear on the hero band of a broadcast page.', body, tags: ['effect'] } }),
    });

    await test('an EFFECT part refuses with words: an unknown effect (the nearest named), a target that is none of the three, a picture effect on a hero without a picture, living motion on a figure, a block effect as a layer pass, a knob outside its bounds', async () => {
        const unknown = await proposeEffect({ effect: 'vignete' });
        assert(unknown.status === 422 && /Did you mean "vignette"/.test(unknown.body.error.message), `an unknown effect suggests the nearest: ${JSON.stringify(unknown.body)}`);
        const frame = await proposeEffect({ effect: 'vignette', on: 'frame' });
        assert(frame.status === 422 && /hero, figure, layer/.test(frame.body.error.message) && /frame/.test(frame.body.error.message),
            `a target outside the three refuses naming them: ${JSON.stringify(frame.body)}`);
        const bare = await proposeEffect({ effect: 'duotone', on: 'hero' });
        assert(bare.status === 422 && /image/.test(bare.body.error.message), `a picture effect on the bare hero band refuses: ${JSON.stringify(bare.body)}`);
        const living = await proposeEffect({ effect: 'kaleidoscope', on: 'figure' });
        assert(living.status === 422 && /ambient\.post/.test(living.body.error.message), `living motion on a figure is pointed at the layer: ${JSON.stringify(living.body)}`);
        const block = await proposeEffect({ effect: 'vignette', on: 'layer' });
        assert(block.status === 422 && /lands on a block/.test(block.body.error.message), `a block effect as a layer pass is pointed back: ${JSON.stringify(block.body)}`);
        const knob = await proposeEffect({ effect: 'glitch', params: { strength: 4 } });
        assert(knob.status === 422 && /from 0 to 1/.test(knob.body.error.message), `a knob outside its bounds refuses with the bounds: ${JSON.stringify(knob.body)}`);
    });

    await test('an EFFECT part lands proven: the bench named, the target defaulted from the registry, the body whole, found by ?kind', async () => {
        const r = await proposeEffect({ effect: 'glitch', params: { strength: 0.8 }, look: 'broadcast' });
        assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const g = await json(`/v1/designbook/${effectId}`, { headers: auth(other.token) });
        assert(g.status === 200, `get ${g.status}`);
        assert(g.body.data.part.bench.checks.includes('effect-valid'), `the record says which bench ran: ${g.body.data.part.bench.checks.join(', ')}`);
        const body = g.body.data.part.body;
        assert(body.effect === 'glitch' && body.on === 'hero' && body.params.strength === 0.8 && body.look === 'broadcast',
            `the body survives whole and the target defaulted to the band: ${JSON.stringify(body)}`);
        const byKind = await json('/v1/designbook?kind=effect&limit=200', { headers: auth(other.token) });
        assert(byKind.body.data.parts.some((p: any) => p.id === effectId), '?kind=effect lists it');
    });

    await test('an EFFECT part: the operator publishes, another owner adopts — it lands on the hero block, the rest of the arrangement survives; a layer pass lands on the ambient', async () => {
        const pub = await json(`/v1/designbook/${effectId}/status`, { method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }) });
        assert(pub.status === 200, `publish ${pub.status}`);
        const adopt = await json(`/v1/designbook/${effectId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }) });
        assert(adopt.status === 200 && adopt.body.data.kind === 'effect', `adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
        const layout = (await json(`/v1/apps/${other.name}/${otherApp}/ui`)).body.data.layout;
        const hero = layout.blocks.find((b: any) => b.component === 'hero');
        assert(JSON.stringify(hero?.effect) === JSON.stringify({ id: 'glitch', params: { strength: 0.8 } }), `the effect wears on the hero block: ${JSON.stringify(hero)}`);
        assert(layout.blocks.length === 3 && layout.ambient?.preset === 'waves' && layout.look === 'editorial', 'the arrangement, its ambient and its look survived');
        // A pass over the layer lands on the arrangement's ambient, the newest two kept.
        const layerId = `${effectId}-layer`;
        const lr = await proposeEffect({ effect: 'kaleidoscope', on: 'layer', look: 'lounge' }, layerId, op.token);
        assert(lr.status === 201, `a layer pass proposes: ${JSON.stringify(lr.body?.error)}`);
        await json(`/v1/designbook/${layerId}/status`, { method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'published' }) });
        const la = await json(`/v1/designbook/${layerId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }) });
        assert(la.status === 200, `adopt the pass ${la.status}: ${JSON.stringify(la.body?.error)}`);
        const after = (await json(`/v1/apps/${other.name}/${otherApp}/ui`)).body.data.layout;
        assert(after.ambient?.preset === 'waves' && after.ambient?.alpha === 0.2 && after.ambient?.speed === 0.75
            && JSON.stringify(after.ambient?.post) === JSON.stringify(['kaleidoscope']),
        `the pass rides the arrangement's ambient, the preset and its numbers untouched: ${JSON.stringify(after.ambient)}`);
        // No target: a figure effect into an arrangement with no figure, a pass into an app with no layer.
        const fig = await json('/v1/designbook/effect-vignette/adopt', { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: otherApp }) });
        assert(fig.status === 409 && fig.body.error?.code === 'NO_TARGET' && /no figure block/.test(fig.body.error.message),
            `a figure effect with no figure to land on refuses with words: ${fig.status} ${JSON.stringify(fig.body?.error)}`);
        const bareApp = await json(`/v1/designbook/${layerId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: 'db-bare.html' }) });
        assert(bareApp.status === 409 && bareApp.body.error?.code === 'NO_LAYOUT' && /atelier\.fx/.test(bareApp.body.error.message),
            `NO_LAYOUT with the app-code way out: ${bareApp.status} ${JSON.stringify(bareApp.body?.error)}`);
    });

    await test('an EFFECT part previews as the demo arrangement wearing it where it lands: a moment gets a Play control, a pass rides the layer', async () => {
        const res = await fetch(`${BASE}/v1/designbook/${effectId}/preview`);
        assert(res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/html'), `preview ${res.status}`);
        const page = await res.text();
        assert(/"component":"hero"[^}]*\}[^}]*"effect":\{"id":"glitch"/.test(page) || /"effect":\{"id":"glitch","params":\{"strength":0\.8\}\}/.test(page), 'the hero block wears the effect');
        assert(/"component":"figure"/.test(page) && /"look":"broadcast"/.test(page), 'the demo arrangement carries a figure, on the part\'s own look');
        assert(/data-ak-fx-play/.test(page), 'a moment gets a real Play control in the frame');
        const layerPage = await (await fetch(`${BASE}/v1/designbook/${effectId}-layer/preview`)).text();
        assert(/"post":\[\{"id":"kaleidoscope"\}\]/.test(layerPage) && /"preset":"waves"/.test(layerPage), `a pass rides the look's own ambient: ${layerPage.match(/"ambient":\{[^}]*\}/)?.[0]}`);
    });

    await test('a fresh node\'s EFFECTS shelf is never empty: the nine effects are seeded published, each where the registry says it lands', async () => {
        let seeded: any[] = [];
        for (let i = 0; i < 10; i++) {
            const r = await json('/v1/designbook?status=published&kind=effect&limit=200', { headers: auth(other.token) });
            seeded = (r.body.data?.parts ?? []).filter((p: any) => p.id.startsWith('effect-') && p.tags.includes('seed'));
            if (seeded.length >= 9) break;
            await new Promise(res => setTimeout(res, 500));
        }
        assert(seeded.length === 9, `nine seeded effects, got ${seeded.length}: ${seeded.map((p: any) => p.id).join(', ')}`);
        const v = await json('/v1/designbook/effect-vignette');
        assert(v.status === 200 && v.body.data.part.body.on === 'figure' && v.body.data.part.body.look === 'gallery', `the vignette lands on the figure on gallery: ${JSON.stringify(v.body.data.part.body)}`);
        const k = await json('/v1/designbook/effect-kaleidoscope');
        assert(k.status === 200 && k.body.data.part.body.on === 'layer', `the kaleidoscope lands on the layer: ${JSON.stringify(k.body.data.part.body)}`);
        const g = await json('/v1/designbook/effect-glitch');
        assert(g.status === 200 && g.body.data.part.body.on === 'hero', `the glitch lands on the band: ${JSON.stringify(g.body.data.part.body)}`);
    });

    await test('discovery surfaces an ambient part with its kind as the segment', async () => {
        const r = await json('/v1/discover?type=designbook&scope=public&limit=200', { headers: auth(other.token) });
        assert(r.status === 200, `discover ${r.status}`);
        const hit = (r.body.data.entries ?? r.body.data.results ?? []).find((e: any) => e.id === ambientId);
        assert(!!hit, `the ambient part appears in /v1/discover, got ${JSON.stringify(r.body.data).slice(0, 200)}`);
        assert(hit.segment === undefined || hit.segment === 'ambient', `its segment is its kind, got ${hit.segment}`);
    });

    await test('the browser bench on an AMBIENT part carries the layer counts at every viewport, or the worded unavailable', async () => {
        const r = await json(`/v1/designbook/${ambientId}/bench`, { method: 'POST', headers: auth(op.token) });
        assert(r.status === 200, `bench ${r.status}: ${JSON.stringify(r.body?.error)}`);
        if (r.body.data.ran === true) {
            const vps = r.body.data.viewports;
            assert(Array.isArray(vps) && vps.length === 3 && vps.every((v: any) => typeof v.ambient_layers === 'number' && typeof v.ambient_painted === 'number'),
                `the counts ride every viewport: ${JSON.stringify(vps)}`);
            // Measured, never asserted in the guard tier (a slow box would flake it): what painted.
            console.log(`     ambient bench: ${vps.map((v: any) => `${v.viewport} layers=${v.ambient_layers} painted=${v.ambient_painted}`).join(' · ')} passed=${r.body.data.passed}`);
        } else {
            assert(typeof r.body.data.reason === 'string' && r.body.data.reason.length > 0, 'an unavailable bench says why');
        }
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

    await test('delete refuses an adopted part with PART_IN_USE — its address must keep meaning something', async () => {
        const r = await json(`/v1/designbook/${partId}`, { method: 'DELETE', headers: auth(op.token) });
        assert(r.status === 409 && r.body.error?.code === 'PART_IN_USE',
            `PART_IN_USE 409, got ${r.status} ${r.body.error?.code}: ${r.body.error?.message}`);
    });

    await test('junk with zero adoptions is DELETED whole: gone from the list, gone from GET', async () => {
        const junkId = `junk-${Date.now()}`;
        const prop = await json('/v1/designbook', {
            method: 'POST', headers: auth(op.token),
            body: JSON.stringify({ part: { id: junkId, kind: 'fill', title: 'Junk', summary: 'A mistake, caught.', body: GOOD_BODY } }),
        });
        assert(prop.status === 201, `propose junk ${prop.status}`);
        const bystander = await json(`/v1/designbook/${junkId}`, { method: 'DELETE', headers: auth(other.token) });
        assert(bystander.status === 403, `a bystander cannot delete someone else's part, got ${bystander.status}`);
        const del = await json(`/v1/designbook/${junkId}`, { method: 'DELETE', headers: auth(op.token) });
        assert(del.status === 200 && del.body.data.deleted === true, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
        const read = await json(`/v1/designbook/${junkId}`, { headers: auth(op.token) });
        assert(read.status === 404, `deleted means gone: GET is 404, got ${read.status}`);
        const browse = await json('/v1/designbook?limit=200', { headers: auth(op.token) });
        assert(!browse.body.data.parts.some((p: any) => p.id === junkId), 'deleted means gone from the browse too');
    });

    await test('dead is invisible: a retired part leaves the default browse, and only ?status=retired shows the graveyard', async () => {
        const browse = await json('/v1/designbook?limit=200', { headers: auth(op.token) });
        assert(browse.status === 200, `browse ${browse.status}`);
        assert(!browse.body.data.parts.some((p: any) => p.id === partId),
            'a retired part must not appear in the default listing, signed in or not');
        const graveyard = await json('/v1/designbook?status=retired&limit=200', { headers: auth(op.token) });
        assert(graveyard.body.data.parts.some((p: any) => p.id === partId),
            'asking for status=retired by name still finds it');
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
})();
