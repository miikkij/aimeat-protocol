/**
 * @file test/unit/spa-asset-stamp.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shell's first-party assets carry the build stamp, every stylesheet as well as
 *   every module. New markup with old stylesheets breaks a page: on 2026-09-23 a browser kept the
 *   old poster.css and component sheets (unstamped) while it ran the new JS (stamped), and the home's
 *   prompt card and playbook list fell apart. A deploy must serve new CSS with the markup that needs it.
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampAssets } from '../../src/routes/portal-spa.js';

const SPA = readFileSync(join(__dirname, '..', '..', 'public', 'spa.html'), 'utf-8');
const V = '?v=testbuild';

describe('stampAssets', () => {
  const html = stampAssets(SPA, V);

  it('stamps every first-party stylesheet link in the shell', () => {
    const links = [...html.matchAll(/<link rel="stylesheet" href="(\/(?!\/)[^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(100);
    const unstamped = links.filter((href) => !href.endsWith(V));
    expect(unstamped).toEqual([]);
  });

  it('stamps every first-party importmap module', () => {
    const map = /"imports"\s*:\s*\{([\s\S]*?)\}/.exec(html)?.[1] ?? '';
    const values = [...map.matchAll(/:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(50);
    expect(values.filter((u) => /\.m?js/.test(u) && !u.endsWith(V))).toEqual([]);
  });

  it('leaves another origin alone', () => {
    const out = stampAssets('<link rel="stylesheet" href="//cdn.example/x.css">', V);
    expect(out).toBe('<link rel="stylesheet" href="//cdn.example/x.css">');
  });
});
