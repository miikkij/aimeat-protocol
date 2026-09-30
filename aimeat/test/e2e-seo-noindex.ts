/**
 * @file e2e-seo-noindex.ts
 * @description E2E for what a search engine is told not to index, read the way Bingbot reads it:
 *   the X-Robots-Tag on a HEAD request and the robots meta inside the document.
 *
 *   Bing judged aimeat.io by the addresses its front page linked to. Five signed-in views answered
 *   with the bare shell titled "AIMEAT", five machine documents had no title at all, the JSON API
 *   was indexable, and an example address written in an inline-script comment
 *   (/v1/apps/.../launch?mode=inline) was requested and answered 403. The front page sat at
 *   "Discovered but not crawled" for five months (2026-09-30).
 *
 *   Four things are proven: (1) every non-HTML response is noindex, except robots.txt, the XML
 *   sitemaps and the IndexNow key file; (2) every signed-in or tool page is noindex and every public
 *   content page is not; (3) the front page's HTML carries no /v1/apps/.../launch address; (4) no
 *   address in sitemap.xml says noindex.
 *
 *   E2E_BASE may point at a live node: run against https://aimeat.io before the deploy, it fails
 *   on every rule; after the deploy it is the production check.
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (wish-bing-noindex-kirjautumissivut-ja-konetiedostot)
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=seo-noindex

const BASE = (process.env.E2E_BASE ?? 'http://localhost:40251').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** The X-Robots-Tag a HEAD request gets, as `curl -sI -A bingbot` sees it. */
async function headTag(path: string): Promise<{ status: number; tag: string; ct: string }> {
    const res = await fetch(`${BASE}${path}`, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'manual' });
    return { status: res.status, tag: res.headers.get('x-robots-tag') ?? '', ct: res.headers.get('content-type') ?? '' };
}

async function getPage(path: string): Promise<{ status: number; tag: string; body: string }> {
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'manual' });
    return { status: res.status, tag: res.headers.get('x-robots-tag') ?? '', body: await res.text() };
}

const metaNoindex = (body: string) => /<meta name="robots" content="[^"]*noindex/i.test(body);

// Point 1: machine documents and API answers.
const MACHINE = [
    '/llms.txt', '/llms-full.txt', '/AGENTS.md', '/sitemap.md', '/v1/spec', '/?format=json',
    '/v1/apps', '/.well-known/api-catalog', '/openapi.json', '/v1/health', '/auth.md',
];
// Point 2: pages behind sign-in, and the tool pages beside them.
const SIGNED_IN = [
    '/v1/admin', '/v1/appcat', '/v1/chat', '/v1/home', '/v1/profile', '/v1/portal?view=dev',
    '/v1/fleet', '/v1/aimeat-os', '/v1/classic', '/v1/portfolio', '/v1/start', '/v1/invite',
    '/v1/app-grant', '/v1/connect-your-ai', '/v1/publicworkspaceviewer', '/v1/publicknowledgeviewer',
    '/v1/design-lab/frame', '/v1/oauth/consent', '/spa.html',
];
const PUBLIC = [
    '/', '/v1/business', '/v1/how-it-works', '/v1/docs', '/v1/help', '/v1/connect', '/v1/glossary',
    '/v1/changelog', '/v1/how-an-app-builds', '/v1/everything', '/v1/app-store', '/v1/members',
    '/v1/transparency', '/v1/privacy', '/v1/terms',
];

(async () => {
    console.log(`\n🔎 Search-engine noindex — ${BASE}\n`);

    for (const path of MACHINE) {
        await test(`${path} (not HTML) says noindex`, async () => {
            const r = await headTag(path);
            assert(!/^text\/html/i.test(r.ct), `answered as HTML (${r.ct}), status ${r.status}`);
            assert(/noindex/i.test(r.tag), `X-Robots-Tag "${r.tag}" (${r.ct}, status ${r.status})`);
        });
    }

    for (const path of ['/robots.txt', '/sitemap.xml', '/sitemap-index.xml']) {
        await test(`${path} carries no X-Robots-Tag`, async () => {
            const r = await headTag(path);
            assert(r.status === 200, `status ${r.status}`);
            assert(r.tag === '', `X-Robots-Tag "${r.tag}"`);
        });
    }

    for (const path of SIGNED_IN) {
        await test(`${path} (not a content page) says noindex`, async () => {
            const r = await headTag(path);
            assert(/noindex/i.test(r.tag), `X-Robots-Tag "${r.tag}" (status ${r.status})`);
            assert(!/nofollow/i.test(r.tag), `"${r.tag}" also refuses the links`);
        });
    }

    await test('a signed-in view carries the robots meta in its document too', async () => {
        for (const path of ['/v1/admin', '/v1/home', '/v1/chat', '/v1/profile', '/v1/appcat']) {
            const r = await getPage(path);
            assert(metaNoindex(r.body), `${path}: no <meta name="robots" content="noindex…">`);
        }
    });

    for (const path of PUBLIC) {
        await test(`${path} (public content page) stays indexable`, async () => {
            const r = await getPage(path);
            assert(r.status === 200, `status ${r.status}`);
            assert(!/noindex/i.test(r.tag), `X-Robots-Tag "${r.tag}"`);
            assert(!metaNoindex(r.body), 'the document says noindex');
        });
    }

    // Point 3.
    await test('the front page HTML carries no /v1/apps/.../launch address', async () => {
        const r = await getPage('/');
        assert(r.status === 200, `status ${r.status}`);
        assert(!r.body.includes('/v1/apps/.../launch'), 'the literal example address is still in the HTML');
        assert(!r.body.includes('href="${'), 'an unrendered template address is in the HTML');
    });

    // Point 4.
    await test('no address in sitemap.xml says noindex', async () => {
        const xml = (await getPage('/sitemap.xml')).body;
        const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
        assert(locs.length > 0, 'sitemap.xml lists nothing');
        const bad: string[] = [];
        for (const path of locs) {
            const r = await getPage(path);
            if (r.status !== 200 || /noindex/i.test(r.tag) || metaNoindex(r.body)) bad.push(`${path} (${r.status}, "${r.tag}")`);
        }
        assert(bad.length === 0, `noindex or unreachable: ${bad.join(', ')}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
