/**
 * @file scripts/lib/ready-train.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a batch of pnpm ready runs for real: the worktree it tests in, the stages (the
 *   checks, the unit suite, the build, the sweeps) and the push. scripts/lib/ready-batch.ts decides
 *   what happens to each waiting session; this file starts the processes it asks for.
 *
 *   A WORKTREE OF THE BATCH'S OWN. A batch tests commits of several sessions, so it cannot test in
 *   any one session's worktree. It has `.worktrees/ready-train`, made once per machine by the recipe
 *   every worktree is made by (.claude/hooks/worktree-create.sh: its own install, its own E2E port and
 *   database). No session works there. Each batch puts it on the candidate commit, removes what the
 *   last batch left untracked, and installs again when the candidate's lockfile is not the one
 *   installed. A session's own worktree is never touched by a batch.
 *
 *   ITS E2E PORT IS ITS OWN. scripts/test-env-init.ts gives a worktree of this name TRAIN_PORT
 *   (scripts/lib/worktree-ports.ts), the first port past the range a session can claim.
 *
 *   OUTPUT GOES TO THE BATCH'S LOG, NOT TO THE SCREEN. The unit suite alone prints tens of thousands
 *   of lines, and the session that drives a batch is one of several whose commits are in it. Every
 *   step's output is appended to the batch's log (scripts/lib/ready-queue.ts logFile); the screen gets
 *   one line when a step starts and one when it ends, and a red step's last lines go into the reason
 *   the refused session reads.
 *
 *   THE OUTPUT REACHES THE LOG THROUGH A PIPE, NEVER AS THE CHILD'S OWN FILE. Git Bash cannot write
 *   to a file opened for append that it is handed as its output: it exits 1 at its first line, with
 *   nothing written (measured 2026-11-23). The worktree recipe is a bash script, and so is the
 *   pre-push hook a `git push` runs, so a batch given the log as a file descriptor could make no
 *   worktree and push nothing. A pipe is what every shell is started with.
 *
 *   A RED STAGE'S PROBE is the narrowest command that shows the same red: the checks again; the red
 *   unit files alone; the red suites alone, from a build of the commit checked out. A file or a suite
 *   that does not exist on that commit (a later session of the batch added it) is green there, since
 *   a commit cannot be red for a test it does not have.
 * @structure TrainConfig · ensureTrain() · trainDeps()
 * @usage
 *   const cfg = { commonDir, stateDir, sessionAimeat, lanes, pgLanes, noMerge, logFile, say };
 *   await ensureTrain(cfg);
 *   const verdicts = await runBatch(trainDeps(cfg), entries, batchId);
 * @version-history
 *   v1.0.1 — 2026-11-23 — A sweep's probe answers green only when every red suite ran again: it ran
 *     the first 20 and answered for all of them.
 *   v1.0.0 — 2026-11-23 — Initial (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, createWriteStream, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { flakyLine, readRunResults } from './e2e-run-results.js';
import type { BatchDeps, Stage, StageResult } from './ready-batch.js';
import { passedStore, type PassedStore } from './ready-passed.js';
import type { QueueEntry } from './ready-queue.js';
import { readyScope } from './ready-scope.js';
import { failedFiles, runUnitWithRerun, type RunCommand } from './unit-rerun.js';
import { envPortOf, TRAIN_PORT, TRAIN_WORKTREE } from './worktree-ports.js';

/** A test node gets this long to start in a sweep (the runner's own limit is 60 s, for a quiet machine). */
const NODE_START_MS = '180000';
/** A probe runs this many red suites first: enough to see a red early, whatever its size. The rest run only when these were green. */
const FIRST_PROBE_SUITES = 20;
/** The colour codes a test runner prints, which a reason read as plain text does not want. */
const COLOUR_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export interface TrainConfig {
    /** Git's common directory, absolute. */
    commonDir: string;
    /** `<common>/aimeat-ready`: the queue, the green-step records and the installed-lockfile mark. */
    stateDir: string;
    /** The driving session's package folder (aimeat/): the worktree recipe is run from it. */
    sessionAimeat: string;
    /** The sweep's lanes on SQLite and on PostgreSQL (scripts/lib/ready-lanes.ts). */
    lanes: number;
    pgLanes: number;
    /** Test and do not push (`pnpm ready --no-merge`). */
    noMerge: boolean;
    /** The batch's log file. */
    logFile: string;
    /** One line to the driving session's screen and to the log. */
    say: (line: string) => void;
}

interface RunOptions { cwd: string; env?: Record<string, string> }

const trainRoot = (cfg: TrainConfig): string => path.join(path.dirname(cfg.commonDir), '.worktrees', TRAIN_WORKTREE);
const trainAimeat = (cfg: TrainConfig): string => path.join(trainRoot(cfg), 'aimeat');

/**
 * How a command is started. Only pnpm needs the shell on Windows (it is a .cmd); node and git run as
 * themselves, because a path with a space in it (C:\Program Files\nodejs\node.exe) is split by the
 * shell. Through the shell the command is one string, an argument with a space in it in double
 * quotes: Node warns about an argument list given to a shell, which it joins without quoting.
 */
function startOf(cmd: string, args: string[]): { file: string; args: string[]; shell: boolean } {
    if (!(process.platform === 'win32' && cmd === 'pnpm')) return { file: cmd, args, shell: false };
    return { file: [cmd, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' '), args: [], shell: true };
}
const header = (cfg: TrainConfig, title: string, cmd: string, args: string[]): void =>
    appendFileSync(cfg.logFile, `\n===== ${new Date().toISOString()} ${title}\n$ ${cmd} ${args.join(' ')}\n`);

/**
 * Run one command with its output piped into the batch's log as it comes (header: why a pipe).
 * Returns its exit status, null when it could not be started or did not exit by itself.
 */
async function runLogged(cfg: TrainConfig, title: string, cmd: string, args: string[], opts: RunOptions): Promise<number | null> {
    header(cfg, title, cmd, args);
    const out = createWriteStream(cfg.logFile, { flags: 'a' });
    const start = startOf(cmd, args);
    const child = spawn(start.file, start.args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: start.shell, env: { ...process.env, ...opts.env } });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const status = await new Promise<number | null>((settle) => {
        child.on('error', (e) => { out.write(`could not start ${cmd}: ${e.message}\n`); settle(null); });
        child.on('close', code => settle(code));
    });
    await new Promise<void>(done => out.end(() => done()));
    return status;
}

/**
 * The same for a caller that cannot wait on a promise (scripts/lib/unit-rerun.ts takes a function
 * that returns the status): the output is held until the command ends, then appended.
 */
function runLoggedSync(cfg: TrainConfig, title: string, cmd: string, args: string[], opts: RunOptions): number | null {
    header(cfg, title, cmd, args);
    const start = startOf(cmd, args);
    const r = spawnSync(start.file, start.args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: start.shell, env: { ...process.env, ...opts.env }, maxBuffer: 1024 * 1024 * 1024 });
    appendFileSync(cfg.logFile, r.stdout ?? '');
    appendFileSync(cfg.logFile, r.stderr ?? '');
    if (r.error) appendFileSync(cfg.logFile, `could not run ${cmd}: ${r.error.message}\n`);
    return r.status;
}

/** The last lines the log got since `from` (a byte offset): what a refused session reads first. */
function logTail(cfg: TrainConfig, from: number, lines = 25, chars = 2500): string {
    try {
        const size = statSync(cfg.logFile).size;
        const start = Math.max(from, size - 64 * 1024);
        const buf = Buffer.alloc(size - start);
        const fd = openSync(cfg.logFile, 'r');
        try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
        const text = buf.toString('utf-8').replace(COLOUR_CODES, '');
        return text.split(/\r?\n/).filter(l => l.trim()).slice(-lines).join('\n').slice(-chars);
    } catch {
        return ''; // the tail is a help; the log's path is in the verdict either way
    }
}

const logSize = (cfg: TrainConfig): number => { try { return statSync(cfg.logFile).size; } catch { return 0; } };

/** A step line on the screen and in the log when it starts and when it ends, with how long it took. */
async function timed<T>(cfg: TrainConfig, title: string, run: () => T | Promise<T>, green: (r: T) => boolean): Promise<T> {
    const t0 = Date.now();
    cfg.say(title);
    const r = await run();
    cfg.say(`${title}: ${green(r) ? 'green' : 'RED'} in ${Math.max(1, Math.round((Date.now() - t0) / 60_000))} min`);
    return r;
}

/**
 * Make the batch's worktree when this machine has none (or one whose install never finished): the
 * recipe every worktree is made by.
 */
export async function ensureTrain(cfg: TrainConfig): Promise<void> {
    const installed = (): boolean => existsSync(path.join(trainAimeat(cfg), 'node_modules', '.bin'));
    if (installed()) return;
    cfg.say(`making the batch's worktree .worktrees/${TRAIN_WORKTREE} (once on a machine; it installs its own dependencies)`);
    const status = await runLogged(cfg, `the worktree recipe for ${TRAIN_WORKTREE}`, process.execPath, ['scripts/agent-session.mjs', 'worktree', TRAIN_WORKTREE], { cwd: cfg.sessionAimeat });
    if (status !== 0 || !installed()) {
        throw new Error(`the batch's worktree .worktrees/${TRAIN_WORKTREE} could not be made (exit ${status}); the log has the recipe's lines: ${cfg.logFile}`);
    }
}

/** The real git, checkout, stages and push of a batch, in the batch's worktree. */
export function trainDeps(cfg: TrainConfig): BatchDeps {
    const root = trainRoot(cfg);
    const aimeat = trainAimeat(cfg);
    const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        // A rebase that wants an editor gets one that says yes.
        env: { ...process.env, GIT_EDITOR: 'true' },
    }).trim();
    const tree = (): string => git('rev-parse', 'HEAD^{tree}');
    const installedMark = path.join(cfg.stateDir, 'train-installed');
    const lockHash = (): string => createHash('sha256').update(readFileSync(path.join(aimeat, 'pnpm-lock.yaml'))).digest('hex');

    /** dist/ holds the build of this tree; a build is made when the checkout is another one. */
    let builtTree: string | null = null;
    const ensureBuilt = async (): Promise<boolean> => {
        const now = tree();
        if (builtTree === now) return true;
        const status = await timed(cfg, 'the build the sweep starts its nodes from (pnpm build)', () => runLogged(cfg, 'pnpm build', 'pnpm', ['build'], { cwd: aimeat }), s => s === 0);
        builtTree = status === 0 ? now : null;
        return status === 0;
    };

    const checksStage = (): Stage => {
        const name = 'the checks (check:fast --before-push)';
        const run = (): Promise<number | null> => runLogged(cfg, 'the checks', process.execPath, ['--import', 'tsx', 'scripts/check-fast.ts', '--before-push'], { cwd: aimeat });
        return {
            name,
            run: async (): Promise<StageResult> => {
                const from = logSize(cfg);
                if (await timed(cfg, name, run, s => s === 0) === 0) return { ok: true };
                const red = [...logTail(cfg, from, 400, 64 * 1024).matchAll(/^✗ (\S+)/gm)].map(m => m[1]);
                return {
                    ok: false,
                    detail: `${red.length ? red.join(', ') : 'see the log'}\n${logTail(cfg, from)}`,
                    probe: async () => await run() !== 0,
                };
            },
        };
    };

    const unitStage = (passed: PassedStore | null): Stage => ({
        name: 'the unit suite',
        run: async (): Promise<StageResult> => {
            const before = passed?.at('unit');
            if (before) { cfg.say(`the unit suite: green on this same tree at ${before}, not run again`); return { ok: true }; }
            const from = logSize(cfg);
            let report: string | null = null;
            let again: string[] = [];
            // What the rule's own runs name: the report of the first, the files of the second.
            const run: RunCommand = (cmd, args, cwd) => {
                report = args.find(a => a.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length) ?? report;
                const alone = args.indexOf('--no-file-parallelism');
                if (alone >= 0) again = args.slice(alone + 1);
                return runLoggedSync(cfg, 'the unit suite', cmd, args, { cwd });
            };
            const r = await timed(cfg, 'the unit suite', () => runUnitWithRerun({ cwd: aimeat, cmd: ['pnpm', 'exec', 'vitest', 'run'], tag: 'ready', run }), x => x.ok);
            if (r.ok) {
                passed?.add('unit');
                return { ok: true, notes: r.passedAlone.map(f => `[unit-flaky] ${f}: red in the parallel run, green alone`) };
            }
            const files = again.length ? again : (report ? failedFiles(report) ?? [] : []);
            const names = files.map(f => f.replace(/\\/g, '/').replace(/^.*?\/aimeat\//, ''));
            return {
                ok: false,
                detail: `${files.length ? `${files.length} unit file(s): ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}` : 'no failed file could be read from the report'}\n${logTail(cfg, from)}`,
                probe: async () => {
                    if (files.length === 0) return await runLogged(cfg, 'the unit suite again', 'pnpm', ['exec', 'vitest', 'run'], { cwd: aimeat }) !== 0;
                    const here = files.filter(f => existsSync(f));
                    if (here.length === 0) return false;
                    return await runLogged(cfg, 'the red unit files again, alone', 'pnpm', ['-s', 'exec', 'vitest', 'run', '--no-file-parallelism', ...here], { cwd: aimeat }) !== 0;
                },
            };
        },
    });

    const sweepStage = (passed: PassedStore | null, name: string, script: string, lanes: number, suites: string[], key: string): Stage => ({
        name,
        run: async (): Promise<StageResult> => {
            const before = passed?.at(key);
            if (before) { cfg.say(`${name}: green on this same tree at ${before}, not run again`); return { ok: true }; }
            const env = { AIMEAT_E2E_NODE_ENTRY: 'dist', AIMEAT_E2E_SERVER_READY_MS: process.env.AIMEAT_E2E_SERVER_READY_MS ?? NODE_START_MS };
            const from = logSize(cfg);
            if (!await ensureBuilt()) {
                return { ok: false, detail: `pnpm build failed\n${logTail(cfg, from)}`, probe: async () => !await ensureBuilt() };
            }
            // A path from the package folder, with no space in it: the command goes through a shell on Windows.
            const resultsArg = `test-results/ready-batch/${key.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}-${Date.now()}.json`;
            const args = [script, '--retry-red', '--stop-on-lost-lane', `--workers=${lanes}`, ...suites.map(s => `--test=${s}`), `--results-out=${resultsArg}`];
            const status = await timed(cfg, name, () => runLogged(cfg, name, 'pnpm', args, { cwd: aimeat, env }), s => s === 0);
            let red: string[] = [];
            const notes: string[] = [];
            try {
                const read = readRunResults(path.join(aimeat, resultsArg));
                red = read.suites.filter(s => s.red).map(s => s.name);
                for (const s of read.suites) if (s.flaky) notes.push(flakyLine(read.dbType, s.name, s.flaky));
            } catch { /* a run that ended before its summary wrote no results: the probe runs it whole */ }
            if (status === 0) { passed?.add(key); return { ok: true, notes }; }
            return {
                ok: false,
                detail: `${red.length ? `${red.length} suite(s): ${red.slice(0, 10).join(', ')}${red.length > 10 ? ', …' : ''}` : 'the run ended without a result for its suites'}\n${logTail(cfg, from)}`,
                probe: async () => {
                    if (!await ensureBuilt()) return true;
                    if (red.length === 0) return await runLogged(cfg, `${name} again`, 'pnpm', args.filter(a => !a.startsWith('--results-out=')), { cwd: aimeat, env }) !== 0;
                    const here = red.filter(s => existsSync(path.join(aimeat, 'test', `${s}.ts`)));
                    if (here.length === 0) return false;
                    const again = async (some: string[]): Promise<boolean> =>
                        await runLogged(cfg, `${name}: ${some.length} red suite(s) again`, 'pnpm', [script, '--retry-red', `--workers=${Math.min(lanes, some.length)}`, ...some.map(s => `--test=${s}`)], { cwd: aimeat, env }) !== 0;
                    // Red is known from the first of them. Green is known only when every one ran: the
                    // batch reads a green probe as a red that did not repeat, and goes on to the push.
                    if (await again(here.slice(0, FIRST_PROBE_SUITES))) return true;
                    return here.length > FIRST_PROBE_SUITES && await again(here.slice(FIRST_PROBE_SUITES));
                },
            };
        },
    });

    return {
        git,
        log: cfg.say,
        logFile: cfg.logFile,
        fetchMain: () => { git('fetch', '-q', 'origin', 'main'); return git('rev-parse', 'origin/main'); },
        checkout: async (commit) => {
            git('checkout', '-q', '-f', '--detach', commit);
            git('clean', '-fdq');
            const want = lockHash();
            let have = '';
            try { have = readFileSync(installedMark, 'utf-8').trim(); } catch { /* never installed by a batch: install now */ }
            if (have !== want) {
                const status = await timed(cfg, 'the install for this lockfile (pnpm install --frozen-lockfile)', () => runLogged(cfg, 'pnpm install', 'pnpm', ['install', '--frozen-lockfile'], { cwd: aimeat }), s => s === 0);
                if (status !== 0) throw new Error(`pnpm install --frozen-lockfile failed in the batch's worktree (exit ${status}); log: ${cfg.logFile}`);
                writeFileSync(installedMark, `${want}\n`, 'utf-8');
                builtTree = null;
            }
            // The worktree's env files were written when it was made, by the test:env:init of main as
            // it was then. One made before that script knew this worktree's port has a hashed one,
            // which a session can hold too: the candidate's script writes the right one.
            if (envPortOf(aimeat) !== TRAIN_PORT) {
                await runLogged(cfg, 'pnpm test:env:init --force', 'pnpm', ['test:env:init', '--force'], { cwd: aimeat });
                if (envPortOf(aimeat) !== TRAIN_PORT) throw new Error(`the batch's worktree has E2E port ${envPortOf(aimeat)}, not ${TRAIN_PORT}, and pnpm test:env:init --force did not change it; log: ${cfg.logFile}`);
            }
        },
        plan: async (entries: QueueEntry[]) => {
            const full = entries.some(e => e.flags.full);
            const passed = entries.some(e => e.flags.fresh) ? null : passedStore(cfg.stateDir, tree());
            const stages: Stage[] = [];
            if (!entries.every(e => e.flags.noChecks)) stages.push(checksStage());
            stages.push(unitStage(passed));
            // How much of the sweep the candidate needs (scripts/lib/ready-scope.ts): all of it for
            // code, the suites that quote the changed words for text.
            const scope = full ? { full: true, code: ['(--full)'], suites: [] as string[], wide: null } : readyScope(root, 'origin/main');
            const picked = scope.suites.join(',');
            if (scope.full) {
                cfg.say(`the candidate reaches code (${scope.code.slice(0, 5).join(', ')}${scope.code.length > 5 ? ` and ${scope.code.length - 5} more` : ''}): the full sweep on both backends, ${cfg.lanes} lanes on SQLite and ${cfg.pgLanes} on PostgreSQL`);
                stages.push(sweepStage(passed, 'the full E2E sweep on SQLite', 'test:e2e:sqlite', cfg.lanes, [], 'sqlite:full'));
                stages.push(sweepStage(passed, 'the full E2E sweep on PostgreSQL', 'test:e2e:postgres-kysely', cfg.pgLanes, [], 'postgres:full'));
            } else if (scope.wide) {
                cfg.say(`the candidate is text only but wide (${scope.wide}): the full sweep on SQLite${scope.suites.length ? `, and on PostgreSQL the ${scope.suites.length} suite(s) that changed or quote the changed words: ${scope.suites.join(', ')}` : ''}`);
                stages.push(sweepStage(passed, 'the full E2E sweep on SQLite', 'test:e2e:sqlite', cfg.lanes, [], 'sqlite:full'));
                if (scope.suites.length) stages.push(sweepStage(passed, 'the changed-text suites on PostgreSQL', 'test:e2e:postgres-kysely', cfg.pgLanes, scope.suites, `postgres:${picked}`));
            } else if (scope.suites.length) {
                cfg.say(`the candidate is text only: the ${scope.suites.length} suite(s) that changed or quote the changed words, on both backends: ${scope.suites.join(', ')}`);
                stages.push(sweepStage(passed, 'the changed-text suites on SQLite', 'test:e2e:sqlite', cfg.lanes, scope.suites, `sqlite:${picked}`));
                stages.push(sweepStage(passed, 'the changed-text suites on PostgreSQL', 'test:e2e:postgres-kysely', cfg.pgLanes, scope.suites, `postgres:${picked}`));
            } else {
                cfg.say('the candidate is text only, and no E2E suite changed or quotes the changed words: no sweep. CI runs on main after the push.');
            }
            return stages;
        },
        push: async (tip, base) => {
            if (cfg.noMerge) return { ok: true, main: null };
            git('checkout', '-q', '-f', '--detach', tip);
            git('fetch', '-q', 'origin', 'main');
            if (git('rev-parse', 'origin/main') !== base) {
                cfg.say('main moved during the run; rebasing the tested commits onto it.');
                try {
                    git('rebase', '-q', 'origin/main');
                } catch {
                    try { git('rebase', '--abort'); } catch { /* no rebase was left open */ }
                    return { ok: false, reason: 'main moved during the run, and the tested commits no longer apply on it. Run pnpm ready again: the next batch starts from main as it is now.' };
                }
            }
            const from = logSize(cfg);
            const status = await timed(cfg, 'the push to main', () => runLogged(cfg, 'the push to main', 'git', ['-C', root, 'push', 'origin', 'HEAD:main'], { cwd: root }), s => s === 0);
            if (status !== 0) return { ok: false, reason: `every stage was green, and the push to main was refused (the pre-push hook or the remote):\n${logTail(cfg, from)}` };
            return { ok: true, main: git('rev-parse', 'HEAD') };
        },
    };
}
