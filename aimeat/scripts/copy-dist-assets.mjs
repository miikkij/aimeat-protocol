/**
 * @file scripts/copy-dist-assets.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The build's asset copy step: everything tsc does not emit but a published install
 *   needs — locales, public/, src/static/, .env.example, docs/ and the Postgres migrations.
 *
 *   IT USED TO BE A ONE-LINER inside package.json's "build", and that is why a GPL binary ended up
 *   inside the MIT-licensed npm package for every release up to 3.10.0. `cpSync('public',
 *   'dist/public')` copies whatever is on the build machine, and `pnpm vendor:libs` had just put
 *   ffmpeg-core there; `files: ["dist/"]` then published it. Nobody could see that chain because
 *   the copy had nowhere to say "except the assets we are deliberately not distributing".
 *
 *   So the copy now reads public/lib/vendored-assets.json and skips every asset marked
 *   `"distribute": false`. Those are the fetched assets whose licence means AIMEAT must not ship
 *   them: the operator's own `pnpm vendor:libs` (postinstall runs it) installs them into the
 *   served tree afterwards, so the node still works and the tarball stays clean.
 * @structure noDistributePaths() → the deny list from the manifest; copy() → cpSync with a filter
 * @usage  node scripts/copy-dist-assets.mjs   (run by `pnpm build`)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Extracted from the inline build one-liner; skips non-distributable assets.
 */
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths under public/ that the build must not copy, as posix-ish suffixes to match against the
 * source path cpSync hands the filter. Read from the manifest so that adding an asset with a
 * licence problem is one JSON field rather than a code change nobody remembers to make.
 */
function noDistributePaths() {
  const manifest = join(ROOT, 'public', 'lib', 'vendored-assets.json');
  if (!existsSync(manifest)) return [];
  const parsed = JSON.parse(readFileSync(manifest, 'utf-8'));
  return (parsed.assets ?? [])
    .filter(a => a.distribute === false)
    .map(a => join(ROOT, 'public', ...a.path.split('/')));
}

const denied = noDistributePaths();
let skipped = 0;

/** cpSync filter: false prunes the file (and, for a directory, everything under it). */
function allow(src) {
  for (const path of denied) {
    if (src === path || src.startsWith(path + sep)) {
      skipped++;
      return false;
    }
  }
  return true;
}

function copy(from, to, opts = {}) {
  cpSync(join(ROOT, from), join(ROOT, to), opts);
}

copy('locales', 'dist/locales', { recursive: true });
copy('public', 'dist/public', { recursive: true, filter: allow });
copy('src/static', 'dist/static', { recursive: true });
copy('.env.example', 'dist/.env.example');
copy('docs', 'dist/docs', { recursive: true });
copy(
  'src/storage/providers/postgres-kysely/migrations',
  'dist/src/storage/providers/postgres-kysely/migrations',
  { recursive: true },
);

if (skipped > 0) {
  console.log(`copy-dist-assets: skipped ${skipped} file(s) marked "distribute": false in vendored-assets.json.`);
  console.log('  They are installed on the operator\'s machine by `pnpm vendor:libs`, not shipped by us.');
}
