#!/usr/bin/env node
/**
 * @file scripts/check-version-drift.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Can this version number mean two different things at once?
 *
 *   WHAT HAPPENED. Published `aimeat` 3.11.0 and a working tree's 3.11.0 were different code for
 *   days, and nothing anywhere could tell them apart. It cost crewaimeat-dev half a day hunting a
 *   bug that was a missing publish — the worst kind of afternoon, because every reading was
 *   consistent and every reading was of the wrong artifact.
 *
 *   WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. It makes the gap FINDABLE. It does not try
 *   to stop a publish, block a build or hold a version back: deciding when to ship is the
 *   developer's, and a gate that refuses would be answering a question nobody asked it. Two
 *   readings, one local and always available, one from the registry and best-effort:
 *
 *   1. THE ARTIFACT (offline, always). `dist/build-stamp.json` carries the commit it was built
 *      from. If that is not HEAD, the dist you would run — and `aimeat connect serve` runs from
 *      dist — is not this source.
 *   2. THE NUMBER (registry, best-effort). If `package.json`'s version is ALREADY published, that
 *      number is taken: whatever is on the registry under it was built from some commit, and if
 *      this tree has moved since, the two are different code wearing one number. That is exactly
 *      the state that cost the afternoon, and it is visible from the version alone.
 *
 *   `gitHead` would have been the precise comparison and cannot be used: npm records it on only 23
 *   of this package's 120 published versions and not on the latest, so a check resting on it would
 *   be silent precisely when it mattered. Measured 2026-09-03.
 *
 *   NEVER FAILS THE BUILD ON A NETWORK PROBLEM. Offline, behind a proxy, registry down: the
 *   registry half is skipped and said to be skipped. A check that cries wolf on a train is a check
 *   people learn to pass with --no-verify.
 *
 * @structure localStamp() · publishedVersions() · main()
 * @usage cd aimeat && pnpm check:version-drift          # report, exit 0
 *        cd aimeat && pnpm check:version-drift --strict # exit 1 when the number is already taken
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

function pkg() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
}

function headCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;   // not a git checkout — a published install, where this question does not arise
  }
}

function localStamp() {
  const p = join(root, 'dist', 'build-stamp.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

/**
 * What the registry already carries under this name. Null when it cannot be reached.
 *
 * `node:https` rather than `fetch`: undici holds a handle open past the last await, and exiting on
 * top of it trips a libuv assertion on Windows. A check whose last line is a crash dump teaches
 * people to stop running it.
 */
function published(name) {
  return new Promise((resolve) => {
    const req = httpsGet({
      host: 'registry.npmjs.org',
      path: `/${encodeURIComponent(name)}`,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let raw = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const body = JSON.parse(raw);
          resolve({ versions: Object.keys(body.versions ?? {}), latest: body['dist-tags']?.latest ?? null, time: body.time ?? {} });
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const p = pkg();
const head = headCommit();
const stamp = localStamp();
const problems = [];

console.log(`\n  ${p.name} ${p.version}`);
console.log(`  HEAD              ${head ? head.slice(0, 12) : '(not a git checkout)'}`);

// ── 1. The artifact ──
if (!stamp) {
  console.log('  dist/build-stamp  (none — nothing built here yet)');
} else {
  const same = head && stamp.commit && stamp.commit.startsWith(head.slice(0, 7));
  console.log(`  dist/build-stamp  ${stamp.version} @ ${stamp.commit ?? '(no commit)'}${stamp.dirty ? ' (dirty)' : ''}`);
  if (head && stamp.commit && !same) {
    problems.push(`dist/ was built from ${stamp.commit}, not from HEAD. \`aimeat connect serve\` runs from dist/, so it is running that commit's code. Run \`pnpm build\`.`);
  }
  if (stamp.version !== p.version) {
    problems.push(`dist/ says version ${stamp.version} and package.json says ${p.version}. Run \`pnpm build\`.`);
  }
}

// ── 2. The number ──
const reg = await published(p.name);
if (!reg) {
  console.log('  registry          (not reached — skipped, this is not a failure)');
} else {
  const taken = reg.versions.includes(p.version);
  const when = reg.time?.[p.version];
  console.log(`  registry latest   ${reg.latest ?? '(unknown)'}`);
  if (taken) {
    problems.push(
      `${p.name} ${p.version} is ALREADY PUBLISHED${when ? ` (${when.slice(0, 10)})` : ''}. `
      + 'This tree and that release now share a version number, and nothing downstream can tell them apart — '
      + 'which is the exact state that cost half a day in September 2026. Bump the version before the next change '
      + 'goes out, or publish, but do not leave the number meaning two things.');
  } else {
    console.log(`  ${p.version} is not published yet — this number still means one thing.`);
  }
}

if (problems.length === 0) {
  console.log('\n  ✓ this version number means one thing\n');
  process.exit(0);
}
console.log('');
for (const line of problems) console.log(`  ⚠ ${line}\n`);
// Advisory by default. The point is that the gap is FINDABLE, not that somebody is stopped.
process.exit(strict ? 1 : 0);
