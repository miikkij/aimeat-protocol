/**
 * @file scripts/vendor-libs.mjs
 * @description Fetch the vendored /lib/ assets that are too large to keep in git, listed in
 *   public/lib/vendored-assets.json, and verify each against its pinned sha256. Idempotent: an
 *   asset that is already present and correct is left alone, so running this on every install,
 *   dev start and build costs nothing after the first time.
 *
 *   Plain .mjs on purpose — it runs as a postinstall hook, where a production install
 *   (`pnpm install --prod`) has no tsx to run a TypeScript script with.
 * @structure main() → --check (verify only, non-zero exit when something is missing) | default
 *   (download what is missing or corrupt, atomically via a .part file)
 * @usage
 *   pnpm vendor:libs        # download what is missing (postinstall / dev / build run this)
 *   pnpm check:vendored     # verify only — CI and "why does /lib/... 404" use this
 *   AIMEAT_SKIP_VENDOR=1 pnpm install   # opt out (offline or air-gapped machine)
 * @version-history
 *   v1.0.0 — 2026-07-30 — initial: @ffmpeg/core 0.12.6 wasm (32 MB), sha256-pinned.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'public', 'lib', 'vendored-assets.json');
const checkOnly = process.argv.includes('--check');

/** sha256 of a file on disk, or null when it is not there. */
function hashOf(file) {
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function human(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

async function download(asset, target) {
  const part = `${target}.part`;
  mkdirSync(dirname(target), { recursive: true });
  process.stdout.write(`  ↓ ${asset.path} (${human(asset.bytes)}) from ${asset.url}\n`);
  const res = await fetch(asset.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${asset.url} → HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== asset.sha256) {
    throw new Error(`${asset.path}: sha256 mismatch\n    expected ${asset.sha256}\n    got      ${got}\n`
      + '    The pinned URL served different bytes. Do NOT ship this file; check the source first.');
  }
  if (bytes.length !== asset.bytes) {
    throw new Error(`${asset.path}: expected ${asset.bytes} bytes, got ${bytes.length}`);
  }
  writeFileSync(part, bytes);
  // Rename last, so an interrupted run never leaves a half file where the server would serve it.
  renameSync(part, target);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const assets = manifest.assets ?? [];
let missing = 0;
let fetched = 0;

if (process.env.AIMEAT_SKIP_VENDOR === '1' && !checkOnly) {
  console.log('vendor-libs: AIMEAT_SKIP_VENDOR=1 — skipping. /lib/ assets in the manifest will 404 until you run pnpm vendor:libs.');
  process.exit(0);
}

for (const asset of assets) {
  const target = join(ROOT, 'public', asset.path);
  const have = hashOf(target);
  if (have === asset.sha256) continue;

  if (checkOnly) {
    missing++;
    const what = have === null ? 'MISSING' : `WRONG CONTENT (sha256 ${have.slice(0, 12)}…)`;
    console.error(`vendor-libs: public/${asset.path} — ${what}`);
    continue;
  }
  if (have !== null) {
    console.warn(`  ! public/${asset.path} does not match its pinned hash (${statSync(target).size} bytes on disk) — refetching`);
    rmSync(target);
  }
  await download(asset, target);
  fetched++;
}

if (checkOnly) {
  if (missing > 0) {
    console.error(`\nvendor-libs: ${missing} vendored asset(s) not in place. Run: pnpm vendor:libs`);
    console.error('Until then those /lib/ paths answer 404 and any app relying on them falls back to a CDN or fails.');
    process.exit(1);
  }
  console.log(`vendor-libs: ${assets.length} vendored asset(s) present and hash-verified.`);
} else if (fetched > 0) {
  console.log(`vendor-libs: fetched ${fetched} asset(s).`);
}
