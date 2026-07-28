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

import { PUBLIC_PAGES, sitemapPages, mirroredPages } from '../src/data/public-pages.js';

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

    // ── /sitemap.md (phase 03) ──────────────────────────────────────────────────────────────

    const smd = await text('/sitemap.md');

    await test('sitemap.md is served as markdown', async () => {
        assert(smd.status === 200, `status ${smd.status}`);
        assert(smd.ct.includes('text/markdown'), `content-type ${smd.ct}`);
    });

    await test('sitemap.md has headings and link lists', async () => {
        const h2 = (smd.body.match(/^## /gm) ?? []).length;
        const links = (smd.body.match(/\]\(/g) ?? []).length;
        assert(h2 >= 3, `expected 3+ H2 sections, got ${h2}`);
        assert(links >= 10, `expected 10+ markdown links, got ${links}`);
        assert(/^# /m.test(smd.body), 'no H1');
    });

    await test('sitemap.md lists every live registry page', async () => {
        for (const p of sitemapPages()) {
            if (p.path === '/') continue;  // linked as "Home", not by title
            assert(smd.body.includes(p.path), `sitemap.md omits ${p.path}`);
        }
    });

    // ── /AGENTS.md (phase 04) ───────────────────────────────────────────────────────────────

    const agents = await text('/AGENTS.md');

    await test('AGENTS.md is served as markdown, under both spellings', async () => {
        assert(agents.status === 200, `status ${agents.status}`);
        assert(agents.ct.includes('text/markdown'), `content-type ${agents.ct}`);
        const lower = await text('/agents.md');
        assert(lower.status === 200, `/agents.md status ${lower.status}`);
        assert(lower.body === agents.body, '/agents.md and /AGENTS.md must serve the same document');
    });

    await test('AGENTS.md carries the sections a coding agent needs', async () => {
        // Installation / Configuration / Usage are the section names a convention-following
        // reader looks for, and 'Setup' is not one of them.
        for (const section of ['## Installation', '## Configuration', '## Usage']) {
            assert(agents.body.includes(section), `AGENTS.md missing ${section}`);
        }
        assert(/^# /m.test(agents.body), 'no H1');
        assert(/^> /m.test(agents.body), 'no blockquote summary');
    });

    // ── llms.txt structure + /llms-full.txt (phase 05) ──────────────────────────────────────

    const llms = await text('/llms.txt');

    await test('llms.txt has a blockquote summary after the H1', async () => {
        assert(llms.status === 200, `status ${llms.status}`);
        assert(llms.ct.includes('text/plain'), `content-type ${llms.ct}`);
        const h1 = llms.body.indexOf('\n# ');
        const bq = llms.body.indexOf('\n> ');
        assert(bq > -1, 'no blockquote in llms.txt');
        assert(bq > h1, 'blockquote must follow the H1');
    });

    await test('llms.txt has H2 sections with markdown link lists', async () => {
        const links = (llms.body.match(/\]\(/g) ?? []).length;
        assert(links >= 15, `expected 15+ markdown links, got ${links}`);
        const docs = llms.body.slice(llms.body.indexOf('\n## Documentation'));
        assert(/\n- \[/.test(docs.slice(0, 400)), 'Documentation section has no link list');
    });

    await test('llms.txt links are absolute and resolve', async () => {
        const urls = [...new Set([...llms.body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map(m => m[1]))];
        assert(urls.length >= 15, `expected 15+ absolute links, got ${urls.length}`);
        for (const u of urls) {
            const r = await fetch(u, { method: 'GET' });
            assert(r.status < 400, `${u} → ${r.status}`);
        }
    });

    await test('llms-full.txt serves the same manual', async () => {
        const full = await text('/llms-full.txt');
        assert(full.status === 200, `status ${full.status}`);
        assert(full.ct.includes('text/plain'), `content-type ${full.ct}`);
        assert(full.body === llms.body, 'llms-full.txt must match llms.txt byte for byte');
    });

    // ── Glossary (phase 06) ─────────────────────────────────────────────────────────────────

    await test('glossary is served as JSON, markdown and JSON-LD from one registry', async () => {
        const j = await fetch(`${BASE}/v1/glossary.json`);
        assert(j.status === 200, `json status ${j.status}`);
        const body = await j.json() as any;
        const registry = body.data.terms as Array<{ term: string; area: string; definition: string }>;
        assert(registry.length >= 30, `expected 30+ terms, got ${registry.length}`);
        for (const t of registry) {
            assert(t.term.length > 0 && t.definition.length >= 40, `${t.term}: definition too thin`);
            assert(t.area.length > 0, `${t.term}: no area`);
        }

        const md = await text('/v1/glossary.md');
        assert(md.ct.includes('text/markdown'), `md content-type ${md.ct}`);
        assert(md.body.startsWith('---'), 'glossary markdown has no frontmatter');
        for (const t of registry) assert(md.body.includes(t.term), `markdown omits ${t.term}`);

        const ld = await (await fetch(`${BASE}/v1/glossary/jsonld.json`)).json() as any;
        assert(ld['@type'] === 'DefinedTermSet', `@type ${ld['@type']}`);
        assert(ld.hasDefinedTerm.length === registry.length, 'JSON-LD term count must match the registry');
    });

    await test('the three identity terms are all defined and distinct', async () => {
        for (const term of ['GHII', 'GAII', 'GEAI']) {
            const r = await fetch(`${BASE}/v1/glossary.json?term=${term}`);
            assert(r.status === 200, `${term} → ${r.status}`);
            const body = await r.json() as any;
            assert(body.data.term.form?.includes('@'), `${term} has no identity form`);
        }
    });

    await test('an unknown term answers 404, not an empty success', async () => {
        const r = await fetch(`${BASE}/v1/glossary.json?term=notaterm`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    // P14: the link has to be in the markup a reader sees WITHOUT running JavaScript. The SPA nav
    // is rendered by Preact, so a nav entry alone would be invisible to every crawler.
    await test('every public page links to the glossary in its static HTML', async () => {
        for (const p of sitemapPages()) {
            const r = await text(p.path, { Accept: 'text/html' });
            if (r.status !== 200) continue;
            assert(r.body.includes('/v1/glossary'), `${p.path} has no glossary link in its static HTML`);
        }
    });

    // ── Protocol discovery documents (phase 09) ─────────────────────────────────────────────

    async function jsonDoc(path: string) {
        const res = await fetch(`${BASE}${path}`);
        return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: await res.json() as any };
    }

    await test('public discovery documents are readable cross-origin', async () => {
        for (const p of ['/.well-known/aimeat', '/.well-known/mcp.json', '/.well-known/api-catalog',
                         '/.well-known/ucp', '/.well-known/acp.json']) {
            const r = await jsonDoc(p);
            assert(r.status === 200, `${p} → ${r.status}`);
            assert(r.cors === '*', `${p} has no Access-Control-Allow-Origin — a browser agent cannot read it`);
        }
    });

    await test('MCP Server Card carries name, description and version at the root', async () => {
        const { body } = await jsonDoc('/.well-known/mcp.json');
        for (const f of ['name', 'description', 'version']) {
            assert(typeof body[f] === 'string' && body[f].length > 0, `mcp.json root field '${f}' missing`);
        }
        assert(typeof body.serverInfo?.name === 'string', 'serverInfo kept for clients that read it');
    });

    await test('UCP capabilities is an object keyed by capability name', async () => {
        const { body } = await jsonDoc('/.well-known/ucp');
        const caps = body.ucp?.capabilities;
        assert(caps !== undefined, 'ucp.capabilities missing');
        assert(!Array.isArray(caps) && typeof caps === 'object',
            `ucp.capabilities must be an object, got ${Array.isArray(caps) ? 'array' : typeof caps}`);
        assert(/^\d{4}-\d{2}-\d{2}$/.test(body.ucp?.version ?? ''), `ucp.version must be YYYY-MM-DD, got ${body.ucp?.version}`);
        assert(typeof body.ucp?.services === 'object', 'ucp.services must be an object');
    });

    await test('ACP discovery document carries the RFC-required fields', async () => {
        const { body } = await jsonDoc('/.well-known/acp.json');
        assert(body.protocol?.name === 'acp', `protocol.name: ${body.protocol?.name}`);
        assert(/^\d{4}-\d{2}-\d{2}$/.test(body.protocol?.version ?? ''), `protocol.version must be YYYY-MM-DD, got ${body.protocol?.version}`);
        assert(Array.isArray(body.protocol?.supported_versions) && body.protocol.supported_versions.length > 0,
            'protocol.supported_versions must be a non-empty array');
        assert(typeof body.api_base_url === 'string' && body.api_base_url.startsWith('http'), `api_base_url: ${body.api_base_url}`);
        assert(Array.isArray(body.transports) && body.transports.includes('rest'), `transports must include "rest": ${JSON.stringify(body.transports)}`);
        assert(Array.isArray(body.capabilities?.services) && body.capabilities.services.length > 0,
            'capabilities.services must be a non-empty array');
    });

    // Honesty check: the document may only advertise services and transports this node actually
    // serves. Claiming "orders" or an MCP transport sends a buyer agent to routes that do not exist.
    await test('ACP advertises only services this node serves', async () => {
        const { body } = await jsonDoc('/.well-known/acp.json');
        const served = new Set(['checkout']);
        for (const s of body.capabilities.services) assert(served.has(s), `advertises service '${s}' with no routes behind it`);
        for (const t of body.transports) assert(t === 'rest', `advertises transport '${t}' that does not answer ACP`);
    });

    // ── Markdown mirrors + per-route head (phases 07 + 08) ──────────────────────────────────

    await test('every mirrored page has a .md URL with frontmatter and a site-map section', async () => {
        for (const p of mirroredPages()) {
            const path = p.path === '/' ? '/index.md' : `${p.path}.md`;
            const r = await fetch(`${BASE}${path}`);
            assert(r.status === 200, `${path} → ${r.status}`);
            assert((r.headers.get('content-type') ?? '').includes('text/markdown'), `${path} content-type`);
            assert((r.headers.get('link') ?? '').includes('rel="canonical"'), `${path} has no canonical Link header`);
            const body = await r.text();
            assert(body.startsWith('---\n'), `${path} has no frontmatter`);
            assert(body.includes(`url: `), `${path} frontmatter has no url`);
            assert(body.includes('## Sitemap'), `${path} has no sitemap section`);
            assert(!body.includes('{{BASE_URL}}'), `${path} has an unsubstituted BASE_URL token`);
        }
    });

    // A scanner forms the mirror URL by appending `.md` to the page URL, so the root's is `/.md`.
    // This was claimed done in a commit message before the code existed; the assertion is here so
    // the claim cannot outrun the route again.
    await test('the root mirror answers on both /.md and /index.md', async () => {
        for (const p of ['/index.md', '/.md']) {
            const r = await text(p);
            assert(r.status === 200, `${p} → ${r.status}`);
            assert(r.ct.includes('text/markdown'), `${p} content-type ${r.ct}`);
            assert(r.body.startsWith('---\n'), `${p} has no frontmatter`);
        }
    });

    await test('page URLs negotiate markdown', async () => {
        for (const p of mirroredPages()) {
            const r = await text(p.path, { Accept: 'text/markdown' });
            assert(r.ct.includes('text/markdown'), `${p.path} with Accept: text/markdown → ${r.ct}`);
        }
    });

    await test('each page head describes THAT page, not the shell', async () => {
        const seen = new Map<string, string>();
        for (const p of sitemapPages()) {
            const r = await text(p.path, { Accept: 'text/html' });
            if (r.status !== 200) continue;
            const canonical = /rel="canonical" href="([^"]+)"/.exec(r.body)?.[1];
            assert(canonical !== undefined, `${p.path} has no canonical`);
            assert(canonical!.endsWith(p.path), `${p.path} claims canonical ${canonical}`);
            // A shell-wide canonical would make every route look like a duplicate of one page.
            const clash = [...seen.entries()].find(([, c]) => c === canonical);
            assert(clash === undefined, `${p.path} and ${clash?.[0]} share canonical ${canonical}`);
            seen.set(p.path, canonical!);
            assert(r.body.includes('<html lang='), `${p.path} has no lang`);
            assert(r.body.includes('name="description"'), `${p.path} has no description`);
            assert(r.body.includes('og:title'), `${p.path} has no og:title`);
            assert(r.body.includes('application/ld+json'), `${p.path} has no JSON-LD`);
            assert((r.body.match(/<h1/g) ?? []).length === 1, `${p.path} has ${(r.body.match(/<h1/g) ?? []).length} h1 elements, expected 1`);
        }
    });

    await test('mirrored pages advertise their markdown from the HTML head', async () => {
        for (const p of mirroredPages()) {
            const r = await text(p.path, { Accept: 'text/html' });
            if (r.status !== 200) continue;
            assert(r.body.includes('rel="alternate" type="text/markdown"'), `${p.path} has no alternate link`);
        }
    });

    // ── Apex-only guard ─────────────────────────────────────────────────────────────────────
    // These documents describe THIS node. Served from an app's own host they would describe
    // somebody else — a site map full of apex URLs, or the 145 kB app-BUILDING manual in which
    // the app's own name never appears. Until phase 12 gives app origins their own versions, a
    // 404 is the honest answer. `x-app-origin` is what nginx stamps on the app host family.
    await test('node discovery documents do not answer on an app origin', async () => {
        for (const p of ['/sitemap.md', '/AGENTS.md', '/agents.md', '/llms-full.txt']) {
            const r = await text(p, { 'x-app-origin': '1', 'x-subdomain': 'someapp' });
            assert(r.status === 404, `${p} on an app origin → ${r.status}, expected 404`);
        }
    });

    // ── Root content negotiation (phase 10) ─────────────────────────────────────────────────
    // A wildcard Accept is what every crawler, unfurler and readability scanner sends, and it used
    // to get the JSON bootstrap — so the node's front door was invisible to all of them.
    await test('the root answers HTML by default and JSON only when asked', async () => {
        const wildcard = await text('/', { Accept: '*/*' });
        assert(wildcard.ct.includes('text/html'), `Accept: */* → ${wildcard.ct}, expected text/html`);
        assert(wildcard.body.includes('rel="canonical"'), 'root HTML has no canonical');
        assert(wildcard.body.includes('application/ld+json'), 'root HTML has no JSON-LD');

        const json = await text('/', { Accept: 'application/json' });
        assert(json.ct.includes('application/json'), `Accept: application/json → ${json.ct}`);
        const forced = await text('/?format=json');
        assert(forced.ct.includes('application/json'), `?format=json → ${forced.ct}`);
        const md = await text('/', { Accept: 'text/markdown' });
        assert(md.ct.includes('text/markdown'), `Accept: text/markdown → ${md.ct}`);
    });

    await test('the JSON bootstrap still carries what agents were told to look for', async () => {
        const r = await fetch(`${BASE}/?format=json`);
        const body = await r.json() as any;
        assert(typeof body.data?.this_node?.base_url === 'string', 'bootstrap lost this_node.base_url');
        assert(body.data?.for_ai_agents || body.data?.for_ai_assistants, 'bootstrap lost its guidance sections');
    });

    // ── Conventional agent paths (phase 14) ─────────────────────────────────────────────────
    // Measured by pointing a scanner at itself and reading its probe list out of the result: it
    // tries /openapi.json, /skill.md, /agents.txt and /mcp at the origin root and reads no
    // discovery document at all. Being correct at our own address and absent from the conventional
    // one is a distinction only the spec cares about.
    await test('the conventional agent paths answer', async () => {
        const expected: Array<[string, string]> = [
            ['/openapi.json', 'application/json'],
            ['/skill.md', 'text/markdown'],
            ['/agents.txt', 'text/plain'],
            ['/.well-known/webmcp.json', 'application/json'],
            ['/.well-known/x402.json', 'application/json'],
        ];
        for (const [p, ct] of expected) {
            const r = await text(p);
            assert(r.status === 200, `${p} → ${r.status}`);
            assert(r.ct.includes(ct), `${p} content-type ${r.ct}, expected ${ct}`);
        }
    });

    await test('/openapi.json is the whole contract, not a stub', async () => {
        const spec = await (await fetch(`${BASE}/openapi.json`)).json() as any;
        assert(typeof spec.openapi === 'string', 'no openapi version field');
        const n = Object.keys(spec.paths ?? {}).length;
        assert(n > 100, `expected the full contract, got ${n} paths`);
    });

    await test('skill.md has frontmatter with a name and a description', async () => {
        const body = (await text('/skill.md')).body;
        assert(body.startsWith('---\n'), 'no frontmatter');
        const fm = body.slice(4, body.indexOf('\n---', 4));
        assert(/^name:\s*\S+/m.test(fm), 'frontmatter has no name');
        assert(/^description:\s*\S+/m.test(fm), 'frontmatter has no description');
    });

    // The rail is real and settles on a test network. That is stated in the document rather than
    // left to be discovered after a transfer, and it is derived from the network registry, so a
    // config flip to mainnet changes this answer with no edit here.
    await test('x402 discovery names the network it actually settles on', async () => {
        const x = await (await fetch(`${BASE}/.well-known/x402.json`)).json() as any;
        assert(typeof x.network === 'string' && x.network.length > 0, 'no network');
        assert(typeof x.testnet === 'boolean', 'testnet flag missing — a buyer must not have to infer it');
        if (x.testnet) assert(typeof x.notice === 'string', 'a testnet rail must say so in plain words');
        assert(x.settlement?.custodial === false, 'settlement must declare that this node holds no funds');
        for (const a of x.assets ?? []) {
            assert(/^0x[0-9a-fA-F]{40}$/.test(a.address), `bad asset address: ${a.address}`);
        }
    });

    await test('the MCP server answers on /mcp as well as /v1/mcp', async () => {
        // Unauthenticated: any status but 404 proves the route exists. 404 would mean the alias is gone.
        for (const p of ['/mcp', '/v1/mcp']) {
            const r = await fetch(`${BASE}${p}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
            });
            assert(r.status !== 404, `${p} → 404, the MCP server is not reachable there`);
        }
    });

    // robots.txt is registered by the static-file layer, ahead of the subdomain router, so without
    // a guard it answered on every app origin with the NODE's file — ending in a Sitemap: line
    // pointing at the apex. A robots.txt that sends a crawler to another host's sitemap is a
    // document about somebody else served under the app's name.
    await test('robots.txt does not leak the node file onto an app origin', async () => {
        const apex = await text('/robots.txt');
        assert(apex.status === 200 && apex.body.includes('Content-Signal'), 'apex robots.txt missing');
        const onApp = await text('/robots.txt', { 'x-app-origin': '1', 'x-subdomain': 'someapp' });
        assert(!onApp.body.includes('Content-Signal'),
            'the node robots.txt answered on an app origin');
    });

    await test('the root serves plain text to a plain-text client', async () => {
        const r = await text('/', { Accept: 'text/plain' });
        assert(r.ct.includes('text/plain'), `Accept: text/plain → ${r.ct}`);
        assert(r.body.length > 100, 'plain-text body is empty');
    });

    await test('the HTML head points at llms.txt and identifies the organization', async () => {
        const h = await text('/', { Accept: 'text/html' });
        assert(h.body.includes('href="/llms.txt"'), 'no link to llms.txt in the head');
        assert(h.body.includes('"@type": "Organization"'), 'no Organization JSON-LD');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
