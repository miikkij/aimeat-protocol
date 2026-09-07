/**
 * @file scripts/check-fast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pre-commit hook's read-only checks, run several at a time.
 *
 *   WHY. Measured 2026-09-05, each hook command alone on a quiet machine: 33 of them cost 1.5 to
 *   15 s each and 130 s together, and the floor of 1.5 s is a tsx process starting, not the check.
 *   The hook ran them one after another. Every check here reads the tree and writes nothing (the
 *   `--check` modes compare a build against what is committed and leave it there), so they can
 *   overlap; four at a time brings the batch to about a third of the serial time.
 *
 *   WHAT STAYS OUTSIDE. Lint, the three type checks and the unit suite are long enough to be their
 *   own hook lines; check:silent-catch reads the staged files; check:invariants builds one compiler
 *   program for five gates and is a single line already. Anything that WRITES the tree (a build, a
 *   seed, a `--fix`) must never be added here: two writers on one file is a race, not a speed-up.
 *
 *   Output is buffered per check and printed whole when it finishes, so a red check reads as one
 *   block rather than interleaved lines. Every check runs; the exit code is 1 if any refused.
 * @structure CHECKS: the hook's set, each with the sentence the hook printed for it; run(): one pnpm
 *   script, buffered; main(): a pool of JOBS runners over CHECKS, a timing table, the verdict
 * @usage
 *   cd aimeat && pnpm check:fast              # the hook's set, four at a time
 *   cd aimeat && pnpm check:fast --jobs=8     # more, on a wider machine
 *   cd aimeat && pnpm check:fast --list       # the set, and nothing runs
 * @version-history
 *  - 2026-09-08: implement the A1-A6 audit reliability and sampling corrections.
 *   v1.0.0 — 2026-09-05 — Initial. Written from the pipeline-cost analysis of the same day.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { delimiter, join } from 'node:path';
import { FAST_CHECKS } from './lib/check-registry.mjs';

interface Check {
    /** The pnpm script, with its arguments as the hook passed them. */
    script: string;
    /** What the hook said while running it. */
    label: string;
}

const CHECKS: Check[] = FAST_CHECKS;

interface Outcome { check: Check; code: number; out: string; ms: number }

/** The package's scripts, read once: the command behind each check comes from here, not from pnpm. */
const SCRIPTS = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

/**
 * The shell command for a check: the package.json script plus the arguments the hook passed after
 * `--`. Not `pnpm -s <name>`: under the git hook on Windows that string reached cmd.exe as
 * `check:fast` alone ("is not recognized as an internal or external command") while working from
 * every interactive shell, and a check runner that works everywhere but in the hook is no runner.
 * node_modules/.bin goes on PATH the way pnpm would put it, so `tsx` and `depcruise` resolve.
 */
function commandFor(check: Check): string {
    const [name, ...rest] = check.script.split(' ');
    const script = SCRIPTS[name];
    if (!script) throw new Error(`No script "${name}" in package.json`);
    return [script, ...rest.filter(a => a !== '--')].join(' ');
}

const PATH_KEY = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
const BIN = join(process.cwd(), 'node_modules', '.bin');

function run(check: Check): Promise<Outcome> {
    return new Promise((settle) => {
        const t0 = Date.now();
        // One command string through the shell (tsx is tsx.cmd on Windows, which only a shell can
        // start). Every script and flag here is a literal from package.json and CHECKS.
        const child = spawn(commandFor(check), {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd(),
            env: { ...process.env, [PATH_KEY]: `${BIN}${delimiter}${process.env[PATH_KEY] ?? ''}` },
        });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('close', (code) => settle({ check, code: code ?? 1, out, ms: Date.now() - t0 }));
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes('--list')) {
        for (const c of CHECKS) console.log(`  ${c.script.padEnd(32)} ${c.label}`);
        console.log(`\n  ${CHECKS.length} checks`);
        return;
    }
    const jobsArg = args.find(a => a.startsWith('--jobs='));
    const jobs = jobsArg ? Math.max(1, Number(jobsArg.slice('--jobs='.length)) || 1) : Math.max(2, Math.min(4, cpus().length - 1));

    const t0 = Date.now();
    const queue = [...CHECKS];
    const done: Outcome[] = [];
    console.log(`[check:fast] ${CHECKS.length} checks, ${jobs} at a time\n`);

    const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next; next = queue.shift()) {
            const o = await run(next);
            done.push(o);
            const mark = o.code === 0 ? '✓' : '✗';
            console.log(`${mark} ${o.check.script}  (${(o.ms / 1000).toFixed(1)}s) — ${o.check.label}`);
            // A green check's own output is noise across thirty of them; a red one's is the point.
            if (o.code !== 0) console.log(o.out.trimEnd().split('\n').map(l => `    ${l}`).join('\n'));
        }
    };
    await Promise.all(Array.from({ length: jobs }, worker));

    const failed = done.filter(o => o.code !== 0);
    const wall = (Date.now() - t0) / 1000;
    const cpu = done.reduce((s, o) => s + o.ms, 0) / 1000;
    console.log('');
    console.log(`  ${done.length} checks, ${wall.toFixed(1)}s wall, ${cpu.toFixed(1)}s of check time`);
    const slow = [...done].sort((a, b) => b.ms - a.ms).slice(0, 5);
    console.log(`  slowest: ${slow.map(o => `${o.check.script} ${(o.ms / 1000).toFixed(1)}s`).join(', ')}`);
    if (failed.length > 0) {
        console.error(`\n✖ ${failed.length} check(s) refused: ${failed.map(o => o.check.script).join(', ')}`);
        process.exit(1);
    }
    console.log('  ✓ all pass');
}

await main();
