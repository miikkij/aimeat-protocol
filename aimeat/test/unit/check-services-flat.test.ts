/**
 * @file test/unit/check-services-flat.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description scripts/check-services-flat.ts holds three counts: the flat .ts files in
 *   src/services/, the flat .ts files in src/routes/, and the config-*.ts files in src/. Each count
 *   refuses one new flat file above its own baseline, leaves subfolders and test files out, and the
 *   tree as it is passes.
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 5).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PLACES, evaluate, flatFiles, type Place } from '../../scripts/check-services-flat.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A throwaway aimeat/ with the three folders and the given files (paths relative to aimeat/). */
function tree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'services-flat-'));
  roots.push(root);
  for (const dir of ['src/services', 'src/routes', 'src/services/domain', 'src/routes/domain', 'src/config']) mkdirSync(join(root, dir), { recursive: true });
  for (const f of files) writeFileSync(join(root, f), '');
  return root;
}

const place = (label: string): Place => {
  const p = PLACES.find(x => x.label === label);
  if (!p) throw new Error(`no place ${label}`);
  return p;
};

const verdict = (root: string, p: Place, baseline: number) =>
  evaluate([{ place: { ...p, baseline }, count: flatFiles(root, p).length }]);

describe('check:services-flat', () => {
  it('holds three places, each with its own baseline', () => {
    expect(PLACES.map(p => p.label)).toEqual(['src/services/', 'src/routes/', 'src/config-*.ts']);
    for (const p of PLACES) expect(p.baseline).toBeGreaterThan(0);
  });

  it('src/services/: a new flat file above the baseline is refused', () => {
    const p = place('src/services/');
    const at = tree(['src/services/a.ts', 'src/services/b.ts', 'src/services/domain/c.ts', 'src/services/d.test.ts']);
    expect(flatFiles(at, p)).toEqual(['a.ts', 'b.ts']);
    expect(verdict(at, p, 2).ok).toBe(true);
    const above = tree(['src/services/a.ts', 'src/services/b.ts', 'src/services/new.ts']);
    const v = verdict(above, p, 2);
    expect(v.ok).toBe(false);
    expect(v.lines[0]).toContain('src/services/ has 3 flat files, above the baseline of 2');
  });

  it('src/routes/: a new flat file above the baseline is refused', () => {
    const p = place('src/routes/');
    const at = tree(['src/routes/a.ts', 'src/routes/domain/b.ts']);
    expect(flatFiles(at, p)).toEqual(['a.ts']);
    expect(verdict(at, p, 1).ok).toBe(true);
    const above = tree(['src/routes/a.ts', 'src/routes/new.ts']);
    const v = verdict(above, p, 1);
    expect(v.ok).toBe(false);
    expect(v.lines[0]).toContain('src/routes/ has 2 flat files, above the baseline of 1');
  });

  it('src/config-*.ts: a new config-<topic>.ts above the baseline is refused; other src/ files do not count', () => {
    const p = place('src/config-*.ts');
    const at = tree(['src/config.ts', 'src/config-types.ts', 'src/server.ts', 'src/config/topic.ts']);
    expect(flatFiles(at, p)).toEqual(['config-types.ts']);
    expect(verdict(at, p, 1).ok).toBe(true);
    const above = tree(['src/config.ts', 'src/config-types.ts', 'src/config-new-topic.ts']);
    const v = verdict(above, p, 1);
    expect(v.ok).toBe(false);
    expect(v.lines[0]).toContain('src/config-*.ts has 2 flat files, above the baseline of 1');
  });

  it('a count below its baseline passes and names the number to lower it to', () => {
    const p = place('src/routes/');
    const v = verdict(tree(['src/routes/a.ts']), p, 5);
    expect(v.ok).toBe(true);
    expect(v.lines[0]).toContain('lower its baseline in scripts/check-services-flat.ts to 1');
  });

  it('the tree as it is passes all three', () => {
    const aimeat = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
    const v = evaluate(PLACES.map(p => ({ place: p, count: flatFiles(aimeat, p).length })));
    expect(v.lines).toHaveLength(3);
    expect(v.ok).toBe(true);
  });
});
