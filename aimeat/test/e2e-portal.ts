// E2E test for AIMEAT Onboarding Portal
// Run: cd aimeat && npx tsx test/e2e-portal.ts
import { registerOwner } from './helpers/owner-login.js';

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

console.log('\n=== AIMEAT Portal E2E Test ===\n');

// ─── GET /v1/portal — SPA shell ───
await test('GET /v1/portal — returns HTML', async () => {
    const res = await fetch(`${BASE}/v1/portal`);
    assert(res.status === 200, `status ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `content-type: ${ct}`);
    const html = await res.text();
    assert(html.includes('<title>'), 'missing title tag');
    assert(html.includes('AIME'), 'missing AIME in title');
    assert(html.includes('<div id="app"'), 'missing SPA mount point');
});

// ─── The showroom's two companions (2026-08-28): the whole change log and the build story ───
// Each is an SPA route (spa.html ROUTES + routes/portal.ts spaRoutes, or F5 is a 404) and a
// public-page registry entry, which is what puts its title in the head and its address in the
// sitemap. The pricing page left both on the same day.
for (const [path, title] of [['/v1/changelog', 'What shipped here'], ['/v1/how-an-app-builds', 'How an app gets built here'], ['/v1/everything', 'Everything in AIMEAT']]) {
    await test(`GET ${path} — the SPA shell with the page's own title`, async () => {
        const res = await fetch(`${BASE}${path}`);
        assert(res.status === 200, `status ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/html'), 'html');
        const html = await res.text();
        assert(html.includes('<div id="app"'), 'missing SPA mount point');
        assert(html.includes(title), `the registry's title "${title}" is in the head`);
    });
}

// The one gated door in this suite's area: the operator's own front-page template. A stranger and a
// made-up token both get a refusal, never the template. (The pages above are public on purpose.)
await test('GET /v1/site/template — refused without an operator session', async () => {
    const anon = await fetch(`${BASE}/v1/site/template`);
    assert(anon.status === 401 || anon.status === 403, `anonymous: status ${anon.status}`);
    const bogus = await fetch(`${BASE}/v1/site/template`, { headers: { Authorization: 'Bearer not-a-token' } });
    assert(bogus.status === 401 || bogus.status === 403, `bogus token: status ${bogus.status}`);
});

// The operator's template at `/` (2026-11-12). It was sent as stored, so a node whose front page is a
// template had no canonical link, no og:* and no JSON-LD. The head is the node's, the body the
// template's, and removing the template gives the SPA shell back. A second owner cannot store one.
let opToken = '';
let otherToken = '';
await test('The operator template at / carries the node head metadata; a second owner cannot store one', async () => {
    const stamp = Date.now().toString(36);
    const op = await registerOwner(BASE, `portalop${stamp}`);
    assert(op.roles.includes('operator'), `the first owner of the suite is the operator, got ${op.roles.join(',')}`);
    const other = await registerOwner(BASE, `portalother${stamp}`);
    opToken = op.token;
    otherToken = other.token;
    const template = '<!doctype html><html lang="en"><head><title>Alice\'s bakery</title>'
        + '<meta name="description" content="Sourdough from the oven of Alice, baked every Friday morning.">'
        + '</head><body><h1>Alice bakes bread</h1></body></html>';
    const post = (token: string) => fetch(`${BASE}/v1/site/template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template }),
    });
    const refused = await post(other.token);
    assert(refused.status === 403, `a second owner: status ${refused.status}`);
    const stored = await post(op.token);
    assert(stored.status === 200, `the operator: status ${stored.status} ${await stored.text()}`);
    try {
        const refusedDelete = await fetch(`${BASE}/v1/site/template`, { method: 'DELETE', headers: { Authorization: `Bearer ${other.token}` } });
        assert(refusedDelete.status === 403, `a second owner's delete: status ${refusedDelete.status}`);
        const html = await (await fetch(`${BASE}/`, { headers: { Accept: 'text/html' } })).text();
        const head = html.slice(0, html.search(/<\/head\s*>/i));
        const canonical = /<link rel="canonical" href="([^"]+)">/.exec(head)?.[1];
        assert(canonical !== undefined && new URL(canonical).pathname === '/', `canonical: ${canonical}`);
        assert(head.includes('<meta property="og:title" content="Alice&#39;s bakery">'), 'og:title is the template\'s title');
        assert(head.includes('<meta property="og:description" content="Sourdough from the oven of Alice, baked every Friday morning.">'), 'og:description is the template\'s description');
        assert(head.includes(`<meta property="og:url" content="${canonical}">`), 'og:url is the canonical address');
        for (const type of ['SoftwareApplication', 'Organization', 'WebPage']) {
            assert(head.includes(`"@type":"${type}"`), `JSON-LD ${type} is in the head`);
        }
        assert((head.match(/<title>/g) ?? []).length === 1, 'one title');
        assert(html.includes('<h1>Alice bakes bread</h1>'), 'the template body is served');
    } finally {
        const del = await fetch(`${BASE}/v1/site/template`, { method: 'DELETE', headers: { Authorization: `Bearer ${op.token}` } });
        assert(del.status === 200, `delete: status ${del.status}`);
    }
    const back = await (await fetch(`${BASE}/`, { headers: { Accept: 'text/html' } })).text();
    assert(back.includes('<div id="app"') && !back.includes('Alice bakes bread'), 'the SPA shell is back at /');
});

// The template in several languages (2026-11-12): one whole page per language beside the default
// page. Each reader gets one language with one h1, each language has its own address, and every
// page names the others. A version the node could not serve is refused, and so is a second owner.
await test('The operator template has language versions: one page and one address per language', async () => {
    const page = (lang: string, h1: string) => `<!doctype html><html lang="${lang}"><head><title>${h1}</title>`
        + `<meta name="description" content="${h1}, from the oven of Alice every Friday morning."></head><body><h1>${h1}</h1></body></html>`;
    const send = (token: string, body: Record<string, unknown>, query = '') => fetch(`${BASE}/v1/site/template${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const remove = (token: string, query = '') => fetch(`${BASE}/v1/site/template${query}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const read = async (query: string, headers: Record<string, string> = {}) => {
        const res = await fetch(`${BASE}/${query}`, { headers: { Accept: 'text/html', ...headers } });
        const html = await res.text();
        const head = html.slice(0, html.search(/<\/head\s*>/i));
        const canonical = new URL(/<link rel="canonical" href="([^"]+)">/.exec(head)?.[1]?.replace(/&amp;/g, '&') ?? 'http://missing.invalid/none');
        return { res, html, head, canonical };
    };

    const early = await send(opToken, { template: page('en', 'Bread on Fridays'), lang: 'en' });
    assert(early.status === 409 && (await early.json()).error?.code === 'TEMPLATE_DEFAULT_MISSING', `a version before the default page: status ${early.status}`);
    assert((await send(opToken, { template: page('fi', 'Leipää perjantaisin') })).status === 200, 'the default page is stored');
    try {
        assert((await send(otherToken, { template: page('en', 'Bread on Fridays'), lang: 'en' })).status === 403, 'a second owner cannot store a version');
        const mismatch = await send(opToken, { template: page('es', 'Pan los viernes'), lang: 'en' });
        assert(mismatch.status === 422 && (await mismatch.json()).error?.code === 'TEMPLATE_LANG_MISMATCH', `a page in another language: status ${mismatch.status}`);
        const noCode = await send(opToken, { template: page('en', 'Bread on Fridays'), lang: 'english' });
        assert(noCode.status === 422 && (await noCode.json()).error?.code === 'TEMPLATE_LANG_INVALID', `a value that is no code: status ${noCode.status}`);
        // A mistyped code on DELETE is refused; read as "no language" it would delete the whole front page.
        assert((await remove(opToken, '?lang=english')).status === 422, 'DELETE with a value that is no code is refused');
        assert((await read('')).html.includes('<h1>Leipää perjantaisin</h1>'), 'the default page is still served');

        assert((await send(opToken, { template: page('en', 'Bread on Fridays'), lang: 'en' })).status === 200, 'the en version is stored');
        assert((await send(opToken, { template: page('es', 'Pan los viernes') }, '?lang=es')).status === 200, 'the es version is stored by ?lang');
        assert((await remove(otherToken, '?lang=en')).status === 403, 'a second owner cannot delete a version');

        const listing = await (await fetch(`${BASE}/v1/site/template?lang=en`, { headers: { Authorization: `Bearer ${opToken}` } })).json();
        assert(listing.data.lang === 'en' && listing.data.template.includes('Bread on Fridays'), 'GET ?lang=en returns the en version');
        assert(JSON.stringify(listing.data.languages.map((l: { lang: string }) => l.lang)) === '["en","es"]', `languages: ${JSON.stringify(listing.data.languages)}`);
        const meta = await (await fetch(`${BASE}/v1/site`)).json();
        assert(JSON.stringify(meta.data.template_languages) === '["en","es"]', `template_languages: ${JSON.stringify(meta.data.template_languages)}`);

        const en = await read('', { 'Accept-Language': 'en-GB,en;q=0.9' });
        assert((en.html.match(/<h1[\s>]/g) ?? []).length === 1 && en.html.includes('<h1>Bread on Fridays</h1>'), 'an English reader gets the en page, with one h1');
        assert(en.canonical.pathname === '/' && en.canonical.search === '?lang=en', `en canonical: ${en.canonical.href}`);
        assert(en.res.headers.get('content-language') === 'en', `Content-Language: ${en.res.headers.get('content-language')}`);
        assert(/Accept-Language/i.test(en.res.headers.get('vary') ?? '') && /Cookie/i.test(en.res.headers.get('vary') ?? ''), `Vary: ${en.res.headers.get('vary')}`);
        assert(en.head.includes('<meta property="og:title" content="Bread on Fridays">'), 'og:title is the en page\'s title');

        const fi = await read('', { 'Accept-Language': 'en-US,en;q=0.9,fi;q=0.8' });
        assert(fi.html.includes('<h1>Leipää perjantaisin</h1>') && fi.canonical.search === '', 'Finnish anywhere in the list gets the default page at the root address');
        const es = await read('?lang=es', { 'Accept-Language': 'fi' });
        assert(es.html.includes('<h1>Pan los viernes</h1>') && es.canonical.search === '?lang=es', '?lang beats the browser');
        const picked = await read('', { 'Accept-Language': 'fi', Cookie: 'aimeat-lang=en; aimeat-lang-chosen=1' });
        assert(picked.html.includes('<h1>Bread on Fridays</h1>'), 'a language picked on this device beats the browser');
        for (const reply of [en, fi, es]) {
            const langs = [...reply.head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => `${m[1]} ${new URL(m[2]!.replace(/&amp;/g, '&')).search}`);
            assert(JSON.stringify(langs) === '["en ?lang=en","es ?lang=es","fi ","x-default "]', `hreflang: ${JSON.stringify(langs)}`);
        }

        const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
        assert(/<loc>[^<]+\/\?lang=en<\/loc>/.test(xml) && /<loc>[^<]+\/\?lang=es<\/loc>/.test(xml), 'the sitemap lists each language address');
        assert((xml.match(/<xhtml:link rel="alternate" hreflang="x-default"/g) ?? []).length === 3, 'each of the three addresses carries the hreflang set');
        const md = await (await fetch(`${BASE}/?format=md&lang=es`)).text();
        assert(md.includes('Pan los viernes'), 'the markdown of / follows the language');

        assert((await remove(opToken, '?lang=es')).status === 200, 'the es version is deleted');
        assert((await remove(opToken, '?lang=es')).status === 404, 'deleting it again answers 404');
        assert((await read('?lang=es')).html.includes('<h1>Leipää perjantaisin</h1>'), 'a language with no version gets the default page');
    } finally {
        assert((await remove(opToken)).status === 200, 'the whole front page is deleted');
    }
    const after = await (await fetch(`${BASE}/v1/site/template`, { headers: { Authorization: `Bearer ${opToken}` } })).json();
    assert(after.data.template === null && after.data.languages.length === 0, 'deleting the default page deletes its language versions');
    const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
    assert(!xml.includes('?lang=') && !xml.includes('xhtml:link'), 'the sitemap is the page registry again');
});

await test('GET /sitemap.xml — lists the two new pages and not the pricing page', async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    assert(res.status === 200, `status ${res.status}`);
    const xml = await res.text();
    assert(xml.includes('/v1/changelog'), '/v1/changelog is in the sitemap');
    assert(xml.includes('/v1/how-an-app-builds'), '/v1/how-an-app-builds is in the sitemap');
    assert(xml.includes('/v1/everything'), '/v1/everything is in the sitemap');
    assert(!xml.includes('/v1/pricing'), '/v1/pricing has left the sitemap');
});

// Everything in AIMEAT (2026-09-15): the whole feature list, generated from docs/AIMEAT-Feature-List.md.
// The short address redirects, the data the page reads is served with every group, and a row count
// that is not the list's own would be a page claiming what the list does not say.
await test('GET /everything — the short address redirects to the page', async () => {
    const res = await fetch(`${BASE}/everything`, { redirect: 'manual' });
    assert(res.status === 301, `status ${res.status}`);
    assert((res.headers.get('location') ?? '').endsWith('/v1/everything'), `location ${res.headers.get('location')}`);
});

await test('GET /data/everything.json — the list the page reads, every group with rows and the stamp from the source', async () => {
    const res = await fetch(`${BASE}/data/everything.json`);
    assert(res.status === 200, `status ${res.status}`);
    const data = await res.json();
    // The group count follows docs/AIMEAT-Feature-List.md, so it is held against the file's own counts and
    // the meta file, not a literal: a literal 23 went red when the packages section became group 24.
    assert(Array.isArray(data.groups) && data.groups.length === data.counts.groups && data.groups.length >= 20,
        `${data.groups?.length} groups, counts says ${data.counts?.groups}`);
    assert(data.groups.every((g: any) => Array.isArray(g.rows) && g.rows.length > 0), 'every group has rows');
    const rows = data.groups.reduce((s: number, g: any) => s + g.rows.length, 0);
    assert(rows === data.counts.rows && rows > 200, `${rows} rows, counts says ${data.counts.rows}`);
    const meta = await (await fetch(`${BASE}/data/everything-meta.json`)).json();
    assert(meta.rows === rows, `meta says ${meta.rows} rows`);
    assert(meta.groups === data.groups.length, `meta says ${meta.groups} groups`);
    assert(data.stamp === null || (typeof data.stamp.version === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.stamp.date)), 'the stamp is a version and a date, or absent');
});

// ─── GET /v1/portal/platforms — JSON ───
await test('GET /v1/portal/platforms — returns platform list', async () => {
    const res = await fetch(`${BASE}/v1/portal/platforms`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok should be true');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
    assert(Array.isArray(body.data.platforms), 'platforms should be array');
    assert(body.data.platforms.length >= 8, `expected >= 8 platforms, got ${body.data.platforms.length}`);

    const chatgpt = body.data.platforms.find((p: any) => p.id === 'chatgpt');
    assert(chatgpt, 'ChatGPT platform missing');
    assert(chatgpt.variants.length >= 3, `ChatGPT should have >= 3 variants, got ${chatgpt.variants.length}`);

    const claude = body.data.platforms.find((p: any) => p.id === 'claude');
    assert(claude, 'Claude platform missing');
    assert(claude.vendor === 'Anthropic', `Claude vendor: ${claude.vendor}`);
});

// ─── Platform variants have correct structure ───
await test('Platform variants have id, name, tier, path', async () => {
    const res = await fetch(`${BASE}/v1/portal/platforms`);
    const body = await res.json() as any;
    for (const platform of body.data.platforms) {
        for (const variant of platform.variants) {
            assert(typeof variant.id === 'string', `${platform.id}: variant missing id`);
            assert(typeof variant.name === 'string', `${platform.id}: variant missing name`);
            assert(['A', 'B', 'C', 'D'].includes(variant.tier), `${platform.id}/${variant.id}: invalid tier ${variant.tier}`);
            assert(['mcp', 'api', 'browse', 'prompt-package'].includes(variant.path), `${platform.id}/${variant.id}: invalid path ${variant.path}`);
        }
    }
});

// ─── GET /v1/portal/prompt — MCP path ───
await test('GET /v1/portal/prompt/claude-pro — returns MCP instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/claude-pro`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.platform === 'Claude', `platform: ${body.data.platform}`);
    assert(body.data.tier === 'A', `tier: ${body.data.tier}`);
    assert(body.data.path === 'mcp', `path: ${body.data.path}`);
    assert(body.data.prompt.includes('/v1/mcp'), 'MCP prompt should reference /v1/mcp');
});

// ─── GET /v1/portal/prompt — API path ───
await test('GET /v1/portal/prompt/grok-api — returns API instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/grok-api`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'B', `tier: ${body.data.tier}`);
    assert(body.data.path === 'api', `path: ${body.data.path}`);
    // How an AI joins is device authorization, not a registration POST. The prompt was cut to a
    // short pointer on 2026-09-18 because the long one taught a contract that does not exist: it
    // asked the person for their private key and read a field `POST /v1/owners` never returned.
    // This assertion named that dead route, so it is the test's own assumption that expired.
    assert(body.data.prompt.includes('/v1/agents/device-authorize'), 'API prompt should say how an agent joins');
    assert(!/private key/i.test(body.data.prompt), 'the API prompt must never ask for the person\'s key');
});

// ─── GET /v1/portal/prompt — Browse path ───
await test('GET /v1/portal/prompt/chatgpt-free — returns browse instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/chatgpt-free`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'C', `tier: ${body.data.tier}`);
    assert(body.data.path === 'browse', `path: ${body.data.path}`);
    assert(body.data.prompt.includes('/v1/catalogue'), 'Browse prompt should reference catalogue');
});

// ─── GET /v1/portal/prompt — Prompt package path with goal ───
await test('GET /v1/portal/prompt/deepseek-chat?goal=notes — returns prompt package', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/deepseek-chat?goal=notes`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'D', `tier: ${body.data.tier}`);
    assert(body.data.path === 'prompt-package', `path: ${body.data.path}`);
    assert(body.data.goal === 'notes', `goal: ${body.data.goal}`);
    // Same cut, same date: the builder prompt is a pointer at the one maintained specification
    // rather than a second copy of it. The three assertions that used to stand here read the old
    // copy's own words (its title, its Ed25519 signing section, its memory examples), so they
    // asserted that the duplicate still existed. What is worth holding is that the prompt SENDS
    // the builder to the specification and still carries the goal the person picked.
    assert(body.data.prompt.includes('/v1/prompts/build-app'), 'should send the builder to the build specification');
    assert(body.data.prompt.includes('Note-Taking App'), 'should include notes goal description');
    assert(!/private key|owner_key/i.test(body.data.prompt), 'the builder prompt must never ask for the person\'s key');
});

// ─── 404 for unknown platform ───
await test('GET /v1/portal/prompt/nonexistent — returns 404', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/nonexistent-variant`);
    assert(res.status === 404, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === false, 'ok should be false');
    assert(body.error.code === 'NOT_FOUND', `error code: ${body.error?.code}`);
});

// ─── Bootstrap includes portal link ───
await test('GET / — bootstrap hints include portal', async () => {
    const res = await fetch(`${BASE}/?format=json`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    // Portal is referenced in discovery_and_meta.endpoints or as a hint
    const hints = body.hints?.next_actions ?? body.hints;
    const portalHint = Array.isArray(hints) ? hints.find((h: any) => h.url === '/v1/portal') : null;
    assert(portalHint, 'hints should include portal link');
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
