/**
 * @file scripts/ready.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finished work reaches main only after everything is green on it, and the whole run
 *   happens on this machine: the checks, the whole unit suite and the full E2E sweep on both backends.
 *   When it is green, the commits go to main, and main is the only ref this pushes. When it is red it
 *   says what is red and stops; main is not touched.
 *
 *   WHY ON THIS MACHINE. From 2026-11-15 to 2026-11-22 the sweep ran on GitHub, which runs only what
 *   is pushed there, so every run put a ready/<session> branch on the public repository for half an
 *   hour. The public repository takes no branch but main without the developer's permission (Jouni,
 *   2026-11-22), and the pre-push hook refuses one. On 4 lanes through the TypeScript loader the local
 *   sweep took about two hours instead of 35 minutes; measured on 2026-11-23 on 32 logical cores, the
 *   SQLite sweep takes 20 minutes on 12 lanes from the compiled build. CI still runs on main after the
 *   push, as it did before 2026-11-15.
 *
 *   WHY AT ALL. Ruled by the developer on 2026-11-15: develop against the suites of the area only, run
 *   `pnpm check:fast` once when the work looks done and fix every red line in one go, then the full run
 *   before main, so that nothing reaches main red.
 *
 *   WHAT IT REFUSES. A dirty tree (what is tested must be what is committed), no AIMEAT_SESSION, commits
 *   that do not rebase onto origin/main without a conflict, and nothing to bring.
 *
 *   ONE RUN AT A TIME, AND THAT RUN GETS THE MACHINE. The run holds the machine-wide `whole-run` lock
 *   (scripts/lib/machine-lock.ts holdMachineForRun; pnpm gate takes the same one) from before its
 *   checks until it has pushed, and a second session's run waits and says whom for. Until 2026-11-23 only a sentence here asked for that, and nothing held
 *   it: on that day several sessions ran their sweeps side by side, every node start passed its 60 s
 *   limit, each run went red for timing and started again, and a change of words took a working day
 *   to reach main. A run that waited starts from main as it is then: when HEAD is behind origin/main
 *   it is rebased first, so the run tests the work on today's main. Because one run has the machine,
 *   its sweep runs on as many lanes as the machine carries (scripts/lib/ready-lanes.ts) instead of the
 *   4 the package script names.
 *
 *   A SECOND RUN ON THE SAME TREE STARTS WHERE THE FIRST WAS RED. The unit suite and each sweep that
 *   were green on a tree are recorded (scripts/lib/ready-passed.ts) and not run again while the tree is
 *   the same; a fix or a rebase gives another tree and every step runs. The checks always run. `--fresh`
 *   runs every step.
 *
 *   A SWEEP THAT HAS LOST A LANE STOPS. A lane whose node cannot start twice makes the run red; the
 *   sweep ends there (`--stop-on-lost-lane`) instead of finishing the other lanes, and a node gets
 *   180 s to start, not the runner's 60 (NODE_START_MS).
 *
 *   THE SWEEP'S NODES START FROM THE COMPILED BUILD. Before the first sweep the run builds the tree
 *   (`pnpm build`, under a minute) and the sweep starts every node from dist/ (AIMEAT_E2E_NODE_ENTRY,
 *   test/helpers/node-entry.ts), as the nightly on GitHub does and as production runs. A sweep restarts
 *   a node before every suite, and through the TypeScript loader those restarts were most of its time.
 *
 *   A SUITE RED FOR TIMING. The sweep runs with `--retry-red`: a red suite runs once more, alone
 *   (test/run-e2e-retry.ts). Red again, the run is red. Green alone, it does not stop the merge, and the
 *   runner prints it with the [e2e-flaky] mark: record each as an incident on Lifecycle Central.
 *
 *   A UNIT FILE RED FOR TIMING. The unit suite runs whole, in parallel. A file red there runs once more
 *   alone (scripts/lib/unit-rerun.ts, the rule pnpm gate has had since 2026-11-14). Red again, the run
 *   is red. Green alone, it does not stop the merge, and the run prints it with the [unit-flaky] mark:
 *   record these as one incident on Lifecycle Central. Until 2026-11-23 any red unit file stopped the
 *   run, and with other sessions' suites on the machine a different 2 to 4 files timed out each run.
 *
 *   MAIN MOVED DURING THE RUN. Other sessions push while the run is going. When origin/main is no longer
 *   under HEAD at the end, the commits are rebased onto it and pushed; CI runs on main as always. They
 *   are not tested a second time, or a busy day would never end.
 * @usage
 *   cd aimeat && AIMEAT_SESSION=cc-alice-x pnpm ready         # check, test, sweep, push main
 *   cd aimeat && pnpm ready --no-merge                         # stop after a green run
 *   cd aimeat && pnpm ready --no-checks                        # skip the static checks (just run on this tree)
 *   cd aimeat && pnpm ready --full                             # the full sweep even for a text change
 *   cd aimeat && pnpm ready --fresh                            # run every step, also one green on this tree
 *   cd aimeat && AIMEAT_READY_WORKERS=6 pnpm ready             # the sweep's lanes by hand (1 to 16)
 *
 *   HOW MUCH OF THE SWEEP. A change that reaches code runs the full sweep. A change of words only
 *   (locales, docs, comments, the prose inside strings) runs the suites that changed or quote the
 *   changed words, and none when no suite does (scripts/lib/ready-scope.ts; Jouni, 2026-11-22). A wide
 *   change of words (20 product files, or 100 removed texts) also runs the full sweep on SQLite, because
 *   the search misses a suite that quotes only a short part of a sentence (Jouni, 2026-11-23).
 * @version-history
 *   v2.4.0 — 2026-11-23 — One run at a time on a machine (the `whole-run` lock), a waiting run rebases onto
 *     main before it tests, the sweep's lanes follow the machine and the PostgreSQL server's
 *     connection limit and its nodes start from the compiled build, a step green on the same tree is
 *     not run again, and a sweep that lost a lane stops
 *     (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
 *   v2.3.0 — 2026-11-23 — A unit file red in the parallel run runs once more alone; one green alone is
 *     listed as [unit-flaky], not red (wish-pnpm-ready-a-red-unit-file-runs-once-more-alone-before-the-r).
 *   v2.2.0 — 2026-11-23 — A wide text change runs the full sweep on SQLite and the picked suites on
 *     PostgreSQL.
 *   v2.1.1 — 2026-11-22 — The checks step runs node without a shell on Windows: the shell split
 *     node's path at the space in "Program Files", and the step was red before it began.
 *   v2.1.0 — 2026-11-22 — The sweep's size follows the change: full for code, the suites that quote
 *     the changed words for text.
 *   v2.0.0 — 2026-11-22 — The whole run on this machine, and main the only ref pushed: the remote run
 *     needed a ready/<session> branch on the public repository.
 *   v1.1.0 — 2026-11-19 — The checks run here before the push (check:fast --before-push), and the sweep
 *     reruns a red suite alone (retry_red); a suite green alone is listed as FLAKY, not red
 *     (wish-pnpm-ready-slow-checks-locally-first-a-failed-suite-rerun-al).
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { holdMachineForRun } from './lib/machine-lock.js';
import { postgresLaneNote, postgresLanes, postgresMaxConnections, sweepLanes } from './lib/ready-lanes.js';
import { passedStore, type PassedStore } from './lib/ready-passed.js';
import { readyScope } from './lib/ready-scope.js';
import { runUnitWithRerun } from './lib/unit-rerun.js';

const sh = (cmd: string, args: string[], opts: { inherit?: boolean } = {}): string =>
    execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] }) ?? '';
const git = (...args: string[]): string => sh('git', args).trim();

function refuse(msg: string): never {
    console.error(`[ready] ${msg}`);
    process.exit(1);
}

/** The steps that were green on this tree in an earlier run; null until the tree is known, and with --fresh. */
let passed: PassedStore | null = null;

/**
 * A test node gets this long to start in the sweep, unless the caller set its own limit. The runner's
 * 60 s is measured on a machine doing nothing else; a workstation with a virus scanner reading every
 * file a node opens passed it on 2026-11-23, and a start limit says nothing about the change.
 */
const NODE_START_MS = '180000';

/**
 * One step of the run; a red step stops the run with what to do. With `key`, a step that was green on
 * this same tree is not run again (scripts/lib/ready-passed.ts); the checks have no key, because some
 * of them read the commits and not only the tree.
 */
function step(name: string, cmd: string, args: string[], key?: string, env: Record<string, string> = {}): void {
    const before = key ? passed?.at(key) : null;
    if (before) {
        console.log(`\n[ready] ${name}: green on this same tree at ${before}, not run again (pnpm ready --fresh runs every step)`);
        return;
    }
    const t0 = Date.now();
    console.log(`\n[ready] ${name}`);
    try {
        // Only pnpm needs the shell on Windows (it is a .cmd); node runs as itself, because its path
        // (C:\Program Files\nodejs\node.exe) has a space the shell would split.
        execFileSync(cmd, args, {
            stdio: 'inherit',
            shell: process.platform === 'win32' && cmd === 'pnpm',
            env: { ...process.env, AIMEAT_E2E_SERVER_READY_MS: process.env.AIMEAT_E2E_SERVER_READY_MS ?? NODE_START_MS, ...env },
        });
    } catch {
        refuse(`${name}: red (above). Main is not touched: fix every red line in one go, commit, and run pnpm ready again. The steps that were green are not run again while the tree stays the same.`);
    }
    if (key) passed?.add(key);
    console.log(`[ready] ${name}: green in ${Math.round((Date.now() - t0) / 60_000)} min`);
}

/**
 * The unit suite. A file red in the parallel run runs once more alone (scripts/lib/unit-rerun.ts);
 * the ones green alone are returned, so the closing lines name them. Green on this same tree in an
 * earlier run, it is not run again (scripts/lib/ready-passed.ts).
 */
function unitStep(): string[] {
    const name = 'the unit suite';
    const before = passed?.at('unit');
    if (before) {
        console.log(`\n[ready] ${name}: green on this same tree at ${before}, not run again (pnpm ready --fresh runs every step)`);
        return [];
    }
    const t0 = Date.now();
    console.log(`\n[ready] ${name}`);
    const r = runUnitWithRerun({ cwd: process.cwd(), cmd: ['pnpm', 'exec', 'vitest', 'run'], tag: 'ready' });
    if (!r.ok) refuse(`${name}: red (above). Main is not touched: fix every red line in one go, commit, and run pnpm ready again.`);
    for (const f of r.passedAlone) console.log(`[ready] [unit-flaky] ${f}: red in the parallel run, green alone`);
    passed?.add('unit');
    console.log(`[ready] ${name}: green in ${Math.round((Date.now() - t0) / 60_000)} min`);
    return r.passedAlone;
}

async function main(): Promise<void> {
    const noMerge = process.argv.includes('--no-merge');
    const session = process.env.AIMEAT_SESSION?.trim();
    if (!session) refuse('AIMEAT_SESSION is not set.');
    if (git('status', '--porcelain', '--untracked-files=no')) refuse('the tree has uncommitted changes; commit them first, so the run tests what is committed.');

    git('fetch', '-q', 'origin', 'main');
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead === 0) refuse('nothing to bring: HEAD is origin/main.');

    // One run at a time on this machine, in the order the lock comes free. Runs side by side took
    // each other's cores and disk until every one of them was red for timing (header, ONE RUN AT A TIME).
    await holdMachineForRun('ready', { session: session!, worktree: process.cwd() });

    // Main as it is when the run starts, which is after the wait: the run before this one has pushed.
    git('fetch', '-q', 'origin', 'main');
    const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
    if (behind > 0) {
        console.log(`[ready] HEAD is ${behind} commit(s) behind origin/main; rebasing onto it before the run, so the run tests the work on today's main.`);
        try {
            sh('git', ['rebase', 'origin/main'], { inherit: true });
        } catch {
            try { sh('git', ['rebase', '--abort']); } catch { /* no rebase was left open */ }
            refuse('the commits do not rebase onto origin/main without a conflict. The tree is as it was: git rebase origin/main, resolve, and run pnpm ready again.');
        }
    }
    const head = git('rev-parse', 'HEAD');
    // The sweep's lanes follow the machine, and on PostgreSQL the server's connection limit
    // (scripts/lib/ready-lanes.ts). The flag comes after the package script's own, and the last wins.
    const lanes = sweepLanes();
    const pgLimit = await postgresMaxConnections();
    const pgLanes = postgresLanes(lanes, pgLimit);
    const pgNote = postgresLaneNote(lanes, pgLanes, pgLimit);
    if (pgNote) console.log(`[ready] ${pgNote}`);
    // `--stop-on-lost-lane`: a lane that cannot restart its node ends the sweep at once (run-e2e-lane.ts).
    const onSqlite = ['test:e2e:sqlite', '--retry-red', '--stop-on-lost-lane', `--workers=${lanes}`];
    const onPostgres = ['test:e2e:postgres-kysely', '--retry-red', '--stop-on-lost-lane', `--workers=${pgLanes}`];
    // What was green on this tree in an earlier run is not run again (scripts/lib/ready-passed.ts).
    if (!process.argv.includes('--fresh')) {
        passed = passedStore(path.join(path.resolve(git('rev-parse', '--git-common-dir')), 'aimeat-ready'), git('rev-parse', 'HEAD^{tree}'));
    }
    const started = Date.now();
    console.log(`[ready] ${ahead} commit(s) at ${head.slice(0, 9)}: checks, unit suite and the E2E suites the change needs, on this machine`);

    if (!process.argv.includes('--no-checks')) {
        step('the checks (check:fast --before-push)', process.execPath, ['--import', 'tsx', 'scripts/check-fast.ts', '--before-push']);
    }
    const unitFlaky = unitStep();

    // How much of the sweep the change needs (scripts/lib/ready-scope.ts): all of it for code, the
    // suites that quote the changed words for text. --full runs all of it whatever the change is.
    const scope = process.argv.includes('--full') ? { full: true, code: ['(--full)'], suites: [], wide: null } : readyScope(path.resolve('..'), 'origin/main');
    // A sweep's nodes start from the compiled build, as the nightly's do (test/helpers/node-entry.ts):
    // through the TypeScript loader a node start cost 12.8 s a suite on 2026-11-23, 59 % of the sweep's
    // time. The tree is committed and clean, so the build made here is the tree under test.
    let built = false;
    const sweep = (name: string, args: string[], key: string): void => {
        if (!passed?.at(key) && !built) {
            step('the build the sweep starts its nodes from (pnpm build)', 'pnpm', ['build']);
            built = true;
        }
        step(name, 'pnpm', args, key, { AIMEAT_E2E_NODE_ENTRY: 'dist' });
    };
    if (scope.full) {
        console.log(`\n[ready] the change reaches code (${scope.code.slice(0, 5).join(', ')}${scope.code.length > 5 ? ` and ${scope.code.length - 5} more` : ''}): the full sweep on both backends, ${lanes} lanes on SQLite and ${pgLanes} on PostgreSQL`);
        sweep('the full E2E sweep on SQLite', onSqlite, 'sqlite:full');
        sweep('the full E2E sweep on PostgreSQL', onPostgres, 'postgres:full');
    } else if (scope.wide) {
        // A wide text change: the search for quoted words misses short quotes (ready-scope.ts header).
        const tests = scope.suites.map(s => `--test=${s}`);
        console.log(`\n[ready] the change is text only but wide (${scope.wide}): the full sweep on SQLite${scope.suites.length ? `, and on PostgreSQL the ${scope.suites.length} suite(s) that changed or quote the changed words: ${scope.suites.join(', ')}` : ''}`);
        sweep('the full E2E sweep on SQLite', onSqlite, 'sqlite:full');
        if (tests.length) sweep('the changed-text suites on PostgreSQL', [...onPostgres, ...tests], `postgres:${scope.suites.join(',')}`);
    } else if (scope.suites.length) {
        const tests = scope.suites.map(s => `--test=${s}`);
        console.log(`\n[ready] the change is text only: the ${scope.suites.length} suite(s) that changed or quote the changed words, on both backends: ${scope.suites.join(', ')}`);
        sweep('the changed-text suites on SQLite', [...onSqlite, ...tests], `sqlite:${scope.suites.join(',')}`);
        sweep('the changed-text suites on PostgreSQL', [...onPostgres, ...tests], `postgres:${scope.suites.join(',')}`);
    } else {
        console.log('\n[ready] the change is text only, and no E2E suite changed or quotes the changed words: no sweep. CI runs on main after the push.');
    }

    const minutes = Math.round((Date.now() - started) / 60_000);
    if (git('rev-parse', 'HEAD') !== head) refuse('HEAD moved during the run; run pnpm ready again on the commit you mean.');
    console.log(`\n[ready] GREEN after ${minutes} min. A suite marked [e2e-flaky] above was red once and green alone: record it as an incident on Lifecycle Central.`);
    if (unitFlaky.length > 0) console.log(`[ready] [unit-flaky] ${unitFlaky.length} unit file(s) were red in the parallel run and green alone, the machine's load and not the change: ${unitFlaky.join(', ')}. Record them as one incident on Lifecycle Central.`);
    if (noMerge) { console.log('[ready] --no-merge: main is not touched.'); return; }

    git('fetch', '-q', 'origin', 'main');
    if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') {
        console.log('[ready] main moved during the run; rebasing the commits onto it.');
        sh('git', ['rebase', 'origin/main'], { inherit: true });
    }
    sh('git', ['push', 'origin', 'HEAD:main'], { inherit: true });
    console.log(`[ready] on main: ${git('rev-parse', '--short', 'HEAD')}. CI runs there now.`);
}

await main();
