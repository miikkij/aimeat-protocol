#!/usr/bin/env node
/**
 * @file scripts/check-overrides.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a dependency override whose value can resolve outside one major version, in
 *   every tracked package.json: the npm `overrides` block, `pnpm.overrides` and yarn's `resolutions`.
 *   The rule and its reason are in scripts/lib/override-ranges.mjs. In short: pnpm resolves an
 *   override to the highest version its value allows and applies a ranged override to every dependent
 *   whose range overlaps the selector, so `">=2.1.4"` hands 5.x to a package that asked for ^2.0.2
 *   and the break shows weeks later in a tool the override never named.
 * @structure trackedManifests() · blocks(pkg) · main
 * @usage pnpm check:overrides   (in check:fast, so pnpm gate and CI)
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial; replaces docs/pitfalls.md §59.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overrideRangeProblems } from './lib/override-ranges.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every package.json git tracks, outside vendored trees. */
function trackedManifests() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(f => /(^|\/)package\.json$/.test(f) && !/(^|\/)node_modules\//.test(f));
}

/** The override blocks one manifest carries, by the name a reader finds them under. */
function blocks(pkg) {
    const found = [];
    if (pkg.overrides && typeof pkg.overrides === 'object') found.push(['overrides', pkg.overrides]);
    if (pkg.pnpm?.overrides && typeof pkg.pnpm.overrides === 'object') found.push(['pnpm.overrides', pkg.pnpm.overrides]);
    if (pkg.resolutions && typeof pkg.resolutions === 'object') found.push(['resolutions', pkg.resolutions]);
    return found;
}

const problems = [];
let rules = 0;
for (const file of trackedManifests()) {
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(join(REPO, file), 'utf8'));
    } catch (err) {
        problems.push(`${file}: not readable as JSON (${err instanceof Error ? err.message : String(err)})`);
        continue;
    }
    for (const [name, block] of blocks(pkg)) {
        rules += Object.keys(block).length;
        for (const p of overrideRangeProblems(block)) problems.push(`${file} ${name} "${p.key}": "${p.value}": ${p.reason}`);
    }
}

if (problems.length) {
    console.error(`\n✖ ${problems.length} override value(s) can leave their major:\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error([
        '',
        '  pnpm resolves an override to the HIGHEST version its value allows, and applies a ranged override',
        '  ("name@>=2.0.0 <2.1.4") to every dependent whose own range overlaps the selector. An open ">=2.1.4"',
        '  therefore handed brace-expansion 5.x to every package that asked for ^2.0.2, and minimatch@9 crashed',
        '  with "brace_expansion_1.default is not a function" weeks later, in a tool the override never named.',
        '',
        '  Write the patched version as a caret range in the major the dependents asked for: "^2.1.4". When',
        '  dependents of several majors overlap the selector, name each major: "^7.3.5 || ^8.0.0". If the fix',
        '  exists only in a newer major, the dependents need a real upgrade, not an override.',
        '  After changing a value, run `pnpm install` so pnpm-lock.yaml carries it, and compare the versions it',
        '  resolves (`pnpm why <name>`) with the ones before.',
        '',
    ].join('\n'));
    process.exit(1);
}
console.log(`✓ every dependency override stays inside one major (${rules} rule(s))`);
