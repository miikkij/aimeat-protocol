/**
 * @file vendor-duckdb-wasm.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reproducible builder for the vendored `duckdb-wasm` bundle: downloads the PINNED
 *   @duckdb/duckdb-wasm release from npm, bundles its browser entry into ONE classic IIFE exposing
 *   `window.duckdb`, and copies the worker beside it. The 34 MB `duckdb-eh.wasm` is NOT written
 *   here — it is listed in vendored-assets.json and fetched by `pnpm vendor:libs`, like ffmpeg-core.
 *
 *   WHY A BUNDLE AND NOT THE PUBLISHED FILE. `duckdb-browser.mjs` imports bare `apache-arrow`, so
 *   the published file cannot be loaded from a static path: a browser has no resolver for a bare
 *   specifier, and an importmap entry would have to carry arrow separately for every app. esbuild
 *   resolves it once, here, and the result is a single script tag like every other vendored lib.
 *
 *   TWO THINGS THAT ARE NOT POLICY BUT PHYSICS, both measured, both a lost day if unknown.
 *   1. The worker MUST be created through duckdb's own blob idiom
 *      (`URL.createObjectURL(new Blob([`importScripts("${workerUrl}");`], {type:'text/javascript'}))`).
 *      The app CSP allows `worker-src blob:`, so a direct `new Worker('/lib/...worker.js')` is
 *      refused outright.
 *   2. AFTER that, the wasm URL must be ABSOLUTE. A blob worker has an opaque base URL, so a
 *      relative `/lib/...` resolves against nothing and the instantiate fails with a fetch error
 *      that names no path.
 *   Both verified under the app CSP with crossOriginIsolated false and SharedArrayBuffer undefined:
 *   the single-threaded `eh` bundle is the one that runs there, and it does.
 * @usage node scripts/vendor-duckdb-wasm.mjs   (from aimeat/; needs network + local esbuild)
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial bundle: @duckdb/duckdb-wasm 1.32.0 (TARGET-063).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const DUCKDB_VERSION = '1.32.0';
// Pinned rather than taken from duckdb's `^17.0.0` range: a vendored artifact that rebuilds into
// something different next month is not vendored, it is cached.
const ARROW_VERSION = '17.0.0';
const DIR = path.resolve(import.meta.dirname, '..', 'public', 'lib', `duckdb-wasm@${DUCKDB_VERSION}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-wasm-'));
const tgz = path.join(work, 'duckdb.tgz');

console.log(`fetching @duckdb/duckdb-wasm@${DUCKDB_VERSION} ...`);
const res = await fetch(`https://registry.npmjs.org/@duckdb/duckdb-wasm/-/duckdb-wasm-${DUCKDB_VERSION}.tgz`);
if (!res.ok) throw new Error(`npm fetch failed: ${res.status}`);
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
// Relative path + cwd: GNU tar reads "C:\..." as a remote host ("Cannot connect to C:").
execFileSync('tar', ['-xzf', 'duckdb.tgz'], { cwd: work });
const pkg = path.join(work, 'package');

// apache-arrow is a peer of the bundle, not of this repo, and its own ESM imports tslib and
// flatbuffers — so it is INSTALLED rather than untarred, which is what resolves that tree. The
// install lands in a temp directory and nothing about it touches this repo's lockfile.
const declared = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).dependencies['apache-arrow'];
if (!declared.includes(ARROW_VERSION.split('.')[0])) {
  throw new Error(`duckdb ${DUCKDB_VERSION} wants apache-arrow ${declared}, this script pins ${ARROW_VERSION}`);
}
console.log(`installing apache-arrow@${ARROW_VERSION} into the scratch tree ...`);
fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'duckdb-vendor-scratch', private: true }));
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', `apache-arrow@${ARROW_VERSION}`],
  { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
const arrowPkg = path.join(work, 'node_modules', 'apache-arrow');

fs.mkdirSync(DIR, { recursive: true });

// ── The loader bundle ──
const entry = path.join(work, 'entry.js');
fs.writeFileSync(entry, `
import * as duckdb from ${JSON.stringify(path.join(pkg, 'dist', 'duckdb-browser.mjs').replace(/\\/g, '/'))};
import * as arrow from 'apache-arrow';
window.duckdb = duckdb;
// Arrow rides along because every query result IS an arrow Table: an app that cannot reach the
// arrow API can read a result's rows and nothing else about it.
window.duckdbArrow = arrow;
`);

const banner = `/*! duckdb-wasm@${DUCKDB_VERSION} — DuckDB-Wasm ${DUCKDB_VERSION} (MIT, (c) DuckDB Labs, https://duckdb.org)
 * + apache-arrow ${ARROW_VERSION} (Apache-2.0) bundled to one classic script: window.duckdb, arrow on window.duckdbArrow.
 * Built by aimeat/scripts/vendor-duckdb-wasm.mjs — regenerate there; NEVER edit or replace in place (VENDORED.md policy). */`;

const outfile = path.join(DIR, 'duckdb-browser.js');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: banner },
  alias: { 'apache-arrow': path.join(arrowPkg, 'Arrow.dom.mjs') },
  nodePaths: [path.join(work, 'node_modules')],
  outfile,
});

// ── The worker, copied verbatim ──
// The eh (exception-handling) build is the single-threaded one. The mvp build is older and the coi
// build needs SharedArrayBuffer, which needs COOP+COEP, which this node deliberately does not set.
const worker = path.join(pkg, 'dist', 'duckdb-browser-eh.worker.js');
fs.copyFileSync(worker, path.join(DIR, 'duckdb-browser-eh.worker.js'));

// ── The wasm: hashed here, fetched by vendor-libs.mjs ──
const wasm = fs.readFileSync(path.join(pkg, 'dist', 'duckdb-eh.wasm'));
const sha256 = crypto.createHash('sha256').update(wasm).digest('hex');

const size = p => (fs.statSync(p).size / 1024).toFixed(0) + ' kB';
console.log(`\nwrote ${DIR}`);
console.log(`  duckdb-browser.js             ${size(outfile)}   (bundle: duckdb + apache-arrow)`);
console.log(`  duckdb-browser-eh.worker.js   ${size(path.join(DIR, 'duckdb-browser-eh.worker.js'))}`);
console.log(`\nNOT written here — put this in public/lib/vendored-assets.json and run pnpm vendor:libs:`);
console.log(JSON.stringify({
  path: `lib/duckdb-wasm@${DUCKDB_VERSION}/duckdb-eh.wasm`,
  url: `https://unpkg.com/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/duckdb-eh.wasm`,
  sha256,
  bytes: wasm.length,
  package: `@duckdb/duckdb-wasm@${DUCKDB_VERSION}`,
  license: 'MIT',
}, null, 2));
