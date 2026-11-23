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
 *   WHAT IT REFUSES AT ONCE. A dirty tree (what is tested must be what is committed), no AIMEAT_SESSION,
 *   and nothing to bring.
 *
 *   ONE RUN AT A TIME, FOR EVERY SESSION THAT IS WAITING. A pnpm ready writes what it asks for into the
 *   machine's queue (scripts/lib/ready-queue.ts) and then waits for its verdict. The machine-wide
 *   `whole-run` lock (scripts/lib/machine-lock.ts; pnpm gate takes the same one) lets one run have the
 *   machine. The waiting pnpm ready that gets the lock drives a BATCH (scripts/lib/ready-batch.ts): the
 *   commits of every session waiting at that moment, rebased in the order they asked onto main as it
 *   is then, tested together in a worktree of the batch's own (scripts/lib/ready-train.ts), and pushed
 *   as one. Every pnpm ready in the batch then reads its own verdict and ends: on main, or refused
 *   with the reason. A session that asks while a batch runs is in the next one.
 *     Before 2026-11-23 nothing held runs apart: several sessions ran their sweeps side by side, every
 *   node start passed its 60 s limit, each run went red for timing and started again, and a change of
 *   words took a working day to reach main. One run at a time ended that and left N waiting sessions
 *   costing N runs; a batch costs one.
 *
 *   WHEN A BATCH IS RED. The stage's narrowest red (the red unit files, the red suites) is run on the
 *   candidate's commits in order, and the first where it shows belongs to the session that brought it.
 *   That session is refused, the candidate is built again without it, and every stage runs again: a
 *   commit that lands was tested whole. A session whose commits do not apply is refused before any
 *   stage runs. The others are not held up by either.
 *
 *   WHAT THE SCREEN SHOWS. One line when a step starts and one when it ends. Everything a step printed
 *   is in the batch's log, whose path a refusal names beside the red step's last lines.
 *
 *   A SECOND RUN ON THE SAME TREE STARTS WHERE THE FIRST WAS RED. The unit suite and each sweep that
 *   were green on a tree are recorded (scripts/lib/ready-passed.ts) and not run again while the
 *   candidate's tree is the same; a fix, a rebase or another session in the batch gives another tree
 *   and every step runs. The checks always run. `--fresh` runs every step.
 *
 *   THE SWEEP. Its lanes follow the machine and, on PostgreSQL, the server's connection limit
 *   (scripts/lib/ready-lanes.ts). Its nodes start from the compiled build (`pnpm build`, under a minute;
 *   AIMEAT_E2E_NODE_ENTRY, test/helpers/node-entry.ts), as the nightly's on GitHub do and as production
 *   runs: a sweep restarts a node before every suite, and through the TypeScript loader those restarts
 *   were most of its time. A lane whose node cannot start twice ends the sweep (`--stop-on-lost-lane`),
 *   and a node gets 180 s to start, not the runner's 60.
 *
 *   A SUITE RED FOR TIMING. The sweep runs with `--retry-red`: a red suite runs once more, alone
 *   (test/run-e2e-retry.ts). Red again, the run is red. Green alone, it does not stop the merge, and the
 *   verdict carries it with the [e2e-flaky] mark: record each as an incident on Lifecycle Central.
 *
 *   A UNIT FILE RED FOR TIMING. The unit suite runs whole, in parallel. A file red there runs once more
 *   alone (scripts/lib/unit-rerun.ts, the rule pnpm gate has had since 2026-11-14). Red again, the run
 *   is red. Green alone, it does not stop the merge, and the verdict carries it with the [unit-flaky]
 *   mark: record these as one incident on Lifecycle Central.
 *
 *   MAIN MOVED DURING THE RUN. Another machine or a person pushes while the batch is going. When
 *   origin/main is no longer under the tested commit at the end, the commits are rebased onto it and
 *   pushed; CI runs on main as always. They are not tested a second time, or a busy day would never end.
 *
 *   AFTER IT LANDS. The commits on main are the session's commits rebased, so they have new ids. The
 *   session's own worktree is rebased onto main by its pnpm ready, which leaves it at main.
 * @usage
 *   cd aimeat && AIMEAT_SESSION=cc-alice-x pnpm ready         # wait for a batch: check, test, sweep, push main
 *   cd aimeat && pnpm ready --no-merge                         # test this session's commits alone, push nothing
 *   cd aimeat && pnpm ready --no-checks                        # skip the static checks (when every session of the batch asks)
 *   cd aimeat && pnpm ready --full                             # the full sweep even for a text change
 *   cd aimeat && pnpm ready --fresh                            # run every step, also one green on this tree
 *   cd aimeat && pnpm ready --workers=6                        # the sweep's lanes by hand (1 to 16), when this run drives
 *
 *   HOW MUCH OF THE SWEEP. A candidate that reaches code runs the full sweep. A change of words only
 *   (locales, docs, comments, the prose inside strings) runs the suites that changed or quote the
 *   changed words, and none when no suite does (scripts/lib/ready-scope.ts; Jouni, 2026-11-22). A wide
 *   change of words (20 product files, or 100 removed texts) also runs the full sweep on SQLite, because
 *   the search misses a suite that quotes only a short part of a sentence (Jouni, 2026-11-23).
 * @version-history
 *   v3.0.0 — 2026-11-23 — One run for every waiting session: a queue, a batch tested in a worktree of
 *     its own, and a verdict for each session (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
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
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { releaseMachineLock, tryMachineLock, WHOLE_RUN_LOCK, WHOLE_RUN_WAIT_MS } from './lib/machine-lock.js';
import { MAX_BATCH, runBatch } from './lib/ready-batch.js';
import { postgresLaneNote, postgresLanes, postgresMaxConnections, sweepLanes } from './lib/ready-lanes.js';
import { readyQueue, type QueueEntry, type ReadyQueue, type Verdict } from './lib/ready-queue.js';
import { ensureTrain, trainDeps, type TrainConfig } from './lib/ready-train.js';

const sh = (cmd: string, args: string[]): string =>
    execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) ?? '';
const git = (...args: string[]): string => sh('git', args).trim();
const short = (sha: string): string => sha.slice(0, 9);
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function refuse(msg: string): never {
    console.error(`[ready] ${msg}`);
    process.exit(1);
}

/**
 * Drive one batch while this process holds the machine: the sessions waiting now (this one alone
 * for `--no-merge`), tested together, each answered in the queue.
 */
async function driveBatch(queue: ReadyQueue, mine: QueueEntry, commonDir: string, stateDir: string): Promise<void> {
    const waiting = queue.waiting();
    // A `--no-merge` entry is tested by its own session, alone, and joins nobody's batch.
    const entries = mine.flags.noMerge ? waiting.filter(e => e.id === mine.id) : waiting.filter(e => !e.flags.noMerge).slice(0, MAX_BATCH);
    if (entries.length === 0) return;

    const batch = `batch-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${mine.session}`;
    const logFile = queue.logFile(batch);
    const say = (line: string): void => {
        console.log(`[ready] ${line}`);
        appendFileSync(logFile, `[ready] ${new Date().toISOString()} ${line}\n`);
    };
    say(`${batch}: ${entries.length} session(s) waiting, tested in one run: ${entries.map(e => e.session).join(', ')}. Log: ${logFile}`);

    // The sweep's lanes follow the machine, and on PostgreSQL the server's connection limit
    // (scripts/lib/ready-lanes.ts).
    const lanes = sweepLanes(undefined, process.argv.find(a => a.startsWith('--workers='))?.slice('--workers='.length));
    const pgLimit = await postgresMaxConnections();
    const pgLanes = postgresLanes(lanes, pgLimit);
    const pgNote = postgresLaneNote(lanes, pgLanes, pgLimit);
    if (pgNote) say(pgNote);

    const cfg: TrainConfig = { commonDir, stateDir, sessionAimeat: process.cwd(), lanes, pgLanes, noMerge: mine.flags.noMerge, logFile, say };
    let verdicts: Map<string, Verdict>;
    const started = Date.now();
    try {
        ensureTrain(cfg);
        verdicts = await runBatch(trainDeps(cfg), entries, batch);
    } catch (e) {
        // A fault of the run itself (the worktree, an install, git): nobody's commits were judged.
        const reason = `the batch stopped on a fault of its own, not on anybody's commits: ${(e as Error).message.split('\n')[0]} Run pnpm ready again.`;
        say(reason);
        verdicts = new Map(entries.map(entry => [entry.id, { status: 'refused', reason, batch, log: logFile } satisfies Verdict]));
    }
    for (const entry of entries) {
        queue.settle(entry, verdicts.get(entry.id) ?? { status: 'refused', reason: 'the batch gave no verdict for this entry; run pnpm ready again.', batch, log: logFile });
    }
    say(`${batch}: ended after ${Math.max(1, Math.round((Date.now() - started) / 60_000))} min.`);
}

/** After its commits landed: put this worktree on main, where they now are under new ids. */
function followMain(head: string): void {
    if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=no')) {
        console.log(`[ready] this worktree changed while it waited, so it is left as it is. The commits up to ${short(head)} are on main: git rebase origin/main brings the rest over them.`);
        return;
    }
    try {
        git('fetch', '-q', 'origin', 'main');
        git('rebase', '-q', 'origin/main');
        console.log(`[ready] this worktree is on main now (${short(git('rev-parse', 'HEAD'))}).`);
    } catch {
        try { git('rebase', '--abort'); } catch { /* no rebase was left open */ }
        console.log(`[ready] this worktree is still at ${short(head)}; its commits are on main under new ids: git rebase origin/main.`);
    }
}

async function main(): Promise<void> {
    const flag = (name: string): boolean => process.argv.includes(name);
    const session = process.env.AIMEAT_SESSION?.trim();
    if (!session) refuse('AIMEAT_SESSION is not set.');
    if (git('status', '--porcelain', '--untracked-files=no')) refuse('the tree has uncommitted changes; commit them first, so the run tests what is committed.');

    git('fetch', '-q', 'origin', 'main');
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead === 0) refuse('nothing to bring: HEAD is origin/main.');
    const head = git('rev-parse', 'HEAD');

    const commonDir = path.resolve(git('rev-parse', '--git-common-dir'));
    const stateDir = path.join(commonDir, 'aimeat-ready');
    const queue = readyQueue(stateDir);
    // The commit stays reachable while it waits, whatever the session does with its HEAD meanwhile.
    const ref = `refs/aimeat-ready/${session}`;
    git('update-ref', ref, head);
    const mine = queue.enqueue({
        session: session!, worktree: process.cwd(), sha: head,
        flags: { full: flag('--full'), fresh: flag('--fresh'), noChecks: flag('--no-checks'), noMerge: flag('--no-merge') },
    });
    process.on('exit', () => {
        queue.forget(mine);
        try { git('update-ref', '-d', ref); } catch { /* removed already, or git is gone with the process */ }
    });
    console.log(`[ready] ${ahead} commit(s) at ${short(head)} in the queue. One run tests every waiting session's commits together, on this machine.`);

    const owner = { session: session!, worktree: process.cwd() };
    let verdict: Verdict | null = null;
    let told = '';
    for (;;) {
        verdict = queue.verdictFor(mine);
        if (verdict) break;
        const { held, holder } = tryMachineLock(WHOLE_RUN_LOCK, owner, { staleMs: WHOLE_RUN_WAIT_MS });
        if (held) {
            try {
                // Answered while the lock was changing hands: the batch before this one took it.
                if (!queue.verdictFor(mine)) await driveBatch(queue, mine, commonDir, stateDir);
            } finally {
                releaseMachineLock(held);
            }
            continue;
        }
        const line = holder
            ? `waiting: ${holder.session} has the machine for its run in ${holder.worktree} (since ${holder.at}). If that run is a batch this entry is in, the verdict comes when it ends; otherwise the next batch takes it.`
            : 'waiting: another run has the machine.';
        if (line !== told) { told = line; console.log(`[ready] ${line}`); }
        await sleep(2000);
    }

    for (const note of 'notes' in verdict ? verdict.notes : []) console.log(`[ready] ${note}`);
    if (verdict.status === 'refused') {
        console.error(`[ready] REFUSED (${verdict.batch}): ${verdict.reason}`);
        if (verdict.log) console.error(`[ready] Everything the run printed: ${verdict.log}`);
        console.error('[ready] Main is not touched by these commits. Fix every red line in one go, commit, and run pnpm ready again.');
        process.exit(1);
    }
    if (verdict.status === 'green') {
        console.log(`[ready] GREEN (${verdict.batch}). --no-merge: main is not touched.`);
        return;
    }
    console.log(`[ready] on main: ${short(verdict.main)} (${verdict.batch}${verdict.with.length ? `, together with ${verdict.with.join(', ')}` : ''}). CI runs there now.`);
    if (verdict.notes.some(n => /\[(e2e|unit|batch)-flaky\]/.test(n))) console.log('[ready] A line marked flaky above was red once and green when run again: record it as an incident on Lifecycle Central.');
    followMain(head);
}

await main();
