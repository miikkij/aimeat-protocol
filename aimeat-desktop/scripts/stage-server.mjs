/**
 * @file stage-server.mjs
 * @description Builds the AIMEAT Node.js server and stages it (plus a
 *   production-only node_modules including the native better-sqlite3 binary)
 *   into src-tauri/resources/server/, which Tauri's
 *   `resources: ["resources/server/**​/*"]` config bundles into the app's
 *   resource directory. At runtime the Rust node_manager spawns the bundled
 *   Node sidecar against resources/server/dist/src/index.js.
 *
 *   Steps:
 *     1. `pnpm build` in ../aimeat (produces dist/ with public, locales, static).
 *     2. Reset resources/server/ and copy dist/.
 *     3. Copy aimeat package.json (+ lockfile) so the prod install resolves the
 *        right versions and pnpm's onlyBuiltDependencies allows better-sqlite3
 *        to produce its native .node binary.
 *     4. `pnpm install --prod --no-optional` in resources/server/ — runtime deps
 *        only; --no-optional drops Prisma engines (Mongo/Postgres are excluded
 *        from the SQLite desktop bundle).
 *     5. Assert the better-sqlite3 native binary is present.
 * @usage  node scripts/stage-server.mjs   (run via `pnpm stage`)
 * @version-history
 *   v0.2.0 — 2026-06-05 — Initial server resource staging (SQLite-only bundle).
 */

import { execSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const repoRoot = join(desktopRoot, '..');
const aimeatDir = join(repoRoot, 'aimeat');
const serverDir = join(desktopRoot, 'src-tauri', 'resources', 'server');

function run(cmd, cwd) {
  console.log(`[stage-server] $ ${cmd}  (cwd: ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// 1. Build the server.
run('pnpm build', aimeatDir);

const distDir = join(aimeatDir, 'dist');
if (!existsSync(distDir)) {
  console.error(`[stage-server] Build did not produce ${distDir}`);
  process.exit(1);
}

// 2. Reset the staging dir and copy the build output.
rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });
cpSync(distDir, join(serverDir, 'dist'), { recursive: true });

// 3. Copy package.json (carries "type":"module" + pnpm.onlyBuiltDependencies) and lockfile.
copyFileSync(join(aimeatDir, 'package.json'), join(serverDir, 'package.json'));
const lockfile = join(aimeatDir, 'pnpm-lock.yaml');
if (existsSync(lockfile)) {
  copyFileSync(lockfile, join(serverDir, 'pnpm-lock.yaml'));
}

// 4. Install production dependencies only (with build scripts so better-sqlite3
//    yields its native binary; --no-optional drops Prisma engines).
run('pnpm install --prod --no-optional --config.confirmModulesPurge=false', serverDir);

// 5. Sanity check: the native SQLite binary must be present, or the packaged app
//    will fail to start the node.
const nativeBinary = join(
  serverDir,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
if (!existsSync(nativeBinary)) {
  console.error(`[stage-server] MISSING native binary: ${nativeBinary}`);
  console.error('[stage-server] better-sqlite3 did not build. Ensure build tools are available.');
  process.exit(1);
}

console.log(`[stage-server] Staged server -> ${serverDir}`);
console.log(`[stage-server]   native SQLite binary present: ${nativeBinary}`);
