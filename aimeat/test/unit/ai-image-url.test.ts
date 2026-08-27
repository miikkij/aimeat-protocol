/**
 * @file test/unit/ai-image-url.test.ts
 * @description The one lesson of the first imagery-pipeline demo, as a test: a public image's URL
 *   must be the anonymous /v1/pub/ form, because /v1/storage/ is owner-authenticated and a
 *   "publicly readable" URL that 401s for every visitor is worse than no URL at all. The demo
 *   shipped exactly that into a live app before anyone noticed.
 * @usage cd aimeat && pnpm test -- ai-image-url
 * @version-history
 *   v1.0.0 — 2026-08-28 — initial.
 */
import { describe, it, expect } from 'vitest';
import { imageFetchUrl } from '../../src/services/ai-image.js';

describe('imageFetchUrl — the URL that loads for the visibility\'s audience', () => {
  const gaii = 'happydude500001@aimeat-finland-001-genesis';

  it('a public image gets the anonymous /v1/pub/ form', () => {
    expect(imageFetchUrl('public', gaii, 'atelier-demo/hero.jpg'))
      .toBe('/v1/pub/happydude500001%40aimeat-finland-001-genesis/atelier-demo/hero.jpg');
  });

  it('a private image stays on the owner-authenticated /v1/storage/ form', () => {
    expect(imageFetchUrl('private', gaii, 'ai-images/x.png')).toBe('/v1/storage/ai-images/x.png');
  });

  it('encodes each key segment, keeping the slashes readable', () => {
    expect(imageFetchUrl('public', 'a#b@node', 'dir with space/img 1.png'))
      .toBe('/v1/pub/a%23b%40node/dir%20with%20space/img%201.png');
  });
});
