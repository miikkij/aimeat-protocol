/**
 * @file e2e-agent-readiness.ts
 * @description E2E for the node's agent-readability surfaces — the documents an AI agent or an
 *   agent-readability scanner fetches before it fetches anything else. Covers sitemap.xml: that it
 *   is valid XML built from the shared public-page registry, that every URL in it is a page the
 *   node actually serves as HTML, and that no API endpoint is advertised there as if it were an
 *   indexable page. A sitemap listing /v1/spec (YAML) or /v1/health (JSON) invites HTML checks
 *   those endpoints can never satisfy, which is exactly what it used to do.
 *
 *   The suite grows with the programme in docs/internal/agentscanner/ — sitemap.md, AGENTS.md,
 *   llms.txt structure and llms-full.txt land here as their phases ship.
 * @version-history
 *   v0.1.0 — 2026-07-28 — Phase 02: sitemap.xml from the public-page registry
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-readiness

import { PUBLIC_PAGES, sitemapPages } from '../src/data/public-pages.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function text(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, { headers });
    return { status: res.status, ct: res.headers.get('content-type') ?? '', body: await res.text() };
}

/** Every <loc> in a sitemap, in document order. */
function locs(xml: string): string[] {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

(async () => {
    console.log('\n🔎 Agent readiness — discovery documents\n');

    const map = await text('/sitemap.xml');

    await test('sitemap.xml is served as XML', async () => {
        assert(map.status === 200, `status ${map.status}`);
        assert(map.ct.includes('xml'), `content-type ${map.ct}`);
        assert(map.body.startsWith('<?xml'), 'missing XML declaration');
        assert(map.body.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'missing urlset namespace');
    });

    await test('sitemap.xml lists exactly the live registry pages', async () => {
        const expected = sitemapPages().map(p => p.path);
        const actual = locs(map.body).map(u => new URL(u).pathname);
        assert(actual.length === expected.length, `expected ${expected.length} urls, got ${actual.length}: ${actual.join(', ')}`);
        for (const p of expected) assert(actual.includes(p), `missing ${p}`);
    });

    await test('every sitemap entry carries lastmod, changefreq and priority', async () => {
        const entries = [...map.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
        assert(entries.length > 0, 'no <url> entries');
        for (const e of entries) {
            assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(e), `lastmod missing or malformed: ${e}`);
            assert(/<changefreq>\w+<\/changefreq>/.test(e), `changefreq missing: ${e}`);
            assert(/<priority>[\d.]+<\/priority>/.test(e), `priority missing: ${e}`);
        }
    });

    // The regression this phase exists for: /v1/spec answers YAML, /v1/catalogue and /v1/health
    // answer JSON. All three sat in the sitemap and were being graded as HTML pages.
    await test('no API endpoint is advertised as an indexable page', async () => {
        const paths = locs(map.body).map(u => new URL(u).pathname);
        for (const bad of ['/v1/spec', '/v1/catalogue', '/v1/health']) {
            assert(!paths.includes(bad), `${bad} must not be in sitemap.xml — it is not an HTML page`);
        }
    });

    await test('every sitemap URL is served as HTML', async () => {
        for (const u of locs(map.body)) {
            const r = await text(new URL(u).pathname, { Accept: 'text/html' });
            assert(r.status === 200 || r.status === 302, `${u} → ${r.status}`);
            if (r.status === 200) assert(r.ct.includes('text/html'), `${u} → content-type ${r.ct}`);
        }
    });

    await test('every sitemap URL is absolute and on this node', async () => {
        const origin = new URL(BASE).origin;
        for (const u of locs(map.body)) {
            assert(u.startsWith('http'), `relative loc: ${u}`);
            assert(new URL(u).origin === origin, `foreign host in sitemap: ${u}`);
        }
    });

    // Failure mode: a page marked `planned` is designed but not routed yet. Listing it would point
    // the sitemap at a 404, which is worse than omitting it.
    await test('planned pages are excluded from the sitemap', async () => {
        const planned = PUBLIC_PAGES.filter(p => p.planned).map(p => p.path);
        const paths = locs(map.body).map(u => new URL(u).pathname);
        for (const p of planned) assert(!paths.includes(p), `planned page ${p} must not be listed until it is served`);
    });

    await test('registry descriptions are long enough to be meta descriptions', async () => {
        for (const p of PUBLIC_PAGES) {
            assert(p.description.length >= 50, `${p.path}: description is ${p.description.length} chars, needs 50+`);
            assert(p.title.length > 0, `${p.path}: empty title`);
        }
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
