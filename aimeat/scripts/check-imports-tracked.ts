/**
 * @file check-imports-tracked.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Guard against the commit that ships without the files it imports. On 2026-09-04
 *   c932f2f17 added `import './sdk-science.js'` and `import type from './types.js'` to a file on
 *   the server's boot path, and neither file was ever committed: they existed in the author's
 *   worktree, so the pre-commit hook (which reads the worktree) passed, and origin/main stopped
 *   booting for everyone else. This walks every relative import in src/ and test/, resolves it the
 *   way Node and tsc do (.js → .ts, index files, bare directories), and refuses when the target
 *   is missing from the worktree OR present but untracked by git. Type-only imports count: tsc
 *   fails on them too.
 * @structure listSources() → relativeImports(file) → resolve(from, spec) → tracked set from
 *   `git ls-files` → report and exit
 * @usage  pnpm check:imports-tracked   (pre-commit, CI); `--staged` reads the index's file list
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-coding-central-parallel-sessions).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const ROOTS = ['src', 'test', 'scripts'].map((d) => join(AIMEAT, d));
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|[^\w.])import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated']);

/** Every .ts/.js/.mjs source under the roots, skipping build output. */
function listSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
  };
  for (const root of ROOTS) if (existsSync(root)) walk(root);
  return out;
}

/** The relative specifiers a file imports, static and dynamic. */
function relativeImports(file: string, text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    // An import written inside a template literal is a fixture (a check script's test feeds
    // source text to the checker), not an import of this file: an odd count of backticks
    // before the match means we are inside one.
    const before = text.slice(0, m.index || 0);
    if ((before.match(/`/g) || []).length % 2 === 1) continue;
    // A usage example in a header comment (` *   await import('../x.js')`) is prose, not an
    // import of this file: skip a match whose line opens as a comment.
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = text.slice(lineStart, text.indexOf('\n', m.index || 0));
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
    specs.push(m[1] || m[2]);
  }
  return specs;
}

/** The candidates a specifier may mean on disk, in the order Node and tsc try them. */
function candidates(from: string, spec: string): string[] {
  const base = resolve(dirname(from), spec);
  const list = [base];
  if (base.endsWith('.js')) list.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.mts');
  if (base.endsWith('.mjs')) list.push(base.slice(0, -4) + '.mts');
  if (!/\.\w+$/.test(base)) list.push(base + '.ts', base + '.js', join(base, 'index.ts'), join(base, 'index.js'));
  return list;
}

function trackedFiles(): Set<string> {
  const raw = execFileSync('git', ['ls-files', '-z', '--', 'aimeat'], { cwd: resolve(AIMEAT, '..') }).toString('utf-8');
  const set = new Set<string>();
  for (const p of raw.split('\0')) if (p) set.add(resolve(AIMEAT, '..', p).split(sep).join('/'));
  return set;
}

/** Files whose worktree copy differs from the index: their imports are read from the index. */
function unstagedFiles(): Set<string> {
  const raw = execFileSync('git', ['diff', '--name-only', '-z', '--', 'aimeat'], { cwd: resolve(AIMEAT, '..') }).toString('utf-8');
  const set = new Set<string>();
  for (const p of raw.split('\0')) if (p) set.add(resolve(AIMEAT, '..', p).split(sep).join('/'));
  return set;
}

/** The text a commit would carry: the index copy when the worktree has unstaged edits. */
function committedText(file: string, unstaged: Set<string>): string {
  const key = file.split(sep).join('/');
  if (!unstaged.has(key)) return readFileSync(file, 'utf-8');
  const rel = relative(resolve(AIMEAT, '..'), file).split(sep).join('/');
  return execFileSync('git', ['show', ':' + rel], { cwd: resolve(AIMEAT, '..') }).toString('utf-8');
}

function main(): void {
  const tracked = trackedFiles();
  const unstaged = unstagedFiles();
  const problems: string[] = [];
  let checked = 0;
  // Only files the commit carries (tracked or staged) are importers: an untracked file's
  // imports go nowhere yet, and a peer's unstaged edit in a shared checkout is not this commit.
  for (const file of listSources()) {
    if (!tracked.has(file.split(sep).join('/'))) continue;
    for (const spec of relativeImports(file, committedText(file, unstaged))) {
      checked += 1;
      const found = candidates(file, spec).find((c) => existsSync(c) && statSync(c).isFile());
      const at = `${relative(AIMEAT, file).split(sep).join('/')} imports "${spec}"`;
      if (!found) { problems.push(`${at}: no file answers it`); continue; }
      if (!tracked.has(found.split(sep).join('/'))) {
        problems.push(`${at}: ${relative(AIMEAT, found).split(sep).join('/')} exists here but git does not track it (git add it, or the commit ships without it)`);
      }
    }
  }
  if (problems.length) {
    console.error(`✗ ${problems.length} import(s) point at files a commit would not carry:`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log(`✓ imports tracked: ${checked} relative imports resolve to committed files`);
}

main();
