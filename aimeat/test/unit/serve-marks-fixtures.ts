/**
 * @file test/unit/serve-marks-fixtures.ts
 * @description The documents and specs the serve-time-marks parity test runs over — shared by the
 *   test and by the one-off golden generator, so the "before" bytes and the "after" bytes are
 *   produced from the SAME inputs. Each case is here because it is a trap that has already cost us
 *   an app: JavaScript containing the literal `</body>`, a single-file app with no `<head>`, a
 *   payload that is not a document at all, and a document being served a second time.
 * @structure SERVE_MARK_CASES — [{ name, html, spec }]; provFixture() — a ServedProvenance stub.
 * @usage import { SERVE_MARK_CASES } from './serve-marks-fixtures.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: proof that consolidating the four injectors
 *     into one pass changes not one byte of what a visitor receives.
 */
import type { AimeatConfig } from '../../src/config.js';
import type { ServedProvenance } from '../../src/services/ai-provenance-marks.js';
import type { AppDiscoverySpec } from '../../src/utils/app-agent-discovery.js';
import type { AppHeadSpec } from '../../src/utils/app-head-meta.js';

export const FIXTURE_CONFIG = { baseUrl: 'https://aimeat.io', nodeId: 'aimeat-fi-001-genesis' } as unknown as AimeatConfig;

/** A record that OWES a visible label, and one that does not. Both shapes are served in practice. */
export function provFixture(kind: 'labelled' | 'quiet'): ServedProvenance {
  return {
    id: 'prov_fixture_1',
    recordUrl: 'https://aimeat.io/v1/provenance/prov_fixture_1',
    record: {
      spec: 'aimeat.provenance/v1',
      level: kind === 'labelled' ? 'ai-generated' : 'assisted',
      humanInvolvement: kind === 'labelled' ? 'none' : 'editorial-control',
      generatedAt: '2026-08-01T12:00:00.000Z',
      generator: { model: 'anthropic/claude-opus-5', provider: 'openrouter' },
      disclosure: kind === 'labelled'
        ? {
            required: true, strength: 'full', reason: 'art50_4_public_interest',
            short: { en: 'AI-generated', fi: 'Tekoälyn tuottama' },
          }
        : { required: false, strength: 'none', reason: 'none' },
    },
  } as ServedProvenance;
}

const DISCOVERY: AppDiscoverySpec = {
  owner: 'alice', filename: 'demo.html', appName: 'Demo', description: 'A demo app',
  baseUrl: 'https://aimeat.io', toolNames: ['search', 'summarise'], webmcp: true,
};

const HEAD: AppHeadSpec = {
  owner: 'alice', filename: 'demo.html', appName: 'Demo', description: 'A demo app',
  origin: 'https://demo.apps.aimeat.io', baseUrl: 'https://aimeat.io',
  tools: [{ name: 'search', description: 'Search it', morsels: 5 }],
  updatedAt: '2026-07-30T09:00:00.000Z',
};

export interface ServeMarkCase {
  name: string;
  html: string;
  badge: boolean;
  prov?: 'labelled' | 'quiet';
  visible?: boolean;
  discovery?: AppDiscoverySpec;
  headMeta?: AppHeadSpec;
}

const FULL_DOC = '<!DOCTYPE html><html lang="fi"><head><meta charset="utf-8"><title>Demo</title></head>'
  + '<body><h1>Hei</h1></body></html>';
// The fatalii drum-slicer trap: app JS carrying the literal closing tag.
const JS_CLOSING_TAG = '<!DOCTYPE html><html><head><title>T</title></head><body><script>'
  + 'var page = "<html><body>generated</bo" + "dy></html>";</scr' + 'ipt></body></html>';
// The commonest single-file-app shape: no doctype, no <html>, no <head> — but a real </body>, which
// is what makes it a document the injectors act on at all.
const HEADLESS = '<meta charset="utf-8"><title>Frag</title><body><div id="app"></div></body>';
// The same shape WITHOUT any closing tag: every injector declines it, and that is the answer.
const FRAGMENT = '<meta charset="utf-8"><title>Frag</title><div id="app"></div>';
// A document that closes </html> but never </body>.
const NO_BODY_CLOSE = '<!DOCTYPE html><html><head><title>T</title></head><body><p>x</html>';
const NOT_A_DOCUMENT = '{"kind":"not html","body":"</body>"}';
const OWN_JSONLD = '<!DOCTYPE html><html><head><script type="application/ld+json">{"@type":"Thing"}</script>'
  + '</head><body>x</body></html>';

export const SERVE_MARK_CASES: ServeMarkCase[] = [
  { name: 'full-doc/badge-only', html: FULL_DOC, badge: true },
  { name: 'full-doc/badge+quiet-prov', html: FULL_DOC, badge: true, prov: 'quiet' },
  { name: 'full-doc/badge+labelled-prov', html: FULL_DOC, badge: true, prov: 'labelled' },
  { name: 'full-doc/badge+labelled-prov+visible', html: FULL_DOC, badge: true, prov: 'labelled', visible: true },
  { name: 'full-doc/all-four', html: FULL_DOC, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'full-doc/no-prov+discovery+head', html: FULL_DOC, badge: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'js-closing-tag/all-four', html: JS_CLOSING_TAG, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'headless/all-four', html: HEADLESS, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'headless/head-meta-only', html: HEADLESS, badge: false, headMeta: HEAD },
  { name: 'headless/badge+prov', html: HEADLESS, badge: true, prov: 'labelled', visible: true },
  { name: 'fragment/all-four', html: FRAGMENT, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'no-body-close/all-four', html: NO_BODY_CLOSE, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'not-a-document/all-four', html: NOT_A_DOCUMENT, badge: true, prov: 'labelled', visible: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'own-jsonld/head-meta', html: OWN_JSONLD, badge: true, discovery: DISCOVERY, headMeta: HEAD },
  { name: 'own-jsonld/prov-then-head-meta', html: OWN_JSONLD, badge: true, prov: 'labelled', discovery: DISCOVERY, headMeta: HEAD },
  { name: 'full-doc/portfolio-badge-no-app-spec', html: FULL_DOC, badge: true },
  { name: 'full-doc/prov-without-badge', html: FULL_DOC, badge: false, prov: 'labelled', visible: true },
];
