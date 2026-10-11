/**
 * @file check-package-scripts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every script in every tracked package.json points at something that exists in a clean
 *   checkout: each file it names (a script, a test, a config, an --env-file) is tracked by git, and
 *   each `pnpm <name>` / `npm run <name>` it calls is a script of the package.json in the directory
 *   it runs in. On 2026-10-11 the root `test:e2e:micro-memory` called a script deleted with
 *   micro-memory on 2026-08-23, and aimeat's `test:e2e` and `test:e2e:memory` read a
 *   .env.test.memory nobody had shipped since the memory backend was retired; a public repository
 *   offered all three as commands.
 *
 *   Some names are not in git and still count as present: build output under dist/, a file written
 *   by the command itself (after -o), the operator's own aimeat/.env, and the .env.test.* files
 *   `pnpm test:env:init` writes (scripts/test-env-init.ts names them as targets).
 * @structure trackedFiles() · envInitTargets() · segments(command) · checkScript() · main
 * @usage  pnpm check:package-scripts   (in check:fast, so pnpm gate and CI)
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-kuolleet-testiskriptit-pois-test-e2e-micro-memory-ja-muistib).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** pnpm and npm commands that are not scripts: a `pnpm <one of these>` is not looked up in package.json. */
const BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'exec', 'dlx', 'x', 'link', 'unlink',
  'publish', 'pack', 'store', 'why', 'list', 'ls', 'outdated', 'audit', 'rebuild', 'prune', 'fetch', 'import',
  'create', 'init', 'config', 'setup', 'env', 'patch', 'patch-commit', 'licenses', 'approve-builds', 'version',
]);
/** A token that names a file: a path ending in a source, config or data extension. */
const FILE_TOKEN = /^(?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|mts|mjs|cjs|js|sh|py|json|yaml|yml)$/;
/** Output a build writes; not in git, and named by start and similar scripts on purpose. */
const GENERATED = /^dist\//;
/** The node's own settings file: every operator writes it (`aimeat init`, or a copy of .env.example), and no repository holds it. */
const OPERATOR_ENV = 'aimeat/.env';
/** A flag whose next word is a file the command writes, not one it reads. */
const OUTPUT_FLAGS = new Set(['-o', '--output', '--out', '--outfile', '--out-file', '>']);

function trackedFiles(): Set<string> {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return new Set(out.split('\0').filter(Boolean));
}

/** The .env.test.* files `pnpm test:env:init` writes, relative to the repository root. */
function envInitTargets(): Set<string> {
  const src = readFileSync(join(REPO, 'aimeat', 'scripts', 'test-env-init.ts'), 'utf-8');
  return new Set([...src.matchAll(/target:\s*'([^']+)'/g)].map((m) => posix.join('aimeat', m[1]!)));
}

/** The command split at && || ; and |, with the code after `node -e` and its kind removed. */
function segments(command: string): string[][] {
  const withoutInline = command.replace(/\s(?:-e|--eval|-c)\s+("[^"]*"|'[^']*')/g, ' ');
  return withoutInline.split(/&&|\|\||;|\|/).map((s) => s.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^['"]|['"]$/g, '')));
}

interface Problem { pkg: string; script: string; reason: string }

function main(): void {
  const tracked = trackedFiles();
  const generated = envInitTargets();
  const packages = [...tracked].filter((f) => f === 'package.json' || f.endsWith('/package.json'));
  const scriptsOf = new Map<string, Record<string, string>>();
  for (const pkg of packages) {
    const json = JSON.parse(readFileSync(join(REPO, pkg), 'utf-8')) as { scripts?: Record<string, string> };
    scriptsOf.set(posix.dirname(pkg), json.scripts ?? {});
  }

  const problems: Problem[] = [];
  for (const pkg of packages) {
    const home = posix.dirname(pkg);
    for (const [name, command] of Object.entries(scriptsOf.get(home)!)) {
      let cwd = home;
      for (const words of segments(command)) {
        if (words.length === 0) continue;
        if (words[0] === 'cd' && words[1]) { cwd = posix.normalize(posix.join(cwd, words[1])); continue; }
        if (words[0] === 'pnpm' || words[0] === 'npm' || words[0] === 'yarn') {
          const called = words[1] === 'run' ? words[2] : words[1];
          if (called && !called.startsWith('-') && (words[1] === 'run' || !BUILTINS.has(called))) {
            const target = scriptsOf.get(cwd);
            if (!target) problems.push({ pkg, script: name, reason: `runs "${words.join(' ')}" in ${cwd}/, which has no package.json` });
            else if (!(called in target)) problems.push({ pkg, script: name, reason: `calls "${called}", which ${posix.join(cwd, 'package.json')} does not define` });
          }
          continue;
        }
        for (const [i, word] of words.entries()) {
          if (i > 0 && OUTPUT_FLAGS.has(words[i - 1]!)) continue;
          const file = word.startsWith('--env-file=') ? word.slice('--env-file='.length) : word;
          if (!FILE_TOKEN.test(file) && !word.startsWith('--env-file=')) continue;
          const path = posix.normalize(posix.join(cwd, file));
          if (GENERATED.test(posix.relative(cwd, path)) || tracked.has(path) || generated.has(path) || path === OPERATOR_ENV) continue;
          problems.push({ pkg, script: name, reason: `names ${path}, which is not in the repository` });
        }
      }
    }
  }

  if (problems.length === 0) {
    const count = [...scriptsOf.values()].reduce((n, s) => n + Object.keys(s).length, 0);
    console.log(`✓ every script in ${packages.length} package.json files points at something that exists (${count} scripts)`);
    return;
  }
  console.error(`✗ ${problems.length} package.json script(s) point at something that does not exist:\n`);
  for (const p of problems) console.error(`  ${p.pkg}  "${p.script}"  ${p.reason}`);
  console.error('\n  Remove the script, or fix what it names. A dead command in a public repository sends the next developer nowhere.');
  process.exit(1);
}

main();
