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
