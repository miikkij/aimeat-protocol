/**
 * @file test/unit/kept-asset-tag.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address the browser may keep for good (server-bootstrap/static-files.ts,
 *   2026-11-09): a module asked for under its current content tag, and nothing else. A page from
 *   before a deploy asks for an old tag, and must get the new bytes without the long cache, so that
 *   no browser keeps new bytes under an old address.
 * @usage cd aimeat && pnpm exec vitest run test/unit/kept-asset-tag.test.ts
 * @version-history
 *   2026-11-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assetTag } from '../../src/utils/asset-version.js';
import { isCurrentAssetTag } from '../../src/routes/portal-spa.js';

const PATH = '/js/api.js';
const current = assetTag(readFileSync(new URL('../../public/js/api.js', import.meta.url)));

describe('isCurrentAssetTag', () => {
  it('is true for the tag the file has now', () => {
    expect(isCurrentAssetTag(PATH, current)).toBe(true);
  });

  it('is false for another tag, no tag, a build stamp, and a path that is no file', () => {
    expect(isCurrentAssetTag(PATH, current.split('').reverse().join(''))).toBe(false);
    expect(isCurrentAssetTag(PATH, '')).toBe(false);
    expect(isCurrentAssetTag(PATH, 'mw8u39xo')).toBe(false);
    expect(isCurrentAssetTag('/js/no-such-file.js', current)).toBe(false);
    expect(isCurrentAssetTag('/../package.json', current)).toBe(false);
  });
});
