/**
 * @file build-sdk-libs.ts
 * @description Build step for the served browser SDK libraries. Bundles each componentized,
 *   JSDoc-typed ESM source under src/static/sdk-libs/ (one entry per library, sharing _core/)
 *   with esbuild into a classic IIFE, and writes it to src/static/sdk-libs/dist/aimeat-<name>.js.
 *   These generated bundles are committed (same model as src/static/app-catalog.html) and served
 *   verbatim at /v1/libs/aimeat-<name>.js with a tiny per-node config prelude prepended at serve
 *   time — replacing the old "JavaScript authored inside a TypeScript template string" approach.
 * @structure
 *   - SDK_LIBS        → the per-library entry registry (name → source entry)
 *   - bundleLib()     → esbuild one entry → IIFE text (with generated-file banner)
 *   - buildSdkLibs()  → write every dist/aimeat-<name>.js
 *   - checkSdkLibs()  → --check: fail (non-zero) if any committed bundle is stale vs its sources
 * @usage  pnpm build:sdk   ·   pnpm check:sdk   (also run by `pnpm dev`)
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: esbuild IIFE bundler + drift check for the SDK-libs migration (Phase 0, pilot: speech).
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src', 'static', 'sdk-libs');
const OUT_DIR = join(SRC_DIR, 'dist');

/** One served library = a public name (aimeat-<name>.js) + its ESM entry under sdk-libs/. */
interface SdkLib {
  /** The served basename, minus the `aimeat-` prefix and `.js` suffix (e.g. `speech`). */
  name: string;
  /** The entry source, relative to src/static/sdk-libs/ (e.g. `speech/index.js`). */
  entry: string;
}

/**
 * The migrated libraries. Phase 0 ships the pilot only; later phases append their entries here
 * (and the drift guard makes sure every committed bundle stays in sync with its sources).
 */
export const SDK_LIBS: SdkLib[] = [
  { name: 'speech', entry: 'speech/index.js' },
  { name: 'data', entry: 'data/index.js' },
  { name: 'wallet', entry: 'wallet/index.js' },
  { name: 'ai', entry: 'ai/index.js' },
  { name: 'capabilities', entry: 'capabilities/index.js' },
  { name: 'agents', entry: 'agents/index.js' },
];

function banner(name: string): string {
  return (
    `// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/${name}/ (+ _core/).\n` +
    `// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-${name}.js (with a per-node config prelude).\n`
  );
}

/** Bundle one library entry to a self-contained classic IIFE (deterministic — no timestamps). */
async function bundleLib(lib: SdkLib): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [join(SRC_DIR, lib.entry)],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  if (!result.outputFiles?.length) throw new Error(`esbuild produced no output for ${lib.name}`);
  return banner(lib.name) + result.outputFiles[0].text;
}

/** Build every library to its committed dist bundle (pure disk write). */
export async function buildSdkLibs(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const lib of SDK_LIBS) {
    writeFileSync(join(OUT_DIR, `aimeat-${lib.name}.js`), await bundleLib(lib), 'utf-8');
  }
}

/** --check: fail (non-zero) if any committed dist bundle is stale vs its sources, without writing. */
async function checkSdkLibs(): Promise<void> {
  let stale = false;
  for (const lib of SDK_LIBS) {
    const fresh = await bundleLib(lib);
    const outFile = join(OUT_DIR, `aimeat-${lib.name}.js`);
    let onDisk = '';
    try { onDisk = readFileSync(outFile, 'utf-8'); } catch { onDisk = ''; }
    if (fresh !== onDisk) {
      console.error(`✗ src/static/sdk-libs/dist/aimeat-${lib.name}.js is STALE vs src/static/sdk-libs/${lib.name}/ sources.`);
      stale = true;
    }
  }
  if (stale) {
    console.error('  Run `pnpm build:sdk` and commit the regenerated bundle(s).');
    process.exit(1);
  }
  console.log(`✓ ${SDK_LIBS.length} SDK lib bundle(s) in sync with their sources`);
}

// Run when invoked directly (tsx scripts/build-sdk-libs.ts [--check]).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-sdk-libs.ts')) {
  const check = process.argv.includes('--check');
  (check ? checkSdkLibs() : buildSdkLibs().then(() => console.log(`✓ ${SDK_LIBS.length} SDK lib(s) built → src/static/sdk-libs/dist/`)))
    .catch((err) => { console.error('✗ SDK libs build failed:', err.message); process.exit(1); });
}
