/**
 * @file test/unit/showroom-cortex-source.test.ts
 * @description The apex page /showroom.html loads the bundled cortex libraries from the node's own
 *   static copy (/cortex-bundled/<name>.js). /v1/cortex/<name>/libs serves whichever active cortex
 *   holds the name, so it is only the fallback when the static copy does not load (the page's
 *   published single-file copy on another origin).
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, showroom cortex by unreserved global name).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../public/showroom.js'), 'utf-8');
const body = src.slice(src.indexOf('function loadScript'), src.indexOf('function ns('));

/** loadCortex against a document whose scripts load when their address is in `present`. */
function harness(present: (url: string) => boolean) {
  const requested: string[] = [];
  const document = {
    createElement: () => ({} as { src?: string; onload?: () => void; onerror?: () => void }),
    head: {
      appendChild(s: { src: string; onload: () => void; onerror: () => void }) {
        requested.push(s.src);
        queueMicrotask(() => (present(s.src) ? s.onload() : s.onerror()));
      },
    },
  };
  const loadCortex = new Function('document', `${body}; return loadCortex;`)(document) as (n: string) => Promise<{ via: string }>;
  return { loadCortex, requested };
}

describe('showroom loads the bundled libraries', () => {
  it('asks for the node\'s own static copy first, and nothing else when it loads', async () => {
    const h = harness(() => true);
    const r = await h.loadCortex('aimeat-ui-nav');
    expect(h.requested).toEqual(['/cortex-bundled/aimeat-ui-nav.js']);
    expect(r.via).toBe('cortex-bundled');
  });

  it('falls back to /v1/cortex only when the static copy does not load', async () => {
    const h = harness((u) => u.startsWith('/v1/'));
    const r = await h.loadCortex('aimeat-charts');
    expect(h.requested).toEqual(['/cortex-bundled/aimeat-charts.js', '/v1/cortex/aimeat-charts/libs/aimeat-charts.js']);
    expect(r.via).toBe('v1/cortex');
  });
});
