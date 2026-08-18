/**
 * @file stage-webview2.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stages WebView2Loader.dll into src-tauri/ so it ships next to the
 *   app executable. The MSVC Rust toolchain links this loader statically (no DLL
 *   needed), but the GNU (mingw) toolchain links it dynamically — without the DLL
 *   beside the exe the app fails to launch with
 *   "WebView2Loader.dll was not found". Tauri's bundler does not ship it for GNU
 *   builds, so we add it as a top-level bundled resource (see tauri.conf.json
 *   `resources`), which NSIS/MSI install into $INSTDIR next to the exe.
 *
 *   Source: the WebView2Loader.dll that ships inside the webview2-com-sys crate
 *   (matches the version Tauri compiled against). Harmless on MSVC builds.
 * @usage  node scripts/stage-webview2.mjs   (run via `pnpm stage`)
 * @version-history
 *   v0.2.0 — 2026-06-06 — Initial WebView2Loader.dll staging (fixes GNU-toolchain launch).
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcTauri = join(__dirname, '..', 'src-tauri');
const dest = join(srcTauri, 'WebView2Loader.dll');

// webview2-com-sys ships the DLL under x64/ x86/ arm64/.
const ARCH_DIR = { x64: 'x64', arm64: 'arm64', ia32: 'x86' }[process.arch] ?? 'x64';

function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Find the newest webview2-com-sys/<arch>/WebView2Loader.dll in the cargo registry. */
function findInRegistry() {
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  const srcRoot = join(cargoHome, 'registry', 'src');
  if (!existsSync(srcRoot)) return null;
  let best = null;
  for (const indexDir of readdirSync(srcRoot)) {
    const indexPath = join(srcRoot, indexDir);
    if (!statSync(indexPath).isDirectory()) continue;
    for (const pkg of readdirSync(indexPath)) {
      const m = pkg.match(/^webview2-com-sys-(\d+)\.(\d+)\.(\d+)/);
      if (!m) continue;
      const dll = join(indexPath, pkg, ARCH_DIR, 'WebView2Loader.dll');
      if (!existsSync(dll)) continue;
      const ver = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!best || cmpVer(ver, best.ver) > 0) best = { dll, ver };
    }
  }
  return best?.dll ?? null;
}

let dll = findInRegistry();
if (!dll) {
  // Registry not populated yet — fetch dependencies, then retry.
  try {
    execSync('cargo fetch', { cwd: srcTauri, stdio: 'inherit' });
  } catch { /* fall through to other sources */ }
  dll = findInRegistry();
}
if (!dll) {
  // Last resort: a prior release build copies the DLL next to the binary.
  const built = join(srcTauri, 'target', 'release', 'WebView2Loader.dll');
  if (existsSync(built)) dll = built;
}
if (!dll) {
  console.error('[stage-webview2] Could not locate WebView2Loader.dll.');
  console.error('[stage-webview2] Run a build once (to populate the cargo registry) and retry,');
  console.error('[stage-webview2] or switch to the MSVC Rust toolchain (statically links the loader).');
  process.exit(1);
}

mkdirSync(srcTauri, { recursive: true });
copyFileSync(dll, dest);
console.log(`[stage-webview2] Staged WebView2Loader.dll -> ${dest}`);
console.log(`[stage-webview2]   source: ${dll}`);
