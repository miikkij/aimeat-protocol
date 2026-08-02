/**
 * @file publish-lifecycle-files.test.ts
 * @description Guards the published tarball against the defect that shipped in every version up to
 *   2.6.0: `postinstall` ran `node scripts/vendor-libs.mjs`, but `files` listed only `dist/` and
 *   `docs/`, so the script was never in the package. Every real `npm install aimeat` died with
 *   MODULE_NOT_FOUND before the package was usable.
 *
 *   It went unnoticed for four published versions because this repo's own global `aimeat` is a
 *   symlink into the working tree (`npm link`-style), where `scripts/` obviously exists — so nobody
 *   here ever exercised the tarball. Nothing in lint, typecheck, the unit suite or the E2E sweep
 *   looks at packaging.
 *
 *   So: any file a LIFECYCLE script needs (the hooks npm runs on the consumer's machine) must be
 *   covered by `files`. Dev-only scripts are deliberately not checked — they never run from a
 *   published install, and shipping them would only bloat the package.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial, after `npm i aimeat@2.6.0` was found to be uninstallable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as {
  files: string[];
  scripts: Record<string, string>;
};

/**
 * Hooks npm runs on the CONSUMER's machine after installing the tarball. `prepublishOnly` and
 * `prepare` are excluded on purpose: they run in the publisher's checkout, where everything exists.
 */
const LIFECYCLE_HOOKS = ['postinstall', 'install', 'preinstall'];

/** Local script paths a command line references, e.g. `node scripts/vendor-libs.mjs --optional`. */
function referencedScriptPaths(command: string): string[] {
  return [...command.matchAll(/(?:^|\s)((?:scripts|bin|dist)\/[\w./-]+\.(?:mjs|cjs|js))/g)].map((m) => m[1]);
}

/** Does `files` cover this path? Handles the directory entries (`dist/`) and exact file entries. */
function coveredByFiles(path: string): boolean {
  return pkg.files.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : entry === path));
}

describe('lifecycle scripts ship with the package', () => {
  const hooks = LIFECYCLE_HOOKS.filter((h) => pkg.scripts[h]);

  it('has at least one lifecycle hook to check (else this guard is vacuous)', () => {
    expect(hooks.length).toBeGreaterThan(0);
  });

  for (const hook of hooks) {
    it(`${hook}: every script it runs is listed in "files"`, () => {
      const referenced = referencedScriptPaths(pkg.scripts[hook]);
      expect(referenced.length, `could not parse a script path out of ${hook}: ${pkg.scripts[hook]}`)
        .toBeGreaterThan(0);
      for (const path of referenced) {
        expect(existsSync(join(PKG_ROOT, path)), `${hook} runs ${path}, which does not exist`).toBe(true);
        expect(
          coveredByFiles(path),
          `"${hook}" runs ${path}, but package.json "files" (${pkg.files.join(', ')}) does not ship it — `
          + 'every `npm install` of this package will fail with MODULE_NOT_FOUND',
        ).toBe(true);
      }
    });
  }
});
