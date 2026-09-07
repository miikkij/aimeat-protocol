/**
 * @file asset-dirs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the three on-disk asset trees the node serves — public/, locales/ and the
 *   PWA static/ tree — actually live, in each of the layouts this code runs in. One list per tree,
 *   in one place, because the knowledge is the same knowledge three times and it had drifted:
 *   the static/ list never named the packaged location at all.
 *
 *   THE LAYOUTS. `serverDir` below is the directory of the module that asks (server-bootstrap/).
 *     - dev, run through tsx      serverDir = <pkg>/src/server-bootstrap, assets at <pkg>/{public,locales,src/static}
 *     - compiled, run in the repo serverDir = <pkg>/dist/src/server-bootstrap, both trees present
 *     - npm install               serverDir = <pkg>/dist/src/server-bootstrap, assets ONLY under <pkg>/dist/
 *     - scaffolded                the operator's CWD carries them
 *
 *   THE TRAP THIS FIXES. public/ and locales/ keep their name in the package (public/ → dist/public/),
 *   so one candidate — serverDir/../../<name> — happens to answer for both the dev tree and the
 *   package. src/static/ does NOT: the build copies it to dist/static, so the same candidate reads
 *   dist/src/static, which no layout has. Every npm-installed node therefore served no
 *   /app-catalog.html, /manifest.json, /app-silent.html or /app-login.js at all — measured on
 *   aimeat@3.13.1 on 2026-09-07, in production, by the commercial fleet, which was symlinking
 *   static → dist/static in its image to get around it.
 * @structure assetDirCandidates() — the ordered candidates for one tree · resolveAssetDir() — the first that exists
 * @version-history
 *   v1.0.0 — 2026-09-08 — Extracted from static-files.ts's three inline lists; adds the packaged
 *     location of the static/ tree, which none of them named.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The asset trees served from disk. The name is the directory the PACKAGE carries. */
export type AssetTree = 'public' | 'locales' | 'static';

/** Where the tree sits in the SOURCE checkout, relative to the package root. */
const SOURCE_SEGMENTS: Record<AssetTree, string[]> = {
  public: ['public'],
  locales: ['locales'],
  static: ['src', 'static'],
};

/**
 * The ordered locations to try for one asset tree, most specific first: an operator's own CWD,
 * then the source tree beside the running module, then the packaged copy, then the source tree of
 * a repo whose compiled output is what is running.
 *
 * @param tree      which asset tree
 * @param serverDir the asking module's directory (`dirname(fileURLToPath(import.meta.url))`)
 * @param cwd       the working directory the node was started in
 */
export function assetDirCandidates(tree: AssetTree, serverDir: string, cwd: string): string[] {
  const source = SOURCE_SEGMENTS[tree];
  const candidates = [
    join(cwd, tree),                                 // scaffolded: CWD/<tree>
    join(serverDir, '..', '..', ...source),          // dev tree: <pkg>/<source>
    join(serverDir, '..', '..', tree),               // built + npm: <pkg>/dist/<tree>
    join(serverDir, '..', '..', '..', ...source),    // compiled inside the repo: <pkg>/<source>
  ];
  // public/ and locales/ name the same directory in both trees, so two of the four coincide.
  return [...new Set(candidates)];
}

/** The first candidate that exists on disk, or undefined when the tree was not shipped. */
export function resolveAssetDir(
  tree: AssetTree,
  serverDir: string,
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return assetDirCandidates(tree, serverDir, cwd).find(exists);
}
