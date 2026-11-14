/**
 * @file scripts/nightly-preflight.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `pnpm nightly:preflight`: before the nightly E2E sweep is started (or before 00:00 UTC,
 *   when it starts by itself), run locally the part of it that can go red, in minutes instead of the
 *   hour GitHub takes to say so. What it runs is chosen in scripts/lib/nightly-preflight-plan.ts:
 *   the suites and unit files the last nightly reported red, the E2E suites changed since that
 *   nightly's commit (uncommitted edits included), the upgrade test when storage changed and the
 *   packed package's start when the package changed. It prints the plan with a reason per line,
 *   runs it, and closes with one line per step.
 *
 *   FLAGS.
 *     --plan       print the plan and stop
 *     --full       add the release-4-0-0 job whole, the upgrade test on both backends and the pack
 *                  start (about twenty minutes)
 *     --since=SHA  compare with this commit instead of the last nightly's
 *     --dispatch   when every step is green, HEAD is origin/main, CI on main is not red and no
 *                  nightly is running, start the nightly (`gh workflow run e2e-full.yml`)
 *
 *   WHY. On 2026-11-14 a nightly started by hand reported after an hour two failures that a local
 *   run of three suites shows in five minutes: a unit test fixed on main after the run's commit,
 *   and an E2E suite whose check raced a fixed wait. The sweep stays the nightly's job; this only
 *   makes sure the run is not spent finding what was already knowable.
 * @usage cd aimeat && pnpm nightly:preflight [--plan] [--full] [--since=<sha>] [--dispatch]
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readCiState, describeState, NIGHTLY_WORKFLOW } from './lib/ci-runs.mjs';
import { redFromLog, planSteps, type Step, type JobReds } from './lib/nightly-preflight-plan.js';

const args = process.argv.slice(2);
const full = args.includes('--full');
const planOnly = args.includes('--plan');
const dispatch = args.includes('--dispatch');
const sinceArg = args.find(a => a.startsWith('--since='))?.slice('--since='.length);
const isWin = process.platform === 'win32';

function git(argv: string[]): string {
    return execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const state = await readCiState({ maxAgeMs: 60_000 });
for (const line of describeState(state)) console.log(line);

// The last nightly's reds, from its failed-job log.
let reds = new Map<string, JobReds>();
const failedJobs = state.nightly.state === 'red' ? (state.nightly.failedJobs ?? []).filter(j => !j.startsWith('issue')) : [];
if (failedJobs.length && state.nightly.runId) {
    try {
        const log = execFileSync('gh', ['run', 'view', String(state.nightly.runId), '--log-failed'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        reds = redFromLog(log);
    } catch (err) {
        console.log(`  The last nightly's log could not be read (${String((err as Error).message).split('\n')[0]}); its red jobs are rerun where a job names its backend.`);
    }
}

// The files changed since the last nightly's commit, uncommitted and new files included.
const base = sinceArg ?? state.nightly.sha;
let changed: string[] = [];
if (base) {
    try {
        git(['cat-file', '-e', `${base}^{commit}`]);
        const repoRoot = git(['rev-parse', '--show-toplevel']);
        const tracked = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8', cwd: repoRoot }).split('\n');
        const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8', cwd: repoRoot }).split('\n');
        changed = [...new Set([...tracked, ...untracked].map(s => s.trim()).filter(Boolean))];
        // A package.json change that touches only `scripts` changes nothing the package ships, and the
        // pack start costs about ten minutes here; drop it from what the plan reads.
        if (changed.includes('aimeat/package.json')) {
            const withoutScripts = (text: string): string => { const p = JSON.parse(text); delete p.scripts; return JSON.stringify(p); };
            try {
                const before = execFileSync('git', ['show', `${base}:aimeat/package.json`], { encoding: 'utf8', cwd: repoRoot });
                if (withoutScripts(before) === withoutScripts(readFileSync('package.json', 'utf8'))) changed = changed.filter(f => f !== 'aimeat/package.json');
            } catch { /* unreadable: keep it, so the pack start runs */ }
        }
    } catch {
        console.log(`  Commit ${base.slice(0, 9)} is not in this clone; run \`git fetch\` to compare with it.`);
    }
} else {
    console.log('  No finished nightly to compare with; pass --since=<sha>.');
}

const versionAware = readFileSync('test/version-aware-suites.txt', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const steps = planSteps({ reds, failedJobs, changed, versionAware, full });

const label = (s: Step): string => {
    switch (s.kind) {
        case 'e2e': return `E2E ${s.backend}${s.version ? ` as ${s.version}` : ''}: ${s.suites.join(', ')}`;
        case 'e2e-list': return `E2E ${s.backend} as ${s.version}: ${s.file}`;
        case 'unit': return `unit${s.version ? ` as ${s.version}` : ''}: ${s.files.length ? s.files.join(', ') : 'every file'}`;
        case 'upgrade': return `upgrade from the last release, ${s.backend}`;
        case 'pack-smoke': return 'pack, install and start the npm package';
        case 'skip': return 'skipped';
    }
};

console.log(`\nNightly preflight against ${base ? base.slice(0, 9) : 'nothing'}, ${changed.length} file(s) changed since:`);
if (!steps.length) console.log('  nothing to run: the last nightly had no red that this tool reruns, and no suite, storage or package file changed.');
for (const s of steps) console.log(`  • ${label(s)}\n      ${s.reason}`);
if (planOnly) process.exit(0);

function run(cmd: string, argv: string[], env: Record<string, string> = {}): boolean {
    const r = spawnSync(cmd, argv, { stdio: 'inherit', env: { ...process.env, ...env }, shell: isWin && cmd === 'pnpm' });
    return r.status === 0;
}
const envFile = (b: string): string | null => existsSync(`.env.test.${b}`) ? `--env-file=.env.test.${b}` : null;
const node = process.execPath;

const results: Array<{ step: Step; ok: boolean; ms: number; note?: string }> = [];
for (const step of steps) {
    if (step.kind === 'skip') { results.push({ step, ok: true, ms: 0, note: step.reason }); continue; }
    const started = Date.now();
    let ok = false;
    let note: string | undefined;
    const version: Record<string, string> = 'version' in step && step.version ? { AIMEAT_TEST_SOFTWARE_VERSION: step.version } : {};
    console.log(`\n=== ${label(step)} ===`);
    if (step.kind === 'e2e' || step.kind === 'e2e-list') {
        const ef = envFile(step.backend);
        if (!ef) note = `.env.test.${step.backend} is missing: run \`pnpm test:env:init\``;
        else {
            const which = step.kind === 'e2e' ? step.suites.map(s => `--test=${s}`) : [`--tests-file=${step.file}`, '--workers=4'];
            ok = run(node, [ef, '--import', 'tsx', 'test/run-e2e-ci.ts', ...which], version);
        }
    } else if (step.kind === 'unit') {
        ok = run('pnpm', ['exec', 'vitest', 'run', ...step.files], { ...version, AIMEAT_TEST_MODE: 'true', AIMEAT_BASE_URL: 'http://localhost:40050' });
    } else if (step.kind === 'upgrade') {
        const ef = envFile(step.backend);
        if (!ef) note = `.env.test.${step.backend} is missing: run \`pnpm test:env:init\``;
        else ok = run(node, [ef, '--import', 'tsx', 'test/upgrade-from-release.ts'], { AIMEAT_DB: step.backend });
    } else if (step.kind === 'pack-smoke') {
        ok = run('pnpm', ['build']) && run('pnpm', ['gen:shrinkwrap']) && run(node, ['scripts/pack-smoke.mjs']);
    }
    results.push({ step, ok, ms: Date.now() - started, note });
}

console.log('\nNightly preflight:');
for (const r of results) {
    const mark = r.step.kind === 'skip' ? '-' : r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${label(r.step)}  ${(r.ms / 1000).toFixed(0)} s${r.note ? `  (${r.note})` : ''}`);
}
const red = results.some(r => !r.ok);
console.log(red ? '  ✗ the nightly would go red on the line above' : `  ✓ ${results.length ? 'every step green' : 'nothing to run'}`);

if (dispatch) {
    const head = git(['rev-parse', 'HEAD']);
    const remote = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
    const refusal = red ? 'a step is red'
        : head !== remote ? `HEAD ${head.slice(0, 9)} is not origin/main ${remote.slice(0, 9)}: push first, the nightly runs main`
        : state.ci.state === 'red' ? 'CI on main is red, and the nightly runs the same unit suite'
        : state.nightly.running ? `a nightly is already running: ${state.nightly.running.url}`
        : null;
    if (refusal) { console.log(`  Not started: ${refusal}.`); process.exit(1); }
    const ok = run('gh', ['workflow', 'run', NIGHTLY_WORKFLOW, '--ref', 'main']);
    console.log(ok ? '  Nightly started on main.' : '  Starting the nightly failed.');
    process.exit(ok ? 0 : 1);
}
process.exit(red ? 1 : 0);
