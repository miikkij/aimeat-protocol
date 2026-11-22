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
 *   2026-11-22), and the pre-push hook refuses one. The local sweep takes about two hours instead of
 *   35 minutes. CI still runs on main after the push, as it did before 2026-11-15.
 *
 *   WHY AT ALL. Ruled by the developer on 2026-11-15: develop against the suites of the area only, run
 *   `pnpm check:fast` once when the work looks done and fix every red line in one go, then the full run
 *   before main, so that nothing reaches main red.
 *
 *   WHAT IT REFUSES. A dirty tree (what is tested must be what is committed), no AIMEAT_SESSION, a HEAD
 *   behind origin/main (rebase first, then the run tests the work on today's main), and nothing to bring.
 *
 *   ONE RUN AT A TIME. The two E2E backends use the session's own port and database from its
 *   .env.test.* files (pnpm test:env:init), so two sessions do not clear each other's data; the machine
 *   still has one CPU, and two sweeps at once take longer than two in a row.
 *
 *   A SUITE RED FOR TIMING. The sweep runs with `--retry-red`: a red suite runs once more, alone
 *   (test/run-e2e-retry.ts). Red again, the run is red. Green alone, it does not stop the merge, and the
 *   runner prints it with the [e2e-flaky] mark: record each as an incident on Lifecycle Central.
 *
 *   MAIN MOVED DURING THE RUN. Other sessions push while the run is going. When origin/main is no longer
 *   under HEAD at the end, the commits are rebased onto it and pushed; CI runs on main as always. They
 *   are not tested a second time, or a busy day would never end.
 * @usage
 *   cd aimeat && AIMEAT_SESSION=cc-alice-x pnpm ready         # check, test, sweep, push main
 *   cd aimeat && pnpm ready --no-merge                         # stop after a green run
 *   cd aimeat && pnpm ready --no-checks                        # skip the static checks (just run on this tree)
 *   cd aimeat && pnpm ready --full                             # the full sweep even for a text change
 *
 *   HOW MUCH OF THE SWEEP. A change that reaches code runs the full sweep. A change of words only
 *   (locales, docs, comments, the prose inside strings) runs the suites that changed or quote the
 *   changed words, and none when no suite does (scripts/lib/ready-scope.ts; Jouni, 2026-11-22).
 * @version-history
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
import { readyScope } from './lib/ready-scope.js';

const sh = (cmd: string, args: string[], opts: { inherit?: boolean } = {}): string =>
    execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] }) ?? '';
const git = (...args: string[]): string => sh('git', args).trim();

function refuse(msg: string): never {
    console.error(`[ready] ${msg}`);
    process.exit(1);
}

/** One step of the run; a red step stops the run with what to do. */
function step(name: string, cmd: string, args: string[]): void {
    const t0 = Date.now();
    console.log(`\n[ready] ${name}`);
    try {
        execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    } catch {
        refuse(`${name}: red (above). Main is not touched: fix every red line in one go, commit, and run pnpm ready again.`);
    }
    console.log(`[ready] ${name}: green in ${Math.round((Date.now() - t0) / 60_000)} min`);
}

async function main(): Promise<void> {
    const noMerge = process.argv.includes('--no-merge');
    const session = process.env.AIMEAT_SESSION?.trim();
    if (!session) refuse('AIMEAT_SESSION is not set.');
    if (git('status', '--porcelain', '--untracked-files=no')) refuse('the tree has uncommitted changes; commit them first, so the run tests what is committed.');

    git('fetch', '-q', 'origin', 'main');
    const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
    if (behind > 0) refuse(`HEAD is ${behind} commit(s) behind origin/main: git rebase origin/main, then pnpm ready.`);
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead === 0) refuse('nothing to bring: HEAD is origin/main.');
    const head = git('rev-parse', 'HEAD');
    const started = Date.now();
    console.log(`[ready] ${ahead} commit(s) at ${head.slice(0, 9)}: checks, unit suite and the full sweep on both backends, on this machine`);

    if (!process.argv.includes('--no-checks')) {
        step('the checks (check:fast --before-push)', process.execPath, ['--import', 'tsx', 'scripts/check-fast.ts', '--before-push']);
    }
    step('the unit suite', 'pnpm', ['exec', 'vitest', 'run']);

    // How much of the sweep the change needs (scripts/lib/ready-scope.ts): all of it for code, the
    // suites that quote the changed words for text. --full runs all of it whatever the change is.
    const scope = process.argv.includes('--full') ? { full: true, code: ['(--full)'], suites: [] } : readyScope(path.resolve('..'), 'origin/main');
    if (scope.full) {
        console.log(`\n[ready] the change reaches code (${scope.code.slice(0, 5).join(', ')}${scope.code.length > 5 ? ` and ${scope.code.length - 5} more` : ''}): the full sweep on both backends`);
        step('the full E2E sweep on SQLite', 'pnpm', ['test:e2e:sqlite', '--retry-red']);
        step('the full E2E sweep on PostgreSQL', 'pnpm', ['test:e2e:postgres-kysely', '--retry-red']);
    } else if (scope.suites.length) {
        const tests = scope.suites.map(s => `--test=${s}`);
        console.log(`\n[ready] the change is text only: the ${scope.suites.length} suite(s) that changed or quote the changed words, on both backends: ${scope.suites.join(', ')}`);
        step('the changed-text suites on SQLite', 'pnpm', ['test:e2e:sqlite', '--retry-red', ...tests]);
        step('the changed-text suites on PostgreSQL', 'pnpm', ['test:e2e:postgres-kysely', '--retry-red', ...tests]);
    } else {
        console.log('\n[ready] the change is text only, and no E2E suite changed or quotes the changed words: no sweep. CI runs on main after the push.');
    }

    const minutes = Math.round((Date.now() - started) / 60_000);
    if (git('rev-parse', 'HEAD') !== head) refuse('HEAD moved during the run; run pnpm ready again on the commit you mean.');
    console.log(`\n[ready] GREEN after ${minutes} min. A suite marked [e2e-flaky] above was red once and green alone: record it as an incident on Lifecycle Central.`);
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
