/**
 * @file test/unit/app-serve-marks.test.ts
 * @description Proof that folding four serve-time HTML injectors into one pass changed not one byte
 *   of what a visitor receives. The goldens in test/fixtures/serve-marks-golden.json were captured
 *   from the PRE-consolidation code (badge → AI disclosure → agent discovery → head meta, in that
 *   order); this replays the same documents and the same specs through applyServeMarks() and
 *   compares base64.
 *
 *   The corpus is not decorative. Every case is a shape that has cost us something or would: app
 *   JavaScript carrying the literal `</body>`, a single-file app with no `<head>`, a payload that is
 *   not a document, a document already carrying its own JSON-LD, and a re-serve.
 * @structure one `it` per fixture case, plus the idempotency and never-on-the-way-in guarantees.
 * @usage pnpm exec vitest run test/unit/app-serve-marks.test.ts
 * @version-history
 *   v1.5.0 — 2026-09-13 — Goldens re-captured for the fifth intentional output change: the
 *     `#aimeat-app-ref` block moves from the end of the body to the start of the head, and its JSON
 *     is escaped for a script element instead of for HTML (app-serve-marks v1.4.0). 9 of 19 cases
 *     moved, exactly the nine documents that carry a discovery block, and each differs from its old
 *     golden only by that block: with it cut out of both, the bytes are identical. The third of
 *     the three cases: the assertion was right and the behaviour changed under it. New section
 *     for the block itself (appdev pitfall appref-block-is-injected-after-your-script); its five
 *     placement and parsing cases failed on the old pass before the change.
 *   v1.4.0 — 2026-09-05 — Goldens re-captured for the fourth intentional output change: the
 *     attribution badge draws its bolt as an inline SVG instead of typing a ⚡, and its panel is
 *     opaque so the words' contrast no longer depends on what the app painted behind them
 *     (app-badge v2.1.0). 15 of 19 cases moved, and every one of them is a case that asks for the
 *     badge — the four that do not are byte-identical, which is the check that the change went
 *     where it was aimed. The third of the three cases again: the assertion was right and the
 *     behaviour changed under it.
 *   v1.3.0 — 2026-08-25 — Goldens re-captured for the third intentional output change, and the
 *     corpus gains two cases. Nine went red because the head-meta pass now stamps
 *     `<meta name="robots" content="noindex, nofollow">` on an app whose owner has not asked for it
 *     to be findable, which every existing fixture is. The assertion was right and the behaviour
 *     changed under it — the third of the three cases, not a broken source and not a stale setup.
 *     The two new cases are the search-VISIBLE state: the social card, the keywords, the app's own
 *     declared language and the interaction count exist only there, so without them the goldens
 *     pinned half the pass.
 *   v1.2.0 — 2026-08-16 — Goldens re-captured for the second intentional output change: the
 *     head-meta pass now also fills in a manifest link, a theme-color and an apple-touch-icon
 *     (installable apps). 9 of 17 cases changed, all of them headMeta cases.
 *   v1.1.0 — 2026-08-02 — Goldens re-captured after the first intentional output change since the
 *     consolidation: the reserved-strip declaration (`--aimeat-chrome-bottom`, app-chrome-reserve.ts)
 *     now rides along whenever visible chrome is served. From here the goldens are a regression
 *     baseline for the CURRENT pass, no longer a parity proof against the four pre-consolidation
 *     injectors.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { SERVE_MARK_CASES, FIXTURE_CONFIG, provFixture } from './serve-marks-fixtures.js';

const GOLDEN: Record<string, string> = JSON.parse(
  readFileSync(new URL('../fixtures/serve-marks-golden.json', import.meta.url), 'utf-8'),
);

/** The consolidated pass, driven from a fixture case. */
function run(c: (typeof SERVE_MARK_CASES)[number]): Buffer {
  return applyServeMarks(c.html, {
    badge: c.badge,
    provenance: c.prov ? provFixture(c.prov) : undefined,
    visibleLabel: c.visible ? { config: FIXTURE_CONFIG, locale: 'en' } : undefined,
    discovery: c.discovery,
    headMeta: c.headMeta,
  });
}

describe('one serve-time marks pass produces exactly what four injectors produced', () => {
  it('covers every golden that was captured', () => {
    expect(SERVE_MARK_CASES.map((c) => c.name).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  for (const c of SERVE_MARK_CASES) {
    it(`${c.name}: byte-identical`, () => {
      expect(run(c).toString('base64')).toBe(GOLDEN[c.name]);
    });
  }
});

describe('the guarantees the pass owns for all four marks at once', () => {
  const DOC = '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>';
  const spec = {
    badge: true,
    provenance: provFixture('labelled'),
    visibleLabel: { config: FIXTURE_CONFIG, locale: 'en' as const },
  };

  it('re-serving an already-marked document adds nothing a second time', () => {
    const once = applyServeMarks(DOC, spec).toString('utf-8');
    const twice = applyServeMarks(once, spec).toString('utf-8');
    expect(twice).toBe(once);
  });

  it('leaves a payload that is not a document completely alone', () => {
    const json = '{"kind":"not html"}';
    expect(applyServeMarks(json, spec).toString('utf-8')).toBe(json);
  });

  it('lands the marks before the LAST </body>, never the first one inside app JS', () => {
    const trap = '<html><body><script>var t = "</bo" + "dy>";</scr' + 'ipt></body></html>';
    const out = applyServeMarks(trap, spec).toString('utf-8');
    // The app's own script is untouched: everything we add sits after it.
    const scriptEnd = out.indexOf('ipt>');
    expect(out.indexOf('id="aimeat-app-badge"')).toBeGreaterThan(scriptEnd);
    expect(out.indexOf('id="aimeat-ai-label"')).toBeGreaterThan(scriptEnd);
    // …and the document still closes exactly once.
    expect(out.match(/<\/body>/g)?.length).toBe(1);
  });

  it('asks for no marks and returns the document verbatim', () => {
    expect(applyServeMarks(DOC, {}).toString('utf-8')).toBe(DOC);
  });
});

/**
 * The caller-declared document (v1.3.0).
 *
 * THE HOLE THIS SECTION IS THE MEMORY OF. `isDocument` was sniffed from a closing `</body>` or
 * `</html>`. Three published apps on aimeat.io — noste, taivas, laake — open with a comment or a
 * `<meta charset>` and never close anything, which every browser parses as a document and this
 * pass declined as a fragment. Measured 2026-09-11: noste served 235 kB with eleven characters of
 * extractable text, no attribution badge, no AI-disclosure mark and no discovery block, on an
 * origin Bing had already indexed. The default is still the sniff, because the callers that pass
 * JSON or SVG cannot vouch for their payload.
 */
describe('applyServeMarks: the caller may declare the payload a document', () => {
  // Exactly the shape of the three: no doctype, no <html>, no closing tag of any kind.
  const TAGLESS = '<meta charset="utf-8"><title>NOSTE</title><div id="app"></div><script>go()</script>';

  it('declines a tagless document when nobody vouches for it', () => {
    const out = applyServeMarks(TAGLESS, { badge: true }).toString('utf-8');
    expect(out).toBe(TAGLESS);
  });

  it('marks the same bytes when the caller says it is a document', () => {
    const out = applyServeMarks(TAGLESS, { badge: true, isDocument: true }).toString('utf-8');
    expect(out).not.toBe(TAGLESS);
    expect(out.startsWith(TAGLESS)).toBe(true);   // appended, the author's bytes untouched
    expect(out).toContain('aimeat');
  });

  // The flag is opt-in, so a caller that cannot vouch for its payload is unaffected by adding it.
  // (A JSON value that happens to contain the literal `</body>` IS spliced, and always has been —
  // see the `not-a-document/all-four` golden. That is the sniff's own limit, not this flag's.)
  it('changes nothing for a caller that does not set it', () => {
    const json = '{"kind":"not html","value":"plain"}';
    expect(applyServeMarks(json, { badge: true }).toString('utf-8')).toBe(json);
  });

  it('leaves a document that closes properly exactly as it was', () => {
    const closed = '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>';
    const sniffed = applyServeMarks(closed, { badge: true }).toString('utf-8');
    const declared = applyServeMarks(closed, { badge: true, isDocument: true }).toString('utf-8');
    expect(declared).toBe(sniffed);
  });
});

/**
 * The app's own identity block (v1.4.0 of the pass).
 *
 * THE HOLE THIS SECTION IS THE MEMORY OF. `#aimeat-app-ref` rode at the end of the body with the
 * rest of the discovery block, so an app's inline script ran before it existed: appRef() read at
 * parse time answered null, the owner was shown the visitor view of their own app and a public
 * gallery read from an empty identity, with a clean console (appdev pitfall
 * appref-block-is-injected-after-your-script, 2026-08-28). The mosaic itself read it that way. And
 * the JSON was HTML-escaped, which a script element's raw text never decodes, so JSON.parse of
 * the block as served threw on the first `&quot;`.
 */
describe('applyServeMarks: the app-ref block is readable from the app\'s first script', () => {
  const discovery = {
    owner: 'alice', filename: 'demo.html', appName: 'Demo', description: 'A demo app',
    baseUrl: 'https://aimeat.io', toolNames: ['search'], webmcp: true,
  };
  const REF = 'id="aimeat-app-ref"';
  /** The text inside the served ref block, exactly as a script would read it. */
  function refText(out: string): string {
    const m = /<script type="application\/json" id="aimeat-app-ref">([\s\S]*?)<\/script>/.exec(out);
    expect(m, 'no ref block in the output').toBeTruthy();
    return m![1];
  }

  it('lands in the head, ahead of every script the app wrote', () => {
    const doc = '<!DOCTYPE html><html lang="fi"><head><meta charset="utf-8"><script>var early = 1;</script>'
      + '<title>t</title></head><body><script>var ref = document.getElementById("aimeat-app-ref");</script></body></html>';
    const out = applyServeMarks(doc, { discovery }).toString('utf-8');
    const at = out.indexOf(REF);
    expect(at).toBeGreaterThan(out.indexOf('<head>'));
    expect(at).toBeLessThan(out.indexOf('<script>var early'));
    expect(at).toBeLessThan(out.indexOf('</head>'));
    // The script-free half stays where a text extractor reads it: after the app, in the body.
    expect(out.indexOf('<noscript id="aimeat-agent-discovery">')).toBeGreaterThan(out.indexOf('var ref ='));
    expect(out.split(REF).length).toBe(2);
  });

  it('parses as JSON exactly as served, even when a value carries markup characters', () => {
    const out = applyServeMarks('<html><head></head><body></body></html>',
      { discovery: { ...discovery, filename: 'a&b"<c></script>.html' } }).toString('utf-8');
    const text = refText(out);
    expect(text).not.toContain('<');
    const ref = JSON.parse(text);
    expect(ref.owner).toBe('alice');
    expect(ref.app_id).toBe('a&b"<c></script>.html');
  });

  it('in a document with no head element, sits after the doctype and before the first script', () => {
    const doc = '<!DOCTYPE html><meta charset="utf-8"><script>go()</script><body><div id="app"></div></body>';
    const out = applyServeMarks(doc, { discovery }).toString('utf-8');
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.indexOf(REF)).toBeLessThan(out.indexOf('<script>go()'));
  });

  it('in a tagless document, comes first, before anything the app wrote', () => {
    const doc = '<meta charset="utf-8"><title>NOSTE</title><script>go()</script><div id="app"></div>';
    const out = applyServeMarks(doc, { discovery, isDocument: true }).toString('utf-8');
    expect(out.indexOf(REF)).toBeLessThan(out.indexOf('<meta charset'));
  });

  it('never lands inside a <head> the app wrote into its own JavaScript', () => {
    const doc = '<html><body><script>var tpl = "<head></head>";</script></body></html>';
    const out = applyServeMarks(doc, { discovery }).toString('utf-8');
    expect(out).toContain('<script>var tpl = "<head></head>";</script>');
    expect(out.indexOf(REF)).toBeLessThan(out.indexOf('<body>'));
  });

  it('is added once when an already-served document is served again', () => {
    const doc = '<!DOCTYPE html><html><head><title>t</title></head><body><p>x</p></body></html>';
    const once = applyServeMarks(doc, { discovery }).toString('utf-8');
    const twice = applyServeMarks(once, { discovery }).toString('utf-8');
    expect(twice).toBe(once);
  });
});
