/**
 * @file test/unit/dependency-map-packs.test.ts
 * @description An app uses a library pack when it loads the pack's OWN file, and not when it loads
 *   something the pack also needs.
 *
 *   A pack's `include` lists its prerequisites beside its own file: aimeat-voice names
 *   aimeat-auth.js first, aimeat-living names the Atelier stylesheet and script. The extractor said
 *   "uses the pack" when ANY of those paths was in the page, so every app that signs people in was
 *   recorded as using the voice library and every Atelier app as using aimeat-living. Measured on
 *   aimeat.io on 2026-09-19: the research call listed aimeat-voice, aimeat-living and aimeat-data
 *   for an app that loads none of the three, and a builder that read it reported the lie.
 * @usage cd aimeat && pnpm vitest run test/unit/dependency-map-packs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial; the first unit test this module has.
 */
import { describe, it, expect } from 'vitest';
import { extractDependencies } from '../../src/services/dependency-map.js';

const packs = (html: string) => extractDependencies(html).packs.map(p => p.name).sort();

/** The head and scripts of the live app the false report was about. */
const DECISION_APP = `<link href="/lib/aimeat-atelier.css" rel="stylesheet" />
<script src="/lib/aimeat-boot.js"></script>
<script src="/v1/libs/aimeat-auth.js"></script>
<script src="/v1/libs/aimeat-atelier.js"></script>
<script src="/v1/libs/aimeat-decide.js"></script>
<script src="/v1/libs/aimeat-prompt.js"></script>`;

describe('what an app is recorded as using', () => {
  it('is what it loads: the live app that was reported wrongly', () => {
    expect(packs(DECISION_APP)).toEqual(['aimeat-atelier', 'aimeat-auth', 'aimeat-decide', 'aimeat-prompt']);
  });

  it('a prerequisite alone is not the pack that needs it', () => {
    expect(packs('<script src="/v1/libs/aimeat-auth.js"></script>')).toEqual(['aimeat-auth']);
    expect(packs('<link href="/lib/aimeat-atelier.css" rel="stylesheet" /><script src="/v1/libs/aimeat-atelier.js"></script>')).toEqual(['aimeat-atelier']);
  });

  it('the pack IS recorded when its own file is there, with its prerequisites', () => {
    expect(packs('<script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-voice.js"></script>')).toEqual(['aimeat-auth', 'aimeat-voice']);
    expect(packs(DECISION_APP + '<script src="/v1/libs/aimeat-living.js"></script>')).toContain('aimeat-living');
  });

  it('a pack made of several files with no file named after it is still found by any of them', () => {
    expect(packs('<link href="/lib/daisyui@5.css" rel="stylesheet" />')).toContain('styling');
  });

  it('two versions of one engine stay two packs', () => {
    expect(packs('<script src="/lib/phaser@4.min.js"></script>')).not.toContain('phaser');
  });
});
