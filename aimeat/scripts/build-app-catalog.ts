/**
 * @file build-app-catalog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Build step for the app-catalog page. Bundles the modular ES sources under
 *   src/static/app-catalog/ (js/main.js entry + its imports) with esbuild into one IIFE, inlines
 *   the CSS, and injects both into _template.html — producing the served, self-contained
 *   src/static/app-catalog.html. The catalog is node-served (standalone retired, TARGET-021), so it
 *   is assembled at build time from many maintainable modules instead of one 9000-line inline script.
 * @structure
 *   - readTemplate() → the markup shell with __APP_CATALOG_STYLES__ / __APP_CATALOG_BUNDLE__ markers
 *   - bundleJs()     → esbuild main.js → IIFE text (</script> escaped so inline injection is safe)
 *   - buildAppCatalog() → assemble + write src/static/app-catalog.html (+ a generated-file banner)
 * @usage  pnpm build:app-catalog   (also run by `pnpm build` and `pnpm dev`)
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial modular build (TARGET-021 Aalto 3): esbuild bundle + CSS inline.
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src', 'static', 'app-catalog');
const OUT_FILE = join(__dirname, '..', 'src', 'static', 'app-catalog.html');

const STYLES_MARKER = '__APP_CATALOG_STYLES__';
const BUNDLE_MARKER = '__APP_CATALOG_BUNDLE__';

async function bundleJs(): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [join(SRC_DIR, 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  if (!result.outputFiles?.length) throw new Error('esbuild produced no output');
  // Inline into <script>…</script>: any literal </script> in a string/regex would close the tag early.
  return result.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
}

/** Assemble the served HTML from the modular sources (pure — does not touch disk). */
export async function renderAppCatalog(): Promise<string> {
  const template = readFileSync(join(SRC_DIR, '_template.html'), 'utf-8');
  if (!template.includes(STYLES_MARKER)) throw new Error(`template missing ${STYLES_MARKER}`);
  if (!template.includes(BUNDLE_MARKER)) throw new Error(`template missing ${BUNDLE_MARKER}`);

  const css = readFileSync(join(SRC_DIR, 'styles', 'app-catalog.css'), 'utf-8');
  const bundle = await bundleJs();

  const banner =
    '<!-- GENERATED FILE — do not edit directly. Source: src/static/app-catalog/ ' +
    '(js/*.js + styles/app-catalog.css + _template.html). Rebuild: pnpm build:app-catalog -->\n';

  return banner + template.replace(STYLES_MARKER, () => css).replace(BUNDLE_MARKER, () => bundle);
}

export async function buildAppCatalog(): Promise<void> {
  writeFileSync(OUT_FILE, await renderAppCatalog(), 'utf-8');
}

/** --check: fail (non-zero) if the committed artifact is stale vs the sources, without writing. */
async function checkAppCatalog(): Promise<void> {
  const fresh = await renderAppCatalog();
  const onDisk = readFileSync(OUT_FILE, 'utf-8');
  if (fresh !== onDisk) {
    console.error('✗ src/static/app-catalog.html is STALE vs src/static/app-catalog/ sources.');
    console.error('  Run `pnpm build:app-catalog` and commit the regenerated file.');
    process.exit(1);
  }
  console.log('✓ app-catalog.html in sync with its sources');
}

// Run when invoked directly (tsx scripts/build-app-catalog.ts [--check]).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-app-catalog.ts')) {
  const check = process.argv.includes('--check');
  (check ? checkAppCatalog() : buildAppCatalog().then(() => console.log('✓ app-catalog built → src/static/app-catalog.html')))
    .catch((err) => { console.error('✗ app-catalog build failed:', err.message); process.exit(1); });
}
