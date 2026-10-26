/**
 * @file front-pages-webmcp.test.ts
 * @description Every static front page the root can serve loads the WebMCP library with the
 *   node-level tools, as spa.html does. From 2026-10-21 aimeat.io served front-start.html at `/`
 *   (AIMEAT_FRONT_PAGE=start), which loaded only its own script, so isitagentready.com reported "No
 *   WebMCP tools detected on page load" although the library and spa.html had them. The page list is
 *   read from config.ts, so a fourth static front page joins this test without an edit here.
 * @usage pnpm exec vitest run test/unit/front-pages-webmcp.test.ts
 * @version-history
 *   2026-10-26 — Initial (wish-webmcp-n-kyy-my-s-staattisilla-etusivuilla).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const TAG = '<script src="/v1/libs/aimeat-webmcp.js?expose=node" defer></script>';

/** The AIMEAT_FRONT_PAGE values that serve a static page (every value but 'classic'), read out of config.ts. */
function staticFrontPages(): string[] {
  const src = readFileSync(new URL('../../src/config.ts', import.meta.url), 'utf8');
  const m = src.match(/frontPage:\s*\(\[([^\]]+)\]\.includes\(process\.env\.AIMEAT_FRONT_PAGE/);
  expect(m, 'the frontPage switch was not found in config.ts').toBeTruthy();
  return [...m![1]!.matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]!);
}

describe('the static front pages', () => {
  const pages = staticFrontPages();

  it('are the three the root switch knows today', () => {
    expect(pages.sort()).toEqual(['demo', 'os', 'start']);
  });

  for (const page of pages) {
    for (const file of [`front-${page}.html`, `front-${page}.fi.html`]) {
      it(`${file} loads the WebMCP library with the node tools`, () => {
        const url = new URL(`../../public/${file}`, import.meta.url);
        expect(existsSync(url), `${file} is missing`).toBe(true);
        const html = readFileSync(url, 'utf8');
        const head = html.slice(0, html.indexOf('</head>'));
        expect(head).toContain(TAG);
      });
    }
  }

  it('spa.html loads the same tag', () => {
    const html = readFileSync(new URL('../../public/spa.html', import.meta.url), 'utf8');
    expect(html).toContain(TAG);
  });
});
