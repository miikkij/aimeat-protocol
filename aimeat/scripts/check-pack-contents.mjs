/**
 * @file scripts/check-pack-contents.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses to publish a dist/ that holds a file with no source in git.
 *
 *   `files: ["dist/"]` publishes whatever dist/ holds on the machine that runs `npm publish`, and
 *   nothing between the build and the registry looked at it. That is how 3.10.0 and earlier shipped
 *   a GPL binary the build had copied off the disk, and how 3.15.0 shipped 922 files whose source
 *   had been deleted months before. scripts/clean-dist.mjs removes the second cause. This check is
 *   for the whole class: a copy step that picks up something untracked on the developer's disk, or
 *   a build that stops cleaning, fails here, before the tarball exists, with the files named.
 *
 *   THE RULE. Every file under dist/ must come from a file git tracks:
 *     dist/{src,bin,scripts}/x.js, .d.ts and their maps  ← x.ts / x.js / x.mjs, compiled by tsc
 *     dist/public/x                                      ← public/x, or an asset vendored-assets.json
 *                                                          fetches and marks distributable
 *     dist/static/x                                      ← src/static/x
 *     dist/docs/{msm-examples,extensions}/x              ← the repo-root docs/ of the same name
 *     dist/locales, dist/docs, the migrations, .env.example ← the same path
 *   plus the few files the build itself writes (GENERATED, each with its reason).
 *
 *   Plain .mjs, matching the other build steps.
 * @usage node scripts/check-pack-contents.mjs   # prepublishOnly runs it after `pnpm build`
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** Files the build writes that have no source of their own. */
const GENERATED = new Map([
  ['build-stamp.json', 'written by scripts/write-build-stamp.mjs'],
  ['src/generated/api-types.js', 'compiled from src/generated/api-types.ts, which `pnpm generate:types` writes from openapi.yaml'],
  ['src/generated/api-types.d.ts', 'as above'],
  ['src/generated/api-types.js.map', 'as above'],
  ['src/generated/api-types.d.ts.map', 'as above'],
]);

const COMPILED_ROOTS = new Set(['src', 'bin', 'scripts']);
const COMPILED_EXT = /(\.d\.ts\.map|\.js\.map|\.d\.ts|\.js)$/;
const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'];

function tracked(args) {
  const out = execFileSync('git', ['ls-files', '-z', ...args], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  return new Set(out.split('\0').filter(Boolean));
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(relative(DIST, full).split(sep).join('/'));
  }
  return files;
}

/** Paths under public/ that vendor-libs fetches and the package may carry. */
function vendoredPublicPaths() {
  const manifest = join(ROOT, 'public', 'lib', 'vendored-assets.json');
  if (!existsSync(manifest)) return new Set();
  const parsed = JSON.parse(readFileSync(manifest, 'utf-8'));
  return new Set((parsed.assets ?? []).filter(a => a.distribute !== false).map(a => `public/${a.path}`));
}

/** The source paths (relative to aimeat/) one dist file may come from. */
function sourcesFor(rel) {
  const top = rel.split('/')[0];
  if (COMPILED_ROOTS.has(top) && COMPILED_EXT.test(rel)) {
    const base = rel.replace(COMPILED_EXT, '');
    return [rel, ...SOURCE_EXT.map(ext => base + ext)];
  }
  if (top === 'static') return [`src/${rel}`];
  if (rel.startsWith('docs/msm-examples/') || rel.startsWith('docs/extensions/')) return [`../${rel}`];
  return [rel];
}

function main() {
  if (!existsSync(DIST)) {
    console.error('check-pack-contents: dist/ does not exist. Run `pnpm build` first.');
    process.exit(1);
  }
  const git = tracked(['.', '../docs/msm-examples', '../docs/extensions']);
  const vendored = vendoredPublicPaths();

  const orphans = [];
  for (const rel of walk(DIST)) {
    if (GENERATED.has(rel)) continue;
    const candidates = sourcesFor(rel);
    if (candidates.some(c => git.has(c) || vendored.has(c))) continue;
    orphans.push(rel);
  }

  if (orphans.length > 0) {
    const shown = orphans.slice(0, 40).map(p => `  dist/${p}`).join('\n');
    const more = orphans.length > 40 ? `\n  … and ${orphans.length - 40} more` : '';
    console.error(`check-pack-contents: ${orphans.length} file(s) in dist/ have no source that git tracks:\n${shown}${more}\n`);
    console.error('These would be published. Run `pnpm build` (it starts from an empty dist/), and if a file is');
    console.error('still listed, it is on this disk but not in git: commit it, or stop the build from copying it.');
    process.exit(1);
  }
  console.log('check-pack-contents: every file in dist/ comes from a tracked source.');
}

main();
