/**
 * @file feature-map-stamp.test.ts
 * @description The capability map's `start` heading states the build stamp as text, and the stamp
 *   carries the node's own version from package.json (feature-list audit #5: the heading read
 *   "[object Object]" and the stamp said 3.26.1 on a 4.0.3 node).
 * @structure stampText · start heading · stamp version
 * @usage pnpm exec vitest run test/unit/feature-map-stamp.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #5).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { featureMapPiece, stampText } from '../../src/services/feature-map.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../../package.json')) as { version: string };
const guide = JSON.parse(read('../../public/data/everything.json')) as { stamp: { version: string; date: string } | null; intro: string[] };

describe('the capability map stamp', () => {
  it('formats an object stamp as text, and nothing for no stamp', () => {
    expect(stampText({ version: '4.0.3', date: '2026-10-12' })).toBe('node 4.0.3, checked 2026-10-12');
    expect(stampText(null)).toBe('');
    expect(stampText(undefined)).toBe('');
  });

  it('the start heading carries the stamp as text, never "[object Object]"', () => {
    const heading = featureMapPiece('start')!.text.split('\n')[0]!;
    expect(heading).not.toContain('[object Object]');
    expect(heading).toContain(`node ${pkg.version}`);
  });

  it('the built stamp and the rendered header line carry the package version', () => {
    expect(guide.stamp?.version).toBe(pkg.version);
    expect(guide.intro.join(' ')).toContain(`Node version ${pkg.version},`);
  });
});
