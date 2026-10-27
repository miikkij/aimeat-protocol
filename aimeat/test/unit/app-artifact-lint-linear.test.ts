/**
 * @file test/unit/app-artifact-lint-linear.test.ts
 * @description The publish-time asset scan (src/services/app-artifact-lint.ts collectAssetRefs) runs
 *   on the node's event loop before the write, so it reads the uploaded HTML in time linear in its
 *   size. A `<script` or `<link` opener with no `>` after it made the old patterns scan to the end of
 *   the text once per opener (secaudit2026oct26,
 *   aimeat/src/services/app-artifact-lint.ts:collectAssetRefs:unclosed-tag-quadratic-scan). The
 *   usage half: the scan still finds the stylesheet link with rel and href in either order, a
 *   script src in single or double quotes, and tells a broken node path, an external host and a
 *   relative path apart as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-artifact-lint-linear.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';

const config = { baseUrl: 'https://aimeat.io', port: 40050, appAssetProbe: false } as unknown as AimeatConfig;

const HEAD = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body>';

/** Milliseconds one lint of `html` takes. */
async function timed(html: string): Promise<number> {
  const t0 = performance.now();
  await lintAppArtifact(html, config);
  return performance.now() - t0;
}

describe('collectAssetRefs reads the HTML in linear time', () => {
  for (const opener of ['<link ', '<script ']) {
    it(`${opener.trim()} openers with no closing > do not cost a scan of the rest of the text each`, async () => {
      // 40,000 openers in about 240 KB: the quadratic scan takes many seconds here, a linear one a few
      // milliseconds. The bound is generous for a loaded machine and far below the quadratic cost.
      const ms = await timed(HEAD + opener.repeat(40_000));
      expect(ms).toBeLessThan(1_500);
    }, 60_000);
  }
});

describe('collectAssetRefs still finds what it found', () => {
  const ids = async (html: string) => {
    const r = await lintAppArtifact(html, config);
    return [...r.blocking, ...r.warnings].map(f => `${f.pitfall}:${f.message}`);
  };

  it('a stylesheet link with rel before href, and with href before rel, both name the external host', async () => {
    const a = await ids(`${HEAD}<link rel="stylesheet" href="https://cdn.example.com/a.css"></body></html>`);
    const b = await ids(`${HEAD}<link href='https://cdn.example.org/b.css' rel='stylesheet'></body></html>`);
    expect(a.some(m => m.startsWith('cdn-libs-blocked') && m.includes('cdn.example.com'))).toBe(true);
    expect(b.some(m => m.startsWith('cdn-libs-blocked') && m.includes('cdn.example.org'))).toBe(true);
  });

  it('a link that is not a stylesheet is not an asset', async () => {
    const a = await ids(`${HEAD}<link rel="icon" href="https://cdn.example.com/i.png"></body></html>`);
    expect(a.some(m => m.includes('cdn.example.com'))).toBe(false);
  });

  it('a script src in double or single quotes names the external host', async () => {
    const a = await ids(`${HEAD}<script src="https://cdn.example.com/a.js"></script></body></html>`);
    const b = await ids(`${HEAD}<script defer src='https://cdn.example.org/b.js'></script></body></html>`);
    expect(a.some(m => m.startsWith('cdn-libs-blocked') && m.includes('cdn.example.com'))).toBe(true);
    expect(b.some(m => m.startsWith('cdn-libs-blocked') && m.includes('cdn.example.org'))).toBe(true);
  });

  it('a relative script path is still warned about', async () => {
    const before = await ids(`${HEAD}<script src="app.js"></script></body></html>`);
    const none = await ids(`${HEAD}<script>var a = 1;</script></body></html>`);
    const extra = before.filter(m => !none.includes(m));
    expect(extra.length).toBeGreaterThan(0);
  });

  it('a later tag after an unclosed opener in an attribute value is read as the old patterns read it', async () => {
    // The old pattern resumed after the matched `>`; a `<script` inside an earlier tag's text is skipped the same way.
    const a = await ids(`${HEAD}<script src="https://cdn.example.com/a.js" data-x="<script src='https://cdn.example.net/n.js'>"></script></body></html>`);
    expect(a.some(m => m.includes('cdn.example.com') || m.includes('cdn.example.net'))).toBe(true);
  });
});
