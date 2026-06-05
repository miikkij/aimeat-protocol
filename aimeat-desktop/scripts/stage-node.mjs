/**
 * @file stage-node.mjs
 * @description Stages a Node.js runtime as a Tauri sidecar binary for the AIMEAT
 *   Personal Node desktop app. Copies the build host's own Node executable
 *   (process.execPath) to src-tauri/binaries/node-<target-triple><ext>, which
 *   Tauri's `externalBin: ["binaries/node"]` config bundles next to the app
 *   executable. Using the host's Node guarantees the ABI matches the native
 *   better-sqlite3 binary staged by stage-server.mjs (same platform/arch/ABI).
 * @usage  node scripts/stage-node.mjs   (run via `pnpm stage`)
 * @version-history
 *   v0.2.0 — 2026-06-05 — Initial sidecar staging (Windows x64 focus).
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const binariesDir = join(desktopRoot, 'src-tauri', 'binaries');

// Map Node's platform/arch to the Rust target triple Tauri expects in the
// sidecar filename. Windows x64 is the supported target for this pass.
const TRIPLES = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

const hostKey = `${process.platform}-${process.arch}`;
const triple = TRIPLES[hostKey];
if (!triple) {
  console.error(`[stage-node] Unsupported host platform/arch: ${hostKey}`);
  console.error('[stage-node] Supported: ' + Object.keys(TRIPLES).join(', '));
  process.exit(1);
}

const ext = process.platform === 'win32' ? '.exe' : '';
const dest = join(binariesDir, `node-${triple}${ext}`);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(process.execPath, dest);

console.log(`[stage-node] Staged Node sidecar -> ${dest}`);
console.log(`[stage-node]   source: ${process.execPath} (${process.version})`);
