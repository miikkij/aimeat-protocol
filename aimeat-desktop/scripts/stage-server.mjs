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
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// 3. Copy runtime assets the server reads from the package root (not from dist/).
//    These mirror aimeat package.json "files": docs read at startup
//    (e.g. routes/bootstrap.ts loads ../../../docs/AIMEAT_Help_Prompt.md).
const helpPrompt = join(aimeatDir, 'docs', 'AIMEAT_Help_Prompt.md');
if (existsSync(helpPrompt)) {
  mkdirSync(join(serverDir, 'docs'), { recursive: true });
  copyFileSync(helpPrompt, join(serverDir, 'docs', 'AIMEAT_Help_Prompt.md'));
}
const csmExamples = join(aimeatDir, 'docs', 'csm-examples');
if (existsSync(csmExamples)) {
  cpSync(csmExamples, join(serverDir, 'docs', 'csm-examples'), { recursive: true });
}

// 3b. Copy the Ollama Chat "liaison" bridge next to node_modules so its
//     `@modelcontextprotocol/sdk` imports resolve from the bundled deps.
const bridgeSrc = join(desktopRoot, 'bridge', 'agent-bridge.mjs');
if (existsSync(bridgeSrc)) {
  copyFileSync(bridgeSrc, join(serverDir, 'agent-bridge.mjs'));
}

// 4. Write the staging package.json (carries "type":"module" + pnpm.onlyBuiltDependencies),
//    but with optionalDependencies stripped. The ONLY optional dep is @prisma/client,
//    which the SQLite bundle never imports and whose engines are large. We must NOT use
//    pnpm's --no-optional, though: quickjs-emscripten pulls quickjs-emscripten-core and
//    the @jitl/quickjs-wasmfile-* WASM variants, which pnpm treats as platform-optional —
//    --no-optional would drop the entire QuickJS runtime and crash the server at startup.
const pkg = JSON.parse(readFileSync(join(aimeatDir, 'package.json'), 'utf8'));
delete pkg.optionalDependencies;
writeFileSync(join(serverDir, 'package.json'), JSON.stringify(pkg, null, 2));
const lockfile = join(aimeatDir, 'pnpm-lock.yaml');
if (existsSync(lockfile)) {
  copyFileSync(lockfile, join(serverDir, 'pnpm-lock.yaml'));
}

// 5. Install production dependencies (with build scripts so better-sqlite3 yields its
//    native binary). Key flags:
//    --node-linker=hoisted : produce a FLAT, symlink-free node_modules. pnpm's default
//      isolated linker uses symlinks with absolute build-machine targets, which the
//      NSIS/MSI bundler breaks on copy — severing module resolution in the installed app
//      (manifests as ERR_MODULE_NOT_FOUND / "lstat 'C:'" at startup). Hoisted = real dirs.
//    --no-frozen-lockfile : reconcile the lockfile with the prisma-stripped package.json.
//    Optionals stay ON so QuickJS's WASM variants ship.
run('pnpm install --prod --no-frozen-lockfile --node-linker=hoisted --config.confirmModulesPurge=false', serverDir);

// 5b. Dedupe minimatch under readdir-glob. readdir-glob@3 is ESM and does
//     `import { Minimatch } from "minimatch"`, which needs minimatch >= 9 (ESM named export).
//     The hoisted prod install is non-deterministic across pnpm versions: on some (CI's 10.30.x)
//     it NESTS minimatch 5.1.8 (CommonJS, no ESM named export) under readdir-glob, which crashes
//     the node at boot with: "minimatch does not provide an export named 'Minimatch'". Removing
//     the nested copy makes readdir-glob resolve the hoisted top-level minimatch (10.x) and the
//     ESM import works. Verified against the packaged 0.4.5 server. (A pnpm override did NOT fix
//     this reliably — the post-install removal is the deterministic fix.)
const nestedMinimatch = join(serverDir, 'node_modules', 'readdir-glob', 'node_modules', 'minimatch');
if (existsSync(nestedMinimatch)) {
  rmSync(nestedMinimatch, { recursive: true, force: true });
  console.log(`[stage-server] removed nested minimatch under readdir-glob (forces the hoisted 10.x): ${nestedMinimatch}`);
} else {
  console.log('[stage-server] no nested minimatch under readdir-glob (ok)');
}

// 6. Sanity check: the native SQLite binary must be present, or the packaged app
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
