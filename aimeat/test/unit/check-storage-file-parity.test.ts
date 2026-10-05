/**
 * @file test/unit/check-storage-file-parity.test.ts
 * @description Proof that `pnpm check:storage-file-parity` fails on each thing it names: a method in a
 *   different file than its twin, a methods file with no twin, a provider-specific member that is gone
 *   or defined on both sides, and a spread member; and that it accepts a `<name>-2.ts` split part. Each
 *   case is a small tree of fixture files in a temporary directory, so nothing in the real tree is
 *   touched. The last case runs it on the real tree.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-storage-file-parity.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial, with the gate (secaudit 2026-10, M8).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileParity } from '../../scripts/check-storage-file-parity.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SQ = 'src/storage/providers/sqlite';
const PG = 'src/storage/providers/postgres-kysely';
const roots: string[] = [];

/** A tree with the two internals interfaces, plus the given files (path → content). */
function tree(files: Record<string, string>, internals = { sqlite: 'deserializeA', pg: '_rawA' }): string {
  const root = mkdtempSync(join(tmpdir(), 'file-parity-'));
  roots.push(root);
  const all: Record<string, string> = {
    [`${SQ}/methods/internal.ts`]: `export interface SqliteInternals {\n  ${internals.sqlite}(row: unknown): unknown;\n}\n`,
    [`${PG}/index.ts`]: `interface PgKyselyInternals {\n  ${internals.pg}(key: string): Promise<null>;\n}\n`,
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const group = (name: string, members: string[]): string =>
  `export const ${name} = {\n${members.map(m => `  ${m}() { return null; },`).join('\n')}\n};\n`;

const matching = {
  [`${SQ}/methods/a.ts`]: group('aMethods', ['getA', 'deserializeA']),
  [`${SQ}/methods/b.ts`]: group('bMethods', ['getB', 'setB']),
  [`${PG}/methods/a.ts`]: group('aMethods', ['getA', '_rawA']),
  [`${PG}/methods/b.ts`]: group('bMethods', ['getB']) + group('bMoreMethods', ['setB']),
};

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('check:storage-file-parity', () => {
  it('passes when every file pair defines the same methods, provider-specific members left out', () => {
    const r = fileParity(tree(matching));
    expect(r.problems).toEqual([]);
    expect(r.methods).toBe(3);
    expect(r.sqliteOnly).toBe(1);
    expect(r.postgresOnly).toBe(1);
  });

  it('fails on a method in a different file than its twin, once', () => {
    const r = fileParity(tree({
      ...matching,
      [`${SQ}/methods/a.ts`]: group('aMethods', ['getA', 'deserializeA', 'setB']),
      [`${SQ}/methods/b.ts`]: group('bMethods', ['getB']),
    }));
    expect(r.problems).toEqual([
      `setB is in ${SQ}/methods/a.ts but in ${PG}/methods/b.ts: move one so both carry the same file name`,
    ]);
  });

  it('fails on a methods file with no twin file', () => {
    const r = fileParity(tree({ ...matching, [`${PG}/methods/c.ts`]: group('cMethods', ['getC']) }));
    expect(r.problems).toEqual([`${PG}/methods/c.ts has no twin file ${SQ}/methods/c.ts`]);
  });

  it('fails on a method one provider does not have at all', () => {
    const r = fileParity(tree({ ...matching, [`${SQ}/methods/b.ts`]: group('bMethods', ['getB']) }));
    expect(r.problems).toEqual([`setB is in ${PG}/methods/b.ts and in no sqlite methods file`]);
  });

  it('accepts a SQLite file split as <name>.ts and <name>-2.ts', () => {
    const r = fileParity(tree({
      ...matching,
      [`${SQ}/methods/b.ts`]: group('bMethods', ['getB']),
      [`${SQ}/methods/b-2.ts`]: group('bMethods2', ['setB']),
    }));
    expect(r.problems).toEqual([]);
  });

  it('fails on a provider-specific member that is gone, and on one both providers define', () => {
    const gone = fileParity(tree(matching, { sqlite: 'deserializeZ', pg: '_rawA' }));
    expect(gone.problems).toContain(
      `SqliteInternals.deserializeZ is listed as sqlite-specific but no sqlite methods file defines it: drop it from ${SQ}/methods/internal.ts`,
    );
    const twoSided = fileParity(tree({ ...matching, [`${PG}/methods/a.ts`]: group('aMethods', ['getA', '_rawA', 'deserializeA']) }));
    expect(twoSided.problems).toContain(
      'SqliteInternals.deserializeA is listed as sqlite-specific but postgres-kysely/methods/a.ts defines it too',
    );
  });

  it('fails on a method defined in two files of one provider, and on a spread member', () => {
    const twice = fileParity(tree({ ...matching, [`${SQ}/methods/b.ts`]: group('bMethods', ['getB', 'setB', 'getA']) }));
    expect(twice.problems).toContain(`getA is defined twice in ${SQ}/methods: a.ts and b.ts`);
    const spread = fileParity(tree({
      ...matching,
      [`${SQ}/methods/b.ts`]: `import { more } from './more.js';\nexport const bMethods = {\n  ...more,\n  getB() { return null; },\n  setB() { return null; },\n};\n`,
    }));
    expect(spread.problems.some(p => p.includes('a spread in bMethods hides which file defines its methods'))).toBe(true);
  });

  it('passes on the real tree', () => {
    const r = fileParity(ROOT);
    expect(r.problems).toEqual([]);
    expect(r.methods).toBeGreaterThan(700);
  });
});
