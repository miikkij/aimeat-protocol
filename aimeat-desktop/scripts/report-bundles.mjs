/**
 * @file report-bundles.mjs
 * @description Prints the installer artifacts produced by `tauri build` (paths +
 *   sizes), so `pnpm package` ends with a clear "here's what was built" summary
 *   instead of leaving the user to hunt under target/release/bundle/.
 * @usage  node scripts/report-bundles.mjs   (run automatically at the end of `pnpm package`)
 * @version-history
 *   v0.2.0 — 2026-06-06 — Initial bundle reporter.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle');

const INSTALLER_RE = /\.(exe|msi|dmg|deb|AppImage|rpm)$/i;
const found = [];

if (existsSync(bundleDir)) {
  for (const sub of readdirSync(bundleDir)) {
    const dir = join(bundleDir, sub);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (INSTALLER_RE.test(file)) {
        const full = join(dir, file);
        const mb = (statSync(full).size / 1048576).toFixed(0);
        found.push({ full, mb });
      }
    }
  }
}

console.log('');
if (found.length === 0) {
  console.log(`[report] No installers found under ${bundleDir}`);
} else {
  console.log('✓ Installers ready:');
  for (const { full, mb } of found) {
    console.log(`    ${full}  (${mb} MB)`);
  }
}
