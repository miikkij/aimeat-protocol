/**
 * @file test/run-e2e-lane.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One lane of the E2E runner: restart the node, run one suite, read its result, for
 *   every suite of the lane in turn. Moved out of run-e2e-ci.ts (which keeps the suite lists, the
 *   argument parsing and the summary) with the changes below.
 *
 *   WHAT CHANGED (QA audit 2026-10-16):
 *     - A TIME LIMIT PER SUITE (P1-06). A suite settled only when its process closed, and about 180
 *       suites end by letting the event loop empty, so one open socket held the lane until somebody
 *       stopped the run by hand. Each suite now gets SUITE_TIME_LIMIT_MS (15 minutes, a longer limit
 *       for the few that need it, AIMEAT_E2E_SUITE_TIMEOUT_MS overrides), after which its whole
 *       process tree is ended and the suite is TIMED OUT in the table; the lane goes on.
 *     - A RESTART ERROR NO LONGER ENDS THE RUN (P1-09). A failed stop, database clean or start
 *       rejected the lane and the run exited with one "Lane failed" line and no summary. The cycle is
 *       tried once more; when it fails again, this suite and the lane's remaining ones are NOT RUN with
 *       the reason, and the run still prints its table for everything that ran.
 *     - THE NODE'S OUTPUT IS KEPT FOR A RED SUITE (P1-07). helpers/runner-node-log.ts writes it per
 *       suite; a red suite's line is followed by the node's last lines and the file's path. A node
 *       that exits while the suite runs makes the suite red with NODE DIED.
 *     - SKIPS ARE COUNTED (P1-04, F7b-01). The suite's `K skipped` is read and shown in its own
 *       column; a suite with no test case is red (scripts/lib/e2e-results.ts decides the verdicts).
 * @structure SuiteResult · suiteTimeLimitMs() · runLane() · runTest() · endTree()
 * @usage Imported by test/run-e2e-ci.ts. Not a suite; it runs nothing on its own.
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Extracted from run-e2e-ci.ts, with a per-suite time limit, a retried
 *     restart, the node's output for a red suite and a skip count (QA audit W12: P1-04, P1-06, P1-07,
 *     P1-09, F7b-01).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { anonymousModeFor, cleanDatabase, pinnedEnv, startServer, stopServer, type RunnerTarget } from './run-e2e-server.js';
import { acquirePortLocks, releasePortLocks, suiteOwnPorts } from '../scripts/lib/e2e-ports.js';
import { classify, parseResults } from '../scripts/lib/e2e-results.js';
import { discardNodeLogOnClose, nodeLogPath, nodeLogTail } from './helpers/runner-node-log.js';

export interface SuiteResult {
    name: string; passed: number; failed: number; skipped: number; total: number; time: string; exitCode: number;
    lane: number;
    /** Stop + clean + start before this suite, ms; 0 for a lane's first suite. */
    cycleMs: number;
    /** The node's anonymous mode for this suite: 'on', 'off', or 'external' (not the runner's). */
    anonymous: string;
    timedOut?: boolean;
    /** Set when the suite never started because the lane could not restart its node. */
    notRun?: string;
    /** Set when the lane's node exited while the suite ran. */
    nodeDied?: string;
}

/** A suite's source, or nothing when it cannot be read: such a suite has no port to lock. */
function readSource(suite: string): string {
    try { return readFileSync(suite, 'utf-8'); } catch { return ''; }
}

const DEFAULT_SUITE_TIME_LIMIT_MS = 15 * 60_000;
/**
 * Suites measured past a few minutes get more. e2e-connect-cli took 1428 s in the coverage sweep of
 * 2026-10-13 (the longest by far); every other suite finished under 180 s there.
 */
const SUITE_TIME_LIMIT_MS: Record<string, number> = {
    'e2e-connect-cli': 45 * 60_000,
};

export function suiteTimeLimitMs(name: string): number {
    const env = Number(process.env.AIMEAT_E2E_SUITE_TIMEOUT_MS);
    if (Number.isFinite(env) && env > 0) return Math.max(env, SUITE_TIME_LIMIT_MS[name] ?? 0);
    return SUITE_TIME_LIMIT_MS[name] ?? DEFAULT_SUITE_TIME_LIMIT_MS;
}

export interface LaneOptions {
    /** Who this run is for, recorded on the machine-wide port lock. */
    session: string;
    /** Whether a suite is in the guard tier, where a skipped test is red. */
    isGuard: (name: string) => boolean;
}

export async function runLane(lane: number, target: RunnerTarget, suites: string[], stream: boolean, opts: LaneOptions): Promise<SuiteResult[]> {
    const tag = stream ? '' : `[lane ${lane}] `;
    const results: SuiteResult[] = [];
    let server: ChildProcess | null = null;

    /** Stop the previous node (if any), empty the database, start the next node: tried twice. */
    async function cycle(name: string): Promise<void> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (server) {
                    await stopServer(server, target);
                    server = null;
                }
                // The database is emptied BEFORE the first suite too, by the same call the loop makes
                // between suites: a solo run of any suite used to start on the previous run's data.
                await cleanDatabase(target);
                server = await startServer(target, name);
                return;
            } catch (e) {
                lastError = e;
                console.error(`${tag}Restarting the node for ${name} failed (attempt ${attempt} of 2): ${(e as Error).message}`);
            }
        }
        throw lastError;
    }

    try {
        for (let i = 0; i < suites.length; i++) {
            const suite = suites[i];
            const name = basename(suite, '.ts');
            // The node starts per suite, because the suite decides its anonymous-mode setting
            // (ANONYMOUS_OFF_SUITES in run-e2e-server.ts). An external node has its own setting.
            const anonymous = target.external ? 'external' : anonymousModeFor(name) === 'false' ? 'off' : 'on';

            let cycleMs = 0;
            if (!target.external) {
                const c0 = Date.now();
                try {
                    await cycle(name);
                } catch (e) {
                    // The run goes on: this suite and the rest of the lane are reported NOT RUN with
                    // the reason, and the other lanes' results reach the summary (QA audit P1-09).
                    const reason = `the lane's node could not be restarted: ${(e as Error).message.split('\n')[0]}`;
                    for (const rest of suites.slice(i)) {
                        const restName = basename(rest, '.ts');
                        console.error(`${tag}! ${restName}  NOT RUN (${reason})`);
                        results.push({ name: restName, passed: 0, failed: 0, skipped: 0, total: 0, time: '0.00s', exitCode: 1, lane, cycleMs: 0, anonymous, notRun: reason });
                    }
                    break;
                }
                if (i > 0) cycleMs = Date.now() - c0;
                else console.log(`${tag}Server ready on :${target.port}.\n`);
            }

            if (stream) {
                console.log(`\n${'─'.repeat(40)}`);
                console.log(`  ${name}  (anonymous mode ${anonymous})`);
                console.log(`${'─'.repeat(40)}`);
            }

            // The ports this suite binds for itself are taken under the machine-wide lock first
            // (scripts/lib/e2e-ports.ts): another session that runs the same suite right now holds the
            // same numbers, and waiting the seconds it needs is the alternative to EADDRINUSE or to
            // a suite that talks to the other session's stub. The wait is not in the suite's time.
            const ownPorts = suiteOwnPorts(readSource(suite), Number(target.port));
            const held = await acquirePortLocks(ownPorts, { suite: name, session: opts.session }, {
                onWait: (port, holder) => console.log(`${tag}${name} waits for port ${port}, which ${holder ? `${holder.session} holds for ${holder.suite}` : 'another run holds'}.`),
            });
            const t0 = Date.now();
            let output: string, exitCode: number, timedOut: boolean;
            try { ({ output, exitCode, timedOut } = await runTest(suite, name, target, stream)); }
            finally { releasePortLocks(held); }
            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            const parsed = parseResults(output);
            const node: ChildProcess | null = server;
            const nodeDied = node && (node.exitCode !== null || node.signalCode !== null)
                ? `exit ${node.exitCode ?? node.signalCode}` : undefined;
            const result: SuiteResult = { name, ...parsed, time: `${elapsed}s`, exitCode, lane, cycleMs, anonymous, timedOut, nodeDied };
            const verdict = classify(result, { guard: opts.isGuard(name) });
            if (!stream) {
                console.log(`${tag}${verdict.mark} ${name}  ${parsed.passed}/${parsed.total}${parsed.skipped ? `, ${parsed.skipped} skipped` : ''} in ${elapsed}s, anonymous mode ${anonymous}${verdict.note ? `  ${verdict.note}` : ''}`);
                // A green suite's output is what the summary already says; a red one's is the point.
                if (verdict.red) console.log(output.trimEnd());
            } else if (verdict.red && verdict.note) {
                console.log(`  ${verdict.note}`);
            }
            if (node) {
                if (verdict.red) {
                    const tail = nodeLogTail(node);
                    console.log(`${tag}The node's last lines during ${name} (whole output: ${nodeLogPath(node) ?? 'not kept'}):\n${tail ? tail.split('\n').map(l => `    ${l}`).join('\n') : '    (the node printed nothing)'}`);
                } else {
                    discardNodeLogOnClose(node);
                }
            }
            results.push(result);
        }
    } finally {
        if (server) {
            // Reported, not thrown: a failure to shut down must not replace whatever error brought
            // us into this block, which is the thing the reader needs.
            await stopServer(server, target).catch((e: unknown) => {
                console.error(`${tag}Could not stop the test server: ${(e as Error).message}`);
            });
        }
    }
    return results;
}

/**
 * The suites running right now. A suite runs in its own process group on POSIX, so the terminal's
 * Ctrl-C no longer reaches it: the runner ends them itself when it stops.
 */
const running = new Set<ChildProcess>();
function endRunning(): void { for (const c of running) endTree(c); }
process.once('exit', endRunning);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { endRunning(); process.exit(130); });
}

/** End a suite's process and every process it started (a suite may run nodes of its own). */
function endTree(child: ChildProcess): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
    } catch {
        child.kill('SIGKILL');
    }
}

/** Run one suite with the runner's pins, under its time limit. */
export function runTest(suitePath: string, name: string, target: RunnerTarget, stream: boolean): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
    return new Promise((settle) => {
        // The suite gets the SAME pins as the server. A suite derives what it expects from its own
        // environment, so any pin it cannot see is a place where the two can disagree about what is
        // being tested: e2e-x402-testnet skips when the off-chain double is in use, could not see
        // that it was, and so ran its real-network acceptance cases against the double.
        const child = spawn('node', ['--import', 'tsx', suitePath], {
            env: { ...process.env, ...pinnedEnv(target, name), E2E_BASE: target.baseUrl },
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd(),
            // Its own process group on POSIX, so the time limit can end the suite and every node or
            // stub it started with one signal.
            detached: process.platform !== 'win32',
        });

        running.add(child);
        let output = '';
        child.stdout?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            if (stream) process.stdout.write(s);
        });
        child.stderr?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            if (stream) process.stderr.write(s);
        });

        const limitMs = suiteTimeLimitMs(name);
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            const line = `\n✗ ${name} reached its time limit of ${Math.round(limitMs / 60_000)} min and was ended with every process it started (AIMEAT_E2E_SUITE_TIMEOUT_MS changes the limit).\n`;
            output += line;
            if (stream) process.stdout.write(line);
            endTree(child);
        }, limitMs);

        child.on('close', (code) => {
            running.delete(child);
            clearTimeout(timer);
            settle({ output, exitCode: timedOut ? 124 : code ?? 1, timedOut });
        });
    });
}
