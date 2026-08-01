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
 * @structure route + mirror · the stated limits · the claims register · locale parity
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=transparency-page
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 10.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findPublicPage } from '../src/data/public-pages.js';

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

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
