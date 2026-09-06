/**
 * @file scripts/gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate a piece of work passes once, when it is finished: as much checking as the
 *   change can have moved, and no more.
 *
 *   WHY IT DECIDES. The hooks take seconds by rule (2026-09-05), and the heavy checks live here.
 *   Run whole, they are twenty minutes; run twenty times a day for text changes they are the day.
 *   So this reads what changed since the branch left origin/main (committed and uncommitted alike)
 *   and picks:
 *
 *     always        check:fast and check:invariants — thirty seconds, and half of them read docs
 *     unit          vitest --changed <base>: the test files whose import graph reaches a changed
 *                   file; the whole suite only with --full
 *     guard tier    only when a change touches the code the tier guards — src/routes, src/auth,
 *                   src/services, src/storage, src/mcp, src/middleware — on SQLite; --postgres adds
 *                   the production backend; --full forces the tier
 *     own suites    an E2E suite file that itself changed is run, on SQLite
 *
 *   It prints the plan and the reason for each line before running anything, so a "why did this
 *   take four minutes" has its answer at the top of the log. CI still runs everything on every
 *   push and blocks a merge on it; this is what a person or a session runs before saying done.
 * @usage
 *   cd aimeat && pnpm gate                 # what the change reaches
 *   cd aimeat && pnpm gate --postgres      # …plus the Postgres tier when the tier runs
 *   cd aimeat && pnpm gate --full          # everything, both backends
 *   cd aimeat && pnpm gate --base=HEAD~3   # measure against another base
 *   cd aimeat && pnpm gate --plan          # print the plan and run nothing
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial. "Full tests rarely; only what changed, and the security tier
 *     only when platform code that concerns it changed, not for every little thing."
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const POSTGRES = args.includes('--postgres') || FULL;
const PLAN_ONLY = args.includes('--plan');
const BASE = args.find(a => a.startsWith('--base='))?.slice('--base='.length) ?? 'origin/main';

const AIMEAT = process.cwd();
const ROOT = resolve(AIMEAT, '..');

/** Paths that can move a guard suite: the doors, the identity layer, the services behind them. */
const GUARDED = /^aimeat\/src\/(routes|auth|services|storage|mcp|middleware)\//;
/** Paths a unit test can reach at all. */
const UNIT_REACH = /^aimeat\/(src\/|test\/(unit|integration)\/|public\/|scripts\/|package\.json|vitest\.config|tsconfig|eslint\.config|locales\/)/;

function git(...a: string[]): string {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * The working tree's changed paths.
 *
 * ITS OWN LINE ONE WAS BEING EATEN. `git status --porcelain` puts a two-character status in columns
 * 1-2 and the path from column 4, and an unstaged modification's first column is a SPACE — so
 * ` M aimeat/src/routes/x.ts`. Reading that through the trimming `git()` above removed the leading
 * space of the FIRST line only, and `slice(3)` then cut three characters off `M aimeat/…`, leaving
 * `imeat/…`, which matches no pattern. Whichever file sorted first was invisible to the plan.
 *
 * Found on 2026-09-06 by the gate reporting "no change under src/routes" for a change to
 * src/routes/ghii/web-verify.ts, which is the same shape as the findings it exists to catch: a
 * check that answers about less than it was asked, and says nothing about the difference.
 *
 * A rename arrives as `R  old -> new`; the NEW path is the one a test can reach.
 */
function workingTreeFiles(): string[] {
    const raw = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
    return raw.split('\n')
        .filter(line => line.length > 3)
        .map(line => line.slice(3).trim())
        .map(path => (path.includes(' -> ') ? path.slice(path.indexOf(' -> ') + 4) : path))
        .map(path => path.replace(/^"|"$/g, ''))
        .filter(Boolean);
}

function changedSince(base: string): { files: string[]; mergeBase: string } {
    try { execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT, stdio: 'ignore' }); } catch { /* offline is fine: the local ref is used */ }
    let mergeBase: string;
    try { mergeBase = git('merge-base', base, 'HEAD'); } catch { mergeBase = git('rev-parse', 'HEAD~1'); }
    const committed = git('diff', '--name-only', mergeBase, 'HEAD').split('\n');
    const files = [...new Set([...committed, ...workingTreeFiles()].filter(Boolean).map(f => f.replace(/\\/g, '/')))].sort();
    return { files, mergeBase };
}

interface Step { name: string; cmd: string[]; why: string }

function plan(files: string[], mergeBase: string): Step[] {
    const steps: Step[] = [];
    const unitReach = files.filter(f => UNIT_REACH.test(f));
    const guarded = files.filter(f => GUARDED.test(f));
    const ownSuites = files.filter(f => /^aimeat\/test\/e2e-[^/]+\.ts$/.test(f)).map(f => f.replace(/^aimeat\/test\//, '').replace(/\.ts$/, ''));

    steps.push({ name: 'check:fast', cmd: ['pnpm', '-s', 'check:fast'], why: 'always: thirty seconds, and half of it reads documents' });
    steps.push({ name: 'check:invariants', cmd: ['pnpm', '-s', 'check:invariants'], why: 'always: one compiler program, five gates' });

    if (FULL) {
        steps.push({ name: 'unit suite, whole', cmd: ['pnpm', '-s', 'test'], why: '--full' });
    } else if (unitReach.length > 0) {
        steps.push({ name: `unit tests reaching ${unitReach.length} changed file(s)`, cmd: ['pnpm', '-s', 'exec', 'vitest', 'run', '--changed', mergeBase, '--passWithNoTests'], why: unitReach.slice(0, 4).join(', ') + (unitReach.length > 4 ? ', …' : '') });
    }

    if (ownSuites.length > 0 && !FULL) {
        steps.push({ name: `own E2E suite(s): ${ownSuites.join(', ')}`, cmd: ['node', '--env-file=.env.test.sqlite', '--import', 'tsx', 'test/run-e2e-ci.ts', ...ownSuites.map(s => `--test=${s}`)], why: 'a suite that changed is run' });
    }

    if (FULL || guarded.length > 0) {
        const why = FULL ? '--full' : guarded.slice(0, 4).join(', ') + (guarded.length > 4 ? ', …' : '');
        steps.push({ name: 'guard tier, SQLite', cmd: ['pnpm', '-s', 'test:e2e:guards:sqlite'], why });
        if (POSTGRES) steps.push({ name: 'guard tier, Postgres', cmd: ['pnpm', '-s', 'test:e2e:guards:postgres-kysely'], why: FULL ? '--full' : '--postgres' });
    }
    return steps;
}

function main(): void {
    const { files, mergeBase } = changedSince(BASE);
    const steps = plan(files, mergeBase);
    console.log(`\n  gate: ${files.length} file(s) changed since ${BASE} (${mergeBase.slice(0, 9)})${FULL ? ', --full' : ''}`);
    console.log('  ' + '─'.repeat(62));
    for (const s of steps) console.log(`  • ${s.name.padEnd(44)} ${s.why}`);
    const skipped: string[] = [];
    if (!FULL && !files.some(f => UNIT_REACH.test(f))) skipped.push('unit tests (nothing a test can reach changed)');
    if (!FULL && !files.some(f => GUARDED.test(f))) skipped.push('guard tier (no change under src/routes, auth, services, storage, mcp, middleware)');
    for (const s of skipped) console.log(`  · skipped: ${s}`);
    console.log('');
    if (PLAN_ONLY) return;

    const t0 = Date.now();
    for (const s of steps) {
        const t = Date.now();
        console.log(`\n[gate] ${s.name}…`);
        const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: AIMEAT, stdio: 'inherit', shell: process.platform === 'win32' });
        const secs = ((Date.now() - t) / 1000).toFixed(0);
        if (r.status !== 0) {
            console.error(`\n✖ gate: ${s.name} refused after ${secs}s. Fix it, then run pnpm gate again.`);
            process.exit(1);
        }
        console.log(`[gate] ✓ ${s.name} (${secs}s)`);
    }
    console.log(`\n  ✓ gate passed in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${steps.length} step(s)${skipped.length ? `, ${skipped.length} skipped for cause` : ''}\n`);
}

main();
