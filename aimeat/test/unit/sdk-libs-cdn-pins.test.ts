/**
 * @file test/unit/sdk-libs-cdn-pins.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The served libraries (src/static/sdk-libs) run on every app origin that loads them,
 *   with that app's session. A third-party script they load from a CDN by a major-version range
 *   (`markdown-it@14`, `dompurify@3`, `@codemirror/lang-markdown@6`) is whatever the newest release in
 *   that range is on the day a visitor opens the app, so a new release, by its publisher or by whoever
 *   takes over the publisher's account, ran on every app that renders rich markdown, DOMPurify, the
 *   sanitizer of that path, among them (secaudit2026oct26,
 *   sdk-libs/markdown/index.js:ensureRich:floating-cdn-without-integrity). Every CDN script address in
 *   the library sources names one exact version.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-libs-cdn-pins.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../src/static/sdk-libs', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'dist' && name !== 'node_modules') out.push(...sources(p)); }
    else if (/\.(js|mjs|ts)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every jsDelivr npm or esm.sh address, with the version it names (or none). */
function cdnRefs(): Array<{ file: string; url: string; version: string | null }> {
  const refs: Array<{ file: string; url: string; version: string | null }> = [];
  const re = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|esm\.sh)\/((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@([^/'"`\s?]+))?/gi;
  for (const file of sources(ROOT)) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) refs.push({ file: relative(ROOT, file), url: m[0], version: m[2] ?? null });
  }
  return refs;
}

describe('the served libraries load third-party scripts by exact version', () => {
  it('finds the CDN addresses it checks', () => {
    expect(cdnRefs().length).toBeGreaterThan(0);
  });

  it('every CDN address names one exact version, never a range', () => {
    const floating = cdnRefs().filter(r => !r.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(r.version));
    expect(floating.map(r => `${r.file}: ${r.url}`)).toEqual([]);
  });
});
