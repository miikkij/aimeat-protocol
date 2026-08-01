/**
 * @file test/unit/app-badge-encoding.test.ts
 * @description The attribution badge and the AI-transparency label are injected into SOMEBODY ELSE'S
 *   document, and that document is served as `text/html` with no charset parameter. Most single-file
 *   apps declare no `<meta charset>` of their own either, so a browser falls back to windows-1252 and
 *   any raw UTF-8 byte we injected is decoded wrongly.
 *
 *   That is not hypothetical: the badge shipped for months rendering as
 *   "âš¡ aimeat.io Â· Publish your own app â€" free" on every app without a charset declaration, and
 *   it was spotted in a browser rather than by any test. This file is the test that would have caught
 *   it — the rule it encodes is simply "nothing we inject into an app document may contain a
 *   non-ASCII byte".
 *
 *   It matters far more for the AI label than for the badge: a mangled lightning bolt is ugly, and a
 *   compliance statement reading "TekoÃ¤lyn tuottama" is a legal disclosure a Finnish reader cannot
 *   read.
 * @structure
 *   - the badge is pure ASCII, and still carries the glyphs as entities
 *   - the visible AI label is pure ASCII in both locales
 * @usage pnpm exec vitest run test/unit/app-badge-encoding.test.ts
 * @version-history
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: driven through applyServeMarks(), the single
 *     serve-time pass that replaced the four injectors. Same assertions, same bytes.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4 step 0c: the em-dash assertion flips from "present as an
 *     entity" to ABSENT. Escaping it still renders the banned character, so the badge was reworded.
 *   v1.0.0 — 2026-08-01 — Written after the mojibake was seen in a real browser.
 */
import { describe, it, expect } from 'vitest';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import type { ServedProvenance } from '../../src/services/ai-provenance-marks.js';
import { AI_PROVENANCE_SPEC_V1, type AiProvenance } from '../../src/models/ai-provenance-schemas.js';
import type { AimeatConfig } from '../../src/config.js';

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>';

/** Every byte outside printable ASCII, with a little context so a failure is readable. */
function nonAscii(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/[^\x09\x0A\x0D\x20-\x7E]/g)) {
    out.push(`${JSON.stringify(m[0])} at …${html.slice(Math.max(0, m.index - 30), m.index + 10)}…`);
  }
  return out;
}

describe('the attribution badge survives a document with no charset', () => {
  const html = applyServeMarks(DOC, { badge: true }).toString('utf-8');

  it('injects no non-ASCII byte at all', () => {
    expect(nonAscii(html)).toEqual([]);
  });

  it('still carries the glyphs it keeps — as entities, not as missing characters', () => {
    expect(html).toContain('&#9889;');  // ⚡
    expect(html).toContain('&#183;');   // ·
  });

  // The em dash is gone from the WORDING, not merely escaped. Encoding it produced `&#8212;`, which
  // a browser renders as exactly the character the house style bans — so the fix had to be a reword
  // ("Publish your own app for free"). Asserted as an absence so re-introducing it fails here.
  it('contains no em dash, encoded or otherwise', () => {
    expect(html).not.toContain('&#8212;');
    expect(html).not.toContain('&mdash;');
    expect(html).not.toContain('—');
  });

  it('and still carries the badge itself', () => {
    expect(html).toContain('id="aimeat-app-badge"');
    expect(html).toContain('https://aimeat.io/');
  });
});

describe('the visible AI label survives it too, in every language the node ships', () => {
  const record: AiProvenance = {
    spec: AI_PROVENANCE_SPEC_V1,
    level: 'ai-generated',
    humanInvolvement: 'none',
    generatedAt: '2026-08-01T18:42:00Z',
    disclosure: {
      required: true, reason: 'art50_4_public_interest', strength: 'full',
      short: { en: 'AI-generated', fi: 'Tekoälyn tuottama' },
      long: { en: 'Written by AI.', fi: 'Tekoälyn kirjoittama.' },
    },
  };
  const served: ServedProvenance = {
    id: 'r1', record, recordUrl: 'https://aimeat.io/v1/provenance/r1',
  };
  const config = { baseUrl: 'https://aimeat.io', aiProvenanceDetail: 'full' } as AimeatConfig;

  for (const locale of ['en', 'fi'] as const) {
    it(`${locale}: no non-ASCII byte reaches the app document`, () => {
      const html = applyServeMarks(DOC, { provenance: served, visibleLabel: { config, locale } }).toString('utf-8');
      expect(nonAscii(html)).toEqual([]);
      expect(html).toContain('id="aimeat-ai-label"');
    });
  }

  it('fi: the Finnish compliance string is present as entities, not dropped', () => {
    const html = applyServeMarks(DOC, { provenance: served, visibleLabel: { config, locale: 'fi' } }).toString('utf-8');
    // "Tekoälyn tuottama" — the ä as &#228;.
    expect(html).toContain('Teko&#228;lyn tuottama');
  });
});
