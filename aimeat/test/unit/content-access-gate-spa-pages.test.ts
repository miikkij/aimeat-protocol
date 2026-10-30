/**
 * @file test/unit/content-access-gate-spa-pages.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a signed-in-only node, every page address the SPA shell serves passes the content
 *   access gate. A browser keeps its session in localStorage, so a page opened from a link carries no
 *   credential even for a signed-in person; a page address the gate does not know answers a JSON
 *   401 instead of the page. Seen on innokas.aimeat.io on 2026-10-30: the structure page link an AI
 *   handed out showed SIGN_IN_REQUIRED, while the same page opened through the catalogue worked.
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { isOpenRoute } from '../../src/middleware/content-access-gate.js';
import { SPA_PAGE_PATHS } from '../../src/data/spa-page-paths.js';

describe('the SPA page addresses on a signed-in-only node', () => {
  it.each(['/v1/appcat/structure', '/v1/secret-allow', '/v1/eco-capability-allow'])('passes %s', (path) => {
    expect(isOpenRoute('GET', path)).toBe(true);
  });

  it('passes every address the portal serves spa.html on', () => {
    const closed = SPA_PAGE_PATHS.filter(p => !isOpenRoute('GET', p));
    expect(closed).toEqual([]);
  });

  it.each(['/v1/appcat/structure/x', '/v1/appcatx', '/v1/appcat.structure', '/v1/apps'])('keeps %s closed', (path) => {
    expect(isOpenRoute('GET', path)).toBe(false);
  });

  it('passes no write to a page address', () => {
    expect(isOpenRoute('POST', '/v1/appcat/structure')).toBe(false);
  });
});
