/**
 * @file e2e-transparency-page.ts
 * @description E2E for the PUBLIC transparency page (TARGET-058 Phase 10) — the human-language
 *   page at /v1/transparency, its markdown mirror, and the copy that ships with them.
 *
 *   THE CLAIMS REGISTER IS ENFORCED HERE, NOT IN A REVIEW. docs/internal/EUAct/20 §L names four
 *   things that may never be said — "EU AI Act compliant", "all AI content is watermarked",
 *   "certified", "compliant because it runs on AIMEAT" — and two claims that Phase 9 checked
 *   against production and found WRONG as drafted. A register that lives only in a document is
 *   checked when somebody remembers; this suite checks it on every run, in both locales.
 *
 *   THE OPERATOR IS NEVER RESTATED IN SHIPPED COPY. Operator identity, supervisory authority and
 *   Code of Practice status have exactly one source, `GET /v1/ai-transparency`. The page reads it
 *   at render time and the mirror points at it. This suite asserts that the mirror does not
 *   contain the operator's legal name, because a hardcoded one is a false statement on every node
 *   running this MIT code that is not the node it was written on.
 *
 *   AND IT ASSERTS THE ROUTE ITSELF. A SPA page needs an entry in BOTH src/routes/portal.ts and
 *   public/spa.html or a hard refresh answers 404 while in-app navigation looks fine — the trap
 *   this codebase has fallen into before.
 * @structure route + mirror · the stated limits · the claims register · locale parity ·
 *   Accept negotiation on the JSON route · the openapi and namespace decisions
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=transparency-page
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 10b. Three decisions turned from comments into checks:
 *     page routes and their mirrors stay OUT of openapi.yaml, no key returns to the colliding
 *     `aiTransparency.*` namespace, and `/v1/ai-transparency` answers JSON to machines while
 *     redirecting a browser. Plus: the labelled example may not be pinned to a filename.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 10.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PUBLIC_PAGES, findPublicPage } from '../src/data/public-pages.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'locales');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function fetchText(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, { headers });
    return { status: res.status, ct: res.headers.get('content-type') ?? '', link: res.headers.get('link') ?? '', body: await res.text() };
}

/** Flatten a locale bundle the way the SPA's i18n runtime does, so keys match what t() sees. */
function flatten(obj: any, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
        else out[key] = String(v);
    }
    return out;
}

/** The keys this page and its two entry points ship. */
function pageKeys(bundle: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(bundle).filter(([k]) =>
        k.startsWith('transparency.') || k.startsWith('biz.trans') || k.startsWith('landing.trans')));
}

/**
 * The four claims from doc 20 §L that may never be made, in both languages.
 *
 * `certified` is matched as a whole word so "certificate" in unrelated copy would not trip it, and
 * the watermarking pattern is deliberately loose about the words between "all" and "watermarked":
 * the claim is wrong however it is phrased.
 */
/**
 * Registry pages this check does NOT hold to the "pages stay out of openapi.yaml" rule.
 *
 * Both predate the decision and both are LISTED rather than quietly skipped, because a silent
 * skip is how an exemption becomes the rule. Neither was introduced by TARGET-058.
 *
 *  - `/v1/docs` is an HTML page in this registry AND a documented path in the contract — the same
 *    inconsistency the decision exists to remove. Not swept up here: taking it out also removes
 *    `getDocs` from the generated types, which is the owner's call, not a test's.
 *  - `/v1/glossary.md` is documented in the contract, but the route the contract describes is the
 *    GLOSSARY DATA document (`glossaryMd`, tags: [Catalogue]) served by routes/glossary.ts — which
 *    is a real API document and belongs there. It happens to collide with the URL the mirror
 *    router would serve for the `/v1/glossary` registry entry; glossary.ts mounts first and wins,
 *    so the registry's markdown body for that page is shadowed and never served.
 *
 * Delete an entry the moment its cause is fixed.
 */
const EXEMPT_FROM_PAGE_RULE = new Set(['/v1/docs', '/v1/glossary']);

const FORBIDDEN: Array<[string, RegExp]> = [
    ['"EU AI Act compliant"', /\bAI[- ]Act[- ]compliant\b/i],
    ['"EU AI Act compliant" (fi)', /tekoälyasetuksen\s+mukainen/i],
    ['"all AI content is watermarked"', /\ball\b[^.]{0,40}\bwatermark/i],
    ['"all AI content is watermarked" (fi)', /\bkaikki\b[^.]{0,40}\bvesileima/i],
    ['"certified"', /\bcertified\b/i],
    ['"certified" (fi)', /\bsertifioitu\b/i],
    ['"compliant because it runs on AIMEAT"', /compliant\s+because/i],
];

(async () => {
    console.log('\n🔎 The public transparency page — route, mirror and claims\n');

    // ── The route, on a hard load. Both portal.ts and spa.html, or this is a 404. ──

    const page = await fetchText('/v1/transparency', { Accept: 'text/html' });

    await test('GET /v1/transparency serves the page as HTML on a cold request', async () => {
        assert(page.status === 200, `status ${page.status} — is /v1/transparency in the spaRoutes list in src/routes/portal.ts?`);
        assert(page.ct.includes('text/html'), `content-type ${page.ct}`);
    });

    await test('the SPA shell knows the route, or the view never loads', async () => {
        const spa = readFileSync(join(here, '..', 'public', 'spa.html'), 'utf-8');
        assert(spa.includes("'/v1/transparency'"), '/v1/transparency is missing from the ROUTES map in public/spa.html');
        assert(spa.includes('/views/transparency.js'), 'spa.html does not import the transparency view');
        assert(spa.includes('/css/views/transparency.css'), 'spa.html does not preload the transparency stylesheet');
    });

    await test('the page is in the public-page registry, so it reaches sitemap and head metadata', async () => {
        const entry = findPublicPage('/v1/transparency');
        assert(!!entry, '/v1/transparency is not in src/data/public-pages.ts');
        assert(!!entry!.markdown, 'the registry entry carries no markdown body, so it has no .md mirror');
        const map = await fetchText('/sitemap.xml');
        assert(map.body.includes('/v1/transparency<'), 'sitemap.xml does not list /v1/transparency');
    });

    // ── The mirror ──

    const mirror = await fetchText('/v1/transparency.md');

    await test('the .md mirror resolves, with frontmatter and a canonical link back', async () => {
        assert(mirror.status === 200, `status ${mirror.status}`);
        assert(mirror.ct.includes('text/markdown'), `content-type ${mirror.ct}`);
        assert(mirror.body.startsWith('---'), 'no frontmatter');
        assert(mirror.link.includes('rel="canonical"'), `no canonical Link header: ${mirror.link}`);
    });

    await test('the page URL itself answers Accept: text/markdown with the same document', async () => {
        const neg = await fetchText('/v1/transparency', { Accept: 'text/markdown' });
        assert(neg.ct.includes('text/markdown'), `content-type ${neg.ct}`);
        assert(neg.body === mirror.body, 'content negotiation and the .md suffix serve different documents');
    });

    // ── The two sentences that are load-bearing. Softening either is the defect. ──

    await test('the mirror states that this node does not watermark text', async () => {
        assert(/does \*\*not\*\* watermark text|does not watermark text/i.test(mirror.body),
            'the "we do not watermark text" limit is missing from the mirror');
    });

    await test('the mirror states that a mark can be removed by copying', async () => {
        assert(/removed by copying/i.test(mirror.body), 'the "a mark can be removed by copying" limit is missing');
    });

    await test('the mirror scopes verification to bytes this node served', async () => {
        assert(/byte for byte/i.test(mirror.body), 'the mirror does not scope checking to the bytes the node served');
        assert(/re-assembles a document on the way out/i.test(mirror.body),
            'the mirror omits the limit Phase 9 found: a re-serialised document cannot be checked by hash');
    });

    await test('an absent record is described as unstated, never as human-written', async () => {
        assert(/never means a person wrote it/i.test(mirror.body), 'the absent-record rule is missing');
    });

    // ── One source for the operator. This is what keeps the copy true on a fork. ──

    const stmt = (await (await fetch(`${BASE}/v1/ai-transparency`)).json() as any).data;

    await test('the mirror does not restate the operator, it points at the live statement', async () => {
        const legalName = stmt.operator?.legal_name;
        if (legalName) {
            assert(!mirror.body.includes(legalName),
                `the mirror hardcodes the operator name "${legalName}" — it would be false on every other node`);
        }
        assert(mirror.body.includes('/v1/ai-transparency'), 'the mirror does not point at the live statement');
    });

    await test('the shipped copy never claims Code of Practice signatory status on its own', async () => {
        // The page renders "has signed" only when the statement says so. Nothing in the mirror,
        // which is static text, may assert it — that is the one claim the Commission says the EU
        // icons must never be presented as implying.
        assert(!/is a signatory|has signed the EU Code/i.test(mirror.body),
            'the static mirror asserts signatory status; that answer belongs to /v1/ai-transparency');
        assert(stmt.code_of_practice?.signatory === false || stmt.code_of_practice?.signatory === true,
            'the live statement does not answer code_of_practice.signatory at all');
    });

    // ── The claims register, on the shipped strings and on the mirror ──

    const en = flatten(JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf-8')));
    const fi = flatten(JSON.parse(readFileSync(join(localesDir, 'fi.json'), 'utf-8')));

    await test('no forbidden claim appears in the English copy', async () => {
        for (const [label, re] of FORBIDDEN) {
            for (const [key, value] of Object.entries(pageKeys(en))) {
                assert(!re.test(value), `${key} makes the forbidden claim ${label}: "${value.slice(0, 120)}"`);
            }
        }
    });

    await test('no forbidden claim appears in the Finnish copy', async () => {
        for (const [label, re] of FORBIDDEN) {
            for (const [key, value] of Object.entries(pageKeys(fi))) {
                assert(!re.test(value), `${key} makes the forbidden claim ${label}: "${value.slice(0, 120)}"`);
            }
        }
    });

    await test('no forbidden claim appears in the markdown mirror', async () => {
        for (const [label, re] of FORBIDDEN) {
            assert(!re.test(mirror.body), `the mirror makes the forbidden claim ${label}`);
        }
    });

    // Phase 9 found this one by checking it against production: the visible label was verified on
    // the node's OWN surfaces, so the copy may not widen it to everywhere a person reads.
    await test('the visible label is not claimed beyond this node\'s own surfaces', async () => {
        for (const bundle of [en, fi]) {
            for (const [key, value] of Object.entries(pageKeys(bundle))) {
                assert(!/label (is shown )?(on )?every(where| surface)/i.test(value),
                    `${key} widens the visible-label claim past what was verified: "${value.slice(0, 120)}"`);
            }
        }
    });

    // ── Locale parity. A compliance string missing in Finnish renders as a raw key. ──

    await test('every page string exists in both locales, with no [TODO:fi] left', async () => {
        const enKeys = Object.keys(pageKeys(en)), fiKeys = Object.keys(pageKeys(fi));
        for (const k of enKeys) assert(k in fi, `locales/fi.json is missing ${k}`);
        for (const k of fiKeys) assert(k in en, `locales/en.json is missing ${k}`);
        assert(enKeys.length >= 40, `expected 40+ page strings, found ${enKeys.length}`);
        for (const [k, v] of Object.entries(pageKeys(fi))) {
            assert(!v.includes('[TODO:fi]'), `${k} is still a Finnish placeholder`);
            assert(v.trim().length > 0, `${k} is empty in Finnish`);
        }
    });

    await test('the Finnish copy is Finnish, not the English text copied across', async () => {
        // A key whose two locales are byte-identical is either untranslated or a bare symbol. Only
        // the arrow-only CTAs and bare labels are allowed to match.
        const allowed = new Set(['transparency.opNode']);
        for (const [k, v] of Object.entries(pageKeys(en))) {
            if (allowed.has(k) || v.length < 12) continue;
            assert(fi[k] !== v, `${k} is identical in both locales — it was not translated`);
        }
    });

    // ── Phase 10b: the machine URL and the human URL are one word apart ─────────────────────

    async function accept(header: string | null) {
        const res = await fetch(`${BASE}/v1/ai-transparency`, {
            redirect: 'manual', headers: header === null ? {} : { Accept: header },
        });
        return { status: res.status, ct: res.headers.get('content-type') ?? '',
                 location: res.headers.get('location') ?? '', vary: res.headers.get('vary') ?? '' };
    }

    await test('/v1/ai-transparency still answers JSON to every machine caller', async () => {
        // `*\/*` is curl and most fetch() defaults; no Accept header at all is a bare socket
        // client. Both must keep getting the statement — the route is linked from llms.txt,
        // /.well-known/ and the bootstrap document.
        for (const h of ['*/*', 'application/json', null]) {
            const r = await accept(h);
            assert(r.status === 200, `Accept: ${h ?? '(none)'} → ${r.status}, expected 200 JSON`);
            assert(r.ct.includes('application/json'), `Accept: ${h ?? '(none)'} → ${r.ct}`);
        }
    });

    await test('/v1/ai-transparency sends a browser to the page instead', async () => {
        for (const h of ['text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                         'text/html,application/xhtml+xml,image/webp,*/*;q=0.8', 'text/html']) {
            const r = await accept(h);
            assert(r.status === 302, `a browser Accept got ${r.status}, expected a 302`);
            assert(r.location === '/v1/transparency', `redirected to ${r.location}`);
        }
    });

    await test('the negotiated route varies on Accept, so no cache serves the wrong one', async () => {
        const r = await accept('*/*');
        // Token-exact: compression already sets `Vary: Accept-Encoding`, and a substring test for
        // "accept" matches THAT and passes on a route that does not vary on Accept at all.
        const tokens = r.vary.split(',').map(s => s.trim().toLowerCase());
        assert(tokens.includes('accept'),
            `Vary is "${r.vary}" — without a bare Accept token a shared cache pins one answer for both callers`);
    });

    // ── Phase 10b: the openapi decision, enforced rather than commented ─────────────────────

    await test('no public page route or .md mirror is documented in openapi.yaml', async () => {
        // The contract describes the API. A human page is not one, and documenting one page out
        // of ten is the inconsistency this check exists to stop coming back.
        //
        // Parsed line by line rather than matched as a substring: openapi.yaml is CRLF, so a
        // literal `\n  /v1/x:\n` never matches and the assertion passes on any input — which is
        // exactly what the first version of this test did.
        const spec = readFileSync(join(here, '..', '..', 'openapi.yaml'), 'utf-8');
        const documented = new Set(
            spec.split(/\r?\n/)
                .map(line => line.match(/^ {2}(\/\S*):\s*$/)?.[1])
                .filter((p): p is string => !!p),
        );
        assert(documented.size > 100, `only ${documented.size} path keys parsed out of openapi.yaml — the parser is wrong, not the spec`);
        for (const p of PUBLIC_PAGES) {
            if (p.path === '/') continue;   // the API root legitimately answers the bootstrap document
            if (EXEMPT_FROM_PAGE_RULE.has(p.path)) continue;
            assert(!documented.has(p.path), `openapi.yaml documents the page route ${p.path}`);
            assert(!documented.has(`${p.path}.md`), `openapi.yaml documents the page mirror ${p.path}.md`);
        }
    });

    // ── Phase 10b: the namespace that was one character from the public page's ──────────────

    await test('no i18n key sits in the old aiTransparency.* namespace', async () => {
        // It was renamed to aiTransparencyMine.* because `aiTransparency.title` (the owner card)
        // and `transparency.title` (this page) meant different things one character apart, and a
        // key picked wrong renders as itself with nothing raising a hand.
        for (const [label, bundle] of [['en', en], ['fi', fi]] as const) {
            const stale = Object.keys(bundle).filter(k => /^aiTransparency\./.test(k));
            assert(stale.length === 0, `locales/${label}.json still has ${stale.length} key(s) in the colliding namespace: ${stale.slice(0, 3).join(', ')}`);
        }
        assert(Object.keys(en).some(k => k.startsWith('aiTransparencyMine.')), 'the owner card lost its strings entirely');
    });

    // ── Phase 10b: the labelled example, and the two ways it could become a lie ─────────────

    await test('the labelled example is resolved from the node, never pinned to a filename', async () => {
        const view = readFileSync(join(here, '..', 'public', 'views', 'transparency.js'), 'utf-8');
        assert(!/['"][\w-]+\.html['"]/.test(view),
            'the view names a specific app file — it would rot on a rename and be false on any other node');
        assert(view.includes('disclosureCallFound'),
            'the example is picked on what the app DECLARES rather than on what the node measured in its bytes');
    });

    await test('the footer and landing strings exist in both locales', async () => {
        for (const k of ['landing.footTransparency', 'landing.transLine', 'landing.transCta']) {
            assert(k in en && k in fi, `${k} is missing from a locale`);
        }
        const landing = readFileSync(join(here, '..', 'public', 'views', 'landing.js'), 'utf-8');
        const footer = landing.slice(landing.indexOf('<footer class="ld-footer"'));
        assert(footer.includes('/v1/transparency'), 'the landing footer has no transparency link');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
