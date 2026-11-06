/**
 * @file test/unit/asset-version.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A file's `?v=` tag changes when its bytes change and at no other time (TARGET-090 Y2).
 *   The build stamp it replaced changed on every deploy for every file, and Search Console listed
 *   4 515 such addresses as crawled and not indexed on 2026-11-05.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assetTag, createAssetVersioner } from '../../src/utils/asset-version.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-version-'));
  mkdirSync(join(root, 'js'));
  writeFileSync(join(root, 'js', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'secret.txt'), 'outside the public path');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('createAssetVersioner', () => {
  it('answers the content hash of the file', () => {
    const v = createAssetVersioner(root, { frozen: false });
    expect(v('/js/a.js')).toBe(`?v=${assetTag('export const a = 1;\n')}`);
  });

  it('answers the same tag for the same bytes, in a new process and after a touch', () => {
    const first = createAssetVersioner(root, { frozen: false })('/js/a.js');
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'js', 'a.js'), later, later);
    expect(createAssetVersioner(root, { frozen: false })('/js/a.js')).toBe(first);
  });

  it('answers a new tag when the bytes change, without a restart', () => {
    const v = createAssetVersioner(root, { frozen: false });
    const before = v('/js/a.js');
    writeFileSync(join(root, 'js', 'a.js'), 'export const a = 2; // longer\n');
    expect(v('/js/a.js')).not.toBe(before);
  });

  it('keeps the first tag in a frozen tree, where the files do not change under the process', () => {
    const v = createAssetVersioner(root, { frozen: true });
    const before = v('/js/a.js');
    writeFileSync(join(root, 'js', 'a.js'), 'export const a = 2; // longer\n');
    expect(v('/js/a.js')).toBe(before);
  });

  it('answers null for a missing file, a directory, and a path that leaves the root', () => {
    const v = createAssetVersioner(join(root, 'js'), { frozen: false });
    expect(v('/missing.js')).toBeNull();
    expect(v('/')).toBeNull();
    expect(v('/../secret.txt')).toBeNull();
    expect(v('js/a.js')).toBeNull();
    expect(createAssetVersioner(undefined, { frozen: true })('/js/a.js')).toBeNull();
  });
});
