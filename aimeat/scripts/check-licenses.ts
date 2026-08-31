/**
 * @file check-licenses.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The licence gate. AIMEAT is MIT and people run it commercially, so the question this
 *   answers on every commit is "can a company ship this without a lawyer stopping them", and the
 *   only honest way to keep answering yes is to notice the day the answer changes.
 *
 *   WHY A GATE RATHER THAN A TABLE. docs/coding-guidelines/dependency-management.md used to carry a
 *   hand-written table of every dependency and its licence. By August 2026 it listed isolated-vm
 *   (replaced by quickjs-emscripten), uuid ^13 (shipped ^14) and typescript ^5.9 (shipped ^6),
 *   because 412 production packages cannot be tracked by hand. A table goes stale in silence; a
 *   gate fails on the commit that introduces the problem.
 *
 *   WHAT IT ACTUALLY CHECKS, and each of the five is a defect this repo really had:
 *     1. Every production dependency's licence is permissive, or has an entry below with a reason.
 *     2. Every file served from /lib/ is claimed by a component in public/lib/licenses.json — the
 *        check that stops a vendored library arriving without its copyright notice.
 *     3. Every component's licence text resolves, so the notices file cannot ship an empty section.
 *     4. A copyleft component carries a complete-source offer, which is what that licence asks for.
 *     5. A GPL asset is marked `"distribute": false` and is untracked, so it cannot reach a
 *        release again the way ffmpeg-core did.
 * @structure evaluate() → SPDX expression vs the allowlist; five check functions; main() prints
 *   every problem and exits non-zero on the first category that has one.
 * @usage  pnpm check:licenses   (pre-commit hook, CI, and prepublishOnly)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: allowlist, served-file coverage, texts, source offers, GPL fence.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AIMEAT_ROOT, LIB_DIR, PERMISSIVE, claims, npmComponents, servedFiles, vendoredComponents,
  type Component,
} from './lib/license-inventory.js';

/**
 * Licences that are not permissive and are here anyway, each with the reason and the date the
 * developer approved it. An entry is a decision, not a suppression: adding one is the moment to
 * ask what the obligation costs an operator, and the answer belongs in the note.
 */
const EXCEPTIONS: Array<{ id: string; spdx: string; reason: string; approved: string }> = [
  {
    id: 'web-push',
    spdx: 'MPL-2.0',
    approved: '2026-08-31',
    reason: 'Web push notifications. MPL is file-level copyleft: we use it unmodified, so the '
      + 'obligation is the notice and a pointer to the source, both of which THIRD-PARTY-NOTICES.md '
      + 'carries. Modifying a web-push file would put that file under the MPL.',
  },
  {
    id: 'p5',
    spdx: 'LGPL-2.1-only',
    approved: '2026-07-16',
    reason: 'The p5 library pack for creative-coding apps. Served unmodified as its own file at a '
      + 'stable URL, so nothing links it statically and an app that calls it keeps its own licence. '
      + 'The LGPL wants the text, the notice and the exact source: all three are in licenses.json.',
  },
  {
    id: 'ffmpeg-core',
    spdx: 'GPL-2.0-or-later',
    approved: '2026-07-31',
    reason: 'Browser-side video encoding. AIMEAT does not distribute it: the three files are marked '
      + '"distribute": false in vendored-assets.json, are untracked, and are installed on the '
      + 'operator\'s own machine by pnpm vendor:libs. An operator who serves them distributes GPL '
      + 'work under the GPL, and the source offer in licenses.json is what that requires.',
  },
];

/** Licence ids that appear inside dual expressions in the tree and are permissive on their own. */
const ALSO_PERMISSIVE = ['Zlib', 'WTFPL', 'CC-BY-4.0'];

const allowed = new Set([...PERMISSIVE, ...ALSO_PERMISSIVE]);

/**
 * Is this SPDX expression acceptable? `A OR B` passes when either side does — the user picks. `A
 * AND B` passes only when both do, because both obligations attach.
 */
function evaluate(expression: string): boolean {
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (allowed.has(expr)) return true;
  if (/\bOR\b/.test(expr)) return expr.split(/\bOR\b/).some(part => evaluate(part.trim()));
  if (/\bAND\b/.test(expr)) return expr.split(/\bAND\b/).every(part => evaluate(part.trim()));
  return allowed.has(expr);
}

/**
 * An exception is keyed by package NAME, not by the inventory id. An npm component's id carries its
 * version (`web-push@3.6.7`) since 2026-08-31, when one component per version replaced one per
 * package; matching on the id alone silently stopped recognising every npm exception the moment
 * that changed, and the gate failed on an approval it already had.
 */
function exceptionFor(component: Component): { reason: string; approved: string } | undefined {
  const hit = EXCEPTIONS.find(e =>
    (e.id === component.id || e.id === component.name) && e.spdx === component.spdx);
  return hit === undefined ? undefined : { reason: hit.reason, approved: hit.approved };
}

/** 1 + 2: every component's licence is permissive, or approved by name. */
function checkAllowlist(components: Component[], where: string): string[] {
  const problems: string[] = [];
  for (const c of components) {
    if (evaluate(c.spdx)) continue;
    if (exceptionFor(c) !== undefined) continue;
    problems.push(
      `${where}: ${c.name}@${c.version} is ${c.spdx}, which is not on the allowlist.\n`
      + '    Either replace it, or add it to EXCEPTIONS in scripts/check-licenses.ts with the '
      + 'reason and what the obligation costs an operator.',
    );
  }
  return problems;
}

/** 3: every file a browser can fetch from /lib/ belongs to a component that names its licence. */
function checkCoverage(vendored: Component[]): string[] {
  const problems: string[] = [];
  for (const file of servedFiles()) {
    if (vendored.some(c => claims(c, file))) continue;
    problems.push(
      `public/lib/${file} is served to browsers and no component in licenses.json claims it.\n`
      + '    Add it to an existing component\'s "files", or add a component with its licence, '
      + 'copyright holder and source.',
    );
  }
  return problems;
}

/** 4: a component whose licence text does not resolve would produce an empty notices section. */
function checkTexts(vendored: Component[]): string[] {
  return vendored
    .filter(c => c.licenseText === null)
    .map(c => `licenses.json: ${c.id} has no readable licenseFile — THIRD-PARTY-NOTICES.md would `
      + 'ship that component with no licence text at all.');
}

/** 5: copyleft asks for the complete corresponding source. Say where it is. */
function checkSourceOffers(vendored: Component[]): string[] {
  return vendored
    .filter(c => /GPL/.test(c.spdx) && (c.sourceOffer ?? '').trim() === '')
    .map(c => `licenses.json: ${c.id} is ${c.spdx} and has no "sourceOffer". That licence requires `
      + 'the complete source of the exact version to be available; name where.');
}

interface VendoredAsset { path: string; license?: string; distribute?: boolean }

/**
 * 6: the fence that would have caught the original defect. Every GPL asset must be marked
 * non-distributable AND be absent from git, because either one alone is not enough: ffmpeg-core.wasm
 * was gitignored and still reached npm through `cpSync('public','dist/public')`.
 */
function checkGplFence(): string[] {
  const problems: string[] = [];
  const manifest = join(LIB_DIR, 'vendored-assets.json');
  const assets = (JSON.parse(readFileSync(manifest, 'utf-8')) as { assets?: VendoredAsset[] }).assets ?? [];

  const tracked = new Set(
    execSync('git ls-files -- public/lib', { cwd: AIMEAT_ROOT, encoding: 'utf-8' })
      .split('\n').map(l => l.trim()).filter(Boolean),
  );

  for (const asset of assets) {
    const copyleft = /GPL/.test(asset.license ?? '');
    if (copyleft && asset.distribute !== false) {
      problems.push(
        `vendored-assets.json: ${asset.path} is ${asset.license} and is not marked "distribute": false.\n`
        + '    The build would copy it into dist/public and the npm tarball would publish it.',
      );
    }
    if (asset.distribute !== false) continue;
    const trackedPath = `public/${asset.path}`;
    if (tracked.has(trackedPath)) {
      problems.push(
        `${trackedPath} is marked "distribute": false and is tracked by git.\n`
        + '    Run: git rm --cached ' + trackedPath,
      );
    }
  }
  return problems;
}

function main(): void {
  const vendored = vendoredComponents();
  const npm = npmComponents();

  const groups: Array<[string, string[]]> = [
    ['production dependencies', checkAllowlist(npm, 'npm')],
    ['served libraries', checkAllowlist(vendored, 'public/lib')],
    ['served files with no licence', checkCoverage(vendored)],
    ['missing licence texts', checkTexts(vendored)],
    ['missing source offers', checkSourceOffers(vendored)],
    ['GPL fence', checkGplFence()],
  ];

  let failed = false;
  for (const [title, problems] of groups) {
    if (problems.length === 0) continue;
    failed = true;
    console.error(`\n✗ ${title}`);
    for (const p of problems) console.error(`  ${p}`);
  }

  if (failed) {
    console.error('\nLicensing is what lets somebody run this commercially. Fix the above, then '
      + 'run: pnpm gen:notices');
    process.exit(1);
  }

  const exceptions = [...npm, ...vendored].filter(c => exceptionFor(c) !== undefined);
  console.log(
    `✓ licences: ${npm.length} production dependencies + ${vendored.length} served components, `
    + `${servedFiles().length} served files all accounted for.`,
  );
  for (const c of exceptions) {
    const hit = exceptionFor(c);
    console.log(`  · ${c.name} — ${c.spdx}, approved ${hit?.approved}`);
  }
}

main();
