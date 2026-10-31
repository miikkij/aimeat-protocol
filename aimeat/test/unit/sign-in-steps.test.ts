/**
 * @file test/unit/sign-in-steps.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The server's list of sign-in step addresses (src/data/sign-in-steps.ts) is the same
 *   as the browser's SIGN_IN_STEPS (public/js/site.js), and the portal serves the shell on every one
 *   of them. The server list hides the static developer footer on those addresses (v27 follow-up B);
 *   a step added to one list only would show the links again, or ask for a sign-in on a step of signing in.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIGN_IN_STEP_PATHS } from '../../src/data/sign-in-steps.js';
import { SPA_PAGE_PATHS } from '../../src/data/spa-page-paths.js';

const SITE_JS = readFileSync(join(__dirname, '..', '..', 'public', 'js', 'site.js'), 'utf-8');

describe('the sign-in step addresses', () => {
  it('are the same on the server and in the browser', () => {
    const list = /export const SIGN_IN_STEPS = new Set\(\[([^\]]*)\]\)/.exec(SITE_JS)?.[1] ?? '';
    const browser = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(browser.length).toBeGreaterThan(0);
    expect([...SIGN_IN_STEP_PATHS].sort()).toEqual(browser);
  });

  it('are each served as the SPA shell', () => {
    expect([...SIGN_IN_STEP_PATHS].filter((p) => !SPA_PAGE_PATHS.includes(p))).toEqual([]);
  });
});
