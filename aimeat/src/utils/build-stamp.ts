/**
 * @file build-stamp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read the stamp that `pnpm build` writes into dist/, and answer one question: is the
 *   artifact we are executing older than the source it was built from? The CLI daemon consumers
 *   spawn (`aimeat connect serve`) runs from dist/, and a stale dist does not fail — it silently
 *   drops fields that exist in source, which has now cost three debugging rounds.
 *
 *   Deliberately NOT modelled on getSoftwareVersion() in version.ts. That resolver climbs OUT of
 *   dist/ to read the live package.json, which is right for advertising a version and precisely
 *   why it can never detect staleness: it always reports the source. This one resolves a single
 *   path inside dist/ and nowhere else, so "no stamp" unambiguously means "not running from dist".
 * @structure readBuildStamp(): BuildStamp | null; checkBuildFreshness(): BuildFreshness;
 *   runningBuild(): RunningBuild
 * @usage import { checkBuildFreshness } from '../utils/build-stamp.js';
 * @version-history
 *   v1.2.0 — 2026-10-11 — runningBuild(): the commit this process runs, from the stamp or, from
 *     source, from the checkout's HEAD. Served by GET /v1/build and GET /v1/health.
 *   v1.1.0 — 2026-08-02 — Detect a published install by the absence of `src/` rather than by all
 *     source dirs scanning to zero. `scripts/vendor-libs.mjs` ships as a postinstall hook, so a
 *     tarball has a `scripts/` dir whose mtimes are extraction time — which made every published
 *     install announce STALE BUILD. Found by installing the packed tarball into a clean directory.
 *   v1.0.0 — 2026-08-02 — Initial stale-dist detection for the serve daemon.
 */
import { readFileSync, readdirSync, statSync, existsSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readGitHead } from './git-head.js';

export interface BuildStamp {
  schema_version: number;
  version: string;
  commit: string | null;
  dirty: boolean | null;
  built_at: string;
  newest_source_mtime: number;
  source_dirs: string[];
}

export interface BuildFreshness {
  /**
   * - `fresh`   — built from the source currently on disk.
   * - `stale`   — source has changed since the build; this process is running old code.
   * - `source`  — running via tsx from src/ (dev), or from a build with no stamp. Nothing to check.
   * - `unknown` — running from a published tarball: stamped, but no src/ to compare against.
   */
  state: 'fresh' | 'stale' | 'source' | 'unknown';
  stamp: BuildStamp | null;
  /** Human-readable one-liner for logs; null when there is nothing worth saying. */
  message: string | null;
}

/** dist/src/utils/build-stamp.js → dist/. In dev (src/utils) this points at a path that does not exist. */
function stampPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'build-stamp.json');
}

let cached: BuildStamp | null | undefined;

/** The stamp written into dist/ at build time, or null when not running from a stamped dist. */
export function readBuildStamp(): BuildStamp | null {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(readFileSync(stampPath(), 'utf-8')) as BuildStamp;
  // eslint-disable-next-line aimeat/no-silent-catch -- absent stamp is the normal dev (tsx) case
  } catch { cached = null; }
  return cached;
}

/** Newest mtime (epoch ms) in a tree, or 0 when absent. Mirrors scripts/write-build-stamp.mjs. */
function newestMtime(dir: string): number {
  let newest = 0;
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  // eslint-disable-next-line aimeat/no-silent-catch -- unreadable dir contributes nothing
  catch { return 0; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else if (entry.isFile()) {
      try { newest = Math.max(newest, statSync(full).mtimeMs); }
      // eslint-disable-next-line aimeat/no-silent-catch -- vanished mid-walk
      catch { /* vanished mid-walk */ }
    }
  }
  return newest;
}

/**
 * Slack for mtime comparison, in ms. Some filesystems round mtimes to whole seconds, so a build
 * that recompiled everything correctly must not report itself stale over sub-second jitter.
 */
export const MTIME_SLACK_MS = 1000;

/**
 * The freshness decision, with the filesystem already reduced to one number. Pure so the rules —
 * no stamp means source, no source means unknown, and only a real gap means stale — can be tested
 * without a fixture tree.
 *
 * `newestOnDisk` is the newest source mtime in epoch ms, or 0 when there is no source to compare
 * (a published tarball ships dist/ only). That case answers `unknown`, not `fresh`: we decline to
 * claim a freshness we cannot verify.
 */
export function compareFreshness(stamp: BuildStamp | null, newestOnDisk: number): BuildFreshness {
  if (!stamp) return { state: 'source', stamp: null, message: null };
  if (newestOnDisk === 0) return { state: 'unknown', stamp, message: null };

  if (newestOnDisk > stamp.newest_source_mtime + MTIME_SLACK_MS) {
    return {
      state: 'stale',
      stamp,
      message: `built ${stamp.built_at} from source last touched ${new Date(stamp.newest_source_mtime).toISOString()}, `
        + `but source on disk is newer (${new Date(newestOnDisk).toISOString()}). `
        + 'This process is running OLD code — run `pnpm build`.',
    };
  }
  return { state: 'fresh', stamp, message: null };
}

/**
 * Announce which artifact is running, and shout when it is behind its source. Lives here rather
 * than at the call site because describing a build is this module's job, and because every
 * long-running entry point that runs from dist/ wants the same two lines.
 *
 * Warns; never exits. A stale build still serves everything that has not changed, so refusing to
 * start would turn a missing-field bug into an outage.
 */
export function announceBuild(freshness: BuildFreshness, write: (line: string) => void): void {
  if (freshness.state === 'stale') {
    write(`[serve] STALE BUILD — ${freshness.message}`);
    write('[serve] Fields added to source since that build will be dropped without an error.');
    return;
  }
  if (!freshness.stamp) {
    write('[serve] build: running from source (tsx) — no dist to be stale');
    return;
  }
  const { version, commit, dirty, built_at: builtAt } = freshness.stamp;
  const short = commit ? commit.slice(0, 8) + (dirty ? '-dirty' : '') : 'no-git';
  write(`[serve] build: v${version} ${short} built ${builtAt}${freshness.state === 'fresh' ? ' (fresh)' : ''}`);
}

/**
 * Build identity for a status payload. A client that sees `state === 'stale'` knows a missing field
 * is the local daemon dropping it, not the node refusing it — the question that has cost three
 * debugging rounds, each ending at a dist/ older than the merge.
 */
export function buildIdentity(freshness: BuildFreshness): Record<string, unknown> {
  return {
    state: freshness.state,
    version: freshness.stamp?.version ?? null,
    commit: freshness.stamp?.commit ?? null,
    dirty: freshness.stamp?.dirty ?? null,
    built_at: freshness.stamp?.built_at ?? null,
  };
}

/**
 * Which code this process runs, for GET /v1/build and GET /v1/health.
 *
 * `commit` is the commit the artifact was BUILT from when the process runs from a stamped dist/
 * (`commit_source: 'stamp'`), and the commit the checkout is ON when it runs from source
 * (`'git'`, read by utils/git-head.ts; `dirty` is then null, because only git can say). Null with
 * `commit_source: null` on an install that is neither.
 *
 * `state` is the freshness answer above. It matters next to the commit: `stale` means the source
 * on disk is newer than the build, so a `git pull` without `pnpm build` shows as an OLD commit and
 * `stale`, which is the case "the fix is on the machine and the node does not run it yet".
 */
export interface RunningBuild {
  commit: string | null;
  commit_source: 'stamp' | 'git' | null;
  dirty: boolean | null;
  built_at: string | null;
  state: BuildFreshness['state'];
}

/**
 * The decision, with the filesystem already read: a stamp that names a commit wins, because it is
 * the code that runs; the checkout's HEAD is asked only when there is none. Pure, so the rule is
 * tested without a dist/ or a repository.
 */
export function describeRunningBuild(freshness: BuildFreshness, checkoutHead: () => string | null): RunningBuild {
  const stamp = freshness.stamp;
  if (stamp?.commit) {
    return { commit: stamp.commit, commit_source: 'stamp', dirty: stamp.dirty, built_at: stamp.built_at, state: freshness.state };
  }
  const head = checkoutHead();
  return { commit: head, commit_source: head ? 'git' : null, dirty: null, built_at: stamp?.built_at ?? null, state: freshness.state };
}

let running: RunningBuild | undefined;

/** Read once per process: neither the stamp nor the checkout changes in a way a running node could act on. */
export function runningBuild(): RunningBuild {
  running ??= describeRunningBuild(checkBuildFreshness(), () => readGitHead(dirname(fileURLToPath(import.meta.url))));
  return running;
}

/** Compare the stamped source state against what is on disk now. */
export function checkBuildFreshness(): BuildFreshness {
  const stamp = readBuildStamp();
  if (!stamp) return compareFreshness(null, 0);

  const pkgRoot = join(dirname(stampPath()), '..');

  // `src/` is THE discriminator between a dev checkout and a published install, because it is the
  // one source dir that never ships. Do not infer this from the union of source_dirs: `scripts/`
  // partially ships (vendor-libs.mjs is a postinstall hook), so a tarball install has a `scripts/`
  // whose mtimes are the EXTRACTION time — newer than built_at, which made every published install
  // announce itself as a stale build. Measured on a clean `npm install` of 2.6.1 before this line.
  if (!existsSync(join(pkgRoot, 'src'))) return compareFreshness(stamp, 0);

  const dirs = stamp.source_dirs ?? ['src', 'bin', 'scripts'];
  return compareFreshness(stamp, Math.max(0, ...dirs.map((d) => newestMtime(join(pkgRoot, d)))));
}
