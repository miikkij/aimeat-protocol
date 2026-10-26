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
 *     guard tier    when a change touches server source (anything under src/ but src/static), the
 *                   dependency manifests or the E2E machinery (runner, helpers, fixtures); on
 *                   SQLite, and on PostgreSQL too when the Postgres legs run; --full forces it
 *     purpose tier  whenever the guard tier runs, on the same backends: the suites that prove a
 *                   designed use still works (test/run-e2e-ci.ts PURPOSE_SUITES)
 *     Python parity the aimeat-crewai offer and signal tests (tests/test_node_schema_parity.py,
 *                   tests/test_offers.py) through uv on Python 3.12, when the package, the offer and
 *                   signal schemas or the shape allowlist changed; --full forces it. No uv fails.
 *     own suites    a registered E2E suite file that itself changed is run, including under --full;
 *                   SQLite always, PostgreSQL when the Postgres legs run
 *     Postgres legs the guard tier, the changed suites and the unit files with a Postgres half run
 *                   on PostgreSQL by themselves when the change touches storage, identity, the
 *                   doors (src/routes, src/mcp, src/tool-catalog) or the runner; --postgres or
 *                   --full forces them
 *
 *   It prints the plan and the reason for each line before running anything, so a "why did this
 *   take four minutes" has its answer at the top of the log. CI runs everything after every push
 *   and blocks no push (work goes straight to main), so the plan also prints main's CI and nightly
 *   state as GitHub last reported them, and whether this clone's git hooks are on; this is what a
 *   person or a session runs before saying done.
 * @usage
 *   cd aimeat && pnpm gate                 # what the change reaches
 *   cd aimeat && pnpm gate --postgres      # …plus the Postgres legs whatever changed
 *   cd aimeat && pnpm gate --full          # all units, changed suites and guards on both backends
 *   cd aimeat && pnpm gate --base=HEAD~3   # measure against another base
 *   cd aimeat && pnpm gate --plan          # print the plan and run nothing
 * @version-history
 *   2026-10-26 -- The Agent Skills validator (pnpm check:skills-standard, skills-ref through uv) runs when
 *     a built-in skill, the SKILL.md parser or the check changed (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
 *   2026-10-21 -- The purpose tier runs wherever the guard tier runs (pnpm test:e2e:purpose:*), so a fix
 *     that removes a designed use turns the gate red (docs/pitfalls.md §126).
 *   2026-10-18 -- The Python parity tests run when aimeat-crewai, the offer or signal schemas or the
 *     shape allowlist changed (scripts/python-parity-test.ts; Jouni's yes to the pytest in the gate).
 *   2026-10-17 -- A changed suite (or the list itself) runs test/unit/version-aware-suites.test.ts, which
 *     `vitest --changed` cannot select because it reads suite text, not imports.
 *   v1.3.0 -- 2026-10-16 -- The plan prints main's CI state and the nightly sweep's state (QA audit
 *     P2-01, P4-01, P8-01, P2-03) and says when core.hooksPath is not .githooks (QA audit P2-07).
 *   2026-10-16 — The guard tier runs for every server source change but src/static, for the
 *     dependency manifests and for the E2E machinery; the Postgres legs run by themselves for a
 *     storage, identity, door or runner change, and include the unit files with a Postgres half;
 *     a changed suite is found by its registration in the runner, not by an e2e- prefix
 *     (QA audit P2-04, P2-05, P2-06, P8-06, P1-03, P4-02).
 *   v1.2.0 -- 2026-10-12 -- More than 40 changed suites go to the runner in a file (--tests-file):
 *     404 of them made a command line Windows refused, and the gate stopped there in 0 s.
 *   v1.1.0 -- 2026-09-07 -- Preserve changed suites under --full, honor --postgres for them,
 *     and select guards when shared identity, commerce, configuration or bootstrap code changes.
 *   v1.0.0 — 2026-09-05 — Initial. "Full tests rarely; only what changed, and the security tier
 *     only when platform code that concerns it changed, not for every little thing."
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describeState, readCiState } from './lib/ci-runs.mjs';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const POSTGRES_ASKED = args.includes('--postgres') || FULL;
const PLAN_ONLY = args.includes('--plan');
const BASE = args.find(a => a.startsWith('--base='))?.slice('--base='.length) ?? 'origin/main';

const AIMEAT = process.cwd();
const ROOT = resolve(AIMEAT, '..');

/**
 * The suites the runner knows, read from its lists as text: `'test/<name>.ts'` entries. A changed
 * suite is selected by membership, not by an `e2e-` prefix, because nine registered suites have
 * none (federation-messages.ts, api-full.ts, …) and a change to one of them ran nothing (QA audit
 * P2-06, P1-03). Read as text so the planner does not import the runner, which starts work on load.
 */
function registeredSuites(): Set<string> {
    try {
        const text = readFileSync(join(AIMEAT, 'test', 'run-e2e-ci.ts'), 'utf8');
        return new Set([...text.matchAll(/'test\/([A-Za-z0-9_.-]+)\.ts'/g)].map(m => m[1]));
    } catch {
        return new Set();
    }
}

/**
 * Paths that can move a guard suite. Every server source file except the browser libraries the node
 * serves (src/static), plus the dependency manifests and the E2E machinery itself (the runner, its
 * server lifecycle and production lane, the shared helpers, the fixtures, the version-aware list).
 *
 * It was a list of nine directories plus config.ts and config-types.ts until 2026-10-16, and 40
 * top-level files sat outside it: 35 config-*.ts files split out of config.ts, server.ts (which
 * mounts the global auth middleware) and index-start.ts (the WebSocket upgrade's credentials), and
 * six directories, src/tool-catalog among them, which holds the scope each MCP tool asks. A change to
 * any of them finished the gate without the tier (QA audit P2-05, P8-06, P1-03).
 */
const GUARDED = /^aimeat\/(?:src\/(?!static\/)|package\.json$|pnpm-lock\.yaml$|test\/(?:run-e2e-[^/]+\.ts$|helpers\/|fixtures\/|version-aware-suites\.txt$))/;
/**
 * Paths whose change runs the PostgreSQL legs as well, without --postgres: the storage layer, the
 * identity layer, the doors (REST routes and MCP tools) and the E2E machinery, which decides how
 * both backends are run. PostgreSQL is the production backend, and a change in these places is the
 * kind that differs between the two providers or decides who may do what (QA audit P2-04).
 */
const POSTGRES_TRIGGER = /^aimeat\/(?:src\/(?:storage|auth|routes|mcp|tool-catalog)\/|src\/(?:services|utils)\/[^/]*(?:identity|gaii|ghii|owner|principal)[^/]*\.ts$|test\/run-e2e-[^/]+\.ts$|test\/helpers\/server-db\.ts$)/;
/**
 * Paths that move the Python half of the offer-shape comparison: the aimeat-crewai package, the zod
 * schemas its fixture is generated from (and the two modules they import), the shape allowlist the
 * pytest reads, and the scripts that write the fixture and run the step. The same set as the
 * package's CI workflow paths for these files (Jouni, 2026-10-18: the parity pytest runs in pnpm gate).
 */
const PYTHON_PARITY = /^(?:python\/aimeat-crewai\/|aimeat\/src\/models\/(?:offer-schemas|workflow-signals|odps-schemas)\.ts$|aimeat\/src\/commerce\/money\.ts$|aimeat\/security\/python-shape-parity\.json$|aimeat\/scripts\/(?:check-python-shapes|python-parity-test|inventory\/python-shapes)\.ts$)/;
/**
 * Paths that change what a built-in skill says, or how the reference validator is run on them: the
 * built-in skills themselves, the SKILL.md parser and the check (scripts/check-skills-standard.ts runs
 * skills-ref, the Agent Skills specification's validator, through uv).
 */
const SKILLS_STANDARD = /^aimeat\/(?:src\/data\/builtin-skills[^/]*\.ts$|src\/services\/skill-md\.ts$|scripts\/(?:check-skills-standard\.ts|skills-standard-validate\.py)$)/;
/** Paths a unit test can reach at all. The whole test tree: the runner has unit tests of its own (QA audit P2-06). */
const UNIT_REACH = /^aimeat\/(src\/|test\/|public\/|scripts\/|package\.json|vitest\.config|tsconfig|eslint\.config|locales\/)/;

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
    const postgresReason = postgresWhy(files);
    const POSTGRES = postgresReason !== null;
    const registered = registeredSuites();
    const ownSuites = files
        .filter(f => /^aimeat\/test\/[^/]+\.ts$/.test(f))
        .map(f => f.replace(/^aimeat\/test\//, '').replace(/\.ts$/, ''))
        .filter(name => registered.has(name) || name.startsWith('e2e-'));

    steps.push({ name: 'check:fast', cmd: ['pnpm', '-s', 'check:fast'], why: 'always: thirty seconds, and half of it reads documents' });
    steps.push({ name: 'check:invariants', cmd: ['pnpm', '-s', 'check:invariants'], why: 'always: one compiler program, five gates' });

    if (FULL) {
        steps.push({ name: 'unit suite, whole', cmd: ['pnpm', '-s', 'test'], why: '--full' });
    } else if (unitReach.length > 0) {
        steps.push({ name: `unit tests reaching ${unitReach.length} changed file(s)`, cmd: ['pnpm', '-s', 'exec', 'vitest', 'run', '--changed', mergeBase, '--passWithNoTests'], why: unitReach.slice(0, 4).join(', ') + (unitReach.length > 4 ? ', …' : '') });
    }
    // test/unit/version-aware-suites.test.ts reads the suites' TEXT, so `vitest --changed` (an import
    // graph) never selects it for a changed suite. A suite that started to name a *_REMOVED_IN constant
    // reached main unlisted and turned CI's unit job red on 2026-10-16 (a5549bad6).
    if (!FULL && (ownSuites.length > 0 || files.includes('aimeat/test/version-aware-suites.txt'))) {
        steps.push({ name: 'version-aware suite list', cmd: ['pnpm', '-s', 'exec', 'vitest', 'run', 'test/unit/version-aware-suites.test.ts'], why: 'a suite changed: test/version-aware-suites.txt must name every suite that branches on the release' });
    }

    // The gate has run check:python-shapes (names, from the Python source) in check:fast since
    // 2026-10-18; this runs the pytest half (values) through uv, and fails with its reason when uv is
    // missing rather than passing without having checked.
    const pythonParity = files.filter(f => PYTHON_PARITY.test(f));
    if (FULL || pythonParity.length > 0) {
        steps.push({ name: 'Python parity tests (uv, Python 3.12)', cmd: ['pnpm', '-s', 'test:python-parity'], why: FULL ? '--full' : pythonParity.slice(0, 3).join(', ') + (pythonParity.length > 3 ? ', …' : '') });
    }

    // Every built-in skill against skills-ref, the Agent Skills specification's own validator, through
    // uv; the TypeScript half of the same rules is test/unit/skill-standard.test.ts, which CI runs.
    const skillsStandard = files.filter(f => SKILLS_STANDARD.test(f));
    if (FULL || skillsStandard.length > 0) {
        steps.push({ name: 'Agent Skills validator (skills-ref, uv)', cmd: ['pnpm', '-s', 'check:skills-standard'], why: FULL ? '--full' : skillsStandard.slice(0, 3).join(', ') + (skillsStandard.length > 3 ? ', …' : '') });
    }

    if (ownSuites.length > 0) {
        // Past a few dozen suites the names go in a file: one `--test=` each made a command line of
        // about 13000 characters for 404 suites, and Windows refused it ("The command line is too
        // long", 2026-10-12). The runner reads the file as if each line were a `--test=`.
        let selection = ownSuites.map(s => `--test=${s}`);
        if (ownSuites.length > 40) {
            const list = join(mkdtempSync(join(tmpdir(), 'aimeat-gate-')), 'suites.txt');
            writeFileSync(list, ownSuites.join('\n') + '\n');
            selection = [`--tests-file=${list}`];
        }
        const shown = ownSuites.length > 40 ? `${ownSuites.length} suites` : ownSuites.join(', ');
        for (const backend of POSTGRES ? ['sqlite', 'postgres-kysely'] : ['sqlite']) {
            const label = backend === 'sqlite' ? 'SQLite' : 'Postgres';
            steps.push({ name: `own E2E suite(s), ${label}: ${shown}`, cmd: ['node', `--env-file=.env.test.${backend}`, '--import', 'tsx', 'test/run-e2e-ci.ts', ...selection], why: backend === 'sqlite' ? 'a suite that changed is run' : postgresReason ?? '' });
        }
    }

    if (FULL || guarded.length > 0) {
        const why = FULL ? '--full' : guarded.slice(0, 4).join(', ') + (guarded.length > 4 ? ', …' : '');
        steps.push({ name: 'guard tier, SQLite', cmd: ['pnpm', '-s', 'test:e2e:guards:sqlite'], why });
        if (POSTGRES) steps.push({ name: 'guard tier, Postgres', cmd: ['pnpm', '-s', 'test:e2e:guards:postgres-kysely'], why: postgresReason ?? '' });
        // The purpose tier runs wherever the guard tier does: the guard tier proves a hole is closed,
        // this one that a designed use still works (docs/pitfalls.md §126, wish
        // wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
        steps.push({ name: 'purpose tier, SQLite', cmd: ['pnpm', '-s', 'test:e2e:purpose:sqlite'], why });
        if (POSTGRES) steps.push({ name: 'purpose tier, Postgres', cmd: ['pnpm', '-s', 'test:e2e:purpose:postgres-kysely'], why: postgresReason ?? '' });
    }

    // The unit files with a PostgreSQL half run it against the Postgres test database whenever the
    // Postgres legs run, with the flag that turns a missing URL into a failure (QA audit P4-02,
    // F7c-02, F24-01). Without this their Postgres half ran in no automatic run.
    if (POSTGRES) {
        steps.push({ name: 'unit tests with a Postgres half, Postgres', cmd: ['node', '--env-file=.env.test.postgres-kysely', '--import', 'tsx', 'scripts/test-unit-postgres.ts'], why: postgresReason ?? '' });
    }
    return steps;
}

/**
 * What a reader of the plan needs before trusting a green gate: is main itself green on GitHub, and
 * do this clone's hooks run at all. Printed, never decided on: CI's answer is about main, the gate's
 * about this change (QA audit P2-01, P2-07).
 */
async function contextLines(): Promise<string[]> {
    const lines = describeState(await readCiState({ cwd: ROOT }));
    let hooks = '';
    try { hooks = git('config', '--get', 'core.hooksPath'); } catch { hooks = ''; }
    if (hooks !== '.githooks') {
        lines.push(`Git hooks: OFF on this clone (core.hooksPath is ${hooks || 'unset'}), so no commit or push check ran. Turn them on: git config core.hooksPath .githooks`);
    }
    return lines;
}


/** Why the Postgres legs run, or null when they do not: --postgres or --full, or a changed path that needs them. */
function postgresWhy(files: string[]): string | null {
    if (FULL) return '--full';
    if (POSTGRES_ASKED) return '--postgres';
    const hits = files.filter(f => POSTGRES_TRIGGER.test(f));
    if (hits.length === 0) return null;
    return 'storage, identity or doors changed: ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ', …' : '');
}


async function main(): Promise<void> {
    const { files, mergeBase } = changedSince(BASE);
    const steps = plan(files, mergeBase);
    console.log(`\n  gate: ${files.length} file(s) changed since ${BASE} (${mergeBase.slice(0, 9)})${FULL ? ', --full' : ''}`);
    console.log('  ' + '─'.repeat(62));
    for (const s of steps) console.log(`  • ${s.name.padEnd(44)} ${s.why}`);
    const skipped: string[] = [];
    if (!FULL && !files.some(f => UNIT_REACH.test(f))) skipped.push('unit tests (nothing a test can reach changed)');
    if (!FULL && !files.some(f => PYTHON_PARITY.test(f))) skipped.push('Python parity tests (no aimeat-crewai, offer schema or shape-allowlist change)');
    if (!FULL && !files.some(f => SKILLS_STANDARD.test(f))) skipped.push('Agent Skills validator (no built-in skill, SKILL.md parser or check change)');
    if (!FULL && !files.some(f => GUARDED.test(f))) skipped.push('guard and purpose tiers (no server source, dependency or E2E machinery changed)');
    if (postgresWhy(files) === null) skipped.push('PostgreSQL legs (no storage, identity, door or runner change; --postgres forces them)');
    for (const s of skipped) console.log(`  · skipped: ${s}`);
    console.log('');
    for (const line of await contextLines()) console.log(`  ${line}`);
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

void main();
