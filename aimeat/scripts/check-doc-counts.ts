/**
 * @file check-doc-counts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Guard for the numbers the project states ABOUT ITSELF: how many suites block a
 *   merge, and how many commands the pre-commit hook runs. Both are facts with a source of truth in
 *   code, both are quoted in prose that a human maintains, and both had drifted.
 *
 *   WHAT IT COST, measured on 2026-09-04. The guard tier is 20 suites. CLAUDE.md said "the fourteen
 *   suites … 407 assertions", .github/workflows/ci.yml said "Twelve suites … 323 assertions", and
 *   the list itself held 20 whose run reports 529. The pre-commit hook runs 39 commands. CLAUDE.md
 *   said "twenty-one checks" and named 21, and the hook's own header numbered 23 with a duplicated
 *   "8.". Five statements, five different numbers, one truth, and nothing looked.
 *
 *   WHY THIS IS NOT PEDANTRY. CLAUDE.md is the file every session reads before it touches anything.
 *   A wrong number there buys one of two outcomes: the next reader works believing the guard is
 *   smaller than it is, or the next reader notices the contradiction and stops trusting the other
 *   numbers in the same file. The second is the expensive one, and it is invisible.
 *
 *   WHAT IS DELIBERATELY NOT GATED: the assertion total. It changes whenever anyone adds an assert
 *   to a guard suite, which is a thing we want to happen freely, so a gate on it would fail on good
 *   news. Both documents now carry it as a measurement with a date rather than as a standing claim,
 *   which is the honest shape for a number nobody promises to maintain.
 * @structure
 *   - guardSuiteCount(): GUARD_SUITES.length, parsed from test/run-e2e-ci.ts
 *   - hookCommandCount(): the `pnpm -s <cmd>` invocations in .githooks/pre-commit
 *   - CLAIMS: where each number is quoted, and the pattern that finds it
 *   - main(): compare, print, exit 1 under --strict on any mismatch
 * @usage
 *   cd aimeat && pnpm check:doc-counts            # report
 *   cd aimeat && pnpm check:doc-counts --strict   # gate (pre-commit + CI)
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (quality plan stream C: documentation truth).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const REPO = join(ROOT, '..');
const RUNNER = join(ROOT, 'test', 'run-e2e-ci.ts');
const HOOK = join(REPO, '.githooks', 'pre-commit');
const CLAUDE_MD = join(REPO, 'CLAUDE.md');
const CI_YML = join(REPO, '.github', 'workflows', 'ci.yml');

/** The guard tier's size, from the array that decides it. */
function guardSuiteCount(): number {
    const src = readFileSync(RUNNER, 'utf-8');
    const block = /const GUARD_SUITES\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
    if (!block) throw new Error(`GUARD_SUITES not found in ${relative(REPO, RUNNER)}`);
    return (block[1].match(/'test\/[^']+'/g) ?? []).length;
}

/**
 * How many commands the hook runs.
 *
 * Counted from the invocations rather than from the hook's own numbered header, because the header
 * is the thing being checked. `pnpm -s <name>` is the only shape the hook uses.
 */
function hookCommandCount(): number {
    const src = readFileSync(HOOK, 'utf-8');
    return (src.match(/^\s*pnpm -s [a-z:0-9-]+/gm) ?? []).length;
}

interface Claim {
    file: string;
    label: string;
    /** Must capture the number in group 1. */
    pattern: RegExp;
    expected: () => number;
}

const CLAIMS: Claim[] = [
    {
        file: CLAUDE_MD,
        label: 'CLAUDE.md — guard tier size',
        pattern: /run the (\d+) suites CI refuses to merge without/,
        expected: guardSuiteCount,
    },
    {
        file: CI_YML,
        label: 'ci.yml — guard tier size',
        pattern: /THE GUARD TIER BLOCKS\. (\d+) suites/,
        expected: guardSuiteCount,
    },
    {
        file: CLAUDE_MD,
        label: 'CLAUDE.md — pre-commit hook size',
        pattern: /`\.githooks\/pre-commit`\) runs (\d+) commands/,
        expected: hookCommandCount,
    },
];

/**
 * NOT A CLAIM HERE, deliberately: the hook's own numbered header.
 *
 * It would be the natural fourth row, and it is left out because the header is a hand-kept list
 * with sub-numbering (5b, 8c) that grew by insertion, and putting a machine-checked total inside it
 * invites a merge conflict on the one file two parallel sessions both add lines to. CLAUDE.md
 * carries the number instead, and it is checked against what the hook RUNS, which is the fact.
 *
 * When this gate fails after somebody adds a check to the hook, the fix is the number in CLAUDE.md,
 * not this file. That failure is the gate working.
 */

function main(): void {
    const strict = process.argv.includes('--strict');

    for (const path of [RUNNER, HOOK, CLAUDE_MD, CI_YML]) {
        if (!existsSync(path)) {
            console.error(`✖ missing ${relative(REPO, path)}`);
            process.exit(1);
        }
    }

    const problems: string[] = [];
    const rows: { label: string; claimed: string; actual: number; ok: boolean }[] = [];

    for (const claim of CLAIMS) {
        const actual = claim.expected();
        const m = claim.pattern.exec(readFileSync(claim.file, 'utf-8'));
        if (!m) {
            rows.push({ label: claim.label, claimed: 'NOT FOUND', actual, ok: false });
            problems.push(
                `${claim.label}: the sentence this check reads is gone. Either restore the wording it `
                + `matches (${claim.pattern.source}) or update the pattern in the same change.`,
            );
            continue;
        }
        const claimed = Number(m[1]);
        const ok = claimed === actual;
        rows.push({ label: claim.label, claimed: String(claimed), actual, ok });
        if (!ok) problems.push(`${claim.label}: says ${claimed}, the code says ${actual}.`);
    }

    console.log('');
    console.log('  The numbers this project states about itself');
    console.log('  ' + '─'.repeat(62));
    for (const r of rows) {
        const mark = r.ok ? '✓' : '✗';
        console.log(`  ${mark} ${r.label.padEnd(42)} says ${String(r.claimed).padStart(9)}   is ${String(r.actual).padStart(3)}`);
    }
    console.log('');

    if (!problems.length) {
        console.log('  ✓ every stated count matches the code it describes');
        return;
    }
    for (const p of problems) console.log(`    ${p}`);
    console.log('');
    console.log('  A wrong number in CLAUDE.md is read as a fact by every session that opens it.');
    console.log('  Fix the prose, not this check, unless the code genuinely changed.');
    console.log('');
    if (strict) process.exit(1);
    console.log('  (report only — pass --strict to gate)');
}

main();
