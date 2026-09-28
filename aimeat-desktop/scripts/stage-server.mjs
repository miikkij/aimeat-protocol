/**
 * @file stage-server.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   Between the install and the assert, the files no running server reads are taken out
 *   (step 5c), and so are the native prebuilds for other platforms (step 5d). Every install
 *   lifecycle hook of the server's package.json is dropped first, because this folder has dist/
 *   and no scripts/ (step 4).
 * @usage  node scripts/stage-server.mjs   (run via `pnpm stage`)
 * @version-history
 *   v0.5.0 — 2026-09-29 — Step 5d: prebuilds/<platform>-<arch>/ folders for other platforms are
 *     removed, and on Linux musl builds too; linuxdeploy had stopped the first Linux AppImage build
 *     on an Android binary of bare-fs.
 *   v0.4.0 — 2026-09-29 — Step 5c: source maps, type declarations and dependency markdown are
 *     removed after the install, about 86 MB of a 353 MB bundle.
 *   v0.3.0 — 2026-09-18 — The server's install lifecycle hooks are dropped from the staged
 *     package.json; the node's new postinstall had failed the desktop-v0.5.0 release build.
 *   v0.2.0 — 2026-06-05 — Initial server resource staging (SQLite-only bundle).
 */

import { execSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// 4. Write the staging package.json (carries "type":"module" + pnpm.onlyBuiltDependencies),
//    but with optionalDependencies stripped. The ONLY optional dep is @prisma/client,
//    which the SQLite bundle never imports and whose engines are large. We must NOT use
//    pnpm's --no-optional, though: quickjs-emscripten pulls quickjs-emscripten-core and
//    the @jitl/quickjs-wasmfile-* WASM variants, which pnpm treats as platform-optional —
//    --no-optional would drop the entire QuickJS runtime and crash the server at startup.
const pkg = JSON.parse(readFileSync(join(aimeatDir, 'package.json'), 'utf8'));
delete pkg.optionalDependencies;

// The staged folder is a place to install dependencies into, not a checkout: it holds dist/ and
// no scripts/. So an install lifecycle script from the server's own package.json cannot run here
// and takes the whole install down with it. On 2026-09-18 the release build failed exactly that
// way, at `postinstall: node scripts/vendor-libs.mjs --optional`, which the node had gained since
// the last installer was built in June. Nothing is lost by removing it: vendor-libs writes the
// browser libraries into public/lib, and dist/public/lib was copied in whole a few lines above,
// already vendored by the `pnpm build` this script ran. prepublishOnly is npm-publish only and
// would be worse: it runs the licence gates and a second build.
for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']) {
  if (pkg.scripts?.[hook]) {
    console.log(`[stage-server] dropped the "${hook}" script: this folder has dist/ and no scripts/`);
    delete pkg.scripts[hook];
  }
}
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

// 5c. Take out what a running server never reads. Measured on 2026-09-29 against the staged
//     bundle of that day, 352.7 MB of files: 54.4 MB of source maps, 25.5 MB of TypeScript type
//     declarations and 5.9 MB of markdown inside node_modules, about 86 MB together. The 0.5.0
//     installer had grown to 105 MB from June's 49 MB, and this was the part of the growth that
//     buys nothing.
//
//     Three kinds only, each safe for a stated reason:
//       *.map          read by a debugger with the file open, never by Node or a browser at run
//                      time; a missing map is a devtools warning and nothing else.
//       *.d.ts, .d.mts, .d.cts
//                      type declarations for a compiler; nothing executes them.
//       *.md, *.markdown under node_modules only
//                      READMEs and changelogs of dependencies. NOT under dist/: the server reads
//                      its own markdown at startup (docs/AIMEAT_Help_Prompt.md among others).
//     Left in on purpose: TypeScript sources and test or docs folders inside dependencies (7 MB
//     and 10 MB), because a package can load a file from a folder with such a name at run time
//     and the saving does not justify finding out in someone's installed app. Also left in: the
//     browser libraries under dist/public/lib, duckdb-wasm's 37 MB included, because the AIMEAT
//     on this computer serves them to the apps it hosts.
function pruneForRuntime(dir, inNodeModules = false) {
  let removed = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = pruneForRuntime(full, inNodeModules || entry.name === 'node_modules');
      removed += sub.removed;
      files += sub.files;
      continue;
    }
    const name = entry.name.toLowerCase();
    const drop = name.endsWith('.map')
      || /\.d\.(ts|mts|cts)$/.test(name)
      || (inNodeModules && /\.(md|markdown)$/.test(name));
    if (!drop) continue;
    removed += statSync(full).size;
    files += 1;
    rmSync(full, { force: true });
  }
  return { removed, files };
}
const pruned = pruneForRuntime(serverDir);
console.log(`[stage-server] removed ${pruned.files} files no running server reads (${(pruned.removed / 1048576).toFixed(1)} MB): source maps, type declarations, dependency markdown`);

// 5d. Keep the native prebuilds for this platform only. A package built with prebuildify ships a
//     binary for every platform in prebuilds/<platform>-<arch>/ (bare-fs, bare-path and bare-url
//     carry 13 each: Android, iOS, macOS, Linux and Windows) and loads the one for the platform it
//     runs on. Each platform stages on its own runner, so the others are dead weight, and on Linux
//     they are worse: linuxdeploy runs ldd over every ELF file in the AppImage, ldd cannot read an
//     Android binary, and the 2026-09-28 build stopped there ("Failed to run ldd", on
//     bare-fs/prebuilds/android-x64). A folder is kept when its platform is this one and one of its
//     '+'-joined architectures is this one (darwin-x64+arm64 is a universal build).
//     On Linux, musl builds go as well, files tagged .musl. and folders named for musl: the
//     AppImage and the .deb run on glibc, where a musl library can never load, and linuxdeploy
//     refuses one whose libc.musl dependency it cannot find.
function pruneForeignPrebuilds(dir) {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (!entry.isDirectory()) {
      if (process.platform === 'linux' && entry.name.includes('.musl.')) {
        removed += statSync(full).size;
        rmSync(full, { force: true });
      }
      continue;
    }
    if (process.platform === 'linux' && /musl/i.test(entry.name)) {
      removed += sizeOf(full);
      rmSync(full, { recursive: true, force: true });
      continue;
    }
    if (entry.name === 'prebuilds') {
      for (const target of readdirSync(full, { withFileTypes: true })) {
        if (!target.isDirectory()) continue;
        const [platform, archs = ''] = target.name.split(/-(.*)/s);
        if (platform === process.platform && archs.split('+').includes(process.arch)) continue;
        const targetDir = join(full, target.name);
        removed += sizeOf(targetDir);
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
    removed += pruneForeignPrebuilds(full);
  }
  return removed;
}
function sizeOf(dir) {
  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    size += entry.isDirectory() ? sizeOf(full) : statSync(full).size;
  }
  return size;
}
const foreign = pruneForeignPrebuilds(join(serverDir, 'node_modules'));
console.log(`[stage-server] removed native prebuilds for other platforms (${(foreign / 1048576).toFixed(1)} MB); kept ${process.platform}-${process.arch}`);

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
