/**
 * @file scripts/lib/unit-rerun.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A vitest run whose failed files are run once more alone, one at a time, before the
 *   caller refuses. Used by `pnpm gate` (scripts/gate.ts) and `pnpm ready` (scripts/ready.ts), so the
 *   two decide a red unit file by one rule.
 *
 *   WHY. Run whole on a machine where other sessions run their own suites, a few of the unit files run
 *   past a time limit, a different set each run, and every one passes alone. The gate got this rule on
 *   2026-11-14. `pnpm ready` did not have it, and on 2026-11-23 a words-only commit was red three runs
 *   in a row in the unit step, 2 to 4 files of about 1500 each time, none of them twice.
 *
 *   THE RULE. The first run is the whole command, in parallel. Green: done. Red: the failed files are
 *   read from vitest's JSON report and run again with `--no-file-parallelism`. A file red again
 *   refuses. A file green alone does not refuse and is returned in `passedAlone`, so the caller names
 *   it: the load must stay visible, and is never read as the change.
 *
 *   WHAT STILL REFUSES WITHOUT A SECOND RUN. A red run with no failed file in the report (an error
 *   outside a test file, a report that cannot be read), and more than MAX_RERUN_FILES failed files:
 *   that many is the change, not the load, and their paths would not fit a Windows command line.
 * @structure
 *   - MAX_RERUN_FILES
 *   - failedFiles(reportPath): the failed files a vitest JSON report names
 *   - runUnitWithRerun(opts): the two runs and the verdict
 * @usage
 *   const r = runUnitWithRerun({ cwd: AIMEAT, cmd: ['pnpm', '-s', 'exec', 'vitest', 'run'], tag: 'ready' });
 *   if (!r.ok) process.exit(1);
 *   for (const f of r.passedAlone) console.log(f);
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial: moved out of scripts/gate.ts (runUnit, 2026-11-14) so pnpm ready
 *     uses it too, with a ceiling on how many files a second run takes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** More failed files than this is not run again: it is the change, and the paths outgrow a command line. */
export const MAX_RERUN_FILES = 40;

/** Runs one command and returns its exit status (null when it did not exit by itself). */
export type RunCommand = (cmd: string, args: string[], cwd: string) => number | null;

export interface UnitRerunOptions {
    /** The folder the commands run in (the aimeat/ package). */
    cwd: string;
    /** The vitest command of the first run, program first: ['pnpm', '-s', 'exec', 'vitest', 'run', ...]. */
    cmd: string[];
    /** The prefix of the printed lines: 'gate' or 'ready'. */
    tag: string;
    /** For a test: stands in for the real process start. */
    run?: RunCommand;
}

export interface UnitRerunResult {
    ok: boolean;
    /** Files red in the parallel run and green alone, as paths from the package folder. */
    passedAlone: string[];
}

const spawnRun: RunCommand = (cmd, args, cwd) =>
    spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status;

/** The failed files a vitest JSON report names; null when the report cannot be read. */
export function failedFiles(reportPath: string): string[] | null {
    try {
        const body = JSON.parse(readFileSync(reportPath, 'utf8')) as { testResults?: Array<{ name: string; status: string }> };
        return (body.testResults ?? []).filter(r => r.status === 'failed').map(r => r.name);
    } catch {
        return null;
    }
}

/** A report's absolute file name as a path from the package folder, with forward slashes. */
const fromPackage = (file: string): string => file.replace(/\\/g, '/').replace(/^.*?\/aimeat\//, '');

export function runUnitWithRerun(opts: UnitRerunOptions): UnitRerunResult {
    const run = opts.run ?? spawnRun;
    const report = join(mkdtempSync(join(tmpdir(), `aimeat-${opts.tag}-unit-`)), 'report.json');
    const first = run(opts.cmd[0], [...opts.cmd.slice(1), '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], opts.cwd);
    if (first === 0) return { ok: true, passedAlone: [] };

    const failed = failedFiles(report);
    if (failed === null) {
        console.error(`[${opts.tag}] the unit report could not be read, so the failed files cannot be run again alone`);
        return { ok: false, passedAlone: [] };
    }
    if (failed.length === 0) return { ok: false, passedAlone: [] };
    if (failed.length > MAX_RERUN_FILES) {
        console.error(`[${opts.tag}] ${failed.length} unit files failed, more than ${MAX_RERUN_FILES}: that is the change, not the machine's load, so they are not run again`);
        return { ok: false, passedAlone: [] };
    }

    console.log(`\n[${opts.tag}] ${failed.length} unit file(s) failed; running them again alone, one at a time…`);
    const again = run('pnpm', ['-s', 'exec', 'vitest', 'run', '--no-file-parallelism', ...failed], opts.cwd);
    if (again !== 0) return { ok: false, passedAlone: [] };
    return { ok: true, passedAlone: failed.map(fromPackage) };
}
