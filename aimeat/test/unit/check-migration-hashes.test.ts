/**
 * @file test/unit/check-migration-hashes.test.ts
 * @description Proof that `pnpm check:migration-hashes` refuses every way a migration file that is
 *   already on main can change: its bytes, its bytes together with its manifest line, its removal, and
 *   a new file nobody listed. The findings function is pure, so every case is two trees in and a list
 *   out; reading origin/main goes through an injected git runner, so the cases where git or
 *   origin/main is missing are tested without either.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-migration-hashes.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial, with the gate.
 */
import { describe, it, expect } from 'vitest';
import {
  migrationFindings, readBase, sha256Of, type MigrationTree, type GitRunner,
} from '../../scripts/check-migration-hashes.js';

const A = '-- 0001\nCREATE TABLE a (id text);\n';
const B = '-- 0002\nALTER TABLE a ADD COLUMN b text;\n';

/** A tree of migration files and the manifest that lists them. */
function tree(files: Record<string, string>, manifest?: Record<string, string>): MigrationTree {
  const bytes = new Map(Object.entries(files).map(([name, text]) => [name, Buffer.from(text, 'utf8')]));
  const listed = manifest ?? Object.fromEntries([...bytes].map(([name, b]) => [name, sha256Of(b)]));
  return { files: bytes, manifest: listed };
}

const kinds = (found: Array<{ kind: string; file: string }>) => found.map(f => `${f.kind}:${f.file}`).sort();

describe('check:migration-hashes findings', () => {
  it('stays quiet when every file matches its line and main has nothing the tree lacks', () => {
    const base = tree({ '0001_a.sql': A });
    const head = tree({ '0001_a.sql': A, '0002_b.sql': B });
    expect(migrationFindings(head, base)).toEqual([]);
    expect(migrationFindings(head, null)).toEqual([]);
  });

  it('refuses a changed file whose manifest line was left as it was', () => {
    const head = tree({ '0001_a.sql': A + '-- one more line\n' }, { '0001_a.sql': sha256Of(Buffer.from(A)) });
    expect(kinds(migrationFindings(head, null))).toEqual(['changed:0001_a.sql']);
  });

  it('refuses a changed file whose manifest line was changed with it, by comparing with main', () => {
    const base = tree({ '0001_a.sql': A });
    const head = tree({ '0001_a.sql': A + '-- one more line\n' });
    // The tree agrees with its own manifest, so only main can show the change.
    expect(migrationFindings(head, null)).toEqual([]);
    expect(kinds(migrationFindings(head, base))).toEqual(['changed-on-main:0001_a.sql', 'manifest-changed:0001_a.sql']);
  });

  it('refuses a new file that the manifest does not list, and says to list it in the same commit', () => {
    const head = tree({ '0001_a.sql': A, '0002_b.sql': B }, { '0001_a.sql': sha256Of(Buffer.from(A)) });
    const found = migrationFindings(head, tree({ '0001_a.sql': A }));
    expect(kinds(found)).toEqual(['unlisted:0002_b.sql']);
    expect(found[0].detail).toContain('same commit');
  });

  it('refuses a listed file that was removed, and a file of main that the tree lost', () => {
    const base = tree({ '0001_a.sql': A, '0002_b.sql': B });
    const head = tree({ '0001_a.sql': A }, base.manifest);
    expect(kinds(migrationFindings(head, base))).toEqual(['removed-from-main:0002_b.sql', 'removed:0002_b.sql']);
    // The line taken out of the manifest together with the file: main still shows both.
    const both = tree({ '0001_a.sql': A });
    expect(kinds(migrationFindings(both, base))).toEqual(['manifest-removed:0002_b.sql', 'removed-from-main:0002_b.sql']);
  });

  it('reads a file with Windows line ends as the same file', () => {
    const head = tree({ '0001_a.sql': A.replace(/\n/g, '\r\n') }, { '0001_a.sql': sha256Of(Buffer.from(A)) });
    expect(migrationFindings(head, tree({ '0001_a.sql': A }))).toEqual([]);
  });
});

describe('check:migration-hashes reading origin/main', () => {
  const DIR = 'aimeat/src/storage/providers/postgres-kysely/migrations';
  const MANIFEST = 'aimeat/security/migration-hashes.json';

  /** A git that answers from a table of argument lists, and fails on anything else. */
  const fakeGit = (answers: Record<string, string>): GitRunner => (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`git ${key}: not answered`);
    return Buffer.from(answers[key], 'utf8');
  };

  it('skips the comparison with one line when git is not there', () => {
    const r = readBase(() => { throw new Error('spawn git ENOENT'); }, DIR, MANIFEST);
    expect(r.base).toBeNull();
    expect(r.skipped).toMatch(/git/);
  });

  it('skips it when there is no origin/main, and when HEAD is origin/main', () => {
    expect(readBase(fakeGit({ 'rev-parse --verify --quiet HEAD': 'abc\n' }), DIR, MANIFEST).skipped).toMatch(/origin\/main/);
    const same = readBase(fakeGit({
      'rev-parse --verify --quiet HEAD': 'abc\n',
      'rev-parse --verify --quiet origin/main^{commit}': 'abc\n',
    }), DIR, MANIFEST);
    expect([same.base, same.skipped]).toEqual([null, expect.stringMatching(/HEAD is origin\/main/)]);
  });

  it('reads the files and the manifest of origin/main when it is another commit', () => {
    const manifest = JSON.stringify({ files: { '0001_a.sql': sha256Of(Buffer.from(A)) } });
    const r = readBase(fakeGit({
      'rev-parse --verify --quiet HEAD': 'abc\n',
      'rev-parse --verify --quiet origin/main^{commit}': 'def\n',
      [`ls-tree --name-only origin/main -- ${DIR}/`]: `${DIR}/0001_a.sql\n${DIR}/README.txt\n`,
      [`show origin/main:${DIR}/0001_a.sql`]: A,
      [`show origin/main:${MANIFEST}`]: manifest,
    }), DIR, MANIFEST);
    expect(r.skipped).toBeUndefined();
    expect([...(r.base?.files.keys() ?? [])]).toEqual(['0001_a.sql']);
    expect(r.base?.manifest).toEqual({ '0001_a.sql': sha256Of(Buffer.from(A)) });
  });

  it('takes a manifest main does not have yet as empty, so the first commit of it passes', () => {
    const r = readBase(fakeGit({
      'rev-parse --verify --quiet HEAD': 'abc\n',
      'rev-parse --verify --quiet origin/main^{commit}': 'def\n',
      [`ls-tree --name-only origin/main -- ${DIR}/`]: `${DIR}/0001_a.sql\n`,
      [`show origin/main:${DIR}/0001_a.sql`]: A,
    }), DIR, MANIFEST);
    expect(r.base?.manifest).toEqual({});
    expect(migrationFindings(tree({ '0001_a.sql': A }), r.base)).toEqual([]);
  });
});
