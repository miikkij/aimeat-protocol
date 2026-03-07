/**
 * Scaffold utility for `aimeat init` and `aimeat update`.
 * Copies runtime assets (public/, locales/, static/) into a target directory
 * with a checksum manifest to avoid overwriting user-modified files.
 */

import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface ScaffoldManifest {
  version: string;
  scaffoldedAt: string;
  files: Record<string, string>; // relative path -> SHA256 hex
}

export interface ScaffoldResult {
  copied: number;
  updated: number;
  skippedModified: number;
  skippedUnchanged: number;
  modifiedFiles: string[];
}

const MANIFEST_FILE = '.aimeat-manifest.json';

/**
 * Directories to scaffold: [sourceDir, targetDir].
 * In dev mode, static files live at src/static/; in dist they're at static/.
 * Both map to static/ in the target directory.
 */
const SCAFFOLD_DIRS: Array<[string, string]> = [
  ['public', 'public'],
  ['locales', 'locales'],
  ['static', 'static'],        // dist mode
  ['src/static', 'static'],    // dev mode fallback
];

export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function readManifest(dir: string): ScaffoldManifest | null {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

export function writeManifest(dir: string, manifest: ScaffoldManifest): void {
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n');
}

/** Recursively list all files in a directory, returning paths relative to base. */
function listFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(full, base));
    } else {
      results.push(relative(base, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * Scaffold runtime assets from pkgRoot into targetDir.
 *
 * - Fresh scaffold: copies everything, writes manifest.
 * - Re-scaffold: skips user-modified files, updates unmodified, copies new.
 */
export function scaffoldFiles(
  pkgRoot: string,
  targetDir: string,
  version: string,
): ScaffoldResult {
  const existingManifest = readManifest(targetDir);
  const oldHashes = existingManifest?.files ?? {};
  const newHashes: Record<string, string> = {};

  const result: ScaffoldResult = {
    copied: 0,
    updated: 0,
    skippedModified: 0,
    skippedUnchanged: 0,
    modifiedFiles: [],
  };

  // Collect all source files across scaffold dirs
  const seenTargets = new Set<string>();
  for (const [srcDirName, targetDirName] of SCAFFOLD_DIRS) {
    const srcDir = join(pkgRoot, srcDirName);
    if (!existsSync(srcDir)) continue;
    // Skip if we already processed this target (e.g. static/ found in dist mode)
    if (seenTargets.has(targetDirName)) continue;
    seenTargets.add(targetDirName);

    const files = listFiles(srcDir, join(pkgRoot, srcDirName));
    for (const fileRelPath of files) {
      const relPath = targetDirName + '/' + fileRelPath;
      const srcPath = join(srcDir, fileRelPath);
      const destPath = join(targetDir, relPath);
      const srcHash = computeFileHash(srcPath);

      if (!existsSync(destPath)) {
        // New file — copy it
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath);
        newHashes[relPath] = srcHash;
        result.copied++;
      } else {
        const destHash = computeFileHash(destPath);
        const manifestHash = oldHashes[relPath];

        if (manifestHash && destHash !== manifestHash) {
          // User modified this file — skip it, keep their hash reference
          newHashes[relPath] = manifestHash;
          result.skippedModified++;
          result.modifiedFiles.push(relPath);
        } else if (destHash === srcHash) {
          // File unchanged in both source and target — skip
          newHashes[relPath] = srcHash;
          result.skippedUnchanged++;
        } else {
          // File not modified by user (matches manifest or no manifest) — update
          cpSync(srcPath, destPath);
          newHashes[relPath] = srcHash;
          result.updated++;
        }
      }
    }
  }

  // Write updated manifest
  writeManifest(targetDir, {
    version,
    scaffoldedAt: new Date().toISOString(),
    files: newHashes,
  });

  return result;
}

/**
 * Find the package root directory containing assets.
 * Searches from the compiled JS location upward.
 */
export function findPackageRoot(fromDir: string): string | null {
  const candidates = [
    join(fromDir, '..', '..', '..'),  // dist/src/cli -> aimeat/
    join(fromDir, '..', '..'),         // src/cli -> aimeat/
  ];

  for (const candidate of candidates) {
    // Check for public/ dir as marker
    if (existsSync(join(candidate, 'public')) && existsSync(join(candidate, 'locales'))) {
      return candidate;
    }
    // Check for dist/public/ (npm installed package)
    if (existsSync(join(candidate, 'dist', 'public')) && existsSync(join(candidate, 'dist', 'locales'))) {
      return join(candidate, 'dist');
    }
  }
  return null;
}
