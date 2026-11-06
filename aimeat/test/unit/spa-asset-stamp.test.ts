/**
 * @file test/unit/spa-asset-stamp.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shell's first-party assets carry a version tag, every stylesheet as well as
 *   every module. New markup with old stylesheets breaks a page: on 2026-09-23 a browser kept the
 *   old poster.css and component sheets (unstamped) while it ran the new JS (stamped), and the home's
 *   prompt card and playbook list fell apart. A deploy must serve new CSS with the markup that needs it.
 *
 *   Since 2026-11-06 the tag is each file's content hash (TARGET-090 Y2): an unchanged file keeps
 *   its address across deploys, and the build stamp is only the fallback for a path with no file.
 * @version-history
 *   v1.1.0 — 2026-11-06 — Content tags from utils/asset-version.ts; every view the shell imports
 *     dynamically is an importmap entry, imported without a query of its own.
 *   v1.0.0 — 2026-09-23 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampAssets } from '../../src/routes/portal-spa.js';
import { assetTag, createAssetVersioner } from '../../src/utils/asset-version.js';

const PUBLIC = join(__dirname, '..', '..', 'public');
const SPA = readFileSync(join(PUBLIC, 'spa.html'), 'utf-8');
const V = '?v=testbuild';

describe('stampAssets with the build stamp alone', () => {
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

describe('stampAssets with content tags (TARGET-090 Y2)', () => {
  const versionOf = createAssetVersioner(PUBLIC, { frozen: true });
  const html = stampAssets(SPA, V, versionOf);

  it('tags each module and stylesheet with the hash of its own file', () => {
    const map = /"imports"\s*:\s*\{([\s\S]*?)\}/.exec(html)?.[1] ?? '';
    const modules = [...map.matchAll(/:\s*"(\/[^"?]+\.m?js)(\?v=[^"]*)"/g)].map((m) => [m[1], m[2]]);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="(\/(?!\/)[^"?]+\.css)(\?v=[^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(modules.length).toBeGreaterThan(500);
    expect(sheets.length).toBeGreaterThan(100);
    const wrong = [...modules, ...sheets].filter(([path, q]) => q !== `?v=${assetTag(readFileSync(join(PUBLIC, path)))}`);
    expect(wrong).toEqual([]);
  });

  it('gives two different files two different tags, and none of them the build stamp', () => {
    expect(html).not.toContain(V);
    expect(versionOf('/components/Mark.js')).not.toBe(versionOf('/css/poster.css'));
  });

  it('falls back to the build stamp for a path with no file under public/', () => {
    const out = stampAssets('<link rel="stylesheet" href="/css/no-such-sheet.css">', V, versionOf);
    expect(out).toBe(`<link rel="stylesheet" href="/css/no-such-sheet.css${V}">`);
  });
});

describe('the views the shell imports on demand', () => {
  const routes = SPA.slice(SPA.indexOf('const ROUTES = {'));
  const targets = [...new Set([...routes.matchAll(/import\('(\/views\/[^']+)'(?:\s*\+[^)]*)?\)/g)].map((m) => m[1]))];

  it('are each an importmap entry, so they get a content tag', () => {
    expect(targets.length).toBeGreaterThan(40);
    const map = /"imports"\s*:\s*\{([\s\S]*?)\}/.exec(SPA)?.[1] ?? '';
    expect(targets.filter((p) => !map.includes(`"${p}": "${p}"`))).toEqual([]);
  });

  it('are imported without a query of their own, which would bypass the importmap', () => {
    expect([...routes.matchAll(/import\('\/views\/[^']+'\s*\+/g)].map((m) => m[0])).toEqual([]);
  });
});
