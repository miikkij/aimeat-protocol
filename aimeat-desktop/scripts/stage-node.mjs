/**
 * @file stage-node.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stages a Node.js runtime as a Tauri sidecar binary for the AIMEAT
 *   Personal Node desktop app. Copies the build host's own Node executable
 *   (process.execPath) to src-tauri/binaries/node-<target-triple><ext>, which
 *   Tauri's `externalBin: ["binaries/node"]` config bundles next to the app
 *   executable. Using the host's Node guarantees the ABI matches the native
 *   better-sqlite3 binary staged by stage-server.mjs (same platform/arch/ABI).
 * @usage  node scripts/stage-node.mjs   (run via `pnpm stage`)
 * @version-history
 *   v0.2.0 — 2026-06-05 — Initial sidecar staging; Rust host triple auto-detected.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const binariesDir = join(desktopRoot, 'src-tauri', 'binaries');

// Tauri names the sidecar `<name>-<rust-target-triple><ext>` and validates it at
// build time. The triple MUST match the Rust toolchain Tauri compiles with
// (e.g. windows-gnu vs windows-msvc differ), so read it from rustc rather than
// guessing from Node's platform/arch.
function rustHostTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8' });
  const m = out.match(/^host:\s*(.+)$/m);
  if (!m) {
    throw new Error('Could not determine Rust host triple from `rustc -vV`. Is Rust installed?');
  }
  return m[1].trim();
}

const hostTriple = rustHostTriple();
const ext = process.platform === 'win32' ? '.exe' : '';

// Stage the sidecar under every triple any Tauri stage might ask for. The
// tauri-build codegen (build.rs) uses cargo's actual target triple, while the
// tauri-cli bundler can resolve a different one (e.g. msvc vs gnu on Windows).
// Staging both Windows triples makes the lookup succeed regardless.
const triples = new Set([hostTriple]);
if (process.platform === 'win32' && process.arch === 'x64') {
  triples.add('x86_64-pc-windows-gnu');
  triples.add('x86_64-pc-windows-msvc');
}

mkdirSync(binariesDir, { recursive: true });
for (const triple of triples) {
  const dest = join(binariesDir, `node-${triple}${ext}`);
  copyFileSync(process.execPath, dest);
  console.log(`[stage-node] Staged Node sidecar -> ${dest}`);
}
console.log(`[stage-node]   source: ${process.execPath} (${process.version})`);
