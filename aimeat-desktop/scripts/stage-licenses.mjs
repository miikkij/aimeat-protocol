/**
 * @file stage-licenses.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stages the licence texts the installer must carry into
 *   src-tauri/resources/licenses/, which tauri.conf.json bundles like any other resource.
 *
 *   THE DESKTOP BUILD DISTRIBUTES MORE THAN THE WEB NODE DOES, and that is easy to miss because
 *   neither of the extra pieces is a dependency anyone declared. stage-node.mjs copies the build
 *   machine's own Node executable into the installer as a Tauri sidecar: Node is MIT, but its
 *   LICENSE file is not one licence, it is forty — OpenSSL, V8, ICU, zlib, c-ares and the rest,
 *   each with its own notice, and that whole file has to travel with the binary. stage-webview2.mjs
 *   copies WebView2Loader.dll out of the webview2-com-sys crate, and that DLL is Microsoft's
 *   redistributable under Microsoft's own terms rather than the crate's MIT.
 *
 *   So this stages four things: AIMEAT's own licence, the generated third-party notices for the
 *   server bundle, Node's LICENSE taken from the very runtime being shipped, and a notice naming
 *   the WebView2 component with a pointer to the terms it ships under. Microsoft's terms are not
 *   reproduced here because we do not have a copy we may redistribute; naming the component,
 *   version and the canonical URL is what an installer can honestly do.
 * @structure nodeLicenseFile() → find LICENSE beside the runtime being staged; main() → copy the
 *   four documents, failing loudly if the Node licence cannot be found
 * @usage  node scripts/stage-licenses.mjs   (run via `pnpm stage`)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: AIMEAT LICENSE, third-party notices, Node LICENSE, WebView2 notice.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const repoRoot = join(desktopRoot, '..');
const outDir = join(desktopRoot, 'src-tauri', 'resources', 'licenses');

/**
 * Node's own LICENSE, beside the runtime stage-node.mjs stages. Taking it from the shipped runtime
 * rather than from a URL means the notices describe the exact build in the installer, which is the
 * whole point of the requirement.
 */
function nodeLicenseFile() {
  const runtimeDir = dirname(process.execPath);
  const candidates = [
    join(runtimeDir, 'LICENSE'),
    join(runtimeDir, '..', 'LICENSE'),
    join(runtimeDir, '..', 'share', 'doc', 'node', 'LICENSE'),
    join(runtimeDir, '..', 'lib', 'node_modules', 'npm', 'LICENSE'),
  ];
  return candidates.find(existsSync) ?? null;
}

/** The staged WebView2 loader's crate version, so the notice names what actually ships. */
function webview2CrateVersion() {
  const cargoHome = process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo');
  const registry = join(cargoHome, 'registry', 'src');
  if (!existsSync(registry)) return null;
  for (const index of readdirSync(registry)) {
    const crates = readdirSync(join(registry, index)).filter(n => n.startsWith('webview2-com-sys-'));
    if (crates.length > 0) return crates.sort().at(-1).replace('webview2-com-sys-', '');
  }
  return null;
}

const WEBVIEW2_NOTICE = version => `Microsoft Edge WebView2

This installer contains WebView2Loader.dll, a Microsoft redistributable component. It is not
covered by the AIMEAT licence and not by the MIT licence of the Rust crate it was taken from.

  Component   WebView2Loader.dll
  Source      the webview2-com-sys crate${version ? ` ${version}` : ''} (MIT), which redistributes the loader from
              the Microsoft Edge WebView2 SDK
  Terms       Microsoft Software License Terms for the Microsoft Edge WebView2 SDK,
              https://developer.microsoft.com/microsoft-edge/webview2/
  Runtime     The WebView2 Runtime itself is not bundled. It is a Microsoft component already
              present on current Windows installations, or installed by Microsoft's own bootstrapper.

The full Microsoft terms are not reproduced in this file because they are Microsoft's document to
publish; the URL above is the canonical copy.
`;

function main() {
  mkdirSync(outDir, { recursive: true });

  copyFileSync(join(repoRoot, 'LICENSE'), join(outDir, 'AIMEAT-LICENSE.txt'));

  const notices = join(repoRoot, 'THIRD-PARTY-NOTICES.md');
  if (!existsSync(notices)) {
    console.error('[stage-licenses] THIRD-PARTY-NOTICES.md is missing. Run: cd aimeat && pnpm gen:notices');
    process.exit(1);
  }
  copyFileSync(notices, join(outDir, 'THIRD-PARTY-NOTICES.md'));

  const nodeLicense = nodeLicenseFile();
  if (nodeLicense === null) {
    console.error(`[stage-licenses] Could not find Node's LICENSE beside ${process.execPath}.`);
    console.error('  The installer bundles that runtime as a sidecar, and its LICENSE carries the');
    console.error('  notices for OpenSSL, V8, ICU and the rest. Shipping without it is not an option:');
    console.error('  point this script at the right path rather than skipping the file.');
    process.exit(1);
  }
  copyFileSync(nodeLicense, join(outDir, 'NODEJS-LICENSE.txt'));

  writeFileSync(join(outDir, 'WEBVIEW2-NOTICE.txt'), WEBVIEW2_NOTICE(webview2CrateVersion()), 'utf-8');

  console.log(`[stage-licenses] staged 4 documents into ${outDir}`);
  console.log(`[stage-licenses] Node LICENSE taken from ${nodeLicense}`);
}

main();
