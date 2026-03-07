# Scaffold & Bundle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `aimeat init` scaffold all runtime files (public/, locales/, static/) into the target directory, and bundle them in the npm package so the server can run standalone from any folder.

**Architecture:** The build script copies asset directories into `dist/`. A new `src/cli/scaffold.ts` module handles copying assets from the package root into CWD with a SHA256 checksum manifest (`.aimeat-manifest.json`) that prevents overwriting user-modified files on re-runs. `server.ts` is updated to prefer CWD paths first.

**Tech Stack:** Node.js fs (cpSync, createHash), @clack/prompts for scaffold UI, vitest for unit tests.

---

### Task 1: Build script — bundle assets into `dist/`

**Files:**
- Modify: `aimeat/package.json`

**Step 1: Update the build script in package.json**

Change the `"build"` script from:
```json
"build": "tsc && node -e \"const fs=require('fs');fs.cpSync('locales','dist/locales',{recursive:true})\""
```
to:
```json
"build": "tsc && node -e \"const fs=require('fs');fs.cpSync('locales','dist/locales',{recursive:true});fs.cpSync('public','dist/public',{recursive:true});fs.cpSync('src/static','dist/static',{recursive:true});fs.cpSync('.env.example','dist/.env.example')\""
```

**Step 2: Add `"files"` field for npm publish**

Add after the `"bin"` field:
```json
"files": [
  "dist/"
],
```

**Step 3: Verify build works**

Run: `cd aimeat && pnpm build`
Expected: `dist/public/`, `dist/static/`, `dist/locales/`, `dist/.env.example` all exist.

**Step 4: Commit**

```bash
git add aimeat/package.json
git commit -m "build: bundle public/, static/, locales/ into dist/ for npm packaging"
```

---

### Task 2: Scaffold utility — `src/cli/scaffold.ts`

**Files:**
- Create: `aimeat/src/cli/scaffold.ts`
- Create: `aimeat/test/unit/scaffold.test.ts`

**Step 1: Write the failing tests**

Create `aimeat/test/unit/scaffold.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFileHash, readManifest, writeManifest, scaffoldFiles } from '../../src/cli/scaffold.js';
import type { ScaffoldManifest } from '../../src/cli/scaffold.js';

describe('scaffold', () => {
  let srcDir: string;
  let targetDir: string;

  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), 'scaffold-src-'));
    targetDir = mkdtempSync(join(tmpdir(), 'scaffold-target-'));

    // Create source asset structure
    mkdirSync(join(srcDir, 'public', 'css'), { recursive: true });
    mkdirSync(join(srcDir, 'public', 'js'), { recursive: true });
    mkdirSync(join(srcDir, 'locales'), { recursive: true });
    mkdirSync(join(srcDir, 'static', 'icons'), { recursive: true });

    writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: red; }');
    writeFileSync(join(srcDir, 'public', 'js', 'app.js'), 'console.log("hi")');
    writeFileSync(join(srcDir, 'locales', 'en.json'), '{"hello":"world"}');
    writeFileSync(join(srcDir, 'static', 'manifest.json'), '{"name":"test"}');
    writeFileSync(join(srcDir, 'static', 'icons', 'icon.svg'), '<svg/>');
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  describe('computeFileHash', () => {
    it('returns consistent SHA256 hex for file content', () => {
      const path = join(srcDir, 'public', 'css', 'theme.css');
      const hash1 = computeFileHash(path);
      const hash2 = computeFileHash(path);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('readManifest / writeManifest', () => {
    it('returns null when no manifest exists', () => {
      expect(readManifest(targetDir)).toBeNull();
    });

    it('round-trips a manifest', () => {
      const manifest: ScaffoldManifest = {
        version: '1.2.0',
        scaffoldedAt: '2026-03-07T00:00:00Z',
        files: { 'public/css/theme.css': 'abc123' },
      };
      writeManifest(targetDir, manifest);
      expect(readManifest(targetDir)).toEqual(manifest);
    });
  });

  describe('scaffoldFiles', () => {
    it('copies all files on fresh scaffold', () => {
      const result = scaffoldFiles(srcDir, targetDir, '1.2.0');
      expect(result.copied).toBeGreaterThanOrEqual(5);
      expect(result.skippedModified).toBe(0);
      expect(result.updated).toBe(0);
      expect(existsSync(join(targetDir, 'public', 'css', 'theme.css'))).toBe(true);
      expect(existsSync(join(targetDir, 'locales', 'en.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'static', 'manifest.json'))).toBe(true);
      // Manifest should exist
      const manifest = readManifest(targetDir);
      expect(manifest).not.toBeNull();
      expect(manifest!.files['public/css/theme.css']).toBeDefined();
    });

    it('updates unmodified files on re-scaffold', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      // Change source file
      writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: blue; }');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.updated).toBeGreaterThanOrEqual(1);
      expect(readFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'utf-8')).toBe('body { color: blue; }');
    });

    it('skips user-modified files', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      // User edits a file
      writeFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'body { color: green; /* custom */ }');
      // Re-scaffold with updated source
      writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: blue; }');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.skippedModified).toBeGreaterThanOrEqual(1);
      // User's version preserved
      expect(readFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'utf-8')).toBe('body { color: green; /* custom */ }');
    });

    it('copies new files that did not exist before', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      // Add new source file
      writeFileSync(join(srcDir, 'public', 'js', 'new.js'), 'new file');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.copied).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(targetDir, 'public', 'js', 'new.js'))).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd aimeat && npx vitest run test/unit/scaffold.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/scaffold.js`

**Step 3: Write the scaffold implementation**

Create `aimeat/src/cli/scaffold.ts`:

```typescript
/**
 * Scaffold utility for `aimeat init` and `aimeat update`.
 * Copies runtime assets (public/, locales/, static/) into a target directory
 * with a checksum manifest to avoid overwriting user-modified files.
 */

import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  statSync, writeFileSync,
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

/** Directories to scaffold from package root into target. */
const SCAFFOLD_DIRS = ['public', 'locales', 'static'];

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
  for (const dir of SCAFFOLD_DIRS) {
    const srcDir = join(pkgRoot, dir);
    if (!existsSync(srcDir)) continue;

    const files = listFiles(srcDir, pkgRoot);
    for (const relPath of files) {
      const srcPath = join(pkgRoot, relPath);
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
  // From dist/src/cli/ -> check ../../.. (package root with dist/public/)
  // and ../.. (dev mode with public/ at aimeat/)
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
```

**Step 4: Run tests to verify they pass**

Run: `cd aimeat && npx vitest run test/unit/scaffold.test.ts`
Expected: All 7 tests PASS

**Step 5: Run typecheck**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add aimeat/src/cli/scaffold.ts aimeat/test/unit/scaffold.test.ts
git commit -m "feat: add scaffold utility with checksum manifest for safe updates"
```

---

### Task 3: Integrate scaffold into init wizard

**Files:**
- Modify: `aimeat/src/cli/init-wizard.ts` (around line 1463)
- Modify: `aimeat/locales/en.json` (add scaffold i18n keys)
- Modify: `aimeat/locales/fi.json` (add scaffold i18n keys)

**Step 1: Add i18n keys to `locales/en.json`**

Add under the `"init"` section:
```json
"scaffoldPrompt": "Copy runtime files (public/, locales/, static/) into this directory?",
"scaffoldCopying": "Scaffolding runtime files...",
"scaffoldDone": "Scaffolded: {copied} copied, {updated} updated, {skipped} skipped (user-modified)",
"scaffoldSkippedFile": "Skipped (modified): {file}",
"scaffoldNoSource": "Could not locate package assets to scaffold. Skipping file copy.",
"updateDone": "Assets updated: {copied} new, {updated} updated, {skipped} skipped (user-modified)"
```

**Step 2: Add i18n keys to `locales/fi.json`**

Add the Finnish equivalents:
```json
"scaffoldPrompt": "Kopioidaanko ajonaikaiset tiedostot (public/, locales/, static/) tahan hakemistoon?",
"scaffoldCopying": "Kopioidaan ajonaikaisia tiedostoja...",
"scaffoldDone": "Kopioitu: {copied} uutta, {updated} paivitetty, {skipped} ohitettu (kayttajan muokkaamia)",
"scaffoldSkippedFile": "Ohitettu (muokattu): {file}",
"scaffoldNoSource": "Paketin tiedostoja ei loydy. Ohitetaan tiedostojen kopiointi.",
"updateDone": "Tiedostot paivitetty: {copied} uutta, {updated} paivitetty, {skipped} ohitettu (kayttajan muokkaamia)"
```

**Step 3: Add scaffold step to init wizard**

In `aimeat/src/cli/init-wizard.ts`, after line 1463 (`p.log.success(t('init.written', { file: fileName }));`), add the scaffold step:

```typescript
  // ── Scaffold runtime files ──
  const shouldScaffold = checkCancel(await p.confirm({
    message: t('init.scaffoldPrompt'),
    initialValue: true,
  }), t);

  if (shouldScaffold) {
    const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./scaffold.js');
    const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    if (pkgRoot) {
      const spinner = p.spinner();
      spinner.start(t('init.scaffoldCopying'));
      const scaffoldResult = doScaffold(pkgRoot, process.cwd(), '1.2.0');
      spinner.stop(t('init.scaffoldDone', {
        copied: String(scaffoldResult.copied),
        updated: String(scaffoldResult.updated),
        skipped: String(scaffoldResult.skippedModified),
      }));
      for (const file of scaffoldResult.modifiedFiles) {
        p.log.warn(t('init.scaffoldSkippedFile', { file }));
      }
    } else {
      p.log.warn(t('init.scaffoldNoSource'));
    }
  }
```

Also add `dirname` and `fileURLToPath` imports if not already present (they are already imported at line 8-9).

**Step 4: Read the version from package.json instead of hardcoding**

At the top of the scaffold call, read the version dynamically:
```typescript
    if (pkgRoot) {
      // Read version from package.json
      const pkgJsonPath = join(pkgRoot, 'package.json');
      const pkgVersion = existsSync(pkgJsonPath)
        ? JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version
        : '0.0.0';
      // ... use pkgVersion instead of '1.2.0'
    }
```

**Step 5: Run typecheck**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add aimeat/src/cli/init-wizard.ts aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: scaffold runtime files into CWD on aimeat init"
```

---

### Task 4: Server.ts — CWD path priority

**Files:**
- Modify: `aimeat/src/server.ts` (lines 145-148, 206-208, 216-218, 523-525)

**Step 1: Add CWD as first candidate for public/**

In `server.ts` around line 145, change:
```typescript
  const publicCandidates = [
    join(__dirname, '..', 'public'),      // dev: src/../public
    join(__dirname, '..', '..', 'public'), // dist: dist/src/../../public
  ];
```
to:
```typescript
  const publicCandidates = [
    join(process.cwd(), 'public'),         // scaffolded: CWD/public
    join(__dirname, '..', 'public'),       // dev: src/../public
    join(__dirname, '..', '..', 'public'), // dist: dist/src/../../public
  ];
```

**Step 2: Add CWD as first candidate for locales/**

Around line 206, change:
```typescript
  const localeCandidates = [
    join(__dirname, '..', 'locales'),      // dev: src/../locales
    join(__dirname, '..', '..', 'locales'), // dist: dist/src/../../locales
  ];
```
to:
```typescript
  const localeCandidates = [
    join(process.cwd(), 'locales'),        // scaffolded: CWD/locales
    join(__dirname, '..', 'locales'),      // dev: src/../locales
    join(__dirname, '..', '..', 'locales'), // dist: dist/src/../../locales
  ];
```

**Step 3: Add CWD as first candidate for static/**

Around line 216, change:
```typescript
  const pwaCandidates = [
    join(__dirname, '..', 'src', 'static'),      // dev
    join(__dirname, '..', '..', 'src', 'static'), // dist
  ];
```
to:
```typescript
  const pwaCandidates = [
    join(process.cwd(), 'static'),                // scaffolded: CWD/static
    join(__dirname, '..', 'src', 'static'),       // dev
    join(__dirname, '..', '..', 'src', 'static'), // dist
  ];
```

**Step 4: Add CWD as first candidate for wizard.html**

Around line 523, change:
```typescript
      const wizardCandidates = [
        join(__dirname, '..', 'public', 'wizard.html'),
        join(__dirname, '..', '..', 'public', 'wizard.html'),
      ];
```
to:
```typescript
      const wizardCandidates = [
        join(process.cwd(), 'public', 'wizard.html'),
        join(__dirname, '..', 'public', 'wizard.html'),
        join(__dirname, '..', '..', 'public', 'wizard.html'),
      ];
```

**Step 5: Run typecheck**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add aimeat/src/server.ts
git commit -m "feat: prefer CWD paths for public/, locales/, static/ over package paths"
```

---

### Task 5: Add `aimeat update` subcommand

**Files:**
- Modify: `aimeat/src/index.ts` (add update subcommand handling + help text)

**Step 1: Add `aimeat update` to the help text**

In `src/index.ts`, add to `HELP_TEXT` after the `aimeat init` line:
```
  aimeat update                  Re-scaffold runtime files (safe update)
```

**Step 2: Add the subcommand handler**

In `src/index.ts`, add a new `else if` branch after the `init` handler (after line 200):

```typescript
} else if (subcommand === 'update') {
  const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./cli/scaffold.js');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (!pkgRoot) {
    console.error('Could not locate package assets. Is aimeat installed correctly?');
    process.exit(1);
  }
  const pkgJsonPath = join(pkgRoot, 'package.json');
  const pkgVersion = existsSync(pkgJsonPath)
    ? JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version
    : '0.0.0';
  const result = doScaffold(pkgRoot, process.cwd(), pkgVersion);
  console.log(`Assets updated: ${result.copied} new, ${result.updated} updated, ${result.skippedModified} skipped (user-modified)`);
  for (const file of result.modifiedFiles) {
    console.log(`  Skipped (modified): ${file}`);
  }
  if (result.skippedUnchanged > 0) {
    console.log(`  ${result.skippedUnchanged} files unchanged`);
  }
  process.exit(0);
```

**Step 3: Run typecheck**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add aimeat/src/index.ts
git commit -m "feat: add aimeat update subcommand for safe asset re-scaffolding"
```

---

### Task 6: Final verification

**Step 1: Full build**

Run: `cd aimeat && pnpm build`
Expected: Builds cleanly, `dist/public/` and `dist/static/` exist

**Step 2: Run all unit tests**

Run: `cd aimeat && npx vitest run`
Expected: All tests pass including scaffold tests

**Step 3: Manual smoke test**

```bash
mkdir /tmp/test-node && cd /tmp/test-node
node /path/to/aimeat/dist/bin/aimeat.js update
ls public/ locales/ static/
cat .aimeat-manifest.json
```
Expected: All directories populated, manifest contains SHA256 hashes

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: scaffold & bundle final cleanup"
```
